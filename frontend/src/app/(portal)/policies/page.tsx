"use client";

import { useState } from "react";
import { Alert, Button, Card, Field, Input, PageHeader, Spinner, Table, Td } from "@/components/ui";
import { PolicyAcknowledgementsPanel } from "@/components/PolicyAcknowledgementsPanel";
import { del, download, post } from "@/lib/api";
import { hasRole, useAuth } from "@/lib/auth";
import { useApi } from "@/lib/useApi";
import { fmtDate } from "@/lib/format";

type Policy = {
  id: number; title: string; description: string | null; fileName: string; size: number; createdAt: string; uploadedBy: string;
  requiresAcknowledgement: boolean; acknowledgedAt: string | null;
};

export default function PoliciesPage() {
  const { user } = useAuth();
  const isHr = hasRole(user, "HR");
  const { data, loading, error, reload } = useApi<Policy[]>("/documents?category=POLICY");
  const [form, setForm] = useState({ title: "", description: "", requiresAcknowledgement: false });
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
      fd.append("category", "POLICY");
      fd.append("requiresAcknowledgement", String(form.requiresAcknowledgement));
      fd.append("file", file);
      await post("/documents", fd);
      setForm({ title: "", description: "", requiresAcknowledgement: false });
      setFile(null);
      (e.target as HTMLFormElement).reset();
      setMsg({ kind: "success", text: "Policy uploaded." });
      reload();
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: Policy) => {
    if (!confirm(`Delete "${p.title}"?`)) return;
    try {
      await del(`/documents/${p.id}`);
      reload();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const acknowledge = async (p: Policy) => {
    setAckBusy(p.id);
    try {
      await post(`/documents/${p.id}/acknowledge`, {});
      reload();
    } finally {
      setAckBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Policies"
        subtitle="Read, download and acknowledge company policies."
        actions={isHr && !uploadOpen ? <Button onClick={() => setUploadOpen(true)}>Upload policy</Button> : null}
      />
      {loading ? <Spinner /> : error ? <Alert>{error}</Alert> : (
        <Card title="Policies">
          <Table head={["Title", "Uploaded", ""]} empty="No policies have been uploaded yet.">
            {data?.map((p) => (
              <tr key={p.id}>
                <Td>
                  <div className="font-medium text-slate-900">{p.title}</div>
                  {p.description && <div className="text-xs text-slate-500">{p.description}</div>}
                  {p.requiresAcknowledgement && (
                    <div className="mt-1 text-xs">
                      {p.acknowledgedAt ? (
                        <span className="text-emerald-700">Acknowledged on {fmtDate(p.acknowledgedAt)}</span>
                      ) : (
                        <span className="text-amber-700">You need to acknowledge this policy</span>
                      )}
                    </div>
                  )}
                  {isHr && p.requiresAcknowledgement && <PolicyAcknowledgementsPanel policyKey={`document:${p.id}`} everyoneLabel="Everyone has acknowledged this policy." />}
                </Td>
                <Td className="text-slate-500">{fmtDate(p.createdAt)}</Td>
                <Td className="text-right">
                  <Button size="sm" variant="secondary" onClick={() => download(`/documents/${p.id}/download`, p.fileName)}>Download</Button>
                  {p.requiresAcknowledgement && !p.acknowledgedAt && (
                    <Button size="sm" loading={ackBusy === p.id} onClick={() => acknowledge(p)}>I have read this</Button>
                  )}
                  {isHr && <Button size="sm" variant="ghost-danger" onClick={() => remove(p)}>Delete</Button>}
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
      {isHr && uploadOpen && (
        <Card title="Upload a policy (HR)" actions={<Button variant="ghost" size="sm" onClick={() => setUploadOpen(false)}>Close</Button>}>
          <form onSubmit={upload} className="grid gap-4 sm:grid-cols-2">
            {msg && <div className="sm:col-span-2"><Alert kind={msg.kind}>{msg.text}</Alert></div>}
            <Field label="Title"><Input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
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
