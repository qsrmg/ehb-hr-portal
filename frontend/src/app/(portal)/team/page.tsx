"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert, Button, Card, Input, PageHeader, Spinner, StatusBadge, Table, Tabs, Td } from "@/components/ui";
import { AttendanceTable, MonthPicker, type MonthData } from "@/components/AttendanceMonth";
import { TeamAssets } from "@/components/AssetPanels";
import { post } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { currentMonth, fmtDate, todayYmd } from "@/lib/format";
import type { Profile } from "@/lib/types";

type Daily = { date: string; lastImported: string | null; rows: { employeeId: number; code: string; fullName: string; designation: string | null; department: string | null; status: string; leaveType: string | null; checkIn: string | null; checkOut: string | null }[] };
type LeaveRow = { requestId: number; status: string; employee: { id: number; fullName: string; code: string }; leaveType: string; startDate: string; endDate: string; days: number };

/** Shown only when the team member's probation is due: a note to HR before they confirm or extend it. */
function ProbationDueNote({ employeeId }: { employeeId: number }) {
  const { data: emp, reload } = useApi<Profile>(`/employees/${employeeId}`);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  if (!emp || emp.probationStatus !== "DUE") return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await post(`/employees/${employeeId}/probation-note`, { comment });
      setComment("");
      setMsg({ kind: "success", text: "Note sent to HR." });
      reload();
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-md bg-amber-50 p-3 ring-1 ring-amber-200">
      <p className="text-sm text-amber-900">
        <StatusBadge status="DUE" /> {emp.fullName}&apos;s probation ended {fmtDate(emp.probationEndDate)}. HR will confirm their employment or extend probation; you can leave an optional note for HR first — this is not an approval step.
      </p>
      {emp.probationHistory?.notes.map((n) => (
        <p key={n.id} className="mt-2 text-xs text-amber-800">Your note ({fmtDate(n.at)}): {n.comment}</p>
      ))}
      <form onSubmit={submit} className="mt-2 flex flex-wrap gap-2">
        <Input placeholder="Optional note for HR" value={comment} onChange={(e) => setComment(e.target.value)} className="flex-1" aria-label="Note for HR" />
        <Button size="sm" type="submit" loading={busy} disabled={!comment.trim()}>Send</Button>
      </form>
      {msg && <p className={`mt-1 text-xs ${msg.kind === "success" ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</p>}
    </div>
  );
}

export default function TeamPage() {
  const [tab, setTab] = useState<"today" | "leave" | "member" | "assets">("today");
  const [date, setDate] = useState(todayYmd());
  const [month, setMonth] = useState(currentMonth());
  const [memberId, setMemberId] = useState<number | null>(null);
  const daily = useApi<Daily>(`/attendance/daily?date=${date}`);
  const leave = useApi<LeaveRow[]>(tab === "leave" ? `/leave/calendar?month=${month}` : null);
  const member = useApi<MonthData & { employee: { fullName: string; code: string } }>(memberId ? `/attendance/employee/${memberId}?month=${month}` : null);

  const counts = daily.data?.rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});

  return (
    <div className="space-y-6">
      <PageHeader title="Team" subtitle="Work information for your team: attendance and leave." />
      <Card>
        <Tabs
          value={tab}
          onChange={setTab}
          options={[{ value: "today", label: "Attendance by day" }, { value: "leave", label: "Leave calendar" }, { value: "assets", label: "Assets" }, ...(memberId ? [{ value: "member" as const, label: member.data?.employee.fullName ?? "Employee" }] : [])]}
        />
        {tab === "today" && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" aria-label="Date" />
              {counts && Object.entries(counts).map(([s, n]) => <span key={s} className="text-sm text-slate-600"><StatusBadge status={s} /> {n}</span>)}
            </div>
            {daily.data?.lastImported && date > daily.data.lastImported && <Alert kind="info">Biometric data is imported up to {fmtDate(daily.data.lastImported)}.</Alert>}
            {daily.loading ? <Spinner /> : daily.error ? <Alert>{daily.error}</Alert> : (
              <Table head={["Employee", "Department", "Check in", "Check out", "Status", ""]} empty="No team members.">
                {daily.data?.rows.map((r) => (
                  <tr key={r.employeeId}>
                    <Td><div className="font-medium text-slate-900">{r.fullName}</div><div className="text-xs text-slate-500">{r.code} · {r.designation}</div></Td>
                    <Td>{r.department}</Td>
                    <Td className="tabular-nums">{r.checkIn ?? "—"}</Td>
                    <Td className="tabular-nums">{r.checkOut ?? "—"}</Td>
                    <Td><StatusBadge status={r.status} />{r.leaveType && <span className="ml-2 text-xs text-slate-500">{r.leaveType}</span>}</Td>
                    <Td><button className="text-xs text-accent hover:underline" onClick={() => { setMemberId(r.employeeId); setTab("member"); }}>Month view</button></Td>
                  </tr>
                ))}
              </Table>
            )}
          </div>
        )}
        {tab === "leave" && (
          <div className="space-y-4">
            <MonthPicker month={month} onChange={setMonth} />
            {leave.loading ? <Spinner /> : (
              <Table head={["Employee", "Leave", "From", "To", "Days", "Status"]} empty="No leave this month.">
                {leave.data?.map((l) => (
                  <tr key={l.requestId}>
                    <Td><div className="font-medium text-slate-900">{l.employee.fullName}</div><div className="text-xs text-slate-500">{l.employee.code}</div></Td>
                    <Td><Link href={`/requests/${l.requestId}`} className="text-accent hover:underline">{l.leaveType}</Link></Td>
                    <Td>{fmtDate(l.startDate)}</Td>
                    <Td>{fmtDate(l.endDate)}</Td>
                    <Td className="tabular-nums">{l.days}</Td>
                    <Td><StatusBadge status={l.status} /></Td>
                  </tr>
                ))}
              </Table>
            )}
          </div>
        )}
        {tab === "assets" && <TeamAssets />}
        {tab === "member" && memberId && (
          <div className="space-y-4">
            <MonthPicker month={month} onChange={setMonth} />
            {member.loading ? <Spinner /> : member.error ? <Alert>{member.error}</Alert> : member.data && (
              <>
                <ProbationDueNote employeeId={memberId} />
                <p className="text-sm text-slate-600">
                  {member.data.employee.fullName} ({member.data.employee.code}): {member.data.summary.onTime} on time · {member.data.summary.late} late · {member.data.summary.halfDay} half day · {member.data.summary.absent} absent · {member.data.summary.leave} leave
                </p>
                <AttendanceTable data={member.data} />
              </>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
