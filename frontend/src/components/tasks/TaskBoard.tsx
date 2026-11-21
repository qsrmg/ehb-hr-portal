"use client";

import { useState } from "react";
import { Alert, Badge, Button, EmptyState, Input, Select, Spinner, Table, Tabs, Td } from "@/components/ui";
import { Icon } from "@/components/icons";
import { patch } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { fmtDate, TASK_PRIORITY_STYLES, TASK_STATUSES, todayYmd } from "@/lib/format";
import type { Task, TaskPriority, TaskStatus } from "@/lib/types";
import { TaskDrawer } from "./TaskDrawer";

const COLUMN_TITLES: Record<TaskStatus, string> = { BACKLOG: "Backlog", TODO: "To Do", IN_PROGRESS: "In Progress", DONE: "Done" };
const COLUMN_HEADER_CLASS: Record<TaskStatus, string> = {
  BACKLOG: "bg-slate-100 text-slate-700",
  TODO: "bg-sky-100 text-sky-800",
  IN_PROGRESS: "bg-amber-100 text-amber-900",
  DONE: "bg-emerald-100 text-emerald-800",
};

/** First letter of up to two name parts — the closest thing this app has to an avatar. */
export function Initials({ name }: { name: string }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
  return (
    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary" title={name} aria-hidden="true">
      {initials || "?"}
    </span>
  );
}

function isOverdue(task: Task) {
  return task.status !== "DONE" && !!task.dueDate && task.dueDate < todayYmd();
}

function TaskCard({ task, onOpen, onMove, canReorder }: { task: Task; onOpen: () => void; onMove: (status: TaskStatus) => void; canReorder: boolean }) {
  const overdue = isOverdue(task);
  const priority = TASK_PRIORITY_STYLES[task.priority];
  return (
    <div
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/task-id", String(task.id))}
      className="cursor-pointer rounded-xl border border-line bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:shadow-md"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-sm font-semibold leading-snug text-charcoal">{task.title}</p>
        <Initials name={task.assignee.fullName} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge tone={task.priority === "HIGH" ? "red" : task.priority === "MEDIUM" ? "blue" : "slate"}>{priority.label}</Badge>
        {task.blocked && <Badge tone="amber">Blocked</Badge>}
        {task.dueDate && <span className={`text-xs ${overdue ? "font-semibold text-red-600" : "text-slate-500"}`}>{overdue ? "Overdue: " : "Due "}{fmtDate(task.dueDate)}</span>}
      </div>
      {canReorder && (
        <div className="mt-2" onClick={(e) => e.stopPropagation()}>
          <Select
            aria-label={`Move "${task.title}" to a different status`}
            value={task.status}
            onChange={(e) => onMove(e.target.value as TaskStatus)}
            className="!h-8 !w-full !py-1 text-xs"
          >
            {TASK_STATUSES.map((s) => <option key={s} value={s}>Move to: {COLUMN_TITLES[s]}</option>)}
          </Select>
        </div>
      )}
    </div>
  );
}

function Column({ status, tasks, onOpen, onMove }: { status: TaskStatus; tasks: Task[]; onOpen: (id: number) => void; onMove: (id: number, status: TaskStatus) => void }) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <div
      className={`flex w-72 shrink-0 flex-col gap-2 rounded-xl border border-line bg-slate-50/60 p-2 transition sm:w-80 ${dragOver ? "ring-2 ring-primary" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const id = Number(e.dataTransfer.getData("text/task-id"));
        if (id) onMove(id, status);
      }}
    >
      <div className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-bold uppercase tracking-wide ${COLUMN_HEADER_CLASS[status]}`}>
        <span>{COLUMN_TITLES[status]}</span>
        <span>{tasks.length}</span>
      </div>
      <div className="flex min-h-24 flex-col gap-2">
        {tasks.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line/80 p-4 text-center text-xs text-slate-400">Nothing here</div>
        ) : (
          tasks.map((t) => <TaskCard key={t.id} task={t} onOpen={() => onOpen(t.id)} onMove={(s) => onMove(t.id, s)} canReorder />)
        )}
      </div>
    </div>
  );
}

export type TaskFilters = { status?: TaskStatus; priority?: TaskPriority; assigneeId?: number; q?: string; overdue?: boolean };

/**
 * The board, shared by "My tasks" and "Team tasks". `mine` scopes the query to tasks assigned to or created
 * by the signed-in user (My tasks); omit it for the fuller team view. Drag-and-drop moves a card between
 * columns the user may move into; every card also carries a keyboard-reachable "Move to" select, so drag is
 * never the only way to move a task. The backend is the real authority on every move — an out-of-scope
 * attempt is simply rejected and the error is shown, nothing here tries to predict every rule.
 */
export function TaskBoard({ mine, assigneeOptions, createFor }: { mine: boolean; assigneeOptions?: { id: number; fullName: string }[]; createFor?: { id: number; fullName: string }[] }) {
  const [view, setView] = useState<"board" | "list">("board");
  const [filters, setFilters] = useState<TaskFilters>({});
  const [openId, setOpenId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mobileStatus, setMobileStatus] = useState<TaskStatus>("TODO");
  const [createOpen, setCreateOpen] = useState(false);

  const qs = new URLSearchParams();
  if (mine) qs.set("mine", "1");
  if (filters.status) qs.set("status", filters.status);
  if (filters.priority) qs.set("priority", filters.priority);
  if (filters.assigneeId) qs.set("assigneeId", String(filters.assigneeId));
  if (filters.q) qs.set("q", filters.q);
  if (filters.overdue) qs.set("overdue", "1");
  const { data, loading, error: loadError, reload } = useApi<Task[]>(`/tasks?${qs.toString()}`);

  const move = async (id: number, status: TaskStatus) => {
    setError(null);
    try {
      await patch(`/tasks/${id}`, { status });
      reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const tasks = data ?? [];
  const byStatus = (s: TaskStatus) => tasks.filter((t) => t.status === s);

  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={view} onChange={setView} options={[{ value: "board", label: "Board" }, { value: "list", label: "List" }]} />
        <div className="flex flex-wrap items-center gap-2">
          <Input placeholder="Search title..." value={filters.q ?? ""} onChange={(e) => setFilters({ ...filters, q: e.target.value || undefined })} className="!w-44" aria-label="Search" />
          <Select value={filters.priority ?? ""} onChange={(e) => setFilters({ ...filters, priority: (e.target.value || undefined) as TaskPriority })} className="!w-32" aria-label="Priority">
            <option value="">All priorities</option>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
          </Select>
          {assigneeOptions && (
            <Select value={filters.assigneeId ?? ""} onChange={(e) => setFilters({ ...filters, assigneeId: e.target.value ? Number(e.target.value) : undefined })} className="!w-44" aria-label="Assignee">
              <option value="">Everyone</option>
              {assigneeOptions.map((a) => <option key={a.id} value={a.id}>{a.fullName}</option>)}
            </Select>
          )}
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            <input type="checkbox" checked={!!filters.overdue} onChange={(e) => setFilters({ ...filters, overdue: e.target.checked || undefined })} />
            Overdue only
          </label>
          {createFor && <Button size="sm" onClick={() => setCreateOpen(true)}>Create task</Button>}
        </div>
      </div>

      {loading ? <Spinner /> : loadError ? <Alert>{loadError}</Alert> : tasks.length === 0 ? (
        <EmptyState icon={<Icon name="checkCircle" className="h-5 w-5" />} title="No tasks here" line="Create a task, or clear your filters." />
      ) : view === "list" ? (
        <Table head={["Title", "Assignee", "Priority", "Status", "Due"]}>
          {tasks.map((t) => (
            <tr key={t.id} className="cursor-pointer" onClick={() => setOpenId(t.id)}>
              <Td><div className="font-medium text-slate-900">{t.title}</div></Td>
              <Td>{t.assignee.fullName}</Td>
              <Td><Badge tone={t.priority === "HIGH" ? "red" : t.priority === "MEDIUM" ? "blue" : "slate"}>{TASK_PRIORITY_STYLES[t.priority].label}</Badge></Td>
              <Td><Badge tone={t.status === "DONE" ? "green" : t.status === "IN_PROGRESS" ? "amber" : t.status === "TODO" ? "blue" : "slate"}>{t.status.replace("_", " ")}</Badge></Td>
              <Td className={isOverdue(t) ? "font-semibold text-red-600" : ""}>{t.dueDate ? fmtDate(t.dueDate) : "—"}</Td>
            </tr>
          ))}
        </Table>
      ) : (
        <>
          {/* Narrow widths: one column at a time via tabs, instead of forcing horizontal scroll. */}
          <div className="sm:hidden">
            <Tabs value={mobileStatus} onChange={setMobileStatus} options={TASK_STATUSES.map((s) => ({ value: s, label: COLUMN_TITLES[s] }))} />
            <Column status={mobileStatus} tasks={byStatus(mobileStatus)} onOpen={setOpenId} onMove={move} />
          </div>
          <div className="hidden gap-3 overflow-x-auto pb-2 sm:flex">
            {TASK_STATUSES.map((s) => <Column key={s} status={s} tasks={byStatus(s)} onOpen={setOpenId} onMove={move} />)}
          </div>
        </>
      )}

      {openId != null && <TaskDrawer taskId={openId} assigneeOptions={assigneeOptions} onClose={() => setOpenId(null)} onChanged={reload} />}
      {createOpen && createFor && (
        <TaskDrawer taskId={null} createFor={createFor} assigneeOptions={assigneeOptions} onClose={() => setCreateOpen(false)} onChanged={() => { reload(); setCreateOpen(false); }} />
      )}
    </div>
  );
}
