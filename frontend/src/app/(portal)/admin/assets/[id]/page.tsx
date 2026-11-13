"use client";

import Link from "next/link";
import { useState } from "react";
import { useParams } from "next/navigation";
import { Alert, Button, Card, Field, Info, Input, PageHeader, Select, Spinner, StatusBadge, Table, Td, Textarea } from "@/components/ui";
import { download, patch, post } from "@/lib/api";
import { hasRole, useAuth } from "@/lib/auth";
import { useApi } from "@/lib/useApi";
import { fmtDate, fmtDateTime, fmtMoney, todayYmd } from "@/lib/format";
import { CONDITIONS, DISPOSAL_REASONS, INCIDENT_TYPES, RECOVERY_FINDINGS, type AssetDetail, type Incident } from "@/lib/assets";

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

/** "Charger" or "Bag x2", one per line. */
function parseAccessories(text: string) {
  return text.split("\n").map((l) => l.trim()).filter(Boolean).map((line) => {
    const m = /^(.*?)(?:\s*x\s*(\d+))?$/i.exec(line);
    return { name: (m?.[1] || line).trim(), quantity: m?.[2] ? Number(m[2]) : 1 };
  });
}

function AdminActions({ asset, reload, onReturned }: { asset: AssetDetail; reload: () => void; onReturned: (missing: { name: string }[]) => void }) {
  const people = useApi<Person[]>("/employees");
  const depts = useApi<Dept[]>("/departments");
  const blankAssignee = { assigneeType: "EMPLOYEE", employeeId: "", departmentId: "", location: "" };
  const [issue, setIssue] = useState({ ...blankAssignee, condition: asset.condition, note: "", accessories: "" });
  const [transfer, setTransfer] = useState({ ...blankAssignee, condition: asset.condition, authorisationNote: "" });
  const [ret, setRet] = useState({ condition: asset.condition, note: "", accessories: (asset.current?.accessories ?? []).map((a) => ({ id: a.id, name: a.name, returned: true })) });
  const [repair, setRepair] = useState({ vendor: "", sentOn: todayYmd(), note: "" });
  const [repairBack, setRepairBack] = useState({ returnedOn: todayYmd(), cost: "", condition: "GOOD" });
  const [incident, setIncident] = useState({ type: "DAMAGED", description: "" });
  const [retire, setRetire] = useState({ note: "", disposalReason: "DISPOSED", replacedByTag: "" });
  const access = asset.category.kind === "ACCESS";
  const openRepair = asset.repairs.find((r) => !r.returnedOn);
  const p = people.data ?? [];
  const d = depts.data ?? [];

  return (
    <Card title="Admin actions">
      <div className="grid gap-4 lg:grid-cols-2">
        {asset.status === "IN_STOCK" && (
          <Action title={access ? "Grant access" : "Issue"} submitLabel={access ? "Grant access" : "Issue item"} onSubmit={async () => { await post(`/assets/${asset.id}/issue`, { ...assigneeBody(issue), condition: issue.condition, note: issue.note, accessories: parseAccessories(issue.accessories) }); reload(); }}>
            <AssigneeFields value={issue} onChange={(v) => setIssue({ ...issue, ...v })} people={p} depts={d} />
            {!access && <ConditionSelect value={issue.condition} onChange={(v) => setIssue({ ...issue, condition: v })} />}
            <Field label="Note (optional)"><Input value={issue.note} onChange={(e) => setIssue({ ...issue, note: e.target.value })} /></Field>
            {!access && <Field label="Accessories (one per line, e.g. Charger or Bag x2)" hint="Printed on the handover form; checked off at return"><Textarea rows={2} value={issue.accessories} onChange={(e) => setIssue({ ...issue, accessories: e.target.value })} /></Field>}
          </Action>
        )}
        {asset.current && (
          <Action title={access ? "Revoke access" : "Record return"} submitLabel={access ? "Revoke" : "Record return"} onSubmit={async () => {
            const result = await post<{ missingAccessories: { name: string }[] }>(`/assets/${asset.id}/return`, { condition: ret.condition, note: ret.note, accessories: ret.accessories.map((a) => ({ id: a.id, returned: a.returned })) });
            onReturned(result.missingAccessories);
            reload();
          }}>
            {!access && <ConditionSelect label="Condition on return" value={ret.condition} onChange={(v) => setRet({ ...ret, condition: v })} />}
            <Field label="Note (optional)"><Input value={ret.note} onChange={(e) => setRet({ ...ret, note: e.target.value })} /></Field>
            {ret.accessories.length > 0 && (
              <div className="space-y-1">
                <div className="text-sm text-slate-600">Accessories returned</div>
                {ret.accessories.map((a, i) => (
                  <label key={a.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={a.returned} onChange={(e) => setRet({ ...ret, accessories: ret.accessories.map((x, j) => (j === i ? { ...x, returned: e.target.checked } : x)) })} />
                    {a.name}
                  </label>
                ))}
              </div>
            )}
          </Action>
        )}
        {asset.status === "ISSUED" && (
          <Action title="Transfer to someone else" submitLabel="Transfer" onSubmit={async () => { await post(`/assets/${asset.id}/transfer`, { ...assigneeBody(transfer), condition: transfer.condition, authorisationNote: transfer.authorisationNote }); reload(); }}>
            <AssigneeFields value={transfer} onChange={(v) => setTransfer({ ...transfer, ...v })} people={p} depts={d} />
            <Field label="Authorisation" hint="Who authorised this transfer and why (Employee Assets Management Policy A9)"><Input required value={transfer.authorisationNote} onChange={(e) => setTransfer({ ...transfer, authorisationNote: e.target.value })} /></Field>
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
          <Action title="Retire" submitLabel="Retire item" danger onSubmit={async () => { await post(`/assets/${asset.id}/retire`, retire); reload(); }}>
            <Field label="Reason"><Input required value={retire.note} onChange={(e) => setRetire({ ...retire, note: e.target.value })} placeholder="e.g. Beyond repair" /></Field>
            <Field label="Disposal / replacement status">
              <Select value={retire.disposalReason} onChange={(e) => setRetire({ ...retire, disposalReason: e.target.value })}>
                {Object.entries(DISPOSAL_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            {retire.disposalReason === "REPLACED" && <Field label="Replaced by asset tag"><Input required value={retire.replacedByTag} onChange={(e) => setRetire({ ...retire, replacedByTag: e.target.value })} /></Field>}
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

/** A police-report style attachment: upload (Admin/HR/Management/the employee) or download if one exists. */
function AttachmentBox({ incident, reload }: { incident: Incident; reload: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {incident.hasAttachment && <Button size="sm" variant="ghost" onClick={() => download(`/assets/incidents/${incident.id}/attachment`, "attachment")}>Download attachment</Button>}
      <label className="cursor-pointer text-accent hover:underline">
        {busy ? "Uploading…" : incident.hasAttachment ? "Replace attachment" : "Attach a file (e.g. police report)"}
        <input
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          className="hidden"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setBusy(true);
            setError(null);
            try {
              const fd = new FormData();
              fd.append("file", file);
              await post(`/assets/incidents/${incident.id}/attachment`, fd);
              reload();
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {error && <span className="text-red-600">{error}</span>}
    </div>
  );
}

function IncidentActions({ incident, reload }: { incident: Incident; reload: () => void }) {
  const { user } = useAuth();
  const [type, setType] = useState(incident.type);
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [finding, setFinding] = useState("NEGLIGENCE");
  const isAdmin = hasRole(user, "ADMIN");
  const isHr = hasRole(user, "HR");
  const isMgmt = hasRole(user, "MANAGEMENT");
  const decidable = ["RECORDED", "RECOVERY_PENDING_APPROVAL", "RECOVERY_SET"].includes(incident.status) && incident.type !== "NOT_WORKING";
  // Finance can view this page's incidents too, but never the attachment (same rule as the backend).
  const canAttach = isAdmin || isHr || isMgmt;
  return (
    <div className="mt-2 space-y-3">
      {incident.policeReportSuggested && !incident.hasAttachment && <Alert kind="warning">A police report is recommended for this type of report.</Alert>}
      {canAttach && <AttachmentBox incident={incident} reload={reload} />}
      <div className="grid gap-3 lg:grid-cols-2">
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
        {isHr && decidable && incident.status !== "RECOVERY_PENDING_APPROVAL" && incident.employee && (
          <Action title={incident.status === "RECOVERY_SET" ? "Change the recovery (HR)" : "Decide a recovery (HR)"} submitLabel="Save decision" onSubmit={async () => { await post(`/assets/incidents/${incident.id}/recovery`, { finding, amount: finding === "WEAR_AND_TEAR" ? undefined : Number(amount), note }); reload(); }}>
              <RecoveryCost incidentId={incident.id} />
              <Field label="Finding">
                <Select value={finding} onChange={(e) => setFinding(e.target.value)}>
                  {Object.entries(RECOVERY_FINDINGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                {finding !== "WEAR_AND_TEAR" && <Field label="Amount (PKR)" hint="Finance deducts it in the final settlement; above the Rules & settings threshold also needs Management approval"><Input type="number" min="1" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>}
                <Field label="Reason"><Input required value={note} onChange={(e) => setNote(e.target.value)} /></Field>
              </div>
          </Action>
        )}
        {isMgmt && incident.status === "RECOVERY_PENDING_APPROVAL" && (
          <Action title="Approve recovery (Management)" submitLabel="Approve" onSubmit={async () => { await post(`/assets/incidents/${incident.id}/recovery/approve`, {}); reload(); }}>
            <p className="text-sm text-slate-600">PKR {fmtMoney(incident.recoveryAmount)} proposed by {incident.recoverySetBy}: {incident.recoveryNote}</p>
          </Action>
        )}
        {isMgmt && decidable && (
          <Action title="Write off (Management)" submitLabel="Write off" danger onSubmit={async () => { await post(`/assets/incidents/${incident.id}/write-off`, { note }); reload(); }}>
            <Field label="Reason"><Input required value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          </Action>
        )}
      </div>
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
  // Kept here, not inside AdminActions: that component remounts (its key changes) the moment a return
  // succeeds, which would wipe this state before the warning had a chance to be seen. Shown only while
  // the item is still unissued (current is empty), so it reads as stale once it is issued again.
  const [missing, setMissing] = useState<{ name: string }[] | null>(null);
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
      {missing && missing.length > 0 && !a.current && (
        <Alert kind="warning">Missing at return: {missing.map((x) => x.name).join(", ")}. Record damage or loss below if a recovery is needed.</Alert>
      )}

      <Card title="Details" actions={isAdmin ? <EditDetails key={JSON.stringify(a)} asset={a} reload={reload} /> : undefined}>
        <dl className="grid gap-4 sm:grid-cols-3">
          <Info label={access ? "Account" : "Serial number"} value={a.serialNumber} />
          <Info label="Condition" value={CONDITIONS[a.condition]} />
          <Info label="Storage location" value={a.storageLocation} />
          <Info label="Purchase date" value={a.purchaseDate ? fmtDate(a.purchaseDate) : null} />
          {a.cost !== undefined && <Info label="Cost" value={a.cost != null ? `PKR ${fmtMoney(a.cost)}` : null} />}
          <Info label="Warranty until" value={a.warrantyUntil ? fmtDate(a.warrantyUntil) : null} />
          {a.disposalReason && <Info label="Disposal / replacement" value={`${DISPOSAL_REASONS[a.disposalReason]}${a.disposalDate ? ` on ${fmtDate(a.disposalDate)}` : ""}`} />}
          {a.notes && <div className="sm:col-span-3"><Info label="Notes" value={<span className="whitespace-pre-line">{a.notes}</span>} /></div>}
        </dl>
      </Card>

      {isAdmin && <AdminActions key={`${a.status}-${a.current?.id ?? 0}`} asset={a} reload={reload} onReturned={setMissing} />}

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
                {i.finding && <p className="text-xs text-slate-500">Finding: {RECOVERY_FINDINGS[i.finding] ?? i.finding}</p>}
                {i.recoveryAmount != null && (
                  <p className="text-sm text-red-700">
                    Recovery PKR {fmtMoney(i.recoveryAmount)} {i.status === "RECOVERY_PENDING_APPROVAL" ? "proposed" : "set"} by {i.recoverySetBy}: {i.recoveryNote}
                    {i.recoveryApprovedBy && ` · approved by ${i.recoveryApprovedBy}`}
                  </p>
                )}
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
        <Table head={["With", "Issued", "Confirmed", access ? "Revoked" : "Returned", "Condition out / in", "Notes", ""]} empty="Never issued.">
          {a.assignments.map((h) => (
            <tr key={h.id} className="align-top">
              <Td className="whitespace-normal">{h.assignee}{h.requestId && <div className="text-xs"><Link href={`/requests/${h.requestId}`} className="text-accent hover:underline">Request #{h.requestId}</Link></div>}</Td>
              <Td>{fmtDate(h.issuedAt)}<div className="text-xs text-slate-500">by {h.issuedBy}</div></Td>
              <Td>{h.confirmedAt ? fmtDate(h.confirmedAt) : <span className="text-xs text-amber-800">not yet</span>}</Td>
              <Td>{h.returnedAt ? <>{fmtDate(h.returnedAt)}<div className="text-xs text-slate-500">to {h.receivedBy}</div></> : "—"}</Td>
              <Td>{CONDITIONS[h.conditionOut]}{h.conditionIn && ` / ${CONDITIONS[h.conditionIn]}`}</Td>
              <Td className="whitespace-normal text-xs text-slate-600">
                {[h.issueNote, h.authorisationNote && `Authorised: ${h.authorisationNote}`, h.returnNote].filter(Boolean).join(" · ") || "—"}
                {h.accessories.length > 0 && <div>Accessories: {h.accessories.map((x) => `${x.name}${x.quantity > 1 ? ` x${x.quantity}` : ""}${h.returnedAt ? (x.returned ? "" : " (missing)") : ""}`).join(", ")}</div>}
              </Td>
              <Td>{h.employee && <Button size="sm" variant="ghost" onClick={() => download(`/assets/assignments/${h.id}/handover`, `handover-${a.tag}.pdf`)}>Handover form</Button>}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
