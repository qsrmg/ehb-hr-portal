"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Field, Input, PageHeader, Select, Spinner, StatusBadge, Table, Td } from "@/components/ui";
import { ImportForm } from "@/components/ImportResult";
import { post } from "@/lib/api";
import { hasRole, ROLE_LABELS, useAuth, type Role } from "@/lib/auth";
import { useApi } from "@/lib/useApi";
import { fmtDate } from "@/lib/format";

type Row = { id: number; code: string; fullName: string; email: string; designation: string | null; department: string | null; manager: string | null; roles: Role[]; status: string; joiningDate: string };
type Dept = { id: number; name: string };
type ImportResult = { rowsRead: number; created: { code: string; fullName: string; email: string }[]; skipped: { row: number; reason: string }[]; managersLinked: number; initialPassword: string };

export default function EmployeesPage() {
  const { user } = useAuth();
  const router = useRouter();
  const isHr = hasRole(user, "HR");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const [departmentId, setDepartmentId] = useState("");
  const { data, loading, error, reload } = useApi<Row[]>(`/employees?status=${status}&q=${encodeURIComponent(q)}${departmentId ? `&departmentId=${departmentId}` : ""}`);
  const depts = useApi<Dept[]>("/departments");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newEmp, setNewEmp] = useState({ fullName: "", email: "", joiningDate: "", designation: "", departmentId: "" });
  const [createError, setCreateError] = useState<string | null>(null);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    try {
      const created = await post<{ id: number; initialPassword: string }>("/employees", {
        ...newEmp, departmentId: newEmp.departmentId ? Number(newEmp.departmentId) : null, designation: newEmp.designation || null,
      });
      router.push(`/admin/employees/${created.id}?created=1`);
    } catch (err) {
      setCreateError((err as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Employees" subtitle="Employee records. HR changes job, department, manager and salary fields." actions={isHr && <Button onClick={() => setShowNew(!showNew)}>Add employee</Button>} />

      {isHr && showNew && (
        <Card title="New employee">
          <form onSubmit={create} className="grid gap-4 sm:grid-cols-2">
            {createError && <div className="sm:col-span-2"><Alert>{createError}</Alert></div>}
            <Field label="Full name"><Input required value={newEmp.fullName} onChange={(e) => setNewEmp({ ...newEmp, fullName: e.target.value })} /></Field>
            <Field label="Work email"><Input type="email" required value={newEmp.email} onChange={(e) => setNewEmp({ ...newEmp, email: e.target.value })} /></Field>
            <Field label="Joining date" hint="The code is generated from the joining year, e.g. EHB-2026-008"><Input type="date" required value={newEmp.joiningDate} onChange={(e) => setNewEmp({ ...newEmp, joiningDate: e.target.value })} /></Field>
            <Field label="Designation"><Input value={newEmp.designation} onChange={(e) => setNewEmp({ ...newEmp, designation: e.target.value })} /></Field>
            <Field label="Department">
              <Select value={newEmp.departmentId} onChange={(e) => setNewEmp({ ...newEmp, departmentId: e.target.value })}>
                <option value="">—</option>
                {depts.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            </Field>
            <div className="flex items-end"><Button type="submit">Create and edit details</Button></div>
          </form>
        </Card>
      )}

      {isHr && (
        <Card title="Import from the Employee Personal Information Google Form">
          <p className="mb-3 text-sm text-slate-600">
            Export the form responses as CSV or Excel. Columns are matched by name (Full Name, Work Email, CNIC, Phone, Department, Designation, Date of Joining, Machine ID, Line Manager Email, Bank Name, Account Number…). Existing emails are skipped. Sample: <code className="text-xs">backend/samples/employees-google-form.csv</code>
          </p>
          <ImportForm<ImportResult> path="/employees/import" onDone={(r) => { setResult(r); reload(); }} />
          {result && (
            <div className="mt-4 space-y-2">
              <Alert kind="success">
                Read {result.rowsRead} rows · created {result.created.length} employees · linked {result.managersLinked} managers. New employees log in with <strong>{result.initialPassword}</strong> and must change it.
              </Alert>
              {result.created.length > 0 && <p className="text-sm text-slate-600">Created: {result.created.map((c) => `${c.fullName} (${c.code})`).join(", ")}</p>}
              {result.skipped.length > 0 && <Alert kind="warning">Skipped: {result.skipped.map((s) => `row ${s.row}: ${s.reason}`).join("; ")}</Alert>}
            </div>
          )}
        </Card>
      )}

      <Card
        title={`Employees${data ? ` (${data.length})` : ""}`}
        actions={
          <>
            <Input placeholder="Search name, code, email" value={q} onChange={(e) => setQ(e.target.value)} className="w-56" />
            <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="w-44" aria-label="Department">
              <option value="">All departments</option>
              {depts.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-32" aria-label="Status">
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
              <option value="ALL">All</option>
            </Select>
          </>
        }
      >
        {loading ? <Spinner /> : error ? <Alert>{error}</Alert> : (
          <Table head={["Code", "Name", "Department", "Manager", "Roles", "Joined", "Status"]} empty="No employees match.">
            {data?.map((e) => (
              <tr key={e.id} className="hover:bg-slate-50">
                <Td className="font-mono text-xs">{e.code}</Td>
                <Td>
                  <Link href={`/admin/employees/${e.id}`} className="font-medium text-accent hover:underline">{e.fullName}</Link>
                  <div className="text-xs text-slate-500">{e.designation ?? e.email}</div>
                </Td>
                <Td>{e.department ?? "—"}</Td>
                <Td>{e.manager ?? "—"}</Td>
                <Td className="text-xs text-slate-500">{e.roles.filter((r) => r !== "EMPLOYEE").map((r) => ROLE_LABELS[r]).join(", ") || "Employee"}</Td>
                <Td>{fmtDate(e.joiningDate)}</Td>
                <Td><StatusBadge status={e.status} /></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
