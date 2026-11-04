import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { audit } from "../lib/audit.js";
import { employeeIdsWithRole, notify } from "../lib/notify.js";
import { attachmentUpload, relativeUploadPath, removeFiles } from "../lib/upload.js";
import { todayYmd, toDate, ymd } from "../lib/dates.js";
import { HttpError } from "../middleware/error.js";
import { currentUser, hasRole, requireAuth, requireRole, type AuthUser } from "../middleware/auth.js";
import { resolveSteps } from "../services/approvals.js";
import { pkr, round2 } from "../services/expenses.js";
import {
  advanceDue, approvedTotal, evaluateSettlement, MODE_LABELS, SETTLEMENT_CHAIN, settlementLineSchema, settlementWindow, travelInclude, travelRules,
} from "../services/travel.js";
import type { Prisma } from "../generated/prisma/client.js";

export const travelRouter = Router();
travelRouter.use(requireAuth);

const issues = (e: z.ZodError) => e.issues.map((i) => `${i.path.length ? `${i.path.join(".")}: ` : ""}${i.message}`).join("; ");
const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const r = schema.safeParse(body);
  if (!r.success) throw new HttpError(400, issues(r.error));
  return r.data;
};

const tripInclude = {
  request: { select: { id: true, title: true, status: true, employeeId: true, employee: { select: { fullName: true, managerId: true } } } },
  bookings: true,
  settlement: { include: { request: { select: { id: true, status: true } }, lines: true } },
} satisfies Prisma.TravelRequestInclude;

async function loadTrip(requestId: number) {
  const trip = await prisma.travelRequest.findUnique({ where: { requestId }, include: tripInclude });
  if (!trip) throw new HttpError(404, "Travel request not found");
  return trip;
}
type Trip = Awaited<ReturnType<typeof loadTrip>>;

const link = (trip: Trip) => `/requests/${trip.requestId}`;
const tripName = (trip: Trip) => `${trip.origin} → ${trip.destination} (${ymd(trip.departDate)} to ${ymd(trip.returnDate)})`;

/** Finance actions on someone else's trip only. */
function assertFinanceFor(user: AuthUser, trip: Trip) {
  if (!hasRole(user, "FINANCE")) throw new HttpError(403, "Only Finance can do this");
  if (trip.request.employeeId === user.id) throw new HttpError(403, "You cannot do this for your own trip");
}

function assertBookable(trip: Trip) {
  if (trip.request.status !== "APPROVED") throw new HttpError(400, "Travel can be booked once the request is approved");
  if (trip.cancelledAt) throw new HttpError(400, "This trip was cancelled");
}

/** After final approval: Admin is asked to book, Finance to pay the advance. Called by the approve route. */
export async function travelApproved(requestId: number) {
  const trip = await loadTrip(requestId);
  if (trip.bookingStatus === "PENDING") {
    await notify(await employeeIdsWithRole("ADMIN"), `Travel to book: ${trip.request.employee.fullName}`, `Please book travel for ${trip.request.employee.fullName}: ${tripName(trip)}, by ${MODE_LABELS[trip.mode].toLowerCase()}${trip.needsHotel ? ", with hotel" : ""}.`, link(trip));
  }
  if (Number(trip.advanceRequested) > 0) {
    const finance = (await employeeIdsWithRole("FINANCE")).filter((id) => id !== trip.request.employeeId);
    await notify(finance, `Travel advance to pay: ${trip.request.employee.fullName}`, `An advance of ${pkr(Number(trip.advanceRequested))} was approved for ${tripName(trip)}.`, link(trip));
  }
}

// ---------- Admin booking ----------

const bookingSchema = z.object({
  kind: z.enum(["AIR", "TRAIN", "BUS", "HOTEL"], { message: "Choose air, train, bus or hotel" }),
  arrangedBy: z.enum(["ADMIN", "EMPLOYEE"]).default("ADMIN"),
  details: z.string().trim().max(300).optional().default(""),
  provider: z.string().trim().max(100).optional().transform((v) => v || null),
  reference: z.string().trim().max(100).optional().transform((v) => v || null),
  cost: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().min(0).nullable()).optional(),
});

travelRouter.post("/:requestId/bookings", requireRole("ADMIN"), attachmentUpload.single("voucher"), async (req, res) => {
  const user = currentUser(req);
  try {
    const trip = await loadTrip(Number(req.params.requestId));
    assertBookable(trip);
    const input = parse(bookingSchema, req.body);
    if (input.arrangedBy === "ADMIN" && !input.details) throw new HttpError(400, "Enter the booking details (e.g. flight, date and time, or hotel name)");
    const booking = await prisma.$transaction(async (tx) => {
      const voucher = req.file
        ? await tx.requestAttachment.create({
            data: { requestId: trip.requestId, fileName: req.file.originalname, path: relativeUploadPath(req.file.path), mimeType: req.file.mimetype, size: req.file.size },
          })
        : null;
      return tx.travelBooking.create({
        data: {
          travelId: trip.id, kind: input.kind, arrangedBy: input.arrangedBy,
          details: input.details || (input.arrangedBy === "EMPLOYEE" ? "Employee to arrange" : ""),
          provider: input.provider ?? null, reference: input.reference ?? null, cost: input.cost ?? null,
          voucherId: voucher?.id ?? null, createdById: user.id,
        },
      });
    });
    await audit(user.id, "CREATE", "TravelBooking", booking.id, { requestId: trip.requestId, kind: input.kind, arrangedBy: input.arrangedBy });
    res.status(201).json({ id: booking.id });
  } catch (err) {
    removeFiles(req.file ? [req.file] : []);
    throw err;
  }
});

travelRouter.delete("/:requestId/bookings/:bookingId", requireRole("ADMIN"), async (req, res) => {
  const trip = await loadTrip(Number(req.params.requestId));
  if (trip.cancelledAt) throw new HttpError(400, "This trip was cancelled");
  const booking = trip.bookings.find((b) => b.id === Number(req.params.bookingId));
  if (!booking) throw new HttpError(404, "Booking not found");
  await prisma.travelBooking.delete({ where: { id: booking.id } });
  await audit(currentUser(req).id, "DELETE", "TravelBooking", booking.id, { requestId: trip.requestId });
  res.json({ ok: true });
});

const ARRANGED = { ADMIN: "booked by Admin", EMPLOYEE: "you arrange it and claim it in the settlement" } as const;

travelRouter.post("/:requestId/booked", requireRole("ADMIN"), async (req, res) => {
  const user = currentUser(req);
  const trip = await loadTrip(Number(req.params.requestId));
  assertBookable(trip);
  if (!trip.bookings.length) throw new HttpError(400, "Add at least one booking item first");
  await prisma.travelRequest.update({ where: { id: trip.id }, data: { bookingStatus: "BOOKED", bookedAt: new Date(), bookedById: user.id } });
  const items = trip.bookings.map((b) => `${b.kind.charAt(0)}${b.kind.slice(1).toLowerCase()}: ${b.details} (${ARRANGED[b.arrangedBy]})`).join("; ");
  await notify([trip.request.employeeId], `Your travel is booked: ${trip.origin} → ${trip.destination}`, `Bookings for ${tripName(trip)}: ${items}. Tickets and vouchers are on the request.`, link(trip));
  await audit(user.id, "UPDATE", "TravelRequest", trip.id, { booked: true });
  res.json({ ok: true });
});

// ---------- Cancellation ----------

const reasonSchema = z.object({ reason: z.string().trim().min(3, "Give a reason") });

travelRouter.post("/:requestId/cancel", async (req, res) => {
  const user = currentUser(req);
  const { reason } = parse(reasonSchema, req.body);
  const trip = await loadTrip(Number(req.params.requestId));
  const isTraveller = trip.request.employeeId === user.id;
  const isManager = trip.request.employee.managerId === user.id;
  if (!isTraveller && !isManager) throw new HttpError(403, "Only the traveller or their line manager can cancel this trip");
  if (trip.cancelledAt || !["PENDING", "RETURNED", "APPROVED"].includes(trip.request.status)) throw new HttpError(400, "This trip can no longer be cancelled");
  if (trip.settlement && !["CANCELLED", "REJECTED"].includes(trip.settlement.request.status)) throw new HttpError(400, "The trip has a settlement, so it cannot be cancelled");

  const wasApproved = trip.request.status === "APPROVED";
  const pending = await prisma.requestStep.findFirst({ where: { requestId: trip.requestId, status: "PENDING" } });
  await prisma.$transaction([
    prisma.request.update({ where: { id: trip.requestId }, data: { status: "CANCELLED" } }),
    prisma.requestStep.updateMany({ where: { requestId: trip.requestId, status: { in: ["PENDING", "WAITING"] } }, data: { status: "SKIPPED" } }),
    prisma.travelRequest.update({ where: { id: trip.id }, data: { cancelledAt: new Date(), cancelledById: user.id, cancellationReason: reason } }),
    prisma.requestAction.create({ data: { requestId: trip.requestId, actorId: user.id, action: "CANCELLED", comment: reason } }),
  ]);
  await audit(user.id, "UPDATE", "TravelRequest", trip.id, { cancelled: reason });

  const who = isTraveller ? trip.request.employee.fullName : `${user.fullName} (line manager)`;
  const body = `${who} cancelled the trip ${tripName(trip)}. Reason: ${reason}`;
  const other = isTraveller ? (trip.request.employee.managerId ? [trip.request.employee.managerId] : []) : [trip.request.employeeId];
  const pendingApprovers = pending ? (pending.approverId ? [pending.approverId] : pending.approverRole ? await employeeIdsWithRole(pending.approverRole) : []) : [];
  await notify([...other, ...pendingApprovers].filter((id) => id !== user.id), `Trip cancelled: ${trip.request.title}`, body, link(trip));
  if (wasApproved) {
    await notify(await employeeIdsWithRole("ADMIN"), `Trip cancelled: ${trip.request.employee.fullName}`, `${body}. Cancel any bookings and record the cancellation fee, if any.`, link(trip));
  }
  if (trip.advancePaidAt) {
    const finance = (await employeeIdsWithRole("FINANCE")).filter((id) => id !== trip.request.employeeId);
    await notify(finance, `Advance to recover: ${trip.request.employee.fullName}`, `${body}. The advance of ${pkr(Number(trip.advanceRequested))} must be returned; record the return when received.`, link(trip));
  }
  res.json({ ok: true });
});

const feeSchema = z.object({ fee: z.coerce.number().min(0, "Enter the fee (0 if none)"), note: z.string().trim().max(500).optional().default("") });

travelRouter.post("/:requestId/cancellation-fee", requireRole("ADMIN"), async (req, res) => {
  const user = currentUser(req);
  const input = parse(feeSchema, req.body);
  const trip = await loadTrip(Number(req.params.requestId));
  if (!trip.cancelledAt) throw new HttpError(400, "The trip is not cancelled");
  await prisma.travelRequest.update({ where: { id: trip.id }, data: { cancellationFee: round2(input.fee), cancellationFeeNote: input.note || null } });
  await prisma.requestAction.create({ data: { requestId: trip.requestId, actorId: user.id, action: "CANCELLATION_FEE", comment: `${pkr(input.fee)} (paid by the company)${input.note ? `: ${input.note}` : ""}` } });
  await audit(user.id, "UPDATE", "TravelRequest", trip.id, { cancellationFee: input.fee, note: input.note });
  if (input.fee > 0) {
    await notify(await employeeIdsWithRole("FINANCE"), `Cancellation fee: ${trip.request.employee.fullName}`, `A cancellation fee of ${pkr(input.fee)} was recorded for ${tripName(trip)}. The company bears it.`, link(trip));
  }
  res.json({ ok: true });
});

travelRouter.post("/:requestId/finance-note", requireRole("FINANCE"), async (req, res) => {
  const user = currentUser(req);
  const { note } = parse(z.object({ note: z.string().trim().min(2, "Write a note").max(500) }), req.body);
  const trip = await loadTrip(Number(req.params.requestId));
  if (!trip.cancelledAt) throw new HttpError(400, "Notes are for cancelled trips");
  await prisma.travelRequest.update({ where: { id: trip.id }, data: { financeNote: note } });
  await prisma.requestAction.create({ data: { requestId: trip.requestId, actorId: user.id, action: "FINANCE_NOTE", comment: note } });
  res.json({ ok: true });
});

// ---------- Advance ----------

const advancePaidSchema = z.object({
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the payment date"),
  method: z.enum(["BANK_TRANSFER", "CASH"], { message: "Choose bank transfer or cash" }),
  reference: z.string().trim().min(1, "Enter the payment reference").max(100),
});

travelRouter.post("/:requestId/advance-paid", async (req, res) => {
  const user = currentUser(req);
  const input = parse(advancePaidSchema, req.body);
  const trip = await loadTrip(Number(req.params.requestId));
  assertFinanceFor(user, trip);
  if (Number(trip.advanceRequested) <= 0) throw new HttpError(400, "No advance was requested");
  if (trip.request.status !== "APPROVED" || trip.cancelledAt) throw new HttpError(400, "The advance can be paid once the trip is approved");
  if (trip.advancePaidAt) throw new HttpError(400, "The advance is already marked as paid");
  if (input.paidOn > todayYmd()) throw new HttpError(400, "The payment date cannot be in the future");
  await prisma.travelRequest.update({
    where: { id: trip.id },
    data: { advancePaidOn: toDate(input.paidOn), advanceMethod: input.method, advanceReference: input.reference, advancePaidAt: new Date(), advancePaidById: user.id },
  });
  const summary = `${pkr(Number(trip.advanceRequested))} paid by ${input.method === "CASH" ? "cash" : "bank transfer"} on ${input.paidOn}, reference ${input.reference}`;
  await prisma.requestAction.create({ data: { requestId: trip.requestId, actorId: user.id, action: "ADVANCE_PAID", comment: summary } });
  await audit(user.id, "UPDATE", "TravelRequest", trip.id, { advancePaid: summary });
  await notify([trip.request.employeeId], `Travel advance paid: ${trip.origin} → ${trip.destination}`, `Your travel advance was paid: ${summary}. Settle it within the deadline after you return.`, link(trip));
  res.json({ ok: true });
});

const returnSchema = z.object({
  amount: z.coerce.number().positive("Enter the amount returned"),
  method: z.enum(["CASH_OR_BANK", "SALARY_DEDUCTION"], { message: "Choose cash/bank or salary deduction" }),
  returnedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date"),
  reference: z.string().trim().max(100).optional().default(""),
});

travelRouter.post("/:requestId/advance-return", async (req, res) => {
  const user = currentUser(req);
  const input = parse(returnSchema, req.body);
  const trip = await loadTrip(Number(req.params.requestId));
  assertFinanceFor(user, trip);
  const due = advanceDue(trip);
  if (due <= 0) throw new HttpError(400, "No advance is due to be returned for this trip");
  if (round2(input.amount) !== due) throw new HttpError(400, `The amount due is ${pkr(due)}`);
  if (input.returnedOn > todayYmd()) throw new HttpError(400, "The date cannot be in the future");
  await prisma.travelRequest.update({
    where: { id: trip.id },
    data: { advanceReturnedAmount: due, advanceReturnMethod: input.method, advanceReturnedOn: toDate(input.returnedOn), advanceReturnReference: input.reference || null, advanceReturnedById: user.id },
  });
  const how = input.method === "SALARY_DEDUCTION" ? "salary deduction" : "cash/bank";
  const summary = `${pkr(due)} returned by ${how} on ${input.returnedOn}${input.reference ? `, reference ${input.reference}` : ""}`;
  await prisma.requestAction.create({ data: { requestId: trip.requestId, actorId: user.id, action: "ADVANCE_RETURNED", comment: summary } });
  await audit(user.id, "UPDATE", "TravelRequest", trip.id, { advanceReturned: summary });
  await notify([trip.request.employeeId], `Advance return recorded: ${trip.origin} → ${trip.destination}`, `Finance recorded the return of your unused travel advance: ${summary}.`, link(trip));
  res.json({ ok: true });
});

// ---------- Settlement helpers for the form ----------

travelRouter.get("/:requestId/settlement-info", async (req, res) => {
  const user = currentUser(req);
  const trip = await prisma.travelRequest.findUnique({ where: { requestId: Number(req.params.requestId) }, include: travelInclude });
  if (!trip) throw new HttpError(404, "Travel request not found");
  if (trip.request.employeeId !== user.id) throw new HttpError(403, "Only the traveller can settle this trip");
  const rules = await travelRules();
  res.json({
    requestId: trip.requestId,
    origin: trip.origin, destination: trip.destination, departDate: ymd(trip.departDate), returnDate: ymd(trip.returnDate), mode: trip.mode,
    advancePaid: trip.advancePaidAt ? Number(trip.advanceRequested) : 0,
    bookings: trip.bookings.map((b) => ({ kind: b.kind, arrangedBy: b.arrangedBy, details: b.details })),
    window: settlementWindow(trip, rules.settlementDays),
    rules,
    settlementRequestId: trip.settlement && !["CANCELLED", "REJECTED"].includes(trip.settlement.request.status) ? trip.settlement.requestId : null,
  });
});

const settlementCheckSchema = z.object({
  travelRequestId: z.number().int(),
  lines: z.array(settlementLineSchema.extend({ hasReceipt: z.boolean() })).min(1).max(40),
  excludeRequestId: z.number().int().optional(),
});

travelRouter.post("/settlement-check", async (req, res) => {
  const user = currentUser(req);
  const parsed = settlementCheckSchema.safeParse(req.body);
  if (!parsed.success) return res.json({ total: 0, net: 0, errors: [issues(parsed.error)], warnings: [], lines: [], approvers: [] });
  const trip = await prisma.travelRequest.findUnique({ where: { requestId: parsed.data.travelRequestId }, include: travelInclude });
  if (!trip) throw new HttpError(404, "Travel request not found");
  const result = await evaluateSettlement(user.id, trip, parsed.data.lines, parsed.data.excludeRequestId);
  const steps = await prisma.$transaction(async (tx) => resolveSteps(tx, user.id, SETTLEMENT_CHAIN));
  const names = await prisma.employee.findMany({ where: { id: { in: steps.flatMap((s) => (s.approverId ? [s.approverId] : [])) } }, select: { id: true, fullName: true } });
  res.json({
    total: result.total, advancePaid: result.advancePaid, net: result.net, errors: result.errors, warnings: result.warnings,
    lines: result.lines.map((l) => ({ amount: l.amount, rate: l.rate })),
    approvers: steps.map((s) => (s.approverId ? `${s.label} (${names.find((n) => n.id === s.approverId)?.fullName})` : s.label)),
  });
});

// ---------- Lists for Admin / Finance / HR / Management ----------

travelRouter.get("/trips", requireRole("ADMIN", "FINANCE", "HR", "MANAGEMENT"), async (req, res) => {
  const view = typeof req.query.view === "string" ? req.query.view : "all";
  const approved = { request: { status: "APPROVED" as const }, cancelledAt: null };
  const where: Prisma.TravelRequestWhereInput =
    view === "to-book" ? { ...approved, bookingStatus: "PENDING" }
    : view === "booked" ? { ...approved, bookingStatus: "BOOKED" }
    : view === "advances" ? { ...approved, advanceRequested: { gt: 0 }, advancePaidAt: null }
    : view === "settlements" ? { settlement: { request: { status: "APPROVED" }, paidAt: null } }
    : view === "cancelled" ? { cancelledAt: { not: null } }
    : view === "returns" ? { advancePaidAt: { not: null }, advanceReturnedAmount: null, OR: [{ cancelledAt: { not: null } }, { settlement: { request: { status: "APPROVED" } } }] }
    : {};
  const rows = await prisma.travelRequest.findMany({
    where,
    include: {
      request: { select: { id: true, status: true, createdAt: true, employee: { select: { fullName: true, code: true, department: { select: { name: true } } } } } },
      bookings: { select: { id: true } },
      settlement: { include: { request: { select: { id: true, status: true } }, lines: true } },
    },
    orderBy: { departDate: "asc" },
    take: 200,
  });
  const list = rows
    .map((t) => {
      const settled = t.settlement ? approvedTotal(t.settlement.lines) : null;
      const advance = t.advancePaidAt ? Number(t.advanceRequested) : 0;
      return {
        requestId: t.requestId,
        status: t.request.status,
        employee: { fullName: t.request.employee.fullName, code: t.request.employee.code, department: t.request.employee.department?.name ?? null },
        route: `${t.origin} → ${t.destination}`,
        departDate: ymd(t.departDate),
        returnDate: ymd(t.returnDate),
        mode: t.mode,
        needsHotel: t.needsHotel,
        bookingStatus: t.bookingStatus,
        bookings: t.bookings.length,
        advanceRequested: Number(t.advanceRequested),
        advancePaid: !!t.advancePaidAt,
        advanceDue: advanceDue(t),
        cancelled: !!t.cancelledAt,
        cancellationFee: t.cancellationFee == null ? null : Number(t.cancellationFee),
        settlement: t.settlement
          ? { requestId: t.settlement.request.id, status: t.settlement.request.status, approvedTotal: settled, toPay: settled != null ? round2(settled - advance) : null, paid: !!t.settlement.paidAt }
          : null,
      };
    })
    // "Settlements to pay" only lists those where the company owes the employee something.
    .filter((t) => view !== "settlements" || (t.settlement?.toPay ?? 0) > 0)
    .filter((t) => view !== "returns" || t.advanceDue > 0);
  res.json(list);
});
