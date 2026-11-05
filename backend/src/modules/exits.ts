import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { audit } from "../lib/audit.js";
import { employeeIdsWithRole, notify } from "../lib/notify.js";
import { renderEmail } from "../lib/mailer.js";
import { enqueueEmail } from "../jobs/queue.js";
import { todayYmd, toDate, ymd } from "../lib/dates.js";
import { HttpError } from "../middleware/error.js";
import { currentUser, hasRole, requireAuth, requireRole, type AuthUser } from "../middleware/auth.js";
import { assetClearance } from "../services/assets.js";
import { exitLetterPdf, EXIT_LETTERS, type ExitLetterKind } from "../services/pdf.js";
import {
  afterParallelCleared, AREA_LABELS, canClear, createExitCase, deactivateForExit, EXIT_TYPE_LABELS, exitCaseOpened, handoverFor,
  handoverWarning, noticeFor, openExitCase, PARALLEL_AREAS, settlementDraft, SETTLEMENT_KIND_LABELS,
} from "../services/exits.js";
import { round2 } from "../services/expenses.js";
import type { ClearanceArea, Prisma } from "../generated/prisma/client.js";

// Exit clearance: IT/Admin, Line Manager and HR clear in parallel, then Finance records the final settlement.
export const exitsRouter = Router();
exitsRouter.use(requireAuth);

const ymdString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const r = schema.safeParse(body ?? {});
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => i.message).join("; "));
  return r.data;
};

const caseInclude = {
  employee: {
    select: {
      id: true, fullName: true, code: true, designation: true, joiningDate: true, personalEmail: true, status: true, managerId: true,
      department: { select: { name: true } }, manager: { select: { fullName: true } },
    },
  },
  request: { select: { id: true, createdAt: true } },
  startedBy: { select: { fullName: true } },
  completedBy: { select: { fullName: true } },
  cancelledBy: { select: { fullName: true } },
  lettersIssuedBy: { select: { fullName: true } },
  settledBy: { select: { fullName: true } },
  clearances: { include: { approver: { select: { fullName: true } }, clearedBy: { select: { fullName: true } } } },
  settlementItems: { orderBy: { order: "asc" } },
  interview: { include: { recordedBy: { select: { fullName: true } } } },
} satisfies Prisma.ExitCaseInclude;

type CaseFull = Prisma.ExitCaseGetPayload<{ include: typeof caseInclude }>;

async function loadCase(id: number) {
  const c = await prisma.exitCase.findUnique({ where: { id }, include: caseInclude });
  if (!c) throw new HttpError(404, "Exit case not found");
  return c;
}

/** HR and Management see everything; the leaver, Admin, Finance and the Line Manager see what they need. */
function viewerOf(user: AuthUser, c: CaseFull) {
  const self = user.id === c.employeeId;
  const hr = hasRole(user, "HR") && !self;
  const management = hasRole(user, "MANAGEMENT") && !self;
  const finance = hasRole(user, "FINANCE") && !self;
  const admin = hasRole(user, "ADMIN") && !self;
  const lineManager = c.clearances.some((x) => x.area === "LINE_MANAGER" && x.approverId === user.id) || c.employee.managerId === user.id;
  return { self, hr, management, finance, admin, lineManager, any: self || hr || management || finance || admin || lineManager };
}

async function loadForUser(id: number, user: AuthUser) {
  const c = await loadCase(id);
  const v = viewerOf(user, c);
  if (!v.any) throw new HttpError(403, "You do not have access to this exit case");
  return { c, v };
}

const ORDER: ClearanceArea[] = ["IT_ADMIN", "LINE_MANAGER", "HR", "FINANCE"];
const allCleared = (c: CaseFull) => c.clearances.every((x) => x.status === "CLEARED");
const n = (v: { toString(): string } | null) => (v == null ? null : Number(v));

function summary(c: Pick<CaseFull, "id" | "type" | "status" | "lastWorkingDay" | "deactivatedAt" | "createdAt"> & {
  clearances: { area: ClearanceArea; status: string }[]; employee: { id: number; fullName: string; code: string; department: { name: string } | null } }) {
  return {
    id: c.id,
    type: c.type,
    typeLabel: EXIT_TYPE_LABELS[c.type],
    status: c.status,
    lastWorkingDay: ymd(c.lastWorkingDay),
    deactivated: !!c.deactivatedAt,
    createdAt: c.createdAt,
    employee: { id: c.employee.id, fullName: c.employee.fullName, code: c.employee.code, department: c.employee.department?.name ?? null },
    clearances: ORDER.map((area) => ({ area, label: AREA_LABELS[area], status: c.clearances.find((x) => x.area === area)?.status ?? "WAITING" })),
  };
}

// List: HR / Management see all; Admin / Finance see every case (they own a card); line managers see their reports' cases.
exitsRouter.get("/", async (req, res) => {
  const user = currentUser(req);
  const status = req.query.status === "ALL" ? undefined : req.query.status === "COMPLETED" || req.query.status === "CANCELLED" ? req.query.status : "OPEN";
  const broad = hasRole(user, "HR", "MANAGEMENT", "ADMIN", "FINANCE");
  const rows = await prisma.exitCase.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(broad ? {} : { OR: [{ employeeId: user.id }, { clearances: { some: { area: "LINE_MANAGER", approverId: user.id } } }] }),
    },
    include: { employee: { select: { id: true, fullName: true, code: true, department: { select: { name: true } } } }, clearances: true },
    orderBy: [{ lastWorkingDay: "asc" }],
  });
  res.json(rows.map((c) => ({ ...summary(c), waitingForMe: c.clearances.some((x) => canClear(user, c, x)) })));
});

// My own exit case (the leaver's view), if any
exitsRouter.get("/mine", async (req, res) => {
  const user = currentUser(req);
  const c = await prisma.exitCase.findFirst({ where: { employeeId: user.id }, orderBy: { createdAt: "desc" }, select: { id: true, status: true } });
  res.json(c);
});

// The resignation form's notice period preview for the signed-in employee
exitsRouter.get("/notice", async (req, res) => {
  const user = currentUser(req);
  const n = await noticeFor(user.id, toDate(todayYmd()));
  res.json({ onProbation: n.onProbation, noticeDays: n.noticeDays, noticeEndDate: ymd(n.noticeEndDate), exitOpen: !!(await openExitCase(user.id)) });
});

// What a person must hand over before their exit can be completed (HR)
exitsRouter.get("/handover/:employeeId", requireRole("HR"), async (req, res) => {
  res.json(await handoverFor(Number(req.params.employeeId)));
});

const startSchema = z.object({
  employeeId: z.coerce.number().int({ message: "Choose the employee" }),
  type: z.enum(["RESIGNATION", "TERMINATION", "END_OF_CONTRACT", "OTHER"]),
  reason: z.string().trim().min(3, "Give the reason"),
  noticeGivenOn: ymdString,
  lastWorkingDay: ymdString,
});

// HR starts an exit without a resignation request (termination, end of contract, a resignation received on paper, …)
exitsRouter.post("/", requireRole("HR"), async (req, res) => {
  const user = currentUser(req);
  const input = parse(startSchema, req.body);
  if (input.employeeId === user.id) throw new HttpError(400, "You cannot start your own exit; another HR user must do it");
  const emp = await prisma.employee.findUnique({ where: { id: input.employeeId }, select: { status: true, fullName: true } });
  if (!emp || emp.status !== "ACTIVE") throw new HttpError(400, "Choose an active employee");
  if (input.lastWorkingDay < input.noticeGivenOn) throw new HttpError(400, "The last working day is before the notice date");
  const pending = await prisma.request.findFirst({ where: { employeeId: input.employeeId, type: "RESIGNATION", status: { in: ["PENDING", "RETURNED"] } } });
  if (pending) throw new HttpError(400, `${emp.fullName} has a resignation waiting for approval (request #${pending.id}); approve or reject it instead`);
  const created = await prisma.$transaction((tx) =>
    createExitCase(tx, {
      employeeId: input.employeeId, type: input.type, reason: input.reason, startedById: user.id,
      noticeGivenOn: toDate(input.noticeGivenOn), noticeDays: 0, noticeEndDate: null, lastWorkingDay: toDate(input.lastWorkingDay), shortfallDays: 0, shortfallWaived: false,
    }),
  );
  await audit(user.id, "CREATE", "ExitCase", created.id, { employeeId: input.employeeId, type: input.type, lastWorkingDay: input.lastWorkingDay });
  await exitCaseOpened(created.id);
  res.status(201).json({ id: created.id });
});

exitsRouter.get("/:id", async (req, res) => {
  const user = currentUser(req);
  const { c, v } = await loadForUser(Number(req.params.id), user);
  const open = c.status === "OPEN";
  const money = v.hr || v.management || v.finance;
  const assets = v.hr || v.management || v.admin || v.finance || v.self ? await assetClearance(c.employeeId) : null;
  const handover = v.hr || v.management ? await handoverFor(c.employeeId) : null;
  const finance = c.clearances.find((x) => x.area === "FINANCE");
  const today = todayYmd();
  const lwd = ymd(c.lastWorkingDay);
  // Replacement requisitions raised for this leaver (Manpower Requisition)
  const replacements = v.hr || v.management || v.lineManager
    ? await prisma.requisition.findMany({ where: { exitCaseId: c.id }, select: { id: true, title: true, status: true }, orderBy: { createdAt: "asc" } })
    : [];
  const completeBlockers = open
    ? [
        ...c.clearances.filter((x) => x.status !== "CLEARED").map((x) => `${AREA_LABELS[x.area]} has not cleared yet`),
        ...(today <= lwd ? [`The last working day (${lwd}) has not ended yet`] : []),
        ...(handover && !handover.done ? [handoverWarning(c.employee.fullName, handover)!] : []),
      ]
    : [];
  res.json({
    ...summary(c),
    // The reason for leaving is for HR, Management and the leaver.
    reason: v.hr || v.management || v.self ? c.reason : null,
    requestId: c.requestId,
    employee: {
      id: c.employee.id, fullName: c.employee.fullName, code: c.employee.code, designation: c.employee.designation,
      department: c.employee.department?.name ?? null, manager: c.employee.manager?.fullName ?? null, joiningDate: ymd(c.employee.joiningDate),
      status: c.employee.status, personalEmail: v.hr ? c.employee.personalEmail : undefined,
    },
    noticeGivenOn: ymd(c.noticeGivenOn),
    noticeDays: c.noticeDays,
    noticeEndDate: c.noticeEndDate ? ymd(c.noticeEndDate) : null,
    shortfallDays: c.shortfallDays,
    shortfallWaived: c.shortfallWaived,
    startedBy: c.startedBy.fullName,
    deactivatedAt: c.deactivatedAt,
    completed: c.completedAt ? { at: c.completedAt, by: c.completedBy?.fullName ?? null } : null,
    cancelled: c.cancelledAt ? { at: c.cancelledAt, by: c.cancelledBy?.fullName ?? null, reason: v.self || v.hr || v.management ? c.cancelReason : null } : null,
    clearanceCards: ORDER.map((area) => {
      const x = c.clearances.find((y) => y.area === area)!;
      return {
        area, label: AREA_LABELS[area], status: x.status,
        owner: area === "LINE_MANAGER" ? x.approver?.fullName ?? "HR (no line manager)" : { IT_ADMIN: "Admin", HR: "HR", FINANCE: "Finance (final settlement)" }[area],
        clearedBy: x.clearedBy?.fullName ?? null, clearedAt: x.clearedAt, comment: v.self ? null : x.comment,
        canClear: open && area !== "FINANCE" && canClear(user, c, x),
      };
    }),
    assets: assets && { cleared: assets.cleared, outstanding: assets.outstanding, pendingDecisions: assets.pendingDecisions, recoveries: money ? assets.recoveries : undefined, recoveryTotal: money ? assets.recoveryTotal : undefined },
    handover,
    settlement: money && c.settledAt
      ? {
          items: c.settlementItems.map((i) => ({ kind: i.kind, kindLabel: SETTLEMENT_KIND_LABELS[i.kind], direction: i.direction, description: i.description, days: n(i.days), amount: Number(i.amount) })),
          net: n(c.settlementNet), settledOn: c.settlementPaidOn ? ymd(c.settlementPaidOn) : null, method: c.settlementMethod, reference: c.settlementReference,
          note: c.settlementNote, by: c.settledBy?.fullName ?? null, at: c.settledAt,
        }
      : null,
    settlementDone: !!c.settledAt,
    canSettle: open && !!finance && canClear(user, c, finance),
    letters: c.lettersIssuedAt ? { at: c.lettersIssuedAt, by: c.lettersIssuedBy?.fullName ?? null, emailedTo: v.hr ? c.lettersEmailedTo : undefined } : null,
    canIssueLetters: v.hr && c.status !== "CANCELLED" && allCleared(c),
    canDownloadLetters: v.hr && !!c.lettersIssuedAt,
    interview: v.hr && c.interview
      ? {
          primaryReason: c.interview.primaryReason, rating: c.interview.rating, wouldRecommend: c.interview.wouldRecommend, wouldReturn: c.interview.wouldReturn,
          likedMost: c.interview.likedMost, improve: c.interview.improve, comments: c.interview.comments, recordedBy: c.interview.recordedBy.fullName, at: c.interview.createdAt,
        }
      : null,
    interviewSubmitted: !!c.interview,
    canSubmitInterview: open && (v.hr || v.self) && !c.interview,
    canEdit: v.hr && open && !c.deactivatedAt,
    canReassign: v.hr && open && !!handover && !handover.done,
    canComplete: v.hr && open,
    completeBlockers,
    canCancel: v.hr && open,
    replacements,
  });
});

const clearSchema = z.object({ comment: z.string().trim().max(1000).optional() });

// Clear IT / Admin, Line Manager or HR
exitsRouter.post("/:id/clearances/:area/clear", async (req, res) => {
  const user = currentUser(req);
  const area = String(req.params.area).toUpperCase() as ClearanceArea;
  if (!PARALLEL_AREAS.includes(area)) throw new HttpError(400, area === "FINANCE" ? "Finance clears by recording the final settlement" : "Unknown clearance");
  const { comment } = parse(clearSchema, req.body);
  const { c } = await loadForUser(Number(req.params.id), user);
  if (c.status !== "OPEN") throw new HttpError(400, `This exit is ${c.status.toLowerCase()}`);
  const card = c.clearances.find((x) => x.area === area)!;
  if (card.status === "CLEARED") throw new HttpError(400, `${AREA_LABELS[area]} has already cleared`);
  if (!canClear(user, c, card)) throw new HttpError(403, `Only ${area === "LINE_MANAGER" ? card.approver?.fullName ?? "HR" : AREA_LABELS[area]} can clear this`);
  if (area === "IT_ADMIN") {
    // Recoveries must be final before Finance settles: every item returned, written off or with a recovery set.
    const a = await assetClearance(c.employeeId);
    if (!a.cleared) throw new HttpError(400, `Items still to collect or revoke: ${a.outstanding.map((o) => `${o.name} (${o.tag}, ${o.action.toLowerCase()})`).join("; ")}`);
    if (a.pendingDecisions.length) throw new HttpError(400, `Asset incidents still wait for a decision: ${a.pendingDecisions.map((p) => `${p.name} (${p.tag})`).join("; ")}`);
  }
  await prisma.exitClearance.update({ where: { id: card.id }, data: { status: "CLEARED", clearedById: user.id, clearedAt: new Date(), comment: comment || null } });
  await audit(user.id, "CLEAR", "ExitClearance", card.id, { caseId: c.id, area });
  await afterParallelCleared(c.id);
  res.json({ ok: true });
});

// Pre-filled final settlement for Finance
exitsRouter.get("/:id/settlement-draft", async (req, res) => {
  const user = currentUser(req);
  const { c } = await loadForUser(Number(req.params.id), user);
  const card = c.clearances.find((x) => x.area === "FINANCE")!;
  if (!canClear(user, c, card)) throw new HttpError(403, card.status === "WAITING" ? "Finance clears after IT / Admin, Line Manager and HR" : "Only Finance can prepare the final settlement");
  res.json(await settlementDraft(c.id));
});

const settlementSchema = z.object({
  items: z.array(z.object({
    kind: z.enum(["ASSET_RECOVERY", "TRAVEL_ADVANCE", "NOTICE_SHORTFALL", "LEAVE_ENCASHMENT", "EXPENSE_PAYABLE", "OTHER"]),
    direction: z.enum(["DEDUCT", "PAY"]),
    description: z.string().trim().min(2, "Describe every item"),
    days: z.coerce.number().min(0).nullable().optional(),
    amount: z.coerce.number().min(0, "Amounts cannot be negative"),
  })).max(50),
  settledOn: ymdString,
  method: z.string().trim().max(60).optional(),
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(1000).optional(),
});

// Finance records the final settlement, which clears the Finance card
exitsRouter.post("/:id/settlement", async (req, res) => {
  const user = currentUser(req);
  const input = parse(settlementSchema, req.body);
  const { c } = await loadForUser(Number(req.params.id), user);
  if (c.status !== "OPEN") throw new HttpError(400, `This exit is ${c.status.toLowerCase()}`);
  const card = c.clearances.find((x) => x.area === "FINANCE")!;
  if (!canClear(user, c, card)) throw new HttpError(403, card.status === "WAITING" ? "Finance clears after IT / Admin, Line Manager and HR" : "Only Finance can record the final settlement");
  const zeroAmount = input.items.find((i) => i.amount === 0 && (i.kind === "NOTICE_SHORTFALL" || i.kind === "LEAVE_ENCASHMENT"));
  if (zeroAmount) throw new HttpError(400, `Enter the amount for "${zeroAmount.description}" or remove the line`);
  const net = round2(input.items.reduce((s, i) => s + (i.direction === "PAY" ? i.amount : -i.amount), 0));
  await prisma.$transaction([
    prisma.exitSettlementItem.deleteMany({ where: { caseId: c.id } }),
    prisma.exitSettlementItem.createMany({ data: input.items.map((i, order) => ({ caseId: c.id, order, kind: i.kind, direction: i.direction, description: i.description, days: i.days ?? null, amount: i.amount })) }),
    prisma.exitCase.update({
      where: { id: c.id },
      data: { settlementNet: net, settlementPaidOn: toDate(input.settledOn), settlementMethod: input.method || null, settlementReference: input.reference || null, settlementNote: input.note || null, settledAt: new Date(), settledById: user.id },
    }),
    prisma.exitClearance.update({ where: { id: card.id }, data: { status: "CLEARED", clearedById: user.id, clearedAt: new Date() } }),
  ]);
  await audit(user.id, "SETTLE", "ExitCase", c.id, { net, items: input.items.length });
  await notify(
    (await employeeIdsWithRole("HR")).filter((id) => id !== c.employeeId),
    `Exit cleared: ${c.employee.fullName}`,
    `Finance recorded the final settlement for ${c.employee.fullName}. Every clearance is done: issue the experience and relieving letters, then complete the exit.`,
    `/exits/${c.id}`,
  );
  if (c.employee.status === "ACTIVE") await notify([c.employeeId], "Final settlement recorded", `Finance has recorded your final settlement (settled on ${input.settledOn}).`, `/exits/${c.id}`);
  res.json({ ok: true, net });
});

const editSchema = z.object({ lastWorkingDay: ymdString, shortfallWaived: z.boolean().optional() });

// HR changes the last working day (before the login is switched off) or waives the notice shortfall
exitsRouter.patch("/:id", requireRole("HR"), async (req, res) => {
  const user = currentUser(req);
  const input = parse(editSchema, req.body);
  const { c, v } = await loadForUser(Number(req.params.id), user);
  if (!v.hr || c.status !== "OPEN" || c.deactivatedAt) throw new HttpError(400, "The last working day can only be changed while the exit is open and the login is still on");
  if (c.settledAt) throw new HttpError(400, "Finance has already recorded the final settlement");
  if (input.lastWorkingDay < ymd(c.noticeGivenOn)) throw new HttpError(400, "The last working day is before the notice date");
  const lwd = toDate(input.lastWorkingDay);
  const shortfallDays = c.noticeEndDate ? Math.max(0, Math.round((c.noticeEndDate.getTime() - lwd.getTime()) / 86_400_000)) : 0;
  await prisma.exitCase.update({ where: { id: c.id }, data: { lastWorkingDay: lwd, shortfallDays, shortfallWaived: input.shortfallWaived ?? c.shortfallWaived } });
  await audit(user.id, "UPDATE", "ExitCase", c.id, { lastWorkingDay: { from: ymd(c.lastWorkingDay), to: input.lastWorkingDay }, shortfallDays, shortfallWaived: input.shortfallWaived ?? c.shortfallWaived });
  if (input.lastWorkingDay !== ymd(c.lastWorkingDay)) {
    await notify([c.employeeId], "Last working day changed", `HR changed your last working day to ${input.lastWorkingDay}.`, `/exits/${c.id}`);
  }
  res.json({ ok: true, shortfallDays });
});

// HR moves the leaver's team, departments, pending approvals and clearance cards to someone else
exitsRouter.post("/:id/handover", requireRole("HR"), async (req, res) => {
  const user = currentUser(req);
  const { toEmployeeId } = parse(z.object({ toEmployeeId: z.coerce.number().int({ message: "Choose who takes over" }) }), req.body);
  const { c } = await loadForUser(Number(req.params.id), user);
  if (c.status !== "OPEN") throw new HttpError(400, `This exit is ${c.status.toLowerCase()}`);
  if (toEmployeeId === c.employeeId) throw new HttpError(400, "Choose someone other than the leaver");
  const to = await prisma.employee.findUnique({ where: { id: toEmployeeId }, select: { id: true, fullName: true, status: true, roles: true } });
  if (!to || to.status !== "ACTIVE") throw new HttpError(400, "Choose an active employee");
  const h = await handoverFor(c.employeeId);
  const moved = await prisma.$transaction(async (tx) => {
    await tx.employee.updateMany({ where: { managerId: c.employeeId, status: "ACTIVE", id: { not: to.id } }, data: { managerId: to.id } });
    if (h.departments.length) {
      await tx.department.updateMany({ where: { hodId: c.employeeId }, data: { hodId: to.id } });
      if (!to.roles.includes("HOD")) await tx.employee.update({ where: { id: to.id }, data: { roles: { push: "HOD" } } });
    }
    if (h.reports.length && !to.roles.includes("LINE_MANAGER")) await tx.employee.update({ where: { id: to.id }, data: { roles: { push: "LINE_MANAGER" } } });
    // A request cannot be approved by the person who submitted it: those steps are left for HR to sort out.
    const stepIds = (await tx.requestStep.findMany({ where: { id: { in: h.pendingApprovals.map((s) => s.stepId) }, request: { employeeId: { not: to.id } } }, select: { id: true } })).map((s) => s.id);
    await tx.requestStep.updateMany({ where: { id: { in: stepIds } }, data: { approverId: to.id } });
    await tx.exitClearance.updateMany({ where: { id: { in: h.clearanceCards.map((x) => x.clearanceId) }, case: { employeeId: { not: to.id } } }, data: { approverId: to.id } });
    return stepIds.length;
  });
  const skipped = h.pendingApprovals.length - moved;
  await audit(user.id, "HANDOVER", "ExitCase", c.id, { to: to.id, reports: h.reports.length, departments: h.departments.length, approvals: moved, clearanceCards: h.clearanceCards.length });
  if (moved || h.reports.length || h.departments.length) {
    await notify([to.id], `Handover from ${c.employee.fullName}`, `You now take over from ${c.employee.fullName}: ${h.reports.length} team member(s), ${h.departments.length} department(s) as HOD and ${moved} pending approval(s).`, "/approvals");
  }
  res.json({ ok: true, moved: { reports: h.reports.length, departments: h.departments.length, approvals: moved, clearanceCards: h.clearanceCards.length }, skipped });
});

const interviewSchema = z.object({
  primaryReason: z.string().trim().min(2, "Choose the main reason for leaving"),
  rating: z.coerce.number().int().min(1).max(5).nullable().optional(),
  wouldRecommend: z.boolean().nullable().optional(),
  wouldReturn: z.boolean().nullable().optional(),
  likedMost: z.string().trim().max(2000).optional(),
  improve: z.string().trim().max(2000).optional(),
  comments: z.string().trim().max(2000).optional(),
});

// Optional exit interview, once per exit: filled in by the leaver or recorded by HR; visible to HR only
exitsRouter.post("/:id/interview", async (req, res) => {
  const user = currentUser(req);
  const input = parse(interviewSchema, req.body);
  const { c, v } = await loadForUser(Number(req.params.id), user);
  if (c.status !== "OPEN") throw new HttpError(400, `This exit is ${c.status.toLowerCase()}`);
  if (!v.self && !v.hr) throw new HttpError(403, "Only the employee or HR can fill in the exit interview");
  if (c.interview) throw new HttpError(400, "The exit interview has already been submitted");
  const data = {
    primaryReason: input.primaryReason, rating: input.rating ?? null, wouldRecommend: input.wouldRecommend ?? null, wouldReturn: input.wouldReturn ?? null,
    likedMost: input.likedMost || null, improve: input.improve || null, comments: input.comments || null, recordedById: user.id,
  };
  await prisma.exitInterview.create({ data: { caseId: c.id, ...data } });
  await audit(user.id, "CREATE", "ExitInterview", c.id);
  res.json({ ok: true });
});

async function letterPdfFor(c: CaseFull, kind: ExitLetterKind, issuedBy: string, issuedAt: Date) {
  const employee = await prisma.employee.findUniqueOrThrow({ where: { id: c.employeeId }, include: { department: { select: { name: true } } } });
  return exitLetterPdf(kind, {
    reference: `EHB/HR/${kind === "EXPERIENCE" ? "EXP" : "REL"}/${issuedAt.getUTCFullYear()}/${String(c.id).padStart(4, "0")}`,
    date: issuedAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
    issuedBy,
    employee,
    lastWorkingDay: c.lastWorkingDay,
    resignedOn: c.type === "RESIGNATION" ? c.noticeGivenOn : null,
  });
}

// HR issues the experience and relieving letters once every card is cleared; they are emailed to the personal email
exitsRouter.post("/:id/letters", requireRole("HR"), async (req, res) => {
  const user = currentUser(req);
  const { c, v } = await loadForUser(Number(req.params.id), user);
  if (!v.hr) throw new HttpError(403, "Another HR user must issue your letters");
  if (c.status === "CANCELLED") throw new HttpError(400, "This exit was cancelled");
  if (!allCleared(c)) throw new HttpError(400, "The letters are issued once IT / Admin, Line Manager, HR and Finance have all cleared");
  const issuedAt = new Date();
  const to = c.employee.personalEmail?.trim() || null;
  if (to) {
    const kinds = Object.keys(EXIT_LETTERS) as ExitLetterKind[];
    const pdfs = await Promise.all(kinds.map((k) => letterPdfFor(c, k, user.fullName, issuedAt)));
    const body = `Dear ${c.employee.fullName}, please find attached your experience letter and relieving letter from EHB Technologies. We wish you every success.`;
    const { text, html } = renderEmail("Your experience and relieving letters", body, null);
    await enqueueEmail({
      to, subject: "Your experience and relieving letters", text, html,
      attachments: kinds.map((k, i) => ({ filename: `${k.toLowerCase()}-letter-${c.employee.code}.pdf`, content: pdfs[i]!.toString("base64"), contentType: "application/pdf" })),
    });
  }
  await prisma.exitCase.update({ where: { id: c.id }, data: { lettersIssuedAt: issuedAt, lettersIssuedById: user.id, lettersEmailedTo: to } });
  await audit(user.id, "ISSUE_LETTERS", "ExitCase", c.id, { emailedTo: to });
  res.json({ ok: true, emailedTo: to });
});

exitsRouter.get("/:id/letters/:kind", requireRole("HR"), async (req, res) => {
  const user = currentUser(req);
  const kind = String(req.params.kind).toUpperCase() as ExitLetterKind;
  if (!(kind in EXIT_LETTERS)) throw new HttpError(404, "Unknown letter");
  const { c, v } = await loadForUser(Number(req.params.id), user);
  if (!v.hr) throw new HttpError(403, "Only HR can download exit letters");
  if (!c.lettersIssuedAt) throw new HttpError(400, "The letters have not been issued yet");
  const pdf = await letterPdfFor(c, kind, c.lettersIssuedBy?.fullName ?? "HR Department", c.lettersIssuedAt);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${kind.toLowerCase()}-letter-${c.employee.code}.pdf"`);
  res.send(pdf);
});

// HR completes the exit: every card cleared, the last working day over, the handover done
exitsRouter.post("/:id/complete", requireRole("HR"), async (req, res) => {
  const user = currentUser(req);
  const { c, v } = await loadForUser(Number(req.params.id), user);
  if (!v.hr) throw new HttpError(403, "Another HR user must complete your exit");
  if (c.status !== "OPEN") throw new HttpError(400, `This exit is ${c.status.toLowerCase()}`);
  const notCleared = c.clearances.filter((x) => x.status !== "CLEARED").map((x) => AREA_LABELS[x.area]);
  if (notCleared.length) throw new HttpError(400, `Still to clear: ${notCleared.join(", ")}`);
  if (todayYmd() <= ymd(c.lastWorkingDay)) throw new HttpError(400, `The exit can be completed after the last working day (${ymd(c.lastWorkingDay)})`);
  const warning = handoverWarning(c.employee.fullName, await handoverFor(c.employeeId));
  if (warning) throw new HttpError(400, warning);
  await deactivateForExit(c.id, user.id);
  await prisma.exitCase.update({ where: { id: c.id }, data: { status: "COMPLETED", completedAt: new Date(), completedById: user.id } });
  await audit(user.id, "COMPLETE", "ExitCase", c.id);
  res.json({ ok: true });
});

// HR cancels an exit (e.g. the employee stays). A switched-off login is switched back on.
exitsRouter.post("/:id/cancel", requireRole("HR"), async (req, res) => {
  const user = currentUser(req);
  const { reason } = parse(z.object({ reason: z.string().trim().min(3, "Give the reason for cancelling") }), req.body);
  const { c, v } = await loadForUser(Number(req.params.id), user);
  if (!v.hr) throw new HttpError(403, "Another HR user must cancel your exit");
  if (c.status !== "OPEN") throw new HttpError(400, `This exit is ${c.status.toLowerCase()}`);
  await prisma.$transaction([
    prisma.exitCase.update({ where: { id: c.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: user.id, cancelReason: reason } }),
    ...(c.deactivatedAt ? [prisma.employee.update({ where: { id: c.employeeId }, data: { status: "ACTIVE" } })] : []),
  ]);
  await audit(user.id, "CANCEL", "ExitCase", c.id, { reason, reactivated: !!c.deactivatedAt });
  const owners = [
    ...(await employeeIdsWithRole("ADMIN")),
    ...(c.clearances.find((x) => x.area === "LINE_MANAGER")?.approverId ? [c.clearances.find((x) => x.area === "LINE_MANAGER")!.approverId!] : []),
    ...(c.clearances.find((x) => x.area === "FINANCE")?.status === "PENDING" ? await employeeIdsWithRole("FINANCE") : []),
  ].filter((id) => id !== c.employeeId);
  await notify(owners, `Exit cancelled: ${c.employee.fullName}`, `HR cancelled ${c.employee.fullName}'s exit. No further clearance is needed.`, `/exits/${c.id}`);
  await notify([c.employeeId], "Exit cancelled", `HR cancelled your exit: ${reason}${c.deactivatedAt ? " Your login has been switched back on." : ""}`, `/exits/${c.id}`);
  res.json({ ok: true, reactivated: !!c.deactivatedAt });
});
