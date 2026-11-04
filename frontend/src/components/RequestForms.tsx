"use client";

import { useEffect, useState } from "react";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { post, put } from "@/lib/api";
import { useApi } from "@/lib/useApi";

type Done = (requestId: number) => void;

async function submitForm(type: string, requestId: number | undefined, fields: Record<string, string>, files: FileList | null) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const f of Array.from(files ?? [])) fd.append("attachments", f);
  return requestId ? put<{ id: number }>(`/requests/${requestId}/resubmit`, fd) : post<{ id: number }>(`/requests/${type}`, fd);
}

function useSubmit(onDone: Done) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<{ id: number }>) => {
    setBusy(true);
    setError(null);
    try {
      const { id } = await fn();
      onDone(id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

type LeaveType = { id: number; code: string; name: string; annualQuota: number | null; noticeDays: number; documentAfterDays: number | null; needsHrApproval: boolean };
type Preview = { days: number; available: number | null; documentRequired: boolean; errors: string[]; needsHrApproval: boolean };

export function LeaveForm({ onDone, requestId, initial }: { onDone: Done; requestId?: number; initial?: { leaveTypeId: number; startDate: string; endDate: string; reason: string } }) {
  const { data: types } = useApi<LeaveType[]>("/leave/types");
  const [form, setForm] = useState({
    leaveTypeId: initial ? String(initial.leaveTypeId) : "",
    startDate: initial?.startDate ?? "",
    endDate: initial?.endDate ?? "",
    reason: initial?.reason ?? "",
  });
  const [files, setFiles] = useState<FileList | null>(null);
  const [preview, setPreview] = useState<(Preview & { key: string }) | null>(null);
  const { busy, error, run } = useSubmit(onDone);

  // Until the employee picks one, the first available leave type is selected.
  const leaveTypeId = form.leaveTypeId || (types?.[0] ? String(types[0].id) : "");
  const previewKey = leaveTypeId && form.startDate && form.endDate ? `${leaveTypeId}|${form.startDate}|${form.endDate}` : null;
  const currentPreview = preview && preview.key === previewKey ? preview : null;

  // Live check of working days, balance, notice period and document requirement
  useEffect(() => {
    if (!previewKey) return;
    const t = setTimeout(() => {
      post<Preview>("/leave/preview", { leaveTypeId, startDate: form.startDate, endDate: form.endDate, excludeRequestId: requestId })
        .then((p) => setPreview({ ...p, key: previewKey }))
        .catch(() => setPreview(null));
    }, 250);
    return () => clearTimeout(t);
  }, [previewKey, leaveTypeId, form.startDate, form.endDate, requestId]);

  const type = types?.find((t) => String(t.id) === leaveTypeId);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => submitForm("leave", requestId, { ...form, leaveTypeId }, files));
      }}
    >
      {error && <Alert>{error}</Alert>}
      <Field label="Leave type">
        <Select value={leaveTypeId} onChange={(e) => setForm({ ...form, leaveTypeId: e.target.value })} required>
          {types?.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </Select>
      </Field>
      {type && (
        <p className="-mt-2 text-xs text-slate-500">
          {type.noticeDays > 0 ? `Apply at least ${type.noticeDays} days before. ` : ""}
          {type.documentAfterDays != null ? `Supporting document needed for more than ${type.documentAfterDays} days. ` : ""}
          {type.needsHrApproval ? "Needs Line Manager and HR approval." : "Needs Line Manager approval."}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="From">
          <Input type="date" required value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value, endDate: form.endDate || e.target.value })} />
        </Field>
        <Field label="To">
          <Input type="date" required value={form.endDate} min={form.startDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
        </Field>
      </div>
      {currentPreview && (
        <div className="rounded-md bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-200">
          <div>
            <strong>{currentPreview.days}</strong> working day{currentPreview.days === 1 ? "" : "s"} (weekends and holidays skipped)
            {currentPreview.available != null && <> · {currentPreview.available} available</>}
          </div>
          {currentPreview.documentRequired && <div className="mt-1 text-amber-800">A supporting document (e.g. medical certificate) is required.</div>}
          {currentPreview.errors.map((e) => (
            <div key={e} className="mt-1 text-red-700">{e}</div>
          ))}
        </div>
      )}
      <Field label="Reason">
        <Textarea required value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
      </Field>
      <Field label="Supporting documents" hint="PDF, JPG or PNG, up to 10 MB each">
        <Input type="file" multiple accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setFiles(e.target.files)} />
      </Field>
      <Button type="submit" loading={busy} disabled={!!currentPreview?.errors.length}>{requestId ? "Resubmit" : "Submit leave request"}</Button>
    </form>
  );
}

export function AttendanceUpdateForm({ onDone, requestId, initial, defaultDate }: {
  onDone: Done; requestId?: number; defaultDate?: string;
  initial?: { date: string; kind: string; checkIn: string | null; checkOut: string | null; reason: string };
}) {
  const [form, setForm] = useState({
    date: initial?.date ?? defaultDate ?? "",
    kind: initial?.kind ?? "MISSED_PUNCH",
    checkIn: initial?.checkIn ?? "",
    checkOut: initial?.checkOut ?? "",
    reason: initial?.reason ?? "",
  });
  const [files, setFiles] = useState<FileList | null>(null);
  const { busy, error, run } = useSubmit(onDone);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => submitForm("attendance-update", requestId, form, files));
      }}
    >
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date">
          <Input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </Field>
        <Field label="Reason type">
          <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            <option value="MISSED_PUNCH">Missed punch</option>
            <option value="FIELD_VISIT">Field visit</option>
            <option value="OTHER">Other</option>
          </Select>
        </Field>
        <Field label="Actual check-in" hint="Leave blank to keep the machine time">
          <Input type="time" value={form.checkIn} onChange={(e) => setForm({ ...form, checkIn: e.target.value })} />
        </Field>
        <Field label="Actual check-out" hint="Leave blank to keep the machine time">
          <Input type="time" value={form.checkOut} onChange={(e) => setForm({ ...form, checkOut: e.target.value })} />
        </Field>
      </div>
      <Field label="Explanation">
        <Textarea required value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
      </Field>
      <Field label="Supporting documents (optional)">
        <Input type="file" multiple accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setFiles(e.target.files)} />
      </Field>
      <Button type="submit" loading={busy}>{requestId ? "Resubmit" : "Submit attendance update"}</Button>
    </form>
  );
}

export const LETTER_TYPES: Record<string, string> = {
  EXPERIENCE: "Experience Letter",
  EMPLOYMENT: "Employment Verification Letter",
  SALARY: "Salary Certificate",
  NOC: "No Objection Certificate",
};

export function LetterForm({ onDone, requestId, initial }: { onDone: Done; requestId?: number; initial?: { letterType: string; addressedTo: string; purpose: string } }) {
  const [form, setForm] = useState({
    letterType: initial?.letterType ?? "EMPLOYMENT",
    addressedTo: initial?.addressedTo ?? "To Whom It May Concern",
    purpose: initial?.purpose ?? "",
  });
  const { busy, error, run } = useSubmit(onDone);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => submitForm("letter", requestId, form, null));
      }}
    >
      {error && <Alert>{error}</Alert>}
      <Field label="Letter type">
        <Select value={form.letterType} onChange={(e) => setForm({ ...form, letterType: e.target.value })}>
          {Object.entries(LETTER_TYPES).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </Select>
      </Field>
      <Field label="Addressed to" hint="e.g. The Manager, Meezan Bank, Gulberg Branch">
        <Input value={form.addressedTo} onChange={(e) => setForm({ ...form, addressedTo: e.target.value })} />
      </Field>
      <Field label="Purpose">
        <Textarea required value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder="e.g. Bank account opening, visa application" />
      </Field>
      <p className="text-xs text-slate-500">Approved by HR. Once approved you can download the letter as a PDF.</p>
      <Button type="submit" loading={busy}>{requestId ? "Resubmit" : "Request letter"}</Button>
    </form>
  );
}
