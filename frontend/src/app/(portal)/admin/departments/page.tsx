"use client";

import { useState } from "react";
import { Alert, Button, Card, Field, Input, PageHeader, Select, Spinner, Table, Td, Textarea } from "@/components/ui";
import { patch, post } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { hasRole, useAuth } from "@/lib/auth";

type Dept = { id: number; name: string; hod: { id: number; fullName: string } | null; employeeCount: number; dressCodeNotes: string | null };
type Person = { id: number; fullName: string; code: string };

/** Dress Code Policy D1/D3: optional guidance shown to the department's own staff. Plain text, no attachments. */
function DressCodeNotes({ d, canEdit, onSaved }: { d: Dept; canEdit: boolean; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(d.dressCodeNotes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    return (
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-slate-600">{d.dressCodeNotes || <span className="text-slate-400">No notes</span>}</p>
        {canEdit && <Button variant="ghost" onClick={() => { setValue(d.dressCodeNotes ?? ""); setEditing(true); }}>Edit</Button>}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {error && <Alert>{error}</Alert>}
      <Textarea value={value} onChange={(e) => setValue(e.target.value)} rows={3} placeholder="e.g. Smart casual allowed on Fridays; closed shoes required on-site" />
      <div className="flex gap-2">
        <Button
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await patch(`/departments/${d.id}/dress-code-notes`, { dressCodeNotes: value });
              setEditing(false);
              onSaved();
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Save
        </Button>
        <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
      </div>
    </div>
  );
}

export default function DepartmentsPage() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useApi<Dept[]>("/departments");
  const people = useApi<Person[]>("/employees");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const isHr = hasRole(user, "HR");

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
          <Table head={["Department", "Employees", "Head of Department", "Dress code notes"]}>
            {data?.map((d) => (
              <tr key={d.id}>
                <Td className="font-medium text-slate-900">{d.name}</Td>
                <Td className="tabular-nums">{d.employeeCount}</Td>
                <Td>
                  {isHr ? (
                    <Select value={d.hod?.id ?? ""} onChange={(e) => setHod(d, e.target.value)} className="w-64" aria-label={`HOD of ${d.name}`}>
                      <option value="">—</option>
                      {people.data?.map((p) => <option key={p.id} value={p.id}>{p.fullName} ({p.code})</option>)}
                    </Select>
                  ) : (
                    d.hod?.fullName ?? "—"
                  )}
                </Td>
                <Td className="min-w-[16rem]">
                  <DressCodeNotes d={d} canEdit={isHr || d.hod?.id === user?.id} onSaved={reload} />
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {isHr && (
        <Card title="Add department">
          <form onSubmit={add} className="flex flex-wrap items-end gap-3">
            {msg && <div className="w-full"><Alert>{msg}</Alert></div>}
            <Field label="Name"><Input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Button type="submit">Add</Button>
          </form>
        </Card>
      )}
    </div>
  );
}
