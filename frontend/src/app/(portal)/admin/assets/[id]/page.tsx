"use client";

import Link from "next/link";
import { useState } from "react";
import { useParams } from "next/navigation";
import { Alert, Button, Card, Field, Info, Input, PageHeader, Select, Spinner, StatusBadge, Table, Td, Textarea } from "@/components/ui";
import { patch, post } from "@/lib/api";
import { hasRole, useAuth } from "@/lib/auth";
import { useApi } from "@/lib/useApi";
import { fmtDate, fmtDateTime, fmtMoney, todayYmd } from "@/lib/format";
import { CONDITIONS, INCIDENT_TYPES, type AssetDetail, type Incident } from "@/lib/assets";

type Person = { id: number; fullName: string; code: string };
type Dept = { id: number; name: string };

/** A small form with its own busy / error state that reloads the asset when done. */
function Action({ title, submitLabel, onSubmit, children, danger }: { title: string; submitLabel: string; onSubmit: () => Promise<unknown>; children?: React.ReactNode; danger?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-3 rounded-md p-3 ring-1 ring-slate-200"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await onSubmit();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="text-sm font-semibold text-slate-700">{title}</div>
      {error && <Alert>{error}</Alert>}
      {children}
      <Button type="submit" size="sm" variant={danger ? "danger" : "primary"} loading={busy}>{submitLabel}</Button>
    </form>
  );
}

function ConditionSelect({ value, onChange, label = "Condition" }: { value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <Field label={label}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        {Object.entries(CONDITIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </Select>
    </Field>
  );
}

function AssigneeFields({ value, onChange, people, depts }: { value: { assigneeType: string; employeeId: string; departmentId: string; location: string }; onChange: (v: typeof value) => void; people: Person[]; depts: Dept[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Issue to">
        <Select value={value.assigneeType} onChange={(e) => onChange({ ...value, assigneeType: e.target.value })}>
          <option value="EMPLOYEE">An employee</option>
          <option value="DEPARTMENT">A department</option>
          <option value="LOCATION">A location</option>
        </Select>
      </Field>
      {value.assigneeType === "EMPLOYEE" && (
        <Field label="Employee">
          <Select required value={value.employeeId} onChange={(e) => onChange({ ...value, employeeId: e.target.value })}>
            <option value="">Choose…</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.fullName} ({p.code})</option>)}
          </Select>
        </Field>
      )}
      {value.assigneeType === "DEPARTMENT" && (
        <Field label="Department">
          <Select required value={value.departmentId} onChange={(e) => onChange({ ...value, departmentId: e.target.value })}>
            <option value="">Choose…</option>
            {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </Field>
      )}
      {value.assigneeType === "LOCATION" && <Field label="Location"><Input required value={value.location} onChange={(e) => onChange({ ...value, location: e.target.value })} placeholder="e.g. Meeting room 2" /></Field>}
    </div>
  );
}

const assigneeBody = (v: { assigneeType: string; employeeId: string; departmentId: string; location: string }) => ({
  assigneeType: v.assigneeType,
  ...(v.assigneeType === "EMPLOYEE" ? { employeeId: Number(v.employeeId) } : v.assigneeType === "DEPARTMENT" ? { departmentId: Number(v.departmentId) } : { location: v.location }),
});

function AdminActions({ asset, reload }: { asset: AssetDetail; reload: () => void }) {
  const people = useApi<Person[]>("/employees");
  const depts = useApi<Dept[]>("/departments");
  const blankAssignee = { assigneeType: "EMPLOYEE", employeeId: "", departmentId: "", location: "" };
  const [issue, setIssue] = useState({ ...blankAssignee, condition: asset.condition, note: "" });
  const [transfer, setTransfer] = useState({ ...blankAssignee, condition: asset.condition });
  const [ret, setRet] = useState({ condition: asset.condition, note: "" });
  const [repair, setRepair] = useState({ vendor: "", sentOn: todayYmd(), note: "" });
  const [repairBack, setRepairBack] = useState({ returnedOn: todayYmd(), cost: "", condition: "GOOD" });
  const [incident, setIncident] = useState({ type: "DAMAGED", description: "" });
  const [retire, setRetire] = useState("");
  const access = asset.category.kind === "ACCESS";
  const openRepair = asset.repairs.find((r) => !r.returnedOn);
  const p = people.data ?? [];
  const d = depts.data ?? [];

  return (
    <Card title="Admin actions">
      <div className="grid gap-4 lg:grid-cols-2">
        {asset.status === "IN_STOCK" && (
          <Action title={access ? "Grant access" : "Issue"} submitLabel={access ? "Grant access" : "Issue item"} onSubmit={async () => { await post(`/assets/${asset.id}/issue`, { ...assigneeBody(issue), condition: issue.condition, note: issue.note }); reload(); }}>
            <AssigneeFields value={issue} onChange={(v) => setIssue({ ...issue, ...v })} people={p} depts={d} />
            {!access && <ConditionSelect value={issue.condition} onChange={(v) => setIssue({ ...issue, condition: v })} />}
            <Field label="Note (optional)"><Input value={issue.note} onChange={(e) => setIssue({ ...issue, note: e.target.value })} /></Field>
          </Action>
        )}
        {asset.current && (
          <Action title={access ? "Revoke access" : "Record return"} submitLabel={access ? "Revoke" : "Record return"} onSubmit={async () => { await post(`/assets/${asset.id}/return`, ret); reload(); }}>
            {!access && <ConditionSelect label="Condition on return" value={ret.condition} onChange={(v) => setRet({ ...ret, condition: v })} />}
            <Field label="Note (optional)"><Input value={ret.note} onChange={(e) => setRet({ ...ret, note: e.target.value })} /></Field>
          </Action>
        )}
        {asset.status === "ISSUED" && (
          <Action title="Transfer to someone else" submitLabel="Transfer" onSubmit={async () => { await post(`/assets/${asset.id}/transfer`, { ...assigneeBody(transfer), condition: transfer.condition }); reload(); }}>
            <AssigneeFields value={transfer} onChange={(v) => setTransfer({ ...transfer, ...v })} people={p} depts={d} />
          </Action>
        )}
        {asset.status === "IN_STOCK" && !access && (
          <Action title="Send for repair" submitLabel="Send for repair" onSubmit={async () => { await post(`/assets/${asset.id}/repairs`, repair); reload(); }}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Vendor"><Input required value={repair.vendor} onChange={(e) => setRepair({ ...repair, vendor: e.target.value })} /></Field>
              <Field label="Sent on"><Input type="date" required max={todayYmd()} value={repair.sentOn} onChange={(e) => setRepair({ ...repair, sentOn: e.target.value })} /></Field>
            </div>
            <Field label="Fault (optional)"><Input value={repair.note} onChange={(e) => setRepair({ ...repair, note: e.target.value })} /></Field>
          </Action>
        )}
        {openRepair && (
          <Action title={`Back from repair (${openRepair.vendor})`} submitLabel="Record repair return" onSubmit={async () => { await post(`/assets/${asset.id}/repairs/${openRepair.id}/returned`, repairBack); reload(); }}>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Returned on"><Input type="date" required value={repairBack.returnedOn} onChange={(e) => setRepairBack({ ...repairBack, returnedOn: e.target.value })} /></Field>
              <Field label="Repair cost (PKR)"><Input type="number" min="0" step="0.01" value={repairBack.cost} onChange={(e) => setRepairBack({ ...repairBack, cost: e.target.value })} /></Field>
              <ConditionSelect value={repairBack.condition} onChange={(v) => setRepairBack({ ...repairBack, condition: v })} />
            </div>
          </Action>
        )}
        {!access && !["RETIRED"].includes(asset.status) && (
          <Action title="Record damage or loss" submitLabel="Record" onSubmit={async () => { await post(`/assets/${asset.id}/incidents`, incident); setIncident({ ...incident, description: "" }); reload(); }}>
            <Field label="What">
              <Select value={incident.type} onChange={(e) => setIncident({ ...incident, type: e.target.value })}>
                <option value="DAMAGED">Damaged</option>
                <option value="LOST">Lost</option>
              </Select>
            </Field>
            <Field label="Details"><Textarea required rows={2} value={incident.description} onChange={(e) => setIncident({ ...incident, description: e.target.value })} /></Field>
          </Action>
        )}
        {asset.status === "IN_STOCK" && (
          <Action title="Retire" submitLabel="Retire item" danger onSubmit={async () => { await post(`/assets/${asset.id}/retire`, { note: retire }); reload(); }}>
            <Field label="Reason"><Input required value={retire} onChange={(e) => setRetire(e.target.value)} placeholder="e.g. Beyond repair" /></Field>
          </Action>
        )}
      </div>
    </Card>
  );
}

/** HR only: purchase cost and date, to decide a fair recovery (costs are hidden from HR elsewhere). */
function RecoveryCost({ incidentId }: { incidentId: number }) {
  const { data } = useApi<{ purchaseCost: number | null; purchaseDate: string | null }>(`/assets/incidents/${incidentId}/recovery-context`);
  if (!data) return null;
  return (
    <p className="rounded bg-slate-50 px-2 py-1 text-sm text-slate-700 ring-1 ring-slate-200">
      Purchase cost: <strong>{data.purchaseCost != null ? `PKR ${fmtMoney(data.purchaseCost)}` : "not recorded"}</strong>
      {" · "}Purchased: <strong>{data.purchaseDate ? fmtDate(data.purchaseDate) : "not recorded"}</strong>
    </p>
  );
}

function IncidentActions({ incident, reload }: { incident: Incident; reload: () => void }) {
  const { user } = useAuth();
  const [type, setType] = useState(incident.type);
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const isAdmin = hasRole(user, "ADMIN");
  const isHr = hasRole(user, "HR");
  const isMgmt = hasRole(user, "MANAGEMENT");
  const decidable = ["RECORDED", "RECOVERY_SET"].includes(incident.status) && incident.type !== "NOT_WORKING";
  return (
    <div className="mt-2 grid gap-3 lg:grid-cols-2">
      {isAdmin && incident.status === "REPORTED" && (
        <>
          <Action title="Record this report" submitLabel="Record" onSubmit={async () => { await post(`/assets/incidents/${incident.id}/record`, { type, note }); reload(); }}>
            <Field label="Confirmed as">
              <Select value={type} onChange={(e) => setType(e.target.value)}>
                {Object.entries(INCIDENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}{k === "NOT_WORKING" ? " (handled by repair, no charge)" : ""}</option>)}
              </Select>
            </Field>
            <Field label="Note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          </Action>
          <Action title="Close without action" submitLabel="Close report" onSubmit={async () => { await post(`/assets/incidents/${incident.id}/close`, { note }); reload(); }}>
            <Field label="Why"><Input required value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Fixed on the spot" /></Field>
          </Action>
        </>
      )}
      {isHr && decidable && incident.employee && (
        <Action title={incident.status === "RECOVERY_SET" ? "Change the recovery (HR)" : "Set a recovery amount (HR)"} submitLabel="Set recovery" onSubmit={async () => { await post(`/assets/incidents/${incident.id}/recovery`, { amount: Number(amount), note }); reload(); }}>
            <RecoveryCost incidentId={incident.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Amount (PKR)" hint="Finance deducts it in the final settlement"><Input type="number" min="1" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
              <Field label="Reason"><Input required value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            </div>
        </Action>
      )}
      {isMgmt && decidable && (
        <Action title="Write off (Management)" submitLabel="Write off" danger onSubmit={async () => { await post(`/assets/incidents/${incident.id}/write-off`, { note }); reload(); }}>
          <Field label="Reason"><Input required value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </Action>
      )}
    </div>
  );
}

function EditDetails({ asset, reload }: { asset: AssetDetail; reload: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    tag: asset.tag, name: asset.name, serialNumber: asset.serialNumber ?? "", purchaseDate: asset.purchaseDate ?? "", cost: asset.cost == null ? "" : String(asset.cost),
    warrantyUntil: asset.warrantyUntil ?? "", storageLocation: asset.storageLocation ?? "", notes: asset.notes ?? "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  if (!open) return <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Edit details</Button>;
  return (
    <Action title="Edit details" submitLabel="Save" onSubmit={async () => { await patch(`/assets/${asset.id}`, f); setOpen(false); reload(); }}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Tag"><Input value={f.tag} onChange={set("tag")} /></Field>
        <Field label="Name"><Input value={f.name} onChange={set("name")} /></Field>
        <Field label="Serial number / account"><Input value={f.serialNumber} onChange={set("serialNumber")} /></Field>
        <Field label="Storage location"><Input value={f.storageLocation} onChange={set("storageLocation")} /></Field>
        <Field label="Purchase date"><Input type="date" value={f.purchaseDate} onChange={set("purchaseDate")} /></Field>
        <Field label="Cost (PKR)"><Input type="number" min="0" step="0.01" value={f.cost} onChange={set("cost")} /></Field>
        <Field label="Warranty until"><Input type="date" value={f.warrantyUntil} onChange={set("warrantyUntil")} /></Field>
      </div>
      <Field label="Notes"><Textarea rows={2} value={f.notes} onChange={set("notes")} /></Field>
    </Action>
  );
}

export default function AssetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { data: a, loading, error, reload } = useApi<AssetDetail>(`/assets/${id}`);
  if (loading && !a) return <Spinner />;
  if (error || !a) return <Alert>{error}</Alert>;
  const isAdmin = hasRole(user, "ADMIN");
  const access = a.category.kind === "ACCESS";

  return (
    <div className="space-y-6">
      <PageHeader
        title={a.name}
        subtitle={<>{a.tag} · {a.category.name}{a.category.mustReturnOnExit ? " · must be returned on exit" : ""}</>}
        actions={<Link href="/admin/assets" className="text-sm text-accent hover:underline">← All assets</Link>}
      />
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={a.status} />
        {a.current && <span className="text-sm text-slate-600">With <strong>{a.current.assignee}</strong> since {fmtDate(a.current.issuedAt)}{!a.current.confirmedAt && " · awaiting their confirmation"}</span>}
      </div>

      <Card title="Details" actions={isAdmin ? <EditDetails key={JSON.stringify(a)} asset={a} reload={reload} /> : undefined}>
        <dl className="grid gap-4 sm:grid-cols-3">
          <Info label={access ? "Account" : "Serial number"} value={a.serialNumber} />
          <Info label="Condition" value={CONDITIONS[a.condition]} />
          <Info label="Storage location" value={a.storageLocation} />
          <Info label="Purchase date" value={a.purchaseDate ? fmtDate(a.purchaseDate) : null} />
          {a.cost !== undefined && <Info label="Cost" value={a.cost != null ? `PKR ${fmtMoney(a.cost)}` : null} />}
          <Info label="Warranty until" value={a.warrantyUntil ? fmtDate(a.warrantyUntil) : null} />
          {a.notes && <div className="sm:col-span-3"><Info label="Notes" value={<span className="whitespace-pre-line">{a.notes}</span>} /></div>}
        </dl>
      </Card>

      {isAdmin && <AdminActions key={`${a.status}-${a.current?.id ?? 0}`} asset={a} reload={reload} />}

      <Card title={`Damage & loss (${a.incidents.length})`}>
        {!a.incidents.length ? <p className="text-sm text-slate-500">None recorded.</p> : (
          <ul className="space-y-4">
            {a.incidents.map((i) => (
              <li key={i.id} className="rounded-md p-3 ring-1 ring-slate-200">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={i.status} />
                  <span className="font-medium text-slate-800">{INCIDENT_TYPES[i.type]}</span>
                  <span className="text-xs text-slate-500">{fmtDateTime(i.createdAt)} · reported by {i.reportedBy}{i.employee ? ` · held by ${i.employee.fullName}` : ""}</span>
                </div>
                <p className="mt-1 text-sm text-slate-700">{i.description}</p>
                {i.adminNote && <p className="text-xs text-slate-500">Admin ({i.recordedBy}): {i.adminNote}</p>}
                {i.recoveryAmount != null && <p className="text-sm text-red-700">Recovery PKR {fmtMoney(i.recoveryAmount)} set by {i.recoverySetBy}: {i.recoveryNote}</p>}
                {i.writeOffNote && <p className="text-sm text-slate-700">Written off by {i.writtenOffBy}: {i.writeOffNote}</p>}
                <IncidentActions key={`${i.id}-${i.status}`} incident={i} reload={reload} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {!access && (
        <Card title="Repair log">
          <Table head={["Vendor", "Sent", "Returned", ...(a.repairs.some((r) => r.cost !== undefined) ? ["Cost"] : []), "Note", "By"]} empty="No repairs.">
            {a.repairs.map((r) => (
              <tr key={r.id}>
                <Td>{r.vendor}</Td>
                <Td>{fmtDate(r.sentOn)}</Td>
                <Td>{r.returnedOn ? fmtDate(r.returnedOn) : <StatusBadge status="IN_REPAIR" />}</Td>
                {r.cost !== undefined && <Td className="tabular-nums">{r.cost != null ? fmtMoney(r.cost) : "—"}</Td>}
                <Td className="whitespace-normal">{r.note ?? "—"}</Td>
                <Td>{r.createdBy}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <Card title="History">
        <Table head={["With", "Issued", "Confirmed", access ? "Revoked" : "Returned", "Condition out / in", "Notes"]} empty="Never issued.">
          {a.assignments.map((h) => (
            <tr key={h.id} className="align-top">
              <Td className="whitespace-normal">{h.assignee}{h.requestId && <div className="text-xs"><Link href={`/requests/${h.requestId}`} className="text-accent hover:underline">Request #{h.requestId}</Link></div>}</Td>
              <Td>{fmtDate(h.issuedAt)}<div className="text-xs text-slate-500">by {h.issuedBy}</div></Td>
              <Td>{h.confirmedAt ? fmtDate(h.confirmedAt) : <span className="text-xs text-amber-800">not yet</span>}</Td>
              <Td>{h.returnedAt ? <>{fmtDate(h.returnedAt)}<div className="text-xs text-slate-500">to {h.receivedBy}</div></> : "—"}</Td>
              <Td>{CONDITIONS[h.conditionOut]}{h.conditionIn && ` / ${CONDITIONS[h.conditionIn]}`}</Td>
              <Td className="whitespace-normal text-xs text-slate-600">{[h.issueNote, h.returnNote].filter(Boolean).join(" · ") || "—"}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
