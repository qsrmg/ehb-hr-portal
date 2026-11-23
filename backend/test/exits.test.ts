import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma.js";
import { addDays, todayYmd, toDate, ymd } from "../src/lib/dates.js";
import { deactivateDueExits } from "../src/services/exits.js";
import { evaluateLeave } from "../src/services/leave.js";
import { futureWorkday, outbox, PASSWORD, resetDatabase, startServer, useMemoryTransport } from "./helpers.js";

const day = (n: number) => ymd(addDays(toDate(todayYmd()), n));

describe("Resignation & exit clearance", () => {
  let api: Awaited<ReturnType<typeof startServer>>;
  const token: Record<string, string> = {};
  const id: Record<string, number> = {};
  const exit: Record<string, number> = {};
  const resignation: Record<string, number> = {};
  let laptopCategory: number;
  let annualLeave: number;

  const as = (who: string) => ({
    get: (path: string) => api.call(token[who]!, "GET", path),
    post: (path: string, body: Record<string, unknown> = {}) => api.call(token[who]!, "POST", path, body),
    patch: (path: string, body: Record<string, unknown>) => api.call(token[who]!, "PATCH", path, body),
  });
  const notes = (who: string, prefix: string) => prisma.notification.findMany({ where: { employeeId: id[who], title: { startsWith: prefix } } });
  const ok = (res: { status: number; data: { message?: string } }, status = 200) => assert.equal(res.status, status, res.data.message ?? "");
  const resign = async (who: string, proposedLastDay: string, reason = "Moving to another city") => {
    const res = await as(who).post("/requests/resignation", { reason, proposedLastDay });
    ok(res, 201);
    return res.data.id as number;
  };
  const caseOf = async (requestId: number) => (await prisma.exitCase.findUniqueOrThrow({ where: { requestId } })).id;

  before(async () => {
    await resetDatabase();
    useMemoryTransport();
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    const mgmt = await prisma.department.create({ data: { name: "Management" } });
    const eng = await prisma.department.create({ data: { name: "Engineering" } });
    const person = async (key: string, fullName: string, departmentId: number, roles: string[], managerId: number | null, extra: Record<string, unknown> = {}) => {
      const e = await prisma.employee.create({
        data: {
          code: `EHB-2024-${String(Object.keys(id).length + 1).padStart(3, "0")}`, email: `${key}@test.local`, fullName, passwordHash, mustChangePassword: false,
          joiningDate: toDate("2024-01-01"), departmentId, managerId, roles: ["EMPLOYEE", ...roles] as never, ...extra,
        },
      });
      id[key] = e.id;
    };
    await person("ceo", "Imran Qureshi", mgmt.id, ["MANAGEMENT"], null);
    await person("hr", "Ayesha Siddiqui", mgmt.id, ["HR"], id.ceo!);
    await person("fin", "Bilal Ahmed", mgmt.id, ["FINANCE"], id.ceo!);
    await person("usman", "Usman Tariq", mgmt.id, ["ADMIN"], id.ceo!);
    await person("nadia", "Nadia Khan", eng.id, ["HOD"], id.ceo!);
    await person("hamza", "Hamza Malik", eng.id, ["LINE_MANAGER"], id.nadia!);
    await person("ali", "Ali Raza", eng.id, [], id.hamza!);
    await person("sara", "Sara Javed", eng.id, [], id.hamza!, { probationEndDate: toDate(day(60)), personalEmail: "sara.personal@example.com" });
    await person("zara", "Zara Ahmed", eng.id, [], id.hamza!);
    await prisma.department.update({ where: { id: eng.id }, data: { hodId: id.nadia } });
    laptopCategory = (await prisma.assetCategory.create({ data: { name: "Laptop", sortOrder: 1 } })).id;
    annualLeave = (await prisma.leaveType.create({ data: { code: "AL", name: "Annual Leave", annualQuota: 14, proRata: false } })).id;
    await prisma.exitChecklistTemplate.createMany({
      data: [
        { area: "IT_ADMIN", label: "Laptop returned", ownerRole: "ADMIN", sortOrder: 1 },
        { area: "LINE_MANAGER", label: "Handover done", ownerRole: "LINE_MANAGER", sortOrder: 1 },
        { area: "HR", label: "Exit interview offered", ownerRole: null, sortOrder: 1 },
        { area: "FINANCE", label: "Settlement filed", ownerRole: "FINANCE", sortOrder: 1 },
      ],
    });
    api = await startServer();
    for (const key of Object.keys(id)) token[key] = await api.login(`${key}@test.local`);
  });

  after(async () => {
    await api.close();
  });

  test("a resignation goes Line Manager → HOD → HR, with a 30-day notice (7 days on probation)", async () => {
    const ali = await resign("ali", day(30));
    const detail = (await as("ali").get(`/requests/${ali}`)).data;
    assert.deepEqual(detail.steps.map((s: { label: string }) => s.label), ["Line Manager", "HOD", "HR"]);
    assert.equal(detail.resignation.noticeDays, 30);
    assert.equal(detail.resignation.noticeEndDate, day(30));
    assert.equal(detail.resignation.onProbation, false);
    resignation.ali = ali;

    const sara = await resign("sara", day(2));
    const s = (await as("sara").get(`/requests/${sara}`)).data;
    assert.equal(s.resignation.onProbation, true);
    assert.equal(s.resignation.noticeDays, 7);
    assert.equal(s.resignation.earlyRelease, true);
    resignation.sara = sara;

    // One resignation at a time
    const again = await as("ali").post("/requests/resignation", { reason: "Again", proposedLastDay: day(40) });
    assert.equal(again.status, 400);
    assert.match(again.data.message, /already have a resignation/);
  });

  test("an HOD's resignation goes to Management in place of the HOD; the employee can withdraw before HR approves", async () => {
    const nadia = await resign("nadia", day(30));
    const detail = (await as("nadia").get(`/requests/${nadia}`)).data;
    assert.deepEqual(detail.steps.map((s: { label: string }) => s.label), ["Line Manager", "Management (in place of HOD)", "HR"]);
    ok(await as("ceo").post(`/requests/${nadia}/approve`, {}));
    ok(await as("nadia").post(`/requests/${nadia}/cancel`));
    assert.equal((await prisma.request.findUniqueOrThrow({ where: { id: nadia } })).status, "CANCELLED");
  });

  test("early release: the Line Manager must recommend it before HR can set an earlier last day", async () => {
    // Ali proposes a day before his notice ends; Hamza must decide on early release.
    await prisma.resignationRequest.update({ where: { requestId: resignation.ali }, data: { proposedLastDay: toDate(day(10)) } });
    const missing = await as("hamza").post(`/requests/${resignation.ali}/approve`, {});
    assert.equal(missing.status, 400);
    assert.match(missing.data.message, /recommend releasing them early/);
    ok(await as("hamza").post(`/requests/${resignation.ali}/approve`, { earlyRelease: false }));
    ok(await as("nadia").post(`/requests/${resignation.ali}/approve`, {}));

    const atHr = (await as("hr").get(`/requests/${resignation.ali}`)).data;
    assert.equal(atHr.resignation.decision, "FINAL");
    assert.equal(atHr.resignation.mayReleaseEarly, false);
    assert.equal(atHr.resignation.defaultLastWorkingDay, day(30));
    const tooEarly = await as("hr").post(`/requests/${resignation.ali}/approve`, { lastWorkingDay: day(10) });
    assert.equal(tooEarly.status, 400);
    assert.match(tooEarly.data.message, /did not recommend early release/);

    ok(await as("hr").post(`/requests/${resignation.ali}/approve`, {}));
    exit.ali = await caseOf(resignation.ali!);
    const c = await prisma.exitCase.findUniqueOrThrow({ where: { id: exit.ali }, include: { clearances: true } });
    assert.equal(ymd(c.lastWorkingDay), day(30));
    assert.equal(c.shortfallDays, 0);
    assert.deepEqual(c.clearances.map((x) => `${x.area}:${x.status}`).sort(), ["FINANCE:WAITING", "HR:PENDING", "IT_ADMIN:PENDING", "LINE_MANAGER:PENDING"]);
    assert.equal(c.clearances.find((x) => x.area === "LINE_MANAGER")?.approverId, id.hamza);

    // After HR's approval only HR can cancel the exit.
    const withdraw = await as("ali").post(`/requests/${resignation.ali}/cancel`);
    assert.equal(withdraw.status, 400);
  });

  test("a recommended early release leaves a notice shortfall that Finance deducts unless HR waives it", async () => {
    ok(await as("hamza").post(`/requests/${resignation.sara}/approve`, { earlyRelease: true }));
    ok(await as("nadia").post(`/requests/${resignation.sara}/approve`, {}));
    ok(await as("hr").post(`/requests/${resignation.sara}/approve`, { lastWorkingDay: day(2), waiveShortfall: false }));
    exit.sara = await caseOf(resignation.sara!);
    const c = await prisma.exitCase.findUniqueOrThrow({ where: { id: exit.sara } });
    assert.equal(ymd(c.lastWorkingDay), day(2));
    assert.equal(c.shortfallDays, 5);
    assert.equal(c.shortfallWaived, false);
    // Everyone with a card is told; the leaver too.
    assert.equal((await notes("usman", "Exit clearance: Sara")).length, 1);
    assert.equal((await notes("hamza", "Exit clearance: Sara")).length, 1);
    assert.equal((await notes("hr", "Exit clearance: Sara")).length, 1);
    assert.equal((await notes("sara", "Exit clearance started")).length, 1);
  });

  test("leave and trips cannot run past the last working day", async () => {
    const r = await evaluateLeave(id.sara!, { leaveTypeId: annualLeave, startDate: day(1), endDate: day(10) });
    assert.ok(r.errors.some((e) => /last working day/.test(e)), r.errors.join("; "));
  });

  test("IT / Admin cannot clear while items are outstanding; Finance waits for the other three", async () => {
    const laptop = await prisma.asset.create({ data: { tag: "EHB-AST-0001", categoryId: laptopCategory, name: "Dell Latitude", status: "ISSUED", cost: 250000 } });
    const assignment = await prisma.assetAssignment.create({ data: { assetId: laptop.id, assigneeType: "EMPLOYEE", employeeId: id.sara, issuedById: id.usman!, conditionOut: "GOOD", confirmedAt: new Date() } });

    const blocked = await as("usman").post(`/exits/${exit.sara}/clearances/it_admin/clear`);
    assert.equal(blocked.status, 400);
    assert.match(blocked.data.message, /Dell Latitude \(EHB-AST-0001, return\)/);
    assert.equal((await as("fin").get(`/exits/${exit.sara}/settlement-draft`)).status, 403);
    assert.equal((await as("hr").post(`/exits/${exit.sara}/clearances/line_manager/clear`)).status, 403, "only Hamza clears the Line Manager card");

    // The laptop is lost and HR sets a recovery: the item no longer blocks, and the recovery goes to Finance.
    await prisma.asset.update({ where: { id: laptop.id }, data: { status: "LOST" } });
    await prisma.assetIncident.create({
      data: { assetId: laptop.id, assignmentId: assignment.id, employeeId: id.sara, type: "LOST", status: "RECOVERY_SET", description: "Left in a taxi", reportedById: id.sara!, recoveryAmount: 30000, recoverySetById: id.hr },
    });
    ok(await as("usman").post(`/exits/${exit.sara}/clearances/it_admin/clear`, { comment: "Laptop lost, recovery set" }));
    ok(await as("hamza").post(`/exits/${exit.sara}/clearances/line_manager/clear`, { comment: "Handover done" }));
    assert.equal((await prisma.exitClearance.findFirstOrThrow({ where: { caseId: exit.sara, area: "FINANCE" } })).status, "WAITING");
    ok(await as("hr").post(`/exits/${exit.sara}/clearances/hr/clear`));
    assert.equal((await prisma.exitClearance.findFirstOrThrow({ where: { caseId: exit.sara, area: "FINANCE" } })).status, "PENDING");
    assert.equal((await notes("fin", "Final settlement: Sara")).length, 1);
  });

  test("Finance's settlement is pre-filled with the recovery, the notice shortfall and leave encashment", async () => {
    const draft = (await as("fin").get(`/exits/${exit.sara}/settlement-draft`)).data;
    const byKind = Object.fromEntries(draft.items.map((i: { kind: string }) => [i.kind, i]));
    assert.equal(byKind.ASSET_RECOVERY.amount, 30000);
    assert.equal(byKind.ASSET_RECOVERY.direction, "DEDUCT");
    assert.equal(byKind.NOTICE_SHORTFALL.days, 5);
    assert.equal(byKind.LEAVE_ENCASHMENT.days, 14);
    assert.equal(byKind.LEAVE_ENCASHMENT.direction, "PAY");

    const items = draft.items.map((i: Record<string, unknown>) => ({ ...i }));
    const missingAmount = await as("fin").post(`/exits/${exit.sara}/settlement`, { items, settledOn: todayYmd() });
    assert.equal(missingAmount.status, 400);
    assert.match(missingAmount.data.message, /Enter the amount/);

    for (const i of items) {
      if (i.kind === "NOTICE_SHORTFALL") i.amount = 8000;
      if (i.kind === "LEAVE_ENCASHMENT") i.amount = 22000;
    }
    // Finance can also add its own line, e.g. a one-off payment with no fixed kind.
    items.push({ kind: "OTHER", direction: "PAY", description: "Notice pay in lieu", amount: 15000 });
    const res = await as("fin").post(`/exits/${exit.sara}/settlement`, { items, settledOn: todayYmd(), method: "Bank transfer", reference: "FS-1" });
    ok(res);
    assert.equal(res.data.net, 22000 - 30000 - 8000 + 15000);
    assert.equal((await prisma.exitClearance.findFirstOrThrow({ where: { caseId: exit.sara, area: "FINANCE" } })).status, "CLEARED");
    assert.equal((await notes("hr", "Exit cleared: Sara")).length, 1);

    // Money and the reason for leaving are not shown to Admin or the Line Manager.
    const admin = (await as("usman").get(`/exits/${exit.sara}`)).data;
    assert.equal(admin.settlement, null);
    assert.equal(admin.reason, null);
    const hr = (await as("hr").get(`/exits/${exit.sara}`)).data;
    assert.equal(hr.settlement.net, -1000);
    const custom = hr.settlement.items.find((i: { kind: string }) => i.kind === "OTHER");
    assert.equal(custom.description, "Notice pay in lieu");
    assert.equal(custom.amount, 15000);
    assert.equal(hr.reason, "Moving to another city");
  });

  test("leave encashment on exit is an on/off setting, not any number", async () => {
    assert.equal((await api.call(token.hr!, "PUT", "/settings", { "exit.leaveEncashment": "2" })).status, 400);
    ok(await api.call(token.hr!, "PUT", "/settings", { "exit.leaveEncashment": "0" }));
    ok(await api.call(token.hr!, "PUT", "/settings", { "exit.leaveEncashment": "1" }));
    const visible = (await api.call(token.hr!, "GET", "/settings")).data.find((s: { key: string }) => s.key === "exit.leaveEncashment");
    assert.equal(visible.boolean, true);
  });

  test("the exit interview is optional and visible to HR only", async () => {
    ok(await as("sara").post(`/exits/${exit.sara}/interview`, { primaryReason: "Relocation", rating: 4, wouldRecommend: true, improve: "More training" }));
    assert.equal((await as("sara").post(`/exits/${exit.sara}/interview`, { primaryReason: "Other" })).status, 400);
    const lm = (await as("hamza").get(`/exits/${exit.sara}`)).data;
    assert.equal(lm.interview, null);
    assert.equal(lm.interviewSubmitted, true);
    const fin = (await as("fin").get(`/exits/${exit.sara}`)).data;
    assert.equal(fin.interview, null);
    const hr = (await as("hr").get(`/exits/${exit.sara}`)).data;
    assert.equal(hr.interview.primaryReason, "Relocation");
    assert.equal(hr.interview.improve, "More training");
  });

  test("VIEW_SENSITIVE is audited when HR reads someone else's interview, never for the employee's own read, and answers never reach AuditLog", async () => {
    const before = await prisma.auditLog.count({ where: { action: "VIEW_SENSITIVE", entity: "ExitInterview", entityId: String(exit.sara) } });
    ok(await as("sara").get(`/exits/${exit.sara}`)); // Sara reading her own case/interview
    assert.equal(await prisma.auditLog.count({ where: { action: "VIEW_SENSITIVE", entity: "ExitInterview", entityId: String(exit.sara) } }), before, "no audit row for the employee's own read");
    ok(await as("hr").get(`/exits/${exit.sara}`)); // HR reading Sara's interview
    assert.equal(await prisma.auditLog.count({ where: { action: "VIEW_SENSITIVE", entity: "ExitInterview", entityId: String(exit.sara) } }), before + 1, "exactly one audit row for HR's read");
    const rows = await prisma.auditLog.findMany({ where: { entity: "ExitInterview" } });
    for (const r of rows) {
      const text = JSON.stringify(r.details ?? {});
      assert.ok(!text.includes("Relocation") && !text.includes("More training"), "interview answers must never be written into AuditLog details");
    }
  });

  test("checklist items with no owner role are HR-only; an owner role may also be cleared by HR", async () => {
    const items = (await as("hr").get(`/exits/${exit.sara}`)).data.checklistItems as { id: number; area: string; ownerRole: string | null; status: string }[];
    assert.equal(items.length, 4, "one snapshotted item per area");
    const hrItem = items.find((i) => i.ownerRole === null)!;
    const itemByArea = (area: string) => items.find((i) => i.area === area)!;

    // No owner role: HR only.
    assert.equal((await as("usman").post(`/exits/${exit.sara}/checklist/${hrItem.id}`, { status: "DONE" })).status, 403);
    assert.equal((await as("hamza").post(`/exits/${exit.sara}/checklist/${hrItem.id}`, { status: "DONE" })).status, 403);
    const hrDone = await as("hr").post(`/exits/${exit.sara}/checklist/${hrItem.id}`, { status: "DONE" });
    ok(hrDone);
    assert.equal(hrDone.data.status, "DONE");

    // An owner role (IT_ADMIN area, ownerRole ADMIN): that role, or HR, may clear it; others cannot.
    const itAdminItem = itemByArea("IT_ADMIN");
    assert.equal((await as("hamza").post(`/exits/${exit.sara}/checklist/${itAdminItem.id}`, { status: "DONE" })).status, 403);
    ok(await as("usman").post(`/exits/${exit.sara}/checklist/${itAdminItem.id}`, { status: "DONE" }));
    const financeItem = itemByArea("FINANCE");
    ok(await as("hr").post(`/exits/${exit.sara}/checklist/${financeItem.id}`, { status: "NOT_APPLICABLE" }));

    const after = (await as("hr").get(`/exits/${exit.sara}`)).data.checklistItems as { id: number; status: string; doneBy: string | null }[];
    assert.equal(after.find((i) => i.id === hrItem.id)!.status, "DONE");
    assert.equal(after.find((i) => i.id === itAdminItem.id)!.doneBy, "Usman Tariq");
    assert.equal(after.find((i) => i.id === financeItem.id)!.status, "NOT_APPLICABLE");
  });

  test("checklist toggle: a Line Manager item follows the card's approver or the employee's current manager, never a bare role check", async () => {
    const items = (await as("hr").get(`/exits/${exit.sara}`)).data.checklistItems as { id: number; area: string }[];
    const lmItem = items.find((i) => i.area === "LINE_MANAGER")!;

    // (f) An unrelated employee gets 403 from loadForUser itself (cannot see the case at all).
    assert.equal((await as("zara").post(`/exits/${exit.sara}/checklist/${lmItem.id}`, { status: "DONE" })).status, 403, "unrelated employee");

    // (d) HR can toggle the Line Manager item too, bypassing the per-case approver rule entirely.
    ok(await as("hr").post(`/exits/${exit.sara}/checklist/${lmItem.id}`, { status: "DONE" }));
    ok(await as("hr").post(`/exits/${exit.sara}/checklist/${lmItem.id}`, { status: "PENDING" })); // reopen for the rest of this test

    // (c) Usman (Admin, sees every case) also temporarily holds LINE_MANAGER, but is neither the card's
    // approver nor Sara's manager: a matching global role alone must not be enough.
    await prisma.employee.update({ where: { id: id.usman }, data: { roles: ["EMPLOYEE", "ADMIN", "LINE_MANAGER"] } });
    try {
      assert.equal((await as("usman").post(`/exits/${exit.sara}/checklist/${lmItem.id}`, { status: "DONE" })).status, 403, "an unrelated extra LINE_MANAGER role is not enough");
    } finally {
      await prisma.employee.update({ where: { id: id.usman }, data: { roles: ["EMPLOYEE", "ADMIN"] } });
    }

    // (b) Sara's manager is reassigned to Nadia without a handover (the card's stored approver stays Hamza).
    // Nadia, as the *current* manager, can still toggle it — and so can Hamza, the originally-snapshotted approver.
    await prisma.employee.update({ where: { id: id.sara }, data: { managerId: id.nadia } });
    try {
      // Nadia, Sara's current manager, even though the card's stored approver is still Hamza.
      ok(await as("nadia").post(`/exits/${exit.sara}/checklist/${lmItem.id}`, { status: "DONE" }));
      // The card's originally-snapshotted approver (Hamza) still works too.
      ok(await as("hamza").post(`/exits/${exit.sara}/checklist/${lmItem.id}`, { status: "PENDING" }));
    } finally {
      await prisma.employee.update({ where: { id: id.sara }, data: { managerId: id.hamza } });
    }
  });

  test("GET /exits/:id/history is HR/Finance/Admin only; 403 for the employee and the Line Manager, 404 if they cannot see the case at all", async () => {
    const hr = await as("hr").get(`/exits/${exit.sara}/history`);
    ok(hr);
    assert.ok(hr.data.length > 0, "the audited actions on this case");
    assert.ok(hr.data.some((r: { changes: Record<string, unknown> }) => "net" in r.changes), "the whitelist includes net, because the audience is already restricted");
    ok(await as("fin").get(`/exits/${exit.sara}/history`));
    ok(await as("usman").get(`/exits/${exit.sara}/history`));
    assert.equal((await as("sara").get(`/exits/${exit.sara}/history`)).status, 403, "the employee");
    assert.equal((await as("hamza").get(`/exits/${exit.sara}/history`)).status, 403, "the Line Manager");
    // Same as the main endpoint: an unrelated employee also gets 403 (loadForUser itself never shows that an exit
    // case exists to someone with no visibility at all); 404 is reserved for an id that does not exist at all.
    assert.equal((await as("zara").get(`/exits/${exit.sara}/history`)).status, 403, "an unrelated employee, same as GET /exits/:id");
    assert.equal((await as("hr").get("/exits/999999/history")).status, 404, "an id that does not exist at all");
  });

  test("HR issues the experience and relieving letters, emailed as PDFs to the personal email", async () => {
    outbox.length = 0;
    ok(await as("hr").post(`/exits/${exit.sara}/letters`));
    const mail = outbox.find((m) => m.to === "sara.personal@example.com");
    assert.ok(mail, "letters emailed to the personal email");
    assert.deepEqual(mail.attachments.sort(), ["experience-letter-EHB-2024-008.pdf", "relieving-letter-EHB-2024-008.pdf"]);
    const res = await fetch(`${api.base}/exits/${exit.sara}/letters/relieving`, { headers: { Authorization: `Bearer ${token.hr}` } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/pdf");
    assert.equal((await as("usman").post(`/exits/${exit.sara}/letters`)).status, 403);
    // Ali's clearance is not finished, so no letters yet.
    assert.equal((await as("hr").post(`/exits/${exit.ali}/letters`)).status, 400);
  });

  test("the login is switched off after the last working day even if clearance is not finished; HR completes later", async () => {
    const early = await as("hr").post(`/exits/${exit.sara}/complete`);
    assert.equal(early.status, 400);
    assert.match(early.data.message, /after the last working day/);

    await prisma.exitCase.updateMany({ where: { id: { in: [exit.sara!, exit.ali!] } }, data: { lastWorkingDay: toDate(day(-1)) } });
    assert.equal(await deactivateDueExits(), 2);
    for (const who of ["sara", "ali"]) {
      assert.equal((await prisma.employee.findUniqueOrThrow({ where: { id: id[who] } })).status, "INACTIVE");
      assert.equal((await as(who).get("/exits/mine")).status, 401, `${who} can no longer log in`);
    }
    assert.equal((await prisma.exitCase.findUniqueOrThrow({ where: { id: exit.ali } })).status, "OPEN");
    assert.equal((await notes("hr", "Account deactivated: Ali")).length, 1);
    assert.equal(await deactivateDueExits(), 0, "runs only once per exit");

    const ali = await as("hr").post(`/exits/${exit.ali}/complete`);
    assert.equal(ali.status, 400);
    assert.match(ali.data.message, /Still to clear: IT \/ Admin, Line Manager, HR, Finance/);
    ok(await as("hr").post(`/exits/${exit.sara}/complete`));
    assert.equal((await prisma.exitCase.findUniqueOrThrow({ where: { id: exit.sara } })).status, "COMPLETED");
  });

  test("HR can cancel an exit; a switched-off login is switched back on", async () => {
    ok(await as("hr").post(`/exits/${exit.ali}/cancel`, { reason: "Ali decided to stay" }));
    assert.equal((await prisma.employee.findUniqueOrThrow({ where: { id: id.ali } })).status, "ACTIVE");
    assert.equal((await prisma.exitCase.findUniqueOrThrow({ where: { id: exit.ali } })).status, "CANCELLED");
    token.ali = await api.login("ali@test.local");
    assert.ok(token.ali);
  });

  test("HR is warned about the leaver's team and approvals; the exit cannot be completed until they are reassigned", async () => {
    // Zara has a leave request waiting with Hamza. A single working day, not day(14): that lands on a
    // weekend depending on the real calendar date, which would make this a "no working days" 400 instead
    // of the leave request this test needs.
    const leaveDay = futureWorkday(14);
    const leave = await api.call(token.zara!, "POST", "/requests/leave", { leaveTypeId: annualLeave, startDate: leaveDay, endDate: leaveDay, reason: "Family event" });
    ok(leave, 201);
    const hamza: number = await resign("hamza", day(30));
    // Hamza's line manager is Nadia, who is also the HOD: one step for her, then HR.
    ok(await as("nadia").post(`/requests/${hamza}/approve`, {}));
    const atHr = (await as("hr").get(`/requests/${hamza}`)).data;
    assert.match(atHr.resignation.handoverWarning, /Hamza Malik still has 2 team members, 1 pending approval/);
    ok(await as("hr").post(`/requests/${hamza}/approve`, {}));
    exit.hamza = await caseOf(hamza);
    const hrNote = (await notes("hr", "Exit clearance: Hamza"))[0];
    assert.match(hrNote!.body, /Reassign them before the exit can be completed/);

    // Self-clearance: Hamza holds LINE_MANAGER globally, but this is his own exit (Nadia is the card's
    // approver, not him) — he must never be able to toggle his own Line Manager checklist item.
    const hamzaItems = (await as("hr").get(`/exits/${exit.hamza}`)).data.checklistItems as { id: number; area: string }[];
    const hamzaLmItem = hamzaItems.find((i) => i.area === "LINE_MANAGER")!;
    assert.equal((await as("hamza").post(`/exits/${exit.hamza}/checklist/${hamzaLmItem.id}`, { status: "DONE" })).status, 403, "a resigning Line Manager cannot toggle their own item");

    for (const area of ["it_admin", "line_manager", "hr"]) {
      ok(await as(area === "it_admin" ? "usman" : area === "hr" ? "hr" : "nadia").post(`/exits/${exit.hamza}/clearances/${area}/clear`));
    }
    ok(await as("fin").post(`/exits/${exit.hamza}/settlement`, { items: [], settledOn: todayYmd() }));
    await prisma.exitCase.update({ where: { id: exit.hamza }, data: { lastWorkingDay: toDate(day(-1)) } });
    const blocked = await as("hr").post(`/exits/${exit.hamza}/complete`);
    assert.equal(blocked.status, 400);
    assert.match(blocked.data.message, /team member/);

    const moved = await as("hr").post(`/exits/${exit.hamza}/handover`, { toEmployeeId: id.nadia });
    ok(moved);
    assert.equal(moved.data.moved.approvals, 1);
    assert.equal((await prisma.employee.findUniqueOrThrow({ where: { id: id.zara } })).managerId, id.nadia);
    const step = await prisma.requestStep.findFirstOrThrow({ where: { requestId: leave.data.id, order: 0 } });
    assert.equal(step.approverId, id.nadia);
    // Letters were never issued for Hamza; completing the exit is a warning in the portal, not a block.
    assert.equal((await as("hr").get(`/exits/${exit.hamza}`)).data.letters, null);
    ok(await as("hr").post(`/exits/${exit.hamza}/complete`));
  });

  test("HR starts an exit for a termination with the same clearance", async () => {
    const res = await as("hr").post("/exits", { employeeId: id.zara, type: "TERMINATION", reason: "Contract breach", noticeGivenOn: todayYmd(), lastWorkingDay: day(5) });
    ok(res, 201);
    const c = (await as("hr").get(`/exits/${res.data.id}`)).data;
    assert.equal(c.typeLabel, "Termination");
    assert.deepEqual(c.clearanceCards.map((x: { area: string; status: string }) => `${x.area}:${x.status}`), ["IT_ADMIN:PENDING", "LINE_MANAGER:PENDING", "HR:PENDING", "FINANCE:WAITING"]);
    assert.equal(c.shortfallDays, 0);
    assert.equal((await as("zara").get(`/exits/${res.data.id}`)).data.reason, "Contract breach");
    assert.equal((await as("hr").post("/exits", { employeeId: id.zara, type: "OTHER", reason: "Twice", noticeGivenOn: todayYmd(), lastWorkingDay: day(5) })).status, 400);
    assert.equal((await as("zara").post("/exits", { employeeId: id.ali, type: "OTHER", reason: "Not HR", noticeGivenOn: todayYmd(), lastWorkingDay: day(5) })).status, 403);
  });
});
