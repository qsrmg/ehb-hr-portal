import fs from "node:fs";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { audit } from "../lib/audit.js";
import { getSettings } from "../lib/settings.js";
import {
  requestFilesUpload, absoluteUploadPath, relativeUploadPath, removeFiles,
} from "../lib/upload.js";
import { hmToMinutes, isWeekend, minutesToHm, monthRange, toDate, todayYmd, ymd } from "../lib/dates.js";
import { HttpError } from "../middleware/error.js";
import { currentUser, hasRole, requireAuth, type AuthUser } from "../middleware/auth.js";
import {
  actOnRequest, canActOnStep, cancelRequest, createSteps, notifySubmitted, pendingForUserWhere, priorApproverIds,
  resolveSteps, restartChain, TYPE_LABELS, type OnApproved, type StepSpec,
} from "../services/approvals.js";
import { deductLeave, evaluateLeave } from "../services/leave.js";
import { computeStatus, getAttendanceRules, holidayMap } from "../services/attendance.js";
import { letterPdf } from "../services/pdf.js";
import { evaluateExpense, expenseChain, expenseClaimSchema, lineApproved, pkr, round2 } from "../services/expenses.js";
import {
  advanceDue, approvedTotal, evaluateSettlement, evaluateTravel, KIND_LABELS, MODE_LABELS, SETTLEMENT_CHAIN, settlementLineSchema,
  settlementWindow, travelChain, travelInclude, travelRules, travelSchema, tripDays,
} from "../services/travel.js";
import { travelApproved } from "./travel.js";
import { assetRequestApproved } from "./assets.js";
import {
  createExitCase, daysBetween, exitCaseOpened, handoverFor, handoverWarning, noticeFor, openExitCase, resignationChain,
} from "../services/exits.js";
import type { OnStepApproved } from "../services/approvals.js";
import type { Prisma, RequestType } from "../generated/prisma/client.js";

type Tx = Prisma.TransactionClient;

export const requestsRouter = Router();
requestsRouter.use(requireAuth);

const ymdString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const hm = z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM").optional().or(z.literal("").transform(() => undefined));

const leaveSchema = z.object({
  leaveTypeId: z.coerce.number().int(),
  startDate: ymdString,
  endDate: ymdString,
  reason: z.string().trim().min(3, "Give a reason"),
});

const attendanceUpdateSchema = z.object({
  date: ymdString,
  kind: z.enum(["MISSED_PUNCH", "FIELD_VISIT", "OTHER"]),
  checkIn: hm,
  checkOut: hm,
  reason: z.string().trim().min(3, "Give a reason"),
});

export const LETTER_TYPES = {
  EXPERIENCE: "Experience Letter",
  EMPLOYMENT: "Employment Verification Letter",
  SALARY: "Salary Certificate",
  NOC: "No Objection Certificate",
} as const;

const letterSchema = z.object({
  letterType: z.enum(Object.keys(LETTER_TYPES) as [keyof typeof LETTER_TYPES, ...(keyof typeof LETTER_TYPES)[]]),
  addressedTo: z.string().trim().default("To Whom It May Concern"),
  purpose: z.string().trim().min(3, "Give the purpose of the letter"),
});

type Prepared = {
  title: string;
  data: Prisma.InputJsonValue;
  chain: StepSpec[];
  persist: (tx: Tx, requestId: number, isUpdate: boolean) => Promise<void>;
  /** The form saves its own files (expense receipts are linked to their lines). */
  ownsFiles?: boolean;
};

const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const r = schema.safeParse(body);
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => i.message).join("; "));
  return r.data;
};

/** Validates the form for each request type and returns its approval chain and how to save it. */
async function prepare(
  type: RequestType,
  user: AuthUser,
  body: unknown,
  files: Express.Multer.File[],
  existingAttachmentCount = 0,
  existingId?: number,
): Promise<Prepared> {
  const attachmentCount = existingAttachmentCount + files.length;
  if (type === "LEAVE") {
    const input = parse(leaveSchema, body);
    const result = await evaluateLeave(user.id, input, existingId);
    if (result.documentRequired && attachmentCount === 0) {
      result.errors.push(`A supporting document (e.g. medical certificate) is required for ${result.type.name} longer than ${result.type.documentAfterDays} days`);
    }
    if (result.errors.length) throw new HttpError(400, result.errors.join("; "));
    const days = result.days;
    return {
      title: `${result.type.name} · ${days} day${days === 1 ? "" : "s"} (${input.startDate} to ${input.endDate})`,
      data: { leaveType: result.type.name },
      chain: [
        { label: "Line Manager", approver: "LINE_MANAGER" },
        ...(result.type.needsHrApproval ? [{ label: "HR", approver: "HR" } as StepSpec] : []),
      ],
      persist: async (tx, requestId, isUpdate) => {
        const fields = {
          leaveTypeId: input.leaveTypeId,
          startDate: toDate(input.startDate),
          endDate: toDate(input.endDate),
          days,
          reason: input.reason,
        };
        if (isUpdate) await tx.leaveRequest.update({ where: { requestId }, data: fields });
        else await tx.leaveRequest.create({ data: { requestId, ...fields } });
      },
    };
  }

  if (type === "ATTENDANCE_UPDATE") {
    const input = parse(attendanceUpdateSchema, body);
    const settings = await getSettings();
    const maxPerMonth = Number(settings["attendanceUpdate.maxPerMonth"]);
    const windowDays = Number(settings["attendanceUpdate.windowDays"]);
    const date = toDate(input.date);
    const today = toDate(todayYmd());
    const errors: string[] = [];
    if (date > today) errors.push("You cannot request an update for a future date");
    const age = Math.round((today.getTime() - date.getTime()) / 86_400_000);
    if (age > windowDays) errors.push(`Attendance Update must be requested within ${windowDays} days of the date`);
    if (isWeekend(date) || (await holidayMap(date, date)).size) errors.push("That date is a weekend or public holiday");
    if (input.kind === "MISSED_PUNCH" && !input.checkIn && !input.checkOut) errors.push("Enter the missed check-in or check-out time");
    if (input.checkIn && input.checkOut && hmToMinutes(input.checkOut) <= hmToMinutes(input.checkIn)) errors.push("Check-out must be after check-in");

    const { start, end } = monthRange(date.getUTCFullYear(), date.getUTCMonth() + 1);
    const sameMonth = await prisma.attendanceUpdateRequest.findMany({
      where: {
        date: { gte: start, lte: end },
        request: { employeeId: user.id, status: { in: ["PENDING", "APPROVED", "RETURNED"] }, ...(existingId ? { id: { not: existingId } } : {}) },
      },
      select: { date: true },
    });
    if (sameMonth.length >= maxPerMonth) errors.push(`You have already used ${maxPerMonth} Attendance Update requests this month`);
    if (sameMonth.some((r) => ymd(r.date) === input.date)) errors.push("There is already an Attendance Update request for this date");
    if (errors.length) throw new HttpError(400, errors.join("; "));

    const kindLabel = { MISSED_PUNCH: "Missed punch", FIELD_VISIT: "Field visit", OTHER: "Other" }[input.kind];
    return {
      title: `Attendance Update · ${input.date} (${kindLabel})`,
      data: {},
      chain: [{ label: "Line Manager", approver: "LINE_MANAGER" }],
      persist: async (tx, requestId, isUpdate) => {
        const fields = {
          date,
          kind: input.kind,
          checkIn: input.checkIn ? hmToMinutes(input.checkIn) : null,
          checkOut: input.checkOut ? hmToMinutes(input.checkOut) : null,
          reason: input.reason,
        };
        if (isUpdate) await tx.attendanceUpdateRequest.update({ where: { requestId }, data: fields });
        else await tx.attendanceUpdateRequest.create({ data: { requestId, ...fields } });
      },
    };
  }

  if (type === "EXPENSE") return prepareExpense(user, body, files, existingId);
  if (type === "TRAVEL") return prepareTravel(user, body, existingId);
  if (type === "TRAVEL_SETTLEMENT") return prepareSettlement(user, body, files, existingId);
  if (type === "ASSET_REQUEST") return prepareAssetRequest(body);
  if (type === "RESIGNATION") return prepareResignation(user, body, existingId);

  const input = parse(letterSchema, body);
  return {
    title: LETTER_TYPES[input.letterType],
    data: input,
    chain: [{ label: "HR", approver: "HR" }],
    persist: async () => {},
  };
}

/** Expense Claim: one line per expense, each with a receipt file field "receipt_<index>". */
async function prepareExpense(user: AuthUser, body: unknown, files: Express.Multer.File[], existingId?: number): Promise<Prepared> {
  const raw = body as { purpose?: string; lines?: string };
  let lines: unknown;
  try {
    lines = JSON.parse(raw.lines ?? "[]");
  } catch {
    throw new HttpError(400, "The expense lines could not be read");
  }
  const input = parse(expenseClaimSchema, { purpose: raw.purpose, lines });
  const receipts = new Map(files.filter((f) => f.fieldname.startsWith("receipt_")).map((f) => [Number(f.fieldname.slice(8)), f]));
  if ([...receipts.keys()].some((i) => i >= input.lines.length)) throw new HttpError(400, "A receipt does not belong to any line");
  if (files.some((f) => f.fieldname === "attachments")) throw new HttpError(400, "Attach receipts to their expense lines");
  // A resubmitted claim may keep receipts it already has.
  const keep = [...new Set(input.lines.map((l) => l.keepReceiptId).filter((v): v is number => v != null))];
  if (keep.length && (await prisma.requestAttachment.count({ where: { id: { in: keep }, requestId: existingId ?? -1 } })) !== keep.length) {
    throw new HttpError(400, "A kept receipt does not belong to this claim");
  }
  const checked = input.lines.map((l, i) => ({ ...l, hasReceipt: receipts.has(i) || l.keepReceiptId != null }));
  const result = await evaluateExpense(user.id, checked, existingId);
  if (result.errors.length) throw new HttpError(400, result.errors.join("; "));
  const chain = await expenseChain(user.id, result.needsManagement);

  return {
    title: `Expense Claim · ${pkr(result.total)} (${checked.length} item${checked.length === 1 ? "" : "s"})`,
    data: { purpose: input.purpose },
    chain,
    ownsFiles: true,
    persist: async (tx, requestId, isUpdate) => {
      let claimId: number;
      if (isUpdate) {
        const claim = await tx.expenseClaim.update({ where: { requestId }, data: { purpose: input.purpose, totalClaimed: result.total } });
        await tx.expenseLine.deleteMany({ where: { claimId: claim.id } });
        claimId = claim.id;
      } else {
        claimId = (await tx.expenseClaim.create({ data: { requestId, purpose: input.purpose, totalClaimed: result.total } })).id;
      }
      for (const [i, l] of checked.entries()) {
        let receiptId = l.keepReceiptId ?? null;
        const file = receipts.get(i);
        if (file) {
          receiptId = (await tx.requestAttachment.create({
            data: { requestId, fileName: file.originalname, path: relativeUploadPath(file.path), mimeType: file.mimetype, size: file.size },
          })).id;
        }
        await tx.expenseLine.create({
          data: {
            claimId, order: i, date: toDate(l.date), categoryId: l.categoryId, description: l.description, amount: l.amount, receiptId,
            noReceiptExplanation: l.hasReceipt ? null : l.noReceiptExplanation || null,
            allowanceJustification: l.allowanceJustification || null,
          },
        });
      }
    },
  };
}

const assetRequestSchema = z.object({
  categoryId: z.coerce.number().int({ message: "Choose what you need" }),
  reason: z.string().trim().min(5, "Say why you need it"),
  neededBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("").transform(() => undefined)),
});

/** Asset request: Line Manager → Admin; Admin then issues an item from stock. */
async function prepareAssetRequest(body: unknown): Promise<Prepared> {
  const input = parse(assetRequestSchema, body);
  const category = await prisma.assetCategory.findUnique({ where: { id: input.categoryId } });
  if (!category || !category.active) throw new HttpError(400, "Choose what you need");
  if (input.neededBy && input.neededBy < todayYmd()) throw new HttpError(400, "The needed-by date is in the past");
  return {
    title: `Asset Request · ${category.name}`,
    data: { category: category.name },
    chain: [{ label: "Line Manager", approver: "LINE_MANAGER" }, { label: "Admin", approver: "ADMIN" }],
    persist: async (tx, requestId, isUpdate) => {
      const fields = { categoryId: category.id, reason: input.reason, neededBy: input.neededBy ? toDate(input.neededBy) : null };
      if (isUpdate) await tx.assetRequest.update({ where: { requestId }, data: fields });
      else await tx.assetRequest.create({ data: { requestId, ...fields } });
    },
  };
}

const resignationSchema = z.object({
  reason: z.string().trim().min(3, "Give the reason for resigning"),
  proposedLastDay: ymdString,
});

/** Resignation: the notice period (probation or confirmed) is worked out from the day notice is given. */
async function prepareResignation(user: AuthUser, body: unknown, existingId?: number): Promise<Prepared> {
  const input = parse(resignationSchema, body);
  if (await openExitCase(user.id)) throw new HttpError(400, "Your exit is already under way");
  const other = await prisma.request.findFirst({
    where: { employeeId: user.id, type: "RESIGNATION", status: { in: ["PENDING", "RETURNED"] }, ...(existingId ? { id: { not: existingId } } : {}) },
  });
  if (other) throw new HttpError(400, `You already have a resignation waiting for approval (request #${other.id})`);
  // A resubmitted resignation keeps the day notice was first given.
  const existing = existingId ? await prisma.resignationRequest.findUnique({ where: { requestId: existingId } }) : null;
  const givenOn = existing?.resignationDate ?? toDate(todayYmd());
  if (input.proposedLastDay < ymd(givenOn) || input.proposedLastDay < todayYmd()) throw new HttpError(400, "The last working day cannot be in the past");
  const notice = await noticeFor(user.id, givenOn);
  return {
    title: `Resignation · last working day ${input.proposedLastDay}`,
    data: {},
    chain: await resignationChain(user.id),
    persist: async (tx, requestId, isUpdate) => {
      const fields = {
        reason: input.reason, resignationDate: givenOn, proposedLastDay: toDate(input.proposedLastDay),
        onProbation: notice.onProbation, noticeDays: notice.noticeDays, noticeEndDate: notice.noticeEndDate, earlyReleaseRecommended: null,
      };
      if (isUpdate) await tx.resignationRequest.update({ where: { requestId }, data: fields });
      else await tx.resignationRequest.create({ data: { requestId, ...fields } });
    },
  };
}

const decisionSchema = z.object({
  comment: z.string().optional(),
  // Resignation: the Line Manager's recommendation on early release, and HR's final last working day
  earlyRelease: z.boolean().optional(),
  lastWorkingDay: ymdString.optional(),
  waiveShortfall: z.boolean().optional(),
});
type Decision = z.infer<typeof decisionSchema>;

/**
 * Early release: the Line Manager recommends it, HR approves it. HR's final approval sets the last working day
 * and opens the exit case; Finance deducts any notice not served unless HR waives it.
 */
const resignationDecision = (body: Decision, approverId: number): OnStepApproved => async (tx, ctx) => {
  if (ctx.type !== "RESIGNATION") return;
  const r = await tx.resignationRequest.findUniqueOrThrow({ where: { requestId: ctx.requestId } });
  const early = r.proposedLastDay < r.noticeEndDate;
  let recommended = r.earlyReleaseRecommended;
  if (ctx.step.label === "Line Manager" && early) {
    if (body.earlyRelease === undefined) {
      throw new HttpError(400, `The proposed last day is before the notice period ends (${ymd(r.noticeEndDate)}). Say whether you recommend releasing them early.`);
    }
    recommended = body.earlyRelease;
    await tx.resignationRequest.update({ where: { id: r.id }, data: { earlyReleaseRecommended: recommended } });
  }
  if (!ctx.isFinal) return;
  const hadLineManager = (await tx.requestStep.count({ where: { requestId: ctx.requestId, label: "Line Manager" } })) > 0;
  const mayRelease = recommended === true || !hadLineManager;
  const lastDay = toDate(body.lastWorkingDay ?? ymd(early && !mayRelease ? r.noticeEndDate : r.proposedLastDay));
  if (lastDay < r.resignationDate) throw new HttpError(400, "The last working day is before the resignation date");
  if (lastDay < r.noticeEndDate && !mayRelease) {
    throw new HttpError(400, `The Line Manager did not recommend early release, so the last working day cannot be before the notice period ends (${ymd(r.noticeEndDate)})`);
  }
  const shortfallDays = Math.max(0, daysBetween(lastDay, r.noticeEndDate));
  await createExitCase(tx, {
    employeeId: ctx.employeeId, type: "RESIGNATION", reason: r.reason, requestId: ctx.requestId, startedById: approverId,
    noticeGivenOn: r.resignationDate, noticeDays: r.noticeDays, noticeEndDate: r.noticeEndDate, lastWorkingDay: lastDay,
    shortfallDays, shortfallWaived: shortfallDays > 0 && !!body.waiveShortfall,
  });
};

/** Pre-trip travel request: Line Manager → HOD (+ Management above the threshold, + Finance for an advance). */
async function prepareTravel(user: AuthUser, body: unknown, existingId?: number): Promise<Prepared> {
  const input = parse(travelSchema, body);
  const result = await evaluateTravel(user.id, input, existingId);
  if (result.errors.length) throw new HttpError(400, result.errors.join("; "));
  const chain = await travelChain(user.id, result.needsManagement, result.needsFinance);
  const fields = {
    purpose: input.purpose, origin: input.origin, destination: input.destination, country: input.country,
    departDate: toDate(input.departDate), returnDate: toDate(input.returnDate), mode: input.mode, needsHotel: input.needsHotel,
    estimateTransport: input.estimateTransport, estimateHotel: input.estimateHotel, estimateMeals: input.estimateMeals, estimateOther: input.estimateOther,
    estimatedTotal: result.estimatedTotal, advanceRequested: input.advanceRequested,
    bookingStatus: result.bookingNeeded ? ("PENDING" as const) : ("NOT_NEEDED" as const),
  };
  return {
    title: `Travel · ${input.origin} → ${input.destination} (${input.departDate} to ${input.returnDate})`,
    data: { purpose: input.purpose },
    chain,
    persist: async (tx, requestId, isUpdate) => {
      if (isUpdate) await tx.travelRequest.update({ where: { requestId }, data: fields });
      else await tx.travelRequest.create({ data: { requestId, ...fields } });
    },
  };
}

/** Post-trip settlement: expense lines (hotel nights, daily allowance, mileage, receipts) against the trip; Line Manager → Finance. */
async function prepareSettlement(user: AuthUser, body: unknown, files: Express.Multer.File[], existingId?: number): Promise<Prepared> {
  const raw = body as { travelRequestId?: string; lines?: string };
  let lines: unknown;
  try {
    lines = JSON.parse(raw.lines ?? "[]");
  } catch {
    throw new HttpError(400, "The settlement lines could not be read");
  }
  const input = parse(
    z.object({ travelRequestId: z.coerce.number().int({ message: "Choose the trip" }), lines: z.array(settlementLineSchema).min(1, "Add at least one expense").max(40) }),
    { travelRequestId: raw.travelRequestId, lines },
  );
  const receipts = new Map(files.filter((f) => f.fieldname.startsWith("receipt_")).map((f) => [Number(f.fieldname.slice(8)), f]));
  if ([...receipts.keys()].some((i) => i >= input.lines.length)) throw new HttpError(400, "A receipt does not belong to any line");
  if (files.some((f) => f.fieldname === "attachments")) throw new HttpError(400, "Attach receipts to their lines");
  const keep = [...new Set(input.lines.map((l) => l.keepReceiptId).filter((v): v is number => v != null))];
  if (keep.length && (await prisma.requestAttachment.count({ where: { id: { in: keep }, requestId: existingId ?? -1 } })) !== keep.length) {
    throw new HttpError(400, "A kept receipt does not belong to this settlement");
  }
  const trip = await prisma.travelRequest.findUnique({ where: { requestId: input.travelRequestId }, include: travelInclude });
  if (!trip) throw new HttpError(404, "Travel request not found");
  if (existingId && trip.settlement?.requestId !== existingId) throw new HttpError(400, "This settlement belongs to another trip");
  const checked = input.lines.map((l, i) => ({ ...l, hasReceipt: receipts.has(i) || l.keepReceiptId != null }));
  const result = await evaluateSettlement(user.id, trip, checked, existingId);
  if (result.errors.length) throw new HttpError(400, result.errors.join("; "));

  return {
    title: `Travel Settlement · ${trip.origin} → ${trip.destination} · ${pkr(result.total)}`,
    data: { travelRequestId: trip.requestId },
    chain: SETTLEMENT_CHAIN,
    ownsFiles: true,
    persist: async (tx, requestId, isUpdate) => {
      let claimId: number;
      const purpose = `Settlement for travel request #${trip.requestId}: ${trip.origin} → ${trip.destination}`;
      if (isUpdate) {
        const claim = await tx.expenseClaim.update({ where: { requestId }, data: { totalClaimed: result.total } });
        await tx.expenseLine.deleteMany({ where: { claimId: claim.id } });
        claimId = claim.id;
      } else {
        // A cancelled or rejected earlier settlement keeps its history but gives up the link to the trip.
        await tx.expenseClaim.updateMany({ where: { travelId: trip.id }, data: { travelId: null } });
        claimId = (await tx.expenseClaim.create({ data: { requestId, purpose, totalClaimed: result.total, travelId: trip.id } })).id;
      }
      for (const [i, l] of result.lines.entries()) {
        let receiptId = l.keepReceiptId ?? null;
        const file = receipts.get(i);
        if (file) {
          receiptId = (await tx.requestAttachment.create({
            data: { requestId, fileName: file.originalname, path: relativeUploadPath(file.path), mimeType: file.mimetype, size: file.size },
          })).id;
        }
        await tx.expenseLine.create({
          data: {
            claimId, order: i, kind: l.kind, date: toDate(l.date), categoryId: l.kind === "STANDARD" ? l.categoryId ?? null : null,
            description: l.description, amount: l.amount, quantity: l.quantity ?? null, rate: l.rate, receiptId,
            noReceiptExplanation: l.hasReceipt ? null : l.noReceiptExplanation || null,
          },
        });
      }
    },
  };
}

/** What happens once the final approver signs off. */
const onApproved: OnApproved = async (tx, requestId) => {
  const request = await tx.request.findUniqueOrThrow({
    where: { id: requestId },
    include: { leaveRequest: true, attendanceUpdateRequest: true },
  });
  if (request.type === "LEAVE" && request.leaveRequest) {
    const l = request.leaveRequest;
    await deductLeave(tx, request.employeeId, l.leaveTypeId, l.startDate, Number(l.days));
  }
  if (request.type === "ATTENDANCE_UPDATE" && request.attendanceUpdateRequest) {
    // The original machine record is never overwritten; the correction goes into separate fields.
    const u = request.attendanceUpdateRequest;
    const rules = await getAttendanceRules();
    const existing = await tx.attendanceRecord.findUnique({
      where: { employeeId_date: { employeeId: request.employeeId, date: u.date } },
    });
    const checkIn = u.checkIn ?? existing?.checkIn ?? null;
    const checkOut = u.checkOut ?? existing?.checkOut ?? null;
    let status = computeStatus(checkIn, checkOut, rules);
    if (u.kind === "FIELD_VISIT" && status === "ABSENT") status = "ON_TIME";
    const correction = { correctedCheckIn: checkIn, correctedCheckOut: checkOut, correctedStatus: status, correctionRequestId: request.id };
    if (existing) await tx.attendanceRecord.update({ where: { id: existing.id }, data: correction });
    else await tx.attendanceRecord.create({ data: { employeeId: request.employeeId, date: u.date, status: "ABSENT", ...correction } });
  }
  if (request.type === "EXPENSE" || request.type === "TRAVEL_SETTLEMENT") {
    // Finance may have reduced or rejected lines; a claim with nothing left must be rejected instead.
    const lines = await tx.expenseLine.findMany({ where: { claim: { requestId } } });
    if (round2(lines.reduce((s, l) => s + lineApproved(l), 0)) <= 0) {
      throw new HttpError(400, "Every line is rejected. Reject the claim instead of approving it.");
    }
  }
  // LETTER: the PDF is generated on download from the approved request.
  // EXPENSE: Finance marks the claim as paid afterwards.
};

const TYPE_ROUTES: Record<string, RequestType> = {
  leave: "LEAVE",
  "attendance-update": "ATTENDANCE_UPDATE",
  letter: "LETTER",
  expense: "EXPENSE",
  travel: "TRAVEL",
  settlement: "TRAVEL_SETTLEMENT",
  asset: "ASSET_REQUEST",
  resignation: "RESIGNATION",
};

async function saveAttachments(tx: Tx, requestId: number, files: Express.Multer.File[]) {
  if (!files.length) return;
  await tx.requestAttachment.createMany({
    data: files.map((f) => ({
      requestId, fileName: f.originalname, path: relativeUploadPath(f.path), mimeType: f.mimetype, size: f.size,
    })),
  });
}

/** Leave / attendance update / letter accept up to 5 "attachments"; expense claims accept "receipt_<line>" files. */
function checkFileFields(type: RequestType, files: Express.Multer.File[]) {
  if (type === "EXPENSE" || type === "TRAVEL_SETTLEMENT") return;
  if (files.some((f) => f.fieldname !== "attachments")) throw new HttpError(400, "Receipts are only for expense claims");
  if (files.length > 5) throw new HttpError(400, "Attach at most 5 files");
}

// Submit a new request: POST /requests/leave | /requests/attendance-update | /requests/letter | /requests/expense
requestsRouter.post("/:type", requestFilesUpload.any(), async (req, res) => {
  const user = currentUser(req);
  const type = TYPE_ROUTES[String(req.params.type)];
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!type) { removeFiles(files); throw new HttpError(404, "Unknown request type"); }
  try {
    checkFileFields(type, files);
    const prepared = await prepare(type, user, req.body, files);
    const request = await prisma.$transaction(async (tx) => {
      const created = await tx.request.create({
        data: { type, employeeId: user.id, title: prepared.title, data: prepared.data },
      });
      await prepared.persist(tx, created.id, false);
      if (!prepared.ownsFiles) await saveAttachments(tx, created.id, files);
      await createSteps(tx, created.id, await resolveSteps(tx, user.id, prepared.chain));
      await tx.requestAction.create({ data: { requestId: created.id, actorId: user.id, action: "SUBMITTED" } });
      return created;
    });
    await notifySubmitted(request.id);
    res.status(201).json({ id: request.id });
  } catch (err) {
    removeFiles(files);
    throw err;
  }
});

// Resubmit a returned request with edits
requestsRouter.put("/:id/resubmit", requestFilesUpload.any(), async (req, res) => {
  const user = currentUser(req);
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  try {
    const id = Number(req.params.id);
    const existing = await prisma.request.findUnique({ where: { id }, include: { _count: { select: { attachments: true } } } });
    if (!existing) throw new HttpError(404, "Request not found");
    if (existing.employeeId !== user.id) throw new HttpError(403, "Only the person who submitted it can resubmit");
    if (existing.status !== "RETURNED") throw new HttpError(400, "Only returned requests can be edited and resubmitted");
    checkFileFields(existing.type, files);
    const prepared = await prepare(existing.type, user, req.body, files, existing._count.attachments, id);
    await prisma.$transaction(async (tx) => {
      await tx.request.update({ where: { id }, data: { title: prepared.title, data: prepared.data } });
      await prepared.persist(tx, id, true);
      if (!prepared.ownsFiles) await saveAttachments(tx, id, files);
      await restartChain(tx, id, user.id, prepared.chain, user.id);
    });
    await notifySubmitted(id, true);
    res.json({ id });
  } catch (err) {
    removeFiles(files);
    throw err;
  }
});

for (const action of ["approve", "reject", "return"] as const) {
  requestsRouter.post(`/:id/${action}`, async (req, res) => {
    const body = parse(decisionSchema, req.body ?? {});
    const id = Number(req.params.id);
    const user = currentUser(req);
    await actOnRequest(id, user, action.toUpperCase() as "APPROVE", body.comment, onApproved, resignationDecision(body, user.id));
    if (action === "approve") {
      const r = await prisma.request.findUnique({ where: { id }, select: { type: true, status: true, exitCase: { select: { id: true } } } });
      if (r?.type === "TRAVEL" && r.status === "APPROVED") await travelApproved(id);
      if (r?.type === "ASSET_REQUEST" && r.status === "APPROVED") await assetRequestApproved(id);
      if (r?.type === "RESIGNATION" && r.status === "APPROVED" && r.exitCase) await exitCaseOpened(r.exitCase.id);
    }
    res.json({ ok: true });
  });
}

requestsRouter.post("/:id/cancel", async (req, res) => {
  const r = await prisma.request.findUnique({ where: { id: Number(req.params.id) }, select: { type: true } });
  if (r?.type === "TRAVEL") throw new HttpError(400, "Use \"Cancel trip\" to cancel a travel request");
  await cancelRequest(Number(req.params.id), currentUser(req));
  res.json({ ok: true });
});

const listInclude = {
  employee: { select: { id: true, fullName: true, code: true, department: { select: { name: true } } } },
  steps: { orderBy: { order: "asc" }, select: { order: true, label: true, status: true } },
} satisfies Prisma.RequestInclude;

const summarize = (r: Prisma.RequestGetPayload<{ include: typeof listInclude }>) => ({
  id: r.id,
  type: r.type,
  typeLabel: TYPE_LABELS[r.type],
  title: r.title,
  status: r.status,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
  employee: { id: r.employee.id, fullName: r.employee.fullName, code: r.employee.code, department: r.employee.department?.name ?? null },
  currentStepLabel: r.status === "PENDING" ? r.steps.find((s) => s.order === r.currentStep)?.label ?? null : null,
});

requestsRouter.get("/mine", async (req, res) => {
  const user = currentUser(req);
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const type = typeof req.query.type === "string" ? req.query.type : undefined;
  const rows = await prisma.request.findMany({
    where: {
      employeeId: user.id,
      ...(status ? { status: status as never } : {}),
      ...(type ? { type: type as never } : {}),
    },
    include: listInclude,
    orderBy: { createdAt: "desc" },
  });
  res.json(rows.map(summarize));
});

// Requests waiting for me, or (history=1) ones I have acted on
requestsRouter.get("/approvals", async (req, res) => {
  const user = currentUser(req);
  if (req.query.history === "1") {
    const rows = await prisma.request.findMany({
      where: { steps: { some: { actedById: user.id } } },
      include: listInclude,
      orderBy: { updatedAt: "desc" },
      take: 100,
    });
    return res.json(rows.map(summarize));
  }
  const steps = await prisma.requestStep.findMany({
    where: pendingForUserWhere(user),
    include: { request: { include: listInclude } },
    orderBy: { pendingSince: "asc" },
  });
  res.json(steps.map((s) => ({ ...summarize(s.request), pendingSince: s.pendingSince })));
});

// HR / Management overview of all requests
requestsRouter.get("/", async (req, res) => {
  const user = currentUser(req);
  if (!hasRole(user, "HR", "MANAGEMENT")) throw new HttpError(403, "You do not have access to this");
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const type = typeof req.query.type === "string" ? req.query.type : undefined;
  const rows = await prisma.request.findMany({
    where: { ...(status ? { status: status as never } : {}), ...(type ? { type: type as never } : {}) },
    include: listInclude,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json(rows.map(summarize));
});

const detailInclude = {
  employee: {
    select: {
      id: true, fullName: true, code: true, designation: true, managerId: true,
      department: { select: { name: true } }, manager: { select: { fullName: true } },
    },
  },
  steps: {
    orderBy: { order: "asc" },
    include: { approver: { select: { fullName: true } }, actedBy: { select: { fullName: true } } },
  },
  actions: { orderBy: { createdAt: "asc" }, include: { actor: { select: { fullName: true } } } },
  attachments: true,
  leaveRequest: { include: { leaveType: true } },
  attendanceUpdateRequest: true,
  expenseClaim: {
    include: {
      lines: { orderBy: { order: "asc" }, include: { category: true, receipt: { select: { id: true, fileName: true, size: true } } } },
      paidBy: { select: { fullName: true } },
      travel: {
        select: {
          requestId: true, origin: true, destination: true, departDate: true, returnDate: true,
          advanceRequested: true, advancePaidAt: true, advanceReturnedAmount: true, cancelledAt: true,
        },
      },
    },
  },
  assetRequest: {
    include: {
      category: true,
      assignment: { include: { asset: { select: { id: true, tag: true, name: true, serialNumber: true } }, issuedBy: { select: { fullName: true } } } },
    },
  },
  travelRequest: {
    include: {
      bookings: { orderBy: { createdAt: "asc" }, include: { voucher: { select: { id: true, fileName: true } } } },
      advancePaidBy: { select: { fullName: true } },
      advanceReturnedBy: { select: { fullName: true } },
      bookedBy: { select: { fullName: true } },
      cancelledBy: { select: { fullName: true } },
      settlement: { include: { request: { select: { id: true, status: true } }, lines: true } },
    },
  },
  resignation: true,
  exitCase: { select: { id: true } },
} satisfies Prisma.RequestInclude;

type Detail = Prisma.RequestGetPayload<{ include: typeof detailInclude }>;

async function loadForUser(id: number, user: AuthUser): Promise<Detail> {
  const r = await prisma.request.findUnique({ where: { id }, include: detailInclude });
  if (!r) throw new HttpError(404, "Request not found");
  const allowed =
    r.employeeId === user.id ||
    hasRole(user, "HR", "MANAGEMENT") ||
    r.employee.managerId === user.id ||
    r.steps.some((s) => s.approverId === user.id || s.actedById === user.id || (s.approverRole && hasRole(user, s.approverRole))) ||
    // Admin books trips; Finance pays advances and settlements.
    ((r.type === "TRAVEL" || r.type === "TRAVEL_SETTLEMENT") && hasRole(user, "ADMIN", "FINANCE"));
  if (!allowed) throw new HttpError(403, "You do not have access to this request");
  return r;
}

/** Settlement: approved total minus the advance already paid (negative = the employee returns the difference). */
function settlementToPay(r: Detail) {
  const travel = r.expenseClaim?.travel;
  if (!r.expenseClaim || !travel) return null;
  const advance = travel.advancePaidAt ? Number(travel.advanceRequested) : 0;
  return round2(approvedTotal(r.expenseClaim.lines) - advance);
}

/** Trip details and what the viewer may do with it. */
async function travelDetail(r: Detail, user: AuthUser) {
  const t = r.travelRequest!;
  const rules = await travelRules();
  const window = settlementWindow(t, rules.settlementDays);
  const activeSettlement = t.settlement && !["CANCELLED", "REJECTED"].includes(t.settlement.request.status) ? t.settlement : null;
  const due = advanceDue({ ...t, settlement: t.settlement ? { request: t.settlement.request, lines: t.settlement.lines } : null });
  const isTraveller = r.employeeId === user.id;
  const finance = hasRole(user, "FINANCE") && !isTraveller;
  const admin = hasRole(user, "ADMIN");
  const approved = r.status === "APPROVED" && !t.cancelledAt;
  const today = todayYmd();
  const n = (v: { toString(): string } | null) => (v == null ? null : Number(v));
  return {
    travel: {
      purpose: t.purpose, origin: t.origin, destination: t.destination, country: t.country,
      departDate: ymd(t.departDate), returnDate: ymd(t.returnDate), days: tripDays(t.departDate, t.returnDate),
      mode: t.mode, modeLabel: MODE_LABELS[t.mode], needsHotel: t.needsHotel,
      estimates: { transport: Number(t.estimateTransport), hotel: Number(t.estimateHotel), meals: Number(t.estimateMeals), other: Number(t.estimateOther), total: Number(t.estimatedTotal) },
      advance: {
        requested: Number(t.advanceRequested),
        paid: t.advancePaidAt ? { paidOn: t.advancePaidOn ? ymd(t.advancePaidOn) : null, method: t.advanceMethod, reference: t.advanceReference, paidBy: t.advancePaidBy?.fullName ?? null } : null,
        due,
        returned: t.advanceReturnedAmount != null
          ? { amount: Number(t.advanceReturnedAmount), method: t.advanceReturnMethod, returnedOn: t.advanceReturnedOn ? ymd(t.advanceReturnedOn) : null, reference: t.advanceReturnReference, by: t.advanceReturnedBy?.fullName ?? null }
          : null,
      },
      bookingStatus: t.bookingStatus,
      booked: t.bookedAt ? { at: t.bookedAt, by: t.bookedBy?.fullName ?? null } : null,
      bookings: t.bookings.map((b) => ({ id: b.id, kind: b.kind, arrangedBy: b.arrangedBy, details: b.details, provider: b.provider, reference: b.reference, cost: n(b.cost), voucher: b.voucher })),
      cancellation: t.cancelledAt
        ? { at: t.cancelledAt, by: t.cancelledBy?.fullName ?? null, reason: t.cancellationReason, fee: n(t.cancellationFee), feeNote: t.cancellationFeeNote, financeNote: t.financeNote }
        : null,
      settlement: activeSettlement ? { requestId: activeSettlement.request.id, status: activeSettlement.request.status } : null,
      settlementWindow: window,
    },
    canCancelTrip: (isTraveller || r.employee.managerId === user.id) && !t.cancelledAt && ["PENDING", "RETURNED", "APPROVED"].includes(r.status) && !activeSettlement,
    canBook: admin && approved,
    canPayAdvance: finance && approved && Number(t.advanceRequested) > 0 && !t.advancePaidAt,
    canRecordAdvanceReturn: finance && due > 0,
    canRecordCancellationFee: admin && !!t.cancelledAt,
    canAddFinanceNote: hasRole(user, "FINANCE") && !!t.cancelledAt,
    canSettle: isTraveller && approved && !activeSettlement && today >= window.opens && today <= window.closes,
  };
}

/** Medical documents are visible to HR only (and the employee who uploaded them). */
const attachmentsHidden = (r: Detail, user: AuthUser) =>
  r.type === "LEAVE" && r.leaveRequest?.leaveType.code === "SL" && r.employeeId !== user.id && !hasRole(user, "HR");

requestsRouter.get("/:id", async (req, res) => {
  const user = currentUser(req);
  const r = await loadForUser(Number(req.params.id), user);
  const current = r.status === "PENDING" ? r.steps.find((s) => s.order === r.currentStep) : undefined;
  const hidden = attachmentsHidden(r, user);
  if (hidden === false && r.attachments.length && r.type === "LEAVE" && r.leaveRequest?.leaveType.code === "SL" && r.employeeId !== user.id) {
    await audit(user.id, "VIEW_SENSITIVE", "MedicalDocument", r.id);
  }
  res.json({
    id: r.id,
    type: r.type,
    typeLabel: TYPE_LABELS[r.type],
    title: r.title,
    status: r.status,
    data: r.data,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    employee: {
      id: r.employee.id, fullName: r.employee.fullName, code: r.employee.code, designation: r.employee.designation,
      department: r.employee.department?.name ?? null, manager: r.employee.manager?.fullName ?? null,
    },
    steps: r.steps.map((s) => ({
      order: s.order,
      label: s.label,
      status: s.status,
      approver: s.approver?.fullName ?? (s.approverRole ? `Any ${s.approverRole} user` : null),
      actedBy: s.actedBy?.fullName ?? null,
      actedAt: s.actedAt,
      comment: s.comment,
      pendingSince: s.pendingSince,
    })),
    history: r.actions.map((a) => ({ action: a.action, actor: a.actor.fullName, comment: a.comment, at: a.createdAt, stepOrder: a.stepOrder })),
    attachments: hidden
      ? []
      : r.attachments.map((a) => ({ id: a.id, fileName: a.fileName, mimeType: a.mimeType, size: a.size })),
    attachmentsHidden: hidden && r.attachments.length > 0,
    leave: r.leaveRequest
      ? {
          leaveTypeId: r.leaveRequest.leaveTypeId,
          leaveType: r.leaveRequest.leaveType.name,
          startDate: ymd(r.leaveRequest.startDate),
          endDate: ymd(r.leaveRequest.endDate),
          days: Number(r.leaveRequest.days),
          reason: r.leaveRequest.reason,
        }
      : null,
    attendanceUpdate: r.attendanceUpdateRequest
      ? {
          date: ymd(r.attendanceUpdateRequest.date),
          kind: r.attendanceUpdateRequest.kind,
          checkIn: minutesToHm(r.attendanceUpdateRequest.checkIn),
          checkOut: minutesToHm(r.attendanceUpdateRequest.checkOut),
          reason: r.attendanceUpdateRequest.reason,
        }
      : null,
    currentStepLabel: current?.label ?? null,
    canAct: current ? canActOnStep(user, r.employeeId, current, priorApproverIds(r.steps, current.order)) : false,
    canResubmit: r.status === "RETURNED" && r.employeeId === user.id,
    canCancel: r.type !== "TRAVEL" && ["PENDING", "RETURNED"].includes(r.status) && r.employeeId === user.id,
    letterAvailable: r.type === "LETTER" && r.status === "APPROVED" && (r.employeeId === user.id || hasRole(user, "HR")),
    expense: r.expenseClaim
      ? {
          purpose: r.expenseClaim.purpose,
          totalClaimed: Number(r.expenseClaim.totalClaimed),
          totalApproved: round2(r.expenseClaim.lines.reduce((s, l) => s + lineApproved(l), 0)),
          lines: r.expenseClaim.lines.map((l) => ({
            id: l.id,
            date: ymd(l.date),
            kind: l.kind,
            quantity: l.quantity == null ? null : Number(l.quantity),
            rate: l.rate == null ? null : Number(l.rate),
            categoryId: l.categoryId,
            category: l.category?.name ?? KIND_LABELS[l.kind],
            accountingCode: l.category?.accountingCode ?? null,
            allowanceWarning: l.category?.allowanceWarning ?? false,
            description: l.description,
            amount: Number(l.amount),
            status: l.status,
            approvedAmount: lineApproved(l),
            financeReason: l.financeReason,
            noReceiptExplanation: l.noReceiptExplanation,
            allowanceJustification: l.allowanceJustification,
            receipt: l.receipt,
          })),
          paid: r.expenseClaim.paidAt
            ? {
                paidOn: r.expenseClaim.paidOn ? ymd(r.expenseClaim.paidOn) : null,
                method: r.expenseClaim.paymentMethod,
                reference: r.expenseClaim.paymentReference,
                paidBy: r.expenseClaim.paidBy?.fullName ?? null,
                paidAt: r.expenseClaim.paidAt,
              }
            : null,
        }
      : null,
    // Only Finance, at its own approval step, may reduce or reject single lines.
    canAdjustLines:
      (r.type === "EXPENSE" || r.type === "TRAVEL_SETTLEMENT") && !!current && current.approverRole === "FINANCE" &&
      canActOnStep(user, r.employeeId, current, priorApproverIds(r.steps, current.order)),
    canMarkPaid:
      (r.type === "EXPENSE" || r.type === "TRAVEL_SETTLEMENT") && r.status === "APPROVED" && !r.expenseClaim?.paidAt &&
      hasRole(user, "FINANCE") && r.employeeId !== user.id && (r.type === "EXPENSE" || (settlementToPay(r) ?? 0) > 0),
    settlement: r.expenseClaim?.travel
      ? {
          travelRequestId: r.expenseClaim.travel.requestId,
          route: `${r.expenseClaim.travel.origin} → ${r.expenseClaim.travel.destination}`,
          departDate: ymd(r.expenseClaim.travel.departDate),
          returnDate: ymd(r.expenseClaim.travel.returnDate),
          advancePaid: r.expenseClaim.travel.advancePaidAt ? Number(r.expenseClaim.travel.advanceRequested) : 0,
          toPay: settlementToPay(r),
        }
      : null,
    ...(r.travelRequest ? await travelDetail(r, user) : { travel: null }),
    assetRequest: r.assetRequest
      ? {
          categoryId: r.assetRequest.categoryId,
          category: r.assetRequest.category.name,
          reason: r.assetRequest.reason,
          neededBy: r.assetRequest.neededBy ? ymd(r.assetRequest.neededBy) : null,
          fulfilled: r.assetRequest.assignment
            ? { tag: r.assetRequest.assignment.asset.tag, name: r.assetRequest.assignment.asset.name, serialNumber: r.assetRequest.assignment.asset.serialNumber, issuedAt: r.assetRequest.assignment.issuedAt, issuedBy: r.assetRequest.assignment.issuedBy.fullName, assetId: r.assetRequest.assignment.asset.id }
            : null,
        }
      : null,
    canFulfil: r.type === "ASSET_REQUEST" && r.status === "APPROVED" && !r.assetRequest?.assignment && hasRole(user, "ADMIN"),
    resignation: r.resignation ? await resignationDetail(r, user, current) : null,
  });
});

/** Resignation details, and what the current approver must decide (early release, last working day). */
async function resignationDetail(r: Detail, user: AuthUser, current: Detail["steps"][number] | undefined) {
  const x = r.resignation!;
  const early = x.proposedLastDay < x.noticeEndDate;
  const canAct = !!current && canActOnStep(user, r.employeeId, current, priorApproverIds(r.steps, current.order));
  const isFinal = !!current && current.order === Math.max(...r.steps.map((s) => s.order));
  const hadLineManager = r.steps.some((s) => s.label === "Line Manager");
  const mayReleaseEarly = x.earlyReleaseRecommended === true || !hadLineManager;
  // Warn HR at approval time about the team and approvals the leaver still holds.
  const warning = r.status === "PENDING" && hasRole(user, "HR", "MANAGEMENT") && user.id !== r.employeeId
    ? handoverWarning(r.employee.fullName, await handoverFor(r.employeeId))
    : null;
  return {
    reason: x.reason,
    resignationDate: ymd(x.resignationDate),
    proposedLastDay: ymd(x.proposedLastDay),
    onProbation: x.onProbation,
    noticeDays: x.noticeDays,
    noticeEndDate: ymd(x.noticeEndDate),
    earlyRelease: early,
    earlyReleaseRecommended: x.earlyReleaseRecommended,
    mayReleaseEarly,
    exitCaseId: r.exitCase?.id ?? null,
    decision: canAct ? (isFinal ? "FINAL" : current!.label === "Line Manager" && early ? "LINE_MANAGER" : null) : null,
    defaultLastWorkingDay: ymd(early && !mayReleaseEarly ? x.noticeEndDate : x.proposedLastDay),
    handoverWarning: warning,
  };
}

requestsRouter.get("/:id/attachments/:attachmentId", async (req, res) => {
  const user = currentUser(req);
  const r = await loadForUser(Number(req.params.id), user);
  if (attachmentsHidden(r, user)) throw new HttpError(403, "Medical documents are visible to HR only");
  const att = r.attachments.find((a) => a.id === Number(req.params.attachmentId));
  if (!att) throw new HttpError(404, "Attachment not found");
  const file = absoluteUploadPath(att.path);
  if (!fs.existsSync(file)) throw new HttpError(404, "File is missing from storage");
  res.download(file, att.fileName);
});

requestsRouter.get("/:id/letter", async (req, res) => {
  const user = currentUser(req);
  const r = await loadForUser(Number(req.params.id), user);
  if (r.type !== "LETTER" || r.status !== "APPROVED") throw new HttpError(400, "The letter is available once the request is approved");
  if (r.employeeId !== user.id && !hasRole(user, "HR")) throw new HttpError(403, "You do not have access to this letter");
  const data = r.data as { letterType: keyof typeof LETTER_TYPES; addressedTo: string; purpose: string };
  const employee = await prisma.employee.findUniqueOrThrow({
    where: { id: r.employeeId },
    include: { department: { select: { name: true } } },
  });
  const finalStep = [...r.steps].reverse().find((s) => s.status === "APPROVED");
  const pdf = await letterPdf({
    letterType: data.letterType,
    reference: `EHB/HR/LTR/${r.createdAt.getUTCFullYear()}/${String(r.id).padStart(4, "0")}`,
    date: (finalStep?.actedAt ?? r.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
    addressedTo: data.addressedTo,
    purpose: data.purpose,
    approvedBy: finalStep?.actedBy?.fullName ?? "HR Department",
    employee,
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${data.letterType.toLowerCase()}-letter-${r.id}.pdf"`);
  res.send(pdf);
});
