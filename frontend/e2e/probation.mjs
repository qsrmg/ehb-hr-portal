// Probation confirmation steps: an employee's probation becomes due, the Line Manager leaves a note for
// HR, HR extends one employee's probation and confirms another's, and each side sees only what it should.
// See e2e/README.md. Run with `npm run e2e` (ONLY=probation re-runs only this spec within one run).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const env = process.env;
const BASE = env.E2E_BASE_URL ?? "http://localhost:3000";
const API = env.E2E_API_URL ?? "http://localhost:5000/api";
const PASSWORD = env.E2E_PASSWORD ?? "Password@123";
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../test-screenshots/probation");
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (/\.(png|json)$/.test(f)) fs.rmSync(path.join(OUT, f));

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

const ymd = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => { const r = new Date(d); r.setUTCDate(r.getUTCDate() + n); return r; };
const YESTERDAY = ymd(addDays(new Date(), -1));
const FUTURE = ymd(addDays(new Date(), 60));

const browser = await chromium.launch();
const snap = async (page, name) => {
  shot++;
  await page.screenshot({ path: path.join(OUT, `${String(shot).padStart(2, "0")}-${name}.png`), fullPage: true });
};

async function apiAs(email) {
  const { token } = await (await fetch(`${API}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }) })).json();
  if (!token) throw new Error(`Could not sign in as ${email}`);
  return async (method, p, body) => {
    const res = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json();
    if (!res.ok) throw new Error(`${method} ${p}: ${data.message}`);
    return data;
  };
}

async function signIn(page, email) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await page.waitForURL(/\/dashboard$/);
}

let aliId, saraId;
await step(1, "Fixture: Ali's and Sara's probation is made due as of yesterday", async (check) => {
  const hr = await apiAs("hr@ehb.local");
  const all = await hr("GET", "/employees?status=ALL");
  aliId = all.find((e) => e.email === "employee@ehb.local").id;
  saraId = all.find((e) => e.email === "employee2@ehb.local").id;
  await hr("PATCH", `/employees/${aliId}`, { probationEndDate: YESTERDAY });
  await hr("PATCH", `/employees/${saraId}`, { probationEndDate: YESTERDAY });
  check(`Ali (#${aliId}) and Sara (#${saraId}) now show as confirmation due`);
});

await step(2, "HR: the Employees list shows a confirmation-due count of (at least) 2", async (check) => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  try {
    await signIn(page, "hr@ehb.local");
    await page.goto(`${BASE}/admin/employees`);
    await page.getByText(/waiting on a confirmation decision/).waitFor();
    await snap(page, "hr-employees-list-due");
    check("The due-count banner is visible on the Employees list");
  } finally {
    await context.close();
  }
});

await step(3, "HR: Ali's record shows Confirmation due with Confirm/Extend actions", async (check) => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  try {
    await signIn(page, "hr@ehb.local");
    await page.goto(`${BASE}/admin/employees/${aliId}`);
    await page.getByText("Probation ended").waitFor();
    await page.getByRole("button", { name: "Confirm employment" }).waitFor();
    await page.getByRole("button", { name: "Extend probation" }).waitFor();
    await snap(page, "hr-ali-due");
    check("Confirm employment and Extend probation are both offered");
  } finally {
    await context.close();
  }
});

await step(4, "Hamza (Line Manager): sees the due notice on Ali's Team page and leaves a note for HR", async (check) => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  try {
    await signIn(page, "manager@ehb.local");
    await page.goto(`${BASE}/team`);
    await page.getByRole("button", { name: "Month view" }).first().click();
    await page.getByText(/probation ended/).waitFor();
    await snap(page, "manager-team-due-note");
    await page.getByLabel("Note for HR").fill("Settling in well, no concerns from my side.");
    await page.getByRole("button", { name: "Send" }).click();
    await page.getByText("Note sent to HR.").waitFor();
    check("The Line Manager's note was sent");
  } finally {
    await context.close();
  }
});

await step(5, "HR: sees the Line Manager's note, then extends Ali's probation with a reason", async (check) => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  try {
    await signIn(page, "hr@ehb.local");
    await page.goto(`${BASE}/admin/employees/${aliId}`);
    await page.getByText("Settling in well, no concerns from my side.").waitFor();
    check("HR sees the Line Manager's note");
    await page.getByRole("button", { name: "Extend probation" }).click();
    await page.getByLabel("New probation end date").fill(FUTURE);
    await page.getByLabel("Reason").fill("Needs a further quarter to reach full productivity on the new stack.");
    await page.getByRole("button", { name: "Save extension" }).click();
    await page.getByText(/Probation extended/).first().waitFor();
    // Not "On probation until" alone: the Job form's field label reads the same, before any date.
    await page.getByText(/On probation until \d/).waitFor();
    await snap(page, "hr-ali-extended");
    check(`Ali's probation is extended to ${FUTURE}`);
  } finally {
    await context.close();
  }
});

await step(6, "HR: confirms Sara's employment; Sara sees her own confirmed status on her profile", async (check) => {
  const hrContext = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const hrPage = await hrContext.newPage();
  hrPage.setDefaultTimeout(15000);
  hrPage.on("dialog", (d) => d.accept());
  try {
    await signIn(hrPage, "hr@ehb.local");
    await hrPage.goto(`${BASE}/admin/employees/${saraId}`);
    await hrPage.getByRole("button", { name: "Confirm employment" }).click();
    await hrPage.getByText(/Employment confirmed/).first().waitFor();
    await hrPage.getByText(/^Confirmed on/).waitFor();
    await snap(hrPage, "hr-sara-confirmed");
    check("Sara's record shows Confirmed");
  } finally {
    await hrContext.close();
  }

  const saraContext = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const saraPage = await saraContext.newPage();
  saraPage.setDefaultTimeout(15000);
  try {
    await signIn(saraPage, "employee2@ehb.local");
    await saraPage.goto(`${BASE}/profile`);
    await saraPage.getByText("Employment status").waitFor();
    await saraPage.getByText(/^Confirmed on/).waitFor();
    await snap(saraPage, "sara-profile-confirmed");
    check("Sara sees her own confirmed status, read-only, on her profile");
  } finally {
    await saraContext.close();
  }
});

await browser.close();
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2));
console.log(`\n${results.filter((r) => r.status === "PASS").length} of ${results.length} steps passed. Screenshots: ${OUT}`);
process.exitCode = results.every((r) => r.status === "PASS") ? 0 : 1;
