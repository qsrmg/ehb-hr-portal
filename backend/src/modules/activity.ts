import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { audit } from "../lib/audit.js";
import { parseMonth } from "../lib/dates.js";
import { HttpError } from "../middleware/error.js";
import { currentUser, requireAuth, requireRole, teamIds } from "../middleware/auth.js";
import {
  acknowledgePolicy, departmentReports, endPause, monthlyActivity, recordHeartbeat,
  startPause, teamAggregate, trackabilityStatus,
} from "../services/activity.js";

export const activityRouter = Router();
activityRouter.use(requireAuth);

activityRouter.get("/status", async (req, res) => {
  res.json(await trackabilityStatus(currentUser(req).id));
});

activityRouter.post("/policy/acknowledge", async (req, res) => {
  await acknowledgePolicy(currentUser(req).id);
  res.json({ ok: true });
});

const heartbeatSchema = z.object({
  minutes: z.array(z.object({ minuteStart: z.string(), active: z.boolean() })).max(2000),
});

activityRouter.post("/heartbeat", async (req, res) => {
  const parsed = heartbeatSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Invalid heartbeat payload");
  const result = await recordHeartbeat(currentUser(req).id, parsed.data.minutes);
  res.json(result);
});

const pauseSchema = z.object({ action: z.enum(["start", "end"]) });

activityRouter.post("/pause", async (req, res) => {
  const parsed = pauseSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Invalid request");
  const user = currentUser(req);
  if (parsed.data.action === "start") await startPause(user.id);
  else await endPause(user.id);
  res.json(await trackabilityStatus(user.id));
});

activityRouter.get("/me", async (req, res) => {
  const { year, month } = parseMonth(req.query.month);
  res.json(await monthlyActivity(currentUser(req).id, year, month));
});

/** Line Manager / HOD: their team's average Active % and who was tracked today. Never a member's own number. */
activityRouter.get("/team", async (req, res) => {
  const user = currentUser(req);
  const ids = await teamIds(user.id);
  if (!ids.length) throw new HttpError(403, "You have no team");
  const { year, month } = parseMonth(req.query.month);
  res.json(await teamAggregate(ids, year, month));
});

activityRouter.get("/reports", requireRole("HR"), async (req, res) => {
  const { year, month } = parseMonth(req.query.month);
  const departmentId = req.query.departmentId ? Number(req.query.departmentId) : undefined;
  res.json(await departmentReports(year, month, departmentId));
});

activityRouter.get("/reports/export.csv", requireRole("HR"), async (req, res) => {
  const { year, month } = parseMonth(req.query.month);
  const departmentId = req.query.departmentId ? Number(req.query.departmentId) : undefined;
  const { rows, companyAverageActivePct } = await departmentReports(year, month, departmentId);
  await audit(currentUser(req).id, "EXPORT", "ActivityReport", null, { year, month, departmentId: departmentId ?? null });
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [
    ["Department", "Employees", "Tracked employees", "Average Active %"].map(esc).join(","),
    ...rows.map((r) => [r.departmentName, r.employeeCount, r.trackedEmployeeCount, r.averageActivePct ?? ""].map(esc).join(",")),
    [].join(","),
    ["Company average", "", "", companyAverageActivePct ?? ""].map(esc).join(","),
  ];
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="activity-${year}-${String(month).padStart(2, "0")}.csv"`);
  res.send(lines.join("\n"));
});

activityRouter.get("/employee/:id", requireRole("HR"), async (req, res) => {
  const id = Number(req.params.id);
  const emp = await prisma.employee.findUnique({ where: { id }, select: { id: true, fullName: true, code: true } });
  if (!emp) throw new HttpError(404, "Employee not found");
  const { year, month } = parseMonth(req.query.month);
  await audit(currentUser(req).id, "VIEW_SENSITIVE", "ActivitySummary", id, { year, month });
  res.json({ employee: emp, ...(await monthlyActivity(id, year, month)) });
});

activityRouter.get("/exclusions", requireRole("HR"), async (_req, res) => {
  const rows = await prisma.activityExclusion.findMany({ include: { employee: { select: { id: true, fullName: true, code: true } } }, orderBy: { createdAt: "desc" } });
  res.json(rows.map((r) => ({ employeeId: r.employeeId, fullName: r.employee.fullName, code: r.employee.code, createdAt: r.createdAt })));
});

const exclusionSchema = z.object({ employeeId: z.number().int() });

activityRouter.post("/exclusions", requireRole("HR"), async (req, res) => {
  const parsed = exclusionSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Choose an employee");
  const user = currentUser(req);
  const emp = await prisma.employee.findUnique({ where: { id: parsed.data.employeeId } });
  if (!emp) throw new HttpError(404, "Employee not found");
  const row = await prisma.activityExclusion.upsert({
    where: { employeeId: parsed.data.employeeId },
    create: { employeeId: parsed.data.employeeId, excludedById: user.id },
    update: {},
  });
  await audit(user.id, "CREATE", "ActivityExclusion", row.id, { employeeId: parsed.data.employeeId, fullName: emp.fullName });
  res.status(201).json({ ok: true });
});

activityRouter.delete("/exclusions/:employeeId", requireRole("HR"), async (req, res) => {
  const employeeId = Number(req.params.employeeId);
  const row = await prisma.activityExclusion.findUnique({ where: { employeeId }, include: { employee: { select: { fullName: true } } } });
  if (!row) throw new HttpError(404, "Not excluded");
  await prisma.activityExclusion.delete({ where: { employeeId } });
  await audit(currentUser(req).id, "DELETE", "ActivityExclusion", row.id, { employeeId, fullName: row.employee.fullName });
  res.json({ ok: true });
});
