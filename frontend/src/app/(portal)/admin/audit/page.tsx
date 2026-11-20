"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Badge, Button, Card, PageHeader, Select, Spinner, Table, Td } from "@/components/ui";
import { useApi } from "@/lib/useApi";
import { fmtDateTime } from "@/lib/format";

type AuditItem = { id: number; action: string; entity: string; entityId: string | null; details: unknown; createdAt: string; actor: { id: number; fullName: string; code: string } | null };
type Audit = { total: number; page: number; pageSize: number; items: AuditItem[] };

const ACTIONS = ["", "LOGIN", "CREATE", "UPDATE", "DELETE", "IMPORT", "EXPORT", "VIEW_SENSITIVE", "RESET_PASSWORD", "CHANGE_PASSWORD", "CARRY_FORWARD"];

const ACTION_TONE: Record<string, "slate" | "amber" | "blue" | "green" | "red"> = {
  VIEW_SENSITIVE: "amber",
  UPDATE: "blue",
  IMPORT: "blue",
  CREATE: "green",
  DELETE: "red",
};
const toneFor = (action: string) => ACTION_TONE[action] ?? "slate";

const fmtValue = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

/** Flattens an audit details object into readable "key: value" pairs, one level into any nested {from, to}
 * diff (e.g. Setting/Employee updates) or plain sub-object — never raw JSON. */
function flattenDetails(obj: unknown, prefix = ""): { k: string; v: string }[] {
  if (obj == null || typeof obj !== "object") return [];
  const out: { k: string; v: string }[] = [];
  for (const [k, val] of Object.entries(obj as Record<string, unknown>)) {
    const label = prefix ? `${prefix}.${k}` : k;
    if (val && typeof val === "object" && !Array.isArray(val) && "from" in val && "to" in val) {
      const { from, to } = val as { from: unknown; to: unknown };
      out.push({ k: label, v: `${fmtValue(from)} → ${fmtValue(to)}` });
    } else if (val && typeof val === "object" && !Array.isArray(val)) {
      out.push(...flattenDetails(val, label));
    } else if (Array.isArray(val)) {
      out.push({ k: label, v: val.length ? val.map(fmtValue).join(", ") : "—" });
    } else {
      out.push({ k: label, v: fmtValue(val) });
    }
  }
  return out;
}

const VISIBLE_CHIPS = 4;

function DetailsCell({ details }: { details: unknown }) {
  const [expanded, setExpanded] = useState(false);
  const chips = flattenDetails(details);
  if (!chips.length) return <span className="text-slate-400">—</span>;
  const shown = expanded ? chips : chips.slice(0, VISIBLE_CHIPS);
  const hidden = chips.length - shown.length;
  return (
    <div className="flex max-w-md flex-wrap items-center gap-1">
      {shown.map((c, i) => (
        <span key={i} className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
          <span className="text-slate-500">{c.k}:</span>&nbsp;{c.v}
        </span>
      ))}
      {hidden > 0 && (
        <button type="button" onClick={() => setExpanded(true)} className="text-[11px] font-semibold text-accent hover:underline">
          +{hidden} more
        </button>
      )}
      {expanded && chips.length > VISIBLE_CHIPS && (
        <button type="button" onClick={() => setExpanded(false)} className="text-[11px] font-semibold text-slate-500 hover:underline">
          Show less
        </button>
      )}
    </div>
  );
}

export default function AuditPage() {
  const router = useRouter();
  const search = useSearchParams();
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const hideLogins = search.get("hideLogins") === "1";
  const { data, loading, error } = useApi<Audit>(`/audit?page=${page}&action=${action}`);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const items = data ? (hideLogins ? data.items.filter((a) => a.action !== "LOGIN") : data.items) : [];

  const toggleHideLogins = () => {
    const params = new URLSearchParams(search.toString());
    if (hideLogins) params.delete("hideLogins");
    else params.set("hideLogins", "1");
    router.replace(`?${params.toString()}`);
  };

  const recordLabel = (a: AuditItem) => {
    if (a.entity === "Employee" && a.entityId && a.actor && Number(a.entityId) === a.actor.id) {
      return <>{a.actor.fullName}<span className="ml-1 text-xs text-slate-400">#{a.entityId}</span></>;
    }
    return <>{a.entity}{a.entityId ? ` #${a.entityId}` : ""}</>;
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Audit log" subtitle="All changes to records and all views of sensitive data, with who and when." />
      <Card
        title={data ? `${data.total} entries` : "Entries"}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-sm text-slate-600">
              <input type="checkbox" checked={hideLogins} onChange={toggleHideLogins} />
              Hide logins
            </label>
            <Select value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} className="!w-48" aria-label="Action">
              {ACTIONS.map((a) => <option key={a} value={a}>{a || "All actions"}</option>)}
            </Select>
          </div>
        }
      >
        {loading ? <Spinner /> : error ? <Alert>{error}</Alert> : (
          <>
            <Table head={["When", "Who", "Action", "Record", "Details"]} empty={hideLogins && data?.items.length ? "No entries (logins hidden)." : "No entries."}>
              {items.map((a) => (
                <tr key={a.id} className="align-top">
                  <Td>{fmtDateTime(a.createdAt)}</Td>
                  <Td>{a.actor ? <>{a.actor.fullName}<div className="text-xs text-slate-500">{a.actor.code}</div></> : "System"}</Td>
                  <Td><Badge tone={toneFor(a.action)}>{a.action}</Badge></Td>
                  <Td>{recordLabel(a)}</Td>
                  <Td><DetailsCell details={a.details} /></Td>
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
