"use client";

import { useState } from "react";
import Link from "next/link";
import { Spinner } from "@/components/ui";
import { MoreRequests } from "@/components/MoreRequests";
import { useAuth, type User } from "@/lib/auth";
import { download, post } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { fmtDate, fmtDateTime, fmtMoney, MONTH_NAMES } from "@/lib/format";

// Dashboard (design page 7): today's in-time, open requests and approvals first, then attendance, balances and pay slips.

type Dashboard = {
  today: string;
  todayAttendance: { checkIn: string | null; checkOut: string | null; status: string } | null;
  month: { name: string; year: number; lastImported: string | null; summary: { onTime: number; late: number; halfDay: number; absent: number; leave: number } };
  balances: { leaveTypeId: number; name: string; code: string; hasQuota: boolean; available: number | null; used: number; pending: number; entitled: number; carriedForward: number }[];
  myPending: { id: number; title: string; typeLabel: string; status: string; currentStepLabel: string | null; createdAt: string }[];
  recent: { id: number; title: string; type: string; typeLabel: string; status: string; updatedAt: string; currentStepLabel: string | null }[];
  tasks: { requestId: number; type: string; title: string; typeLabel: string; step: string; employee: string; pendingSince: string }[];
  latestPayslip: { id: number; monthName: string; month: number; year: number; netPay: number } | null;
  rules: { lateAfter: string; payslipsDueDay: number; annualCarryForwardMax: number | null };
  hr: { lateWarningsThisMonth: number; activeEmployees: number; onLeaveToday: number } | null;
};

const isApprover = (u: User) => u.hasTeam || u.roles.some((r) => r !== "EMPLOYEE");
/** Simple requests can be approved from the dashboard; the rest open the request (they need more than a click). */
const QUICK_APPROVE = new Set(["LEAVE", "ATTENDANCE_UPDATE"]);

const ATTENDANCE_LABELS: Record<string, string> = { ON_TIME: "On Time", LATE: "Late", HALF_DAY: "Half Day", ABSENT: "Absent" };
const PILL: Record<string, string> = {
  PENDING: "bg-sun text-ink-950",
  APPROVED: "bg-[#dbe6ff] text-[#1e3a8a]",
  RETURNED: "bg-slate-200 text-slate-800",
  REJECTED: "bg-red-200 text-red-900",
  CANCELLED: "bg-white/10 text-white/70",
  ON_TIME: "bg-[#dbe6ff] text-[#1e3a8a]",
  LATE: "bg-sun text-ink-950",
  HALF_DAY: "bg-orange-200 text-orange-900",
  ABSENT: "bg-red-200 text-red-900",
};
const STATUS_TEXT: Record<string, string> = { APPROVED: "Approved", RETURNED: "Returned for changes", REJECTED: "Rejected", CANCELLED: "Cancelled" };

function greeting() {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Karachi" }).format(new Date()));
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

/** 1 -> 1st, 2 -> 2nd, 5 -> 5th */
const ordinal = (n: number) => `${n}${[11, 12, 13].includes(n % 100) ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;

const longDate = (ymd: string) =>
  new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** "09:25" -> "9:25 AM" */
function clock(hm: string | null) {
  if (!hm) return null;
  const [h, m] = hm.split(":").map(Number) as [number, number];
  return `${String(h % 12 || 12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

const Pill = ({ status, children }: { status: string; children: React.ReactNode }) => (
  <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold ${PILL[status] ?? "bg-white/10 text-white"}`}>{children}</span>
);

function Panel({ title, aside, children, className = "" }: { title?: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-line/80 bg-ink-800/80 p-5 ${className}`}>
      {(title || aside) && (
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          {title && <h2 className="text-lg font-bold text-white">{title}</h2>}
          {aside && <div className="text-sm text-haze">{aside}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

const outline = "inline-flex items-center justify-center rounded-lg border border-white/30 px-4 py-2 text-sm font-bold text-white transition hover:border-white/60 hover:bg-white/5";
const primary = "inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white shadow-[0_10px_24px_-12px_rgba(37,99,235,.9)] transition hover:bg-primary-hover";

export default function DashboardPage() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useApi<Dashboard>("/dashboard");
  const [acting, setActing] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (loading && !data) return <Spinner />;
  if (error || !data || !user) return <p role="alert" className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-900">{error}</p>;

  const approver = isApprover(user);
  const s = data.month.summary;
  const counted = s.onTime + s.late + s.halfDay + s.absent;
  const onTimeShare = counted ? Math.round((s.onTime / counted) * 100) : 0;
  const quota = data.balances.filter((b) => b.hasQuota);
  const nextPayslip = (() => {
    if (!data.latestPayslip) return null;
    const m = data.latestPayslip.month === 12 ? 1 : data.latestPayslip.month + 1;
    const y = data.latestPayslip.month === 12 ? data.latestPayslip.year + 1 : data.latestPayslip.year;
    return `${MONTH_NAMES[m - 1]} ${y}`;
  })();
  const firstPending = data.myPending[0];

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
    <div className="space-y-6 font-display text-white">
      {/* Greeting and quick actions */}
      <div className="relative">
        <div aria-hidden="true" className="pointer-events-none absolute -right-6 -top-10 h-56 w-2/3 bg-[radial-gradient(closest-side,rgba(37,99,235,.25),transparent)]" />
        <p className="relative flex items-center gap-2.5 text-xs font-bold uppercase tracking-[0.18em] text-white/85">
          <span className="h-1.5 w-1.5 rounded-full bg-sun" aria-hidden="true" />
          {longDate(data.today)}
        </p>
        <h1 className="relative mt-2 text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">
          {greeting()}, <span className="text-sun">{user.fullName.split(" ")[0]}</span>
        </h1>
        <p className="relative mt-1 text-sm text-haze">{[user.designation, user.department].filter(Boolean).join(" · ")}</p>
        <div className="relative mt-5 flex flex-wrap gap-2.5">
          <Link href="/requests/new/leave" className={primary}>Apply for leave</Link>
          <Link href="/requests/new/attendance-update" className={outline}>Attendance Update</Link>
          {data.latestPayslip && (
            <button
              className={outline}
              onClick={() => download(`/payroll/payslips/${data.latestPayslip!.id}/pdf`, `payslip-${data.latestPayslip!.year}-${data.latestPayslip!.month}.pdf`)}
            >
              Download pay slip
            </button>
          )}
          <MoreRequests className={outline} />
        </div>
      </div>

      {/* Today, my pending requests, and (for approvers) what waits for me */}
      <div className={`grid gap-4 sm:grid-cols-2 ${approver ? "lg:grid-cols-3" : ""}`}>
        <Panel>
          <div className="text-sm text-haze">Today&apos;s in-time</div>
          <div className="mt-1 text-3xl font-extrabold tabular-nums">{clock(data.todayAttendance?.checkIn ?? null) ?? "—"}</div>
          {data.todayAttendance && <div className="mt-2"><Pill status={data.todayAttendance.status}>{ATTENDANCE_LABELS[data.todayAttendance.status] ?? data.todayAttendance.status}</Pill></div>}
          <p className="mt-2 text-xs text-haze">
            {data.todayAttendance ? `Arriving after ${clock(data.rules.lateAfter)?.replace(/^0/, "")} counts as Late.` : data.month.lastImported ? `Attendance is imported up to ${fmtDate(data.month.lastImported)}.` : "No attendance imported yet."}
          </p>
        </Panel>
        <Link href="/requests" className="block rounded-2xl border border-line/80 bg-ink-800/80 p-5 transition hover:border-white/25">
          <div className="text-sm text-haze">My pending requests</div>
          <div className="mt-1 text-3xl font-extrabold tabular-nums">{data.myPending.length}</div>
          <p className="mt-2 text-xs text-haze">
            {firstPending ? (firstPending.currentStepLabel ? `${firstPending.typeLabel}, waiting with ${firstPending.currentStepLabel}.` : `${firstPending.typeLabel}, returned to you for changes.`) : "Nothing open right now."}
          </p>
        </Link>
        {approver && (
          <Link href="/approvals" className="block rounded-2xl bg-gradient-to-br from-primary to-[#1d4fd8] p-5 shadow-[0_20px_50px_-20px_rgba(37,99,235,.9)] transition hover:brightness-110">
            <div className="text-sm text-white/85">Waiting for your approval</div>
            <div className="mt-1 text-3xl font-extrabold tabular-nums">
              {data.tasks.length} <span className="text-lg font-bold">{data.tasks.length === 1 ? "task" : "tasks"}</span>
            </div>
            <p className="mt-2 text-xs text-white/85">{data.tasks.length ? (data.tasks.length === 1 ? "A request needs your decision." : "Requests need your decision.") : "Nothing waiting for you."}</p>
          </Link>
        )}
      </div>

      {data.hr && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Panel><div className="text-sm text-haze">Active employees</div><div className="mt-1 text-3xl font-extrabold tabular-nums">{data.hr.activeEmployees}</div></Panel>
          <Panel><div className="text-sm text-haze">On leave today</div><div className="mt-1 text-3xl font-extrabold tabular-nums">{data.hr.onLeaveToday}</div></Panel>
          <Link href="/admin/late-warnings" className="block rounded-2xl border border-line/80 bg-ink-800/80 p-5 transition hover:border-white/25">
            <div className="text-sm text-haze">Late warnings this month</div>
            <div className="mt-1 text-3xl font-extrabold tabular-nums text-sun">{data.hr.lateWarningsThisMonth}</div>
            <p className="mt-1 text-xs text-haze">View warnings →</p>
          </Link>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
        <div className="space-y-6">
          <Panel title="This month's attendance" aside={`${data.month.name} ${data.month.year}`}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[["On Time", s.onTime], ["Late", s.late], ["Half Day", s.halfDay], ["Absent", s.absent]].map(([label, n]) => (
                <div key={label} className="rounded-xl bg-ink-700/70 px-4 py-3">
                  <div className="text-2xl font-extrabold tabular-nums">{n}</div>
                  <div className="text-xs text-haze">{label}</div>
                </div>
              ))}
            </div>
            <div className="mt-4 h-2 rounded-full bg-white/10" role="img" aria-label={`${onTimeShare}% of recorded days on time`}>
              <div className="h-full rounded-full bg-gradient-to-r from-primary to-[#7ea6ff]" style={{ width: `${onTimeShare}%` }} />
            </div>
            <p className="mt-3 text-sm leading-relaxed text-haze">
              {s.leave ? `${s.leave} day${s.leave === 1 ? "" : "s"} on leave this month. ` : ""}
              Missed a punch or on a field visit? <Link href="/requests/new/attendance-update" className="font-semibold text-white underline-offset-2 hover:underline">Raise an Attendance Update</Link> within 7 days. The original record is never overwritten.
            </p>
          </Panel>

          <Panel title="My requests" aside={<Link href="/requests" className="font-semibold text-white/85 hover:text-white">All requests</Link>}>
            {data.recent.length === 0 ? (
              <p className="text-sm text-haze">You have not submitted any requests yet.</p>
            ) : (
              <ul className="divide-y divide-white/10 border-t border-white/10">
                {data.recent.map((r) => (
                  <li key={r.id}>
                    <Link href={`/requests/${r.id}`} className="flex items-center justify-between gap-3 py-3 hover:bg-white/[.03]">
                      <div className="min-w-0">
                        <div className="truncate font-bold">{r.title}</div>
                        <div className="text-xs text-haze">{r.typeLabel} · updated {fmtDate(r.updatedAt)}</div>
                      </div>
                      <Pill status={r.status}>{r.status === "PENDING" ? `Pending with ${r.currentStepLabel ?? "approver"}` : STATUS_TEXT[r.status] ?? r.status}</Pill>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Leave balances" aside={<Link href="/leave" className="font-semibold text-white/85 hover:text-white">Details</Link>}>
            <div className="space-y-4">
              {quota.map((b, i) => {
                const total = b.entitled + b.carriedForward;
                const left = b.available ?? 0;
                return (
                  <div key={b.leaveTypeId}>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="font-bold">{b.name}</span>
                      <span className="text-haze">{left} day{left === 1 ? "" : "s"} left{b.pending ? ` · ${b.pending} pending` : ""}</span>
                    </div>
                    <div className="mt-1.5 h-2 rounded-full bg-white/10">
                      <div className={`h-full rounded-full ${i % 2 ? "bg-sun" : "bg-gradient-to-r from-primary to-[#7ea6ff]"}`} style={{ width: `${total ? Math.max(0, Math.min(100, (left / total) * 100)) : 0}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
            {data.rules.annualCarryForwardMax != null && (
              <p className="mt-4 text-xs text-haze">Up to {data.rules.annualCarryForwardMax} unused Annual Leave days carry forward to next year.</p>
            )}
          </Panel>

          {approver && (
            <Panel title="Waiting for your approval" aside={<Link href="/approvals" className="font-semibold text-white/85 hover:text-white">All approvals</Link>}>
              {actionError && <p role="alert" className="mb-3 rounded-lg bg-red-100 px-3 py-2 text-sm text-red-900">{actionError}</p>}
              {data.tasks.length === 0 ? (
                <p className="text-sm text-haze">Nothing waiting for you.</p>
              ) : (
                <ul className="space-y-3">
                  {data.tasks.slice(0, 4).map((t) => (
                    <li key={t.requestId} className="rounded-xl bg-ink-700/70 p-4">
                      <div className="font-bold">{t.title}</div>
                      <div className="mt-0.5 text-xs text-haze">From {t.employee} · {t.step} · since {fmtDateTime(t.pendingSince)}</div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {QUICK_APPROVE.has(t.type) && (
                          <button className={`${primary} py-1.5`} disabled={acting === t.requestId} onClick={() => quickApprove(t.requestId)}>
                            {acting === t.requestId ? "Approving…" : "Approve"}
                          </button>
                        )}
                        <Link href={`/requests/${t.requestId}`} className={`${outline} py-1.5`}>{QUICK_APPROVE.has(t.type) ? "Review or return" : "Review"}</Link>
                      </div>
                    </li>
                  ))}
                  {data.tasks.length > 4 && <li className="text-sm text-haze">and {data.tasks.length - 4} more in Approvals.</li>}
                </ul>
              )}
            </Panel>
          )}

          <Panel title="Pay slips" aside={<Link href="/payslips" className="font-semibold text-white/85 hover:text-white">All pay slips</Link>}>
            {data.latestPayslip ? (
              <>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-bold">{data.latestPayslip.monthName} {data.latestPayslip.year}</div>
                    <div className="text-xs text-haze">PDF · net pay PKR {fmtMoney(data.latestPayslip.netPay)}</div>
                  </div>
                  <button className={outline} onClick={() => download(`/payroll/payslips/${data.latestPayslip!.id}/pdf`, `payslip-${data.latestPayslip!.year}-${data.latestPayslip!.month}.pdf`)}>
                    Download
                  </button>
                </div>
                <p className="mt-4 border-t border-white/10 pt-3 text-xs leading-relaxed text-haze">
                  {nextPayslip} will be available by the {ordinal(data.rules.payslipsDueDay)}. Your yearly tax statement for July to June is also here.
                </p>
              </>
            ) : (
              <p className="text-sm text-haze">No pay slips uploaded yet. They are available by the {ordinal(data.rules.payslipsDueDay)} of each month.</p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
