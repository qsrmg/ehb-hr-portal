import { prisma } from "../lib/prisma.js";
import { getSettings, settingNumber } from "../lib/settings.js";
import { employeeIdsWithRole, notify } from "../lib/notify.js";
import { renderEmail } from "../lib/mailer.js";
import { enqueueEmail } from "../jobs/queue.js";
import { audit } from "../lib/audit.js";
import { todayYmd, toDate, ymd } from "../lib/dates.js";
import { HttpError } from "../middleware/error.js";
import { hasRole, type AuthUser } from "../middleware/auth.js";
import { FINANCE_STEP } from "./expenses.js";
import { bandFor, ratingScale } from "./performance.js";
import type { StepSpec } from "./approvals.js";
import type { ApplicationStage, Prisma, RequisitionStatus } from "../generated/prisma/client.js";

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

export const STATUS_LABELS: Record<RequisitionStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Waiting for approval",
  APPROVED: "Approved, not posted",
  POSTED: "Posted",
  FILLED: "Filled",
  CANCELLED: "Cancelled",
};

export const STAGE_LABELS: Record<ApplicationStage, string> = {
  APPLIED: "Applied",
  SHORTLISTED: "Shortlisted",
  INTERVIEW: "Interview",
  OFFER: "Offer",
  HIRED: "Hired",
  NOT_SELECTED: "Not selected",
  WITHDRAWN: "Withdrawn",
};

/** Stages the hiring manager sees (HR sees all). */
export const SHORTLIST_STAGES: ApplicationStage[] = ["SHORTLISTED", "INTERVIEW", "OFFER", "HIRED"];
export const ACTIVE_STAGES: ApplicationStage[] = ["APPLIED", "SHORTLISTED", "INTERVIEW", "OFFER"];
/** Positions that still count against headcount. */
const OPEN_STATUSES: RequisitionStatus[] = ["SUBMITTED", "APPROVED", "POSTED"];

/** Salary figures are for HR, Finance and Management only. */
export const canSeeSalary = (user: AuthUser) => hasRole(user, "HR", "FINANCE", "MANAGEMENT");

/** Departments a person may raise requisitions for: HR any; HODs the ones they head; Line Managers their own. */
export async function departmentsFor(user: AuthUser) {
  if (hasRole(user, "HR")) return prisma.department.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  const me = await prisma.employee.findUniqueOrThrow({
    where: { id: user.id },
    select: { departmentId: true, headOf: { select: { id: true } }, _count: { select: { reports: { where: { status: "ACTIVE" } } } } },
  });
  const ids = new Set(me.headOf.map((d) => d.id));
  if (me.departmentId && (me._count.reports > 0 || hasRole(user, "LINE_MANAGER"))) ids.add(me.departmentId);
  return prisma.department.findMany({ where: { id: { in: [...ids] } }, orderBy: { name: "asc" }, select: { id: true, name: true } });
}

/** Positions filled so far. */
export const hiredCount = (db: Db, requisitionId: number) => db.jobApplication.count({ where: { requisitionId, stage: "HIRED" } });

/**
 * Headcount for a department: active staff, minus people leaving (open exit case), plus open positions.
 * `extra` is the requisition being checked (left out of the open positions).
 */
export async function headcountFor(departmentId: number, extra?: { id?: number; headcount: number }) {
  const dept = await prisma.department.findUniqueOrThrow({ where: { id: departmentId }, select: { name: true, approvedHeadcount: true } });
  const [active, leaving, open] = await Promise.all([
    prisma.employee.count({ where: { departmentId, status: "ACTIVE" } }),
    prisma.employee.count({ where: { departmentId, status: "ACTIVE", exits: { some: { status: "OPEN" } } } }),
    prisma.requisition.findMany({
      where: { departmentId, status: { in: OPEN_STATUSES }, ...(extra?.id ? { id: { not: extra.id } } : {}) },
      select: { id: true, headcount: true },
    }),
  ]);
  let openPositions = 0;
  for (const r of open) openPositions += Math.max(0, r.headcount - (await hiredCount(prisma, r.id)));
  const projected = active - leaving + openPositions + (extra?.headcount ?? 0);
  return {
    department: dept.name,
    approved: dept.approvedHeadcount,
    active, leaving, openPositions, projected,
    over: dept.approvedHeadcount != null && projected > dept.approvedHeadcount,
  };
}

export type Route = "FULL" | "REPLACEMENT" | "REPLACEMENT_GRADE";
export const ROUTE_LABELS: Record<Route, string> = {
  FULL: "New position or over headcount: Line Manager, HOD, Finance, Management, HR",
  REPLACEMENT: "Replacement, same grade, within headcount: Line Manager, HOD, HR",
  REPLACEMENT_GRADE: "Replacement with a different grade: Line Manager, HOD, Finance, HR",
};

export function routeFor(r: { reason: string; overHeadcount: boolean; gradeChanged: boolean }): Route {
  if (r.reason === "NEW" || r.overHeadcount) return "FULL";
  return r.gradeChanged ? "REPLACEMENT_GRADE" : "REPLACEMENT";
}

/**
 * The approval chain for a requisition. The hiring manager is the Line Manager step (skipped when they raised it);
 * the HOD of the requisition's department follows, with Management standing in when the requester is that HOD
 * (or there is none) unless the route already has a Management step.
 */
export async function requisitionChain(r: { requestedById: number; departmentId: number; reportsToId: number | null }, route: Route): Promise<StepSpec[]> {
  const dept = await prisma.department.findUniqueOrThrow({ where: { id: r.departmentId }, select: { hodId: true } });
  const management: StepSpec = { label: "Management", approver: "MANAGEMENT" };
  const chain: StepSpec[] = [{ label: "Line Manager", approver: "LINE_MANAGER", approverId: r.reportsToId }];
  if (dept.hodId && dept.hodId !== r.requestedById) chain.push({ label: "HOD", approver: "HOD", approverId: dept.hodId });
  else if (route !== "FULL") chain.push({ label: "Management (in place of HOD)", approver: "MANAGEMENT" });
  if (route !== "REPLACEMENT") chain.push(FINANCE_STEP);
  if (route === "FULL") chain.push(management);
  chain.push({ label: "HR", approver: "HR" });
  return chain;
}

/** Steps where Finance confirms the budget. */
export const BUDGET_STEP_LABELS = [FINANCE_STEP.label, FINANCE_STEP.fallback!.label];

/** Rules for applying to internal jobs (settings). */
export async function hiringRules() {
  const s = await getSettings();
  return {
    internalOnlyDays: Number(s["hiring.internalOnlyDays"]),
    minMonthsInRole: Number(s["hiring.minMonthsInRole"]),
    minPerformanceRating: settingNumber(s, "hiring.minPerformanceRating") ?? 0,
  };
}

const monthsBefore = (ymdStr: string, months: number) => {
  const d = toDate(ymdStr);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
};

/** Why an employee may not apply for internal jobs right now (empty = eligible). */
export async function eligibilityProblems(employeeId: number) {
  const rules = await hiringRules();
  const today = todayYmd();
  const emp = await prisma.employee.findUniqueOrThrow({
    where: { id: employeeId },
    select: { status: true, probationEndDate: true, joiningDate: true, roleSince: true, exits: { where: { status: "OPEN" }, select: { id: true } } },
  });
  const problems: string[] = [];
  if (emp.status !== "ACTIVE") problems.push("Only active employees can apply");
  if (emp.probationEndDate && ymd(emp.probationEndDate) >= today) problems.push(`You are on probation until ${ymd(emp.probationEndDate)}`);
  if (emp.exits.length) problems.push("Your exit is under way");
  const since = emp.roleSince ?? emp.joiningDate;
  if (rules.minMonthsInRole > 0 && since > monthsBefore(today, rules.minMonthsInRole)) {
    problems.push(`You need ${rules.minMonthsInRole} months in your current role (in it since ${ymd(since)})`);
  }
  if (rules.minPerformanceRating > 0) {
    const last = await prisma.scorecard.findFirst({
      where: { employeeId, stage: { in: ["COMPLETED", "APPEAL", "ACKNOWLEDGED"] }, finalScore: { not: null } },
      orderBy: { completedAt: "desc" },
    });
    if (last) {
      const scale = await ratingScale();
      const score = Number(last.finalScore);
      const rating = scale.bands.find((b) => score >= b.from)?.rating ?? 1;
      if (rating < rules.minPerformanceRating) {
        problems.push(`Your last performance rating (${bandFor(score, scale)}) is below the minimum of ${scale.labels[rules.minPerformanceRating]}`);
      }
    }
  }
  return problems;
}

/** A posting employees can apply to today. */
export function internalOpen(r: { status: string; scope: string | null; closingDate: Date | null }) {
  return r.status === "POSTED" && (r.scope === "INTERNAL" || r.scope === "BOTH") && !!r.closingDate && ymd(r.closingDate) >= todayYmd();
}

/** HR may add external candidates once the internal-only window is over. */
export function externalOpen(r: { status: string; scope: string | null; externalFrom: Date | null }) {
  return r.status === "POSTED" && (r.scope === "EXTERNAL" || r.scope === "BOTH") && !!r.externalFrom && ymd(r.externalFrom) <= todayYmd();
}

/** Tells an applicant about a stage change: portal + email for employees; email for external candidates. */
export async function notifyApplicant(app: { id: number; employeeId: number | null; candidateName: string | null; candidateEmail: string | null }, title: string, stage: ApplicationStage) {
  const text: Partial<Record<ApplicationStage, string>> = {
    SHORTLISTED: `Good news: you have been shortlisted for ${title}. HR will be in touch about the next step.`,
    INTERVIEW: `You are invited to interview for ${title}. HR will confirm the time with you.`,
    OFFER: `We are pleased to offer you the position of ${title}. HR will share the details with you.`,
    HIRED: `Congratulations, you have been appointed as ${title}.`,
    NOT_SELECTED: `Thank you for your interest in ${title} and for the time you put into your application. After careful consideration we will not be taking your application further on this occasion. We appreciate your interest and encourage you to apply for future opportunities.`,
  };
  const body = text[stage];
  if (!body) return;
  const subject = stage === "NOT_SELECTED" ? `Your application for ${title}` : `${STAGE_LABELS[stage]}: ${title}`;
  if (app.employeeId) {
    await notify([app.employeeId], subject, body, "/hiring?tab=applications");
  } else if (app.candidateEmail) {
    const { text: t, html } = renderEmail(subject, `Dear ${app.candidateName ?? "candidate"}, ${body}`, null);
    await enqueueEmail({ to: app.candidateEmail, subject, text: t, html });
  }
}

/**
 * Marks a position filled once every place is taken; the remaining applicants are told politely that they were
 * not selected.
 */
export async function closeIfFilled(requisitionId: number, actorId: number) {
  const r = await prisma.requisition.findUniqueOrThrow({ where: { id: requisitionId } });
  if (r.status !== "POSTED" || (await hiredCount(prisma, r.id)) < r.headcount) return false;
  await prisma.requisition.update({ where: { id: r.id }, data: { status: "FILLED", closedAt: new Date(), closedById: actorId, closedReason: "All positions filled" } });
  await declineRemaining(r.id, r.title, actorId, "Position filled");
  await notify([r.requestedById, ...(r.reportsToId ? [r.reportsToId] : [])], `Position filled: ${r.title}`, `All ${r.headcount} position(s) for ${r.title} are filled.`, `/hiring/requisitions/${r.id}`);
  return true;
}

export async function declineRemaining(requisitionId: number, title: string, actorId: number, note: string) {
  const open = await prisma.jobApplication.findMany({ where: { requisitionId, stage: { in: ACTIVE_STAGES } } });
  for (const a of open) {
    await prisma.$transaction([
      prisma.jobApplication.update({ where: { id: a.id }, data: { stage: "NOT_SELECTED" } }),
      prisma.applicationEvent.create({ data: { applicationId: a.id, stage: "NOT_SELECTED", note, byId: actorId } }),
    ]);
    await notifyApplicant(a, title, "NOT_SELECTED");
  }
}

/**
 * An employee moves into the position: department, line manager, designation and grade change now, and their
 * time in role starts again. The manager they leave gets a DRAFT replacement requisition (not submitted).
 */
export async function moveInternally(applicationId: number, effectiveDate: string, actor: AuthUser) {
  const app = await prisma.jobApplication.findUniqueOrThrow({
    where: { id: applicationId },
    include: {
      requisition: true,
      employee: { select: { id: true, fullName: true, departmentId: true, managerId: true, designation: true, grade: true, department: { select: { name: true } } } },
    },
  });
  const emp = app.employee!;
  const r = app.requisition;
  const before = { departmentId: emp.departmentId, managerId: emp.managerId, designation: emp.designation, grade: emp.grade };
  const draft = await prisma.$transaction(async (tx) => {
    await tx.employee.update({
      where: { id: emp.id },
      data: { departmentId: r.departmentId, managerId: r.reportsToId, designation: r.title, grade: r.grade ?? emp.grade, roleSince: toDate(effectiveDate) },
    });
    await tx.jobApplication.update({ where: { id: app.id }, data: { stage: "HIRED", hiredEmployeeId: emp.id } });
    await tx.applicationEvent.create({ data: { applicationId: app.id, stage: "HIRED", note: `Internal move effective ${effectiveDate}`, byId: actor.id } });
    if (!before.departmentId) return null;
    const hrFallback = (await employeeIdsWithRole("HR"))[0] ?? actor.id;
    return tx.requisition.create({
      data: {
        status: "DRAFT", requestedById: before.managerId ?? hrFallback, departmentId: before.departmentId, title: before.designation ?? "Replacement",
        grade: before.grade, reason: "REPLACEMENT", replacesEmployeeId: emp.id, reportsToId: before.managerId, targetStartDate: toDate(effectiveDate),
        justification: `Replacement for ${emp.fullName}, who moved to ${r.title} on ${effectiveDate}.`,
      },
    });
  });
  await audit(actor.id, "INTERNAL_MOVE", "Employee", emp.id, { requisitionId: r.id, from: before, to: { departmentId: r.departmentId, managerId: r.reportsToId, designation: r.title }, effectiveDate });
  await notifyApplicant(app, r.title, "HIRED");
  if (draft) {
    await notify(
      [draft.requestedById],
      `Draft replacement: ${draft.title}`,
      `${emp.fullName} moves to ${r.title} on ${effectiveDate}. A draft replacement requisition for their role is ready for you to review and submit (it has not been submitted).`,
      `/hiring/requisitions/${draft.id}`,
    );
  }
  await closeIfFilled(r.id, actor.id);
  return draft?.id ?? null;
}

/** External candidate becomes an employee (called after Add employee created them). */
export async function hiredExternally(tx: Tx, applicationId: number, employeeId: number, actorId: number) {
  await tx.jobApplication.update({ where: { id: applicationId }, data: { stage: "HIRED", hiredEmployeeId: employeeId } });
  await tx.applicationEvent.create({ data: { applicationId, stage: "HIRED", note: "Employee record created", byId: actorId } });
}

/** Checks an external candidate can be hired through Add employee; returns what to pre-fill. */
export async function externalHireContext(applicationId: number) {
  const app = await prisma.jobApplication.findUnique({ where: { id: applicationId }, include: { requisition: true } });
  if (!app || app.employeeId) throw new HttpError(400, "Only external candidates are hired through Add employee; internal applicants are moved from the position");
  if (!ACTIVE_STAGES.includes(app.stage)) throw new HttpError(400, `This candidate is ${STAGE_LABELS[app.stage].toLowerCase()}`);
  if (app.requisition.status !== "POSTED") throw new HttpError(400, "This position is no longer open");
  return app;
}

/**
 * At its approval step Finance must confirm the budget (salary range); the requester's figures are a suggestion.
 * Runs inside the approval transaction.
 */
export async function manpowerStepApproved(
  tx: Tx,
  ctx: { requestId: number; type: string; step: { label: string } },
  body: { salaryMin?: number; salaryMax?: number; budgetNote?: string },
  approverId: number,
) {
  if (ctx.type !== "MANPOWER" || !BUDGET_STEP_LABELS.includes(ctx.step.label)) return;
  const { salaryMin, salaryMax } = body;
  if (!salaryMin || !salaryMax) throw new HttpError(400, "Confirm the budget: enter the salary range (minimum and maximum) before approving");
  if (salaryMin <= 0 || salaryMax <= 0 || salaryMin > salaryMax) throw new HttpError(400, "The salary range must be positive, with the minimum not above the maximum");
  await tx.requisition.update({
    where: { requestId: ctx.requestId },
    data: { salaryMin, salaryMax, budgetNote: body.budgetNote?.trim() || null, budgetConfirmedById: approverId, budgetConfirmedAt: new Date() },
  });
}

/** Final approval (HR): ready to post. */
export async function manpowerApproved(tx: Tx, requestId: number) {
  await tx.requisition.update({ where: { requestId }, data: { status: "APPROVED" } });
}

/** After an action on a requisition's approval request: returned → back to a draft; rejected or withdrawn → cancelled. */
export async function manpowerActed(requestId: number, action: "approve" | "reject" | "return" | "cancel", actorId: number) {
  const request = await prisma.request.findUniqueOrThrow({ where: { id: requestId }, select: { status: true } });
  const r = await prisma.requisition.findUnique({ where: { requestId } });
  if (!r) return;
  const comment = (await prisma.requestAction.findFirst({ where: { requestId }, orderBy: { createdAt: "desc" } }))?.comment ?? null;
  if (action === "return" && request.status === "RETURNED") {
    await prisma.requisition.update({ where: { id: r.id }, data: { status: "DRAFT", requestId: null } });
  } else if ((action === "reject" && request.status === "REJECTED") || (action === "cancel" && request.status === "CANCELLED")) {
    await prisma.requisition.update({
      where: { id: r.id },
      data: { status: "CANCELLED", closedAt: new Date(), closedById: actorId, closedReason: action === "reject" ? `Rejected: ${comment ?? ""}` : "Withdrawn by the requester" },
    });
  } else if (action === "approve" && request.status === "APPROVED") {
    await notify(
      (await employeeIdsWithRole("HR")).filter((id) => id !== r.requestedById),
      `Approved, ready to post: ${r.title}`,
      `The requisition for ${r.title} is approved. Post it as an internal and/or external job.`,
      `/hiring/requisitions/${r.id}`,
    );
  }
}
