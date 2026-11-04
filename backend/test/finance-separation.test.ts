import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma.js";
import { addDays, toDate, todayYmd, ymd } from "../src/lib/dates.js";
import { sendDueReminders } from "../src/jobs/reminders.js";
import { PASSWORD, resetDatabase, startServer, useMemoryTransport } from "./helpers.js";

/**
 * Finance separation on expense claims:
 * - the Finance step goes to a Finance user who is not the claimant and has not approved an earlier step;
 * - if nobody like that exists, Management stands in for Finance (the step is never skipped);
 * - "Mark as paid" can be done by any Finance user except the claimant.
 */
describe("Finance step: not the claimant, not an earlier approver; otherwise Management", () => {
  let api: Awaited<ReturnType<typeof startServer>>;
  const token: Record<string, string> = {};
  const id: Record<string, number> = {};
  let travel: number;
  let amount = 2000; // each claim gets a different amount so duplicate warnings never interfere

  async function claim(who: string) {
    const fd = new FormData();
    fd.append("purpose", "Bank visits");
    fd.append("lines", JSON.stringify([{ date: ymd(addDays(toDate(todayYmd()), -1)), categoryId: travel, description: "Taxi to the bank", amount: amount++ }]));
    fd.append("receipt_0", new Blob(["%PDF-1.4 receipt"], { type: "application/pdf" }), "receipt.pdf");
    const res = await fetch(`${api.base}/requests/expense`, { method: "POST", headers: { Authorization: `Bearer ${token[who]}` }, body: fd });
    const data = (await res.json()) as { id: number; message: string };
    assert.equal(res.status, 201, data.message);
    return data.id;
  }
  const chain = async (requestId: number) =>
    (await prisma.requestStep.findMany({ where: { requestId }, orderBy: { order: "asc" }, include: { approver: true } })).map((s) =>
      s.approver ? `${s.label}: ${s.approver.fullName}` : s.label,
    );
  const act = (who: string, requestId: number, action = "approve", body: Record<string, unknown> = {}) =>
    api.call(token[who]!, "POST", `/requests/${requestId}/${action}`, body);
  const pay = (who: string, requestId: number) =>
    api.call(token[who]!, "POST", `/expenses/claims/${requestId}/paid`, { paidOn: todayYmd(), method: "BANK_TRANSFER", reference: `IBFT-${requestId}` });
  const waitingFor = async (who: string) => ((await api.call(token[who]!, "GET", "/requests/approvals")).data as { id: number }[]).map((r) => r.id);
  const detail = async (who: string, requestId: number) => (await api.call(token[who]!, "GET", `/requests/${requestId}`)).data;
  const setRoles = (who: string, roles: string[]) => api.call(token.hr!, "PATCH", `/employees/${id[who]}`, { roles });
  const askedToApprove = async (requestId: number) =>
    (await prisma.notification.findMany({ where: { link: `/requests/${requestId}`, title: { startsWith: "Approval needed" } } })).map((n) => n.employeeId).sort();

  /** HR adds an employee from the Employees page and they log in with the initial password. */
  async function hrAdds(key: string, fullName: string, departmentName: string) {
    const dept = await prisma.department.findUniqueOrThrow({ where: { name: departmentName } });
    const created = await api.call(token.hr!, "POST", "/employees", { fullName, email: `${key}@test.local`, joiningDate: "2026-11-02", departmentId: dept.id });
    assert.equal(created.status, 201);
    id[key] = created.data.id;
    const login = await fetch(`${api.base}/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `${key}@test.local`, password: "Welcome@123" }),
    });
    token[key] = ((await login.json()) as { token: string }).token;
  }

  before(async () => {
    await resetDatabase();
    useMemoryTransport();
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    const mgmt = await prisma.department.create({ data: { name: "Management" } });
    const finance = await prisma.department.create({ data: { name: "Finance" } });
    const eng = await prisma.department.create({ data: { name: "Engineering" } });
    const person = async (key: string, fullName: string, departmentId: number, roles: string[], managerId: number | null) => {
      const e = await prisma.employee.create({
        data: {
          code: `EHB-2024-${String(Object.keys(id).length + 1).padStart(3, "0")}`, email: `${key}@test.local`, fullName, passwordHash, mustChangePassword: false,
          joiningDate: toDate("2024-01-01"), departmentId, managerId, roles: ["EMPLOYEE", ...roles] as never,
        },
      });
      id[key] = e.id;
    };
    await person("ceo", "Imran Qureshi", mgmt.id, ["MANAGEMENT"], null);
    await person("hr", "Ayesha Siddiqui", mgmt.id, ["HR"], id.ceo!);
    await person("bilal", "Bilal Ahmed", finance.id, ["FINANCE", "HOD"], id.ceo!);
    await person("hamza", "Hamza Malik", eng.id, ["LINE_MANAGER", "HOD"], id.ceo!);
    await person("ali", "Ali Raza", eng.id, [], id.hamza!);
    await prisma.department.update({ where: { id: finance.id }, data: { hodId: id.bilal } });
    await prisma.department.update({ where: { id: eng.id }, data: { hodId: id.hamza } });
    await prisma.department.update({ where: { id: mgmt.id }, data: { hodId: id.ceo } });
    travel = (await prisma.expenseCategory.create({ data: { name: "Local travel" } })).id;

    api = await startServer();
    for (const key of Object.keys(id)) token[key] = await api.login(`${key}@test.local`);
  });

  after(async () => {
    await api.close();
  });

  test("only one Finance user: his own claim is not skipped, Management stands in for Finance", async () => {
    const requestId = await claim("bilal");
    assert.deepEqual(await chain(requestId), ["Management", "Management (in place of Finance)"]);
    assert.equal((await act("ceo", requestId)).status, 200);
    // The CEO is the only Management user, so he may also take the stand-in step rather than leave it stuck.
    assert.equal((await act("ceo", requestId)).status, 200);
    assert.equal((await detail("bilal", requestId)).status, "APPROVED");
    assert.equal((await pay("bilal", requestId)).status, 403, "nobody pays their own claim");
  });

  test("HR adds an employee and gives them the Finance role; only HR can assign roles", async () => {
    await hrAdds("sana", "Sana Iqbal", "Finance");
    const res = await api.call(token.hr!, "PATCH", `/employees/${id.sana}`, { managerId: id.bilal, roles: ["FINANCE"] });
    assert.equal(res.status, 200);
    assert.deepEqual([...res.data.roles].sort(), ["EMPLOYEE", "FINANCE"]);
    assert.equal((await api.call(token.bilal!, "PATCH", `/employees/${id.ali}`, { roles: ["FINANCE"] })).status, 403);
    assert.equal((await api.call(token.ali!, "PATCH", `/employees/${id.ali}`, { roles: ["FINANCE"] })).status, 403);
  });

  test("Bilal's claim goes to Sana for the Finance step; Bilal cannot approve, adjust or pay it", async () => {
    const requestId = await claim("bilal");
    assert.deepEqual(await chain(requestId), ["Management", "Finance"]);
    await act("ceo", requestId);
    assert.ok((await waitingFor("sana")).includes(requestId));
    assert.ok(!(await waitingFor("bilal")).includes(requestId));
    const lineId = (await detail("bilal", requestId)).expense.lines[0].id;
    assert.equal((await act("bilal", requestId)).status, 403);
    assert.equal((await api.call(token.bilal!, "POST", `/expenses/claims/${requestId}/lines/${lineId}/adjust`, { action: "REJECT", reason: "Self-review" })).status, 403);
    assert.equal((await act("sana", requestId)).status, 200);
    assert.equal((await pay("bilal", requestId)).status, 403);
    assert.equal((await pay("sana", requestId)).status, 200);
  });

  test("Sana reports to Bilal: Bilal approves as line manager, so he cannot also be Finance; Management stands in", async () => {
    const requestId = await claim("sana");
    assert.deepEqual(await chain(requestId), ["Line Manager: Bilal Ahmed", "Management (in place of Finance)"]);
    await act("bilal", requestId);
    assert.ok(!(await waitingFor("bilal")).includes(requestId), "Bilal is not asked twice");
    assert.equal((await act("bilal", requestId)).status, 403);
    assert.equal((await act("ceo", requestId)).status, 200);
    assert.equal((await detail("sana", requestId)).canAdjustLines, false, "line changes stay with Finance");
    // Payment: any Finance user except the claimant, even one who approved an earlier step
    assert.equal((await pay("sana", requestId)).status, 403);
    assert.equal((await pay("bilal", requestId)).status, 200);
  });

  test("with a third Finance user, Sana's claim goes to her, never to Bilal who approved as line manager", async () => {
    await hrAdds("nadia", "Nadia Shah", "Finance");
    await setRoles("nadia", ["FINANCE"]);
    const requestId = await claim("sana");
    assert.deepEqual(await chain(requestId), ["Line Manager: Bilal Ahmed", "Finance"]);
    await act("bilal", requestId);
    assert.ok((await waitingFor("nadia")).includes(requestId));
    assert.ok(!(await waitingFor("bilal")).includes(requestId), "Bilal approved an earlier step");
    assert.ok(!(await waitingFor("sana")).includes(requestId), "the claimant");
    assert.equal((await detail("bilal", requestId)).canAct, false);
    assert.equal((await act("bilal", requestId)).status, 403);
    assert.deepEqual(await askedToApprove(requestId), [id.bilal, id.nadia].sort(), "Bilal for the line-manager step, Nadia for Finance");
    assert.equal((await act("nadia", requestId)).status, 200);
  });

  test("reminders for the Finance step go only to eligible Finance users", async () => {
    const requestId = await claim("sana");
    await act("bilal", requestId);
    await prisma.request.updateMany({ where: { status: "PENDING", id: { not: requestId } }, data: { status: "CANCELLED" } });
    await prisma.requestStep.updateMany({ where: { requestId, status: "PENDING" }, data: { pendingSince: new Date("2026-11-16T06:00:00+05:00"), lastReminderAt: null } });
    assert.equal(await sendDueReminders(new Date("2026-11-16T10:00:00+05:00")), 1);
    const reminded = await prisma.notification.findMany({ where: { link: `/requests/${requestId}`, title: { startsWith: "Reminder:" } } });
    assert.deepEqual(reminded.map((n) => n.employeeId), [id.nadia]);
    await act("nadia", requestId, "reject", { comment: "Test" });
  });

  test("someone who is both Finance and Management approves the Management step: Finance is then rerouted to another Management user", async () => {
    await setRoles("sana", []); // Finance users now: Bilal and Nadia
    await setRoles("nadia", ["FINANCE", "MANAGEMENT"]);
    const requestId = await claim("bilal");
    assert.deepEqual(await chain(requestId), ["Management", "Finance"], "at submission Nadia could still do Finance");
    assert.equal((await act("nadia", requestId)).status, 200, "Nadia approves as Management");
    assert.deepEqual(await chain(requestId), ["Management", "Management (in place of Finance)"]);
    assert.ok(!(await waitingFor("nadia")).includes(requestId), "Nadia cannot approve the same claim twice");
    assert.equal((await act("nadia", requestId)).status, 403);
    assert.ok((await waitingFor("ceo")).includes(requestId));
    assert.equal((await act("ceo", requestId)).status, 200);
    assert.equal((await pay("nadia", requestId)).status, 200, "Nadia may still pay it");
  });

  test("other employees' claims: any eligible Finance user, once", async () => {
    await setRoles("nadia", ["FINANCE"]);
    const requestId = await claim("ali");
    assert.deepEqual(await chain(requestId), ["Line Manager: Hamza Malik", "Finance"]);
    await act("hamza", requestId);
    assert.ok((await waitingFor("bilal")).includes(requestId));
    assert.ok((await waitingFor("nadia")).includes(requestId));
    assert.equal((await act("nadia", requestId)).status, 200);
    assert.equal((await act("bilal", requestId)).status, 400, "already decided");
    assert.equal((await pay("bilal", requestId)).status, 200);
  });

  test("with no Finance user at all besides the claimant and no other Management user, submission still works and nothing gets stuck", async () => {
    await setRoles("nadia", []);
    const requestId = await claim("bilal");
    assert.deepEqual(await chain(requestId), ["Management", "Management (in place of Finance)"]);
    await act("ceo", requestId);
    assert.equal((await act("ceo", requestId)).status, 200);
  });
});
