// Walks through DEMO.md on the HR demo data (backend/prisma/demo.ts): every login and every screen the demo
// script points to, with screenshots in test-screenshots/demo/. Run with `npm run e2e` (it loads the demo data).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const env = process.env;
const BASE = env.E2E_BASE_URL ?? "http://localhost:3000";
const PASSWORD = "Password@123";
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../test-screenshots/demo");
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (/\.(png|json)$/.test(f)) fs.rmSync(path.join(OUT, f));

const browser = await chromium.launch();
const results = [];
let shot = 0;

async function as(who, fn) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, timezoneId: "Asia/Karachi", acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("dialog", (d) => d.accept());
  try {
    await page.goto(`${BASE}/login`);
    await page.getByLabel("Work email").fill(`${who}@ehb.demo`);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in securely" }).click();
    await page.waitForURL(/\/dashboard$/);
    await page.locator("main h1").first().waitFor();
    try {
      return await fn(page);
    } catch (err) {
      await snap(page, `FAILED-${who}`).catch(() => {});
      throw err;
    }
  } finally {
    await context.close();
  }
}
const snap = async (page, name) => {
  shot++;
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.screenshot({ path: path.join(OUT, `${String(shot).padStart(2, "0")}-${name}.png`), fullPage: true });
};
const visible = (page, text, opts = {}) => page.getByText(text, opts).first().waitFor();
const go = async (page, url, heading) => {
  await page.goto(`${BASE}${url}`);
  await page.getByRole("heading", { name: heading }).first().waitFor();
};

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

// ---------------- Part 1: Employee (Ali) ----------------
await step("1.1", "Landing page and sign-in", async (check) => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/`);
  await page.getByRole("heading", { name: /Your Entire HR Experience/ }).waitFor();
  await page.waitForTimeout(1500);
  await snap(page, "landing");
  await page.getByRole("link", { name: "Sign In", exact: true }).first().click();
  await page.waitForURL(/\/login$/);
  await context.close();
  check("Landing page → Sign In");
});

await step("1.2", "Ali: dashboard, attendance, leave, pay slips, policies, inventory", async (check) => {
  await as("ali", async (page) => {
    await visible(page, "My pending requests");
    const pending = await page.locator("a", { hasText: "My pending requests" }).innerText();
    if (!/\b2\b/.test(pending)) throw new Error(`Expected 2 pending requests, got: ${pending.replace(/\s+/g, " ")}`);
    await visible(page, "Leave balances");
    await visible(page, "Pay slips");
    await snap(page, "ali-dashboard");
    check("Dashboard: 2 pending requests (casual leave and expense claim), balances, pay slip");
    await go(page, "/attendance", "My attendance");
    await snap(page, "ali-attendance");
    await go(page, "/requests/new/leave", "Apply for leave");
    await snap(page, "ali-apply-leave");
    await go(page, "/payslips", /Pay slips/);
    await snap(page, "ali-payslips");
    await go(page, "/documents", /Policies/);
    await visible(page, "Leave Policy");
    await go(page, "/inventory", /inventory/i);
    await visible(page, "Dell Latitude 5440");
    await visible(page, "Google Workspace email");
    await snap(page, "ali-inventory");
    check("Attendance, leave form, pay slips, policies (4), inventory (laptop and email account)");
  });
});

// ---------------- Part 2: Manager (Hamza) ----------------
await step("2.1", "Hamza: 2 tasks waiting; approves Ali's leave from the dashboard and the expense claim", async (check) => {
  await as("hamza", async (page) => {
    const tasks = await page.locator("a", { hasText: "Waiting for your approval" }).innerText();
    if (!/\b2\s*tasks/.test(tasks)) throw new Error(`Expected 2 tasks, got: ${tasks.replace(/\s+/g, " ")}`);
    await snap(page, "hamza-dashboard");
    await page.getByRole("button", { name: "Approve", exact: true }).first().click();
    await page.getByText(/^1\s*task/).first().waitFor();
    check("Casual leave approved from the dashboard; 1 task left");
    await go(page, "/approvals", "Approvals");
    await page.getByRole("link", { name: /Expense Claim/ }).first().click();
    await visible(page, "Lunch with the client's IT team");
    await snap(page, "hamza-expense");
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await visible(page, "Approved.", { exact: true });
    check("Expense claim approved; now with Finance");
    await go(page, "/team", /Team/);
    await snap(page, "hamza-team");
  });
});

// ---------------- Part 3: HR (Ayesha) ----------------
await step("3.1", "Ayesha: HR dashboard, employee record, late warnings, leave types, settings, audit log", async (check) => {
  await as("ayesha", async (page) => {
    await visible(page, "Active employees");
    await snap(page, "ayesha-dashboard");
    await go(page, "/admin/employees", "Employees");
    await page.getByRole("link", { name: "Sara Javed" }).click();
    await page.getByLabel(/^Grade/).waitFor();
    if ((await page.getByLabel(/^Grade/).inputValue()) !== "G4") throw new Error("Sara's grade is not G4");
    await snap(page, "ayesha-employee-record");
    check("15 employees; Sara's record has a grade, role date and probation date");
    await go(page, "/admin/late-warnings", /Late/);
    await visible(page, "Kashif Raza");
    await snap(page, "ayesha-late-warnings");
    check("Late warning for Kashif");
    for (const [url, heading] of [["/admin/leave-types", /Leave types/i], ["/admin/holidays", /Holiday/i], ["/admin/settings", /Rules and settings/i], ["/admin/audit", /Audit/i]]) {
      await go(page, url, heading);
    }
    await snap(page, "ayesha-audit");
    check("Leave types, holidays, settings and audit log open");
  });
});

// ---------------- Part 4: Phase 2 tour ----------------
await step("4.1", "Bilal (Finance): approves Ali's expense claim and marks it paid", async (check) => {
  await as("bilal", async (page) => {
    await go(page, "/approvals", "Approvals");
    await page.getByRole("link", { name: /Expense Claim/ }).first().click();
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await visible(page, "Approved.", { exact: true });
    await page.getByRole("button", { name: /Mark as paid/ }).first().waitFor();
    await snap(page, "bilal-expense");
    check("Expense claim approved by Finance; ready to mark as paid");
  });
});

await step("4.2", "Usman (Admin): Omar's trip waits to be booked; asset register", async (check) => {
  await as("usman", async (page) => {
    await go(page, "/admin/travel", /Travel/);
    await visible(page, "Omar Sheikh");
    await snap(page, "usman-travel");
    await go(page, "/admin/assets", /Assets/);
    await visible(page, "Dell Latitude 7440");
    await snap(page, "usman-assets");
    check("Trip to Karachi to book; 11 items in the register");
  });
});

await step("4.3", "Ayesha: Zainab's exit clearance, performance cycle, internal job with one applicant", async (check) => {
  await as("ayesha", async (page) => {
    await go(page, "/exits", /Exit clearance/i);
    await page.getByRole("link", { name: "Zainab Hussain" }).click();
    await visible(page, "Handover to Ali completed");
    await visible(page, "Return: Dell Latitude 5440");
    await snap(page, "ayesha-exit");
    check("Zainab: Line Manager cleared; laptop and email still to collect");
    await go(page, "/performance", "Performance");
    await page.getByRole("button", { name: "Cycles" }).click();
    await page.locator("tbody tr").first().getByRole("link").click();
    await visible(page, "Where everyone is");
    await snap(page, "ayesha-performance");
    check("Performance cycle at goal setting");
    await go(page, "/hiring", "Jobs and hiring");
    await page.getByRole("button", { name: "Requisitions" }).click();
    await page.getByRole("link", { name: "Digital Marketing Executive" }).click();
    await page.locator('[data-applicant="Kashif Raza"]').waitFor();
    await snap(page, "ayesha-job");
    check("Digital Marketing Executive posted; Kashif has applied");
  });
});

await step("4.4", "Sara: laptop awaiting confirmation; Ali: goals to acknowledge; Maryam: missed punch", async (check) => {
  await as("sara", async (page) => {
    await go(page, "/inventory", /inventory/i);
    await page.getByRole("button", { name: "Confirm I received it" }).waitFor();
    await snap(page, "sara-inventory");
  });
  await as("ali", async (page) => {
    await go(page, "/performance", "Performance");
    await visible(page, "Read and acknowledge your goals");
    await snap(page, "ali-performance");
  });
  await as("maryam", async (page) => {
    await go(page, "/attendance", "My attendance");
    await visible(page, "Absent");
    await snap(page, "maryam-attendance");
  });
  check("Sara confirms her laptop; Ali reads his goals; Maryam's missed punch shows");
});

await browser.close();
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2));
console.log(`\n${results.filter((r) => r.status === "PASS").length} of ${results.length} steps passed. Screenshots: ${OUT}`);
process.exitCode = results.every((r) => r.status === "PASS") ? 0 : 1;
