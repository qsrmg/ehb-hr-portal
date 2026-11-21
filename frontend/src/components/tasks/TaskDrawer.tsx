"use client";

import { useState } from "react";
import { Alert, Button, Field, Input, Select, Spinner, Tabs, Textarea } from "@/components/ui";
import { Icon } from "@/components/icons";
import { post, patch } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { fmtDateTime, TASK_STATUSES } from "@/lib/format";
import type { Task, TaskComment, TaskHistoryRow, TaskPriority, TaskStatus } from "@/lib/types";
import { Initials } from "./TaskBoard";

type Person = { id: number; fullName: string };

function DetailsTab({ task, assigneeOptions, onChanged }: { task: Task; assigneeOptions?: Person[]; onChanged: () => void }) {
  const [form, setForm] = useState({ title: task.title, description: task.description ?? "", dueDate: task.dueDate ?? "", priority: task.priority, status: task.status, assigneeId: task.assignee.id });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    const body: Record<string, unknown> = {};
    if (form.title !== task.title) body.title = form.title;
    if (form.description !== (task.description ?? "")) body.description = form.description;
    if (form.dueDate !== (task.dueDate ?? "")) body.dueDate = form.dueDate || null;
    if (form.priority !== task.priority) body.priority = form.priority;
    if (form.status !== task.status) body.status = form.status;
    if (form.assigneeId !== task.assignee.id) body.assigneeId = form.assigneeId;
    if (!Object.keys(body).length) {
      setBusy(false);
      return;
    }
    try {
      await patch(`/tasks/${task.id}`, body);
      setMsg({ kind: "success", text: "Saved." });
      onChanged();
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    if (!confirm(`Archive "${task.title}"?`)) return;
    try {
      await post(`/tasks/${task.id}/archive`);
      onChanged();
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    }
  };

  return (
    <div className="space-y-4">
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <Field label="Title"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
      <Field label="Description"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Status">
          <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as TaskStatus })}>
            {TASK_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
          </Select>
        </Field>
        <Field label="Priority">
          <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as TaskPriority })}>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
          </Select>
        </Field>
        <Field label="Due date"><Input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></Field>
        <Field label="Assignee">
          {assigneeOptions ? (
            <Select value={form.assigneeId} onChange={(e) => setForm({ ...form, assigneeId: Number(e.target.value) })}>
              {assigneeOptions.map((a) => <option key={a.id} value={a.id}>{a.fullName}</option>)}
            </Select>
          ) : (
            <div className="flex h-10 items-center gap-2 text-sm text-slate-700"><Initials name={task.assignee.fullName} /> {task.assignee.fullName}</div>
          )}
        </Field>
      </div>
      <p className="text-xs text-slate-500">Created by {task.creator.fullName} on {fmtDateTime(task.createdAt)}{task.department ? ` · ${task.department.name}` : ""}</p>
      <div className="flex items-center justify-between">
        <Button loading={busy} onClick={save}>Save changes</Button>
        {!task.archivedAt && <Button variant="ghost-danger" size="sm" onClick={archive}>Archive</Button>}
      </div>
      {task.archivedAt && <Alert kind="info">Archived {fmtDateTime(task.archivedAt)}{task.archivedBy ? ` by ${task.archivedBy.fullName}` : ""}.</Alert>}
    </div>
  );
}

function CommentsTab({ taskId }: { taskId: number }) {
  const { data, loading, error, reload } = useApi<TaskComment[]>(`/tasks/${taskId}/comments`);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try {
      await post(`/tasks/${taskId}/comments`, { body });
      setBody("");
      reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {loading ? <Spinner /> : error ? <Alert>{error}</Alert> : (
        <div className="space-y-2">
          {!data?.length && <p className="text-sm text-slate-500">No comments yet.</p>}
          {data?.map((c) => (
            <div key={c.id} className="rounded-lg bg-slate-50 p-2.5 text-sm">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="font-semibold text-slate-700">{c.author.fullName}</span>
                <span>{fmtDateTime(c.createdAt)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-slate-700">{c.body}</p>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={send} className="flex gap-2">
        <Input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a comment..." className="flex-1" aria-label="Add a comment" />
        <Button type="submit" loading={busy} disabled={!body.trim()}>Send</Button>
      </form>
    </div>
  );
}

function fieldLabel(k: string) {
  return { status: "Status", assigneeId: "Assignee", dueDate: "Due date", priority: "Priority" }[k] ?? k;
}

function HistoryTab({ taskId }: { taskId: number }) {
  const { data, loading, error } = useApi<TaskHistoryRow[]>(`/tasks/${taskId}/history`);
  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  if (!data?.length) return <p className="text-sm text-slate-500">No changes yet.</p>;
  return (
    <ul className="space-y-2">
      {data.map((h) => (
        <li key={h.id} className="rounded-lg bg-slate-50 p-2.5 text-sm">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span><span className="font-semibold text-slate-700">{h.actor?.fullName ?? "System"}</span> · {h.action}</span>
            <span>{fmtDateTime(h.at)}</span>
          </div>
          {Object.entries(h.changes).length > 0 && (
            <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
              {Object.entries(h.changes).map(([k, v]) => (
                <li key={k}>{fieldLabel(k)}: {String(v.from ?? "—")} → {String(v.to ?? "—")}</li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

function CreateForm({ createFor, onChanged, onClose }: { createFor: Person[]; onChanged: () => void; onClose: () => void }) {
  const [form, setForm] = useState({ title: "", description: "", assigneeId: createFor[0]?.id ?? 0, priority: "MEDIUM" as TaskPriority, dueDate: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await post("/tasks", { title: form.title, description: form.description || undefined, assigneeId: form.assigneeId, priority: form.priority, dueDate: form.dueDate || undefined });
      onChanged();
      onClose();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {msg && <Alert>{msg}</Alert>}
      <Field label="Title"><Input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
      <Field label="Description (optional)"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Assignee">
          <Select value={form.assigneeId} onChange={(e) => setForm({ ...form, assigneeId: Number(e.target.value) })}>
            {createFor.map((a) => <option key={a.id} value={a.id}>{a.fullName}</option>)}
          </Select>
        </Field>
        <Field label="Priority">
          <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as TaskPriority })}>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
          </Select>
        </Field>
        <Field label="Due date (optional)"><Input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></Field>
      </div>
      <Button type="submit" loading={busy}>Create task</Button>
    </form>
  );
}

/** Slides over the board. `taskId: null` with `createFor` set is create mode instead of an existing task. */
export function TaskDrawer({ taskId, createFor, assigneeOptions, onClose, onChanged }: { taskId: number | null; createFor?: Person[]; assigneeOptions?: Person[]; onClose: () => void; onChanged: () => void }) {
  const [tab, setTab] = useState<"details" | "comments" | "history">("details");
  const { data: task, loading, error, reload } = useApi<Task>(taskId != null ? `/tasks/${taskId}` : null);

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={taskId == null ? "Create task" : "Task detail"}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 flex w-full max-w-lg flex-col border-l border-line bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-display text-base font-bold text-charcoal">{taskId == null ? "Create task" : task?.title ?? "Task"}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-dim hover:bg-gray-100"><Icon name="close" className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {taskId == null ? (
            createFor && <CreateForm createFor={createFor} onChanged={onChanged} onClose={onClose} />
          ) : loading ? (
            <Spinner />
          ) : error ? (
            <Alert>{error}</Alert>
          ) : task ? (
            <>
              <Tabs value={tab} onChange={setTab} options={[{ value: "details", label: "Details" }, { value: "comments", label: "Comments" }, { value: "history", label: "History" }]} />
              {tab === "details" && <DetailsTab task={task} assigneeOptions={assigneeOptions} onChanged={() => { reload(); onChanged(); }} />}
              {tab === "comments" && <CommentsTab taskId={task.id} />}
              {tab === "history" && <HistoryTab taskId={task.id} />}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
