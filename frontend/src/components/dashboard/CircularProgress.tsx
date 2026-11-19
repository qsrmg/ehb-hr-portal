"use client";

import { useEffect, useState } from "react";

/**
 * A ring that draws from 0 to `percent` once, the first time it has a real value (no further movement after
 * that — re-renders with the same percent are a no-op). `motion-safe:` keeps the actual CSS transition out
 * of the stylesheet under prefers-reduced-motion, so there it jumps straight to the final ring with no motion.
 */
export function CircularProgress({
  percent, color, trackColor = "var(--color-track)", size = 96, strokeWidth = 10, centerLabel,
}: {
  percent: number;
  color: string;
  trackColor?: string;
  size?: number;
  strokeWidth?: number;
  centerLabel?: React.ReactNode;
}) {
  const [animated, setAnimated] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setAnimated(percent));
    return () => cancelAnimationFrame(id);
  }, [percent]);

  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.max(0, Math.min(100, animated)) / 100) * c;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={trackColor} strokeWidth={strokeWidth} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          className="motion-safe:transition-[stroke-dashoffset] motion-safe:duration-[1100ms] motion-safe:ease-out"
          style={{ filter: `drop-shadow(0 0 3px ${color}55)` }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{centerLabel}</div>
    </div>
  );
}
