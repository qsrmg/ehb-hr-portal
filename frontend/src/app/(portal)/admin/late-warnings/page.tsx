"use client";

import { Alert, Card, PageHeader, Spinner, Table, Td } from "@/components/ui";
import { useApi } from "@/lib/useApi";
import { fmtDateTime } from "@/lib/format";

type Warning = { id: number; year: number; month: number; monthName: string; lateCount: number; createdAt: string; employee: { id: number; code: string; fullName: string; department: string | null; manager: string | null } };

export default function LateWarningsPage() {
  const { data, loading, error } = useApi<Warning[]>("/attendance/late-warnings");
  return (
    <div className="space-y-6">
      <PageHeader title="Late arrival warnings" subtitle="Raised when an employee has 3 or more late arrivals in a month that were not corrected. There is no automatic deduction." />
      <Card>
        {loading ? <Spinner /> : error ? <Alert>{error}</Alert> : (
          <Table head={["Month", "Employee", "Department", "Line manager", "Late arrivals", "Raised"]} empty="No warnings.">
            {data?.map((w) => (
              <tr key={w.id}>
                <Td>{w.monthName} {w.year}</Td>
                <Td><div className="font-medium text-slate-900">{w.employee.fullName}</div><div className="text-xs text-slate-500">{w.employee.code}</div></Td>
                <Td>{w.employee.department ?? "—"}</Td>
                <Td>{w.employee.manager ?? "—"}</Td>
                <Td className="font-semibold tabular-nums text-amber-700">{w.lateCount}</Td>
                <Td>{fmtDateTime(w.createdAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
