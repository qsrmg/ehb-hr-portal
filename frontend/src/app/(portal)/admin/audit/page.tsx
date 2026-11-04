"use client";

import { useState } from "react";
import { Alert, Button, Card, PageHeader, Select, Spinner, Table, Td } from "@/components/ui";
import { useApi } from "@/lib/useApi";
import { fmtDateTime } from "@/lib/format";

type Audit = {
  total: number; page: number; pageSize: number;
  items: { id: number; action: string; entity: string; entityId: string | null; details: unknown; createdAt: string; actor: { fullName: string; code: string } | null }[];
};

const ACTIONS = ["", "LOGIN", "CREATE", "UPDATE", "DELETE", "IMPORT", "VIEW_SENSITIVE", "RESET_PASSWORD", "CHANGE_PASSWORD", "CARRY_FORWARD"];

export default function AuditPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const { data, loading, error } = useApi<Audit>(`/audit?page=${page}&action=${action}`);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-6">
      <PageHeader title="Audit log" subtitle="All changes to records and all views of sensitive data, with who and when." />
      <Card
        title={data ? `${data.total} entries` : "Entries"}
        actions={
          <Select value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} className="w-48" aria-label="Action">
            {ACTIONS.map((a) => <option key={a} value={a}>{a || "All actions"}</option>)}
          </Select>
        }
      >
        {loading ? <Spinner /> : error ? <Alert>{error}</Alert> : (
          <>
            <Table head={["When", "Who", "Action", "Record", "Details"]} empty="No entries.">
              {data?.items.map((a) => (
                <tr key={a.id} className="align-top">
                  <Td>{fmtDateTime(a.createdAt)}</Td>
                  <Td>{a.actor ? <>{a.actor.fullName}<div className="text-xs text-slate-500">{a.actor.code}</div></> : "System"}</Td>
                  <Td className="font-mono text-xs">{a.action}</Td>
                  <Td>{a.entity}{a.entityId ? ` #${a.entityId}` : ""}</Td>
                  <Td className="max-w-md whitespace-pre-wrap break-all font-mono text-[11px] text-slate-500">
                    {a.details && JSON.stringify(a.details) !== "{}" ? JSON.stringify(a.details) : ""}
                  </Td>
                </tr>
              ))}
            </Table>
            <div className="mt-3 flex items-center justify-end gap-2 text-sm text-slate-600">
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              Page {page} of {pages}
              <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
