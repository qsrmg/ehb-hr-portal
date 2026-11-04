import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { audit } from "../lib/audit.js";
import { notify } from "../lib/notify.js";
import { sheetUpload } from "../lib/upload.js";
import { readSheet, pick, pickString, parseSheetNumber } from "../lib/sheet.js";
import { MONTHS, todayYmd } from "../lib/dates.js";
import { HttpError } from "../middleware/error.js";
import { currentUser, hasRole, requireAuth, requireRole, type AuthUser } from "../middleware/auth.js";
import { payslipPdf, taxStatementPdf } from "../services/pdf.js";
import type { Payslip } from "../generated/prisma/client.js";

export const payrollRouter = Router();
payrollRouter.use(requireAuth);

const COLUMNS = {
  basic: ["basic", "basicsalary", "basicpay"],
  houseRent: ["houserent", "houserentallowance", "hra"],
  medical: ["medical", "medicalallowance"],
  conveyance: ["conveyance", "conveyanceallowance"],
  fuel: ["fuel", "fuelallowance", "petrol"],
  mobile: ["mobile", "mobileallowance"],
  gross: ["gross", "grosssalary", "grosspay", "totalearnings"],
  incomeTax: ["incometax", "tax", "wht"],
  eobi: ["eobi"],
  providentFund: ["providentfund", "pf"],
  totalDeductions: ["totaldeductions", "deductions"],
  netPay: ["netpay", "netsalary", "net"],
};

const num = (row: Record<string, unknown>, aliases: string[]) => parseSheetNumber(pick(row, aliases));

/**
 * Finance uploads the monthly payroll Excel; the portal does not calculate salary.
 * Re-uploading a month replaces that month's pay slips.
 */
payrollRouter.post("/upload", requireRole("FINANCE"), sheetUpload.single("file"), async (req, res) => {
  const user = currentUser(req);
  const year = Number(req.body?.year);
  const month = Number(req.body?.month);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) throw new HttpError(400, "Choose the payroll month");
  if (!req.file) throw new HttpError(400, "Choose the payroll file");
  const rows = await readSheet(req.file.buffer, req.file.originalname);
  if (!rows.length) throw new HttpError(400, "The file has no rows");

  const employees = await prisma.employee.findMany({ select: { id: true, code: true, email: true } });
  const byKey = new Map<string, number>();
  for (const e of employees) { byKey.set(e.code.toLowerCase(), e.id); byKey.set(e.email.toLowerCase(), e.id); }

  const unmatched: string[] = [];
  const slips: Omit<Payslip, "id" | "uploadId" | "createdAt">[] = [];
  for (const row of rows) {
    const key = pickString(row, ["employeecode", "empcode", "code", "employeeid", "email", "workemail"]);
    const employeeId = key ? byKey.get(key.toLowerCase()) : undefined;
    if (!employeeId) { unmatched.push(key ?? "(blank)"); continue; }
    const earnings = {
      basic: num(row, COLUMNS.basic) ?? 0, houseRent: num(row, COLUMNS.houseRent) ?? 0, medical: num(row, COLUMNS.medical) ?? 0,
      conveyance: num(row, COLUMNS.conveyance) ?? 0, fuel: num(row, COLUMNS.fuel) ?? 0, mobile: num(row, COLUMNS.mobile) ?? 0,
    };
    const deductions = { incomeTax: num(row, COLUMNS.incomeTax) ?? 0, eobi: num(row, COLUMNS.eobi) ?? 0, providentFund: num(row, COLUMNS.providentFund) ?? 0 };
    const gross = num(row, COLUMNS.gross) ?? Object.values(earnings).reduce((a, b) => a + b, 0);
    const totalDeductions = num(row, COLUMNS.totalDeductions) ?? Object.values(deductions).reduce((a, b) => a + b, 0);
    const netPay = num(row, COLUMNS.netPay) ?? gross - totalDeductions;
    slips.push({ employeeId, year, month, ...earnings, ...deductions, gross, totalDeductions, netPay } as never);
  }
  if (!slips.length) throw new HttpError(400, `No rows matched an employee code or email. Unmatched: ${unmatched.slice(0, 10).join(", ")}`);

  const upload = await prisma.$transaction(async (tx) => {
    const created = await tx.payrollUpload.create({
      data: { year, month, fileName: req.file!.originalname, uploadedById: user.id, rowsImported: slips.length, unmatched },
    });
    for (const s of slips) {
      await tx.payslip.upsert({
        where: { employeeId_year_month: { employeeId: s.employeeId, year, month } },
        create: { ...s, uploadId: created.id },
        update: { ...s, uploadId: created.id },
      });
    }
    return created;
  });
  await notify(slips.map((s) => s.employeeId), `Pay slip for ${MONTHS[month - 1]} ${year}`, `Your pay slip for ${MONTHS[month - 1]} ${year} is ready to download.`, "/payslips");
  await audit(user.id, "IMPORT", "Payroll", upload.id, { year, month, rows: slips.length, unmatched });
  res.json({ uploadId: upload.id, payslipsCreated: slips.length, unmatched });
});

payrollRouter.get("/uploads", requireRole("FINANCE", "HR"), async (_req, res) => {
  res.json(await prisma.payrollUpload.findMany({ orderBy: [{ year: "desc" }, { month: "desc" }, { createdAt: "desc" }], take: 50 }));
});

const canSeeSalary = (user: AuthUser, employeeId: number) => user.id === employeeId || hasRole(user, "HR", "FINANCE", "MANAGEMENT");

const toNumbers = (p: Payslip) => ({
  id: p.id, employeeId: p.employeeId, year: p.year, month: p.month, monthName: MONTHS[p.month - 1],
  basic: Number(p.basic), houseRent: Number(p.houseRent), medical: Number(p.medical), conveyance: Number(p.conveyance),
  fuel: Number(p.fuel), mobile: Number(p.mobile), gross: Number(p.gross), incomeTax: Number(p.incomeTax), eobi: Number(p.eobi),
  providentFund: Number(p.providentFund), totalDeductions: Number(p.totalDeductions), netPay: Number(p.netPay),
});

// Own pay slips, or another employee's for HR / Finance / Management (?employeeId=)
payrollRouter.get("/payslips", async (req, res) => {
  const user = currentUser(req);
  const employeeId = req.query.employeeId ? Number(req.query.employeeId) : user.id;
  if (!canSeeSalary(user, employeeId)) throw new HttpError(403, "Salary data is private");
  if (employeeId !== user.id) await audit(user.id, "VIEW_SENSITIVE", "Payslip", employeeId);
  const rows = await prisma.payslip.findMany({ where: { employeeId }, orderBy: [{ year: "desc" }, { month: "desc" }] });
  res.json(rows.map(toNumbers));
});

const employeeForPdf = (id: number) =>
  prisma.employee.findUniqueOrThrow({ where: { id }, include: { department: { select: { name: true } } } });

payrollRouter.get("/payslips/:id/pdf", async (req, res) => {
  const user = currentUser(req);
  const slip = await prisma.payslip.findUnique({ where: { id: Number(req.params.id) } });
  if (!slip) throw new HttpError(404, "Pay slip not found");
  if (!canSeeSalary(user, slip.employeeId)) throw new HttpError(403, "Salary data is private");
  if (slip.employeeId !== user.id) await audit(user.id, "VIEW_SENSITIVE", "Payslip", slip.id);
  const emp = await employeeForPdf(slip.employeeId);
  const showBank = user.id === emp.id || hasRole(user, "HR", "FINANCE");
  const pdf = await payslipPdf({ ...emp, ...(showBank ? {} : { bankAccount: null }) }, slip);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="payslip-${emp.code}-${slip.year}-${String(slip.month).padStart(2, "0")}.pdf"`);
  res.send(pdf);
});

/** Tax year runs July to June; "2026" means July 2026 to June 2027. */
function taxYear(q: unknown) {
  if (typeof q === "string" && /^\d{4}$/.test(q)) return Number(q);
  const [y, m] = todayYmd().split("-").map(Number) as [number, number];
  return m >= 7 ? y : y - 1;
}

async function taxStatement(employeeId: number, fy: number) {
  const rows = await prisma.payslip.findMany({
    where: { employeeId, OR: [{ year: fy, month: { gte: 7 } }, { year: fy + 1, month: { lte: 6 } }] },
    orderBy: [{ year: "asc" }, { month: "asc" }],
  });
  const totals = rows.reduce(
    (t, r) => ({ gross: t.gross + Number(r.gross), incomeTax: t.incomeTax + Number(r.incomeTax), netPay: t.netPay + Number(r.netPay) }),
    { gross: 0, incomeTax: 0, netPay: 0 },
  );
  return { fy, label: `${fy}-${String((fy + 1) % 100).padStart(2, "0")}`, rows, totals };
}

const taxQuery = z.object({ employeeId: z.coerce.number().int().optional() });

payrollRouter.get("/tax-statement", async (req, res) => {
  const user = currentUser(req);
  const employeeId = taxQuery.parse(req.query).employeeId ?? user.id;
  if (!canSeeSalary(user, employeeId)) throw new HttpError(403, "Salary data is private");
  const t = await taxStatement(employeeId, taxYear(req.query.fy));
  res.json({ fy: t.fy, label: t.label, totals: t.totals, months: t.rows.map(toNumbers) });
});

payrollRouter.get("/tax-statement/pdf", async (req, res) => {
  const user = currentUser(req);
  const employeeId = taxQuery.parse(req.query).employeeId ?? user.id;
  if (!canSeeSalary(user, employeeId)) throw new HttpError(403, "Salary data is private");
  const t = await taxStatement(employeeId, taxYear(req.query.fy));
  const emp = await employeeForPdf(employeeId);
  const showCnic = user.id === emp.id || hasRole(user, "HR");
  const pdf = await taxStatementPdf({ ...emp, ...(showCnic ? {} : { cnic: null }) }, t.label, t.rows, t.totals);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="tax-statement-${emp.code}-${t.label}.pdf"`);
  res.send(pdf);
});
