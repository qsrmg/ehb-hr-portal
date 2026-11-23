"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Spinner, StatusBadge, Table, Tabs, Td, Textarea } from "@/components/ui";
import { hasRole, useAuth } from "@/lib/auth";
import { post, put } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { fmtDate, todayYmd } from "@/lib/format";

type ExitSummary = {
  id: number; type: string; typeLabel: string; status: string; lastWorkingDay: string; deactivated: boolean; createdAt: string;
  employee: { id: number; fullName: string; code: string; department: string | null };
  clearances: { area: string; label: string; status: string }[];
  waitingForMe: boolean;
};

type Option = { id: number; fullName: string; code: string };
type ChecklistTemplate = { id: number; area: string; label: string; ownerRole: string | null; sortOrder: number; active: boolean };

const EXIT_TYPES: Record<string, string> = { RESIGNATION: "Resignation", TERMINATION: "Termination", END_OF_CONTRACT: "End of contract", OTHER: "Other" };
const AREAS = ["IT_ADMIN", "LINE_MANAGER", "HR", "FINANCE"] as const;
const AREA_LABELS: Record<string, string> = { IT_ADMIN: "IT / Admin", LINE_MANAGER: "Line Manager", HR: "HR", FINANCE: "Finance" };
const OWNER_ROLES = ["", "LINE_MANAGER", "HOD", "HR", "FINANCE", "ADMIN", "MANAGEMENT"] as const;

/** Configurable offboarding checklist (per DECISIONS.md: informational only, does not change clearance gating). */
function ChecklistTemplates() {
  const { data, loading, error, reload } = useApi<ChecklistTemplate[]>("/exits/checklist-templates");
  const [form, setForm] = useState({ area: "IT_ADMIN", label: "", ownerRole: "" });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await post("/exits/checklist-templates", { area: form.area, label: form.label, ownerRole: form.ownerRole || null, sortOrder: (data?.length ?? 0) + 1 });
      setForm({ ...form, label: "" });
      await reload();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (t: ChecklistTemplate) => {
    await put(`/exits/checklist-templates/${t.id}`, { active: !t.active });
    await reload();
  };

  if (loading && !data) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Placeholder wording — HR/Admin to confirm (see DECISIONS.md). New items apply to exits opened from now on; existing open exits keep the items they started with.
      </p>
      {AREAS.map((area) => {
        const items = (data ?? []).filter((t) => t.area === area);
        if (!items.length) return null;
        return (
          <div key={area}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{AREA_LABELS[area]}</h3>
            <ul className="mt-1 divide-y divide-slate-100">
              {items.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                  <span className={t.active ? "text-slate-700" : "text-slate-400 line-through"}>
                    {t.label}{t.ownerRole ? ` · ${t.ownerRole}` : " · HR only"}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => toggleActive(t)}>{t.active ? "Deactivate" : "Reactivate"}</Button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      <form onSubmit={add} className="grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2 lg:grid-cols-[minmax(10rem,1fr)_minmax(14rem,2fr)_minmax(10rem,1fr)_auto] lg:items-end">
        {formError && <div className="sm:col-span-2 lg:col-span-4"><Alert>{formError}</Alert></div>}
        <Field label="Area">
          <Select value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })}>
            {AREAS.map((a) => <option key={a} value={a}>{AREA_LABELS[a]}</option>)}
          </Select>
        </Field>
        <Field label="New item"><Input required value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></Field>
        <Field label="Owner (blank: HR only)">
          <Select value={form.ownerRole} onChange={(e) => setForm({ ...form, ownerRole: e.target.value })}>
            {OWNER_ROLES.map((r) => <option key={r} value={r}>{r || "HR only"}</option>)}
          </Select>
        </Field>
        <div><Button type="submit" loading={busy}>Add item</Button></div>
      </form>
    </div>
  );
}

function StartExit({ onStarted }: { onStarted: (id: number) => void }) {
  const people = useApi<Option[]>("/employees");
  const [form, setForm] = useState({ employeeId: "", type: "TERMINATION", reason: "", noticeGivenOn: todayYmd(), lastWorkingDay: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const { id } = await post<{ id: number }>("/exits", { ...form, employeeId: Number(form.employeeId) });
          onStarted(id);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Employee">
          <Select required value={form.employeeId} onChange={set("employeeId")}>
            <option value="">Choose…</option>
            {people.data?.map((p) => <option key={p.id} value={p.id}>{p.fullName} ({p.code})</option>)}
          </Select>
        </Field>
        <Field label="Reason for the exit">
          <Select value={form.type} onChange={set("type")}>
            {Object.entries(EXIT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="Notice given on"><Input type="date" required value={form.noticeGivenOn} onChange={set("noticeGivenOn")} /></Field>
        <Field label="Last working day"><Input type="date" required value={form.lastWorkingDay} min={form.noticeGivenOn} onChange={set("lastWorkingDay")} /></Field>
      </div>
      <Field label="Details" hint="Visible to HR, Management and the employee only">
        <Textarea required value={form.reason} onChange={set("reason")} />
      </Field>
      <p className="text-xs text-slate-500">
        Starts the same clearance as an approved resignation. Use the Resignation request for a resignation submitted in the portal.
      </p>
      <Button type="submit" loading={busy}>Start exit clearance</Button>
    </form>
  );
}

export default function ExitsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [status, setStatus] = useState<"OPEN" | "COMPLETED" | "CANCELLED">("OPEN");
  const [starting, setStarting] = useState(false);
  const { data, loading, error } = useApi<ExitSummary[]>(`/exits?status=${status}`);
  const hr = !!user && hasRole(user, "HR");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Exit clearance"
        subtitle="Leavers and what is left to clear. IT / Admin, Line Manager and HR clear in parallel; Finance records the final settlement last."
        actions={hr && !starting ? <Button onClick={() => setStarting(true)}>Start an exit</Button> : null}
      />
      {starting && (
        <Card title="Start an exit (termination, end of contract, other)" actions={<Button variant="ghost" size="sm" onClick={() => setStarting(false)}>Close</Button>}>
          <StartExit onStarted={(id) => router.push(`/exits/${id}`)} />
        </Card>
      )}
      <Card>
        <Tabs
          value={status}
          onChange={setStatus}
          options={[{ value: "OPEN", label: "In progress" }, { value: "COMPLETED", label: "Completed" }, { value: "CANCELLED", label: "Cancelled" }]}
        />
        {loading && !data ? <Spinner /> : error ? <Alert>{error}</Alert> : (
          <Table head={["Employee", "Exit", "Last working day", "IT / Admin", "Line Manager", "HR", "Finance", ""]} empty="No exits here.">
            {data?.map((x) => (
              <tr key={x.id} className="hover:bg-slate-50">
                <Td>
                  <Link href={`/exits/${x.id}`} className="font-medium text-accent hover:underline">{x.employee.fullName}</Link>
                  <div className="text-xs text-slate-500">{x.employee.code}{x.employee.department ? ` · ${x.employee.department}` : ""}</div>
                </Td>
                <Td>{x.typeLabel}</Td>
                <Td>
                  {fmtDate(x.lastWorkingDay)}
                  {x.deactivated && <div className="text-xs text-slate-500">Login switched off</div>}
                </Td>
                {x.clearances.map((c) => <Td key={c.area}><StatusBadge status={c.status} /></Td>)}
                <Td>{x.waitingForMe && <Badge tone="amber">Waiting for you</Badge>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {hr && <Card title="Checklist templates"><ChecklistTemplates /></Card>}
    </div>
  );
}
