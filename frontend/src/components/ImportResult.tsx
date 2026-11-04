"use client";

import { useState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { post } from "@/lib/api";

/** File picker + upload button for the Excel / CSV imports. */
export function ImportForm<T>({ path, extra, onDone, label = "Import", children }: {
  path: string;
  extra?: Record<string, string>;
  onDone: (result: T) => void;
  label?: string;
  children?: React.ReactNode;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      Object.entries(extra ?? {}).forEach(([k, v]) => fd.append(k, v));
      fd.append("file", file);
      onDone(await post<T>(path, fd));
      (e.target as HTMLFormElement).reset();
      setFile(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap items-end gap-3">
        {children}
        <Field label="Excel (.xlsx) or CSV file" className="min-w-64 flex-1">
          <Input type="file" accept=".xlsx,.csv" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
        <Button type="submit" loading={busy}>{label}</Button>
      </div>
    </form>
  );
}
