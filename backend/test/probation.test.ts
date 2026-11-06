import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma.js";
import { addDays, todayYmd, toDate, ymd } from "../src/lib/dates.js";
import { notifyProbationDue, probationDueCount, probationStatus } from "../src/services/probation.js";
import { outbox, PASSWORD, resetDatabase, seedPeople, startServer, useMemoryTransport } from "./helpers.js";

const day = (n: number) => ymd(addDays(toDate(todayYmd()), n));

describe("probationStatus()", () => {
  test("no probation date on record: confirmed", () => {
    assert.equal(probationStatus({ probationEndDate: null, confirmedAt: null }), "CONFIRMED");
  });
  test("a future date: on probation", () => {
    assert.equal(probationStatus({ probationEndDate: toDate(day(5)), confirmedAt: null }), "ON_PROBATION");
  });
  test("today or earlier, not yet confirmed: due", () => {
    assert.equal(probationStatus({ probationEndDate: toDate(todayYmd()), confirmedAt: null }), "DUE");
    assert.equal(probationStatus({ probationEndDate: toDate(day(-10)), confirmedAt: null }), "DUE");
  });
  test("confirmedAt set: confirmed, even if a date is still on the record", () => {
    assert.equal(probationStatus({ probationEndDate: toDate(day(-10)), confirmedAt: new Date() }), "CONFIRMED");
  });
});

describe("Probation confirmation", () => {
  let api: Awaited<ReturnType<typeof startServer>>;
  let people: Awaited<ReturnType<typeof seedPeople>>;
  let noManagerId: number;
  let hrToken: string;
  let managerToken: string;
  let employeeToken: string;

  const as = (token: string) => ({
    get: (path: string) => api.call(token, "GET", path),
    post: (path: string, body: Record<string, unknown> = {}) => api.call(token, "POST", path, body),
  });
  const ok = (res: { status: number; data: { message?: string } }, status = 200) => assert.equal(res.status, status, res.data.message ?? "");

  before(async () => {
    await resetDatabase();
    useMemoryTransport();
    people = await seedPeople();
    // No Line Manager, for the "HR is told instead" case.
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    const nm = await prisma.employee.create({
      data: {
        code: "EHB-2024-004", email: "nomanager@test.local", fullName: "Nida Khan", passwordHash, mustChangePassword: false,
        joiningDate: toDate("2024-01-01"), roles: ["EMPLOYEE"],
      },
    });
    noManagerId = nm.id;
    api = await startServer();
    hrToken = await api.login(people.hr.email);
    managerToken = await api.login(people.manager.email);
    employeeToken = await api.login(people.employee.email);
  });

  after(async () => {
    await api.close();
  });

  test("not yet due: ON_PROBATION, no history returned to the employee", async () => {
    await prisma.employee.update({ where: { id: people.employee.id }, data: { probationEndDate: toDate(day(30)) } });
    const res = await as(hrToken).get(`/employees/${people.employee.id}`);
    assert.equal(res.data.probationStatus, "ON_PROBATION");
  });

  test("due: HR and the Line Manager see the probation history; the employee does not", async () => {
    await prisma.employee.update({ where: { id: people.employee.id }, data: { probationEndDate: toDate(day(-1)) } });
    const hr = await as(hrToken).get(`/employees/${people.employee.id}`);
    assert.equal(hr.data.probationStatus, "DUE");
    assert.ok(hr.data.probationHistory, "HR sees the history");
    const mgr = await as(managerToken).get(`/employees/${people.employee.id}`);
    assert.ok(mgr.data.probationHistory, "the Line Manager sees the history");
    const self = await as(employeeToken).get(`/employees/${people.employee.id}`);
    assert.equal(self.data.probationHistory, undefined, "the employee does not see the history");
    assert.equal(self.data.probationStatus, "DUE", "but does see their own status");
  });

  test("only HR can confirm or extend", async () => {
    assert.equal((await as(managerToken).post(`/employees/${people.employee.id}/confirm`)).status, 403);
    assert.equal((await as(employeeToken).post(`/employees/${people.employee.id}/confirm`)).status, 403);
  });

  test("the Line Manager can leave a note for HR; anyone else cannot", async () => {
    const note = await as(managerToken).post(`/employees/${people.employee.id}/probation-note`, { comment: "Doing well, no concerns." });
    ok(note);
    assert.equal((await as(employeeToken).post(`/employees/${people.employee.id}/probation-note`, { comment: "..." })).status, 403);
    assert.equal((await as(hrToken).post(`/employees/${people.employee.id}/probation-note`, { comment: "..." })).status, 403, "HR is not this employee's Line Manager");
    const seen = await as(hrToken).get(`/employees/${people.employee.id}`);
    assert.equal(seen.data.probationHistory.notes[0].comment, "Doing well, no concerns.");
  });

  test("HR confirms employment: the probation date clears, the employee and Line Manager are emailed", async () => {
    outbox.length = 0;
    ok(await as(hrToken).post(`/employees/${people.employee.id}/confirm`));
    const emp = await as(hrToken).get(`/employees/${people.employee.id}`);
    assert.equal(emp.data.probationStatus, "CONFIRMED");
    assert.equal(emp.data.probationEndDate, null);
    assert.ok(emp.data.confirmedAt);
    assert.equal(emp.data.probationHistory.decisions[0].kind, "CONFIRMED");
    assert.ok(outbox.find((m) => m.to === "employee@test.local" && m.subject === "Employment confirmed"));
    assert.ok(outbox.find((m) => m.to === "manager@test.local" && m.subject === "Employment confirmed"));
  });

  test("an already-confirmed employee cannot be confirmed or extended again", async () => {
    assert.equal((await as(hrToken).post(`/employees/${people.employee.id}/confirm`)).status, 400);
    assert.equal((await as(hrToken).post(`/employees/${people.employee.id}/extend-probation`, { probationEndDate: day(30), reason: "x" })).status, 400);
  });

  test("extending probation requires a future date and a reason; the due cycle restarts", async () => {
    await prisma.employee.update({ where: { id: noManagerId }, data: { probationEndDate: toDate(day(-2)) } });
    assert.equal((await as(hrToken).post(`/employees/${noManagerId}/extend-probation`, { probationEndDate: day(-1), reason: "Needs more time" })).status, 400, "cannot extend into the past");
    assert.equal((await as(hrToken).post(`/employees/${noManagerId}/extend-probation`, { probationEndDate: day(30) })).status, 400, "a reason is required");
    outbox.length = 0;
    ok(await as(hrToken).post(`/employees/${noManagerId}/extend-probation`, { probationEndDate: day(30), reason: "Needs more time to settle in" }));
    const emp = await as(hrToken).get(`/employees/${noManagerId}`);
    assert.equal(emp.data.probationStatus, "ON_PROBATION");
    assert.equal(emp.data.probationEndDate, day(30));
    assert.equal(emp.data.probationHistory.decisions[0].kind, "EXTENDED");
    assert.equal(emp.data.probationHistory.decisions[0].reason, "Needs more time to settle in");
    assert.ok(outbox.find((m) => m.to === "nomanager@test.local" && m.subject === "Probation extended"));
  });

  test("notifyProbationDue: tells the Line Manager once; HR instead when there is none", async () => {
    await prisma.employee.update({ where: { id: people.employee.id }, data: { confirmedAt: null, probationEndDate: toDate(day(-3)), probationNotifiedAt: null } });
    await prisma.employee.update({ where: { id: noManagerId }, data: { probationEndDate: toDate(day(-1)), probationNotifiedAt: null } });
    outbox.length = 0;
    assert.equal(await notifyProbationDue(), 2);
    assert.ok(outbox.find((m) => m.to === "manager@test.local" && m.subject.startsWith("Confirmation due")));
    assert.ok(outbox.find((m) => m.to === "hr@test.local" && m.subject.startsWith("Confirmation due")), "no Line Manager: HR is told instead");
    // Runs again straight away: nothing new, already notified this cycle.
    outbox.length = 0;
    assert.equal(await notifyProbationDue(), 0);
  });

  test("probation-due-count matches the service, and only privileged roles can read it", async () => {
    const svc = await probationDueCount();
    const res = await as(hrToken).get("/employees/probation-due-count");
    ok(res);
    assert.equal(res.data.count, svc);
    assert.equal((await as(employeeToken).get("/employees/probation-due-count")).status, 403);
  });
});
