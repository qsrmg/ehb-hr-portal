import { Router } from "express";
import { z } from "zod";
import { currentUser, requireAuth } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { ymd } from "../lib/dates.js";
import {
  addComment, archiveTask, assignableTeam, createTask, getTask, listComments, listTasks, myTasksSummary,
  taskHistory, taskScopeFor, teamSummary, updateTask,
} from "../services/tasks.js";

export const tasksRouter = Router();
tasksRouter.use(requireAuth);

const STATUSES = ["BACKLOG", "TODO", "IN_PROGRESS", "DONE"] as const;
const PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;

const toApi = (t: { dueDate: Date | null; [k: string]: unknown }) => ({ ...t, dueDate: t.dueDate ? ymd(t.dueDate) : null });

tasksRouter.get("/", async (req, res) => {
  const user = currentUser(req);
  const scope = await taskScopeFor(user);
  const q = req.query;
  const rows = await listTasks(user, scope, {
    status: typeof q.status === "string" && (STATUSES as readonly string[]).includes(q.status) ? (q.status as (typeof STATUSES)[number]) : undefined,
    priority: typeof q.priority === "string" && (PRIORITIES as readonly string[]).includes(q.priority) ? (q.priority as (typeof PRIORITIES)[number]) : undefined,
    assigneeId: q.assigneeId ? Number(q.assigneeId) : undefined,
    q: typeof q.q === "string" && q.q.trim() ? q.q.trim() : undefined,
    overdue: q.overdue === "1",
    archived: q.archived === "1",
  });
  const scoped = q.mine === "1" ? rows.filter((t) => t.assigneeId === user.id || t.creatorId === user.id) : rows;
  res.json(scoped.map(toApi));
});

tasksRouter.get("/team-summary", async (req, res) => {
  const user = currentUser(req);
  const scope = await taskScopeFor(user);
  res.json(await teamSummary(user, scope));
});

tasksRouter.get("/me/widget", async (req, res) => {
  res.json(await myTasksSummary(currentUser(req).id));
});

tasksRouter.get("/team-members", async (req, res) => {
  const user = currentUser(req);
  const scope = await taskScopeFor(user);
  res.json(await assignableTeam(user, scope));
});

tasksRouter.get("/:id", async (req, res) => {
  const user = currentUser(req);
  const scope = await taskScopeFor(user);
  const task = await getTask(user, scope, Number(req.params.id));
  res.json(toApi(task));
});

tasksRouter.get("/:id/comments", async (req, res) => {
  const user = currentUser(req);
  const scope = await taskScopeFor(user);
  res.json(await listComments(user, scope, Number(req.params.id)));
});

tasksRouter.get("/:id/history", async (req, res) => {
  const user = currentUser(req);
  const scope = await taskScopeFor(user);
  res.json(await taskHistory(user, scope, Number(req.params.id)));
});

const createSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().optional(),
  assigneeId: z.number().int(),
  priority: z.enum(PRIORITIES).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  departmentId: z.number().int().optional(),
});

tasksRouter.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "));
  const user = currentUser(req);
  const scope = await taskScopeFor(user);
  const task = await createTask(user, scope, parsed.data);
  res.status(201).json(toApi(task));
});

const patchSchema = z.object({
  title: z.string().trim().min(1).optional(),
  description: z.string().trim().optional(),
  assigneeId: z.number().int().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  priority: z.enum(PRIORITIES).optional(),
  status: z.enum(STATUSES).optional(),
  blocked: z.boolean().optional(),
});

tasksRouter.patch("/:id", async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "));
  const user = currentUser(req);
  const scope = await taskScopeFor(user);
  const task = await updateTask(user, scope, Number(req.params.id), parsed.data);
  res.json(toApi(task));
});

tasksRouter.post("/:id/archive", async (req, res) => {
  const user = currentUser(req);
  const scope = await taskScopeFor(user);
  const task = await archiveTask(user, scope, Number(req.params.id));
  res.json(toApi(task));
});

const commentSchema = z.object({ body: z.string().trim().min(1) });

tasksRouter.post("/:id/comments", async (req, res) => {
  const parsed = commentSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "A comment cannot be empty");
  const user = currentUser(req);
  const scope = await taskScopeFor(user);
  const comment = await addComment(user, scope, Number(req.params.id), parsed.data.body);
  res.status(201).json(comment);
});
