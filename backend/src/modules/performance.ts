import { Router, type Request } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { audit } from "../lib/audit.js";
import { employeeIdsWithRole, notify } from "../lib/notify.js";
import { todayYmd, toDate, ymd } from "../lib/dates.js";
import { HttpError } from "../middleware/error.js";
import { currentUser, hasRole, requireAuth, requireRole, type AuthUser } from "../middleware/auth.js";
import { canActOnStep, createSteps, notifyCurrentApprovers, priorApproverIds, resolveSteps } from "../services/approvals.js";
import {
  attendanceReference, bandFor, createScorecard, createScorecards, dateOnly, goalsChain, isManagerOf, joinerLimit, kpiProblems, kpiSchema,
  managerIdsFor, MAX_KPIS, MIN_KPI_WEIGHT, PERSPECTIVES, ratingScale, reviewChain, reviewOpen, STAGE_LABELS, templateKpis, weightedScore,
  type RatingScale,
} from "../services/performance.js";
import { scorecardPdf } from "../services/pdf.js";
import type { Prisma } from "../generated/prisma/client.js";

// Performance (Balanced Scorecard): six-monthly cycles run by HR; goals and results go through the approval engine.
// Ratings are confidential: the employee, their Line Manager, the HOD, HR and Management only.
export const performanceRouter = Router();
performanceRouter.use(requireAuth);

const ymdString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const r = schema.safeParse(body ?? {});
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => i.message).join("; "));
  return r.data;
};
const rating = z.coerce.number().int().min(1, "Ratings are 1 to 5").max(5, "Ratings are 1 to 5");

// ---------------------------------------------------------------------------
// Rules for the screens (scale, bands, limits)
// ---------------------------------------------------------------------------

performanceRouter.get("/rules", async (_req, res) => {
  const scale = await ratingScale();
  res.json({ ...scale, maxKpis: MAX_KPIS, minKpiWeight: MIN_KPI_WEIGHT, perspectives: PERSPECTIVES });
});

// ---------------------------------------------------------------------------
// Department templates (HR creates them; scorecards start from them)
// ---------------------------------------------------------------------------

performanceRouter.get("/templates", requireRole("HR", "MANAGEMENT"), async (_req, res) => {
  const departments = await prisma.department.findMany({ orderBy: { name: "asc" }, include: { performanceTemplate: { include: { updatedBy: { select: { fullName: true } } } } } });
  res.json(departments.map((d) => ({
    departmentId: d.id,
    department: d.name,
    kpis: d.performanceTemplate ? z.array(kpiSchema).catch([]).parse(d.performanceTemplate.kpis) : [],
    updatedAt: d.performanceTemplate?.updatedAt ?? null,
    updatedBy: d.performanceTemplate?.updatedBy.fullName ?? null,
  })));
});

performanceRouter.put("/templates/:departmentId", requireRole("HR"), async (req, res) => {
  const user = currentUser(req);
  const { kpis } = parse(z.object({ kpis: z.array(kpiSchema).max(20) }), req.body);
  const department = await prisma.department.findUnique({ where: { id: Number(req.params.departmentId) } });
  if (!department) throw new HttpError(404, "Department not found");
  const problems = kpiProblems(kpis, (await ratingScale()).minPerspectiveWeight);
  if (problems.length) throw new HttpError(400, problems.join("; "));
  await prisma.performanceTemplate.upsert({
    where: { departmentId: department.id },
    create: { departmentId: department.id, kpis, updatedById: user.id },
    update: { kpis, updatedById: user.id },
  });
  await audit(user.id, "UPDATE", "PerformanceTemplate", department.id, { kpis: kpis.length });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Cycles (HR runs them; HR and Management see the overview)
// ---------------------------------------------------------------------------

const cycleSchema = z.object({
  name: z.string().trim().min(3, "Name the cycle, e.g. January-June 2027"),
  startDate: ymdString,
  endDate: ymdString,
  goalsDueDate: ymdString,
  checkInDate: ymdString.optional().or(z.literal("").transform(() => undefined)),
  reviewOpensDate: ymdString,
  reviewDueDate: ymdString,
});

performanceRouter.get("/cycles", requireRole("HR", "MANAGEMENT"), async (_req, res) => {
  const cycles = await prisma.performanceCycle.findMany({ orderBy: { startDate: "desc" }, include: { scorecards: { select: { stage: true } } } });
  res.json(cycles.map((c) => ({
    id: c.id, name: c.name, status: c.status, startDate: ymd(c.startDate), endDate: ymd(c.endDate), reviewDueDate: ymd(c.reviewDueDate),
    total: c.scorecards.length, done: c.scorecards.filter((s) => s.stage === "COMPLETED" || s.stage === "ACKNOWLEDGED").length,
  })));
});

performanceRouter.post("/cycles", requireRole("HR"), async (req, res) => {
  const user = currentUser(req);
  const input = parse(cycleSchema, req.body);
  // The check-in is at three months unless HR picks another date.
  const checkIn = input.checkInDate ?? ymd(joinerLimit(toDate(input.startDate), 3));
  const order: [string, string][] = [
    [input.startDate, "the start"], [input.goalsDueDate, "the goals due date"], [checkIn, "the check-in"],
    [input.reviewOpensDate, "the review opening"], [input.reviewDueDate, "the review due date"],
  ];
  for (let i = 1; i < order.length; i++) {
    if (order[i]![0] < order[i - 1]![0]) throw new HttpError(400, `Dates must be in order: ${order[i - 1]![1]} comes before ${order[i]![1]}`);
  }
  if (input.endDate < input.startDate || input.reviewOpensDate > input.endDate) throw new HttpError(400, "The review opens before the cycle ends, and the cycle ends after it starts");
  const clash = await prisma.performanceCycle.findFirst({ where: { status: "OPEN", startDate: { lte: toDate(input.endDate) }, endDate: { gte: toDate(input.startDate) } } });
  if (clash) throw new HttpError(400, `"${clash.name}" is still open and overlaps these dates`);
  const scale = await ratingScale();
  const { cycle, count } = await prisma.$transaction(async (tx) => {
    const cycle = await tx.performanceCycle.create({
      data: {
        name: input.name, startDate: toDate(input.startDate), endDate: toDate(input.endDate), goalsDueDate: toDate(input.goalsDueDate),
        checkInDate: toDate(checkIn), reviewOpensDate: toDate(input.reviewOpensDate), reviewDueDate: toDate(input.reviewDueDate), createdById: user.id,
      },
    });
    return { cycle, count: await createScorecards(tx, cycle, scale.joinerMonths) };
  }, { timeout: 30_000 });
  await audit(user.id, "CREATE", "PerformanceCycle", cycle.id, { name: cycle.name, scorecards: count });
  // Every Line Manager (or HR for employees without one) is asked to set goals.
  const cards = await prisma.scorecard.findMany({ where: { cycleId: cycle.id }, include: { employee: { select: { fullName: true } } } });
  const byManager = new Map<number, string[]>();
  for (const c of cards) for (const m of await managerIdsFor(c.employeeId)) byManager.set(m, [...(byManager.get(m) ?? []), c.employee.fullName]);
  for (const [managerId, names] of byManager) {
    await notify([managerId], `Set goals: ${cycle.name}`, `Performance cycle "${cycle.name}" has started. Set the goals for ${names.join(", ")} by ${input.goalsDueDate}.`, "/performance");
  }
  res.status(201).json({ id: cycle.id, scorecards: count });
});

performanceRouter.get("/cycles/:id", requireRole("HR", "MANAGEMENT"), async (req, res) => {
  const cycle = await prisma.performanceCycle.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      scorecards: {
        include: { employee: { select: { id: true, fullName: true, code: true, department: { select: { name: true } }, manager: { select: { fullName: true } } } } },
        orderBy: { employee: { fullName: "asc" } },
      },
    },
  });
  if (!cycle) throw new HttpError(404, "Cycle not found");
  const scale = await ratingScale();
  const today = todayYmd();
  const late = (stage: string) =>
    (["GOAL_SETTING", "GOALS_WITH_EMPLOYEE", "GOALS_APPROVAL"].includes(stage) && today > ymd(cycle.goalsDueDate)) ||
    (["ACTIVE", "MANAGER_REVIEW", "SIGN_OFF"].includes(stage) && today > ymd(cycle.reviewDueDate));
  const final = (s: { stage: string }) => ["COMPLETED", "APPEAL", "ACKNOWLEDGED"].includes(s.stage);
  res.json({
    id: cycle.id, name: cycle.name, status: cycle.status,
    startDate: ymd(cycle.startDate), endDate: ymd(cycle.endDate), goalsDueDate: ymd(cycle.goalsDueDate), checkInDate: dateOnly(cycle.checkInDate),
    reviewOpensDate: ymd(cycle.reviewOpensDate), reviewDueDate: ymd(cycle.reviewDueDate), closedAt: cycle.closedAt,
    joinersUntil: ymd(joinerLimit(cycle.startDate, scale.joinerMonths)),
    stages: Object.entries(STAGE_LABELS).map(([stage, label]) => ({ stage, label, count: cycle.scorecards.filter((s) => s.stage === stage).length })),
    distribution: [5, 4, 3, 2, 1].map((n) => ({ rating: n, band: scale.labels[n], count: cycle.scorecards.filter((s) => final(s) && s.finalBand === scale.labels[n]).length })),
    scorecards: cycle.scorecards.map((s) => ({
      id: s.id, stage: s.stage, stageLabel: STAGE_LABELS[s.stage], late: cycle.status === "OPEN" && late(s.stage),
      finalScore: s.finalScore == null ? null : Number(s.finalScore), finalBand: s.finalBand,
      employee: { id: s.employee.id, fullName: s.employee.fullName, code: s.employee.code, department: s.employee.department?.name ?? null, manager: s.employee.manager?.fullName ?? null },
    })),
    canManage: hasRole(currentUser(req), "HR") && cycle.status === "OPEN",
  });
});

// HR adds someone to an open cycle (e.g. a joiner) or removes a scorecard whose goals were never sent
performanceRouter.post("/cycles/:id/scorecards", requireRole("HR"), async (req, res) => {
  const { employeeId } = parse(z.object({ employeeId: z.coerce.number().int({ message: "Choose the employee" }) }), req.body);
  const cycle = await prisma.performanceCycle.findUnique({ where: { id: Number(req.params.id) } });
  if (!cycle || cycle.status !== "OPEN") throw new HttpError(400, "Only an open cycle can take more employees");
  const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, status: true, fullName: true, departmentId: true } });
  if (!emp || emp.status !== "ACTIVE") throw new HttpError(400, "Choose an active employee");
  if (await prisma.scorecard.findUnique({ where: { cycleId_employeeId: { cycleId: cycle.id, employeeId } } })) throw new HttpError(400, `${emp.fullName} is already in this cycle`);
  const sc = await createScorecard(prisma, cycle.id, emp);
  await audit(currentUser(req).id, "CREATE", "Scorecard", sc.id, { cycleId: cycle.id, employeeId });
  await notify(await managerIdsFor(employeeId), `Set goals: ${emp.fullName}`, `${emp.fullName} was added to "${cycle.name}". Set their goals by ${ymd(cycle.goalsDueDate)}.`, `/performance/${sc.id}`);
  res.status(201).json({ id: sc.id });
});

performanceRouter.delete("/scorecards/:id", requireRole("HR"), async (req, res) => {
  const sc = await prisma.scorecard.findUnique({ where: { id: Number(req.params.id) } });
  if (!sc) throw new HttpError(404, "Scorecard not found");
  if (sc.stage !== "GOAL_SETTING" || sc.goalsSentAt) throw new HttpError(400, "Only a scorecard whose goals were never sent can be removed");
  await prisma.scorecard.delete({ where: { id: sc.id } });
  await audit(currentUser(req).id, "DELETE", "Scorecard", sc.id, { cycleId: sc.cycleId, employeeId: sc.employeeId });
  res.json({ ok: true });
});

performanceRouter.post("/cycles/:id/close", requireRole("HR"), async (req, res) => {
  const cycle = await prisma.performanceCycle.findUnique({ where: { id: Number(req.params.id) }, include: { scorecards: { select: { stage: true } } } });
  if (!cycle || cycle.status !== "OPEN") throw new HttpError(400, "This cycle is not open");
  const waiting = cycle.scorecards.filter((s) => ["SIGN_OFF", "GOALS_APPROVAL", "APPEAL"].includes(s.stage)).length;
  if (waiting) throw new HttpError(400, `${waiting} scorecard(s) are still waiting for an approver or an appeal decision; finish them first`);
  await prisma.performanceCycle.update({ where: { id: cycle.id }, data: { status: "CLOSED", closedAt: new Date() } });
  await audit(currentUser(req).id, "CLOSE", "PerformanceCycle", cycle.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Scorecards
// ---------------------------------------------------------------------------

const scorecardInclude = {
  cycle: true,
  employee: {
    select: {
      id: true, fullName: true, code: true, designation: true, managerId: true, departmentId: true,
      department: { select: { name: true, hodId: true } }, manager: { select: { fullName: true } },
    },
  },
  goalsSetBy: { select: { fullName: true } },
  reviewedBy: { select: { fullName: true } },
  appealDecidedBy: { select: { fullName: true } },
  kpis: { orderBy: { order: "asc" } },
  checkIns: { orderBy: { createdAt: "asc" }, include: { author: { select: { fullName: true } } } },
  adjustments: { orderBy: { createdAt: "asc" }, include: { by: { select: { fullName: true } }, kpi: { select: { title: true } } } },
  goalsRequest: { include: { steps: { orderBy: { order: "asc" } } } },
  reviewRequest: { include: { steps: { orderBy: { order: "asc" } } } },
} satisfies Prisma.ScorecardInclude;
type Full = Prisma.ScorecardGetPayload<{ include: typeof scorecardInclude }>;

/**
 * Who may see a scorecard (and its ratings): the employee, their Line Manager, the HOD of their department,
 * whoever is on its approval chain, HR and Management. Finance and Admin are not included as such.
 */
function viewer(user: AuthUser, sc: Full) {
  const self = user.id === sc.employeeId;
  const manager = isManagerOf(user, sc.employee);
  const hr = hasRole(user, "HR") && !self;
  const management = hasRole(user, "MANAGEMENT") && !self;
  const onChain = [sc.goalsRequest, sc.reviewRequest].some((r) => r?.steps.some((s) => s.approverId === user.id || s.actedById === user.id));
  const hod = sc.employee.department?.hodId === user.id && !self;
  return { self, manager, hr, management, hod: hod || onChain, any: self || manager || hr || management || onChain || hod };
}

async function loadFor(id: number, user: AuthUser) {
  const sc = await prisma.scorecard.findUnique({ where: { id }, include: scorecardInclude });
  if (!sc) throw new HttpError(404, "Scorecard not found");
  const v = viewer(user, sc);
  if (!v.any) throw new HttpError(403, "You do not have access to this scorecard");
  return { sc, v };
}

const isOpen = (sc: Full) => sc.cycle.status === "OPEN";
const pendingStep = (r: Full["reviewRequest"]) => (r && r.status === "PENDING" ? r.steps.find((s) => s.order === r.currentStep) ?? null : null);
const RELEASED = ["COMPLETED", "APPEAL", "ACKNOWLEDGED"];

/** What this viewer should do next (lists and the top of the scorecard). */
function nextAction(sc: { stage: string; appealedAt: Date | null; cycle: { status: string; reviewOpensDate: Date } }, v: { self: boolean; manager: boolean; hr?: boolean }) {
  if (v.hr && sc.stage === "APPEAL") return "Decide the appeal";
  if (sc.cycle.status !== "OPEN") return null;
  if (v.manager && sc.stage === "GOAL_SETTING") return "Set the goals";
  if (v.self && sc.stage === "GOALS_WITH_EMPLOYEE") return "Read and acknowledge your goals";
  if (v.self && sc.stage === "ACTIVE" && reviewOpen(sc.cycle)) return "Submit your self-review";
  if (v.manager && sc.stage === "MANAGER_REVIEW") return "Rate the KPIs";
  if (v.self && sc.stage === "COMPLETED") return sc.appealedAt ? "Acknowledge your final result" : "Acknowledge your result or appeal";
  return null;
}

function present(sc: Full, user: AuthUser, scale: RatingScale) {
  const v = viewer(user, sc);
  const selfVisible = v.self || !!sc.selfSubmittedAt;
  const released = RELEASED.includes(sc.stage);
  const resultVisible = !v.self || released;
  const review = pendingStep(sc.reviewRequest);
  const goals = pendingStep(sc.goalsRequest);
  const hrStep = sc.stage === "SIGN_OFF" && !!review && review.approverRole === "HR" && hasRole(user, "HR") &&
    canActOnStep(user, sc.employeeId, review, priorApproverIds(sc.reviewRequest!.steps, review.order));
  const score = sc.finalScore != null ? Number(sc.finalScore) : sc.stage === "SIGN_OFF" || sc.stage === "APPEAL" ? weightedScore(sc.kpis) : null;
  return {
    id: sc.id,
    stage: sc.stage,
    stageLabel: STAGE_LABELS[sc.stage],
    waitingFor: sc.stage === "GOALS_APPROVAL" ? goals?.label ?? null : sc.stage === "SIGN_OFF" ? review?.label ?? null : sc.stage === "APPEAL" ? "HR" : null,
    nextAction: nextAction(sc, v),
    cycle: {
      id: sc.cycle.id, name: sc.cycle.name, status: sc.cycle.status, startDate: ymd(sc.cycle.startDate), endDate: ymd(sc.cycle.endDate),
      goalsDueDate: ymd(sc.cycle.goalsDueDate), checkInDate: dateOnly(sc.cycle.checkInDate), reviewOpensDate: ymd(sc.cycle.reviewOpensDate),
      reviewDueDate: ymd(sc.cycle.reviewDueDate), reviewOpen: reviewOpen(sc.cycle),
    },
    employee: {
      id: sc.employee.id, fullName: sc.employee.fullName, code: sc.employee.code, designation: sc.employee.designation,
      department: sc.employee.department?.name ?? null, manager: sc.employee.manager?.fullName ?? null,
    },
    kpis: sc.kpis.map((k) => ({
      id: k.id, perspective: k.perspective, perspectiveLabel: PERSPECTIVES[k.perspective], title: k.title, measure: k.measure, target: k.target, weight: k.weight,
      ...(selfVisible ? { actual: k.actual, selfRating: k.selfRating, selfComment: k.selfComment } : { actual: null, selfRating: null, selfComment: null }),
      ...(resultVisible ? { managerRating: k.managerRating, managerComment: k.managerComment, finalRating: k.finalRating } : { managerRating: null, managerComment: null, finalRating: null }),
    })),
    goalsSetBy: sc.goalsSetBy?.fullName ?? null,
    goalsSentAt: sc.goalsSentAt,
    goalsAcknowledgedAt: sc.goalsAcknowledgedAt,
    employeeGoalComment: sc.employeeGoalComment,
    selfSubmittedAt: sc.selfSubmittedAt,
    selfComment: selfVisible ? sc.selfComment : null,
    managerSubmittedAt: sc.managerSubmittedAt,
    reviewedBy: sc.reviewedBy?.fullName ?? null,
    managerComment: resultVisible ? sc.managerComment : null,
    score: resultVisible ? score : null,
    band: resultVisible ? sc.finalBand ?? (score != null ? bandFor(score, scale) : null) : null,
    completedAt: sc.completedAt,
    employeeAckAt: sc.employeeAckAt,
    employeeAckComment: sc.employeeAckComment,
    appeal: sc.appealedAt
      ? { reason: sc.appealReason, at: sc.appealedAt, decision: sc.appealDecision, decidedAt: sc.appealDecidedAt, decidedBy: sc.appealDecidedBy?.fullName ?? null, changed: sc.appealChanged }
      : null,
    checkIns: sc.checkIns.map((c) => ({ id: c.id, author: c.author.fullName, comment: c.comment, at: c.createdAt })),
    // Calibration history: the original rating stays visible (to the employee once the result is released).
    adjustments: resultVisible ? sc.adjustments.map((a) => ({ kpi: a.kpi.title, from: a.fromRating, to: a.toRating, reason: a.reason, kind: a.kind, by: a.by.fullName, at: a.createdAt })) : [],
    goalsRequestId: sc.goalsRequestId,
    reviewRequestId: sc.reviewRequestId,
    can: {
      editGoals: isOpen(sc) && v.manager && sc.stage === "GOAL_SETTING",
      ackGoals: isOpen(sc) && v.self && sc.stage === "GOALS_WITH_EMPLOYEE",
      checkIn: isOpen(sc) && (v.self || v.manager) && sc.stage === "ACTIVE",
      selfReview: isOpen(sc) && v.self && sc.stage === "ACTIVE" && reviewOpen(sc.cycle),
      managerReview: isOpen(sc) && v.manager && sc.stage === "MANAGER_REVIEW",
      calibrate: hrStep || (v.hr && sc.stage === "APPEAL"),
      decideAppeal: v.hr && sc.stage === "APPEAL",
      appeal: v.self && sc.stage === "COMPLETED" && !sc.appealedAt,
      acknowledge: v.self && sc.stage === "COMPLETED",
      remove: v.hr && isOpen(sc) && sc.stage === "GOAL_SETTING" && !sc.goalsSentAt,
      pdf: released,
    },
  };
}

const listInclude = {
  cycle: { select: { id: true, name: true, status: true, startDate: true, endDate: true, reviewOpensDate: true } },
  employee: { select: { id: true, fullName: true, code: true, managerId: true, department: { select: { name: true } } } },
} satisfies Prisma.ScorecardInclude;

function summary(s: Prisma.ScorecardGetPayload<{ include: typeof listInclude }>, user: AuthUser) {
  const v = { self: s.employeeId === user.id, manager: isManagerOf(user, s.employee), hr: hasRole(user, "HR") && s.employeeId !== user.id };
  const released = !v.self || RELEASED.includes(s.stage);
  return {
    id: s.id, stage: s.stage, stageLabel: STAGE_LABELS[s.stage], nextAction: nextAction(s, v),
    cycle: { id: s.cycle.id, name: s.cycle.name, status: s.cycle.status, startDate: ymd(s.cycle.startDate), endDate: ymd(s.cycle.endDate) },
    employee: { id: s.employee.id, fullName: s.employee.fullName, code: s.employee.code, department: s.employee.department?.name ?? null },
    finalBand: released ? s.finalBand : null,
    finalScore: released && s.finalScore != null ? Number(s.finalScore) : null,
  };
}

performanceRouter.get("/mine", async (req, res) => {
  const user = currentUser(req);
  const rows = await prisma.scorecard.findMany({ where: { employeeId: user.id }, include: listInclude, orderBy: { cycle: { startDate: "desc" } } });
  res.json(rows.map((s) => summary(s, user)));
});

// Scorecards I act on: as Line Manager (HR also covers employees without a manager, and appeals)
performanceRouter.get("/team", async (req, res) => {
  const user = currentUser(req);
  const hr = hasRole(user, "HR");
  const rows = await prisma.scorecard.findMany({
    where: {
      employeeId: { not: user.id },
      OR: [
        { employee: { managerId: user.id } },
        ...(hr ? [{ employee: { managerId: null } }, { stage: "APPEAL" as const }] : []),
      ],
    },
    include: listInclude,
    orderBy: [{ cycle: { startDate: "desc" } }, { employee: { fullName: "asc" } }],
  });
  res.json(rows.map((s) => summary(s, user)));
});

performanceRouter.get("/scorecards/:id", async (req, res) => {
  const user = currentUser(req);
  const { sc } = await loadFor(Number(req.params.id), user);
  const scale = await ratingScale();
  const p = present(sc, user, scale);
  const attendance = await attendanceReference(sc.employeeId, sc.cycle.startDate, sc.cycle.endDate);
  const templateAvailable = p.can.editGoals && (await templateKpis(prisma, sc.employee.departmentId)).length > 0;
  res.json({ ...p, attendance, templateAvailable, scale: { labels: scale.labels, bands: scale.bands, minPerspectiveWeight: scale.minPerspectiveWeight }, limits: { maxKpis: MAX_KPIS, minKpiWeight: MIN_KPI_WEIGHT } });
});

async function forAction(req: Request) {
  const user = currentUser(req);
  const { sc, v } = await loadFor(Number(req.params.id), user);
  return { user, sc, v, p: present(sc, user, await ratingScale()) };
}

// --- Goals ---

performanceRouter.put("/scorecards/:id/kpis", async (req, res) => {
  const { kpis } = parse(z.object({ kpis: z.array(kpiSchema).max(20) }), req.body);
  const { user, sc, p } = await forAction(req);
  if (!p.can.editGoals) throw new HttpError(403, "Only the Line Manager can change the goals, while they are being set");
  await prisma.$transaction([
    prisma.scorecardKpi.deleteMany({ where: { scorecardId: sc.id } }),
    prisma.scorecardKpi.createMany({ data: kpis.map((k, order) => ({ scorecardId: sc.id, order, ...k })) }),
    prisma.scorecard.update({ where: { id: sc.id }, data: { goalsSetById: user.id } }),
  ]);
  res.json({ ok: true, problems: kpiProblems(kpis, (await ratingScale()).minPerspectiveWeight) });
});

performanceRouter.post("/scorecards/:id/template/load", async (req, res) => {
  const { user, sc, p } = await forAction(req);
  if (!p.can.editGoals) throw new HttpError(403, "Only the Line Manager can change the goals, while they are being set");
  const kpis = await templateKpis(prisma, sc.employee.departmentId);
  if (!kpis.length) throw new HttpError(404, "There is no template for this department yet");
  await prisma.$transaction([
    prisma.scorecardKpi.deleteMany({ where: { scorecardId: sc.id } }),
    prisma.scorecardKpi.createMany({ data: kpis.map((k, order) => ({ scorecardId: sc.id, order, ...k })) }),
    prisma.scorecard.update({ where: { id: sc.id }, data: { goalsSetById: user.id } }),
  ]);
  res.json({ ok: true });
});

performanceRouter.post("/scorecards/:id/send-goals", async (req, res) => {
  const { user, sc, p } = await forAction(req);
  if (!p.can.editGoals) throw new HttpError(403, "Only the Line Manager can send the goals, while they are being set");
  const problems = kpiProblems(sc.kpis, (await ratingScale()).minPerspectiveWeight);
  if (problems.length) throw new HttpError(400, problems.join("; "));
  await prisma.scorecard.update({ where: { id: sc.id }, data: { stage: "GOALS_WITH_EMPLOYEE", goalsSentAt: new Date(), goalsSetById: user.id } });
  await audit(user.id, "SEND_GOALS", "Scorecard", sc.id);
  await notify([sc.employeeId], `Your goals for ${sc.cycle.name}`, `${user.fullName} has set your goals for ${sc.cycle.name}. Read them and acknowledge them, or ask for changes.`, `/performance/${sc.id}`);
  res.json({ ok: true });
});

const optionalComment = z.object({ comment: z.string().trim().max(2000).optional() });

performanceRouter.post("/scorecards/:id/goals/acknowledge", async (req, res) => {
  const { comment } = parse(optionalComment, req.body);
  const { user, sc, p } = await forAction(req);
  if (!p.can.ackGoals) throw new HttpError(403, "Only the employee can acknowledge their goals, once they are sent");
  const chain = await goalsChain(sc.employeeId);
  const requestId = await prisma.$transaction(async (tx) => {
    const ack = { goalsAcknowledgedAt: new Date(), employeeGoalComment: comment || null };
    // The Line Manager is also the HOD: no duplicate step, the goals are agreed now.
    if (!chain.length) {
      await tx.scorecard.update({ where: { id: sc.id }, data: { ...ack, stage: "ACTIVE" } });
      return null;
    }
    const created = await tx.request.create({
      data: { type: "PERFORMANCE_GOALS", employeeId: sc.employeeId, title: `Performance goals · ${sc.cycle.name}`, data: { scorecardId: sc.id } },
    });
    await createSteps(tx, created.id, await resolveSteps(tx, sc.employeeId, chain));
    await tx.requestAction.create({ data: { requestId: created.id, actorId: user.id, action: "SUBMITTED", comment: comment || null } });
    await tx.scorecard.update({ where: { id: sc.id }, data: { ...ack, stage: "GOALS_APPROVAL", goalsRequestId: created.id } });
    return created.id;
  });
  if (requestId) await notifyCurrentApprovers(requestId);
  else await notify(await managerIdsFor(sc.employeeId), `Goals agreed: ${sc.employee.fullName}`, `${sc.employee.fullName} acknowledged their goals for ${sc.cycle.name}.`, `/performance/${sc.id}`);
  res.json({ ok: true, requestId });
});

performanceRouter.post("/scorecards/:id/goals/request-changes", async (req, res) => {
  const { comment } = parse(z.object({ comment: z.string({ error: "Say what should change" }).trim().min(3, "Say what should change") }), req.body);
  const { sc, p } = await forAction(req);
  if (!p.can.ackGoals) throw new HttpError(403, "Only the employee can ask for changes to their goals, once they are sent");
  await prisma.scorecard.update({ where: { id: sc.id }, data: { stage: "GOAL_SETTING", employeeGoalComment: comment } });
  await notify(await managerIdsFor(sc.employeeId), `Changes asked: ${sc.employee.fullName}'s goals`, `${sc.employee.fullName} asked for changes to their goals: ${comment}`, `/performance/${sc.id}`);
  res.json({ ok: true });
});

// --- Mid-point check-in (comments only, no score) ---

performanceRouter.post("/scorecards/:id/check-ins", async (req, res) => {
  const { comment } = parse(z.object({ comment: z.string({ error: "Write the check-in note" }).trim().min(3, "Write the check-in note").max(2000) }), req.body);
  const { user, sc, v, p } = await forAction(req);
  if (!p.can.checkIn) throw new HttpError(403, "Check-ins are for the employee and their Line Manager while the goals are running");
  await prisma.scorecardCheckIn.create({ data: { scorecardId: sc.id, authorId: user.id, comment } });
  await notify(v.self ? await managerIdsFor(sc.employeeId) : [sc.employeeId], `Check-in note: ${sc.cycle.name}`, `${user.fullName} added a check-in note to ${v.self ? "their" : "your"} scorecard.`, `/performance/${sc.id}`);
  res.status(201).json({ ok: true });
});

// --- Self-review ---

const selfBody = z.object({
  kpis: z.array(z.object({ id: z.coerce.number().int(), actual: z.string().trim().max(500).optional(), selfRating: rating.nullable().optional(), selfComment: z.string().trim().max(2000).optional() })),
  comment: z.string().trim().max(3000).optional(),
  submit: z.boolean().default(false),
});

performanceRouter.put("/scorecards/:id/self-review", async (req, res) => {
  const input = parse(selfBody, req.body);
  const { sc, p } = await forAction(req);
  if (!p.can.selfReview) throw new HttpError(403, sc.stage === "ACTIVE" ? `The self-review opens on ${ymd(sc.cycle.reviewOpensDate)}` : "The self-review is not open");
  if (input.kpis.some((k) => !sc.kpis.some((x) => x.id === k.id))) throw new HttpError(400, "A KPI does not belong to this scorecard");
  const byId = new Map(input.kpis.map((k) => [k.id, k]));
  if (input.submit) {
    const missing = sc.kpis.filter((k) => !byId.get(k.id)?.selfRating);
    if (missing.length) throw new HttpError(400, `Rate every KPI before submitting (missing: ${missing.map((k) => k.title).join(", ")})`);
  }
  await prisma.$transaction([
    ...sc.kpis.map((k) => {
      const v = byId.get(k.id);
      return prisma.scorecardKpi.update({ where: { id: k.id }, data: { actual: v?.actual || null, selfRating: v?.selfRating ?? null, selfComment: v?.selfComment || null } });
    }),
    prisma.scorecard.update({ where: { id: sc.id }, data: { selfComment: input.comment || null, ...(input.submit ? { stage: "MANAGER_REVIEW" as const, selfSubmittedAt: new Date() } : {}) } }),
  ]);
  if (input.submit) {
    await notify(await managerIdsFor(sc.employeeId), `Self-review submitted: ${sc.employee.fullName}`, `${sc.employee.fullName} submitted their self-review for ${sc.cycle.name}. Rate each KPI to continue.`, `/performance/${sc.id}`);
  }
  res.json({ ok: true });
});

// --- Manager review: then HOD and HR sign off ---

const managerBody = z.object({
  kpis: z.array(z.object({ id: z.coerce.number().int(), managerRating: rating.nullable().optional(), managerComment: z.string().trim().max(2000).optional() })),
  comment: z.string().trim().max(3000).optional(),
  submit: z.boolean().default(false),
});

performanceRouter.put("/scorecards/:id/manager-review", async (req, res) => {
  const input = parse(managerBody, req.body);
  const { user, sc, p } = await forAction(req);
  if (!p.can.managerReview) throw new HttpError(403, "Only the Line Manager can rate the KPIs, after the self-review");
  if (input.kpis.some((k) => !sc.kpis.some((x) => x.id === k.id))) throw new HttpError(400, "A KPI does not belong to this scorecard");
  const byId = new Map(input.kpis.map((k) => [k.id, k]));
  if (input.submit) {
    const missing = sc.kpis.filter((k) => !byId.get(k.id)?.managerRating);
    if (missing.length) throw new HttpError(400, `Rate every KPI before submitting (missing: ${missing.map((k) => k.title).join(", ")})`);
    if (!input.comment?.trim()) throw new HttpError(400, "Add an overall comment before submitting");
  }
  const requestId = await prisma.$transaction(async (tx) => {
    for (const k of sc.kpis) {
      const v = byId.get(k.id);
      await tx.scorecardKpi.update({ where: { id: k.id }, data: { managerRating: v?.managerRating ?? null, managerComment: v?.managerComment || null, finalRating: v?.managerRating ?? null } });
    }
    // A returned review starts again from the manager's ratings: earlier calibrations no longer apply.
    await tx.ratingAdjustment.deleteMany({ where: { scorecardId: sc.id, kind: "CALIBRATION" } });
    await tx.scorecard.update({ where: { id: sc.id }, data: { managerComment: input.comment || null, reviewedById: user.id } });
    if (!input.submit) return null;
    const created = await tx.request.create({
      data: { type: "PERFORMANCE_REVIEW", employeeId: sc.employeeId, title: `Performance review · ${sc.cycle.name}`, data: { scorecardId: sc.id } },
    });
    await createSteps(tx, created.id, await resolveSteps(tx, sc.employeeId, await reviewChain(sc.employeeId)));
    await tx.requestAction.create({ data: { requestId: created.id, actorId: user.id, action: "SUBMITTED" } });
    await tx.scorecard.update({ where: { id: sc.id }, data: { stage: "SIGN_OFF", managerSubmittedAt: new Date(), reviewRequestId: created.id } });
    return created.id;
  });
  if (requestId) await notifyCurrentApprovers(requestId);
  res.json({ ok: true, requestId });
});

// --- HR changes a rating: at the HR sign-off step (calibration) or when deciding an appeal; a reason is required ---

performanceRouter.patch("/scorecards/:id/kpis/:kpiId/final-rating", requireRole("HR"), async (req, res) => {
  const input = parse(z.object({ rating, reason: z.string({ error: "Give the reason for the change" }).trim().min(5, "Give the reason for the change") }), req.body);
  const { user, sc, p } = await forAction(req);
  if (!p.can.calibrate) throw new HttpError(403, "HR can change ratings at the HR sign-off step, or while deciding an appeal");
  const kpi = sc.kpis.find((k) => k.id === Number(req.params.kpiId));
  if (!kpi) throw new HttpError(404, "KPI not found");
  if (kpi.finalRating === input.rating) throw new HttpError(400, "That is already the rating");
  const kind = sc.stage === "APPEAL" ? "APPEAL" : "CALIBRATION";
  await prisma.$transaction([
    prisma.scorecardKpi.update({ where: { id: kpi.id }, data: { finalRating: input.rating } }),
    prisma.ratingAdjustment.create({ data: { scorecardId: sc.id, kpiId: kpi.id, fromRating: kpi.finalRating ?? 0, toRating: input.rating, reason: input.reason, kind, byId: user.id } }),
  ]);
  await audit(user.id, kind, "ScorecardKpi", kpi.id, { from: kpi.finalRating, to: input.rating, reason: input.reason });
  res.json({ ok: true });
});

// --- Employee: acknowledge (comment on record) or appeal once to HR ---

performanceRouter.post("/scorecards/:id/acknowledge", async (req, res) => {
  const { comment } = parse(optionalComment, req.body);
  const { sc, p } = await forAction(req);
  if (!p.can.acknowledge) throw new HttpError(403, "Only the employee can acknowledge their released result");
  await prisma.scorecard.update({ where: { id: sc.id }, data: { stage: "ACKNOWLEDGED", employeeAckAt: new Date(), employeeAckComment: comment || null } });
  await notify(await managerIdsFor(sc.employeeId), `Result acknowledged: ${sc.employee.fullName}`, `${sc.employee.fullName} acknowledged their result for ${sc.cycle.name}${comment ? ` with a comment: ${comment}` : "."}`, `/performance/${sc.id}`);
  res.json({ ok: true });
});

performanceRouter.post("/scorecards/:id/appeal", async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string({ error: "Explain why you are appealing" }).trim().min(10, "Explain why you are appealing (at least a sentence)").max(3000) }), req.body);
  const { sc, p } = await forAction(req);
  if (!p.can.appeal) throw new HttpError(403, sc.appealedAt ? "You have already appealed this result; HR's decision is final" : "Only the employee can appeal their released result");
  await prisma.scorecard.update({ where: { id: sc.id }, data: { stage: "APPEAL", appealReason: reason, appealedAt: new Date() } });
  await audit(currentUser(req).id, "APPEAL", "Scorecard", sc.id);
  await notify((await employeeIdsWithRole("HR")).filter((id) => id !== sc.employeeId), `Performance appeal: ${sc.employee.fullName}`, `${sc.employee.fullName} appealed their result for ${sc.cycle.name}: ${reason}`, `/performance/${sc.id}`);
  res.json({ ok: true });
});

performanceRouter.post("/scorecards/:id/appeal/decide", requireRole("HR"), async (req, res) => {
  const { decision } = parse(z.object({ decision: z.string({ error: "Explain HR's decision" }).trim().min(10, "Explain HR's decision (at least a sentence)").max(3000) }), req.body);
  const { user, sc, p } = await forAction(req);
  if (!p.can.decideAppeal) throw new HttpError(403, "Only HR can decide this appeal");
  const scale = await ratingScale();
  const score = weightedScore(sc.kpis);
  const changed = sc.adjustments.some((a) => a.kind === "APPEAL");
  await prisma.scorecard.update({
    where: { id: sc.id },
    data: { stage: "COMPLETED", finalScore: score, finalBand: bandFor(score, scale), appealDecision: decision, appealDecidedAt: new Date(), appealDecidedById: user.id, appealChanged: changed },
  });
  await audit(user.id, "DECIDE_APPEAL", "Scorecard", sc.id, { changed, score });
  const text = changed ? `HR changed your result to ${bandFor(score, scale)} (${score.toFixed(2)} of 5).` : "HR kept your result as it was.";
  await notify([sc.employeeId], "Your appeal has been decided", `${text} ${decision} This decision is final; please acknowledge your result.`, `/performance/${sc.id}`);
  await notify(await managerIdsFor(sc.employeeId), `Appeal decided: ${sc.employee.fullName}`, `HR decided ${sc.employee.fullName}'s appeal for ${sc.cycle.name}. ${changed ? "The result was changed." : "The result stands."}`, `/performance/${sc.id}`);
  res.json({ ok: true, changed, score });
});

performanceRouter.get("/scorecards/:id/pdf", async (req, res) => {
  const { sc, p } = await forAction(req);
  if (!p.can.pdf) throw new HttpError(400, "The PDF is available once the result is released");
  const pdf = await scorecardPdf({
    cycle: `${sc.cycle.name} (${ymd(sc.cycle.startDate)} to ${ymd(sc.cycle.endDate)})`,
    employee: { fullName: sc.employee.fullName, code: sc.employee.code, designation: sc.employee.designation, department: sc.employee.department?.name ?? null, manager: sc.employee.manager?.fullName ?? null },
    kpis: sc.kpis.map((k) => ({ perspective: PERSPECTIVES[k.perspective], title: k.title, target: k.target, weight: k.weight, actual: k.actual, selfRating: k.selfRating, finalRating: k.finalRating })),
    score: Number(sc.finalScore ?? weightedScore(sc.kpis)),
    band: sc.finalBand ?? "",
    scale: (await ratingScale()).labels,
    managerComment: sc.managerComment,
    reviewedBy: sc.reviewedBy?.fullName ?? null,
    completedAt: sc.completedAt,
    appeal: sc.appealDecidedAt ? { decision: sc.appealDecision ?? "", changed: !!sc.appealChanged } : null,
    acknowledged: sc.employeeAckAt ? { at: sc.employeeAckAt, comment: sc.employeeAckComment } : null,
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="scorecard-${sc.employee.code}-${sc.cycle.id}.pdf"`);
  res.send(pdf);
});
