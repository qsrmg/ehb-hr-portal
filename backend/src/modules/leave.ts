import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { audit } from "../lib/audit.js";
import { parseMonth, monthRange, todayYmd, ymd } from "../lib/dates.js";
import { HttpError } from "../middleware/error.js";
import { canSeeWorkInfo, currentUser, hasRole, requireAuth, requireRole } from "../middleware/auth.js";
import {
  applicableTypes, balancesFor, carryForward, entitlementFor, evaluateLeave, recalculateEntitlements,
} from "../services/leave.js";
import type { Prisma } from "../generated/prisma/client.js";

export const leaveRouter = Router();
leaveRouter.use(requireAuth);

const currentYear = () => Number(todayYmd().slice(0, 4));
const yearParam = (v: unknown) => (typeof v === "string" && /^\d{4}$/.test(v) ? Number(v) : currentYear());

const serializeType = (t: Prisma.LeaveTypeGetPayload<object>) => ({
  ...t,
  annualQuota: t.annualQuota == null ? null : Number(t.annualQuota),
  carryForwardMax: t.carryForwardMax == null ? null : Number(t.carryForwardMax),
});

// Leave types the signed-in employee can apply for
leaveRouter.get("/types", async (req, res) => {
  const user = currentUser(req);
  res.json((await applicableTypes(user.id)).map(serializeType));
});

// All leave types (HR settings page)
leaveRouter.get("/types/all", requireRole("HR"), async (_req, res) => {
  res.json((await prisma.leaveType.findMany({ orderBy: { id: "asc" } })).map(serializeType));
});

const typeSchema = z.object({
  code: z.string().trim().toUpperCase().min(1).max(10),
  name: z.string().trim().min(2),
  annualQuota: z.number().min(0).nullable(),
  paid: z.boolean(),
  needsHrApproval: z.boolean(),
  noticeDays: z.number().int().min(0),
  documentAfterDays: z.number().int().min(0).nullable(),
  carryForwardMax: z.number().min(0).nullable(),
  proRata: z.boolean(),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).nullable(),
  active: z.boolean(),
});

leaveRouter.post("/types", requireRole("HR"), async (req, res) => {
  const parsed = typeSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const t = await prisma.leaveType.create({ data: parsed.data });
  await audit(currentUser(req).id, "CREATE", "LeaveType", t.id, parsed.data);
  res.status(201).json(serializeType(t));
});

// A quota or pro-rata change recalculates this year's (and later) balances, except ones HR adjusted by hand.
leaveRouter.put("/types/:id", requireRole("HR"), async (req, res) => {
  const parsed = typeSchema.partial().safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const id = Number(req.params.id);
  const before = await prisma.leaveType.findUniqueOrThrow({ where: { id } });
  const t = await prisma.leaveType.update({ where: { id }, data: parsed.data });
  const quotaChanged =
    (parsed.data.annualQuota !== undefined && parsed.data.annualQuota !== (before.annualQuota == null ? null : Number(before.annualQuota))) ||
    (parsed.data.proRata !== undefined && parsed.data.proRata !== before.proRata);
  const recalculated = quotaChanged ? await recalculateEntitlements({ leaveTypeId: id }) : null;
  await audit(currentUser(req).id, "UPDATE", "LeaveType", id, { before: serializeType(before), after: parsed.data, recalculated } as Prisma.InputJsonValue);
  res.json({ ...serializeType(t), recalculated });
});

leaveRouter.get("/balances/me", async (req, res) => {
  res.json(await balancesFor(currentUser(req).id, yearParam(req.query.year)));
});

leaveRouter.get("/balances/:employeeId", async (req, res) => {
  const id = Number(req.params.employeeId);
  if (!(await canSeeWorkInfo(currentUser(req), id))) throw new HttpError(403, "You can only view your own team");
  res.json(await balancesFor(id, yearParam(req.query.year)));
});

const adjustSchema = z.object({
  entitled: z.number().min(0).optional(),
  carriedForward: z.number().min(0).optional(),
  /** true: drop the manual entitlement and go back to the calculated one */
  automatic: z.boolean().optional(),
  reason: z.string().trim().min(3),
});

// HR manual adjustment of one balance. A hand-set entitlement is kept when quotas or joining dates change later.
leaveRouter.patch("/balances/:balanceId", requireRole("HR"), async (req, res) => {
  const parsed = adjustSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Enter the new values and a reason");
  const id = Number(req.params.balanceId);
  const before = await prisma.leaveBalance.findUniqueOrThrow({
    where: { id },
    include: { leaveType: true, employee: { select: { joiningDate: true } } },
  });
  const { reason, automatic, ...values } = parsed.data;
  const data: Prisma.LeaveBalanceUpdateInput = { ...values };
  if (automatic) {
    data.entitledManual = false;
    data.entitled = entitlementFor(before.leaveType, before.employee.joiningDate, before.year);
  } else if (values.entitled !== undefined) {
    data.entitledManual = true;
  }
  const b = await prisma.leaveBalance.update({ where: { id }, data });
  await audit(currentUser(req).id, "UPDATE", "LeaveBalance", id, {
    employeeId: before.employeeId, reason,
    before: { entitled: Number(before.entitled), carriedForward: Number(before.carriedForward), manual: before.entitledManual },
    after: { entitled: Number(b.entitled), carriedForward: Number(b.carriedForward), manual: b.entitledManual },
  });
  res.json({ id: b.id, entitled: Number(b.entitled), carriedForward: Number(b.carriedForward), entitledManual: b.entitledManual });
});

const previewSchema = z.object({
  leaveTypeId: z.coerce.number().int(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  excludeRequestId: z.coerce.number().int().optional(),
});

// Live check for the leave form: working days, balance, notice period and whether a document is needed
leaveRouter.post("/preview", async (req, res) => {
  const parsed = previewSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Pick a leave type and dates");
  const { excludeRequestId, ...input } = parsed.data;
  const r = await evaluateLeave(currentUser(req).id, input, excludeRequestId);
  res.json({ days: r.days, available: r.available, documentRequired: r.documentRequired, errors: r.errors, needsHrApproval: r.type.needsHrApproval });
});

leaveRouter.post("/carry-forward", requireRole("HR"), async (req, res) => {
  const fromYear = Number(req.body?.fromYear);
  if (!Number.isInteger(fromYear)) throw new HttpError(400, "Give the year to carry forward from");
  const updated = await carryForward(fromYear);
  await audit(currentUser(req).id, "CARRY_FORWARD", "LeaveBalance", null, { fromYear, updated });
  res.json({ updated });
});

/** Approved (and pending) leave in a month for the team calendar. */
leaveRouter.get("/calendar", async (req, res) => {
  const user = currentUser(req);
  const { year, month } = parseMonth(req.query.month);
  const { start, end } = monthRange(year, month);
  const all = hasRole(user, "HR", "MANAGEMENT");
  const rows = await prisma.leaveRequest.findMany({
    where: {
      startDate: { lte: end },
      endDate: { gte: start },
      request: { status: { in: ["APPROVED", "PENDING"] }, ...(all ? {} : { employee: { managerId: user.id } }) },
    },
    include: {
      leaveType: { select: { name: true, code: true } },
      request: { select: { id: true, status: true, employee: { select: { id: true, fullName: true, code: true } } } },
    },
    orderBy: { startDate: "asc" },
  });
  res.json(rows.map((l) => ({
    requestId: l.request.id, status: l.request.status, employee: l.request.employee,
    leaveType: l.leaveType.name, code: l.leaveType.code, startDate: ymd(l.startDate), endDate: ymd(l.endDate), days: Number(l.days),
  })));
});
