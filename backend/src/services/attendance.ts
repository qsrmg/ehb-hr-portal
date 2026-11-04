import { prisma } from "../lib/prisma.js";
import { getSettings } from "../lib/settings.js";
import { employeeIdsWithRole, notify } from "../lib/notify.js";
import { audit } from "../lib/audit.js";
import {
  addDays, eachDay, hmToMinutes, isWeekend, minutesToHm, monthRange, MONTHS, toDate, todayYmd, ymd,
} from "../lib/dates.js";
import { hasAny, pick, pickString, parseSheetDate, parseSheetTime, type SheetRow } from "../lib/sheet.js";
import { HttpError } from "../middleware/error.js";
import type { AttendanceStatus } from "../generated/prisma/client.js";

export type AttendanceRules = { lateAfter: number; presentMinutes: number; halfDayMinutes: number };

export async function getAttendanceRules(): Promise<AttendanceRules> {
  const s = await getSettings();
  return {
    lateAfter: hmToMinutes(s["attendance.lateAfter"]),
    presentMinutes: Number(s["attendance.presentHours"]) * 60,
    halfDayMinutes: Number(s["attendance.halfDayHours"]) * 60,
  };
}

/**
 * Day status from the rules: arrival after the cutoff is Late; 6+ hours Present (On Time / Late);
 * 4 to under 6 hours Half Day; under 4 hours or a missing punch is Absent.
 */
export function computeStatus(checkIn: number | null, checkOut: number | null, rules: AttendanceRules): AttendanceStatus {
  if (checkIn == null || checkOut == null || checkOut <= checkIn) return "ABSENT";
  const worked = checkOut - checkIn;
  if (worked >= rules.presentMinutes) return checkIn > rules.lateAfter ? "LATE" : "ON_TIME";
  if (worked >= rules.halfDayMinutes) return "HALF_DAY";
  return "ABSENT";
}

export async function holidayMap(from: Date, to: Date) {
  const rows = await prisma.holiday.findMany({ where: { date: { gte: from, lte: to } } });
  return new Map(rows.map((h) => [ymd(h.date), h.name]));
}

/** Latest date covered by any biometric import; days after it have "no data yet" rather than Absent. */
export async function lastImportedDate() {
  const row = await prisma.attendanceRecord.aggregate({ _max: { date: true } });
  return row._max.date ? ymd(row._max.date) : null;
}

export type DayStatus = AttendanceStatus | "LEAVE" | "TRAVEL" | "WEEKEND" | "HOLIDAY" | "NO_DATA" | "UPCOMING";

/** Approved, not cancelled trips: those days are "On duty / Travel". */
export const approvedTripsWhere = (from: Date, to: Date) => ({
  cancelledAt: null,
  departDate: { lte: to },
  returnDate: { gte: from },
  request: { status: "APPROVED" as const },
});

/** Day-by-day attendance for one employee and month, combining biometric records, approved leave and holidays. */
export async function monthlyAttendance(employeeId: number, year: number, month: number) {
  const { start, end } = monthRange(year, month);
  const [records, leaves, holidays, lastImported, employee, trips] = await Promise.all([
    prisma.attendanceRecord.findMany({ where: { employeeId, date: { gte: start, lte: end } } }),
    prisma.leaveRequest.findMany({
      where: { request: { employeeId, status: "APPROVED" }, startDate: { lte: end }, endDate: { gte: start } },
      include: { leaveType: true },
    }),
    holidayMap(start, end),
    lastImportedDate(),
    prisma.employee.findUnique({ where: { id: employeeId }, select: { joiningDate: true } }),
    prisma.travelRequest.findMany({ where: { ...approvedTripsWhere(start, end), request: { status: "APPROVED", employeeId } }, select: { departDate: true, returnDate: true, destination: true } }),
  ]);
  const byDate = new Map(records.map((r) => [ymd(r.date), r]));
  const today = todayYmd();
  const joined = employee ? ymd(employee.joiningDate) : null;

  const summary = { onTime: 0, late: 0, halfDay: 0, absent: 0, leave: 0, travel: 0, workingDays: 0 };
  const days = eachDay(start, end).map((d) => {
    const date = ymd(d);
    const record = byDate.get(date);
    const leave = leaves.find((l) => l.startDate <= d && l.endDate >= d);
    const trip = trips.find((t) => t.departDate <= d && t.returnDate >= d);
    const holiday = holidays.get(date);
    let status: DayStatus;
    let note: string | null = null;

    if (isWeekend(d)) status = "WEEKEND";
    else if (holiday) { status = "HOLIDAY"; note = holiday; }
    else if (joined && date < joined) status = "NO_DATA";
    else if (date > today) status = leave ? "LEAVE" : trip ? "TRAVEL" : "UPCOMING";
    else {
      const effective = record ? record.correctedStatus ?? record.status : null;
      if (leave && (!effective || effective === "ABSENT")) { status = "LEAVE"; note = leave.leaveType.name; }
      // On a trip the biometric record is usually missing: the day counts as on duty.
      else if (trip && (!effective || effective === "ABSENT" || effective === "HALF_DAY")) { status = "TRAVEL"; note = `Travel: ${trip.destination}`; }
      else if (effective) status = effective;
      else if (lastImported && date <= lastImported) status = "ABSENT";
      else status = "NO_DATA";
    }
    if (status === "LEAVE" && !note) note = leave?.leaveType.name ?? null;
    if (status === "TRAVEL" && !note) note = trip ? `Travel: ${trip.destination}` : null;

    if (!["WEEKEND", "HOLIDAY", "NO_DATA", "UPCOMING"].includes(status)) summary.workingDays++;
    if (status === "ON_TIME") summary.onTime++;
    if (status === "LATE") summary.late++;
    if (status === "HALF_DAY") summary.halfDay++;
    if (status === "ABSENT") summary.absent++;
    if (status === "LEAVE") summary.leave++;
    if (status === "TRAVEL") summary.travel++;

    return {
      date,
      status,
      note,
      checkIn: minutesToHm(record?.checkIn),
      checkOut: minutesToHm(record?.checkOut),
      corrected: record?.correctedStatus
        ? {
            status: record.correctedStatus,
            checkIn: minutesToHm(record.correctedCheckIn),
            checkOut: minutesToHm(record.correctedCheckOut),
            requestId: record.correctionRequestId,
          }
        : null,
      originalStatus: record?.status ?? null,
    };
  });

  return { year, month, monthName: MONTHS[month - 1], lastImported, summary, days };
}

const ID_ALIASES = ["machineid", "userid", "enrollid", "enrollno", "acno", "empid", "employeeid", "employeecode", "empcode", "code", "id", "no"];
const DATE_ALIASES = ["date", "attendancedate", "day"];
const IN_ALIASES = ["checkin", "intime", "timein", "in", "clockin", "firstin"];
const OUT_ALIASES = ["checkout", "outtime", "timeout", "out", "clockout", "lastout"];
const PUNCH_ALIASES = ["datetime", "punchtime", "checktime", "timestamp", "punch", "time", "logtime"];

/**
 * Turns either a daily sheet (ID, Date, Check In, Check Out) or a raw punch log (ID, Date/Time per punch)
 * into one entry per machine ID and day: first punch = check-in, last punch = check-out.
 */
export function parseAttendanceRows(rows: SheetRow[]) {
  if (!hasAny(rows, ID_ALIASES)) throw new HttpError(400, `No employee/machine ID column found. Expected one of: ${ID_ALIASES.join(", ")}`);
  const daily = hasAny(rows, IN_ALIASES);
  if (!daily && !hasAny(rows, PUNCH_ALIASES)) {
    throw new HttpError(400, "Could not find Check In / Check Out columns or a punch Date/Time column");
  }
  const days = new Map<string, { id: string; date: string; checkIn: number | null; checkOut: number | null }>();
  const punches = new Map<string, { id: string; date: string; times: number[] }>();
  let skipped = 0;
  for (const row of rows) {
    const id = pickString(row, ID_ALIASES);
    if (!id) { skipped++; continue; }
    if (daily) {
      const date = parseSheetDate(pick(row, DATE_ALIASES));
      if (!date) { skipped++; continue; }
      days.set(`${id}|${date}`, {
        id, date,
        checkIn: parseSheetTime(pick(row, IN_ALIASES)),
        checkOut: parseSheetTime(pick(row, OUT_ALIASES)),
      });
    } else {
      const punchRaw = pick(row, PUNCH_ALIASES);
      const date = parseSheetDate(pick(row, DATE_ALIASES) ?? punchRaw);
      const time = parseSheetTime(punchRaw);
      if (!date || time == null) { skipped++; continue; }
      const key = `${id}|${date}`;
      const entry = punches.get(key) ?? { id, date, times: [] };
      entry.times.push(time);
      punches.set(key, entry);
    }
  }
  for (const [key, { id, date, times }] of punches) {
    times.sort((a, b) => a - b);
    // A single punch is a missed punch: check-in only.
    days.set(key, { id, date, checkIn: times[0]!, checkOut: times.length > 1 ? times[times.length - 1]! : null });
  }
  return { entries: [...days.values()], skipped };
}

export async function importAttendance(rows: SheetRow[], fileName: string, importedById: number) {
  const { entries, skipped } = parseAttendanceRows(rows);
  if (!entries.length) throw new HttpError(400, "No usable attendance rows found in the file");

  const rules = await getAttendanceRules();
  const employees = await prisma.employee.findMany({ select: { id: true, code: true, machineId: true } });
  const byKey = new Map<string, number>();
  for (const e of employees) {
    byKey.set(e.code.toLowerCase(), e.id);
    if (e.machineId) byKey.set(e.machineId.toLowerCase(), e.id);
  }

  const dates = entries.map((e) => e.date).sort();
  const from = toDate(dates[0]!);
  const to = toDate(dates[dates.length - 1]!);
  const holidays = await holidayMap(from, to);

  const unmatched = new Set<string>();
  let weekendOrHoliday = 0;
  const toSave: { employeeId: number; date: string; checkIn: number | null; checkOut: number | null }[] = [];
  for (const e of entries) {
    const employeeId = byKey.get(e.id.toLowerCase());
    if (!employeeId) { unmatched.add(e.id); continue; }
    const d = toDate(e.date);
    if (isWeekend(d) || holidays.has(e.date)) { weekendOrHoliday++; continue; }
    toSave.push({ employeeId, date: e.date, checkIn: e.checkIn, checkOut: e.checkOut });
  }

  const batch = await prisma.attendanceImport.create({
    data: {
      fileName, importedById, rowsRead: rows.length, rowsImported: toSave.length,
      unmatchedIds: [...unmatched], fromDate: from, toDate: to,
    },
  });

  // Re-importing the same day refreshes the machine values; HR corrections live in separate fields and are kept.
  await prisma.$transaction(
    toSave.map((r) => {
      const status = computeStatus(r.checkIn, r.checkOut, rules);
      return prisma.attendanceRecord.upsert({
        where: { employeeId_date: { employeeId: r.employeeId, date: toDate(r.date) } },
        create: { employeeId: r.employeeId, date: toDate(r.date), checkIn: r.checkIn, checkOut: r.checkOut, status, importId: batch.id },
        update: { checkIn: r.checkIn, checkOut: r.checkOut, status, importId: batch.id },
      });
    }),
  );

  const warnings = await checkLateWarnings([...new Set(toSave.map((r) => r.employeeId))], from, to);
  await audit(importedById, "IMPORT", "Attendance", batch.id, { fileName, rows: toSave.length, unmatched: [...unmatched] });

  return {
    importId: batch.id,
    rowsRead: rows.length,
    daysImported: toSave.length,
    skippedRows: skipped,
    weekendOrHolidaySkipped: weekendOrHoliday,
    unmatchedIds: [...unmatched],
    from: ymd(from),
    to: ymd(to),
    lateWarningsRaised: warnings,
  };
}

/** Three (setting) unapproved late arrivals in a month raise a warning to HR. No automatic deduction. */
export async function checkLateWarnings(employeeIds: number[], from: Date, to: Date) {
  const threshold = Number((await getSettings())["attendance.lateWarningCount"]);
  let raised = 0;
  const months = new Set<string>();
  for (let d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1)); d <= to; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    months.add(`${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`);
  }
  const hrIds = await employeeIdsWithRole("HR");
  for (const key of months) {
    const [year, month] = key.split("-").map(Number) as [number, number];
    const { start, end } = monthRange(year, month);
    for (const employeeId of employeeIds) {
      const records = await prisma.attendanceRecord.findMany({
        where: { employeeId, date: { gte: start, lte: end } },
        select: { status: true, correctedStatus: true },
      });
      const lateCount = records.filter((r) => (r.correctedStatus ?? r.status) === "LATE").length;
      if (lateCount < threshold) continue;
      const existing = await prisma.lateWarning.findUnique({ where: { employeeId_year_month: { employeeId, year, month } } });
      if (existing) {
        if (existing.lateCount !== lateCount) await prisma.lateWarning.update({ where: { id: existing.id }, data: { lateCount } });
        continue;
      }
      await prisma.lateWarning.create({ data: { employeeId, year, month, lateCount } });
      const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { fullName: true, code: true } });
      await notify(
        hrIds,
        `Late arrival warning: ${emp?.fullName}`,
        `${emp?.fullName} (${emp?.code}) has ${lateCount} late arrivals in ${MONTHS[month - 1]} ${year}.`,
        "/admin/late-warnings",
      );
      raised++;
    }
  }
  return raised;
}

/** Number of working days between two dates, skipping weekends and public holidays. */
export async function countWorkingDays(start: Date, end: Date) {
  const holidays = await holidayMap(start, end);
  return eachDay(start, end).filter((d) => !isWeekend(d) && !holidays.has(ymd(d))).length;
}

export { addDays };
