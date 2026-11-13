import fs from "node:fs";
import { Router } from "express";
import ExcelJS from "exceljs";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { audit } from "../lib/audit.js";
import { employeeIdsWithRole, notify } from "../lib/notify.js";
import { sheetUpload, attachmentUpload, absoluteUploadPath, relativeUploadPath, removeFiles } from "../lib/upload.js";
import { readSheet, pickString, parseSheetDate, parseSheetNumber } from "../lib/sheet.js";
import { todayYmd, toDate, ymd } from "../lib/dates.js";
import { getSettings, settingNumber, ROLE_VALUES } from "../lib/settings.js";
import { HttpError } from "../middleware/error.js";
import { currentUser, hasRole, requireAuth, requireRole, teamIds, type AuthUser } from "../middleware/auth.js";
import {
  assetClearance, assetClearanceFor, assetInclude, assigneeLabel, canSeeCost, canSeeIncidentAttachment, canSeeRecoveryAmount, canSeeRegister,
  nextAssetTag, notifyRecoverySet, serializeAsset, serializeAssignment, serializeIncident,
} from "../services/assets.js";
import { pkr } from "../services/expenses.js";
import { assetHandoverPdf } from "../services/pdf.js";
import type { AssetCondition, Prisma, Role } from "../generated/prisma/client.js";

const RECOVERY_FINDINGS = ["NEGLIGENCE", "MISUSE", "UNAUTHORISED_USE", "PROCEDURE_VIOLATION", "WEAR_AND_TEAR"] as const;
const DISPOSAL_REASONS = ["DISPOSED", "SOLD", "REPLACED", "WRITTEN_OFF"] as const;

export const assetsRouter = Router();
assetsRouter.use(requireAuth);

const issues = (e: z.ZodError) => e.issues.map((i) => `${i.path.length ? `${i.path.join(".")}: ` : ""}${i.message}`).join("; ");
const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const r = schema.safeParse(body);
  if (!r.success) throw new HttpError(400, issues(r.error));
  return r.data;
};
const CONDITIONS = ["NEW", "GOOD", "FAIR", "DAMAGED"] as const;
const optionalYmd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().or(z.literal("").transform(() => null));
const optionalText = z.string().trim().max(300).nullable().optional().transform((v) => v || null);
const optionalMoney = z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().min(0).nullable()).optional();

function assertRegister(user: AuthUser) {
  if (!canSeeRegister(user)) throw new HttpError(403, "You do not have access to the asset register");
}

async function loadAsset(id: number) {
  const asset = await prisma.asset.findUnique({ where: { id }, include: assetInclude });
  if (!asset) throw new HttpError(404, "Asset not found");
  return asset;
}

// ---------- Categories ----------

assetsRouter.get("/categories", async (req, res) => {
  const all = req.query.all === "1" && hasRole(currentUser(req), "ADMIN");
  const rows = await prisma.assetCategory.findMany({ where: all ? {} : { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  res.json(rows);
});

const categorySchema = z.object({
  name: z.string().trim().min(2, "Give the category a name").max(60),
  kind: z.enum(["PHYSICAL", "ACCESS"]).optional(),
  mustReturnOnExit: z.boolean().optional(),
  // Cyber Security Incident Response Policy: categories that can hold company data also notify
  // assets.cyberSecurityNotifyRole when one is reported lost, stolen or damaged.
  dataBearing: z.boolean().optional(),
  // A9: who may authorise a transfer of this category; empty means Admin.
  transferAuthorisingRole: z.enum(ROLE_VALUES).nullable().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});
const uniqueName = (err: unknown): never => {
  if (err && typeof err === "object" && "code" in err && err.code === "P2002") throw new HttpError(409, "A category with this name already exists");
  throw err;
};

assetsRouter.post("/categories", requireRole("ADMIN"), async (req, res) => {
  const data = parse(categorySchema, req.body);
  const c = await prisma.assetCategory.create({ data }).catch(uniqueName);
  await audit(currentUser(req).id, "CREATE", "AssetCategory", c.id, data);
  res.status(201).json(c);
});

assetsRouter.put("/categories/:id", requireRole("ADMIN"), async (req, res) => {
  const data = parse(categorySchema.partial(), req.body);
  const id = Number(req.params.id);
  const c = await prisma.assetCategory.update({ where: { id }, data }).catch(uniqueName);
  await audit(currentUser(req).id, "UPDATE", "AssetCategory", id, data);
  res.json(c);
});

// ---------- Register ----------

assetsRouter.get("/", async (req, res) => {
  const user = currentUser(req);
  assertRegister(user);
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const status = typeof req.query.status === "string" && req.query.status ? req.query.status : undefined;
  const categoryId = req.query.categoryId ? Number(req.query.categoryId) : undefined;
  const view = typeof req.query.view === "string" ? req.query.view : "all";
  const where: Prisma.AssetWhereInput = {
    ...(status ? { status: status as never } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(q ? { OR: [{ tag: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }, { serialNumber: { contains: q, mode: "insensitive" } }] } : {}),
    ...(view === "awaiting" ? { assignments: { some: { returnedAt: null, confirmedAt: null } } } : {}),
  };
  const rows = await prisma.asset.findMany({
    where,
    include: {
      category: true,
      assignments: { where: { returnedAt: null }, include: { employee: { select: { fullName: true, code: true } }, department: { select: { name: true } } } },
    },
    orderBy: { tag: "asc" },
    take: 500,
  });
  const cost = canSeeCost(user);
  res.json(rows.map((a) => {
    const current = a.assignments[0];
    return {
      id: a.id, tag: a.tag, name: a.name, category: a.category.name, kind: a.category.kind, serialNumber: a.serialNumber,
      status: a.status, condition: a.condition, warrantyUntil: a.warrantyUntil ? ymd(a.warrantyUntil) : null,
      cost: cost ? (a.cost == null ? null : Number(a.cost)) : undefined,
      holder: current ? assigneeLabel(current) : null,
      awaitingConfirmation: !!current && !current.confirmedAt,
    };
  }));
});

const assetSchema = z.object({
  tag: z.string().trim().max(40).optional().transform((v) => v || undefined),
  categoryId: z.coerce.number().int(),
  name: z.string().trim().min(2, "Enter the make / model or name").max(120),
  serialNumber: optionalText,
  purchaseDate: optionalYmd,
  cost: optionalMoney,
  warrantyUntil: optionalYmd,
  condition: z.enum(CONDITIONS).optional(),
  storageLocation: optionalText,
  notes: optionalText,
});

const assetFields = (input: Partial<z.infer<typeof assetSchema>>) => {
  const { purchaseDate, warrantyUntil, tag: _tag, ...rest } = input;
  return {
    ...rest,
    ...(purchaseDate !== undefined ? { purchaseDate: purchaseDate ? toDate(purchaseDate) : null } : {}),
    ...(warrantyUntil !== undefined ? { warrantyUntil: warrantyUntil ? toDate(warrantyUntil) : null } : {}),
  };
};
const uniqueTag = (err: unknown): never => {
  if (err && typeof err === "object" && "code" in err && err.code === "P2002") throw new HttpError(409, "Another asset already has this tag");
  throw err;
};

assetsRouter.post("/", requireRole("ADMIN"), async (req, res) => {
  const user = currentUser(req);
  const input = parse(assetSchema, req.body);
  if (!(await prisma.assetCategory.findUnique({ where: { id: input.categoryId } }))) throw new HttpError(400, "Choose a category");
  const tag = input.tag ?? (await nextAssetTag());
  const a = await prisma.asset.create({ data: { ...(assetFields(input) as Prisma.AssetUncheckedCreateInput), tag } }).catch(uniqueTag);
  await audit(user.id, "CREATE", "Asset", a.id, { tag });
  res.status(201).json({ id: a.id, tag: a.tag });
});

assetsRouter.get("/mine", async (req, res) => {
  const user = currentUser(req);
  const rows = await prisma.assetAssignment.findMany({
    where: { employeeId: user.id },
    include: {
      asset: { include: { category: true } },
      employee: { select: { id: true, fullName: true, code: true } },
      department: { select: { id: true, name: true } },
      issuedBy: { select: { fullName: true } },
      receivedBy: { select: { fullName: true } },
      request: { select: { requestId: true } },
      incidents: { orderBy: { createdAt: "desc" } },
      accessories: true,
    },
    orderBy: { issuedAt: "desc" },
  });
  // A13: items waiting for this employee's confirmation in an open verification round.
  const pending = await prisma.assetVerificationItem.findMany({
    where: { assignmentId: { in: rows.map((a) => a.id) }, confirmedAt: null, round: { closedAt: null } },
    select: { id: true, assignmentId: true, round: { select: { dueDate: true } } },
  });
  const pendingByAssignment = new Map(pending.map((p) => [p.assignmentId, { itemId: p.id, dueDate: ymd(p.round.dueDate) }]));
  res.json(rows.map((a) => ({
    ...serializeAssignment(a),
    asset: { id: a.asset.id, tag: a.asset.tag, name: a.asset.name, serialNumber: a.asset.serialNumber, category: a.asset.category.name, kind: a.asset.category.kind, status: a.asset.status, warrantyUntil: a.asset.warrantyUntil ? ymd(a.asset.warrantyUntil) : null },
    incidents: a.incidents.map((i) => ({ id: i.id, type: i.type, status: i.status, description: i.description, createdAt: i.createdAt, recoveryAmount: i.recoveryAmount == null ? null : Number(i.recoveryAmount), recoveryNote: i.recoveryNote, writeOffNote: i.writeOffNote })),
    pendingVerification: pendingByAssignment.get(a.id) ?? null,
  })));
});

// A line manager sees what their team holds (no cost values, no recovery amounts)
assetsRouter.get("/team", async (req, res) => {
  const user = currentUser(req);
  const ids = await teamIds(user.id);
  const rows = await prisma.assetAssignment.findMany({
    where: { employeeId: { in: ids }, returnedAt: null },
    include: { asset: { include: { category: true } }, employee: { select: { id: true, fullName: true, code: true } }, incidents: { select: { status: true } } },
    orderBy: [{ employeeId: "asc" }, { issuedAt: "asc" }],
  });
  res.json(rows.map((a) => ({
    id: a.id, employee: a.employee, issuedAt: a.issuedAt, confirmedAt: a.confirmedAt,
    asset: { tag: a.asset.tag, name: a.asset.name, category: a.asset.category.name, status: a.asset.status },
    // A6: the team can see that something was reported, never the recovery amount.
    hasOpenIncident: a.incidents.some((i) => i.status !== "CLOSED" && i.status !== "WRITTEN_OFF"),
  })));
});

// A10/A14: Management authorises in writing that the employee keeps this item past their exit.
assetsRouter.post("/assignments/:id/retain", requireRole("MANAGEMENT"), async (req, res) => {
  const user = currentUser(req);
  const { note } = parse(z.object({ note: z.string().trim().min(3, "Give the reason in writing") }), req.body);
  const a = await prisma.assetAssignment.findUnique({ where: { id: Number(req.params.id) }, include: { asset: true } });
  if (!a || a.employeeId == null) throw new HttpError(404, "Item not found");
  if (a.returnedAt) throw new HttpError(400, "This item has already been returned");
  await prisma.assetAssignment.update({ where: { id: a.id }, data: { retainedById: user.id, retainedAt: new Date(), retainedNote: note } });
  await audit(user.id, "UPDATE", "AssetAssignment", a.id, { retained: note });
  await notify([a.employeeId], `Retained with authorisation: ${a.asset.name} (${a.asset.tag})`, `Management has authorised you to keep ${a.asset.name}, tag ${a.asset.tag}: ${note}.`, "/inventory");
  res.json({ ok: true });
});

assetsRouter.get("/clearance/:employeeId", async (req, res) => {
  const user = currentUser(req);
  const employeeId = Number(req.params.employeeId);
  const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { managerId: true } });
  if (!emp) throw new HttpError(404, "Employee not found");
  if (!(canSeeRegister(user) || user.id === employeeId || emp.managerId === user.id)) throw new HttpError(403, "You do not have access to this");
  res.json(assetClearanceFor(user, await assetClearance(employeeId)));
});

// ---------- Incidents, recoveries, requests to fulfil (lists) ----------

const incidentListInclude = {
  asset: { select: { id: true, tag: true, name: true, category: { select: { name: true } } } },
  employee: { select: { fullName: true, code: true } },
  reportedBy: { select: { fullName: true } },
  recordedBy: { select: { fullName: true } },
  recoverySetBy: { select: { fullName: true } },
  recoveryApprovedBy: { select: { fullName: true } },
  writtenOffBy: { select: { fullName: true } },
} satisfies Prisma.AssetIncidentInclude;

assetsRouter.get("/incidents", async (req, res) => {
  const user = currentUser(req);
  assertRegister(user);
  const view = typeof req.query.view === "string" ? req.query.view : "open";
  const status: Prisma.AssetIncidentWhereInput =
    view === "open" ? { status: { in: ["REPORTED", "RECORDED", "RECOVERY_PENDING_APPROVAL"] } }
    : view === "recoveries" ? { status: "RECOVERY_SET" }
    : {};
  const rows = await prisma.assetIncident.findMany({ where: status, include: incidentListInclude, orderBy: { createdAt: "desc" }, take: 300 });
  const suggested = await policeReportSuggestedTypes();
  res.json(withPoliceHint(rows.map((i) => ({
    ...serializeIncident(i, canSeeRecoveryAmount(user, i.employeeId), canSeeIncidentAttachment(user, i.employeeId)),
    asset: { id: i.asset.id, tag: i.asset.tag, name: i.asset.name, category: i.asset.category.name },
  })), suggested));
});

assetsRouter.get("/requests", requireRole("ADMIN"), async (_req, res) => {
  const rows = await prisma.assetRequest.findMany({
    where: { assignmentId: null, request: { status: "APPROVED" } },
    include: { category: true, request: { select: { id: true, updatedAt: true, employee: { select: { id: true, fullName: true, code: true } } } } },
    orderBy: { request: { updatedAt: "asc" } },
  });
  res.json(rows.map((r) => ({
    requestId: r.request.id, employee: r.request.employee, category: { id: r.category.id, name: r.category.name }, reason: r.reason,
    neededBy: r.neededBy ? ymd(r.neededBy) : null, approvedAt: r.request.updatedAt,
  })));
});

// ---------- A13: periodic physical audit (asset verification rounds) ----------
// Registered here (a single path segment, like /incidents and /requests above), not after the generic
// /:id route further down, which would otherwise swallow "/verification-rounds" as an asset id.

const verificationRoundSchema = z.object({
  scope: z.enum(["ALL", "DEPARTMENT", "CATEGORY"]),
  departmentId: z.coerce.number().int().optional(),
  categoryId: z.coerce.number().int().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a due date"),
});

assetsRouter.get("/verification-rounds", async (req, res) => {
  assertRegister(currentUser(req));
  const rounds = await prisma.assetVerificationRound.findMany({
    orderBy: { createdAt: "desc" },
    include: { department: { select: { name: true } }, category: { select: { name: true } }, createdBy: { select: { fullName: true } }, items: { select: { confirmedAt: true, discrepancyNote: true } } },
  });
  res.json(rounds.map((r) => ({
    id: r.id, scope: r.scope, department: r.department?.name ?? null, category: r.category?.name ?? null, dueDate: ymd(r.dueDate),
    createdBy: r.createdBy.fullName, createdAt: r.createdAt, closedAt: r.closedAt,
    total: r.items.length, confirmed: r.items.filter((i) => i.confirmedAt).length, discrepancies: r.items.filter((i) => i.discrepancyNote).length,
  })));
});

assetsRouter.post("/verification-rounds", requireRole("ADMIN"), async (req, res) => {
  const user = currentUser(req);
  const input = parse(verificationRoundSchema, req.body);
  if (input.scope === "DEPARTMENT" && !input.departmentId) throw new HttpError(400, "Choose a department");
  if (input.scope === "CATEGORY" && !input.categoryId) throw new HttpError(400, "Choose a category");
  const assignments = await prisma.assetAssignment.findMany({
    where: {
      returnedAt: null, assigneeType: "EMPLOYEE",
      ...(input.scope === "DEPARTMENT" ? { employee: { departmentId: input.departmentId } } : {}),
      ...(input.scope === "CATEGORY" ? { asset: { categoryId: input.categoryId } } : {}),
    },
    select: { id: true, employeeId: true },
  });
  const round = await prisma.$transaction(async (tx) => {
    const r = await tx.assetVerificationRound.create({
      data: { scope: input.scope, departmentId: input.departmentId ?? null, categoryId: input.categoryId ?? null, dueDate: toDate(input.dueDate), createdById: user.id },
    });
    if (assignments.length) await tx.assetVerificationItem.createMany({ data: assignments.map((a) => ({ roundId: r.id, assignmentId: a.id })) });
    return r;
  });
  await audit(user.id, "CREATE", "AssetVerificationRound", round.id, { scope: input.scope, items: assignments.length });
  const employeeIds = [...new Set(assignments.map((a) => a.employeeId).filter((id): id is number => id != null))];
  await notify(employeeIds, "Please confirm your company items", `Admin started an asset verification round, due ${input.dueDate}. Open My Inventory and confirm the items listed there are in your possession and in the condition shown.`, "/inventory");
  res.status(201).json({ id: round.id, items: assignments.length });
});

// ---------- Template and import ----------

const TEMPLATE_COLUMNS = [
  ["Tag", "Leave empty to generate EHB-AST-0001…", 18],
  ["Category", "Must match a category name", 18],
  ["Name", "Make / model or account name", 28],
  ["Serial number", "", 18],
  ["Purchase date", "dd/mm/yyyy", 14],
  ["Cost", "PKR", 12],
  ["Warranty until", "dd/mm/yyyy", 14],
  ["Condition", "New, Good, Fair or Damaged", 12],
  ["Storage location", "Where it is kept in stock", 18],
  ["Notes", "", 24],
  ["Assigned to employee", "Employee code or work email", 24],
  ["Assigned to department", "Department name", 20],
  ["Assigned to location", "e.g. Meeting room 2", 20],
] as const;

assetsRouter.get("/import-template", requireRole("ADMIN"), async (_req, res) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Assets");
  ws.columns = TEMPLATE_COLUMNS.map(([header, , width]) => ({ header, key: header, width }));
  ws.getRow(1).font = { bold: true };
  ws.addRow(["", "Laptop", "Dell Latitude 5440", "7XK2Q73", "15/01/2026", 285000, "15/01/2029", "Good", "IT store", "", "EHB-2025-006", "", ""]);
  ws.addRow(["EHB-PRN-01", "Other", "HP LaserJet M404", "VNB3K12", "", "", "", "Good", "", "Shared printer", "", "Engineering", ""]);
  const help = wb.addWorksheet("Help");
  help.columns = [{ header: "Column", width: 24 }, { header: "How to fill it", width: 60 }];
  help.getRow(1).font = { bold: true };
  for (const [header, hint] of TEMPLATE_COLUMNS) help.addRow([header, hint]);
  help.addRow([]);
  help.addRow(["Categories"]).font = { bold: true };
  for (const c of await prisma.assetCategory.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } })) help.addRow([c.name, c.mustReturnOnExit ? "Must be returned on exit" : "Not required on exit"]);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="asset-import-template.xlsx"');
  await wb.xlsx.write(res);
  res.end();
});

const CONDITION_WORDS: Record<string, AssetCondition> = { new: "NEW", good: "GOOD", fair: "FAIR", damaged: "DAMAGED" };

/** Imports the existing asset register. Items assigned to an employee wait for their confirmation. */
assetsRouter.post("/import", requireRole("ADMIN"), sheetUpload.single("file"), async (req, res) => {
  const user = currentUser(req);
  if (!req.file) throw new HttpError(400, "Choose a file to import");
  const rows = await readSheet(req.file.buffer, req.file.originalname);
  const categories = new Map((await prisma.assetCategory.findMany()).map((c) => [c.name.toLowerCase(), c]));
  const departments = new Map((await prisma.department.findMany()).map((d) => [d.name.toLowerCase(), d]));
  const created: { tag: string; name: string; assignedTo: string | null }[] = [];
  const skipped: { row: number; reason: string }[] = [];
  const notifyEmployees = new Set<number>();

  for (const [i, row] of rows.entries()) {
    const rowNo = i + 2;
    const categoryName = pickString(row, ["category"]);
    const name = pickString(row, ["name", "makemodel", "model", "description"]);
    const category = categoryName ? categories.get(categoryName.toLowerCase()) : undefined;
    if (!name) { skipped.push({ row: rowNo, reason: "Missing name" }); continue; }
    if (!category) { skipped.push({ row: rowNo, reason: `Unknown category "${categoryName ?? ""}"` }); continue; }
    const givenTag = pickString(row, ["tag", "assettag", "tagno"]);
    if (givenTag && (await prisma.asset.findUnique({ where: { tag: givenTag } }))) { skipped.push({ row: rowNo, reason: `Tag ${givenTag} already exists` }); continue; }
    const conditionWord = pickString(row, ["condition"]);
    const condition = conditionWord ? CONDITION_WORDS[conditionWord.toLowerCase()] : "GOOD";
    if (!condition) { skipped.push({ row: rowNo, reason: `Unknown condition "${conditionWord}"` }); continue; }

    const empKey = pickString(row, ["assignedtoemployee", "employee", "employeecode", "assignedto"]);
    const deptName = pickString(row, ["assignedtodepartment", "department"]);
    const location = pickString(row, ["assignedtolocation", "location"]);
    let employee: { id: number; fullName: string } | null = null;
    if (empKey) {
      employee = await prisma.employee.findFirst({
        where: { status: "ACTIVE", OR: [{ code: { equals: empKey, mode: "insensitive" } }, { email: empKey.toLowerCase() }] },
        select: { id: true, fullName: true },
      });
      if (!employee) { skipped.push({ row: rowNo, reason: `No active employee "${empKey}"` }); continue; }
    }
    const department = !employee && deptName ? departments.get(deptName.toLowerCase()) : undefined;
    if (!employee && deptName && !department) { skipped.push({ row: rowNo, reason: `Unknown department "${deptName}"` }); continue; }

    const purchase = parseSheetDate(pickString(row, ["purchasedate", "purchased"]));
    const warranty = parseSheetDate(pickString(row, ["warrantyuntil", "warranty", "warrantyexpiry"]));
    const assigned = employee || department || location;
    const tag = givenTag ?? (await nextAssetTag());
    await prisma.$transaction(async (tx) => {
      const asset = await tx.asset.create({
        data: {
          tag, categoryId: category.id, name, condition,
          serialNumber: pickString(row, ["serialnumber", "serial", "serialno"]),
          purchaseDate: purchase ? toDate(purchase) : null,
          cost: parseSheetNumber(pickString(row, ["cost", "price"])),
          warrantyUntil: warranty ? toDate(warranty) : null,
          storageLocation: pickString(row, ["storagelocation"]),
          notes: pickString(row, ["notes"]),
          status: assigned ? "ISSUED" : "IN_STOCK",
        },
      });
      if (assigned) {
        await tx.assetAssignment.create({
          data: {
            assetId: asset.id, issuedById: user.id, conditionOut: condition, issueNote: "Imported from the asset register",
            assigneeType: employee ? "EMPLOYEE" : department ? "DEPARTMENT" : "LOCATION",
            employeeId: employee?.id ?? null, departmentId: department?.id ?? null, location: employee || department ? null : location,
            confirmedAt: employee && category.kind === "PHYSICAL" ? null : new Date(),
          },
        });
      }
    });
    if (employee && category.kind === "PHYSICAL") notifyEmployees.add(employee.id);
    created.push({ tag, name, assignedTo: employee?.fullName ?? department?.name ?? location ?? null });
  }
  await notify([...notifyEmployees], "Please confirm the items issued to you", "Company items have been registered to you in the HR portal. Open My Inventory and confirm that you have them.", "/inventory");
  await audit(user.id, "IMPORT", "Asset", null, { fileName: req.file.originalname, created: created.length, skipped: skipped.length });
  res.json({ rowsRead: rows.length, created, skipped });
});

// ---------- One asset ----------

/** A6: advisory only, never blocking — HR or Admin decide case by case when the setting is empty. */
async function policeReportSuggestedTypes() {
  const settings = await getSettings();
  const value = settings["assets.policeReportRequiredTypes"];
  return new Set(value ? value.split(",").map((v) => v.trim().toUpperCase()) : []);
}
const withPoliceHint = <T extends { type: string }>(rows: T[], suggested: Set<string>) => rows.map((r) => ({ ...r, policeReportSuggested: suggested.has(r.type) }));

assetsRouter.get("/:id", async (req, res) => {
  const user = currentUser(req);
  assertRegister(user);
  const asset = serializeAsset(await loadAsset(Number(req.params.id)), user);
  res.json({ ...asset, incidents: withPoliceHint(asset.incidents, await policeReportSuggestedTypes()) });
});

assetsRouter.patch("/:id", requireRole("ADMIN"), async (req, res) => {
  const user = currentUser(req);
  const input = parse(assetSchema.partial(), req.body);
  const id = Number(req.params.id);
  const data: Prisma.AssetUncheckedUpdateInput = { ...assetFields(input), ...(input.tag ? { tag: input.tag } : {}) };
  await prisma.asset.update({ where: { id }, data }).catch(uniqueTag);
  await audit(user.id, "UPDATE", "Asset", id, input as Prisma.InputJsonValue);
  res.json(serializeAsset(await loadAsset(id), user));
});

const accessoriesSchema = z.array(z.object({ name: z.string().trim().min(1).max(60), quantity: z.coerce.number().int().min(1).max(99).default(1) })).max(20).optional();

const issueSchema = z.object({
  assigneeType: z.enum(["EMPLOYEE", "DEPARTMENT", "LOCATION"]).default("EMPLOYEE"),
  employeeId: z.coerce.number().int().optional(),
  departmentId: z.coerce.number().int().optional(),
  location: z.string().trim().max(100).optional(),
  condition: z.enum(CONDITIONS).optional(),
  note: z.string().trim().max(300).optional(),
  requestId: z.coerce.number().int().optional(),
  // A3/A9: required only on transfer (see transferSchema); carried as an optional field so issueAsset()
  // can store it on the new assignment either way.
  authorisationNote: optionalText,
  // A11/A13: accessories issued with the item, checked off at return.
  accessories: accessoriesSchema,
});

/** Creates the assignment row; the asset must be in stock. Used by issue and transfer. */
async function issueAsset(tx: Prisma.TransactionClient, asset: Awaited<ReturnType<typeof loadAsset>>, input: z.infer<typeof issueSchema>, user: AuthUser) {
  let employeeId: number | null = null;
  let departmentId: number | null = null;
  let location: string | null = null;
  let assetRequestId: number | null = null;
  if (input.requestId) {
    // Fulfilling an approved asset request: the item goes to the requester, and must match the category.
    const ar = await tx.assetRequest.findFirst({ where: { requestId: input.requestId }, include: { request: true } });
    if (!ar || ar.request.status !== "APPROVED") throw new HttpError(400, "That asset request is not approved");
    if (ar.assignmentId) throw new HttpError(400, "That asset request has already been fulfilled");
    if (ar.categoryId !== asset.categoryId) throw new HttpError(400, `The request is for a different category from ${asset.category.name}`);
    input = { ...input, assigneeType: "EMPLOYEE", employeeId: ar.request.employeeId };
    assetRequestId = ar.id;
  }
  if (input.assigneeType === "EMPLOYEE") {
    const emp = input.employeeId ? await tx.employee.findUnique({ where: { id: input.employeeId }, select: { id: true, status: true } }) : null;
    if (!emp || emp.status !== "ACTIVE") throw new HttpError(400, "Choose an active employee");
    employeeId = emp.id;
  } else if (input.assigneeType === "DEPARTMENT") {
    if (!input.departmentId || !(await tx.department.findUnique({ where: { id: input.departmentId } }))) throw new HttpError(400, "Choose a department");
    departmentId = input.departmentId;
  } else {
    if (!input.location) throw new HttpError(400, "Enter the location");
    location = input.location;
  }
  // Employees confirm physical items; access, department and location assignments need no confirmation.
  const autoConfirm = asset.category.kind === "ACCESS" || input.assigneeType !== "EMPLOYEE";
  const assignment = await tx.assetAssignment.create({
    data: {
      assetId: asset.id, assigneeType: input.assigneeType, employeeId, departmentId, location, issuedById: user.id,
      conditionOut: input.condition ?? asset.condition, issueNote: input.note || null, authorisationNote: input.authorisationNote ?? null,
      confirmedAt: autoConfirm ? new Date() : null,
    },
  });
  if (input.accessories?.length) {
    await tx.assetAccessory.createMany({ data: input.accessories.map((a) => ({ assignmentId: assignment.id, name: a.name, quantity: a.quantity })) });
  }
  await tx.asset.update({ where: { id: asset.id }, data: { status: "ISSUED", ...(input.condition ? { condition: input.condition } : {}) } });
  if (assetRequestId) await tx.assetRequest.update({ where: { id: assetRequestId }, data: { assignmentId: assignment.id } });
  return { assignment, employeeId, autoConfirm, requestId: input.requestId ?? null };
}

async function afterIssue(asset: { tag: string; name: string; category: { kind: string } }, result: { employeeId: number | null; autoConfirm: boolean; requestId: number | null }) {
  if (!result.employeeId) return;
  const access = asset.category.kind === "ACCESS";
  await notify(
    [result.employeeId],
    access ? `Access granted: ${asset.name}` : `Item issued to you: ${asset.name} (${asset.tag})`,
    access ? `You now have ${asset.name}.` : `${asset.name}, tag ${asset.tag}, has been issued to you. Open My Inventory and confirm that you received it.`,
    result.requestId ? `/requests/${result.requestId}` : "/inventory",
  );
}

assetsRouter.post("/:id/issue", requireRole("ADMIN"), async (req, res) => {
  const user = currentUser(req);
  const input = parse(issueSchema, req.body);
  const asset = await loadAsset(Number(req.params.id));
  if (asset.status !== "IN_STOCK") throw new HttpError(400, `This item is ${asset.status.toLowerCase().replace("_", " ")}; only items in stock can be issued`);
  const result = await prisma.$transaction((tx) => issueAsset(tx, asset, input, user));
  await audit(user.id, "UPDATE", "Asset", asset.id, { issued: result.assignment.id, to: input.assigneeType, employeeId: result.employeeId, requestId: result.requestId });
  await afterIssue(asset, result);
  res.json(serializeAsset(await loadAsset(asset.id), user));
});

const returnSchema = z.object({
  condition: z.enum(CONDITIONS).optional(),
  note: z.string().trim().max(300).optional(),
  // A11/A13: which issued accessories came back; anything left out, or marked false, is missing.
  accessories: z.array(z.object({ id: z.coerce.number().int(), returned: z.boolean() })).max(20).optional(),
});

/** Return (or, for access & accounts, revoke). The asset goes back into stock with the condition seen on return. */
async function closeAssignment(tx: Prisma.TransactionClient, asset: Awaited<ReturnType<typeof loadAsset>>, user: AuthUser, condition: AssetCondition, note: string | null) {
  const open = asset.assignments.find((a) => !a.returnedAt);
  if (!open) throw new HttpError(400, "This item is not issued to anyone");
  await tx.assetAssignment.update({ where: { id: open.id }, data: { returnedAt: new Date(), receivedById: user.id, conditionIn: condition, returnNote: note } });
  await tx.asset.update({ where: { id: asset.id }, data: { status: "IN_STOCK", condition } });
  return open;
}

/** Marks which accessories of a closed assignment came back; returns the ones still missing. */
async function settleAccessories(assignmentId: number, reported?: { id: number; returned: boolean }[]) {
  if (reported?.length) {
    await prisma.$transaction(reported.map((a) => prisma.assetAccessory.updateMany({ where: { id: a.id, assignmentId }, data: { returned: a.returned } })));
  }
  const rows = await prisma.assetAccessory.findMany({ where: { assignmentId } });
  return rows.filter((a) => !a.returned).map((a) => ({ id: a.id, name: a.name, quantity: a.quantity }));
}

assetsRouter.post("/:id/return", requireRole("ADMIN"), async (req, res) => {
  const user = currentUser(req);
  const input = parse(returnSchema, req.body);
  const asset = await loadAsset(Number(req.params.id));
  const open = await prisma.$transaction((tx) => closeAssignment(tx, asset, user, input.condition ?? asset.condition, input.note || null));
  const missingAccessories = await settleAccessories(open.id, input.accessories);
  const access = asset.category.kind === "ACCESS";
  await audit(user.id, "UPDATE", "Asset", asset.id, { [access ? "revoked" : "returned"]: open.id, condition: input.condition, missingAccessories: missingAccessories.map((a) => a.name) });
  if (open.employeeId) {
    await notify([open.employeeId], access ? `Access revoked: ${asset.name}` : `Return recorded: ${asset.name} (${asset.tag})`, access ? `${asset.name} has been revoked.` : `Admin recorded that you returned ${asset.name}, tag ${asset.tag}.`, "/inventory");
  }
  res.json({ ...serializeAsset(await loadAsset(asset.id), user), missingAccessories });
});

const transferSchema = issueSchema.omit({ requestId: true, accessories: true }).extend({
  // A3/A9: no transfer to another employee without authorisation from the relevant department.
  authorisationNote: z.string().trim().min(3, "Give the reason this transfer is authorised"),
});

/** A9: who may authorise a transfer of this category; empty on the category means Admin. */
const transferAuthorisingRole = (category: { transferAuthorisingRole: Role | null }): Role => category.transferAuthorisingRole ?? "ADMIN";

// No requireRole middleware: the authorising role is per category (assets.ts AssetCategory.transferAuthorisingRole).
assetsRouter.post("/:id/transfer", async (req, res) => {
  const user = currentUser(req);
  const input = parse(transferSchema, req.body);
  const asset = await loadAsset(Number(req.params.id));
  const role = transferAuthorisingRole(asset.category);
  if (!hasRole(user, role)) throw new HttpError(403, `Only ${role.replace("_", " ")} can authorise a transfer of ${asset.category.name}`);
  if (asset.status !== "ISSUED") throw new HttpError(400, "Only issued items can be transferred");
  const openAccessories = asset.assignments.find((a) => !a.returnedAt)?.accessories ?? [];
  const result = await prisma.$transaction(async (tx) => {
    const from = await closeAssignment(tx, asset, user, input.condition ?? asset.condition, `Transferred: ${input.authorisationNote}`);
    const fresh = await tx.asset.findUniqueOrThrow({ where: { id: asset.id }, include: assetInclude });
    // Accessories travel with the item; the receiving employee checks them off again at their own return.
    return { from, ...(await issueAsset(tx, fresh, { ...input, accessories: openAccessories.map((a) => ({ name: a.name, quantity: a.quantity })) }, user)) };
  });
  await audit(user.id, "UPDATE", "Asset", asset.id, { transferredFrom: result.from.id, to: result.assignment.id, authorisationNote: input.authorisationNote });
  if (result.from.employeeId) await notify([result.from.employeeId], `Item transferred: ${asset.name} (${asset.tag})`, `${asset.name}, tag ${asset.tag}, is no longer issued to you.`, "/inventory");
  await afterIssue(asset, result);
  res.json(serializeAsset(await loadAsset(asset.id), user));
});

const retireSchema = z.object({
  note: z.string().trim().min(3, "Give a reason"),
  // A13: disposal or replacement status.
  disposalReason: z.enum(DISPOSAL_REASONS),
  replacedByTag: z.string().trim().max(40).optional(),
});

assetsRouter.post("/:id/retire", requireRole("ADMIN"), async (req, res) => {
  const user = currentUser(req);
  const input = parse(retireSchema, req.body);
  const asset = await loadAsset(Number(req.params.id));
  if (asset.status !== "IN_STOCK") throw new HttpError(400, "Only items in stock can be retired");
  if (input.disposalReason === "REPLACED" && !input.replacedByTag) throw new HttpError(400, "Enter the tag of the asset that replaces it");
  const note = input.disposalReason === "REPLACED" && input.replacedByTag ? `${input.note} (replaced by ${input.replacedByTag})` : input.note;
  await prisma.asset.update({
    where: { id: asset.id },
    data: { status: "RETIRED", disposalReason: input.disposalReason, disposalDate: toDate(todayYmd()), notes: [asset.notes, `Retired: ${note}`].filter(Boolean).join("\n") },
  });
  await audit(user.id, "UPDATE", "Asset", asset.id, { retired: note, disposalReason: input.disposalReason });
  res.json(serializeAsset(await loadAsset(asset.id), user));
});

// ---------- Repairs ----------

const repairSchema = z.object({ vendor: z.string().trim().min(2, "Enter the vendor"), sentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date sent"), note: z.string().trim().max(300).optional() });

assetsRouter.post("/:id/repairs", requireRole("ADMIN"), async (req, res) => {
  const user = currentUser(req);
  const input = parse(repairSchema, req.body);
  const asset = await loadAsset(Number(req.params.id));
  if (asset.status !== "IN_STOCK") throw new HttpError(400, "Return the item to stock before sending it for repair");
  if (input.sentOn > todayYmd()) throw new HttpError(400, "The date sent cannot be in the future");
  await prisma.$transaction([
    prisma.assetRepair.create({ data: { assetId: asset.id, vendor: input.vendor, sentOn: toDate(input.sentOn), note: input.note || null, createdById: user.id } }),
    prisma.asset.update({ where: { id: asset.id }, data: { status: "IN_REPAIR" } }),
  ]);
  await audit(user.id, "UPDATE", "Asset", asset.id, { repairSent: input.vendor });
  res.json(serializeAsset(await loadAsset(asset.id), user));
});

const repairDoneSchema = z.object({
  returnedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date returned"),
  cost: optionalMoney,
  condition: z.enum(CONDITIONS).optional(),
  note: z.string().trim().max(300).optional(),
});

assetsRouter.post("/:id/repairs/:repairId/returned", requireRole("ADMIN"), async (req, res) => {
  const user = currentUser(req);
  const input = parse(repairDoneSchema, req.body);
  const asset = await loadAsset(Number(req.params.id));
  const repair = asset.repairs.find((r) => r.id === Number(req.params.repairId));
  if (!repair || repair.returnedOn) throw new HttpError(400, "This repair is not open");
  if (input.returnedOn < ymd(repair.sentOn)) throw new HttpError(400, "The return date is before the date sent");
  await prisma.$transaction([
    prisma.assetRepair.update({ where: { id: repair.id }, data: { returnedOn: toDate(input.returnedOn), cost: input.cost ?? null, note: [repair.note, input.note].filter(Boolean).join("\n") || null } }),
    prisma.asset.update({ where: { id: asset.id }, data: { status: "IN_STOCK", condition: input.condition ?? "GOOD" } }),
  ]);
  await audit(user.id, "UPDATE", "Asset", asset.id, { repairReturned: repair.id, cost: input.cost });
  res.json(serializeAsset(await loadAsset(asset.id), user));
});

// ---------- Employee: confirm receipt, report a problem ----------

async function ownAssignment(user: AuthUser, assignmentId: number) {
  const a = await prisma.assetAssignment.findUnique({ where: { id: assignmentId }, include: { asset: { include: { category: true } } } });
  if (!a || a.employeeId !== user.id) throw new HttpError(404, "Item not found in your inventory");
  if (a.returnedAt) throw new HttpError(400, "This item has already been returned");
  return a;
}

assetsRouter.post("/assignments/:id/confirm", async (req, res) => {
  const user = currentUser(req);
  const a = await ownAssignment(user, Number(req.params.id));
  if (a.confirmedAt) throw new HttpError(400, "You have already confirmed this item");
  await prisma.assetAssignment.update({ where: { id: a.id }, data: { confirmedAt: new Date() } });
  await audit(user.id, "UPDATE", "AssetAssignment", a.id, { confirmed: true });
  res.json({ ok: true });
});

const reportSchema = z.object({ type: z.enum(["NOT_WORKING", "DAMAGED", "LOST"]), description: z.string().trim().min(5, "Describe the problem") });
const TYPE_WORDS = { NOT_WORKING: "not working", DAMAGED: "damaged", LOST: "lost" } as const;

assetsRouter.post("/assignments/:id/report", async (req, res) => {
  const user = currentUser(req);
  const input = parse(reportSchema, req.body);
  const a = await ownAssignment(user, Number(req.params.id));
  const incident = await prisma.assetIncident.create({
    data: { assetId: a.assetId, assignmentId: a.id, employeeId: user.id, type: input.type, status: "REPORTED", description: input.description, reportedById: user.id },
  });
  await audit(user.id, "CREATE", "AssetIncident", incident.id, { type: input.type });
  // A6: the Line Manager and Admin/IT are notified at once.
  const emp = await prisma.employee.findUnique({ where: { id: user.id }, select: { managerId: true } });
  await notify(
    [...(await employeeIdsWithRole("ADMIN")), ...(emp?.managerId ? [emp.managerId] : [])],
    `Problem reported: ${a.asset.name} (${a.asset.tag})`,
    `${user.fullName} reported ${a.asset.name}, tag ${a.asset.tag}, as ${TYPE_WORDS[input.type]}: ${input.description}`,
    `/admin/assets/${a.assetId}`,
  );
  // Cyber Security Incident Response Policy: a data-bearing device also notifies IT/Security, without
  // the employee's own description (that stays with HR/Admin; the portal does not run the investigation).
  if (a.asset.category.dataBearing) {
    const settings = await getSettings();
    const role = settings["assets.cyberSecurityNotifyRole"];
    if (role) {
      await notify(
        await employeeIdsWithRole(role as Role),
        `Data-bearing asset ${TYPE_WORDS[input.type]}: ${a.asset.name} (${a.asset.tag})`,
        `${a.asset.name}, tag ${a.asset.tag}, a ${a.asset.category.name.toLowerCase()}, was reported ${TYPE_WORDS[input.type]}. This is a system notification only; the cyber security incident itself is handled outside the portal.`,
        `/admin/assets/${a.assetId}`,
      );
    }
  }
  res.status(201).json({ id: incident.id });
});

// ---------- Incidents: Admin records, HR sets recovery, Management writes off ----------

const recordSchema = z.object({ type: z.enum(["NOT_WORKING", "DAMAGED", "LOST"]), description: z.string().trim().min(5, "Describe what happened") });

async function afterRecorded(incidentId: number) {
  const i = await prisma.assetIncident.findUniqueOrThrow({ where: { id: incidentId }, include: { asset: true, employee: { select: { fullName: true } } } });
  if (i.type === "NOT_WORKING") return;
  const who = i.employee ? ` (held by ${i.employee.fullName})` : "";
  const recipients = [...(await employeeIdsWithRole("HR")), ...(await employeeIdsWithRole("MANAGEMENT"))];
  await notify(recipients, `Asset ${i.type === "LOST" ? "lost" : "damaged"}: ${i.asset.name} (${i.asset.tag})`, `Admin recorded ${i.asset.name}, tag ${i.asset.tag}${who}, as ${TYPE_WORDS[i.type]}: ${i.description}. HR can set a recovery amount, or Management can write it off.`, `/admin/assets/${i.assetId}`);
}

// Admin records damage / loss directly on an asset
assetsRouter.post("/:id/incidents", requireRole("ADMIN"), async (req, res) => {
  const user = currentUser(req);
  const input = parse(recordSchema.extend({ type: z.enum(["DAMAGED", "LOST"]) }), req.body);
  const asset = await loadAsset(Number(req.params.id));
  const open = asset.assignments.find((a) => !a.returnedAt);
  const incident = await prisma.$transaction(async (tx) => {
    const created = await tx.assetIncident.create({
      data: {
        assetId: asset.id, assignmentId: open?.id ?? null, employeeId: open?.employee?.id ?? null, type: input.type, status: "RECORDED",
        description: input.description, reportedById: user.id, recordedById: user.id, recordedAt: new Date(),
      },
    });
    await tx.asset.update({ where: { id: asset.id }, data: input.type === "LOST" ? { status: "LOST" } : { condition: "DAMAGED" } });
    return created;
  });
  await audit(user.id, "CREATE", "AssetIncident", incident.id, { type: input.type, assetId: asset.id });
  await afterRecorded(incident.id);
  res.status(201).json({ id: incident.id });
});

async function loadIncident(id: number) {
  const i = await prisma.assetIncident.findUnique({ where: { id }, include: { asset: true } });
  if (!i) throw new HttpError(404, "Incident not found");
  return i;
}

// Admin confirms an employee's report (and its type), or closes it when there is nothing to recover
assetsRouter.post("/incidents/:id/record", requireRole("ADMIN"), async (req, res) => {
  const user = currentUser(req);
  const input = parse(z.object({ type: z.enum(["NOT_WORKING", "DAMAGED", "LOST"]), note: z.string().trim().max(300).optional() }), req.body);
  const i = await loadIncident(Number(req.params.id));
  if (i.status !== "REPORTED") throw new HttpError(400, "Only new reports can be recorded");
  await prisma.$transaction([
    prisma.assetIncident.update({ where: { id: i.id }, data: { type: input.type, status: input.type === "NOT_WORKING" ? "CLOSED" : "RECORDED", recordedById: user.id, recordedAt: new Date(), adminNote: input.note || null } }),
    ...(input.type === "LOST" ? [prisma.asset.update({ where: { id: i.assetId }, data: { status: "LOST" } })] : []),
    ...(input.type === "DAMAGED" ? [prisma.asset.update({ where: { id: i.assetId }, data: { condition: "DAMAGED" } })] : []),
  ]);
  await audit(user.id, "UPDATE", "AssetIncident", i.id, { recorded: input.type });
  await afterRecorded(i.id);
  if (i.employeeId) await notify([i.employeeId], `Your report was reviewed: ${i.asset.name}`, input.type === "NOT_WORKING" ? `Admin will look after ${i.asset.name} (repair or replacement). ${input.note ?? ""}`.trim() : `Admin recorded ${i.asset.name} as ${TYPE_WORDS[input.type]}. ${input.note ?? ""}`.trim(), "/inventory");
  res.json({ ok: true });
});

assetsRouter.post("/incidents/:id/close", requireRole("ADMIN"), async (req, res) => {
  const user = currentUser(req);
  const { note } = parse(z.object({ note: z.string().trim().min(3, "Say why it is closed") }), req.body);
  const i = await loadIncident(Number(req.params.id));
  // A recorded damage or loss is decided by HR (recovery) or Management (write-off), not closed by Admin.
  if (i.status !== "REPORTED") throw new HttpError(400, "Only new reports can be closed; recorded damage or loss needs HR or Management");
  await prisma.assetIncident.update({ where: { id: i.id }, data: { status: "CLOSED", recordedById: user.id, recordedAt: new Date(), adminNote: note } });
  await audit(user.id, "UPDATE", "AssetIncident", i.id, { closed: note });
  if (i.employeeId) await notify([i.employeeId], `Your report was closed: ${i.asset.name}`, note, "/inventory");
  res.json({ ok: true });
});

/**
 * What HR needs to decide a fair recovery: the item's purchase cost and date. HR sees costs only here,
 * for an incident waiting for (or having) their decision; every other view hides costs from HR.
 */
const RECOVERABLE_STATUSES = ["RECORDED", "RECOVERY_PENDING_APPROVAL", "RECOVERY_SET"] as const;

assetsRouter.get("/incidents/:id/recovery-context", requireRole("HR"), async (req, res) => {
  const user = currentUser(req);
  const i = await prisma.assetIncident.findUnique({ where: { id: Number(req.params.id) }, include: { asset: { include: { category: true } } } });
  if (!i) throw new HttpError(404, "Incident not found");
  if (!(RECOVERABLE_STATUSES as readonly string[]).includes(i.status) || i.type === "NOT_WORKING") throw new HttpError(400, "Cost details are shown only while a recovery can be set");
  await audit(user.id, "VIEW_SENSITIVE", "AssetCost", i.assetId, { incidentId: i.id, reason: "recovery decision" });
  res.json({
    incidentId: i.id,
    tag: i.asset.tag,
    name: i.asset.name,
    category: i.asset.category.name,
    purchaseCost: i.asset.cost == null ? null : Number(i.asset.cost),
    purchaseDate: i.asset.purchaseDate ? ymd(i.asset.purchaseDate) : null,
  });
});

const recoverySchema = z
  .object({
    // A6: the finding behind the recovery; WEAR_AND_TEAR is not negligence, so it is never recovered.
    finding: z.enum(RECOVERY_FINDINGS),
    amount: z.coerce.number().min(0).optional(),
    note: z.string().trim().min(3, "Give the reason"),
  })
  .refine((v) => v.finding === "WEAR_AND_TEAR" || (v.amount != null && v.amount > 0), {
    message: "Enter the amount to recover (use a Management write-off for no charge)",
    path: ["amount"],
  });

assetsRouter.post("/incidents/:id/recovery", requireRole("HR"), async (req, res) => {
  const user = currentUser(req);
  const input = parse(recoverySchema, req.body);
  const i = await loadIncident(Number(req.params.id));
  if (!(RECOVERABLE_STATUSES as readonly string[]).includes(i.status) || i.type === "NOT_WORKING") throw new HttpError(400, "A recovery can be set on recorded damage or loss");
  if (i.employeeId === user.id) throw new HttpError(403, "You cannot decide a recovery for yourself");
  if (!i.employeeId) throw new HttpError(400, "Nobody held this item, so there is no one to recover from");

  if (input.finding === "WEAR_AND_TEAR") {
    // Not negligence: the report is closed directly, with no recovery and nothing for Management to approve.
    await prisma.assetIncident.update({
      where: { id: i.id },
      data: { status: "CLOSED", finding: "WEAR_AND_TEAR", recoveryAmount: null, recoverySetById: user.id, recoverySetAt: new Date(), recoveryNote: input.note, recoveryApprovedById: null, recoveryApprovedAt: null },
    });
    await audit(user.id, "UPDATE", "AssetIncident", i.id, { finding: "WEAR_AND_TEAR", note: input.note });
    await notify([i.employeeId], `No recovery: ${i.asset.name} (${i.asset.tag})`, `HR found that this was wear and tear, not negligence: ${input.note}. No recovery applies.`, "/inventory");
    return res.json({ ok: true });
  }

  const amount = Math.round(input.amount! * 100) / 100;
  const settings = await getSettings();
  const threshold = settingNumber(settings, "assets.recoveryApprovalThreshold");
  const needsApproval = threshold != null && amount > threshold;
  await prisma.assetIncident.update({
    where: { id: i.id },
    data: {
      status: needsApproval ? "RECOVERY_PENDING_APPROVAL" : "RECOVERY_SET",
      finding: input.finding, recoveryAmount: amount, recoverySetById: user.id, recoverySetAt: new Date(), recoveryNote: input.note,
      recoveryApprovedById: null, recoveryApprovedAt: null,
    },
  });
  await audit(user.id, "UPDATE", "AssetIncident", i.id, { recovery: amount, finding: input.finding, note: input.note, needsApproval });
  if (needsApproval) {
    await notify(await employeeIdsWithRole("MANAGEMENT"), `Recovery awaiting approval: ${pkr(amount)}`, `HR proposed a recovery of ${pkr(amount)} for ${i.asset.name}, tag ${i.asset.tag} (above the Rules & settings threshold): ${input.note}.`, `/admin/assets/${i.assetId}`);
  } else {
    await notifyRecoverySet({ ...i, recoveryNote: input.note }, amount);
  }
  res.json({ ok: true, needsApproval });
});

// Management confirms a recovery that was above the assets.recoveryApprovalThreshold setting
assetsRouter.post("/incidents/:id/recovery/approve", requireRole("MANAGEMENT"), async (req, res) => {
  const user = currentUser(req);
  const i = await loadIncident(Number(req.params.id));
  if (i.status !== "RECOVERY_PENDING_APPROVAL") throw new HttpError(400, "This recovery is not waiting for approval");
  await prisma.assetIncident.update({ where: { id: i.id }, data: { status: "RECOVERY_SET", recoveryApprovedById: user.id, recoveryApprovedAt: new Date() } });
  await audit(user.id, "UPDATE", "AssetIncident", i.id, { recoveryApproved: Number(i.recoveryAmount) });
  await notifyRecoverySet(i, Number(i.recoveryAmount));
  res.json({ ok: true });
});

assetsRouter.post("/incidents/:id/write-off", requireRole("MANAGEMENT"), async (req, res) => {
  const user = currentUser(req);
  const { note } = parse(z.object({ note: z.string().trim().min(3, "Give the reason") }), req.body);
  const i = await loadIncident(Number(req.params.id));
  if (!(RECOVERABLE_STATUSES as readonly string[]).includes(i.status) || i.type === "NOT_WORKING") throw new HttpError(400, "Only recorded damage or loss can be written off");
  if (i.employeeId === user.id) throw new HttpError(403, "You cannot write off an item you were responsible for");
  const hadRecovery = i.status === "RECOVERY_SET" || i.status === "RECOVERY_PENDING_APPROVAL";
  await prisma.assetIncident.update({ where: { id: i.id }, data: { status: "WRITTEN_OFF", writtenOffById: user.id, writtenOffAt: new Date(), writeOffNote: note, recoveryAmount: null, recoveryApprovedById: null, recoveryApprovedAt: null } });
  if (i.type === "LOST") await prisma.asset.update({ where: { id: i.assetId }, data: { status: "RETIRED" } }).catch(() => {});
  await audit(user.id, "UPDATE", "AssetIncident", i.id, { writtenOff: note });
  const recipients = [...(i.employeeId ? [i.employeeId] : []), ...(await employeeIdsWithRole("ADMIN")), ...(hadRecovery ? await employeeIdsWithRole("FINANCE") : [])];
  await notify(recipients, `Written off: ${i.asset.name} (${i.asset.tag})`, `Management wrote off ${i.asset.name}: ${note}.${hadRecovery ? " The recovery amount no longer applies." : ""}`, `/admin/assets/${i.assetId}`);
  res.json({ ok: true });
});

// ---------- Incident attachment (e.g. a police report): employee, Admin, HR and Management only ----------

assetsRouter.post("/incidents/:id/attachment", attachmentUpload.single("file"), async (req, res) => {
  const user = currentUser(req);
  const i = await loadIncident(Number(req.params.id));
  if (!canSeeIncidentAttachment(user, i.employeeId)) { removeFiles(req.file ? [req.file] : []); throw new HttpError(403, "You do not have access to this report"); }
  if (!req.file) throw new HttpError(400, "Choose a file to attach");
  if (i.attachmentPath) fs.rm(absoluteUploadPath(i.attachmentPath), { force: true }, () => {});
  await prisma.assetIncident.update({
    where: { id: i.id },
    data: { attachmentFileName: req.file.originalname, attachmentPath: relativeUploadPath(req.file.path), attachmentMimeType: req.file.mimetype, attachmentSize: req.file.size },
  });
  await audit(user.id, "UPDATE", "AssetIncident", i.id, { attached: req.file.originalname });
  res.json({ ok: true });
});

assetsRouter.get("/incidents/:id/attachment", async (req, res) => {
  const user = currentUser(req);
  const i = await loadIncident(Number(req.params.id));
  if (!canSeeIncidentAttachment(user, i.employeeId)) throw new HttpError(403, "You do not have access to this report");
  if (!i.attachmentPath) throw new HttpError(404, "No file attached");
  const file = absoluteUploadPath(i.attachmentPath);
  if (!fs.existsSync(file)) throw new HttpError(404, "File is missing from storage");
  res.download(file, i.attachmentFileName ?? "attachment");
});

// ---------- A3: Asset Handover / Acknowledgement Form ----------

/** Admin, or the employee the item was issued to. Never shows the cost. */
assetsRouter.get("/assignments/:id/handover", async (req, res) => {
  const user = currentUser(req);
  const a = await prisma.assetAssignment.findUnique({
    where: { id: Number(req.params.id) },
    include: { asset: { include: { category: true } }, employee: { select: { fullName: true, code: true } }, issuedBy: { select: { fullName: true } }, accessories: true },
  });
  if (!a) throw new HttpError(404, "Item not found");
  if (!(hasRole(user, "ADMIN") || a.employeeId === user.id)) throw new HttpError(403, "You do not have access to this item");
  if (!a.employee) throw new HttpError(400, "The handover form is for items issued to an employee");
  const pdf = await assetHandoverPdf({
    reference: `EHB/AST/${a.id}`,
    date: a.issuedAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
    employee: a.employee,
    asset: { tag: a.asset.tag, name: a.asset.name, category: a.asset.category.name, serialNumber: a.asset.serialNumber },
    condition: a.conditionOut,
    accessories: a.accessories.map((x) => ({ name: x.name, quantity: x.quantity })),
    issuedBy: a.issuedBy.fullName,
    confirmedAt: a.confirmedAt,
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="handover-${a.asset.tag}.pdf"`);
  res.send(pdf);
});

// ---------- A13: periodic physical audit (asset verification rounds) ----------

assetsRouter.get("/verification-rounds/:id", async (req, res) => {
  assertRegister(currentUser(req));
  const round = await prisma.assetVerificationRound.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      department: { select: { name: true } }, category: { select: { name: true } }, createdBy: { select: { fullName: true } },
      items: { include: { assignment: { include: { employee: { select: { fullName: true, code: true } }, asset: { select: { tag: true, name: true } } } } }, orderBy: { id: "asc" } },
    },
  });
  if (!round) throw new HttpError(404, "Verification round not found");
  res.json({
    id: round.id, scope: round.scope, department: round.department?.name ?? null, category: round.category?.name ?? null,
    dueDate: ymd(round.dueDate), createdBy: round.createdBy.fullName, createdAt: round.createdAt, closedAt: round.closedAt,
    items: round.items.map((i) => ({
      id: i.id, employee: i.assignment.employee, asset: i.assignment.asset, confirmedAt: i.confirmedAt, discrepancyNote: i.discrepancyNote,
    })),
  });
});

assetsRouter.post("/verification-rounds/:id/close", requireRole("ADMIN"), async (req, res) => {
  const user = currentUser(req);
  const round = await prisma.assetVerificationRound.findUnique({ where: { id: Number(req.params.id) } });
  if (!round) throw new HttpError(404, "Verification round not found");
  if (round.closedAt) throw new HttpError(400, "This round is already closed");
  await prisma.assetVerificationRound.update({ where: { id: round.id }, data: { closedAt: new Date() } });
  await audit(user.id, "UPDATE", "AssetVerificationRound", round.id, { closed: true });
  res.json({ ok: true });
});

assetsRouter.post("/verification-items/:id/confirm", async (req, res) => {
  const user = currentUser(req);
  const { matches, note } = parse(z.object({ matches: z.boolean().default(true), note: z.string().trim().max(300).optional() }), req.body);
  const item = await prisma.assetVerificationItem.findUnique({ where: { id: Number(req.params.id) }, include: { assignment: true, round: true } });
  if (!item) throw new HttpError(404, "Item not found");
  if (item.assignment.employeeId !== user.id) throw new HttpError(404, "Item not found in your inventory");
  if (item.confirmedAt) throw new HttpError(400, "You have already confirmed this item");
  if (item.round.closedAt) throw new HttpError(400, "This verification round is closed");
  await prisma.assetVerificationItem.update({ where: { id: item.id }, data: { confirmedAt: new Date(), discrepancyNote: matches ? null : (note || "Does not match") } });
  await audit(user.id, "UPDATE", "AssetVerificationItem", item.id, { matches });
  res.json({ ok: true });
});

/** After an asset request is approved: Admin is asked to issue an item. Called by the approve route. */
export async function assetRequestApproved(requestId: number) {
  const ar = await prisma.assetRequest.findUnique({ where: { requestId }, include: { category: true, request: { include: { employee: { select: { fullName: true } } } } } });
  if (!ar) return;
  await notify(await employeeIdsWithRole("ADMIN"), `Asset to issue: ${ar.category.name} for ${ar.request.employee.fullName}`, `${ar.request.employee.fullName}'s request for a ${ar.category.name.toLowerCase()} was approved: ${ar.reason}`, `/requests/${requestId}`);
}

/** When an employee is deactivated while still holding items, Admin is asked to collect them. */
export async function employeeDeactivated(employeeId: number) {
  const c = await assetClearance(employeeId);
  if (c.cleared) return;
  const emp = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { fullName: true, code: true } });
  await notify(
    await employeeIdsWithRole("ADMIN"),
    `Collect company items: ${emp.fullName}`,
    `${emp.fullName} (${emp.code}) is no longer active and still has: ${c.outstanding.map((o) => `${o.name} (${o.tag}, ${o.action.toLowerCase()})`).join("; ")}.`,
    "/admin/assets",
  );
}
