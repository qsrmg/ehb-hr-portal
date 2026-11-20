"use client";

import { useState } from "react";
import { Alert, Button, Card, Field, Input, PageHeader, Select, Spinner, Table, Tabs, Td } from "@/components/ui";
import { MonthPicker } from "@/components/AttendanceMonth";
import { del, download, post } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { currentMonth, fmtDateTime } from "@/lib/format";

type Reports = { companyAverageActivePct: number | null; rows: { departmentId: number | null; departmentName: string; employeeCount: number; trackedEmployeeCount: number; averageActivePct: number | null }[] };
type Department = { id: number; name: string };
type EmployeeRow = { id: number; fullName: string; code: string };
type Exclusion = { employeeId: number; fullName: string; code: string; createdAt: string };
type Day = { date: string; trackedMinutes: number; activeMinutes: number; idleMinutes: number; activePct: number | null };
type EmployeeActivity = { employee: EmployeeRow; today: Day; days: Day[]; monthSummary: { trackedMinutes: number; activeMinutes: number; idleMinutes: number; activePct: number | null } };

const hm = (minutes: number) => `${Math.floor(minutes / 60)}h ${minutes % 60}m`;

function ReportsTab() {
  const [month, setMonth] = useState(currentMonth());
  const [departmentId, setDepartmentId] = useState("");
  const { data: departments } = useApi<Department[]>("/departments");
  const { data, loading, error } = useApi<Reports>(`/activity/reports?month=${month}${departmentId ? `&departmentId=${departmentId}` : ""}`);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <MonthPicker month={month} onChange={setMonth} />
          <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="!w-56" aria-label="Department">
            <option value="">All departments</option>
            {departments?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </div>
        <Button
          variant="secondary"
          onClick={() => download(`/activity/reports/export.csv?month=${month}${departmentId ? `&departmentId=${departmentId}` : ""}`, `activity-${month}.csv`)}
        >
          Export CSV
        </Button>
      </div>
      {loading ? <Spinner /> : error ? <Alert>{error}</Alert> : data && (
        <>
          <p className="text-sm text-slate-600">Company average Active % this month: <strong>{data.companyAverageActivePct == null ? "-" : `${data.companyAverageActivePct}%`}</strong></p>
          <Table head={["Department", "Employees", "Tracked", "Average Active %"]} empty="No activity data for this month.">
            {data.rows.map((r) => (
              <tr key={r.departmentId ?? "none"}>
                <Td>{r.departmentName}</Td>
                <Td>{r.employeeCount}</Td>
                <Td>{r.trackedEmployeeCount}</Td>
                <Td>{r.averageActivePct == null ? "-" : `${r.averageActivePct}%`}</Td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </div>
  );
}

function ExclusionsTab() {
  const { data, loading, error, reload } = useApi<Exclusion[]>("/activity/exclusions");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: results } = useApi<EmployeeRow[]>(q.trim().length >= 2 ? `/employees?q=${encodeURIComponent(q)}` : null);

  const exclude = async (employeeId: number) => {
    setBusy(true);
    try {
      await post("/activity/exclusions", { employeeId });
      setQ("");
      reload();
    } finally {
      setBusy(false);
    }
  };
  const include = async (employeeId: number) => {
    await del(`/activity/exclusions/${employeeId}`);
    reload();
  };

  return (
    <div className="space-y-4">
      <Field label="Exclude an employee from activity monitoring" hint="Search by name, code or email">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Start typing a name..." />
      </Field>
      {results && results.length > 0 && (
        <Table head={["Employee", ""]}>
          {results.filter((r) => !data?.some((d) => d.employeeId === r.id)).map((r) => (
            <tr key={r.id}>
              <Td><div className="font-medium text-slate-900">{r.fullName}</div><div className="text-xs text-slate-500">{r.code}</div></Td>
              <Td className="text-right"><Button size="sm" loading={busy} onClick={() => exclude(r.id)}>Exclude</Button></Td>
            </tr>
          ))}
        </Table>
      )}
      {loading ? <Spinner /> : error ? <Alert>{error}</Alert> : (
        <Table head={["Excluded employee", "Since", ""]} empty="No one is excluded.">
          {data?.map((e) => (
            <tr key={e.employeeId}>
              <Td><div className="font-medium text-slate-900">{e.fullName}</div><div className="text-xs text-slate-500">{e.code}</div></Td>
              <Td>{fmtDateTime(e.createdAt)}</Td>
              <Td className="text-right"><Button size="sm" variant="ghost" onClick={() => include(e.employeeId)}>Remove</Button></Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

function IndividualTab() {
  const [month, setMonth] = useState(currentMonth());
  const [q, setQ] = useState("");
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const { data: results } = useApi<EmployeeRow[]>(q.trim().length >= 2 && !employeeId ? `/employees?q=${encodeURIComponent(q)}` : null);
  const { data, loading, error } = useApi<EmployeeActivity>(employeeId ? `/activity/employee/${employeeId}?month=${month}` : null);

  return (
    <div className="space-y-4">
      <Alert kind="warning">Opening an individual employee&apos;s activity is recorded in the audit log.</Alert>
      <Field label="Find an employee">
        <Input
          value={employeeId ? `${data?.employee.fullName ?? ""}` : q}
          onChange={(e) => { setQ(e.target.value); setEmployeeId(null); }}
          placeholder="Start typing a name..."
        />
      </Field>
      {!employeeId && results && results.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-md border border-line">
          {results.map((r) => (
            <li key={r.id}>
              <button className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50" onClick={() => { setEmployeeId(r.id); setQ(""); }}>
                {r.fullName} <span className="text-xs text-slate-500">({r.code})</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {employeeId && (
        loading ? <Spinner /> : error ? <Alert>{error}</Alert> : data && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <MonthPicker month={month} onChange={setMonth} />
              <span className="text-sm text-slate-600">
                {hm(data.monthSummary.trackedMinutes)} tracked · {hm(data.monthSummary.activeMinutes)} active · {data.monthSummary.activePct == null ? "-" : `${data.monthSummary.activePct}%`} Active %
              </span>
            </div>
            <Table head={["Date", "Tracked", "Active", "Idle", "Active %"]} empty="No tracked days this month.">
              {data.days.filter((d) => d.trackedMinutes > 0).map((d) => (
                <tr key={d.date}>
                  <Td>{d.date}</Td>
                  <Td>{hm(d.trackedMinutes)}</Td>
                  <Td>{hm(d.activeMinutes)}</Td>
                  <Td>{hm(d.idleMinutes)}</Td>
                  <Td>{d.activePct == null ? "-" : `${d.activePct}%`}</Td>
                </tr>
              ))}
            </Table>
          </>
        )
      )}
    </div>
  );
}

export default function AdminActivityPage() {
  const [tab, setTab] = useState<"reports" | "exclusions" | "individual">("reports");
  return (
    <div className="space-y-6">
      <PageHeader title="Activity monitoring" subtitle="Tracked time and Active % across the company. Never used to judge the quality of anyone's work." />
      <Card>
        <Tabs value={tab} onChange={setTab} options={[{ value: "reports", label: "Reports" }, { value: "individual", label: "Individual" }, { value: "exclusions", label: "Excluded employees" }]} />
        {tab === "reports" && <ReportsTab />}
        {tab === "individual" && <IndividualTab />}
        {tab === "exclusions" && <ExclusionsTab />}
      </Card>
    </div>
  );
}
