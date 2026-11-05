"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Alert, Button, Card, Field, Info, Input, LinkButton, PageHeader, Select, Spinner, StatusBadge, Textarea } from "@/components/ui";
import { RequisitionForm } from "@/components/RequisitionForm";
import { useAuth } from "@/lib/auth";
import { del, download, patch, post } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { fmtDate, fmtDateTime, fmtMoney, todayYmd } from "@/lib/format";

type App = {
  id: number; stage: string; stageLabel: string; internal: boolean; name: string; code: string | null; currentRole: string | null;
  email: string | null; phone: string | null; note: string | null; cv: { name: string } | null; appliedAt: string; managerNotifiedAt: string | null;
  events: { stage: string; note: string | null; by: string; at: string }[];
  feedback: { id: number; author: string; recommendation: string; comment: string; at: string }[];
  hiredEmployeeId: number | null;
};
type Requisition = {
  id: number; status: string; statusLabel: string; title: string; grade: string | null; headcount: number; hired: number; employmentType: string;
  department: { id: number; name: string }; reportsTo: { id: number; fullName: string } | null; requestedBy: { id: number; fullName: string };
  targetStartDate: string; justification: string; skills: string | null; jd: { name: string } | null;
  reason: string; gradeChanged: boolean; overHeadcount: boolean; route: string | null;
  replaces: { employeeId: number; fullName: string; designation: string | null; grade: string | null; exitCaseId: number | null; lastWorkingDay: string | null } | null;
  suggestedSalary: { min: number | null; max: number | null } | null;
  budget: { min: number | null; max: number | null; note: string | null; by: string | null; at: string | null } | null;
  request: { id: number; status: string; waitingFor: string | null } | null;
  posting: { scope: string; description: string; requirements: string; postedAt: string; by: string | null; externalFrom: string | null; closingDate: string | null } | null;
  closed: { at: string; by: string | null; reason: string | null } | null;
  applications: App[];
  headcountCheck: { approved: number | null; active: number; leaving: number; openPositions: number; projected: number; over: boolean } | null;
  can: { edit: boolean; submit: boolean; delete: boolean; post: boolean; addCandidate: boolean; manageApplicants: boolean; feedback: boolean; cancel: boolean };
  externalOpen: boolean;
};

const TYPES: Record<string, string> = { PERMANENT: "Permanent", CONTRACT: "Contract", INTERN: "Intern" };
const SCOPES: Record<string, string> = { INTERNAL: "Internal only", EXTERNAL: "External only", BOTH: "Internal first, then external" };
const RECS: Record<string, string> = { HIRE: "Hire", MAYBE: "Maybe", NO_HIRE: "Do not hire" };
const range = (r: { min: number | null; max: number | null } | null) => (r && (r.min != null || r.max != null) ? `PKR ${fmtMoney(r.min)} to ${fmtMoney(r.max)}` : null);

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

function PostForm({ r, onDone }: { r: Requisition; onDone: () => Promise<void> }) {
  const [f, setF] = useState({ scope: "BOTH", description: "", requirements: r.skills ?? "", closingDate: "" });
  const { busy, error, run } = useAction(onDone);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Card title="Post the job">
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Who can apply">
            <Select value={f.scope} onChange={set("scope")}>
              {Object.entries(SCOPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Applications close on"><Input type="date" value={f.closingDate} min={todayYmd()} onChange={set("closingDate")} /></Field>
        </div>
        <Field label="Job description"><Textarea rows={4} value={f.description} onChange={set("description")} /></Field>
        <Field label="Requirements"><Textarea value={f.requirements} onChange={set("requirements")} /></Field>
        <p className="text-xs text-slate-500">&quot;Internal first&quot; keeps the job internal for the number of days in Rules &amp; settings, then HR can add external candidates. No salary is shown on the posting.</p>
        <Button loading={busy === "post"} onClick={() => run("post", () => post(`/hiring/requisitions/${r.id}/post`, f))}>Post job</Button>
      </div>
    </Card>
  );
}

function AddCandidate({ r, onDone }: { r: Requisition; onDone: () => Promise<void> }) {
  const [f, setF] = useState({ name: "", email: "", phone: "", note: "" });
  const [cv, setCv] = useState<File | null>(null);
  const [open, setOpen] = useState(false);
  const { busy, error, run } = useAction(onDone);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  if (!open) return <Button variant="secondary" onClick={() => setOpen(true)}>Add external candidate</Button>;
  return (
    <Card title="Add an external candidate">
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Name"><Input value={f.name} onChange={set("name")} /></Field>
          <Field label="Email"><Input type="email" value={f.email} onChange={set("email")} /></Field>
          <Field label="Phone"><Input value={f.phone} onChange={set("phone")} /></Field>
        </div>
        <Field label="Note"><Textarea value={f.note} onChange={set("note")} /></Field>
        <Field label="CV" hint="PDF or Word"><Input type="file" accept=".pdf,.doc,.docx" onChange={(e) => setCv(e.target.files?.[0] ?? null)} /></Field>
        <div className="flex gap-2">
          <Button loading={busy === "add"} onClick={() => run("add", async () => {
            const fd = new FormData();
            for (const [k, v] of Object.entries(f)) fd.append(k, v);
            if (cv) fd.append("cv", cv);
            await post(`/hiring/requisitions/${r.id}/candidates`, fd);
            setF({ name: "", email: "", phone: "", note: "" });
            setOpen(false);
          })}>Add candidate</Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      </div>
    </Card>
  );
}

function Applicant({ r, a, isHr, onDone }: { r: Requisition; a: App; isHr: boolean; onDone: () => Promise<void> }) {
  const [note, setNote] = useState("");
  const [effective, setEffective] = useState(r.targetStartDate);
  const [rec, setRec] = useState("HIRE");
  const [comment, setComment] = useState("");
  const { busy, error, run } = useAction(onDone);
  const active = ["APPLIED", "SHORTLISTED", "INTERVIEW", "OFFER"].includes(a.stage);
  const order = ["APPLIED", "SHORTLISTED", "INTERVIEW", "OFFER"];
  const next = order.slice(order.indexOf(a.stage) + 1);
  const label: Record<string, string> = { SHORTLISTED: "Shortlist", INTERVIEW: "Invite to interview", OFFER: "Make an offer" };
  return (
    <div className="rounded-2xl p-4 ring-1 ring-slate-200" data-applicant={a.name}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-white">{a.name} <span className="text-xs font-normal text-slate-500">{a.internal ? `Internal · ${a.code}` : "External"}</span></div>
          <div className="text-xs text-slate-500">{a.currentRole ?? [a.email, a.phone].filter(Boolean).join(" · ")} · applied {fmtDate(a.appliedAt)}</div>
        </div>
        <StatusBadge status={a.stage} label={a.stageLabel} />
      </div>
      {a.note && <p className="mt-2 text-sm text-slate-700">“{a.note}”</p>}
      {a.cv && <button className="mt-1 text-sm text-accent hover:underline" onClick={() => download(`/hiring/applications/${a.id}/cv`, a.cv!.name)}>CV: {a.cv.name}</button>}
      {a.managerNotifiedAt && <p className="mt-1 text-xs text-slate-500">Current manager told at shortlisting ({fmtDateTime(a.managerNotifiedAt)})</p>}

      {a.feedback.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-white/10 pt-3 text-sm">
          {a.feedback.map((fb) => (
            <li key={fb.id}><span className="font-semibold text-white">{RECS[fb.recommendation]}</span> · {fb.comment} <span className="text-xs text-slate-500">({fb.author}, {fmtDate(fb.at)})</span></li>
          ))}
        </ul>
      )}
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}

      {isHr && r.can.manageApplicants && active && (
        <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
          <Input aria-label={`Note for ${a.name}`} placeholder="Note for the record (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            {next.map((s) => (
              <Button key={s} size="sm" variant="secondary" loading={busy === s} onClick={() => run(s, () => patch(`/hiring/applications/${a.id}/stage`, { stage: s, note }))}>{label[s]}</Button>
            ))}
            <Button size="sm" variant="ghost" loading={busy === "no"} onClick={() => confirm(`Mark ${a.name} as not selected? They get a polite email.`) && run("no", () => patch(`/hiring/applications/${a.id}/stage`, { stage: "NOT_SELECTED", note }))}>Not selected</Button>
          </div>
          {a.stage === "OFFER" && (
            a.internal ? (
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Moves into the role on"><Input type="date" value={effective} onChange={(e) => setEffective(e.target.value)} /></Field>
                <Button size="sm" loading={busy === "hire"} onClick={() => confirm(`Move ${a.name} into ${r.title}? Their department, manager and designation change, and their manager gets a draft replacement requisition.`) && run("hire", () => post(`/hiring/applications/${a.id}/hire`, { effectiveDate: effective }))}>Appoint (internal move)</Button>
              </div>
            ) : (
              <LinkButton size="sm" href={`/admin/employees?hire=${a.id}&requisition=${r.id}`}>Create employee</LinkButton>
            )
          )}
        </div>
      )}

      {r.can.feedback && ["SHORTLISTED", "INTERVIEW", "OFFER"].includes(a.stage) && (
        <div className="mt-3 grid gap-2 border-t border-white/10 pt-3 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-end">
          <Field label="Recommendation">
            <Select value={rec} onChange={(e) => setRec(e.target.value)}>{Object.entries(RECS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          </Field>
          <Field label="Interview feedback"><Input value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
          <Button size="sm" variant="secondary" disabled={!comment.trim()} loading={busy === "fb"} onClick={() => run("fb", async () => { await post(`/hiring/applications/${a.id}/feedback`, { recommendation: rec, comment }); setComment(""); })}>Add feedback</Button>
        </div>
      )}

      {isHr && a.events.length > 0 && (
        <details className="mt-3 text-xs text-slate-500">
          <summary className="cursor-pointer">History</summary>
          <ul className="mt-1 space-y-0.5">{a.events.map((e, i) => <li key={i}>{e.stage} · {e.by} · {fmtDateTime(e.at)}{e.note ? ` · ${e.note}` : ""}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

export default function RequisitionPage() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const { data: r, loading, error, reload } = useApi<Requisition>(`/hiring/requisitions/${id}`);
  const [cancelReason, setCancelReason] = useState("");
  const top = useAction(reload);
  if (loading && !r) return <Spinner />;
  if (error || !r || !user) return <Alert>{error}</Alert>;
  const isHr = user.roles.includes("HR");
  const notice = search.get("submitted") ? "Requisition submitted for approval." : search.get("saved") ? "Draft saved." : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={r.title}
        subtitle={<>#{r.id} · {r.department.name} · {r.reason === "NEW" ? "New position" : "Replacement"}{r.headcount > 1 ? ` · ${r.headcount} positions` : ""} · raised by {r.requestedBy.fullName}</>}
        actions={r.jd ? <Button variant="secondary" onClick={() => download(`/hiring/requisitions/${r.id}/jd`, r.jd!.name)}>Job description</Button> : null}
      />
      {notice && <Alert kind="success">{notice}</Alert>}
      {top.error && <Alert>{top.error}</Alert>}
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={`REQ_${r.status}`} label={r.statusLabel} />
        {r.request?.waitingFor && <span className="text-sm text-slate-600">Waiting for: <strong className="text-white">{r.request.waitingFor}</strong></span>}
        {r.request && <Link href={`/requests/${r.request.id}`} className="text-sm text-accent hover:underline">Approval request #{r.request.id}</Link>}
        {r.status === "POSTED" && <span className="text-sm text-slate-600">{r.hired} of {r.headcount} filled</span>}
      </div>
      {r.closed && <Alert kind="info">Closed {fmtDateTime(r.closed.at)}{r.closed.by ? ` by ${r.closed.by}` : ""}: {r.closed.reason}</Alert>}

      {r.can.edit ? (
        <Card title="Draft" actions={r.can.delete ? <Button size="sm" variant="ghost" loading={top.busy === "del"} onClick={() => confirm("Delete this draft?") && top.run("del", async () => { await del(`/hiring/requisitions/${r.id}`); router.push("/hiring?tab=requisitions"); })}>Delete draft</Button> : null}>
          {r.replaces && !r.replaces.exitCaseId && <div className="mb-4"><Alert kind="info">This draft replacement was prepared automatically when {r.replaces.fullName} moved to a new role. Check it, then submit it or delete it.</Alert></div>}
          <RequisitionForm
            userId={user.id}
            initial={{
              id: r.id, departmentId: r.department.id, title: r.title, grade: r.grade, headcount: r.headcount, employmentType: r.employmentType,
              reportsToId: r.reportsTo?.id ?? null, targetStartDate: r.targetStartDate, justification: r.justification, skills: r.skills, reason: r.reason,
              exitCaseId: r.replaces?.exitCaseId ?? null, replaces: r.replaces, suggestedMin: r.suggestedSalary?.min ?? null, suggestedMax: r.suggestedSalary?.max ?? null,
            }}
            onDone={(_, submitted) => { router.replace(`/hiring/requisitions/${r.id}?${submitted ? "submitted" : "saved"}=1`); reload(); }}
          />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card title="Position" className="lg:col-span-2">
            <dl className="grid gap-4 sm:grid-cols-3">
              <Info label="Grade" value={r.grade} />
              <Info label="Employment type" value={TYPES[r.employmentType]} />
              <Info label="Positions" value={String(r.headcount)} />
              <Info label="Hiring manager" value={r.reportsTo?.fullName} />
              <Info label="Target start" value={fmtDate(r.targetStartDate)} />
              {r.replaces && <Info label="Replaces" value={<>{r.replaces.fullName}{r.replaces.exitCaseId && isHr ? <> · <Link className="text-accent hover:underline" href={`/exits/${r.replaces.exitCaseId}`}>exit case</Link></> : null}</>} />}
              <div className="sm:col-span-3"><Info label="Why it is needed" value={r.justification} /></div>
              {r.skills && <div className="sm:col-span-3"><Info label="Key skills" value={r.skills} /></div>}
            </dl>
          </Card>
          <Card title="Approval and budget">
            <dl className="grid gap-3">
              {r.route && <Info label="Approval route" value={r.route} />}
              {r.reason === "REPLACEMENT" && <Info label="Grade" value={r.gradeChanged ? "Different from the leaver's (Finance approves)" : "Same as the leaver's"} />}
              <Info label="Headcount" value={r.overHeadcount ? "Over the approved headcount (Management approves)" : "Within the approved headcount"} />
              {r.suggestedSalary && <Info label="Suggested salary" value={range(r.suggestedSalary) ?? "None"} />}
              {r.budget && <Info label="Budget confirmed by Finance" value={range(r.budget) ? `${range(r.budget)}${r.budget.by ? ` · ${r.budget.by}` : ""}${r.budget.note ? ` · ${r.budget.note}` : ""}` : "Not needed on this route"} />}
            </dl>
          </Card>
        </div>
      )}

      {r.can.post && <PostForm r={r} onDone={reload} />}
      {r.posting && (
        <Card title="Job posting">
          <dl className="grid gap-4 sm:grid-cols-3">
            <Info label="Who can apply" value={SCOPES[r.posting.scope]} />
            <Info label="Closes" value={fmtDate(r.posting.closingDate)} />
            <Info label="External candidates from" value={r.posting.externalFrom ? fmtDate(r.posting.externalFrom) : "Internal only"} />
            <div className="sm:col-span-3"><Info label="Description" value={r.posting.description} /></div>
            <div className="sm:col-span-3"><Info label="Requirements" value={r.posting.requirements} /></div>
          </dl>
          <p className="mt-3 text-xs text-slate-500">Posted by {r.posting.by} · {fmtDateTime(r.posting.postedAt)} · <Link className="text-accent hover:underline" href={`/hiring/jobs/${r.id}`}>view as employees see it</Link></p>
        </Card>
      )}

      {(r.posting || r.applications.length > 0) && (
        <Card title={`Applicants (${r.applications.length})`} actions={r.can.addCandidate ? <AddCandidate r={r} onDone={reload} /> : null}>
          {!isHr && <p className="mb-3 text-sm text-slate-500">As hiring manager you see candidates once HR has shortlisted them, and you can add interview feedback.</p>}
          {r.applications.length === 0 ? <p className="text-sm text-slate-500">No applicants yet.</p> : (
            <div className="space-y-3">{r.applications.map((a) => <Applicant key={a.id} r={r} a={a} isHr={isHr} onDone={reload} />)}</div>
          )}
        </Card>
      )}

      {r.can.cancel && (
        <Card title="Close the position">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Reason" className="min-w-64 flex-1"><Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="e.g. Budget frozen" /></Field>
            <Button variant="danger" disabled={!cancelReason.trim()} loading={top.busy === "cancel"} onClick={() => confirm("Close this position? Open applicants are told politely.") && top.run("cancel", () => post(`/hiring/requisitions/${r.id}/cancel`, { reason: cancelReason }))}>Close position</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
