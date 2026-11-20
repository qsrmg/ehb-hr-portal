import Link from "next/link";
import { CheckCircle2, Clock, FileClock, XCircle } from "lucide-react";
import { Empty } from "@/components/ui";
import { GlassCard } from "./GlassCard";
import { fmtDateTime } from "@/lib/format";

export type ActivityRow = { id: number; title: string; typeLabel: string; status: string; updatedAt: string };

const STATUS_VERB: Record<string, string> = {
  PENDING: "submitted", APPROVED: "approved", REJECTED: "rejected", RETURNED: "returned", CANCELLED: "cancelled",
};
const STATUS_TONE: Record<string, { icon: typeof CheckCircle2; tile: string }> = {
  PENDING: { icon: Clock, tile: "bg-sun/20 text-amber-700" },
  RETURNED: { icon: Clock, tile: "bg-orange-50 text-orange-700" },
  APPROVED: { icon: CheckCircle2, tile: "bg-emerald-50 text-emerald-700" },
  REJECTED: { icon: XCircle, tile: "bg-red-50 text-red-700" },
  CANCELLED: { icon: FileClock, tile: "bg-slate-100 text-slate-500" },
};

/** The employee's own most recent request activity — the same real rows the full "My requests" table uses
 * (see RequestsPanel), restyled as a compact timeline strip. No step here is invented: there is no tracked
 * event for a pay slip download, so that kind of line never appears. */
export function RecentActivity({ rows }: { rows: ActivityRow[] }) {
  return (
    <GlassCard title="Recent activity" actions={<Link href="/requests" className="text-sm font-semibold text-accent hover:underline">All requests</Link>}>
      {rows.length === 0 ? (
        <Empty>No recent activity yet.</Empty>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.slice(0, 3).map((r) => {
            const tone = STATUS_TONE[r.status] ?? STATUS_TONE.PENDING;
            const Icon = tone.icon;
            return (
              <li key={r.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${tone.tile}`}>
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-charcoal">
                    {r.typeLabel} {STATUS_VERB[r.status] ?? r.status.toLowerCase()}
                  </p>
                  <p className="truncate text-xs text-slate-500">{r.title}</p>
                </div>
                <span className="shrink-0 text-xs text-slate-400">{fmtDateTime(r.updatedAt)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </GlassCard>
  );
}
