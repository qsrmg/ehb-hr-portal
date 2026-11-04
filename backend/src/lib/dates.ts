import { env } from "../config/env.js";

// All calendar dates travel as "YYYY-MM-DD" strings and are stored as UTC-midnight DATE values.

export const toDate = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
export const ymd = (d: Date) => d.toISOString().slice(0, 10);

export const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(toDate(s).getTime());

export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

export const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;

/** Parts of "now" in the company timezone. */
export function nowParts(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: env.APP_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return {
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    weekday: parts.weekday as string,
  };
}

export const todayYmd = () => nowParts().ymd;

export function monthRange(year: number, month: number) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return { start, end };
}

export function eachDay(start: Date, end: Date) {
  const days: Date[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  return days;
}

/** "09:25" -> 565 */
export function hmToMinutes(hm: string) {
  const [h, m] = hm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export const minutesToHm = (m: number | null | undefined) =>
  m == null ? null : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Parses "2026-10" style month params, defaulting to the current month. */
export function parseMonth(value: unknown) {
  const m = typeof value === "string" ? /^(\d{4})-(\d{2})$/.exec(value) : null;
  if (m) return { year: Number(m[1]), month: Number(m[2]) };
  const [y, mo] = todayYmd().split("-");
  return { year: Number(y), month: Number(mo) };
}
