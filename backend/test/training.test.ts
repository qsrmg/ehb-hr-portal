import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma.js";
import { addDays, toDate, todayYmd, ymd } from "../src/lib/dates.js";
import { PASSWORD, resetDatabase, startServer, useMemoryTransport, waitForEmails, sentTo } from "./helpers.js";

const inDays = (n: number) => ymd(addDays(toDate(todayYmd()), n));

type Fields = {
  programmeTitle?: string; provider?: string; trainingType?: string; startDate?: string; endDate?: string;
  mode?: string; location?: string; estimatedCost?: number; justification?: string;
};

describe("training requests", () => {
  let api: Awaited<ReturnType<typeof startServer>>;
  const token: Record<string, string> = {};
  const id: Record<string, number> = {};

  const fields = (over: Fields = {}): Required<Fields> => ({
    programmeTitle: "Advanced React Workshop",
    provider: "Tech Academy",
    trainingType: "WORKSHOP",
    startDate: inDays(14),
    endDate: inDays(16),
    mode: "ONLINE",
    location: "",
    estimatedCost: 50_000,
    justification: "Upgrades the team's front-end skills ahead of the new product launch",
    ...over,
  });

  const submit = (who: string, over: Fields = {}) => api.call(token[who]!, "POST", "/requests/training", fields(over) as never);
  const resubmit = (who: string, requestId: number, over: Fields = {}) => api.call(token[who]!, "PUT", `/requests/${requestId}/resubmit`, fields(over) as never);
  const detail = async (requestId: number, who = "ali") => (await api.call(token[who]!, "GET", `/requests/${requestId}`)).data;
  const approve = (who: string, requestId: number, comment?: string) => api.call(token[who]!, "POST", `/requests/${requestId}/approve`, comment ? { comment } : {});
  const chainOf = async (requestId: number) =>
    (await prisma.requestStep.findMany({ where: { requestId }, orderBy: { order: "asc" }, include: { approver: true } })).map((s) =>
      s.approver ? `${s.label}: ${s.approver.fullName}` : s.label,
    );
  const setSetting = (key: string, value: string) => prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });

  before(async () => {
    await resetDatabase();
    useMemoryTransport();
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    const dept = async (name: string) => prisma.department.create({ data: { name } });
    const [mgmt, finance, eng] = [await dept("Management"), await dept("Finance"), await dept("Engineering")];
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
    await person("hamza", "Hamza Malik", eng.id, ["LINE_MANAGER", "HOD"], id.ceo!);
    await person("zara", "Zara Khan", eng.id, ["LINE_MANAGER"], id.hamza!);
    await person("omar", "Omar Farooq", eng.id, [], id.zara!);
    await person("ali", "Ali Raza", eng.id, [], id.hamza!);
    await prisma.department.update({ where: { id: eng.id }, data: { hodId: id.hamza } });
    await prisma.department.update({ where: { id: mgmt.id }, data: { hodId: id.ceo } });
    await prisma.department.update({ where: { id: finance.id }, data: { hodId: id.fin } });

    api = await startServer();
    for (const key of Object.keys(id)) token[key] = await api.login(`${key}@test.local`);
  });

  after(async () => {
    await api.close();
  });

  describe("approval chain", () => {
    test("Line Manager → HOD → Finance", async () => {
      const { status, data } = await submit("omar");
      assert.equal(status, 201, data.message);
      assert.deepEqual(await chainOf(data.id), ["Line Manager: Zara Khan", "Head of Department: Hamza Malik", "Finance"]);
    });

    test("line manager who is also the HOD is asked once (Hamza → Finance)", async () => {
      const { data } = await submit("ali");
      assert.deepEqual(await chainOf(data.id), ["Line Manager: Hamza Malik", "Finance"]);
    });

    test("a HOD's own request goes to Management, then Finance", async () => {
      const { data } = await submit("hamza");
      assert.deepEqual(await chainOf(data.id), ["Management", "Finance"]);
    });

    test("someone with no manager goes to Finance directly (Management is skipped: they are the only Management user)", async () => {
      const { data } = await submit("ceo");
      assert.deepEqual(await chainOf(data.id), ["Finance"]);
    });

    test("the Management threshold is off by default", async () => {
      const { data } = await submit("omar", { estimatedCost: 5_000_000 });
      assert.equal((await chainOf(data.id)).includes("Management"), false);
    });

    test("cost exactly at the threshold does not add a Management step", async () => {
      await setSetting("training.managementApprovalAbove", "100000");
      const { data } = await submit("omar", { estimatedCost: 100_000 });
      assert.deepEqual(await chainOf(data.id), ["Line Manager: Zara Khan", "Head of Department: Hamza Malik", "Finance"]);
    });

    test("cost just above the threshold adds a Management step before Finance", async () => {
      await setSetting("training.managementApprovalAbove", "100000");
      const { data } = await submit("omar", { estimatedCost: 100_000.01 });
      assert.deepEqual(await chainOf(data.id), ["Line Manager: Zara Khan", "Head of Department: Hamza Malik", "Management", "Finance"]);
      await setSetting("training.managementApprovalAbove", "");
    });

    test("Management stands in for Finance when the sole Finance user already approved an earlier step", async () => {
      // Bilal (Finance) is also this employee's Line Manager and the Finance department's HOD, so he
      // approves step 1 alone (the duplicate HOD step is skipped) and cannot also act as Finance.
      const sub = await prisma.employee.create({
        data: {
          code: "EHB-2024-100", email: "sub@test.local", fullName: "Nida Khan", passwordHash: await bcrypt.hash(PASSWORD, 4),
          mustChangePassword: false, joiningDate: toDate("2024-01-01"), departmentId: (await prisma.department.findFirstOrThrow({ where: { name: "Finance" } })).id,
          managerId: id.fin, roles: ["EMPLOYEE"],
        },
      });
      const subToken = await api.login("sub@test.local");
      const created = await api.call(subToken, "POST", "/requests/training", fields() as never);
      assert.equal(created.status, 201, created.data.message);
      assert.deepEqual(await chainOf(created.data.id), ["Line Manager: Bilal Ahmed", "Management (in place of Finance)"]);
    });
  });

  describe("validation", () => {
    test("end date before start date is rejected", async () => {
      const { status, data } = await submit("ali", { startDate: inDays(10), endDate: inDays(5) });
      assert.equal(status, 400);
      assert.match(data.message, /end date cannot be before the start date/);
    });

    test("start date in the past is rejected", async () => {
      const { status, data } = await submit("ali", { startDate: inDays(-1), endDate: inDays(2) });
      assert.equal(status, 400);
      assert.match(data.message, /start date cannot be in the past/);
    });

    test("estimated cost must be greater than zero", async () => {
      const { status, data } = await submit("ali", { estimatedCost: 0 });
      assert.equal(status, 400);
      assert.match(data.message, /estimated cost must be more than 0/);
    });

    test("location is required for an on-site programme", async () => {
      const { status, data } = await submit("ali", { mode: "ON_SITE", location: "" });
      assert.equal(status, 400);
      assert.match(data.message, /Give the location for an on-site programme/);
    });

    test("an on-site programme with a location is accepted", async () => {
      const { status, data } = await submit("ali", { mode: "ON_SITE", location: "Karachi" });
      assert.equal(status, 201, data.message);
      const d = await detail(data.id);
      assert.equal(d.training.location, "Karachi");
    });

    test("an online programme does not keep a location", async () => {
      const { data } = await submit("ali", { mode: "ONLINE", location: "ignored" });
      const d = await detail(data.id);
      assert.equal(d.training.location, null);
    });
  });

  describe("workflow", () => {
    test("returned, edited and resubmitted; the chain restarts", async () => {
      const { data } = await submit("omar");
      await api.call(token.zara!, "POST", `/requests/${data.id}/return`, { comment: "Please add a quotation" });
      assert.equal((await detail(data.id, "omar")).status, "RETURNED");
      const resub = await resubmit("omar", data.id, { programmeTitle: "Advanced React Workshop (revised)" });
      assert.equal(resub.status, 200, resub.data.message);
      const d = await detail(data.id, "omar");
      assert.equal(d.status, "PENDING");
      assert.equal(d.training.programmeTitle, "Advanced React Workshop (revised)");
      assert.deepEqual(await chainOf(data.id), ["Line Manager: Zara Khan", "Head of Department: Hamza Malik", "Finance"]);
    });

    test("rejected with a reason", async () => {
      const { data } = await submit("omar");
      await approve("zara", data.id);
      const rejected = await api.call(token.hamza!, "POST", `/requests/${data.id}/reject`, { comment: "Not in this quarter's budget" });
      assert.equal(rejected.status, 200, rejected.data.message);
      assert.equal((await detail(data.id, "omar")).status, "REJECTED");
    });

    test("withdrawn (cancelled) by the employee while pending", async () => {
      const { data } = await submit("omar");
      const cancelled = await api.call(token.omar!, "POST", `/requests/${data.id}/cancel`, {});
      assert.equal(cancelled.status, 200, cancelled.data.message);
      assert.equal((await detail(data.id, "omar")).status, "CANCELLED");
    });

    test("full chain approval: Line Manager, HOD, then Finance", async () => {
      const { data } = await submit("omar");
      await approve("zara", data.id);
      await approve("hamza", data.id);
      const fin = await approve("fin", data.id);
      assert.equal(fin.status, 200, fin.data.message);
      assert.equal((await detail(data.id, "omar")).status, "APPROVED");
    });

    test("emails are sent at submission and at every step", async () => {
      const { data } = await submit("omar");
      await waitForEmails((sent) => sentTo("omar@test.local", "Submitted").length > 0 && sentTo("zara@test.local", "Approval needed").length > 0);
      await approve("zara", data.id);
      await waitForEmails((sent) => sentTo("omar@test.local", "Approved by Line Manager").length > 0 && sentTo("hamza@test.local", "Approval needed").length > 0);
      await approve("hamza", data.id);
      await waitForEmails((sent) => sentTo("omar@test.local", "Approved by Head of Department").length > 0 && sentTo("fin@test.local", "Approval needed").length > 0);
      await approve("fin", data.id);
      await waitForEmails((sent) => sentTo("omar@test.local", "Approved:").length > 0);
    });
  });

  describe("access", () => {
    test("another employee with no part in the request gets 403", async () => {
      const { data } = await submit("omar");
      const asOther = await api.call(token.ali!, "GET", `/requests/${data.id}`);
      assert.equal(asOther.status, 403);
      assert.match(asOther.data.message, /do not have access/);
    });

    test("the requester, the approvers and Finance can all open it", async () => {
      const { data } = await submit("omar");
      for (const who of ["omar", "zara", "hamza", "fin", "ceo"]) {
        const res = await api.call(token[who]!, "GET", `/requests/${data.id}`);
        assert.equal(res.status, 200, `${who} should be able to open the request`);
      }
    });
  });
});
