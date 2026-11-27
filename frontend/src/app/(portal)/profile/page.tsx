"use client";

import { useState } from "react";
import { Alert, Button, Card, Field, Info, Input, PageHeader, Spinner, StatusBadge, Textarea } from "@/components/ui";
import type { Profile } from "@/lib/types";
import { patch } from "@/lib/api";
import { ROLE_LABELS } from "@/lib/auth";
import { QualificationCard } from "@/components/QualificationCard";
import { useApi } from "@/lib/useApi";
import { fmtDate, fmtMoney } from "@/lib/format";

const CONTACT_FIELDS = ["phone", "personalEmail", "address", "emergencyContactName", "emergencyContactPhone"] as const;

/** One label style across every field group on this page — editable (Field) and read-only (Info) alike. */
const LABEL_CLASS = "mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500";

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
        <Field label="Mobile number" labelClassName={LABEL_CLASS}><Input value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        <Field label="Personal email" labelClassName={LABEL_CLASS}><Input type="email" value={form.personalEmail ?? ""} onChange={(e) => setForm({ ...form, personalEmail: e.target.value })} /></Field>
        <Field label="Emergency contact name" labelClassName={LABEL_CLASS}><Input value={form.emergencyContactName ?? ""} onChange={(e) => setForm({ ...form, emergencyContactName: e.target.value })} /></Field>
        <Field label="Emergency contact number" labelClassName={LABEL_CLASS}><Input value={form.emergencyContactPhone ?? ""} onChange={(e) => setForm({ ...form, emergencyContactPhone: e.target.value })} /></Field>
        <Field label="Address" className="sm:col-span-2" labelClassName={LABEL_CLASS}><Textarea value={form.address ?? ""} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
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
        <dl className="grid gap-4 sm:grid-cols-2">
          <Info label="Employee code" value={data.code} labelClassName={LABEL_CLASS} />
          <Info label="Name" value={data.fullName} labelClassName={LABEL_CLASS} />
          <Info label="Work email" value={data.email} labelClassName={LABEL_CLASS} />
          <Info label="Designation" value={data.designation} labelClassName={LABEL_CLASS} />
          <Info label="Department" value={data.department?.name} labelClassName={LABEL_CLASS} />
          <Info label="Line manager" value={data.manager?.fullName} labelClassName={LABEL_CLASS} />
          <Info label="Joining date" value={fmtDate(data.joiningDate)} labelClassName={LABEL_CLASS} />
          <Info label="Status" value={<StatusBadge status={data.status} />} labelClassName={LABEL_CLASS} />
          <Info
            label="Employment status"
            labelClassName={LABEL_CLASS}
            value={
              <>
                <StatusBadge status={data.probationStatus ?? "CONFIRMED"} />
                {data.probationStatus === "ON_PROBATION" && <span className="ml-2 text-xs text-slate-500">{`Until ${fmtDate(data.probationEndDate)}`}</span>}
                {data.probationStatus === "CONFIRMED" && data.confirmedAt && <span className="ml-2 text-xs text-slate-500">{`Confirmed on ${fmtDate(data.confirmedAt)}`}</span>}
              </>
            }
          />
          <Info label="Roles" value={data.roles.map((r) => ROLE_LABELS[r]).join(", ")} labelClassName={LABEL_CLASS} />
        </dl>
        {data.department?.dressCodeNotes && (
          <div className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-200">
            <span className="font-medium text-slate-700">Dress code notes for {data.department.name}: </span>
            {data.department.dressCodeNotes}
          </div>
        )}
      </Card>

      <Card title="Contact details">
        <ContactForm profile={data} onSaved={setData} />
      </Card>

      <QualificationCard employeeId={data.id} canAct={false} />

      <Card title="Personal, bank and salary (view only)">
        <dl className="grid gap-4 sm:grid-cols-2">
          <Info label="CNIC" value={data.cnic} labelClassName={LABEL_CLASS} />
          <Info label="Father's name" value={data.fatherName} labelClassName={LABEL_CLASS} />
          <Info label="Date of birth" value={data.dateOfBirth ? fmtDate(data.dateOfBirth) : null} labelClassName={LABEL_CLASS} />
          <Info label="Bank" value={data.bankName} labelClassName={LABEL_CLASS} />
          <Info label="Account number" value={data.bankAccount} labelClassName={LABEL_CLASS} />
          <Info label="Gross salary (PKR)" value={data.grossSalary != null ? fmtMoney(data.grossSalary) : null} labelClassName={LABEL_CLASS} />
        </dl>
      </Card>
    </div>
  );
}
