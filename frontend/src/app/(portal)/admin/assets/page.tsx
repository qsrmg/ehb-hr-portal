"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Field, Input, PageHeader, Select, Spinner, StatusBadge, Table, Tabs, Td } from "@/components/ui";
import { ImportForm } from "@/components/ImportResult";
import { download, post, put } from "@/lib/api";
import { hasRole, useAuth } from "@/lib/auth";
import { useApi } from "@/lib/useApi";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";
import { CONDITIONS, INCIDENT_TYPES, type AssetCategory } from "@/lib/assets";

type Row = { id: number; tag: string; name: string; category: string; kind: string; serialNumber: string | null; status: string; condition: string; warrantyUntil: string | null; cost?: number | null; holder: string | null; awaitingConfirmation: boolean };
type IncidentRow = { id: number; type: string; status: string; description: string; createdAt: string; employee: { fullName: string; code: string } | null; reportedBy: string; recoveryAmount: number | null; recoveryNote: string | null; asset: { id: number; tag: string; name: string; category: string } };
type RequestRow = { requestId: number; employee: { fullName: string; code: string }; category: { name: string }; reason: string; neededBy: string | null; approvedAt: string };
type ImportResult = { rowsRead: number; created: { tag: string; name: string; assignedTo: string | null }[]; skipped: { row: number; reason: string }[] };
type View = "register" | "awaiting" | "requests" | "incidents" | "recoveries" | "categories" | "import";

function Register({ view, isAdmin }: { view: "register" | "awaiting"; isAdmin: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const categories = useApi<AssetCategory[]>("/assets/categories");
  const params = new URLSearchParams({ view: view === "awaiting" ? "awaiting" : "all", q, status, categoryId });
  const { data, loading, error } = useApi<Row[]>(`/assets?${params}`);
  const [form, setForm] = useState({ categoryId: "", name: "", tag: "", serialNumber: "", purchaseDate: "", cost: "", warrantyUntil: "", condition: "GOOD", storageLocation: "" });
  const [showAdd, setShowAdd] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const showCost = !!data?.some((r) => r.cost !== undefined);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError(null);
    try {
      const created = await post<{ id: number }>("/assets", { ...form, categoryId: Number(form.categoryId) });
      router.push(`/admin/assets/${created.id}`);
    } catch (err) {
      setAddError((err as Error).message);
    }
  };
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="space-y-4">
      {view === "register" && isAdmin && (
        <div>
          <Button variant="secondary" onClick={() => setShowAdd(!showAdd)}>{showAdd ? "Close" : "Add an asset"}</Button>
          {showAdd && (
            <form onSubmit={add} className="mt-3 grid gap-3 rounded-md p-3 ring-1 ring-slate-200 sm:grid-cols-2 lg:grid-cols-3">
              {addError && <div className="sm:col-span-2 lg:col-span-3"><Alert>{addError}</Alert></div>}
              <Field label="Category">
                <Select required value={form.categoryId} onChange={set("categoryId")}>
                  <option value="">Choose…</option>
                  {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="Name (make / model, or account)"><Input required value={form.name} onChange={set("name")} /></Field>
              <Field label="Tag" hint="Leave empty to generate EHB-AST-…"><Input value={form.tag} onChange={set("tag")} /></Field>
              <Field label="Serial number / account"><Input value={form.serialNumber} onChange={set("serialNumber")} /></Field>
              <Field label="Purchase date"><Input type="date" value={form.purchaseDate} onChange={set("purchaseDate")} /></Field>
              <Field label="Cost (PKR)"><Input type="number" min="0" step="0.01" value={form.cost} onChange={set("cost")} /></Field>
              <Field label="Warranty until"><Input type="date" value={form.warrantyUntil} onChange={set("warrantyUntil")} /></Field>
              <Field label="Condition">
                <Select value={form.condition} onChange={set("condition")}>
                  {Object.entries(CONDITIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
              <Field label="Storage location"><Input value={form.storageLocation} onChange={set("storageLocation")} placeholder="e.g. IT store" /></Field>
              <div><Button type="submit">Add asset</Button></div>
            </form>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Input placeholder="Search tag, name or serial" value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />
        <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-48" aria-label="Category">
          <option value="">All categories</option>
          {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        {view === "register" && (
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40" aria-label="Status">
            <option value="">All statuses</option>
            {["IN_STOCK", "ISSUED", "IN_REPAIR", "LOST", "RETIRED"].map((s) => <option key={s} value={s}>{s.replace("_", " ").toLowerCase()}</option>)}
          </Select>
        )}
      </div>
      {loading ? <Spinner /> : error ? <Alert>{error}</Alert> : (
        <Table head={["Tag", "Item", "Category", "Status", "With", "Warranty", ...(showCost ? ["Cost"] : [])]} empty="No assets match.">
          {data?.map((r) => (
            <tr key={r.id} className="hover:bg-slate-50">
              <Td className="font-mono text-xs"><Link href={`/admin/assets/${r.id}`} className="text-accent hover:underline">{r.tag}</Link></Td>
              <Td className="whitespace-normal"><div className="min-w-40 font-medium text-slate-900">{r.name}</div>{r.serialNumber && <div className="text-xs text-slate-500">{r.serialNumber}</div>}</Td>
              <Td>{r.category}</Td>
              <Td><StatusBadge status={r.status} />{r.condition === "DAMAGED" && <span className="ml-1 text-xs text-red-700">damaged</span>}</Td>
              <Td className="whitespace-normal">{r.holder ?? "—"}{r.awaitingConfirmation && <div className="text-xs text-amber-800">awaiting confirmation</div>}</Td>
              <Td>{r.warrantyUntil ? fmtDate(r.warrantyUntil) : "—"}</Td>
              {showCost && <Td className="tabular-nums">{r.cost != null ? fmtMoney(r.cost) : "—"}</Td>}
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

function Incidents({ view }: { view: "open" | "recoveries" }) {
  const { data, loading, error } = useApi<IncidentRow[]>(`/assets/incidents?view=${view}`);
  const total = data?.reduce((s, i) => s + (i.recoveryAmount ?? 0), 0) ?? 0;
  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  return (
    <div className="space-y-3">
      {view === "recoveries" && data && data.length > 0 && <p className="text-sm text-slate-600">PKR {fmtMoney(total)} to recover in final settlements. Open an item for details.</p>}
      <Table head={["When", "Item", "Employee", "Problem", "Status", ...(view === "recoveries" ? ["Recovery"] : [])]} empty={view === "open" ? "No open reports." : "No recoveries set."}>
        {data?.map((i) => (
          <tr key={i.id} className="align-top hover:bg-slate-50">
            <Td>{fmtDateTime(i.createdAt)}</Td>
            <Td><Link href={`/admin/assets/${i.asset.id}`} className="text-accent hover:underline">{i.asset.name}</Link><div className="font-mono text-xs text-slate-500">{i.asset.tag}</div></Td>
            <Td>{i.employee ? `${i.employee.fullName} (${i.employee.code})` : "—"}</Td>
            <Td className="whitespace-normal"><div className="min-w-48">{INCIDENT_TYPES[i.type]}: {i.description}</div><div className="text-xs text-slate-500">by {i.reportedBy}</div></Td>
            <Td><StatusBadge status={i.status} /></Td>
            {view === "recoveries" && <Td className="tabular-nums">PKR {fmtMoney(i.recoveryAmount)}<div className="text-xs text-slate-500">{i.recoveryNote}</div></Td>}
          </tr>
        ))}
      </Table>
    </div>
  );
}

function Requests() {
  const { data, loading } = useApi<RequestRow[]>("/assets/requests");
  if (loading) return <Spinner />;
  return (
    <Table head={["Request", "Employee", "Needs", "Reason", "Needed by", "Approved"]} empty="No approved requests waiting for an item.">
      {data?.map((r) => (
        <tr key={r.requestId}>
          <Td><Link href={`/requests/${r.requestId}`} className="text-accent hover:underline">#{r.requestId} · Issue an item</Link></Td>
          <Td>{r.employee.fullName}<div className="text-xs text-slate-500">{r.employee.code}</div></Td>
          <Td>{r.category.name}</Td>
          <Td className="whitespace-normal"><div className="min-w-48">{r.reason}</div></Td>
          <Td>{r.neededBy ? fmtDate(r.neededBy) : "—"}</Td>
          <Td>{fmtDateTime(r.approvedAt)}</Td>
        </tr>
      ))}
    </Table>
  );
}

function CategoryCard({ category, onSaved }: { category: AssetCategory; onSaved: () => void }) {
  const [c, setC] = useState(category);
  const [msg, setMsg] = useState<string | null>(null);
  const dirty = JSON.stringify(c) !== JSON.stringify(category);
  const save = async () => {
    try {
      await put(`/assets/categories/${c.id}`, { name: c.name, mustReturnOnExit: c.mustReturnOnExit, active: c.active, sortOrder: c.sortOrder, kind: c.kind });
      setMsg("Saved");
      onSaved();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <div className={`grid gap-3 rounded-md p-3 ring-1 ring-slate-200 sm:grid-cols-2 lg:grid-cols-[minmax(12rem,2fr)_minmax(10rem,1fr)_6rem_auto] lg:items-end ${c.active ? "" : "bg-slate-50"}`}>
      <Field label="Name"><Input value={c.name} onChange={(e) => { setC({ ...c, name: e.target.value }); setMsg(null); }} /></Field>
      <Field label="Type">
        <Select value={c.kind} onChange={(e) => { setC({ ...c, kind: e.target.value as AssetCategory["kind"] }); setMsg(null); }}>
          <option value="PHYSICAL">Physical item</option>
          <option value="ACCESS">Access & accounts (revoked)</option>
        </Select>
      </Field>
      <Field label="Order"><Input type="number" value={c.sortOrder} onChange={(e) => { setC({ ...c, sortOrder: Number(e.target.value) }); setMsg(null); }} /></Field>
      <div className="flex flex-wrap items-center gap-4 pb-2">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={c.mustReturnOnExit} onChange={(e) => { setC({ ...c, mustReturnOnExit: e.target.checked }); setMsg(null); }} />Must be returned on exit</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={c.active} onChange={(e) => { setC({ ...c, active: e.target.checked }); setMsg(null); }} />Active</label>
        {msg && <span role="status" className={`text-sm ${msg === "Saved" ? "text-emerald-700" : "text-red-600"}`}>{msg}</span>}
        <Button size="sm" disabled={!dirty} onClick={save}>Save</Button>
      </div>
    </div>
  );
}

function Categories() {
  const { data, loading, reload } = useApi<AssetCategory[]>("/assets/categories?all=1");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (loading) return <Spinner />;
  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-600">Exit clearance waits for items in categories marked “Must be returned on exit”. Access & accounts items are revoked instead of returned.</p>
      {data?.map((c) => <CategoryCard key={c.id} category={c} onSaved={reload} />)}
      <form
        className="flex flex-wrap items-end gap-3 pt-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            await post("/assets/categories", { name, sortOrder: (data?.length ?? 0) + 1 });
            setName("");
            reload();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        {error && <div className="w-full"><Alert>{error}</Alert></div>}
        <Field label="New category"><Input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Button type="submit">Add category</Button>
      </form>
    </div>
  );
}

function Import() {
  const [result, setResult] = useState<ImportResult | null>(null);
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">Fill the template with your current register. Keep existing tags in the Tag column, or leave it empty to generate EHB-AST tags. Items assigned to an employee wait for their confirmation in My Inventory.</p>
      <Button variant="secondary" onClick={() => download("/assets/import-template", "asset-import-template.xlsx")}>Download the Excel template</Button>
      <ImportForm<ImportResult> path="/assets/import" onDone={setResult} />
      {result && (
        <div className="space-y-2">
          <Alert kind="success">Read {result.rowsRead} rows · added {result.created.length} assets.</Alert>
          {result.skipped.length > 0 && <Alert kind="warning">Skipped: {result.skipped.map((s) => `row ${s.row}: ${s.reason}`).join("; ")}</Alert>}
        </div>
      )}
    </div>
  );
}

export default function AssetsPage() {
  const { user } = useAuth();
  const isAdmin = hasRole(user, "ADMIN");
  const [view, setView] = useState<View>("register");
  const options: { value: View; label: string }[] = [
    { value: "register", label: "Register" },
    { value: "awaiting", label: "Awaiting confirmation" },
    ...(isAdmin ? [{ value: "requests" as const, label: "Requests to fulfil" }] : []),
    { value: "incidents", label: "Damage & loss" },
    { value: "recoveries", label: "Recoveries" },
    ...(isAdmin ? [{ value: "categories" as const, label: "Categories" }, { value: "import" as const, label: "Import" }] : []),
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="Assets" subtitle="Company items and accounts: who has what, repairs, damage and loss, and exit clearance." />
      <Card>
        <Tabs value={view} onChange={setView} options={options} />
        {(view === "register" || view === "awaiting") && <Register key={view} view={view} isAdmin={isAdmin} />}
        {view === "requests" && <Requests />}
        {view === "incidents" && <Incidents view="open" />}
        {view === "recoveries" && <Incidents view="recoveries" />}
        {view === "categories" && <Categories />}
        {view === "import" && <Import />}
      </Card>
    </div>
  );
}
