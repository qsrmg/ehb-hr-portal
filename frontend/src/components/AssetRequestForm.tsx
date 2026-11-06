"use client";

import { useState } from "react";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { post, put } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { todayYmd } from "@/lib/format";
import type { AssetCategory } from "@/lib/assets";

/** Ask for a company item: Line Manager → Admin; Admin then issues one from stock. */
export function AssetRequestForm({ onDone, requestId, initial }: { onDone: (id: number) => void; requestId?: number; initial?: { categoryId: number; reason: string; neededBy: string | null } }) {
  const { data: categories } = useApi<AssetCategory[]>("/assets/categories");
  const [form, setForm] = useState({ categoryId: initial ? String(initial.categoryId) : "", reason: initial?.reason ?? "", neededBy: initial?.neededBy ?? "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      const { id } = requestId ? await put<{ id: number }>(`/requests/${requestId}/resubmit`, fd) : await post<{ id: number }>("/requests/asset", fd);
      onDone(id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <Field label="What do you need?">
        <Select required value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
          <option value="">Choose…</option>
          {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>
      <Field label="Why do you need it?"><Textarea required value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. New joiner, or my laptop no longer holds a charge" /></Field>
      <Field label="Needed by (optional)"><Input type="date" min={todayYmd()} value={form.neededBy} onChange={(e) => setForm({ ...form, neededBy: e.target.value })} /></Field>
      <p className="text-xs text-slate-500">Goes to your Line Manager, then Admin. Once approved, Admin issues an item and you confirm receipt in My inventory.</p>
      <Button type="submit" loading={busy}>{requestId ? "Resubmit request" : "Submit request"}</Button>
    </form>
  );
}
