"use client";

import { useMemo } from "react";
import { Spinner } from "@/components/ui";
import { GlassCard } from "./GlassCard";
import { MonthPicker } from "@/components/AttendanceMonth";
import { StatusDoughnut } from "./StatusDoughnut";
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

/**
 * Attendance analytics for the selected month: a donut of the four recorded statuses with a legend, and a
 * check-in time trend line from the same month's real day-by-day records (both from /attendance/me, the
 * same endpoint the Attendance page uses — no new backend data).
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
  const total = STATUS.reduce((s, x) => s + summary[x.key], 0);
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
    <GlassCard title="Attendance analytics" actions={<MonthPicker month={month} onChange={onMonthChange} />}>
      {loading ? (
        <Spinner />
      ) : (
        <div key={month} className="anim-fade-in-fast grid gap-8 lg:grid-cols-2">
          <div>
            <div className="mb-3 text-sm font-semibold text-slate-600">This month, by status</div>
            {total === 0 ? (
              <p className="flex h-32 items-center text-sm text-slate-500">No attendance recorded yet this month.</p>
            ) : (
              <div className="flex items-center gap-6">
                <StatusDoughnut
                  segments={STATUS.map((s) => ({ key: s.key, label: s.label, color: s.color, value: summary[s.key] }))}
                  size={112}
                  strokeWidth={16}
                  centerValue={total}
                  centerLabel="Total"
                  ariaLabel={`This month's attendance: ${STATUS.map((s) => `${s.label} ${summary[s.key]} of ${total}`).join(", ")}`}
                />
                <ul className="min-w-0 flex-1 space-y-1.5">
                  {STATUS.map((s) => {
                    const count = summary[s.key];
                    const pct = total ? Math.round((count / total) * 100) : 0;
                    return (
                      <li key={s.key} className="flex items-center justify-between gap-2 text-sm">
                        <span className="inline-flex items-center gap-1.5 font-medium text-slate-600">
                          <span className="h-2 w-2 rounded-full" style={{ background: s.color }} aria-hidden="true" />
                          {s.label}
                        </span>
                        <span className="tabular-nums text-slate-500">{count} · {pct}%</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
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
    </GlassCard>
  );
}
