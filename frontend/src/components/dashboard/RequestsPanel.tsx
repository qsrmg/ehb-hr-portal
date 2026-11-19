"use client";

import Link from "next/link";
import { Card, Empty, Table, Td } from "@/components/ui";
import { fmtDate } from "@/lib/format";

export type RequestRow = { id: number; title: string; typeLabel: string; status: string; updatedAt: string; currentStepLabel: string | null };

// The brief's exact status colours: pending=gold, approved=green, rejected=red, "in progress" (a step
// approved but the chain isn't finished) reuses the existing PENDING status with a distinct blue pill.
const STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-sun/20 text-amber-800",
  IN_PROGRESS: "bg-sky-100 text-sky-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-red-100 text-red-800",
  RETURNED: "bg-orange-100 text-orange-800",
  CANCELLED: "bg-slate-100 text-slate-600",
};
const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pending", APPROVED: "Approved", REJECTED: "Rejected", RETURNED: "Returned", CANCELLED: "Cancelled",
};

/** My requests: type, status, current approver and when it last changed — the dashboard's own view of the
 * existing /requests data, restyled with the brief's status colours. Every row still links to the request. */
export function RequestsPanel({ rows }: { rows: RequestRow[] }) {
  return (
    <Card title="My requests" actions={<Link href="/requests" className="text-sm font-semibold text-accent hover:underline">All requests</Link>}>
      {rows.length === 0 ? (
        <Empty>You have not submitted any requests yet.</Empty>
      ) : (
        <Table head={["Request", "Type", "Updated", "Status", "With", ""]} empty="No requests to show">
          {rows.map((r) => {
            // A pending request already past its first step reads as "in progress" rather than plain "pending".
            const isInProgress = r.status === "PENDING" && !!r.currentStepLabel && r.currentStepLabel !== "Line Manager";
            const statusKey = isInProgress ? "IN_PROGRESS" : r.status;
            return (
              <tr key={r.id} className="anim-fade-in-fast transition-colors hover:bg-slate-50">
                <Td><Link href={`/requests/${r.id}`} className="font-semibold text-charcoal hover:text-accent">{r.title}</Link></Td>
                <Td className="text-slate-500">{r.typeLabel}</Td>
                <Td className="text-slate-500">{fmtDate(r.updatedAt)}</Td>
                <Td>
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${STATUS_STYLE[statusKey] ?? "bg-slate-100 text-slate-600"}`}>
                    {STATUS_LABEL[statusKey] ?? (isInProgress ? "In progress" : r.status)}
                  </span>
                </Td>
                <Td className="text-slate-500">{r.status === "PENDING" ? r.currentStepLabel ?? "—" : "—"}</Td>
                <Td><Link href={`/requests/${r.id}`} className="text-sm font-semibold text-accent hover:underline">View</Link></Td>
              </tr>
            );
          })}
        </Table>
      )}
    </Card>
  );
}
