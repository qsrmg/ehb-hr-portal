"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { CalendarCheck, Clock3, ListChecks } from "lucide-react";
import { useReducedMotion } from "@/components/login3d/hooks";

const EASE = [0.22, 1, 0.36, 1] as const;

const KPIS = [
  { icon: Clock3, label: "On time", to: 92, suffix: "%" },
  { icon: CalendarCheck, label: "Leave left", to: 14, suffix: "d" },
  { icon: ListChecks, label: "Pending", to: 2, suffix: "" },
] as const;

const BARS = [16, 28, 22, 36, 26];
const RING_PCT = 62;

/** Counts up from 0 to `to` once, in-place to `to` (no animation frames) when reduced motion is preferred. */
function Count({ to, suffix, reduced }: { to: number; suffix: string; reduced: boolean }) {
  const [n, setN] = useState(reduced ? to : 0);
  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const start = performance.now();
    const duration = 900;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setN(Math.round(to * (1 - (1 - t) ** 3)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, reduced]);
  return <span>{n}{suffix}</span>;
}

const container = { hidden: {}, show: { transition: { staggerChildren: 0.12, delayChildren: 0.1 } } };
const item = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } } };

/**
 * Variant B — "Animated product preview": a flat, self-contained mock of the signed-in dashboard (no real
 * data, no charting library — plain SVG/CSS) whose tiles fade in with a stagger, whose KPI numbers count up
 * once, and which floats gently; all three are skipped outright under prefers-reduced-motion.
 */
export function SceneB({ className = "" }: { className?: string }) {
  const reduced = useReducedMotion();
  const r = 20;
  const c = 2 * Math.PI * r;

  return (
    <div className={`relative ${className}`} aria-hidden="true">
      <motion.div
        className="h-full"
        animate={reduced ? undefined : { y: [0, -6, 0] }}
        transition={reduced ? undefined : { duration: 6, repeat: Infinity, ease: "easeInOut" }}
      >
        <motion.div
          className="h-full overflow-hidden rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_30px_70px_-40px_rgba(16,31,58,.35)] sm:p-6"
          variants={container}
          initial={reduced ? false : "hidden"}
          animate="show"
        >
          <motion.div variants={item} className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-500">This week</span>
            <span className="h-2 w-2 rounded-full bg-primary" />
          </motion.div>

          <motion.div variants={item} className="mt-3 grid grid-cols-3 gap-2">
            {KPIS.map(({ icon: Icon, label, to, suffix }) => (
              <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-center">
                <Icon className="mx-auto h-4 w-4 text-primary" aria-hidden="true" />
                <div className="mt-1 text-base font-extrabold tabular-nums text-ink-950">
                  <Count to={to} suffix={suffix} reduced={reduced} />
                </div>
                <div className="text-[10px] font-semibold leading-tight text-slate-500">{label}</div>
              </div>
            ))}
          </motion.div>

          <motion.div variants={item} className="mt-4 flex items-end gap-1.5" style={{ height: 40 }}>
            {BARS.map((h, i) => (
              <motion.span
                key={i}
                className="flex-1 rounded-t-sm bg-primary/70"
                initial={reduced ? false : { height: 0 }}
                animate={{ height: h }}
                transition={{ duration: 0.6, delay: reduced ? 0 : 0.3 + i * 0.08, ease: EASE }}
              />
            ))}
          </motion.div>

          <motion.div variants={item} className="mt-4 flex items-center gap-3">
            <svg width={56} height={56} viewBox="0 0 56 56" className="-rotate-90" aria-hidden="true">
              <circle cx={28} cy={28} r={r} fill="none" stroke="var(--color-track)" strokeWidth={6} />
              <motion.circle
                cx={28} cy={28} r={r} fill="none" stroke="#2563eb" strokeWidth={6} strokeLinecap="round"
                initial={reduced ? false : { strokeDasharray: `0 ${c}` }}
                animate={{ strokeDasharray: `${(RING_PCT / 100) * c} ${c}` }}
                transition={{ duration: 0.9, ease: EASE }}
              />
            </svg>
            <div>
              <div className="text-sm font-bold text-ink-950">Leave balance</div>
              <div className="text-xs text-slate-500">{RING_PCT}% remaining this year</div>
            </div>
          </motion.div>
        </motion.div>
      </motion.div>
    </div>
  );
}
