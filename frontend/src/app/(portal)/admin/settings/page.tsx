"use client";

import { useState } from "react";
import { Alert, Button, Card, Field, Input, PageHeader, Spinner } from "@/components/ui";
import { put } from "@/lib/api";
import { useApi } from "@/lib/useApi";

type Setting = { key: string; label: string; value: string; default: string };

function SettingsForm({ settings, onSaved }: { settings: Setting[]; onSaved: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(settings.map((s) => [s.key, s.value])));
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await put("/settings", values);
      setMsg({ kind: "success", text: "Settings saved. New attendance imports and requests use the new rules." });
      onSaved();
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-4">
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        {settings.map((s) => (
          <Field key={s.key} label={s.label} hint={`Default: ${s.default}`}>
            <Input value={values[s.key] ?? ""} onChange={(e) => setValues({ ...values, [s.key]: e.target.value })} />
          </Field>
        ))}
      </div>
      <Button type="submit" loading={busy}>Save settings</Button>
    </form>
  );
}

export default function SettingsPage() {
  const { data: all, loading, error, reload } = useApi<Setting[]>("/settings");
  if (loading) return <Spinner />;
  if (error || !all) return <Alert>{error}</Alert>;
  // Expense limits live on their own page, shared with Finance.
  const data = all.filter((s) => !s.key.startsWith("expense."));
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Rules and settings" subtitle="HR can change these rules without new development. Changes are recorded in the audit log." />
      <Card>
        <SettingsForm settings={data} onSaved={reload} />
      </Card>
    </div>
  );
}
