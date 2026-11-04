"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Alert, Card, PageHeader } from "@/components/ui";
import { AttendanceUpdateForm, LeaveForm, LetterForm } from "@/components/RequestForms";

const TITLES: Record<string, { title: string; subtitle: string }> = {
  leave: { title: "Apply for leave", subtitle: "Goes to your Line Manager (and HR for leave without pay, maternity and paternity)." },
  "attendance-update": { title: "Attendance update", subtitle: "Fix a missed punch or record a field visit. Up to 3 a month, within 7 days. The machine record is kept; the correction is stored alongside it." },
  letter: { title: "Letter request", subtitle: "Experience letter, salary certificate, employment verification or NOC. Approved by HR." },
};

export default function NewRequestPage() {
  const { type } = useParams<{ type: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const meta = TITLES[type];
  const done = (id: number) => router.push(`/requests/${id}?submitted=1`);

  if (!meta) return <Alert>Unknown request type.</Alert>;
  return (
    <div className="max-w-2xl">
      <PageHeader title={meta.title} subtitle={meta.subtitle} />
      <Card>
        {type === "leave" && <LeaveForm onDone={done} />}
        {type === "attendance-update" && <AttendanceUpdateForm onDone={done} defaultDate={search.get("date") ?? undefined} />}
        {type === "letter" && <LetterForm onDone={done} />}
      </Card>
    </div>
  );
}
