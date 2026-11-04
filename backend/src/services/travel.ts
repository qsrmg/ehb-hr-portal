import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { getSettings, settingNumber } from "../lib/settings.js";
import { addDays, isYmd, toDate, todayYmd, ymd } from "../lib/dates.js";
import { expenseRules, FINANCE_STEP, lineApproved, pkr, round2 } from "./expenses.js";
import type { StepSpec } from "./approvals.js";
import type { ExpenseLine, Prisma } from "../generated/prisma/client.js";

export const TRAVEL_MODES = ["AIR", "TRAIN", "BUS", "COMPANY_CAR", "OWN_CAR", "OTHER"] as const;
export const MODE_LABELS: Record<(typeof TRAVEL_MODES)[number], string> = {
  AIR: "Air", TRAIN: "Train", BUS: "Bus", COMPANY_CAR: "Company car", OWN_CAR: "Own car", OTHER: "Other",
};
/** Modes Admin books a ticket for. */
const BOOKED_MODES = new Set(["AIR", "TRAIN", "BUS"]);

const money = z.coerce
  .number()
  .min(0, "Amounts cannot be negative")
  .max(100_000_000)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "Amounts can have at most 2 decimals");
// Multipart forms send booleans as text.
const bool = z.preprocess((v) => v === true || v === "true" || v === "on", z.boolean());
const ymdField = (label: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `Enter the ${label}`);

export const travelSchema = z.object({
  purpose: z.string().trim().min(3, "Give the purpose of the trip"),
  origin: z.string().trim().min(2, "Enter where you travel from"),
  destination: z.string().trim().min(2, "Enter the destination"),
  country: z.string().trim().toUpperCase().default("PK"),
  departDate: ymdField("departure date"),
  returnDate: ymdField("return date"),
  mode: z.enum(TRAVEL_MODES, { message: "Choose how you will travel" }),
  needsHotel: bool.default(false),
  estimateTransport: money.default(0),
  estimateHotel: money.default(0),
  estimateMeals: money.default(0),
  estimateOther: money.default(0),
  advanceRequested: money.default(0),
});
export type TravelInput = z.infer<typeof travelSchema>;

export async function travelRules() {
  const s = await getSettings();
  return {
    managementApprovalAbove: settingNumber(s, "travel.managementApprovalAbove"),
    maxAdvance: settingNumber(s, "travel.maxAdvance"),
    perDiemRate: settingNumber(s, "travel.perDiemRate"),
    mileageRatePerKm: settingNumber(s, "travel.mileageRatePerKm"),
    hotelLimitPerNight: settingNumber(s, "travel.hotelLimitPerNight"),
    settlementDays: Number(s["travel.settlementDays"]),
  };
}

export const tripDays = (depart: Date, ret: Date) => Math.round((ret.getTime() - depart.getTime()) / 86_400_000) + 1;
const tripNights = (depart: Date, ret: Date) => Math.max(1, tripDays(depart, ret) - 1);

/** Checks a travel request. Returns problems instead of throwing so a form could preview them. */
export async function evaluateTravel(employeeId: number, input: TravelInput, excludeRequestId?: number) {
  const rules = await travelRules();
  const errors: string[] = [];
  if (input.country !== "PK") errors.push("Only domestic travel (within Pakistan) can be requested for now");
  if (!isYmd(input.departDate) || !isYmd(input.returnDate)) errors.push("Enter valid travel dates");
  else {
    if (input.departDate < todayYmd()) errors.push("The departure date is in the past");
    if (input.returnDate < input.departDate) errors.push("The return date is before the departure date");
  }
  const estimatedTotal = round2(input.estimateTransport + input.estimateHotel + input.estimateMeals + input.estimateOther);
  if (input.advanceRequested > estimatedTotal) errors.push(`The advance cannot be more than the estimated cost (${pkr(estimatedTotal)})`);
  if (rules.maxAdvance != null && input.advanceRequested > rules.maxAdvance) {
    errors.push(`The advance is above the limit of ${pkr(rules.maxAdvance)} per trip`);
  }
  if (isYmd(input.departDate) && isYmd(input.returnDate) && input.returnDate >= input.departDate) {
    const overlap = await prisma.travelRequest.findFirst({
      where: {
        cancelledAt: null,
        departDate: { lte: toDate(input.returnDate) },
        returnDate: { gte: toDate(input.departDate) },
        request: { employeeId, status: { in: ["PENDING", "APPROVED", "RETURNED"] }, ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}) },
      },
      select: { requestId: true },
    });
    if (overlap) errors.push(`These dates overlap with travel request #${overlap.requestId}`);
  }
  return {
    errors,
    estimatedTotal,
    needsManagement: rules.managementApprovalAbove != null && estimatedTotal > rules.managementApprovalAbove,
    needsFinance: input.advanceRequested > 0,
    bookingNeeded: BOOKED_MODES.has(input.mode) || input.needsHotel,
  };
}

/** Line Manager → HOD (asked once if the same person), + Management above the threshold, + Finance when an advance is requested. */
export async function travelChain(employeeId: number, needsManagement: boolean, needsFinance: boolean): Promise<StepSpec[]> {
  const emp = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { manager: { select: { roles: true } } } });
  const managerIsManagement = emp.manager?.roles.includes("MANAGEMENT") ?? false;
  return [
    { label: "Line Manager", approver: "LINE_MANAGER" },
    { label: "Head of Department", approver: "HOD" },
    ...(needsManagement && !managerIsManagement ? [{ label: "Management", approver: "MANAGEMENT" } as StepSpec] : []),
    ...(needsFinance ? [FINANCE_STEP] : []),
  ];
}

/** Settlement: Line Manager → Finance (Finance separation rule and Management stand-in apply). */
export const SETTLEMENT_CHAIN: StepSpec[] = [{ label: "Line Manager", approver: "LINE_MANAGER" }, FINANCE_STEP];

export const settlementLineSchema = z.object({
  kind: z.enum(["STANDARD", "HOTEL", "PER_DIEM", "MILEAGE"]).default("STANDARD"),
  date: ymdField("date of each expense"),
  categoryId: z.coerce.number().int().optional(),
  description: z.string().trim().min(3, "Describe each expense"),
  amount: money.default(0),
  /** Nights (hotel), days (daily allowance) or km (mileage). */
  quantity: z.coerce.number().positive().optional(),
  noReceiptExplanation: z.string().trim().max(500).optional().default(""),
  keepReceiptId: z.coerce.number().int().optional(),
  hasReceipt: z.boolean().optional(),
});
export type SettlementLineInput = z.infer<typeof settlementLineSchema> & { hasReceipt: boolean };

export const KIND_LABELS = { STANDARD: "Expense", HOTEL: "Hotel", PER_DIEM: "Daily allowance", MILEAGE: "Mileage (own car)" } as const;

export const travelInclude = {
  request: { select: { id: true, employeeId: true, status: true } },
  bookings: true,
  settlement: { select: { requestId: true, request: { select: { status: true } } } },
} satisfies Prisma.TravelRequestInclude;
export type TripForSettlement = Prisma.TravelRequestGetPayload<{ include: typeof travelInclude }>;

/** Settlement window: from the return date until N days after it. */
export function settlementWindow(trip: { returnDate: Date }, settlementDays: number) {
  const opens = ymd(trip.returnDate);
  const closes = ymd(addDays(trip.returnDate, settlementDays));
  return { opens, closes };
}

/**
 * Checks a trip settlement. Daily allowance and mileage are computed from the rate settings, so their
 * amounts are returned too. Errors block submission; warnings do not.
 */
export async function evaluateSettlement(employeeId: number, trip: TripForSettlement, lines: SettlementLineInput[], excludeRequestId?: number) {
  const rules = await travelRules();
  const { receiptOptionalBelow } = await expenseRules();
  const categories = new Map((await prisma.expenseCategory.findMany({ where: { scope: "TRAVEL" } })).map((c) => [c.id, c]));
  const errors: string[] = [];
  const warnings: string[] = [];
  const today = todayYmd();
  const depart = ymd(trip.departDate);
  const ret = ymd(trip.returnDate);
  const days = tripDays(trip.departDate, trip.returnDate);
  const nights = tripNights(trip.departDate, trip.returnDate);
  const window = settlementWindow(trip, rules.settlementDays);

  if (trip.request.employeeId !== employeeId) errors.push("Only the traveller can settle this trip");
  if (trip.request.status !== "APPROVED" || trip.cancelledAt) errors.push("Only an approved trip that was not cancelled can be settled");
  if (today < window.opens) errors.push(`You can submit the settlement after you return on ${window.opens}`);
  if (today > window.closes) errors.push(`The settlement had to be submitted within ${rules.settlementDays} days of return (by ${window.closes})`);
  if (trip.settlement && trip.settlement.requestId !== excludeRequestId && !["CANCELLED", "REJECTED"].includes(trip.settlement.request.status)) {
    errors.push(`This trip already has a settlement (#${trip.settlement.requestId})`);
  }

  const computed = lines.map((l, i) => {
    const n = `Line ${i + 1}`;
    let amount = l.amount;
    let rate: number | null = null;
    if (!isYmd(l.date) || l.date < depart || l.date > ret) errors.push(`${n}: the date must be during the trip (${depart} to ${ret})`);
    const needsReceipt = () => {
      if (l.hasReceipt) return;
      if (amount >= receiptOptionalBelow) errors.push(`${n}: attach a receipt (required for ${pkr(receiptOptionalBelow)} and above)`);
      else if (!l.noReceiptExplanation) errors.push(`${n}: attach a receipt or explain why there is none`);
    };
    if (l.kind === "STANDARD") {
      const cat = l.categoryId ? categories.get(l.categoryId) : undefined;
      if (!cat || !cat.active) errors.push(`${n}: choose a travel category`);
      else if (cat.coveredByPerDiem && rules.perDiemRate != null) errors.push(`${n}: ${cat.name} is covered by the daily allowance; claim the daily allowance instead`);
      if (amount <= 0) errors.push(`${n}: the amount must be more than 0`);
      needsReceipt();
    } else if (l.kind === "HOTEL") {
      const q = l.quantity ?? 0;
      if (!Number.isInteger(q) || q < 1) errors.push(`${n}: enter the number of hotel nights`);
      if (amount <= 0) errors.push(`${n}: the amount must be more than 0`);
      if (rules.hotelLimitPerNight != null && q >= 1 && amount > q * rules.hotelLimitPerNight) {
        errors.push(`${n}: ${pkr(amount)} for ${q} night(s) is above the hotel limit of ${pkr(rules.hotelLimitPerNight)} per night`);
      }
      needsReceipt();
      if (trip.bookings.some((b) => b.kind === "HOTEL" && b.arrangedBy === "ADMIN")) warnings.push(`${n}: Admin already booked a hotel for this trip, paid by the company`);
    } else if (l.kind === "PER_DIEM") {
      const q = l.quantity ?? 0;
      if (rules.perDiemRate == null) errors.push(`${n}: the daily allowance is not offered; claim meals with receipts`);
      else if (!Number.isInteger(q) || q < 1) errors.push(`${n}: enter the number of days`);
      rate = rules.perDiemRate;
      amount = rate != null ? round2(q * rate) : 0;
    } else {
      const q = l.quantity ?? 0;
      if (rules.mileageRatePerKm == null) errors.push(`${n}: mileage cannot be claimed (no rate is set)`);
      else if (q <= 0) errors.push(`${n}: enter the distance in km`);
      rate = rules.mileageRatePerKm;
      amount = rate != null ? round2(q * rate) : 0;
    }
    return { ...l, amount, rate };
  });

  const hotelNights = lines.filter((l) => l.kind === "HOTEL").reduce((s, l) => s + (l.quantity ?? 0), 0);
  if (hotelNights > nights) errors.push(`Hotel nights (${hotelNights}) are more than the trip's ${nights} night(s)`);
  const allowanceDays = lines.filter((l) => l.kind === "PER_DIEM").reduce((s, l) => s + (l.quantity ?? 0), 0);
  if (allowanceDays > days) errors.push(`Daily allowance days (${allowanceDays}) are more than the trip's ${days} day(s)`);
  if (trip.bookings.some((b) => b.arrangedBy === "ADMIN" && b.kind !== "HOTEL") && lines.some((l) => l.kind === "STANDARD" && categories.get(l.categoryId ?? 0)?.name.startsWith("Fare"))) {
    warnings.push("Admin booked tickets for this trip; only claim fares you arranged yourself");
  }

  const total = round2(computed.reduce((s, l) => s + l.amount, 0));
  const advancePaid = trip.advancePaidAt ? Number(trip.advanceRequested) : 0;
  return { lines: computed, total, advancePaid, net: round2(total - advancePaid), errors, warnings, rules, window, days, nights };
}

/** What the settlement is worth after Finance changes. */
export const approvedTotal = (lines: Pick<ExpenseLine, "status" | "amount" | "approvedAmount">[]) => round2(lines.reduce((s, l) => s + lineApproved(l), 0));

type TripMoney = {
  advanceRequested: Prisma.Decimal | number;
  advancePaidAt: Date | null;
  advanceReturnedAmount: Prisma.Decimal | number | null;
  cancelledAt: Date | null;
  settlement: { request: { status: string }; lines: Pick<ExpenseLine, "status" | "amount" | "approvedAmount">[] } | null;
};

/**
 * Advance the employee still has to return: all of it when the trip was cancelled, or what the approved
 * settlement did not use. Zero once Finance has recorded the return.
 */
export function advanceDue(trip: TripMoney) {
  if (!trip.advancePaidAt || trip.advanceReturnedAmount != null) return 0;
  const advance = Number(trip.advanceRequested);
  if (trip.cancelledAt) return advance;
  if (trip.settlement?.request.status === "APPROVED") return Math.max(0, round2(advance - approvedTotal(trip.settlement.lines)));
  return 0;
}
