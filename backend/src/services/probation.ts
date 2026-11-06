import { prisma } from "../lib/prisma.js";
import { toDate, todayYmd, ymd } from "../lib/dates.js";
import { notify, employeeIdsWithRole } from "../lib/notify.js";
import { HttpError } from "../middleware/error.js";

export type ProbationStatus = "ON_PROBATION" | "DUE" | "CONFIRMED";

/**
 * ON_PROBATION: a future end date. DUE: the date has arrived and HR has not decided yet.
 * CONFIRMED: either HR confirmed (confirmedAt set), or the employee was never put on probation.
 */
export function probationStatus(e: { probationEndDate: Date | null; confirmedAt: Date | null }): ProbationStatus {
  if (!e.probationEndDate || e.confirmedAt) return "CONFIRMED";
  return e.probationEndDate <= toDate(todayYmd()) ? "DUE" : "ON_PROBATION";
}

/** How many active employees are waiting on a confirmation decision right now (for the Employees list). */
export function probationDueCount() {
  return prisma.employee.count({
    where: { status: "ACTIVE", confirmedAt: null, probationEndDate: { lte: toDate(todayYmd()) } },
  });
}

/**
 * Daily: tells the Line Manager (HR, if there isn't one) once per employee whose probation end date has
 * arrived, so HR can confirm or extend. Fires again if probation is later extended and the new date also
 * arrives, because extending clears probationNotifiedAt.
 */
export async function notifyProbationDue() {
  const due = await prisma.employee.findMany({
    where: { status: "ACTIVE", confirmedAt: null, probationNotifiedAt: null, probationEndDate: { lte: toDate(todayYmd()) } },
    select: { id: true, fullName: true, managerId: true, probationEndDate: true },
  });
  for (const e of due) {
    const recipients = e.managerId ? [e.managerId] : await employeeIdsWithRole("HR");
    await notify(
      recipients,
      `Confirmation due: ${e.fullName}`,
      `${e.fullName}'s probation ended on ${ymd(e.probationEndDate!)}. HR can now confirm their employment or extend probation.` +
        (e.managerId ? " You can leave a note for HR before they decide." : ""),
      "/team",
    );
    await prisma.employee.update({ where: { id: e.id }, data: { probationNotifiedAt: new Date() } });
  }
  return due.length;
}

async function notifyDecision(e: { id: number; fullName: string; managerId: number | null }, title: string, body: string) {
  await notify([e.id], title, body, "/profile");
  if (e.managerId) await notify([e.managerId], title, body, "/team");
}

/** HR confirms employment: the probation period ends (empty = confirmed, as the field has always meant). */
export async function confirmEmployee(employeeId: number, decidedById: number) {
  const e = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!e) throw new HttpError(404, "Employee not found");
  if (e.confirmedAt) throw new HttpError(400, `${e.fullName} is already confirmed`);
  const [, decision] = await prisma.$transaction([
    prisma.employee.update({ where: { id: employeeId }, data: { probationEndDate: null, confirmedAt: new Date() } }),
    prisma.probationDecision.create({
      data: { employeeId, kind: "CONFIRMED", previousProbationEndDate: e.probationEndDate, decidedById },
    }),
  ]);
  await notifyDecision(e, "Employment confirmed", `${e.fullName}'s employment has been confirmed by HR.`);
  return decision;
}

/** HR extends probation: a new end date and a reason are required; the due cycle restarts. */
export async function extendProbation(employeeId: number, newEndDate: string, reason: string, decidedById: number) {
  const e = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!e) throw new HttpError(404, "Employee not found");
  if (e.confirmedAt) throw new HttpError(400, `${e.fullName} is already confirmed`);
  const newDate = toDate(newEndDate);
  if (newDate <= toDate(todayYmd())) throw new HttpError(400, "The new probation end date must be in the future");
  const [, decision] = await prisma.$transaction([
    prisma.employee.update({ where: { id: employeeId }, data: { probationEndDate: newDate, probationNotifiedAt: null } }),
    prisma.probationDecision.create({
      data: { employeeId, kind: "EXTENDED", previousProbationEndDate: e.probationEndDate, newProbationEndDate: newDate, reason, decidedById },
    }),
  ]);
  await notifyDecision(e, "Probation extended", `${e.fullName}'s probation has been extended to ${ymd(newDate)} by HR. Reason: ${reason}`);
  return decision;
}

/** The employee's Line Manager leaves an optional note for HR. Not an approval step. */
export async function addProbationNote(employeeId: number, authorId: number, comment: string) {
  const e = await prisma.employee.findUnique({ where: { id: employeeId }, select: { managerId: true } });
  if (!e) throw new HttpError(404, "Employee not found");
  if (e.managerId !== authorId) throw new HttpError(403, "Only this employee's Line Manager can leave a note");
  return prisma.probationNote.create({ data: { employeeId, authorId, comment } });
}

/** HR's view of an employee's probation record: every decision and every Line Manager note, newest first. */
export async function probationHistory(employeeId: number) {
  const [decisions, notes] = await Promise.all([
    prisma.probationDecision.findMany({
      where: { employeeId },
      include: { decidedBy: { select: { fullName: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.probationNote.findMany({
      where: { employeeId },
      include: { author: { select: { fullName: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return {
    decisions: decisions.map((d) => ({
      id: d.id, kind: d.kind,
      previousProbationEndDate: d.previousProbationEndDate ? ymd(d.previousProbationEndDate) : null,
      newProbationEndDate: d.newProbationEndDate ? ymd(d.newProbationEndDate) : null,
      reason: d.reason, decidedBy: d.decidedBy.fullName, at: d.createdAt,
    })),
    notes: notes.map((n) => ({ id: n.id, comment: n.comment, author: n.author.fullName, at: n.createdAt })),
  };
}
