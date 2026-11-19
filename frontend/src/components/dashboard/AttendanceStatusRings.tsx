"use client";

import { Card, Empty } from "@/components/ui";
import { CircularProgress } from "./CircularProgress";

const ROWS: { key: "onTime" | "late" | "halfDay" | "absent"; label: string; color: string }[] = [
  { key: "onTime", label: "On-Time", color: "#10b981" },
  { key: "late", label: "Late", color: "#f59e0b" },
  { key: "halfDay", label: "Half-Day", color: "#fb923c" },
  { key: "absent", label: "Absent", color: "#ef4444" },
];

/**
 * Four circular indicators for this month's attendance composition. The denominator is every day with a
 * recorded outcome (on-time + late + half-day + absent) — the same base the existing progress bar and the
 * "% on time" figure already use, excluding leave, travel, weekends, holidays and days not yet imported.
 */
export function AttendanceStatusRings({ summary }: { summary: { onTime: number; late: number; halfDay: number; absent: number } }) {
  const total = summary.onTime + summary.late + summary.halfDay + summary.absent;
  return (
    <Card title="Attendance status" actions={total ? <span className="text-sm text-slate-500">{total} day{total === 1 ? "" : "s"} recorded</span> : undefined}>
      {total === 0 ? (
        <Empty>No attendance recorded yet this month.</Empty>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {ROWS.map(({ key, label, color }) => {
            const count = summary[key];
            const pct = total ? (count / total) * 100 : 0;
            return (
              <div key={key} className="flex flex-col items-center gap-2 text-center" title={`${label}: ${count} of ${total} day${total === 1 ? "" : "s"}`}>
                <CircularProgress
                  percent={pct}
                  color={color}
                  size={88}
                  strokeWidth={9}
                  centerLabel={
                    <div className="flex flex-col items-center">
                      <span data-testid="ring-percent" className="text-lg font-extrabold tabular-nums text-charcoal">{Math.round(pct)}%</span>
                    </div>
                  }
                />
                <div>
                  <div className="text-sm font-semibold text-slate-700">{label}</div>
                  <div className="text-xs text-slate-500">{count} day{count === 1 ? "" : "s"}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
