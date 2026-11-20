"use client";

import { useState } from "react";
import Link from "next/link";
import { Alert, Card, PageHeader, Select, Spinner } from "@/components/ui";
import { RequestList, type RequestSummary } from "@/components/RequestList";
import { useApi } from "@/lib/useApi";

const NEW_REQUEST_TYPES = [
  ["leave", "Leave"],
  ["attendance-update", "Attendance update"],
  ["letter", "Letter"],
  ["expense", "Expense claim"],
  ["travel", "Travel"],
  ["asset", "Asset"],
  ["resignation", "Resignation"],
] as const;

/** One pill group for "start a new request", rather than a row of separate buttons — Leave is the common
 * case and reads as selected/primary; the rest sit beside it in the same light track. */
function NewRequestPills() {
  return (
    <div className="no-scrollbar max-w-full overflow-x-auto rounded-full bg-slate-100 p-1">
      <div className="flex w-max gap-1">
        {NEW_REQUEST_TYPES.map(([slug, label], i) => (
          <Link
            key={slug}
            href={`/requests/new/${slug}`}
            className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-semibold transition ${i === 0 ? "bg-primary text-white" : "text-slate-600 hover:bg-white hover:text-charcoal"}`}
          >
            {label}
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function MyRequestsPage() {
  const [status, setStatus] = useState("");
  const { data, loading, error } = useApi<RequestSummary[]>(`/requests/mine${status ? `?status=${status}` : ""}`);
  return (
    <div className="space-y-6">
      <PageHeader title="My requests" subtitle="Track every request: who has it, and every approval step." actions={<NewRequestPills />} />
      <Card
        actions={
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="!w-40" aria-label="Filter by status">
            <option value="">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="RETURNED">Returned</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="CANCELLED">Cancelled</option>
          </Select>
        }
        title="Requests"
      >
        {loading ? <Spinner /> : error ? <Alert>{error}</Alert> : <RequestList rows={data ?? []} empty="You have not submitted any requests yet." />}
      </Card>
    </div>
  );
}
