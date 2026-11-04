"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Alert, Card, PageHeader } from "@/components/ui";
import { AttendanceUpdateForm, LeaveForm, LetterForm } from "@/components/RequestForms";
import { ExpenseForm } from "@/components/ExpenseForm";
import { TravelForm } from "@/components/TravelForm";
import { SettlementForm } from "@/components/SettlementForm";

const TITLES: Record<string, { title: string; subtitle: string }> = {
  leave: { title: "Apply for leave", subtitle: "Goes to your Line Manager (and HR for leave without pay, maternity and paternity)." },
  "attendance-update": { title: "Attendance update", subtitle: "Fix a missed punch or record a field visit. Up to 3 a month, within 7 days. The machine record is kept; the correction is stored alongside it." },
  letter: { title: "Letter request", subtitle: "Experience letter, salary certificate, employment verification or NOC. Approved by HR." },
  travel: { title: "Travel request", subtitle: "Business trips within Pakistan. Goes to your Line Manager and Head of Department; Admin books tickets and hotel once approved." },
  settlement: { title: "Trip settlement", subtitle: "What the trip cost, after you return. Goes to your Line Manager and Finance; any advance is deducted." },
  expense: { title: "Expense claim", subtitle: "Local expenses with receipts. Goes to your Line Manager, Head of Department and Finance; Finance pays it once approved." },
};

export default function NewRequestPage() {
  const { type } = useParams<{ type: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const meta = TITLES[type];
  const done = (id: number) => router.push(`/requests/${id}?submitted=1`);

  if (!meta) return <Alert>Unknown request type.</Alert>;
  return (
    <div className={["expense", "settlement", "travel"].includes(type) ? "max-w-4xl" : "max-w-2xl"}>
      <PageHeader title={meta.title} subtitle={meta.subtitle} />
      <Card>
        {type === "leave" && <LeaveForm onDone={done} />}
        {type === "attendance-update" && <AttendanceUpdateForm onDone={done} defaultDate={search.get("date") ?? undefined} />}
        {type === "letter" && <LetterForm onDone={done} />}
        {type === "expense" && <ExpenseForm onDone={done} />}
        {type === "travel" && <TravelForm onDone={done} />}
        {type === "settlement" && (search.get("travel") ? <SettlementForm travelRequestId={Number(search.get("travel"))} onDone={done} /> : <Alert>Open the trip and choose “Submit trip settlement”.</Alert>)}
      </Card>
    </div>
  );
}
