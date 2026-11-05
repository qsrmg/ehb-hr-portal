"use client";

import { useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Alert, Button, Card, Field, Info, Input, LinkButton, PageHeader, Select, Spinner, StatusBadge, Textarea } from "@/components/ui";
import { AttendanceUpdateForm, LeaveForm, LetterForm, LETTER_TYPES, ResignationForm } from "@/components/RequestForms";
import { ExpenseForm } from "@/components/ExpenseForm";
import { ExpenseDetails, type ExpenseDetail } from "@/components/ExpenseDetails";
import { TravelForm } from "@/components/TravelForm";
import { SettlementForm } from "@/components/SettlementForm";
import { TravelDetails, type TravelDetail, type TravelFlags } from "@/components/TravelDetails";
import { AssetRequestForm } from "@/components/AssetRequestForm";
import { AssetRequestPanel, type AssetRequestDetail } from "@/components/AssetPanels";
import { download, post } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";

type Detail = {
  id: number; type: string; typeLabel: string; title: string; status: string; createdAt: string;
  data: Record<string, string>;
  employee: { id: number; fullName: string; code: string; designation: string | null; department: string | null; manager: string | null };
  steps: { order: number; label: string; status: string; approver: string | null; actedBy: string | null; actedAt: string | null; comment: string | null; pendingSince: string | null }[];
  history: { action: string; actor: string; comment: string | null; at: string }[];
  attachments: { id: number; fileName: string; size: number }[];
  attachmentsHidden: boolean;
  leave: { leaveTypeId: number; leaveType: string; startDate: string; endDate: string; days: number; reason: string } | null;
  attendanceUpdate: { date: string; kind: string; checkIn: string | null; checkOut: string | null; reason: string } | null;
  currentStepLabel: string | null;
  canAct: boolean; canResubmit: boolean; canCancel: boolean; letterAvailable: boolean;
  expense: ExpenseDetail | null;
  canAdjustLines: boolean;
  canMarkPaid: boolean;
  settlement: { travelRequestId: number; route: string; departDate: string; returnDate: string; advancePaid: number; toPay: number | null } | null;
  travel: TravelDetail | null;
  assetRequest: AssetRequestDetail | null;
  canFulfil: boolean;
  resignation: Resignation | null;
  canReject?: boolean;
  performance: { scorecardId: number | null } | null;
  requisition: RequisitionInfo | null;
} & Partial<TravelFlags>;

type RequisitionInfo = {
  id: number; title: string; department: string; headcount: number; grade: string | null; employmentType: string; reportsTo: string | null;
  targetStartDate: string; justification: string; skills: string | null; reason: string; overHeadcount: boolean; gradeChanged: boolean;
  replaces: { fullName: string; grade: string | null } | null;
  suggestedSalary: { min: number | null; max: number | null } | null;
  budget: { min: number | null; max: number | null; note: string | null } | null;
  confirmBudget: boolean;
};

type Resignation = {
  reason: string; resignationDate: string; proposedLastDay: string; onProbation: boolean; noticeDays: number; noticeEndDate: string;
  earlyRelease: boolean; earlyReleaseRecommended: boolean | null; mayReleaseEarly: boolean; exitCaseId: number | null;
  decision: "LINE_MANAGER" | "FINAL" | null; defaultLastWorkingDay: string; handoverWarning: string | null;
};

const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

const KIND_LABELS: Record<string, string> = { MISSED_PUNCH: "Missed punch", FIELD_VISIT: "Field visit", OTHER: "Other" };
const ACTION_LABELS: Record<string, string> = {
  SUBMITTED: "Submitted", RESUBMITTED: "Resubmitted", APPROVED: "Approved", REJECTED: "Rejected", RETURNED: "Returned for changes", CANCELLED: "Cancelled",
  LINE_REDUCE: "Line reduced", LINE_REJECT: "Line rejected", LINE_RESET: "Line change undone", PAID: "Paid",
  ADVANCE_PAID: "Advance paid", ADVANCE_RETURNED: "Advance returned", CANCELLATION_FEE: "Cancellation fee recorded", FINANCE_NOTE: "Finance note",
};

export default function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const { data: r, loading, error, reload } = useApi<Detail>(`/requests/${id}`);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(search.get("submitted") ? "Request submitted. It has been sent to the first approver." : null);
  const [earlyRelease, setEarlyRelease] = useState<"" | "yes" | "no">("");
  const [lastWorkingDay, setLastWorkingDay] = useState("");
  const [waiveShortfall, setWaiveShortfall] = useState(false);
  const [budget, setBudget] = useState({ salaryMin: "", salaryMax: "", budgetNote: "" });

  if (loading && !r) return <Spinner />;
  if (error || !r) return <Alert>{error}</Alert>;

  const act = async (action: "approve" | "reject" | "return" | "cancel") => {
    if (action === "cancel" && !confirm(r.type === "RESIGNATION" ? "Withdraw your resignation?" : "Cancel this request?")) return;
    setBusy(action);
    setActionError(null);
    try {
      const decision = action === "approve" && r.resignation?.decision
        ? r.resignation.decision === "LINE_MANAGER"
          ? { earlyRelease: earlyRelease === "" ? undefined : earlyRelease === "yes" }
          : { lastWorkingDay: lastWorkingDay || r.resignation.defaultLastWorkingDay, waiveShortfall }
        : action === "approve" && r.requisition?.confirmBudget
          ? { salaryMin: budget.salaryMin ? Number(budget.salaryMin) : undefined, salaryMax: budget.salaryMax ? Number(budget.salaryMax) : undefined, budgetNote: budget.budgetNote }
          : {};
      await post(`/requests/${r.id}/${action}`, { comment, ...decision });
      setComment("");
      setNotice({ approve: "Approved.", reject: "Rejected.", return: "Returned to the employee for changes.", cancel: "Request cancelled." }[action]);
      await reload();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const resubmitted = async () => {
    setEditing(false);
    setNotice("Request resubmitted. The approval chain has restarted.");
    await reload();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={r.title}
        subtitle={<>#{r.id} · {r.typeLabel} · submitted {fmtDateTime(r.createdAt)}</>}
        actions={
          <>
            {r.letterAvailable && <Button onClick={() => download(`/requests/${r.id}/letter`, `letter-${r.id}.pdf`)}>Download letter (PDF)</Button>}
            {r.canResubmit && !editing && <Button onClick={() => setEditing(true)}>Edit and resubmit</Button>}
            {r.resignation?.exitCaseId && <LinkButton href={`/exits/${r.resignation.exitCaseId}`}>Open exit clearance</LinkButton>}
            {r.performance?.scorecardId && <LinkButton href={`/performance/${r.performance.scorecardId}`}>Open scorecard</LinkButton>}
            {r.requisition && <LinkButton href={`/hiring/requisitions/${r.requisition.id}`}>Open requisition</LinkButton>}
            {r.canCancel && <Button variant="secondary" loading={busy === "cancel"} onClick={() => act("cancel")}>{r.type === "RESIGNATION" ? "Withdraw resignation" : "Cancel request"}</Button>}
          </>
        }
      />
      {notice && <Alert kind="success">{notice}</Alert>}

      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={r.status} />
        {r.currentStepLabel && <span className="text-sm text-slate-600">Waiting for: <strong>{r.currentStepLabel}</strong></span>}
        {r.status === "RETURNED" && <span className="text-sm text-orange-700">Returned to the employee for changes</span>}
      </div>

      {editing && (
        <Card title="Edit and resubmit">
          {r.leave && <LeaveForm requestId={r.id} initial={r.leave} onDone={resubmitted} />}
          {r.attendanceUpdate && <AttendanceUpdateForm requestId={r.id} initial={r.attendanceUpdate} onDone={resubmitted} />}
          {r.type === "LETTER" && <LetterForm requestId={r.id} initial={{ letterType: r.data.letterType ?? "", addressedTo: r.data.addressedTo ?? "", purpose: r.data.purpose ?? "" }} onDone={resubmitted} />}
          {r.type === "EXPENSE" && r.expense && <ExpenseForm requestId={r.id} initial={r.expense} onDone={resubmitted} />}
          {r.type === "TRAVEL" && r.travel && <TravelForm requestId={r.id} initial={r.travel} onDone={resubmitted} />}
          {r.resignation && <ResignationForm requestId={r.id} initial={r.resignation} onDone={resubmitted} />}
          {r.type === "ASSET_REQUEST" && r.assetRequest && <AssetRequestForm requestId={r.id} initial={r.assetRequest} onDone={resubmitted} />}
          {r.type === "TRAVEL_SETTLEMENT" && r.settlement && r.expense && (
            <SettlementForm
              requestId={r.id}
              travelRequestId={r.settlement.travelRequestId}
              initial={{ travelRequestId: r.settlement.travelRequestId, lines: r.expense.lines.map((l) => ({ ...l, kind: l.kind ?? "STANDARD", quantity: l.quantity ?? null })) }}
              onDone={resubmitted}
            />
          )}
          <div className="mt-3"><Button variant="ghost" onClick={() => setEditing(false)}>Close</Button></div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Details">
            <dl className="grid gap-4 sm:grid-cols-2">
              <Info label="Employee" value={`${r.employee.fullName} (${r.employee.code})`} />
              <Info label="Department" value={r.employee.department} />
              <Info label="Designation" value={r.employee.designation} />
              <Info label="Line manager" value={r.employee.manager} />
              {r.leave && (
                <>
                  <Info label="Leave type" value={r.leave.leaveType} />
                  <Info label="Working days" value={r.leave.days} />
                  <Info label="From" value={fmtDate(r.leave.startDate)} />
                  <Info label="To" value={fmtDate(r.leave.endDate)} />
                  <div className="sm:col-span-2"><Info label="Reason" value={r.leave.reason} /></div>
                </>
              )}
              {r.attendanceUpdate && (
                <>
                  <Info label="Date" value={fmtDate(r.attendanceUpdate.date)} />
                  <Info label="Reason type" value={KIND_LABELS[r.attendanceUpdate.kind]} />
                  <Info label="Check in" value={r.attendanceUpdate.checkIn ?? "Keep machine time"} />
                  <Info label="Check out" value={r.attendanceUpdate.checkOut ?? "Keep machine time"} />
                  <div className="sm:col-span-2"><Info label="Explanation" value={r.attendanceUpdate.reason} /></div>
                </>
              )}
              {r.resignation && (
                <>
                  <Info label="Resignation given on" value={fmtDate(r.resignation.resignationDate)} />
                  <Info label="Proposed last working day" value={fmtDate(r.resignation.proposedLastDay)} />
                  <Info label="Notice period" value={`${r.resignation.noticeDays} days${r.resignation.onProbation ? " (probation)" : ""}, ends ${fmtDate(r.resignation.noticeEndDate)}`} />
                  <Info
                    label="Early release"
                    value={!r.resignation.earlyRelease ? "Not needed" : r.resignation.earlyReleaseRecommended == null ? "Asked; Line Manager to recommend" : r.resignation.earlyReleaseRecommended ? "Recommended by the Line Manager" : "Not recommended by the Line Manager"}
                  />
                  <div className="sm:col-span-2"><Info label="Reason" value={r.resignation.reason} /></div>
                </>
              )}
              {r.requisition && (
                <>
                  <Info label="Position" value={`${r.requisition.title}${r.requisition.headcount > 1 ? ` (${r.requisition.headcount} positions)` : ""}`} />
                  <Info label="For department" value={r.requisition.department} />
                  <Info label="Reason" value={r.requisition.reason === "NEW" ? "New position" : `Replacement for ${r.requisition.replaces?.fullName ?? "a leaver"}`} />
                  <Info label="Grade" value={`${r.requisition.grade ?? "—"}${r.requisition.gradeChanged ? " (different from the leaver's)" : ""}`} />
                  <Info label="Hiring manager" value={r.requisition.reportsTo} />
                  <Info label="Target start" value={fmtDate(r.requisition.targetStartDate)} />
                  <Info label="Headcount" value={r.requisition.overHeadcount ? "Over the approved headcount" : "Within the approved headcount"} />
                  {r.requisition.suggestedSalary && <Info label="Suggested salary" value={r.requisition.suggestedSalary.min != null || r.requisition.suggestedSalary.max != null ? `PKR ${fmtMoney(r.requisition.suggestedSalary.min)} to ${fmtMoney(r.requisition.suggestedSalary.max)}` : "None"} />}
                  {r.requisition.budget?.min != null && <Info label="Budget confirmed" value={`PKR ${fmtMoney(r.requisition.budget.min)} to ${fmtMoney(r.requisition.budget.max)}${r.requisition.budget.note ? ` · ${r.requisition.budget.note}` : ""}`} />}
                  <div className="sm:col-span-2"><Info label="Why it is needed" value={r.requisition.justification} /></div>
                </>
              )}
              {r.type === "LETTER" && (
                <>
                  <Info label="Letter type" value={LETTER_TYPES[r.data.letterType ?? ""]} />
                  <Info label="Addressed to" value={r.data.addressedTo} />
                  <div className="sm:col-span-2"><Info label="Purpose" value={r.data.purpose} /></div>
                </>
              )}
            </dl>
            {r.expense && r.type === "EXPENSE" && (
              <div className="mt-4 grid gap-4 border-t border-slate-100 pt-3 sm:grid-cols-2">
                <div className="sm:col-span-2"><Info label="Purpose" value={r.expense.purpose} /></div>
                <Info label="Total claimed" value={`PKR ${r.expense.totalClaimed.toLocaleString("en-PK")}`} />
                <Info label="Total approved" value={`PKR ${r.expense.totalApproved.toLocaleString("en-PK")}`} />
              </div>
            )}
            {!r.expense && !r.travel && (r.attachments.length > 0 || r.attachmentsHidden) && (
              <div className="mt-4 border-t border-slate-100 pt-3">
                <div className="mb-1 text-xs text-slate-500">Attachments</div>
                {r.attachmentsHidden ? (
                  <p className="text-sm text-slate-500">A medical document is attached. Medical documents are visible to HR only.</p>
                ) : (
                  <ul className="space-y-1">
                    {r.attachments.map((a) => (
                      <li key={a.id}>
                        <button className="text-sm text-accent hover:underline" onClick={() => download(`/requests/${r.id}/attachments/${a.id}`, a.fileName)}>
                          {a.fileName} <span className="text-xs text-slate-400">({Math.ceil(a.size / 1024)} KB)</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Card>

          {r.settlement && (
            <Alert kind="info">
              Settlement for trip <a className="font-medium underline" href={`/requests/${r.settlement.travelRequestId}`}>#{r.settlement.travelRequestId}</a>: {r.settlement.route}, {fmtDate(r.settlement.departDate)} to {fmtDate(r.settlement.returnDate)}.
              Advance paid PKR {r.settlement.advancePaid.toLocaleString("en-PK")}.
              {r.settlement.toPay != null && (r.settlement.toPay >= 0 ? ` Finance pays the employee PKR ${r.settlement.toPay.toLocaleString("en-PK")}.` : ` The employee returns PKR ${(-r.settlement.toPay).toLocaleString("en-PK")} of the advance.`)}
            </Alert>
          )}
          {r.expense && (
            <ExpenseDetails
              requestId={r.id}
              expense={r.expense}
              canAdjust={r.canAdjustLines}
              canMarkPaid={r.canMarkPaid}
              payAmount={r.settlement?.toPay ?? undefined}
              onChanged={reload}
            />
          )}
          {r.performance?.scorecardId && (
            <Alert kind="info">
              The goals and ratings are on the <a className="font-semibold underline" href={`/performance/${r.performance.scorecardId}`}>scorecard</a>. Approve to move it on, or return it to the Line Manager with a comment.
            </Alert>
          )}
          {r.assetRequest && <AssetRequestPanel requestId={r.id} detail={r.assetRequest} canFulfil={r.canFulfil} onChanged={reload} />}
          {r.travel && (
            <TravelDetails
              requestId={r.id}
              travel={r.travel}
              flags={{
                canCancelTrip: !!r.canCancelTrip, canBook: !!r.canBook, canPayAdvance: !!r.canPayAdvance, canRecordAdvanceReturn: !!r.canRecordAdvanceReturn,
                canRecordCancellationFee: !!r.canRecordCancellationFee, canAddFinanceNote: !!r.canAddFinanceNote, canSettle: !!r.canSettle,
              }}
              onChanged={reload}
            />
          )}

          {r.canAct && (
            <Card title={`Your decision (${r.currentStepLabel})`}>
              <div className="space-y-3">
                {actionError && <Alert>{actionError}</Alert>}
                {r.resignation?.handoverWarning && <Alert kind="warning">{r.resignation.handoverWarning}</Alert>}
                {r.resignation?.decision === "LINE_MANAGER" && (
                  <Field label="Early release" hint={`The proposed last day is before the notice period ends (${fmtDate(r.resignation.noticeEndDate)}). HR decides.`}>
                    <Select value={earlyRelease} onChange={(e) => setEarlyRelease(e.target.value as "" | "yes" | "no")}>
                      <option value="">Choose…</option>
                      <option value="yes">I recommend releasing them early</option>
                      <option value="no">I do not recommend it (full notice)</option>
                    </Select>
                  </Field>
                )}
                {r.resignation?.decision === "FINAL" && (() => {
                  const lwd = lastWorkingDay || r.resignation.defaultLastWorkingDay;
                  const shortfall = Math.max(0, daysBetween(lwd, r.resignation.noticeEndDate));
                  return (
                    <div className="space-y-3 rounded-md bg-slate-50 p-3 ring-1 ring-slate-200">
                      <Field
                        label="Last working day"
                        hint={r.resignation.mayReleaseEarly ? `Notice ends ${fmtDate(r.resignation.noticeEndDate)}.` : `The Line Manager did not recommend early release: not before ${fmtDate(r.resignation.noticeEndDate)}.`}
                      >
                        <Input type="date" value={lwd} min={r.resignation.mayReleaseEarly ? r.resignation.resignationDate : r.resignation.noticeEndDate} onChange={(e) => setLastWorkingDay(e.target.value)} />
                      </Field>
                      {shortfall > 0 && (
                        <label className="flex items-start gap-2 text-sm text-slate-700">
                          <input type="checkbox" className="mt-0.5" checked={waiveShortfall} onChange={(e) => setWaiveShortfall(e.target.checked)} />
                          <span>Waive the notice shortfall of {shortfall} day{shortfall === 1 ? "" : "s"} (otherwise Finance deducts it from the final settlement)</span>
                        </label>
                      )}
                      <p className="text-xs text-slate-500">Approving opens exit clearance: IT / Admin, Line Manager and HR clear in parallel, then Finance. The login is switched off automatically after the last working day.</p>
                    </div>
                  );
                })()}
                {r.requisition?.confirmBudget && (
                  <div className="space-y-3 rounded-md bg-slate-50 p-3 ring-1 ring-slate-200">
                    <p className="text-sm text-slate-700">Confirm the budget before approving: the salary range for this position.</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Salary from (PKR)"><Input type="number" min={0} value={budget.salaryMin} onChange={(e) => setBudget({ ...budget, salaryMin: e.target.value })} /></Field>
                      <Field label="Salary to (PKR)"><Input type="number" min={0} value={budget.salaryMax} onChange={(e) => setBudget({ ...budget, salaryMax: e.target.value })} /></Field>
                    </div>
                    <Field label="Budget note (optional)"><Input value={budget.budgetNote} onChange={(e) => setBudget({ ...budget, budgetNote: e.target.value })} /></Field>
                  </div>
                )}
                <Field label="Comment" hint="Required when rejecting or returning">
                  <Textarea value={comment} onChange={(e) => setComment(e.target.value)} />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button loading={busy === "approve"} onClick={() => act("approve")}>Approve</Button>
                  <Button variant="secondary" loading={busy === "return"} onClick={() => act("return")}>Return for changes</Button>
                  {r.canReject !== false && <Button variant="danger" loading={busy === "reject"} onClick={() => act("reject")}>Reject</Button>}
                </div>
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card title="Approval chain">
            <ol className="space-y-3">
              {r.steps.map((s) => (
                <li key={s.order} className="flex gap-3">
                  <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${s.status === "APPROVED" ? "bg-emerald-100 text-emerald-700" : s.status === "PENDING" ? "bg-amber-100 text-amber-800" : s.status === "REJECTED" ? "bg-red-100 text-red-700" : s.status === "RETURNED" ? "bg-orange-100 text-orange-700" : "bg-slate-100 text-slate-500"}`}>
                    {s.order + 1}
                  </span>
                  <div className="min-w-0 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-800">{s.label}</span>
                      <StatusBadge status={s.status} />
                    </div>
                    <div className="text-xs text-slate-500">{s.actedBy ? `${s.actedBy} · ${fmtDateTime(s.actedAt)}` : s.approver}</div>
                    {s.comment && <div className="mt-1 rounded bg-slate-50 px-2 py-1 text-xs text-slate-700">“{s.comment}”</div>}
                  </div>
                </li>
              ))}
            </ol>
          </Card>
          <Card title="History">
            <ol className="space-y-2 text-sm">
              {r.history.map((h, i) => (
                <li key={i}>
                  <div className="text-slate-800"><strong>{ACTION_LABELS[h.action] ?? h.action}</strong> by {h.actor}</div>
                  <div className="text-xs text-slate-500">{fmtDateTime(h.at)}</div>
                  {h.comment && <div className="text-xs text-slate-600">“{h.comment}”</div>}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}
