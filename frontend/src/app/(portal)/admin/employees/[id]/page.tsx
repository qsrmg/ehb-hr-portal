"use client";

import Link from "next/link";
import { useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Alert, Button, Card, Field, Info, Input, PageHeader, Select, Spinner, StatusBadge, Table, Td, Textarea } from "@/components/ui";
import { patch, post } from "@/lib/api";
import { hasRole, ROLE_LABELS, useAuth, type Role } from "@/lib/auth";
import { useApi } from "@/lib/useApi";
import type { Profile } from "@/lib/types";
import { fmtDate, fmtMoney } from "@/lib/format";

type Option = { id: number; name?: string; fullName?: string; code?: string };
type Balance = { balanceId: number; name: string; hasQuota: boolean; entitled: number; carriedForward: number; used: number; pending: number; available: number | null };
type Msg = { kind: "success" | "error"; text: string } | null;

const ALL_ROLES: Role[] = ["LINE_MANAGER", "HOD", "HR", "FINANCE", "ADMIN", "MANAGEMENT"];
const TEXT_FIELDS = [
  ["fullName", "Full name"], ["email", "Work email"], ["designation", "Designation"], ["machineId", "Biometric machine ID"],
  ["phone", "Mobile"], ["personalEmail", "Personal email"], ["emergencyContactName", "Emergency contact"], ["emergencyContactPhone", "Emergency number"],
  ["fatherName", "Father's name"], ["cnic", "CNIC"], ["maritalStatus", "Marital status"], ["bankName", "Bank"], ["bankAccount", "Account number"],
  ["basicSalary", "Basic salary (PKR)"], ["grossSalary", "Gross salary (PKR)"],
] as const;

function initialForm(emp: Profile) {
  const f: Record<string, string> = {};
  for (const [k] of TEXT_FIELDS) f[k] = emp[k] == null ? "" : String(emp[k]);
  return {
    ...f,
    address: emp.address ?? "", familyDetails: emp.familyDetails ?? "", gender: emp.gender ?? "", dateOfBirth: emp.dateOfBirth ?? "",
    joiningDate: emp.joiningDate, departmentId: emp.department ? String(emp.department.id) : "", managerId: emp.manager ? String(emp.manager.id) : "", status: emp.status,
  } as Record<string, string>;
}

function EmployeeForm({ emp, onSaved, onMessage }: { emp: Profile; onSaved: (p: Profile) => void; onMessage: (m: Msg) => void }) {
  const depts = useApi<Option[]>("/departments");
  const people = useApi<Option[]>("/employees");
  const [form, setForm] = useState(() => initialForm(emp));
  const [roles, setRoles] = useState<Role[]>(() => emp.roles.filter((r) => r !== "EMPLOYEE"));
  const [busy, setBusy] = useState(false);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    onMessage(null);
    try {
      const body = {
        ...form,
        gender: form.gender || null,
        departmentId: form.departmentId ? Number(form.departmentId) : null,
        managerId: form.managerId ? Number(form.managerId) : null,
        roles,
      };
      const saved = await patch<Profile & { leaveRecalculated: { updated: number; keptManual: number } | null }>(`/employees/${emp.id}`, body);
      onSaved(saved);
      const leave = saved.leaveRecalculated;
      onMessage({
        kind: "success",
        text: `Saved. The change is recorded in the audit log.${leave ? ` New joining date: ${leave.updated} leave balance(s) recalculated${leave.keptManual ? `, ${leave.keptManual} adjusted by hand kept` : ""}.` : ""}`,
      });
    } catch (err) {
      onMessage({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-6">
      <Card title="Job">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Department">
            <Select value={form.departmentId} onChange={set("departmentId")}>
              <option value="">—</option>
              {depts.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </Field>
          <Field label="Line manager">
            <Select value={form.managerId} onChange={set("managerId")}>
              <option value="">—</option>
              {people.data?.filter((p) => p.id !== emp.id).map((p) => <option key={p.id} value={p.id}>{p.fullName} ({p.code})</option>)}
            </Select>
          </Field>
          <Field label="Joining date"><Input type="date" value={form.joiningDate} onChange={set("joiningDate")} /></Field>
          <Field label="Status">
            <Select value={form.status} onChange={set("status")}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive (cannot log in)</option>
            </Select>
          </Field>
          <Field label="Gender">
            <Select value={form.gender} onChange={set("gender")}>
              <option value="">—</option>
              <option value="MALE">Male</option>
              <option value="FEMALE">Female</option>
              <option value="OTHER">Other</option>
            </Select>
          </Field>
          <Field label="Date of birth"><Input type="date" value={form.dateOfBirth} onChange={set("dateOfBirth")} /></Field>
        </div>
        <div className="mt-4">
          <div className="mb-1 text-sm font-medium text-slate-700">Portal roles</div>
          <div className="flex flex-wrap gap-4">
            {ALL_ROLES.map((r) => (
              <label key={r} className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={roles.includes(r)} onChange={(e) => setRoles(e.target.checked ? [...roles, r] : roles.filter((x) => x !== r))} />
                {ROLE_LABELS[r]}
              </label>
            ))}
          </div>
        </div>
      </Card>
      <Card title="Details">
        <div className="grid gap-4 sm:grid-cols-3">
          {TEXT_FIELDS.map(([k, label]) => (
            <Field key={k} label={label}><Input value={form[k] ?? ""} onChange={set(k)} /></Field>
          ))}
          <Field label="Address" className="sm:col-span-3"><Textarea value={form.address} onChange={set("address")} /></Field>
          <Field label="Family details (HR only)" className="sm:col-span-3"><Textarea value={form.familyDetails} onChange={set("familyDetails")} /></Field>
        </div>
      </Card>
      <Button type="submit" loading={busy}>Save changes</Button>
    </form>
  );
}

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const { user } = useAuth();
  const isHr = hasRole(user, "HR");
  const { data: emp, loading, error, setData } = useApi<Profile>(`/employees/${id}`);
  const balances = useApi<Balance[]>(`/leave/balances/${id}`);
  const [msg, setMsg] = useState<Msg>(
    search.get("created") ? { kind: "success", text: "Employee created. They log in with the default initial password and must change it at first login." } : null,
  );

  if (loading) return <Spinner />;
  if (error || !emp) return <Alert>{error}</Alert>;

  const resetPassword = async () => {
    if (!confirm(`Reset ${emp.fullName}'s password to the default initial password?`)) return;
    const r = await post<{ initialPassword: string }>(`/employees/${id}/reset-password`);
    setMsg({ kind: "success", text: `Password reset to ${r.initialPassword}. They must change it at next login.` });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={emp.fullName}
        subtitle={<>{emp.code} · {emp.designation ?? "—"} · {emp.department?.name ?? "No department"} <StatusBadge status={emp.status} /></>}
        actions={
          <>
            <Link href="/admin/employees" className="text-sm text-accent hover:underline">← All employees</Link>
            {isHr && <Button variant="secondary" onClick={resetPassword}>Reset password</Button>}
          </>
        }
      />
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      {isHr ? (
        <EmployeeForm key={emp.id} emp={emp} onSaved={setData} onMessage={setMsg} />
      ) : (
        <Card title="Information">
          <dl className="grid gap-4 sm:grid-cols-3">
            <Info label="Work email" value={emp.email} />
            <Info label="Line manager" value={emp.manager?.fullName} />
            <Info label="Joining date" value={fmtDate(emp.joiningDate)} />
            {"bankAccount" in emp && <Info label="Bank" value={`${emp.bankName ?? ""} ${emp.bankAccount ?? ""}`} />}
            {"grossSalary" in emp && <Info label="Gross salary" value={emp.grossSalary != null ? fmtMoney(emp.grossSalary) : null} />}
          </dl>
        </Card>
      )}

      {balances.data && (
        <Card title={`Leave balances ${new Date().getFullYear()}`}>
          <Table head={["Type", "Entitled", "Carried", "Used", "Pending", "Available"]}>
            {balances.data.map((b) => (
              <tr key={b.balanceId}>
                <Td>{b.name}</Td>
                <Td className="tabular-nums">{b.hasQuota ? b.entitled : "—"}</Td>
                <Td className="tabular-nums">{b.carriedForward}</Td>
                <Td className="tabular-nums">{b.used}</Td>
                <Td className="tabular-nums">{b.pending}</Td>
                <Td className="tabular-nums font-semibold">{b.available ?? "—"}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}
