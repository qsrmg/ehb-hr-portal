"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { CountUp } from "@/components/landing/motion";

const TONE: Record<string, string> = {
  primary: "bg-primary/10 text-primary",
  sun: "bg-sun/20 text-amber-700",
  emerald: "bg-emerald-50 text-emerald-700",
  red: "bg-red-50 text-red-700",
  violet: "bg-violet-50 text-violet-700",
};

/**
 * One premium KPI card. `value` is the real number from the backend; when it's `null` (the data does not
 * apply to this user's role, e.g. HR-only stats for a regular employee) a plain "Not shown for your role"
 * state is used instead of a fabricated number. The count-up only plays once, when the card first has a
 * real value to show (see CountUp — it fires once on first appearing in view, and skips itself under
 * prefers-reduced-motion).
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
    <div className="group h-full rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(16,31,58,.04),0_8px_24px_-14px_rgba(16,31,58,.14)] transition duration-200 motion-safe:hover:-translate-y-0.5 hover:shadow-[0_14px_34px_-14px_rgba(16,31,58,.22)] hover:border-slate-300">
      <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${TONE[tone]}`}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="mt-4 text-sm font-semibold text-slate-500">{label}</div>
      <div data-testid="kpi-value" className="mt-1 text-3xl font-extrabold tabular-nums text-charcoal">
        {value == null ? <span className="text-base font-semibold text-slate-500">{unavailable ?? "Not shown for your role"}</span> : <CountUp value={value} />}
      </div>
      {hint && <div className="mt-1.5 text-xs text-slate-500">{hint}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block h-full rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
      {body}
    </Link>
  ) : (
    body
  );
}
