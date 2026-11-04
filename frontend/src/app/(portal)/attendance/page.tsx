"use client";

import { useState } from "react";
import { Alert, Card, LinkButton, PageHeader, Spinner, Stat } from "@/components/ui";
import { AttendanceTable, MonthPicker, type MonthData } from "@/components/AttendanceMonth";
import { useApi } from "@/lib/useApi";
import { currentMonth, fmtDate } from "@/lib/format";

type MyAttendance = MonthData & {
  updateRequests: { used: number; max: number; windowDays: number };
  rules: { lateAfter: string; presentHours: string; halfDayHours: string };
};

export default function AttendancePage() {
  const [month, setMonth] = useState(currentMonth());
  const { data, loading, error } = useApi<MyAttendance>(`/attendance/me?month=${month}`);

  return (
    <div className="space-y-6">
      <PageHeader
        title="My attendance"
        subtitle={data ? `Late after ${data.rules.lateAfter} · ${data.rules.presentHours}+ hours Present · ${data.rules.halfDayHours} to under ${data.rules.presentHours} hours Half Day` : undefined}
        actions={<LinkButton href="/requests/new/attendance-update">Request attendance update</LinkButton>}
      />
      <MonthPicker month={month} onChange={setMonth} />
      {loading && <Spinner />}
      {error && <Alert>{error}</Alert>}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
            <Stat label="On time" value={data.summary.onTime} tone="green" />
            <Stat label="Late" value={data.summary.late} tone="amber" />
            <Stat label="Half day" value={data.summary.halfDay} tone="orange" />
            <Stat label="Absent" value={data.summary.absent} tone="red" />
            <Stat label="Leave" value={data.summary.leave} tone="sky" />
            <Stat label="On duty / Travel" value={data.summary.travel} tone="sky" />
          </div>
          <Alert kind="info">
            Attendance Update requests used this month: <strong>{data.updateRequests.used} of {data.updateRequests.max}</strong>. Requests must be made within {data.updateRequests.windowDays} days.
            {data.lastImported ? ` Biometric data imported up to ${fmtDate(data.lastImported)}.` : " No biometric data imported yet."}
          </Alert>
          <Card>
            <AttendanceTable data={data} fixLink={(date) => `/requests/new/attendance-update?date=${date}`} />
          </Card>
        </>
      )}
    </div>
  );
}
