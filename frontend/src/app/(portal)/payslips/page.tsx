"use client";

import { Fragment, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Alert, Button, Card, Field, Input, PageHeader, Select, Spinner, Table, Td, Textarea } from "@/components/ui";
import { download, patch } from "@/lib/api";
import { hasRole, useAuth } from "@/lib/auth";
import { useApi } from "@/lib/useApi";
import { fmtDate, fmtMoney } from "@/lib/format";

type Slip = {
  id: number; employeeId: number; year: number; month: number; monthName: string;
  basic: number; houseRent: number; medical: number; conveyance: number; fuel: number; mobile: number; gross: number;
  incomeTax: number; eobi: number; providentFund: number; totalDeductions: number; netPay: number;
  correctedAt: string | null; correctionReason: string | null;
};
type Tax = { fy: number; label: string; totals: { gross: number; incomeTax: number; netPay: number }; months: Slip[] };
type Pair = { from: number; to: number };
type Revision = {
  id: number; reason: string; correctedBy: string; at: string;
  basic: Pair; houseRent: Pair; medical: Pair; conveyance: Pair; fuel: Pair; mobile: Pair;
  incomeTax: Pair; eobi: Pair; providentFund: Pair;
};

type AmountField = "basic" | "houseRent" | "medical" | "conveyance" | "fuel" | "mobile" | "incomeTax" | "eobi" | "providentFund";
const EDIT_FIELDS: { key: AmountField; label: string }[] = [
  { key: "basic", label: "Basic" }, { key: "houseRent", label: "House Rent" }, { key: "medical", label: "Medical" },
  { key: "conveyance", label: "Conveyance" }, { key: "fuel", label: "Fuel" }, { key: "mobile", label: "Mobile" },
  { key: "incomeTax", label: "Income Tax" }, { key: "eobi", label: "EOBI" }, { key: "providentFund", label: "Provident Fund" },
];

function currentTaxYear() {
  const d = new Date();
  return d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1;
}

function EditPayslipForm({ slip, onCancel, onDone }: { slip: Slip; onCancel: () => void; onDone: () => Promise<void> }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(EDIT_FIELDS.map((f) => [f.key, String(slip[f.key])])));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await patch(`/payroll/payslips/${slip.id}`, { ...Object.fromEntries(EDIT_FIELDS.map((f) => [f.key, Number(values[f.key])])), reason });
      await onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {EDIT_FIELDS.map((f) => (
          <Field key={f.key} label={f.label}>
            <Input type="number" min={0} step="0.01" value={values[f.key]} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
          </Field>
        ))}
      </div>
      <Field label="Reason (required, kept in the history)" hint="Don't write amounts here; the employee can see this reason.">
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {error && <Alert>{error}</Alert>}
      <div className="flex gap-2">
        <Button size="sm" loading={busy} disabled={reason.trim().length < 5} onClick={save}>Save correction</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function RevisionHistory({ payslipId }: { payslipId: number }) {
  const { data, loading, error } = useApi<Revision[]>(`/payroll/payslips/${payslipId}/revisions`);
  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  if (!data?.length) return <p className="text-sm text-slate-500">No corrections yet.</p>;
  return (
    <ul className="space-y-3 text-sm">
      {data.map((r) => (
        <li key={r.id} className="rounded-lg border border-slate-200 p-3">
          <div className="text-xs text-slate-500">{fmtDate(r.at)} · {r.correctedBy}</div>
          <div className="mt-1 text-slate-700">{r.reason}</div>
          <dl className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-4">
            {EDIT_FIELDS.filter((f) => r[f.key].from !== r[f.key].to).map((f) => (
              <div key={f.key}>
                <dt className="text-slate-500">{f.label}</dt>
                <dd className="tabular-nums">{fmtMoney(r[f.key].from)} → {fmtMoney(r[f.key].to)}</dd>
              </div>
            ))}
          </dl>
        </li>
      ))}
    </ul>
  );
}

export default function PayslipsPage() {
  const { user } = useAuth();
  const employeeIdParam = useSearchParams().get("employeeId");
  const isHr = hasRole(user, "HR");
  const targetEmployeeId = employeeIdParam ? Number(employeeIdParam) : user?.id ?? null;
  const canEdit = isHr && targetEmployeeId != null && targetEmployeeId !== user?.id;

  const slips = useApi<Slip[]>(employeeIdParam ? `/payroll/payslips?employeeId=${employeeIdParam}` : "/payroll/payslips");
  const [fy, setFy] = useState(currentTaxYear());
  const tax = useApi<Tax>(employeeIdParam ? `/payroll/tax-statement?fy=${fy}&employeeId=${employeeIdParam}` : `/payroll/tax-statement?fy=${fy}`);
  const [open, setOpen] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [history, setHistory] = useState<number | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader title="Pay slips and tax statement" subtitle="Finance uploads payroll each month; pay slips are due by the 5th." />
      <Card title="Pay slips">
        {slips.loading ? <Spinner /> : slips.error ? <Alert>{slips.error}</Alert> : (
          <Table head={["Month", "Gross", "Deductions", "Net pay", ""]} empty="No pay slips yet.">
            {slips.data?.map((s) => (
              <Fragment key={s.id}>
                <tr>
                  <Td className="font-medium text-slate-900">
                    {s.monthName} {s.year}
                    {s.correctedAt && (
                      <div className="mt-0.5 text-xs font-normal text-amber-700">
                        Corrected by HR on {fmtDate(s.correctedAt)}{s.correctionReason ? `. Reason: ${s.correctionReason}` : ""}
                      </div>
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">{fmtMoney(s.gross)}</Td>
                  <Td className="text-right tabular-nums">{fmtMoney(s.totalDeductions)}</Td>
                  <Td className="text-right font-semibold tabular-nums">{fmtMoney(s.netPay)}</Td>
                  <Td className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => setOpen(open === s.id ? null : s.id)}>{open === s.id ? "Hide" : "View"}</Button>
                    <Button size="sm" variant="secondary" onClick={() => download(`/payroll/payslips/${s.id}/pdf`, `payslip-${s.year}-${s.month}.pdf`)}>PDF</Button>
                    {canEdit && (
                      <Button size="sm" variant="secondary" onClick={() => { setEditing(editing === s.id ? null : s.id); setHistory(null); }}>
                        {editing === s.id ? "Cancel" : "Edit"}
                      </Button>
                    )}
                    {isHr && (
                      <Button size="sm" variant="ghost" onClick={() => { setHistory(history === s.id ? null : s.id); setEditing(null); }}>
                        {history === s.id ? "Hide history" : "History"}
                      </Button>
                    )}
                  </Td>
                </tr>
                {open === s.id && (
                  <tr>
                    <td colSpan={5} className="bg-slate-50 px-4 py-3">
                      <div className="grid gap-6 text-sm sm:grid-cols-2">
                        <dl className="space-y-1">
                          <div className="font-semibold text-slate-700">Earnings</div>
                          {([["Basic", s.basic], ["House Rent", s.houseRent], ["Medical", s.medical], ["Conveyance", s.conveyance], ["Fuel", s.fuel], ["Mobile", s.mobile]] as const).map(([k, v]) => (
                            <div key={k} className="flex justify-between"><dt className="text-slate-500">{k}</dt><dd className="tabular-nums">{fmtMoney(v)}</dd></div>
                          ))}
                        </dl>
                        <dl className="space-y-1">
                          <div className="font-semibold text-slate-700">Deductions</div>
                          {([["Income Tax", s.incomeTax], ["EOBI", s.eobi], ["Provident Fund", s.providentFund]] as const).map(([k, v]) => (
                            <div key={k} className="flex justify-between"><dt className="text-slate-500">{k}</dt><dd className="tabular-nums">{fmtMoney(v)}</dd></div>
                          ))}
                        </dl>
                      </div>
                    </td>
                  </tr>
                )}
                {editing === s.id && (
                  <tr>
                    <td colSpan={5} className="bg-slate-50 px-4 py-3">
                      <EditPayslipForm slip={s} onCancel={() => setEditing(null)} onDone={async () => { setEditing(null); await slips.reload(); }} />
                    </td>
                  </tr>
                )}
                {history === s.id && (
                  <tr>
                    <td colSpan={5} className="bg-slate-50 px-4 py-3">
                      <RevisionHistory payslipId={s.id} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </Table>
        )}
      </Card>

      <Card
        title="Yearly tax statement (July – June)"
        actions={
          <>
            <Select value={fy} onChange={(e) => setFy(Number(e.target.value))} className="!w-36" aria-label="Tax year">
              {[0, 1, 2].map((n) => {
                const y = currentTaxYear() - n;
                return <option key={y} value={y}>{y}-{String((y + 1) % 100).padStart(2, "0")}</option>;
              })}
            </Select>
            <Button size="sm" variant="secondary" onClick={() => download(`/payroll/tax-statement/pdf?fy=${fy}${employeeIdParam ? `&employeeId=${employeeIdParam}` : ""}`, `tax-statement-${fy}.pdf`)}>Download PDF</Button>
          </>
        }
      >
        {tax.loading ? <Spinner /> : tax.error ? <Alert>{tax.error}</Alert> : tax.data && (
          <Table head={["Month", "Gross pay", "Income tax", "Net pay"]} empty="No pay slips in this tax year.">
            {tax.data.months.map((m) => (
              <tr key={m.id}>
                <Td>{m.monthName} {m.year}</Td>
                <Td className="text-right tabular-nums">{fmtMoney(m.gross)}</Td>
                <Td className="text-right tabular-nums">{fmtMoney(m.incomeTax)}</Td>
                <Td className="text-right tabular-nums">{fmtMoney(m.netPay)}</Td>
              </tr>
            ))}
            {tax.data.months.length > 0 && (
              <tr className="font-semibold">
                <Td>Total</Td>
                <Td className="text-right tabular-nums">{fmtMoney(tax.data.totals.gross)}</Td>
                <Td className="text-right tabular-nums">{fmtMoney(tax.data.totals.incomeTax)}</Td>
                <Td className="text-right tabular-nums">{fmtMoney(tax.data.totals.netPay)}</Td>
              </tr>
            )}
          </Table>
        )}
      </Card>
    </div>
  );
}
