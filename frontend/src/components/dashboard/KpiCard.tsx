"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { CountUp } from "@/components/landing/motion";

const TONE: Record<string, string> = {
  primary: "bg-gradient-to-br from-blue-100 to-blue-50 text-primary",
  sun: "bg-gradient-to-br from-amber-100 to-amber-50 text-amber-700",
  emerald: "bg-gradient-to-br from-emerald-100 to-emerald-50 text-emerald-700",
  red: "bg-gradient-to-br from-red-100 to-red-50 text-red-700",
  violet: "bg-gradient-to-br from-violet-100 to-violet-50 text-violet-700",
};

/**
 * One premium KPI card. `value` is the real number from the backend; when it's `null` (the data does not
 * apply to this user's role, e.g. HR-only stats for a regular employee) a plain "Not shown for your role"
 * state is used instead of a fabricated number. The count-up only plays once, when the card first has a
 * real value to show (see CountUp — it fires once on first appearing in view, and skips itself under
 * prefers-reduced-motion). No chart or sparkline here, decorative or otherwise: this card has no genuine
 * small time series behind it.
 */
export function KpiCard({
  label, value, icon: Icon, tone = "primary", hint, href, unavailable,
}: {
  label: string;
  value: number | null;
  icon: LucideIcon;
  tone?: keyof typeof TONE;
  hint?: string;
  href?: string;
  unavailable?: string;
}) {
  const body = (
    <div className="group flex min-h-[110px] items-center gap-4 rounded-[20px] border border-[#e5e7eb] bg-white/80 p-4 shadow-[0_10px_30px_rgba(37,99,235,0.08)] ring-1 ring-inset ring-white/60 backdrop-blur-sm transition duration-200 motion-safe:hover:-translate-y-0.5 hover:shadow-[0_14px_34px_rgba(37,99,235,0.12)] hover:border-slate-300">
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${TONE[tone]}`}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] text-slate-500">{label}</div>
        <div data-testid="kpi-value" className="mt-0.5 truncate text-[30px] font-extrabold leading-tight tabular-nums text-charcoal">
          {value == null ? <span className="text-sm font-semibold text-slate-500">{unavailable ?? "Not shown for your role"}</span> : <CountUp value={value} />}
        </div>
        {hint && <div className="mt-0.5 truncate text-[12px] text-slate-500">{hint}</div>}
      </div>
    </div>
  );
  return href ? (
    <Link href={href} className="block h-full rounded-[20px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
      {body}
    </Link>
  ) : (
    body
  );
}
