"use client";

import Link from "next/link";
import { Button, StatusBadge, Table, Td } from "@/components/ui";
import { fmtDate, shiftMonth } from "@/lib/format";

export type MonthData = {
  year: number;
  month: number;
  monthName: string;
  lastImported: string | null;
  summary: { onTime: number; late: number; halfDay: number; absent: number; leave: number; workingDays: number };
  days: {
    date: string;
    status: string;
    note: string | null;
    checkIn: string | null;
    checkOut: string | null;
    corrected: { status: string; checkIn: string | null; checkOut: string | null; requestId: number | null } | null;
    originalStatus: string | null;
  }[];
};

export function MonthPicker({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <div className="flex items-center gap-2">
      <Button variant="secondary" size="sm" onClick={() => onChange(shiftMonth(month, -1))} aria-label="Previous month">←</Button>
      <span className="min-w-32 text-center text-sm font-medium text-slate-700">{label}</span>
      <Button variant="secondary" size="sm" onClick={() => onChange(shiftMonth(month, 1))} aria-label="Next month">→</Button>
    </div>
  );
}

/** Day-by-day attendance table. When `onFix` is given, absent / late / half-day rows get a "Fix" link. */
export function AttendanceTable({ data, fixLink }: { data: MonthData; fixLink?: (date: string) => string }) {
  const days = data.days.filter((d) => d.status !== "UPCOMING");
  return (
    <Table head={["Date", "Day", "Check in", "Check out", "Status", ""]} empty="No days to show">
      {days.map((d) => {
        const weekday = new Date(`${d.date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
        const muted = d.status === "WEEKEND" || d.status === "NO_DATA";
        const fixable = fixLink && ["ABSENT", "LATE", "HALF_DAY"].includes(d.status) && !d.corrected;
        return (
          <tr key={d.date} className={muted ? "bg-slate-50/60" : undefined}>
            <Td className={muted ? "text-slate-400" : undefined}>{fmtDate(d.date)}</Td>
            <Td className="text-slate-500">{weekday}</Td>
            <Td className="tabular-nums">
              {d.corrected?.checkIn ?? d.checkIn ?? "—"}
              {d.corrected && d.checkIn !== d.corrected.checkIn && <span className="ml-1 text-xs text-slate-400 line-through">{d.checkIn}</span>}
            </Td>
            <Td className="tabular-nums">
              {d.corrected?.checkOut ?? d.checkOut ?? "—"}
              {d.corrected && d.checkOut !== d.corrected.checkOut && <span className="ml-1 text-xs text-slate-400 line-through">{d.checkOut ?? "missing"}</span>}
            </Td>
            <Td>
              <div className="flex items-center gap-2">
                <StatusBadge status={d.status} />
                {d.note && <span className="text-xs text-slate-500">{d.note}</span>}
                {d.corrected && (
                  <Link href={`/requests/${d.corrected.requestId}`} className="text-xs text-accent hover:underline" title={`Machine record: ${d.originalStatus}`}>
                    corrected
                  </Link>
                )}
              </div>
            </Td>
            <Td>{fixable && <Link href={fixLink(d.date)} className="text-xs font-medium text-accent hover:underline">Fix</Link>}</Td>
          </tr>
        );
      })}
    </Table>
  );
}
