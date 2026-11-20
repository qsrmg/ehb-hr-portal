"use client";

import { useEffect, useState } from "react";

export type DoughnutSegment = { key: string; label: string; color: string; value: number };

/**
 * A stacked-segment donut (same maths as LeaveDoughnut's ring, generalised): each segment's arc length is
 * its share of the total. Draws once, growing from 0, the first time `segments` has a real total — a no-op
 * on later renders with the same totals, and instant (no motion) under prefers-reduced-motion.
 */
export function StatusDoughnut({
  segments, size = 168, strokeWidth = 20, centerValue, centerLabel, ariaLabel,
}: {
  segments: DoughnutSegment[];
  size?: number;
  strokeWidth?: number;
  centerValue: React.ReactNode;
  centerLabel: string;
  ariaLabel: string;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;

  const [animated, setAnimated] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setAnimated(1));
    return () => cancelAnimationFrame(id);
  }, [total]);

  const arcs = segments.reduce<{ cumulative: number; list: Array<DoughnutSegment & { frac: number; startFrac: number }> }>(
    (acc, s) => {
      const frac = total ? s.value / total : 0;
      const startFrac = total ? acc.cumulative / total : 0;
      return { cumulative: acc.cumulative + s.value, list: [...acc.list, { ...s, frac, startFrac }] };
    },
    { cumulative: 0, list: [] },
  ).list;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" role="img" aria-label={ariaLabel}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-track)" strokeWidth={strokeWidth} />
        {arcs.map((s) => (
          <circle
            key={s.key}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth={strokeWidth}
            strokeDasharray={`${s.frac * c * animated} ${c}`}
            strokeDashoffset={-s.startFrac * c}
            className="motion-safe:transition-[stroke-dasharray] motion-safe:duration-[1100ms] motion-safe:ease-out"
          >
            <title>{`${s.label}: ${s.value}`}</title>
          </circle>
        ))}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center" aria-hidden="true">
        <span className="text-2xl font-extrabold tabular-nums text-charcoal">{centerValue}</span>
        <span className="text-xs font-medium text-slate-500">{centerLabel}</span>
      </div>
    </div>
  );
}
