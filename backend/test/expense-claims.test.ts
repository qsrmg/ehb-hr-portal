import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma.js";
import { addDays, toDate, todayYmd, ymd } from "../src/lib/dates.js";
import { PASSWORD, resetDatabase, startServer, useMemoryTransport } from "./helpers.js";

type Line = {
  date: string; categoryId: number; description: string; amount: number;
  noReceiptExplanation?: string; allowanceJustification?: string; keepReceiptId?: number;
};

const daysAgo = (n: number) => ymd(addDays(toDate(todayYmd()), -n));

describe("expense claims", () => {
  let api: Awaited<ReturnType<typeof startServer>>;
  const token: Record<string, string> = {};
  const id: Record<string, number> = {};
  const cat: Record<string, number> = {};

  /** Submits (or resubmits) a claim; `receipts` lists the line indexes that get a receipt file. */
  async function submit(who: string, lines: Line[], receipts: number[] = lines.map((_, i) => i), resubmitId?: number) {
    const fd = new FormData();
    fd.append("purpose", "Client visits in Lahore");
    fd.append("lines", JSON.stringify(lines));
    for (const i of receipts) fd.append(`receipt_${i}`, new Blob(["%PDF-1.4 test receipt"], { type: "application/pdf" }), `receipt-${i}.pdf`);
    const res = await fetch(`${api.base}/requests/${resubmitId ? `${resubmitId}/resubmit` : "expense"}`, {
      method: resubmitId ? "PUT" : "POST",
      headers: { Authorization: `Bearer ${token[who]}` },
      body: fd,
    });
    return { status: res.status, data: (await res.json()) as { id: number; message: string } };
  }

  const line = (over: Partial<Line> = {}): Line => ({ date: daysAgo(2), categoryId: cat.travel!, description: "Taxi to client office", amount: 1200, ...over });
  const detail = async (requestId: number, who = "ali") => (await api.call(token[who]!, "GET", `/requests/${requestId}`)).data;
  const chainOf = async (requestId: number) =>
    (await prisma.requestStep.findMany({ where: { requestId }, orderBy: { order: "asc" }, include: { approver: true } })).map((s) =>
      s.approver ? `${s.label}: ${s.approver.fullName}` : s.label,
    );
  const setSetting = (key: string, value: string) => prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  const approve = (who: string, requestId: number) => api.call(token[who]!, "POST", `/requests/${requestId}/approve`, {});

  before(async () => {
    await resetDatabase();
    useMemoryTransport();
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    const dept = async (name: string) => prisma.department.create({ data: { name } });
    const [mgmt, finance, eng, admin] = [await dept("Management"), await dept("Finance"), await dept("Engineering"), await dept("Administration")];
    const person = async (key: string, fullName: string, departmentId: number, roles: string[], managerId: number | null) => {
      const e = await prisma.employee.create({
        data: {
          code: `EHB-2024-${String(Object.keys(id).length + 1).padStart(3, "0")}`, email: `${key}@test.local`, fullName, passwordHash,
          mustChangePassword: false, joiningDate: toDate("2024-01-01"), departmentId, managerId, roles: ["EMPLOYEE", ...roles] as never,
        },
      });
      id[key] = e.id;
    };
    await person("ceo", "Imran Qureshi", mgmt.id, ["MANAGEMENT"], null);
    await person("fin", "Bilal Ahmed", finance.id, ["FINANCE"], id.ceo!);
    await person("hr", "Ayesha Siddiqui", mgmt.id, ["HR"], id.ceo!);
    await person("hamza", "Hamza Malik", eng.id, ["LINE_MANAGER", "HOD"], id.ceo!);
    await person("zara", "Zara Khan", eng.id, ["LINE_MANAGER"], id.hamza!);
    await person("omar", "Omar Farooq", eng.id, [], id.zara!);
    await person("ali", "Ali Raza", eng.id, [], id.hamza!);
    await person("usman", "Usman Tariq", admin.id, [], id.ceo!);
    await prisma.department.update({ where: { id: eng.id }, data: { hodId: id.hamza } });
    await prisma.department.update({ where: { id: mgmt.id }, data: { hodId: id.ceo } });
    await prisma.department.update({ where: { id: finance.id }, data: { hodId: id.fin } });

    cat.travel = (await prisma.expenseCategory.create({ data: { name: "Local travel", sortOrder: 1 } })).id;
    cat.fuel = (await prisma.expenseCategory.create({ data: { name: "Fuel", allowanceWarning: true, sortOrder: 2 } })).id;
    cat.meals = (await prisma.expenseCategory.create({ data: { name: "Meals & entertainment", sortOrder: 3 } })).id;

    api = await startServer();
    for (const key of Object.keys(id)) token[key] = await api.login(`${key}@test.local`);
  });

  after(async () => {
    await api.close();
  });

  beforeEach(async () => {
    await prisma.request.deleteMany({ where: { type: "EXPENSE" } });
    await prisma.setting.deleteMany({ where: { key: { startsWith: "expense." } } });
    await prisma.expenseCategory.update({ where: { id: cat.meals! }, data: { monthlyLimit: null, active: true } });
  });

  describe("approval chain", () => {
    test("Line Manager → HOD → Finance", async () => {
      const { status, data } = await submit("omar", [line()]);
      assert.equal(status, 201, data.message);
      assert.deepEqual(await chainOf(data.id), ["Line Manager: Zara Khan", "Head of Department: Hamza Malik", "Finance"]);
    });

    test("line manager who is also the HOD is asked once (Hamza → Finance)", async () => {
      const { data } = await submit("ali", [line()]);
      assert.deepEqual(await chainOf(data.id), ["Line Manager: Hamza Malik", "Finance"]);
    });

    test("a HOD's own claim goes to Management, then Finance", async () => {
      const { data } = await submit("hamza", [line()]);
      assert.deepEqual(await chainOf(data.id), ["Management", "Finance"]);
    });

    test("someone with no manager goes to Management (skipped when they are the only Management user), then Finance", async () => {
      const { data } = await submit("ceo", [line()]);
      assert.deepEqual(await chainOf(data.id), ["Finance"]);
    });

    test("the Management threshold is off by default", async () => {
      const { data } = await submit("omar", [line({ amount: 250_000 })]);
      assert.equal((await chainOf(data.id)).includes("Management"), false);
    });

    test("claims above the threshold get an extra Management step before Finance", async () => {
      await setSetting("expense.managementApprovalAbove", "10000");
      const above = await submit("omar", [line({ amount: 12_000 })]);
      assert.deepEqual(await chainOf(above.data.id), ["Line Manager: Zara Khan", "Head of Department: Hamza Malik", "Management", "Finance"]);
      const below = await submit("omar", [line({ amount: 9_000, date: daysAgo(3) })]);
      assert.deepEqual(await chainOf(below.data.id), ["Line Manager: Zara Khan", "Head of Department: Hamza Malik", "Finance"]);
    });

    test("no double Management step when the line manager is already Management", async () => {
      await setSetting("expense.managementApprovalAbove", "10000");
      const { data } = await submit("usman", [line({ amount: 12_000 })]);
      assert.deepEqual(await chainOf(data.id), ["Line Manager: Imran Qureshi", "Finance"]);
    });

    test("the live check shows who will approve", async () => {
      const res = await api.call(token.omar!, "POST", "/expenses/check", { lines: [{ ...line(), hasReceipt: true }] } as never);
      assert.deepEqual(res.data.approvers, ["Line Manager (Zara Khan)", "Head of Department (Hamza Malik)", "Finance"]);
      assert.equal(res.data.total, 1200);
    });
  });

  describe("receipts", () => {
    test("required at or above PKR 500", async () => {
      const res = await submit("ali", [line({ amount: 500 })], []);
      assert.equal(res.status, 400);
      assert.match(res.data.message, /Line 1: attach a receipt \(required for PKR 500 and above\)/);
    });

    test("below PKR 500 a written explanation replaces the receipt", async () => {
      const missing = await submit("ali", [line({ amount: 300 })], []);
      assert.match(missing.data.message, /attach a receipt or explain why there is none/);
      const explained = await submit("ali", [line({ amount: 300, noReceiptExplanation: "Rickshaw, no receipt given" })], []);
      assert.equal(explained.status, 201, explained.data.message);
    });

    test("the threshold is a setting", async () => {
      await setSetting("expense.receiptOptionalBelow", "1000");
      const res = await submit("ali", [line({ amount: 800, noReceiptExplanation: "Parking meter" })], []);
      assert.equal(res.status, 201, res.data.message);
    });

    test("receipts are visible to the employee, approvers, Finance and HR, not to other employees", async () => {
      const { data } = await submit("ali", [line()]);
      const receiptId = (await detail(data.id)).expense.lines[0].receipt.id;
      for (const who of ["ali", "hamza", "fin", "hr"]) {
        const res = await fetch(`${api.base}/requests/${data.id}/attachments/${receiptId}`, { headers: { Authorization: `Bearer ${token[who]}` } });
        assert.equal(res.status, 200, who);
      }
      const other = await fetch(`${api.base}/requests/${data.id}/attachments/${receiptId}`, { headers: { Authorization: `Bearer ${token.omar}` } });
      assert.equal(other.status, 403);
    });
  });

  describe("dates and amounts", () => {
    test("no expenses older than 30 days, and none in the future", async () => {
      assert.match((await submit("ali", [line({ date: daysAgo(31) })])).data.message, /older than 30 days/);
      assert.match((await submit("ali", [line({ date: daysAgo(-1) })])).data.message, /in the future/);
      assert.equal((await submit("ali", [line({ date: daysAgo(30) })])).status, 201);
    });

    test("the 30 days are a setting", async () => {
      await setSetting("expense.maxAgeDays", "60");
      assert.equal((await submit("ali", [line({ date: daysAgo(45) })])).status, 201);
    });

    test("amounts must be positive with at most 2 decimals", async () => {
      assert.equal((await submit("ali", [line({ amount: 0 })])).status, 400);
      assert.equal((await submit("ali", [line({ amount: 10.555 })])).status, 400);
      assert.equal((await submit("ali", [line({ amount: 10.55 })])).status, 201);
    });
  });

  describe("fuel and mobile allowance", () => {
    test("not blocked, but a justification is required and a warning is shown", async () => {
      const fuel = line({ categoryId: cat.fuel!, description: "Fuel for site visit" });
      assert.match((await submit("ali", [fuel])).data.message, /explain why this Fuel cost is not covered by your salary allowance/);
      const check = await api.call(token.ali!, "POST", "/expenses/check", { lines: [{ ...fuel, hasReceipt: true }] } as never);
      assert.ok(check.data.warnings.some((w: string) => w.includes("you already receive a Fuel allowance")));
      const ok = await submit("ali", [{ ...fuel, allowanceJustification: "Trip to Sheikhupura plant, 120 km" }]);
      assert.equal(ok.status, 201, ok.data.message);
    });
  });

  describe("limits (all off until Finance sets them)", () => {
    test("no limits by default", async () => {
      assert.equal((await submit("ali", [line({ amount: 900_000 })])).status, 201);
    });

    test("per-claim limit", async () => {
      await setSetting("expense.maxPerClaim", "5000");
      const res = await submit("ali", [line({ amount: 3000 }), line({ amount: 2500, date: daysAgo(3) })]);
      assert.match(res.data.message, /PKR 5,500 is above the limit of PKR 5,000 per claim/);
    });

    test("monthly limit counts the employee's other open claims in the same month", async () => {
      await setSetting("expense.maxPerMonth", "8000");
      await setSetting("expense.maxAgeDays", "60");
      const thisMonth = todayYmd();
      assert.equal((await submit("ali", [line({ amount: 5000, date: thisMonth })])).status, 201);
      const over = await submit("ali", [line({ amount: 4000, date: thisMonth, description: "Second taxi" })]);
      assert.match(over.data.message, /PKR 9,000 in total is above the monthly limit of PKR 8,000 \(PKR 5,000 already claimed\)/);
      const lastMonth = ymd(addDays(toDate(`${thisMonth.slice(0, 8)}01`), -1));
      assert.equal((await submit("ali", [line({ amount: 4000, date: lastMonth })])).status, 201, "a different month has its own limit");
    });

    test("per-category monthly limit", async () => {
      await prisma.expenseCategory.update({ where: { id: cat.meals! }, data: { monthlyLimit: 2000 } });
      const meal = (amount: number) => line({ categoryId: cat.meals!, description: "Lunch with client", amount, date: todayYmd() });
      assert.equal((await submit("ali", [meal(1500)])).status, 201);
      assert.match((await submit("ali", [meal(800)])).data.message, /Meals & entertainment totals PKR 2,300, above its monthly limit of PKR 2,000/);
      assert.equal((await submit("ali", [line({ amount: 800, date: todayYmd() })])).status, 201, "other categories are not affected");
    });

    test("rejected and cancelled claims do not count", async () => {
      await setSetting("expense.maxPerMonth", "8000");
      const first = await submit("ali", [line({ amount: 6000, date: todayYmd() })]);
      await api.call(token.ali!, "POST", `/requests/${first.data.id}/cancel`, {});
      assert.equal((await submit("ali", [line({ amount: 6000, date: todayYmd() })])).status, 201);
    });

    test("possible duplicates are a warning, not a block", async () => {
      const first = line({ amount: 1750 });
      await submit("ali", [first]);
      const check = await api.call(token.ali!, "POST", "/expenses/check", { lines: [{ ...first, hasReceipt: true }] } as never);
      assert.ok(check.data.warnings.some((w: string) => /looks like a duplicate of an expense in claim #\d+/.test(w)));
      assert.equal(check.data.errors.length, 0);
      assert.equal((await submit("ali", [first])).status, 201);
    });
  });

  describe("Finance adjusts single lines", () => {
    let claimId: number;
    let lineIds: number[];
    const adjust = (who: string, lineId: number, body: Record<string, unknown>) =>
      api.call(token[who]!, "POST", `/expenses/claims/${claimId}/lines/${lineId}/adjust`, body);

    beforeEach(async () => {
      const res = await submit("ali", [line({ amount: 3000 }), line({ amount: 1000, categoryId: cat.meals!, description: "Team lunch" })]);
      claimId = res.data.id;
      lineIds = (await detail(claimId)).expense.lines.map((l: { id: number }) => l.id);
    });

    test("not before the claim reaches Finance, and never by the line manager or HOD", async () => {
      assert.equal((await adjust("fin", lineIds[0]!, { action: "REDUCE", amount: 2000, reason: "Too high" })).status, 403);
      assert.equal((await adjust("hamza", lineIds[0]!, { action: "REDUCE", amount: 2000, reason: "Too high" })).status, 403);
      await approve("hamza", claimId);
      assert.equal((await adjust("hamza", lineIds[0]!, { action: "REJECT", reason: "Not allowed" })).status, 403);
      assert.equal((await adjust("ali", lineIds[0]!, { action: "REJECT", reason: "Not allowed" })).status, 403);
    });

    test("reduce and reject need a reason; the employee is notified; the approved total follows", async () => {
      await approve("hamza", claimId);
      assert.equal((await adjust("fin", lineIds[0]!, { action: "REDUCE", amount: 2500 })).status, 400, "reason required");
      assert.equal((await adjust("fin", lineIds[0]!, { action: "REDUCE", amount: 3000, reason: "x" })).status, 400);
      assert.equal((await adjust("fin", lineIds[0]!, { action: "REDUCE", amount: 3500, reason: "More than claimed" })).status, 400);

      const reduced = await adjust("fin", lineIds[0]!, { action: "REDUCE", amount: 2500, reason: "Uber rate is PKR 2,500 for this route" });
      assert.equal(reduced.data.totalApproved, 3500);
      const rejected = await adjust("fin", lineIds[1]!, { action: "REJECT", reason: "Team lunches are not reimbursed" });
      assert.equal(rejected.data.totalApproved, 2500);

      const notes = await prisma.notification.findMany({ where: { employeeId: id.ali, title: { startsWith: "Finance changed your claim" } } });
      assert.equal(notes.length, 2);
      assert.match(notes.map((n) => n.body).join("\n"), /PKR 3,000 reduced to PKR 2,500\. Reason: Uber rate/);
      assert.match(notes.map((n) => n.body).join("\n"), /PKR 1,000 rejected\. Reason: Team lunches/);

      assert.equal((await approve("fin", claimId)).status, 200);
      const d = await detail(claimId);
      assert.equal(d.status, "APPROVED");
      assert.equal(d.expense.totalClaimed, 4000);
      assert.equal(d.expense.totalApproved, 2500);
      assert.deepEqual(d.expense.lines.map((l: { status: string }) => l.status), ["REDUCED", "REJECTED"]);
      assert.ok(d.history.some((h: { action: string }) => h.action === "LINE_REDUCE"));
    });

    test("a change can be undone before approving", async () => {
      await approve("hamza", claimId);
      await adjust("fin", lineIds[1]!, { action: "REJECT", reason: "Not allowed" });
      const reset = await adjust("fin", lineIds[1]!, { action: "RESET" });
      assert.equal(reset.data.totalApproved, 4000);
    });

    test("a claim with every line rejected cannot be approved, only rejected", async () => {
      await approve("hamza", claimId);
      for (const l of lineIds) await adjust("fin", l, { action: "REJECT", reason: "Outside policy" });
      const res = await approve("fin", claimId);
      assert.equal(res.status, 400);
      assert.match(res.data.message, /Reject the claim instead/);
      assert.equal((await api.call(token.fin!, "POST", `/requests/${claimId}/reject`, { comment: "Outside policy" })).status, 200);
    });

    test("line manager and HOD can return the whole claim; resubmitting can keep the receipts", async () => {
      assert.equal((await api.call(token.hamza!, "POST", `/requests/${claimId}/return`, { comment: "Add the client name" })).status, 200);
      const before = (await detail(claimId)).expense.lines;
      const res = await submit(
        "ali",
        before.map((l: { date: string; description: string; amount: number; receipt: { id: number } }, i: number) => ({
          date: l.date, categoryId: i === 0 ? cat.travel! : cat.meals!, description: `${l.description} (Acme Ltd)`, amount: l.amount, keepReceiptId: l.receipt.id,
        })),
        [],
        claimId,
      );
      assert.equal(res.status, 200, res.data.message);
      const after = (await detail(claimId)).expense.lines;
      assert.deepEqual(after.map((l: { receipt: { id: number } }) => l.receipt.id), before.map((l: { receipt: { id: number } }) => l.receipt.id));
      assert.equal((await detail(claimId)).status, "PENDING");
    });

    test("a receipt from another claim cannot be reused", async () => {
      const other = await submit("ali", [line({ amount: 700, date: daysAgo(4) })]);
      const foreign = (await detail(other.data.id)).expense.lines[0].receipt.id;
      await api.call(token.hamza!, "POST", `/requests/${claimId}/return`, { comment: "Fix" });
      const res = await submit("ali", [line({ keepReceiptId: foreign })], [], claimId);
      assert.equal(res.status, 400);
    });
  });

  describe("paid step", () => {
    let claimId: number;
    const pay = (who: string, body: Record<string, unknown>) => api.call(token[who]!, "POST", `/expenses/claims/${claimId}/paid`, body);
    const valid = () => ({ paidOn: todayYmd(), method: "BANK_TRANSFER", reference: "IBFT-20261104-7781" });

    beforeEach(async () => {
      claimId = (await submit("ali", [line({ amount: 2200 })])).data.id;
    });

    test("only after approval, only by Finance, with date, method and reference", async () => {
      assert.equal((await pay("fin", valid())).status, 400, "not approved yet");
      await approve("hamza", claimId);
      await approve("fin", claimId);
      assert.equal((await pay("ali", valid())).status, 403);
      assert.equal((await pay("hamza", valid())).status, 403);
      assert.equal((await pay("fin", { ...valid(), method: "CASH" })).status, 400);
      assert.equal((await pay("fin", { ...valid(), reference: "" })).status, 400);
      assert.equal((await pay("fin", { ...valid(), paidOn: daysAgo(-2) })).status, 400, "future date");

      assert.equal((await pay("fin", { ...valid(), method: "WITH_SALARY", reference: "Payroll Nov 2026" })).status, 200);
      const d = await detail(claimId);
      assert.deepEqual({ ...d.expense.paid, paidAt: undefined }, { paidOn: todayYmd(), method: "WITH_SALARY", reference: "Payroll Nov 2026", paidBy: "Bilal Ahmed", paidAt: undefined });
      assert.equal(d.canMarkPaid, false);
      assert.ok(d.history.some((h: { action: string }) => h.action === "PAID"));
      const note = await prisma.notification.findFirst({ where: { employeeId: id.ali, title: { startsWith: "Paid:" } } });
      assert.match(note!.body, /PKR 2,200 paid by with salary on/);

      assert.equal((await pay("fin", valid())).status, 400, "already paid");
    });

    test("Finance sees approved claims waiting for payment, then under paid", async () => {
      await approve("hamza", claimId);
      await approve("fin", claimId);
      const toPay = await api.call(token.fin!, "GET", "/expenses/claims?view=to-pay");
      assert.deepEqual(toPay.data.map((c: { requestId: number }) => c.requestId), [claimId]);
      await pay("fin", valid());
      assert.equal((await api.call(token.fin!, "GET", "/expenses/claims?view=to-pay")).data.length, 0);
      assert.equal((await api.call(token.fin!, "GET", "/expenses/claims?view=paid")).data[0].paid.reference, "IBFT-20261104-7781");
      assert.equal((await api.call(token.ali!, "GET", "/expenses/claims")).status, 403);
    });
  });

  describe("settings and categories (HR / Finance)", () => {
    test("Finance can set the expense limits, including empty = off, but not other settings", async () => {
      assert.equal((await api.call(token.fin!, "PUT", "/settings", { "expense.maxPerClaim": "25000" })).status, 200);
      assert.equal((await api.call(token.fin!, "PUT", "/settings", { "expense.maxPerClaim": "" })).status, 200);
      assert.equal((await api.call(token.fin!, "PUT", "/settings", { "expense.maxAgeDays": "" })).status, 400, "not optional");
      assert.equal((await api.call(token.fin!, "PUT", "/settings", { "attendance.lateAfter": "09:30" })).status, 403);
      assert.equal((await api.call(token.ali!, "PUT", "/settings", { "expense.maxPerClaim": "1" })).status, 403);
      const visible = (await api.call(token.fin!, "GET", "/settings")).data.map((s: { key: string }) => s.key);
      assert.ok(visible.every((k: string) => k.startsWith("expense.") || k.startsWith("travel.")), "Finance sees expense and travel settings only");
      assert.ok(visible.includes("travel.perDiemRate"));
    });

    test("HR and Finance edit categories with an optional accounting code; employees cannot", async () => {
      const created = await api.call(token.fin!, "POST", "/expenses/categories", { name: "Parking", accountingCode: "6105" });
      assert.equal(created.status, 201);
      assert.equal(created.data.accountingCode, "6105");
      assert.equal((await api.call(token.hr!, "PUT", `/expenses/categories/${created.data.id}`, { monthlyLimit: 3000 })).data.monthlyLimit, 3000);
      assert.equal((await api.call(token.fin!, "POST", "/expenses/categories", { name: "Parking" })).status, 409);
      assert.equal((await api.call(token.ali!, "POST", "/expenses/categories", { name: "Snacks" })).status, 403);
      await prisma.expenseCategory.delete({ where: { id: created.data.id } });
    });

    test("an inactive category is hidden from employees and cannot be used", async () => {
      await api.call(token.fin!, "PUT", `/expenses/categories/${cat.meals}`, { active: false });
      const list = (await api.call(token.ali!, "GET", "/expenses/categories")).data.map((c: { id: number }) => c.id);
      assert.equal(list.includes(cat.meals), false);
      assert.match((await submit("ali", [line({ categoryId: cat.meals! })])).data.message, /choose a category/);
    });
  });
});
