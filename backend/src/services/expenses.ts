import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { getSettings, settingNumber } from "../lib/settings.js";
import { addDays, isYmd, MONTHS, toDate, todayYmd, ymd } from "../lib/dates.js";
import type { StepSpec } from "./approvals.js";
import type { ExpenseLine } from "../generated/prisma/client.js";

export const expenseLineSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD for each date"),
  categoryId: z.coerce.number().int(),
  description: z.string().trim().min(3, "Describe each expense"),
  amount: z.coerce
    .number()
    .positive("Each amount must be more than 0")
    .max(100_000_000)
    .refine((v) => Number.isInteger(Math.round(v * 100)) && Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "Amounts can have at most 2 decimals"),
  noReceiptExplanation: z.string().trim().max(500).optional().default(""),
  allowanceJustification: z.string().trim().max(500).optional().default(""),
  /** Resubmitting: keep the receipt already uploaded for this line. */
  keepReceiptId: z.coerce.number().int().optional(),
  /** Live check only: the form says whether a receipt file is chosen. */
  hasReceipt: z.boolean().optional(),
});

export const expenseClaimSchema = z.object({
  purpose: z.string().trim().min(3, "Give the purpose of the claim"),
  lines: z.array(expenseLineSchema).min(1, "Add at least one expense").max(30, "At most 30 expenses per claim"),
});

export type ExpenseLineInput = z.infer<typeof expenseLineSchema> & { hasReceipt: boolean };

export const round2 = (n: number) => Math.round(n * 100) / 100;
export const pkr = (n: number) => `PKR ${n.toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

/** What a line is worth after Finance: as claimed, reduced, or 0 when rejected. */
export const lineApproved = (l: Pick<ExpenseLine, "status" | "amount" | "approvedAmount">) =>
  l.status === "CLAIMED" ? Number(l.amount) : Number(l.approvedAmount ?? 0);

export async function expenseRules() {
  const s = await getSettings();
  return {
    maxPerClaim: settingNumber(s, "expense.maxPerClaim"),
    maxPerMonth: settingNumber(s, "expense.maxPerMonth"),
    managementApprovalAbove: settingNumber(s, "expense.managementApprovalAbove"),
    receiptOptionalBelow: settingNumber(s, "expense.receiptOptionalBelow") ?? 0,
    maxAgeDays: Number(s["expense.maxAgeDays"]),
  };
}

/** Lines in the employee's other open or approved claims, per month, as they count towards limits. */
async function otherClaimLines(employeeId: number, months: string[], excludeRequestId?: number) {
  if (!months.length) return [];
  const sorted = [...months].sort();
  const [ly, lm] = sorted[sorted.length - 1]!.split("-").map(Number) as [number, number];
  const rows = await prisma.expenseLine.findMany({
    where: {
      date: { gte: toDate(`${sorted[0]}-01`), lte: new Date(Date.UTC(ly, lm, 0)) },
      claim: { travelId: null, request: { employeeId, status: { in: ["PENDING", "RETURNED", "APPROVED"] }, ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}) } },
    },
    select: { date: true, categoryId: true, amount: true, approvedAmount: true, status: true },
  });
  return rows.map((l) => ({ month: ymd(l.date).slice(0, 7), categoryId: l.categoryId, value: lineApproved(l) }));
}

/**
 * Checks a claim against the rules. Returns problems instead of throwing so the form can show them live.
 * Errors block submission; warnings (salary allowance, possible duplicate) do not.
 */
export async function evaluateExpense(employeeId: number, lines: ExpenseLineInput[], excludeRequestId?: number) {
  const rules = await expenseRules();
  const categories = new Map((await prisma.expenseCategory.findMany()).map((c) => [c.id, c]));
  const errors: string[] = [];
  const warnings: string[] = [];
  const today = todayYmd();
  const oldest = ymd(addDays(toDate(today), -rules.maxAgeDays));

  lines.forEach((l, i) => {
    const n = `Line ${i + 1}`;
    const cat = categories.get(l.categoryId);
    if (!cat || !cat.active) errors.push(`${n}: choose a category`);
    else if (cat.scope !== "LOCAL") errors.push(`${n}: ${cat.name} is a travel cost; claim it in the trip settlement`);
    if (!isYmd(l.date)) errors.push(`${n}: the date is not valid`);
    else if (l.date > today) errors.push(`${n}: the date is in the future`);
    else if (l.date < oldest) errors.push(`${n}: expenses older than ${rules.maxAgeDays} days cannot be claimed`);
    if (!l.hasReceipt) {
      if (l.amount >= rules.receiptOptionalBelow) errors.push(`${n}: attach a receipt (required for ${pkr(rules.receiptOptionalBelow)} and above)`);
      else if (!l.noReceiptExplanation) errors.push(`${n}: attach a receipt or explain why there is none`);
    }
    if (cat?.allowanceWarning) {
      warnings.push(`${n}: you already receive a ${cat.name} allowance in your salary`);
      if (!l.allowanceJustification) errors.push(`${n}: explain why this ${cat.name} cost is not covered by your salary allowance`);
    }
  });

  const total = round2(lines.reduce((s, l) => s + l.amount, 0));
  if (rules.maxPerClaim != null && total > rules.maxPerClaim) {
    errors.push(`The claim total ${pkr(total)} is above the limit of ${pkr(rules.maxPerClaim)} per claim`);
  }

  // Monthly limits (overall and per category) count this claim plus the employee's other open or approved claims.
  const dated = lines.filter((l) => isYmd(l.date));
  const months = [...new Set(dated.map((l) => l.date.slice(0, 7)))];
  const others = await otherClaimLines(employeeId, months, excludeRequestId);
  for (const month of months) {
    const mine = dated.filter((l) => l.date.startsWith(month));
    const theirs = others.filter((o) => o.month === month);
    if (rules.maxPerMonth != null) {
      const before = round2(theirs.reduce((s, o) => s + o.value, 0));
      const after = round2(before + mine.reduce((s, l) => s + l.amount, 0));
      if (after > rules.maxPerMonth) {
        errors.push(`${monthLabel(month)}: ${pkr(after)} in total is above the monthly limit of ${pkr(rules.maxPerMonth)}${before ? ` (${pkr(before)} already claimed)` : ""}`);
      }
    }
    for (const categoryId of new Set(mine.map((l) => l.categoryId))) {
      const cat = categories.get(categoryId);
      if (!cat || cat.monthlyLimit == null) continue;
      const limit = Number(cat.monthlyLimit);
      const before = round2(theirs.filter((o) => o.categoryId === categoryId).reduce((s, o) => s + o.value, 0));
      const after = round2(before + mine.filter((l) => l.categoryId === categoryId).reduce((s, l) => s + l.amount, 0));
      if (after > limit) {
        errors.push(`${monthLabel(month)}: ${cat.name} totals ${pkr(after)}, above its monthly limit of ${pkr(limit)}${before ? ` (${pkr(before)} already claimed)` : ""}`);
      }
    }
  }

  // Possible duplicates: same date, category and amount in another claim, or twice in this one.
  const valid = dated.filter((l) => categories.has(l.categoryId));
  if (valid.length) {
    const matches = await prisma.expenseLine.findMany({
      where: {
        claim: { travelId: null, request: { employeeId, status: { notIn: ["CANCELLED", "REJECTED"] }, ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}) } },
        OR: valid.map((l) => ({ date: toDate(l.date), categoryId: l.categoryId, amount: l.amount })),
      },
      select: { date: true, categoryId: true, amount: true, claim: { select: { requestId: true } } },
    });
    lines.forEach((l, i) => {
      const other = matches.find((m) => ymd(m.date) === l.date && m.categoryId === l.categoryId && Number(m.amount) === l.amount);
      if (other) warnings.push(`Line ${i + 1}: looks like a duplicate of an expense in claim #${other.claim.requestId} (same date, category and amount)`);
      const twin = lines.findIndex((x, j) => j < i && x.date === l.date && x.categoryId === l.categoryId && x.amount === l.amount);
      if (twin >= 0) warnings.push(`Line ${i + 1}: same date, category and amount as line ${twin + 1}`);
    });
  }

  const needsManagement = rules.managementApprovalAbove != null && total > rules.managementApprovalAbove;
  return { total, errors, warnings, needsManagement, rules };
}

/** Finance: not the claimant and not anyone who approved an earlier step; if nobody is left, Management stands in. */
export const FINANCE_STEP: StepSpec = {
  label: "Finance",
  approver: "FINANCE",
  excludePriorApprovers: true,
  fallback: { label: "Management (in place of Finance)", approver: "MANAGEMENT" },
};

/**
 * Line Manager → HOD → Finance. The engine skips the HOD when they are also the line manager.
 * A HOD, or someone with no manager, goes to Management first. Claims above the setting add a Management step.
 */
export async function expenseChain(employeeId: number, needsManagement: boolean): Promise<StepSpec[]> {
  const emp = await prisma.employee.findUniqueOrThrow({
    where: { id: employeeId },
    select: { managerId: true, manager: { select: { roles: true } }, department: { select: { hodId: true } } },
  });
  const finance = FINANCE_STEP;
  const management: StepSpec = { label: "Management", approver: "MANAGEMENT" };
  if (!emp.managerId || emp.department?.hodId === employeeId) return [management, finance];
  const managerIsManagement = emp.manager?.roles.includes("MANAGEMENT") ?? false;
  return [
    { label: "Line Manager", approver: "LINE_MANAGER" },
    { label: "Head of Department", approver: "HOD" },
    ...(needsManagement && !managerIsManagement ? [management] : []),
    finance,
  ];
}
