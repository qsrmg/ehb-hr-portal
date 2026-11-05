"use client";

import { useRouter } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { RequisitionForm } from "@/components/RequisitionForm";
import { useAuth } from "@/lib/auth";

export default function NewRequisitionPage() {
  const { user } = useAuth();
  const router = useRouter();
  if (!user) return null;
  return (
    <div className="max-w-4xl">
      <PageHeader title="New requisition" subtitle="Ask for a new or replacement position. Save it as a draft, or submit it for approval." />
      <Card>
        <RequisitionForm userId={user.id} onDone={(id, submitted) => router.push(`/hiring/requisitions/${id}${submitted ? "?submitted=1" : "?saved=1"}`)} />
      </Card>
    </div>
  );
}
