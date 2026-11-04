import { prisma } from "../lib/prisma.js";
import { getSettings, settingNumber } from "../lib/settings.js";
import { addDays, todayYmd, toDate, ymd } from "../lib/dates.js";
import { audit } from "../lib/audit.js";
import { employeeIdsWithRole, notify } from "../lib/notify.js";
import { HttpError } from "../middleware/error.js";
import { hasRole, type AuthUser } from "../middleware/auth.js";
import { assetClearance } from "./assets.js";
import { balancesFor } from "./leave.js";
import { advanceDue, approvedTotal } from "./travel.js";
import { round2 } from "./expenses.js";
import type { StepSpec } from "./approvals.js";
import type { ClearanceArea, ExitType, Prisma } from "../generated/prisma/client.js";

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

export const EXIT_TYPE_LABELS: Record<ExitType, string> = {
  RESIGNATION: "Resignation",
  TERMINATION: "Termination",
  END_OF_CONTRACT: "End of contract",
  OTHER: "Other",
};

export const AREA_LABELS: Record<ClearanceArea, string> = {
  IT_ADMIN: "IT / Admin",
  LINE_MANAGER: "Line Manager",
  HR: "HR",
  FINANCE: "Finance",
};

/** IT/Admin, Line Manager and HR clear in parallel; Finance clears last, once recoveries are final. */
export const PARALLEL_AREAS: ClearanceArea[] = ["IT_ADMIN", "LINE_MANAGER", "HR"];

export const daysBetween = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / 86_400_000);

/** Notice period on a given day: the probation period applies until the employee's probation end date. */
export async function noticeFor(employeeId: number, givenOn: Date) {
  const emp = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { probationEndDate: true } });
  const settings = await getSettings();
  const onProbation = !!emp.probationEndDate && emp.probationEndDate >= givenOn;
  const noticeDays = Number(onProbation ? settings["exit.probationNoticeDays"] : settings["exit.noticeDays"]);
  return { onProbation, noticeDays, noticeEndDate: addDays(givenOn, noticeDays) };
}

/** Line Manager → HOD → HR. An HOD's own resignation goes to Management in place of the HOD. */
export async function resignationChain(employeeId: number): Promise<StepSpec[]> {
  const emp = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { department: { select: { hodId: true } } } });
  const hodId = emp.department?.hodId ?? null;
  const hodStep: StepSpec = hodId && hodId !== employeeId
    ? { label: "HOD", approver: "HOD" }
    : { label: "Management (in place of HOD)", approver: "MANAGEMENT" };
  return [{ label: "Line Manager", approver: "LINE_MANAGER" }, hodStep, { label: "HR", approver: "HR" }];
}

/** The open exit case of an employee, if any. */
export const openExitCase = (employeeId: number, db: Db = prisma) =>
  db.exitCase.findFirst({ where: { employeeId, status: "OPEN" } });

/** Leave and trips may not run past the last working day once an exit is under way. */
export async function lastWorkingDayLimit(employeeId: number) {
  const c = await openExitCase(employeeId);
  return c ? c.lastWorkingDay : null;
}

/**
 * What the leaver still holds as an approver: their team, departments they head, approvals waiting with them
 * by name, and Line Manager clearance cards of other leavers. "Complete exit" is blocked until all are reassigned.
 */
export async function handoverFor(employeeId: number) {
  const [reports, departments, steps, cards, roles] = await Promise.all([
    prisma.employee.findMany({ where: { managerId: employeeId, status: "ACTIVE" }, select: { id: true, fullName: true, code: true }, orderBy: { fullName: "asc" } }),
    prisma.department.findMany({ where: { hodId: employeeId }, select: { id: true, name: true } }),
    prisma.requestStep.findMany({
      where: { approverId: employeeId, status: { in: ["PENDING", "WAITING"] }, request: { status: { in: ["PENDING", "RETURNED"] } } },
      select: { id: true, label: true, status: true, request: { select: { id: true, title: true, employee: { select: { fullName: true } } } } },
      orderBy: { requestId: "asc" },
    }),
    prisma.exitClearance.findMany({
      where: { approverId: employeeId, area: "LINE_MANAGER", status: "PENDING", case: { status: "OPEN", employeeId: { not: employeeId } } },
      select: { id: true, case: { select: { id: true, employee: { select: { fullName: true } } } } },
    }),
    prisma.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { roles: true } }),
  ]);
  // Not blocking: role-pool approvals simply go to the other holders. Warn when nobody else holds a role.
  const soleRoles: string[] = [];
  for (const role of roles.roles.filter((r) => ["HR", "FINANCE", "ADMIN", "MANAGEMENT"].includes(r))) {
    const others = await prisma.employee.count({ where: { roles: { has: role }, status: "ACTIVE", id: { not: employeeId } } });
    if (!others) soleRoles.push(role);
  }
  return {
    reports,
    departments,
    pendingApprovals: steps.map((s) => ({ stepId: s.id, requestId: s.request.id, title: s.request.title, employee: s.request.employee.fullName, label: s.label, status: s.status })),
    clearanceCards: cards.map((c) => ({ clearanceId: c.id, caseId: c.case.id, employee: c.case.employee.fullName })),
    soleRoles,
    done: !reports.length && !departments.length && !steps.length && !cards.length,
  };
}

export type Handover = Awaited<ReturnType<typeof handoverFor>>;

export function handoverWarning(name: string, h: Handover) {
  if (h.done) return null;
  const parts = [
    h.reports.length ? `${h.reports.length} team member${h.reports.length === 1 ? "" : "s"}` : null,
    h.departments.length ? `HOD of ${h.departments.map((d) => d.name).join(", ")}` : null,
    h.pendingApprovals.length ? `${h.pendingApprovals.length} pending approval${h.pendingApprovals.length === 1 ? "" : "s"}` : null,
    h.clearanceCards.length ? `${h.clearanceCards.length} exit clearance${h.clearanceCards.length === 1 ? "" : "s"} to sign` : null,
  ].filter(Boolean);
  return `${name} still has ${parts.join(", ")}. Reassign them before the exit can be completed.`;
}

/** Creates the case and its four clearance cards. */
export async function createExitCase(tx: Tx, input: {
  employeeId: number; type: ExitType; reason: string; requestId?: number; startedById: number;
  noticeGivenOn: Date; noticeDays: number; noticeEndDate: Date | null; lastWorkingDay: Date; shortfallDays: number; shortfallWaived: boolean;
}) {
  if (await openExitCase(input.employeeId, tx)) throw new HttpError(400, "This employee already has an open exit case");
  const emp = await tx.employee.findUniqueOrThrow({ where: { id: input.employeeId }, select: { managerId: true } });
  return tx.exitCase.create({
    data: {
      ...input,
      clearances: {
        create: [
          { area: "IT_ADMIN", status: "PENDING" },
          { area: "LINE_MANAGER", status: "PENDING", approverId: emp.managerId },
          { area: "HR", status: "PENDING" },
          { area: "FINANCE", status: "WAITING" },
        ],
      },
    },
  });
}

/** Everyone who must clear something is told; HR also gets the handover warning. */
export async function exitCaseOpened(caseId: number) {
  const c = await prisma.exitCase.findUniqueOrThrow({ where: { id: caseId }, include: { employee: { select: { fullName: true, code: true } }, clearances: true } });
  const who = `${c.employee.fullName} (${c.employee.code})`;
  const lwd = ymd(c.lastWorkingDay);
  const link = `/exits/${c.id}`;
  const lm = c.clearances.find((x) => x.area === "LINE_MANAGER")?.approverId;
  await notify(await employeeIdsWithRole("ADMIN"), `Exit clearance: ${c.employee.fullName}`, `${who} leaves on ${lwd}. Collect their company items and revoke their accounts, then clear IT / Admin.`, link);
  if (lm) await notify([lm], `Exit clearance: ${c.employee.fullName}`, `${who} leaves on ${lwd}. Confirm the handover of their work, then clear Line Manager.`, link);
  const warning = handoverWarning(c.employee.fullName, await handoverFor(c.employeeId));
  await notify(
    (await employeeIdsWithRole("HR")).filter((id) => id !== c.employeeId),
    `Exit clearance: ${c.employee.fullName}`,
    `${who} leaves on ${lwd}. Clear HR when your checks are done.${lm ? "" : " They have no line manager, so HR also clears the Line Manager card."}${warning ? ` ${warning}` : ""}`,
    link,
  );
  await notify([c.employeeId], `Exit clearance started`, `Your last working day is ${lwd}. Return your company items to Admin and complete your handover. You can also fill in an optional exit interview.`, link);
}

/** Who may clear a card. */
export function canClear(user: AuthUser, c: { employeeId: number }, card: { area: ClearanceArea; status: string; approverId: number | null }) {
  if (card.status !== "PENDING" || user.id === c.employeeId) return false;
  if (card.area === "IT_ADMIN") return hasRole(user, "ADMIN");
  if (card.area === "HR") return hasRole(user, "HR");
  if (card.area === "FINANCE") return hasRole(user, "FINANCE");
  return card.approverId ? card.approverId === user.id : hasRole(user, "HR");
}

/** Called after a parallel card is cleared: once all three are done, Finance's card opens. */
export async function afterParallelCleared(caseId: number) {
  const cards = await prisma.exitClearance.findMany({ where: { caseId } });
  if (!PARALLEL_AREAS.every((a) => cards.find((c) => c.area === a)?.status === "CLEARED")) return;
  const finance = cards.find((c) => c.area === "FINANCE");
  if (finance?.status !== "WAITING") return;
  await prisma.exitClearance.update({ where: { id: finance.id }, data: { status: "PENDING" } });
  const c = await prisma.exitCase.findUniqueOrThrow({ where: { id: caseId }, include: { employee: { select: { fullName: true, id: true } } } });
  await notify(
    (await employeeIdsWithRole("FINANCE")).filter((id) => id !== c.employee.id),
    `Final settlement: ${c.employee.fullName}`,
    `IT / Admin, Line Manager and HR have cleared ${c.employee.fullName}'s exit. Prepare the final settlement (recoveries, advances, notice and leave) and clear Finance.`,
    `/exits/${caseId}`,
  );
}

const SETTLEMENT_KIND_LABELS = {
  ASSET_RECOVERY: "Asset recovery",
  TRAVEL_ADVANCE: "Travel advance not settled",
  NOTICE_SHORTFALL: "Notice period not served",
  LEAVE_ENCASHMENT: "Annual Leave encashment",
  EXPENSE_PAYABLE: "Approved claim not yet paid",
  OTHER: "Other",
} as const;
export { SETTLEMENT_KIND_LABELS };

type DraftItem = { kind: keyof typeof SETTLEMENT_KIND_LABELS; direction: "DEDUCT" | "PAY"; description: string; days: number | null; amount: number };

/**
 * Pre-filled final settlement for Finance. The portal does not calculate salary: notice shortfall and leave
 * encashment come with the number of days and Finance enters the amount.
 */
export async function settlementDraft(caseId: number) {
  const c = await prisma.exitCase.findUniqueOrThrow({ where: { id: caseId } });
  const items: DraftItem[] = [];
  const notes: string[] = [];

  const assets = await assetClearance(c.employeeId);
  for (const r of assets.recoveries) {
    items.push({ kind: "ASSET_RECOVERY", direction: "DEDUCT", description: `${r.name} (${r.tag}), ${r.type.toLowerCase().replace("_", " ")}${r.note ? `: ${r.note}` : ""}`, days: null, amount: r.amount });
  }

  const trips = await prisma.travelRequest.findMany({
    where: { request: { employeeId: c.employeeId }, advancePaidAt: { not: null }, advanceReturnedAmount: null },
    include: { request: { select: { id: true } }, settlement: { include: { request: { select: { status: true } }, lines: true } } },
  });
  for (const t of trips) {
    const settled = t.settlement?.request.status === "APPROVED";
    const due = settled || t.cancelledAt ? advanceDue(t) : Number(t.advanceRequested);
    if (due <= 0) continue;
    const state = t.cancelledAt ? "trip cancelled" : settled ? "unspent part" : "no approved settlement yet";
    items.push({ kind: "TRAVEL_ADVANCE", direction: "DEDUCT", description: `Trip #${t.request.id} ${t.origin} → ${t.destination} (${state})`, days: null, amount: due });
  }

  const claims = await prisma.expenseClaim.findMany({
    where: { request: { employeeId: c.employeeId, type: { in: ["EXPENSE", "TRAVEL_SETTLEMENT"] }, status: { in: ["APPROVED", "PENDING", "RETURNED"] } }, paidAt: null },
    include: { request: { select: { id: true, status: true, type: true } }, lines: true, travel: { select: { advancePaidAt: true, advanceRequested: true } } },
  });
  for (const cl of claims) {
    if (cl.request.status !== "APPROVED") {
      notes.push(`Claim #${cl.request.id} is still ${cl.request.status.toLowerCase()}; it is not included.`);
      continue;
    }
    const advance = cl.travel?.advancePaidAt ? Number(cl.travel.advanceRequested) : 0;
    const toPay = round2(approvedTotal(cl.lines) - advance);
    if (toPay > 0) items.push({ kind: "EXPENSE_PAYABLE", direction: "PAY", description: `${cl.request.type === "EXPENSE" ? "Expense claim" : "Travel settlement"} #${cl.request.id}`, days: null, amount: toPay });
  }

  if (c.shortfallDays > 0) {
    if (c.shortfallWaived) notes.push(`HR waived the ${c.shortfallDays}-day notice shortfall.`);
    else items.push({ kind: "NOTICE_SHORTFALL", direction: "DEDUCT", description: `${c.shortfallDays} day(s) of the ${c.noticeDays}-day notice period not served`, days: c.shortfallDays, amount: 0 });
  }

  const settings = await getSettings();
  if ((settingNumber(settings, "exit.leaveEncashment") ?? 0) > 0) {
    const al = (await balancesFor(c.employeeId, c.lastWorkingDay.getUTCFullYear())).find((b) => b.code === "AL");
    if (al?.available && al.available > 0) items.push({ kind: "LEAVE_ENCASHMENT", direction: "PAY", description: `${al.available} unused Annual Leave day(s)`, days: al.available, amount: 0 });
  } else {
    notes.push("Leave encashment on exit is switched off in Rules & Settings.");
  }
  if (assets.pendingDecisions.length) notes.push(`${assets.pendingDecisions.length} asset incident(s) still wait for an HR or Management decision.`);
  return { items, notes };
}

/**
 * Hourly: switches off the login of everyone whose last working day has ended, even if clearance is not
 * finished. The case stays open until HR completes it.
 */
export async function deactivateDueExits(today = todayYmd()) {
  const due = await prisma.exitCase.findMany({
    where: { status: "OPEN", deactivatedAt: null, lastWorkingDay: { lt: toDate(today) } },
    include: { employee: { select: { id: true, fullName: true, status: true } } },
  });
  for (const c of due) await deactivateForExit(c.id, null);
  return due.length;
}

export async function deactivateForExit(caseId: number, actorId: number | null) {
  const c = await prisma.exitCase.findUniqueOrThrow({ where: { id: caseId }, include: { employee: { select: { id: true, fullName: true, status: true } } } });
  if (c.deactivatedAt) return;
  await prisma.$transaction([
    prisma.employee.update({ where: { id: c.employeeId }, data: { status: "INACTIVE" } }),
    prisma.exitCase.update({ where: { id: c.id }, data: { deactivatedAt: new Date() } }),
  ]);
  await audit(actorId, "DEACTIVATE", "Employee", c.employeeId, { exitCaseId: c.id, lastWorkingDay: ymd(c.lastWorkingDay) });
  // Admin is asked to collect anything still held (same hook as a manual deactivation).
  const { employeeDeactivated } = await import("../modules/assets.js");
  await employeeDeactivated(c.employeeId);
  const open = await prisma.exitClearance.count({ where: { caseId: c.id, status: { not: "CLEARED" } } });
  await notify(
    (await employeeIdsWithRole("HR")).filter((id) => id !== c.employeeId),
    `Account deactivated: ${c.employee.fullName}`,
    `${c.employee.fullName}'s last working day (${ymd(c.lastWorkingDay)}) has ended and their login is now off.${open ? ` ${open} clearance card(s) are still open.` : ""} Complete the exit when everything is done.`,
    `/exits/${c.id}`,
  );
}

export const daysFromToday = (d: Date) => daysBetween(toDate(todayYmd()), d);
