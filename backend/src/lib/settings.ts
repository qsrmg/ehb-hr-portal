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
} as const satisfies Record<string, { value: string; label: string; optional?: boolean }>;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

export const isOptionalSetting = (key: SettingKey) => "optional" in SETTING_DEFAULTS[key];

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
