import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { minutesToHm, MONTHS, parseMonth, toDate, todayYmd } from "../lib/dates.js";
import { currentUser, hasRole, requireAuth } from "../middleware/auth.js";
import { monthlyAttendance } from "../services/attendance.js";
import { balancesFor } from "../services/leave.js";
import { pendingForUserWhere, TYPE_LABELS } from "../services/approvals.js";

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

/** Today's in-time, this month's attendance, leave balances, pending requests and approval tasks in one call. */
dashboardRouter.get("/", async (req, res) => {
  const user = currentUser(req);
  const today = todayYmd();
  const { year, month } = parseMonth(undefined);

  const [todayRecord, attendance, balances, myPending, tasks, unread, latestPayslip] = await Promise.all([
    prisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: user.id, date: toDate(today) } } }),
    monthlyAttendance(user.id, year, month),
    balancesFor(user.id, year),
    prisma.request.findMany({
      where: { employeeId: user.id, status: { in: ["PENDING", "RETURNED"] } },
      include: { steps: { select: { order: true, label: true } } },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.requestStep.findMany({
      where: pendingForUserWhere(user),
      include: { request: { include: { employee: { select: { fullName: true, code: true } } } } },
      orderBy: { pendingSince: "asc" },
      take: 10,
    }),
    prisma.notification.count({ where: { employeeId: user.id, read: false } }),
    prisma.payslip.findFirst({ where: { employeeId: user.id }, orderBy: [{ year: "desc" }, { month: "desc" }] }),
  ]);

  let hr = null;
  if (hasRole(user, "HR")) {
    const [lateWarnings, employees, onLeaveToday] = await Promise.all([
      prisma.lateWarning.count({ where: { year, month } }),
      prisma.employee.count({ where: { status: "ACTIVE" } }),
      prisma.leaveRequest.count({ where: { startDate: { lte: toDate(today) }, endDate: { gte: toDate(today) }, request: { status: "APPROVED" } } }),
    ]);
    hr = { lateWarningsThisMonth: lateWarnings, activeEmployees: employees, onLeaveToday };
  }

  res.json({
    today,
    todayAttendance: todayRecord
      ? {
          checkIn: minutesToHm(todayRecord.correctedCheckIn ?? todayRecord.checkIn),
          checkOut: minutesToHm(todayRecord.correctedCheckOut ?? todayRecord.checkOut),
          status: todayRecord.correctedStatus ?? todayRecord.status,
        }
      : null,
    month: { year, month, name: MONTHS[month - 1], summary: attendance.summary, lastImported: attendance.lastImported },
    balances,
    myPending: myPending.map((r) => ({
      id: r.id, title: r.title, type: r.type, typeLabel: TYPE_LABELS[r.type], status: r.status, createdAt: r.createdAt,
      currentStepLabel: r.status === "PENDING" ? r.steps.find((s) => s.order === r.currentStep)?.label ?? null : null,
    })),
    tasks: tasks.map((s) => ({
      requestId: s.requestId, title: s.request.title, typeLabel: TYPE_LABELS[s.request.type], step: s.label,
      employee: s.request.employee.fullName, pendingSince: s.pendingSince,
    })),
    unreadNotifications: unread,
    latestPayslip: latestPayslip ? { id: latestPayslip.id, year: latestPayslip.year, month: latestPayslip.month, monthName: MONTHS[latestPayslip.month - 1], netPay: Number(latestPayslip.netPay) } : null,
    hr,
  });
});
