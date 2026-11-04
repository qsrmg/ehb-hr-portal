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
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

export async function getSettings() {
  const rows = await prisma.setting.findMany();
  const values = Object.fromEntries(
    Object.entries(SETTING_DEFAULTS).map(([k, v]) => [k, v.value]),
  ) as Record<SettingKey, string>;
  for (const row of rows) if (row.key in values) values[row.key as SettingKey] = row.value;
  return values;
}
