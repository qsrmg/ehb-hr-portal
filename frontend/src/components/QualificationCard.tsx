"use client";

import { useState } from "react";
import { Alert, Badge, Button, Card, Field, Input, Select, Spinner, Textarea } from "@/components/ui";
import { api, download, post } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { fmtDate, fmtDateTime } from "@/lib/format";

type Qualification = {
  id: number; type: string; evidenceType: string; institution: string | null;
  completed: boolean; completedAt: string | null; documentName: string | null; hasDocument: boolean;
  verifiedAt: string | null; verifiedBy: string | null; verified: boolean; note: string | null;
  createdBy: string; createdAt: string;
};
type Qualifications = { status: "VERIFIED" | "PENDING" | "NONE"; records: Qualification[] };

const TYPES: Record<string, string> = { BACHELORS: "Bachelor's degree", HIGHER_DEGREE: "Higher degree", PROFESSIONAL_CERTIFICATION: "Professional certification", OTHER: "Other" };
const EVIDENCE: Record<string, string> = {
  DEGREE_CERTIFICATE: "Degree certificate", PROVISIONAL_CERTIFICATE: "Provisional certificate", TRANSCRIPT: "Transcript",
  COMPLETION_CERTIFICATE: "Completion certificate", INSTITUTION_VERIFICATION: "Institution verification",
  PROFESSIONAL_CERTIFICATION: "Professional certification", OTHER: "Other",
};
const STATUS_TONE = { VERIFIED: "green", PENDING: "amber", NONE: "slate" } as const;
const STATUS_LABEL = { VERIFIED: "Verified", PENDING: "Pending verification", NONE: "No qualification on record" } as const;

function AddQualificationForm({ employeeId, onDone }: { employeeId: number; onDone: () => Promise<void> }) {
  const [form, setForm] = useState({ type: "BACHELORS", evidenceType: "DEGREE_CERTIFICATE", institution: "", completed: false, completedAt: "", note: "" });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("type", form.type);
      fd.append("evidenceType", form.evidenceType);
      fd.append("institution", form.institution);
      fd.append("completed", String(form.completed));
      fd.append("completedAt", form.completedAt);
      fd.append("note", form.note);
      if (file) fd.append("file", file);
      await post(`/employees/${employeeId}/qualifications`, fd);
      await onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md p-3 ring-1 ring-slate-200">
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type">
          <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="Evidence type" hint="Employment Eligibility Policy §5">
          <Select value={form.evidenceType} onChange={(e) => setForm({ ...form, evidenceType: e.target.value })}>
            {Object.entries(EVIDENCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="Institution (optional)"><Input value={form.institution} onChange={(e) => setForm({ ...form, institution: e.target.value })} /></Field>
        <Field label="Completed on (optional)"><Input type="date" value={form.completedAt} onChange={(e) => setForm({ ...form, completedAt: e.target.value })} /></Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={form.completed} onChange={(e) => setForm({ ...form, completed: e.target.checked })} />
          The qualification has been completed (merely enrolled or in progress does not count — §4)
        </label>
        <Field label="Evidence file (optional)" className="sm:col-span-2" hint="PDF, JPG or PNG"><Input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
        <Field label="Note (optional)" className="sm:col-span-2"><Textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
      </div>
      <Button size="sm" loading={busy} onClick={save}>Add record</Button>
    </div>
  );
}

function QualificationRow({ employeeId, q, canAct, onChanged }: { employeeId: number; q: Qualification; canAct: boolean; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);

  const update = async (key: string, body: Record<string, unknown>) => {
    setBusy(key);
    try {
      const fd = new FormData();
      for (const [k, v] of Object.entries(body)) fd.append(k, String(v));
      await api(`/employees/${employeeId}/qualifications/${q.id}`, { method: "PATCH", body: fd });
      await onChanged();
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="rounded-md bg-slate-50 p-3 text-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-medium text-slate-900">{TYPES[q.type]}</span>
          {q.institution && <span className="text-slate-600"> · {q.institution}</span>}
          <span className="ml-2 text-xs text-slate-500">{EVIDENCE[q.evidenceType]}{q.completed ? "" : " · in progress"}</span>
        </div>
        <Badge tone={q.verified ? "green" : "amber"}>{q.verified ? "Verified" : "Not verified"}</Badge>
      </div>
      {q.note && <p className="mt-1 text-slate-600">{q.note}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        {q.completedAt && <span>Completed {fmtDate(q.completedAt)}</span>}
        {q.verifiedAt && <span>Verified by {q.verifiedBy}, {fmtDateTime(q.verifiedAt)}</span>}
        <span>Entered by {q.createdBy}, {fmtDateTime(q.createdAt)}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {q.hasDocument && (
          <Button size="sm" variant="secondary" onClick={() => download(`/employees/${employeeId}/qualifications/${q.id}/document`, q.documentName ?? "qualification-document")}>
            Download evidence
          </Button>
        )}
        {canAct && (
          <>
            {!q.completed && (
              <Button size="sm" variant="secondary" loading={busy === "completed"} onClick={() => update("completed", { completed: true })}>
                Mark completed
              </Button>
            )}
            <Button
              size="sm"
              variant={q.verified ? "ghost" : "primary"}
              loading={busy === "verify"}
              disabled={!q.completed && !q.verified}
              onClick={() => update("verify", { verified: !q.verified })}
            >
              {q.verified ? "Unverify" : "Mark verified"}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

/**
 * Employment Eligibility Policy, slice 1: an employee's qualification claims. HR (canAct) can add records
 * and mark them completed/verified; everyone else only ever sees their own, read-only, with no edit controls
 * and no form — the server refuses anyone else's (Line Manager, HOD, Finance, Admin, Management included).
 */
export function QualificationCard({ employeeId, canAct }: { employeeId: number; canAct: boolean }) {
  const { data, loading, error, reload } = useApi<Qualifications>(`/employees/${employeeId}/qualifications`);
  const [adding, setAdding] = useState(false);
  if (loading) return <Spinner />;
  if (error || !data) return null;

  return (
    <Card title="Qualification" actions={canAct && !adding ? <Button size="sm" onClick={() => setAdding(true)}>Add record</Button> : null}>
      <div className="space-y-4">
        <Badge tone={STATUS_TONE[data.status]}>{STATUS_LABEL[data.status]}</Badge>
        {canAct && adding && <AddQualificationForm employeeId={employeeId} onDone={async () => { setAdding(false); await reload(); }} />}
        {data.records.length > 0 && (
          <ul className="space-y-2">
            {data.records.map((q) => (
              <QualificationRow key={q.id} employeeId={employeeId} q={q} canAct={canAct} onChanged={reload} />
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
