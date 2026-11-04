"use client";

import { Fragment, useState } from "react";
import { Alert, Button, Card, PageHeader, Select, Spinner, Table, Td } from "@/components/ui";
import { download } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { fmtMoney } from "@/lib/format";

type Slip = {
  id: number; year: number; month: number; monthName: string;
  basic: number; houseRent: number; medical: number; conveyance: number; fuel: number; mobile: number; gross: number;
  incomeTax: number; eobi: number; providentFund: number; totalDeductions: number; netPay: number;
};
type Tax = { fy: number; label: string; totals: { gross: number; incomeTax: number; netPay: number }; months: Slip[] };

function currentTaxYear() {
  const d = new Date();
  return d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1;
}

export default function PayslipsPage() {
  const slips = useApi<Slip[]>("/payroll/payslips");
  const [fy, setFy] = useState(currentTaxYear());
  const tax = useApi<Tax>(`/payroll/tax-statement?fy=${fy}`);
  const [open, setOpen] = useState<number | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader title="Pay slips and tax statement" subtitle="Finance uploads payroll each month; pay slips are due by the 5th." />
      <Card title="Pay slips">
        {slips.loading ? <Spinner /> : slips.error ? <Alert>{slips.error}</Alert> : (
          <Table head={["Month", "Gross", "Deductions", "Net pay", ""]} empty="No pay slips yet.">
            {slips.data?.map((s) => (
              <Fragment key={s.id}>
                <tr>
                  <Td className="font-medium text-slate-900">{s.monthName} {s.year}</Td>
                  <Td className="tabular-nums">{fmtMoney(s.gross)}</Td>
                  <Td className="tabular-nums">{fmtMoney(s.totalDeductions)}</Td>
                  <Td className="font-semibold tabular-nums">{fmtMoney(s.netPay)}</Td>
                  <Td className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => setOpen(open === s.id ? null : s.id)}>{open === s.id ? "Hide" : "View"}</Button>
                    <Button size="sm" variant="secondary" onClick={() => download(`/payroll/payslips/${s.id}/pdf`, `payslip-${s.year}-${s.month}.pdf`)}>PDF</Button>
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
              </Fragment>
            ))}
          </Table>
        )}
      </Card>

      <Card
        title="Yearly tax statement (July – June)"
        actions={
          <>
            <Select value={fy} onChange={(e) => setFy(Number(e.target.value))} className="w-36" aria-label="Tax year">
              {[0, 1, 2].map((n) => {
                const y = currentTaxYear() - n;
                return <option key={y} value={y}>{y}-{String((y + 1) % 100).padStart(2, "0")}</option>;
              })}
            </Select>
            <Button size="sm" variant="secondary" onClick={() => download(`/payroll/tax-statement/pdf?fy=${fy}`, `tax-statement-${fy}.pdf`)}>Download PDF</Button>
          </>
        }
      >
        {tax.loading ? <Spinner /> : tax.error ? <Alert>{tax.error}</Alert> : tax.data && (
          <Table head={["Month", "Gross pay", "Income tax", "Net pay"]} empty="No pay slips in this tax year.">
            {tax.data.months.map((m) => (
              <tr key={m.id}>
                <Td>{m.monthName} {m.year}</Td>
                <Td className="tabular-nums">{fmtMoney(m.gross)}</Td>
                <Td className="tabular-nums">{fmtMoney(m.incomeTax)}</Td>
                <Td className="tabular-nums">{fmtMoney(m.netPay)}</Td>
              </tr>
            ))}
            {tax.data.months.length > 0 && (
              <tr className="font-semibold">
                <Td>Total</Td>
                <Td className="tabular-nums">{fmtMoney(tax.data.totals.gross)}</Td>
                <Td className="tabular-nums">{fmtMoney(tax.data.totals.incomeTax)}</Td>
                <Td className="tabular-nums">{fmtMoney(tax.data.totals.netPay)}</Td>
              </tr>
            )}
          </Table>
        )}
      </Card>
    </div>
  );
}
