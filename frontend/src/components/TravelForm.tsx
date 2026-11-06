"use client";

import { useState } from "react";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { post, put } from "@/lib/api";
import { fmtMoney, todayYmd } from "@/lib/format";

export const TRAVEL_MODES: Record<string, string> = {
  AIR: "Air", TRAIN: "Train", BUS: "Bus", COMPANY_CAR: "Company car", OWN_CAR: "Own car", OTHER: "Other",
};

export type TravelInitial = {
  purpose: string; origin: string; destination: string; departDate: string; returnDate: string; mode: string; needsHotel: boolean;
  estimates: { transport: number; hotel: number; meals: number; other: number }; advance: { requested: number };
};

/** Pre-trip travel request (new or resubmitted). Domestic only for now. */
export function TravelForm({ onDone, requestId, initial }: { onDone: (id: number) => void; requestId?: number; initial?: TravelInitial }) {
  const [form, setForm] = useState({
    purpose: initial?.purpose ?? "",
    origin: initial?.origin ?? "Lahore",
    destination: initial?.destination ?? "",
    departDate: initial?.departDate ?? "",
    returnDate: initial?.returnDate ?? "",
    mode: initial?.mode ?? "AIR",
    needsHotel: initial?.needsHotel ?? false,
    estimateTransport: String(initial?.estimates.transport ?? ""),
    estimateHotel: String(initial?.estimates.hotel ?? ""),
    estimateMeals: String(initial?.estimates.meals ?? ""),
    estimateOther: String(initial?.estimates.other ?? ""),
    advanceRequested: String(initial?.advance.requested || ""),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });
  const total = ["estimateTransport", "estimateHotel", "estimateMeals", "estimateOther"].reduce((s, k) => s + (Number(form[k as keyof typeof form]) || 0), 0);
  const booked = ["AIR", "TRAIN", "BUS"].includes(form.mode) || form.needsHotel;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      for (const [k, v] of Object.entries(form)) fd.append(k, String(v === "" ? 0 : v));
      fd.set("purpose", form.purpose);
      fd.set("origin", form.origin);
      fd.set("destination", form.destination);
      fd.set("departDate", form.departDate);
      fd.set("returnDate", form.returnDate);
      const { id } = requestId ? await put<{ id: number }>(`/requests/${requestId}/resubmit`, fd) : await post<{ id: number }>("/requests/travel", fd);
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
      <Field label="Purpose of the trip"><Textarea required rows={2} value={form.purpose} onChange={set("purpose")} placeholder="e.g. Client workshop at Engro, Karachi" /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="From"><Input required value={form.origin} onChange={set("origin")} /></Field>
        <Field label="To (within Pakistan)"><Input required value={form.destination} onChange={set("destination")} placeholder="e.g. Karachi" /></Field>
        <Field label="Departure date"><Input type="date" required min={todayYmd()} value={form.departDate} onChange={(e) => setForm({ ...form, departDate: e.target.value, returnDate: form.returnDate || e.target.value })} /></Field>
        <Field label="Return date"><Input type="date" required min={form.departDate || todayYmd()} value={form.returnDate} onChange={set("returnDate")} /></Field>
        <Field label="Travel by">
          <Select value={form.mode} onChange={set("mode")}>
            {Object.entries(TRAVEL_MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700">
          <input type="checkbox" checked={form.needsHotel} onChange={(e) => setForm({ ...form, needsHotel: e.target.checked })} />
          I need a hotel
        </label>
      </div>
      {booked && <p className="-mt-2 text-xs text-slate-500">Admin books air, train and bus tickets and hotels once the trip is approved, or marks an item for you to arrange and claim later.</p>}

      <fieldset className="rounded-md p-3 ring-1 ring-slate-200">
        <legend className="px-1 text-sm font-semibold text-slate-700">Estimated cost (PKR)</legend>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Transport"><Input type="number" min="0" step="0.01" value={form.estimateTransport} onChange={set("estimateTransport")} /></Field>
          <Field label="Hotel"><Input type="number" min="0" step="0.01" value={form.estimateHotel} onChange={set("estimateHotel")} /></Field>
          <Field label="Meals"><Input type="number" min="0" step="0.01" value={form.estimateMeals} onChange={set("estimateMeals")} /></Field>
          <Field label="Other"><Input type="number" min="0" step="0.01" value={form.estimateOther} onChange={set("estimateOther")} /></Field>
        </div>
        <div className="mt-2 text-sm text-slate-600">Total estimate: <strong className="tabular-nums">PKR {fmtMoney(total)}</strong></div>
      </fieldset>

      <Field label="Travel advance (PKR, optional)" hint="Adds a Finance approval step. Unspent advance is returned after the trip.">
        <Input type="number" min="0" step="0.01" value={form.advanceRequested} onChange={set("advanceRequested")} placeholder="0" />
      </Field>
      <p className="text-xs text-slate-500">Goes to your Line Manager and Head of Department (and Finance for an advance). Business-trip costs are claimed in the settlement after you return, not in the Expense claim.</p>
      <Button type="submit" loading={busy}>{requestId ? "Resubmit travel request" : "Submit travel request"}</Button>
    </form>
  );
}
