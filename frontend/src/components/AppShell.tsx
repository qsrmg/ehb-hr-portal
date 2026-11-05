"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { hasRole, ROLE_LABELS, useAuth, type Role, type User } from "@/lib/auth";
import { api } from "@/lib/api";
import { Logo } from "@/components/brand";
import { Icon, type IconName } from "@/components/icons";

// Signed-in layout (design page 7): dark sidebar with the menu for the user's roles, the user and Sign out at the bottom.

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
      { href: "/performance", label: "Performance", icon: "chart" },
      { href: "/inventory", label: "My inventory", icon: "box" },
      { href: "/documents", label: "Policies and documents", icon: "file" },
      { href: "/profile", label: "My profile", icon: "user" },
    ],
  },
  {
    title: "Manage",
    items: [
      { href: "/approvals", label: "Approvals", icon: "inbox", show: isApprover },
      { href: "/team", label: "Team", icon: "users", show: (u) => u.hasTeam || hasRole(u, "HR", "MANAGEMENT") },
      { href: "/exits", label: "Exit clearance", icon: "logout", show: (u) => u.hasTeam || hasRole(u, "HR", "MANAGEMENT", "ADMIN", "FINANCE") },
    ],
  },
  {
    title: "HR Admin",
    items: [
      { href: "/admin/employees", label: "Employees", icon: "users", show: any("HR", "MANAGEMENT", "FINANCE", "ADMIN") },
      { href: "/admin/departments", label: "Departments", icon: "flow", show: any("HR") },
      { href: "/admin/attendance", label: "Attendance import", icon: "clock", show: any("HR") },
      { href: "/admin/late-warnings", label: "Late warnings", icon: "bell", show: any("HR", "MANAGEMENT") },
      { href: "/admin/leave-types", label: "Leave types & quotas", icon: "calendar", show: any("HR") },
      { href: "/admin/holidays", label: "Holiday calendar", icon: "calendar", show: any("HR") },
      { href: "/admin/payroll", label: "Payroll upload", icon: "wallet", show: any("FINANCE", "HR") },
      { href: "/admin/expenses", label: "Expense claims", icon: "file", show: any("FINANCE", "HR", "MANAGEMENT") },
      { href: "/admin/travel", label: "Travel", icon: "arrowRight", show: any("ADMIN", "FINANCE", "HR", "MANAGEMENT") },
      { href: "/admin/assets", label: "Assets", icon: "box", show: any("ADMIN", "HR", "FINANCE", "MANAGEMENT") },
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
  const wide = pathname === "/dashboard";
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
        className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition ${active ? "bg-primary/20 text-white" : "text-white/75 hover:bg-white/5 hover:text-white"}`}
      >
        {active && <span aria-hidden="true" className="absolute -left-3 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r bg-sun" />}
        <Icon name={item.icon} className={`h-[18px] w-[18px] shrink-0 ${active ? "text-white" : "text-white/60 group-hover:text-white"}`} />
        <span className="min-w-0 flex-1 leading-snug">{item.label}</span>
        {!!badge && <span className="rounded-full bg-sun px-1.5 text-[11px] font-bold leading-5 text-ink-950">{badge > 99 ? "99+" : badge}</span>}
      </Link>
    );
  };

  const sidebar = (
    <div className="flex h-full flex-col font-display">
      <div className="px-5 pb-4 pt-5">
        <Link href="/dashboard" onClick={close} aria-label="Dashboard"><Logo /></Link>
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4" aria-label="Main">
        {NAV.map((group) => {
          const items = group.items.filter((i) => !i.show || i.show(user));
          if (!items.length) return null;
          return (
            <div key={group.title ?? "mine"} className="space-y-0.5">
              {group.title && <div className="px-3 pb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-haze/80">{group.title}</div>}
              {items.map((item) => link(item))}
            </div>
          );
        })}
      </nav>
      <div className="border-t border-white/10 px-3 pb-4 pt-4">
        <div className="px-3">
          <div className="truncate text-sm font-bold text-white">{user.fullName}</div>
          <div className="mt-0.5 text-xs text-haze">Employee code {user.code}</div>
          <div className="mt-0.5 truncate text-xs text-haze/80">{roles}</div>
        </div>
        <div className="mt-3 space-y-0.5">
          {link({ href: "/notifications", label: "Notifications", icon: "bell" }, unread)}
          {link({ href: "/change-password", label: "Change password", icon: "key" })}
          <button onClick={logout} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold text-white/75 transition hover:bg-white/5 hover:text-white">
            <Icon name="logout" className="h-[18px] w-[18px] text-white/60" /> Sign out
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="portal-dark flex min-h-screen bg-ink-950">
      <aside className="hidden w-64 shrink-0 border-r border-white/5 bg-ink-900 lg:block">
        <div className="sticky top-0 h-screen">{sidebar}</div>
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/50" onClick={close} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-ink-900">
            <button onClick={close} className="absolute right-3 top-5 rounded-md p-1.5 text-white/70 hover:bg-white/10 hover:text-white" aria-label="Close menu">
              <Icon name="close" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Phones and tablets: the sidebar opens from this bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-white/5 bg-ink-900 px-4 lg:hidden">
          <button className="rounded-md p-1.5 text-white/80 hover:bg-white/10" onClick={() => setOpen(true)} aria-label="Open menu">
            <Icon name="menu" />
          </button>
          <Link href="/dashboard" aria-label="Dashboard"><Logo size="sm" /></Link>
          <div className="flex-1" />
          <Link href="/notifications" className="relative rounded-md p-1.5 text-white/80 hover:bg-white/10" aria-label={`Notifications (${unread} unread)`}>
            <Icon name="bell" />
            {unread > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-sun px-1 text-center text-[10px] font-bold leading-4 text-ink-950">{unread > 99 ? "99+" : unread}</span>}
          </Link>
        </header>
        <main className={`mx-auto w-full flex-1 px-4 py-6 sm:px-6 lg:py-8 ${wide ? "max-w-7xl" : "max-w-6xl"}`}>{children}</main>
      </div>
    </div>
  );
}
