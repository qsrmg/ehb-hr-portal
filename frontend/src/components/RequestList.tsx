"use client";

import Link from "next/link";
import { StatusBadge, Table, Td } from "@/components/ui";
import { fmtDate, fmtDateTime } from "@/lib/format";

export type RequestSummary = {
  id: number;
  type: string;
  typeLabel: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  employee: { id: number; fullName: string; code: string; department: string | null };
  currentStepLabel: string | null;
  pendingSince?: string | null;
};

export function RequestList({ rows, showEmployee, empty }: { rows: RequestSummary[]; showEmployee?: boolean; empty: string }) {
  return (
    <Table head={["#", ...(showEmployee ? ["Employee"] : []), "Type", "Request", "Submitted", "Status"]} empty={empty}>
      {rows.map((r) => (
        <tr key={r.id} className="hover:bg-slate-50">
          <Td className="text-slate-500">{r.id}</Td>
          {showEmployee && (
            <Td>
              <div className="font-medium text-slate-900">{r.employee.fullName}</div>
              <div className="text-xs text-slate-500">{r.employee.code}{r.employee.department ? ` · ${r.employee.department}` : ""}</div>
            </Td>
          )}
          <Td className="text-slate-500">{r.typeLabel}</Td>
          <Td>
            <Link href={`/requests/${r.id}`} className="font-medium text-accent hover:underline">{r.title}</Link>
            {r.pendingSince && <div className="text-xs text-slate-500">waiting since {fmtDateTime(r.pendingSince)}</div>}
          </Td>
          <Td>{fmtDate(r.createdAt)}</Td>
          <Td>
            <StatusBadge status={r.status} />
            {r.currentStepLabel && <span className="ml-2 text-xs text-slate-500">with {r.currentStepLabel}</span>}
          </Td>
        </tr>
      ))}
    </Table>
  );
}
