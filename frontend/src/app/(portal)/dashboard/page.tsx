"use client";

import { useState } from "react";
import Link from "next/link";
import { Calendar as CalendarIcon, CheckSquare, ClipboardList, ShieldAlert, UserCheck, Users } from "lucide-react";
import { Alert, Card, Empty, Spinner } from "@/components/ui";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { AttendanceAnalytics, type AttendanceDay, type AttendanceSummary } from "@/components/dashboard/AttendanceAnalytics";
import { AttendanceStatusRings } from "@/components/dashboard/AttendanceStatusRings";
import { LeaveDoughnut, type LeaveBalance } from "@/components/dashboard/LeaveDoughnut";
import { RequestsPanel, type RequestRow } from "@/components/dashboard/RequestsPanel";
import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { useAuth, type User } from "@/lib/auth";
import { download, post } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { currentMonth, fmtDateTime, fmtMoney, MONTH_NAMES } from "@/lib/format";

// Premium dashboard: a white, card-based redesign of the same real data the previous dashboard showed
// (nothing here is demonstration/hardcoded data — see the API calls below). The sidebar and every other
// signed-in page keep the existing dark theme; this page alone switches to light, premium cards, consistent
// with how Attendance/Leave/Team etc. already render their own content as white cards on the dark shell.

type Dashboard = {
  today: string;
  todayAttendance: { checkIn: string | null; checkOut: string | null; status: string } | null;
  month: { name: string; year: number; lastImported: string | null; summary: AttendanceSummary & { leave: number; travel: number } };
  balances: (LeaveBalance & { hasQuota: boolean; used: number })[];
  myPending: { id: number; title: string; typeLabel: string; status: string; currentStepLabel: string | null; createdAt: string }[];
  recent: RequestRow[];
  tasks: { requestId: number; type: string; title: string; typeLabel: string; step: string; employee: string; pendingSince: string }[];
  latestPayslip: { id: number; monthName: string; month: number; year: number; netPay: number } | null;
  rules: { lateAfter: string; payslipsDueDay: number; annualCarryForwardMax: number | null };
  hr: { lateWarningsThisMonth: number; activeEmployees: number; onLeaveToday: number } | null;
  unreadNotifications: number;
};

type MonthAttendance = { summary: AttendanceSummary; days: AttendanceDay[]; rules: { lateAfter: string } };

const isApprover = (u: User) => u.hasTeam || u.roles.some((r) => r !== "EMPLOYEE");
/** Simple requests can be approved from the dashboard; the rest open the request (they need more than a click). */
const QUICK_APPROVE = new Set(["LEAVE", "ATTENDANCE_UPDATE"]);

/** 1 -> 1st, 2 -> 2nd, 5 -> 5th */
const ordinal = (n: number) => `${n}${[11, 12, 13].includes(n % 100) ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;

/** "09:25" -> "9:25 AM" */
function clock(hm: string | null) {
  if (!hm) return null;
  const [h, m] = hm.split(":").map(Number) as [number, number];
  return `${String(h % 12 || 12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

const outline = "inline-flex items-center justify-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-charcoal transition duration-200 motion-safe:hover:-translate-y-0.5 hover:border-slate-400 hover:bg-slate-50";
const primaryBtn = "inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white shadow-[0_10px_24px_-12px_rgba(37,99,235,.55)] transition duration-200 motion-safe:hover:-translate-y-0.5 hover:bg-primary-hover";

export default function DashboardPage() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useApi<Dashboard>("/dashboard");
  const [month, setMonth] = useState(currentMonth());
  const monthData = useApi<MonthAttendance>(`/attendance/me?month=${month}`);
  const [acting, setActing] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (loading && !data) return <Spinner />;
  if (error || !data || !user) return <Alert>{error}</Alert>;

  const approver = isApprover(user);
  const quota = data.balances.filter((b) => b.hasQuota);
  const nextPayslip = (() => {
    if (!data.latestPayslip) return null;
    const m = data.latestPayslip.month === 12 ? 1 : data.latestPayslip.month + 1;
    const y = data.latestPayslip.month === 12 ? data.latestPayslip.year + 1 : data.latestPayslip.year;
    return `${MONTH_NAMES[m - 1]} ${y}`;
  })();

  const quickApprove = async (requestId: number) => {
    setActing(requestId);
    setActionError(null);
    try {
      await post(`/requests/${requestId}/approve`, {});
      await reload();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setActing(null);
    }
  };

  return (
    <div className="space-y-6">
      <DashboardHeader
        user={user}
        today={data.today}
        unreadNotifications={data.unreadNotifications}
        latestPayslipId={data.latestPayslip?.id ?? null}
        onDownloadPayslip={() => download(`/payroll/payslips/${data.latestPayslip!.id}/pdf`, `payslip-${data.latestPayslip!.year}-${data.latestPayslip!.month}.pdf`)}
      />

      {/* KPI cards: only ever real, role-appropriate data — see KpiCard for the "not shown for your role" rule. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard
          label="Today's in-time"
          value={null}
          unavailable={clock(data.todayAttendance?.checkIn ?? null) ?? "No check-in yet"}
          icon={CheckSquare}
          tone="primary"
          hint={data.todayAttendance ? `Arriving after ${clock(data.rules.lateAfter)?.replace(/^0/, "")} counts as Late` : data.month.lastImported ? `Imported up to ${data.month.lastImported}` : "No attendance imported yet"}
        />
        <KpiCard label="My pending requests" value={data.myPending.length} icon={ClipboardList} tone="violet" href="/requests" hint={data.myPending[0]?.currentStepLabel ? `Waiting with ${data.myPending[0].currentStepLabel}` : undefined} />
        {approver && <KpiCard label="Waiting for your approval" value={data.tasks.length} icon={UserCheck} tone="sun" href="/approvals" hint={data.tasks.length ? "Needs your decision" : "Nothing waiting"} />}
        {data.hr && <KpiCard label="Active employees" value={data.hr.activeEmployees} icon={Users} tone="emerald" href="/admin/employees" />}
        {data.hr && <KpiCard label="On leave today" value={data.hr.onLeaveToday} icon={CalendarIcon} tone="primary" href="/team" />}
        {data.hr && <KpiCard label="Late warnings this month" value={data.hr.lateWarningsThisMonth} icon={ShieldAlert} tone="red" href="/admin/late-warnings" />}
      </div>

      <AttendanceAnalytics
        month={month}
        onMonthChange={setMonth}
        summary={monthData.data?.summary ?? { onTime: 0, late: 0, halfDay: 0, absent: 0 }}
        days={monthData.data?.days ?? []}
        lateAfter={monthData.data?.rules.lateAfter ?? data.rules.lateAfter}
        loading={monthData.loading && !monthData.data}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <AttendanceStatusRings summary={monthData.data?.summary ?? { onTime: 0, late: 0, halfDay: 0, absent: 0 }} />
        <LeaveDoughnut balances={quota} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <RequestsPanel rows={data.recent} />

        <div className="space-y-6">
          {approver && (
            <Card title="Waiting for your approval" actions={<Link href="/approvals" className="text-sm font-semibold text-accent hover:underline">All approvals</Link>}>
              {actionError && <Alert>{actionError}</Alert>}
              {data.tasks.length === 0 ? (
                <Empty>Nothing waiting for you.</Empty>
              ) : (
                <ul className="space-y-3">
                  {data.tasks.slice(0, 4).map((t) => (
                    <li key={t.requestId} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="font-bold text-charcoal">{t.title}</div>
                      <div className="mt-0.5 text-xs text-slate-500">From {t.employee} · {t.step} · since {fmtDateTime(t.pendingSince)}</div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {QUICK_APPROVE.has(t.type) && (
                          <button className={`${primaryBtn} py-1.5`} disabled={acting === t.requestId} onClick={() => quickApprove(t.requestId)}>
                            {acting === t.requestId ? "Approving…" : "Approve"}
                          </button>
                        )}
                        <Link href={`/requests/${t.requestId}`} className={`${outline} py-1.5`}>{QUICK_APPROVE.has(t.type) ? "Review or return" : "Review"}</Link>
                      </div>
                    </li>
                  ))}
                  {data.tasks.length > 4 && <li className="text-sm text-slate-500">and {data.tasks.length - 4} more in Approvals.</li>}
                </ul>
              )}
            </Card>
          )}

          <Card title="Pay slips" actions={<Link href="/payslips" className="text-sm font-semibold text-accent hover:underline">All pay slips</Link>}>
            {data.latestPayslip ? (
              <>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-bold text-charcoal">{data.latestPayslip.monthName} {data.latestPayslip.year}</div>
                    <div className="text-xs text-slate-500">PDF · net pay PKR {fmtMoney(data.latestPayslip.netPay)}</div>
                  </div>
                  <button className={outline} onClick={() => download(`/payroll/payslips/${data.latestPayslip!.id}/pdf`, `payslip-${data.latestPayslip!.year}-${data.latestPayslip!.month}.pdf`)}>
                    Download
                  </button>
                </div>
                <p className="mt-4 border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-500">
                  {nextPayslip} will be available by the {ordinal(data.rules.payslipsDueDay)}. Your yearly tax statement for July to June is also here.
                </p>
              </>
            ) : (
              <p className="text-sm text-slate-500">No pay slips uploaded yet. They are available by the {ordinal(data.rules.payslipsDueDay)} of each month.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
