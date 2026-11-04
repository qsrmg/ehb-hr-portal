"use client";

import { useState } from "react";
import { Alert, Button, Card, Field, Input, PageHeader, Select, Spinner, Table, Td } from "@/components/ui";
import { patch, post } from "@/lib/api";
import { useApi } from "@/lib/useApi";

type Dept = { id: number; name: string; hod: { id: number; fullName: string } | null; employeeCount: number };
type Person = { id: number; fullName: string; code: string };

export default function DepartmentsPage() {
  const { data, loading, error, reload } = useApi<Dept[]>("/departments");
  const people = useApi<Person[]>("/employees");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      await post("/departments", { name });
      setName("");
      reload();
    } catch (err) {
      setMsg((err as Error).message);
    }
  };

  const setHod = async (d: Dept, hodId: string) => {
    await patch(`/departments/${d.id}`, { hodId: hodId ? Number(hodId) : null });
    reload();
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Departments" subtitle="The Head of Department gives second-level approval for expenses, travel, resignations and hiring (Phase 2)." />
      <Card title="Departments">
        {loading ? <Spinner /> : error ? <Alert>{error}</Alert> : (
          <Table head={["Department", "Employees", "Head of Department"]}>
            {data?.map((d) => (
              <tr key={d.id}>
                <Td className="font-medium text-slate-900">{d.name}</Td>
                <Td className="tabular-nums">{d.employeeCount}</Td>
                <Td>
                  <Select value={d.hod?.id ?? ""} onChange={(e) => setHod(d, e.target.value)} className="w-64" aria-label={`HOD of ${d.name}`}>
                    <option value="">—</option>
                    {people.data?.map((p) => <option key={p.id} value={p.id}>{p.fullName} ({p.code})</option>)}
                  </Select>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Card title="Add department">
        <form onSubmit={add} className="flex flex-wrap items-end gap-3">
          {msg && <div className="w-full"><Alert>{msg}</Alert></div>}
          <Field label="Name"><Input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Button type="submit">Add</Button>
        </form>
      </Card>
    </div>
  );
}
