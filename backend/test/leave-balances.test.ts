import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.js";
import { toDate, todayYmd } from "../src/lib/dates.js";
import { CARRY_FORWARD_CRON, startQueue, stopQueue } from "../src/jobs/queue.js";
import { carryForward, ensureBalance, entitlementFor, yearEndCarryForward } from "../src/services/leave.js";
import { resetDatabase, seedPeople, startServer, useMemoryTransport } from "./helpers.js";
import type { LeaveType } from "../src/generated/prisma/client.js";

const YEAR = Number(todayYmd().slice(0, 4));
const leaveType = (over: Partial<Record<keyof LeaveType, unknown>> = {}) =>
  ({ annualQuota: 14, proRata: true, ...over }) as unknown as LeaveType;

describe("pro-rata entitlement for new joiners", () => {
  test("joined in an earlier year: full quota", () => {
    assert.equal(entitlementFor(leaveType(), toDate("2025-09-15"), 2026), 14);
  });
  test("joined in January: full quota", () => {
    assert.equal(entitlementFor(leaveType(), toDate("2026-01-20"), 2026), 14);
  });
  test("joined mid-April: 9 of 12 months, rounded to half a day (14 × 9/12 = 10.5)", () => {
    assert.equal(entitlementFor(leaveType(), toDate("2026-04-15"), 2026), 10.5);
  });
  test("joined in July: half the quota", () => {
    assert.equal(entitlementFor(leaveType(), toDate("2026-07-01"), 2026), 7);
    assert.equal(entitlementFor(leaveType({ annualQuota: 10 }), toDate("2026-07-01"), 2026), 5);
  });
  test("joined in December: one month (14/12 = 1.17, rounded to 1)", () => {
    assert.equal(entitlementFor(leaveType(), toDate("2026-12-01"), 2026), 1);
  });
  test("joins next year: nothing this year", () => {
    assert.equal(entitlementFor(leaveType(), toDate("2027-02-01"), 2026), 0);
  });
  test("leave types without pro-rata give the full quota", () => {
    assert.equal(entitlementFor(leaveType({ proRata: false, annualQuota: 180 }), toDate("2026-10-01"), 2026), 180);
  });
  test("leave types without a quota (leave without pay) give 0", () => {
    assert.equal(entitlementFor(leaveType({ annualQuota: null }), toDate("2026-01-01"), 2026), 0);
  });
});

describe("annual leave carry forward (max 14 days)", () => {
  let people: Awaited<ReturnType<typeof seedPeople>>;
  let annual: LeaveType;
  const FROM = 2025;

  /** Sets an employee's balance for a type and year. */
  const setBalance = async (employeeId: number, type: LeaveType, year: number, values: { entitled: number; carriedForward?: number; used: number }) => {
    const b = await ensureBalance(prisma, employeeId, type, year);
    await prisma.leaveBalance.update({ where: { id: b.id }, data: values });
  };
  const carried = async (employeeId: number, type: LeaveType, year: number) =>
    Number((await prisma.leaveBalance.findUniqueOrThrow({ where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId: type.id, year } } })).carriedForward);

  before(async () => {
    await resetDatabase();
    people = await seedPeople();
    annual = await prisma.leaveType.create({ data: { code: "AL", name: "Annual Leave", annualQuota: 14, carryForwardMax: 14 } });
  });

  test("unused days carry over, capped at 14", async () => {
    await setBalance(people.employee.id, annual, FROM, { entitled: 14, carriedForward: 10, used: 2 }); // 22 unused
    await setBalance(people.manager.id, annual, FROM, { entitled: 14, used: 10 }); // 4 unused
    await setBalance(people.hr.id, annual, FROM, { entitled: 14, used: 16 }); // overdrawn
    await carryForward(FROM);
    assert.equal(await carried(people.employee.id, annual, FROM + 1), 14, "capped at 14");
    assert.equal(await carried(people.manager.id, annual, FROM + 1), 4);
    assert.equal(await carried(people.hr.id, annual, FROM + 1), 0, "never negative");
  });

  test("running it again gives the same result", async () => {
    await carryForward(FROM);
    await carryForward(FROM);
    assert.equal(await carried(people.employee.id, annual, FROM + 1), 14);
    assert.equal(await carried(people.manager.id, annual, FROM + 1), 4);
  });

  test("re-running after a late correction picks up the new figure", async () => {
    await setBalance(people.manager.id, annual, FROM, { entitled: 14, used: 12 });
    await carryForward(FROM);
    assert.equal(await carried(people.manager.id, annual, FROM + 1), 2);
  });

  test("leave types without a carry-forward max do not carry over", async () => {
    await setBalance(people.employee.id, people.casual, FROM, { entitled: 10, used: 0 });
    await carryForward(FROM);
    const next = await prisma.leaveBalance.findUnique({
      where: { employeeId_leaveTypeId_year: { employeeId: people.employee.id, leaveTypeId: people.casual.id, year: FROM + 1 } },
    });
    assert.equal(next ? Number(next.carriedForward) : 0, 0);
  });

  test("inactive employees are not carried over", async () => {
    await prisma.employee.update({ where: { id: people.hr.id }, data: { status: "INACTIVE" } });
    await setBalance(people.hr.id, annual, FROM, { entitled: 14, used: 4 });
    await prisma.leaveBalance.updateMany({ where: { employeeId: people.hr.id, year: FROM + 1 }, data: { carriedForward: 0 } });
    await carryForward(FROM);
    assert.equal(await carried(people.hr.id, annual, FROM + 1), 0);
    await prisma.employee.update({ where: { id: people.hr.id }, data: { status: "ACTIVE" } });
  });

  test("the 1 January job carries the year that just ended, in Pakistan time, and is audited", async () => {
    await setBalance(people.manager.id, annual, 2026, { entitled: 14, carriedForward: 0, used: 5 });
    // 00:05 on 1 Jan 2027 in Pakistan is still 31 Dec 2026 in UTC
    const result = await yearEndCarryForward(new Date("2027-01-01T00:05:00+05:00"));
    assert.equal(result.fromYear, 2026);
    assert.equal(await carried(people.manager.id, annual, 2027), 9);
    const log = await prisma.auditLog.findFirst({ where: { action: "CARRY_FORWARD" }, orderBy: { id: "desc" } });
    assert.deepEqual(log?.details, { fromYear: 2026, updated: result.updated, automatic: true });
    assert.equal(log?.actorId, null, "recorded as done by the system");
  });

  test("the job is scheduled on the queue for 00:05 on 1 January, Pakistan time, and catches up if missed", async () => {
    await startQueue({ pollingIntervalSeconds: 0.5 });
    try {
      const [row] = await prisma.$queryRaw<{ cron: string; timezone: string; options: { missed?: string } }[]>`
        select cron, timezone, options from pgboss.schedule where name = 'leave-carry-forward'`;
      assert.equal(row?.cron, CARRY_FORWARD_CRON);
      assert.equal(CARRY_FORWARD_CRON, "5 0 1 1 *");
      assert.equal(row?.timezone, "Asia/Karachi");
      assert.equal(row?.options?.missed, "once", "runs once on start-up if the server was down at midnight");
    } finally {
      await stopQueue();
    }
  });
});

describe("balances recalculate when HR changes a joining date or a quota", () => {
  let api: Awaited<ReturnType<typeof startServer>>;
  let people: Awaited<ReturnType<typeof seedPeople>>;
  let annual: LeaveType;
  let hrToken: string;

  const balance = async (employeeId: number, type: LeaveType, year = YEAR) =>
    prisma.leaveBalance.findUniqueOrThrow({ where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId: type.id, year } } });
  const entitled = async (employeeId: number, type: LeaveType, year = YEAR) => Number((await balance(employeeId, type, year)).entitled);

  before(async () => {
    await resetDatabase();
    people = await seedPeople();
    annual = await prisma.leaveType.create({ data: { code: "AL", name: "Annual Leave", annualQuota: 14, carryForwardMax: 14 } });
    useMemoryTransport();
    api = await startServer();
    hrToken = await api.login("hr@test.local");
    // Balances for this year exist (everyone joined in 2024: full quota), plus a closed past year.
    for (const e of [people.employee, people.manager, people.hr]) {
      await ensureBalance(prisma, e.id, annual, YEAR);
      await ensureBalance(prisma, e.id, people.casual, YEAR);
    }
    await ensureBalance(prisma, people.employee.id, annual, YEAR - 1);
  });

  after(async () => {
    await api.close();
  });

  test("a later joining date re-pro-rates this year's entitlement", async () => {
    assert.equal(await entitled(people.employee.id, annual), 14);
    const res = await api.call(hrToken, "PATCH", `/employees/${people.employee.id}`, { joiningDate: `${YEAR}-07-01` });
    assert.equal(res.status, 200);
    assert.deepEqual(res.data.leaveRecalculated, { updated: 2, keptManual: 0 });
    assert.equal(await entitled(people.employee.id, annual), 7);
    assert.equal(await entitled(people.employee.id, people.casual), 5);
  });

  test("past years are not rewritten", async () => {
    assert.equal(await entitled(people.employee.id, annual, YEAR - 1), 14);
  });

  test("other HR edits do not trigger a recalculation", async () => {
    const res = await api.call(hrToken, "PATCH", `/employees/${people.employee.id}`, { designation: "Senior Engineer" });
    assert.equal(res.data.leaveRecalculated, null);
  });

  test("a balance HR adjusted by hand is kept", async () => {
    const b = await balance(people.manager.id, annual);
    const adj = await api.call(hrToken, "PATCH", `/leave/balances/${b.id}`, { entitled: 20, reason: "Long-service award" });
    assert.equal(adj.data.entitledManual, true);
    const res = await api.call(hrToken, "PATCH", `/employees/${people.manager.id}`, { joiningDate: `${YEAR}-07-01` });
    assert.deepEqual(res.data.leaveRecalculated, { updated: 1, keptManual: 1 });
    assert.equal(await entitled(people.manager.id, annual), 20, "hand-set value kept");
    assert.equal(await entitled(people.manager.id, people.casual), 5, "other types still recalculated");
  });

  test("HR can switch a hand-adjusted balance back to automatic", async () => {
    const b = await balance(people.manager.id, annual);
    const res = await api.call(hrToken, "PATCH", `/leave/balances/${b.id}`, { automatic: true, reason: "Award ended" });
    assert.equal(res.data.entitledManual, false);
    assert.equal(res.data.entitled, 7, "back to the pro-rated figure for a July joiner");
  });

  test("a quota change recalculates everyone's balance for that type, pro-rated where needed", async () => {
    const res = await api.call(hrToken, "PUT", `/leave/types/${annual.id}`, { annualQuota: 16 });
    assert.equal(res.status, 200);
    assert.equal(res.data.recalculated.updated, 3);
    assert.equal(await entitled(people.hr.id, annual), 16, "full-year employee");
    assert.equal(await entitled(people.employee.id, annual), 8, "July joiner: 16 × 6/12");
    assert.equal(await entitled(people.employee.id, annual, YEAR - 1), 14, "past year unchanged");
  });

  test("turning pro-rata off gives new joiners the full quota", async () => {
    await api.call(hrToken, "PUT", `/leave/types/${annual.id}`, { proRata: false });
    assert.equal(await entitled(people.employee.id, annual), 16);
  });

  test("changes that do not affect entitlement do not recalculate", async () => {
    const res = await api.call(hrToken, "PUT", `/leave/types/${annual.id}`, { noticeDays: 5 });
    assert.equal(res.data.recalculated, null);
  });

  test("the manual carry-forward button still works for HR only", async () => {
    assert.equal((await api.call(hrToken, "POST", "/leave/carry-forward", { fromYear: String(YEAR - 1) })).status, 200);
    const empToken = await api.login("employee@test.local");
    assert.equal((await api.call(empToken, "POST", "/leave/carry-forward", { fromYear: String(YEAR - 1) })).status, 403);
  });
});
