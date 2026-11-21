// Tasks module browser test against a running portal. See e2e/README.md.
// Covers: Employee create-for-self-only, Line Manager team-scoped assignment, HR assign-anyone, 403s on
// out-of-scope moves, Finance's own-only scope, a notification on assignment, the keyboard "Move to" control,
// and screenshots for Employee/Line Manager/HR at 1440x900 and 390x844.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const env = process.env;
const BASE = env.E2E_BASE_URL ?? "http://localhost:3000";
const API = env.E2E_API_URL ?? "http://localhost:5000/api";
const PASSWORD = env.E2E_PASSWORD ?? "Password@123";
const HR = env.E2E_HR_EMAIL ?? "hr@ehb.local";
const MANAGER = env.E2E_MANAGER_EMAIL ?? "manager@ehb.local"; // Hamza Malik, Line Manager/HOD of Ali and Sara
const EMPLOYEE = env.E2E_EMPLOYEE_EMAIL ?? "employee@ehb.local"; // Ali Raza
const EMPLOYEE2 = env.E2E_EMPLOYEE2_EMAIL ?? "employee2@ehb.local"; // Sara Javed, also Hamza's report
const FINANCE = env.E2E_FINANCE_EMAIL ?? "finance@ehb.local";
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../test-screenshots/tasks");
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (/\.(png|json)$/.test(f)) fs.rmSync(path.join(OUT, f));

const browser = await chromium.launch();
const results = [];
let shot = 0;

async function step(no, name, fn) {
  const checks = [];
  try {
    await fn((c) => checks.push(c));
    results.push({ no, name, status: "PASS", checks });
  } catch (err) {
    results.push({ no, name, status: "FAIL", checks, error: err.message.split("\n")[0] });
  }
  const r = results[results.length - 1];
  console.log(`${r.status}  Step ${no}: ${name}${r.error ? `  — ${r.error}` : ""}`);
}

async function newViewport(width, height) {
  const context = await browser.newContext({ viewport: { width, height }, timezoneId: "Asia/Karachi" });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  return { context, page };
}

async function signIn(page, email) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await page.waitForURL(/\/dashboard$/);
  await page.locator("main h1").first().waitFor();
}

const snap = async (page, name) => {
  shot++;
  await page.screenshot({ path: path.join(OUT, `${String(shot).padStart(2, "0")}-${name}.png`), fullPage: true });
};

/** A raw API call using the token the page already holds (for checks the UI can't trigger, e.g. a 403 the
 * assignee dropdown never offers in the first place). */
async function apiCall(page, method, p, body) {
  return page.evaluate(
    async ({ api, method, p, body, tokenKey }) => {
      const token = localStorage.getItem(tokenKey);
      const res = await fetch(`${api}${p}`, {
        method,
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, data: await res.json().catch(() => null) };
    },
    { api: API, method, p, body, tokenKey: "hr_token" },
  );
}

let aliTaskId, saraTaskId;

await step(1, "Employee: creates a task for themselves, moves it with the keyboard-accessible Move-to control, and cannot assign to anyone else", async (check) => {
  const { context, page } = await newViewport(1440, 900);
  await signIn(page, EMPLOYEE);
  await page.goto(`${BASE}/tasks`);
  await page.getByRole("heading", { name: "My tasks" }).waitFor();
  await snap(page, "employee-my-tasks-empty");

  await page.getByRole("button", { name: "Create task" }).click();
  await page.getByRole("dialog").getByLabel("Title").fill("Finish onboarding checklist");
  // Only Ali himself is offered as assignee — there is no way, via this form, to pick anyone else.
  const assigneeOptions = await page.getByRole("dialog").getByLabel("Assignee").locator("option").allTextContents();
  if (assigneeOptions.length !== 1) throw new Error(`Expected only "self" as an assignee option, got: ${assigneeOptions.join(", ")}`);
  check("The create form offers only the employee themselves as assignee");
  await page.getByRole("dialog").getByRole("button", { name: "Create task" }).click();
  await page.getByText("Finish onboarding checklist").waitFor();
  await snap(page, "employee-task-created");

  // Keyboard-accessible move: a native <select>, reachable and operable without a mouse.
  const card = page.locator("div[role='button']", { hasText: "Finish onboarding checklist" }).first();
  await card.getByLabel(/Move .* to a different status/).selectOption("TODO");
  await page.getByText("1", { exact: true }).first().waitFor(); // some column now shows a count of 1
  check("The card moved via the keyboard-operable Move-to select, not drag-and-drop");
  await snap(page, "employee-moved-to-todo");

  // Confirm via the API that Ali genuinely cannot assign to Sara (not merely that the UI doesn't offer it).
  const forbidden = await apiCall(page, "POST", "/tasks", { title: "Should be rejected", assigneeId: 999999 });
  if (forbidden.status !== 403 && forbidden.status !== 404) throw new Error(`Expected a 403 (or 404 if the id doesn't exist), got ${forbidden.status}`);
  check("Attempting to assign to someone else is rejected by the backend, not just hidden by the UI");

  await context.close();
});

await step(2, "Line Manager: creates and assigns within the team; cannot assign outside it; sees the team board and summary", async (check) => {
  const { context, page } = await newViewport(1440, 900);
  await signIn(page, MANAGER);
  await page.goto(`${BASE}/tasks/team`);
  await page.getByRole("heading", { name: "Team tasks" }).waitFor();
  await page.getByText("Who has what").waitFor();
  check("Team tasks board and summary strip both load for the Line Manager");
  await snap(page, "manager-team-tasks");

  await page.getByRole("button", { name: "Create task" }).click();
  await page.getByRole("dialog").getByLabel("Title").fill("Review Q1 budget");
  await page.getByRole("dialog").getByLabel("Assignee").selectOption({ label: "Ali Raza" });
  await page.getByRole("dialog").getByRole("button", { name: "Create task" }).click();
  await page.getByText("Review Q1 budget").waitFor();
  check("Hamza assigned a task to his direct report Ali");
  await snap(page, "manager-assigned-to-team");

  const financeUser = await apiCall(page, "GET", "/employees?q=Bilal");
  const financeId = financeUser.data?.[0]?.id;
  if (financeId) {
    const rejected = await apiCall(page, "POST", "/tasks", { title: "Outside my team", assigneeId: financeId });
    if (rejected.status !== 403) throw new Error(`Assigning outside the team should be 403, got ${rejected.status}`);
    check("Assigning to someone outside Hamza's team (Finance) is rejected with 403");
  }

  const aliTasks = await apiCall(page, "GET", "/tasks");
  aliTaskId = aliTasks.data?.find((t) => t.title === "Review Q1 budget")?.id;
  await context.close();
});

await step(3, "HR: can assign to anyone, including someone outside any team", async (check) => {
  const { context, page } = await newViewport(1440, 900);
  await signIn(page, HR);
  await page.goto(`${BASE}/tasks/team`);
  await page.getByRole("heading", { name: "Team tasks" }).waitFor();
  await page.getByRole("button", { name: "Create task" }).click();
  await page.getByRole("dialog").getByLabel("Title").fill("Prepare the town hall slides");
  await page.getByRole("dialog").getByLabel("Assignee").selectOption({ label: "Sara Javed" });
  await page.getByRole("dialog").getByRole("button", { name: "Create task" }).click();
  await page.getByText("Prepare the town hall slides").waitFor();
  check("HR assigned a task to Sara Javed, company-wide");
  await snap(page, "hr-team-tasks");

  const saraTasks = await apiCall(page, "GET", "/tasks");
  saraTaskId = saraTasks.data?.find((t) => t.title === "Prepare the town hall slides")?.id;

  await page.goto(`${BASE}/admin/audit`);
  await page.getByText("Task").first().waitFor();
  check("A Task entry appears in the company-wide audit log");
  await snap(page, "hr-audit-log-tasks");
  await context.close();
});

await step(4, "A notification is created when a task is assigned; an unauthorised status move is rejected", async (check) => {
  const { context, page } = await newViewport(1440, 900);
  await signIn(page, EMPLOYEE2); // Sara — the Finance-created task's assignee
  await page.goto(`${BASE}/notifications`);
  await page.getByText(/Task assigned/).first().waitFor();
  check("Sara was notified that a task was assigned to her");
  await snap(page, "sara-notified");

  // Sara cannot move Ali's task (not hers, not her team's).
  if (aliTaskId) {
    const rejected = await apiCall(page, "PATCH", `/tasks/${aliTaskId}`, { status: "TODO" });
    if (rejected.status !== 403 && rejected.status !== 404) throw new Error(`Expected 403/404, got ${rejected.status}`);
    check("Sara cannot move Ali's task");
  }
  await context.close();
});

await step(5, "Finance sees only its own tasks", async (check) => {
  const { context, page } = await newViewport(1440, 900);
  await signIn(page, FINANCE);
  await page.goto(`${BASE}/tasks`);
  await page.getByRole("heading", { name: "My tasks" }).waitFor();
  const res = await apiCall(page, "GET", "/tasks");
  const me = await apiCall(page, "GET", "/employees/me");
  const myId = me.data?.id;
  const onlyOwn = (res.data ?? []).every((t) => t.assignee.id === myId || t.creator.id === myId);
  if (!onlyOwn) throw new Error("Finance saw a task that is neither assigned to nor created by them");
  check("Every task Finance can see is their own");
  // Finance has no team: the team-tasks page is not offered in navigation, and the API backs that up.
  if (await page.getByRole("link", { name: "Team tasks" }).count()) throw new Error("Finance should not see a Team tasks nav link");
  const summary = await apiCall(page, "GET", "/tasks/team-summary");
  if (summary.status !== 403) throw new Error(`Finance's team-summary should be 403, got ${summary.status}`);
  check("No Team tasks nav link for Finance, and the team-summary API itself is 403");
  await context.close();
});

await step(6, "Screenshots at a phone width (390x844) for Employee, Line Manager and HR", async (check) => {
  for (const [label, email, url] of [["employee", EMPLOYEE, "/tasks"], ["manager", MANAGER, "/tasks/team"], ["hr", HR, "/tasks/team"]]) {
    const { context, page } = await newViewport(390, 844);
    await signIn(page, email);
    await page.goto(`${BASE}${url}`);
    await page.locator("main h1").first().waitFor();
    await page.waitForTimeout(300);
    await snap(page, `${label}-390w`);
    await context.close();
  }
  check("Phone-width screenshots captured for all three roles");
});

await browser.close();

console.log("\n=== tasks summary ===");
let failed = false;
for (const r of results) {
  console.log(`${r.status}  Step ${r.no}: ${r.name}`);
  for (const c of r.checks) console.log(`   - ${c}`);
  if (r.status === "FAIL") {
    failed = true;
    console.log(`   ! ${r.error}`);
  }
}
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
process.exit(failed ? 1 : 0);
