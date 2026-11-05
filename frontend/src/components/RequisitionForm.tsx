"use client";

import { useState } from "react";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { post, put } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { fmtDate } from "@/lib/format";

type Options = {
  departments: { id: number; name: string }[];
  exits: { exitCaseId: number; lastWorkingDay: string; employeeId: number; fullName: string; designation: string | null; grade: string | null; departmentId: number | null; managerId: number | null }[];
  managers: { id: number; fullName: string; code: string }[];
  canSeeSalary: boolean;
};

export type RequisitionInitial = {
  id: number; departmentId: number; title: string; grade: string | null; headcount: number; employmentType: string; reportsToId: number | null;
  targetStartDate: string; justification: string; skills: string | null; reason: string; exitCaseId: number | null; replaces: { fullName: string } | null;
  suggestedMin: number | null; suggestedMax: number | null;
};

/** New requisition, or a draft being changed. Saves as a draft or submits for approval. */
export function RequisitionForm({ initial, userId, onDone }: { initial?: RequisitionInitial; userId: number; onDone: (id: number, submitted: boolean) => void }) {
  const { data: opts } = useApi<Options>("/hiring/options");
  const [f, setF] = useState({
    departmentId: initial ? String(initial.departmentId) : "",
    reason: initial?.reason ?? "NEW",
    exitCaseId: initial?.exitCaseId ? String(initial.exitCaseId) : "",
    title: initial?.title ?? "",
    grade: initial?.grade ?? "",
    headcount: String(initial?.headcount ?? 1),
    employmentType: initial?.employmentType ?? "PERMANENT",
    reportsToId: initial?.reportsToId ? String(initial.reportsToId) : String(userId),
    targetStartDate: initial?.targetStartDate ?? "",
    justification: initial?.justification ?? "",
    skills: initial?.skills ?? "",
    suggestedSalaryMin: initial?.suggestedMin != null ? String(initial.suggestedMin) : "",
    suggestedSalaryMax: initial?.suggestedMax != null ? String(initial.suggestedMax) : "",
  });
  const [jd, setJd] = useState<File | null>(null);
  const [busy, setBusy] = useState<"save" | "submit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const exits = opts?.exits.filter((x) => !f.departmentId || String(x.departmentId) === f.departmentId) ?? [];
  const leaver = opts?.exits.find((x) => String(x.exitCaseId) === f.exitCaseId);
  const draftReplacement = !!initial?.replaces && !initial.exitCaseId;
  const pickLeaver = (value: string) => {
    const x = opts?.exits.find((e) => String(e.exitCaseId) === value);
    setF({
      ...f, exitCaseId: value,
      ...(x ? { title: x.designation ?? f.title, grade: x.grade ?? "", reportsToId: x.managerId ? String(x.managerId) : f.reportsToId, departmentId: x.departmentId ? String(x.departmentId) : f.departmentId } : {}),
    });
  };

  const save = async (submit: boolean) => {
    setBusy(submit ? "submit" : "save");
    setError(null);
    try {
      const fd = new FormData();
      for (const [k, v] of Object.entries(f)) fd.append(k, v);
      fd.append("submit", String(submit));
      if (jd) fd.append("jd", jd);
      const res = initial ? await put<{ id: number }>(`/hiring/requisitions/${initial.id}`, fd) : await post<{ id: number }>("/hiring/requisitions", fd);
      onDone(res.id, submit);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!opts) return null;
  if (!opts.departments.length) return <Alert kind="info">Requisitions are raised by Line Managers and HODs for their own department, and by HR.</Alert>;

  return (
    <form className="space-y-5" onSubmit={(e) => e.preventDefault()}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Department">
          <Select required value={f.departmentId} onChange={set("departmentId")}>
            <option value="">Choose…</option>
            {opts.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </Field>
        <Field label="Reason">
          <Select value={f.reason} onChange={set("reason")} disabled={draftReplacement}>
            <option value="NEW">New position</option>
            <option value="REPLACEMENT">Replacement</option>
          </Select>
        </Field>
      </div>
      {f.reason === "REPLACEMENT" && (
        draftReplacement ? (
          <Alert kind="info">Replacement for {initial!.replaces!.fullName}, who moved to a new role.</Alert>
        ) : (
          <Field label="Replaces" hint="A leaver whose resignation (or exit) has been approved. The title, grade and manager are taken from their job; a different grade adds the Finance step.">
            <Select required value={f.exitCaseId} onChange={(e) => pickLeaver(e.target.value)}>
              <option value="">Choose…</option>
              {exits.map((x) => <option key={x.exitCaseId} value={x.exitCaseId}>{x.fullName}{x.designation ? `, ${x.designation}` : ""} (last day {fmtDate(x.lastWorkingDay)})</option>)}
            </Select>
          </Field>
        )
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Position title" className="lg:col-span-2"><Input required value={f.title} onChange={set("title")} placeholder="e.g. Backend Developer" /></Field>
        <Field label="Grade" hint={leaver ? `${leaver.fullName}'s grade: ${leaver.grade ?? "none"}` : "Optional"}><Input value={f.grade} onChange={set("grade")} placeholder="e.g. G5" /></Field>
        <Field label="Number of positions"><Input type="number" min={1} max={20} value={f.headcount} onChange={set("headcount")} /></Field>
        <Field label="Employment type">
          <Select value={f.employmentType} onChange={set("employmentType")}>
            <option value="PERMANENT">Permanent</option>
            <option value="CONTRACT">Contract</option>
            <option value="INTERN">Intern</option>
          </Select>
        </Field>
        <Field label="Target start date"><Input type="date" required value={f.targetStartDate} onChange={set("targetStartDate")} /></Field>
        <Field label="Hiring manager (reports to)" className="lg:col-span-2">
          <Select value={f.reportsToId} onChange={set("reportsToId")}>
            {opts.managers.map((m) => <option key={m.id} value={m.id}>{m.fullName} ({m.code})</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Why is this position needed?"><Textarea required value={f.justification} onChange={set("justification")} /></Field>
      <Field label="Key skills (optional)"><Textarea value={f.skills} onChange={set("skills")} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Suggested salary from (PKR, optional)" hint="A suggestion only; Finance confirms the budget"><Input type="number" min={0} value={f.suggestedSalaryMin} onChange={set("suggestedSalaryMin")} /></Field>
        <Field label="Suggested salary to (PKR, optional)"><Input type="number" min={0} value={f.suggestedSalaryMax} onChange={set("suggestedSalaryMax")} /></Field>
      </div>
      <Field label="Job description (optional)" hint="PDF or Word"><Input type="file" accept=".pdf,.doc,.docx" onChange={(e) => setJd(e.target.files?.[0] ?? null)} /></Field>
      <p className="text-xs text-slate-500">
        Approval: a new position (or one over the approved headcount) goes to the HOD, Finance, Management and HR; a replacement at the same grade to the HOD and HR; a replacement at a different grade adds Finance.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" loading={busy === "save"} onClick={() => save(false)}>Save draft</Button>
        <Button type="button" loading={busy === "submit"} onClick={() => save(true)}>Submit for approval</Button>
      </div>
    </form>
  );
}
