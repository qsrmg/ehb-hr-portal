"use client";

import { CalendarDays, ClipboardList, ListTodo } from "lucide-react";
import { OrbitScene3D, type OrbitNodeDef } from "@/components/orbit/OrbitScene3D";
import { fmtDate } from "@/lib/format";
import type { Holiday } from "./ComingUp";

const NODES: OrbitNodeDef[] = [
  { icon: "calendar", label: "Attendance" },
  { icon: "users", label: "Leave" },
  { icon: "coins", label: "Pay Slips" },
  { icon: "idCard", label: "Requests" },
  { icon: "folder", label: "Performance", accent: "sun" },
];

export type TodaySummary = { pendingRequests: number; tasksDue: number; nextHoliday: Holiday | null };

/**
 * Stands in for the live 3D scene whenever OrbitScene3D falls back (WebGL missing, viewport under 820px,
 * reduced motion, or a lost context) — real numbers already on this page, in the same calm-card chrome as
 * OrbitScene3D's own default fallback (SceneA). SceneA itself is the sign-in page's marketing card: its
 * logo and "Everything your workday needs" copy belong there, not inside the signed-in dashboard, so this
 * header passes its own fallback instead of taking OrbitScene3D's default.
 */
function TodayFallback({ pendingRequests, tasksDue, nextHoliday, className = "" }: TodaySummary & { className?: string }) {
  const rows = [
    { icon: ClipboardList, value: String(pendingRequests), label: `pending request${pendingRequests === 1 ? "" : "s"}` },
    { icon: ListTodo, value: String(tasksDue), label: `task${tasksDue === 1 ? "" : "s"} due` },
    ...(nextHoliday ? [{ icon: CalendarDays, value: fmtDate(nextHoliday.date), label: nextHoliday.name }] : []),
  ];
  return (
    <div className={`relative ${className}`} aria-hidden="true">
      <div className="relative h-full overflow-hidden rounded-[28px] border border-slate-200 bg-gradient-to-br from-sky-50 via-white to-blue-50 shadow-[0_30px_70px_-40px_rgba(16,31,58,.35)]">
        <span className="anim-drift will-change-transform absolute -left-10 -top-12 h-40 w-40 rounded-full bg-primary/15 blur-2xl" />
        <span className="anim-drift-2 will-change-transform absolute -bottom-14 -right-8 h-36 w-36 rounded-full bg-sun/20 blur-2xl" />
        <div className="relative flex h-full flex-col justify-center gap-3 p-6 sm:gap-4 sm:p-8">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Today</p>
          <ul className="space-y-2.5">
            {rows.map(({ icon: Icon, value, label }, i) => (
              <li key={i} className="flex items-center gap-3">
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-primary ring-1 ring-slate-200 shadow-sm">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="text-sm leading-tight text-ink-950">
                  <span className="font-bold">{value}</span> <span className="text-slate-600">· {label}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/**
 * The dashboard header's hero illustration: the same "hub and orbit" scene as the sign-in page
 * (components/orbit/OrbitScene3D), compact and light-themed to sit on the header's white-to-pale-blue
 * card. Gating (WebGL/viewport/reduced-motion/on-screen) is entirely OrbitScene3D's own; only the static
 * fallback is overridden here (see TodayFallback). Below `xl` it sits in normal flow, smaller, below the
 * quick-action buttons (live or static, whichever OrbitScene3D's own width gate already picks); at `xl` and
 * up it becomes an absolute overlay filling the header's full height on the right, fading in from the left
 * edge.
 */
export function HeaderOrbit3D({ summary }: { summary: TodaySummary }) {
  return (
    <div
      aria-hidden="true"
      className="relative mt-1 h-[160px] w-full xl:pointer-events-none xl:absolute xl:inset-y-0 xl:right-0 xl:mt-0 xl:h-auto xl:w-1/2 xl:overflow-hidden xl:[-webkit-mask-image:linear-gradient(to_right,transparent_0%,black_16%)] xl:[mask-image:linear-gradient(to_right,transparent_0%,black_16%)]"
    >
      <OrbitScene3D
        nodes={NODES}
        hubTitle="EHB"
        hubSubtitle="HR WORKSPACE"
        compact
        glowRing
        fallback={<TodayFallback {...summary} className="h-full w-full xl:absolute xl:inset-0" />}
        className="h-full w-full xl:absolute xl:inset-0"
      />
    </div>
  );
}
