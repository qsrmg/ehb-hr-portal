"use client";

import Link from "next/link";
import { Alert, Card, Empty, LinkButton, PageHeader, Spinner, Stat, StatusBadge } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useApi } from "@/lib/useApi";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";

type Dashboard = {
  today: string;
  todayAttendance: { checkIn: string | null; checkOut: string | null; status: string } | null;
  month: { name: string; year: number; lastImported: string | null; summary: { onTime: number; late: number; halfDay: number; absent: number; leave: number } };
  balances: { leaveTypeId: number; name: string; code: string; hasQuota: boolean; available: number | null; used: number; pending: number; entitled: number; carriedForward: number }[];
  myPending: { id: number; title: string; typeLabel: string; status: string; currentStepLabel: string | null; createdAt: string }[];
  tasks: { requestId: number; title: string; typeLabel: string; step: string; employee: string; pendingSince: string }[];
  latestPayslip: { id: number; monthName: string; year: number; netPay: number } | null;
  hr: { lateWarningsThisMonth: number; activeEmployees: number; onLeaveToday: number } | null;
};

export default function DashboardPage() {
  const { user } = useAuth();
  const { data, error, loading } = useApi<Dashboard>("/dashboard");
  if (loading) return <Spinner />;
  if (error || !data) return <Alert>{error}</Alert>;
  const s = data.month.summary;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${user?.fullName.split(" ")[0]}`}
        subtitle={`${user?.designation ?? ""}${user?.department ? ` · ${user.department}` : ""} · ${fmtDate(data.today)}`}
        actions={
          <>
            <LinkButton href="/requests/new/leave">Apply for leave</LinkButton>
            <LinkButton href="/requests/new/attendance-update" variant="secondary">Fix attendance</LinkButton>
            <LinkButton href="/requests/new/letter" variant="secondary">Request a letter</LinkButton>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="sm:col-span-2">
          <Stat
            label="Today's in-time"
            value={data.todayAttendance?.checkIn ?? "—"}
            sub={data.todayAttendance ? <StatusBadge status={data.todayAttendance.status} /> : data.month.lastImported ? `Attendance imported up to ${fmtDate(data.month.lastImported)}` : "No attendance imported yet"}
          />
        </div>
        <Stat label="On time" value={s.onTime} tone="green" sub={data.month.name} />
        <Stat label="Late" value={s.late} tone="amber" sub={data.month.name} />
        <Stat label="Half day" value={s.halfDay} tone="orange" sub={data.month.name} />
        <Stat label="Absent" value={s.absent} tone="red" sub={`${s.leave} on leave`} />
      </div>

      {data.hr && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Active employees" value={data.hr.activeEmployees} />
          <Stat label="On leave today" value={data.hr.onLeaveToday} tone="sky" />
          <Link href="/admin/late-warnings"><Stat label="Late warnings this month" value={data.hr.lateWarningsThisMonth} tone="amber" sub="View warnings →" /></Link>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Leave balance" actions={<Link href="/leave" className="text-xs text-accent hover:underline">Details</Link>}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {data.balances.filter((b) => b.hasQuota).map((b) => (
              <div key={b.leaveTypeId} className="rounded-md bg-slate-50 p-3 ring-1 ring-slate-200">
                <div className="text-xs text-slate-500">{b.name}</div>
                <div className="text-xl font-semibold tabular-nums text-slate-900">{b.available}</div>
                <div className="text-[11px] text-slate-500">of {b.entitled + b.carriedForward} · {b.used} used{b.pending ? ` · ${b.pending} pending` : ""}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card title={`Waiting for my approval (${data.tasks.length})`} actions={<Link href="/approvals" className="text-xs text-accent hover:underline">All approvals</Link>}>
          {data.tasks.length === 0 ? (
            <Empty>Nothing waiting for you.</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.tasks.map((t) => (
                <li key={t.requestId}>
                  <Link href={`/requests/${t.requestId}`} className="flex items-center justify-between gap-3 py-2 hover:bg-slate-50">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-800">{t.employee}: {t.title}</div>
                      <div className="text-xs text-slate-500">{t.step} · waiting since {fmtDateTime(t.pendingSince)}</div>
                    </div>
                    <span className="text-xs text-accent">Review →</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="My open requests" actions={<Link href="/requests" className="text-xs text-accent hover:underline">All requests</Link>}>
          {data.myPending.length === 0 ? (
            <Empty>No open requests.</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.myPending.map((r) => (
                <li key={r.id}>
                  <Link href={`/requests/${r.id}`} className="flex items-center justify-between gap-3 py-2 hover:bg-slate-50">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-800">{r.title}</div>
                      <div className="text-xs text-slate-500">{r.currentStepLabel ? `With ${r.currentStepLabel}` : "Needs your changes"} · {fmtDate(r.createdAt)}</div>
                    </div>
                    <StatusBadge status={r.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Latest pay slip" actions={<Link href="/payslips" className="text-xs text-accent hover:underline">All pay slips</Link>}>
          {data.latestPayslip ? (
            <div className="flex items-end justify-between">
              <div>
                <div className="text-sm text-slate-500">{data.latestPayslip.monthName} {data.latestPayslip.year}</div>
                <div className="text-2xl font-semibold tabular-nums text-slate-900">PKR {fmtMoney(data.latestPayslip.netPay)}</div>
                <div className="text-xs text-slate-500">Net pay</div>
              </div>
              <LinkButton href="/payslips" variant="secondary" size="sm">Download</LinkButton>
            </div>
          ) : (
            <Empty>No pay slips uploaded yet.</Empty>
          )}
        </Card>
      </div>
    </div>
  );
}
