"use client";

import { useState } from "react";
import { Alert, Button, Card, Field, Input, PageHeader, Spinner, Table, Td } from "@/components/ui";
import { del, download, post } from "@/lib/api";
import { hasRole, useAuth } from "@/lib/auth";
import { useApi } from "@/lib/useApi";
import { fmtDate } from "@/lib/format";

type Form = {
  id: number; title: string; description: string | null; fileName: string; size: number; createdAt: string; uploadedBy: string;
};

export default function HrFormsPage() {
  const { user } = useAuth();
  const isHr = hasRole(user, "HR");
  const { data, loading, error, reload } = useApi<Form[]>("/documents?category=HR_FORM");
  const [form, setForm] = useState({ title: "", description: "" });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
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
      fd.append("category", "HR_FORM");
      fd.append("file", file);
      await post("/documents", fd);
      setForm({ title: "", description: "" });
      setFile(null);
      (e.target as HTMLFormElement).reset();
      setMsg({ kind: "success", text: "Form uploaded." });
      reload();
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (d: Form) => {
    if (!confirm(`Delete "${d.title}"?`)) return;
    try {
      await del(`/documents/${d.id}`);
      reload();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="HR forms"
        subtitle="Download HR forms."
        actions={isHr && !uploadOpen ? <Button onClick={() => setUploadOpen(true)}>Upload form</Button> : null}
      />
      {loading ? <Spinner /> : error ? <Alert>{error}</Alert> : (
        <Card title="HR forms">
          <Table head={["Title", "Uploaded", ""]} empty="No HR forms have been uploaded yet.">
            {data?.map((d) => (
              <tr key={d.id}>
                <Td>
                  <div className="font-medium text-slate-900">{d.title}</div>
                  {d.description && <div className="text-xs text-slate-500">{d.description}</div>}
                </Td>
                <Td className="text-slate-500">{fmtDate(d.createdAt)}</Td>
                <Td className="text-right">
                  <Button size="sm" variant="secondary" onClick={() => download(`/documents/${d.id}/download`, d.fileName)}>Download</Button>
                  {isHr && <Button size="sm" variant="ghost-danger" onClick={() => remove(d)}>Delete</Button>}
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
      {isHr && uploadOpen && (
        <Card title="Upload a form (HR)" actions={<Button variant="ghost" size="sm" onClick={() => setUploadOpen(false)}>Close</Button>}>
          <form onSubmit={upload} className="grid gap-4 sm:grid-cols-2">
            {msg && <div className="sm:col-span-2"><Alert kind={msg.kind}>{msg.text}</Alert></div>}
            <Field label="Title"><Input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Description (optional)"><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <Field label="PDF file"><Input type="file" accept=".pdf" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
            <div><Button type="submit" loading={busy}>Upload</Button></div>
          </form>
        </Card>
      )}
    </div>
  );
}
