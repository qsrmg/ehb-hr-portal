import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma.js";
import { toDate, todayYmd } from "../src/lib/dates.js";
import { cleanupOldActivity, endPause, recordHeartbeat, startPause, trackabilityStatus } from "../src/services/activity.js";
import { PASSWORD, resetDatabase, startServer, useMemoryTransport } from "./helpers.js";

/**
 * Activity monitoring (keyboard/mouse presence time, never content). See DECISIONS.md and
 * backend/src/services/activity.ts for the design this proves.
 */
describe("Activity monitoring", () => {
  let api: Awaited<ReturnType<typeof startServer>>;
  const token: Record<string, string> = {};
  const id: Record<string, number> = {};

  const as = (who: string) => ({
    get: (path: string) => api.call(token[who]!, "GET", path),
    post: (path: string, body: Record<string, unknown> = {}) => api.call(token[who]!, "POST", path, body),
    delete: (path: string) => api.call(token[who]!, "DELETE", path),
  });
  const setSetting = (key: string, value: string) => prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  const auditRows = (entity: string, action?: string) => prisma.auditLog.findMany({ where: { entity, ...(action ? { action } : {}) }, orderBy: { createdAt: "desc" } });
  const minute = (date: Date) => ({ minuteStart: date.toISOString(), active: true });

  before(async () => {
    await resetDatabase();
    useMemoryTransport();
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    const mgmt = await prisma.department.create({ data: { name: "Management" } });
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
    await person("fin", "Bilal Ahmed", mgmt.id, ["FINANCE"], id.ceo!);
    await person("hamza", "Hamza Malik", eng.id, ["LINE_MANAGER", "HOD"], id.ceo!);
    await person("ali", "Ali Raza", eng.id, [], id.hamza!);
    await person("sara", "Sara Javed", eng.id, [], id.hamza!);

    // Office hours wide open so tests never depend on the real wall-clock time of day.
    await setSetting("office.start", "00:00");
    await setSetting("office.end", "23:59");

    api = await startServer();
    for (const key of Object.keys(id)) token[key] = await api.login(`${key}@test.local`);
  });

  after(async () => {
    await api.close();
  });

  test("off by default: status says not trackable, heartbeats are rejected, nothing is recorded", async () => {
    const status = (await as("ali").get("/activity/status")).data;
    assert.equal(status.enabled, false);
    assert.equal(status.trackable, false);
    const hb = await as("ali").post("/activity/heartbeat", { minutes: [minute(new Date())] });
    assert.equal(hb.status, 403);
    const me = (await as("ali").get("/activity/me")).data;
    assert.equal(me.today.trackedMinutes, 0);
  });

  test("turning the feature on does not track anyone until they acknowledge the policy", async () => {
    assert.equal((await api.call(token.hr!, "PUT", "/settings", { "activity.enabled": "1" })).status, 200);
    const status = (await as("ali").get("/activity/status")).data;
    assert.equal(status.enabled, true);
    assert.equal(status.acknowledged, false);
    assert.equal(status.trackable, false);
    const hb = await as("ali").post("/activity/heartbeat", { minutes: [minute(new Date())] });
    assert.equal(hb.status, 403);
  });

  test("after acknowledging, heartbeats are accepted; the payload carries only a timestamp and a boolean, nothing from the event itself", async (t) => {
    assert.equal((await as("ali").post("/activity/policy/acknowledge")).status, 200);
    // Freezes the server's clock (Date only — real timers still run) so this test never depends on the real
    // calendar date being a working day. 2026-11-10 is a Tuesday.
    t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-10T06:00:00.000Z").getTime() });
    const status = (await as("ali").get("/activity/status")).data;
    assert.equal(status.acknowledged, true);
    assert.equal(status.trackable, true);
    const now = new Date();
    // Extra fields a compromised or buggy client might add are accepted but never used or stored anywhere.
    const payload = { minuteStart: now.toISOString(), active: true, key: "Enter", clientX: 42, text: "secret" };
    const hb = await as("ali").post("/activity/heartbeat", { minutes: [payload] });
    assert.equal(hb.status, 200, JSON.stringify(hb.data));
    assert.equal(hb.data.accepted, 1);
    const day = await prisma.activityDailySummary.findFirst({ where: { employeeId: id.ali } });
    assert.equal(day?.trackedMinutes, 1);
    assert.equal(day?.activeMinutes, 1);
    // The schema itself has no column that could hold a key, a coordinate or page text.
    assert.deepEqual(Object.keys(day!).sort(), [
      "activeMinutes", "createdAt", "date", "employeeId", "firstActivityAt", "id", "idleMinutes",
      "lastActivityAt", "pausedMinutesUsed", "processedThroughAt", "trackedMinutes", "updatedAt",
    ].sort());
  });

  test("idle threshold: a short gap after activity still counts as active, a gap past the threshold counts as idle", async () => {
    await prisma.activityDailySummary.deleteMany({ where: { employeeId: id.ali } });
    await prisma.activityHeartbeatState.deleteMany({ where: { employeeId: id.ali } });
    await setSetting("activity.idleThresholdMinutes", "5");
    const base = new Date("2026-11-10T06:00:00.000Z"); // well within the office-hours window
    const now = new Date(base.getTime() + 10 * 60_000);
    const minutes = [
      { minuteStart: base.toISOString(), active: true }, // minute 0: raw activity
      { minuteStart: new Date(base.getTime() + 3 * 60_000).toISOString(), active: false }, // +3min: within 5min grace -> active
      { minuteStart: new Date(base.getTime() + 8 * 60_000).toISOString(), active: false }, // +8min: past 5min grace -> idle
    ];
    const result = await recordHeartbeat(id.ali!, minutes, now);
    assert.equal(result.accepted, 3);
    const day = await prisma.activityDailySummary.findFirst({ where: { employeeId: id.ali } });
    assert.equal(day?.trackedMinutes, 3);
    assert.equal(day?.activeMinutes, 2);
    assert.equal(day?.idleMinutes, 1);
  });

  test("a minute more than 24h old, and a minute in the future, are ignored rather than recorded or erroring out", async () => {
    await prisma.activityDailySummary.deleteMany({ where: { employeeId: id.ali } });
    await prisma.activityHeartbeatState.deleteMany({ where: { employeeId: id.ali } });
    const now = new Date("2026-11-17T06:00:00.000Z"); // Tuesday
    const minutes = [
      { minuteStart: new Date(now.getTime() - 25 * 3_600_000).toISOString(), active: true }, // 25h old
      { minuteStart: new Date(now.getTime() + 10 * 60_000).toISOString(), active: true }, // 10min in the future
      { minuteStart: new Date(now.getTime() - 60_000).toISOString(), active: true }, // valid
    ];
    const result = await recordHeartbeat(id.ali!, minutes, now);
    assert.equal(result.accepted, 1);
    assert.equal(result.ignored, 2);
  });

  test("a break window excludes its minutes from every count, but still advances the watermark", async () => {
    await prisma.activityDailySummary.deleteMany({ where: { employeeId: id.ali } });
    await prisma.activityHeartbeatState.deleteMany({ where: { employeeId: id.ali } });
    await setSetting("activity.breakWindows", "12:00-13:00");
    // 12:30 Asia/Karachi (UTC+5) = 07:30 UTC
    const breakMinute = new Date("2026-11-16T07:30:00.000Z");
    const now = new Date(breakMinute.getTime() + 60_000);
    const result = await recordHeartbeat(id.ali!, [{ minuteStart: breakMinute.toISOString(), active: true }], now);
    assert.equal(result.accepted, 1);
    const day = await prisma.activityDailySummary.findFirst({ where: { employeeId: id.ali, date: toDate("2026-11-16") } });
    assert.equal(day?.trackedMinutes, 0);
    assert.equal(day?.activeMinutes, 0);
    await setSetting("activity.breakWindows", "");
  });

  test("timezone: minutes either side of local midnight (Asia/Karachi) land in two different daily rows", async () => {
    await prisma.activityDailySummary.deleteMany({ where: { employeeId: id.ali } });
    await prisma.activityHeartbeatState.deleteMany({ where: { employeeId: id.ali } });
    // 23:59 on the 17th and 00:01 on the 18th, Asia/Karachi (UTC+5) => 18:59 UTC on the 17th, 19:01 UTC on the 17th... in UTC terms:
    const beforeMidnight = new Date("2026-11-17T18:59:00.000Z"); // 2026-11-17 23:59 PKT
    const afterMidnight = new Date("2026-11-17T19:01:00.000Z"); // 2026-11-18 00:01 PKT
    const now = new Date(afterMidnight.getTime() + 60_000);
    const result = await recordHeartbeat(id.ali!, [minute(beforeMidnight), minute(afterMidnight)], now);
    assert.equal(result.accepted, 2);
    const day17 = await prisma.activityDailySummary.findUnique({ where: { employeeId_date: { employeeId: id.ali!, date: toDate("2026-11-17") } } });
    const day18 = await prisma.activityDailySummary.findUnique({ where: { employeeId_date: { employeeId: id.ali!, date: toDate("2026-11-18") } } });
    assert.equal(day17?.trackedMinutes, 1);
    assert.equal(day18?.trackedMinutes, 1);
  });

  test("working-day gate: a Sunday, a holiday and an approved-leave day are not trackable; an ordinary working day is", async () => {
    // Every moment below is a fixed, explicit "now" passed straight into trackabilityStatus — never the real
    // calendar date — so this test's result never depends on which day it is actually run.
    const sunday = new Date("2026-11-15T10:00:00+05:00"); // 2026-11-15 is a Sunday
    const holidayDay = new Date("2026-11-18T10:00:00+05:00"); // Wednesday, made a holiday below
    const leaveDay = new Date("2026-11-19T10:00:00+05:00"); // Thursday, Ali on approved leave below
    const ordinaryDay = new Date("2026-11-12T10:00:00+05:00"); // Thursday, an otherwise ordinary working day

    const sun = await trackabilityStatus(id.ali!, sunday);
    assert.equal(sun.withinOfficeHours, false, "a Sunday is outside office hours regardless of the time");
    assert.equal(sun.trackable, false);

    await prisma.holiday.create({ data: { date: toDate("2026-11-18"), name: "Test holiday (activity)" } });
    const hol = await trackabilityStatus(id.ali!, holidayDay);
    assert.equal(hol.withinOfficeHours, false, "a public holiday is outside office hours");
    assert.equal(hol.trackable, false);

    const leaveType = await prisma.leaveType.create({ data: { code: "CL-ACT", name: "Casual Leave (activity test)", annualQuota: 10 } });
    const leaveRequest = await prisma.request.create({ data: { employeeId: id.ali!, type: "LEAVE", status: "APPROVED", title: "Casual Leave" } });
    await prisma.leaveRequest.create({
      data: { requestId: leaveRequest.id, leaveTypeId: leaveType.id, startDate: toDate("2026-11-19"), endDate: toDate("2026-11-19"), days: 1, reason: "Personal" },
    });
    const lv = await trackabilityStatus(id.ali!, leaveDay);
    assert.equal(lv.withinOfficeHours, true, "the day itself is an ordinary weekday");
    assert.equal(lv.onApprovedLeaveOrTravel, true);
    assert.equal(lv.trackable, false, "approved leave blocks tracking even on a normal working day");

    const normal = await trackabilityStatus(id.ali!, ordinaryDay);
    assert.equal(normal.withinOfficeHours, true);
    assert.equal(normal.onApprovedLeaveOrTravel, false);
    assert.equal(normal.trackable, true, "an ordinary working day inside office hours is trackable");

    // The same gate also blocks the heartbeat endpoint itself, not just the status flag.
    await prisma.activityHeartbeatState.deleteMany({ where: { employeeId: id.ali } });
    await assert.rejects(() => recordHeartbeat(id.ali!, [minute(sunday)], sunday), /not trackable/i);
  });

  test("rate limit: a second heartbeat sent too soon gets 429 with Retry-After; retrying later accepts it with nothing lost or duplicated", async (t) => {
    await prisma.activityDailySummary.deleteMany({ where: { employeeId: id.ali } });
    await prisma.activityHeartbeatState.deleteMany({ where: { employeeId: id.ali } });
    t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-10T06:00:00.000Z").getTime() }); // fixed Tuesday
    const t0 = new Date();
    const first = await as("ali").post("/activity/heartbeat", { minutes: [{ minuteStart: t0.toISOString(), active: true }] });
    assert.equal(first.status, 200);

    const t1 = new Date(t0.getTime() + 60_000);
    const res = await fetch(`${api.base}/activity/heartbeat`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token.ali}`, "Content-Type": "application/json" },
      body: JSON.stringify({ minutes: [{ minuteStart: t1.toISOString(), active: true }] }),
    });
    assert.equal(res.status, 429);
    assert.ok(Number(res.headers.get("Retry-After")) > 0, "Retry-After header is present and positive");

    // Simulate the wait by moving the rate-limit clock back; the client resends the SAME unprocessed batch.
    await prisma.activityHeartbeatState.update({ where: { employeeId: id.ali }, data: { lastHeartbeatAt: new Date(Date.now() - 60_000) } });
    const retry = await as("ali").post("/activity/heartbeat", { minutes: [{ minuteStart: t1.toISOString(), active: true }] });
    assert.equal(retry.status, 200);
    assert.equal(retry.data.accepted, 1);

    const day = await prisma.activityDailySummary.findFirst({ where: { employeeId: id.ali } });
    assert.equal(day?.trackedMinutes, 2, "both the first minute and the retried minute are counted, once each");
  });

  test("a client that queues several offline minutes in one batch loses nothing when it reconnects", async (t) => {
    await prisma.activityDailySummary.deleteMany({ where: { employeeId: id.ali } });
    await prisma.activityHeartbeatState.deleteMany({ where: { employeeId: id.ali } });
    t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-10T06:00:00.000Z").getTime() }); // fixed Tuesday
    const base = new Date();
    const minutes = Array.from({ length: 20 }, (_, i) => ({ minuteStart: new Date(base.getTime() - (20 - i) * 60_000).toISOString(), active: i % 2 === 0 }));
    const res = await as("ali").post("/activity/heartbeat", { minutes });
    assert.equal(res.status, 200);
    assert.equal(res.data.accepted, 20);
    const day = await prisma.activityDailySummary.findFirst({ where: { employeeId: id.ali } });
    assert.equal(day?.trackedMinutes, 20);
  });

  test("Line Manager sees only the team average and who is tracked today — never a member's own Active %", async () => {
    const today = toDate(todayYmd());
    await prisma.activityDailySummary.deleteMany({ where: { employeeId: { in: [id.ali!, id.sara!] } } });
    await prisma.activityDailySummary.create({ data: { employeeId: id.ali!, date: today, trackedMinutes: 60, activeMinutes: 60 } });
    await prisma.activityDailySummary.create({ data: { employeeId: id.sara!, date: today, trackedMinutes: 60, activeMinutes: 30 } });

    const res = await as("hamza").get("/activity/team");
    assert.equal(res.status, 200);
    assert.equal(res.data.teamAveragePct, 75);
    assert.equal(res.data.trackedCount, 2);
    for (const m of res.data.members) {
      assert.deepEqual(Object.keys(m).sort(), ["code", "fullName", "id", "trackedToday"].sort());
    }
    assert.equal((await as("ali").get("/activity/team")).status, 403, "an individual contributor has no team");
  });

  test("HR's individual view is audited; Finance and Management have no access at all", async () => {
    assert.equal((await as("fin").get(`/activity/employee/${id.ali}`)).status, 403);
    assert.equal((await as("ceo").get(`/activity/employee/${id.ali}`)).status, 403);
    assert.equal((await as("fin").get("/activity/reports")).status, 403);
    assert.equal((await as("fin").get("/activity/reports/export.csv")).status, 403);

    const before = (await auditRows("ActivitySummary", "VIEW_SENSITIVE")).length;
    const res = await as("hr").get(`/activity/employee/${id.ali}`);
    assert.equal(res.status, 200);
    const after = await auditRows("ActivitySummary", "VIEW_SENSITIVE");
    assert.equal(after.length, before + 1);
    assert.equal(after[0]!.actorId, id.hr);
    assert.equal(after[0]!.entityId, String(id.ali));
  });

  test("exporting the CSV report is audited", async () => {
    const before = (await auditRows("ActivityReport", "EXPORT")).length;
    const res = await fetch(`${api.base}/activity/reports/export.csv`, { headers: { Authorization: `Bearer ${token.hr}` } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/csv/);
    const after = await auditRows("ActivityReport", "EXPORT");
    assert.equal(after.length, before + 1);
    assert.equal(after[0]!.actorId, id.hr);
  });

  test("excluding an employee blocks their tracking and is audited; removing the exclusion restores it, also audited", async (t) => {
    assert.equal((await as("hr").post("/activity/exclusions", { employeeId: id.sara })).status, 201);
    assert.equal(((await auditRows("ActivityExclusion", "CREATE"))[0]!).actorId, id.hr);
    assert.equal((await as("sara").get("/activity/status")).data.trackable, false);
    assert.equal((await as("sara").post("/activity/heartbeat", { minutes: [minute(new Date())] })).status, 403);

    assert.equal((await as("hr").delete(`/activity/exclusions/${id.sara}`)).status, 200);
    assert.equal(((await auditRows("ActivityExclusion", "DELETE"))[0]!).actorId, id.hr);
    assert.equal((await as("sara").post("/activity/policy/acknowledge")).status, 200);
    // Being un-excluded and acknowledged is only enough to make trackable true on a working day inside
    // office hours; freeze the clock there so this does not depend on the real calendar date (2026-11-10
    // is a Tuesday). Scoped to this test only — t.mock.timers auto-restores the real clock once it ends.
    t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-10T06:00:00.000Z").getTime() });
    assert.equal((await as("sara").get("/activity/status")).data.trackable, true);
  });

  test("changing activity settings is recorded in the general settings audit trail", async () => {
    const res = await api.call(token.hr!, "PUT", "/settings", { "activity.idleThresholdMinutes": "7" });
    assert.equal(res.status, 200);
    const rows = await auditRows("Setting", "UPDATE");
    assert.ok(rows[0]!.details && JSON.stringify(rows[0]!.details).includes("activity.idleThresholdMinutes"));
    await setSetting("activity.idleThresholdMinutes", "5");
  });

  test("pausing is off by default; once allowed, the daily pause budget caps how much time is excused", async () => {
    assert.equal((await as("ali").post("/activity/pause", { action: "start" })).status, 403);
    await setSetting("activity.allowPause", "1");
    await setSetting("activity.pauseMaxMinutesPerDay", "10");
    await prisma.activityDailySummary.deleteMany({ where: { employeeId: id.ali } });
    await prisma.activityHeartbeatState.deleteMany({ where: { employeeId: id.ali } });

    await startPause(id.ali!);
    // Simulate 20 minutes elapsed while paused (more than the 10-minute daily budget).
    await prisma.activityHeartbeatState.update({ where: { employeeId: id.ali }, data: { pausedSince: new Date(Date.now() - 20 * 60_000) } });
    await endPause(id.ali!);
    const day = await prisma.activityDailySummary.findFirst({ where: { employeeId: id.ali } });
    assert.equal(day?.pausedMinutesUsed, 10, "capped at the daily budget, not the full 20 minutes paused");
    await setSetting("activity.allowPause", "0");
    await setSetting("activity.pauseMaxMinutesPerDay", "0");
  });

  test("retention cleanup deletes daily summaries past the retention setting and keeps recent ones", async () => {
    await prisma.activityDailySummary.deleteMany({ where: { employeeId: id.ali } });
    await setSetting("activity.retentionDays", "30");
    const old = new Date();
    old.setUTCDate(old.getUTCDate() - 40);
    const recent = new Date();
    recent.setUTCDate(recent.getUTCDate() - 1);
    await prisma.activityDailySummary.create({ data: { employeeId: id.ali!, date: toDate(old.toISOString().slice(0, 10)), trackedMinutes: 10 } });
    await prisma.activityDailySummary.create({ data: { employeeId: id.ali!, date: toDate(recent.toISOString().slice(0, 10)), trackedMinutes: 10 } });
    const deleted = await cleanupOldActivity();
    assert.ok(deleted >= 1);
    const remaining = await prisma.activityDailySummary.findMany({ where: { employeeId: id.ali } });
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0]!.date.toISOString().slice(0, 10), recent.toISOString().slice(0, 10));
    await setSetting("activity.retentionDays", "90");
  });
});
