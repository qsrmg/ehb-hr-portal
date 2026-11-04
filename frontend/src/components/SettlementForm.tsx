"use client";

import { useEffect, useState } from "react";
import { Alert, Button, Field, Input, Select, Spinner, Textarea } from "@/components/ui";
import { post, put } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { fmtDate, fmtMoney } from "@/lib/format";
import type { ExpenseCategory } from "@/components/ExpenseForm";

type Info = {
  requestId: number; origin: string; destination: string; departDate: string; returnDate: string; mode: string; advancePaid: number;
  bookings: { kind: string; arrangedBy: "ADMIN" | "EMPLOYEE"; details: string }[];
  window: { opens: string; closes: string };
  rules: { perDiemRate: number | null; mileageRatePerKm: number | null; hotelLimitPerNight: number | null; settlementDays: number };
  settlementRequestId: number | null;
};
type Check = { total: number; advancePaid: number; net: number; errors: string[]; warnings: string[]; lines: { amount: number }[]; approvers: string[] };
type Kind = "STANDARD" | "HOTEL" | "PER_DIEM" | "MILEAGE";

type LineState = {
  key: number; kind: Kind; date: string; categoryId: string; description: string; amount: string; quantity: string;
  file: File | null; keepReceipt: { id: number; fileName: string } | null; noReceiptExplanation: string;
};

export type SettlementInitial = {
  travelRequestId: number;
  lines: { kind: Kind; date: string; categoryId: number | null; description: string; amount: number; quantity: number | null; noReceiptExplanation: string | null; receipt: { id: number; fileName: string } | null }[];
};

let nextKey = 1;
const KIND_LABELS: Record<Kind, string> = { STANDARD: "Expense with receipt", HOTEL: "Hotel (self-booked)", PER_DIEM: "Daily allowance", MILEAGE: "Mileage (own car)" };

const toPayload = (l: LineState) => ({
  kind: l.kind,
  date: l.date,
  ...(l.kind === "STANDARD" ? { categoryId: Number(l.categoryId) } : {}),
  description: l.description,
  amount: Number(l.amount) || 0,
  ...(l.kind !== "STANDARD" ? { quantity: Number(l.quantity) || 0 } : {}),
  noReceiptExplanation: l.file || l.keepReceipt ? "" : l.noReceiptExplanation,
  ...(l.keepReceipt && !l.file ? { keepReceiptId: l.keepReceipt.id } : {}),
});

/** Post-trip settlement: what the trip cost, against any advance paid. */
export function SettlementForm({ travelRequestId, onDone, requestId, initial }: { travelRequestId: number; onDone: (id: number) => void; requestId?: number; initial?: SettlementInitial }) {
  const info = useApi<Info>(`/travel/${travelRequestId}/settlement-info`);
  const { data: categories } = useApi<ExpenseCategory[]>("/expenses/categories?scope=TRAVEL");
  const [lines, setLines] = useState<LineState[]>(() =>
    initial
      ? initial.lines.map((l) => ({
          key: nextKey++, kind: l.kind, date: l.date, categoryId: l.categoryId ? String(l.categoryId) : "", description: l.description,
          amount: String(l.amount), quantity: l.quantity == null ? "" : String(l.quantity), file: null, keepReceipt: l.receipt, noReceiptExplanation: l.noReceiptExplanation ?? "",
        }))
      : [],
  );
  const [check, setCheck] = useState<(Check & { key: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trip = info.data;
  const newLine = (kind: Kind = "STANDARD"): LineState => ({
    key: nextKey++, kind, date: trip?.departDate ?? "", categoryId: "", amount: "", file: null, keepReceipt: null, noReceiptExplanation: "",
    quantity: kind === "PER_DIEM" && trip ? String(Math.round((Date.parse(trip.returnDate) - Date.parse(trip.departDate)) / 86_400_000) + 1) : "",
    description: kind === "PER_DIEM" ? "Daily allowance" : "",
  });
  const update = (key: number, patch: Partial<LineState>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const checkKey = lines.length ? JSON.stringify(lines.map((l) => ({ ...toPayload(l), hasReceipt: !!(l.file || l.keepReceipt) }))) : null;
  const current = check && check.key === checkKey ? check : null;
  useEffect(() => {
    if (!checkKey) return;
    const t = setTimeout(() => {
      post<Check>("/travel/settlement-check", { travelRequestId, lines: JSON.parse(checkKey), excludeRequestId: requestId })
        .then((c) => setCheck({ ...c, key: checkKey }))
        .catch(() => setCheck(null));
    }, 400);
    return () => clearTimeout(t);
  }, [checkKey, travelRequestId, requestId]);

  if (info.loading) return <Spinner />;
  if (info.error || !trip) return <Alert>{info.error}</Alert>;
  if (trip.settlementRequestId && trip.settlementRequestId !== requestId) return <Alert kind="info">This trip already has a settlement (#{trip.settlementRequestId}).</Alert>;
  const r = trip.rules;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("travelRequestId", String(travelRequestId));
      fd.append("lines", JSON.stringify(lines.map(toPayload)));
      lines.forEach((l, i) => l.file && fd.append(`receipt_${i}`, l.file));
      const { id } = requestId ? await put<{ id: number }>(`/requests/${requestId}/resubmit`, fd) : await post<{ id: number }>("/requests/settlement", fd);
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
      <div className="rounded-md bg-slate-50 p-3 text-sm ring-1 ring-slate-200">
        <div className="font-medium text-slate-800">{trip.origin} → {trip.destination} · {fmtDate(trip.departDate)} to {fmtDate(trip.returnDate)}</div>
        <div className="mt-1 text-slate-600">
          Submit by <strong>{fmtDate(trip.window.closes)}</strong> ({r.settlementDays} days after return). Advance paid: PKR {fmtMoney(trip.advancePaid)}.
        </div>
        <div className="mt-1 text-xs text-slate-500">
          Daily allowance: {r.perDiemRate != null ? `PKR ${fmtMoney(r.perDiemRate)} per day (meals are covered)` : "not offered (claim meals with receipts)"} ·
          Mileage: {r.mileageRatePerKm != null ? `PKR ${fmtMoney(r.mileageRatePerKm)} per km` : "not offered"} ·
          Hotel limit: {r.hotelLimitPerNight != null ? `PKR ${fmtMoney(r.hotelLimitPerNight)} per night` : "none"}
        </div>
        {trip.bookings.length > 0 && (
          <div className="mt-2 text-xs text-slate-600">
            Booked: {trip.bookings.map((b) => `${b.kind.toLowerCase()} (${b.arrangedBy === "ADMIN" ? "by Admin, paid by the company" : "you arranged it, claim it here"})`).join("; ")}
          </div>
        )}
      </div>

      {lines.map((l, i) => (
        <fieldset key={l.key} className="rounded-md p-3 ring-1 ring-slate-200">
          <div className="mb-2 flex items-center justify-between">
            <legend className="text-sm font-semibold text-slate-700">{i + 1}. {KIND_LABELS[l.kind]}</legend>
            <Button type="button" size="sm" variant="ghost" className="text-red-600" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>Remove</Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Date"><Input type="date" required min={trip.departDate} max={trip.returnDate} value={l.date} onChange={(e) => update(l.key, { date: e.target.value })} /></Field>
            {l.kind === "STANDARD" && (
              <Field label="Category">
                <Select required value={l.categoryId} onChange={(e) => update(l.key, { categoryId: e.target.value })}>
                  <option value="">Choose…</option>
                  {categories?.map((c) => <option key={c.id} value={c.id} disabled={c.coveredByPerDiem && r.perDiemRate != null}>{c.name}{c.coveredByPerDiem && r.perDiemRate != null ? " (covered by daily allowance)" : ""}</option>)}
                </Select>
              </Field>
            )}
            {l.kind !== "STANDARD" && (
              <Field label={l.kind === "HOTEL" ? "Nights" : l.kind === "PER_DIEM" ? "Days" : "Distance (km)"}>
                <Input type="number" required min={l.kind === "MILEAGE" ? "0.1" : "1"} step={l.kind === "MILEAGE" ? "0.1" : "1"} value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} />
              </Field>
            )}
            <Field label="Description"><Input required value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} placeholder={l.kind === "MILEAGE" ? "Route" : "What and where"} /></Field>
            {l.kind === "STANDARD" || l.kind === "HOTEL" ? (
              <Field label="Amount (PKR)"><Input type="number" required min="0.01" step="0.01" value={l.amount} onChange={(e) => update(l.key, { amount: e.target.value })} /></Field>
            ) : (
              <Field label="Amount (PKR)" hint="Calculated from the rate">
                <Input disabled value={current?.lines[i] ? fmtMoney(current.lines[i]!.amount) : "—"} />
              </Field>
            )}
          </div>
          {(l.kind === "STANDARD" || l.kind === "HOTEL") && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Receipt" hint={l.keepReceipt && !l.file ? `Keeping ${l.keepReceipt.fileName}` : "PDF, JPG or PNG"}>
                <Input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => update(l.key, { file: e.target.files?.[0] ?? null })} />
              </Field>
              {!l.file && !l.keepReceipt && (
                <Field label="No receipt? Explain why" hint="Only for small amounts">
                  <Textarea rows={2} value={l.noReceiptExplanation} onChange={(e) => update(l.key, { noReceiptExplanation: e.target.value })} />
                </Field>
              )}
            </div>
          )}
        </fieldset>
      ))}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={() => setLines((ls) => [...ls, newLine("STANDARD")])}>+ Expense with receipt</Button>
        <Button type="button" variant="secondary" onClick={() => setLines((ls) => [...ls, newLine("HOTEL")])}>+ Hotel</Button>
        {r.perDiemRate != null && <Button type="button" variant="secondary" onClick={() => setLines((ls) => [...ls, newLine("PER_DIEM")])}>+ Daily allowance</Button>}
        {r.mileageRatePerKm != null && <Button type="button" variant="secondary" onClick={() => setLines((ls) => [...ls, newLine("MILEAGE")])}>+ Mileage</Button>}
      </div>

      {current && (
        <div className="space-y-1 rounded-md bg-slate-50 px-3 py-3 text-sm ring-1 ring-slate-200">
          <div className="flex justify-between"><span>Total claimed</span><span className="tabular-nums">PKR {fmtMoney(current.total)}</span></div>
          <div className="flex justify-between"><span>Advance already paid</span><span className="tabular-nums">− PKR {fmtMoney(current.advancePaid)}</span></div>
          <div className="flex justify-between font-semibold">
            <span>{current.net >= 0 ? "Finance pays you" : "You return to Finance"}</span>
            <span className="tabular-nums">PKR {fmtMoney(Math.abs(current.net))}</span>
          </div>
          {current.approvers.length > 0 && <div className="text-slate-600">Approval: {current.approvers.join(" → ")}</div>}
          {current.warnings.map((w) => <div key={w} className="text-amber-800">⚠ {w}</div>)}
          {current.errors.map((e) => <div key={e} className="text-red-700">{e}</div>)}
        </div>
      )}
      <Button type="submit" loading={busy} disabled={!lines.length || !!current?.errors.length}>{requestId ? "Resubmit settlement" : "Submit settlement"}</Button>
    </form>
  );
}
