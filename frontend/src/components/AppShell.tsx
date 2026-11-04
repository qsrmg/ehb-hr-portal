"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { hasRole, ROLE_LABELS, useAuth, type Role, type User } from "@/lib/auth";
import { api } from "@/lib/api";

type NavItem = { href: string; label: string; show?: (u: User) => boolean };
type NavGroup = { title: string; items: NavItem[]; show?: (u: User) => boolean };

const isApprover = (u: User) => u.hasTeam || u.roles.some((r) => r !== "EMPLOYEE");
const any = (...roles: Role[]) => (u: User) => hasRole(u, ...roles);

const NAV: NavGroup[] = [
  {
    title: "My HR",
    items: [
      { href: "/dashboard", label: "Dashboard" },
      { href: "/profile", label: "My Profile" },
      { href: "/attendance", label: "Attendance" },
      { href: "/leave", label: "Leave" },
      { href: "/requests", label: "My Requests" },
      { href: "/inventory", label: "My Inventory" },
      { href: "/payslips", label: "Pay Slips & Tax" },
      { href: "/documents", label: "Policies & Forms" },
    ],
  },
  {
    title: "Manage",
    show: isApprover,
    items: [
      { href: "/approvals", label: "Approvals" },
      { href: "/team", label: "Team", show: (u) => u.hasTeam || hasRole(u, "HR", "MANAGEMENT") },
    ],
  },
  {
    title: "HR Admin",
    show: any("HR", "MANAGEMENT", "FINANCE", "ADMIN"),
    items: [
      { href: "/admin/employees", label: "Employees", show: any("HR", "MANAGEMENT", "FINANCE", "ADMIN") },
      { href: "/admin/departments", label: "Departments", show: any("HR") },
      { href: "/admin/attendance", label: "Attendance Import", show: any("HR") },
      { href: "/admin/late-warnings", label: "Late Warnings", show: any("HR", "MANAGEMENT") },
      { href: "/admin/leave-types", label: "Leave Types & Quotas", show: any("HR") },
      { href: "/admin/holidays", label: "Holiday Calendar", show: any("HR") },
      { href: "/admin/payroll", label: "Payroll Upload", show: any("FINANCE", "HR") },
      { href: "/admin/expenses", label: "Expense Claims", show: any("FINANCE", "HR", "MANAGEMENT") },
      { href: "/admin/travel", label: "Travel", show: any("ADMIN", "FINANCE", "HR", "MANAGEMENT") },
      { href: "/admin/assets", label: "Assets", show: any("ADMIN", "HR", "FINANCE", "MANAGEMENT") },
      { href: "/exits", label: "Exit Clearance", show: (u) => u.hasTeam || hasRole(u, "HR", "MANAGEMENT", "ADMIN", "FINANCE") },
      { href: "/admin/expense-settings", label: "Expense & Travel Settings", show: any("FINANCE", "HR") },
      { href: "/admin/requests", label: "All Requests", show: any("HR", "MANAGEMENT") },
      { href: "/admin/settings", label: "Rules & Settings", show: any("HR") },
      { href: "/admin/audit", label: "Audit Log", show: any("HR", "MANAGEMENT") },
    ],
  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    api<{ unread: number }>("/notifications").then((r) => setUnread(r.unread)).catch(() => {});
  }, [pathname]);

  if (!user) return null;

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const nav = (
    <nav className="flex flex-col gap-5 px-3 py-4">
      {NAV.filter((g) => !g.show || g.show(user)).map((group) => (
        <div key={group.title}>
          <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-white/50">{group.title}</div>
          {group.items
            .filter((i) => !i.show || i.show(user))
            .map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={`block rounded-md px-2 py-1.5 text-sm ${isActive(item.href) ? "bg-white/15 font-medium text-white" : "text-white/75 hover:bg-white/10 hover:text-white"}`}
              >
                {item.label}
              </Link>
            ))}
        </div>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 bg-brand lg:block">
        <div className="sticky top-0 max-h-screen overflow-y-auto">
          <Brand />
          {nav}
        </div>
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 overflow-y-auto bg-brand">
            <Brand />
            {nav}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4">
          <button className="rounded p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 5h14M3 10h14M3 15h14" /></svg>
          </button>
          <div className="flex-1" />
          <Link href="/notifications" className="relative rounded p-1.5 text-slate-600 hover:bg-slate-100" aria-label={`Notifications (${unread} unread)`}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M10 3a5 5 0 0 0-5 5v3l-1.5 2.5h13L15 11V8a5 5 0 0 0-5-5zM8 16a2 2 0 0 0 4 0" /></svg>
            {unread > 0 && (
              <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-red-600 px-1 text-center text-[10px] font-semibold leading-4 text-white">{unread > 99 ? "99+" : unread}</span>
            )}
          </Link>
          <div className="hidden text-right sm:block">
            <div className="text-sm font-medium text-slate-800">{user.fullName}</div>
            <div className="text-xs text-slate-500">
              {user.code} · {user.roles.filter((r) => r !== "EMPLOYEE").map((r) => ROLE_LABELS[r]).join(", ") || "Employee"}
            </div>
          </div>
          <Link href="/change-password" className="hidden rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 md:block">Password</Link>
          <button onClick={logout} className="rounded px-2 py-1 text-sm text-slate-600 hover:bg-slate-100">Log out</button>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="border-b border-white/10 px-5 py-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-white/60">EHB Technologies</div>
      <div className="text-lg font-semibold text-white">HR Portal</div>
    </div>
  );
}
