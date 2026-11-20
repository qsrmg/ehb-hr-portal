import { prisma } from "../lib/prisma.js";
import { hmToMinutes, nowParts, toDate, ymd } from "../lib/dates.js";
import { getSettings, settingNumber, type SettingKey } from "../lib/settings.js";
import { HttpError } from "../middleware/error.js";
import { approvedTripsWhere, holidayMap } from "./attendance.js";
import { inOfficeHours } from "../jobs/reminders.js";

/**
 * Activity monitoring: records only "was there keyboard/mouse/touch/scroll activity in this minute" — a
 * boolean per minute. It never receives, stores or logs which key was pressed, mouse coordinates, page
 * content, URLs or window titles; the frontend hook (useActivityTracking.ts) only ever reads event.type.
 */

export const POLICY_VERSION = 1;
export const POLICY_TEXT =
  "While you are signed in during office hours, this portal notes whether your mouse or keyboard were used " +
  "in each minute — never which key, where you clicked, or what was on screen. It only runs in this browser " +
  "tab and only after you agree below. HR and your Line Manager can see how much of your tracked time was " +
  "active; only HR can see your day-by-day detail, and every time they do that is recorded in the audit log. " +
  "This is not used to judge the quality of your work, and never feeds appraisals, pay or disciplinary " +
  "decisions automatically. You can stop it at any time by closing this tab.";

const MIN_HEARTBEAT_INTERVAL_SECONDS = 45;
const MAX_MINUTE_AGE_MS = 24 * 60 * 60 * 1000;
const FUTURE_SKEW_MS = 2 * 60 * 1000;

export type ActivitySettings = {
  enabled: boolean;
  idleThresholdMinutes: number;
  retentionDays: number;
  breakWindows: { start: number; end: number }[];
  allowPause: boolean;
  pauseMaxMinutesPerDay: number;
};

/** "12:30-13:30,13:45-14:00" -> minute-of-day windows; malformed or empty entries are dropped, never thrown. */
export function parseBreakWindows(raw: string): { start: number; end: number }[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(s);
      if (!m) return null;
      const start = hmToMinutes(m[1]!);
      const end = hmToMinutes(m[2]!);
      return start < end ? { start, end } : null;
    })
    .filter((w): w is { start: number; end: number } => w != null);
}

export async function activitySettings(raw?: Record<SettingKey, string>): Promise<ActivitySettings> {
  const s = raw ?? (await getSettings());
  return {
    enabled: s["activity.enabled"] === "1",
    idleThresholdMinutes: settingNumber(s, "activity.idleThresholdMinutes") ?? 5,
    retentionDays: settingNumber(s, "activity.retentionDays") ?? 90,
    breakWindows: parseBreakWindows(s["activity.breakWindows"]),
    allowPause: s["activity.allowPause"] === "1",
    pauseMaxMinutesPerDay: settingNumber(s, "activity.pauseMaxMinutesPerDay") ?? 0,
  };
}

export const isWithinWindow = (minutesOfDay: number, start: number, end: number) => minutesOfDay >= start && minutesOfDay < end;

export const isWithinBreak = (minutesOfDay: number, windows: { start: number; end: number }[]) =>
  windows.some((w) => isWithinWindow(minutesOfDay, w.start, w.end));

export async function isExcluded(employeeId: number) {
  return (await prisma.activityExclusion.findUnique({ where: { employeeId } })) != null;
}

export async function hasAcknowledgedPolicy(employeeId: number) {
  return (
    (await prisma.activityPolicyAcknowledgement.findUnique({
      where: { employeeId_policyVersion: { employeeId, policyVersion: POLICY_VERSION } },
    })) != null
  );
}

/**
 * Weekends, configured holidays, outside office hours, and the employee's own approved leave or travel for
 * the day — any of these mean tracking does not run, same as the enabled/excluded/acknowledged checks.
 * `now` is always an explicit parameter (never read from the system clock directly) so this is deterministic
 * in tests: pass a fixed Date instead of relying on the real calendar date.
 */
export async function isWorkingDay(employeeId: number, now: Date, rawSettings: Record<SettingKey, string>) {
  const date = toDate(nowParts(now).ymd);
  const holidays = await holidayMap(date, date);
  const withinOfficeHours = inOfficeHours(now, rawSettings["office.start"], rawSettings["office.end"], (y) => holidays.has(y));
  if (!withinOfficeHours) return { withinOfficeHours, onApprovedLeaveOrTravel: false, workingDay: false };
  const [leave, trip] = await Promise.all([
    prisma.leaveRequest.findFirst({ where: { request: { employeeId, status: "APPROVED" }, startDate: { lte: date }, endDate: { gte: date } } }),
    prisma.travelRequest.findFirst({ where: { ...approvedTripsWhere(date, date), request: { status: "APPROVED", employeeId } } }),
  ]);
  const onApprovedLeaveOrTravel = !!leave || !!trip;
  return { withinOfficeHours, onApprovedLeaveOrTravel, workingDay: !onApprovedLeaveOrTravel };
}

/** Everything the frontend needs to decide whether to show the badge / prompt and start tracking. */
export async function trackabilityStatus(employeeId: number, now = new Date()) {
  const rawSettings = await getSettings();
  const settings = await activitySettings(rawSettings);
  const [excluded, acknowledged, heartbeatState, working] = await Promise.all([
    isExcluded(employeeId),
    hasAcknowledgedPolicy(employeeId),
    prisma.activityHeartbeatState.findUnique({ where: { employeeId } }),
    isWorkingDay(employeeId, now, rawSettings),
  ]);
  const trackable = settings.enabled && !excluded && acknowledged && working.workingDay;
  const today = await prisma.activityDailySummary.findUnique({ where: { employeeId_date: { employeeId, date: toDate(nowParts(now).ymd) } } });
  return {
    enabled: settings.enabled,
    excluded,
    acknowledged,
    policyVersion: POLICY_VERSION,
    policyText: POLICY_TEXT,
    withinOfficeHours: working.withinOfficeHours,
    onApprovedLeaveOrTravel: working.onApprovedLeaveOrTravel,
    trackable,
    allowPause: settings.allowPause,
    pauseBudgetMinutes: settings.pauseMaxMinutesPerDay,
    pauseUsedMinutesToday: today?.pausedMinutesUsed ?? 0,
    paused: heartbeatState?.pausedSince != null,
  };
}

export async function acknowledgePolicy(employeeId: number) {
  await prisma.activityPolicyAcknowledgement.upsert({
    where: { employeeId_policyVersion: { employeeId, policyVersion: POLICY_VERSION } },
    create: { employeeId, policyVersion: POLICY_VERSION },
    update: {},
  });
}

export type HeartbeatMinute = { minuteStart: string; active: boolean };

/**
 * Accepts a batch of per-minute booleans for the signed-in employee only. Rate-limited per employee
 * (429 + Retry-After, nothing is dropped — the client keeps the batch queued and resends it); minutes that
 * are in the future or more than 24h old are silently ignored (counted in `ignored`); minutes inside a
 * configured break window are excluded from every count but still mark the watermark as processed.
 */
export async function recordHeartbeat(employeeId: number, minutes: HeartbeatMinute[], now = new Date()) {
  const rawSettings = await getSettings();
  const settings = await activitySettings(rawSettings);
  if (!settings.enabled) throw new HttpError(403, "Activity monitoring is off");
  if (await isExcluded(employeeId)) throw new HttpError(403, "Activity monitoring is off for this employee");
  if (!(await hasAcknowledgedPolicy(employeeId))) throw new HttpError(403, "Acknowledge the activity policy first");
  if (!(await isWorkingDay(employeeId, now, rawSettings)).workingDay) {
    throw new HttpError(403, "Not trackable right now (weekend, holiday, outside office hours, or approved leave/travel)");
  }

  const state = await prisma.activityHeartbeatState.upsert({
    where: { employeeId },
    create: { employeeId },
    update: {},
  });
  if (state.lastHeartbeatAt) {
    const elapsedMs = now.getTime() - state.lastHeartbeatAt.getTime();
    if (elapsedMs < MIN_HEARTBEAT_INTERVAL_SECONDS * 1000) {
      const retryAfter = Math.ceil((MIN_HEARTBEAT_INTERVAL_SECONDS * 1000 - elapsedMs) / 1000);
      throw new HttpError(429, "Sending heartbeats too often", retryAfter);
    }
  }

  let lastRawActivityAt = state.lastRawActivityAt;
  let accepted = 0;
  let ignored = 0;
  const sorted = [...minutes].sort((a, b) => a.minuteStart.localeCompare(b.minuteStart));

  for (const m of sorted) {
    const at = new Date(m.minuteStart);
    if (Number.isNaN(at.getTime())) {
      ignored++;
      continue;
    }
    if (at.getTime() > now.getTime() + FUTURE_SKEW_MS) {
      ignored++;
      continue;
    }
    if (now.getTime() - at.getTime() > MAX_MINUTE_AGE_MS) {
      ignored++;
      continue;
    }
    const { ymd: dayYmd, minutes: minutesOfDay } = nowParts(at);
    const date = toDate(dayYmd);
    const day = await prisma.activityDailySummary.upsert({
      where: { employeeId_date: { employeeId, date } },
      create: { employeeId, date },
      update: {},
    });
    if (day.processedThroughAt && at.getTime() <= day.processedThroughAt.getTime()) {
      ignored++;
      continue;
    }
    const inBreak = isWithinBreak(minutesOfDay, settings.breakWindows);
    const data: Record<string, unknown> = { processedThroughAt: at };
    if (!inBreak) {
      data.trackedMinutes = { increment: 1 };
      if (m.active) {
        lastRawActivityAt = lastRawActivityAt && lastRawActivityAt > at ? lastRawActivityAt : at;
        if (!day.firstActivityAt || at < day.firstActivityAt) data.firstActivityAt = at;
        if (!day.lastActivityAt || at > day.lastActivityAt) data.lastActivityAt = at;
      }
      const withinIdleGrace = lastRawActivityAt != null && at.getTime() - lastRawActivityAt.getTime() <= settings.idleThresholdMinutes * 60_000;
      if (m.active || withinIdleGrace) data.activeMinutes = { increment: 1 };
      else data.idleMinutes = { increment: 1 };
    }
    await prisma.activityDailySummary.update({ where: { id: day.id }, data });
    accepted++;
  }

  await prisma.activityHeartbeatState.update({ where: { employeeId }, data: { lastHeartbeatAt: now, lastRawActivityAt } });
  return { accepted, ignored };
}

export async function startPause(employeeId: number, now = new Date()) {
  const settings = await activitySettings();
  if (!settings.allowPause || settings.pauseMaxMinutesPerDay <= 0) throw new HttpError(403, "Pausing is not allowed");
  const date = toDate(nowParts(now).ymd);
  const day = await prisma.activityDailySummary.upsert({ where: { employeeId_date: { employeeId, date } }, create: { employeeId, date }, update: {} });
  if (day.pausedMinutesUsed >= settings.pauseMaxMinutesPerDay) throw new HttpError(400, "Today's pause allowance is used up");
  await prisma.activityHeartbeatState.upsert({ where: { employeeId }, create: { employeeId, pausedSince: now }, update: { pausedSince: now } });
}

export async function endPause(employeeId: number, now = new Date()) {
  const state = await prisma.activityHeartbeatState.findUnique({ where: { employeeId } });
  if (!state?.pausedSince) return;
  const settings = await activitySettings();
  const date = toDate(nowParts(now).ymd);
  const day = await prisma.activityDailySummary.upsert({ where: { employeeId_date: { employeeId, date } }, create: { employeeId, date }, update: {} });
  const remaining = Math.max(0, settings.pauseMaxMinutesPerDay - day.pausedMinutesUsed);
  const elapsedMinutes = Math.min(remaining, Math.round((now.getTime() - state.pausedSince.getTime()) / 60_000));
  await prisma.$transaction([
    prisma.activityDailySummary.update({ where: { id: day.id }, data: { pausedMinutesUsed: { increment: elapsedMinutes } } }),
    prisma.activityHeartbeatState.update({ where: { employeeId }, data: { pausedSince: null } }),
  ]);
}

const pct = (active: number, tracked: number) => (tracked ? Math.round((active / tracked) * 1000) / 10 : null);

export function summaryRow(s: { date: Date; trackedMinutes: number; activeMinutes: number; idleMinutes: number; firstActivityAt: Date | null; lastActivityAt: Date | null }) {
  return {
    date: ymd(s.date),
    trackedMinutes: s.trackedMinutes,
    activeMinutes: s.activeMinutes,
    idleMinutes: s.idleMinutes,
    activePct: pct(s.activeMinutes, s.trackedMinutes),
    firstActivityAt: s.firstActivityAt,
    lastActivityAt: s.lastActivityAt,
  };
}

export { pct as activePct };

/** An employee's own days for a month, today's row, and the month total — used by /activity/me and HR's per-employee drill-down. */
export async function monthlyActivity(employeeId: number, year: number, month: number, now = new Date()) {
  const start = toDate(`${year}-${String(month).padStart(2, "0")}-01`);
  const end = new Date(Date.UTC(year, month, 0));
  const rows = await prisma.activityDailySummary.findMany({ where: { employeeId, date: { gte: start, lte: end } }, orderBy: { date: "asc" } });
  const todayYmd = nowParts(now).ymd;
  const today = rows.find((r) => ymd(r.date) === todayYmd);
  const totals = rows.reduce((acc, r) => ({ tracked: acc.tracked + r.trackedMinutes, active: acc.active + r.activeMinutes, idle: acc.idle + r.idleMinutes }), { tracked: 0, active: 0, idle: 0 });
  return {
    today: today ? summaryRow(today) : { date: todayYmd, trackedMinutes: 0, activeMinutes: 0, idleMinutes: 0, activePct: null, firstActivityAt: null, lastActivityAt: null },
    days: rows.map(summaryRow),
    monthSummary: { trackedMinutes: totals.tracked, activeMinutes: totals.active, idleMinutes: totals.idle, activePct: pct(totals.active, totals.tracked) },
  };
}

/** Line Manager / HOD view: the team's average Active % and who was tracked, never any member's own number. */
export async function teamAggregate(memberIds: number[], year: number, month: number) {
  if (!memberIds.length) return { teamAveragePct: null, trackedCount: 0, totalCount: 0, members: [] as { id: number; fullName: string; code: string; trackedToday: boolean }[] };
  const start = toDate(`${year}-${String(month).padStart(2, "0")}-01`);
  const end = new Date(Date.UTC(year, month, 0));
  const todayYmd = nowParts().ymd;
  const [employees, rows, todayRows] = await Promise.all([
    prisma.employee.findMany({ where: { id: { in: memberIds } }, select: { id: true, fullName: true, code: true } }),
    prisma.activityDailySummary.findMany({ where: { employeeId: { in: memberIds }, date: { gte: start, lte: end } } }),
    prisma.activityDailySummary.findMany({ where: { employeeId: { in: memberIds }, date: toDate(todayYmd) } }),
  ]);
  const byEmployee = new Map<number, { tracked: number; active: number }>();
  for (const r of rows) {
    const cur = byEmployee.get(r.employeeId) ?? { tracked: 0, active: 0 };
    byEmployee.set(r.employeeId, { tracked: cur.tracked + r.trackedMinutes, active: cur.active + r.activeMinutes });
  }
  const pcts = [...byEmployee.values()].map((v) => pct(v.active, v.tracked)).filter((p): p is number => p != null);
  const trackedToday = new Set(todayRows.filter((r) => r.trackedMinutes > 0).map((r) => r.employeeId));
  return {
    teamAveragePct: pcts.length ? Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 10) / 10 : null,
    trackedCount: trackedToday.size,
    totalCount: employees.length,
    members: employees.map((e) => ({ id: e.id, fullName: e.fullName, code: e.code, trackedToday: trackedToday.has(e.id) })),
  };
}

/** HR's department/company report for a month. */
export async function departmentReports(year: number, month: number, departmentId?: number) {
  const start = toDate(`${year}-${String(month).padStart(2, "0")}-01`);
  const end = new Date(Date.UTC(year, month, 0));
  const employees = await prisma.employee.findMany({
    where: { status: "ACTIVE", ...(departmentId ? { departmentId } : {}) },
    select: { id: true, departmentId: true, department: { select: { name: true } } },
  });
  const rows = await prisma.activityDailySummary.findMany({
    where: { employeeId: { in: employees.map((e) => e.id) }, date: { gte: start, lte: end } },
  });
  const byEmployee = new Map<number, { tracked: number; active: number }>();
  for (const r of rows) {
    const cur = byEmployee.get(r.employeeId) ?? { tracked: 0, active: 0 };
    byEmployee.set(r.employeeId, { tracked: cur.tracked + r.trackedMinutes, active: cur.active + r.activeMinutes });
  }
  const byDept = new Map<string, { departmentId: number | null; departmentName: string; employeeCount: number; trackedEmployeeCount: number; pcts: number[] }>();
  for (const e of employees) {
    const key = String(e.departmentId ?? "none");
    const entry = byDept.get(key) ?? { departmentId: e.departmentId, departmentName: e.department?.name ?? "No department", employeeCount: 0, trackedEmployeeCount: 0, pcts: [] };
    entry.employeeCount++;
    const totals = byEmployee.get(e.id);
    if (totals && totals.tracked > 0) {
      entry.trackedEmployeeCount++;
      const p = pct(totals.active, totals.tracked);
      if (p != null) entry.pcts.push(p);
    }
    byDept.set(key, entry);
  }
  const allPcts = [...byDept.values()].flatMap((d) => d.pcts);
  return {
    companyAverageActivePct: allPcts.length ? Math.round((allPcts.reduce((a, b) => a + b, 0) / allPcts.length) * 10) / 10 : null,
    rows: [...byDept.values()].map((d) => ({
      departmentId: d.departmentId, departmentName: d.departmentName, employeeCount: d.employeeCount, trackedEmployeeCount: d.trackedEmployeeCount,
      averageActivePct: d.pcts.length ? Math.round((d.pcts.reduce((a, b) => a + b, 0) / d.pcts.length) * 10) / 10 : null,
    })),
  };
}

/** Daily cleanup: deletes daily summaries older than the retention setting. */
export async function cleanupOldActivity(now = new Date()) {
  const settings = await activitySettings();
  const cutoff = new Date(toDate(nowParts(now).ymd).getTime() - settings.retentionDays * 86_400_000);
  const { count } = await prisma.activityDailySummary.deleteMany({ where: { date: { lt: cutoff } } });
  return count;
}
