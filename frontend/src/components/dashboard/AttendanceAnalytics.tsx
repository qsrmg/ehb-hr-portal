"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, Spinner } from "@/components/ui";
import { MonthPicker } from "@/components/AttendanceMonth";
import { fmtDate } from "@/lib/format";

export type AttendanceDay = { date: string; status: string; checkIn: string | null };
export type AttendanceSummary = { onTime: number; late: number; halfDay: number; absent: number };

const STATUS: { key: keyof AttendanceSummary; label: string; color: string }[] = [
  { key: "onTime", label: "On Time", color: "#10b981" },
  { key: "late", label: "Late", color: "#f59e0b" },
  { key: "halfDay", label: "Half Day", color: "#fb923c" },
  { key: "absent", label: "Absent", color: "#ef4444" },
];

const NOT_A_WORKING_RECORD = new Set(["WEEKEND", "HOLIDAY", "NO_DATA", "UPCOMING"]);
const hmToMinutes = (hm: string) => { const [h, m] = hm.split(":").map(Number) as [number, number]; return h * 60 + m; };
const fmtHm = (min: number) => { const h = Math.floor(min / 60); const m = Math.round(min % 60); const h12 = h % 12 || 12; return `${h12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };

/** A bar growing from 0 to its share of the tallest bar, once, when the month's data is ready. */
function Bar({ value, max, color, label }: { value: number; max: number; color: string; label: string }) {
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(id);
  }, [value]);
  const pct = grown && max ? (value / max) * 100 : 0;
  return (
    <div className="flex flex-1 flex-col items-center gap-2">
      <div className="text-sm font-bold tabular-nums text-charcoal">{value}</div>
      <div className="flex h-32 w-full items-end overflow-hidden rounded-lg bg-track">
        <div
          className="w-full rounded-t-lg motion-safe:transition-[height] motion-safe:duration-700 motion-safe:ease-out"
          style={{ height: `${pct}%`, minHeight: value ? 4 : 0, background: color }}
          title={`${label}: ${value} day${value === 1 ? "" : "s"}`}
        />
      </div>
      <div className="text-xs font-medium text-slate-500">{label}</div>
    </div>
  );
}

/**
 * Attendance analytics for the selected month: a bar chart of the four recorded statuses, and a check-in
 * time trend line from the same month's real day-by-day records (both from /attendance/me, the same
 * endpoint the Attendance page uses — no new backend data).
 */
export function AttendanceAnalytics({
  month, onMonthChange, summary, days, lateAfter, loading,
}: {
  month: string;
  onMonthChange: (m: string) => void;
  summary: AttendanceSummary;
  days: AttendanceDay[];
  lateAfter: string;
  loading: boolean;
}) {
  const max = Math.max(1, ...STATUS.map((s) => summary[s.key]));
  const linePoints = useMemo(
    () => days.filter((d) => d.checkIn && !NOT_A_WORKING_RECORD.has(d.status)).map((d) => ({ date: d.date, minutes: hmToMinutes(d.checkIn!) })),
    [days],
  );

  const w = 560;
  const h = 170;
  const pad = 28;
  const lateCutoff = hmToMinutes(lateAfter);
  const allMinutes = [...linePoints.map((p) => p.minutes), lateCutoff, 8 * 60, 11 * 60];
  const minY = Math.min(...allMinutes) - 15;
  const maxY = Math.max(...allMinutes) + 15;
  const xFor = (i: number) => pad + (linePoints.length > 1 ? (i / (linePoints.length - 1)) * (w - 2 * pad) : (w - 2 * pad) / 2);
  const yFor = (min: number) => h - pad - ((min - minY) / (maxY - minY)) * (h - 2 * pad);
  const path = linePoints.map((p, i) => `${i === 0 ? "M" : "L"}${xFor(i).toFixed(1)},${yFor(p.minutes).toFixed(1)}`).join(" ");
  const lateY = yFor(lateCutoff);

  return (
    <Card title="Attendance analytics" actions={<MonthPicker month={month} onChange={onMonthChange} />}>
      {loading ? (
        <Spinner />
      ) : (
        <div key={month} className="anim-fade-in-fast grid gap-8 lg:grid-cols-2">
          <div>
            <div className="mb-3 text-sm font-semibold text-slate-600">This month, by status</div>
            <div className="flex items-end gap-3">
              {STATUS.map((s) => (
                <Bar key={s.key} value={summary[s.key]} max={max} color={s.color} label={s.label} />
              ))}
            </div>
          </div>
          <div>
            <div className="mb-3 text-sm font-semibold text-slate-600">Check-in time trend</div>
            {linePoints.length < 2 ? (
              <p className="flex h-32 items-center text-sm text-slate-500">Not enough recorded check-ins yet this month.</p>
            ) : (
              <svg viewBox={`0 0 ${w} ${h}`} className="h-36 w-full" preserveAspectRatio="none" role="img" aria-label="Check-in time across the month, with the late cut-off marked">
                <line x1={pad} y1={lateY} x2={w - pad} y2={lateY} stroke="#f59e0b" strokeDasharray="4 4" strokeWidth={1} />
                <text x={w - pad} y={lateY - 6} textAnchor="end" fontSize={10} className="fill-amber-700">Late after {fmtHm(lateCutoff)}</text>
                <path d={path} fill="none" stroke="#2563eb" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
                {linePoints.map((p, i) => (
                  <circle key={p.date} cx={xFor(i)} cy={yFor(p.minutes)} r={4} fill={p.minutes > lateCutoff ? "#f59e0b" : "#10b981"} stroke="#fff" strokeWidth={1.5}>
                    <title>{`${fmtDate(p.date)}: check-in ${fmtHm(p.minutes)}`}</title>
                  </circle>
                ))}
              </svg>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
