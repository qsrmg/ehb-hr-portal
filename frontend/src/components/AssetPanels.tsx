"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert, Button, Card, Field, Info, Select, Spinner, StatusBadge, Table, Td } from "@/components/ui";
import { post } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { fmtDate, fmtMoney } from "@/lib/format";
import type { Clearance } from "@/lib/assets";

export type AssetRequestDetail = {
  categoryId: number; category: string; reason: string; neededBy: string | null;
  fulfilled: { tag: string; name: string; serialNumber: string | null; issuedAt: string; issuedBy: string; assetId: number } | null;
};

/** Asset request on the request page: what was asked for, what was issued, and (for Admin) issuing an item from stock. */
export function AssetRequestPanel({ requestId, detail, canFulfil, onChanged }: { requestId: number; detail: AssetRequestDetail; canFulfil: boolean; onChanged: () => void }) {
  const stock = useApi<{ id: number; tag: string; name: string; serialNumber: string | null }[]>(canFulfil ? `/assets?status=IN_STOCK&categoryId=${detail.categoryId}` : null);
  const [assetId, setAssetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card title="Asset request">
      <dl className="grid gap-4 sm:grid-cols-3">
        <Info label="Needs" value={detail.category} />
        <Info label="Needed by" value={detail.neededBy ? fmtDate(detail.neededBy) : null} />
        <Info label="Issued" value={detail.fulfilled ? `${detail.fulfilled.name} (${detail.fulfilled.tag}) on ${fmtDate(detail.fulfilled.issuedAt)} by ${detail.fulfilled.issuedBy}` : "Not yet"} />
        <div className="sm:col-span-3"><Info label="Reason" value={detail.reason} /></div>
      </dl>
      {canFulfil && (
        <form
          className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await post(`/assets/${assetId}/issue`, { requestId });
              onChanged();
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {error && <div className="w-full"><Alert>{error}</Alert></div>}
          {stock.loading ? <Spinner /> : stock.data?.length ? (
            <Field label={`Issue a ${detail.category.toLowerCase()} from stock`} className="min-w-72">
              <Select required value={assetId} onChange={(e) => setAssetId(e.target.value)}>
                <option value="">Choose…</option>
                {stock.data.map((a) => <option key={a.id} value={a.id}>{a.tag} · {a.name}{a.serialNumber ? ` · ${a.serialNumber}` : ""}</option>)}
              </Select>
            </Field>
          ) : (
            <Alert kind="warning">No {detail.category.toLowerCase()} in stock. <Link href="/admin/assets" className="underline">Add one to the register</Link>, then come back.</Alert>
          )}
          {!!stock.data?.length && <Button type="submit" loading={busy}>Issue to the employee</Button>}
        </form>
      )}
    </Card>
  );
}

/** Exit clearance for assets (HR / Admin view on the employee page). */
export function AssetClearanceCard({ employeeId }: { employeeId: number }) {
  const { data, loading, error } = useApi<Clearance>(`/assets/clearance/${employeeId}`);
  if (loading) return <Card title="Asset clearance"><Spinner /></Card>;
  if (error || !data) return null;
  return (
    <Card title="Asset clearance" actions={<StatusBadge status={data.cleared ? "APPROVED" : "PENDING"} label={data.cleared ? "Cleared" : `Blocked: ${data.outstanding.length} item(s)`} />}>
      {data.outstanding.length > 0 ? (
        <Table head={["Item", "Tag", "Category", "Since", "Needed"]}>
          {data.outstanding.map((o) => (
            <tr key={o.assignmentId}>
              <Td><Link href={`/admin/assets/${o.assetId}`} className="text-accent hover:underline">{o.name}</Link></Td>
              <Td className="font-mono text-xs">{o.tag}</Td>
              <Td>{o.category}</Td>
              <Td>{fmtDate(o.issuedAt)}</Td>
              <Td>{o.action}</Td>
            </tr>
          ))}
        </Table>
      ) : (
        <p className="text-sm text-slate-600">No returnable items or accounts outstanding.</p>
      )}
      {data.recoveries.length > 0 && (
        <p className="mt-3 text-sm text-red-700">Recoveries for the final settlement: PKR {fmtMoney(data.recoveryTotal)} ({data.recoveries.map((r) => `${r.name} ${r.tag}`).join(", ")}).</p>
      )}
      {data.pendingDecisions.length > 0 && (
        <p className="mt-2 text-sm text-amber-800">Waiting for an HR recovery or Management write-off: {data.pendingDecisions.map((p) => `${p.name} (${p.tag})`).join(", ")}.</p>
      )}
      {data.stillHeldNotRequired.length > 0 && (
        <p className="mt-2 text-xs text-slate-500">Also holds (not required on exit): {data.stillHeldNotRequired.map((s) => s.name).join(", ")}.</p>
      )}
    </Card>
  );
}

/** Line manager: what the team holds. */
export function TeamAssets() {
  const { data, loading } = useApi<{ id: number; employee: { fullName: string; code: string }; issuedAt: string; confirmedAt: string | null; asset: { tag: string; name: string; category: string; status: string } }[]>("/assets/team");
  if (loading) return <Spinner />;
  return (
    <Table head={["Employee", "Item", "Tag", "Category", "Since", "Status"]} empty="Your team has no company items issued.">
      {data?.map((r) => (
        <tr key={r.id}>
          <Td>{r.employee.fullName}<div className="text-xs text-slate-500">{r.employee.code}</div></Td>
          <Td>{r.asset.name}</Td>
          <Td className="font-mono text-xs">{r.asset.tag}</Td>
          <Td>{r.asset.category}</Td>
          <Td>{fmtDate(r.issuedAt)}</Td>
          <Td><StatusBadge status={r.asset.status} />{!r.confirmedAt && <div className="text-xs text-amber-800">not confirmed</div>}</Td>
        </tr>
      ))}
    </Table>
  );
}
