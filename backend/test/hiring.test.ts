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

// Employment Eligibility Policy §10/§12, slice 2: the internal-application qualification gate (off by
// default) and the Management exception. A separate describe with its own fixtures, so turning settings on
// does not affect the sequential requisition tests above.
describe("Employment Eligibility Policy: qualification gate and exception", () => {
  let api: Awaited<ReturnType<typeof startServer>>;
  const token: Record<string, string> = {};
  const id: Record<string, number> = {};
  let engId: number;

  const as = (who: string) => ({
    get: (path: string) => api.call(token[who]!, "GET", path),
    post: (path: string, body: Record<string, unknown> = {}) => api.call(token[who]!, "POST", path, body),
    put: (path: string, body: Record<string, unknown>) => api.call(token[who]!, "PUT", path, body),
    patch: (path: string, body: Record<string, unknown>) => api.call(token[who]!, "PATCH", path, body),
  });
  const ok = (res: { status: number; data: { message?: string } }, status = 200) => assert.equal(res.status, status, res.data.message ?? "");
  const forbidden = (res: { status: number }) => assert.equal(res.status, 403);
  const OTHER_ROLES = ["manager", "hod", "finance", "admin"];

  const makeJob = (overrides: Record<string, unknown> = {}) =>
    prisma.requisition.create({
      data: {
        requestedById: id.hr!, departmentId: engId, title: "Backend Developer", reportsToId: id.manager!,
        targetStartDate: toDate(day(30)), justification: "Growth", reason: "NEW", minimumQualification: "BACHELORS",
        status: "POSTED", scope: "BOTH", description: "Build things.", requirements: "Experience with Node.js",
        postedAt: new Date(), postedById: id.hr!, closingDate: toDate(day(20)), externalFrom: toDate(day(-1)),
        ...overrides,
      },
    });
  let nextFreshId = 900;
  /** A brand-new employee with no qualification records, for tests that need a clean slate. */
  const freshEmployee = async (key: string, fullName: string) => {
    nextFreshId++;
    const e = await prisma.employee.create({
      data: {
        code: `EHB-2024-${nextFreshId}`, email: `${key}@test.local`, fullName, passwordHash: await bcrypt.hash(PASSWORD, 4),
        mustChangePassword: false, joiningDate: toDate("2024-01-01"), departmentId: engId, managerId: id.manager, roles: ["EMPLOYEE"],
      },
    });
    id[key] = e.id;
    token[key] = await api.login(`${key}@test.local`);
    return e;
  };

  /** HR adds a qualification record for `who` and, if asked, verifies it in the same call. */
  const giveQualification = async (who: string, type: string, verified: boolean) => {
    const fd = new FormData();
    fd.append("type", type);
    fd.append("evidenceType", type === "PROFESSIONAL_CERTIFICATION" ? "PROFESSIONAL_CERTIFICATION" : "DEGREE_CERTIFICATE");
    fd.append("completed", "true");
    const created = await fetch(`${api.base}/employees/${id[who]}/qualifications`, { method: "POST", headers: { Authorization: `Bearer ${token.hr}` }, body: fd });
    const row = (await created.json()) as { id: number };
    if (verified) ok(await as("hr").patch(`/employees/${id[who]}/qualifications/${row.id}`, { verified: true }));
    return row.id;
  };

  before(async () => {
    await resetDatabase();
    useMemoryTransport();
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    const eng = await prisma.department.create({ data: { name: "Engineering" } });
    engId = eng.id;
    let n = 0;
    const person = async (key: string, fullName: string, roles: string[], managerId: number | null = null) => {
      n++;
      const e = await prisma.employee.create({
        data: {
          code: `EHB-2024-${String(n).padStart(3, "0")}`, email: `${key}@test.local`, fullName, passwordHash, mustChangePassword: false,
          joiningDate: toDate("2024-01-01"), departmentId: eng.id, managerId, roles: ["EMPLOYEE", ...roles] as never,
        },
      });
      id[key] = e.id;
      return e;
    };
    await person("ceo", "Imran Qureshi", ["MANAGEMENT"]);
    await person("hr", "Ayesha Siddiqui", ["HR"]);
    const manager = await person("manager", "Hamza Malik", ["LINE_MANAGER"]);
    const hod = await person("hod", "Nadia Khan", ["HOD"]);
    await prisma.department.update({ where: { id: eng.id }, data: { hodId: hod.id } });
    await person("finance", "Bilal Ahmed", ["FINANCE"]);
    await person("admin", "Usman Tariq", ["ADMIN"]);
    await person("employee", "Ali Raza", [], manager.id);

    api = await startServer();
    for (const key of Object.keys(id)) token[key] = await api.login(`${key}@test.local`);
  });

  after(async () => {
    await api.close();
  });

  test("the gate is off by default: an employee with no qualification record can still apply", async () => {
    const job = await makeJob();
    assert.deepEqual((await as("employee").get(`/hiring/jobs/${job.id}`)).data.eligibility, []);
    ok(await as("employee").post(`/hiring/jobs/${job.id}/apply`, {}), 201);
  });

  test("turned on: a missing or unverified qualification blocks applying, server-side, with no record detail in the message", async () => {
    ok(await as("hr").put("/settings", { "hiring.qualificationCheckEnabled": "1" }));
    const job = await makeJob();
    await giveQualification("employee", "PROFESSIONAL_CERTIFICATION", false); // on file, but not verified, and the wrong type anyway
    const eligibility = (await as("employee").get(`/hiring/jobs/${job.id}`)).data.eligibility as string[];
    assert.match(eligibility.join(), /verified Bachelor's degree/);
    assert.doesNotMatch(eligibility.join(), /PROFESSIONAL_CERTIFICATION|not verified|pending/i, "never describes the employee's actual records");
    const applied = await as("employee").post(`/hiring/jobs/${job.id}/apply`, {});
    assert.equal(applied.status, 400, "enforced on the apply endpoint itself, not only shown in the UI");
    assert.match(applied.data.message!, /verified Bachelor's degree/);
  });

  test("a verified Bachelor's degree clears the block", async () => {
    const job = await makeJob();
    await giveQualification("employee", "BACHELORS", true);
    assert.deepEqual((await as("employee").get(`/hiring/jobs/${job.id}`)).data.eligibility, []);
    ok(await as("employee").post(`/hiring/jobs/${job.id}/apply`, {}), 201);
  });

  test("a Higher Degree does not satisfy a Bachelor's requirement unless hiring.higherDegreeSatisfiesBachelors is also on", async () => {
    await freshEmployee("other", "Zain Ahmed");
    await giveQualification("other", "HIGHER_DEGREE", true);
    const job = await makeJob();
    assert.match((await as("other").get(`/hiring/jobs/${job.id}`)).data.eligibility.join(), /verified Bachelor's degree/);
    ok(await as("hr").put("/settings", { "hiring.higherDegreeSatisfiesBachelors": "1" }));
    assert.deepEqual((await as("other").get(`/hiring/jobs/${job.id}`)).data.eligibility, []);
    ok(await as("hr").put("/settings", { "hiring.higherDegreeSatisfiesBachelors": "0" }));
  });

  test("a professional-certification requirement needs a verified professional certification; a Bachelor's does not satisfy it", async () => {
    const job = await makeJob({ title: "Security Analyst", minimumQualification: "PROFESSIONAL_CERTIFICATION" });
    assert.match((await as("employee").get(`/hiring/jobs/${job.id}`)).data.eligibility.join(), /verified professional certification/);
    await giveQualification("employee", "PROFESSIONAL_CERTIFICATION", true);
    assert.deepEqual((await as("employee").get(`/hiring/jobs/${job.id}`)).data.eligibility, []);
  });

  test("OTHER is never auto-blocked, gate on or off", async () => {
    const job = await makeJob({ minimumQualification: "OTHER", minimumQualificationDetail: "Diploma in X" });
    assert.deepEqual((await as("employee").get(`/hiring/jobs/${job.id}`)).data.eligibility, []);
  });

  test("a Management exception clears the block for that one posting only; only HR may raise it, only Management may approve", async () => {
    await freshEmployee("sara", "Sara Javed");
    const job = await makeJob();
    const otherJob = await makeJob();
    assert.match((await as("sara").get(`/hiring/jobs/${job.id}`)).data.eligibility.join(), /verified Bachelor's degree/);

    for (const who of [...OTHER_ROLES, "sara"]) {
      forbidden(await as(who).post("/hiring/qualification-exceptions", { employeeId: id.sara, requisitionId: job.id, note: "Strong portfolio" }));
    }
    const raised = await as("hr").post("/hiring/qualification-exceptions", { employeeId: id.sara, requisitionId: job.id, note: "Strong portfolio, 6 years' experience" });
    ok(raised, 201);
    const requestId = raised.data.id as number;

    assert.ok(await prisma.auditLog.findFirst({ where: { action: "CREATE", entity: "QualificationExceptionRequest", entityId: String(requestId) } }));

    for (const who of OTHER_ROLES) {
      forbidden(await as(who).post(`/requests/${requestId}/approve`));
    }
    ok(await as("ceo").post(`/requests/${requestId}/approve`));

    assert.ok(await prisma.auditLog.findFirst({ where: { action: "GRANT", entity: "QualificationException" } }), "the grant is documented (§13)");
    const grantNote = await prisma.notification.findFirst({ where: { employeeId: id.sara, title: { startsWith: "You can now apply" } } });
    assert.ok(grantNote, "the employee is told their application can proceed");
    assert.doesNotMatch(grantNote!.body, /portfolio|experience/i, "no reason or note in the notification");

    assert.deepEqual((await as("sara").get(`/hiring/jobs/${job.id}`)).data.eligibility, [], "cleared for this posting");
    assert.match((await as("sara").get(`/hiring/jobs/${otherJob.id}`)).data.eligibility.join(), /verified Bachelor's degree/, "no precedent for another posting");

    const again = await as("hr").post("/hiring/qualification-exceptions", { employeeId: id.sara, requisitionId: job.id, note: "Repeat" });
    assert.equal(again.status, 400);
  });

  test("the exception request is visible to HR, Management and the employee themselves only", async () => {
    await freshEmployee("neo", "Neo Khan");
    const job = await makeJob();
    const raised = await as("hr").post("/hiring/qualification-exceptions", { employeeId: id.neo, requisitionId: job.id, note: "Second opinion from the HOD" });
    ok(raised, 201);
    const requestId = raised.data.id as number;
    for (const who of OTHER_ROLES) {
      forbidden(await as(who).get(`/requests/${requestId}`));
    }
    ok(await as("hr").get(`/requests/${requestId}`));
    ok(await as("ceo").get(`/requests/${requestId}`));
    ok(await as("neo").get(`/requests/${requestId}`));
  });

  test("a rejected exception leaves the applicant blocked, and the employee is never told", async () => {
    await freshEmployee("kamal", "Kamal Shah");
    const job = await makeJob();
    const raised = await as("hr").post("/hiring/qualification-exceptions", { employeeId: id.kamal, requisitionId: job.id, note: "Trying again" });
    const requestId = raised.data.id as number;
    ok(await as("ceo").post(`/requests/${requestId}/reject`, { comment: "Not convinced yet" }));
    assert.match((await as("kamal").get(`/hiring/jobs/${job.id}`)).data.eligibility.join(), /verified Bachelor's degree/);
    const told = await prisma.notification.findMany({ where: { employeeId: id.kamal } });
    assert.ok(!told.some((n) => /not convinced/i.test(n.body) || /reject/i.test(n.title)), "the employee is never told about the rejection");
  });

  test("the subject employee cannot approve or reject their own exception, even holding MANAGEMENT; another Management user still can", async () => {
    const vp = await prisma.employee.create({
      data: {
        code: "EHB-2024-950", email: "vp@test.local", fullName: "Vera Patel", passwordHash: await bcrypt.hash(PASSWORD, 4),
        mustChangePassword: false, joiningDate: toDate("2024-01-01"), departmentId: engId, managerId: id.manager, roles: ["EMPLOYEE", "MANAGEMENT"],
      },
    });
    id.vp = vp.id;
    token.vp = await api.login("vp@test.local");

    const job = await makeJob();
    const raised = await as("hr").post("/hiring/qualification-exceptions", { employeeId: vp.id, requisitionId: job.id, note: "Needs a decision" });
    ok(raised, 201);
    const requestId = raised.data.id as number;

    forbidden(await as("vp").post(`/requests/${requestId}/approve`));
    forbidden(await as("vp").post(`/requests/${requestId}/reject`, { comment: "No" }));

    ok(await as("ceo").post(`/requests/${requestId}/approve`));
    assert.deepEqual((await as("vp").get(`/hiring/jobs/${job.id}`)).data.eligibility, [], "another Management user (Imran) could still approve it");
  });
});
