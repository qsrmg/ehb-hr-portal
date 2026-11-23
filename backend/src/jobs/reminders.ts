import { prisma } from "../lib/prisma.js";
import { getSettings } from "../lib/settings.js";
import { notify } from "../lib/notify.js";
import { currentApproverIds } from "../services/approvals.js";
import { AREA_LABELS, clearanceOwnerIds } from "../services/exits.js";
import { e2eIgnoreWorkingDayGate, hmToMinutes, nowParts, toDate } from "../lib/dates.js";

/** Office hours in the company timezone: Monday–Friday, start ≤ time < end, not a public holiday. */
export function inOfficeHours(now: Date, start: string, end: string, isHoliday: (ymd: string) => boolean) {
  const { ymd, minutes, weekday } = nowParts(now);
  const isWeekendOrHoliday = weekday === "Sat" || weekday === "Sun" || isHoliday(ymd);
  if (isWeekendOrHoliday && !e2eIgnoreWorkingDayGate) return false;
  return minutes >= hmToMinutes(start) && minutes < hmToMinutes(end);
}

/**
 * Reminder email to the current approver every N hours (default 3), office hours only (9–6, Mon–Fri).
 * There is no delegation: a request keeps waiting with its approver. Returns how many steps were reminded.
 */
export async function sendDueReminders(now = new Date()) {
  const settings = await getSettings();
  const today = nowParts(now).ymd;
  const holiday = await prisma.holiday.findUnique({ where: { date: toDate(today) } });
  if (!inOfficeHours(now, settings["office.start"], settings["office.end"], () => !!holiday)) return 0;

  const cutoff = new Date(now.getTime() - Number(settings["reminders.intervalHours"]) * 3_600_000);
  const due = await prisma.requestStep.findMany({
    where: {
      status: "PENDING",
      request: { status: "PENDING" },
      OR: [{ lastReminderAt: { lte: cutoff } }, { lastReminderAt: null, pendingSince: { lte: cutoff } }],
    },
    include: { request: { include: { employee: { select: { fullName: true } } } } },
  });
  for (const step of due) {
    // Same rule as who may act: not the requester, and not earlier approvers where the step excludes them.
    const recipients = await currentApproverIds(step.requestId);
    await notify(
      recipients,
      `Reminder: ${step.request.title} is waiting for you`,
      `${step.request.employee.fullName}'s request "${step.request.title}" is still waiting for your approval (${step.label}).`,
      `/requests/${step.requestId}`,
    );
    await prisma.requestStep.update({ where: { id: step.id }, data: { lastReminderAt: now } });
  }
  return due.length;
}

/**
 * Reminder email to whoever owns a still-pending exit clearance card, every N hours, office hours only,
 * skipping weekends and holidays — identical gate to sendDueReminders above, reusing the same settings.
 */
export async function sendDueExitClearanceReminders(now = new Date()) {
  const settings = await getSettings();
  const today = nowParts(now).ymd;
  const holiday = await prisma.holiday.findUnique({ where: { date: toDate(today) } });
  if (!inOfficeHours(now, settings["office.start"], settings["office.end"], () => !!holiday)) return 0;

  const cutoff = new Date(now.getTime() - Number(settings["reminders.intervalHours"]) * 3_600_000);
  const sendEmail = settings["exit.sendEmails"] === "1";
  const due = await prisma.exitClearance.findMany({
    where: {
      status: "PENDING",
      case: { status: "OPEN" },
      OR: [{ lastReminderAt: { lte: cutoff } }, { lastReminderAt: null, pendingSince: { lte: cutoff } }],
    },
    include: { case: { select: { id: true, employeeId: true, employee: { select: { fullName: true } } } } },
  });
  for (const card of due) {
    const recipients = (await clearanceOwnerIds(card)).filter((id) => id !== card.case.employeeId);
    if (recipients.length) {
      await notify(
        recipients,
        `Reminder: ${AREA_LABELS[card.area]} clearance is waiting`,
        `${card.case.employee.fullName}'s exit clearance is still waiting for ${AREA_LABELS[card.area]}.`,
        `/exits/${card.case.id}`,
        { sendEmail },
      );
    }
    await prisma.exitClearance.update({ where: { id: card.id }, data: { lastReminderAt: now } });
  }
  return due.length;
}
