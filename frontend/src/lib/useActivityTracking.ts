"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { API_URL, api, getToken, post } from "./api";

export type ActivityStatus = {
  enabled: boolean;
  excluded: boolean;
  acknowledged: boolean;
  policyVersion: number;
  policyText: string;
  withinOfficeHours: boolean;
  trackable: boolean;
  allowPause: boolean;
  pauseBudgetMinutes: number;
  pauseUsedMinutesToday: number;
  paused: boolean;
};

/**
 * Keyboard/mouse presence tracking. Every listener below takes no argument at all, so there is nothing
 * for it to read off the DOM event — it cannot see which key was pressed, a mouse position, page text, the
 * URL or the window title, only that *something* happened. Only a per-minute boolean ever leaves the tab.
 *
 * Multi-tab: every open tab detects its own activity locally and broadcasts "activity in minute X" over a
 * BroadcastChannel; one tab is elected leader (a renewed localStorage lock) and is the only one that merges
 * those broadcasts (OR per minute, so activity in any tab counts) and sends heartbeats. This halves network
 * chatter and keeps rate limiting simple, without ever missing activity that happened in a background tab.
 * If the leader tab closes, its lock goes stale and another tab takes over within LEADER_TTL_MS; a brief
 * dual-leader moment during handover cannot double-count server-side because the server's own per-minute
 * watermark (see activity.ts) ignores a minute it has already recorded.
 */

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"] as const;
const LEADER_KEY = "hr_activity_leader";
const LEADER_TTL_MS = 12_000;
const LEADER_RENEW_MS = 4_000;
const HEARTBEAT_INTERVAL_MS = 75_000; // within the 60-120s batching window
const QUEUE_KEY = "hr_activity_queue";
const STATUS_POLL_MS = 5 * 60_000;

type QueuedMinute = { minuteStart: string; active: boolean };

const minuteFloorIso = (d: Date) => {
  const t = new Date(d);
  t.setSeconds(0, 0);
  return t.toISOString();
};

function loadQueue(): QueuedMinute[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedMinute[]) : [];
  } catch {
    return [];
  }
}
function saveQueue(q: QueuedMinute[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    /* storage unavailable: the queue just lives in memory for this tab's lifetime */
  }
}

export function useActivityTracking() {
  const [status, setStatus] = useState<ActivityStatus | null>(null);
  const [tabId] = useState(() => Math.random().toString(36).slice(2));
  const isLeaderRef = useRef(false);
  const mergedRef = useRef<Map<string, boolean>>(new Map());
  const nextRetryAtRef = useRef(0);

  const fetchStatus = useCallback(() => api<ActivityStatus>("/activity/status"), []);

  const refreshStatus = useCallback(() => fetchStatus().then(setStatus).catch(() => {}), [fetchStatus]);

  useEffect(() => {
    fetchStatus().then(setStatus).catch(() => {});
    const id = setInterval(() => fetchStatus().then(setStatus).catch(() => {}), STATUS_POLL_MS);
    return () => clearInterval(id);
  }, [fetchStatus]);

  const acknowledge = useCallback(async () => {
    await post("/activity/policy/acknowledge");
    await refreshStatus();
  }, [refreshStatus]);

  const pause = useCallback(async () => {
    await post("/activity/pause", { action: "start" });
    await refreshStatus();
  }, [refreshStatus]);

  const resume = useCallback(async () => {
    await post("/activity/pause", { action: "end" });
    await refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (!status?.trackable || status.paused) return;
    if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return;

    // e2e tests only: lets a test shrink the heartbeat cadence instead of waiting out the real 75s interval.
    // window.__ACTIVITY_HEARTBEAT_INTERVAL_MS__ is undefined for every real user, so production is unaffected.
    const heartbeatIntervalMs = (window as unknown as { __ACTIVITY_HEARTBEAT_INTERVAL_MS__?: number }).__ACTIVITY_HEARTBEAT_INTERVAL_MS__ ?? HEARTBEAT_INTERVAL_MS;

    const channel = new BroadcastChannel("hr_activity");

    // Takes no argument: there is nothing here that could read event.key, event.clientX, etc.
    const onActivity = () => {
      const minuteStart = minuteFloorIso(new Date());
      mergedRef.current.set(minuteStart, true);
      channel.postMessage({ type: "activity", minuteStart });
    };
    for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, onActivity, { passive: true });

    channel.onmessage = (e) => {
      const data = e.data as { type?: string; minuteStart?: string };
      if (data?.type === "activity" && data.minuteStart) mergedRef.current.set(data.minuteStart, true);
    };

    const renewLeadership = () => {
      try {
        const raw = localStorage.getItem(LEADER_KEY);
        const lock = raw ? (JSON.parse(raw) as { tabId: string; ts: number }) : null;
        const stale = !lock || Date.now() - lock.ts > LEADER_TTL_MS;
        if (isLeaderRef.current || stale) {
          localStorage.setItem(LEADER_KEY, JSON.stringify({ tabId, ts: Date.now() }));
          isLeaderRef.current = true;
        } else {
          isLeaderRef.current = lock.tabId === tabId;
        }
      } catch {
        isLeaderRef.current = true; // storage unavailable: worst case, more than one tab sends (harmless, see above)
      }
    };
    renewLeadership();
    const leaderTimer = setInterval(renewLeadership, LEADER_RENEW_MS);

    const sendHeartbeat = async (minutes: QueuedMinute[], keepalive = false) => {
      const token = getToken();
      const res = await fetch(`${API_URL}/activity/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ minutes }),
        keepalive,
      });
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("Retry-After") ?? "60");
        nextRetryAtRef.current = Date.now() + retryAfter * 1000;
        throw new Error("rate limited");
      }
      if (!res.ok) throw new Error(`heartbeat failed (${res.status})`);
    };

    const flush = async (keepalive = false) => {
      if (!isLeaderRef.current) return;
      if (Date.now() < nextRetryAtRef.current) return;
      const pending = new Map<string, boolean>(loadQueue().map((m) => [m.minuteStart, m.active]));
      for (const [k, v] of mergedRef.current) pending.set(k, v || (pending.get(k) ?? false));
      if (!pending.size) return;
      mergedRef.current.clear();
      const minutes = [...pending.entries()].map(([minuteStart, active]) => ({ minuteStart, active }));
      try {
        await sendHeartbeat(minutes, keepalive);
        saveQueue([]); // accepted (or legitimately too old/future — either way the server has dealt with it)
      } catch {
        saveQueue(minutes); // nothing lost: resent in full on the next tick (or once Retry-After has passed)
      }
    };
    const heartbeatTimer = setInterval(() => void flush(), heartbeatIntervalMs);
    const onBeforeUnload = () => void flush(true);
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, onActivity);
      window.removeEventListener("beforeunload", onBeforeUnload);
      clearInterval(leaderTimer);
      clearInterval(heartbeatTimer);
      channel.close();
    };
  }, [status?.trackable, status?.paused, tabId]);

  return { status, acknowledge, pause, resume, refreshStatus };
}
