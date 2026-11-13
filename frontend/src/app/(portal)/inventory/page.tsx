"use client";

import { useState } from "react";
import { Alert, Button, Card, Field, LinkButton, PageHeader, Select, Spinner, StatusBadge, Table, Td, Textarea } from "@/components/ui";
import { download, post } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { fmtDate, fmtMoney } from "@/lib/format";
import { CONDITIONS, INCIDENT_TYPES, type Assignment } from "@/lib/assets";

type MyItem = Assignment & {
  asset: { id: number; tag: string; name: string; serialNumber: string | null; category: string; kind: "PHYSICAL" | "ACCESS"; status: string; warrantyUntil: string | null };
  incidents: { id: number; type: string; status: string; description: string; createdAt: string; recoveryAmount: number | null; recoveryNote: string | null; writeOffNote: string | null }[];
  pendingVerification: { itemId: number; dueDate: string } | null;
};

/** A13: confirm this item is still held and in the condition shown, as part of a physical audit round. */
function VerifyItem({ item, onDone }: { item: MyItem; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const confirm = async (matches: boolean) => {
    setBusy(true);
    try {
      await post(`/assets/verification-items/${item.pendingVerification!.itemId}/confirm`, { matches });
      onDone();
    } finally {
      setBusy(false);
    }
  };
  if (!item.pendingVerification) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-amber-50 p-2 text-xs text-amber-900 ring-1 ring-amber-200">
      <span>Asset verification round, due {fmtDate(item.pendingVerification.dueDate)}: do you still have this item, in the condition shown?</span>
      <Button size="sm" variant="secondary" loading={busy} onClick={() => confirm(true)}>Yes, confirm</Button>
      <Button size="sm" variant="ghost" loading={busy} onClick={() => confirm(false)}>No, flag a discrepancy</Button>
    </div>
  );
}

function ReportProblem({ item, onDone }: { item: MyItem; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ type: "NOT_WORKING", description: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Report a problem</Button>;
  return (
    <form
      className="mt-2 space-y-2 rounded-md bg-slate-50 p-3 ring-1 ring-slate-200"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await post(`/assets/assignments/${item.id}/report`, form);
          setOpen(false);
          onDone();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {error && <Alert>{error}</Alert>}
      <Field label="Problem">
        <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
          {Object.entries(INCIDENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </Field>
      <Field label="What happened?"><Textarea required rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
      <div className="flex gap-2">
        <Button size="sm" type="submit" loading={busy}>Send to Admin</Button>
        <Button size="sm" type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </form>
  );
}

export default function InventoryPage() {
  const { data, loading, error, reload } = useApi<MyItem[]>("/assets/mine");
  const [msg, setMsg] = useState<string | null>(null);
  const current = data?.filter((d) => !d.returnedAt) ?? [];
  const past = data?.filter((d) => d.returnedAt) ?? [];
  const awaiting = current.filter((c) => !c.confirmedAt);

  const confirm = async (item: MyItem) => {
    await post(`/assets/assignments/${item.id}/confirm`);
    setMsg(`Thank you. You confirmed ${item.asset.name} (${item.asset.tag}).`);
    reload();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="My inventory"
        subtitle="Company items and accounts issued to you. Returnable items must be handed back before you leave."
        actions={<LinkButton href="/requests/new/asset">Request an asset</LinkButton>}
      />
      {msg && <Alert kind="success">{msg}</Alert>}
      {awaiting.length > 0 && <Alert kind="warning">Please confirm that you received {awaiting.length === 1 ? "the item" : `${awaiting.length} items`} below.</Alert>}
      <Card title={`With me (${current.length})`}>
        {loading ? <Spinner /> : error ? <Alert>{error}</Alert> : !current.length ? <p className="py-4 text-sm text-slate-500">Nothing is issued to you.</p> : (
          <ul className="divide-y divide-slate-100">
            {current.map((item) => {
              const open = item.incidents.find((i) => ["REPORTED", "RECORDED", "RECOVERY_SET", "WRITTEN_OFF"].includes(i.status));
              return (
                <li key={item.id} className="py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900">{item.asset.name}</div>
                      <div className="text-xs text-slate-500">
                        {item.asset.category} · Tag {item.asset.tag}{item.asset.serialNumber ? ` · ${item.asset.kind === "ACCESS" ? "Account" : "Serial"} ${item.asset.serialNumber}` : ""} · since {fmtDate(item.issuedAt)}
                        {item.asset.kind === "PHYSICAL" && ` · condition when issued: ${CONDITIONS[item.conditionOut]}`}
                        {item.asset.warrantyUntil && ` · warranty until ${fmtDate(item.asset.warrantyUntil)}`}
                      </div>
                      {open && (
                        <div className="mt-1 text-xs text-slate-600">
                          <StatusBadge status={open.status} /> {INCIDENT_TYPES[open.type]}: {open.description}
                          {open.recoveryAmount != null && <> · Recovery PKR {fmtMoney(open.recoveryAmount)} ({open.recoveryNote}), deducted in your final settlement</>}
                          {open.writeOffNote && <> · Written off: {open.writeOffNote}</>}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {item.confirmedAt ? <StatusBadge status="CONFIRMED" /> : <Button size="sm" onClick={() => confirm(item)}>Confirm I received it</Button>}
                    </div>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3">
                    {item.asset.kind === "PHYSICAL" && <ReportProblem item={item} onDone={() => { setMsg("Your report was sent to Admin."); reload(); }} />}
                    <Button size="sm" variant="ghost" onClick={() => download(`/assets/assignments/${item.id}/handover`, `handover-${item.asset.tag}.pdf`)}>Handover form</Button>
                  </div>
                  <VerifyItem item={item} onDone={() => { setMsg("Thank you for confirming."); reload(); }} />
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Card title="Returned / revoked">
        <Table head={["Item", "Tag", "Issued", "Returned", "Condition on return"]} empty="Nothing returned yet.">
          {past.map((item) => (
            <tr key={item.id}>
              <Td>{item.asset.name}<div className="text-xs text-slate-500">{item.asset.category}</div></Td>
              <Td className="font-mono text-xs">{item.asset.tag}</Td>
              <Td>{fmtDate(item.issuedAt)}</Td>
              <Td>{fmtDate(item.returnedAt)}</Td>
              <Td>{item.conditionIn ? CONDITIONS[item.conditionIn] : "—"}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
