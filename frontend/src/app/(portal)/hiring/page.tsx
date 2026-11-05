"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Alert, Button, Card, Empty, Input, LinkButton, PageHeader, Spinner, StatusBadge, Table, Tabs, Td } from "@/components/ui";
import { hasRole, useAuth } from "@/lib/auth";
import { post, put } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { fmtDate } from "@/lib/format";

type Job = { id: number; title: string; department: string; reportsTo: string | null; employmentType: string; headcount: number; closingDate: string | null; myApplication: { id: number; stage: string; stageLabel: string } | null };
type Application = { id: number; stage: string; stageLabel: string; appliedAt: string; job: { id: number; title: string; department: string; closingDate: string | null }; canWithdraw: boolean };
type Requisition = { id: number; status: string; statusLabel: string; title: string; headcount: number; reason: string; department: string; reportsTo: string | null; requestedBy: string; createdAt: string; closingDate: string | null; applicants: number; hired: number };
type Headcount = { departmentId: number; department: string; approved: number | null; active: number; leaving: number; openPositions: number; projected: number; over: boolean };

const TYPES: Record<string, string> = { PERMANENT: "Permanent", CONTRACT: "Contract", INTERN: "Intern" };

function Jobs() {
  const { data, loading, error } = useApi<{ eligibility: string[]; jobs: Job[] }>("/hiring/jobs");
  if (loading && !data) return <Spinner />;
  if (error || !data) return <Alert>{error}</Alert>;
  return (
    <div className="space-y-4">
      {data.eligibility.length > 0 && (
        <Alert kind="info">
          You can read the open jobs, but you cannot apply right now: {data.eligibility.join("; ")}.
        </Alert>
      )}
      {data.jobs.length === 0 ? <Empty>There are no open internal jobs right now.</Empty> : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.jobs.map((j) => (
            <Link key={j.id} href={`/hiring/jobs/${j.id}`} className="block rounded-2xl bg-ink-800/80 p-5 ring-1 ring-line/80 transition hover:-translate-y-0.5 hover:ring-white/30">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-display text-lg font-bold text-white">{j.title}</div>
                  <div className="text-sm text-slate-500">{j.department} · {TYPES[j.employmentType]}{j.headcount > 1 ? ` · ${j.headcount} positions` : ""}</div>
                </div>
                {j.myApplication && <StatusBadge status={j.myApplication.stage} label={`You: ${j.myApplication.stageLabel}`} />}
              </div>
              <div className="mt-3 text-sm text-slate-600">Reports to {j.reportsTo ?? "—"} · closes {fmtDate(j.closingDate)}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function MyApplications() {
  const { data, loading, error, reload } = useApi<Application[]>("/hiring/applications/mine");
  const [busy, setBusy] = useState<number | null>(null);
  if (loading && !data) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  return (
    <Table head={["Job", "Department", "Applied", "Status", ""]} empty="You have not applied for any internal jobs.">
      {data?.map((a) => (
        <tr key={a.id}>
          <Td><Link href={`/hiring/jobs/${a.job.id}`} className="font-medium text-accent hover:underline">{a.job.title}</Link></Td>
          <Td>{a.job.department}</Td>
          <Td>{fmtDate(a.appliedAt)}</Td>
          <Td><StatusBadge status={a.stage} label={a.stageLabel} /></Td>
          <Td>
            {a.canWithdraw && (
              <Button size="sm" variant="ghost" loading={busy === a.id} onClick={async () => {
                if (!confirm("Withdraw this application?")) return;
                setBusy(a.id);
                try { await post(`/hiring/applications/${a.id}/withdraw`); await reload(); } finally { setBusy(null); }
              }}>Withdraw</Button>
            )}
          </Td>
        </tr>
      ))}
    </Table>
  );
}

function Requisitions() {
  const { data, loading, error } = useApi<Requisition[]>("/hiring/requisitions");
  if (loading && !data) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  return (
    <Table head={["Position", "Department", "Reason", "Hiring manager", "Status", "Applicants", "Filled"]} empty="No requisitions yet.">
      {data?.map((r) => (
        <tr key={r.id} className="hover:bg-slate-50">
          <Td><Link href={`/hiring/requisitions/${r.id}`} className="font-medium text-accent hover:underline">{r.title}</Link><div className="text-xs text-slate-500">#{r.id} · by {r.requestedBy}</div></Td>
          <Td>{r.department}</Td>
          <Td>{r.reason === "NEW" ? "New position" : "Replacement"}</Td>
          <Td>{r.reportsTo ?? "—"}</Td>
          <Td><StatusBadge status={`REQ_${r.status}`} label={r.statusLabel} /></Td>
          <Td className="tabular-nums">{r.applicants}</Td>
          <Td className="tabular-nums">{r.hired} of {r.headcount}</Td>
        </tr>
      ))}
    </Table>
  );
}

function HeadcountTable({ canEdit }: { canEdit: boolean }) {
  const { data, loading, error, reload } = useApi<Headcount[]>("/hiring/headcount");
  const [values, setValues] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  if (loading && !data) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">Projected = active staff − people leaving + open positions. Requisitions that take a department over its approved headcount also go to Finance and Management.</p>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <Table head={["Department", "Approved", "Active", "Leaving", "Open positions", "Projected", ""]}>
        {data?.map((d) => (
          <tr key={d.departmentId}>
            <Td className="font-medium text-white">{d.department}</Td>
            <Td>
              {canEdit ? (
                <Input aria-label={`Approved headcount for ${d.department}`} type="number" min={0} className="w-24" value={values[d.departmentId] ?? (d.approved ?? "")} placeholder="No limit" onChange={(e) => setValues({ ...values, [d.departmentId]: e.target.value })} />
              ) : (d.approved ?? "No limit")}
            </Td>
            <Td className="tabular-nums">{d.active}</Td>
            <Td className="tabular-nums">{d.leaving}</Td>
            <Td className="tabular-nums">{d.openPositions}</Td>
            <Td className={`tabular-nums font-semibold ${d.over ? "text-red-700" : "text-white"}`}>{d.projected}{d.over ? " (over)" : ""}</Td>
            <Td>
              {canEdit && values[d.departmentId] !== undefined && (
                <Button size="sm" variant="secondary" onClick={async () => {
                  setMsg(null);
                  try {
                    const v = values[d.departmentId]!;
                    await put(`/hiring/headcount/${d.departmentId}`, { approvedHeadcount: v === "" ? null : Number(v) });
                    setValues((prev) => { const next = { ...prev }; delete next[d.departmentId]; return next; });
                    setMsg({ kind: "success", text: `Approved headcount for ${d.department} saved.` });
                    await reload();
                  } catch (err) {
                    setMsg({ kind: "error", text: (err as Error).message });
                  }
                }}>Save</Button>
              )}
            </Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

export default function HiringPage() {
  const { user } = useAuth();
  const search = useSearchParams();
  const office = hasRole(user, "HR", "FINANCE", "MANAGEMENT");
  const raises = !!user?.hasTeam || hasRole(user, "HR", "HOD", "LINE_MANAGER");
  const tabs = [
    { value: "jobs" as const, label: "Internal jobs" },
    { value: "applications" as const, label: "My applications" },
    ...(raises || office ? [{ value: "requisitions" as const, label: "Requisitions" }] : []),
    ...(office ? [{ value: "headcount" as const, label: "Headcount" }] : []),
  ];
  const initial = tabs.find((t) => t.value === search.get("tab"))?.value ?? "jobs";
  const [tab, setTab] = useState<(typeof tabs)[number]["value"]>(initial);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Jobs and hiring"
        subtitle="Open internal positions, your applications and, for managers and HR, requisitions for new and replacement positions."
        actions={raises ? <LinkButton href="/hiring/requisitions/new">New requisition</LinkButton> : null}
      />
      <Tabs value={tab} onChange={setTab} options={tabs} />
      {tab === "jobs" && <Jobs />}
      {tab === "applications" && <Card><MyApplications /></Card>}
      {tab === "requisitions" && <Card><Requisitions /></Card>}
      {tab === "headcount" && <Card><HeadcountTable canEdit={hasRole(user, "HR")} /></Card>}
    </div>
  );
}
