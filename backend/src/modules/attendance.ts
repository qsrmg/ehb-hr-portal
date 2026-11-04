import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { sheetUpload } from "../lib/upload.js";
import { readSheet } from "../lib/sheet.js";
import { getSettings } from "../lib/settings.js";
import { isYmd, minutesToHm, monthRange, MONTHS, parseMonth, toDate, todayYmd } from "../lib/dates.js";
import { HttpError } from "../middleware/error.js";
import { canSeeWorkInfo, currentUser, hasRole, requireAuth, requireRole } from "../middleware/auth.js";
import { importAttendance, monthlyAttendance, holidayMap, lastImportedDate } from "../services/attendance.js";

export const attendanceRouter = Router();
attendanceRouter.use(requireAuth);

async function updateRequestsUsed(employeeId: number, year: number, month: number) {
  const { start, end } = monthRange(year, month);
  return prisma.attendanceUpdateRequest.count({
    where: { date: { gte: start, lte: end }, request: { employeeId, status: { in: ["PENDING", "APPROVED", "RETURNED"] } } },
  });
}

attendanceRouter.get("/me", async (req, res) => {
  const user = currentUser(req);
  const { year, month } = parseMonth(req.query.month);
  const settings = await getSettings();
  res.json({
    ...(await monthlyAttendance(user.id, year, month)),
    updateRequests: { used: await updateRequestsUsed(user.id, year, month), max: Number(settings["attendanceUpdate.maxPerMonth"]), windowDays: Number(settings["attendanceUpdate.windowDays"]) },
    rules: { lateAfter: settings["attendance.lateAfter"], presentHours: settings["attendance.presentHours"], halfDayHours: settings["attendance.halfDayHours"] },
  });
});

attendanceRouter.get("/employee/:id", async (req, res) => {
  const user = currentUser(req);
  const id = Number(req.params.id);
  if (!(await canSeeWorkInfo(user, id))) throw new HttpError(403, "You can only view your own team's attendance");
  const { year, month } = parseMonth(req.query.month);
  const emp = await prisma.employee.findUnique({ where: { id }, select: { fullName: true, code: true } });
  if (!emp) throw new HttpError(404, "Employee not found");
  res.json({ employee: emp, ...(await monthlyAttendance(id, year, month)) });
});

/** Who is in, late, on leave or absent on a day. HR / Management see everyone; line managers see their team. */
attendanceRouter.get("/daily", async (req, res) => {
  const user = currentUser(req);
  const date = typeof req.query.date === "string" && isYmd(req.query.date) ? req.query.date : todayYmd();
  const all = hasRole(user, "HR", "MANAGEMENT");
  const employees = await prisma.employee.findMany({
    where: { status: "ACTIVE", ...(all ? {} : { managerId: user.id }) },
    select: { id: true, code: true, fullName: true, designation: true, department: { select: { name: true } } },
    orderBy: { fullName: "asc" },
  });
  const d = toDate(date);
  const ids = employees.map((e) => e.id);
  const [records, leaves, holidays, lastImported] = await Promise.all([
    prisma.attendanceRecord.findMany({ where: { date: d, employeeId: { in: ids } } }),
    prisma.leaveRequest.findMany({
      where: { startDate: { lte: d }, endDate: { gte: d }, request: { status: "APPROVED", employeeId: { in: ids } } },
      include: { leaveType: { select: { name: true } }, request: { select: { employeeId: true } } },
    }),
    holidayMap(d, d),
    lastImportedDate(),
  ]);
  const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
  const rows = employees.map((e) => {
    const r = records.find((x) => x.employeeId === e.id);
    const leave = leaves.find((l) => l.request.employeeId === e.id);
    const effective = r ? r.correctedStatus ?? r.status : null;
    let status: string;
    if (weekend) status = "WEEKEND";
    else if (holidays.size) status = "HOLIDAY";
    else if (leave && (!effective || effective === "ABSENT")) status = "LEAVE";
    else if (effective) status = effective;
    else status = lastImported && date <= lastImported ? "ABSENT" : "NO_DATA";
    return {
      employeeId: e.id, code: e.code, fullName: e.fullName, designation: e.designation, department: e.department?.name ?? null,
      status, leaveType: leave?.leaveType.name ?? null,
      checkIn: minutesToHm(r?.correctedCheckIn ?? r?.checkIn), checkOut: minutesToHm(r?.correctedCheckOut ?? r?.checkOut),
    };
  });
  res.json({ date, lastImported, rows });
});

attendanceRouter.post("/import", requireRole("HR"), sheetUpload.single("file"), async (req, res) => {
  if (!req.file) throw new HttpError(400, "Choose a file to import");
  const rows = await readSheet(req.file.buffer, req.file.originalname);
  res.json(await importAttendance(rows, req.file.originalname, currentUser(req).id));
});

attendanceRouter.get("/imports", requireRole("HR"), async (_req, res) => {
  const rows = await prisma.attendanceImport.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  res.json(rows);
});

attendanceRouter.get("/late-warnings", requireRole("HR", "MANAGEMENT"), async (_req, res) => {
  const rows = await prisma.lateWarning.findMany({
    orderBy: [{ year: "desc" }, { month: "desc" }, { lateCount: "desc" }],
    include: { employee: { select: { id: true, code: true, fullName: true, department: { select: { name: true } }, manager: { select: { fullName: true } } } } },
    take: 200,
  });
  res.json(rows.map((w) => ({
    id: w.id, year: w.year, month: w.month, monthName: MONTHS[w.month - 1], lateCount: w.lateCount, createdAt: w.createdAt,
    employee: { id: w.employee.id, code: w.employee.code, fullName: w.employee.fullName, department: w.employee.department?.name ?? null, manager: w.employee.manager?.fullName ?? null },
  })));
});
