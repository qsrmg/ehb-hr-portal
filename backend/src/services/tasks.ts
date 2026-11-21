import { prisma } from "../lib/prisma.js";
import { audit, diff } from "../lib/audit.js";
import { notify } from "../lib/notify.js";
import { getSettings } from "../lib/settings.js";
import { holidayMap } from "./attendance.js";
import { isWeekend, nowParts, toDate, ymd } from "../lib/dates.js";
import { hasRole, type AuthUser } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import type { Prisma, TaskPriority, TaskStatus } from "../generated/prisma/client.js";

/**
 * Direct + indirect reports, breadth-first down the `managerId` chain. A visited set (seeded with the
 * employee's own id) stops a corrupted manager cycle (A -> B -> A) from ever re-adding the root or looping
 * forever; the depth cap (10) is a second, independent safety net for pathological data.
 */
export async function teamIdsRecursive(employeeId: number, maxDepth = 10): Promise<number[]> {
  const visited = new Set<number>([employeeId]);
  const result: number[] = [];
  let frontier = [employeeId];
  for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
    const reports = await prisma.employee.findMany({ where: { managerId: { in: frontier } }, select: { id: true } });
    const next: number[] = [];
    for (const r of reports) {
      if (visited.has(r.id)) continue;
      visited.add(r.id);
      result.push(r.id);
      next.push(r.id);
    }
    frontier = next;
  }
  return result;
}

export type TaskScope = { kind: "ALL" } | { kind: "TEAM"; teamIds: number[] } | { kind: "SELF" };

/**
 * HR: every task. Finance: own only, always (never team, even if they happen to have reports). ADMIN /
 * MANAGEMENT: own only for v1 (DECISIONS.md PENDING) unless they also hold LINE_MANAGER/HOD, in which case
 * the team they structurally have (via managerId) applies. Everyone else: team scope if they structurally
 * have direct or indirect reports, else own only.
 */
export async function taskScopeFor(user: AuthUser): Promise<TaskScope> {
  if (hasRole(user, "HR")) return { kind: "ALL" };
  if (hasRole(user, "FINANCE")) return { kind: "SELF" };
  if ((hasRole(user, "ADMIN") || hasRole(user, "MANAGEMENT")) && !hasRole(user, "LINE_MANAGER", "HOD")) {
    return { kind: "SELF" };
  }
  const team = await teamIdsRecursive(user.id);
  return team.length ? { kind: "TEAM", teamIds: team } : { kind: "SELF" };
}

/** Self + the full recursive team, for the assignee picker (HR picks from the separate, full employees list instead). */
export async function assignableTeam(user: AuthUser, scope: TaskScope) {
  if (scope.kind !== "TEAM") return [];
  const ids = [user.id, ...scope.teamIds];
  return prisma.employee.findMany({ where: { id: { in: ids }, status: "ACTIVE" }, select: { id: true, fullName: true, code: true }, orderBy: { fullName: "asc" } });
}

/** The Prisma `where` fragment for "tasks this user may see" under a scope (archived tasks excluded by default). */
function visibilityWhere(user: AuthUser, scope: TaskScope, includeArchived: boolean) {
  const archived = includeArchived ? {} : { archivedAt: null };
  if (scope.kind === "ALL") return archived;
  if (scope.kind === "SELF") return { ...archived, OR: [{ assigneeId: user.id }, { creatorId: user.id }] };
  const ids = [user.id, ...scope.teamIds];
  return { ...archived, OR: [{ assigneeId: { in: ids } }, { creatorId: { in: ids } }] };
}

/** May `user` create or reassign a task to `targetEmployeeId`? */
function canTarget(user: AuthUser, scope: TaskScope, targetEmployeeId: number) {
  if (scope.kind === "ALL") return true;
  if (scope.kind === "TEAM") return targetEmployeeId === user.id || scope.teamIds.includes(targetEmployeeId);
  return targetEmployeeId === user.id;
}

const taskInclude = {
  assignee: { select: { id: true, fullName: true, code: true } },
  creator: { select: { id: true, fullName: true, code: true } },
  department: { select: { id: true, name: true } },
  archivedBy: { select: { id: true, fullName: true, code: true } },
} as const;

function isVisible(user: AuthUser, scope: TaskScope, task: { assigneeId: number; creatorId: number }) {
  if (scope.kind === "ALL") return true;
  if (scope.kind === "SELF") return task.assigneeId === user.id || task.creatorId === user.id;
  const ids = new Set([user.id, ...scope.teamIds]);
  return ids.has(task.assigneeId) || ids.has(task.creatorId);
}

/** 404 whether the task truly doesn't exist or merely isn't visible — reads never reveal which. */
async function loadVisibleTask(user: AuthUser, scope: TaskScope, taskId: number) {
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: taskInclude });
  if (!task || !isVisible(user, scope, task)) throw new HttpError(404, "Task not found");
  return task;
}

/** For writes (update/archive/comment): 404 only if the task truly does not exist, 403 if it exists but is
 * outside the actor's scope — distinct from reads, which use loadVisibleTask and always 404 either way. */
async function loadTaskForWrite(user: AuthUser, scope: TaskScope, taskId: number) {
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: taskInclude });
  if (!task) throw new HttpError(404, "Task not found");
  if (!isVisible(user, scope, task)) throw new HttpError(403, "You cannot act on this task");
  return task;
}

export async function listTasks(
  user: AuthUser,
  scope: TaskScope,
  filters: { status?: TaskStatus; priority?: TaskPriority; assigneeId?: number; q?: string; overdue?: boolean; archived?: boolean },
) {
  const where: Record<string, unknown> = { ...visibilityWhere(user, scope, !!filters.archived) };
  if (filters.status) where.status = filters.status;
  if (filters.priority) where.priority = filters.priority;
  if (filters.assigneeId) where.assigneeId = filters.assigneeId;
  if (filters.q) where.title = { contains: filters.q, mode: "insensitive" };
  if (filters.overdue) {
    where.dueDate = { lt: toDate(nowParts().ymd) };
    where.status = { not: "DONE" };
  }
  return prisma.task.findMany({ where, include: taskInclude, orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }] });
}

export async function getTask(user: AuthUser, scope: TaskScope, taskId: number) {
  return loadVisibleTask(user, scope, taskId);
}

const defaultPriority = async (): Promise<TaskPriority> => {
  const s = await getSettings();
  const v = s["tasks.defaultPriority"].split(",")[0]?.trim().toUpperCase();
  return v === "LOW" || v === "HIGH" ? v : "MEDIUM";
};

export async function createTask(
  user: AuthUser,
  scope: TaskScope,
  input: { title: string; description?: string; assigneeId: number; priority?: TaskPriority; dueDate?: string; departmentId?: number },
) {
  if (!input.title.trim()) throw new HttpError(400, "A title is required");
  if (scope.kind === "SELF" && input.assigneeId !== user.id) {
    throw new HttpError(403, "You may only create tasks for yourself");
  }
  if (scope.kind === "SELF") {
    const settings = await getSettings();
    if (settings["tasks.employeesCanCreateOwnTasks"] !== "1") throw new HttpError(403, "Creating your own tasks is currently switched off");
  }
  if (!canTarget(user, scope, input.assigneeId)) throw new HttpError(403, "You cannot assign a task outside your team");
  const assignee = await prisma.employee.findUnique({ where: { id: input.assigneeId }, select: { id: true, status: true } });
  if (!assignee || assignee.status !== "ACTIVE") throw new HttpError(404, "Employee not found");

  const task = await prisma.task.create({
    data: {
      title: input.title.trim(),
      description: input.description?.trim() || null,
      assigneeId: input.assigneeId,
      creatorId: user.id,
      priority: input.priority ?? (await defaultPriority()),
      dueDate: input.dueDate ? toDate(input.dueDate) : null,
      departmentId: input.departmentId ?? null,
    },
    include: taskInclude,
  });
  await audit(user.id, "CREATE", "Task", task.id, { title: task.title, assigneeId: task.assigneeId });
  if (task.assigneeId !== user.id) {
    const settings = await getSettings();
    await notify([task.assigneeId], `Task assigned: ${task.title}`, `${user.fullName} assigned you a task: "${task.title}".`, `/tasks/${task.id}`, {
      sendEmail: settings["tasks.sendEmails"] === "1",
    });
  }
  return task;
}

export type TaskPatch = {
  title?: string;
  description?: string;
  assigneeId?: number;
  dueDate?: string | null;
  priority?: TaskPriority;
  status?: TaskStatus;
  blocked?: boolean;
};

const OWN_TASK_FIELDS = new Set(["title", "description", "dueDate", "priority", "status", "blocked"]);
const MANAGER_FIELDS = new Set(["assigneeId", "dueDate", "priority", "status", "blocked"]);

/**
 * Which fields `user` may change on `task`, given their scope. Being the task's assignee makes someone a
 * stakeholder (for visibility) but not automatically a manager over it — manager-level authority (assignee,
 * due date, priority together) only applies when the actor is overseeing a TEAM MEMBER's task, never their
 * own. The one exception, regardless of scope: whoever both created a task and assigned it to themselves
 * may also edit its title, description, due date and priority — just never who it is assigned to.
 */
function editableFields(user: AuthUser, scope: TaskScope, task: { creatorId: number; assigneeId: number }): Set<string> {
  if (scope.kind === "ALL") return new Set(["title", "description", "assigneeId", "dueDate", "priority", "status", "blocked"]);
  const selfCreatedAndAssigned = task.creatorId === user.id && task.assigneeId === user.id;
  if (selfCreatedAndAssigned) return OWN_TASK_FIELDS;

  if (scope.kind === "TEAM") {
    const assigneeIsTeamMember = task.assigneeId !== user.id && scope.teamIds.includes(task.assigneeId);
    if (assigneeIsTeamMember) return MANAGER_FIELDS; // a report's task: full manager rights
    if (task.assigneeId === user.id) return new Set(["status"]); // the manager is only the worker here (assigned by someone else)
    return new Set();
  }

  // SELF scope: assigned to them by someone else -> status only.
  if (task.assigneeId === user.id) return new Set(["status"]);
  return new Set();
}

export async function updateTask(user: AuthUser, scope: TaskScope, taskId: number, patch: TaskPatch) {
  const task = await loadTaskForWrite(user, scope, taskId);
  if (task.archivedAt) throw new HttpError(400, "This task is archived");
  const allowed = editableFields(user, scope, task);
  const fields = Object.keys(patch) as (keyof TaskPatch)[];
  if (!fields.length) throw new HttpError(400, "Nothing to update");
  for (const f of fields) {
    if (!allowed.has(f)) throw new HttpError(403, `You cannot change ${f} on this task`);
  }
  if (patch.assigneeId != null && !canTarget(user, scope, patch.assigneeId)) {
    throw new HttpError(403, "You cannot assign a task outside your team");
  }
  if (patch.title != null && !patch.title.trim()) throw new HttpError(400, "Title cannot be empty");

  const before: Record<string, unknown> = {
    title: task.title, description: task.description, assigneeId: task.assigneeId,
    dueDate: task.dueDate ? ymd(task.dueDate) : null, priority: task.priority, status: task.status, blocked: task.blocked,
  };
  const data: Record<string, unknown> = {};
  if (patch.title !== undefined) data.title = patch.title.trim();
  if (patch.description !== undefined) data.description = patch.description?.trim() || null;
  if (patch.assigneeId !== undefined) data.assigneeId = patch.assigneeId;
  if (patch.dueDate !== undefined) data.dueDate = patch.dueDate ? toDate(patch.dueDate) : null;
  if (patch.priority !== undefined) data.priority = patch.priority;
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.blocked !== undefined) data.blocked = patch.blocked;

  const updated = await prisma.task.update({ where: { id: taskId }, data, include: taskInclude });
  const after: Record<string, unknown> = {
    title: updated.title, description: updated.description, assigneeId: updated.assigneeId,
    dueDate: updated.dueDate ? ymd(updated.dueDate) : null, priority: updated.priority, status: updated.status, blocked: updated.blocked,
  };
  const changes = diff(before, after);
  if (Object.keys(changes).length) await audit(user.id, "UPDATE", "Task", taskId, changes as Prisma.InputJsonValue);

  const settings = await getSettings();
  const sendEmail = settings["tasks.sendEmails"] === "1";
  if (changes.assigneeId && updated.assigneeId !== user.id) {
    await notify([updated.assigneeId], `Task assigned: ${updated.title}`, `${user.fullName} assigned you a task: "${updated.title}".`, `/tasks/${taskId}`, { sendEmail });
  }
  if (changes.status && updated.creatorId !== user.id) {
    await notify([updated.creatorId], `Status changed: ${updated.title}`, `${user.fullName} moved "${updated.title}" to ${updated.status.replace("_", " ")}.`, `/tasks/${taskId}`, { sendEmail });
  }
  return updated;
}

export async function archiveTask(user: AuthUser, scope: TaskScope, taskId: number) {
  const task = await loadTaskForWrite(user, scope, taskId);
  if (task.archivedAt) throw new HttpError(400, "Already archived");
  const isCreator = task.creatorId === user.id;
  const isAssigneesManager = (await prisma.employee.findUnique({ where: { id: task.assigneeId }, select: { managerId: true } }))?.managerId === user.id;
  if (!isCreator && !isAssigneesManager && !hasRole(user, "HR")) throw new HttpError(403, "You cannot archive this task");
  const updated = await prisma.task.update({ where: { id: taskId }, data: { archivedAt: new Date(), archivedById: user.id }, include: taskInclude });
  await audit(user.id, "ARCHIVE", "Task", taskId, { title: task.title });
  return updated;
}

export async function addComment(user: AuthUser, scope: TaskScope, taskId: number, body: string) {
  if (!body.trim()) throw new HttpError(400, "Comment cannot be empty");
  await loadTaskForWrite(user, scope, taskId);
  return prisma.taskComment.create({
    data: { taskId, authorId: user.id, body: body.trim() },
    include: { author: { select: { id: true, fullName: true, code: true } } },
  });
}

export async function listComments(user: AuthUser, scope: TaskScope, taskId: number) {
  await loadVisibleTask(user, scope, taskId);
  return prisma.taskComment.findMany({ where: { taskId }, include: { author: { select: { id: true, fullName: true, code: true } } }, orderBy: { createdAt: "asc" } });
}

const HISTORY_FIELDS = new Set(["status", "assigneeId", "dueDate", "priority"]);

/**
 * Only AuditLog rows for this task, only actor name/time/action and the from/to of status, assignee, due
 * date and priority — comment text is never written to the audit log in the first place, so there is
 * nothing to filter there, but every other detail key (title, description, blocked, ...) is dropped here too.
 */
export async function taskHistory(user: AuthUser, scope: TaskScope, taskId: number) {
  await loadVisibleTask(user, scope, taskId);
  const rows = await prisma.auditLog.findMany({
    where: { entity: "Task", entityId: String(taskId) },
    include: { actor: { select: { id: true, fullName: true, code: true } } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => {
    const details = (r.details ?? {}) as Record<string, { from: unknown; to: unknown }>;
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const [k, v] of Object.entries(details)) if (HISTORY_FIELDS.has(k)) changes[k] = v;
    return { id: r.id, action: r.action, at: r.createdAt, actor: r.actor, changes };
  });
}

export async function teamSummary(user: AuthUser, scope: TaskScope) {
  if (scope.kind === "SELF") throw new HttpError(403, "You have no team");
  const where = visibilityWhere(user, scope, false);
  const rows = await prisma.task.findMany({ where, select: { assigneeId: true, status: true, dueDate: true, assignee: { select: { id: true, fullName: true, code: true } } } });
  const today = toDate(nowParts().ymd);
  const byAssignee = new Map<number, { assignee: { id: number; fullName: string; code: string }; backlog: number; todo: number; inProgress: number; done: number; overdue: number }>();
  for (const r of rows) {
    const entry = byAssignee.get(r.assigneeId) ?? { assignee: r.assignee, backlog: 0, todo: 0, inProgress: 0, done: 0, overdue: 0 };
    if (r.status === "BACKLOG") entry.backlog++;
    if (r.status === "TODO") entry.todo++;
    if (r.status === "IN_PROGRESS") entry.inProgress++;
    if (r.status === "DONE") entry.done++;
    if (r.status !== "DONE" && r.dueDate && r.dueDate < today) entry.overdue++;
    byAssignee.set(r.assigneeId, entry);
  }
  const people = [...byAssignee.values()].sort((a, b) => a.assignee.fullName.localeCompare(b.assignee.fullName));
  return { people, overdueCount: people.reduce((s, p) => s + p.overdue, 0), totalCount: rows.length };
}

/** For the dashboard widget. */
export async function myTasksSummary(employeeId: number) {
  const today = toDate(nowParts().ymd);
  const rows = await prisma.task.findMany({ where: { assigneeId: employeeId, archivedAt: null }, select: { status: true, dueDate: true } });
  let toDoCount = 0, inProgressCount = 0, overdueCount = 0;
  for (const r of rows) {
    if (r.status === "TODO") toDoCount++;
    if (r.status === "IN_PROGRESS") inProgressCount++;
    if (r.status !== "DONE" && r.dueDate && r.dueDate < today) overdueCount++;
  }
  return { toDo: toDoCount, inProgress: inProgressCount, overdueCount };
}

/** Daily job: one notification per assignee with overdue tasks, skipping weekends and holidays (Asia/Karachi). */
export async function sendOverdueDigest(now = new Date()) {
  const { ymd: dayYmd } = nowParts(now);
  const date = toDate(dayYmd);
  if (isWeekend(date)) return 0;
  const holidays = await holidayMap(date, date);
  if (holidays.has(dayYmd)) return 0;

  const overdue = await prisma.task.findMany({
    where: { archivedAt: null, status: { not: "DONE" }, dueDate: { lt: date } },
    select: { assigneeId: true, title: true },
  });
  if (!overdue.length) return 0;
  const byAssignee = new Map<number, string[]>();
  for (const t of overdue) byAssignee.set(t.assigneeId, [...(byAssignee.get(t.assigneeId) ?? []), t.title]);

  const settings = await getSettings();
  const sendEmail = settings["tasks.sendEmails"] === "1";
  for (const [assigneeId, titles] of byAssignee) {
    const shown = titles.slice(0, 5).join(", ") + (titles.length > 5 ? ", …" : "");
    await notify(
      [assigneeId],
      `${titles.length} overdue task${titles.length > 1 ? "s" : ""}`,
      `You have ${titles.length} overdue task${titles.length > 1 ? "s" : ""}: ${shown}.`,
      "/tasks?overdue=1",
      { sendEmail },
    );
  }
  return byAssignee.size;
}
