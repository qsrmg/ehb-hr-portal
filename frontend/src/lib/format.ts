export function fmtDate(value: string | Date | null | undefined) {
  if (!value) return "-";
  const d = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : new Date(value);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: typeof value === "string" && value.length === 10 ? "UTC" : undefined });
}

export function fmtDateTime(value: string | Date | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export const fmtMoney = (n: number | null | undefined) =>
  n == null ? "-" : n.toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export const todayYmd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Human labels and badge colours for every status shown in the portal. */
export const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  ON_TIME: { label: "On Time", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  LATE: { label: "Late", className: "bg-amber-50 text-amber-800 ring-amber-200" },
  HALF_DAY: { label: "Half Day", className: "bg-orange-50 text-orange-700 ring-orange-200" },
  ABSENT: { label: "Absent", className: "bg-red-50 text-red-700 ring-red-200" },
  LEAVE: { label: "Leave", className: "bg-sky-50 text-sky-700 ring-sky-200" },
  WEEKEND: { label: "Weekend", className: "bg-slate-50 text-slate-500 ring-slate-200" },
  HOLIDAY: { label: "Holiday", className: "bg-violet-50 text-violet-700 ring-violet-200" },
  NO_DATA: { label: "No data", className: "bg-slate-50 text-slate-400 ring-slate-200" },
  UPCOMING: { label: "-", className: "bg-white text-slate-300 ring-slate-100" },
  PENDING: { label: "Pending", className: "bg-amber-50 text-amber-800 ring-amber-200" },
  APPROVED: { label: "Approved", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  REJECTED: { label: "Rejected", className: "bg-red-50 text-red-700 ring-red-200" },
  RETURNED: { label: "Returned", className: "bg-orange-50 text-orange-700 ring-orange-200" },
  CANCELLED: { label: "Cancelled", className: "bg-slate-100 text-slate-500 ring-slate-200" },
  WAITING: { label: "Waiting", className: "bg-slate-50 text-slate-500 ring-slate-200" },
  SKIPPED: { label: "Skipped", className: "bg-slate-50 text-slate-400 ring-slate-200" },
  ACTIVE: { label: "Active", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  INACTIVE: { label: "Inactive", className: "bg-slate-100 text-slate-500 ring-slate-200" },
};
