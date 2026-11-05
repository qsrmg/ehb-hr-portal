"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Alert, Button, Card, Field, Info, Input, PageHeader, Select, Spinner, StatusBadge, Table, Td, Textarea } from "@/components/ui";
import { KpiEditor, type Kpi } from "@/components/KpiEditor";
import { del, download, patch, post, put } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { fmtDate, fmtDateTime } from "@/lib/format";

type ScoreKpi = Kpi & {
  id: number; perspectiveLabel: string; actual: string | null; selfRating: number | null; selfComment: string | null;
  managerRating: number | null; managerComment: string | null; finalRating: number | null;
};
type Scorecard = {
  id: number; stage: string; stageLabel: string; waitingFor: string | null; nextAction: string | null;
  cycle: { id: number; name: string; status: string; startDate: string; endDate: string; goalsDueDate: string; checkInDate: string | null; reviewOpensDate: string; reviewDueDate: string; reviewOpen: boolean };
  employee: { id: number; fullName: string; code: string; designation: string | null; department: string | null; manager: string | null };
  kpis: ScoreKpi[];
  goalsSetBy: string | null; goalsSentAt: string | null; goalsAcknowledgedAt: string | null; employeeGoalComment: string | null;
  selfSubmittedAt: string | null; selfComment: string | null; managerSubmittedAt: string | null; reviewedBy: string | null; managerComment: string | null;
  score: number | null; band: string | null; completedAt: string | null; employeeAckAt: string | null; employeeAckComment: string | null;
  appeal: { reason: string | null; at: string; decision: string | null; decidedAt: string | null; decidedBy: string | null; changed: boolean | null } | null;
  checkIns: { id: number; author: string; comment: string; at: string }[];
  adjustments: { kpi: string; from: number; to: number; reason: string; kind: string; by: string; at: string }[];
  goalsRequestId: number | null; reviewRequestId: number | null;
  can: { editGoals: boolean; ackGoals: boolean; checkIn: boolean; selfReview: boolean; managerReview: boolean; calibrate: boolean; decideAppeal: boolean; appeal: boolean; acknowledge: boolean; remove: boolean; pdf: boolean };
  attendance: { from: string; to: string; onTime: number; late: number; halfDay: number; absent: number; leaveDays: number };
  templateAvailable: boolean;
  scale: { labels: Record<number, string>; bands: { rating: number; from: number; label: string }[]; minPerspectiveWeight: number };
  limits: { maxKpis: number; minKpiWeight: number };
};

const STAGES = ["GOAL_SETTING", "GOALS_WITH_EMPLOYEE", "GOALS_APPROVAL", "ACTIVE", "MANAGER_REVIEW", "SIGN_OFF", "COMPLETED", "ACKNOWLEDGED"];
const STAGE_SHORT: Record<string, string> = {
  GOAL_SETTING: "Goals set", GOALS_WITH_EMPLOYEE: "Employee", GOALS_APPROVAL: "Goals approved", ACTIVE: "Check-in",
  MANAGER_REVIEW: "Reviews", SIGN_OFF: "Sign-off", COMPLETED: "Released", ACKNOWLEDGED: "Acknowledged",
};

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

function RatingSelect({ value, onChange, labels, label }: { value: number | null; onChange: (v: number | null) => void; labels: Record<number, string>; label: string }) {
  return (
    <Select aria-label={label} value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">Choose…</option>
      {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} · {labels[n]}</option>)}
    </Select>
  );
}

function Stepper({ stage }: { stage: string }) {
  const at = stage === "APPEAL" ? STAGES.indexOf("COMPLETED") : STAGES.indexOf(stage);
  return (
    <ol className="flex flex-wrap gap-x-1 gap-y-2" aria-label="Progress">
      {STAGES.map((s, i) => (
        <li key={s} className="flex items-center gap-1">
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${i < at ? "bg-primary/25 text-white" : i === at ? "bg-sun text-ink-950" : "bg-white/5 text-slate-500"}`} aria-current={i === at ? "step" : undefined}>
            {STAGE_SHORT[s]}
          </span>
          {i < STAGES.length - 1 && <span aria-hidden="true" className="h-px w-3 bg-white/15" />}
        </li>
      ))}
    </ol>
  );
}

function SelfReview({ sc, onDone }: { sc: Scorecard; onDone: () => Promise<void> }) {
  const [rows, setRows] = useState(() => sc.kpis.map((k) => ({ id: k.id, actual: k.actual ?? "", selfRating: k.selfRating, selfComment: k.selfComment ?? "" })));
  const [comment, setComment] = useState(sc.selfComment ?? "");
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction(onDone);
  const save = (submit: boolean) => run(submit ? "submit" : "save", async () => {
    await put(`/performance/scorecards/${sc.id}/self-review`, { kpis: rows, comment, submit });
    setSaved(!submit);
  });
  return (
    <Card title="Your self-review">
      <div className="space-y-4">
        {sc.kpis.map((k, i) => (
          <div key={k.id} className="rounded-xl p-3 ring-1 ring-slate-200">
            <div className="text-sm font-semibold text-white">{k.title} <span className="font-normal text-slate-500">· {k.perspectiveLabel} · {k.weight}% · target {k.target}</span></div>
            <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_14rem]">
              <Input aria-label={`Actual result for ${k.title}`} placeholder="Actual result" value={rows[i]!.actual} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, actual: e.target.value } : r)))} />
              <RatingSelect label={`Your rating for ${k.title}`} labels={sc.scale.labels} value={rows[i]!.selfRating} onChange={(v) => setRows(rows.map((r, j) => (j === i ? { ...r, selfRating: v } : r)))} />
              <Input aria-label={`Your comment on ${k.title}`} placeholder="Comment (optional)" value={rows[i]!.selfComment} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, selfComment: e.target.value } : r)))} className="sm:col-span-2" />
            </div>
          </div>
        ))}
        <Field label="Overall comment (optional)"><Textarea value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
        {error && <Alert>{error}</Alert>}
        {saved && <Alert kind="success">Draft saved.</Alert>}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" loading={busy === "save"} onClick={() => save(false)}>Save draft</Button>
          <Button loading={busy === "submit"} onClick={() => confirm("Submit your self-review to your Line Manager?") && save(true)}>Submit self-review</Button>
        </div>
      </div>
    </Card>
  );
}

function ManagerReview({ sc, onDone }: { sc: Scorecard; onDone: () => Promise<void> }) {
  const [rows, setRows] = useState(() => sc.kpis.map((k) => ({ id: k.id, managerRating: k.managerRating, managerComment: k.managerComment ?? "" })));
  const [comment, setComment] = useState(sc.managerComment ?? "");
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction(onDone);
  const save = (submit: boolean) => run(submit ? "submit" : "save", async () => {
    await put(`/performance/scorecards/${sc.id}/manager-review`, { kpis: rows, comment, submit });
    setSaved(!submit);
  });
  const preview = (() => {
    if (rows.some((r) => !r.managerRating)) return null;
    const score = Math.round(sc.kpis.reduce((s, k, i) => s + k.weight * rows[i]!.managerRating!, 0)) / 100;
    return { score, band: sc.scale.bands.find((b) => score >= b.from)?.label ?? sc.scale.labels[1] };
  })();
  return (
    <Card title={`Rate ${sc.employee.fullName.split(" ")[0]}'s KPIs`}>
      <div className="space-y-4">
        {sc.kpis.map((k, i) => (
          <div key={k.id} className="rounded-xl p-3 ring-1 ring-slate-200">
            <div className="text-sm font-semibold text-white">{k.title} <span className="font-normal text-slate-500">· {k.perspectiveLabel} · {k.weight}% · target {k.target}</span></div>
            <p className="mt-1 text-sm text-slate-600">Actual: {k.actual || "—"} · Self-rating: {k.selfRating ? `${k.selfRating} · ${sc.scale.labels[k.selfRating]}` : "—"}{k.selfComment ? ` · “${k.selfComment}”` : ""}</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-[14rem_minmax(0,1fr)]">
              <RatingSelect label={`Your rating for ${k.title}`} labels={sc.scale.labels} value={rows[i]!.managerRating} onChange={(v) => setRows(rows.map((r, j) => (j === i ? { ...r, managerRating: v } : r)))} />
              <Input aria-label={`Comment on ${k.title}`} placeholder="Comment (optional)" value={rows[i]!.managerComment} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, managerComment: e.target.value } : r)))} />
            </div>
          </div>
        ))}
        {sc.selfComment && <Info label="Employee's overall comment" value={sc.selfComment} />}
        <Field label="Your overall comment"><Textarea value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
        {preview && <p className="text-sm text-slate-600">Weighted score: <strong className="text-white">{preview.score.toFixed(2)}</strong> of 5 · {preview.band}</p>}
        {error && <Alert>{error}</Alert>}
        {saved && <Alert kind="success">Draft saved.</Alert>}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" loading={busy === "save"} onClick={() => save(false)}>Save draft</Button>
          <Button loading={busy === "submit"} onClick={() => confirm("Submit your ratings for sign-off by the HOD and HR?") && save(true)}>Submit for sign-off</Button>
        </div>
      </div>
    </Card>
  );
}

function Calibrate({ sc, onDone, appeal }: { sc: Scorecard; onDone: () => Promise<void>; appeal: boolean }) {
  const [kpiId, setKpiId] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const { busy, error, run } = useAction(onDone);
  const kpi = sc.kpis.find((k) => String(k.id) === kpiId);
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="KPI">
          <Select value={kpiId} onChange={(e) => setKpiId(e.target.value)}>
            <option value="">Choose…</option>
            {sc.kpis.map((k) => <option key={k.id} value={k.id}>{k.title} (now {k.finalRating})</option>)}
          </Select>
        </Field>
        <Field label="New rating"><RatingSelect label="New rating" labels={sc.scale.labels} value={rating} onChange={setRating} /></Field>
      </div>
      <Field label="Reason (required, kept in the history)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      {error && <Alert>{error}</Alert>}
      <Button
        variant="secondary"
        disabled={!kpi || !rating}
        loading={busy === "cal"}
        onClick={() => run("cal", async () => {
          await patch(`/performance/scorecards/${sc.id}/kpis/${kpiId}/final-rating`, { rating, reason });
          setReason("");
          setRating(null);
          setKpiId("");
        })}
      >
        {appeal ? "Change rating for the appeal" : "Change rating"}
      </Button>
    </div>
  );
}

function CommentAction({ label, button, required, onSubmit, variant = "primary" }: { label: string; button: string; required?: boolean; onSubmit: (text: string) => Promise<unknown>; variant?: "primary" | "secondary" }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <Field label={label}><Textarea value={text} onChange={(e) => setText(e.target.value)} /></Field>
      {error && <Alert>{error}</Alert>}
      <Button
        variant={variant}
        loading={busy}
        disabled={required && !text.trim()}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await onSubmit(text);
            setText("");
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {button}
      </Button>
    </div>
  );
}

export default function ScorecardPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: sc, loading, error, reload } = useApi<Scorecard>(`/performance/scorecards/${id}`);
  const [notice, setNotice] = useState<string | null>(null);
  // Bumped when a template replaces the KPIs, so the editor starts again from the new ones.
  const [editorVersion, setEditorVersion] = useState(0);
  const top = useAction(reload);
  if (loading && !sc) return <Spinner />;
  if (error || !sc) return <Alert>{error}</Alert>;

  const resultShown = sc.score != null && sc.band != null;
  const showSelf = sc.kpis.some((k) => k.selfRating != null);
  const showFinal = sc.kpis.some((k) => k.finalRating != null);
  const say = (msg: string) => async (fn: Promise<unknown>) => { await fn; setNotice(msg); await reload(); };

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${sc.employee.fullName} · ${sc.cycle.name}`}
        subtitle={<>{sc.employee.code}{sc.employee.designation ? ` · ${sc.employee.designation}` : ""}{sc.employee.department ? ` · ${sc.employee.department}` : ""} · {fmtDate(sc.cycle.startDate)} to {fmtDate(sc.cycle.endDate)}</>}
        actions={sc.can.pdf ? <Button variant="secondary" onClick={() => download(`/performance/scorecards/${sc.id}/pdf`, `scorecard-${sc.employee.code}.pdf`)}>Download PDF</Button> : null}
      />
      {notice && <Alert kind="success">{notice}</Alert>}
      {top.error && <Alert>{top.error}</Alert>}

      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={sc.stage} label={sc.stageLabel} />
        {sc.waitingFor && <span className="text-sm text-slate-600">Waiting for: <strong className="text-white">{sc.waitingFor}</strong></span>}
        {sc.nextAction && <span className="rounded-full bg-sun px-2.5 py-0.5 text-xs font-bold text-ink-950">{sc.nextAction}</span>}
        {sc.cycle.status === "CLOSED" && <span className="text-sm text-slate-500">This cycle is closed.</span>}
      </div>
      <Stepper stage={sc.stage} />

      {resultShown && (
        <section className="rounded-2xl bg-gradient-to-br from-primary/30 to-ink-800/80 p-6 ring-1 ring-primary/40" aria-label="Result">
          <div className="text-sm text-slate-600">{sc.stage === "SIGN_OFF" ? "Score so far (not yet released)" : "Overall result"}</div>
          <div className="mt-1 flex flex-wrap items-baseline gap-3">
            <span className="font-display text-5xl font-extrabold text-white">{sc.score!.toFixed(2)}</span>
            <span className="text-lg text-slate-600">of 5</span>
            <span className="rounded-full bg-sun px-3 py-1 text-sm font-bold text-ink-950">{sc.band}</span>
          </div>
          {sc.managerComment && <p className="mt-3 max-w-3xl text-sm text-slate-700">“{sc.managerComment}” <span className="text-slate-500">· {sc.reviewedBy}</span></p>}
        </section>
      )}

      {!sc.can.editGoals && (
        <Card title="Goals and ratings">
          {sc.kpis.length === 0 ? <p className="text-sm text-slate-500">The Line Manager has not set the goals yet.</p> : (
            <Table head={["KPI", "Weight", "Target", ...(showSelf ? ["Actual", "Self"] : []), ...(showFinal ? ["Manager", "Final"] : [])]}>
              {sc.kpis.map((k) => (
                <tr key={k.id}>
                  <Td className="whitespace-normal">
                    <div className="font-medium text-white">{k.title}</div>
                    <div className="text-xs text-slate-500">{k.perspectiveLabel} · {k.measure}</div>
                    {(k.selfComment || k.managerComment) && (
                      <div className="mt-1 space-y-0.5 text-xs text-slate-600">
                        {k.selfComment && <div>Employee: “{k.selfComment}”</div>}
                        {k.managerComment && <div>Manager: “{k.managerComment}”</div>}
                      </div>
                    )}
                  </Td>
                  <Td className="tabular-nums">{k.weight}%</Td>
                  <Td className="whitespace-normal">{k.target}</Td>
                  {showSelf && <><Td className="whitespace-normal">{k.actual ?? "—"}</Td><Td>{k.selfRating ?? "—"}</Td></>}
                  {showFinal && <><Td>{k.managerRating ?? "—"}</Td><Td className="font-bold text-white">{k.finalRating ?? "—"}{k.finalRating !== k.managerRating && k.finalRating != null ? " *" : ""}</Td></>}
                </tr>
              ))}
            </Table>
          )}
          {showFinal && sc.kpis.some((k) => k.finalRating !== k.managerRating) && <p className="mt-2 text-xs text-slate-500">* Changed by HR; see the rating history.</p>}
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {sc.can.editGoals ? (
            <Card title="Set the goals" actions={sc.templateAvailable ? (
              <Button size="sm" variant="secondary" loading={top.busy === "tpl"} onClick={() => confirm("Replace the KPIs with the department template?") && top.run("tpl", async () => { await post(`/performance/scorecards/${sc.id}/template/load`); setEditorVersion((v) => v + 1); })}>Load department template</Button>
            ) : null}>
              {sc.employeeGoalComment && <div className="mb-4"><Alert kind="warning">{sc.employee.fullName.split(" ")[0]} asked for changes: “{sc.employeeGoalComment}”</Alert></div>}
              <KpiEditor
                key={editorVersion}
                initial={sc.kpis}
                limits={{ ...sc.limits, minPerspectiveWeight: sc.scale.minPerspectiveWeight }}
                saveLabel="Save goals"
                onSave={async (kpis) => { await put(`/performance/scorecards/${sc.id}/kpis`, { kpis }); await reload(); }}
              >
                <Button
                  variant="secondary"
                  loading={top.busy === "send"}
                  onClick={() => top.run("send", () => say(`Goals sent to ${sc.employee.fullName.split(" ")[0]}.`)(post(`/performance/scorecards/${sc.id}/send-goals`)))}
                >
                  Send to {sc.employee.fullName.split(" ")[0]}
                </Button>
              </KpiEditor>
              <p className="mt-3 text-xs text-slate-500">Save your changes first, then send. Goals are due {fmtDate(sc.cycle.goalsDueDate)}.</p>
            </Card>
          ) : null}

          {sc.can.ackGoals && (
            <Card title="Your goals">
              <p className="mb-4 text-sm text-slate-600">{sc.goalsSetBy ?? "Your Line Manager"} set these goals. Acknowledge them, or ask for changes.</p>
              <div className="grid gap-6 md:grid-cols-2">
                <CommentAction label="Comment (optional)" button="Acknowledge goals" onSubmit={(c) => say("Goals acknowledged.")(post(`/performance/scorecards/${sc.id}/goals/acknowledge`, { comment: c }))} />
                <CommentAction label="What should change?" button="Ask for changes" variant="secondary" required onSubmit={(c) => say("Your Line Manager has been asked to change the goals.")(post(`/performance/scorecards/${sc.id}/goals/request-changes`, { comment: c }))} />
              </div>
            </Card>
          )}

          {sc.can.selfReview && <SelfReview sc={sc} onDone={reload} />}
          {sc.stage === "ACTIVE" && !sc.cycle.reviewOpen && sc.cycle.status === "OPEN" && (
            <Alert kind="info">The self-review opens on {fmtDate(sc.cycle.reviewOpensDate)} and is due by {fmtDate(sc.cycle.reviewDueDate)}.</Alert>
          )}
          {sc.can.managerReview && <ManagerReview sc={sc} onDone={reload} />}

          {sc.can.calibrate && sc.stage === "SIGN_OFF" && (
            <Card title="Calibration (HR)">
              <p className="mb-3 text-sm text-slate-600">Change a rating if needed, with the reason. Then approve the sign-off request to release the result.</p>
              <Calibrate sc={sc} onDone={reload} appeal={false} />
              {sc.reviewRequestId && <div className="mt-4"><Link className="font-semibold text-accent hover:underline" href={`/requests/${sc.reviewRequestId}`}>Open the sign-off request to approve →</Link></div>}
            </Card>
          )}

          {sc.appeal && (
            <Card title="Appeal">
              <dl className="grid gap-3">
                <Info label={`Employee's appeal · ${fmtDateTime(sc.appeal.at)}`} value={sc.appeal.reason} />
                {sc.appeal.decidedAt && <Info label={`HR's decision (final) · ${sc.appeal.decidedBy} · ${fmtDateTime(sc.appeal.decidedAt)}`} value={`${sc.appeal.changed ? "Result changed. " : "Result kept. "}${sc.appeal.decision}`} />}
              </dl>
              {sc.can.decideAppeal && (
                <div className="mt-5 space-y-5 border-t border-white/10 pt-4">
                  <Calibrate sc={sc} onDone={reload} appeal />
                  <CommentAction label="HR's decision (final; sent to the employee)" button="Decide the appeal" required onSubmit={(d) => say("Appeal decided.")(post(`/performance/scorecards/${sc.id}/appeal/decide`, { decision: d }))} />
                </div>
              )}
            </Card>
          )}

          {(sc.can.acknowledge || sc.can.appeal) && (
            <Card title="Your result">
              <div className="grid gap-6 md:grid-cols-2">
                <CommentAction label="Comment for the record (optional)" button="Acknowledge result" onSubmit={(c) => say("Result acknowledged.")(post(`/performance/scorecards/${sc.id}/acknowledge`, { comment: c }))} />
                {sc.can.appeal && (
                  <CommentAction label="Appeal to HR (once; HR's decision is final)" button="Appeal" variant="secondary" required onSubmit={(r) => say("Your appeal has been sent to HR.")(post(`/performance/scorecards/${sc.id}/appeal`, { reason: r }))} />
                )}
              </div>
            </Card>
          )}
          {sc.employeeAckAt && <Alert kind="success">Acknowledged by {sc.employee.fullName} on {fmtDateTime(sc.employeeAckAt)}{sc.employeeAckComment ? `: “${sc.employeeAckComment}”` : "."}</Alert>}

          {sc.adjustments.length > 0 && (
            <Card title="Rating history">
              <ul className="space-y-2 text-sm">
                {sc.adjustments.map((a, i) => (
                  <li key={i}>
                    <span className="font-medium text-white">{a.kpi}</span>: {a.from} → {a.to} <span className="text-slate-500">({a.kind === "APPEAL" ? "appeal" : "calibration"} by {a.by}, {fmtDateTime(a.at)})</span>
                    <div className="text-slate-600">“{a.reason}”</div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card title="Timeline">
            <dl className="grid gap-3">
              <Info label="Goals due" value={fmtDate(sc.cycle.goalsDueDate)} />
              <Info label="Check-in" value={sc.cycle.checkInDate ? fmtDate(sc.cycle.checkInDate) : null} />
              <Info label="Review" value={`${fmtDate(sc.cycle.reviewOpensDate)} to ${fmtDate(sc.cycle.reviewDueDate)}`} />
              <Info label="Line manager" value={sc.employee.manager ?? "HR"} />
              {sc.goalsRequestId && <Info label="Goal approval" value={<Link className="text-accent hover:underline" href={`/requests/${sc.goalsRequestId}`}>Request #{sc.goalsRequestId}</Link>} />}
              {sc.reviewRequestId && <Info label="Result sign-off" value={<Link className="text-accent hover:underline" href={`/requests/${sc.reviewRequestId}`}>Request #{sc.reviewRequestId}</Link>} />}
            </dl>
          </Card>

          <Card title="Check-ins">
            {sc.checkIns.length === 0 ? <p className="text-sm text-slate-500">No check-in notes yet. They are comments only and do not change the score.</p> : (
              <ul className="space-y-3">
                {sc.checkIns.map((c) => (
                  <li key={c.id} className="text-sm">
                    <div className="text-slate-700">{c.comment}</div>
                    <div className="text-xs text-slate-500">{c.author} · {fmtDateTime(c.at)}</div>
                  </li>
                ))}
              </ul>
            )}
            {sc.can.checkIn && (
              <div className="mt-4 border-t border-white/10 pt-4">
                <CommentAction label="Add a check-in note" button="Add note" required onSubmit={(c) => post(`/performance/scorecards/${sc.id}/check-ins`, { comment: c }).then(reload)} />
              </div>
            )}
          </Card>

          <Card title="Attendance (for reference)">
            <p className="mb-3 text-xs text-slate-500">{fmtDate(sc.attendance.from)} to {fmtDate(sc.attendance.to)}. Shown for context only; it is not part of the score.</p>
            <dl className="grid grid-cols-2 gap-3">
              <Info label="On time" value={String(sc.attendance.onTime)} />
              <Info label="Late" value={String(sc.attendance.late)} />
              <Info label="Half day" value={String(sc.attendance.halfDay)} />
              <Info label="Absent" value={String(sc.attendance.absent)} />
              <Info label="Leave days" value={String(sc.attendance.leaveDays)} />
            </dl>
          </Card>

          {sc.can.remove && (
            <Button variant="danger" loading={top.busy === "remove"} onClick={() => confirm("Remove this scorecard from the cycle?") && top.run("remove", async () => {
              await del(`/performance/scorecards/${sc.id}`);
              router.push(`/performance/cycles/${sc.cycle.id}`);
            })}>Remove from cycle</Button>
          )}
        </div>
      </div>
    </div>
  );
}
