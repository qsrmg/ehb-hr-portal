import { Router } from "express";
import ExcelJS from "exceljs";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { audit } from "../lib/audit.js";
import { employeeIdsWithRole, notify } from "../lib/notify.js";
import { sheetUpload } from "../lib/upload.js";
import { readSheet, pickString, parseSheetDate, parseSheetNumber } from "../lib/sheet.js";
import { todayYmd, toDate, ymd } from "../lib/dates.js";
import { HttpError } from "../middleware/error.js";
import { currentUser, hasRole, requireAuth, requireRole, teamIds, type AuthUser } from "../middleware/auth.js";
import {
  assetClearance, assetInclude, assigneeLabel, canSeeCost, canSeeRegister, nextAssetTag, serializeAsset, serializeAssignment, serializeIncident,
} from "../services/assets.js";
import { pkr } from "../services/expenses.js";
import type { AssetCondition, Prisma } from "../generated/prisma/client.js";

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
    },
    orderBy: { issuedAt: "desc" },
  });
  res.json(rows.map((a) => ({
    ...serializeAssignment(a),
    asset: { id: a.asset.id, tag: a.asset.tag, name: a.asset.name, serialNumber: a.asset.serialNumber, category: a.asset.category.name, kind: a.asset.category.kind, status: a.asset.status, warrantyUntil: a.asset.warrantyUntil ? ymd(a.asset.warrantyUntil) : null },
    incidents: a.incidents.map((i) => ({ id: i.id, type: i.type, status: i.status, description: i.description, createdAt: i.createdAt, recoveryAmount: i.recoveryAmount == null ? null : Number(i.recoveryAmount), recoveryNote: i.recoveryNote, writeOffNote: i.writeOffNote })),
  })));
});

// A line manager sees what their team holds (no cost values)
assetsRouter.get("/team", async (req, res) => {
  const user = currentUser(req);
  const ids = await teamIds(user.id);
  const rows = await prisma.assetAssignment.findMany({
    where: { employeeId: { in: ids }, returnedAt: null },
    include: { asset: { include: { category: true } }, employee: { select: { id: true, fullName: true, code: true } } },
    orderBy: [{ employeeId: "asc" }, { issuedAt: "asc" }],
  });
  res.json(rows.map((a) => ({
    id: a.id, employee: a.employee, issuedAt: a.issuedAt, confirmedAt: a.confirmedAt,
    asset: { tag: a.asset.tag, name: a.asset.name, category: a.asset.category.name, status: a.asset.status },
  })));
});

assetsRouter.get("/clearance/:employeeId", async (req, res) => {
  const user = currentUser(req);
  const employeeId = Number(req.params.employeeId);
  const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { managerId: true } });
  if (!emp) throw new HttpError(404, "Employee not found");
  if (!(canSeeRegister(user) || user.id === employeeId || emp.managerId === user.id)) throw new HttpError(403, "You do not have access to this");
  res.json(await assetClearance(employeeId));
});

// ---------- Incidents, recoveries, requests to fulfil (lists) ----------

const incidentListInclude = {
  asset: { select: { id: true, tag: true, name: true, category: { select: { name: true } } } },
  employee: { select: { fullName: true, code: true } },
  reportedBy: { select: { fullName: true } },
  recordedBy: { select: { fullName: true } },
  recoverySetBy: { select: { fullName: true } },
  writtenOffBy: { select: { fullName: true } },
} satisfies Prisma.AssetIncidentInclude;

assetsRouter.get("/incidents", async (req, res) => {
  const user = currentUser(req);
  assertRegister(user);
  const view = typeof req.query.view === "string" ? req.query.view : "open";
  const status: Prisma.AssetIncidentWhereInput =
    view === "open" ? { status: { in: ["REPORTED", "RECORDED"] } } : view === "recoveries" ? { status: "RECOVERY_SET" } : {};
  const rows = await prisma.assetIncident.findMany({ where: status, include: incidentListInclude, orderBy: { createdAt: "desc" }, take: 300 });
  res.json(rows.map((i) => ({ ...serializeIncident(i), asset: { id: i.asset.id, tag: i.asset.tag, name: i.asset.name, category: i.asset.category.name } })));
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

assetsRouter.get("/:id", async (req, res) => {
  const user = currentUser(req);
  assertRegister(user);
  res.json(serializeAsset(await loadAsset(Number(req.params.id)), user));
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

const issueSchema = z.object({
  assigneeType: z.enum(["EMPLOYEE", "DEPARTMENT", "LOCATION"]).default("EMPLOYEE"),
  employeeId: z.coerce.number().int().optional(),
  departmentId: z.coerce.number().int().optional(),
  location: z.string().trim().max(100).optional(),
  condition: z.enum(CONDITIONS).optional(),
  note: z.string().trim().max(300).optional(),
  requestId: z.coerce.number().int().optional(),
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
    if (ar.categoryId !== asset.categoryId) throw new HttpError(400, `The request is for a different category than ${asset.category.name}`);
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
      conditionOut: input.condition ?? asset.condition, issueNote: input.note || null, confirmedAt: autoConfirm ? new Date() : null,
    },
  });
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

const returnSchema = z.object({ condition: z.enum(CONDITIONS).optional(), note: z.string().trim().max(300).optional() });

/** Return (or, for access & accounts, revoke). The asset goes back into stock with the condition seen on return. */
async function closeAssignment(tx: Prisma.TransactionClient, asset: Awaited<ReturnType<typeof loadAsset>>, user: AuthUser, condition: AssetCondition, note: string | null) {
  const open = asset.assignments.find((a) => !a.returnedAt);
  if (!open) throw new HttpError(400, "This item is not issued to anyone");
  await tx.assetAssignment.update({ where: { id: open.id }, data: { returnedAt: new Date(), receivedById: user.id, conditionIn: condition, returnNote: note } });
  await tx.asset.update({ where: { id: asset.id }, data: { status: "IN_STOCK", condition } });
  return open;
}

assetsRouter.post("/:id/return", requireRole("ADMIN"), async (req, res) => {
  const user = currentUser(req);
  const input = parse(returnSchema, req.body);
  const asset = await loadAsset(Number(req.params.id));
  const open = await prisma.$transaction((tx) => closeAssignment(tx, asset, user, input.condition ?? asset.condition, input.note || null));
  const access = asset.category.kind === "ACCESS";
  await audit(user.id, "UPDATE", "Asset", asset.id, { [access ? "revoked" : "returned"]: open.id, condition: input.condition });
  if (open.employeeId) {
    await notify([open.employeeId], access ? `Access revoked: ${asset.name}` : `Return recorded: ${asset.name} (${asset.tag})`, access ? `${asset.name} has been revoked.` : `Admin recorded that you returned ${asset.name}, tag ${asset.tag}.`, "/inventory");
  }
  res.json(serializeAsset(await loadAsset(asset.id), user));
});

assetsRouter.post("/:id/transfer", requireRole("ADMIN"), async (req, res) => {
  const user = currentUser(req);
  const input = parse(issueSchema.omit({ requestId: true }), req.body);
  const asset = await loadAsset(Number(req.params.id));
  if (asset.status !== "ISSUED") throw new HttpError(400, "Only issued items can be transferred");
  const result = await prisma.$transaction(async (tx) => {
    const from = await closeAssignment(tx, asset, user, input.condition ?? asset.condition, "Transferred");
    const fresh = await tx.asset.findUniqueOrThrow({ where: { id: asset.id }, include: assetInclude });
    return { from, ...(await issueAsset(tx, fresh, input, user)) };
  });
  await audit(user.id, "UPDATE", "Asset", asset.id, { transferredFrom: result.from.id, to: result.assignment.id });
  if (result.from.employeeId) await notify([result.from.employeeId], `Item transferred: ${asset.name} (${asset.tag})`, `${asset.name}, tag ${asset.tag}, is no longer issued to you.`, "/inventory");
  await afterIssue(asset, result);
  res.json(serializeAsset(await loadAsset(asset.id), user));
});

assetsRouter.post("/:id/retire", requireRole("ADMIN"), async (req, res) => {
  const user = currentUser(req);
  const { note } = parse(z.object({ note: z.string().trim().min(3, "Give a reason") }), req.body);
  const asset = await loadAsset(Number(req.params.id));
  if (asset.status !== "IN_STOCK") throw new HttpError(400, "Only items in stock can be retired");
  await prisma.asset.update({ where: { id: asset.id }, data: { status: "RETIRED", notes: [asset.notes, `Retired: ${note}`].filter(Boolean).join("\n") } });
  await audit(user.id, "UPDATE", "Asset", asset.id, { retired: note });
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
  await notify(await employeeIdsWithRole("ADMIN"), `Problem reported: ${a.asset.name} (${a.asset.tag})`, `${user.fullName} reported ${a.asset.name}, tag ${a.asset.tag}, as ${TYPE_WORDS[input.type]}: ${input.description}`, `/admin/assets/${a.assetId}`);
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
assetsRouter.get("/incidents/:id/recovery-context", requireRole("HR"), async (req, res) => {
  const user = currentUser(req);
  const i = await prisma.assetIncident.findUnique({ where: { id: Number(req.params.id) }, include: { asset: { include: { category: true } } } });
  if (!i) throw new HttpError(404, "Incident not found");
  if (!["RECORDED", "RECOVERY_SET"].includes(i.status) || i.type === "NOT_WORKING") throw new HttpError(400, "Cost details are shown only while a recovery can be set");
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

assetsRouter.post("/incidents/:id/recovery", requireRole("HR"), async (req, res) => {
  const user = currentUser(req);
  const input = parse(z.object({ amount: z.coerce.number().positive("Enter the amount to recover (use a Management write-off for no charge)"), note: z.string().trim().min(3, "Give the reason") }), req.body);
  const i = await loadIncident(Number(req.params.id));
  if (!["RECORDED", "RECOVERY_SET"].includes(i.status) || i.type === "NOT_WORKING") throw new HttpError(400, "A recovery can be set on recorded damage or loss");
  if (i.employeeId === user.id) throw new HttpError(403, "You cannot decide a recovery for yourself");
  if (!i.employeeId) throw new HttpError(400, "Nobody held this item, so there is no one to recover from");
  const amount = Math.round(input.amount * 100) / 100;
  await prisma.assetIncident.update({ where: { id: i.id }, data: { status: "RECOVERY_SET", recoveryAmount: amount, recoverySetById: user.id, recoverySetAt: new Date(), recoveryNote: input.note } });
  await audit(user.id, "UPDATE", "AssetIncident", i.id, { recovery: amount, note: input.note });
  await notify([i.employeeId], `Recovery set: ${i.asset.name} (${i.asset.tag})`, `HR set a recovery of ${pkr(amount)} for ${i.asset.name}: ${input.note}. Finance will deduct it in your final settlement.`, "/inventory");
  await notify(await employeeIdsWithRole("FINANCE"), `Asset recovery for final settlement: ${pkr(amount)}`, `HR set a recovery of ${pkr(amount)} for ${i.asset.name}, tag ${i.asset.tag}: ${input.note}.`, `/admin/assets/${i.assetId}`);
  res.json({ ok: true });
});

assetsRouter.post("/incidents/:id/write-off", requireRole("MANAGEMENT"), async (req, res) => {
  const user = currentUser(req);
  const { note } = parse(z.object({ note: z.string().trim().min(3, "Give the reason") }), req.body);
  const i = await loadIncident(Number(req.params.id));
  if (!["RECORDED", "RECOVERY_SET"].includes(i.status) || i.type === "NOT_WORKING") throw new HttpError(400, "Only recorded damage or loss can be written off");
  if (i.employeeId === user.id) throw new HttpError(403, "You cannot write off an item you were responsible for");
  await prisma.assetIncident.update({ where: { id: i.id }, data: { status: "WRITTEN_OFF", writtenOffById: user.id, writtenOffAt: new Date(), writeOffNote: note, recoveryAmount: null } });
  if (i.type === "LOST") await prisma.asset.update({ where: { id: i.assetId }, data: { status: "RETIRED" } }).catch(() => {});
  await audit(user.id, "UPDATE", "AssetIncident", i.id, { writtenOff: note });
  const recipients = [...(i.employeeId ? [i.employeeId] : []), ...(await employeeIdsWithRole("ADMIN")), ...(i.status === "RECOVERY_SET" ? await employeeIdsWithRole("FINANCE") : [])];
  await notify(recipients, `Written off: ${i.asset.name} (${i.asset.tag})`, `Management wrote off ${i.asset.name}: ${note}.${i.status === "RECOVERY_SET" ? " The recovery amount no longer applies." : ""}`, `/admin/assets/${i.assetId}`);
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
