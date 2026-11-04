"use client";

import { useState } from "react";
import { Alert, Button, Card, Field, Input, PageHeader, Select, Spinner } from "@/components/ui";
import { post, put } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import type { ExpenseCategory } from "@/components/ExpenseForm";

type Setting = { key: string; label: string; value: string; default: string; optional: boolean };

function LimitsForm({ settings, onSaved }: { settings: Setting[]; onSaved: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(settings.map((s) => [s.key, s.value])));
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await put("/settings", values);
      setMsg({ kind: "success", text: "Saved. New claims are checked against these rules." });
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
          <Field key={s.key} label={s.label} hint={s.optional ? "Leave empty for no limit" : `Default: ${s.default}`}>
            <Input
              inputMode="decimal"
              value={values[s.key] ?? ""}
              placeholder={s.optional ? "No limit" : undefined}
              onChange={(e) => {
                setValues({ ...values, [s.key]: e.target.value });
                setMsg(null);
              }}
            />
          </Field>
        ))}
      </div>
      <Button type="submit" loading={busy}>Save rules</Button>
    </form>
  );
}

const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** One category as a small card: labelled fields that wrap to a single column on a phone. */
function CategoryCard({ category, onSaved }: { category: ExpenseCategory; onSaved: () => void }) {
  const [c, setC] = useState(category);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "saved" | "error"; text: string } | null>(null);
  const dirty = JSON.stringify(c) !== JSON.stringify(category);
  const edit = (patch: Partial<ExpenseCategory>) => {
    setC({ ...c, ...patch });
    setMsg(null);
  };
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await put(`/expenses/categories/${c.id}`, {
        name: c.name, accountingCode: c.accountingCode, monthlyLimit: c.monthlyLimit, allowanceWarning: c.allowanceWarning, active: c.active, sortOrder: c.sortOrder,
        scope: c.scope, coveredByPerDiem: c.coveredByPerDiem,
      });
      setMsg({ kind: "saved", text: "Saved" });
      onSaved();
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const local = c.scope === "LOCAL";
  return (
    <div className={`rounded-md p-3 ring-1 ring-slate-200 ${c.active ? "bg-white" : "bg-slate-50"}`}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(14rem,2fr)_minmax(10rem,1fr)_minmax(8rem,1fr)_minmax(9rem,1fr)_6rem]">
        <Field label="Name"><Input value={c.name} onChange={(e) => edit({ name: e.target.value })} /></Field>
        <Field label="Used for">
          <Select value={c.scope} onChange={(e) => edit({ scope: e.target.value as ExpenseCategory["scope"] })}>
            <option value="LOCAL">Expense Claim</option>
            <option value="TRAVEL">Trip settlement</option>
          </Select>
        </Field>
        <Field label="Accounting code"><Input value={c.accountingCode ?? ""} placeholder="Optional" onChange={(e) => edit({ accountingCode: e.target.value || null })} /></Field>
        {local ? (
          <Field label="Monthly limit (PKR)"><Input inputMode="decimal" value={c.monthlyLimit ?? ""} placeholder="No limit" onChange={(e) => edit({ monthlyLimit: numOrNull(e.target.value) })} /></Field>
        ) : (
          <div className="hidden lg:block" />
        )}
        <Field label="Order"><Input type="number" value={c.sortOrder} onChange={(e) => edit({ sortOrder: Number(e.target.value) })} /></Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        {local ? (
          <Check label="Salary allowance (warn and ask for a justification)" checked={c.allowanceWarning} onChange={(v) => edit({ allowanceWarning: v })} />
        ) : (
          <Check label="Covered by daily allowance" checked={c.coveredByPerDiem} onChange={(v) => edit({ coveredByPerDiem: v })} />
        )}
        <Check label="Active" checked={c.active} onChange={(v) => edit({ active: v })} />
        <div className="ml-auto flex items-center gap-3">
          {msg && <span role="status" className={`text-sm ${msg.kind === "saved" ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</span>}
          <Button size="sm" disabled={!dirty} loading={busy} onClick={save}>Save</Button>
        </div>
      </div>
    </div>
  );
}

export default function ExpenseSettingsPage() {
  const settings = useApi<Setting[]>("/settings");
  const categories = useApi<ExpenseCategory[]>("/expenses/categories?all=1");
  const [form, setForm] = useState({ name: "", accountingCode: "", scope: "LOCAL" });
  const [addError, setAddError] = useState<string | null>(null);
  const expenseSettings = settings.data?.filter((s) => s.key.startsWith("expense."));
  const travelSettings = settings.data?.filter((s) => s.key.startsWith("travel."));
  // Keyed by which settings exist (not their values), so saving does not rebuild the form and hide "Saved."
  const keyOf = (list: Setting[]) => list.map((s) => s.key).join(",");

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError(null);
    try {
      await post("/expenses/categories", { name: form.name, accountingCode: form.accountingCode || null, scope: form.scope, sortOrder: (categories.data?.length ?? 0) + 1 });
      setForm({ name: "", accountingCode: "", scope: form.scope });
      categories.reload();
    } catch (err) {
      setAddError((err as Error).message);
    }
  };

  const group = (scope: ExpenseCategory["scope"], title: string) => {
    const list = categories.data?.filter((c) => c.scope === scope) ?? [];
    return (
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-700">{title} <span className="font-normal text-slate-500">({list.length})</span></h3>
        {list.map((c) => <CategoryCard key={c.id} category={c} onSaved={categories.reload} />)}
        {!list.length && <p className="text-sm text-slate-500">No categories.</p>}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Expense & travel settings" subtitle="Limits, rates and categories for expense claims and travel. HR and Finance can change these; changes are recorded in the audit log." />
      <Card title="Expense Claim rules">
        {settings.loading ? <Spinner /> : settings.error ? <Alert>{settings.error}</Alert> : expenseSettings && (
          <LimitsForm key={keyOf(expenseSettings)} settings={expenseSettings} onSaved={settings.reload} />
        )}
      </Card>
      <Card title="Travel rules and rates">
        {settings.loading ? <Spinner /> : travelSettings && (
          <LimitsForm key={keyOf(travelSettings)} settings={travelSettings} onSaved={settings.reload} />
        )}
      </Card>
      <Card title="Categories">
        <p className="mb-4 text-sm text-slate-600">
          “Expense Claim” categories are for local expenses; “Trip settlement” categories are for business-trip costs. The monthly limit applies per employee per calendar month. “Salary allowance” is for costs already paid in salary (fuel, mobile): employees see a warning and must justify the claim. “Covered by daily allowance” travel costs (meals) cannot be claimed while a daily allowance rate is set. Untick “Active” to hide a category.
        </p>
        {categories.loading ? <Spinner /> : (
          <div className="space-y-6">
            {group("LOCAL", "Expense Claim")}
            {group("TRAVEL", "Trip settlement")}
          </div>
        )}
        <form onSubmit={add} className="mt-6 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2 lg:grid-cols-[minmax(14rem,2fr)_minmax(10rem,1fr)_minmax(10rem,1fr)_auto] lg:items-end">
          {addError && <div className="sm:col-span-2 lg:col-span-4"><Alert>{addError}</Alert></div>}
          <Field label="New category"><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Used for">
            <Select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}>
              <option value="LOCAL">Expense Claim</option>
              <option value="TRAVEL">Trip settlement</option>
            </Select>
          </Field>
          <Field label="Accounting code (optional)"><Input value={form.accountingCode} onChange={(e) => setForm({ ...form, accountingCode: e.target.value })} /></Field>
          <div><Button type="submit">Add category</Button></div>
        </form>
      </Card>
    </div>
  );
}
