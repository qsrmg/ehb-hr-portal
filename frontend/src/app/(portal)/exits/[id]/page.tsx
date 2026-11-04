"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Alert, Button, Card, Field, Info, Input, PageHeader, Select, Spinner, StatusBadge, Table, Td, Textarea } from "@/components/ui";
import { download, patch, post } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { fmtDate, fmtDateTime, fmtMoney, todayYmd } from "@/lib/format";

type CardData = {
  area: string; label: string; status: string; owner: string; clearedBy: string | null; clearedAt: string | null; comment: string | null; canClear: boolean;
};
type Outstanding = { assignmentId: number; tag: string; name: string; category: string; action: string };
type Handover = {
  reports: { id: number; fullName: string; code: string }[];
  departments: { id: number; name: string }[];
  pendingApprovals: { stepId: number; requestId: number; title: string; employee: string; label: string; status: string }[];
  clearanceCards: { clearanceId: number; caseId: number; employee: string }[];
  soleRoles: string[];
  done: boolean;
};
type SettlementItem = { kind: string; kindLabel?: string; direction: "DEDUCT" | "PAY"; description: string; days: number | null; amount: number };
type ExitCase = {
  id: number; type: string; typeLabel: string; status: string; lastWorkingDay: string; deactivated: boolean; deactivatedAt: string | null;
  reason: string | null; requestId: number | null; startedBy: string;
  employee: { id: number; fullName: string; code: string; designation: string | null; department: string | null; manager: string | null; joiningDate: string; status: string; personalEmail?: string | null };
  noticeGivenOn: string; noticeDays: number; noticeEndDate: string | null; shortfallDays: number; shortfallWaived: boolean;
  completed: { at: string; by: string | null } | null;
  cancelled: { at: string; by: string | null; reason: string | null } | null;
  clearanceCards: CardData[];
  assets: { cleared: boolean; outstanding: Outstanding[]; pendingDecisions: { incidentId: number; tag: string; name: string; type: string; status: string }[]; recoveries?: { tag: string; name: string; amount: number }[]; recoveryTotal?: number } | null;
  handover: Handover | null;
  settlement: { items: SettlementItem[]; net: number | null; settledOn: string | null; method: string | null; reference: string | null; note: string | null; by: string | null; at: string } | null;
  settlementDone: boolean;
  canSettle: boolean;
  letters: { at: string; by: string | null; emailedTo?: string | null } | null;
  canIssueLetters: boolean; canDownloadLetters: boolean;
  interview: { primaryReason: string; rating: number | null; wouldRecommend: boolean | null; wouldReturn: boolean | null; likedMost: string | null; improve: string | null; comments: string | null; recordedBy: string; at: string } | null;
  interviewSubmitted: boolean; canSubmitInterview: boolean;
  canEdit: boolean; canReassign: boolean; canComplete: boolean; completeBlockers: string[]; canCancel: boolean;
};
type Option = { id: number; fullName: string; code: string };

const KIND_LABELS: Record<string, string> = {
  ASSET_RECOVERY: "Asset recovery", TRAVEL_ADVANCE: "Travel advance not settled", NOTICE_SHORTFALL: "Notice period not served",
  LEAVE_ENCASHMENT: "Annual Leave encashment", EXPENSE_PAYABLE: "Approved claim not yet paid", OTHER: "Other",
};
const REASONS = ["Better opportunity", "Salary and benefits", "Career growth", "Work environment", "Manager", "Relocation", "Personal or family", "Studies", "Other"];

function useAction(onDone: () => Promise<void>) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await onDone();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  };
  return { busy, error, run };
}

function ClearanceCard({ caseId, card, assets, onChanged }: { caseId: number; card: CardData; assets: ExitCase["assets"]; onChanged: () => Promise<void> }) {
  const [comment, setComment] = useState("");
  const { busy, error, run } = useAction(onChanged);
  return (
    <div className="rounded-lg bg-white p-4 shadow-sm ring-1 ring-slate-200" data-area={card.area}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800">{card.label}</h3>
        <StatusBadge status={card.status} label={card.status === "WAITING" ? "Waits for the others" : undefined} />
      </div>
      <p className="mt-1 text-xs text-slate-500">{card.owner}</p>
      {card.clearedBy && <p className="mt-2 text-xs text-slate-600">Cleared by {card.clearedBy} · {fmtDateTime(card.clearedAt)}</p>}
      {card.comment && <p className="mt-1 rounded bg-slate-50 px-2 py-1 text-xs text-slate-700">“{card.comment}”</p>}
      {card.area === "IT_ADMIN" && card.status !== "CLEARED" && assets && (
        <div className="mt-2 text-xs">
          {assets.outstanding.length ? (
            <ul className="space-y-0.5 text-amber-800">{assets.outstanding.map((o) => <li key={o.assignmentId}>{o.action}: {o.name} ({o.tag})</li>)}</ul>
          ) : (
            <p className="text-emerald-700">All company items returned, written off or with a recovery set.</p>
          )}
          {assets.pendingDecisions.length > 0 && <p className="mt-1 text-amber-800">{assets.pendingDecisions.length} incident(s) still wait for an HR or Management decision.</p>}
        </div>
      )}
      {card.canClear && (
        <div className="mt-3 space-y-2">
          {error && <Alert>{error}</Alert>}
          <Input placeholder="Comment (optional)" value={comment} onChange={(e) => setComment(e.target.value)} aria-label={`${card.label} comment`} />
          <Button size="sm" loading={busy === "clear"} onClick={() => run("clear", () => post(`/exits/${caseId}/clearances/${card.area.toLowerCase()}/clear`, { comment }))}>
            Clear {card.label}
          </Button>
        </div>
      )}
    </div>
  );
}

function SettlementForm({ caseId, onDone }: { caseId: number; onDone: () => Promise<void> }) {
  const { data: draft, loading, error: loadError } = useApi<{ items: SettlementItem[]; notes: string[] }>(`/exits/${caseId}/settlement-draft`);
  const [items, setItems] = useState<SettlementItem[] | null>(null);
  const [form, setForm] = useState({ settledOn: todayYmd(), method: "Bank transfer", reference: "", note: "" });
  const { busy, error, run } = useAction(onDone);
  if (loading && !draft) return <Spinner />;
  if (loadError) return <Alert>{loadError}</Alert>;
  const rows = items ?? draft?.items ?? [];
  const update = (i: number, patchRow: Partial<SettlementItem>) => setItems(rows.map((r, j) => (j === i ? { ...r, ...patchRow } : r)));
  const net = rows.reduce((s, r) => s + (r.direction === "PAY" ? 1 : -1) * (Number(r.amount) || 0), 0);
  return (
    <div className="space-y-4">
      {draft?.notes.map((n) => <Alert key={n} kind="info">{n}</Alert>)}
      <p className="text-sm text-slate-600">Pre-filled from the portal. The portal does not calculate salary: enter the amounts for notice and leave days, adjust anything, and add other items (e.g. the last month&apos;s salary).</p>
      {rows.length === 0 && <p className="text-sm text-slate-500">Nothing to settle. Add items if needed.</p>}
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={i} className="rounded-md p-3 ring-1 ring-slate-200" data-kind={r.kind}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                {KIND_LABELS[r.kind] ?? r.kind}{r.days != null ? ` · ${r.days} day(s)` : ""}
              </span>
              <Button size="sm" variant="ghost" onClick={() => setItems(rows.filter((_, j) => j !== i))}>Remove</Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem_10rem]">
              <Input value={r.description} onChange={(e) => update(i, { description: e.target.value })} aria-label="Description" placeholder="Description" />
              <Select value={r.direction} onChange={(e) => update(i, { direction: e.target.value as SettlementItem["direction"] })} aria-label="Deduct or pay">
                <option value="DEDUCT">Deduct</option>
                <option value="PAY">Pay to employee</option>
              </Select>
              <Input type="number" min={0} step="0.01" value={r.amount} onChange={(e) => update(i, { amount: Number(e.target.value) })} aria-label={`Amount for ${KIND_LABELS[r.kind] ?? r.kind}`} placeholder="Amount (PKR)" />
            </div>
          </div>
        ))}
      </div>
      <Button size="sm" variant="secondary" onClick={() => setItems([...rows, { kind: "OTHER", direction: "PAY", description: "", days: null, amount: 0 }])}>Add item</Button>
      <p className="text-sm">
        Net: <strong>{net >= 0 ? `PKR ${fmtMoney(net)} paid to the employee` : `PKR ${fmtMoney(-net)} owed by the employee`}</strong>
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Settled on"><Input type="date" value={form.settledOn} onChange={(e) => setForm({ ...form, settledOn: e.target.value })} /></Field>
        <Field label="Method"><Input value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} /></Field>
        <Field label="Reference"><Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></Field>
      </div>
      <Field label="Note (optional)"><Textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
      {error && <Alert>{error}</Alert>}
      <Button loading={busy === "settle"} onClick={() => run("settle", () => post(`/exits/${caseId}/settlement`, { items: rows, ...form }))}>Record final settlement and clear Finance</Button>
    </div>
  );
}

function InterviewForm({ caseId, onDone }: { caseId: number; onDone: () => Promise<void> }) {
  const [form, setForm] = useState({ primaryReason: "", rating: "", wouldRecommend: "", wouldReturn: "", likedMost: "", improve: "", comments: "" });
  const { busy, error, run } = useAction(onDone);
  const yesNo = (v: string) => (v === "" ? null : v === "yes");
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run("interview", () => post(`/exits/${caseId}/interview`, {
          ...form, rating: form.rating ? Number(form.rating) : null, wouldRecommend: yesNo(form.wouldRecommend), wouldReturn: yesNo(form.wouldReturn),
        }));
      }}
    >
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Main reason for leaving">
          <Select required value={form.primaryReason} onChange={set("primaryReason")}>
            <option value="">Choose…</option>
            {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </Select>
        </Field>
        <Field label="Overall experience (1–5)">
          <Select value={form.rating} onChange={set("rating")}>
            <option value="">—</option>
            {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
        </Field>
        <Field label="Would you recommend EHB as an employer?">
          <Select value={form.wouldRecommend} onChange={set("wouldRecommend")}><option value="">—</option><option value="yes">Yes</option><option value="no">No</option></Select>
        </Field>
        <Field label="Would you consider coming back?">
          <Select value={form.wouldReturn} onChange={set("wouldReturn")}><option value="">—</option><option value="yes">Yes</option><option value="no">No</option></Select>
        </Field>
      </div>
      <Field label="What did you like most?"><Textarea value={form.likedMost} onChange={set("likedMost")} /></Field>
      <Field label="What should we improve?"><Textarea value={form.improve} onChange={set("improve")} /></Field>
      <Field label="Anything else?"><Textarea value={form.comments} onChange={set("comments")} /></Field>
      <Button type="submit" loading={busy === "interview"}>Submit exit interview</Button>
    </form>
  );
}

function HandoverPanel({ c, onChanged }: { c: ExitCase; onChanged: () => Promise<void> }) {
  const people = useApi<Option[]>(c.canReassign ? "/employees" : null);
  const [to, setTo] = useState("");
  const { busy, error, run } = useAction(onChanged);
  const h = c.handover!;
  return (
    <Card title="Handover">
      {h.done ? (
        <p className="text-sm text-emerald-700">Nothing to hand over: no team, departments, pending approvals or clearances are left with {c.employee.fullName}.</p>
      ) : (
        <div className="space-y-3 text-sm">
          {h.reports.length > 0 && <div><div className="text-xs text-slate-500">Team</div>{h.reports.map((r) => r.fullName).join(", ")}</div>}
          {h.departments.length > 0 && <div><div className="text-xs text-slate-500">Head of department</div>{h.departments.map((d) => d.name).join(", ")}</div>}
          {h.pendingApprovals.length > 0 && (
            <div>
              <div className="text-xs text-slate-500">Approvals waiting with them</div>
              <ul>{h.pendingApprovals.map((p) => <li key={p.stepId}><Link className="text-accent hover:underline" href={`/requests/${p.requestId}`}>#{p.requestId}</Link> {p.title} ({p.employee})</li>)}</ul>
            </div>
          )}
          {h.clearanceCards.length > 0 && <div><div className="text-xs text-slate-500">Line Manager clearances to sign</div>{h.clearanceCards.map((x) => x.employee).join(", ")}</div>}
          {c.canReassign && (
            <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
              <Field label="Move all of this to" className="min-w-64 flex-1">
                <Select value={to} onChange={(e) => setTo(e.target.value)}>
                  <option value="">Choose…</option>
                  {people.data?.filter((p) => p.id !== c.employee.id).map((p) => <option key={p.id} value={p.id}>{p.fullName} ({p.code})</option>)}
                </Select>
              </Field>
              <Button disabled={!to} loading={busy === "handover"} onClick={() => run("handover", () => post(`/exits/${c.id}/handover`, { toEmployeeId: Number(to) }))}>Reassign</Button>
            </div>
          )}
          {error && <Alert>{error}</Alert>}
        </div>
      )}
      {h.soleRoles.length > 0 && <Alert kind="warning">They are the only {h.soleRoles.join(", ")} user. Give the role to someone else in Employees.</Alert>}
    </Card>
  );
}

function EditDates({ c, onChanged }: { c: ExitCase; onChanged: () => Promise<void> }) {
  const [lwd, setLwd] = useState(c.lastWorkingDay);
  const [waived, setWaived] = useState(c.shortfallWaived);
  const { busy, error, run } = useAction(onChanged);
  return (
    <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Change last working day"><Input type="date" value={lwd} min={c.noticeGivenOn} onChange={(e) => setLwd(e.target.value)} /></Field>
        {c.noticeEndDate && (
          <label className="mb-2 flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={waived} onChange={(e) => setWaived(e.target.checked)} /> Waive notice shortfall
          </label>
        )}
        <Button variant="secondary" loading={busy === "save"} onClick={() => run("save", () => patch(`/exits/${c.id}`, { lastWorkingDay: lwd, shortfallWaived: waived }))}>Save</Button>
      </div>
    </div>
  );
}

export default function ExitCasePage() {
  const { id } = useParams<{ id: string }>();
  const { data: c, loading, error, reload } = useApi<ExitCase>(`/exits/${id}`);
  const [notice, setNotice] = useState<string | null>(null);
  const actions = useAction(reload);
  if (loading && !c) return <Spinner />;
  if (error || !c) return <Alert>{error}</Alert>;

  const open = c.status === "OPEN";
  const say = (msg: string) => async (ok: boolean) => { if (ok) setNotice(msg); };

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Exit: ${c.employee.fullName}`}
        subtitle={<>{c.employee.code} · {c.typeLabel} · last working day {fmtDate(c.lastWorkingDay)}</>}
        actions={
          <>
            {c.canIssueLetters && (
              <Button loading={actions.busy === "letters"} onClick={() => actions.run("letters", () => post(`/exits/${c.id}/letters`)).then(say(c.employee.personalEmail ? `Letters emailed to ${c.employee.personalEmail}.` : "Letters issued. There is no personal email on file, so download them and send them yourself."))}>
                {c.letters ? "Issue letters again" : "Issue experience & relieving letters"}
              </Button>
            )}
            {c.canDownloadLetters && (
              <>
                <Button variant="secondary" onClick={() => download(`/exits/${c.id}/letters/experience`, "experience-letter.pdf")}>Experience letter</Button>
                <Button variant="secondary" onClick={() => download(`/exits/${c.id}/letters/relieving`, "relieving-letter.pdf")}>Relieving letter</Button>
              </>
            )}
            {c.canComplete && (
              <Button disabled={c.completeBlockers.length > 0} loading={actions.busy === "complete"} onClick={() => confirm("Complete this exit?") && actions.run("complete", () => post(`/exits/${c.id}/complete`)).then(say("Exit completed."))}>
                Complete exit
              </Button>
            )}
            {c.canCancel && (
              <Button variant="danger" loading={actions.busy === "cancel"} onClick={() => {
                const reason = prompt("Why is this exit being cancelled?");
                if (reason) actions.run("cancel", () => post(`/exits/${c.id}/cancel`, { reason })).then(say("Exit cancelled."));
              }}>Cancel exit</Button>
            )}
          </>
        }
      />
      {notice && <Alert kind="success">{notice}</Alert>}
      {actions.error && <Alert>{actions.error}</Alert>}
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={c.status} />
        {c.deactivatedAt ? <span className="text-sm text-slate-600">Login switched off {fmtDateTime(c.deactivatedAt)}</span> : open && <span className="text-sm text-slate-600">The login is switched off automatically after {fmtDate(c.lastWorkingDay)}.</span>}
      </div>
      {c.canComplete && c.completeBlockers.length > 0 && (
        <Alert kind="warning">
          <div className="font-medium">Before the exit can be completed:</div>
          <ul className="mt-1 list-disc pl-5">{c.completeBlockers.map((b) => <li key={b}>{b}</li>)}</ul>
        </Alert>
      )}
      {c.cancelled && <Alert kind="info">Cancelled by {c.cancelled.by} on {fmtDateTime(c.cancelled.at)}{c.cancelled.reason ? `: ${c.cancelled.reason}` : ""}</Alert>}
      {c.completed && <Alert kind="success">Completed by {c.completed.by} on {fmtDateTime(c.completed.at)}.</Alert>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {c.clearanceCards.map((card) => <ClearanceCard key={card.area} caseId={c.id} card={card} assets={c.assets} onChanged={reload} />)}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Details">
            <dl className="grid gap-4 sm:grid-cols-3">
              <Info label="Department" value={c.employee.department} />
              <Info label="Designation" value={c.employee.designation} />
              <Info label="Line manager" value={c.employee.manager} />
              <Info label="Joined" value={fmtDate(c.employee.joiningDate)} />
              <Info label="Notice given on" value={fmtDate(c.noticeGivenOn)} />
              <Info label="Last working day" value={fmtDate(c.lastWorkingDay)} />
              {c.noticeEndDate && <Info label="Notice period" value={`${c.noticeDays} days, ends ${fmtDate(c.noticeEndDate)}`} />}
              {c.noticeEndDate && <Info label="Notice shortfall" value={c.shortfallDays ? `${c.shortfallDays} day(s)${c.shortfallWaived ? ", waived by HR" : ", deducted by Finance"}` : "None"} />}
              <Info label="Started by" value={c.startedBy} />
              {c.requestId && <Info label="Resignation" value={<Link className="text-accent hover:underline" href={`/requests/${c.requestId}`}>Request #{c.requestId}</Link>} />}
              {c.employee.personalEmail !== undefined && <Info label="Personal email (letters)" value={c.employee.personalEmail} />}
              {c.reason && <div className="sm:col-span-3"><Info label="Reason" value={c.reason} /></div>}
            </dl>
            {c.canEdit && <EditDates c={c} onChanged={reload} />}
          </Card>

          {c.canSettle && <Card title="Final settlement (Finance)"><SettlementForm caseId={c.id} onDone={reload} /></Card>}
          {c.settlement && (
            <Card title="Final settlement">
              <Table head={["Item", "Description", "Days", "Amount (PKR)"]}>
                {c.settlement.items.map((i, k) => (
                  <tr key={k}>
                    <Td className="text-xs">{i.kindLabel}</Td>
                    <Td className="whitespace-normal">{i.description}</Td>
                    <Td>{i.days ?? "—"}</Td>
                    <Td className={i.direction === "DEDUCT" ? "text-red-700" : "text-emerald-700"}>{i.direction === "DEDUCT" ? "−" : "+"}{fmtMoney(i.amount)}</Td>
                  </tr>
                ))}
              </Table>
              <p className="mt-3 text-sm">
                Net: <strong>{(c.settlement.net ?? 0) >= 0 ? `PKR ${fmtMoney(c.settlement.net)} paid to the employee` : `PKR ${fmtMoney(-(c.settlement.net ?? 0))} owed by the employee`}</strong>
                {" "}· settled {fmtDate(c.settlement.settledOn)}{c.settlement.method ? ` by ${c.settlement.method}` : ""}{c.settlement.reference ? ` (${c.settlement.reference})` : ""} · recorded by {c.settlement.by}
              </p>
              {c.settlement.note && <p className="mt-1 text-sm text-slate-600">{c.settlement.note}</p>}
            </Card>
          )}
          {!c.settlement && c.settlementDone && <Alert kind="info">Finance has recorded the final settlement.</Alert>}

          {c.interview && (
            <Card title="Exit interview (HR only)">
              <dl className="grid gap-4 sm:grid-cols-2">
                <Info label="Main reason" value={c.interview.primaryReason} />
                <Info label="Overall experience" value={c.interview.rating ? `${c.interview.rating} / 5` : null} />
                <Info label="Would recommend EHB" value={c.interview.wouldRecommend == null ? null : c.interview.wouldRecommend ? "Yes" : "No"} />
                <Info label="Would come back" value={c.interview.wouldReturn == null ? null : c.interview.wouldReturn ? "Yes" : "No"} />
                <div className="sm:col-span-2"><Info label="Liked most" value={c.interview.likedMost} /></div>
                <div className="sm:col-span-2"><Info label="Should improve" value={c.interview.improve} /></div>
                <div className="sm:col-span-2"><Info label="Other comments" value={c.interview.comments} /></div>
              </dl>
              <p className="mt-3 text-xs text-slate-500">Recorded by {c.interview.recordedBy} · {fmtDateTime(c.interview.at)}</p>
            </Card>
          )}
          {c.canSubmitInterview && (
            <Card title="Exit interview (optional)">
              <p className="mb-3 text-sm text-slate-600">The answers are seen by HR only. HR can record them here after an interview in person.</p>
              <InterviewForm caseId={c.id} onDone={reload} />
            </Card>
          )}
          {c.interviewSubmitted && !c.interview && <Alert kind="info">The exit interview has been submitted. Thank you.</Alert>}
        </div>

        <div className="space-y-6">
          {c.handover && <HandoverPanel c={c} onChanged={reload} />}
          {c.assets && (c.assets.recoveries?.length ?? 0) > 0 && (
            <Card title="Asset recoveries">
              <ul className="space-y-1 text-sm">{c.assets.recoveries!.map((r) => <li key={r.tag}>{r.name} ({r.tag}): PKR {fmtMoney(r.amount)}</li>)}</ul>
              <p className="mt-2 text-sm font-medium">Total PKR {fmtMoney(c.assets.recoveryTotal)}</p>
            </Card>
          )}
          {c.letters && (
            <Card title="Letters">
              <p className="text-sm text-slate-700">Issued by {c.letters.by} · {fmtDateTime(c.letters.at)}</p>
              {c.letters.emailedTo !== undefined && <p className="mt-1 text-sm text-slate-600">{c.letters.emailedTo ? `Emailed to ${c.letters.emailedTo}` : "Not emailed (no personal email on file)"}</p>}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
