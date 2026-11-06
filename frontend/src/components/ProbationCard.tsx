"use client";

import { useState } from "react";
import { Alert, Button, Card, Field, Input, StatusBadge, Textarea } from "@/components/ui";
import { post } from "@/lib/api";
import { fmtDate, fmtDateTime } from "@/lib/format";
import type { Profile } from "@/lib/types";

/**
 * HR's probation record for one employee: status, the Line Manager's notes, the confirm/extend history,
 * and (for HR) the Confirm employment / Extend probation actions. Rendered only when the API included
 * `probationHistory` — HR, Management or this employee's own Line Manager.
 */
export function ProbationCard({ emp, canAct, onChanged }: { emp: Profile; canAct: boolean; onChanged: () => void }) {
  const history = emp.probationHistory;
  const [extending, setExtending] = useState(false);
  const [form, setForm] = useState({ probationEndDate: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  if (!history) return null;

  const doConfirm = async () => {
    if (!confirm(`Confirm ${emp.fullName}'s employment?`)) return;
    setBusy(true);
    setMsg(null);
    try {
      await post(`/employees/${emp.id}/confirm`);
      setMsg({ kind: "success", text: "Employment confirmed. The employee and their Line Manager have been told." });
      onChanged();
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const extend = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await post(`/employees/${emp.id}/extend-probation`, form);
      setMsg({ kind: "success", text: "Probation extended. The employee and their Line Manager have been told." });
      setExtending(false);
      setForm({ probationEndDate: "", reason: "" });
      onChanged();
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Probation">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={emp.probationStatus ?? "CONFIRMED"} />
          <span className="text-sm text-slate-600">
            {emp.probationStatus === "CONFIRMED" && emp.confirmedAt && `Confirmed on ${fmtDate(emp.confirmedAt)}`}
            {emp.probationStatus === "CONFIRMED" && !emp.confirmedAt && "No probation period on record"}
            {emp.probationStatus === "ON_PROBATION" && `On probation until ${fmtDate(emp.probationEndDate)}`}
            {emp.probationStatus === "DUE" && `Probation ended ${fmtDate(emp.probationEndDate)}`}
          </span>
        </div>

        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

        {canAct && emp.probationStatus !== "CONFIRMED" && !extending && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" loading={busy} onClick={doConfirm}>Confirm employment</Button>
            <Button size="sm" variant="secondary" onClick={() => setExtending(true)}>Extend probation</Button>
          </div>
        )}

        {canAct && extending && (
          <form onSubmit={extend} className="space-y-3 rounded-md p-3 ring-1 ring-slate-200">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="New probation end date">
                <Input type="date" required value={form.probationEndDate} onChange={(e) => setForm({ ...form, probationEndDate: e.target.value })} />
              </Field>
            </div>
            <Field label="Reason"><Textarea required value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
            <div className="flex gap-2">
              <Button size="sm" type="submit" loading={busy}>Save extension</Button>
              <Button size="sm" type="button" variant="ghost" onClick={() => setExtending(false)}>Cancel</Button>
            </div>
          </form>
        )}

        {history.notes.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Line Manager&apos;s notes</div>
            <ul className="space-y-2">
              {history.notes.map((n) => (
                <li key={n.id} className="rounded-md bg-slate-50 p-2 text-sm text-slate-700 ring-1 ring-slate-200">
                  {n.comment}
                  <div className="mt-1 text-xs text-slate-500">{n.author} · {fmtDateTime(n.at)}</div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {history.decisions.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">History</div>
            <ul className="space-y-1 text-sm text-slate-600">
              {history.decisions.map((d) => (
                <li key={d.id}>
                  {d.kind === "CONFIRMED" ? "Confirmed" : `Extended to ${fmtDate(d.newProbationEndDate)}`} by {d.decidedBy}, {fmtDateTime(d.at)}
                  {d.reason && <> — {d.reason}</>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}
