// Demo data for testing Phase 1. Run with: npm run db:seed (on an empty database).
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import PDFDocument from "pdfkit";
import { prisma } from "../src/lib/prisma.js";
import { addDays, eachDay, isWeekend, toDate, todayYmd, ymd } from "../src/lib/dates.js";
import { checkLateWarnings, computeStatus, getAttendanceRules } from "../src/services/attendance.js";
import { ensureBalance, deductLeave } from "../src/services/leave.js";
import { uploadRoot } from "../src/lib/upload.js";
import type { Role } from "../src/generated/prisma/client.js";

const PASSWORD = "Password@123";

async function main() {
  if (await prisma.employee.count()) {
    console.log("Database already has employees; skipping seed. Run `npm run db:reset` to start over.");
    return;
  }
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const dept = async (name: string) => prisma.department.create({ data: { name } });
  const [mgmt, hrDept, finDept, adminDept, eng] = await Promise.all(
    ["Management", "Human Resources", "Finance", "Administration", "Engineering"].map(dept),
  );

  let seq = 0;
  const emp = async (p: {
    email: string; fullName: string; roles: Role[]; departmentId: number; designation: string; joiningDate: string;
    managerId?: number; gender: "MALE" | "FEMALE"; gross: number; machineId: string;
  }) => {
    seq++;
    return prisma.employee.create({
      data: {
        code: `EHB-${p.joiningDate.slice(0, 4)}-${String(seq).padStart(3, "0")}`,
        email: p.email, fullName: p.fullName, roles: ["EMPLOYEE", ...p.roles], passwordHash, mustChangePassword: false,
        departmentId: p.departmentId, designation: p.designation, joiningDate: toDate(p.joiningDate),
        managerId: p.managerId ?? null, gender: p.gender, machineId: p.machineId,
        grossSalary: p.gross, basicSalary: Math.round(p.gross * 0.6),
        phone: `0300-${String(1000000 + seq * 1111).slice(0, 7)}`,
        cnic: `35202-${String(1234560 + seq)}-${seq % 10}`,
        bankName: "Meezan Bank", bankAccount: `0101-0${String(seq).padStart(6, "0")}`,
        address: "Lahore, Pakistan",
      },
    });
  };

  const ceo = await emp({ email: "ceo@ehb.local", fullName: "Imran Qureshi", roles: ["MANAGEMENT"], departmentId: mgmt.id, designation: "Chief Executive Officer", joiningDate: "2023-01-02", gender: "MALE", gross: 900000, machineId: "100" });
  const hr = await emp({ email: "hr@ehb.local", fullName: "Ayesha Siddiqui", roles: ["HR", "HOD"], departmentId: hrDept.id, designation: "HR Manager", joiningDate: "2023-02-01", managerId: ceo.id, gender: "FEMALE", gross: 350000, machineId: "101" });
  const fin = await emp({ email: "finance@ehb.local", fullName: "Bilal Ahmed", roles: ["FINANCE", "HOD"], departmentId: finDept.id, designation: "Finance Manager", joiningDate: "2023-03-01", managerId: ceo.id, gender: "MALE", gross: 340000, machineId: "102" });
  const adm = await emp({ email: "admin@ehb.local", fullName: "Usman Tariq", roles: ["ADMIN"], departmentId: adminDept.id, designation: "Admin Officer", joiningDate: "2024-01-15", managerId: ceo.id, gender: "MALE", gross: 150000, machineId: "103" });
  const mgr = await emp({ email: "manager@ehb.local", fullName: "Hamza Malik", roles: ["LINE_MANAGER", "HOD"], departmentId: eng.id, designation: "Engineering Manager", joiningDate: "2023-06-01", managerId: ceo.id, gender: "MALE", gross: 450000, machineId: "104" });
  const ali = await emp({ email: "employee@ehb.local", fullName: "Ali Raza", roles: [], departmentId: eng.id, designation: "Software Engineer", joiningDate: "2025-03-01", managerId: mgr.id, gender: "MALE", gross: 220000, machineId: "105" });
  const sara = await emp({ email: "employee2@ehb.local", fullName: "Sara Javed", roles: [], departmentId: eng.id, designation: "QA Engineer", joiningDate: "2026-04-15", managerId: mgr.id, gender: "FEMALE", gross: 160000, machineId: "106" });

  await prisma.department.update({ where: { id: hrDept.id }, data: { hodId: hr.id } });
  await prisma.department.update({ where: { id: finDept.id }, data: { hodId: fin.id } });
  await prisma.department.update({ where: { id: eng.id }, data: { hodId: mgr.id } });
  await prisma.department.update({ where: { id: mgmt.id }, data: { hodId: ceo.id } });

  // Placeholder quotas until "HR Portal — Final Rules v1" is signed off; HR can edit them in the portal.
  await prisma.leaveType.createMany({
    data: [
      { code: "AL", name: "Annual Leave", annualQuota: 14, noticeDays: 3, carryForwardMax: 14 },
      { code: "CL", name: "Casual Leave", annualQuota: 10 },
      { code: "SL", name: "Sick Leave", annualQuota: 8, documentAfterDays: 2 },
      { code: "LWP", name: "Leave Without Pay", annualQuota: null, paid: false, needsHrApproval: true, noticeDays: 3, proRata: false },
      { code: "ML", name: "Maternity Leave", annualQuota: 180, needsHrApproval: true, noticeDays: 14, proRata: false, gender: "FEMALE" },
      { code: "PL", name: "Paternity Leave", annualQuota: 30, needsHrApproval: true, noticeDays: 7, proRata: false, gender: "MALE" },
    ],
  });

  // Fixed-date public holidays; HR adds the moon-sighted Eid / Muharram / Rabi-ul-Awal dates each year.
  await prisma.holiday.createMany({
    data: [
      ["2026-02-05", "Kashmir Solidarity Day"], ["2026-03-23", "Pakistan Day"], ["2026-05-01", "Labour Day"],
      ["2026-05-28", "Youm-e-Takbeer"], ["2026-08-14", "Independence Day"], ["2026-11-09", "Iqbal Day"],
      ["2026-12-25", "Quaid-e-Azam Day"],
    ].map(([date, name]) => ({ date: toDate(date!), name: name! })),
  });

  // Attendance from the start of last month up to yesterday, as if imported from the biometric machine.
  const rules = await getAttendanceRules();
  const today = todayYmd();
  const thisMonth = toDate(`${today.slice(0, 8)}01`);
  const monthStart = new Date(Date.UTC(thisMonth.getUTCFullYear(), thisMonth.getUTCMonth() - 1, 1));
  const yesterday = addDays(toDate(today), -1);
  const holidays = new Set((await prisma.holiday.findMany()).map((h) => ymd(h.date)));
  const workdays = eachDay(monthStart, yesterday).filter((d) => !isWeekend(d) && !holidays.has(ymd(d)));

  const batch = await prisma.attendanceImport.create({
    data: { fileName: "seed-data.csv", importedById: hr.id, rowsRead: 0, rowsImported: 0, unmatchedIds: [], fromDate: monthStart, toDate: yesterday },
  });
  const t = (h: number, m: number) => h * 60 + m;
  const records: { employeeId: number; date: Date; checkIn: number | null; checkOut: number | null }[] = [];
  for (const [i, d] of workdays.entries()) {
    for (const e of [ceo, hr, fin, adm, mgr]) records.push({ employeeId: e.id, date: d, checkIn: t(8, 50 + (i % 5)), checkOut: t(17, 40 + (i % 15)) });
    // Ali: three late arrivals, one half day, one absence and a missed punch on the last day (to test Attendance Update)
    const n = workdays.length;
    if (i === n - 1) records.push({ employeeId: ali.id, date: d, checkIn: t(9, 10), checkOut: null });
    else if (i === n - 4) { /* absent: no record */ }
    else if (i === 3 || i === 8 || i === 13) records.push({ employeeId: ali.id, date: d, checkIn: t(9, 40 + i), checkOut: t(18, 30) });
    else if (i === 10) records.push({ employeeId: ali.id, date: d, checkIn: t(9, 5), checkOut: t(13, 50) });
    else records.push({ employeeId: ali.id, date: d, checkIn: t(9, i % 20), checkOut: t(18, 5) });
    // Sara: on time, one late day, and two days on approved Annual Leave (no records)
    if (i !== 6 && i !== 7) records.push({ employeeId: sara.id, date: d, checkIn: i === 2 ? t(9, 35) : t(9, 10), checkOut: t(18, 0) });
  }
  await prisma.attendanceRecord.createMany({
    data: records.map((r) => ({ ...r, status: computeStatus(r.checkIn, r.checkOut, rules), importId: batch.id })),
  });
  await prisma.attendanceImport.update({ where: { id: batch.id }, data: { rowsRead: records.length, rowsImported: records.length } });
  await checkLateWarnings([ali.id, sara.id], monthStart, yesterday);

  // Leave balances for the year, plus Sara's approved two-day Annual Leave
  const year = Number(today.slice(0, 4));
  const types = await prisma.leaveType.findMany();
  for (const e of [ceo, hr, fin, adm, mgr, ali, sara]) {
    for (const type of types) if (!type.gender || type.gender === e.gender) await ensureBalance(prisma, e.id, type, year);
  }
  const al = types.find((x) => x.code === "AL")!;
  if (workdays.length > 7) {
    const [s, f] = [workdays[6]!, workdays[7]!];
    const req = await prisma.request.create({
      data: {
        type: "LEAVE", employeeId: sara.id, status: "APPROVED", title: `Annual Leave · 2 days (${ymd(s)} to ${ymd(f)})`, data: { leaveType: al.name },
        leaveRequest: { create: { leaveTypeId: al.id, startDate: s, endDate: f, days: 2, reason: "Family event" } },
        steps: { create: { order: 0, label: "Line Manager", approverId: mgr.id, status: "APPROVED", actedById: mgr.id, actedAt: s, pendingSince: s } },
        actions: { create: [{ actorId: sara.id, action: "SUBMITTED" }, { actorId: mgr.id, action: "APPROVED", stepOrder: 0, comment: "Enjoy" }] },
      },
    });
    await deductLeave(prisma, sara.id, al.id, s, 2);
    console.log(`Seeded approved leave request #${req.id}`);
  }

  // Two months of pay slips, as if uploaded by Finance
  const all = [ceo, hr, fin, adm, mgr, ali, sara];
  const [cy, cm] = today.split("-").map(Number) as [number, number];
  for (const back of [2, 1]) {
    const date = new Date(Date.UTC(cy, cm - 1 - back, 1));
    const py = date.getUTCFullYear();
    const pm = date.getUTCMonth() + 1;
    const upload = await prisma.payrollUpload.create({ data: { year: py, month: pm, fileName: "seed-payroll.xlsx", uploadedById: fin.id, rowsImported: all.length, unmatched: [] } });
    for (const e of all) {
      if (e.joiningDate > date) continue;
      const gross = Number(e.grossSalary);
      const basic = Math.round(gross * 0.6), houseRent = Math.round(gross * 0.25), medical = Math.round(gross * 0.05);
      const conveyance = Math.round(gross * 0.04), fuel = Math.round(gross * 0.04), mobile = gross - basic - houseRent - medical - conveyance - fuel;
      const incomeTax = Math.round(gross * 0.06), eobi = 370, providentFund = Math.round(basic * 0.0833);
      const totalDeductions = incomeTax + eobi + providentFund;
      await prisma.payslip.create({
        data: { employeeId: e.id, uploadId: upload.id, year: py, month: pm, basic, houseRent, medical, conveyance, fuel, mobile, gross, incomeTax, eobi, providentFund, totalDeductions, netPay: gross - totalDeductions },
      });
    }
  }

  // Sample policy PDFs
  const docsDir = path.join(uploadRoot, "documents");
  fs.mkdirSync(docsDir, { recursive: true });
  for (const [file, title, category, body] of [
    ["seed-leave-policy.pdf", "Leave Policy (draft)", "POLICY", "Sample leave policy. Replace with the approved policy from HR Portal — Final Rules v1."],
    ["seed-attendance-policy.pdf", "Attendance Policy (draft)", "POLICY", "Arrival after 9:25 AM is Late. 6+ hours Present; 4 to under 6 hours Half Day; under 4 hours Absent. Three late arrivals in a month raise a warning to HR."],
    ["seed-expense-form.pdf", "Expense Claim Form", "HR_FORM", "Sample HR form."],
  ] as const) {
    const full = path.join(docsDir, file);
    await new Promise<void>((resolve) => {
      const doc = new PDFDocument({ size: "A4", margin: 60 });
      const out = fs.createWriteStream(full);
      out.on("finish", () => resolve());
      doc.pipe(out);
      doc.fontSize(20).text(title).moveDown().fontSize(11).text(body);
      doc.end();
    });
    await prisma.document.create({
      data: { title, category, fileName: file.replace("seed-", ""), path: `documents/${file}`, mimeType: "application/pdf", size: fs.statSync(full).size, uploadedById: hr.id },
    });
  }

  console.log(`Seeded ${all.length} employees. Password for all demo accounts: ${PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
