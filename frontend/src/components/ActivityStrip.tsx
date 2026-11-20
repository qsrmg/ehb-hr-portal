"use client";

import { useState } from "react";
import { Alert, Button } from "@/components/ui";
import { Icon } from "@/components/icons";
import { useActivityTracking } from "@/lib/useActivityTracking";

const DISMISS_KEY = "hr_activity_ack_dismissed";

/** "What is tracked?" — the same short, plain-language explanation whether tracking is on or still pending. */
function WhatIsTracked({ policyText, onClose }: { policyText: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="What is tracked?">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 w-[min(92vw,32rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-base font-bold text-charcoal">What is tracked?</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-dim hover:bg-gray-100"><Icon name="close" className="h-4 w-4" /></button>
        </div>
        <p className="mt-3 text-sm text-slate-600">{policyText}</p>
        <div className="mt-4 text-right"><Button size="sm" variant="secondary" onClick={onClose}>Close</Button></div>
      </div>
    </div>
  );
}

/**
 * Mounted once in AppShell. Shows a small "Activity tracking on" badge while active, a non-blocking banner
 * asking the employee to acknowledge the policy before tracking can start, and a Pause button when HR has
 * allowed it. Nothing here blocks the rest of the portal — the banner can simply be dismissed.
 */
export function ActivityStrip() {
  const { status, acknowledge, pause, resume } = useActivityTracking();
  const [infoOpen, setInfoOpen] = useState(false);
  // The dismissed policy version, read once lazily; comparing it against the current one means a later
  // policy change (a new version) shows the banner again without needing an effect to notice the change.
  const [dismissedVersion, setDismissedVersion] = useState<number | null>(() => {
    try {
      const raw = sessionStorage.getItem(DISMISS_KEY);
      return raw ? Number(raw) : null;
    } catch {
      return null;
    }
  });
  const [busy, setBusy] = useState(false);

  if (!status?.enabled || status.excluded) return null;
  const dismissed = dismissedVersion === status.policyVersion;

  const dismiss = () => {
    setDismissedVersion(status.policyVersion);
    try {
      sessionStorage.setItem(DISMISS_KEY, String(status.policyVersion));
    } catch {
      /* ignore */
    }
  };

  const doAcknowledge = async () => {
    setBusy(true);
    try {
      await acknowledge();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {!status.acknowledged && !dismissed && (
        <Alert kind="info">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>HR has turned on activity monitoring for the portal. {status.policyText}</span>
            <span className="flex shrink-0 gap-2">
              <Button size="sm" loading={busy} onClick={doAcknowledge}>I understand, turn it on</Button>
              <Button size="sm" variant="ghost" onClick={dismiss}>Later</Button>
            </span>
          </div>
        </Alert>
      )}
      {status.trackable && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
            <Icon name="eye" className="h-3.5 w-3.5" /> Activity tracking on
          </span>
          <button className="text-xs text-accent hover:underline" onClick={() => setInfoOpen(true)}>What is tracked?</button>
          {status.allowPause && status.pauseBudgetMinutes > 0 && (
            status.paused ? (
              <Button size="sm" variant="secondary" onClick={resume}>Resume tracking</Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={pause} disabled={status.pauseUsedMinutesToday >= status.pauseBudgetMinutes}>
                Pause tracking ({Math.max(0, status.pauseBudgetMinutes - status.pauseUsedMinutesToday)} min left today)
              </Button>
            )
          )}
        </div>
      )}
      {infoOpen && <WhatIsTracked policyText={status.policyText} onClose={() => setInfoOpen(false)} />}
    </>
  );
}
