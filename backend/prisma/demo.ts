// Demo data for showing the portal to HR (see DEMO.md). All people and figures are fictional.
//
//   npm run db:demo -- --yes     WIPES the database in backend/.env (DATABASE_URL) and the uploads folder,
//                                re-applies the migrations, then loads the demo data.
//   --skip-reset                 only loads the data (used by the e2e runner on its fresh hr_ms_e2e database).
//
// Base data (people, attendance, pay slips, policies) is written directly; every workflow (leave, expense claim,
// trip, assets, resignation, performance cycle, internal job) goes through the portal's own API, so approval
// chains, balances and notifications are exactly what the app produces. Emails are not sent.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ quiet: true });
const args = new Set(process.argv.slice(2));
const PASSWORD = "Password@123";
const DOMAIN = "ehb.demo";

// ---------------------------------------------------------------------------
// Reset (only with --yes)
// ---------------------------------------------------------------------------

async function reset() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  const db = url.pathname.slice(1);
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to reset a production database");
  if (!args.has("--yes")) {
    console.error(`This wipes every record in the database "${db}" and the uploads folder, then loads demo data.\nRun it again with --yes to continue:  npm run db:demo -- --yes`);
    process.exit(1);
  }
  console.log(`Resetting "${db}"…`);
  url.search = "";
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  await client.query("DROP SCHEMA IF EXISTS public CASCADE");
  await client.query("CREATE SCHEMA public");
  await client.query("DROP SCHEMA IF EXISTS pgboss CASCADE"); // the job queue recreates its tables on start
  await client.end();
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: process.env });
  const uploads = path.resolve(process.env.UPLOAD_DIR ?? "uploads");
  fs.rmSync(uploads, { recursive: true, force: true });
  fs.mkdirSync(uploads, { recursive: true });
  console.log("Database and uploads cleared; migrations applied.");
}

// ---------------------------------------------------------------------------
// Demo data
// ---------------------------------------------------------------------------

async function seed() {
  // Quiet: no request log for the API calls below.
  process.env.NODE_ENV = "test";
  // Loaded after the reset so nothing connects to the old schema.
  const nodemailer = (await import("nodemailer")).default;
  const bcrypt = (await import("bcryptjs")).default;
  const PDFDocument = (await import("pdfkit")).default;
  const { prisma } = await import("../src/lib/prisma.js");
  const { setMailTransport } = await import("../src/lib/mailer.js");
  const { app } = await import("../src/app.js");
  const { addDays, eachDay, isWeekend, toDate, todayYmd, ymd } = await import("../src/lib/dates.js");
  const { checkLateWarnings, computeStatus, getAttendanceRules } = await import("../src/services/attendance.js");
  const { ensureBalance, deductLeave } = await import("../src/services/leave.js");
  const { uploadRoot } = await import("../src/lib/upload.js");

  if (await prisma.employee.count()) throw new Error("The database already has employees; run with --yes to reset it first");
  setMailTransport(nodemailer.createTransport({ jsonTransport: true })); // no emails during the seed

  const today = todayYmd();
  const year = Number(today.slice(0, 4));
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  // --- Holidays (fixed-date ones, this year and next) ---
  const fixed: [string, string][] = [
    ["02-05", "Kashmir Solidarity Day"], ["03-23", "Pakistan Day"], ["05-01", "Labour Day"], ["05-28", "Youm-e-Takbeer"],
    ["08-14", "Independence Day"], ["11-09", "Iqbal Day"], ["12-25", "Quaid-e-Azam Day"],
  ];
  await prisma.holiday.createMany({ data: [year, year + 1].flatMap((y) => fixed.map(([md, name]) => ({ date: toDate(`${y}-${md}`), name }))) });
  const holidays = new Set((await prisma.holiday.findMany()).map((h) => ymd(h.date)));
  const isWorkday = (d: Date) => !isWeekend(d) && !holidays.has(ymd(d));
  /** The n-th working day after today (n = 1: next working day). */
  const workdayFromToday = (n: number) => {
    let d = toDate(today);
    for (let c = 0; c < n; ) {
      d = addDays(d, 1);
      if (isWorkday(d)) c++;
    }
    return ymd(d);
  };

  // --- Departments and people ---
  const deptNames = ["Management", "Human Resources", "Finance", "Administration", "Engineering", "Sales & Marketing", "Customer Support"];
  const dept: Record<string, number> = {};
  for (const name of deptNames) dept[name] = (await prisma.department.create({ data: { name } })).id;

  type Person = {
    key: string; name: string; dept: string; designation: string; grade: string; joined: string; roleSince?: string; manager?: string;
    roles?: ("MANAGEMENT" | "HR" | "FINANCE" | "ADMIN" | "LINE_MANAGER" | "HOD")[]; gender: "MALE" | "FEMALE"; gross: number; probationUntil?: string;
  };
  const people: Person[] = [
    { key: "imran", name: "Imran Qureshi", dept: "Management", designation: "Chief Executive Officer", grade: "G10", joined: "2021-01-04", roles: ["MANAGEMENT", "HOD"], gender: "MALE", gross: 950000 },
    { key: "ayesha", name: "Ayesha Siddiqui", dept: "Human Resources", designation: "HR Manager", grade: "G8", joined: "2021-03-01", roleSince: "2023-07-01", manager: "imran", roles: ["HR", "HOD"], gender: "FEMALE", gross: 380000 },
    { key: "nida", name: "Nida Farooq", dept: "Human Resources", designation: "HR Executive", grade: "G5", joined: "2023-09-11", manager: "ayesha", roles: ["HR"], gender: "FEMALE", gross: 165000 },
    { key: "bilal", name: "Bilal Ahmed", dept: "Finance", designation: "Finance Manager", grade: "G8", joined: "2021-05-17", manager: "imran", roles: ["FINANCE", "HOD"], gender: "MALE", gross: 370000 },
    { key: "sana", name: "Sana Mirza", dept: "Finance", designation: "Accountant", grade: "G5", joined: "2022-10-03", manager: "bilal", roles: ["FINANCE"], gender: "FEMALE", gross: 170000 },
    { key: "usman", name: "Usman Tariq", dept: "Administration", designation: "Admin Officer", grade: "G5", joined: "2022-02-14", manager: "imran", roles: ["ADMIN", "HOD"], gender: "MALE", gross: 155000 },
    { key: "hamza", name: "Hamza Malik", dept: "Engineering", designation: "Engineering Manager", grade: "G8", joined: "2021-08-02", roleSince: "2024-01-01", manager: "imran", roles: ["LINE_MANAGER", "HOD"], gender: "MALE", gross: 480000 },
    { key: "ali", name: "Ali Raza", dept: "Engineering", designation: "Senior Software Engineer", grade: "G6", joined: "2022-06-06", roleSince: "2025-01-01", manager: "hamza", gender: "MALE", gross: 290000 },
    { key: "zainab", name: "Zainab Hussain", dept: "Engineering", designation: "Frontend Developer", grade: "G5", joined: "2023-04-10", manager: "hamza", gender: "FEMALE", gross: 210000 },
    { key: "sara", name: "Sara Javed", dept: "Engineering", designation: "QA Engineer", grade: "G4", joined: ymd(addDays(toDate(today), -120)), manager: "hamza", gender: "FEMALE", gross: 150000, probationUntil: ymd(addDays(toDate(today), 60)) },
    { key: "fahad", name: "Fahad Khan", dept: "Sales & Marketing", designation: "Sales & Marketing Manager", grade: "G7", joined: "2022-01-17", manager: "imran", roles: ["LINE_MANAGER", "HOD"], gender: "MALE", gross: 340000 },
    { key: "maryam", name: "Maryam Ali", dept: "Sales & Marketing", designation: "Business Development Executive", grade: "G4", joined: "2024-02-05", manager: "fahad", gender: "FEMALE", gross: 140000 },
    { key: "omar", name: "Omar Sheikh", dept: "Sales & Marketing", designation: "Marketing Specialist", grade: "G5", joined: "2023-11-20", manager: "fahad", gender: "MALE", gross: 175000 },
    { key: "hina", name: "Hina Baig", dept: "Customer Support", designation: "Support Team Lead", grade: "G6", joined: "2022-08-08", roleSince: "2024-07-01", manager: "imran", roles: ["LINE_MANAGER", "HOD"], gender: "FEMALE", gross: 230000 },
    { key: "kashif", name: "Kashif Raza", dept: "Customer Support", designation: "Support Agent", grade: "G3", joined: "2024-03-04", manager: "hina", gender: "MALE", gross: 95000 },
  ];
  const id: Record<string, number> = {};
  const email = (key: string) => `${key}@${DOMAIN}`;
  let seq = 0;
  for (const p of people) {
    seq++;
    const e = await prisma.employee.create({
      data: {
        code: `EHB-${p.joined.slice(0, 4)}-${String(seq).padStart(3, "0")}`, email: email(p.key), fullName: p.name, passwordHash, mustChangePassword: false,
        roles: ["EMPLOYEE", ...(p.roles ?? [])], departmentId: dept[p.dept], designation: p.designation, grade: p.grade,
        joiningDate: toDate(p.joined), roleSince: p.roleSince ? toDate(p.roleSince) : null, probationEndDate: p.probationUntil ? toDate(p.probationUntil) : null,
        managerId: p.manager ? id[p.manager] : null, gender: p.gender, machineId: String(1000 + seq),
        grossSalary: p.gross, basicSalary: Math.round(p.gross * 0.6),
        phone: `0300-${String(4100000 + seq * 7341).slice(0, 7)}`, personalEmail: `${p.key}.${p.name.split(" ")[1]!.toLowerCase()}@example.com`,
        address: "Lahore, Pakistan", cnic: `35202-${String(4100000 + seq * 9137).slice(0, 7)}-${seq % 10}`,
        bankName: seq % 2 ? "Meezan Bank" : "HBL", bankAccount: `0${String(10000000 + seq * 48271).slice(0, 8)}`,
        emergencyContactName: "Family contact", emergencyContactPhone: "0321-5550000",
      },
    });
    id[p.key] = e.id;
  }
  const heads: [string, string][] = [["Management", "imran"], ["Human Resources", "ayesha"], ["Finance", "bilal"], ["Administration", "usman"], ["Engineering", "hamza"], ["Sales & Marketing", "fahad"], ["Customer Support", "hina"]];
  const headcount: Record<string, number> = { Management: 2, "Human Resources": 3, Finance: 3, Administration: 2, Engineering: 6, "Sales & Marketing": 5, "Customer Support": 4 };
  for (const [name, head] of heads) await prisma.department.update({ where: { id: dept[name] }, data: { hodId: id[head], approvedHeadcount: headcount[name] } });

  // --- Leave types (placeholders until the Final Rules are signed off) ---
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
  const types = await prisma.leaveType.findMany();
  const leaveType = (code: string) => types.find((t) => t.code === code)!;
  for (const p of people) for (const t of types) if (!t.gender || t.gender === p.gender) await ensureBalance(prisma, id[p.key]!, t, year);

  // --- A month of attendance (from the 1st of last month to yesterday), as if imported ---
  const thisMonth = toDate(`${today.slice(0, 8)}01`);
  const from = new Date(Date.UTC(thisMonth.getUTCFullYear(), thisMonth.getUTCMonth() - 1, 1));
  const yesterday = addDays(toDate(today), -1);
  const workdays = eachDay(from, yesterday).filter(isWorkday);
  const n = workdays.length;
  // Omar was on approved Annual Leave on two days last week.
  const omarLeave = [workdays[n - 6]!, workdays[n - 5]!];
  const rules = await getAttendanceRules();
  const t = (h: number, m: number) => h * 60 + m;
  const batch = await prisma.attendanceImport.create({ data: { fileName: "biometric-export.csv", importedById: id.ayesha!, rowsRead: 0, rowsImported: 0, unmatchedIds: [], fromDate: from, toDate: yesterday } });
  const rows: { employeeId: number; date: Date; checkIn: number | null; checkOut: number | null }[] = [];
  people.forEach((p, pi) => {
    const joined = toDate(p.joined);
    workdays.forEach((d, i) => {
      if (d < joined) return;
      const jitter = (pi * 7 + i * 13) % 23; // 0-22 minutes, different per person and day
      let inT: number | null = t(8, 45) + jitter;
      let outT: number | null = t(17, 50) + ((pi * 5 + i * 3) % 30);
      if (p.key === "omar" && omarLeave.includes(d)) return;
      if (p.key === "kashif" && [i % 6 === 2, i === n - 3].some(Boolean)) inT = t(9, 32) + (i % 15); // several late arrivals
      if (p.key === "ali" && i === n - 8) outT = t(13, 45); // a half day
      if (p.key === "sara" && i === n - 10) return; // absent once
      if (p.key === "maryam" && i === n - 1) outT = null; // missed punch yesterday: raise an Attendance Update
      if (p.key === "zainab" && i === n - 4) inT = t(9, 41);
      rows.push({ employeeId: id[p.key]!, date: d, checkIn: inT, checkOut: outT });
    });
  });
  await prisma.attendanceRecord.createMany({ data: rows.map((r) => ({ ...r, status: computeStatus(r.checkIn, r.checkOut, rules), importId: batch.id })) });
  await prisma.attendanceImport.update({ where: { id: batch.id }, data: { rowsRead: rows.length, rowsImported: rows.length } });
  await checkLateWarnings(Object.values(id), from, yesterday);

  // Omar's past leave (submitted and approved before it started)
  const al = leaveType("AL");
  await prisma.request.create({
    data: {
      type: "LEAVE", employeeId: id.omar!, status: "APPROVED", title: `Annual Leave · 2 days (${ymd(omarLeave[0]!)} to ${ymd(omarLeave[1]!)})`, data: { leaveType: al.name },
      leaveRequest: { create: { leaveTypeId: al.id, startDate: omarLeave[0]!, endDate: omarLeave[1]!, days: 2, reason: "Sister's wedding" } },
      steps: { create: { order: 0, label: "Line Manager", approverId: id.fahad, status: "APPROVED", actedById: id.fahad, actedAt: addDays(omarLeave[0]!, -7), pendingSince: addDays(omarLeave[0]!, -8) } },
      actions: { create: [{ actorId: id.omar!, action: "SUBMITTED" }, { actorId: id.fahad!, action: "APPROVED", stepOrder: 0, comment: "Approved, congratulations to the family" }] },
    },
  });
  await deductLeave(prisma, id.omar!, al.id, omarLeave[0]!, 2);

  // --- Pay slips for the last two months, as if uploaded by Finance ---
  const [cy, cm] = today.split("-").map(Number) as [number, number];
  for (const back of [2, 1]) {
    const date = new Date(Date.UTC(cy, cm - 1 - back, 1));
    const py = date.getUTCFullYear(), pm = date.getUTCMonth() + 1;
    const upload = await prisma.payrollUpload.create({ data: { year: py, month: pm, fileName: `payroll-${py}-${String(pm).padStart(2, "0")}.xlsx`, uploadedById: id.bilal!, rowsImported: 0, unmatched: [] } });
    let count = 0;
    for (const p of people) {
      if (toDate(p.joined) > date) continue;
      const gross = p.gross;
      const basic = Math.round(gross * 0.6), houseRent = Math.round(gross * 0.25), medical = Math.round(gross * 0.05);
      const conveyance = Math.round(gross * 0.04), fuel = Math.round(gross * 0.04), mobile = gross - basic - houseRent - medical - conveyance - fuel;
      const incomeTax = Math.round(gross * (gross > 300000 ? 0.12 : gross > 150000 ? 0.06 : 0.02)), eobi = 370, providentFund = Math.round(basic * 0.0833);
      const totalDeductions = incomeTax + eobi + providentFund;
      await prisma.payslip.create({ data: { employeeId: id[p.key]!, uploadId: upload.id, year: py, month: pm, basic, houseRent, medical, conveyance, fuel, mobile, gross, incomeTax, eobi, providentFund, totalDeductions, netPay: gross - totalDeductions } });
      count++;
    }
    await prisma.payrollUpload.update({ where: { id: upload.id }, data: { rowsImported: count } });
  }

  // --- Policies and HR forms (sample PDFs) ---
  const docsDir = path.join(uploadRoot, "documents");
  fs.mkdirSync(docsDir, { recursive: true });
  const pdf = (file: string, title: string, body: string) => new Promise<number>((resolve) => {
    const doc = new PDFDocument({ size: "A4", margin: 60 });
    const out = fs.createWriteStream(file);
    out.on("finish", () => resolve(fs.statSync(file).size));
    doc.pipe(out);
    doc.fontSize(9).fillColor("#5b6573").text("EHB Technologies · Human Resources · SAMPLE for the demo").moveDown();
    doc.fillColor("#000").fontSize(20).text(title).moveDown().fontSize(11).text(body, { lineGap: 4 });
    doc.end();
  });
  for (const [file, title, category, body] of [
    ["leave-policy.pdf", "Leave Policy", "POLICY", "Annual, casual and sick leave, notice periods and carry forward. Sample text for the demo; HR uploads the approved policy before go-live."],
    ["attendance-policy.pdf", "Attendance Policy", "POLICY", "Arrival after 9:25 AM is Late. 6 hours or more is Present; 4 to under 6 hours is Half Day; under 4 hours is Absent. Three late arrivals in a month raise a warning to HR. A missed punch is fixed with an Attendance Update within 7 days."],
    ["travel-policy.pdf", "Travel and Expense Policy", "POLICY", "Business travel within Pakistan, advances, settlements and local expense claims. Sample text for the demo."],
    ["expense-claim-form.pdf", "Expense Claim Form (paper backup)", "HR_FORM", "Use the portal for expense claims; this form is a paper backup."],
  ] as const) {
    const size = await pdf(path.join(docsDir, file), title, body);
    await prisma.document.create({ data: { title, category, fileName: file, path: `documents/${file}`, mimeType: "application/pdf", size, uploadedById: id.ayesha! } });
  }

  // ---------------------------------------------------------------------------
  // Workflows through the portal's own API
  // ---------------------------------------------------------------------------
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const tokens: Record<string, string> = {};
  const as = async (key: string) => {
    tokens[key] ??= ((await (await fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email(key), password: PASSWORD }) })).json()) as { token: string }).token;
    return async <T = { id: number }>(method: string, p: string, body?: Record<string, unknown> | FormData): Promise<T> => {
      const res = await fetch(`${base}${p}`, {
        method,
        headers: { Authorization: `Bearer ${tokens[key]}`, ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}) },
        body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(`${key}: ${method} ${p} → ${(data as { message?: string }).message}`);
      return data as T;
    };
  };
  const approve = async (key: string, requestId: number, body: Record<string, unknown> = {}) => (await as(key))("POST", `/requests/${requestId}/approve`, body);

  try {
    // Leave: Ali's casual leave waits for Hamza; Maryam's annual leave waits for Fahad; Hina's is approved.
    await (await as("ali"))("POST", "/requests/leave", { leaveTypeId: leaveType("CL").id, startDate: workdayFromToday(5), endDate: workdayFromToday(5), reason: "Doctor's appointment for my father" });
    await (await as("maryam"))("POST", "/requests/leave", { leaveTypeId: al.id, startDate: workdayFromToday(15), endDate: workdayFromToday(17), reason: "Family trip to Murree" });
    const hinaLeave = await (await as("hina"))("POST", "/requests/leave", { leaveTypeId: leaveType("CL").id, startDate: workdayFromToday(3), endDate: workdayFromToday(3), reason: "Personal errand" });
    await approve("imran", hinaLeave.id, { comment: "Approved" });

    // Expense claim: Ali, two local expenses (one with a receipt), waiting for Hamza.
    const cat = async (name: string) => (await prisma.expenseCategory.findFirstOrThrow({ where: { name } })).id;
    const receipt = await new Promise<Buffer>((resolve) => {
      const doc = new PDFDocument({ size: "A6", margin: 30 });
      const parts: Buffer[] = [];
      doc.on("data", (c: Buffer) => parts.push(c));
      doc.on("end", () => resolve(Buffer.concat(parts)));
      doc.fontSize(12).text("Café Aylanto, Gulberg").fontSize(9).text("Lunch with client (sample receipt)").moveDown().text("Total: PKR 4,850");
      doc.end();
    });
    const claim = new FormData();
    claim.append("purpose", "Client visit for the payroll integration project");
    claim.append("lines", JSON.stringify([
      { date: ymd(workdays[n - 3]!), categoryId: await cat("Client meeting"), description: "Lunch with the client's IT team", amount: 4850 },
      { date: ymd(workdays[n - 3]!), categoryId: await cat("Local travel"), description: "Careem to the client's office and back", amount: 460, noReceiptExplanation: "Ride receipt is in the Careem app only" },
    ]));
    claim.append("receipt_0", new Blob([new Uint8Array(receipt)], { type: "application/pdf" }), "aylanto-receipt.pdf");
    await (await as("ali"))("POST", "/requests/expense", claim);

    // Trip: Omar to Karachi with an advance; approved by Fahad and Finance, waiting for Admin to book.
    const trip = await (await as("omar"))("POST", "/requests/travel", {
      purpose: "Meet the distributor and run the product demo at their Karachi office", origin: "Lahore", destination: "Karachi",
      departDate: workdayFromToday(8), returnDate: workdayFromToday(9), mode: "AIR", needsHotel: true,
      estimateTransport: 38000, estimateHotel: 24000, estimateMeals: 6000, estimateOther: 2000, advanceRequested: 20000,
    });
    await approve("fahad", trip.id, { comment: "Important account, go ahead" });
    await approve("bilal", trip.id);

    // Assets: laptops, accounts and accessories issued by Usman (Admin); most confirmed by the holder.
    const admin = await as("usman");
    const acat = async (name: string) => (await prisma.assetCategory.findFirstOrThrow({ where: { name } })).id;
    const asset = (categoryId: number, name: string, serialNumber: string, cost: number | null, purchaseDate: string) =>
      admin<{ id: number; tag: string }>("POST", "/assets", { categoryId, name, serialNumber, cost, purchaseDate, warrantyUntil: cost ? `${Number(purchaseDate.slice(0, 4)) + 3}${purchaseDate.slice(4)}` : undefined });
    const issue = (assetId: number, employee: string) => admin("POST", `/assets/${assetId}/issue`, { assigneeType: "EMPLOYEE", employeeId: id[employee] });
    const laptop = await acat("Laptop");
    const handed: [string, string, string, number, string][] = [
      ["hamza", "Dell Latitude 7440", "DL7440-8KQ2", 365000, "2024-01-10"],
      ["ali", "Dell Latitude 5440", "DL5440-3HV7", 285000, "2024-02-20"],
      ["zainab", "Dell Latitude 5440", "DL5440-9TP1", 285000, "2024-02-20"],
      ["sara", "HP EliteBook 840 G10", "HP840-5XR3", 275000, ymd(addDays(toDate(today), -125))],
      ["maryam", "Lenovo ThinkPad E14", "TPE14-2MN8", 210000, "2024-02-01"],
      ["kashif", "HP ProBook 450", "HP450-7QW2", 180000, "2024-03-01"],
    ];
    for (const [who, name, serial, cost, bought] of handed) {
      const a = await asset(laptop, name, serial, cost, bought);
      await issue(a.id, who);
    }
    await asset(laptop, "Dell Latitude 5440", "DL5440-6YB4", 285000, "2025-06-15"); // spare, in stock
    const access = await acat("Access & accounts");
    for (const who of ["zainab", "ali"]) {
      const a = await asset(access, "Google Workspace email", `${who}@ehb.com.pk`, null, "2024-01-01");
      await issue(a.id, who);
    }
    const mouse = await asset(await acat("Accessories"), "Logitech MX Master 3S mouse", "LGMX3S-0451", 28000, "2025-03-01");
    await issue(mouse.id, "omar");
    // Everyone but Sara has confirmed receipt (Sara's laptop shows "awaiting your confirmation").
    for (const a of await prisma.assetAssignment.findMany({ where: { confirmedAt: null, employee: { email: { not: email("sara") } } }, include: { employee: { select: { email: true } } } })) {
      await (await as(a.employee!.email.split("@")[0]!))("POST", `/assets/assignments/${a.id}/confirm`);
    }

    // Items were handed over when they were bought (or when the person joined), not today.
    for (const a of await prisma.assetAssignment.findMany({ include: { asset: { select: { purchaseDate: true } }, employee: { select: { joiningDate: true } } } })) {
      const bought = a.asset.purchaseDate ?? toDate(today);
      const joined = a.employee?.joiningDate ?? bought;
      const handedOver = addDays(bought > joined ? bought : joined, 2);
      await prisma.assetAssignment.update({ where: { id: a.id }, data: { issuedAt: handedOver, ...(a.confirmedAt ? { confirmedAt: addDays(handedOver, 1) } : {}) } });
    }

    // Resignation in progress: Zainab; Hamza recommended early release, HR approved; Hamza cleared his part.
    const resignation = await (await as("zainab"))("POST", "/requests/resignation", { reason: "I am moving to Islamabad with my family.", proposedLastDay: ymd(addDays(toDate(today), 25)) });
    await approve("hamza", resignation.id, { earlyRelease: true, comment: "Agreed; handover plan is in place" });
    await approve("ayesha", resignation.id, { comment: "Approved" });
    const exitCase = await prisma.exitCase.findFirstOrThrow({ where: { requestId: resignation.id } });
    await (await as("hamza"))("POST", `/exits/${exitCase.id}/clearances/line_manager/clear`, { comment: "Handover to Ali completed" });

    // Performance: department templates, a cycle starting next month at goal setting; Ali's goals already sent.
    const hr = await as("ayesha");
    const templates: Record<string, { perspective: string; title: string; measure: string; target: string; weight: number }[]> = {
      Engineering: [
        { perspective: "CUSTOMER", title: "Deliver sprint commitments", measure: "Sprints delivered on schedule", target: "90%", weight: 35 },
        { perspective: "INTERNAL_PROCESS", title: "Release quality", measure: "Production defects per release", target: "Fewer than 5", weight: 30 },
        { perspective: "LEARNING_GROWTH", title: "Learning and certification", measure: "Courses or certifications completed", target: "2", weight: 20 },
        { perspective: "FINANCIAL", title: "Cloud cost control", measure: "Monthly cloud cost against budget", target: "Within budget", weight: 15 },
      ],
      "Sales & Marketing": [
        { perspective: "FINANCIAL", title: "New revenue", measure: "Signed contract value", target: "PKR 12 million", weight: 40 },
        { perspective: "CUSTOMER", title: "New accounts", measure: "New customers signed", target: "8", weight: 30 },
        { perspective: "INTERNAL_PROCESS", title: "CRM hygiene", measure: "Opportunities updated weekly", target: "95%", weight: 15 },
        { perspective: "LEARNING_GROWTH", title: "Product knowledge", measure: "Product certifications passed", target: "2", weight: 15 },
      ],
      "Customer Support": [
        { perspective: "CUSTOMER", title: "Customer satisfaction", measure: "CSAT score", target: "4.5 of 5", weight: 40 },
        { perspective: "INTERNAL_PROCESS", title: "First response time", measure: "Median first response", target: "Under 2 hours", weight: 35 },
        { perspective: "LEARNING_GROWTH", title: "Knowledge base", measure: "Articles written or updated", target: "10", weight: 25 },
      ],
    };
    for (const [name, kpis] of Object.entries(templates)) await hr("PUT", `/performance/templates/${dept[name]}`, { kpis });
    const start = new Date(Date.UTC(cy, cm, 1)); // the 1st of next month
    const end = addDays(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 6, 1)), -1);
    const cycleName = `${start.toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" })} to ${end.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}`;
    await hr("POST", "/performance/cycles", {
      name: cycleName, startDate: ymd(start), endDate: ymd(end), goalsDueDate: ymd(addDays(start, 14)),
      reviewOpensDate: ymd(addDays(end, -14)), reviewDueDate: ymd(addDays(end, 14)),
    });
    const aliCard = await prisma.scorecard.findFirstOrThrow({ where: { employeeId: id.ali } });
    await (await as("hamza"))("POST", `/performance/scorecards/${aliCard.id}/send-goals`);

    // Internal job: Fahad's new position, approved (Finance confirmed the budget) and posted; Kashif has applied.
    const reqn = await (await as("fahad"))<{ id: number; requestId: number }>("POST", "/hiring/requisitions", {
      departmentId: dept["Sales & Marketing"], title: "Digital Marketing Executive", grade: "G4", headcount: 1, employmentType: "PERMANENT",
      reportsToId: id.fahad, targetStartDate: ymd(addDays(toDate(today), 45)), reason: "NEW",
      justification: "Paid social and search campaigns for the 2027 product launch need a dedicated person.",
      skills: "Google Ads, Meta Ads, analytics, copywriting", suggestedSalaryMin: 120000, suggestedSalaryMax: 150000, submit: true,
    });
    await approve("bilal", reqn.requestId, { salaryMin: 130000, salaryMax: 160000, budgetNote: "Within the 2027 marketing budget" });
    await approve("imran", reqn.requestId);
    await approve("ayesha", reqn.requestId);
    await hr("POST", `/hiring/requisitions/${reqn.id}/post`, {
      scope: "BOTH", closingDate: ymd(addDays(toDate(today), 21)),
      description: "Plan and run paid social and search campaigns, report on results and work with Sales on lead quality.",
      requirements: "2 years of digital marketing; hands-on Google Ads and Meta Ads; good written English.",
    });
    await (await as("kashif"))("POST", `/hiring/jobs/${reqn.id}/apply`, { note: "I have run our support team's social channels for a year and completed the Google Ads certification." });
  } finally {
    server.close();
  }

  console.log(`Demo data loaded: ${people.length} employees in ${deptNames.length} departments. Log in with <name>@${DOMAIN} / ${PASSWORD} (see DEMO.md).`);
  await prisma.$disconnect();
}

(async () => {
  if (!args.has("--skip-reset")) await reset();
  await seed();
  process.exit(0);
})().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
