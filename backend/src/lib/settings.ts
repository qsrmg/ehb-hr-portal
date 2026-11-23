import { prisma } from "./prisma.js";

/** Report types a police report can be required for ("not working" is handled by repair, never police). */
const INCIDENT_LIST_VALUES = ["DAMAGED", "LOST"] as const;
const TASK_PRIORITY_LIST_VALUES = ["LOW", "MEDIUM", "HIGH"] as const;

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
  "expense.maxPerClaim": { value: "", label: "Maximum total per expense claim (PKR)", optional: true },
  "expense.maxPerMonth": { value: "", label: "Maximum claimed per employee per month (PKR)", optional: true },
  "expense.managementApprovalAbove": { value: "", label: "Claims above this total also need Management/CEO approval (PKR)", optional: true },
  "expense.receiptOptionalBelow": { value: "500", label: "Lines below this amount may have a written explanation instead of a receipt (PKR)" },
  "expense.maxAgeDays": { value: "30", label: "Expenses older than this many days cannot be claimed" },
  // Travel: HR or Finance can change these. Empty means "off" / "no limit".
  "travel.managementApprovalAbove": { value: "", label: "Trips with an estimated cost above this also need Management/CEO approval (PKR)", optional: true },
  "travel.maxAdvance": { value: "", label: "Maximum travel advance per trip (PKR)", optional: true },
  "travel.perDiemRate": { value: "", label: "Daily allowance per trip day (PKR)", optional: true, hint: "Empty: meals are claimed with receipts instead" },
  "travel.mileageRatePerKm": { value: "", label: "Own-car mileage rate per km (PKR)", optional: true, hint: "Empty: mileage cannot be claimed" },
  "travel.hotelLimitPerNight": { value: "", label: "Hotel limit per night (PKR)", optional: true },
  "travel.settlementDays": { value: "15", label: "Days after return within which the trip settlement must be submitted" },
  // Resignation & exit clearance
  "exit.noticeDays": { value: "30", label: "Resignation notice period for confirmed employees (days)" },
  "exit.probationNoticeDays": { value: "7", label: "Resignation notice period during probation (days)" },
  "exit.leaveEncashment": { value: "1", label: "Pay out unused Annual Leave in the final settlement", boolean: true },
  "exit.sendEmails": { value: "1", label: "Also email exit clearance notifications, not just the in-app notification", boolean: true },
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
  // Training request (Phase 3): HR or Finance can change this. Empty means "off".
  "training.managementApprovalAbove": { value: "", label: "Training programmes above this estimated cost also need Management/CEO approval (PKR)", optional: true },
  // Employee Assets Management Policy / Cyber Security Incident Response Policy: left open by the policy,
  // so these are HR-editable settings, empty (off) by default. See DECISIONS.md.
  "assets.recoveryApprovalThreshold": { value: "", label: "Asset recoveries above this amount also need Management approval (PKR)", optional: true },
  "assets.cyberSecurityNotifyRole": { value: "", label: "Role also notified when a data-bearing asset is reported lost, stolen or damaged (one of: EMPLOYEE, LINE_MANAGER, HOD, HR, FINANCE, ADMIN, MANAGEMENT; empty = off)", optional: true, role: true },
  "assets.auditReminderMonths": { value: "", label: "Remind Admin to start an asset verification round every this many months", optional: true, hint: "Empty: no reminder" },
  "assets.policeReportRequiredTypes": { value: "", label: "Report types that should have a police report attached, comma-separated (DAMAGED, LOST; empty = HR or Admin decide case by case)", optional: true, list: INCIDENT_LIST_VALUES },
  "assets.recoveryMethod": { value: "", label: "How asset recovery amounts are worked out, shown for reference on the recovery form (empty = Finance enters the amount by hand; the portal has no depreciation formula)", optional: true, text: true },
  // Activity monitoring (keyboard/mouse presence time, never content): off by default. See DECISIONS.md.
  "activity.enabled": { value: "0", label: "Turn on activity monitoring (tracked time and Active %) for the portal", boolean: true },
  "activity.idleThresholdMinutes": { value: "5", label: "Minutes with no input before a minute counts as idle" },
  "activity.retentionDays": { value: "90", label: "Days an employee's daily activity totals are kept before they are deleted" },
  "activity.breakWindows": { value: "", label: "Daily break windows excluded from tracking, comma-separated HH:MM-HH:MM (e.g. lunch, prayer)", optional: true },
  "activity.allowPause": { value: "0", label: "Let employees pause their own activity tracking", boolean: true },
  "activity.pauseMaxMinutesPerDay": { value: "0", label: "Maximum minutes an employee may pause tracking per day (0 = pausing not allowed even if switched on above)" },
  // Tasks module.
  "tasks.defaultPriority": { value: "MEDIUM", label: "Default priority for a new task", list: TASK_PRIORITY_LIST_VALUES },
  "tasks.employeesCanCreateOwnTasks": { value: "1", label: "Let employees create tasks for themselves", boolean: true },
  "tasks.sendEmails": { value: "1", label: "Also email task notifications (assigned, status changed, overdue digest), not just the in-app notification", boolean: true },
} as const satisfies Record<string, { value: string; label: string; optional?: boolean; text?: boolean; boolean?: boolean; role?: boolean; list?: readonly string[]; hint?: string }>;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

export const isOptionalSetting = (key: SettingKey) => "optional" in SETTING_DEFAULTS[key];
/** Extra helper text shown only when emptying the field means something more specific than "no limit" / "off". */
export const settingHint = (key: SettingKey) => (SETTING_DEFAULTS[key] as { hint?: string }).hint ?? null;
/** Settings whose value is a name rather than a number or a time. */
export const isTextSetting = (key: SettingKey) => "text" in SETTING_DEFAULTS[key];
/** Settings that are an on/off switch, stored as "1" or "0" rather than shown as a number. */
export const isBooleanSetting = (key: SettingKey) => "boolean" in SETTING_DEFAULTS[key];
/** Settings whose value must be one of the Role enum names, or empty. */
export const isRoleSetting = (key: SettingKey) => "role" in SETTING_DEFAULTS[key];
/** Settings whose value is a comma-separated list drawn from a fixed set of codes, or empty. */
export const listSettingValues = (key: SettingKey) => (SETTING_DEFAULTS[key] as { list?: readonly string[] }).list;

export const ROLE_VALUES = ["EMPLOYEE", "LINE_MANAGER", "HOD", "HR", "FINANCE", "ADMIN", "MANAGEMENT"] as const;

/** Settings Finance may change as well as HR. */
export const FINANCE_SETTING_PREFIXES = ["expense.", "travel.", "training."];

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
