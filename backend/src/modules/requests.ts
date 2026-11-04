import fs from "node:fs";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { audit } from "../lib/audit.js";
import { getSettings } from "../lib/settings.js";
import {
  attachmentUpload, absoluteUploadPath, relativeUploadPath, removeFiles,
} from "../lib/upload.js";
import { hmToMinutes, isWeekend, minutesToHm, monthRange, toDate, todayYmd, ymd } from "../lib/dates.js";
import { HttpError } from "../middleware/error.js";
import { currentUser, hasRole, requireAuth, type AuthUser } from "../middleware/auth.js";
import {
  actOnRequest, canActOnStep, cancelRequest, createSteps, notifySubmitted, pendingForUserWhere,
  resolveSteps, restartChain, TYPE_LABELS, type OnApproved, type StepSpec,
} from "../services/approvals.js";
import { deductLeave, evaluateLeave } from "../services/leave.js";
import { computeStatus, getAttendanceRules, holidayMap } from "../services/attendance.js";
import { letterPdf } from "../services/pdf.js";
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
};

const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const r = schema.safeParse(body);
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => i.message).join("; "));
  return r.data;
};

/** Validates the form for each request type and returns its approval chain and how to save it. */
async function prepare(type: RequestType, user: AuthUser, body: unknown, attachmentCount: number, existingId?: number): Promise<Prepared> {
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

  const input = parse(letterSchema, body);
  return {
    title: LETTER_TYPES[input.letterType],
    data: input,
    chain: [{ label: "HR", approver: "HR" }],
    persist: async () => {},
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
  // LETTER: the PDF is generated on download from the approved request.
};

const TYPE_ROUTES: Record<string, RequestType> = {
  leave: "LEAVE",
  "attendance-update": "ATTENDANCE_UPDATE",
  letter: "LETTER",
};

async function saveAttachments(tx: Tx, requestId: number, files: Express.Multer.File[]) {
  if (!files.length) return;
  await tx.requestAttachment.createMany({
    data: files.map((f) => ({
      requestId, fileName: f.originalname, path: relativeUploadPath(f.path), mimeType: f.mimetype, size: f.size,
    })),
  });
}

// Submit a new request: POST /requests/leave | /requests/attendance-update | /requests/letter
requestsRouter.post("/:type", attachmentUpload.array("attachments", 5), async (req, res) => {
  const user = currentUser(req);
  const type = TYPE_ROUTES[String(req.params.type)];
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!type) { removeFiles(files); throw new HttpError(404, "Unknown request type"); }
  try {
    const prepared = await prepare(type, user, req.body, files.length);
    const request = await prisma.$transaction(async (tx) => {
      const created = await tx.request.create({
        data: { type, employeeId: user.id, title: prepared.title, data: prepared.data },
      });
      await prepared.persist(tx, created.id, false);
      await saveAttachments(tx, created.id, files);
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
requestsRouter.put("/:id/resubmit", attachmentUpload.array("attachments", 5), async (req, res) => {
  const user = currentUser(req);
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  try {
    const id = Number(req.params.id);
    const existing = await prisma.request.findUnique({ where: { id }, include: { _count: { select: { attachments: true } } } });
    if (!existing) throw new HttpError(404, "Request not found");
    if (existing.employeeId !== user.id) throw new HttpError(403, "Only the person who submitted it can resubmit");
    if (existing.status !== "RETURNED") throw new HttpError(400, "Only returned requests can be edited and resubmitted");
    const prepared = await prepare(existing.type, user, req.body, existing._count.attachments + files.length, id);
    await prisma.$transaction(async (tx) => {
      await tx.request.update({ where: { id }, data: { title: prepared.title, data: prepared.data } });
      await prepared.persist(tx, id, true);
      await saveAttachments(tx, id, files);
      await restartChain(tx, id, user.id, prepared.chain, user.id);
    });
    await notifySubmitted(id, true);
    res.json({ id });
  } catch (err) {
    removeFiles(files);
    throw err;
  }
});

const actionSchema = z.object({ comment: z.string().optional() });

for (const action of ["approve", "reject", "return"] as const) {
  requestsRouter.post(`/:id/${action}`, async (req, res) => {
    const { comment } = actionSchema.parse(req.body ?? {});
    await actOnRequest(Number(req.params.id), currentUser(req), action.toUpperCase() as "APPROVE", comment, onApproved);
    res.json({ ok: true });
  });
}

requestsRouter.post("/:id/cancel", async (req, res) => {
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
} satisfies Prisma.RequestInclude;

type Detail = Prisma.RequestGetPayload<{ include: typeof detailInclude }>;

async function loadForUser(id: number, user: AuthUser): Promise<Detail> {
  const r = await prisma.request.findUnique({ where: { id }, include: detailInclude });
  if (!r) throw new HttpError(404, "Request not found");
  const allowed =
    r.employeeId === user.id ||
    hasRole(user, "HR", "MANAGEMENT") ||
    r.employee.managerId === user.id ||
    r.steps.some((s) => s.approverId === user.id || s.actedById === user.id || (s.approverRole && hasRole(user, s.approverRole)));
  if (!allowed) throw new HttpError(403, "You do not have access to this request");
  return r;
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
    canAct: current ? canActOnStep(user, r.employeeId, current) : false,
    canResubmit: r.status === "RETURNED" && r.employeeId === user.id,
    canCancel: ["PENDING", "RETURNED"].includes(r.status) && r.employeeId === user.id,
    letterAvailable: r.type === "LETTER" && r.status === "APPROVED" && (r.employeeId === user.id || hasRole(user, "HR")),
  });
});

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
