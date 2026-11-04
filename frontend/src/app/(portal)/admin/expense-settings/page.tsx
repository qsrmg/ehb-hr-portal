"use client";

import { useState } from "react";
import { Alert, Button, Card, Field, Input, PageHeader, Select, Spinner, Table, Td } from "@/components/ui";
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
            <Input inputMode="decimal" value={values[s.key] ?? ""} placeholder={s.optional ? "No limit" : undefined} onChange={(e) => setValues({ ...values, [s.key]: e.target.value })} />
          </Field>
        ))}
      </div>
      <Button type="submit" loading={busy}>Save rules</Button>
    </form>
  );
}

const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

function CategoryRow({ category, onSaved }: { category: ExpenseCategory; onSaved: () => void }) {
  const [c, setC] = useState(category);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dirty = JSON.stringify(c) !== JSON.stringify(category);
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await put(`/expenses/categories/${c.id}`, {
        name: c.name, accountingCode: c.accountingCode, monthlyLimit: c.monthlyLimit, allowanceWarning: c.allowanceWarning, active: c.active, sortOrder: c.sortOrder,
        scope: c.scope, coveredByPerDiem: c.coveredByPerDiem,
      });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <tr className={c.active ? undefined : "bg-slate-50"}>
      <Td><Input value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} className="w-52" />{err && <div className="mt-1 text-xs text-red-600">{err}</div>}</Td>
      <Td>
        <Select value={c.scope} onChange={(e) => setC({ ...c, scope: e.target.value as ExpenseCategory["scope"] })} className="w-36" aria-label={`${c.name}: used for`}>
          <option value="LOCAL">Expense Claim</option>
          <option value="TRAVEL">Trip settlement</option>
        </Select>
      </Td>
      <Td><Input value={c.accountingCode ?? ""} placeholder="—" onChange={(e) => setC({ ...c, accountingCode: e.target.value || null })} className="w-28" /></Td>
      <Td><Input inputMode="decimal" value={c.monthlyLimit ?? ""} placeholder="No limit" onChange={(e) => setC({ ...c, monthlyLimit: numOrNull(e.target.value) })} className="w-32" /></Td>
      <Td className="text-center"><input type="checkbox" checked={c.allowanceWarning} onChange={(e) => setC({ ...c, allowanceWarning: e.target.checked })} aria-label={`${c.name}: salary allowance warning`} /></Td>
      <Td className="text-center">
        {c.scope === "TRAVEL" && <input type="checkbox" checked={c.coveredByPerDiem} onChange={(e) => setC({ ...c, coveredByPerDiem: e.target.checked })} aria-label={`${c.name}: covered by daily allowance`} />}
      </Td>
      <Td className="text-center"><input type="checkbox" checked={c.active} onChange={(e) => setC({ ...c, active: e.target.checked })} aria-label={`${c.name}: active`} /></Td>
      <Td><Input type="number" value={c.sortOrder} onChange={(e) => setC({ ...c, sortOrder: Number(e.target.value) })} className="w-20" /></Td>
      <Td><Button size="sm" disabled={!dirty} loading={busy} onClick={save}>Save</Button></Td>
    </tr>
  );
}

export default function ExpenseSettingsPage() {
  const settings = useApi<Setting[]>("/settings");
  const categories = useApi<ExpenseCategory[]>("/expenses/categories?all=1");
  const [form, setForm] = useState({ name: "", accountingCode: "", scope: "LOCAL" });
  const [addError, setAddError] = useState<string | null>(null);
  const expenseSettings = settings.data?.filter((s) => s.key.startsWith("expense."));
  const travelSettings = settings.data?.filter((s) => s.key.startsWith("travel."));

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

  return (
    <div className="space-y-6">
      <PageHeader title="Expense & travel settings" subtitle="Limits, rates and categories for expense claims and travel. HR and Finance can change these; changes are recorded in the audit log." />
      <Card title="Expense Claim rules">
        {settings.loading ? <Spinner /> : settings.error ? <Alert>{settings.error}</Alert> : expenseSettings && (
          <LimitsForm key={JSON.stringify(expenseSettings)} settings={expenseSettings} onSaved={settings.reload} />
        )}
      </Card>
      <Card title="Travel rules and rates">
        {settings.loading ? <Spinner /> : travelSettings && (
          <LimitsForm key={JSON.stringify(travelSettings)} settings={travelSettings} onSaved={settings.reload} />
        )}
      </Card>
      <Card title="Categories">
        <p className="mb-3 text-sm text-slate-600">
          “Expense Claim” categories are for local expenses; “Trip settlement” categories are for business-trip costs. The monthly limit applies per employee per calendar month (Expense Claim). Tick “Salary allowance” for costs already paid in salary (fuel, mobile): employees then see a warning and must justify the claim. Tick “Covered by daily allowance” for travel costs (meals) that cannot be claimed while a daily allowance rate is set. Untick “Active” to hide a category.
        </p>
        {categories.loading ? <Spinner /> : (
          <Table head={["Name", "Used for", "Accounting code", "Monthly limit (PKR)", "Salary allowance", "Covered by daily allowance", "Active", "Order", ""]}>
            {categories.data?.map((c) => <CategoryRow key={`${c.id}-${JSON.stringify(c)}`} category={c} onSaved={categories.reload} />)}
          </Table>
        )}
        <form onSubmit={add} className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
          {addError && <div className="w-full"><Alert>{addError}</Alert></div>}
          <Field label="New category"><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Used for">
            <Select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}>
              <option value="LOCAL">Expense Claim</option>
              <option value="TRAVEL">Trip settlement</option>
            </Select>
          </Field>
          <Field label="Accounting code (optional)"><Input value={form.accountingCode} onChange={(e) => setForm({ ...form, accountingCode: e.target.value })} /></Field>
          <Button type="submit">Add category</Button>
        </form>
      </Card>
    </div>
  );
}
