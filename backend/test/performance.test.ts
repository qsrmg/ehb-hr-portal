import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma.js";
import { addDays, todayYmd, toDate, ymd } from "../src/lib/dates.js";
import { PASSWORD, resetDatabase, startServer, useMemoryTransport } from "./helpers.js";

const day = (n: number) => ymd(addDays(toDate(todayYmd()), n));
const plusMonths = (ymdStr: string, n: number) => {
  const d = toDate(ymdStr);
  d.setUTCMonth(d.getUTCMonth() + n);
  return ymd(d);
};

describe("Performance (BSC)", () => {
  let api: Awaited<ReturnType<typeof startServer>>;
  const token: Record<string, string> = {};
  const id: Record<string, number> = {};
  const dept: Record<string, number> = {};
  const sc: Record<string, number> = {};
  let cycleId: number;
  const START = day(-30);

  const as = (who: string) => ({
    get: (path: string) => api.call(token[who]!, "GET", path),
    post: (path: string, body: Record<string, unknown> = {}) => api.call(token[who]!, "POST", path, body),
    put: (path: string, body: Record<string, unknown>) => api.call(token[who]!, "PUT", path, body),
    patch: (path: string, body: Record<string, unknown>) => api.call(token[who]!, "PATCH", path, body),
  });
  const ok = (res: { status: number; data: { message?: string } }, status = 200) => assert.equal(res.status, status, res.data.message ?? "");
  const notes = (who: string, prefix: string) => prisma.notification.findMany({ where: { employeeId: id[who], title: { startsWith: prefix } } });
  const stage = async (key: string) => (await prisma.scorecard.findUniqueOrThrow({ where: { id: sc[key] } })).stage;
  const kpis = (key: string) => prisma.scorecardKpi.findMany({ where: { scorecardId: sc[key] }, orderBy: { order: "asc" } });

  const TEMPLATE = [
    { perspective: "CUSTOMER", title: "Delivery on time", measure: "Sprints delivered on time", target: "90%", weight: 40 },
    { perspective: "INTERNAL_PROCESS", title: "Code quality", measure: "Defects per release", target: "< 5", weight: 30 },
    { perspective: "LEARNING_GROWTH", title: "Learning", measure: "Courses completed", target: "2", weight: 20 },
    { perspective: "FINANCIAL", title: "Cloud cost", measure: "Monthly cost vs budget", target: "Within budget", weight: 10 },
  ];

  before(async () => {
    await resetDatabase();
    useMemoryTransport();
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    for (const name of ["Management", "Engineering", "Sales"]) dept[name] = (await prisma.department.create({ data: { name } })).id;
    const person = async (key: string, fullName: string, d: string, roles: string[], managerId: number | null, joiningDate = "2024-01-01") => {
      const e = await prisma.employee.create({
        data: {
          code: `EHB-2024-${String(Object.keys(id).length + 1).padStart(3, "0")}`, email: `${key}@test.local`, fullName, passwordHash, mustChangePassword: false,
          joiningDate: toDate(joiningDate), departmentId: dept[d], managerId, roles: ["EMPLOYEE", ...roles] as never,
        },
      });
      id[key] = e.id;
    };
    await person("ceo", "Imran Qureshi", "Management", ["MANAGEMENT"], null);
    await person("hr", "Ayesha Siddiqui", "Management", ["HR"], id.ceo!);
    await person("fin", "Bilal Ahmed", "Management", ["FINANCE"], id.ceo!);
    await person("usman", "Usman Tariq", "Management", ["ADMIN"], id.ceo!);
    await person("nadia", "Nadia Khan", "Engineering", ["HOD"], id.ceo!);
    await person("hamza", "Hamza Malik", "Engineering", ["LINE_MANAGER"], id.nadia!);
    await person("ali", "Ali Raza", "Engineering", [], id.hamza!);
    await person("sara", "Sara Javed", "Engineering", [], id.hamza!, plusMonths(START, 2)); // joined in the first 3 months: included
    await person("late", "Late Joiner", "Engineering", [], id.hamza!, plusMonths(START, 4)); // joined later: next cycle
    await person("kamran", "Kamran Ali", "Sales", ["LINE_MANAGER", "HOD"], id.ceo!);
    await person("zaid", "Zaid Khan", "Sales", [], id.kamran!);
    await prisma.department.update({ where: { id: dept.Engineering }, data: { hodId: id.nadia } });
    await prisma.department.update({ where: { id: dept.Sales }, data: { hodId: id.kamran } });
    await prisma.leaveType.create({ data: { code: "AL", name: "Annual Leave", annualQuota: 14 } });
    api = await startServer();
    for (const key of Object.keys(id)) token[key] = await api.login(`${key}@test.local`);
  });

  after(async () => {
    await api.close();
  });

  test("the rating names and bands are settings, and the bands must run downwards", async () => {
    const rules = (await as("ali").get("/performance/rules")).data;
    assert.equal(rules.labels[5], "Outstanding");
    assert.deepEqual(rules.bands.map((b: { from: number }) => b.from), [4.5, 3.5, 2.5, 1.5]);
    assert.equal(rules.maxKpis, 10);
    assert.equal(rules.minKpiWeight, 5);
    const bad = await as("hr").put("/settings", { "performance.band4From": "4.6" });
    assert.equal(bad.status, 400);
    assert.match(bad.data.message, /lower than the band above/);
    ok(await as("hr").put("/settings", { "performance.rating3": "Solid Performer" }));
    assert.equal((await as("ali").get("/performance/rules")).data.labels[3], "Solid Performer");
    ok(await as("hr").put("/settings", { "performance.rating3": "Meets Expectations" }));
  });

  test("HR creates department templates: at most 10 KPIs, each at least 5%, 100% in total, perspective minimum", async () => {
    const put = (kpis: unknown[]) => as("hr").put(`/performance/templates/${dept.Engineering}`, { kpis });
    assert.match((await put([{ ...TEMPLATE[0], weight: 96 }, { ...TEMPLATE[1], weight: 4 }])).data.message, /at least 5%/);
    assert.match((await put(Array.from({ length: 11 }, (_, i) => ({ ...TEMPLATE[0], title: `KPI ${i}`, weight: i < 10 ? 9 : 10 })))).data.message, /at most 10 KPIs/);
    assert.match((await put(TEMPLATE.slice(0, 3))).data.message, /add up to 90%/);
    ok(await as("hr").put("/settings", { "performance.minPerspectiveWeight": "15" }));
    assert.match((await put(TEMPLATE)).data.message, /Financial has 10%; each perspective needs at least 15%/);
    ok(await as("hr").put("/settings", { "performance.minPerspectiveWeight": "0" }));
    ok(await put(TEMPLATE));
    assert.equal((await as("hamza").put(`/performance/templates/${dept.Engineering}`, { kpis: TEMPLATE })).status, 403);
  });

  test("a cycle includes everyone active at the start plus joiners in its first 3 months, starting from the template", async () => {
    const res = await as("hr").post("/performance/cycles", {
      name: "Test cycle", startDate: START, endDate: day(150), goalsDueDate: day(10), reviewOpensDate: day(120), reviewDueDate: day(170),
    });
    ok(res, 201);
    cycleId = res.data.id;
    const cards = await prisma.scorecard.findMany({ where: { cycleId }, include: { employee: { select: { email: true } }, kpis: true } });
    const emails = cards.map((c) => c.employee.email.split("@")[0]);
    assert.ok(emails.includes("sara"), "a joiner in the first 3 months is included");
    assert.ok(!emails.includes("late"), "a later joiner waits for the next cycle");
    for (const key of ["ali", "sara", "zaid", "hamza"]) sc[key] = cards.find((c) => c.employeeId === id[key])!.id;
    assert.equal(cards.find((c) => c.employeeId === id.ali)!.kpis.length, 4, "Engineering scorecards start from the template");
    assert.equal(cards.find((c) => c.employeeId === id.zaid)!.kpis.length, 0, "Sales has no template");
    const cycle = await prisma.performanceCycle.findUniqueOrThrow({ where: { id: cycleId } });
    assert.equal(ymd(cycle.checkInDate!), plusMonths(START, 3), "the check-in is at three months");
    assert.equal((await notes("hamza", "Set goals")).length, 1);

    // A new employee who joins within the first 3 months is added automatically.
    const created = await as("hr").post("/employees", { email: "new@test.local", fullName: "New Starter", joiningDate: plusMonths(START, 1), departmentId: dept.Engineering, managerId: id.hamza });
    ok(created, 201);
    assert.ok(await prisma.scorecard.findUnique({ where: { cycleId_employeeId: { cycleId, employeeId: created.data.id } } }));
  });

  test("goals: the Line Manager adjusts and sends them, the employee acknowledges or asks for changes, the HOD approves", async () => {
    const draft = [...TEMPLATE.slice(0, 3), { ...TEMPLATE[3], weight: 15 }];
    const editByAli = await as("ali").put(`/performance/scorecards/${sc.ali}/kpis`, { kpis: draft });
    assert.equal(editByAli.status, 403);
    const saved = await as("hamza").put(`/performance/scorecards/${sc.ali}/kpis`, { kpis: draft });
    ok(saved);
    assert.match(saved.data.problems.join(), /add up to 105%/);
    assert.match((await as("hamza").post(`/performance/scorecards/${sc.ali}/send-goals`)).data.message, /must total 100%/);
    ok(await as("hamza").post(`/performance/scorecards/${sc.ali}/template/load`));
    ok(await as("hamza").post(`/performance/scorecards/${sc.ali}/send-goals`));
    assert.equal(await stage("ali"), "GOALS_WITH_EMPLOYEE");

    ok(await as("ali").post(`/performance/scorecards/${sc.ali}/goals/request-changes`, { comment: "Please lower the learning target" }));
    assert.equal(await stage("ali"), "GOAL_SETTING");
    assert.equal((await notes("hamza", "Changes asked")).length, 1);
    ok(await as("hamza").post(`/performance/scorecards/${sc.ali}/send-goals`));
    ok(await as("ali").post(`/performance/scorecards/${sc.ali}/goals/acknowledge`, { comment: "Agreed" }));
    assert.equal(await stage("ali"), "GOALS_APPROVAL");
    const request = (await prisma.scorecard.findUniqueOrThrow({ where: { id: sc.ali } })).goalsRequestId!;
    const steps = await prisma.requestStep.findMany({ where: { requestId: request } });
    assert.deepEqual(steps.map((s) => s.label), ["HOD"]);
    assert.equal(steps[0]!.approverId, id.nadia);

    // Returned by the HOD: back to the Line Manager.
    ok(await as("nadia").post(`/requests/${request}/return`, { comment: "Add a customer satisfaction KPI" }));
    assert.equal(await stage("ali"), "GOAL_SETTING");
    assert.equal((await notes("hamza", "Goals returned")).length, 1);
    ok(await as("hamza").post(`/performance/scorecards/${sc.ali}/send-goals`));
    ok(await as("ali").post(`/performance/scorecards/${sc.ali}/goals/acknowledge`));
    const second = (await prisma.scorecard.findUniqueOrThrow({ where: { id: sc.ali } })).goalsRequestId!;
    assert.notEqual(second, request);
    const reject = await as("nadia").post(`/requests/${second}/reject`, { comment: "No" });
    assert.equal(reject.status, 400, "performance requests are returned, not rejected");
    ok(await as("nadia").post(`/requests/${second}/approve`));
    assert.equal(await stage("ali"), "ACTIVE");
    assert.equal((await as("ali").post(`/requests/${second}/cancel`)).status, 400);
  });

  test("when the Line Manager is also the HOD there is no duplicate step: goals are agreed on acknowledgement", async () => {
    ok(await as("kamran").put(`/performance/scorecards/${sc.zaid}/kpis`, { kpis: [{ perspective: "CUSTOMER", title: "New accounts", measure: "Accounts signed", target: "12", weight: 100 }] }));
    ok(await as("kamran").post(`/performance/scorecards/${sc.zaid}/send-goals`));
    const ack = await as("zaid").post(`/performance/scorecards/${sc.zaid}/goals/acknowledge`);
    ok(ack);
    assert.equal(ack.data.requestId, null);
    assert.equal(await stage("zaid"), "ACTIVE");
  });

  test("ratings are confidential: Finance and Admin cannot open a scorecard", async () => {
    assert.equal((await as("fin").get(`/performance/scorecards/${sc.ali}`)).status, 403);
    assert.equal((await as("usman").get(`/performance/scorecards/${sc.ali}`)).status, 403);
    assert.equal((await as("sara").get(`/performance/scorecards/${sc.ali}`)).status, 403);
    for (const who of ["ali", "hamza", "nadia", "hr", "ceo"]) ok(await as(who).get(`/performance/scorecards/${sc.ali}`));
    assert.equal((await as("fin").get("/performance/cycles")).status, 403);
  });

  test("check-ins are comments only, and the self-review opens on the review date", async () => {
    ok(await as("hamza").post(`/performance/scorecards/${sc.ali}/check-ins`, { comment: "Good progress on delivery" }), 201);
    ok(await as("ali").post(`/performance/scorecards/${sc.ali}/check-ins`, { comment: "Started the second course" }), 201);
    const early = await as("ali").put(`/performance/scorecards/${sc.ali}/self-review`, { kpis: [], submit: false });
    assert.equal(early.status, 403);
    assert.match(early.data.message, /opens on/);
    await prisma.performanceCycle.update({ where: { id: cycleId }, data: { reviewOpensDate: toDate(day(-1)) } });
    const k = await kpis("ali");
    const missing = await as("ali").put(`/performance/scorecards/${sc.ali}/self-review`, { kpis: [{ id: k[0]!.id, selfRating: 4 }], submit: true });
    assert.match(missing.data.message, /Rate every KPI/);
    ok(await as("ali").put(`/performance/scorecards/${sc.ali}/self-review`, {
      kpis: k.map((x, i) => ({ id: x.id, actual: `Actual ${i + 1}`, selfRating: 4 })), comment: "A good half-year", submit: true,
    }));
    assert.equal(await stage("ali"), "MANAGER_REVIEW");
  });

  test("Line Manager rates, then HOD and HR sign off; HR calibrates with a required reason and the original stays in the history", async () => {
    const k = await kpis("ali");
    const rated = k.map((x, i) => ({ id: x.id, managerRating: [4, 3, 4, 5][i], managerComment: "Fair" }));
    assert.match((await as("hamza").put(`/performance/scorecards/${sc.ali}/manager-review`, { kpis: rated, submit: true })).data.message, /overall comment/);
    const submitted = await as("hamza").put(`/performance/scorecards/${sc.ali}/manager-review`, { kpis: rated, comment: "Strong delivery, keep improving quality", submit: true });
    ok(submitted);
    assert.equal(await stage("ali"), "SIGN_OFF");
    const requestId = submitted.data.requestId as number;
    assert.deepEqual((await prisma.requestStep.findMany({ where: { requestId }, orderBy: { order: "asc" } })).map((s) => s.label), ["HOD", "HR"]);

    // The employee does not see ratings before the result is released.
    const early = (await as("ali").get(`/performance/scorecards/${sc.ali}`)).data;
    assert.equal(early.kpis[0].managerRating, null);
    assert.equal(early.score, null);

    // HR cannot calibrate before its own step.
    assert.equal((await as("hr").patch(`/performance/scorecards/${sc.ali}/kpis/${k[1]!.id}/final-rating`, { rating: 4, reason: "Matches peers" })).status, 403);
    ok(await as("nadia").post(`/requests/${requestId}/approve`));
    assert.match((await as("hr").patch(`/performance/scorecards/${sc.ali}/kpis/${k[1]!.id}/final-rating`, { rating: 4 })).data.message, /reason/);
    ok(await as("hr").patch(`/performance/scorecards/${sc.ali}/kpis/${k[1]!.id}/final-rating`, { rating: 4, reason: "In line with the team's quality results" }));
    ok(await as("hr").post(`/requests/${requestId}/approve`));
    assert.equal(await stage("ali"), "COMPLETED");

    // 40%x4 + 30%x4 + 20%x4 + 10%x5 = 4.1 -> rating 4.
    const result = (await as("ali").get(`/performance/scorecards/${sc.ali}`)).data;
    assert.equal(result.score, 4.1);
    assert.equal(result.band, "Exceeds Expectations");
    assert.equal(result.kpis[1].managerRating, 3, "the manager's original rating stays visible");
    assert.equal(result.kpis[1].finalRating, 4);
    assert.equal(result.adjustments[0].from, 3);
    assert.equal(result.adjustments[0].to, 4);
    assert.equal(result.adjustments[0].kind, "CALIBRATION");
    assert.equal((await notes("ali", "Your performance result is ready")).length, 1);
  });

  test("the employee may appeal once to HR; HR's decision is final; then the employee acknowledges", async () => {
    const k = await kpis("ali");
    assert.match((await as("ali").post(`/performance/scorecards/${sc.ali}/appeal`, { reason: "short" })).data.message, /Explain why/);
    ok(await as("ali").post(`/performance/scorecards/${sc.ali}/appeal`, { reason: "Delivery was 98% on time, above the 90% target." }));
    assert.equal(await stage("ali"), "APPEAL");
    assert.equal((await notes("hr", "Performance appeal")).length, 1);
    ok(await as("hr").patch(`/performance/scorecards/${sc.ali}/kpis/${k[0]!.id}/final-rating`, { rating: 5, reason: "Delivery evidence confirmed" }));
    const decided = await as("hr").post(`/performance/scorecards/${sc.ali}/appeal/decide`, { decision: "The delivery evidence supports a higher rating." });
    ok(decided);
    assert.equal(decided.data.changed, true);
    // 40%x5 + 30%x4 + 20%x4 + 10%x5 = 4.5 -> rating 5.
    const after = (await as("ali").get(`/performance/scorecards/${sc.ali}`)).data;
    assert.equal(after.score, 4.5);
    assert.equal(after.band, "Outstanding");
    assert.equal(after.appeal.changed, true);
    assert.equal((await as("ali").post(`/performance/scorecards/${sc.ali}/appeal`, { reason: "Trying a second appeal here." })).status, 403);
    ok(await as("ali").post(`/performance/scorecards/${sc.ali}/acknowledge`, { comment: "Thank you" }));
    assert.equal(await stage("ali"), "ACKNOWLEDGED");
    const pdf = await fetch(`${api.base}/performance/scorecards/${sc.ali}/pdf`, { headers: { Authorization: `Bearer ${token.ali}` } });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get("content-type"), "application/pdf");
  });

  test("HR sees the cycle overview with stages and the rating distribution, and closes the cycle when nothing is waiting", async () => {
    const overview = (await as("hr").get(`/performance/cycles/${cycleId}`)).data;
    assert.equal(overview.distribution.find((d: { rating: number }) => d.rating === 5).count, 1);
    assert.equal(overview.stages.find((s: { stage: string }) => s.stage === "ACKNOWLEDGED").count, 1);
    ok(await as("ceo").get(`/performance/cycles/${cycleId}`));
    // Sara's goals wait with the HOD: the cycle cannot close yet.
    ok(await as("hamza").post(`/performance/scorecards/${sc.sara}/send-goals`));
    ok(await as("sara").post(`/performance/scorecards/${sc.sara}/goals/acknowledge`));
    assert.match((await as("hr").post(`/performance/cycles/${cycleId}/close`)).data.message, /still waiting/);
    const goals = (await prisma.scorecard.findUniqueOrThrow({ where: { id: sc.sara } })).goalsRequestId!;
    ok(await as("nadia").post(`/requests/${goals}/approve`));
    ok(await as("hr").post(`/performance/cycles/${cycleId}/close`));
    assert.equal((await as("ali").get(`/performance/scorecards/${sc.ali}`)).data.can.checkIn, false);
  });
});
