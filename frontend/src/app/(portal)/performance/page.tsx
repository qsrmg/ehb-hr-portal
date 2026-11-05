"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Empty, Field, Input, PageHeader, Spinner, StatusBadge, Table, Tabs, Td } from "@/components/ui";
import { KpiEditor, PERSPECTIVES, type Kpi } from "@/components/KpiEditor";
import { hasRole, useAuth } from "@/lib/auth";
import { post, put } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { fmtDate } from "@/lib/format";

type Summary = {
  id: number; stage: string; stageLabel: string; nextAction: string | null;
  cycle: { id: number; name: string; status: string; startDate: string; endDate: string };
  employee: { id: number; fullName: string; code: string; department: string | null };
  finalBand: string | null; finalScore: number | null;
};
type Cycle = { id: number; name: string; status: string; startDate: string; endDate: string; reviewDueDate: string; total: number; done: number };
type Template = { departmentId: number; department: string; kpis: Kpi[]; updatedAt: string | null; updatedBy: string | null };
type Rules = { maxKpis: number; minKpiWeight: number; minPerspectiveWeight: number; joinerMonths: number; labels: Record<number, string>; bands: { rating: number; from: number; label: string }[] };

function NextAction({ text }: { text: string | null }) {
  if (!text) return null;
  return <span className="rounded-full bg-sun px-2.5 py-0.5 text-xs font-bold text-ink-950">{text}</span>;
}

function MyScorecards() {
  const { data, loading, error } = useApi<Summary[]>("/performance/mine");
  if (loading && !data) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  if (!data?.length) return <Empty>You are not in a performance cycle yet. HR starts the cycles twice a year.</Empty>;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {data.map((s) => (
        <Link key={s.id} href={`/performance/${s.id}`} className="block rounded-2xl bg-ink-800/80 p-5 ring-1 ring-line/80 transition hover:ring-white/30">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="font-display text-lg font-bold text-white">{s.cycle.name}</div>
              <div className="text-sm text-slate-500">{fmtDate(s.cycle.startDate)} to {fmtDate(s.cycle.endDate)}</div>
            </div>
            <StatusBadge status={s.stage} label={s.stageLabel} />
          </div>
          {s.finalBand && (
            <div className="mt-4 flex items-baseline gap-2">
              <span className="font-display text-3xl font-extrabold text-white">{s.finalScore?.toFixed(2)}</span>
              <span className="text-sm text-slate-500">of 5 · {s.finalBand}</span>
            </div>
          )}
          <div className="mt-4"><NextAction text={s.nextAction} /></div>
        </Link>
      ))}
    </div>
  );
}

function TeamScorecards() {
  const { data, loading, error } = useApi<Summary[]>("/performance/team");
  if (loading && !data) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  return (
    <Table head={["Employee", "Cycle", "Stage", "Result", "To do"]} empty="No scorecards for your team yet.">
      {data?.map((s) => (
        <tr key={s.id} className="hover:bg-slate-50">
          <Td>
            <Link href={`/performance/${s.id}`} className="font-medium text-accent hover:underline">{s.employee.fullName}</Link>
            <div className="text-xs text-slate-500">{s.employee.code}{s.employee.department ? ` · ${s.employee.department}` : ""}</div>
          </Td>
          <Td>{s.cycle.name}</Td>
          <Td><StatusBadge status={s.stage} label={s.stageLabel} /></Td>
          <Td>{s.finalBand ? `${s.finalScore?.toFixed(2)} · ${s.finalBand}` : "—"}</Td>
          <Td><NextAction text={s.nextAction} /></Td>
        </tr>
      ))}
    </Table>
  );
}

function StartCycle({ onDone }: { onDone: (id: number) => void }) {
  const [f, setF] = useState({ name: "", startDate: "", endDate: "", goalsDueDate: "", checkInDate: "", reviewOpensDate: "", reviewDueDate: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const { id } = await post<{ id: number }>("/performance/cycles", f);
          onDone(id);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {error && <Alert>{error}</Alert>}
      <Field label="Name"><Input required value={f.name} onChange={set("name")} placeholder="e.g. January to June 2027" /></Field>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Cycle starts"><Input type="date" required value={f.startDate} onChange={set("startDate")} /></Field>
        <Field label="Cycle ends"><Input type="date" required value={f.endDate} onChange={set("endDate")} /></Field>
        <Field label="Goals due"><Input type="date" required value={f.goalsDueDate} onChange={set("goalsDueDate")} /></Field>
        <Field label="Check-in" hint="Empty = three months after the start"><Input type="date" value={f.checkInDate} onChange={set("checkInDate")} /></Field>
        <Field label="Review opens"><Input type="date" required value={f.reviewOpensDate} onChange={set("reviewOpensDate")} /></Field>
        <Field label="Review due"><Input type="date" required value={f.reviewDueDate} onChange={set("reviewDueDate")} /></Field>
      </div>
      <p className="text-xs text-slate-500">Everyone active is included, plus people who join in the first months of the cycle (Rules &amp; settings). Scorecards start from their department&apos;s template and Line Managers are asked to set goals.</p>
      <Button type="submit" loading={busy}>Start cycle</Button>
    </form>
  );
}

function Cycles({ canManage }: { canManage: boolean }) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const { data, loading, error } = useApi<Cycle[]>("/performance/cycles");
  return (
    <div className="space-y-4">
      {canManage && !starting && <Button onClick={() => setStarting(true)}>Start a cycle</Button>}
      {starting && (
        <Card title="Start a performance cycle" actions={<Button variant="ghost" size="sm" onClick={() => setStarting(false)}>Close</Button>}>
          <StartCycle onDone={(id) => router.push(`/performance/cycles/${id}`)} />
        </Card>
      )}
      {loading && !data ? <Spinner /> : error ? <Alert>{error}</Alert> : (
        <Table head={["Cycle", "Period", "Review due", "Results released", "Status"]} empty="No cycles yet.">
          {data?.map((c) => (
            <tr key={c.id} className="hover:bg-slate-50">
              <Td><Link href={`/performance/cycles/${c.id}`} className="font-medium text-accent hover:underline">{c.name}</Link></Td>
              <Td>{fmtDate(c.startDate)} to {fmtDate(c.endDate)}</Td>
              <Td>{fmtDate(c.reviewDueDate)}</Td>
              <Td>{c.done} of {c.total}</Td>
              <Td><StatusBadge status={c.status} /></Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

function Templates({ canEdit, rules }: { canEdit: boolean; rules: Rules }) {
  const { data, loading, error, reload } = useApi<Template[]>("/performance/templates");
  const [editing, setEditing] = useState<number | null>(null);
  if (loading && !data) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Each department&apos;s KPIs. New scorecards start from them and the Line Manager adjusts them. At most {rules.maxKpis} KPIs, each at least {rules.minKpiWeight}%, together 100%
        {rules.minPerspectiveWeight > 0 ? `, at least ${rules.minPerspectiveWeight}% per perspective` : ""}.
      </p>
      {data?.map((t) => (
        <Card
          key={t.departmentId}
          title={t.department}
          actions={canEdit && editing !== t.departmentId ? <Button size="sm" variant="secondary" onClick={() => setEditing(t.departmentId)}>{t.kpis.length ? "Edit template" : "Create template"}</Button> : null}
        >
          {editing === t.departmentId ? (
            <KpiEditor
              initial={t.kpis}
              limits={rules}
              saveLabel="Save template"
              onSave={async (kpis) => {
                await put(`/performance/templates/${t.departmentId}`, { kpis });
                await reload();
                setEditing(null);
              }}
            >
              <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            </KpiEditor>
          ) : t.kpis.length ? (
            <>
              <ul className="divide-y divide-white/10">
                {t.kpis.map((k, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span><span className="text-slate-500">{PERSPECTIVES[k.perspective]}</span> · <span className="font-medium text-white">{k.title}</span> <span className="text-slate-500">(target {k.target})</span></span>
                    <span className="font-semibold tabular-nums">{k.weight}%</span>
                  </li>
                ))}
              </ul>
              {t.updatedBy && <p className="mt-2 text-xs text-slate-500">Last changed by {t.updatedBy}</p>}
            </>
          ) : (
            <p className="text-sm text-slate-500">No template yet: Line Managers start from an empty scorecard.</p>
          )}
        </Card>
      ))}
    </div>
  );
}

export default function PerformancePage() {
  const { user } = useAuth();
  const hr = hasRole(user, "HR");
  const overview = hasRole(user, "HR", "MANAGEMENT");
  const managesPeople = !!user?.hasTeam || hr;
  const { data: rules } = useApi<Rules>("/performance/rules");
  const tabs = [
    { value: "mine" as const, label: "My scorecards" },
    ...(managesPeople ? [{ value: "team" as const, label: hr ? "My team and appeals" : "My team" }] : []),
    ...(overview ? [{ value: "cycles" as const, label: "Cycles" }, { value: "templates" as const, label: "Department templates" }] : []),
  ];
  const [tab, setTab] = useState<(typeof tabs)[number]["value"]>("mine");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Performance"
        subtitle="Six-monthly Balanced Scorecard: goals agreed at the start, a check-in at three months, then a self-review, the Line Manager's ratings and sign-off by the HOD and HR."
      />
      {rules && (
        <p className="text-xs text-slate-500">
          Scale: {[1, 2, 3, 4, 5].map((n) => `${n} ${rules.labels[n]}`).join(" · ")}. Ratings are seen only by you, your Line Manager, your HOD, HR and Management.
        </p>
      )}
      <Tabs value={tab} onChange={setTab} options={tabs} />
      {tab === "mine" && <MyScorecards />}
      {tab === "team" && <Card><TeamScorecards /></Card>}
      {tab === "cycles" && <Cycles canManage={hr} />}
      {tab === "templates" && rules && <Templates canEdit={hr} rules={rules} />}
    </div>
  );
}
