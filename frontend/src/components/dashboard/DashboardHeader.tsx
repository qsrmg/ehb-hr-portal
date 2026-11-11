"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { MoreRequests } from "@/components/MoreRequests";
import { HeaderIllustration3D } from "./HeaderIllustration3D";
import type { User } from "@/lib/auth";

function greeting() {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Karachi" }).format(new Date()));
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

const longDate = (ymd: string) =>
  new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

const outline = "inline-flex items-center justify-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-ink-950 transition duration-200 motion-safe:hover:-translate-y-0.5 hover:border-slate-400 hover:bg-slate-50";
const primary = "inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white shadow-[0_10px_24px_-12px_rgba(37,99,235,.55)] transition duration-200 motion-safe:hover:-translate-y-0.5 hover:bg-primary-hover";

/**
 * The premium header: greeting, date, role line, quick actions and the notification bell. The greeting's
 * one-time entrance reuses the existing CSS `.anim-fade-up` (see globals.css) rather than a second,
 * JS-driven animation system — it is already reduced-motion-safe and never replays after mount, which is
 * exactly what a "plays once, then stays put" entrance needs; Framer Motion is reserved for the sign-in
 * page's more elaborate word-by-word choreography, where a simple CSS class could not do the job alone.
 */
export function DashboardHeader({ user, today, unreadNotifications, latestPayslipId, onDownloadPayslip }: {
  user: User;
  today: string;
  unreadNotifications: number;
  latestPayslipId: number | null;
  onDownloadPayslip: () => void;
}) {
  return (
    <div className="relative flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-[#f3f7ff] p-6 shadow-[0_1px_2px_rgba(16,31,58,.04),0_8px_24px_-14px_rgba(16,31,58,.1)]">
      <div className="min-w-0">
        <p className="anim-fade-up flex items-center gap-2.5 text-xs font-bold uppercase tracking-[0.18em] text-slate-500" style={{ "--i": 0 } as React.CSSProperties}>
          <span className="h-1.5 w-1.5 rounded-full bg-sun" aria-hidden="true" />
          {longDate(today)}
        </p>
        <h1 className="anim-fade-up mt-2 text-balance text-3xl font-extrabold tracking-tight text-ink-950 sm:text-4xl" style={{ "--i": 1 } as React.CSSProperties}>
          {greeting()}, <span className="text-amber-700">{user.fullName.split(" ")[0]}</span>
        </h1>
        <p className="anim-fade-up mt-1 text-sm text-slate-500" style={{ "--i": 2 } as React.CSSProperties}>
          {[user.designation, user.department].filter(Boolean).join(" · ")}
        </p>
        <div className="anim-fade-up mt-5 flex flex-wrap gap-2.5" style={{ "--i": 3 } as React.CSSProperties}>
          <Link href="/requests/new/leave" className={primary}>Apply for leave</Link>
          <Link href="/requests/new/attendance-update" className={outline}>Attendance Update</Link>
          {latestPayslipId != null && <button className={outline} onClick={onDownloadPayslip}>Download pay slip</button>}
          <MoreRequests className={outline} />
        </div>
      </div>
      <HeaderIllustration3D />
      <Link
        href="/notifications"
        className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition duration-200 hover:border-slate-300 hover:text-ink-950"
        aria-label={`Notifications (${unreadNotifications} unread)`}
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {unreadNotifications > 0 && (
          <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-sun px-1 text-center text-[10px] font-bold leading-[18px] text-ink-950">
            {unreadNotifications > 99 ? "99+" : unreadNotifications}
          </span>
        )}
      </Link>
    </div>
  );
}
