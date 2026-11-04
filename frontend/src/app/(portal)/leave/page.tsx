"use client";

import Link from "next/link";
import { Alert, Card, LinkButton, PageHeader, Spinner, StatusBadge, Table, Td } from "@/components/ui";
import { useApi } from "@/lib/useApi";
import { fmtDate } from "@/lib/format";

type Balance = { leaveTypeId: number; code: string; name: string; hasQuota: boolean; entitled: number; carriedForward: number; used: number; pending: number; available: number | null };
type RequestRow = { id: number; title: string; status: string; currentStepLabel: string | null; createdAt: string };

export default function LeavePage() {
  const year = new Date().getFullYear();
  const balances = useApi<Balance[]>(`/leave/balances/me?year=${year}`);
  const history = useApi<RequestRow[]>("/requests/mine?type=LEAVE");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leave"
        subtitle={`Calendar year ${year}. Quotas are pro-rated for new joiners; up to 14 unused Annual Leave days carry forward.`}
        actions={<LinkButton href="/requests/new/leave">Apply for leave</LinkButton>}
      />
      <Card title="Balances">
        {balances.loading ? <Spinner /> : balances.error ? <Alert>{balances.error}</Alert> : (
          <Table head={["Leave type", "Entitled", "Carried forward", "Used", "Pending", "Available"]}>
            {balances.data?.map((b) => (
              <tr key={b.leaveTypeId}>
                <Td className="font-medium text-slate-900">{b.name}</Td>
                <Td className="tabular-nums">{b.hasQuota ? b.entitled : "No fixed quota"}</Td>
                <Td className="tabular-nums">{b.hasQuota ? b.carriedForward : "—"}</Td>
                <Td className="tabular-nums">{b.used}</Td>
                <Td className="tabular-nums">{b.pending}</Td>
                <Td className="font-semibold tabular-nums">{b.available ?? "—"}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Card title="My leave requests">
        {history.loading ? <Spinner /> : (
          <Table head={["#", "Request", "Submitted", "Status"]} empty="No leave requests yet.">
            {history.data?.map((r) => (
              <tr key={r.id}>
                <Td className="text-slate-500">{r.id}</Td>
                <Td><Link href={`/requests/${r.id}`} className="font-medium text-accent hover:underline">{r.title}</Link></Td>
                <Td>{fmtDate(r.createdAt)}</Td>
                <Td><StatusBadge status={r.status} />{r.currentStepLabel && <span className="ml-2 text-xs text-slate-500">with {r.currentStepLabel}</span>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
