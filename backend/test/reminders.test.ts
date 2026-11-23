import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma.js";
import { toDate } from "../src/lib/dates.js";
import { startQueue, stopQueue } from "../src/jobs/queue.js";
import { inOfficeHours, sendDueExitClearanceReminders, sendDueReminders } from "../src/jobs/reminders.js";
import { createExitCase } from "../src/services/exits.js";
import { futureWorkday, outbox, PASSWORD, resetDatabase, seedPeople, sentTo, startServer, useMemoryTransport, waitForEmails } from "./helpers.js";

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

describe("exit clearance reminders (reuses the same office-hours gate and interval)", () => {
  let api: Awaited<ReturnType<typeof startServer>>;
  let caseId: number;

  before(async () => {
    await resetDatabase();
    const people = await seedPeople();
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    const dept = await prisma.department.create({ data: { name: "Admin & Finance" } });
    await prisma.employee.create({
      data: { code: "EHB-2024-010", email: "admin@test.local", fullName: "Usman Tariq", roles: ["EMPLOYEE", "ADMIN"], passwordHash, mustChangePassword: false, joiningDate: toDate("2024-01-01"), departmentId: dept.id },
    });
    useMemoryTransport();
    await startQueue({ retryDelaySeconds: 1, pollingIntervalSeconds: 0.5, schedules: false });
    api = await startServer();
    const created = await prisma.$transaction((tx) =>
      createExitCase(tx, {
        employeeId: people.employee.id, type: "OTHER", reason: "Redundancy", startedById: people.hr.id,
        noticeGivenOn: toDate("2026-11-01"), noticeDays: 0, noticeEndDate: null, lastWorkingDay: toDate("2026-12-01"),
        shortfallDays: 0, shortfallWaived: false,
      }),
    );
    caseId = created.id;
    // The three parallel cards have been waiting since Friday 16:00, exactly like the approval-reminder fixture above.
    await prisma.exitClearance.updateMany({ where: { caseId, area: { in: ["IT_ADMIN", "LINE_MANAGER", "HR"] } }, data: { pendingSince: pkt("2026-11-13", "16:00"), lastReminderAt: null } });
    outbox.length = 0;
  });

  after(async () => {
    await api.close();
    await stopQueue();
  });

  beforeEach(() => {
    outbox.length = 0;
  });

  test("not sent before 3 hours have passed", async () => {
    assert.equal(await sendDueExitClearanceReminders(pkt("2026-11-13", "17:30")), 0);
  });

  test("not sent after office hours, even when due", async () => {
    assert.equal(await sendDueExitClearanceReminders(pkt("2026-11-13", "19:30")), 0);
    assert.equal(await sendDueExitClearanceReminders(pkt("2026-11-13", "18:00")), 0);
  });

  test("not sent at the weekend", async () => {
    assert.equal(await sendDueExitClearanceReminders(pkt("2026-11-14", "11:00")), 0);
    assert.equal(await sendDueExitClearanceReminders(pkt("2026-11-15", "11:00")), 0);
  });

  test("sent on Monday morning: one reminder per card, to each card's owner", async () => {
    assert.equal(await sendDueExitClearanceReminders(pkt("2026-11-16", "09:05")), 3);
    await waitForEmails(() => sentTo("admin@test.local", "Reminder:").length === 1 && sentTo("manager@test.local", "Reminder:").length === 1 && sentTo("hr@test.local", "Reminder:").length === 1);
    assert.equal(sentTo("employee@test.local", "Reminder:").length, 0, "the leaver is never reminded about their own clearance");
  });

  test("not repeated within 3 hours of the last reminder (no duplicates)", async () => {
    assert.equal(await sendDueExitClearanceReminders(pkt("2026-11-16", "11:00")), 0);
    assert.equal(await sendDueExitClearanceReminders(pkt("2026-11-16", "12:04")), 0);
  });

  test("repeated once 3 hours have passed", async () => {
    assert.equal(await sendDueExitClearanceReminders(pkt("2026-11-16", "12:05")), 3);
    await waitForEmails(() => sentTo("hr@test.local", "Reminder:").length === 1);
  });

  test("not sent on a public holiday", async () => {
    await prisma.holiday.create({ data: { date: toDate("2026-11-17"), name: "Test holiday" } });
    assert.equal(await sendDueExitClearanceReminders(pkt("2026-11-17", "10:00")), 0);
  });

  test("exit.sendEmails off: the in-app notification still lands, only the email is skipped", async () => {
    await prisma.setting.create({ data: { key: "exit.sendEmails", value: "0" } });
    try {
      const before = await prisma.notification.count({ where: { title: { startsWith: "Reminder:" } } });
      assert.equal(await sendDueExitClearanceReminders(pkt("2026-11-18", "09:05")), 3);
      const after = await prisma.notification.count({ where: { title: { startsWith: "Reminder:" } } });
      assert.equal(after - before, 3, "the in-app notification always lands");
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(sentTo("hr@test.local", "Reminder:").length, 0, "no email is queued while exit.sendEmails is off");
    } finally {
      await prisma.setting.delete({ where: { key: "exit.sendEmails" } });
    }
  });

  test("exit.sendEmails on (the default): the email is sent again", async () => {
    assert.equal(await sendDueExitClearanceReminders(pkt("2026-11-19", "09:05")), 3);
    await waitForEmails(() => sentTo("hr@test.local", "Reminder:").length === 1);
  });
});

describe("exit clearance reminders: the migration backfill does not cause a burst", () => {
  let api: Awaited<ReturnType<typeof startServer>>;
  let hrCardId: number;

  before(async () => {
    await resetDatabase();
    const people = await seedPeople();
    useMemoryTransport();
    await startQueue({ retryDelaySeconds: 1, pollingIntervalSeconds: 0.5, schedules: false });
    api = await startServer();
    const created = await prisma.$transaction((tx) =>
      createExitCase(tx, {
        employeeId: people.employee.id, type: "OTHER", reason: "Redundancy", startedById: people.hr.id,
        noticeGivenOn: toDate("2026-11-01"), noticeDays: 0, noticeEndDate: null, lastWorkingDay: toDate("2026-12-01"),
        shortfallDays: 0, shortfallWaived: false,
      }),
    );
    // Mimic exactly what migration 20261123060154_exit_checklist_and_reminders's backfill sets on an
    // already-open case: pendingSince far in the past (the case's own createdAt), lastReminderAt = "now"
    // (the moment the migration ran) — so the very first job run afterwards must not fire for this card.
    const hrCard = await prisma.exitClearance.findFirstOrThrow({ where: { caseId: created.id, area: "HR" } });
    hrCardId = hrCard.id;
    await prisma.exitClearance.update({ where: { id: hrCardId }, data: { pendingSince: pkt("2026-10-01", "09:00"), lastReminderAt: pkt("2026-11-13", "13:00") } });
    // The other two parallel cards are left far from due (just-created pendingSince) so they never interfere.
    await prisma.exitClearance.updateMany({ where: { caseId: created.id, area: { in: ["IT_ADMIN", "LINE_MANAGER"] } }, data: { pendingSince: pkt("2026-11-13", "13:55") } });
    outbox.length = 0;
  });

  after(async () => {
    await api.close();
    await stopQueue();
  });

  test("no reminder on the first run right after the backfill", async () => {
    assert.equal(await sendDueExitClearanceReminders(pkt("2026-11-13", "14:00")), 0);
    assert.equal((await prisma.exitClearance.findUniqueOrThrow({ where: { id: hrCardId } })).lastReminderAt?.toISOString(), pkt("2026-11-13", "13:00").toISOString());
  });

  test("the next reminder only goes out once reminders.intervalHours has passed", async () => {
    assert.equal(await sendDueExitClearanceReminders(pkt("2026-11-13", "16:01")), 1);
    await waitForEmails(() => sentTo("hr@test.local", "Reminder:").length === 1);
  });
});
