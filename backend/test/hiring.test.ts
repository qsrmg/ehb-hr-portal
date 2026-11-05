import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma.js";
import { addDays, todayYmd, toDate, ymd } from "../src/lib/dates.js";
import { outbox, PASSWORD, resetDatabase, startServer, useMemoryTransport } from "./helpers.js";

const day = (n: number) => ymd(addDays(toDate(todayYmd()), n));

describe("Manpower Requisition and internal jobs", () => {
  let api: Awaited<ReturnType<typeof startServer>>;
  const token: Record<string, string> = {};
  const id: Record<string, number> = {};
  const dept: Record<string, number> = {};
  const req: Record<string, number> = {};

  const as = (who: string) => ({
    get: (path: string) => api.call(token[who]!, "GET", path),
    post: (path: string, body: Record<string, unknown> = {}) => api.call(token[who]!, "POST", path, body),
    put: (path: string, body: Record<string, unknown>) => api.call(token[who]!, "PUT", path, body),
    patch: (path: string, body: Record<string, unknown>) => api.call(token[who]!, "PATCH", path, body),
  });
  const ok = (res: { status: number; data: { message?: string } }, status = 200) => assert.equal(res.status, status, res.data.message ?? "");
  const notes = (who: string, prefix: string) => prisma.notification.findMany({ where: { employeeId: id[who], title: { startsWith: prefix } } });
  const stepsOf = async (requisitionId: number) => {
    const r = await prisma.requisition.findUniqueOrThrow({ where: { id: requisitionId } });
    return (await prisma.requestStep.findMany({ where: { requestId: r.requestId! }, orderBy: { order: "asc" } })).map((s) => s.label);
  };
  const requestOf = async (requisitionId: number) => (await prisma.requisition.findUniqueOrThrow({ where: { id: requisitionId } })).requestId!;
  /** An exit case as HR opens it (with its four clearance cards). */
  const makeExit = (employee: string, lastDay: string) =>
    prisma.exitCase.create({
      data: {
        employeeId: id[employee]!, type: "RESIGNATION", reason: "Leaving", noticeGivenOn: toDate(todayYmd()), lastWorkingDay: toDate(lastDay), startedById: id.hr!,
        clearances: { create: [{ area: "IT_ADMIN", status: "PENDING" }, { area: "LINE_MANAGER", status: "PENDING" }, { area: "HR", status: "PENDING" }, { area: "FINANCE", status: "WAITING" }] },
      },
    });
  const base = (extra: Record<string, unknown> = {}) => ({
    departmentId: dept.Engineering, title: "Backend Developer", grade: "G5", headcount: 1, employmentType: "PERMANENT", reportsToId: id.hamza,
    targetStartDate: day(30), justification: "The team needs more capacity for the payments project.", reason: "NEW", ...extra,
  });

  before(async () => {
    await resetDatabase();
    useMemoryTransport();
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    for (const name of ["Management", "Engineering", "Finance"]) dept[name] = (await prisma.department.create({ data: { name } })).id;
    const person = async (key: string, fullName: string, d: string, roles: string[], managerId: number | null, extra: Record<string, unknown> = {}) => {
      const e = await prisma.employee.create({
        data: {
          code: `EHB-2024-${String(Object.keys(id).length + 1).padStart(3, "0")}`, email: `${key}@test.local`, fullName, passwordHash, mustChangePassword: false,
          joiningDate: toDate("2024-01-01"), departmentId: dept[d], managerId, roles: ["EMPLOYEE", ...roles] as never, ...extra,
        },
      });
      id[key] = e.id;
    };
    await person("ceo", "Imran Qureshi", "Management", ["MANAGEMENT"], null);
    await person("hr", "Ayesha Siddiqui", "Management", ["HR"], id.ceo!);
    await person("fin", "Bilal Ahmed", "Finance", ["FINANCE", "LINE_MANAGER"], id.ceo!);
    await person("nadia", "Nadia Khan", "Engineering", ["HOD"], id.ceo!);
    await person("hamza", "Hamza Malik", "Engineering", ["LINE_MANAGER"], id.nadia!);
    await person("ali", "Ali Raza", "Engineering", [], id.hamza!, { grade: "G5", designation: "Backend Developer" });
    await person("zain", "Zain Ahmed", "Engineering", [], id.hamza!, { grade: "G5", designation: "QA Engineer" });
    await person("kamal", "Kamal Shah", "Finance", [], id.fin!, { grade: "G4", designation: "Accountant" });
    await person("sara", "Sara Javed", "Engineering", [], id.hamza!, { probationEndDate: toDate(day(30)) });
    await person("neo", "Neo Khan", "Finance", [], id.fin!, { joiningDate: toDate(day(-60)) });
    await prisma.department.update({ where: { id: dept.Engineering }, data: { hodId: id.nadia } });
    await prisma.department.update({ where: { id: dept.Finance }, data: { hodId: id.ceo } });
    api = await startServer();
    for (const key of Object.keys(id)) token[key] = await api.login(`${key}@test.local`);
  });

  after(async () => {
    await api.close();
  });

  test("Line Managers and HODs raise requisitions for their own department; HR for any", async () => {
    assert.equal((await as("ali").post("/hiring/requisitions", base())).status, 403);
    assert.equal((await as("hamza").post("/hiring/requisitions", base({ departmentId: dept.Finance }))).status, 403);
    const opts = (await as("hamza").get("/hiring/options")).data;
    assert.deepEqual(opts.departments.map((d: { name: string }) => d.name), ["Engineering"]);
    assert.equal(opts.canSeeSalary, false);
    assert.equal((await as("hr").get("/hiring/options")).data.departments.length, 3);
    const draft = await as("hamza").post("/hiring/requisitions", base({ suggestedSalaryMin: 150000, suggestedSalaryMax: 200000 }));
    ok(draft, 201);
    req.newPos = draft.data.id;
    assert.equal((await prisma.requisition.findUniqueOrThrow({ where: { id: req.newPos } })).status, "DRAFT");
  });

  test("a new position goes Line Manager -> HOD -> Finance -> Management -> HR, and Finance must confirm the budget", async () => {
    const submitted = await as("hamza").put(`/hiring/requisitions/${req.newPos}`, base({ suggestedSalaryMin: 150000, suggestedSalaryMax: 200000, submit: true }));
    ok(submitted);
    // Hamza raised it and is the hiring manager: the Line Manager step is his own and is left out.
    assert.deepEqual(await stepsOf(req.newPos!), ["HOD", "Finance", "Management", "HR"]);
    const requestId = await requestOf(req.newPos!);
    ok(await as("nadia").post(`/requests/${requestId}/approve`));
    const noBudget = await as("fin").post(`/requests/${requestId}/approve`);
    assert.equal(noBudget.status, 400);
    assert.match(noBudget.data.message, /Confirm the budget/);
    ok(await as("fin").post(`/requests/${requestId}/approve`, { salaryMin: 160000, salaryMax: 210000, budgetNote: "Within the 2027 plan" }));
    ok(await as("ceo").post(`/requests/${requestId}/approve`));
    ok(await as("hr").post(`/requests/${requestId}/approve`));
    const r = await prisma.requisition.findUniqueOrThrow({ where: { id: req.newPos } });
    assert.equal(r.status, "APPROVED");
    assert.equal(Number(r.salaryMin), 160000);
    assert.equal((await notes("hr", "Approved, ready to post")).length, 1, "HR is told the position is ready to post");

    // Salaries: the requester sees only their suggestion; Finance sees the confirmed budget; Ali has no access.
    const mine = (await as("hamza").get(`/hiring/requisitions/${req.newPos}`)).data;
    assert.equal(mine.budget, null);
    assert.equal(mine.suggestedSalary.min, 150000);
    assert.equal((await as("fin").get(`/hiring/requisitions/${req.newPos}`)).data.budget.max, 210000);
    assert.equal((await as("ali").get(`/hiring/requisitions/${req.newPos}`)).status, 403);
  });

  test("a replacement at the same grade within headcount goes Line Manager -> HOD -> HR; a different grade adds Finance", async () => {
    const exit = await makeExit("ali", day(30));
    const opts = (await as("hamza").get("/hiring/options")).data;
    assert.ok(opts.exits.some((e: { exitCaseId: number; grade: string }) => e.exitCaseId === exit.id && e.grade === "G5"));
    const same = await as("hamza").post("/hiring/requisitions", base({ reason: "REPLACEMENT", exitCaseId: exit.id, submit: true }));
    ok(same, 201);
    req.replacement = same.data.id;
    assert.deepEqual(await stepsOf(req.replacement!), ["HOD", "HR"]);
    const twice = await as("hamza").post("/hiring/requisitions", base({ reason: "REPLACEMENT", exitCaseId: exit.id }));
    assert.match(twice.data.message, /already a requisition for this replacement/);

    const zainExit = await makeExit("zain", day(30));
    const higher = await as("hamza").post("/hiring/requisitions", base({ title: "Senior QA Engineer", grade: "G6", reason: "REPLACEMENT", exitCaseId: zainExit.id, submit: true }));
    ok(higher, 201);
    req.higher = higher.data.id;
    assert.deepEqual(await stepsOf(req.higher!), ["HOD", "Finance", "HR"]);
    assert.equal((await prisma.requisition.findUniqueOrThrow({ where: { id: req.higher } })).gradeChanged, true);

    const exitView = (await as("hr").get(`/exits/${exit.id}`)).data;
    assert.equal(exitView.replacements[0].id, req.replacement);
  });

  test("over the approved headcount (set by HR) a replacement also goes through Finance and Management", async () => {
    assert.equal((await as("fin").put(`/hiring/headcount/${dept.Engineering}`, { approvedHeadcount: 4 })).status, 403);
    ok(await as("hr").put(`/hiring/headcount/${dept.Engineering}`, { approvedHeadcount: 7 }));
    const hc = (await as("fin").get("/hiring/headcount")).data.find((d: { departmentId: number }) => d.departmentId === dept.Engineering);
    // 5 active - 2 leaving + open positions (1 new + 1 + 1 replacements) = 6
    assert.equal(hc.projected, 6);
    assert.equal(hc.over, false);
    // Two more for the same leaver would make 7 + 1 = over by one.
    const exit = await makeExit("sara", day(20));
    const over = await as("hamza").post("/hiring/requisitions", base({ grade: "", reason: "REPLACEMENT", exitCaseId: exit.id, headcount: 3, submit: true }));
    ok(over, 201);
    assert.deepEqual(await stepsOf(over.data.id), ["HOD", "Finance", "Management", "HR"]);
    assert.equal((await prisma.requisition.findUniqueOrThrow({ where: { id: over.data.id } })).overHeadcount, true);
    req.over = over.data.id;
  });

  test("returned requisitions go back to the requester as a draft; rejected or withdrawn ones are cancelled", async () => {
    const first = await requestOf(req.over!);
    ok(await as("nadia").post(`/requests/${first}/return`, { comment: "One replacement is enough" }));
    const back = await prisma.requisition.findUniqueOrThrow({ where: { id: req.over } });
    assert.equal(back.status, "DRAFT");
    assert.equal((await as("hamza").put(`/requests/${first}/resubmit`, { reason: "x" })).status, 400);
    const exitId = back.exitCaseId!;
    ok(await as("hamza").put(`/hiring/requisitions/${req.over}`, base({ grade: "", reason: "REPLACEMENT", exitCaseId: exitId, headcount: 1, submit: true })));
    const second = await requestOf(req.over!);
    assert.notEqual(second, first);
    assert.deepEqual(await stepsOf(req.over!), ["HOD", "HR"]);
    ok(await as("nadia").post(`/requests/${second}/reject`, { comment: "Freeze on this team" }));
    assert.equal((await prisma.requisition.findUniqueOrThrow({ where: { id: req.over } })).status, "CANCELLED");

    const higherRequest = await requestOf(req.higher!);
    ok(await as("hamza").post(`/requests/${higherRequest}/cancel`));
    assert.equal((await prisma.requisition.findUniqueOrThrow({ where: { id: req.higher } })).status, "CANCELLED");
  });

  test("HR posts internal first for 7 days, then external too; eligibility rules for applying", async () => {
    ok(await prisma.requisition.update({ where: { id: req.newPos }, data: { headcount: 2 } }).then(() => ({ status: 200, data: {} })));
    const posted = await as("hr").post(`/hiring/requisitions/${req.newPos}/post`, {
      scope: "BOTH", description: "Build and run payment services.", requirements: "Node.js, PostgreSQL, 3 years' experience", closingDate: day(21),
    });
    ok(posted);
    assert.equal(posted.data.externalFrom, day(7));
    assert.match((await as("hr").post(`/hiring/requisitions/${req.newPos}/candidates`, { name: "Early Bird" })).data.message, new RegExp(`from ${day(7)}`));
    assert.ok((await notes("kamal", "Internal job")).length >= 1);

    const kamalJobs = (await as("kamal").get("/hiring/jobs")).data;
    assert.deepEqual(kamalJobs.eligibility, []);
    assert.equal(kamalJobs.jobs[0].title, "Backend Developer");
    assert.equal(kamalJobs.jobs[0].salaryMin, undefined, "no salary on the job posting");
    assert.match((await as("sara").get("/hiring/jobs")).data.eligibility.join(), /probation|exit/);
    assert.match((await as("neo").get("/hiring/jobs")).data.eligibility.join(), /12 months in your current role/);
    assert.equal((await as("neo").post(`/hiring/jobs/${req.newPos}/apply`, { note: "Keen" })).status, 400);

    // Minimum performance rating: a setting, off by default.
    ok(await as("hr").put("/settings", { "hiring.minPerformanceRating": "3" }));
    const cycle = await prisma.performanceCycle.create({
      data: { name: "H1", startDate: toDate(day(-200)), endDate: toDate(day(-20)), goalsDueDate: toDate(day(-180)), reviewOpensDate: toDate(day(-40)), reviewDueDate: toDate(day(-10)), createdById: id.hr! },
    });
    await prisma.scorecard.create({ data: { cycleId: cycle.id, employeeId: id.kamal!, stage: "ACKNOWLEDGED", finalScore: 2.1, finalBand: "Needs Improvement", completedAt: new Date() } });
    assert.match((await as("kamal").get("/hiring/jobs")).data.eligibility.join(), /below the minimum of Meets Expectations/);
    ok(await as("hr").put("/settings", { "hiring.minPerformanceRating": "0" }));
    assert.deepEqual((await as("kamal").get("/hiring/jobs")).data.eligibility, []);
  });

  test("applications are confidential until shortlisting; then the current and the hiring manager are told", async () => {
    const applied = await as("kamal").post(`/hiring/jobs/${req.newPos}/apply`, { note: "I have built our payment reconciliation scripts." });
    ok(applied, 201);
    const appId = applied.data.id as number;
    assert.match((await notes("kamal", "Application received"))[0]!.body, /current manager is told only if you are shortlisted/);
    assert.equal((await as("kamal").post(`/hiring/jobs/${req.newPos}/apply`, { note: "again" })).status, 400);
    assert.equal((await notes("fin", "Kamal Shah is shortlisted")).length, 0);
    // The hiring manager does not see applicants before shortlisting.
    assert.equal((await as("hamza").get(`/hiring/requisitions/${req.newPos}`)).data.applications.length, 0);
    assert.equal((await as("hamza").post(`/hiring/applications/${appId}/feedback`, { recommendation: "HIRE", comment: "Strong" })).status, 403);

    const shortlisted = await as("hr").patch(`/hiring/applications/${appId}/stage`, { stage: "SHORTLISTED", note: "Relevant experience" });
    ok(shortlisted);
    assert.equal(shortlisted.data.managerNotified, true);
    assert.equal((await notes("fin", "Kamal Shah is shortlisted")).length, 1, "the current manager is told at shortlisting");
    assert.equal((await notes("hamza", "Shortlisted for")).length, 1);
    assert.equal((await as("hamza").get(`/hiring/requisitions/${req.newPos}`)).data.applications.length, 1);
    ok(await as("hamza").post(`/hiring/applications/${appId}/feedback`, { recommendation: "HIRE", comment: "Clear thinking on system design." }), 201);
    ok(await as("hr").patch(`/hiring/applications/${appId}/stage`, { stage: "INTERVIEW" }));
    assert.equal((await notes("fin", "Kamal Shah is shortlisted")).length, 1, "told once only");
    req.kamalApp = appId;
  });

  test("HR adds external candidates after the internal window; not-selected candidates get a polite email", async () => {
    await prisma.requisition.update({ where: { id: req.newPos }, data: { externalFrom: toDate(day(-1)) } });
    const ext = await as("hr").post(`/hiring/requisitions/${req.newPos}/candidates`, { name: "Rabia Noor", email: "rabia@example.com", phone: "0300-1234567", note: "Referred by a client" });
    ok(ext, 201);
    const other = await as("hr").post(`/hiring/requisitions/${req.newPos}/candidates`, { name: "Usama Iqbal", email: "usama@example.com" });
    ok(other, 201);
    outbox.length = 0;
    ok(await as("hr").patch(`/hiring/applications/${other.data.id}/stage`, { stage: "NOT_SELECTED", note: "Not enough experience" }));
    const mail = outbox.find((m) => m.to === "usama@example.com");
    assert.ok(mail, "polite email to the external candidate");
    assert.match(mail.text, /Thank you for your interest in Backend Developer/);
    req.rabia = ext.data.id;
  });

  test("an internal hire moves the employee and offers a DRAFT replacement for the role they leave", async () => {
    const hired = await as("hr").post(`/hiring/applications/${req.kamalApp}/hire`, { effectiveDate: day(14) });
    ok(hired);
    const kamal = await prisma.employee.findUniqueOrThrow({ where: { id: id.kamal } });
    assert.equal(kamal.departmentId, dept.Engineering);
    assert.equal(kamal.managerId, id.hamza);
    assert.equal(kamal.designation, "Backend Developer");
    assert.equal(ymd(kamal.roleSince!), day(14));
    const draft = await prisma.requisition.findUniqueOrThrow({ where: { id: hired.data.draftReplacementId } });
    assert.equal(draft.status, "DRAFT");
    assert.equal(draft.requestId, null, "not submitted");
    assert.equal(draft.departmentId, dept.Finance);
    assert.equal(draft.title, "Accountant");
    assert.equal(draft.requestedById, id.fin);
    assert.equal((await notes("fin", "Draft replacement")).length, 1);
    assert.equal((await prisma.requisition.findUniqueOrThrow({ where: { id: req.newPos } })).status, "POSTED", "one of two places filled");
  });

  test("an external hire creates the employee through Add employee; the position is filled and the rest are told", async () => {
    await as("hr").patch(`/hiring/applications/${req.rabia}/stage`, { stage: "OFFER" });
    const late = await as("hr").post(`/hiring/requisitions/${req.newPos}/candidates`, { name: "Late Applicant", email: "late@example.com" });
    ok(late, 201);
    outbox.length = 0;
    const created = await as("hr").post("/employees", {
      fullName: "Rabia Noor", email: "rabia.noor@test.local", joiningDate: day(30), departmentId: dept.Engineering, managerId: id.hamza,
      designation: "Backend Developer", grade: "G5", applicationId: req.rabia,
    });
    ok(created, 201);
    const app = await prisma.jobApplication.findUniqueOrThrow({ where: { id: req.rabia } });
    assert.equal(app.stage, "HIRED");
    assert.equal(app.hiredEmployeeId, created.data.id);
    const r = await prisma.requisition.findUniqueOrThrow({ where: { id: req.newPos } });
    assert.equal(r.status, "FILLED");
    assert.equal((await prisma.jobApplication.findUniqueOrThrow({ where: { id: late.data.id } })).stage, "NOT_SELECTED");
    assert.ok(outbox.some((m) => m.to === "late@example.com"));
    // An internal applicant cannot be hired through Add employee.
    const wrong = await as("hr").post("/employees", { fullName: "X", email: "x@test.local", joiningDate: day(30), applicationId: req.kamalApp });
    assert.equal(wrong.status, 400);
  });
});
