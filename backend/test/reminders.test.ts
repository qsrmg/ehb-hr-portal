import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.js";
import { toDate } from "../src/lib/dates.js";
import { startQueue, stopQueue } from "../src/jobs/queue.js";
import { inOfficeHours, sendDueReminders } from "../src/jobs/reminders.js";
import { futureWorkday, outbox, resetDatabase, seedPeople, sentTo, startServer, useMemoryTransport, waitForEmails } from "./helpers.js";

/** A moment in Pakistan time (UTC+5), e.g. pkt("2026-11-16", "09:05"). */
const pkt = (date: string, time: string) => new Date(`${date}T${time}:00+05:00`);
const noHolidays = () => false;

// 13 Nov 2026 is a Friday, 14–15 the weekend, 16 Monday, 17 Tuesday.
describe("office hours (9:00–18:00, Monday–Friday, Pakistan time)", () => {
  test("weekday office hours", () => {
    assert.equal(inOfficeHours(pkt("2026-11-16", "09:00"), "09:00", "18:00", noHolidays), true);
    assert.equal(inOfficeHours(pkt("2026-11-16", "17:59"), "09:00", "18:00", noHolidays), true);
    assert.equal(inOfficeHours(pkt("2026-11-13", "12:00"), "09:00", "18:00", noHolidays), true, "Friday");
  });
  test("before 9, from 18:00, and weekends are outside", () => {
    assert.equal(inOfficeHours(pkt("2026-11-16", "08:59"), "09:00", "18:00", noHolidays), false);
    assert.equal(inOfficeHours(pkt("2026-11-16", "18:00"), "09:00", "18:00", noHolidays), false);
    assert.equal(inOfficeHours(pkt("2026-11-14", "11:00"), "09:00", "18:00", noHolidays), false, "Saturday");
    assert.equal(inOfficeHours(pkt("2026-11-15", "11:00"), "09:00", "18:00", noHolidays), false, "Sunday");
  });
  test("uses Pakistan time, not the server clock", () => {
    // 04:30 UTC is 09:30 in Pakistan
    assert.equal(inOfficeHours(new Date("2026-11-16T04:30:00Z"), "09:00", "18:00", noHolidays), true);
    assert.equal(inOfficeHours(new Date("2026-11-16T03:30:00Z"), "09:00", "18:00", noHolidays), false);
  });
  test("public holidays are outside office hours", () => {
    assert.equal(inOfficeHours(pkt("2026-11-17", "10:00"), "09:00", "18:00", (d) => d === "2026-11-17"), false);
  });
});

describe("3-hourly reminders to the current approver", () => {
  let api: Awaited<ReturnType<typeof startServer>>;
  let requestId: number;

  before(async () => {
    await resetDatabase();
    const people = await seedPeople();
    await prisma.holiday.create({ data: { date: toDate("2026-11-17"), name: "Test holiday" } });
    useMemoryTransport();
    await startQueue({ retryDelaySeconds: 1, pollingIntervalSeconds: 0.5, schedules: false });
    api = await startServer();
    const token = await api.login("employee@test.local");
    const date = futureWorkday(3);
    const res = await api.call(token, "POST", "/requests/leave", { leaveTypeId: String(people.casual.id), startDate: date, endDate: date, reason: "Appointment" });
    requestId = res.data.id;
    // The step has been waiting since Friday 16:00.
    await prisma.requestStep.updateMany({ where: { requestId, status: "PENDING" }, data: { pendingSince: pkt("2026-11-13", "16:00"), lastReminderAt: null } });
    await waitForEmails((o) => o.length >= 2); // submission emails
  });

  after(async () => {
    await api.close();
    await stopQueue();
  });

  beforeEach(() => {
    outbox.length = 0;
  });

  const step = () => prisma.requestStep.findFirstOrThrow({ where: { requestId, status: "PENDING" } });

  test("not sent before 3 hours have passed", async () => {
    assert.equal(await sendDueReminders(pkt("2026-11-13", "17:30")), 0);
  });

  test("not sent after office hours, even when due", async () => {
    assert.equal(await sendDueReminders(pkt("2026-11-13", "19:30")), 0);
    assert.equal(await sendDueReminders(pkt("2026-11-13", "18:00")), 0);
  });

  test("not sent at the weekend", async () => {
    assert.equal(await sendDueReminders(pkt("2026-11-14", "11:00")), 0);
    assert.equal(await sendDueReminders(pkt("2026-11-15", "11:00")), 0);
  });

  test("sent on Monday morning to the line manager, by email", async () => {
    assert.equal(await sendDueReminders(pkt("2026-11-16", "09:05")), 1);
    await waitForEmails(() => sentTo("manager@test.local", "Reminder:").length === 1);
    assert.equal(sentTo("employee@test.local", "").length, 0, "the employee is not reminded");
    assert.deepEqual((await step()).lastReminderAt, pkt("2026-11-16", "09:05"));
  });

  test("not repeated within 3 hours of the last reminder", async () => {
    assert.equal(await sendDueReminders(pkt("2026-11-16", "11:00")), 0);
    assert.equal(await sendDueReminders(pkt("2026-11-16", "12:04")), 0);
  });

  test("repeated once 3 hours have passed", async () => {
    assert.equal(await sendDueReminders(pkt("2026-11-16", "12:05")), 1);
    await waitForEmails(() => sentTo("manager@test.local", "Reminder:").length === 1);
  });

  test("not sent on a public holiday", async () => {
    assert.equal(await sendDueReminders(pkt("2026-11-17", "10:00")), 0);
  });

  test("the interval is an HR setting", async () => {
    await prisma.setting.create({ data: { key: "reminders.intervalHours", value: "1" } });
    try {
      // last reminder was Monday 12:05; with a 1-hour interval Monday 13:10 is due
      assert.equal(await sendDueReminders(pkt("2026-11-16", "13:10")), 1);
    } finally {
      await prisma.setting.delete({ where: { key: "reminders.intervalHours" } });
    }
  });

  test("stops once the request is no longer pending", async () => {
    await prisma.request.update({ where: { id: requestId }, data: { status: "APPROVED" } });
    assert.equal(await sendDueReminders(pkt("2026-11-18", "16:00")), 0);
  });
});
