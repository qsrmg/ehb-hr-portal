"use client";

import { useState } from "react";
import { Alert, Button, Card, Field, Info, Input, PageHeader, Spinner, StatusBadge, Textarea } from "@/components/ui";
import type { Profile } from "@/lib/types";
import { patch } from "@/lib/api";
import { ROLE_LABELS } from "@/lib/auth";
import { useApi } from "@/lib/useApi";
import { fmtDate, fmtMoney } from "@/lib/format";

const CONTACT_FIELDS = ["phone", "personalEmail", "address", "emergencyContactName", "emergencyContactPhone"] as const;

function ContactForm({ profile, onSaved }: { profile: Profile; onSaved: (p: Profile) => void }) {
  const [form, setForm] = useState<Record<string, string>>(() => Object.fromEntries(CONTACT_FIELDS.map((k) => [k, profile[k] ?? ""])));
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      onSaved(await patch<Profile>("/employees/me/contact", form));
      setMsg({ kind: "success", text: "Contact details saved." });
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-4">
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Mobile number"><Input value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        <Field label="Personal email"><Input type="email" value={form.personalEmail ?? ""} onChange={(e) => setForm({ ...form, personalEmail: e.target.value })} /></Field>
        <Field label="Emergency contact name"><Input value={form.emergencyContactName ?? ""} onChange={(e) => setForm({ ...form, emergencyContactName: e.target.value })} /></Field>
        <Field label="Emergency contact number"><Input value={form.emergencyContactPhone ?? ""} onChange={(e) => setForm({ ...form, emergencyContactPhone: e.target.value })} /></Field>
        <Field label="Address" className="sm:col-span-2"><Textarea value={form.address ?? ""} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
      </div>
      <Button type="submit" loading={busy}>Save contact details</Button>
    </form>
  );
}

export default function ProfilePage() {
  const { data, loading, error, setData } = useApi<Profile>("/employees/me");

  if (loading) return <Spinner />;
  if (error || !data) return <Alert>{error}</Alert>;

  return (
    <div className="space-y-6">
      <PageHeader title="My profile" subtitle="You can update your contact details. Ask HR to change job, department, manager or bank details." />
      <Card title="Job information">
        <dl className="grid gap-4 sm:grid-cols-3">
          <Info label="Employee code" value={data.code} />
          <Info label="Name" value={data.fullName} />
          <Info label="Work email" value={data.email} />
          <Info label="Designation" value={data.designation} />
          <Info label="Department" value={data.department?.name} />
          <Info label="Line manager" value={data.manager?.fullName} />
          <Info label="Joining date" value={fmtDate(data.joiningDate)} />
          <Info label="Status" value={<StatusBadge status={data.status} />} />
          <Info
            label="Employment status"
            value={
              <>
                <StatusBadge status={data.probationStatus ?? "CONFIRMED"} />
                {data.probationStatus === "ON_PROBATION" && <span className="ml-2 text-xs text-slate-500">{`Until ${fmtDate(data.probationEndDate)}`}</span>}
                {data.probationStatus === "CONFIRMED" && data.confirmedAt && <span className="ml-2 text-xs text-slate-500">{`Confirmed on ${fmtDate(data.confirmedAt)}`}</span>}
              </>
            }
          />
          <Info label="Roles" value={data.roles.map((r) => ROLE_LABELS[r]).join(", ")} />
        </dl>
      </Card>

      <Card title="Contact details">
        <ContactForm profile={data} onSaved={setData} />
      </Card>

      <Card title="Personal, bank and salary (view only)">
        <dl className="grid gap-4 sm:grid-cols-3">
          <Info label="CNIC" value={data.cnic} />
          <Info label="Father's name" value={data.fatherName} />
          <Info label="Date of birth" value={data.dateOfBirth ? fmtDate(data.dateOfBirth) : null} />
          <Info label="Bank" value={data.bankName} />
          <Info label="Account number" value={data.bankAccount} />
          <Info label="Gross salary (PKR)" value={data.grossSalary != null ? fmtMoney(data.grossSalary) : null} />
        </dl>
      </Card>
    </div>
  );
}
