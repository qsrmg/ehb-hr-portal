import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma.js";
import { toDate } from "../src/lib/dates.js";
import { PASSWORD, outbox, resetDatabase, startServer, useMemoryTransport } from "./helpers.js";

describe("Payroll and pay slip corrections", () => {
  let api: Awaited<ReturnType<typeof startServer>>;
  const token: Record<string, string> = {};
  const id: Record<string, number> = {};
  let aliSlipId: number;
  let managerSlipId: number;

  const as = (who: string) => ({
    get: (path: string) => api.call(token[who]!, "GET", path),
    patch: (path: string, body: Record<string, unknown>) => api.call(token[who]!, "PATCH", path, body),
  });
  const ok = (res: { status: number; data: { message?: string } }, status = 200) => assert.equal(res.status, status, res.data.message ?? "");

  /** The upload route needs a real multipart file, which the shared helpers.ts `call()` does not build for this path. */
  async function upload(who: string, year: number, month: number, rows: Record<string, string | number>[]) {
    const headers = Object.keys(rows[0]!);
    const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => r[h]).join(","))].join("\n");
    const fd = new FormData();
    fd.append("year", String(year));
    fd.append("month", String(month));
    fd.append("file", new Blob([csv], { type: "text/csv" }), "payroll.csv");
    const res = await fetch(`${api.base}/payroll/upload`, { method: "POST", headers: { Authorization: `Bearer ${token[who]}` }, body: fd });
    return { status: res.status, data: await res.json() };
  }

  before(async () => {
    await resetDatabase();
    useMemoryTransport();
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    const eng = await prisma.department.create({ data: { name: "Engineering" } });
    const person = async (key: string, fullName: string, roles: string[], managerId: number | null, status: "ACTIVE" | "INACTIVE" = "ACTIVE") => {
      const e = await prisma.employee.create({
        data: {
          code: `EHB-2024-${String(Object.keys(id).length + 1).padStart(3, "0")}`, email: `${key}@test.local`, fullName, passwordHash, mustChangePassword: false,
          joiningDate: toDate("2024-01-01"), departmentId: eng.id, managerId, roles: ["EMPLOYEE", ...roles] as never, status,
        },
      });
      id[key] = e.id;
    };
    await person("hr", "Ayesha Siddiqui", ["HR"], null);
    await person("hr2", "Hina Malik", ["HR"], null);
    await person("fin", "Bilal Ahmed", ["FINANCE"], null);
    await person("mgmt", "Imran Qureshi", ["MANAGEMENT"], null);
    await person("admin", "Usman Tariq", ["ADMIN"], null);
    await person("manager", "Hamza Malik", ["LINE_MANAGER"], null);
    await person("ali", "Ali Raza", [], id.manager!);
    await person("exited", "Zara Khan", [], id.manager!, "INACTIVE");
    api = await startServer();
    for (const key of Object.keys(id)) token[key] = await api.login(`${key}@test.local`);
  });

  after(async () => {
    await api.close();
  });

  test("Finance uploads a month; HR, Finance and Management can see it, the Line Manager and Admin cannot", async () => {
    const res = await upload("fin", 2026, 11, [
      { EmployeeCode: "EHB-2024-007", Basic: 50000, HouseRent: 10000, Medical: 2000, Conveyance: 2000, Fuel: 2000, Mobile: 2000, IncomeTax: 5000, EOBI: 370, ProvidentFund: 4165 },
      { EmployeeCode: "EHB-2024-006", Basic: 60000, HouseRent: 12000, Medical: 2500, Conveyance: 2500, Fuel: 2500, Mobile: 2500, IncomeTax: 6000, EOBI: 370, ProvidentFund: 5000 },
    ]);
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.payslipsCreated, 2);
    assert.deepEqual(res.data.correctedSkipped, []);

    const mine = await as("ali").get("/payroll/payslips");
    ok(mine);
    aliSlipId = mine.data[0].id;
    assert.equal(mine.data[0].gross, 68000);
    assert.equal(mine.data[0].totalDeductions, 9535);
    assert.equal(mine.data[0].netPay, 58465);
    assert.equal(mine.data[0].correctedAt, null);

    const managerSlip = await prisma.payslip.findFirstOrThrow({ where: { employeeId: id.manager } });
    managerSlipId = managerSlip.id;

    for (const who of ["hr", "fin", "mgmt"]) ok(await as(who).get(`/payroll/payslips?employeeId=${id.ali}`));
    for (const who of ["manager", "admin"]) assert.equal((await as(who).get(`/payroll/payslips?employeeId=${id.ali}`)).status, 403);
  });

  test("viewing someone else's pay slips and PDF is audited; one's own is not", async () => {
    const beforeList = await prisma.auditLog.count({ where: { action: "VIEW_SENSITIVE", entity: "Payslip", entityId: String(id.ali) } });
    ok(await as("ali").get("/payroll/payslips"));
    assert.equal(await prisma.auditLog.count({ where: { action: "VIEW_SENSITIVE", entity: "Payslip", entityId: String(id.ali) } }), beforeList, "no audit row for Ali's own list");
    ok(await as("hr").get(`/payroll/payslips?employeeId=${id.ali}`));
    assert.equal(await prisma.auditLog.count({ where: { action: "VIEW_SENSITIVE", entity: "Payslip", entityId: String(id.ali) } }), beforeList + 1);

    const beforePdf = await prisma.auditLog.count({ where: { action: "VIEW_SENSITIVE", entity: "Payslip", entityId: String(aliSlipId) } });
    await fetch(`${api.base}/payroll/payslips/${aliSlipId}/pdf`, { headers: { Authorization: `Bearer ${token.ali}` } });
    assert.equal(await prisma.auditLog.count({ where: { action: "VIEW_SENSITIVE", entity: "Payslip", entityId: String(aliSlipId) } }), beforePdf, "no audit row for Ali's own PDF");
    await fetch(`${api.base}/payroll/payslips/${aliSlipId}/pdf`, { headers: { Authorization: `Bearer ${token.hr}` } });
    assert.equal(await prisma.auditLog.count({ where: { action: "VIEW_SENSITIVE", entity: "Payslip", entityId: String(aliSlipId) } }), beforePdf + 1);
  });

  test("a non-HR user cannot edit a pay slip or see its history", async () => {
    for (const who of ["fin", "mgmt", "manager", "admin", "ali"]) {
      assert.equal((await as(who).patch(`/payroll/payslips/${aliSlipId}`, { basic: 70000, reason: "Trying without HR" })).status, 403);
      assert.equal((await as(who).get(`/payroll/payslips/${aliSlipId}/revisions`)).status, 403);
    }
  });

  test("HR cannot edit their own pay slip", async () => {
    const hrUpload = await upload("fin", 2026, 11, [{ EmployeeCode: "EHB-2024-001", Basic: 80000, HouseRent: 16000, Medical: 3000, Conveyance: 3000, Fuel: 3000, Mobile: 3000, IncomeTax: 8000, EOBI: 370, ProvidentFund: 6000 }]);
    ok(hrUpload, 200);
    const hrSlip = await prisma.payslip.findFirstOrThrow({ where: { employeeId: id.hr } });
    const res = await as("hr").patch(`/payroll/payslips/${hrSlip.id}`, { basic: 90000, reason: "Self correction attempt" });
    assert.equal(res.status, 403);
    assert.match(res.data.message, /cannot edit their own pay slip/);
  });

  test("validation: a short reason, a negative or too-large amount, and a would-be-negative net pay are all rejected", async () => {
    assert.match((await as("hr").patch(`/payroll/payslips/${aliSlipId}`, { basic: 51000, reason: "x" })).data.message, /reason/i);
    assert.match((await as("hr").patch(`/payroll/payslips/${aliSlipId}`, { basic: -1, reason: "Fixing a typo" })).data.message, /negative/i);
    assert.match((await as("hr").patch(`/payroll/payslips/${aliSlipId}`, { basic: 20_000_000, reason: "Fixing a typo" })).data.message, /too large/i);
    assert.match((await as("hr").patch(`/payroll/payslips/${aliSlipId}`, { incomeTax: 9_000_000, reason: "Fixing a typo" })).data.message, /negative/i);
  });

  test("an edit that changes nothing is rejected, with no revision row written", async () => {
    const before = await prisma.payslipRevision.count({ where: { payslipId: aliSlipId } });
    const res = await as("hr").patch(`/payroll/payslips/${aliSlipId}`, { basic: 50000, reason: "No real change" });
    assert.equal(res.status, 400);
    assert.match(res.data.message, /at least one amount/);
    assert.equal(await prisma.payslipRevision.count({ where: { payslipId: aliSlipId } }), before);
  });

  test("HR corrects a pay slip: totals recalculate, the full revision is kept, and the notification has no amount or reason", async () => {
    const res = await as("hr").patch(`/payroll/payslips/${aliSlipId}`, { basic: 55000, houseRent: 11000, reason: "Basic and house rent were under-entered on the sheet" });
    ok(res);
    assert.equal(res.data.basic, 55000);
    assert.equal(res.data.houseRent, 11000);
    assert.equal(res.data.gross, 74000, "55000+11000, the other 4 earnings unchanged (2000x4=8000) => 74000");
    assert.equal(res.data.totalDeductions, 9535, "deductions were not touched");
    assert.equal(res.data.netPay, 64465);
    assert.ok(res.data.correctedAt);
    assert.equal(res.data.correctionReason, "Basic and house rent were under-entered on the sheet");

    const revision = await prisma.payslipRevision.findFirstOrThrow({ where: { payslipId: aliSlipId }, orderBy: { createdAt: "desc" } });
    assert.equal(Number(revision.basicBefore), 50000);
    assert.equal(Number(revision.basicAfter), 55000);
    assert.equal(Number(revision.houseRentBefore), 10000);
    assert.equal(Number(revision.houseRentAfter), 11000);
    assert.equal(Number(revision.grossBefore), 68000);
    assert.equal(Number(revision.grossAfter), 74000);
    assert.equal(Number(revision.netPayBefore), 58465);
    assert.equal(Number(revision.netPayAfter), 64465);
    assert.equal(revision.reason, "Basic and house rent were under-entered on the sheet");
    assert.equal(revision.correctedById, id.hr);

    const log = await prisma.auditLog.findFirst({ where: { action: "UPDATE", entity: "Payslip", entityId: String(aliSlipId) }, orderBy: { id: "desc" } });
    assert.equal(log?.actorId, id.hr);
    const details = log?.details as { before: { basic: number }; after: { basic: number }; reason: string };
    assert.equal(details.before.basic, 50000);
    assert.equal(details.after.basic, 55000);
    assert.equal(details.reason, "Basic and house rent were under-entered on the sheet");

    const note = await prisma.notification.findFirstOrThrow({ where: { employeeId: id.ali, title: "Pay slip corrected" } });
    assert.equal(note.body, "Your pay slip for November 2026 was corrected by HR. Open Pay slips to see the details.", "exact wording: no reason, no amount");

    const sent = outbox.filter((e) => e.to === "ali@test.local" && e.subject === "Pay slip corrected");
    assert.equal(sent.length, 1);
    assert.ok(sent[0]!.text.includes(note.body), "the email uses the same amount-free, reason-free text as the in-app notification");
    assert.equal(sent[0]!.text.includes("under-entered"), false, "the reason must never appear in the email");
    for (const figure of ["55000", "11000", "74000", "64465"]) assert.equal(sent[0]!.text.includes(figure), false, `no amount (${figure}) in the email`);
  });

  test("HR sees the full correction history; it lists every edit, newest first", async () => {
    ok(await as("hr").patch(`/payroll/payslips/${aliSlipId}`, { medical: 2500, reason: "Medical allowance revised upward" }));
    const history = await as("hr").get(`/payroll/payslips/${aliSlipId}/revisions`);
    ok(history);
    assert.equal(history.data.length, 2);
    assert.equal(history.data[0].reason, "Medical allowance revised upward");
    assert.equal(history.data[0].medical.from, 2000);
    assert.equal(history.data[0].medical.to, 2500);
    assert.equal(history.data[1].reason, "Basic and house rent were under-entered on the sheet");
    assert.equal(history.data[1].correctedBy, "Ayesha Siddiqui");
  });

  test("re-uploading the same month never overwrites a corrected pay slip; an uncorrected one still updates as before", async () => {
    const res = await upload("fin", 2026, 11, [
      { EmployeeCode: "EHB-2024-007", Basic: 999999, HouseRent: 1, Medical: 1, Conveyance: 1, Fuel: 1, Mobile: 1, IncomeTax: 1, EOBI: 1, ProvidentFund: 1 },
      { EmployeeCode: "EHB-2024-006", Basic: 65000, HouseRent: 12000, Medical: 2500, Conveyance: 2500, Fuel: 2500, Mobile: 2500, IncomeTax: 6000, EOBI: 370, ProvidentFund: 5000 },
    ]);
    ok(res, 200);
    assert.equal(res.data.payslipsCreated, 1, "only the uncorrected employee's row is imported");
    assert.equal(res.data.correctedSkipped.length, 1);
    assert.equal(res.data.correctedSkipped[0].employee, "EHB-2024-007");
    assert.equal(res.data.correctedSkipped[0].reason, "Medical allowance revised upward");

    const aliStillCorrected = await prisma.payslip.findUniqueOrThrow({ where: { id: aliSlipId } });
    assert.equal(Number(aliStillCorrected.basic), 55000, "the correction was not overwritten by the re-upload");

    const managerStillUpdates = await prisma.payslip.findUniqueOrThrow({ where: { id: managerSlipId } });
    assert.equal(Number(managerStillUpdates.basic), 65000, "an uncorrected pay slip still overwrites on re-upload, as before");
  });

  test("an exited employee's pay slip can still be corrected, but they are never notified", async () => {
    const uploadRes = await upload("fin", 2026, 11, [{ EmployeeCode: "EHB-2024-008", Basic: 40000, HouseRent: 8000, Medical: 1500, Conveyance: 1500, Fuel: 1500, Mobile: 1500, IncomeTax: 3000, EOBI: 370, ProvidentFund: 3000 }]);
    ok(uploadRes, 200);
    const slip = await prisma.payslip.findFirstOrThrow({ where: { employeeId: id.exited } });
    const before = await prisma.notification.count({ where: { employeeId: id.exited } });
    const res = await as("hr").patch(`/payroll/payslips/${slip.id}`, { basic: 42000, reason: "Backdated increment missed before exit" });
    ok(res);
    assert.equal(await prisma.notification.count({ where: { employeeId: id.exited } }), before, "no notification for an employee who has exited");
  });

  test("a non-existent pay slip gives 404 for both edit and history", async () => {
    assert.equal((await as("hr").patch("/payroll/payslips/999999", { basic: 1, reason: "Does not exist" })).status, 404);
    assert.equal((await as("hr").get("/payroll/payslips/999999/revisions")).status, 404);
  });
});
