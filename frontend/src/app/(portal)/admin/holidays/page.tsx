"use client";

import { useState } from "react";
import { Alert, Button, Card, Field, Input, PageHeader, Spinner, Table, Td } from "@/components/ui";
import { del, post } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { fmtDate } from "@/lib/format";

type Holiday = { id: number; date: string; name: string };

export default function HolidaysPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const { data, loading, error, reload } = useApi<Holiday[]>(`/holidays?year=${year}`);
  const [form, setForm] = useState({ date: "", name: "" });
  const [msg, setMsg] = useState<string | null>(null);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      await post("/holidays", form);
      setForm({ date: "", name: "" });
      reload();
    } catch (err) {
      setMsg((err as Error).message);
    }
  };

  const remove = async (h: Holiday) => {
    if (!confirm(`Remove ${h.name}?`)) return;
    await del(`/holidays/${h.id}`);
    reload();
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Holiday calendar" subtitle="Public holidays are skipped when counting leave days and attendance." />
      <Card
        title={`Holidays ${year}`}
        actions={
          <>
            <Button size="sm" variant="secondary" onClick={() => setYear(year - 1)}>←</Button>
            <Button size="sm" variant="secondary" onClick={() => setYear(year + 1)}>→</Button>
          </>
        }
      >
        {loading ? <Spinner /> : error ? <Alert>{error}</Alert> : (
          <Table head={["Date", "Day", "Holiday", ""]} empty="No holidays for this year.">
            {data?.map((h) => (
              <tr key={h.id}>
                <Td>{fmtDate(h.date)}</Td>
                <Td className="text-slate-500">{new Date(`${h.date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" })}</Td>
                <Td className="font-medium text-slate-900">{h.name}</Td>
                <Td className="text-right"><Button size="sm" variant="ghost" className="text-red-600" onClick={() => remove(h)}>Remove</Button></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Card title="Add holiday">
        <form onSubmit={add} className="flex flex-wrap items-end gap-3">
          {msg && <div className="w-full"><Alert>{msg}</Alert></div>}
          <Field label="Date"><Input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
          <Field label="Name" className="min-w-64 flex-1"><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Eid ul Fitr" /></Field>
          <Button type="submit">Add</Button>
        </form>
        <p className="mt-2 text-xs text-slate-500">Add the moon-sighted holidays (Eid, Muharram, 12 Rabi-ul-Awal) once announced.</p>
      </Card>
    </div>
  );
}
