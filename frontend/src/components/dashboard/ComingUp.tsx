"use client";

import { CalendarDays, Users } from "lucide-react";
import { fmtDate, currentMonth, shiftMonth } from "@/lib/format";
import { useApi } from "@/lib/useApi";
import { GlassCard } from "./GlassCard";

export type Holiday = { id: number; date: string; name: string };
type LeaveRow = { requestId: number; status: string; employee: { id: number; fullName: string; code: string }; leaveType: string; startDate: string; endDate: string; days: number };

/**
 * Replaces the former "Attendance status" card (a duplicate of the Attendance analytics donut above it)
 * with two things the API already has but the dashboard never surfaced: the next public holiday (resolved
 * once by the dashboard page, which also feeds the header's "Today" summary) and any upcoming approved/
 * pending team leave, from the same `/leave/calendar` endpoint the Team page already uses — naturally empty
 * for an employee with no reports, since that endpoint already scopes rows to the caller's own team (or
 * company-wide for HR/Management), so no extra role check is needed here.
 */
export function ComingUp({ nextHoliday, today }: { nextHoliday: Holiday | null; today: string }) {
  const month = currentMonth();
  const leaveThis = useApi<LeaveRow[]>(`/leave/calendar?month=${month}`);
  const leaveNext = useApi<LeaveRow[]>(`/leave/calendar?month=${shiftMonth(month, 1)}`);

  const upcomingLeave = [...(leaveThis.data ?? []), ...(leaveNext.data ?? [])]
    .filter((l) => l.endDate >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .slice(0, 3);

  return (
    <GlassCard title="Coming up">
      <div className="space-y-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-700">
            <CalendarDays className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <div className="text-sm font-semibold text-slate-600">Next public holiday</div>
            {nextHoliday ? (
              <div className="font-bold text-charcoal">{nextHoliday.name} · {fmtDate(nextHoliday.date)}</div>
            ) : (
              <p className="text-sm text-slate-500">No upcoming holiday on the calendar yet.</p>
            )}
          </div>
        </div>

        {upcomingLeave.length > 0 && (
          <div className="flex items-start gap-3 border-t border-slate-100 pt-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-700">
              <Users className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-slate-600">Upcoming team leave</div>
              <ul className="mt-1 space-y-1">
                {upcomingLeave.map((l) => (
                  <li key={l.requestId} className="text-sm text-slate-700">
                    <span className="font-medium">{l.employee.fullName}</span> · {l.leaveType} · {fmtDate(l.startDate)}{l.startDate !== l.endDate ? `–${fmtDate(l.endDate)}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </GlassCard>
  );
}
