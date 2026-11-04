"use client";

import { useState } from "react";
import { Alert, Button, Card, Field, Input, PageHeader, Select, Spinner, Table, Td } from "@/components/ui";
import { del, download, post } from "@/lib/api";
import { hasRole, useAuth } from "@/lib/auth";
import { useApi } from "@/lib/useApi";
import { fmtDate } from "@/lib/format";

type Doc = { id: number; title: string; description: string | null; category: "POLICY" | "HR_FORM"; fileName: string; size: number; createdAt: string; uploadedBy: string };

export default function DocumentsPage() {
  const { user } = useAuth();
  const isHr = hasRole(user, "HR");
  const { data, loading, error, reload } = useApi<Doc[]>("/documents");
  const [form, setForm] = useState({ title: "", description: "", category: "POLICY" });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const upload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      fd.append("file", file);
      await post("/documents", fd);
      setForm({ title: "", description: "", category: form.category });
      setFile(null);
      (e.target as HTMLFormElement).reset();
      setMsg({ kind: "success", text: "Document uploaded." });
      reload();
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (d: Doc) => {
    if (!confirm(`Delete "${d.title}"?`)) return;
    await del(`/documents/${d.id}`);
    reload();
  };

  const section = (category: Doc["category"], title: string) => (
    <Card title={title}>
      <Table head={["Title", "Uploaded", ""]} empty="Nothing here yet.">
        {data?.filter((d) => d.category === category).map((d) => (
          <tr key={d.id}>
            <Td>
              <div className="font-medium text-slate-900">{d.title}</div>
              {d.description && <div className="text-xs text-slate-500">{d.description}</div>}
            </Td>
            <Td className="text-slate-500">{fmtDate(d.createdAt)}</Td>
            <Td className="text-right">
              <Button size="sm" variant="secondary" onClick={() => download(`/documents/${d.id}/download`, d.fileName)}>Download</Button>
              {isHr && <Button size="sm" variant="ghost" className="text-red-600" onClick={() => remove(d)}>Delete</Button>}
            </Td>
          </tr>
        ))}
      </Table>
    </Card>
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Policies and HR forms" subtitle="Read and download company policies and HR forms." />
      {loading ? <Spinner /> : error ? <Alert>{error}</Alert> : (
        <>
          {section("POLICY", "Policies")}
          {section("HR_FORM", "HR forms")}
        </>
      )}
      {isHr && (
        <Card title="Upload a document (HR)">
          <form onSubmit={upload} className="grid gap-4 sm:grid-cols-2">
            {msg && <div className="sm:col-span-2"><Alert kind={msg.kind}>{msg.text}</Alert></div>}
            <Field label="Title"><Input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Category">
              <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                <option value="POLICY">Policy</option>
                <option value="HR_FORM">HR form</option>
              </Select>
            </Field>
            <Field label="Description (optional)"><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <Field label="PDF file"><Input type="file" accept=".pdf" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
            <div><Button type="submit" loading={busy}>Upload</Button></div>
          </form>
        </Card>
      )}
    </div>
  );
}
