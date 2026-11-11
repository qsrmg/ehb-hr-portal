import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { getSettings, settingNumber } from "../lib/settings.js";
import { todayYmd } from "../lib/dates.js";
import type { StepSpec } from "./approvals.js";

export const TRAINING_TYPE_LABELS = {
  COURSE: "Course",
  WORKSHOP: "Workshop",
  CONFERENCE: "Conference",
  CERTIFICATION: "Certification",
  OTHER: "Other",
} as const;

export const trainingSchema = z.object({
  programmeTitle: z.string().trim().min(3, "Give the programme title").max(150),
  provider: z.string().trim().min(2, "Give the training provider").max(150),
  trainingType: z.enum(Object.keys(TRAINING_TYPE_LABELS) as [keyof typeof TRAINING_TYPE_LABELS, ...(keyof typeof TRAINING_TYPE_LABELS)[]], { message: "Choose the training type" }),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD for the start date"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD for the end date"),
  mode: z.enum(["ONLINE", "ON_SITE"], { message: "Choose online or on-site" }),
  location: z.string().trim().max(150).optional().default(""),
  estimatedCost: z.coerce
    .number()
    .positive("The estimated cost must be more than 0")
    .max(100_000_000)
    .refine((v) => Number.isInteger(Math.round(v * 100)) && Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "The estimated cost can have at most 2 decimals"),
  justification: z.string().trim().min(5, "Explain why this training is needed"),
});

export type TrainingInput = z.infer<typeof trainingSchema>;

/** Checks the programme dates and location before anything is saved. */
export function evaluateTraining(input: TrainingInput): string[] {
  const errors: string[] = [];
  if (input.startDate < todayYmd()) errors.push("The start date cannot be in the past");
  if (input.endDate < input.startDate) errors.push("The end date cannot be before the start date");
  if (input.mode === "ON_SITE" && !input.location) errors.push("Give the location for an on-site programme");
  return errors;
}

export async function trainingRules() {
  const s = await getSettings();
  return { managementApprovalAbove: settingNumber(s, "training.managementApprovalAbove") };
}

/** Finance: not the requester and not anyone who approved an earlier step; Management stands in if nobody else holds the role. */
const FINANCE_STEP: StepSpec = {
  label: "Finance",
  approver: "FINANCE",
  excludePriorApprovers: true,
  fallback: { label: "Management (in place of Finance)", approver: "MANAGEMENT" },
};

/**
 * Line Manager -> HOD -> Finance. The engine skips the HOD when they are also the line manager. A HOD, or
 * someone with no manager, goes to Management first. Programmes above the cost setting add a Management step.
 * This chain is proposed (the project overview's roles table only says Finance approves training); see
 * DECISIONS.md for HR and Finance to confirm it.
 */
export async function trainingChain(employeeId: number, needsManagement: boolean): Promise<StepSpec[]> {
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
