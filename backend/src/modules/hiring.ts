import fs from "node:fs";
import { Router, type Request } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { audit } from "../lib/audit.js";
import { employeeIdsWithRole, notify } from "../lib/notify.js";
import { absoluteUploadPath, hiringUpload, relativeUploadPath } from "../lib/upload.js";
import { addDays, todayYmd, toDate, ymd } from "../lib/dates.js";
import { HttpError } from "../middleware/error.js";
import { currentUser, hasRole, requireAuth, requireRole, type AuthUser } from "../middleware/auth.js";
import { createSteps, notifySubmitted, resolveSteps } from "../services/approvals.js";
import {
  ACTIVE_STAGES, canSeeSalary, closeIfFilled, declineRemaining, departmentsFor, eligibilityProblems, externalOpen, headcountFor, hiredCount,
  hiringRules, internalOpen, moveInternally, notifyApplicant, requisitionChain, ROUTE_LABELS, routeFor, SHORTLIST_STAGES, STAGE_LABELS, STATUS_LABELS,
} from "../services/hiring.js";
import type { ApplicationStage, Prisma } from "../generated/prisma/client.js";

// Manpower Requisition and internal jobs. Requisitions go through the approval engine (three routes); HR posts
// approved positions, tracks applicants and hires (internal move, or Add employee for external candidates).
export const hiringRouter = Router();
hiringRouter.use(requireAuth);

const ymdString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const r = schema.safeParse(body ?? {});
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => i.message).join("; "));
  return r.data;
};
const text = (msg: string, min = 2) => z.string({ error: msg }).trim().min(min, msg);
const optText = z.string().trim().max(3000).optional().transform((v) => v || null);
const optMoney = z.union([z.literal(""), z.coerce.number().positive("Salary amounts must be positive")]).optional().transform((v) => (v === "" || v == null ? null : v));
const removeFile = (f?: Express.Multer.File) => f && fs.rm(f.path, { force: true }, () => {});

// ---------------------------------------------------------------------------
// Headcount (HR maintains it; Finance and Management can look)
// ---------------------------------------------------------------------------

hiringRouter.get("/headcount", requireRole("HR", "FINANCE", "MANAGEMENT"), async (_req, res) => {
  const departments = await prisma.department.findMany({ orderBy: { name: "asc" }, select: { id: true } });
  res.json(await Promise.all(departments.map(async (d) => ({ departmentId: d.id, ...(await headcountFor(d.id)) }))));
});

hiringRouter.put("/headcount/:departmentId", requireRole("HR"), async (req, res) => {
  const { approvedHeadcount } = parse(z.object({ approvedHeadcount: z.union([z.null(), z.coerce.number().int().min(0).max(10000)]) }), req.body);
  const id = Number(req.params.departmentId);
  const before = await prisma.department.findUnique({ where: { id } });
  if (!before) throw new HttpError(404, "Department not found");
  await prisma.department.update({ where: { id }, data: { approvedHeadcount } });
  await audit(currentUser(req).id, "UPDATE", "Department", id, { approvedHeadcount: { from: before.approvedHeadcount, to: approvedHeadcount } });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Requisitions
// ---------------------------------------------------------------------------

/** What the form needs: departments the user may raise for, leavers to replace, and possible hiring managers. */
hiringRouter.get("/options", async (req, res) => {
  const user = currentUser(req);
  const departments = await departmentsFor(user);
  const deptIds = departments.map((d) => d.id);
  const exits = await prisma.exitCase.findMany({
    where: { status: { in: ["OPEN", "COMPLETED"] }, employee: { departmentId: { in: deptIds } }, replacements: { none: { status: { not: "CANCELLED" } } } },
    include: { employee: { select: { id: true, fullName: true, designation: true, grade: true, departmentId: true, managerId: true } } },
    orderBy: { lastWorkingDay: "asc" },
  });
  const managers = await prisma.employee.findMany({ where: { status: "ACTIVE" }, select: { id: true, fullName: true, code: true }, orderBy: { fullName: "asc" } });
  res.json({
    departments,
    exits: exits.map((e) => ({
      exitCaseId: e.id, lastWorkingDay: ymd(e.lastWorkingDay), employeeId: e.employee.id, fullName: e.employee.fullName, designation: e.employee.designation,
      grade: e.employee.grade, departmentId: e.employee.departmentId, managerId: e.employee.managerId,
    })),
    managers,
    canSeeSalary: canSeeSalary(user),
  });
});

const requisitionInclude = {
  department: { select: { id: true, name: true, hodId: true } },
  requestedBy: { select: { id: true, fullName: true } },
  reportsTo: { select: { id: true, fullName: true } },
  replacesEmployee: { select: { id: true, fullName: true, grade: true, designation: true } },
  exitCase: { select: { id: true, lastWorkingDay: true, employee: { select: { id: true, fullName: true, grade: true, designation: true } } } },
  budgetConfirmedBy: { select: { fullName: true } },
  postedBy: { select: { fullName: true } },
  closedBy: { select: { fullName: true } },
  request: { include: { steps: { orderBy: { order: "asc" } } } },
  applications: {
    orderBy: { createdAt: "asc" },
    include: {
      employee: { select: { id: true, fullName: true, code: true, designation: true, department: { select: { name: true } }, managerId: true } },
      events: { orderBy: { createdAt: "asc" }, include: { by: { select: { fullName: true } } } },
      feedback: { orderBy: { createdAt: "asc" }, include: { author: { select: { fullName: true } } } },
    },
  },
} satisfies Prisma.RequisitionInclude;
type Full = Prisma.RequisitionGetPayload<{ include: typeof requisitionInclude }>;

function viewer(user: AuthUser, r: Full) {
  const requester = r.requestedById === user.id;
  const hiringManager = r.reportsToId === user.id;
  const hr = hasRole(user, "HR");
  const office = hasRole(user, "FINANCE", "MANAGEMENT");
  const hod = r.department.hodId === user.id;
  const onChain = !!r.request?.steps.some((s) => s.approverId === user.id || s.actedById === user.id);
  return { requester, hiringManager, hr, office, hod, any: requester || hiringManager || hr || office || hod || onChain };
}

async function loadFor(id: number, user: AuthUser) {
  const r = await prisma.requisition.findUnique({ where: { id }, include: requisitionInclude });
  if (!r) throw new HttpError(404, "Requisition not found");
  const v = viewer(user, r);
  if (!v.any) throw new HttpError(403, "You do not have access to this requisition");
  return { r, v };
}

const money = (v: { toString(): string } | null) => (v == null ? null : Number(v));
const leaverOf = (r: Pick<Full, "exitCase" | "replacesEmployee">) => r.exitCase?.employee ?? r.replacesEmployee ?? null;

async function present(r: Full, user: AuthUser) {
  const v = viewer(user, r);
  const salary = canSeeSalary(user);
  const hired = r.applications.filter((a) => a.stage === "HIRED").length;
  const leaver = leaverOf(r);
  const visibleApps = v.hr ? r.applications : v.hiringManager ? r.applications.filter((a) => SHORTLIST_STAGES.includes(a.stage)) : [];
  const editable = r.status === "DRAFT" && (v.requester || v.hr);
  const current = r.request?.status === "PENDING" ? r.request.steps.find((s) => s.order === r.request!.currentStep) : null;
  return {
    id: r.id, status: r.status, statusLabel: STATUS_LABELS[r.status],
    title: r.title, grade: r.grade, headcount: r.headcount, hired, employmentType: r.employmentType,
    department: r.department, reportsTo: r.reportsTo, requestedBy: r.requestedBy,
    targetStartDate: ymd(r.targetStartDate), justification: r.justification, skills: r.skills,
    jd: r.jdName ? { name: r.jdName } : null,
    reason: r.reason, gradeChanged: r.gradeChanged, overHeadcount: r.overHeadcount,
    route: r.status === "DRAFT" ? null : ROUTE_LABELS[routeFor(r)],
    replaces: leaver ? { employeeId: leaver.id, fullName: leaver.fullName, designation: leaver.designation, grade: leaver.grade, exitCaseId: r.exitCaseId, lastWorkingDay: r.exitCase ? ymd(r.exitCase.lastWorkingDay) : null } : null,
    // Salary figures: HR, Finance and Management; the requester sees their own suggestion.
    suggestedSalary: salary || v.requester ? { min: money(r.suggestedSalaryMin), max: money(r.suggestedSalaryMax) } : null,
    budget: salary ? { min: money(r.salaryMin), max: money(r.salaryMax), note: r.budgetNote, by: r.budgetConfirmedBy?.fullName ?? null, at: r.budgetConfirmedAt } : null,
    request: r.request ? { id: r.request.id, status: r.request.status, waitingFor: current?.label ?? null } : null,
    posting: r.postedAt
      ? { scope: r.scope, description: r.description, requirements: r.requirements, postedAt: r.postedAt, by: r.postedBy?.fullName ?? null, externalFrom: r.externalFrom ? ymd(r.externalFrom) : null, closingDate: r.closingDate ? ymd(r.closingDate) : null }
      : null,
    closed: r.closedAt ? { at: r.closedAt, by: r.closedBy?.fullName ?? null, reason: r.closedReason } : null,
    applications: visibleApps.map((a) => ({
      id: a.id, stage: a.stage, stageLabel: STAGE_LABELS[a.stage], internal: !!a.employeeId,
      name: a.employee?.fullName ?? a.candidateName, code: a.employee?.code ?? null,
      currentRole: a.employee ? [a.employee.designation, a.employee.department?.name].filter(Boolean).join(" · ") : null,
      email: v.hr ? a.candidateEmail : null, phone: v.hr ? a.candidatePhone : null,
      note: a.note, cv: a.cvName ? { name: a.cvName } : null, appliedAt: a.createdAt, managerNotifiedAt: v.hr ? a.managerNotifiedAt : null,
      events: v.hr ? a.events.map((e) => ({ stage: STAGE_LABELS[e.stage], note: e.note, by: e.by.fullName, at: e.createdAt })) : [],
      feedback: a.feedback.map((f) => ({ id: f.id, author: f.author.fullName, recommendation: f.recommendation, comment: f.comment, at: f.createdAt })),
      hiredEmployeeId: a.hiredEmployeeId,
    })),
    headcountCheck: r.status === "DRAFT" || r.status === "SUBMITTED" ? await headcountFor(r.departmentId, { id: r.id, headcount: r.headcount }) : null,
    can: {
      edit: editable,
      submit: editable,
      delete: editable,
      post: v.hr && r.status === "APPROVED",
      addCandidate: v.hr && externalOpen(r),
      manageApplicants: v.hr && r.status === "POSTED",
      feedback: (v.hr || v.hiringManager) && r.status === "POSTED",
      cancel: v.hr && ["APPROVED", "POSTED"].includes(r.status),
    },
    externalOpen: externalOpen(r),
  };
}

hiringRouter.get("/requisitions", async (req, res) => {
  const user = currentUser(req);
  const broad = hasRole(user, "HR", "FINANCE", "MANAGEMENT");
  const rows = await prisma.requisition.findMany({
    where: broad ? { OR: [{ status: { not: "DRAFT" } }, { requestedById: user.id }] } : { OR: [{ requestedById: user.id }, { reportsToId: user.id }, { department: { hodId: user.id }, status: { not: "DRAFT" } }] },
    include: { department: { select: { name: true } }, reportsTo: { select: { fullName: true } }, requestedBy: { select: { fullName: true } }, applications: { select: { stage: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(rows.map((r) => ({
    id: r.id, status: r.status, statusLabel: STATUS_LABELS[r.status], title: r.title, headcount: r.headcount, reason: r.reason,
    department: r.department.name, reportsTo: r.reportsTo?.fullName ?? null, requestedBy: r.requestedBy.fullName, createdAt: r.createdAt,
    closingDate: r.closingDate ? ymd(r.closingDate) : null,
    applicants: r.applications.filter((a) => a.stage !== "WITHDRAWN").length, hired: r.applications.filter((a) => a.stage === "HIRED").length,
  })));
});

const requisitionSchema = z.object({
  departmentId: z.coerce.number({ error: "Choose the department" }).int(),
  title: text("Give the position title"),
  grade: optText,
  headcount: z.coerce.number().int().min(1, "At least one position").max(20, "At most 20 positions per requisition").default(1),
  employmentType: z.enum(["PERMANENT", "CONTRACT", "INTERN"]).default("PERMANENT"),
  reportsToId: z.coerce.number({ error: "Choose the hiring manager" }).int(),
  targetStartDate: ymdString,
  justification: text("Explain why the position is needed (at least a sentence)", 10),
  skills: optText,
  reason: z.enum(["NEW", "REPLACEMENT"]),
  exitCaseId: z.union([z.literal(""), z.coerce.number().int()]).optional().transform((v) => (v === "" || v == null ? null : v)),
  suggestedSalaryMin: optMoney,
  suggestedSalaryMax: optMoney,
  submit: z.union([z.boolean(), z.literal("true"), z.literal("false")]).optional().transform((v) => v === true || v === "true"),
});

/** Validates the form for this user; returns the fields to save. */
async function prepare(user: AuthUser, body: unknown, existing?: { id: number; replacesEmployeeId: number | null; exitCaseId: number | null }) {
  const input = parse(requisitionSchema, body);
  const departments = await departmentsFor(user);
  if (!departments.some((d) => d.id === input.departmentId)) throw new HttpError(403, "You can raise requisitions for your own department only");
  const manager = await prisma.employee.findUnique({ where: { id: input.reportsToId }, select: { status: true } });
  if (!manager || manager.status !== "ACTIVE") throw new HttpError(400, "Choose an active hiring manager");
  if (input.targetStartDate < todayYmd()) throw new HttpError(400, "The target start date is in the past");
  const min = input.suggestedSalaryMin, max = input.suggestedSalaryMax;
  if (min != null && max != null && min > max) throw new HttpError(400, "The minimum salary is above the maximum");
  let exitCaseId: number | null = null;
  let replacesEmployeeId: number | null = existing?.replacesEmployeeId ?? null;
  if (input.reason === "REPLACEMENT") {
    exitCaseId = input.exitCaseId ?? existing?.exitCaseId ?? null;
    if (exitCaseId) {
      const exit = await prisma.exitCase.findUnique({ where: { id: exitCaseId }, include: { employee: { select: { id: true, departmentId: true } }, replacements: { where: { status: { not: "CANCELLED" }, ...(existing ? { id: { not: existing.id } } : {}) }, select: { id: true } } } });
      if (!exit || exit.status === "CANCELLED") throw new HttpError(400, "Choose the exit this position replaces");
      if (exit.employee.departmentId !== input.departmentId) throw new HttpError(400, "The leaver is in another department");
      if (exit.replacements.length) throw new HttpError(400, `There is already a requisition for this replacement (#${exit.replacements[0]!.id})`);
      replacesEmployeeId = exit.employee.id;
    } else if (!replacesEmployeeId) {
      throw new HttpError(400, "Choose the leaver this position replaces");
    }
  } else {
    replacesEmployeeId = null;
  }
  return {
    departmentId: input.departmentId, title: input.title, grade: input.grade, headcount: input.headcount, employmentType: input.employmentType,
    reportsToId: input.reportsToId, targetStartDate: toDate(input.targetStartDate), justification: input.justification, skills: input.skills,
    reason: input.reason, exitCaseId, replacesEmployeeId, suggestedSalaryMin: min, suggestedSalaryMax: max, submit: input.submit,
  };
}

/** Submits a draft: works out the route (headcount, grade) and starts the approval request. */
async function submitRequisition(id: number, user: AuthUser) {
  const r = await prisma.requisition.findUniqueOrThrow({ where: { id }, include: { department: { select: { name: true } }, exitCase: { select: { employee: { select: { grade: true } } } }, replacesEmployee: { select: { grade: true } } } });
  if (r.status !== "DRAFT") throw new HttpError(400, "Only a draft can be submitted");
  if (r.targetStartDate < toDate(todayYmd())) throw new HttpError(400, "The target start date is in the past; change it first");
  const check = await headcountFor(r.departmentId, { id: r.id, headcount: r.headcount });
  const leaverGrade = r.exitCase?.employee.grade ?? r.replacesEmployee?.grade ?? null;
  const gradeChanged = r.reason === "REPLACEMENT" && (r.grade ?? "").trim().toLowerCase() !== (leaverGrade ?? "").trim().toLowerCase();
  const route = routeFor({ reason: r.reason, overHeadcount: check.over, gradeChanged });
  const chain = await requisitionChain(r, route);
  const request = await prisma.$transaction(async (tx) => {
    const created = await tx.request.create({
      data: {
        type: "MANPOWER", employeeId: r.requestedById,
        title: `Manpower Requisition · ${r.title}${r.headcount > 1 ? ` (${r.headcount} positions)` : ""} · ${r.department.name}`,
        data: { requisitionId: r.id },
      },
    });
    await createSteps(tx, created.id, await resolveSteps(tx, r.requestedById, chain));
    await tx.requestAction.create({ data: { requestId: created.id, actorId: user.id, action: "SUBMITTED" } });
    await tx.requisition.update({ where: { id: r.id }, data: { status: "SUBMITTED", requestId: created.id, overHeadcount: check.over, gradeChanged } });
    return created;
  });
  await notifySubmitted(request.id);
  return { requestId: request.id, route: ROUTE_LABELS[route] };
}

hiringRouter.post("/requisitions", hiringUpload.single("jd"), async (req, res) => {
  const user = currentUser(req);
  try {
    const { submit, ...data } = await prepare(user, req.body);
    const created = await prisma.requisition.create({
      data: { ...data, requestedById: user.id, ...(req.file ? { jdPath: relativeUploadPath(req.file.path), jdName: req.file.originalname } : {}) },
    });
    await audit(user.id, "CREATE", "Requisition", created.id, { title: data.title });
    const submitted = submit ? await submitRequisition(created.id, user) : null;
    res.status(201).json({ id: created.id, ...submitted });
  } catch (err) {
    removeFile(req.file);
    throw err;
  }
});

hiringRouter.put("/requisitions/:id", hiringUpload.single("jd"), async (req, res) => {
  const user = currentUser(req);
  try {
    const { r } = await loadFor(Number(req.params.id), user);
    if (!(await present(r, user)).can.edit) throw new HttpError(403, "Only the requester or HR can change a draft");
    const { submit, ...data } = await prepare(user, req.body, r);
    await prisma.requisition.update({
      where: { id: r.id },
      data: { ...data, ...(req.file ? { jdPath: relativeUploadPath(req.file.path), jdName: req.file.originalname } : {}) },
    });
    const submitted = submit ? await submitRequisition(r.id, user) : null;
    res.json({ id: r.id, ...submitted });
  } catch (err) {
    removeFile(req.file);
    throw err;
  }
});

hiringRouter.delete("/requisitions/:id", async (req, res) => {
  const user = currentUser(req);
  const { r } = await loadFor(Number(req.params.id), user);
  if (!(await present(r, user)).can.delete) throw new HttpError(403, "Only a draft can be deleted, by the requester or HR");
  await prisma.requisition.delete({ where: { id: r.id } });
  await audit(user.id, "DELETE", "Requisition", r.id);
  res.json({ ok: true });
});

hiringRouter.get("/requisitions/:id", async (req, res) => {
  const user = currentUser(req);
  const { r } = await loadFor(Number(req.params.id), user);
  res.json(await present(r, user));
});

hiringRouter.get("/requisitions/:id/jd", async (req, res) => {
  const { r } = await loadFor(Number(req.params.id), currentUser(req));
  if (!r.jdPath) throw new HttpError(404, "No job description attached");
  res.download(absoluteUploadPath(r.jdPath), r.jdName ?? "job-description");
});

// --- HR posts an approved position ---

const postSchema = z.object({
  scope: z.enum(["INTERNAL", "EXTERNAL", "BOTH"]).default("BOTH"),
  description: text("Describe the role", 10),
  requirements: text("List the requirements", 5),
  closingDate: ymdString,
});

hiringRouter.post("/requisitions/:id/post", requireRole("HR"), async (req, res) => {
  const user = currentUser(req);
  const input = parse(postSchema, req.body);
  const { r } = await loadFor(Number(req.params.id), user);
  if (r.status !== "APPROVED") throw new HttpError(400, "Only an approved requisition can be posted");
  if (input.closingDate < todayYmd()) throw new HttpError(400, "The closing date is in the past");
  const { internalOnlyDays } = await hiringRules();
  const today = toDate(todayYmd());
  const externalFrom = input.scope === "INTERNAL" ? null : input.scope === "EXTERNAL" ? today : addDays(today, internalOnlyDays);
  await prisma.requisition.update({
    where: { id: r.id },
    data: { status: "POSTED", scope: input.scope, description: input.description, requirements: input.requirements, closingDate: toDate(input.closingDate), externalFrom, postedAt: new Date(), postedById: user.id },
  });
  await audit(user.id, "POST", "Requisition", r.id, { scope: input.scope, closingDate: input.closingDate });
  if (input.scope !== "EXTERNAL") {
    const everyone = (await prisma.employee.findMany({ where: { status: "ACTIVE" }, select: { id: true } })).map((e) => e.id);
    await notify(everyone, `Internal job: ${r.title}`, `A new internal position is open in ${r.department.name}: ${r.title}. Applications close on ${input.closingDate}.`, `/hiring/jobs/${r.id}`);
  }
  await notify([r.requestedById, ...(r.reportsToId ? [r.reportsToId] : [])], `Posted: ${r.title}`, `HR has posted ${r.title} (${input.scope.toLowerCase()}), closing ${input.closingDate}.`, `/hiring/requisitions/${r.id}`);
  res.json({ ok: true, externalFrom: externalFrom ? ymd(externalFrom) : null });
});

hiringRouter.post("/requisitions/:id/cancel", requireRole("HR"), async (req, res) => {
  const user = currentUser(req);
  const { reason } = parse(z.object({ reason: text("Give the reason for closing the position", 3) }), req.body);
  const { r } = await loadFor(Number(req.params.id), user);
  if (!["APPROVED", "POSTED"].includes(r.status)) throw new HttpError(400, `This requisition is ${STATUS_LABELS[r.status].toLowerCase()}`);
  await prisma.requisition.update({ where: { id: r.id }, data: { status: "CANCELLED", closedAt: new Date(), closedById: user.id, closedReason: reason } });
  await declineRemaining(r.id, r.title, user.id, `Position closed: ${reason}`);
  await audit(user.id, "CANCEL", "Requisition", r.id, { reason });
  await notify([r.requestedById, ...(r.reportsToId ? [r.reportsToId] : [])], `Position closed: ${r.title}`, `HR closed ${r.title}: ${reason}`, `/hiring/requisitions/${r.id}`);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Internal jobs (employees)
// ---------------------------------------------------------------------------

const jobOf = (r: { id: number; title: string; employmentType: string; headcount: number; description: string | null; requirements: string | null; closingDate: Date | null; postedAt: Date | null; department: { name: string }; reportsTo: { fullName: string } | null }) => ({
  id: r.id, title: r.title, department: r.department.name, reportsTo: r.reportsTo?.fullName ?? null, employmentType: r.employmentType, headcount: r.headcount,
  description: r.description, requirements: r.requirements, closingDate: r.closingDate ? ymd(r.closingDate) : null, postedAt: r.postedAt,
});

hiringRouter.get("/jobs", async (req, res) => {
  const user = currentUser(req);
  const rows = await prisma.requisition.findMany({
    where: { status: "POSTED", scope: { in: ["INTERNAL", "BOTH"] }, closingDate: { gte: toDate(todayYmd()) } },
    include: { department: { select: { name: true } }, reportsTo: { select: { fullName: true } }, applications: { where: { employeeId: user.id }, select: { id: true, stage: true } } },
    orderBy: { postedAt: "desc" },
  });
  const problems = await eligibilityProblems(user.id);
  res.json({
    eligibility: problems,
    jobs: rows.map((r) => ({ ...jobOf(r), myApplication: r.applications[0] ? { id: r.applications[0].id, stage: r.applications[0].stage, stageLabel: STAGE_LABELS[r.applications[0].stage] } : null })),
  });
});

hiringRouter.get("/jobs/:id", async (req, res) => {
  const user = currentUser(req);
  const r = await prisma.requisition.findUnique({
    where: { id: Number(req.params.id) },
    include: { department: { select: { name: true } }, reportsTo: { select: { fullName: true } }, applications: { where: { employeeId: user.id } } },
  });
  if (!r || !r.postedAt || r.scope === "EXTERNAL") throw new HttpError(404, "Job not found");
  const mine = r.applications[0];
  const problems = await eligibilityProblems(user.id);
  if (r.reportsToId === user.id) problems.push("You are the hiring manager for this position");
  res.json({
    ...jobOf(r), open: internalOpen(r), eligibility: problems,
    myApplication: mine ? { id: mine.id, stage: mine.stage, stageLabel: STAGE_LABELS[mine.stage], note: mine.note, cv: mine.cvName, appliedAt: mine.createdAt } : null,
  });
});

hiringRouter.post("/jobs/:id/apply", hiringUpload.single("cv"), async (req, res) => {
  const user = currentUser(req);
  try {
    const { note } = parse(z.object({ note: z.string().trim().max(3000).optional() }), req.body);
    const r = await prisma.requisition.findUnique({ where: { id: Number(req.params.id) } });
    if (!r || !internalOpen(r)) throw new HttpError(400, "This job is not open for internal applications");
    if (r.reportsToId === user.id) throw new HttpError(400, "You are the hiring manager for this position");
    const problems = await eligibilityProblems(user.id);
    if (problems.length) throw new HttpError(400, problems.join("; "));
    const existing = await prisma.jobApplication.findUnique({ where: { requisitionId_employeeId: { requisitionId: r.id, employeeId: user.id } } });
    if (existing && existing.stage !== "WITHDRAWN") throw new HttpError(400, "You have already applied for this job");
    const data = { note: note || null, stage: "APPLIED" as const, ...(req.file ? { cvPath: relativeUploadPath(req.file.path), cvName: req.file.originalname } : {}) };
    const app = existing
      ? await prisma.jobApplication.update({ where: { id: existing.id }, data })
      : await prisma.jobApplication.create({ data: { requisitionId: r.id, employeeId: user.id, ...data } });
    await prisma.applicationEvent.create({ data: { applicationId: app.id, stage: "APPLIED", byId: user.id } });
    await notify(
      [user.id],
      `Application received: ${r.title}`,
      `Thank you for applying for ${r.title}. Your application is confidential: your current manager is told only if you are shortlisted.`,
      `/hiring/jobs/${r.id}`,
    );
    await notify((await employeeIdsWithRole("HR")).filter((id) => id !== user.id), `New applicant: ${r.title}`, `${user.fullName} applied for ${r.title}.`, `/hiring/requisitions/${r.id}`);
    res.status(201).json({ id: app.id });
  } catch (err) {
    removeFile(req.file);
    throw err;
  }
});

hiringRouter.get("/applications/mine", async (req, res) => {
  const user = currentUser(req);
  const rows = await prisma.jobApplication.findMany({
    where: { employeeId: user.id },
    include: { requisition: { select: { id: true, title: true, closingDate: true, department: { select: { name: true } } } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(rows.map((a) => ({
    id: a.id, stage: a.stage, stageLabel: STAGE_LABELS[a.stage], appliedAt: a.createdAt, updatedAt: a.updatedAt,
    job: { id: a.requisition.id, title: a.requisition.title, department: a.requisition.department.name, closingDate: a.requisition.closingDate ? ymd(a.requisition.closingDate) : null },
    canWithdraw: ACTIVE_STAGES.includes(a.stage),
  })));
});

hiringRouter.post("/applications/:id/withdraw", async (req, res) => {
  const user = currentUser(req);
  const app = await prisma.jobApplication.findUnique({ where: { id: Number(req.params.id) }, include: { requisition: { select: { title: true } } } });
  if (!app || app.employeeId !== user.id) throw new HttpError(404, "Application not found");
  if (!ACTIVE_STAGES.includes(app.stage)) throw new HttpError(400, `This application is ${STAGE_LABELS[app.stage].toLowerCase()}`);
  await prisma.$transaction([
    prisma.jobApplication.update({ where: { id: app.id }, data: { stage: "WITHDRAWN" } }),
    prisma.applicationEvent.create({ data: { applicationId: app.id, stage: "WITHDRAWN", byId: user.id } }),
  ]);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Applicant tracking (HR; the hiring manager sees shortlisted candidates and adds interview feedback)
// ---------------------------------------------------------------------------

async function loadApplication(id: number, user: AuthUser) {
  const app = await prisma.jobApplication.findUnique({
    where: { id },
    include: { requisition: { include: requisitionInclude }, employee: { select: { id: true, fullName: true, managerId: true } } },
  });
  if (!app) throw new HttpError(404, "Application not found");
  const v = viewer(user, app.requisition);
  const own = app.employeeId === user.id;
  const allowed = own || v.hr || (v.hiringManager && SHORTLIST_STAGES.includes(app.stage));
  if (!allowed) throw new HttpError(403, "You do not have access to this application");
  return { app, v, own };
}

hiringRouter.get("/applications/:id/cv", async (req, res) => {
  const { app } = await loadApplication(Number(req.params.id), currentUser(req));
  if (!app.cvPath) throw new HttpError(404, "No CV attached");
  res.download(absoluteUploadPath(app.cvPath), app.cvName ?? "cv");
});

const stageSchema = z.object({ stage: z.enum(["SHORTLISTED", "INTERVIEW", "OFFER", "NOT_SELECTED"]), note: z.string().trim().max(2000).optional() });

hiringRouter.patch("/applications/:id/stage", requireRole("HR"), async (req, res) => {
  const user = currentUser(req);
  const input = parse(stageSchema, req.body);
  const { app } = await loadApplication(Number(req.params.id), user);
  const r = app.requisition;
  if (r.status !== "POSTED") throw new HttpError(400, "This position is not open");
  if (!ACTIVE_STAGES.includes(app.stage)) throw new HttpError(400, `This application is ${STAGE_LABELS[app.stage].toLowerCase()}`);
  if (app.employeeId === user.id) throw new HttpError(403, "Another HR user must handle your own application");
  const order: ApplicationStage[] = ["APPLIED", "SHORTLISTED", "INTERVIEW", "OFFER"];
  if (input.stage !== "NOT_SELECTED" && order.indexOf(input.stage) <= order.indexOf(app.stage)) throw new HttpError(400, `The application is already at ${STAGE_LABELS[app.stage]}`);
  // The applicant's current manager is told only once they are shortlisted (and never twice).
  const tellManager = input.stage !== "NOT_SELECTED" && !!app.employee?.managerId && !app.managerNotifiedAt && app.employee.managerId !== user.id;
  await prisma.$transaction([
    prisma.jobApplication.update({ where: { id: app.id }, data: { stage: input.stage, ...(tellManager ? { managerNotifiedAt: new Date() } : {}) } }),
    prisma.applicationEvent.create({ data: { applicationId: app.id, stage: input.stage, note: input.note || null, byId: user.id } }),
  ]);
  await notifyApplicant(app, r.title, input.stage);
  if (tellManager) {
    await notify([app.employee!.managerId!], `${app.employee!.fullName} is shortlisted`, `${app.employee!.fullName} has applied for ${r.title} (${r.department.name}) and has been shortlisted. HR will keep you informed.`, "/team");
  }
  if (input.stage === "SHORTLISTED" && r.reportsToId) {
    await notify([r.reportsToId], `Shortlisted for ${r.title}`, `${app.employee?.fullName ?? app.candidateName} has been shortlisted for ${r.title}. You can read their application and add interview feedback.`, `/hiring/requisitions/${r.id}`);
  }
  res.json({ ok: true, managerNotified: tellManager });
});

hiringRouter.post("/applications/:id/feedback", async (req, res) => {
  const user = currentUser(req);
  const input = parse(z.object({ recommendation: z.enum(["HIRE", "MAYBE", "NO_HIRE"]), comment: text("Write the interview feedback", 5) }), req.body);
  const { app, v } = await loadApplication(Number(req.params.id), user);
  if (!(v.hr || v.hiringManager) || !SHORTLIST_STAGES.includes(app.stage) || app.employeeId === user.id) {
    throw new HttpError(403, "The hiring manager and HR add feedback on shortlisted candidates");
  }
  await prisma.interviewFeedback.create({ data: { applicationId: app.id, authorId: user.id, recommendation: input.recommendation, comment: input.comment } });
  res.status(201).json({ ok: true });
});

// HR adds an external candidate by hand (once external candidates are allowed)
hiringRouter.post("/requisitions/:id/candidates", requireRole("HR"), hiringUpload.single("cv"), async (req, res) => {
  const user = currentUser(req);
  try {
    const input = parse(z.object({ name: text("Give the candidate's name"), email: z.string().trim().email("Enter a valid email").optional().or(z.literal("").transform(() => undefined)), phone: optText, note: optText }), req.body);
    const { r } = await loadFor(Number(req.params.id), user);
    if (!externalOpen(r)) {
      throw new HttpError(400, r.scope === "INTERNAL" ? "This position is internal only" : r.externalFrom ? `External candidates can be added from ${ymd(r.externalFrom)}` : "This position is not open");
    }
    const app = await prisma.jobApplication.create({
      data: {
        requisitionId: r.id, candidateName: input.name, candidateEmail: input.email ?? null, candidatePhone: input.phone, note: input.note,
        ...(req.file ? { cvPath: relativeUploadPath(req.file.path), cvName: req.file.originalname } : {}),
      },
    });
    await prisma.applicationEvent.create({ data: { applicationId: app.id, stage: "APPLIED", note: "External candidate added by HR", byId: user.id } });
    res.status(201).json({ id: app.id });
  } catch (err) {
    removeFile(req.file);
    throw err;
  }
});

// Internal applicant appointed: moved into the position (external candidates: Add employee with ?application=)
hiringRouter.post("/applications/:id/hire", requireRole("HR"), async (req: Request, res) => {
  const user = currentUser(req);
  const { effectiveDate } = parse(z.object({ effectiveDate: ymdString }), req.body);
  const { app } = await loadApplication(Number(req.params.id), user);
  if (!app.employeeId) throw new HttpError(400, "External candidates are hired with Create employee");
  if (app.requisition.status !== "POSTED") throw new HttpError(400, "This position is not open");
  if (!ACTIVE_STAGES.includes(app.stage)) throw new HttpError(400, `This application is ${STAGE_LABELS[app.stage].toLowerCase()}`);
  if (app.employeeId === user.id) throw new HttpError(403, "Another HR user must appoint you");
  if ((await hiredCount(prisma, app.requisitionId)) >= app.requisition.headcount) throw new HttpError(400, "All positions are already filled");
  const draftId = await moveInternally(app.id, effectiveDate, user);
  res.json({ ok: true, draftReplacementId: draftId });
});

export { closeIfFilled };
