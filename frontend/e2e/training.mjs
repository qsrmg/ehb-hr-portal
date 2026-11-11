// Training request browser test against a running portal. See e2e/README.md.
// It creates real data (a training request) in the database the portal uses.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const env = process.env;
const BASE = env.E2E_BASE_URL ?? "http://localhost:3000";
const PASSWORD = env.E2E_PASSWORD ?? "Password@123";
const EMPLOYEE = env.E2E_EMPLOYEE_EMAIL ?? "employee@ehb.local";
const MANAGER = env.E2E_MANAGER_EMAIL ?? "manager@ehb.local"; // Hamza Malik: Line Manager and HOD, so the chain is Hamza -> Finance
const FINANCE = env.E2E_FINANCE_EMAIL ?? "finance@ehb.local";
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../test-screenshots/training");
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (/\.(png|json)$/.test(f)) fs.rmSync(path.join(OUT, f));

const karachiYmd = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
};
const START = karachiYmd(21);
const END = karachiYmd(23);
const PROGRAMME = `Advanced Kubernetes Workshop ${Date.now().toString(36).slice(-4).toUpperCase()}`;

const browser = await chromium.launch();
const results = [];
let shot = 0;
const ctx = {};

async function as(email, fn) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, timezoneId: "Asia/Karachi" });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  try {
    await page.goto(`${BASE}/login`);
    await page.getByLabel("Work email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in securely" }).click();
    await page.waitForURL(/\/dashboard$/);
    await page.locator("main h1").first().waitFor();
    try {
      return await fn(page);
    } catch (err) {
      await snap(page, `FAILED-${email.split("@")[0]}`).catch(() => {});
      throw err;
    }
  } finally {
    await context.close();
  }
}
const snap = async (page, name) => {
  shot++;
  await page.screenshot({ path: path.join(OUT, `${String(shot).padStart(2, "0")}-${name}.png`), fullPage: true });
};
const visible = (page, text, opts = {}) => page.getByText(text, opts).first().waitFor();
const approve = async (page, requestId) => {
  await page.goto(`${BASE}/requests/${requestId}`);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await visible(page, "Approved.", { exact: true });
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

await step(1, "On-site programme without a location is blocked before it reaches the server", async (check) => {
  await as(EMPLOYEE, async (page) => {
    await page.goto(`${BASE}/requests/new/training`);
    await page.getByRole("heading", { name: "Training request" }).waitFor();
    await page.getByLabel("Programme title").fill(PROGRAMME);
    await page.getByLabel("Provider").fill("Cloud Native Institute");
    await page.locator("label", { hasText: /^Online or on-site/ }).locator("select").selectOption("ON_SITE");
    await page.getByLabel("Start date").fill(START);
    await page.getByLabel("End date").fill(END);
    await page.getByLabel("Estimated cost (PKR)").fill("45000");
    await page.getByLabel("Business justification").fill("Hands-on cluster operations training for the platform team");
    // The Location field is required="" (like the form's other required fields), so the browser's own
    // constraint validation blocks the submit before any request is sent; it never reaches the server.
    const location = page.getByLabel("Location");
    const [navigated] = await Promise.all([
      page.waitForURL(/\/requests\/\d+/, { timeout: 2000 }).then(() => true).catch(() => false),
      page.getByRole("button", { name: "Submit training request" }).click(),
    ]);
    const message = await location.evaluate((el) => el.validationMessage);
    await snap(page, "on-site-no-location-blocked");
    if (navigated) throw new Error("DEFECT: the request was submitted without a location for an on-site programme");
    if (!message) throw new Error("Expected the browser to block submission with a required-field message on Location");
    check(`The browser blocks submission until Location is filled in ("${message}"); the page stays on the form`);
  });
});

await step(2, `Ali requests "${PROGRAMME}" (online); the chain is Hamza (Line Manager/HOD) -> Finance`, async (check) => {
  await as(EMPLOYEE, async (page) => {
    await page.goto(`${BASE}/requests/new/training`);
    await page.getByRole("heading", { name: "Training request" }).waitFor();
    await page.getByLabel("Programme title").fill(PROGRAMME);
    await page.getByLabel("Provider").fill("Cloud Native Institute");
    await page.locator("label", { hasText: /^Type/ }).locator("select").selectOption("WORKSHOP");
    await page.getByLabel("Start date").fill(START);
    await page.getByLabel("End date").fill(END);
    await page.getByLabel("Estimated cost (PKR)").fill("45000");
    await page.getByLabel("Business justification").fill("Hands-on cluster operations training for the platform team");
    await snap(page, "training-form-filled");
    await page.getByRole("button", { name: "Submit training request" }).click();
    await page.waitForURL(/\/requests\/\d+\?submitted=1/);
    ctx.requestId = Number(page.url().match(/\/requests\/(\d+)/)[1]);
    await visible(page, "Waiting for:");
    await visible(page, "Line Manager");
    await snap(page, "submitted");
    check(`Request #${ctx.requestId} submitted, waiting for the Line Manager`);
  });
});

await step(3, "Hamza (Line Manager and HOD, asked once) approves; it moves to Finance", async (check) => {
  await as(MANAGER, async (page) => {
    await approve(page, ctx.requestId);
    await visible(page, "Finance");
    await snap(page, "manager-approved");
    check("Hamza's single combined step is approved; the request now waits for Finance");
  });
});

await step(4, "Bilal (Finance) gives the final approval", async (check) => {
  await as(FINANCE, async (page) => {
    await approve(page, ctx.requestId);
    await snap(page, "finance-approved");
    check("Finance approved; the request is fully Approved");
  });
});

await step(5, "Ali sees the request Approved, with the programme details shown", async (check) => {
  await as(EMPLOYEE, async (page) => {
    await page.goto(`${BASE}/requests/${ctx.requestId}`);
    await visible(page, "Approved", { exact: true });
    await visible(page, PROGRAMME);
    await visible(page, "Cloud Native Institute");
    await snap(page, "employee-view-approved");
    check("Ali's request detail page shows Approved with the programme title and provider");
  });
});

await browser.close();
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2));
console.log(`\n${results.filter((r) => r.status === "PASS").length} of ${results.length} steps passed. Screenshots: ${OUT}`);
process.exitCode = results.every((r) => r.status === "PASS") ? 0 : 1;
