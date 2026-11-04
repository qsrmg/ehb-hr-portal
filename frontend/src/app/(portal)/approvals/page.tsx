"use client";

import { useState } from "react";
import { Alert, Card, PageHeader, Spinner, Tabs } from "@/components/ui";
import { RequestList, type RequestSummary } from "@/components/RequestList";
import { useApi } from "@/lib/useApi";

export default function ApprovalsPage() {
  const [tab, setTab] = useState<"pending" | "history">("pending");
  const { data, loading, error } = useApi<RequestSummary[]>(`/requests/approvals${tab === "history" ? "?history=1" : ""}`);
  return (
    <div className="space-y-6">
      <PageHeader title="Approvals" subtitle="Requests wait with their approver; there is no delegation. Reminders are emailed every 3 hours in office hours." />
      <Card>
        <Tabs value={tab} onChange={setTab} options={[{ value: "pending", label: "Waiting for me" }, { value: "history", label: "I have acted on" }]} />
        {loading ? <Spinner /> : error ? <Alert>{error}</Alert> : (
          <RequestList rows={data ?? []} showEmployee empty={tab === "pending" ? "Nothing is waiting for your approval." : "You have not acted on any requests yet."} />
        )}
      </Card>
    </div>
  );
}
