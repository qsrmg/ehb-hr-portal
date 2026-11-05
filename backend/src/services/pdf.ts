import PDFDocument from "pdfkit";
import { MONTHS } from "../lib/dates.js";

const NAVY = "#1e3a5c";
const MUTED = "#5b6573";

function render(build: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    build(doc);
    doc.end();
  });
}

function header(doc: PDFKit.PDFDocument, title: string, subtitle?: string) {
  doc.rect(0, 0, doc.page.width, 90).fill(NAVY);
  doc.fillColor("#ffffff").fontSize(10).text("EHB TECHNOLOGIES (PVT.) LTD  ·  HUMAN RESOURCES", 50, 28);
  doc.fontSize(20).font("Helvetica-Bold").text(title, 50, 46);
  doc.font("Helvetica").fillColor("#000000");
  doc.y = 110;
  if (subtitle) doc.fontSize(11).fillColor(MUTED).text(subtitle).fillColor("#000000").moveDown();
}

export const money = (n: number | string | { toString(): string }) =>
  Number(n.toString()).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function keyValues(doc: PDFKit.PDFDocument, rows: [string, string][]) {
  const x = 50;
  for (const [k, v] of rows) {
    const y = doc.y;
    doc.fontSize(10).fillColor(MUTED).text(k, x, y, { width: 140 });
    doc.fillColor("#000000").text(v, x + 150, y, { width: 340 });
    doc.moveDown(0.3);
  }
  doc.moveDown();
}

function table(doc: PDFKit.PDFDocument, x: number, width: number, title: string, rows: [string, string][], total: [string, string]) {
  let y = doc.y;
  doc.rect(x, y, width, 20).fill("#eef2f6");
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(10).text(title, x + 8, y + 6);
  doc.font("Helvetica").fillColor("#000000");
  y += 26;
  for (const [k, v] of rows) {
    doc.fontSize(10).text(k, x + 8, y, { width: width / 2 });
    doc.text(v, x + width / 2, y, { width: width / 2 - 8, align: "right" });
    y += 18;
  }
  doc.moveTo(x, y).lineTo(x + width, y).strokeColor("#c9d2dc").stroke();
  y += 6;
  doc.font("Helvetica-Bold").text(total[0], x + 8, y, { width: width / 2 });
  doc.text(total[1], x + width / 2, y, { width: width / 2 - 8, align: "right" });
  doc.font("Helvetica");
  return y + 24;
}

type Employee = { fullName: string; code: string; designation: string | null; department: { name: string } | null; cnic?: string | null; bankName?: string | null; bankAccount?: string | null };

type PayslipData = {
  year: number; month: number;
  basic: unknown; houseRent: unknown; medical: unknown; conveyance: unknown; fuel: unknown; mobile: unknown; gross: unknown;
  incomeTax: unknown; eobi: unknown; providentFund: unknown; totalDeductions: unknown; netPay: unknown;
};

const m = (v: unknown) => money(v as number);

export function payslipPdf(emp: Employee, p: PayslipData) {
  return render((doc) => {
    header(doc, "Pay Slip", `${MONTHS[p.month - 1]} ${p.year}`);
    keyValues(doc, [
      ["Employee", emp.fullName],
      ["Employee code", emp.code],
      ["Designation", emp.designation ?? "-"],
      ["Department", emp.department?.name ?? "-"],
      ...(emp.bankAccount ? [["Bank account", `${emp.bankName ?? ""} ${emp.bankAccount}`.trim()] as [string, string]] : []),
    ]);
    const top = doc.y;
    const endLeft = table(doc, 50, 240, "Earnings", [
      ["Basic", m(p.basic)], ["House Rent", m(p.houseRent)], ["Medical", m(p.medical)],
      ["Conveyance", m(p.conveyance)], ["Fuel", m(p.fuel)], ["Mobile", m(p.mobile)],
    ], ["Gross pay", m(p.gross)]);
    doc.y = top;
    const endRight = table(doc, 305, 240, "Deductions", [
      ["Income Tax", m(p.incomeTax)], ["EOBI", m(p.eobi)], ["Provident Fund", m(p.providentFund)],
    ], ["Total deductions", m(p.totalDeductions)]);
    const y = Math.max(endLeft, endRight) + 10;
    doc.rect(50, y, 495, 36).fill(NAVY);
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(13).text("Net pay (PKR)", 62, y + 11);
    doc.text(m(p.netPay), 300, y + 11, { width: 233, align: "right" });
    doc.font("Helvetica").fillColor(MUTED).fontSize(8)
      .text("This is a system-generated pay slip from the EHB HR Portal and does not require a signature.", 50, y + 60);
  });
}

export function taxStatementPdf(emp: Employee, fyLabel: string, rows: PayslipData[], totals: { gross: number; incomeTax: number; netPay: number }) {
  return render((doc) => {
    header(doc, "Income Tax Statement", `Tax year ${fyLabel} (July – June)`);
    keyValues(doc, [
      ["Employee", emp.fullName],
      ["Employee code", emp.code],
      ...(emp.cnic ? [["CNIC", emp.cnic] as [string, string]] : []),
      ["Designation", emp.designation ?? "-"],
    ]);
    const cols = [50, 200, 320, 440];
    const head = ["Month", "Gross pay", "Income tax", "Net pay"];
    let y = doc.y;
    doc.rect(50, y, 495, 20).fill("#eef2f6");
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(10);
    head.forEach((h, i) => doc.text(h, cols[i]! + 6, y + 6, { width: 100, align: i ? "right" : "left" }));
    doc.font("Helvetica").fillColor("#000000");
    y += 26;
    for (const r of rows) {
      const vals = [`${MONTHS[r.month - 1]} ${r.year}`, m(r.gross), m(r.incomeTax), m(r.netPay)];
      vals.forEach((v, i) => doc.text(v, cols[i]! + 6, y, { width: 100, align: i ? "right" : "left" }));
      y += 18;
    }
    doc.moveTo(50, y).lineTo(545, y).strokeColor("#c9d2dc").stroke();
    y += 6;
    doc.font("Helvetica-Bold");
    ["Total", money(totals.gross), money(totals.incomeTax), money(totals.netPay)].forEach((v, i) =>
      doc.text(v, cols[i]! + 6, y, { width: 100, align: i ? "right" : "left" }));
    doc.font("Helvetica").fillColor(MUTED).fontSize(8)
      .text("Figures are taken from the monthly payroll uploaded by Finance. System-generated; no signature required.", 50, y + 40);
  });
}

export function letterPdf(opts: {
  letterType: string; reference: string; date: string; addressedTo: string;
  employee: Employee & { joiningDate: Date; grossSalary?: unknown };
  purpose: string; approvedBy: string;
}) {
  const { employee: e } = opts;
  const joined = e.joiningDate.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const bodies: Record<string, string> = {
    EXPERIENCE: `This is to certify that ${e.fullName} (Employee Code ${e.code}) has been working with EHB Technologies (Pvt.) Ltd. since ${joined} as ${e.designation ?? "a member of staff"} in the ${e.department?.name ?? "company"} department. During this period we found them hardworking and professional.`,
    EMPLOYMENT: `This is to confirm that ${e.fullName} (Employee Code ${e.code}) is a permanent employee of EHB Technologies (Pvt.) Ltd., working as ${e.designation ?? "a member of staff"} in the ${e.department?.name ?? "company"} department since ${joined}.`,
    SALARY: `This is to certify that ${e.fullName} (Employee Code ${e.code}) has been employed with EHB Technologies (Pvt.) Ltd. since ${joined} as ${e.designation ?? "a member of staff"}.${e.grossSalary ? ` Their current gross monthly salary is PKR ${m(e.grossSalary)}.` : ""}`,
    NOC: `EHB Technologies (Pvt.) Ltd. has no objection to ${e.fullName} (Employee Code ${e.code}), ${e.designation ?? "a member of staff"} in the ${e.department?.name ?? "company"} department, for the purpose stated below.`,
  };
  const titles: Record<string, string> = {
    EXPERIENCE: "Experience Letter",
    EMPLOYMENT: "Employment Verification Letter",
    SALARY: "Salary Certificate",
    NOC: "No Objection Certificate",
  };
  return render((doc) => {
    header(doc, titles[opts.letterType] ?? "Letter");
    doc.fontSize(10).fillColor(MUTED).text(`Ref: ${opts.reference}`).text(`Date: ${opts.date}`).moveDown();
    doc.fillColor("#000000").fontSize(11).text("To,").text(opts.addressedTo || "Whom It May Concern").moveDown(1.5);
    doc.font("Helvetica-Bold").text(`Subject: ${titles[opts.letterType] ?? "Letter"}`).font("Helvetica").moveDown();
    doc.text(bodies[opts.letterType] ?? "", { align: "justify", lineGap: 3 }).moveDown();
    if (opts.purpose) doc.text(`Purpose: ${opts.purpose}`, { lineGap: 3 }).moveDown();
    doc.text("This letter is issued on the employee's request without any liability on the part of the company.", { lineGap: 3 });
    doc.moveDown(4);
    doc.text("______________________").text(opts.approvedBy).fillColor(MUTED).text("Human Resources, EHB Technologies (Pvt.) Ltd.");
  });
}

export const EXIT_LETTERS = { EXPERIENCE: "Experience Letter", RELIEVING: "Relieving Letter" } as const;
export type ExitLetterKind = keyof typeof EXIT_LETTERS;

const longDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** Letters issued at the end of exit clearance (same layout as the Letter module's letters). */
export function exitLetterPdf(kind: ExitLetterKind, opts: {
  reference: string; date: string; issuedBy: string;
  employee: Employee & { joiningDate: Date };
  lastWorkingDay: Date; resignedOn: Date | null;
}) {
  const { employee: e } = opts;
  const role = `${e.designation ?? "a member of staff"} in the ${e.department?.name ?? "company"} department`;
  const bodies: Record<ExitLetterKind, string> = {
    EXPERIENCE: `This is to certify that ${e.fullName} (Employee Code ${e.code}) worked with EHB Technologies (Pvt.) Ltd. from ${longDate(e.joiningDate)} to ${longDate(opts.lastWorkingDay)} as ${role}. During this period we found them hardworking and professional. We wish them every success in the future.`,
    RELIEVING: `This is to confirm that ${e.fullName} (Employee Code ${e.code}), ${role}, has been relieved of their duties with EHB Technologies (Pvt.) Ltd. with effect from the close of business on ${longDate(opts.lastWorkingDay)}${opts.resignedOn ? `, following their resignation dated ${longDate(opts.resignedOn)}` : ""}. They have completed the company's exit clearance.`,
  };
  return render((doc) => {
    header(doc, EXIT_LETTERS[kind]);
    doc.fontSize(10).fillColor(MUTED).text(`Ref: ${opts.reference}`).text(`Date: ${opts.date}`).moveDown();
    doc.fillColor("#000000").fontSize(11).text("To Whom It May Concern").moveDown(1.5);
    doc.font("Helvetica-Bold").text(`Subject: ${EXIT_LETTERS[kind]}`).font("Helvetica").moveDown();
    doc.text(bodies[kind], { align: "justify", lineGap: 3 });
    doc.moveDown(4);
    doc.text("______________________").text(opts.issuedBy).fillColor(MUTED).text("Human Resources, EHB Technologies (Pvt.) Ltd.");
  });
}

/** Released performance scorecard (BSC): KPIs, ratings, weighted score and band. */
export function scorecardPdf(opts: {
  cycle: string;
  employee: { fullName: string; code: string; designation: string | null; department: string | null; manager: string | null };
  kpis: { perspective: string; title: string; target: string; weight: number; actual: string | null; selfRating: number | null; finalRating: number | null }[];
  score: number; band: string; scale: Record<number, string>; managerComment: string | null; reviewedBy: string | null; completedAt: Date | null;
  appeal: { decision: string; changed: boolean } | null;
  acknowledged: { at: Date; comment: string | null } | null;
}) {
  const date = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  return render((doc) => {
    header(doc, "Performance Scorecard", opts.cycle);
    keyValues(doc, [
      ["Employee", `${opts.employee.fullName} (${opts.employee.code})`],
      ["Designation", opts.employee.designation ?? "-"],
      ["Department", opts.employee.department ?? "-"],
      ["Line manager", opts.employee.manager ?? "-"],
      ["Overall result", `${opts.band} (${opts.score.toFixed(2)} of 5)`],
      ["Released", opts.completedAt ? date(opts.completedAt) : "-"],
    ]);
    const cols = [
      { label: "Perspective", x: 50, w: 85 }, { label: "KPI and target", x: 140, w: 200 }, { label: "Weight", x: 345, w: 45 },
      { label: "Actual", x: 395, w: 85 }, { label: "Self", x: 485, w: 25 }, { label: "Final", x: 515, w: 30 },
    ];
    let y = doc.y;
    doc.rect(50, y, 495, 20).fill("#eef2f6");
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9);
    for (const c of cols) doc.text(c.label, c.x + 2, y + 6, { width: c.w });
    doc.font("Helvetica").fillColor("#000000");
    y += 26;
    for (const k of opts.kpis) {
      const kpiText = `${k.title}\nTarget: ${k.target}`;
      const height = Math.max(doc.heightOfString(kpiText, { width: 200 }), doc.heightOfString(k.actual ?? "-", { width: 85 })) + 8;
      if (y + height > doc.page.height - 80) {
        doc.addPage();
        y = 50;
      }
      doc.fontSize(9);
      doc.text(k.perspective, cols[0]!.x + 2, y, { width: cols[0]!.w });
      doc.text(kpiText, cols[1]!.x + 2, y, { width: cols[1]!.w });
      doc.text(`${k.weight}%`, cols[2]!.x + 2, y, { width: cols[2]!.w });
      doc.text(k.actual ?? "-", cols[3]!.x + 2, y, { width: cols[3]!.w });
      doc.text(k.selfRating ? String(k.selfRating) : "-", cols[4]!.x + 2, y, { width: cols[4]!.w });
      doc.font("Helvetica-Bold").text(k.finalRating ? String(k.finalRating) : "-", cols[5]!.x + 2, y, { width: cols[5]!.w }).font("Helvetica");
      y += height;
      doc.moveTo(50, y - 4).lineTo(545, y - 4).strokeColor("#dde3ea").stroke();
    }
    doc.x = 50;
    doc.y = y + 10;
    doc.fontSize(9).fillColor(MUTED).text(`Ratings: ${[1, 2, 3, 4, 5].map((n) => `${n} ${opts.scale[n]}`).join(" · ")}. The overall result is the weighted average of the final ratings.`, { width: 495 });
    doc.moveDown();
    if (opts.managerComment) {
      doc.fillColor("#000000").font("Helvetica-Bold").fontSize(10).text(`Line Manager's comment${opts.reviewedBy ? ` (${opts.reviewedBy})` : ""}`).font("Helvetica").fontSize(10).text(opts.managerComment, { width: 495 }).moveDown();
    }
    if (opts.appeal) {
      doc.font("Helvetica-Bold").text(`Appeal decided by HR (${opts.appeal.changed ? "result changed" : "result kept"}); this decision is final`).font("Helvetica").text(opts.appeal.decision, { width: 495 }).moveDown();
    }
    if (opts.acknowledged) {
      doc.font("Helvetica-Bold").text(`Acknowledged by the employee on ${date(opts.acknowledged.at)}`).font("Helvetica");
      if (opts.acknowledged.comment) doc.text(`Employee's comment: ${opts.acknowledged.comment}`, { width: 495 });
    }
  });
}
