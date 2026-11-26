"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { useApi } from "@/lib/useApi";

type Acknowledgements = { acknowledged: { id: number; fullName: string; code: string; acknowledgedAt: string }[]; outstanding: { id: number; fullName: string; code: string }[] };

/**
 * HR sees who still has not acknowledged a policy — a document that requires acknowledgement
 * ("document:<id>") or the activity-monitoring policy ("activity-monitoring"). Shared by the Policies
 * page and the Activity admin page, both backed by the same GET /policies/:policyKey/acknowledgements.
 */
export function PolicyAcknowledgementsPanel({ policyKey, everyoneLabel = "Everyone has acknowledged this." }: { policyKey: string; everyoneLabel?: string }) {
  const [open, setOpen] = useState(false);
  const { data } = useApi<Acknowledgements>(open ? `/policies/${policyKey}/acknowledgements` : null);
  return (
    <div className="mt-1">
      <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
        {open ? "Hide" : "Who has not acknowledged?"}
      </Button>
      {open && data && (
        <div className="mt-2 text-xs text-slate-600">
          <div>{data.acknowledged.length} acknowledged, {data.outstanding.length} outstanding:</div>
          {data.outstanding.length ? (
            <ul className="mt-1 list-disc pl-4">
              {data.outstanding.map((e) => <li key={e.id}>{e.fullName} ({e.code})</li>)}
            </ul>
          ) : (
            <div className="mt-1">{everyoneLabel}</div>
          )}
        </div>
      )}
    </div>
  );
}
