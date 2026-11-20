"use client";

import { Empty } from "@/components/ui";
import { GlassCard } from "./GlassCard";
import { StatusDoughnut } from "./StatusDoughnut";

const ROWS: { key: "onTime" | "late" | "halfDay" | "absent"; label: string; color: string }[] = [
  { key: "onTime", label: "On-Time", color: "#10b981" },
  { key: "late", label: "Late", color: "#f59e0b" },
  { key: "halfDay", label: "Half-Day", color: "#fb923c" },
  { key: "absent", label: "Absent", color: "#ef4444" },
];

/**
 * This month's attendance composition as one combined donut (same real summary the Attendance analytics
 * card and the Attendance page already use) with a legend of counts and shares — the centre shows the total
 * number of days recorded, not any single status, so the headline never misrepresents which status leads.
 */
export function AttendanceStatusRings({ summary }: { summary: { onTime: number; late: number; halfDay: number; absent: number } }) {
  const total = summary.onTime + summary.late + summary.halfDay + summary.absent;
  return (
    <GlassCard title="Attendance status" actions={total ? <span className="text-sm text-slate-500">{total} day{total === 1 ? "" : "s"} recorded</span> : undefined}>
      {total === 0 ? (
        <Empty>No attendance recorded yet this month.</Empty>
      ) : (
        <div className="flex flex-col items-center gap-6 sm:flex-row">
          <StatusDoughnut
            segments={ROWS.map((r) => ({ key: r.key, label: r.label, color: r.color, value: summary[r.key] }))}
            centerValue={total}
            centerLabel={`day${total === 1 ? "" : "s"} recorded`}
            ariaLabel={`This month's attendance: ${ROWS.map((r) => `${r.label} ${summary[r.key]} of ${total}`).join(", ")}`}
          />
          <div className="w-full min-w-0 space-y-3">
            {ROWS.map(({ key, label, color }) => {
              const count = summary[key];
              const pct = total ? Math.round((count / total) * 100) : 0;
              return (
                <div key={key} className="flex items-center justify-between gap-2 text-sm">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700">
                    <span className="h-2 w-2 rounded-full" style={{ background: color }} aria-hidden="true" />
                    {label}
                  </span>
                  <span data-testid="ring-percent" className="text-slate-500">{count} day{count === 1 ? "" : "s"} · {pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </GlassCard>
  );
}
