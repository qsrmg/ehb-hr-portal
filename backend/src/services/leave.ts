import { prisma } from "../lib/prisma.js";
import { audit } from "../lib/audit.js";
import { nowParts, toDate, todayYmd, ymd } from "../lib/dates.js";
import { HttpError } from "../middleware/error.js";
import { countWorkingDays } from "./attendance.js";
import { lastWorkingDayLimit } from "./exits.js";
import type { LeaveType, Prisma } from "../generated/prisma/client.js";

type Db = typeof prisma | Prisma.TransactionClient;

const roundHalf = (n: number) => Math.round(n * 2) / 2;

/** Yearly entitlement; pro-rated by remaining months for employees who join during the year. */
export function entitlementFor(type: LeaveType, joiningDate: Date, year: number) {
  if (type.annualQuota == null) return 0;
  const quota = Number(type.annualQuota);
  const joinYear = joiningDate.getUTCFullYear();
  if (joinYear > year) return 0;
  if (!type.proRata || joinYear < year) return quota;
  const monthsRemaining = 12 - joiningDate.getUTCMonth();
  return roundHalf((quota * monthsRemaining) / 12);
}

/** Leave types that apply to an employee (maternity / paternity are gender-specific). */
export async function applicableTypes(employeeId: number) {
  const emp = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { gender: true } });
  const types = await prisma.leaveType.findMany({ where: { active: true }, orderBy: { id: "asc" } });
  return types.filter((t) => !t.gender || t.gender === emp.gender);
}

export async function ensureBalance(db: Db, employeeId: number, type: LeaveType, year: number) {
  const existing = await db.leaveBalance.findUnique({
    where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId: type.id, year } },
  });
  if (existing) return existing;
  const emp = await db.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { joiningDate: true } });
  return db.leaveBalance.create({
    data: { employeeId, leaveTypeId: type.id, year, entitled: entitlementFor(type, emp.joiningDate, year) },
  });
}

/** Days in pending (or returned) leave requests, which are held against the balance. */
async function pendingDays(employeeId: number, leaveTypeId: number, year: number, excludeRequestId?: number) {
  const rows = await prisma.leaveRequest.findMany({
    where: {
      leaveTypeId,
      startDate: { gte: toDate(`${year}-01-01`), lte: toDate(`${year}-12-31`) },
      request: { employeeId, status: { in: ["PENDING", "RETURNED"] }, ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}) },
    },
    select: { days: true },
  });
  return rows.reduce((sum, r) => sum + Number(r.days), 0);
}

export async function balancesFor(employeeId: number, year: number) {
  const types = await applicableTypes(employeeId);
  return Promise.all(
    types.map(async (type) => {
      const b = await ensureBalance(prisma, employeeId, type, year);
      const pending = await pendingDays(employeeId, type.id, year);
      const total = Number(b.entitled) + Number(b.carriedForward);
      return {
        balanceId: b.id,
        leaveTypeId: type.id,
        code: type.code,
        name: type.name,
        hasQuota: type.annualQuota != null,
        entitled: Number(b.entitled),
        entitledManual: b.entitledManual,
        carriedForward: Number(b.carriedForward),
        used: Number(b.used),
        pending,
        available: type.annualQuota == null ? null : total - Number(b.used) - pending,
      };
    }),
  );
}

export type LeaveInput = { leaveTypeId: number; startDate: string; endDate: string; reason?: string };

/**
 * Checks a leave application against the rules: dates, working days, notice period, overlap, balance and
 * whether a supporting document is needed. Returns problems instead of throwing so the form can preview them.
 */
export async function evaluateLeave(employeeId: number, input: LeaveInput, excludeRequestId?: number) {
  const errors: string[] = [];
  const type = await prisma.leaveType.findUnique({ where: { id: input.leaveTypeId } });
  if (!type || !type.active) throw new HttpError(400, "Unknown leave type");
  const applicable = await applicableTypes(employeeId);
  if (!applicable.some((t) => t.id === type.id)) errors.push(`${type.name} does not apply to you`);

  const start = toDate(input.startDate);
  const end = toDate(input.endDate);
  if (end < start) errors.push("End date is before start date");
  if (start.getUTCFullYear() !== end.getUTCFullYear()) errors.push("Leave cannot cross into the next year; apply separately for each year");

  const days = end >= start ? await countWorkingDays(start, end) : 0;
  if (end >= start && days === 0) errors.push("The selected dates contain no working days");

  const today = todayYmd();
  const noticeGiven = Math.round((start.getTime() - toDate(today).getTime()) / 86_400_000);
  if (type.noticeDays > 0 && noticeGiven < type.noticeDays) {
    errors.push(`${type.name} needs ${type.noticeDays} days' notice (apply by ${ymd(new Date(start.getTime() - type.noticeDays * 86_400_000))})`);
  }

  const overlap = await prisma.leaveRequest.findFirst({
    where: {
      startDate: { lte: end },
      endDate: { gte: start },
      request: { employeeId, status: { in: ["PENDING", "APPROVED", "RETURNED"] }, ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}) },
    },
    include: { request: { select: { id: true } } },
  });
  if (overlap) errors.push(`These dates overlap with leave request #${overlap.request.id}`);
  const lastDay = await lastWorkingDayLimit(employeeId);
  if (lastDay && end > lastDay) errors.push(`Your last working day is ${ymd(lastDay)}; leave cannot go beyond it`);

  const year = start.getUTCFullYear();
  let available: number | null = null;
  if (type.annualQuota != null) {
    const b = await ensureBalance(prisma, employeeId, type, year);
    const pending = await pendingDays(employeeId, type.id, year, excludeRequestId);
    available = Number(b.entitled) + Number(b.carriedForward) - Number(b.used) - pending;
    if (days > available) errors.push(`Not enough ${type.name} balance: ${available} day(s) available, ${days} requested`);
  }

  const documentRequired = type.documentAfterDays != null && days > type.documentAfterDays;
  return { type, days, available, documentRequired, errors };
}

/** On approval the days are deducted from the balance. */
export async function deductLeave(db: Db, employeeId: number, leaveTypeId: number, startDate: Date, days: number) {
  const type = await db.leaveType.findUniqueOrThrow({ where: { id: leaveTypeId } });
  const b = await ensureBalance(db, employeeId, type, startDate.getUTCFullYear());
  await db.leaveBalance.update({ where: { id: b.id }, data: { used: { increment: days } } });
}

/**
 * Recomputes the yearly entitlement from the employee's current joining date and the leave type's current
 * quota / pro-rata setting. Only this year and later are touched (past years are closed), and balances HR
 * adjusted by hand are left alone.
 */
export async function recalculateEntitlements(where: { employeeId?: number; leaveTypeId?: number }) {
  const fromYear = Number(todayYmd().slice(0, 4));
  const balances = await prisma.leaveBalance.findMany({
    where: { ...where, year: { gte: fromYear } },
    include: { leaveType: true, employee: { select: { joiningDate: true } } },
  });
  let updated = 0;
  let keptManual = 0;
  for (const b of balances) {
    if (b.entitledManual) {
      keptManual++;
      continue;
    }
    const entitled = entitlementFor(b.leaveType, b.employee.joiningDate, b.year);
    if (entitled !== Number(b.entitled)) {
      await prisma.leaveBalance.update({ where: { id: b.id }, data: { entitled } });
      updated++;
    }
  }
  return { updated, keptManual };
}

/** Run by the job queue on 1 January: carries last year's unused leave into the new year. */
export async function yearEndCarryForward(now = new Date()) {
  const fromYear = Number(nowParts(now).ymd.slice(0, 4)) - 1;
  const updated = await carryForward(fromYear);
  await audit(null, "CARRY_FORWARD", "LeaveBalance", null, { fromYear, updated, automatic: true });
  return { fromYear, updated };
}

/** Carries unused balance into the next year, capped per leave type (Annual Leave: 14 days). */
export async function carryForward(fromYear: number) {
  const types = await prisma.leaveType.findMany({ where: { carryForwardMax: { not: null } } });
  const employees = await prisma.employee.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
  let updated = 0;
  for (const type of types) {
    for (const { id } of employees) {
      const prev = await prisma.leaveBalance.findUnique({
        where: { employeeId_leaveTypeId_year: { employeeId: id, leaveTypeId: type.id, year: fromYear } },
      });
      if (!prev) continue;
      const unused = Number(prev.entitled) + Number(prev.carriedForward) - Number(prev.used);
      const carry = Math.max(0, Math.min(unused, Number(type.carryForwardMax)));
      const next = await ensureBalance(prisma, id, type, fromYear + 1);
      await prisma.leaveBalance.update({ where: { id: next.id }, data: { carriedForward: carry } });
      updated++;
    }
  }
  return updated;
}
