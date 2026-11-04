"use client";

import { useState } from "react";
import { Alert, Card, LinkButton, PageHeader, Select, Spinner } from "@/components/ui";
import { RequestList, type RequestSummary } from "@/components/RequestList";
import { useApi } from "@/lib/useApi";

export default function MyRequestsPage() {
  const [status, setStatus] = useState("");
  const { data, loading, error } = useApi<RequestSummary[]>(`/requests/mine${status ? `?status=${status}` : ""}`);
  return (
    <div className="space-y-6">
      <PageHeader
        title="My requests"
        subtitle="Track every request: who has it, and every approval step."
        actions={
          <>
            <LinkButton href="/requests/new/leave">Leave</LinkButton>
            <LinkButton href="/requests/new/attendance-update" variant="secondary">Attendance update</LinkButton>
            <LinkButton href="/requests/new/letter" variant="secondary">Letter</LinkButton>
          </>
        }
      />
      <Card
        actions={
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40" aria-label="Filter by status">
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
