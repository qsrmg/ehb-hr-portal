"use client";

import { useState } from "react";
import { Alert, Card, PageHeader, Select, Spinner } from "@/components/ui";
import { RequestList, type RequestSummary } from "@/components/RequestList";
import { useApi } from "@/lib/useApi";

export default function AllRequestsPage() {
  const [status, setStatus] = useState("PENDING");
  const [type, setType] = useState("");
  const params = new URLSearchParams({ ...(status ? { status } : {}), ...(type ? { type } : {}) });
  const { data, loading, error } = useApi<RequestSummary[]>(`/requests?${params}`);
  return (
    <div className="space-y-6">
      <PageHeader title="All requests" subtitle="Every request across the company and where it is waiting." />
      <Card
        title={`Requests${data ? ` (${data.length})` : ""}`}
        actions={
          <>
            <Select value={type} onChange={(e) => setType(e.target.value)} className="w-44" aria-label="Type">
              <option value="">All types</option>
              <option value="LEAVE">Leave</option>
              <option value="ATTENDANCE_UPDATE">Attendance Update</option>
              <option value="LETTER">Letter Request</option>
              <option value="EXPENSE">Expense Claim</option>
              <option value="TRAVEL">Travel Request</option>
              <option value="TRAVEL_SETTLEMENT">Travel Settlement</option>
              <option value="ASSET_REQUEST">Asset Request</option>
            </Select>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-36" aria-label="Status">
              <option value="">All statuses</option>
              <option value="PENDING">Pending</option>
              <option value="RETURNED">Returned</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="CANCELLED">Cancelled</option>
            </Select>
          </>
        }
      >
        {loading ? <Spinner /> : error ? <Alert>{error}</Alert> : <RequestList rows={data ?? []} showEmployee empty="No requests match." />}
      </Card>
    </div>
  );
}
