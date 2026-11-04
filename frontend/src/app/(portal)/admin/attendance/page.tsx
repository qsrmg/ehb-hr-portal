"use client";

import { useState } from "react";
import { Alert, Card, PageHeader, Spinner, Table, Td } from "@/components/ui";
import { ImportForm } from "@/components/ImportResult";
import { useApi } from "@/lib/useApi";
import { fmtDate, fmtDateTime } from "@/lib/format";

type Result = { importId: number; rowsRead: number; daysImported: number; skippedRows: number; weekendOrHolidaySkipped: number; unmatchedIds: string[]; from: string; to: string; lateWarningsRaised: number };
type ImportRow = { id: number; fileName: string; rowsRead: number; rowsImported: number; unmatchedIds: string[]; fromDate: string | null; toDate: string | null; createdAt: string };

export default function AttendanceImportPage() {
  const imports = useApi<ImportRow[]>("/attendance/imports");
  const [result, setResult] = useState<Result | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader title="Attendance import" subtitle="Export check-in / check-out data from the biometric machine and import it here. Each machine ID is matched to an employee." />
      <Card title="Import biometric data">
        <div className="mb-4 space-y-1 text-sm text-slate-600">
          <p>Two layouts are accepted:</p>
          <ul className="list-disc pl-5">
            <li><strong>Daily</strong>: one row per person per day with columns <code>Machine ID</code>, <code>Date</code>, <code>Check In</code>, <code>Check Out</code>.</li>
            <li><strong>Punch log</strong>: one row per punch with <code>Machine ID</code> (or AC-No.) and <code>Date/Time</code>. The first punch is check-in and the last is check-out.</li>
          </ul>
          <p>Dates may be <code>2026-10-28</code> or <code>28/10/2026</code> (day first). Weekends and holidays are skipped. Re-importing a day refreshes the machine values; approved corrections are kept. Samples are in <code>backend/samples/</code>.</p>
        </div>
        <ImportForm<Result> path="/attendance/import" onDone={(r) => { setResult(r); imports.reload(); }} />
        {result && (
          <div className="mt-4 space-y-2">
            <Alert kind="success">
              Imported {result.daysImported} employee-days from {fmtDate(result.from)} to {fmtDate(result.to)} ({result.rowsRead} rows read
              {result.weekendOrHolidaySkipped ? `, ${result.weekendOrHolidaySkipped} weekend/holiday rows skipped` : ""}
              {result.skippedRows ? `, ${result.skippedRows} unreadable rows` : ""}).
              {result.lateWarningsRaised > 0 && ` ${result.lateWarningsRaised} late-arrival warning(s) sent to HR.`}
            </Alert>
            {result.unmatchedIds.length > 0 && (
              <Alert kind="warning">No employee has these machine IDs: {result.unmatchedIds.join(", ")}. Set the machine ID on the employee record and import again.</Alert>
            )}
          </div>
        )}
      </Card>
      <Card title="Import history">
        {imports.loading ? <Spinner /> : (
          <Table head={["When", "File", "Period", "Rows", "Imported", "Unmatched IDs"]} empty="No imports yet.">
            {imports.data?.map((i) => (
              <tr key={i.id}>
                <Td>{fmtDateTime(i.createdAt)}</Td>
                <Td>{i.fileName}</Td>
                <Td>{fmtDate(i.fromDate)} – {fmtDate(i.toDate)}</Td>
                <Td className="tabular-nums">{i.rowsRead}</Td>
                <Td className="tabular-nums">{i.rowsImported}</Td>
                <Td className="text-xs text-slate-500">{i.unmatchedIds.join(", ") || "—"}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
