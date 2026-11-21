import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma.js";
import { toDate, todayYmd } from "../src/lib/dates.js";
import { sendOverdueDigest, teamIdsRecursive } from "../src/services/tasks.js";
import { PASSWORD, resetDatabase, startServer, useMemoryTransport } from "./helpers.js";

describe("Tasks", () => {
  let api: Awaited<ReturnType<typeof startServer>>;
  const token: Record<string, string> = {};
  const id: Record<string, number> = {};

  const as = (who: string) => ({
    get: (path: string) => api.call(token[who]!, "GET", path),
    post: (path: string, body: Record<string, unknown> = {}) => api.call(token[who]!, "POST", path, body),
    patch: (path: string, body: Record<string, unknown> = {}) => api.call(token[who]!, "PATCH", path, body),
  });
  const setSetting = (key: string, value: string) => prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  const auditRows = (entityId: number, action?: string) => prisma.auditLog.findMany({ where: { entity: "Task", entityId: String(entityId), ...(action ? { action } : {}) }, orderBy: { createdAt: "desc" } });
  const notifTitles = (employeeId: number) => prisma.notification.findMany({ where: { employeeId }, orderBy: { createdAt: "desc" } }).then((rows) => rows.map((r) => r.title));

  before(async () => {
    await resetDatabase();
    useMemoryTransport();
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    const eng = await prisma.department.create({ data: { name: "Engineering" } });
    const sales = await prisma.department.create({ data: { name: "Sales" } });
    const mgmt = await prisma.department.create({ data: { name: "Management" } });
    const person = async (key: string, fullName: string, departmentId: number, roles: string[], managerId: number | null) => {
      const e = await prisma.employee.create({
        data: {
          code: `EHB-2024-${String(Object.keys(id).length + 1).padStart(3, "0")}`, email: `${key}@test.local`, fullName, passwordHash, mustChangePassword: false,
          joiningDate: toDate("2024-01-01"), departmentId, managerId, roles: ["EMPLOYEE", ...roles] as never,
        },
      });
      id[key] = e.id;
      return e.id;
    };
    await person("ceo", "Imran Qureshi", mgmt.id, ["MANAGEMENT"], null);
    await person("hr", "Ayesha Siddiqui", mgmt.id, ["HR"], id.ceo!);
    await person("fin", "Bilal Ahmed", mgmt.id, ["FINANCE"], id.ceo!);
    await person("hamza", "Hamza Malik", eng.id, ["LINE_MANAGER", "HOD"], id.ceo!);
    await person("ali", "Ali Raza", eng.id, [], id.hamza!); // Hamza's direct report
    await person("sara", "Sara Javed", eng.id, [], id.hamza!); // Hamza's direct report
    await person("junior", "Junaid Latif", eng.id, [], id.ali!); // Hamza's INDIRECT report (reports to Ali)
    await person("waqas", "Waqas Tariq", sales.id, ["LINE_MANAGER"], id.ceo!); // a sibling manager, not under Hamza
    await person("outsider", "Omer Farooq", sales.id, [], id.waqas!); // Waqas's own report — must stay excluded from Hamza's team
    await person("adminuser", "Usman Tariq", mgmt.id, ["ADMIN"], id.ceo!);

    api = await startServer();
    for (const key of Object.keys(id)) token[key] = await api.login(`${key}@test.local`);
  });

  after(async () => {
    await api.close();
  });

  test("teamIdsRecursive: a 3-level chain includes direct and indirect reports; a sibling branch is excluded", async () => {
    const team = await teamIdsRecursive(id.hamza!);
    assert.deepEqual([...team].sort((a, b) => a - b), [id.ali!, id.sara!, id.junior!].sort((a, b) => a - b));
    assert.ok(!team.includes(id.waqas!));
    assert.ok(!team.includes(id.outsider!));
  });

  test("teamIdsRecursive: a manager cycle (A -> B -> A) terminates and never includes the root", async () => {
    const a = await prisma.employee.create({ data: { code: "EHB-CYCLE-A", email: "cyclea@test.local", fullName: "Cycle A", passwordHash: await bcrypt.hash(PASSWORD, 4), mustChangePassword: false, joiningDate: toDate("2024-01-01"), roles: ["EMPLOYEE"] } });
    const b = await prisma.employee.create({ data: { code: "EHB-CYCLE-B", email: "cycleb@test.local", fullName: "Cycle B", passwordHash: await bcrypt.hash(PASSWORD, 4), mustChangePassword: false, joiningDate: toDate("2024-01-01"), roles: ["EMPLOYEE"], managerId: a.id } });
    await prisma.employee.update({ where: { id: a.id }, data: { managerId: b.id } }); // corrupt: A now reports to B, closing the loop
    const team = await teamIdsRecursive(a.id, 10);
    assert.deepEqual(team, [b.id]); // B found once; A (the root) never re-added even though B "reports" to A
  });

  test("Employee cannot assign a task to someone else, at creation or on an existing task", async () => {
    const create = await as("ali").post("/tasks", { title: "Help Sara", assigneeId: id.sara });
    assert.equal(create.status, 403);
    const own = await as("ali").post("/tasks", { title: "My own task", assigneeId: id.ali });
    assert.equal(own.status, 201);
    const reassign = await as("ali").patch(`/tasks/${own.data.id}`, { assigneeId: id.sara });
    assert.equal(reassign.status, 403);
  });

  test("Line Manager can assign within the team (direct and indirect), never outside it", async () => {
    const toDirect = await as("hamza").post("/tasks", { title: "Direct report task", assigneeId: id.ali });
    assert.equal(toDirect.status, 201);
    const toIndirect = await as("hamza").post("/tasks", { title: "Indirect report task", assigneeId: id.junior });
    assert.equal(toIndirect.status, 201);
    const outOfScope = await as("hamza").post("/tasks", { title: "Not my team", assigneeId: id.outsider });
    assert.equal(outOfScope.status, 403);
    // Reassigning an existing team task to someone outside the team is also rejected.
    const reassignOut = await as("hamza").patch(`/tasks/${toDirect.data.id}`, { assigneeId: id.outsider });
    assert.equal(reassignOut.status, 403);
  });

  test("HR can assign anyone", async () => {
    const res = await as("hr").post("/tasks", { title: "Company-wide task", assigneeId: id.outsider });
    assert.equal(res.status, 201);
  });

  test("Finance sees only its own tasks (assigned to or created by them), even for a task about them created by HR", async () => {
    const forFin = await as("hr").post("/tasks", { title: "Finance task from HR", assigneeId: id.fin });
    assert.equal(forFin.status, 201);
    const theirs = await as("fin").get("/tasks");
    assert.ok(theirs.data.every((t: { assigneeId: number; creatorId: number }) => t.assigneeId === id.fin || t.creatorId === id.fin));
    assert.ok(theirs.data.some((t: { id: number }) => t.id === forFin.data.id));
    // Finance cannot see Hamza's team tasks, and gets 404 (not 403) trying to open one directly.
    const hamzaTask = await as("hamza").post("/tasks", { title: "Hamza's own", assigneeId: id.hamza });
    assert.equal((await as("fin").get(`/tasks/${hamzaTask.data.id}`)).status, 404);
    // Finance cannot assign to anyone, including themselves-adjacent others.
    assert.equal((await as("fin").post("/tasks", { title: "x", assigneeId: id.hr })).status, 403);
  });

  test("status move by someone outside the task's scope is rejected with 403 (not 404 — write attempts stay 403 even though reads of the same task would 404)", async () => {
    const task = await as("hamza").post("/tasks", { title: "Status scope test", assigneeId: id.ali });
    assert.equal((await as("waqas").patch(`/tasks/${task.data.id}`, { status: "TODO" })).status, 403);
    assert.equal((await as("fin").patch(`/tasks/${task.data.id}`, { status: "TODO" })).status, 403);
    // The same task, read instead of written, is a 404 for the same two people.
    assert.equal((await as("waqas").get(`/tasks/${task.data.id}`)).status, 404);
    assert.equal((await as("fin").get(`/tasks/${task.data.id}`)).status, 404);
  });

  test("an employee who both created and is assigned their own task may edit title, description, due date and priority, but never the assignee", async () => {
    const task = await as("ali").post("/tasks", { title: "Self task", assigneeId: id.ali });
    const edit = await as("ali").patch(`/tasks/${task.data.id}`, { title: "Self task (renamed)", description: "details", dueDate: "2026-12-01", priority: "HIGH", status: "TODO" });
    assert.equal(edit.status, 200, JSON.stringify(edit.data));
    assert.equal(edit.data.title, "Self task (renamed)");
    assert.equal((await as("ali").patch(`/tasks/${task.data.id}`, { assigneeId: id.sara })).status, 403);
  });

  test("an employee assigned a task by someone else may change status only", async () => {
    const task = await as("hamza").post("/tasks", { title: "Assigned to Ali by Hamza", assigneeId: id.ali });
    assert.equal((await as("ali").patch(`/tasks/${task.data.id}`, { status: "TODO" })).status, 200);
    assert.equal((await as("ali").patch(`/tasks/${task.data.id}`, { title: "Nope" })).status, 403);
    assert.equal((await as("ali").patch(`/tasks/${task.data.id}`, { priority: "HIGH" })).status, 403);
    assert.equal((await as("ali").patch(`/tasks/${task.data.id}`, { dueDate: "2026-12-05" })).status, 403);
  });

  test("create, status change and archive all write to the audit log", async () => {
    const task = await as("hamza").post("/tasks", { title: "Audited task", assigneeId: id.ali });
    assert.equal((await auditRows(task.data.id, "CREATE")).length, 1);
    await as("hamza").patch(`/tasks/${task.data.id}`, { status: "TODO" });
    assert.equal((await auditRows(task.data.id, "UPDATE")).length, 1);
    await as("hamza").post(`/tasks/${task.data.id}/archive`);
    assert.equal((await auditRows(task.data.id, "ARCHIVE")).length, 1);
  });

  test("assigning a task notifies the assignee; a non-creator's status change notifies the creator", async () => {
    const task = await as("hamza").post("/tasks", { title: "Notify me", assigneeId: id.ali });
    assert.ok((await notifTitles(id.ali!)).some((t) => t.startsWith("Task assigned:")));
    await as("ali").patch(`/tasks/${task.data.id}`, { status: "IN_PROGRESS" });
    assert.ok((await notifTitles(id.hamza!)).some((t) => t.startsWith("Status changed:")));
  });

  test("the task history endpoint returns only actor/time/action and status/assignee/dueDate/priority from-to — never title, description or comment text", async () => {
    // Sara (no reports) creating and self-assigning her own task may change title/description — proving the
    // history endpoint filters them out even when they really did change, not merely because they couldn't.
    const task = await as("sara").post("/tasks", { title: "History test", description: "secret plan details", assigneeId: id.sara });
    const patched = await as("sara").patch(`/tasks/${task.data.id}`, { status: "TODO", title: "Renamed", description: "even more secret", priority: "HIGH" });
    assert.equal(patched.status, 200, JSON.stringify(patched.data));
    await as("sara").post(`/tasks/${task.data.id}/comments`, { body: "a private comment nobody else should see in history" });
    const history = await as("sara").get(`/tasks/${task.data.id}/history`);
    assert.equal(history.status, 200);
    const text = JSON.stringify(history.data);
    assert.ok(!text.includes("secret"), "no title/description leaked into history, even though they really did change");
    assert.ok(!text.includes("private comment"), "comment text never appears in history");
    const update = history.data.find((h: { action: string }) => h.action === "UPDATE");
    assert.ok(update, "an UPDATE row exists");
    assert.ok(update.changes.status);
    assert.ok(update.changes.priority);
    assert.ok(!("title" in update.changes), "title changes are not part of the whitelisted history fields");
    assert.ok(!("description" in update.changes), "description changes are not part of the whitelisted history fields");
  });

  test("a task's history and comments are 404 for someone who cannot see the task; 403 would leak that it exists", async () => {
    const task = await as("hamza").post("/tasks", { title: "Private to the team", assigneeId: id.ali });
    assert.equal((await as("fin").get(`/tasks/${task.data.id}/history`)).status, 404);
    assert.equal((await as("fin").get(`/tasks/${task.data.id}/comments`)).status, 404);
    assert.equal((await as("fin").get(`/tasks/${task.data.id}`)).status, 404);
  });

  test("ADMIN and MANAGEMENT are own-tasks-only in v1, even though the CEO structurally has direct reports", async () => {
    const res = await as("adminuser").post("/tasks", { title: "x", assigneeId: id.hr });
    assert.equal(res.status, 403);
    const ceoList = await as("ceo").get("/tasks");
    assert.ok(ceoList.data.every((t: { assigneeId: number; creatorId: number }) => t.assigneeId === id.ceo || t.creatorId === id.ceo));
  });

  test("tasks.employeesCanCreateOwnTasks: off blocks self-creation; on (default) allows it", async () => {
    await setSetting("tasks.employeesCanCreateOwnTasks", "0");
    assert.equal((await as("sara").post("/tasks", { title: "x", assigneeId: id.sara })).status, 403);
    await setSetting("tasks.employeesCanCreateOwnTasks", "1");
    assert.equal((await as("sara").post("/tasks", { title: "x", assigneeId: id.sara })).status, 201);
  });

  test("tasks.sendEmails: off still creates the in-app notification (email path is skipped, not tested here, but the row exists)", async () => {
    await setSetting("tasks.sendEmails", "0");
    const task = await as("hamza").post("/tasks", { title: "No email please", assigneeId: id.sara });
    assert.equal(task.status, 201);
    assert.ok((await notifTitles(id.sara!)).some((t) => t.startsWith("Task assigned:")));
    await setSetting("tasks.sendEmails", "1");
  });

  test("team-summary is available to Line Manager/HR and rejected for someone with no team", async () => {
    const res = await as("hamza").get("/tasks/team-summary");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.data.people));
    // Sara has no reports of her own (unlike Ali, who manages Junior) -> genuinely no team.
    assert.equal((await as("sara").get("/tasks/team-summary")).status, 403);
  });

  test("overdue digest: skips weekends and holidays, otherwise one notification per assignee with overdue tasks", async () => {
    await prisma.task.deleteMany({});
    await prisma.notification.deleteMany({});
    const overdueTask = await prisma.task.create({ data: { title: "Was due yesterday", assigneeId: id.ali!, creatorId: id.hamza!, status: "TODO", dueDate: toDate("2026-11-16") } }); // Monday
    void overdueTask;
    // Sunday 2026-11-15: skipped entirely.
    assert.equal(await sendOverdueDigest(new Date("2026-11-15T06:00:00.000Z")), 0);
    // A declared holiday: also skipped.
    await prisma.holiday.create({ data: { date: toDate("2026-11-17"), name: "Test holiday (tasks)" } });
    assert.equal(await sendOverdueDigest(new Date("2026-11-17T06:00:00.000Z")), 0);
    // An ordinary working day: one assignee notified once.
    const count = await sendOverdueDigest(new Date("2026-11-18T06:00:00.000Z"));
    assert.equal(count, 1);
    assert.ok((await notifTitles(id.ali!)).some((t) => t.includes("overdue")));
  });
});
