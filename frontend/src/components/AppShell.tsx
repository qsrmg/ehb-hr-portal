"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { hasRole, ROLE_LABELS, useAuth, type Role, type User } from "@/lib/auth";
import { api } from "@/lib/api";
import { Logo } from "@/components/brand";
import { Icon, type IconName } from "@/components/icons";
import { ActivityStrip } from "@/components/ActivityStrip";

// Signed-in layout: white sidebar with the menu for the user's roles, the user and Sign out at the bottom.

type NavItem = { href: string; label: string; icon: IconName; show?: (u: User) => boolean };
type NavGroup = { title: string | null; items: NavItem[] };

const isApprover = (u: User) => u.hasTeam || u.roles.some((r) => r !== "EMPLOYEE");
const any = (...roles: Role[]) => (u: User) => hasRole(u, ...roles);

const NAV: NavGroup[] = [
  {
    title: null,
    items: [
      { href: "/dashboard", label: "Dashboard", icon: "grid" },
      { href: "/attendance", label: "Attendance", icon: "clock" },
      { href: "/leave", label: "Leave", icon: "calendar" },
      { href: "/payslips", label: "Pay slips & tax", icon: "wallet" },
      { href: "/requests", label: "Requests", icon: "clipboard" },
      { href: "/tasks", label: "My tasks", icon: "checkCircle" },
      { href: "/performance", label: "Performance", icon: "chart" },
      { href: "/hiring", label: "Jobs and hiring", icon: "users" },
      { href: "/inventory", label: "My inventory", icon: "box" },
      { href: "/activity", label: "My activity", icon: "eye" },
      { href: "/policies", label: "Policies", icon: "shield" },
      { href: "/documents", label: "HR forms", icon: "file" },
      { href: "/profile", label: "My profile", icon: "user" },
    ],
  },
  {
    title: "Manage",
    items: [
      { href: "/approvals", label: "Approvals", icon: "inbox", show: isApprover },
      { href: "/team", label: "Team", icon: "users", show: (u) => u.hasTeam || hasRole(u, "HR", "MANAGEMENT") },
      { href: "/tasks/team", label: "Team tasks", icon: "checkCircle", show: (u) => u.hasTeam || hasRole(u, "HR") },
      { href: "/exits", label: "Exit clearance", icon: "logout", show: (u) => u.hasTeam || hasRole(u, "HR", "MANAGEMENT", "ADMIN", "FINANCE") },
    ],
  },
  {
    title: "HR Admin",
    items: [
      { href: "/admin/employees", label: "Employees", icon: "users", show: any("HR", "MANAGEMENT", "FINANCE", "ADMIN") },
      { href: "/admin/departments", label: "Departments", icon: "flow", show: any("HR", "HOD") },
      { href: "/admin/attendance", label: "Attendance import", icon: "clock", show: any("HR") },
      { href: "/admin/late-warnings", label: "Late warnings", icon: "bell", show: any("HR", "MANAGEMENT") },
      { href: "/admin/leave-types", label: "Leave types & quotas", icon: "calendar", show: any("HR") },
      { href: "/admin/holidays", label: "Holiday calendar", icon: "calendar", show: any("HR") },
      { href: "/admin/payroll", label: "Payroll upload", icon: "wallet", show: any("FINANCE", "HR") },
      { href: "/admin/expenses", label: "Expense claims", icon: "file", show: any("FINANCE", "HR", "MANAGEMENT") },
      { href: "/admin/travel", label: "Travel", icon: "arrowRight", show: any("ADMIN", "FINANCE", "HR", "MANAGEMENT") },
      { href: "/admin/assets", label: "Assets", icon: "box", show: any("ADMIN", "HR", "FINANCE", "MANAGEMENT") },
      { href: "/admin/activity", label: "Activity monitoring", icon: "eye", show: any("HR") },
      { href: "/admin/expense-settings", label: "Expense & travel settings", icon: "settings", show: any("FINANCE", "HR") },
      { href: "/admin/requests", label: "All requests", icon: "list", show: any("HR", "MANAGEMENT") },
      { href: "/admin/settings", label: "Rules & settings", icon: "settings", show: any("HR") },
      { href: "/admin/audit", label: "Audit log", icon: "shield", show: any("HR", "MANAGEMENT") },
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
  const roles = user.roles.filter((r) => r !== "EMPLOYEE").map((r) => ROLE_LABELS[r]).join(", ") || "Employee";
  const close = () => setOpen(false);

  const link = (item: { href: string; label: string; icon: IconName }, badge?: number) => {
    const active = isActive(item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={close}
        aria-current={active ? "page" : undefined}
        className={`group relative flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm font-semibold transition ${active ? "bg-blue-50 text-primary" : "text-dim hover:bg-gray-100 hover:text-charcoal"}`}
      >
        {active && <span aria-hidden="true" className="absolute -left-3 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r bg-primary" />}
        <Icon name={item.icon} className={`h-[18px] w-[18px] shrink-0 ${active ? "text-primary" : "text-slate-400 group-hover:text-charcoal"}`} />
        <span className="min-w-0 flex-1 leading-snug">{item.label}</span>
        {!!badge && <span className="rounded-full bg-sun px-1.5 text-[11px] font-bold leading-5 text-ink-950">{badge > 99 ? "99+" : badge}</span>}
      </Link>
    );
  };

  const sidebar = (
    <div className="flex h-full flex-col font-display">
      <div className="px-5 pb-3 pt-4">
        <Link href="/dashboard" onClick={close} aria-label="Dashboard"><Logo /></Link>
      </div>
      <nav className="no-scrollbar flex-1 space-y-4 overflow-y-auto px-3 pb-3" aria-label="Main">
        {NAV.map((group) => {
          const items = group.items.filter((i) => !i.show || i.show(user));
          if (!items.length) return null;
          return (
            <div key={group.title ?? "mine"} className="space-y-0.5">
              {group.title && <div className="px-3 pb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-dim/80">{group.title}</div>}
              {items.map((item) => link(item))}
            </div>
          );
        })}
      </nav>
      <div className="border-t border-line px-3 pb-3 pt-3">
        <div className="px-3">
          <div className="truncate text-sm font-bold text-charcoal">{user.fullName}</div>
          <div className="mt-0.5 text-xs text-dim">Employee code {user.code}</div>
          <div className="mt-0.5 truncate text-xs text-dim/80">{roles}</div>
        </div>
        <div className="mt-2 space-y-0.5">
          {link({ href: "/notifications", label: "Notifications", icon: "bell" }, unread)}
          {link({ href: "/change-password", label: "Change password", icon: "key" })}
          <button onClick={logout} className="flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-sm font-semibold text-dim transition hover:bg-gray-100 hover:text-charcoal">
            <Icon name="logout" className="h-[18px] w-[18px] text-slate-400" /> Sign out
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div data-testid="app-shell" className="flex min-h-screen bg-white">
      <aside className="hidden w-64 shrink-0 border-r border-line bg-white lg:block">
        <div className="sticky top-0 h-screen">{sidebar}</div>
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/50" onClick={close} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-line bg-white">
            <button onClick={close} className="absolute right-3 top-5 rounded-md p-1.5 text-dim hover:bg-gray-100 hover:text-charcoal" aria-label="Close menu">
              <Icon name="close" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Phones and tablets: the sidebar opens from this bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-white px-4 lg:hidden">
          <button className="rounded-md p-1.5 text-dim hover:bg-gray-100" onClick={() => setOpen(true)} aria-label="Open menu">
            <Icon name="menu" />
          </button>
          <Link href="/dashboard" aria-label="Dashboard"><Logo size="sm" /></Link>
          <div className="flex-1" />
          <Link href="/notifications" className="relative rounded-md p-1.5 text-dim hover:bg-gray-100" aria-label={`Notifications (${unread} unread)`}>
            <Icon name="bell" />
            {unread > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-sun px-1 text-center text-[10px] font-bold leading-4 text-ink-950">{unread > 99 ? "99+" : unread}</span>}
          </Link>
        </header>
        <div className="relative z-10 mx-auto w-full max-w-7xl px-4 pt-6 sm:px-6 lg:pt-8">
          <ActivityStrip />
        </div>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
