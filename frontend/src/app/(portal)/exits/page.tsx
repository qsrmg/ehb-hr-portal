"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Field, Input, PageHeader, Select, Spinner, StatusBadge, Table, Tabs, Td, Textarea } from "@/components/ui";
import { hasRole, useAuth } from "@/lib/auth";
import { post } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { fmtDate, todayYmd } from "@/lib/format";

type ExitSummary = {
  id: number; type: string; typeLabel: string; status: string; lastWorkingDay: string; deactivated: boolean; createdAt: string;
  employee: { id: number; fullName: string; code: string; department: string | null };
  clearances: { area: string; label: string; status: string }[];
  waitingForMe: boolean;
};

type Option = { id: number; fullName: string; code: string };

const EXIT_TYPES: Record<string, string> = { RESIGNATION: "Resignation", TERMINATION: "Termination", END_OF_CONTRACT: "End of contract", OTHER: "Other" };

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
                <Td>{x.waitingForMe && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">Waiting for you</span>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
