"use client";

import { useState } from "react";
import { Alert, Button, Input, Select } from "@/components/ui";

export type Kpi = { perspective: string; title: string; measure: string; target: string; weight: number };

export const PERSPECTIVES: Record<string, string> = {
  FINANCIAL: "Financial",
  CUSTOMER: "Customer",
  INTERNAL_PROCESS: "Internal Process",
  LEARNING_GROWTH: "Learning & Growth",
};

export type KpiLimits = { maxKpis: number; minKpiWeight: number; minPerspectiveWeight: number };

/** The same checks the server makes, so the editor can show them while typing. */
export function kpiProblems(kpis: Kpi[], limits: KpiLimits) {
  const problems: string[] = [];
  if (!kpis.length) problems.push("Add at least one KPI");
  if (kpis.length > limits.maxKpis) problems.push(`Use at most ${limits.maxKpis} KPIs`);
  if (kpis.some((k) => k.weight < limits.minKpiWeight)) problems.push(`Every KPI needs at least ${limits.minKpiWeight}%`);
  const total = kpis.reduce((s, k) => s + (Number(k.weight) || 0), 0);
  if (kpis.length && total !== 100) problems.push(`The weights add up to ${total}%; they must total 100%`);
  if (limits.minPerspectiveWeight > 0) {
    for (const [p, label] of Object.entries(PERSPECTIVES)) {
      const w = kpis.filter((k) => k.perspective === p).reduce((s, k) => s + (Number(k.weight) || 0), 0);
      if (w < limits.minPerspectiveWeight) problems.push(`${label} has ${w}%; each perspective needs at least ${limits.minPerspectiveWeight}%`);
    }
  }
  return problems;
}

const empty = (): Kpi => ({ perspective: "CUSTOMER", title: "", measure: "", target: "", weight: 10 });

/** Balanced Scorecard KPIs: perspective, title, measure, target and weight per row; totals checked as you type. */
export function KpiEditor({
  initial, limits, saveLabel, onSave, children,
}: { initial: Kpi[]; limits: KpiLimits; saveLabel: string; onSave: (kpis: Kpi[]) => Promise<void>; children?: React.ReactNode }) {
  const [rows, setRows] = useState<Kpi[]>(initial.length ? initial : [empty()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const set = (i: number, patch: Partial<Kpi>) => {
    setSaved(false);
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };
  const problems = kpiProblems(rows, limits);
  const total = rows.reduce((s, k) => s + (Number(k.weight) || 0), 0);
  const byPerspective = Object.entries(PERSPECTIVES).map(([p, label]) => ({ label, weight: rows.filter((k) => k.perspective === p).reduce((s, k) => s + (Number(k.weight) || 0), 0) }));

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={i} className="rounded-xl p-3 ring-1 ring-slate-200" data-kpi-row={i}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">KPI {i + 1}</span>
              <Button size="sm" variant="ghost" onClick={() => { setSaved(false); setRows(rows.filter((_, j) => j !== i)); }} disabled={rows.length === 1}>Remove</Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-[11rem_minmax(0,1fr)_6rem]">
              <Select aria-label={`Perspective of KPI ${i + 1}`} value={r.perspective} onChange={(e) => set(i, { perspective: e.target.value })}>
                {Object.entries(PERSPECTIVES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
              <Input aria-label={`Title of KPI ${i + 1}`} placeholder="KPI, e.g. Deliver sprints on time" value={r.title} onChange={(e) => set(i, { title: e.target.value })} />
              <div className="relative">
                <Input aria-label={`Weight of KPI ${i + 1} (%)`} type="number" min={limits.minKpiWeight} max={100} value={r.weight} onChange={(e) => set(i, { weight: Number(e.target.value) })} className="pr-7" />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">%</span>
              </div>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <Input aria-label={`Measure of KPI ${i + 1}`} placeholder="How it is measured" value={r.measure} onChange={(e) => set(i, { measure: e.target.value })} />
              <Input aria-label={`Target of KPI ${i + 1}`} placeholder="Target" value={r.target} onChange={(e) => set(i, { target: e.target.value })} />
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="secondary" onClick={() => { setSaved(false); setRows([...rows, empty()]); }} disabled={rows.length >= limits.maxKpis}>Add KPI</Button>
        <span className={`text-sm font-semibold ${total === 100 ? "text-emerald-700" : "text-amber-700"}`}>Total {total}%</span>
        <span className="text-xs text-slate-500">{byPerspective.map((p) => `${p.label} ${p.weight}%`).join(" · ")}</span>
      </div>
      {problems.length > 0 && (
        <Alert kind="warning">
          <ul className="list-disc pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </Alert>
      )}
      {error && <Alert>{error}</Alert>}
      {saved && <Alert kind="success">Saved.</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await onSave(rows.map((r) => ({ ...r, weight: Number(r.weight) })));
              setSaved(true);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {saveLabel}
        </Button>
        {children}
      </div>
    </div>
  );
}
