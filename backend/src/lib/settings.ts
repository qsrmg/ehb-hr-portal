import { prisma } from "./prisma.js";

// Every quota, limit and day count is a setting HR can change without new development.
export const SETTING_DEFAULTS = {
  "attendance.lateAfter": { value: "09:25", label: "Arrival after this time is Late (HH:MM)" },
  "attendance.presentHours": { value: "6", label: "Minimum hours worked for Present" },
  "attendance.halfDayHours": { value: "4", label: "Minimum hours worked for Half Day" },
  "attendance.lateWarningCount": { value: "3", label: "Late arrivals in a month that raise a warning to HR" },
  "attendanceUpdate.maxPerMonth": { value: "3", label: "Attendance Update requests allowed per month" },
  "attendanceUpdate.windowDays": { value: "7", label: "Days after the date an Attendance Update can be requested" },
  "reminders.intervalHours": { value: "3", label: "Hours between reminder emails to the current approver" },
  "office.start": { value: "09:00", label: "Office hours start (reminders are sent only in office hours)" },
  "office.end": { value: "18:00", label: "Office hours end" },
  "payroll.availableByDay": { value: "5", label: "Day of the month pay slips are due" },
  // Expense claims: HR or Finance can change these. Empty means "no limit" / "off".
  "expense.maxPerClaim": { value: "", label: "Maximum total per expense claim (PKR, empty = no limit)", optional: true },
  "expense.maxPerMonth": { value: "", label: "Maximum claimed per employee per month (PKR, empty = no limit)", optional: true },
  "expense.managementApprovalAbove": { value: "", label: "Claims above this total also need Management/CEO approval (PKR, empty = off)", optional: true },
  "expense.receiptOptionalBelow": { value: "500", label: "Lines below this amount may have a written explanation instead of a receipt (PKR)" },
  "expense.maxAgeDays": { value: "30", label: "Expenses older than this many days cannot be claimed" },
  // Travel: HR or Finance can change these. Empty means "off" / "no limit".
  "travel.managementApprovalAbove": { value: "", label: "Trips with an estimated cost above this also need Management/CEO approval (PKR, empty = off)", optional: true },
  "travel.maxAdvance": { value: "", label: "Maximum travel advance per trip (PKR, empty = no limit)", optional: true },
  "travel.perDiemRate": { value: "", label: "Daily allowance per trip day (PKR, empty = meals are claimed with receipts)", optional: true },
  "travel.mileageRatePerKm": { value: "", label: "Own-car mileage rate per km (PKR, empty = mileage cannot be claimed)", optional: true },
  "travel.hotelLimitPerNight": { value: "", label: "Hotel limit per night (PKR, empty = no limit)", optional: true },
  "travel.settlementDays": { value: "15", label: "Days after return within which the trip settlement must be submitted" },
  // Resignation & exit clearance
  "exit.noticeDays": { value: "30", label: "Resignation notice period for confirmed employees (days)" },
  "exit.probationNoticeDays": { value: "7", label: "Resignation notice period during probation (days)" },
  "exit.leaveEncashment": { value: "1", label: "Pay out unused Annual Leave in the final settlement", boolean: true },
  // Performance (BSC)
  "performance.rating1": { value: "Unsatisfactory", label: "Performance rating 1 (name)", text: true },
  "performance.rating2": { value: "Needs Improvement", label: "Performance rating 2 (name)", text: true },
  "performance.rating3": { value: "Meets Expectations", label: "Performance rating 3 (name)", text: true },
  "performance.rating4": { value: "Exceeds Expectations", label: "Performance rating 4 (name)", text: true },
  "performance.rating5": { value: "Outstanding", label: "Performance rating 5 (name)", text: true },
  "performance.band5From": { value: "4.5", label: "Overall score from which the result is rating 5" },
  "performance.band4From": { value: "3.5", label: "Overall score from which the result is rating 4" },
  "performance.band3From": { value: "2.5", label: "Overall score from which the result is rating 3" },
  "performance.band2From": { value: "1.5", label: "Overall score from which the result is rating 2 (below: rating 1)" },
  "performance.minPerspectiveWeight": { value: "0", label: "Minimum weight per BSC perspective on a scorecard (%)" },
  // Manpower Requisition and internal jobs
  "hiring.internalOnlyDays": { value: "7", label: "Days a job is open to internal applicants only before external candidates (when posted to both)" },
  "hiring.minMonthsInRole": { value: "12", label: "Months in the current role before an employee can apply for an internal job" },
  "hiring.minPerformanceRating": { value: "0", label: "Minimum last performance rating to apply for an internal job (1-5, 0 = off)" },
  "performance.joinerMonths": { value: "3", label: "Employees who join in the first months of a cycle are included (months)" },
} as const satisfies Record<string, { value: string; label: string; optional?: boolean; text?: boolean; boolean?: boolean }>;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

export const isOptionalSetting = (key: SettingKey) => "optional" in SETTING_DEFAULTS[key];
/** Settings whose value is a name rather than a number or a time. */
export const isTextSetting = (key: SettingKey) => "text" in SETTING_DEFAULTS[key];
/** Settings that are an on/off switch, stored as "1" or "0" rather than shown as a number. */
export const isBooleanSetting = (key: SettingKey) => "boolean" in SETTING_DEFAULTS[key];

/** Settings Finance may change as well as HR. */
export const FINANCE_SETTING_PREFIXES = ["expense.", "travel."];

/** A numeric setting, or null when it is empty (= no limit / off). */
export function settingNumber(values: Record<SettingKey, string>, key: SettingKey) {
  const v = values[key].trim();
  return v === "" ? null : Number(v);
}

export async function getSettings() {
  const rows = await prisma.setting.findMany();
  const values = Object.fromEntries(
    Object.entries(SETTING_DEFAULTS).map(([k, v]) => [k, v.value]),
  ) as Record<SettingKey, string>;
  for (const row of rows) if (row.key in values) values[row.key as SettingKey] = row.value;
  return values;
}
