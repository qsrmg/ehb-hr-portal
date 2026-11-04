"use client";

import { useState } from "react";
import { Alert, Button, Card, Field, Info, Input, LinkButton, Select, StatusBadge, Table, Td, Textarea } from "@/components/ui";
import { del, download, post } from "@/lib/api";
import { fmtDate, fmtDateTime, fmtMoney, todayYmd } from "@/lib/format";

export type TravelDetail = {
  purpose: string; origin: string; destination: string; country: string; departDate: string; returnDate: string; days: number;
  mode: string; modeLabel: string; needsHotel: boolean;
  estimates: { transport: number; hotel: number; meals: number; other: number; total: number };
  advance: {
    requested: number;
    paid: { paidOn: string | null; method: string | null; reference: string | null; paidBy: string | null } | null;
    due: number;
    returned: { amount: number; method: string | null; returnedOn: string | null; reference: string | null; by: string | null } | null;
  };
  bookingStatus: "NOT_NEEDED" | "PENDING" | "BOOKED";
  booked: { at: string; by: string | null } | null;
  bookings: { id: number; kind: string; arrangedBy: "ADMIN" | "EMPLOYEE"; details: string; provider: string | null; reference: string | null; cost: number | null; voucher: { id: number; fileName: string } | null }[];
  cancellation: { at: string; by: string | null; reason: string | null; fee: number | null; feeNote: string | null; financeNote: string | null } | null;
  settlement: { requestId: number; status: string } | null;
  settlementWindow: { opens: string; closes: string };
};

export type TravelFlags = {
  canCancelTrip: boolean; canBook: boolean; canPayAdvance: boolean; canRecordAdvanceReturn: boolean;
  canRecordCancellationFee: boolean; canAddFinanceNote: boolean; canSettle: boolean;
};

const METHODS: Record<string, string> = { BANK_TRANSFER: "bank transfer", CASH: "cash", WITH_SALARY: "with salary", CASH_OR_BANK: "cash/bank", SALARY_DEDUCTION: "salary deduction" };
const KINDS: Record<string, string> = { AIR: "Air", TRAIN: "Train", BUS: "Bus", HOTEL: "Hotel" };

/** Small form card with its own busy/error state. */
function ActionCard({ title, children, submitLabel, onSubmit, danger }: { title: string; children: React.ReactNode; submitLabel: string; onSubmit: () => Promise<unknown>; danger?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card title={title}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await onSubmit();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {error && <Alert>{error}</Alert>}
        {children}
        <Button type="submit" variant={danger ? "danger" : "primary"} loading={busy}>{submitLabel}</Button>
      </form>
    </Card>
  );
}

function AddBooking({ requestId, onChanged }: { requestId: number; onChanged: () => void }) {
  const [form, setForm] = useState({ kind: "AIR", arrangedBy: "ADMIN", details: "", provider: "", reference: "", cost: "" });
  const [voucher, setVoucher] = useState<File | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  const byAdmin = form.arrangedBy === "ADMIN";
  return (
    <ActionCard
      title="Add a booking (Admin)"
      submitLabel="Add booking"
      onSubmit={async () => {
        const fd = new FormData();
        Object.entries(form).forEach(([k, v]) => fd.append(k, v));
        if (voucher) fd.append("voucher", voucher);
        await post(`/travel/${requestId}/bookings`, fd);
        setForm({ ...form, details: "", provider: "", reference: "", cost: "" });
        setVoucher(null);
        onChanged();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Item">
          <Select value={form.kind} onChange={set("kind")}>
            {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="Arranged by">
          <Select value={form.arrangedBy} onChange={set("arrangedBy")}>
            <option value="ADMIN">Admin books it</option>
            <option value="EMPLOYEE">Employee to arrange (claims it later)</option>
          </Select>
        </Field>
        <Field label={byAdmin ? "Details" : "Note (optional)"}><Input required={byAdmin} value={form.details} onChange={set("details")} placeholder={form.kind === "HOTEL" ? "Hotel, check-in / check-out" : "Flight / train, date and time"} /></Field>
        {byAdmin && (
          <>
            <Field label="Provider"><Input value={form.provider} onChange={set("provider")} placeholder="e.g. PIA, Pearl Continental" /></Field>
            <Field label="Booking reference"><Input value={form.reference} onChange={set("reference")} /></Field>
            <Field label="Cost (PKR)"><Input type="number" min="0" step="0.01" value={form.cost} onChange={set("cost")} /></Field>
            <Field label="Ticket / voucher" className="sm:col-span-3"><Input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setVoucher(e.target.files?.[0] ?? null)} /></Field>
          </>
        )}
      </div>
    </ActionCard>
  );
}

export function TravelDetails({ requestId, travel, flags, onChanged }: { requestId: number; travel: TravelDetail; flags: TravelFlags; onChanged: () => void }) {
  const [cancelReason, setCancelReason] = useState("");
  const [advance, setAdvance] = useState({ paidOn: todayYmd(), method: "BANK_TRANSFER", reference: "" });
  const [ret, setRet] = useState({ method: "SALARY_DEDUCTION", returnedOn: todayYmd(), reference: "" });
  const [fee, setFee] = useState({ fee: "", note: "" });
  const [note, setNote] = useState("");
  const t = travel;

  return (
    <div className="space-y-6">
      <Card title="Trip">
        <dl className="grid gap-4 sm:grid-cols-3">
          <Info label="Route" value={`${t.origin} → ${t.destination}`} />
          <Info label="Dates" value={`${fmtDate(t.departDate)} to ${fmtDate(t.returnDate)} (${t.days} day${t.days === 1 ? "" : "s"})`} />
          <Info label="Travel by" value={`${t.modeLabel}${t.needsHotel ? " · hotel needed" : ""}`} />
          <div className="sm:col-span-3"><Info label="Purpose" value={t.purpose} /></div>
          <Info label="Estimated cost" value={`PKR ${fmtMoney(t.estimates.total)}`} />
          <Info label="Breakdown" value={`Transport ${fmtMoney(t.estimates.transport)} · Hotel ${fmtMoney(t.estimates.hotel)} · Meals ${fmtMoney(t.estimates.meals)} · Other ${fmtMoney(t.estimates.other)}`} />
          <Info label="Booking" value={<StatusBadge status={t.bookingStatus} />} />
        </dl>
      </Card>

      {t.cancellation && (
        <Alert kind="warning">
          Cancelled by {t.cancellation.by} on {fmtDateTime(t.cancellation.at)}: {t.cancellation.reason}
          {t.cancellation.fee != null && <> · Cancellation fee PKR {fmtMoney(t.cancellation.fee)} (paid by the company){t.cancellation.feeNote ? `: ${t.cancellation.feeNote}` : ""}</>}
          {t.cancellation.financeNote && <> · Finance note: {t.cancellation.financeNote}</>}
        </Alert>
      )}

      {t.advance.requested > 0 && (
        <Card title="Travel advance">
          <dl className="grid gap-4 sm:grid-cols-3">
            <Info label="Requested" value={`PKR ${fmtMoney(t.advance.requested)}`} />
            <Info label="Paid" value={t.advance.paid ? `${fmtDate(t.advance.paid.paidOn)} by ${METHODS[t.advance.paid.method ?? ""] ?? "-"}, ref ${t.advance.paid.reference} (${t.advance.paid.paidBy})` : "Not yet"} />
            <Info
              label="To return"
              value={t.advance.returned ? `Returned PKR ${fmtMoney(t.advance.returned.amount)} by ${METHODS[t.advance.returned.method ?? ""]} on ${fmtDate(t.advance.returned.returnedOn)} (${t.advance.returned.by})` : t.advance.due > 0 ? `PKR ${fmtMoney(t.advance.due)} due` : "—"}
            />
          </dl>
        </Card>
      )}

      <Card title="Bookings" actions={t.booked ? <span className="text-xs text-slate-500">Booked by {t.booked.by} on {fmtDateTime(t.booked.at)}</span> : undefined}>
        <Table head={["Item", "Arranged by", "Details", "Reference", "Cost", "Ticket", ...(flags.canBook ? [""] : [])]} empty={t.bookingStatus === "NOT_NEEDED" ? "No booking needed for this trip." : "Nothing booked yet."}>
          {t.bookings.map((b) => (
            <tr key={b.id}>
              <Td>{KINDS[b.kind]}</Td>
              <Td>{b.arrangedBy === "ADMIN" ? "Admin" : <span className="text-amber-800">Employee to arrange</span>}</Td>
              <Td className="whitespace-normal">{b.details}{b.provider && <div className="text-xs text-slate-500">{b.provider}</div>}</Td>
              <Td>{b.reference ?? "—"}</Td>
              <Td className="tabular-nums">{b.cost != null ? fmtMoney(b.cost) : "—"}</Td>
              <Td>{b.voucher ? <button className="text-sm text-accent hover:underline" onClick={() => download(`/requests/${requestId}/attachments/${b.voucher!.id}`, b.voucher!.fileName)}>Download</button> : "—"}</Td>
              {flags.canBook && <Td><Button size="sm" variant="ghost" className="text-red-600" onClick={async () => { await del(`/travel/${requestId}/bookings/${b.id}`); onChanged(); }}>Remove</Button></Td>}
            </tr>
          ))}
        </Table>
        {flags.canBook && t.bookings.length > 0 && t.bookingStatus !== "BOOKED" && (
          <div className="mt-3"><Button onClick={async () => { await post(`/travel/${requestId}/booked`); onChanged(); }}>Mark as booked and notify the traveller</Button></div>
        )}
      </Card>

      {flags.canBook && <AddBooking requestId={requestId} onChanged={onChanged} />}

      {t.settlement && (
        <Alert kind="info">Settlement <a className="font-medium underline" href={`/requests/${t.settlement.requestId}`}>#{t.settlement.requestId}</a> · <StatusBadge status={t.settlement.status} /></Alert>
      )}
      {flags.canSettle && (
        <Card title="After the trip">
          <p className="mb-3 text-sm text-slate-600">Claim what the trip cost (hotel you booked yourself, local transport, daily allowance, mileage) by {fmtDate(t.settlementWindow.closes)}. Any advance is deducted.</p>
          <LinkButton href={`/requests/new/settlement?travel=${requestId}`}>Submit trip settlement</LinkButton>
        </Card>
      )}

      {flags.canPayAdvance && (
        <ActionCard title="Pay the advance (Finance)" submitLabel="Mark advance as paid" onSubmit={async () => { await post(`/travel/${requestId}/advance-paid`, advance); onChanged(); }}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Paid on"><Input type="date" required max={todayYmd()} value={advance.paidOn} onChange={(e) => setAdvance({ ...advance, paidOn: e.target.value })} /></Field>
            <Field label="Method">
              <Select value={advance.method} onChange={(e) => setAdvance({ ...advance, method: e.target.value })}>
                <option value="BANK_TRANSFER">Bank transfer</option>
                <option value="CASH">Cash</option>
              </Select>
            </Field>
            <Field label="Reference"><Input required value={advance.reference} onChange={(e) => setAdvance({ ...advance, reference: e.target.value })} /></Field>
          </div>
        </ActionCard>
      )}

      {flags.canRecordAdvanceReturn && (
        <ActionCard title={`Record the returned advance: PKR ${fmtMoney(t.advance.due)} (Finance)`} submitLabel="Record return" onSubmit={async () => { await post(`/travel/${requestId}/advance-return`, { ...ret, amount: t.advance.due }); onChanged(); }}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="How">
              <Select value={ret.method} onChange={(e) => setRet({ ...ret, method: e.target.value })}>
                <option value="SALARY_DEDUCTION">Salary deduction</option>
                <option value="CASH_OR_BANK">Cash / bank</option>
              </Select>
            </Field>
            <Field label="Date"><Input type="date" required max={todayYmd()} value={ret.returnedOn} onChange={(e) => setRet({ ...ret, returnedOn: e.target.value })} /></Field>
            <Field label="Reference (optional)"><Input value={ret.reference} onChange={(e) => setRet({ ...ret, reference: e.target.value })} /></Field>
          </div>
        </ActionCard>
      )}

      {flags.canRecordCancellationFee && (
        <ActionCard title="Cancellation fee (Admin)" submitLabel={t.cancellation?.fee != null ? "Update fee" : "Record fee"} onSubmit={async () => { await post(`/travel/${requestId}/cancellation-fee`, { fee: Number(fee.fee || 0), note: fee.note }); onChanged(); }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Fee (PKR, 0 if none)" hint="The company bears it"><Input type="number" min="0" step="0.01" required value={fee.fee} onChange={(e) => setFee({ ...fee, fee: e.target.value })} /></Field>
            <Field label="Note"><Input value={fee.note} onChange={(e) => setFee({ ...fee, note: e.target.value })} placeholder="e.g. airline change fee" /></Field>
          </div>
        </ActionCard>
      )}

      {flags.canAddFinanceNote && (
        <ActionCard title="Finance note" submitLabel="Save note" onSubmit={async () => { await post(`/travel/${requestId}/finance-note`, { note }); setNote(""); onChanged(); }}>
          <Textarea required rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t.cancellation?.financeNote ?? "e.g. fee charged to the travel cost centre"} />
        </ActionCard>
      )}

      {flags.canCancelTrip && (
        <ActionCard title="Cancel this trip" submitLabel="Cancel trip" danger onSubmit={async () => { await post(`/travel/${requestId}/cancel`, { reason: cancelReason }); onChanged(); }}>
          <Field label="Reason" hint="Admin is told to cancel bookings; any advance paid must be returned."><Input required minLength={3} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} /></Field>
        </ActionCard>
      )}
    </div>
  );
}
