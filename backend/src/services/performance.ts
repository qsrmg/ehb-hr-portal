import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { getSettings } from "../lib/settings.js";
import { notify, employeeIdsWithRole } from "../lib/notify.js";
import { todayYmd, toDate, ymd } from "../lib/dates.js";
import { HttpError } from "../middleware/error.js";
import { hasRole, type AuthUser } from "../middleware/auth.js";
import type { StepSpec } from "./approvals.js";
import type { BscPerspective, Prisma, ScorecardStage } from "../generated/prisma/client.js";

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

export const PERSPECTIVES: Record<BscPerspective, string> = {
  FINANCIAL: "Financial",
  CUSTOMER: "Customer",
  INTERNAL_PROCESS: "Internal Process",
  LEARNING_GROWTH: "Learning & Growth",
};

export const STAGE_LABELS: Record<ScorecardStage, string> = {
  GOAL_SETTING: "Goal setting",
  GOALS_WITH_EMPLOYEE: "Goals with the employee",
  GOALS_APPROVAL: "Goals awaiting approval",
  ACTIVE: "Goals agreed",
  MANAGER_REVIEW: "Manager review",
  SIGN_OFF: "Sign-off",
  COMPLETED: "Result released",
  APPEAL: "Appeal with HR",
  ACKNOWLEDGED: "Acknowledged",
};

export const MAX_KPIS = 10;
export const MIN_KPI_WEIGHT = 5;

/** The 1-5 scale: names and the overall-score bands are HR settings. */
export async function ratingScale() {
  const s = await getSettings();
  const labels: Record<number, string> = {
    1: s["performance.rating1"], 2: s["performance.rating2"], 3: s["performance.rating3"], 4: s["performance.rating4"], 5: s["performance.rating5"],
  };
  const from = { 5: Number(s["performance.band5From"]), 4: Number(s["performance.band4From"]), 3: Number(s["performance.band3From"]), 2: Number(s["performance.band2From"]) };
  return {
    labels,
    bands: [5, 4, 3, 2].map((n) => ({ rating: n, from: from[n as 5 | 4 | 3 | 2], label: labels[n]! })),
    minPerspectiveWeight: Number(s["performance.minPerspectiveWeight"]),
    joinerMonths: Number(s["performance.joinerMonths"]),
  };
}
export type RatingScale = Awaited<ReturnType<typeof ratingScale>>;

/** Overall band for a weighted score, e.g. 4.5 and above is rating 5. */
export function bandFor(score: number, scale: RatingScale) {
  return scale.bands.find((b) => score >= b.from)?.label ?? scale.labels[1]!;
}

export const kpiSchema = z.object({
  perspective: z.enum(["FINANCIAL", "CUSTOMER", "INTERNAL_PROCESS", "LEARNING_GROWTH"]),
  title: z.string().trim().min(3, "Give every KPI a title").max(200),
  measure: z.string().trim().min(2, "Say how every KPI is measured").max(300),
  target: z.string().trim().min(1, "Give every KPI a target").max(200),
  weight: z.coerce.number().int("Weights are whole percentages").min(1).max(100),
});
export type KpiInput = z.infer<typeof kpiSchema>;

/** What must hold before goals go to the employee (and for a department template). */
export function kpiProblems(kpis: Pick<KpiInput, "weight" | "perspective" | "title">[], minPerspectiveWeight: number) {
  const problems: string[] = [];
  if (!kpis.length) problems.push("Add at least one KPI");
  if (kpis.length > MAX_KPIS) problems.push(`Use at most ${MAX_KPIS} KPIs`);
  const light = kpis.filter((k) => k.weight < MIN_KPI_WEIGHT);
  if (light.length) problems.push(`Every KPI needs at least ${MIN_KPI_WEIGHT}% (${light.map((k) => k.title || "untitled").join(", ")})`);
  const total = kpis.reduce((s, k) => s + k.weight, 0);
  if (kpis.length && total !== 100) problems.push(`The weights add up to ${total}%; they must total 100%`);
  if (minPerspectiveWeight > 0) {
    for (const [p, label] of Object.entries(PERSPECTIVES)) {
      const w = kpis.filter((k) => k.perspective === p).reduce((s, k) => s + k.weight, 0);
      if (w < minPerspectiveWeight) problems.push(`${label} has ${w}%; each perspective needs at least ${minPerspectiveWeight}%`);
    }
  }
  return problems;
}

/** Weighted score (1-5, two decimals) from each KPI's final rating. */
export function weightedScore(kpis: { weight: number; finalRating: number | null }[]) {
  const total = kpis.reduce((s, k) => s + k.weight * (k.finalRating ?? 0), 0) / 100;
  return Math.round(total * 100) / 100;
}

/**
 * Second-level approval: the HOD of the employee's department. An HOD's own scorecard goes to Management;
 * when the HOD is also the Line Manager the duplicate step is left out.
 */
async function hodStep(employeeId: number): Promise<StepSpec[]> {
  const emp = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { managerId: true, department: { select: { hodId: true } } } });
  const hodId = emp.department?.hodId ?? null;
  if (!hodId || hodId === employeeId) return [{ label: "Management (in place of HOD)", approver: "MANAGEMENT" }];
  if (hodId === emp.managerId) return [];
  return [{ label: "HOD", approver: "HOD" }];
}

/** Goals: the HOD approves. Empty when the Line Manager is the HOD: the goals are agreed on acknowledgement. */
export const goalsChain = (employeeId: number) => hodStep(employeeId);

/** Result: HOD (unless they are the Line Manager), then HR. */
export async function reviewChain(employeeId: number): Promise<StepSpec[]> {
  return [...(await hodStep(employeeId)), { label: "HR", approver: "HR" }];
}

/** Included: active at the cycle start, plus joiners in the first months of the cycle (a setting). */
export function joinerLimit(startDate: Date, months: number) {
  const d = new Date(startDate);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

/** Who acts as the Line Manager: the employee's current manager, or HR when they have none. */
export async function managerIdsFor(employeeId: number) {
  const emp = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { managerId: true } });
  if (emp.managerId) return [emp.managerId];
  return (await employeeIdsWithRole("HR")).filter((id) => id !== employeeId);
}

export function isManagerOf(user: AuthUser, employee: { id: number; managerId: number | null }) {
  if (user.id === employee.id) return false;
  return employee.managerId ? employee.managerId === user.id : hasRole(user, "HR");
}

/** The review window: from the cycle's review date while the cycle is open. */
export const reviewOpen = (cycle: { reviewOpensDate: Date; status: string }) => cycle.status === "OPEN" && todayYmd() >= ymd(cycle.reviewOpensDate);

/** Attendance and leave during the cycle, shown for reference only (not scored). */
export async function attendanceReference(employeeId: number, start: Date, end: Date) {
  const today = toDate(todayYmd());
  const until = today < end ? today : end;
  const records = until < start ? [] : await prisma.attendanceRecord.findMany({
    where: { employeeId, date: { gte: start, lte: until } },
    select: { status: true, correctedStatus: true },
  });
  const count = { onTime: 0, late: 0, halfDay: 0, absent: 0 };
  for (const r of records) {
    const s = r.correctedStatus ?? r.status;
    if (s === "ON_TIME") count.onTime++;
    else if (s === "LATE") count.late++;
    else if (s === "HALF_DAY") count.halfDay++;
    else if (s === "ABSENT") count.absent++;
  }
  const leave = await prisma.leaveRequest.findMany({
    where: { request: { employeeId, status: "APPROVED" }, startDate: { lte: end }, endDate: { gte: start } },
    select: { days: true },
  });
  return { from: ymd(start), to: ymd(until < start ? start : until), ...count, leaveDays: leave.reduce((s, l) => s + Number(l.days), 0) };
}

/** KPIs from the department template, ready to copy into a scorecard. */
export async function templateKpis(db: Db, departmentId: number | null) {
  if (!departmentId) return [];
  const t = await db.performanceTemplate.findUnique({ where: { departmentId } });
  if (!t) return [];
  const parsed = z.array(kpiSchema).safeParse(t.kpis);
  return parsed.success ? parsed.data : [];
}

/** A scorecard for one employee, pre-filled from their department's template. */
export async function createScorecard(db: Db, cycleId: number, employee: { id: number; departmentId: number | null }) {
  const kpis = await templateKpis(db, employee.departmentId);
  return db.scorecard.create({
    data: { cycleId, employeeId: employee.id, kpis: { create: kpis.map((k, order) => ({ order, ...k })) } },
  });
}

/** Creates the scorecards of a new cycle for everyone included; returns how many. */
export async function createScorecards(db: Db, cycle: { id: number; startDate: Date }, joinerMonths: number) {
  const people = await db.employee.findMany({
    where: { status: "ACTIVE", joiningDate: { lte: joinerLimit(cycle.startDate, joinerMonths) } },
    select: { id: true, departmentId: true },
  });
  for (const p of people) await createScorecard(db, cycle.id, p);
  return people.length;
}

/** A new employee who joins in the first months of an open cycle is added to it straight away. */
export async function addJoinerToOpenCycles(employeeId: number) {
  const emp = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { id: true, departmentId: true, joiningDate: true, status: true } });
  if (emp.status !== "ACTIVE") return;
  const { joinerMonths } = await ratingScale();
  const cycles = await prisma.performanceCycle.findMany({ where: { status: "OPEN" } });
  for (const c of cycles) {
    if (emp.joiningDate > joinerLimit(c.startDate, joinerMonths)) continue;
    if (await prisma.scorecard.findUnique({ where: { cycleId_employeeId: { cycleId: c.id, employeeId } } })) continue;
    await createScorecard(prisma, c.id, emp);
  }
}

/** Called inside the approval transaction when a performance request is finally approved. */
export async function performanceApproved(tx: Tx, requestId: number) {
  const goals = await tx.scorecard.findUnique({ where: { goalsRequestId: requestId } });
  if (goals) {
    if (goals.stage !== "GOALS_APPROVAL") throw new HttpError(400, "These goals are no longer waiting for approval");
    await tx.scorecard.update({ where: { id: goals.id }, data: { stage: "ACTIVE" } });
    return;
  }
  const review = await tx.scorecard.findUnique({ where: { reviewRequestId: requestId }, include: { kpis: true } });
  if (!review) return;
  if (review.stage !== "SIGN_OFF") throw new HttpError(400, "This result is no longer waiting for sign-off");
  const score = weightedScore(review.kpis);
  await tx.scorecard.update({ where: { id: review.id }, data: { stage: "COMPLETED", finalScore: score, finalBand: bandFor(score, await ratingScale()), completedAt: new Date() } });
}

/** After an approve or return on a performance request: move the scorecard and tell the right people. */
export async function performanceActed(requestId: number, action: "approve" | "return") {
  const request = await prisma.request.findUniqueOrThrow({ where: { id: requestId }, select: { status: true, type: true } });
  const sc = await prisma.scorecard.findFirst({
    where: { OR: [{ goalsRequestId: requestId }, { reviewRequestId: requestId }] },
    include: { employee: { select: { id: true, fullName: true } }, cycle: { select: { name: true } } },
  });
  if (!sc) return;
  const link = `/performance/${sc.id}`;
  const who = sc.employee.fullName;
  const goals = request.type === "PERFORMANCE_GOALS";
  const managers = await managerIdsFor(sc.employeeId);
  if (action === "return" && request.status === "RETURNED") {
    await prisma.scorecard.update({ where: { id: sc.id }, data: { stage: goals ? "GOAL_SETTING" : "MANAGER_REVIEW" } });
    const comment = (await prisma.requestAction.findFirst({ where: { requestId, action: "RETURNED" }, orderBy: { createdAt: "desc" } }))?.comment ?? "";
    await notify(managers, `${goals ? "Goals" : "Review"} returned: ${who}`, `${who}'s ${goals ? "goals" : "performance review"} for ${sc.cycle.name} came back for changes: ${comment}`, link);
    if (goals) await notify([sc.employeeId], `Your goals are being revised`, `Your goals for ${sc.cycle.name} were sent back to your Line Manager for changes.`, link);
    return;
  }
  if (action === "approve" && request.status === "APPROVED") {
    if (goals) {
      await notify([sc.employeeId, ...managers], `Goals agreed: ${who}`, `${who}'s goals for ${sc.cycle.name} are approved. Check-ins can be recorded until the review opens.`, link);
    } else {
      const done = await prisma.scorecard.findUniqueOrThrow({ where: { id: sc.id } });
      await notify([sc.employeeId], "Your performance result is ready", `Your result for ${sc.cycle.name} is ready: ${done.finalBand} (${Number(done.finalScore).toFixed(2)} of 5). Read it, then acknowledge it or appeal to HR.`, link);
      await notify(managers, `Result released: ${who}`, `HR has released ${who}'s result for ${sc.cycle.name}: ${done.finalBand}.`, link);
    }
  }
}

export const dateOnly = (d: Date | null) => (d ? ymd(d) : null);
