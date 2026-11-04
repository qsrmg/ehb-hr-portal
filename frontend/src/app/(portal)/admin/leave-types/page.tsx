"use client";

import { useState } from "react";
import { Alert, Button, Card, Input, PageHeader, Select, Spinner, Table, Td } from "@/components/ui";
import { post, put } from "@/lib/api";
import { useApi } from "@/lib/useApi";

type LeaveType = {
  id: number; code: string; name: string; annualQuota: number | null; paid: boolean; needsHrApproval: boolean; noticeDays: number;
  documentAfterDays: number | null; carryForwardMax: number | null; proRata: boolean; gender: "MALE" | "FEMALE" | "OTHER" | null; active: boolean;
};

const numOrNull = (v: string) => (v === "" ? null : Number(v));

function Row({ type, onSaved }: { type: LeaveType; onSaved: (message: string | null) => void }) {
  const [t, setT] = useState(type);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dirty = JSON.stringify(t) !== JSON.stringify(type);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const { id, ...body } = t;
      const r = await put<{ recalculated: { updated: number; keptManual: number } | null }>(`/leave/types/${id}`, body);
      onSaved(
        r.recalculated
          ? `${t.name}: ${r.recalculated.updated} balance(s) recalculated for this year onward${r.recalculated.keptManual ? `; ${r.recalculated.keptManual} adjusted by hand were kept` : ""}.`
          : null,
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const numInput = (key: "annualQuota" | "noticeDays" | "documentAfterDays" | "carryForwardMax", placeholder = "") => (
    <Input type="number" min={0} step={key === "noticeDays" ? 1 : 0.5} className="w-20" placeholder={placeholder} value={t[key] ?? ""} onChange={(e) => setT({ ...t, [key]: key === "noticeDays" ? Number(e.target.value || 0) : numOrNull(e.target.value) })} />
  );
  const check = (key: "paid" | "needsHrApproval" | "proRata" | "active") => (
    <input type="checkbox" checked={t[key]} onChange={(e) => setT({ ...t, [key]: e.target.checked })} aria-label={key} />
  );

  return (
    <tr>
      <Td><div className="font-medium text-slate-900">{t.name}</div><div className="text-xs text-slate-500">{t.code}</div>{err && <div className="text-xs text-red-600">{err}</div>}</Td>
      <Td>{numInput("annualQuota", "none")}</Td>
      <Td>{numInput("noticeDays")}</Td>
      <Td>{numInput("documentAfterDays", "—")}</Td>
      <Td>{numInput("carryForwardMax", "—")}</Td>
      <Td className="text-center">{check("proRata")}</Td>
      <Td className="text-center">{check("paid")}</Td>
      <Td className="text-center">{check("needsHrApproval")}</Td>
      <Td>
        <Select value={t.gender ?? ""} onChange={(e) => setT({ ...t, gender: (e.target.value || null) as LeaveType["gender"] })} className="w-24">
          <option value="">All</option>
          <option value="FEMALE">Female</option>
          <option value="MALE">Male</option>
        </Select>
      </Td>
      <Td className="text-center">{check("active")}</Td>
      <Td><Button size="sm" disabled={!dirty} loading={busy} onClick={save}>Save</Button></Td>
    </tr>
  );
}

export default function LeaveTypesPage() {
  const { data, loading, error, reload } = useApi<LeaveType[]>("/leave/types/all");
  const [year, setYear] = useState(String(new Date().getFullYear() - 1));
  const [cfMsg, setCfMsg] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const carry = async () => {
    if (!confirm(`Carry unused balances from ${year} into ${Number(year) + 1}?`)) return;
    const r = await post<{ updated: number }>("/leave/carry-forward", { fromYear: Number(year) });
    setCfMsg(`Updated ${r.updated} balances for ${Number(year) + 1}.`);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Leave types and quotas" subtitle="Every quota, notice period and limit is a setting. Changing a quota or pro-rata recalculates this year's balances (hand-adjusted balances are kept)." />
      <Alert kind="warning">These quotas are placeholders until “HR Portal — Final Rules v1” is signed off. Check maternity and paternity days against the federal Maternity and Paternity Leave Act.</Alert>
      {savedMsg && <Alert kind="success">{savedMsg}</Alert>}
      <Card title="Leave types">
        {loading ? <Spinner /> : error ? <Alert>{error}</Alert> : (
          <Table head={["Type", "Days / year", "Notice days", "Document after (days)", "Carry forward max", "Pro-rata", "Paid", "HR approval", "Applies to", "Active", ""]}>
            {data?.map((t) => <Row key={`${t.id}-${JSON.stringify(t)}`} type={t} onSaved={(m) => { setSavedMsg(m); reload(); }} />)}
          </Table>
        )}
      </Card>
      <Card title="Year-end carry forward">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm text-slate-700">From year <Input type="number" value={year} onChange={(e) => setYear(e.target.value)} className="mt-1 w-28" /></label>
          <Button variant="secondary" onClick={carry}>Carry forward unused leave</Button>
        </div>
        <p className="mt-2 text-xs text-slate-500">Runs automatically at 00:05 on 1 January. Unused balance up to each type&apos;s carry-forward max (Annual Leave: 14 days) moves into the next year. Running it again gives the same result, so use the button after correcting last year&apos;s leave.</p>
        {cfMsg && <div className="mt-3"><Alert kind="success">{cfMsg}</Alert></div>}
      </Card>
    </div>
  );
}
