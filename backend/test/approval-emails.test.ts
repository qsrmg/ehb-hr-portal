import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.js";
import { startQueue, stopQueue } from "../src/jobs/queue.js";
import {
  failNextDeliveries, futureWorkday, outbox, resetDatabase, seedPeople, sentTo, startServer, useMemoryTransport, waitForEmails,
} from "./helpers.js";

const EMP = "employee@test.local";
const MGR = "manager@test.local";
const HR = "hr@test.local";

describe("approval engine emails (through the background queue)", () => {
  let api: Awaited<ReturnType<typeof startServer>>;
  let people: Awaited<ReturnType<typeof seedPeople>>;
  let tokens: { emp: string; mgr: string; hr: string };
  let dayOffset = 5;

  const leave = (leaveTypeId: number) => {
    const date = futureWorkday(dayOffset++);
    return { leaveTypeId: String(leaveTypeId), startDate: date, endDate: date, reason: "Family matter" };
  };

  before(async () => {
    await resetDatabase();
    people = await seedPeople();
    useMemoryTransport();
    await startQueue({ retryDelaySeconds: 1, pollingIntervalSeconds: 0.5, schedules: false });
    api = await startServer();
    tokens = { emp: await api.login(EMP), mgr: await api.login(MGR), hr: await api.login(HR) };
  });

  after(async () => {
    await api.close();
    await stopQueue();
  });

  beforeEach(() => {
    outbox.length = 0;
  });

  test("submitted: employee gets a confirmation and the line manager is asked to approve", async () => {
    const res = await api.call(tokens.emp, "POST", "/requests/leave", leave(people.casual.id));
    assert.equal(res.status, 201);
    await waitForEmails(() => sentTo(EMP, "Submitted:").length === 1 && sentTo(MGR, "Approval needed:").length === 1);

    const [confirmation] = sentTo(EMP, "Submitted:");
    assert.match(confirmation!.text, /waiting for Line Manager \(Hamza Malik\)/);
    assert.match(confirmation!.text, new RegExp(`http://portal.test/requests/${res.data.id}`));
    assert.match(confirmation!.html, /Open in the HR Portal/);
    assert.equal(sentTo(HR, "").length, 0, "HR is not part of this chain");
  });

  test("approved at step 1: employee is told, and the next approver (HR) is asked to approve", async () => {
    const { data } = await api.call(tokens.emp, "POST", "/requests/leave", leave(people.unpaid.id));
    await waitForEmails(() => sentTo(MGR, "Approval needed:").length === 1);
    outbox.length = 0;

    assert.equal((await api.call(tokens.mgr, "POST", `/requests/${data.id}/approve`, {})).status, 200);
    await waitForEmails(() => sentTo(EMP, "Approved by Line Manager:").length === 1 && sentTo(HR, "Approval needed:").length === 1);
    assert.match(sentTo(EMP, "Approved by Line Manager:")[0]!.text, /now waiting for HR/);
    assert.equal(sentTo(MGR, "").length, 0, "the manager has already acted");
  });

  test("final approval: employee is told it is approved", async () => {
    const { data } = await api.call(tokens.emp, "POST", "/requests/leave", leave(people.casual.id));
    await waitForEmails(() => sentTo(MGR, "Approval needed:").length === 1);
    outbox.length = 0;

    await api.call(tokens.mgr, "POST", `/requests/${data.id}/approve`, {});
    await waitForEmails(() => sentTo(EMP, "Approved:").length === 1);
    assert.equal(outbox.length, 1, "nobody else is emailed when the chain is finished");
  });

  test("returned: employee gets the reason; resubmitting emails the employee and the approver again", async () => {
    const body = leave(people.casual.id);
    const { data } = await api.call(tokens.emp, "POST", "/requests/leave", body);
    await waitForEmails(() => sentTo(MGR, "Approval needed:").length === 1);
    outbox.length = 0;

    await api.call(tokens.mgr, "POST", `/requests/${data.id}/return`, { comment: "Please add the event details" });
    await waitForEmails(() => sentTo(EMP, "Returned for changes:").length === 1);
    assert.match(sentTo(EMP, "Returned for changes:")[0]!.text, /Please add the event details/);
    outbox.length = 0;

    const resubmit = await api.call(tokens.emp, "PUT", `/requests/${data.id}/resubmit`, { ...body, reason: "Cousin's wedding in Multan" });
    assert.equal(resubmit.status, 200);
    await waitForEmails(() => sentTo(EMP, "Resubmitted:").length === 1 && sentTo(MGR, "Approval needed:").length === 1);
  });

  test("rejected at step 2: employee gets the reason", async () => {
    const { data } = await api.call(tokens.emp, "POST", "/requests/leave", leave(people.unpaid.id));
    await api.call(tokens.mgr, "POST", `/requests/${data.id}/approve`, {});
    await waitForEmails(() => sentTo(HR, "Approval needed:").length === 1);
    outbox.length = 0;

    await api.call(tokens.hr, "POST", `/requests/${data.id}/reject`, { comment: "Unpaid leave is frozen this quarter" });
    await waitForEmails(() => sentTo(EMP, "Rejected:").length === 1);
    assert.match(sentTo(EMP, "Rejected:")[0]!.text, /rejected by HR. Reason: Unpaid leave is frozen this quarter/);
  });

  test("cancelled by the employee: the waiting approver is told", async () => {
    const { data } = await api.call(tokens.emp, "POST", "/requests/leave", leave(people.casual.id));
    await waitForEmails(() => sentTo(MGR, "Approval needed:").length === 1);
    outbox.length = 0;

    assert.equal((await api.call(tokens.emp, "POST", `/requests/${data.id}/cancel`, {})).status, 200);
    await waitForEmails(() => sentTo(MGR, "Cancelled:").length === 1);
  });

  test("every email is also an in-app notification", async () => {
    const { data } = await api.call(tokens.emp, "POST", "/requests/letter", { letterType: "SALARY", addressedTo: "Bank", purpose: "Loan" });
    await waitForEmails(() => sentTo(HR, "Approval needed:").length === 1);
    const inApp = await prisma.notification.findMany({ where: { link: `/requests/${data.id}` } });
    assert.deepEqual(inApp.map((n) => n.title.split(":")[0]).sort(), ["Approval needed", "Submitted"]);
  });

  test("a failed delivery is retried by the queue", async () => {
    failNextDeliveries(2);
    await api.call(tokens.emp, "POST", "/requests/letter", { letterType: "NOC", addressedTo: "Embassy", purpose: "Visa" });
    await waitForEmails(() => sentTo(EMP, "Submitted:").length === 1 && sentTo(HR, "Approval needed:").length === 1);
  });
});
