"use client";

import { useState } from "react";
import { Alert, Button, Card, Field, Input, PageHeader, Spinner, Switch } from "@/components/ui";
import { put } from "@/lib/api";
import { useApi } from "@/lib/useApi";

type Setting = { key: string; label: string; value: string; default: string; boolean: boolean; hint: string | null };

const FIELD_LABEL_CLASS = "mb-1 block min-h-10 text-sm font-medium text-body";
/** "Default:" only when there is one to show (several settings default to empty = off). */
const hintFor = (s: Setting) => (s.boolean ? undefined : s.default ? `Default: ${s.default}` : s.hint ?? undefined);

// Groups follow the setting-key prefixes already in use (backend/src/lib/settings.ts); nothing is renamed or
// removed, this only decides which heading a key's fields sit under.
const GROUPS: { title: string; prefixes: string[] }[] = [
  { title: "Attendance", prefixes: ["attendance.", "attendanceUpdate."] },
  { title: "Approvals and reminders", prefixes: ["reminders.", "office."] },
  { title: "Pay slips", prefixes: ["payroll."] },
  { title: "Travel", prefixes: ["travel."] },
  { title: "Exit and resignation", prefixes: ["exit."] },
  { title: "Performance", prefixes: ["performance."] },
  { title: "Hiring", prefixes: ["hiring."] },
  { title: "Training", prefixes: ["training."] },
  { title: "Assets", prefixes: ["assets."] },
  { title: "Activity monitoring", prefixes: ["activity."] },
  { title: "Tasks", prefixes: ["tasks."] },
];

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

  const groups = GROUPS.map((g) => ({ ...g, items: settings.filter((s) => g.prefixes.some((p) => s.key.startsWith(p))) })).filter((g) => g.items.length);
  const grouped = new Set(groups.flatMap((g) => g.items.map((s) => s.key)));
  const other = settings.filter((s) => !grouped.has(s.key));

  return (
    <form onSubmit={save} className="space-y-8 pb-20">
      {[...groups, ...(other.length ? [{ title: "Other", items: other }] : [])].map((g) => (
        <div key={g.title}>
          <h2 className="mb-3 font-display text-sm font-bold uppercase tracking-wide text-slate-500">{g.title}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {g.items.map((s) => (
              <Field key={s.key} label={s.label} hint={hintFor(s)} labelClassName={FIELD_LABEL_CLASS}>
                {s.boolean ? (
                  <Switch checked={values[s.key] === "1"} onChange={(v) => setValues({ ...values, [s.key]: v ? "1" : "0" })} />
                ) : (
                  <Input value={values[s.key] ?? ""} onChange={(e) => setValues({ ...values, [s.key]: e.target.value })} />
                )}
              </Field>
            ))}
          </div>
        </div>
      ))}
      <div className="sticky bottom-0 -mx-4 -mb-4 flex flex-wrap items-center gap-3 rounded-b-xl border-t border-line bg-white/95 px-4 py-3 backdrop-blur">
        <Button type="submit" loading={busy}>Save settings</Button>
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      </div>
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
    <div className="space-y-6">
      <PageHeader title="Rules and settings" subtitle="HR can change these rules without new development. Changes are recorded in the audit log." />
      <Card>
        <SettingsForm settings={data} onSaved={reload} />
      </Card>
    </div>
  );
}
