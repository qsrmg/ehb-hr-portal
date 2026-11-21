"use client";

import { useState } from "react";
import { Alert, Button, Card, Field, Input, PageHeader, Select, Spinner, Table, Td } from "@/components/ui";
import { PolicyAcknowledgementsPanel } from "@/components/PolicyAcknowledgementsPanel";
import { del, download, post } from "@/lib/api";
import { hasRole, useAuth } from "@/lib/auth";
import { useApi } from "@/lib/useApi";
import { fmtDate } from "@/lib/format";

type Doc = {
  id: number; title: string; description: string | null; category: "POLICY" | "HR_FORM"; fileName: string; size: number; createdAt: string; uploadedBy: string;
  requiresAcknowledgement: boolean; acknowledgedAt: string | null;
};

export default function DocumentsPage() {
  const { user } = useAuth();
  const isHr = hasRole(user, "HR");
  const { data, loading, error, reload } = useApi<Doc[]>("/documents");
  const [form, setForm] = useState({ title: "", description: "", category: "POLICY", requiresAcknowledgement: false });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [ackBusy, setAckBusy] = useState<number | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const upload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("title", form.title);
      fd.append("description", form.description);
      fd.append("category", form.category);
      fd.append("requiresAcknowledgement", String(form.requiresAcknowledgement));
      fd.append("file", file);
      await post("/documents", fd);
      setForm({ title: "", description: "", category: form.category, requiresAcknowledgement: false });
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
    try {
      await del(`/documents/${d.id}`);
      reload();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const acknowledge = async (d: Doc) => {
    setAckBusy(d.id);
    try {
      await post(`/documents/${d.id}/acknowledge`, {});
      reload();
    } finally {
      setAckBusy(null);
    }
  };

  const section = (category: Doc["category"], title: string) => (
    <Card title={title}>
      <Table head={["Title", "Uploaded", ""]} empty="Nothing here yet.">
        {data?.filter((d) => d.category === category).map((d) => (
          <tr key={d.id}>
            <Td>
              <div className="font-medium text-slate-900">{d.title}</div>
              {d.description && <div className="text-xs text-slate-500">{d.description}</div>}
              {d.requiresAcknowledgement && (
                <div className="mt-1 text-xs">
                  {d.acknowledgedAt ? (
                    <span className="text-emerald-700">Acknowledged on {fmtDate(d.acknowledgedAt)}</span>
                  ) : (
                    <span className="text-amber-700">You need to acknowledge this document</span>
                  )}
                </div>
              )}
              {isHr && d.requiresAcknowledgement && <PolicyAcknowledgementsPanel policyKey={`document:${d.id}`} everyoneLabel="Everyone has acknowledged this document." />}
            </Td>
            <Td className="text-slate-500">{fmtDate(d.createdAt)}</Td>
            <Td className="text-right">
              <Button size="sm" variant="secondary" onClick={() => download(`/documents/${d.id}/download`, d.fileName)}>Download</Button>
              {d.requiresAcknowledgement && !d.acknowledgedAt && (
                <Button size="sm" loading={ackBusy === d.id} onClick={() => acknowledge(d)}>I have read this</Button>
              )}
              {isHr && <Button size="sm" variant="ghost-danger" onClick={() => remove(d)}>Delete</Button>}
            </Td>
          </tr>
        ))}
      </Table>
    </Card>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Policies and HR forms"
        subtitle="Read and download company policies and HR forms."
        actions={isHr && !uploadOpen ? <Button onClick={() => setUploadOpen(true)}>Upload document</Button> : null}
      />
      {loading ? <Spinner /> : error ? <Alert>{error}</Alert> : (
        <>
          {section("POLICY", "Policies")}
          {section("HR_FORM", "HR forms")}
        </>
      )}
      {isHr && uploadOpen && (
        <Card title="Upload a document (HR)" actions={<Button variant="ghost" size="sm" onClick={() => setUploadOpen(false)}>Close</Button>}>
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
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={form.requiresAcknowledgement} onChange={(e) => setForm({ ...form, requiresAcknowledgement: e.target.checked })} />
              Require every employee to acknowledge they have read this
            </label>
            <div><Button type="submit" loading={busy}>Upload</Button></div>
          </form>
        </Card>
      )}
    </div>
  );
}
