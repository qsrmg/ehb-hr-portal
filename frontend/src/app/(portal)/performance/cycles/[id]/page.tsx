"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Alert, Button, Card, Field, Info, PageHeader, Select, Spinner, StatusBadge, Table, Td } from "@/components/ui";
import { post } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { fmtDate } from "@/lib/format";

type Overview = {
  id: number; name: string; status: string; startDate: string; endDate: string; goalsDueDate: string; checkInDate: string | null;
  reviewOpensDate: string; reviewDueDate: string; closedAt: string | null; joinersUntil: string;
  stages: { stage: string; label: string; count: number }[];
  distribution: { rating: number; band: string; count: number }[];
  scorecards: {
    id: number; stage: string; stageLabel: string; late: boolean; finalScore: number | null; finalBand: string | null;
    employee: { id: number; fullName: string; code: string; department: string | null; manager: string | null };
  }[];
  canManage: boolean;
};
type Option = { id: number; fullName: string; code: string };

export default function CycleOverviewPage() {
  const { id } = useParams<{ id: string }>();
  const { data: c, loading, error, reload } = useApi<Overview>(`/performance/cycles/${id}`);
  const people = useApi<Option[]>(c?.canManage ? "/employees" : null);
  const [employeeId, setEmployeeId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  if (loading && !c) return <Spinner />;
  if (error || !c) return <Alert>{error}</Alert>;

  const run = async (key: string, fn: () => Promise<unknown>, success: string) => {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
      setMsg({ kind: "success", text: success });
      await reload();
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };
  const released = c.distribution.reduce((s, d) => s + d.count, 0);
  const max = Math.max(1, ...c.distribution.map((d) => d.count));
  const inCycle = new Set(c.scorecards.map((s) => s.employee.id));

  return (
    <div className="space-y-6">
      <PageHeader
        title={c.name}
        subtitle={<>{fmtDate(c.startDate)} to {fmtDate(c.endDate)} · {c.scorecards.length} scorecards</>}
        actions={c.canManage ? (
          <Button variant="secondary" loading={busy === "close"} onClick={() => confirm("Close this cycle? Scorecards become read-only.") && run("close", () => post(`/performance/cycles/${c.id}/close`), "Cycle closed.")}>Close cycle</Button>
        ) : null}
      />
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <div className="flex flex-wrap items-center gap-3"><StatusBadge status={c.status} /><Link href="/performance" className="text-sm text-accent hover:underline">All cycles</Link></div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Where everyone is" className="lg:col-span-2">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {c.stages.map((s) => (
              <div key={s.stage} className="rounded-xl bg-ink-700/60 px-4 py-3">
                <div className="font-display text-2xl font-extrabold tabular-nums text-white">{s.count}</div>
                <div className="text-xs text-slate-500">{s.label}</div>
              </div>
            ))}
          </div>
        </Card>
        <Card title={`Rating distribution (${released} released)`}>
          <ul className="space-y-2.5" aria-label="Rating distribution">
            {c.distribution.map((d) => (
              <li key={d.rating}>
                <div className="flex justify-between text-sm"><span>{d.rating} · {d.band}</span><span className="tabular-nums text-white">{d.count}</span></div>
                <div className="mt-1 h-2 rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-primary to-[#7ea6ff]" style={{ width: `${(d.count / max) * 100}%` }} /></div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="Timeline">
        <dl className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <Info label="Goals due" value={fmtDate(c.goalsDueDate)} />
          <Info label="Check-in" value={c.checkInDate ? fmtDate(c.checkInDate) : null} />
          <Info label="Review opens" value={fmtDate(c.reviewOpensDate)} />
          <Info label="Review due" value={fmtDate(c.reviewDueDate)} />
          <Info label="Joiners included until" value={fmtDate(c.joinersUntil)} />
        </dl>
      </Card>

      <Card title="Scorecards">
        <Table head={["Employee", "Department", "Line manager", "Stage", "Result"]} empty="No scorecards.">
          {c.scorecards.map((s) => (
            <tr key={s.id} className="hover:bg-slate-50">
              <Td><Link href={`/performance/${s.id}`} className="font-medium text-accent hover:underline">{s.employee.fullName}</Link><div className="text-xs text-slate-500">{s.employee.code}</div></Td>
              <Td>{s.employee.department ?? "—"}</Td>
              <Td>{s.employee.manager ?? "HR"}</Td>
              <Td><span className="inline-flex items-center gap-2"><StatusBadge status={s.stage} label={s.stageLabel} />{s.late && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">Late</span>}</span></Td>
              <Td>{s.finalBand ? `${s.finalScore?.toFixed(2)} · ${s.finalBand}` : "—"}</Td>
            </tr>
          ))}
        </Table>
        {c.canManage && (
          <div className="mt-5 flex flex-wrap items-end gap-3 border-t border-white/10 pt-4">
            <Field label="Add an employee to this cycle" className="min-w-64 flex-1">
              <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                <option value="">Choose…</option>
                {people.data?.filter((p) => !inCycle.has(p.id)).map((p) => <option key={p.id} value={p.id}>{p.fullName} ({p.code})</option>)}
              </Select>
            </Field>
            <Button disabled={!employeeId} loading={busy === "add"} onClick={() => run("add", () => post(`/performance/cycles/${c.id}/scorecards`, { employeeId: Number(employeeId) }), "Added; their Line Manager has been asked to set goals.")}>Add</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
