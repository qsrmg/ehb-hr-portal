"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { post, put } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { fmtMoney, todayYmd } from "@/lib/format";

export type ExpenseCategory = {
  id: number; name: string; accountingCode: string | null; monthlyLimit: number | null; allowanceWarning: boolean; active: boolean; sortOrder: number;
  scope: "LOCAL" | "TRAVEL"; coveredByPerDiem: boolean;
};

type Rules = { maxPerClaim: number | null; maxPerMonth: number | null; managementApprovalAbove: number | null; receiptOptionalBelow: number; maxAgeDays: number };
type Check = { total: number; errors: string[]; warnings: string[]; approvers: string[]; rules: Rules | null };

type LineState = {
  key: number;
  date: string;
  categoryId: string;
  description: string;
  amount: string;
  file: File | null;
  keepReceipt: { id: number; fileName: string } | null;
  noReceiptExplanation: string;
  allowanceJustification: string;
};

export type ExpenseInitial = {
  purpose: string;
  lines: {
    date: string; categoryId: number; description: string; amount: number;
    noReceiptExplanation: string | null; allowanceJustification: string | null; receipt: { id: number; fileName: string } | null;
  }[];
};

let nextKey = 1;
const emptyLine = (): LineState => ({
  key: nextKey++, date: todayYmd(), categoryId: "", description: "", amount: "", file: null, keepReceipt: null, noReceiptExplanation: "", allowanceJustification: "",
});

const daysBefore = (ymd: string, days: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
};

/** The line as the API expects it. */
const toPayload = (l: LineState) => ({
  date: l.date,
  categoryId: Number(l.categoryId),
  description: l.description,
  amount: Number(l.amount),
  noReceiptExplanation: l.file || l.keepReceipt ? "" : l.noReceiptExplanation,
  allowanceJustification: l.allowanceJustification,
  ...(l.keepReceipt && !l.file ? { keepReceiptId: l.keepReceipt.id } : {}),
});

export function ExpenseForm({ onDone, requestId, initial }: { onDone: (id: number) => void; requestId?: number; initial?: ExpenseInitial }) {
  const { data: categories } = useApi<ExpenseCategory[]>("/expenses/categories");
  const [purpose, setPurpose] = useState(initial?.purpose ?? "");
  const [lines, setLines] = useState<LineState[]>(() =>
    initial
      ? initial.lines.map((l) => ({
          key: nextKey++, date: l.date, categoryId: String(l.categoryId), description: l.description, amount: String(l.amount), file: null,
          keepReceipt: l.receipt, noReceiptExplanation: l.noReceiptExplanation ?? "", allowanceJustification: l.allowanceJustification ?? "",
        }))
      : [emptyLine()],
  );
  const [check, setCheck] = useState<(Check & { key: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (key: number, patch: Partial<LineState>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const catById = useMemo(() => new Map((categories ?? []).map((c) => [String(c.id), c])), [categories]);

  // Live check: total, limits, receipts, warnings and who will approve
  const ready = lines.every((l) => l.date && l.categoryId && Number(l.amount) > 0 && l.description.trim().length >= 3);
  const checkKey = ready ? JSON.stringify(lines.map((l) => ({ ...toPayload(l), hasReceipt: !!(l.file || l.keepReceipt) }))) : null;
  const currentCheck = check && check.key === checkKey ? check : null;
  useEffect(() => {
    if (!checkKey) return;
    const t = setTimeout(() => {
      post<Check>("/expenses/check", { lines: JSON.parse(checkKey), excludeRequestId: requestId })
        .then((c) => setCheck({ ...c, key: checkKey }))
        .catch(() => setCheck(null));
    }, 400);
    return () => clearTimeout(t);
  }, [checkKey, requestId]);

  const rules = currentCheck?.rules ?? check?.rules ?? null;
  const total = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("purpose", purpose);
      fd.append("lines", JSON.stringify(lines.map(toPayload)));
      lines.forEach((l, i) => l.file && fd.append(`receipt_${i}`, l.file));
      const { id } = requestId ? await put<{ id: number }>(`/requests/${requestId}/resubmit`, fd) : await post<{ id: number }>("/requests/expense", fd);
      onDone(id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      {error && <Alert>{error}</Alert>}
      <Field label="Purpose" hint="Local expenses only. Business-trip costs go in the Travel request.">
        <Input required value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Client visits in Lahore, week of 2 November" />
      </Field>

      <div className="space-y-4">
        {lines.map((l, i) => {
          const cat = catById.get(l.categoryId);
          const hasReceipt = !!(l.file || l.keepReceipt);
          const amount = Number(l.amount) || 0;
          const receiptOptional = rules ? amount > 0 && amount < rules.receiptOptionalBelow : false;
          return (
            <fieldset key={l.key} className="rounded-md p-3 ring-1 ring-slate-200">
              <div className="mb-2 flex items-center justify-between">
                <legend className="text-sm font-semibold text-slate-700">Expense {i + 1}</legend>
                {lines.length > 1 && (
                  <Button type="button" size="sm" variant="ghost" className="text-red-600" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>Remove</Button>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-4">
                <Field label="Date">
                  <Input type="date" required value={l.date} max={todayYmd()} min={rules ? daysBefore(todayYmd(), rules.maxAgeDays) : undefined} onChange={(e) => update(l.key, { date: e.target.value })} />
                </Field>
                <Field label="Category">
                  <Select required value={l.categoryId} onChange={(e) => update(l.key, { categoryId: e.target.value })}>
                    <option value="">Choose…</option>
                    {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                </Field>
                <Field label="Description" className="sm:col-span-1">
                  <Input required value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} placeholder="What and why" />
                </Field>
                <Field label="Amount (PKR)">
                  <Input type="number" required min="0.01" step="0.01" value={l.amount} onChange={(e) => update(l.key, { amount: e.target.value })} />
                </Field>
              </div>

              {cat?.allowanceWarning && (
                <div className="mt-3 space-y-2">
                  <Alert kind="warning">You already receive a {cat.name} allowance in your salary. Explain why this cost is not covered by it.</Alert>
                  <Field label="Justification (required)">
                    <Textarea rows={2} required value={l.allowanceJustification} onChange={(e) => update(l.key, { allowanceJustification: e.target.value })} />
                  </Field>
                </div>
              )}

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field
                  label="Receipt"
                  hint={l.keepReceipt && !l.file ? `Keeping ${l.keepReceipt.fileName}. Choose a file to replace it.` : "PDF, JPG or PNG, up to 10 MB"}
                >
                  <Input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => update(l.key, { file: e.target.files?.[0] ?? null })} />
                </Field>
                {!hasReceipt && (
                  <Field
                    label="No receipt? Explain why"
                    hint={rules ? `Only for amounts below PKR ${fmtMoney(rules.receiptOptionalBelow)}` : undefined}
                  >
                    <Textarea rows={2} value={l.noReceiptExplanation} onChange={(e) => update(l.key, { noReceiptExplanation: e.target.value })} disabled={!!rules && !receiptOptional} placeholder={rules && !receiptOptional ? "A receipt is required for this amount" : "e.g. Rickshaw, no receipt given"} />
                  </Field>
                )}
              </div>
            </fieldset>
          );
        })}
        {lines.length < 30 && (
          <Button type="button" variant="secondary" onClick={() => setLines((ls) => [...ls, emptyLine()])}>Add another expense</Button>
        )}
      </div>

      <div className="rounded-md bg-slate-50 px-3 py-3 text-sm ring-1 ring-slate-200">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-medium text-slate-700">Total claimed</span>
          <span className="text-lg font-semibold tabular-nums text-slate-900">PKR {fmtMoney(total)}</span>
        </div>
        {currentCheck && (
          <div className="mt-2 space-y-1">
            {currentCheck.approvers.length > 0 && <div className="text-slate-600">Approval: {currentCheck.approvers.join(" → ")}</div>}
            {currentCheck.warnings.map((w) => <div key={w} className="text-amber-800">⚠ {w}</div>)}
            {currentCheck.errors.map((e) => <div key={e} className="text-red-700">{e}</div>)}
          </div>
        )}
        {!ready && <div className="mt-1 text-xs text-slate-500">Fill in every expense to see the approval route and checks.</div>}
      </div>

      <p className="text-xs text-slate-500">By submitting you confirm these expenses are genuine, were for company work, and have not been claimed before.</p>
      <Button type="submit" loading={busy} disabled={!!currentCheck?.errors.length}>{requestId ? "Resubmit claim" : "Submit expense claim"}</Button>
    </form>
  );
}
