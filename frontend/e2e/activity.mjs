// Activity monitoring browser test against a running portal. See e2e/README.md.
// Covers: off by default, the non-blocking acknowledgement prompt, on-state tracking, the multi-tab
// leader-election/OR-merge design, that the tracking listener never reads anything off a DOM event, Line
// Manager aggregate-only view, and HR's audited individual view / CSV export.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const env = process.env;
const BASE = env.E2E_BASE_URL ?? "http://localhost:3000";
const API = env.E2E_API_URL ?? "http://localhost:5000/api";
const PASSWORD = env.E2E_PASSWORD ?? "Password@123";
const HR = env.E2E_HR_EMAIL ?? "hr@ehb.local";
const MANAGER = env.E2E_MANAGER_EMAIL ?? "manager@ehb.local";
const EMPLOYEE = env.E2E_EMPLOYEE_EMAIL ?? "employee@ehb.local";
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../test-screenshots/activity");
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

const snap = async (page, name) => {
  shot++;
  await page.screenshot({ path: path.join(OUT, `${String(shot).padStart(2, "0")}-${name}.png`), fullPage: true });
};

/** Speeds up the heartbeat cadence for this browser context only (see useActivityTracking.ts); production
 * code never sets this, so real users are unaffected. */
async function newSpeedyContext() {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, timezoneId: "Asia/Karachi" });
  await context.addInitScript(() => {
    window.__ACTIVITY_HEARTBEAT_INTERVAL_MS__ = 3000;
  });
  return context;
}

async function signIn(page, email) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await page.waitForURL(/\/dashboard$/);
  await page.locator("main h1").first().waitFor();
}

async function apiGet(page, p) {
  return page.evaluate(
    async ({ api, p, tokenKey }) => {
      const token = localStorage.getItem(tokenKey);
      const res = await fetch(`${api}${p}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      return { status: res.status, data: await res.json() };
    },
    { api: API, p, tokenKey: "hr_token" },
  );
}

await step(1, "Off by default: no activity badge, nothing to acknowledge", async (check) => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, timezoneId: "Asia/Karachi" });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await signIn(page, EMPLOYEE);
  if (await page.getByText("Activity tracking on").count()) throw new Error("Badge shown while the feature is off");
  if (await page.getByText(/activity monitoring/i).count()) throw new Error("Nothing about activity monitoring should appear while it is off");
  check("No badge and no acknowledgement banner while the feature is off");
  await snap(page, "off-by-default");
  await context.close();
});

await step(2, "HR turns on activity monitoring and widens office hours (so the test is not time-of-day dependent)", async (check) => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, timezoneId: "Asia/Karachi" });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await signIn(page, HR);
  await page.goto(`${BASE}/admin/settings`);
  await page.getByRole("heading", { name: "Rules and settings" }).waitFor();
  await page.getByLabel("Office hours start (reminders are sent only in office hours)").fill("00:00");
  await page.getByLabel("Office hours end").fill("23:59");
  await page.getByRole("switch", { name: /Turn on activity monitoring/ }).click();
  await snap(page, "hr-settings-before-save");
  await page.getByRole("button", { name: "Save settings" }).click();
  await page.getByText("Settings saved.").waitFor();
  check("Office hours widened and activity monitoring switched on");
  await snap(page, "hr-settings-saved");
  await context.close();
});

const empContext = await newSpeedyContext();
const empPage = await empContext.newPage();
empPage.setDefaultTimeout(15000);

await step(3, "Employee sees a non-blocking acknowledgement prompt; the rest of the portal stays fully usable while it is showing", async (check) => {
  await signIn(empPage, EMPLOYEE);
  await empPage.getByText(/HR has turned on activity monitoring/).waitFor();
  if (await empPage.getByText("Activity tracking on").count()) throw new Error("Should not be tracking before acknowledgement");
  check("Prompt shown, not yet tracking");
  await snap(empPage, "acknowledgement-prompt");
  // The prompt is still showing (not acknowledged, not dismissed) — navigating elsewhere must still work.
  await empPage.goto(`${BASE}/leave`);
  await empPage.getByRole("heading", { name: "Leave", exact: true }).waitFor();
  check("The portal is fully usable while the prompt is still showing");
  await empPage.goto(`${BASE}/dashboard`);
  await empPage.getByText(/HR has turned on activity monitoring/).waitFor();
});

await step(4, "Acknowledging turns tracking on; the badge appears", async (check) => {
  await empPage.getByRole("button", { name: "I understand, turn it on" }).click();
  await empPage.getByText("Activity tracking on").waitFor();
  check("Badge appears once the policy is acknowledged");
  await empPage.getByText("What is tracked?").click();
  await empPage.getByRole("dialog", { name: "What is tracked?" }).waitFor();
  await snap(empPage, "tracking-on-what-is-tracked");
  await empPage.getByRole("dialog", { name: "What is tracked?" }).getByRole("button", { name: "Close" }).last().click();
});

await step(5, "Multi-tab: activity in a second tab is still recorded (OR-merged), even though the first tab stays idle", async (check) => {
  const before = await apiGet(empPage, "/activity/me");
  const beforeActive = before.data.today.activeMinutes;

  const page2 = await empContext.newPage();
  page2.setDefaultTimeout(15000);
  await page2.goto(`${BASE}/dashboard`);
  await page2.getByText("Activity tracking on").waitFor();
  // Dispatched with no payload at all — the production listener takes no argument, so there is nothing
  // here it could read off an event even if one were attached (see useActivityTracking.ts).
  await page2.evaluate(() => window.dispatchEvent(new Event("mousedown")));
  check("Tab 2 reports activity; tab 1 (empPage) never receives any synthetic input");

  let after;
  for (let i = 0; i < 20; i++) {
    await empPage.waitForTimeout(1000);
    after = await apiGet(empPage, "/activity/me");
    if (after.data.today.activeMinutes > beforeActive) break;
  }
  if (!(after.data.today.activeMinutes > beforeActive)) throw new Error(`Active minutes did not increase: ${JSON.stringify(after.data.today)}`);
  check(`Active minutes increased (${beforeActive} -> ${after.data.today.activeMinutes}) from the idle tab's own session, via tab 2's activity`);
  await snap(page2, "second-tab-activity");
  await page2.close();
});

await step(6, "The heartbeat payload the browser actually sends carries only timestamps and booleans", async (check) => {
  const requests = [];
  empPage.on("request", (r) => {
    if (r.url().endsWith("/activity/heartbeat")) requests.push(r.postDataJSON());
  });
  await empPage.evaluate(() => window.dispatchEvent(new Event("keydown")));
  await empPage.waitForTimeout(4000);
  if (!requests.length) throw new Error("No heartbeat request was observed");
  for (const body of requests) {
    for (const m of body.minutes) {
      const keys = Object.keys(m).sort();
      if (JSON.stringify(keys) !== JSON.stringify(["active", "minuteStart"])) throw new Error(`Unexpected heartbeat fields: ${keys.join(",")}`);
    }
  }
  check(`Every heartbeat minute has exactly {minuteStart, active} — ${requests.length} request(s) checked`);
});

await empContext.close();

await step(7, "Line Manager sees only the team's average Active % — never a member's own number", async (check) => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, timezoneId: "Asia/Karachi" });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await signIn(page, MANAGER);
  await page.goto(`${BASE}/team`);
  await page.getByRole("button", { name: "Activity" }).click();
  await page.getByText(/Team average Active %/).waitFor();
  const rowsText = await page.locator("table tbody").innerText();
  if (/\d+(\.\d+)?%/.test(rowsText)) throw new Error(`A per-member percentage leaked into the team table: ${rowsText}`);
  check("Team table shows Tracked/Not tracked only, no per-member percentage");
  await snap(page, "line-manager-team-activity");
  await context.close();
});

await step(8, "HR's individual view is audited; the CSV export works", async (check) => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, timezoneId: "Asia/Karachi" });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await signIn(page, HR);
  await page.goto(`${BASE}/admin/activity`);
  await page.getByRole("button", { name: "Individual" }).click();
  await page.getByPlaceholder("Start typing a name...").fill("Ali Raza");
  await page.getByText("Ali Raza", { exact: false }).first().click();
  await page.getByText(/tracked ·/).waitFor();
  check("HR opened Ali Raza's individual activity detail");
  await snap(page, "hr-individual-activity");

  await page.getByRole("button", { name: "Reports" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export CSV" }).click(),
  ]);
  if (!download.suggestedFilename().endsWith(".csv")) throw new Error("Export did not produce a CSV file");
  check("CSV export downloaded");

  await page.goto(`${BASE}/admin/audit`);
  await page.getByLabel("Action").selectOption("VIEW_SENSITIVE");
  await page.getByText("ActivitySummary").first().waitFor();
  check("The individual view was recorded as VIEW_SENSITIVE on ActivitySummary in the audit log");
  await page.getByLabel("Action").selectOption("EXPORT");
  await page.getByText("ActivityReport").first().waitFor();
  check("The CSV export was recorded as EXPORT on ActivityReport in the audit log");
  await snap(page, "hr-audit-log");
  await context.close();
});

await browser.close();

console.log("\n=== activity summary ===");
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
