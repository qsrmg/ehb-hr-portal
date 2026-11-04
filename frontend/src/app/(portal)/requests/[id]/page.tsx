"use client";

import { useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Alert, Button, Card, Field, Info, PageHeader, Spinner, StatusBadge, Textarea } from "@/components/ui";
import { AttendanceUpdateForm, LeaveForm, LetterForm, LETTER_TYPES } from "@/components/RequestForms";
import { ExpenseForm } from "@/components/ExpenseForm";
import { ExpenseDetails, type ExpenseDetail } from "@/components/ExpenseDetails";
import { TravelForm } from "@/components/TravelForm";
import { SettlementForm } from "@/components/SettlementForm";
import { TravelDetails, type TravelDetail, type TravelFlags } from "@/components/TravelDetails";
import { download, post } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { fmtDate, fmtDateTime } from "@/lib/format";

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
} & Partial<TravelFlags>;

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

  if (loading && !r) return <Spinner />;
  if (error || !r) return <Alert>{error}</Alert>;

  const act = async (action: "approve" | "reject" | "return" | "cancel") => {
    if (action === "cancel" && !confirm("Cancel this request?")) return;
    setBusy(action);
    setActionError(null);
    try {
      await post(`/requests/${r.id}/${action}`, { comment });
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
            {r.canCancel && <Button variant="secondary" loading={busy === "cancel"} onClick={() => act("cancel")}>Cancel request</Button>}
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
                <Field label="Comment" hint="Required when rejecting or returning">
                  <Textarea value={comment} onChange={(e) => setComment(e.target.value)} />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button loading={busy === "approve"} onClick={() => act("approve")}>Approve</Button>
                  <Button variant="secondary" loading={busy === "return"} onClick={() => act("return")}>Return for changes</Button>
                  <Button variant="danger" loading={busy === "reject"} onClick={() => act("reject")}>Reject</Button>
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
