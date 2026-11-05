"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Alert, Button, Card, Field, Info, Input, PageHeader, Spinner, StatusBadge, Textarea } from "@/components/ui";
import { post } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { fmtDate, fmtDateTime } from "@/lib/format";

type Job = {
  id: number; title: string; department: string; reportsTo: string | null; employmentType: string; headcount: number;
  description: string | null; requirements: string | null; closingDate: string | null; postedAt: string | null; open: boolean; eligibility: string[];
  myApplication: { id: number; stage: string; stageLabel: string; note: string | null; cv: string | null; appliedAt: string } | null;
};
const TYPES: Record<string, string> = { PERMANENT: "Permanent", CONTRACT: "Contract", INTERN: "Intern" };

export default function JobPage() {
  const { id } = useParams<{ id: string }>();
  const { data: job, loading, error, reload } = useApi<Job>(`/hiring/jobs/${id}`);
  const [note, setNote] = useState("");
  const [cv, setCv] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  if (loading && !job) return <Spinner />;
  if (error || !job) return <Alert>{error}</Alert>;
  const applied = job.myApplication && job.myApplication.stage !== "WITHDRAWN";

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title={job.title} subtitle={<>{job.department} · {TYPES[job.employmentType]}{job.headcount > 1 ? ` · ${job.headcount} positions` : ""} · closes {fmtDate(job.closingDate)}</>} />
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <Card title="About the role">
        <dl className="grid gap-4 sm:grid-cols-3">
          <Info label="Department" value={job.department} />
          <Info label="Reports to" value={job.reportsTo} />
          <Info label="Applications close" value={fmtDate(job.closingDate)} />
          <div className="sm:col-span-3"><Info label="Description" value={job.description} /></div>
          <div className="sm:col-span-3"><Info label="Requirements" value={job.requirements} /></div>
        </dl>
      </Card>

      {applied ? (
        <Card title="Your application">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={job.myApplication!.stage} label={job.myApplication!.stageLabel} />
            <span className="text-sm text-slate-600">Applied {fmtDateTime(job.myApplication!.appliedAt)}</span>
          </div>
          {job.myApplication!.note && <p className="mt-3 text-sm text-slate-700">“{job.myApplication!.note}”</p>}
          <p className="mt-3 text-xs text-slate-500">Your application is confidential. Your current manager is told only if you are shortlisted. You can withdraw it from My applications.</p>
        </Card>
      ) : !job.open ? (
        <Alert kind="info">This job is no longer open for applications.</Alert>
      ) : job.eligibility.length ? (
        <Alert kind="warning">You cannot apply for this job: {job.eligibility.join("; ")}.</Alert>
      ) : (
        <Card title="Apply">
          <div className="space-y-4">
            <Alert kind="info">Your application is confidential. Your current manager is told only if you are shortlisted.</Alert>
            <Field label="Why are you a good fit? (optional)"><Textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <Field label="CV (optional)" hint="PDF or Word"><Input type="file" accept=".pdf,.doc,.docx" onChange={(e) => setCv(e.target.files?.[0] ?? null)} /></Field>
            <Button
              loading={busy}
              onClick={async () => {
                setBusy(true);
                setMsg(null);
                try {
                  const fd = new FormData();
                  fd.append("note", note);
                  if (cv) fd.append("cv", cv);
                  await post(`/hiring/jobs/${job.id}/apply`, fd);
                  setMsg({ kind: "success", text: "Application sent. HR will be in touch." });
                  await reload();
                } catch (err) {
                  setMsg({ kind: "error", text: (err as Error).message });
                } finally {
                  setBusy(false);
                }
              }}
            >
              Apply for this job
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
