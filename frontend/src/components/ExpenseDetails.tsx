"use client";

import { useState } from "react";
import { Alert, Button, Card, Field, Input, Select, StatusBadge, Table, Td } from "@/components/ui";
import { download, post } from "@/lib/api";
import { fmtDate, fmtDateTime, fmtMoney, todayYmd } from "@/lib/format";

export type ExpenseDetail = {
  purpose: string;
  totalClaimed: number;
  totalApproved: number;
  lines: {
    id: number; date: string; categoryId: number; category: string; accountingCode: string | null; allowanceWarning: boolean;
    kind?: "STANDARD" | "HOTEL" | "PER_DIEM" | "MILEAGE"; quantity?: number | null; rate?: number | null;
    description: string; amount: number; status: "CLAIMED" | "REDUCED" | "REJECTED"; approvedAmount: number; financeReason: string | null;
    noReceiptExplanation: string | null; allowanceJustification: string | null; receipt: { id: number; fileName: string; size: number } | null;
  }[];
  paid: { paidOn: string | null; method: "BANK_TRANSFER" | "WITH_SALARY" | null; reference: string | null; paidBy: string | null; paidAt: string } | null;
};

const METHOD_LABELS = { BANK_TRANSFER: "Bank transfer", WITH_SALARY: "With salary" } as const;
const LINE_STATUS = { CLAIMED: null, REDUCED: { label: "Reduced", status: "RETURNED" }, REJECTED: { label: "Rejected", status: "REJECTED" } } as const;

/** Finance: reduce or reject one line (reason required), or undo the change. */
function LineAdjust({ requestId, line, onChanged }: { requestId: number; line: ExpenseDetail["lines"][number]; onChanged: () => void }) {
  const [mode, setMode] = useState<"REDUCE" | "REJECT" | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await post(`/expenses/claims/${requestId}/lines/${line.id}/adjust`, body);
      setMode(null);
      setAmount("");
      setReason("");
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (line.status !== "CLAIMED" && !mode) {
    return <Button size="sm" variant="ghost" loading={busy} onClick={() => send({ action: "RESET" })}>Undo</Button>;
  }
  if (!mode) {
    return (
      <div className="flex gap-1">
        <Button size="sm" variant="secondary" onClick={() => setMode("REDUCE")}>Reduce</Button>
        <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setMode("REJECT")}>Reject</Button>
      </div>
    );
  }
  return (
    <form
      className="flex min-w-72 flex-col gap-2 whitespace-normal"
      onSubmit={(e) => {
        e.preventDefault();
        send(mode === "REDUCE" ? { action: "REDUCE", amount: Number(amount), reason } : { action: "REJECT", reason });
      }}
    >
      {error && <Alert>{error}</Alert>}
      {mode === "REDUCE" && (
        <Input type="number" min="0.01" step="0.01" max={line.amount} required placeholder={`New amount (less than ${fmtMoney(line.amount)})`} value={amount} onChange={(e) => setAmount(e.target.value)} />
      )}
      <Input required minLength={3} placeholder="Reason (shown to the employee)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex gap-1">
        <Button size="sm" type="submit" variant={mode === "REJECT" ? "danger" : "primary"} loading={busy}>{mode === "REDUCE" ? "Reduce" : "Reject line"}</Button>
        <Button size="sm" type="button" variant="ghost" onClick={() => setMode(null)}>Cancel</Button>
      </div>
    </form>
  );
}

function MarkPaid({ requestId, onChanged }: { requestId: number; onChanged: () => void }) {
  const [form, setForm] = useState({ paidOn: todayYmd(), method: "BANK_TRANSFER", reference: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post(`/expenses/claims/${requestId}/paid`, form);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Mark as paid (Finance)">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-4">
        {error && <div className="sm:col-span-4"><Alert>{error}</Alert></div>}
        <Field label="Payment date"><Input type="date" required max={todayYmd()} value={form.paidOn} onChange={(e) => setForm({ ...form, paidOn: e.target.value })} /></Field>
        <Field label="Method">
          <Select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
            <option value="BANK_TRANSFER">Bank transfer</option>
            <option value="WITH_SALARY">With salary</option>
          </Select>
        </Field>
        <Field label="Reference"><Input required value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="e.g. IBFT number or payroll month" /></Field>
        <div className="flex items-end"><Button type="submit" loading={busy}>Mark as paid</Button></div>
      </form>
    </Card>
  );
}

export function ExpenseDetails({ requestId, expense, canAdjust, canMarkPaid, payAmount, onChanged }: {
  requestId: number; expense: ExpenseDetail; canAdjust: boolean; canMarkPaid: boolean;
  /** Travel settlements pay the approved total minus the advance. */
  payAmount?: number;
  onChanged: () => void;
}) {
  const changed = expense.totalApproved !== expense.totalClaimed;
  return (
    <div className="space-y-6">
      <Card title={`Expenses (${expense.lines.length})`}>
        {canAdjust && <div className="mb-3"><Alert kind="info">As Finance you can reduce or reject single lines (with a reason the employee will see), then approve or reject the whole claim.</Alert></div>}
        <Table head={["Date", "Category", "Description", "Claimed", "Approved", "Receipt", ...(canAdjust ? [""] : [])]}>
          {expense.lines.map((l) => {
            const badge = LINE_STATUS[l.status];
            return (
              <tr key={l.id} className="align-top">
                <Td>{fmtDate(l.date)}</Td>
                <Td>
                  {l.category}
                  {l.accountingCode && <div className="text-xs text-slate-400">Code {l.accountingCode}</div>}
                </Td>
                <Td className="whitespace-normal">
                  <div className="min-w-40">{l.description}</div>
                  {l.kind && l.kind !== "STANDARD" && l.quantity != null && (
                    <div className="mt-1 text-xs text-slate-500">
                      {l.quantity} {l.kind === "HOTEL" ? "night(s)" : l.kind === "PER_DIEM" ? "day(s)" : "km"}
                      {l.rate != null && ` × PKR ${fmtMoney(l.rate)}`}
                    </div>
                  )}
                  {l.allowanceJustification && <div className="mt-1 text-xs text-amber-800">Salary allowance — justification: {l.allowanceJustification}</div>}
                  {l.noReceiptExplanation && <div className="mt-1 text-xs text-slate-500">No receipt: {l.noReceiptExplanation}</div>}
                  {l.financeReason && <div className="mt-1 text-xs text-red-700">Finance: {l.financeReason}</div>}
                </Td>
                <Td className={`tabular-nums ${l.status !== "CLAIMED" ? "text-slate-400 line-through" : ""}`}>{fmtMoney(l.amount)}</Td>
                <Td className="tabular-nums">
                  {fmtMoney(l.approvedAmount)}
                  {badge && <div className="mt-1"><StatusBadge status={badge.status} label={badge.label} /></div>}
                </Td>
                <Td>
                  {l.receipt ? (
                    <button className="text-sm text-accent hover:underline" onClick={() => download(`/requests/${requestId}/attachments/${l.receipt!.id}`, l.receipt!.fileName)}>
                      {l.receipt.fileName.length > 22 ? `${l.receipt.fileName.slice(0, 20)}…` : l.receipt.fileName}
                    </button>
                  ) : (
                    <span className="text-xs text-slate-400">None</span>
                  )}
                </Td>
                {canAdjust && <Td><LineAdjust requestId={requestId} line={l} onChanged={onChanged} /></Td>}
              </tr>
            );
          })}
          <tr className="font-semibold">
            <Td>Total</Td>
            <Td />
            <Td />
            <Td className="tabular-nums">{fmtMoney(expense.totalClaimed)}</Td>
            <Td className={`tabular-nums ${changed ? "text-orange-700" : ""}`}>{fmtMoney(expense.totalApproved)}</Td>
            <Td />
            {canAdjust && <Td />}
          </tr>
        </Table>
      </Card>

      {expense.paid && (
        <Alert kind="success">
          Paid PKR {fmtMoney(payAmount ?? expense.totalApproved)} by {expense.paid.method ? METHOD_LABELS[expense.paid.method].toLowerCase() : "-"} on {fmtDate(expense.paid.paidOn)}, reference {expense.paid.reference}.
          Recorded by {expense.paid.paidBy} on {fmtDateTime(expense.paid.paidAt)}.
        </Alert>
      )}
      {canMarkPaid && <MarkPaid requestId={requestId} onChanged={onChanged} />}
    </div>
  );
}
