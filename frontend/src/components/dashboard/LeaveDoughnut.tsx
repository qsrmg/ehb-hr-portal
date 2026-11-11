"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, Empty } from "@/components/ui";

export type LeaveBalance = { leaveTypeId: number; name: string; code: string; available: number | null; entitled: number; carriedForward: number; pending: number };

// Blue/gold (the EHB brand pair) plus purple and teal for additional leave types, as requested; anything
// beyond these four categories cycles back through the same palette rather than inventing new colours.
const PALETTE: Record<string, string> = { AL: "#2563eb", CL: "#f5b700", SL: "#8b5cf6", ML: "#14b8a6", PL: "#14b8a6" };
const FALLBACK = ["#2563eb", "#f5b700", "#8b5cf6", "#14b8a6", "#64748b"];
const colorFor = (code: string, i: number) => PALETTE[code] ?? FALLBACK[i % FALLBACK.length]!;

/**
 * Each segment's size is the employee's *remaining* days for that leave type, as a share of their total
 * remaining days across every type that carries a quota — entitlement and days-used are shown separately
 * (the legend) but never blended into the segment math itself, so no percentage here mixes those up.
 */
export function LeaveDoughnut({ balances }: { balances: LeaveBalance[] }) {
  const rows = balances.filter((b) => b.available != null);
  const total = rows.reduce((s, b) => s + (b.available ?? 0), 0);
  const size = 168;
  const strokeWidth = 22;
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;

  const [animated, setAnimated] = useState(0); // 0..1, how much of the final arcs to show
  useEffect(() => {
    const id = requestAnimationFrame(() => setAnimated(1));
    return () => cancelAnimationFrame(id);
  }, [total]);

  const segments = rows.reduce<{ cumulative: number; list: Array<LeaveBalance & { color: string; frac: number; startFrac: number }> }>(
    (acc, b, i) => {
      const value = b.available ?? 0;
      const frac = total ? value / total : 0;
      const startFrac = total ? acc.cumulative / total : 0;
      return { cumulative: acc.cumulative + value, list: [...acc.list, { ...b, color: colorFor(b.code, i), frac, startFrac }] };
    },
    { cumulative: 0, list: [] },
  ).list;

  return (
    <Card title="Leave balance" actions={<Link href="/leave" className="text-sm font-semibold text-primary hover:underline">Details</Link>}>
      {rows.length === 0 ? (
        <Empty>No leave quotas apply to your record.</Empty>
      ) : (
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
          <div className="relative shrink-0" style={{ width: size, height: size }}>
            <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
              <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={strokeWidth} />
              {segments.map((s) => (
                <circle
                  key={s.leaveTypeId}
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
                  <title>{`${s.name}: ${s.available} day${s.available === 1 ? "" : "s"} left`}</title>
                </circle>
              ))}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-extrabold tabular-nums text-ink-950">{total}</span>
              <span className="text-xs font-medium text-slate-500">day{total === 1 ? "" : "s"} left</span>
            </div>
          </div>
          <div className="w-full min-w-0 space-y-3">
            {segments.map((s) => {
              const entitledTotal = s.entitled + s.carriedForward;
              const usedPct = entitledTotal ? Math.min(100, ((entitledTotal - (s.available ?? 0)) / entitledTotal) * 100) : 0;
              return (
                <div key={s.leaveTypeId}>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700">
                      <span className="h-2 w-2 rounded-full" style={{ background: s.color }} aria-hidden="true" />
                      {s.name}
                    </span>
                    <span className="text-slate-500">{s.available} of {entitledTotal} days left{s.pending ? ` · ${s.pending} pending` : ""}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full motion-safe:transition-[width] motion-safe:duration-[1100ms] motion-safe:ease-out"
                      style={{ width: `${animated * usedPct}%`, background: s.color }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}
