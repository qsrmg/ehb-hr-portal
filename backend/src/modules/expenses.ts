import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { audit } from "../lib/audit.js";
import { notify } from "../lib/notify.js";
import { todayYmd, toDate, ymd } from "../lib/dates.js";
import { HttpError } from "../middleware/error.js";
import { currentUser, hasRole, requireAuth, requireRole } from "../middleware/auth.js";
import { canActOnStep, priorApproverIds, resolveSteps } from "../services/approvals.js";
import { evaluateExpense, expenseChain, expenseLineSchema, lineApproved, pkr, round2 } from "../services/expenses.js";
import { KIND_LABELS } from "../services/travel.js";
import type { ExpenseCategory, Prisma } from "../generated/prisma/client.js";

export const expensesRouter = Router();
expensesRouter.use(requireAuth);

const issues = (e: z.ZodError) => e.issues.map((i) => `${i.path.length ? `${i.path.join(".")}: ` : ""}${i.message}`).join("; ");

const serializeCategory = (c: ExpenseCategory) => ({ ...c, monthlyLimit: c.monthlyLimit == null ? null : Number(c.monthlyLimit) });

// ---------- Categories (HR / Finance) ----------

expensesRouter.get("/categories", async (req, res) => {
  const all = req.query.all === "1" && hasRole(currentUser(req), "HR", "FINANCE");
  // Expense Claim lists local categories; the trip settlement asks for ?scope=TRAVEL.
  const scope = req.query.scope === "TRAVEL" ? "TRAVEL" : req.query.scope === "ALL" ? undefined : "LOCAL";
  const rows = await prisma.expenseCategory.findMany({
    where: { ...(all ? {} : { active: true }), ...(scope && !all ? { scope } : {}) },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  res.json(rows.map(serializeCategory));
});

const categorySchema = z.object({
  name: z.string().trim().min(2, "Give the category a name").max(60),
  accountingCode: z.string().trim().max(30).nullable().optional().transform((v) => v || null),
  monthlyLimit: z.number().positive().nullable().optional(),
  allowanceWarning: z.boolean().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  scope: z.enum(["LOCAL", "TRAVEL"]).optional(),
  coveredByPerDiem: z.boolean().optional(),
});

const uniqueName = (err: unknown): never => {
  if (err && typeof err === "object" && "code" in err && err.code === "P2002") throw new HttpError(409, "A category with this name already exists");
  throw err;
};

expensesRouter.post("/categories", requireRole("HR", "FINANCE"), async (req, res) => {
  const parsed = categorySchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, issues(parsed.error));
  const c = await prisma.expenseCategory.create({ data: parsed.data }).catch(uniqueName);
  await audit(currentUser(req).id, "CREATE", "ExpenseCategory", c.id, parsed.data as Prisma.InputJsonValue);
  res.status(201).json(serializeCategory(c));
});

expensesRouter.put("/categories/:id", requireRole("HR", "FINANCE"), async (req, res) => {
  const parsed = categorySchema.partial().safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, issues(parsed.error));
  const id = Number(req.params.id);
  const before = await prisma.expenseCategory.findUnique({ where: { id } });
  if (!before) throw new HttpError(404, "Category not found");
  const c = await prisma.expenseCategory.update({ where: { id }, data: parsed.data }).catch(uniqueName);
  await audit(currentUser(req).id, "UPDATE", "ExpenseCategory", id, { before: serializeCategory(before), after: parsed.data } as Prisma.InputJsonValue);
  res.json(serializeCategory(c));
});

// ---------- Live check for the claim form ----------

const checkSchema = z.object({
  lines: z.array(expenseLineSchema.extend({ hasReceipt: z.boolean() })).min(1).max(30),
  excludeRequestId: z.number().int().optional(),
});

/** Total, errors, warnings and who will approve, before the employee submits. */
expensesRouter.post("/check", async (req, res) => {
  const user = currentUser(req);
  const parsed = checkSchema.safeParse(req.body);
  if (!parsed.success) return res.json({ total: 0, errors: [issues(parsed.error)], warnings: [], approvers: [], rules: null });
  const result = await evaluateExpense(user.id, parsed.data.lines, parsed.data.excludeRequestId);
  const steps = await prisma.$transaction(async (tx) => resolveSteps(tx, user.id, await expenseChain(user.id, result.needsManagement)));
  const names = await prisma.employee.findMany({ where: { id: { in: steps.flatMap((s) => (s.approverId ? [s.approverId] : [])) } }, select: { id: true, fullName: true } });
  res.json({
    total: result.total,
    errors: result.errors,
    warnings: result.warnings,
    rules: result.rules,
    approvers: steps.map((s) => (s.approverId ? `${s.label} (${names.find((n) => n.id === s.approverId)?.fullName})` : s.label)),
  });
});

// ---------- Finance: adjust single lines at the Finance step ----------

const adjustSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("REDUCE"), amount: z.number().nonnegative(), reason: z.string().trim().min(3, "Give a reason") }),
  z.object({ action: z.literal("REJECT"), reason: z.string().trim().min(3, "Give a reason") }),
  z.object({ action: z.literal("RESET") }),
]);

async function loadClaim(requestId: number) {
  const request = await prisma.request.findUnique({
    where: { id: requestId },
    include: { steps: true, expenseClaim: { include: { lines: { orderBy: { order: "asc" }, include: { category: true } }, travel: true } } },
  });
  if (!request || !["EXPENSE", "TRAVEL_SETTLEMENT"].includes(request.type) || !request.expenseClaim) throw new HttpError(404, "Expense claim not found");
  return { request, claim: request.expenseClaim };
}

expensesRouter.post("/claims/:requestId/lines/:lineId/adjust", async (req, res) => {
  const user = currentUser(req);
  const parsed = adjustSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, issues(parsed.error));
  const { request, claim } = await loadClaim(Number(req.params.requestId));
  if (request.status !== "PENDING") throw new HttpError(400, "Lines can only be changed while the claim is waiting for Finance");
  const step = request.steps.find((s) => s.order === request.currentStep);
  if (!step || step.approverRole !== "FINANCE" || !canActOnStep(user, request.employeeId, step, priorApproverIds(request.steps, step.order))) {
    throw new HttpError(403, "Only Finance can change line amounts, once the claim reaches the Finance step");
  }
  const line = claim.lines.find((l) => l.id === Number(req.params.lineId));
  if (!line) throw new HttpError(404, "Line not found");
  const claimed = Number(line.amount);
  const n = `Line ${line.order + 1} (${line.category?.name ?? KIND_LABELS[line.kind]}, ${line.description})`;

  let data: Prisma.ExpenseLineUpdateInput;
  let summary: string;
  const input = parsed.data;
  if (input.action === "REDUCE") {
    const amount = round2(input.amount);
    if (amount <= 0) throw new HttpError(400, "To pay nothing for this line, reject it instead");
    if (amount >= claimed) throw new HttpError(400, `The reduced amount must be less than the claimed ${pkr(claimed)}`);
    data = { status: "REDUCED", approvedAmount: amount, financeReason: input.reason };
    summary = `${n}: ${pkr(claimed)} reduced to ${pkr(amount)}. Reason: ${input.reason}`;
  } else if (input.action === "REJECT") {
    data = { status: "REJECTED", approvedAmount: 0, financeReason: input.reason };
    summary = `${n}: ${pkr(claimed)} rejected. Reason: ${input.reason}`;
  } else {
    data = { status: "CLAIMED", approvedAmount: null, financeReason: null };
    summary = `${n}: restored to the claimed ${pkr(claimed)}`;
  }

  await prisma.$transaction([
    prisma.expenseLine.update({ where: { id: line.id }, data }),
    prisma.requestAction.create({ data: { requestId: request.id, actorId: user.id, action: `LINE_${input.action}`, stepOrder: step.order, comment: summary } }),
  ]);
  await audit(user.id, "UPDATE", "ExpenseLine", line.id, { requestId: request.id, action: input.action, summary });
  await notify([request.employeeId], `Finance changed your claim: ${request.title}`, summary, `/requests/${request.id}`);

  const lines = await prisma.expenseLine.findMany({ where: { claimId: claim.id } });
  res.json({ totalApproved: round2(lines.reduce((s, l) => s + lineApproved(l), 0)) });
});

// ---------- Finance: mark an approved claim as paid ----------

const paidSchema = z.object({
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the payment date"),
  method: z.enum(["BANK_TRANSFER", "WITH_SALARY"], { message: "Choose bank transfer or with salary" }),
  reference: z.string().trim().min(1, "Enter the payment reference").max(100),
});

const METHOD_LABELS = { BANK_TRANSFER: "bank transfer", WITH_SALARY: "with salary" } as const;

expensesRouter.post("/claims/:requestId/paid", requireRole("FINANCE"), async (req, res) => {
  const user = currentUser(req);
  const parsed = paidSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, issues(parsed.error));
  const { request, claim } = await loadClaim(Number(req.params.requestId));
  if (request.status !== "APPROVED") throw new HttpError(400, "Only approved claims can be marked as paid");
  if (claim.paidAt) throw new HttpError(400, "This claim is already marked as paid");
  if (request.employeeId === user.id) throw new HttpError(403, "You cannot mark your own claim as paid");
  if (parsed.data.paidOn > todayYmd()) throw new HttpError(400, "The payment date cannot be in the future");

  // A travel settlement pays the approved total minus the advance already paid.
  const advance = claim.travel?.advancePaidAt ? Number(claim.travel.advanceRequested) : 0;
  const amount = round2(claim.lines.reduce((s, l) => s + lineApproved(l), 0) - advance);
  if (amount <= 0) throw new HttpError(400, "Nothing is owed to the employee: the advance covers this settlement");
  const summary = `${pkr(amount)} paid by ${METHOD_LABELS[parsed.data.method]} on ${parsed.data.paidOn}, reference ${parsed.data.reference}`;
  await prisma.$transaction([
    prisma.expenseClaim.update({
      where: { id: claim.id },
      data: { paidOn: toDate(parsed.data.paidOn), paymentMethod: parsed.data.method, paymentReference: parsed.data.reference, paidAt: new Date(), paidById: user.id },
    }),
    prisma.requestAction.create({ data: { requestId: request.id, actorId: user.id, action: "PAID", comment: summary } }),
  ]);
  await audit(user.id, "UPDATE", "ExpenseClaim", claim.id, { requestId: request.id, paid: summary });
  await notify([request.employeeId], `Paid: ${request.title}`, `Your expense claim has been paid: ${summary}.`, `/requests/${request.id}`);
  res.json({ ok: true });
});

// ---------- Claim lists for Finance / HR / Management ----------

expensesRouter.get("/claims", requireRole("FINANCE", "HR", "MANAGEMENT"), async (req, res) => {
  const view = typeof req.query.view === "string" ? req.query.view : "to-pay";
  const where: Prisma.ExpenseClaimWhereInput =
    view === "to-pay" ? { paidAt: null, request: { status: "APPROVED" } }
    : view === "paid" ? { paidAt: { not: null } }
    : view === "pending" ? { request: { status: { in: ["PENDING", "RETURNED"] } } }
    : {};
  const rows = await prisma.expenseClaim.findMany({
    where: { ...where, travelId: null, request: { ...(where.request as object), type: "EXPENSE" } },
    include: {
      lines: true,
      paidBy: { select: { fullName: true } },
      request: { select: { id: true, status: true, createdAt: true, updatedAt: true, employee: { select: { fullName: true, code: true, department: { select: { name: true } } } } } },
    },
    orderBy: { request: { updatedAt: "desc" } },
    take: 200,
  });
  res.json(rows.map((c) => ({
    requestId: c.request.id,
    status: c.request.status,
    employee: { fullName: c.request.employee.fullName, code: c.request.employee.code, department: c.request.employee.department?.name ?? null },
    purpose: c.purpose,
    items: c.lines.length,
    totalClaimed: Number(c.totalClaimed),
    totalApproved: round2(c.lines.reduce((s, l) => s + lineApproved(l), 0)),
    submittedAt: c.request.createdAt,
    decidedAt: c.request.status === "APPROVED" ? c.request.updatedAt : null,
    paid: c.paidAt ? { paidOn: c.paidOn ? ymd(c.paidOn) : null, method: c.paymentMethod, reference: c.paymentReference, paidBy: c.paidBy?.fullName ?? null } : null,
  })));
});
