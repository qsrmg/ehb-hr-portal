"use client";

import { useState } from "react";
import { Alert, Card, Field, PageHeader, Select, Spinner, Table, Td } from "@/components/ui";
import { ImportForm } from "@/components/ImportResult";
import { hasRole, useAuth } from "@/lib/auth";
import { useApi } from "@/lib/useApi";
import { fmtDateTime, MONTH_NAMES } from "@/lib/format";

type Upload = { id: number; year: number; month: number; fileName: string; rowsImported: number; unmatched: string[]; createdAt: string };
type Result = { uploadId: number; payslipsCreated: number; unmatched: string[] };

export default function PayrollPage() {
  const { user } = useAuth();
  const canUpload = hasRole(user, "FINANCE");
  const uploads = useApi<Upload[]>("/payroll/uploads");
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [result, setResult] = useState<Result | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader title="Payroll upload" subtitle="The portal does not calculate salary. Finance uploads the monthly payroll file and a pay slip is created for each employee." />
      {canUpload ? (
        <Card title="Upload monthly payroll">
          <p className="mb-3 text-sm text-slate-600">
            Columns: <code>Employee Code</code> (or work email), <code>Basic</code>, <code>House Rent</code>, <code>Medical</code>, <code>Conveyance</code>, <code>Fuel</code>, <code>Mobile</code>, <code>Income Tax</code>, <code>EOBI</code>, <code>Provident Fund</code>.
            Gross, total deductions and net pay are calculated if those columns are missing. Uploading the same month again replaces it. Sample: <code>backend/samples/payroll-october-2026.csv</code>
          </p>
          <ImportForm<Result> path="/payroll/upload" extra={{ year, month }} label="Upload payroll" onDone={(r) => { setResult(r); uploads.reload(); }}>
            <Field label="Month">
              <Select value={month} onChange={(e) => setMonth(e.target.value)} className="w-36">
                {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </Select>
            </Field>
            <Field label="Year">
              <Select value={year} onChange={(e) => setYear(e.target.value)} className="w-28">
                {[0, 1, 2].map((n) => <option key={n} value={now.getFullYear() - n}>{now.getFullYear() - n}</option>)}
              </Select>
            </Field>
          </ImportForm>
          {result && (
            <div className="mt-4 space-y-2">
              <Alert kind="success">Created {result.payslipsCreated} pay slips. Employees have been notified.</Alert>
              {result.unmatched.length > 0 && <Alert kind="warning">Rows that did not match any employee: {result.unmatched.join(", ")}</Alert>}
            </div>
          )}
        </Card>
      ) : (
        <Alert kind="info">Only Finance can upload payroll. HR can see the upload history.</Alert>
      )}
      <Card title="Upload history">
        {uploads.loading ? <Spinner /> : (
          <Table head={["Payroll month", "File", "Pay slips", "Unmatched", "Uploaded"]} empty="No payroll uploaded yet.">
            {uploads.data?.map((u) => (
              <tr key={u.id}>
                <Td className="font-medium text-slate-900">{MONTH_NAMES[u.month - 1]} {u.year}</Td>
                <Td>{u.fileName}</Td>
                <Td className="tabular-nums">{u.rowsImported}</Td>
                <Td className="text-xs text-slate-500">{u.unmatched.join(", ") || "—"}</Td>
                <Td>{fmtDateTime(u.createdAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
