"use client";

import { useState } from "react";
import { Alert, Card, Empty, PageHeader, Spinner, Stat } from "@/components/ui";
import { MonthPicker } from "@/components/AttendanceMonth";
import { useApi } from "@/lib/useApi";
import { currentMonth, fmtDateTime } from "@/lib/format";

type Day = { date: string; trackedMinutes: number; activeMinutes: number; idleMinutes: number; activePct: number | null; firstActivityAt: string | null; lastActivityAt: string | null };
type MonthlyActivity = { today: Day; days: Day[]; monthSummary: { trackedMinutes: number; activeMinutes: number; idleMinutes: number; activePct: number | null } };

const hm = (minutes: number) => `${Math.floor(minutes / 60)}h ${minutes % 60}m`;

/** One bar per day of the month: Active % of that day's tracked time. No chart library — plain divs, like the rest of the portal's hand-rolled charts. */
function DailyBars({ days }: { days: Day[] }) {
  if (!days.some((d) => d.trackedMinutes > 0)) return <Empty>No tracked days yet this month.</Empty>;
  return (
    <div className="flex h-40 items-end gap-1 overflow-x-auto pb-1">
      {days.map((d) => {
        const dayNum = Number(d.date.slice(-2));
        const height = d.activePct == null ? 0 : Math.max(4, (d.activePct / 100) * 140);
        return (
          <div key={d.date} className="flex w-5 shrink-0 flex-col items-center gap-1" title={`${d.date}: ${d.activePct ?? "-"}% active of ${hm(d.trackedMinutes)} tracked`}>
            <div className="flex h-36 w-full items-end">
              <div className="w-full rounded-t bg-primary/80" style={{ height }} />
            </div>
            <span className="text-[10px] text-slate-400">{dayNum}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function ActivityPage() {
  const [month, setMonth] = useState(currentMonth());
  const { data, loading, error } = useApi<MonthlyActivity>(`/activity/me?month=${month}`);

  return (
    <div className="space-y-6">
      <PageHeader title="My activity" subtitle="How much of your tracked time in the portal was active. Activity time does not measure the quality or output of your work — meetings, calls and reading count as idle." />
      {loading ? <Spinner /> : error ? <Alert>{error}</Alert> : data && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Today: tracked" value={hm(data.today.trackedMinutes)} />
            <Stat label="Today: active" value={hm(data.today.activeMinutes)} tone="green" />
            <Stat label="Today: Active %" value={data.today.activePct == null ? "-" : `${data.today.activePct}%`} />
          </div>
          <Card title="This month">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <MonthPicker month={month} onChange={setMonth} />
              <span className="text-sm text-slate-600">
                {hm(data.monthSummary.trackedMinutes)} tracked · {hm(data.monthSummary.activeMinutes)} active · {data.monthSummary.activePct == null ? "-" : `${data.monthSummary.activePct}%`} Active %
              </span>
            </div>
            <DailyBars days={data.days} />
          </Card>
          {data.today.lastActivityAt && (
            <p className="text-xs text-slate-500">Last activity seen today: {fmtDateTime(data.today.lastActivityAt)}</p>
          )}
        </>
      )}
    </div>
  );
}
