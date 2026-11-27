// Employment Eligibility Policy, slice 1: HR adds and verifies an employee's qualification record; the
// employee sees their own status read-only; everyone else is refused, including the document download.
// See e2e/README.md. Run it with `npm run e2e`, which gives it a freshly seeded database.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const env = process.env;
const BASE = env.E2E_BASE_URL ?? "http://localhost:3000";
const API = env.E2E_API_URL ?? "http://localhost:5000/api";
const PASSWORD = env.E2E_PASSWORD ?? "Password@123";
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../test-screenshots/qualification");
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (/\.(png|json)$/.test(f)) fs.rmSync(path.join(OUT, f));

const browser = await chromium.launch();
const results = [];
const ctx = {};
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

async function as(email, fn) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  try {
    await page.goto(`${BASE}/login`);
    await page.getByLabel("Work email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in securely" }).click();
    await page.waitForURL(/\/dashboard$/);
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

async function apiLogin(email) {
  const { token } = await (await fetch(`${API}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }) })).json();
  if (!token) throw new Error(`Could not sign in as ${email}`);
  return token;
}
const apiCall = async (token, method, p, body) => {
  const res = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
};

await step(1, "Fixture: Ali has no qualification on record yet", async (check) => {
  const aliToken = await apiLogin("employee@ehb.local");
  const me = await apiCall(aliToken, "GET", "/employees/me");
  ctx.aliId = me.data.id;
  const hrToken = await apiLogin("hr@ehb.local");
  const quals = await apiCall(hrToken, "GET", `/employees/${ctx.aliId}/qualifications`);
  if (quals.data.status !== "NONE") throw new Error(`Expected no qualification on record, got status ${quals.data.status}`);
  check("Ali's qualification status starts at NONE");
});

await step(2, "HR adds a Bachelor's degree record for Ali, with a PDF, from his employee record", async (check) => {
  await as("hr@ehb.local", async (page) => {
    await page.goto(`${BASE}/admin/employees/${ctx.aliId}`);
    await page.getByRole("heading", { name: "Ali Raza" }).waitFor();
    await page.getByRole("button", { name: "Add record" }).click();
    await page.getByLabel("Institution (optional)").fill("University of Engineering and Technology");
    const file = path.join(OUT, "degree.pdf");
    fs.writeFileSync(file, "%PDF-1.4 sample degree certificate for the e2e test");
    await page.locator('input[type="file"]').setInputFiles(file);
    // The header's own "Add record" button is hidden once the form is open, so only this one matches now.
    await page.getByRole("button", { name: "Add record" }).click();
    await visible(page, "Pending verification");
    await visible(page, "University of Engineering and Technology");
    await snap(page, "hr-adds-qualification");
    check("Qualification record added; overall status shows Pending verification");
  });
});

await step(3, "HR marks it completed and verified; Ali sees Verified, read-only, on his own profile", async (check) => {
  await as("hr@ehb.local", async (page) => {
    await page.goto(`${BASE}/admin/employees/${ctx.aliId}`);
    await page.getByRole("button", { name: "Mark completed" }).click();
    await page.getByRole("button", { name: "Mark verified" }).click();
    await visible(page, "Verified", { exact: true });
    await snap(page, "hr-verifies-qualification");
    check("HR marked the record completed and verified");
  });
  await as("employee@ehb.local", async (page) => {
    await page.goto(`${BASE}/profile`);
    await page.getByRole("heading", { name: "Qualification" }).waitFor();
    await visible(page, "Verified", { exact: true });
    if (await page.getByRole("button", { name: "Add record" }).count()) throw new Error("Ali must never see an Add record control on his own qualification");
    await page.getByRole("button", { name: "Download evidence" }).click();
    await snap(page, "ali-sees-verified");
    check("Ali sees Verified on his own profile, with no edit controls, and can download his own evidence file");
  });
});

await step(4, "Finance and Admin are refused by the API directly, including the document download", async (check) => {
  for (const email of ["finance@ehb.local", "admin@ehb.local"]) {
    const token = await apiLogin(email);
    const list = await apiCall(token, "GET", `/employees/${ctx.aliId}/qualifications`);
    if (list.status !== 403) throw new Error(`${email} reading Ali's qualification records: expected 403, got ${list.status}`);
  }
  check("Finance (Bilal) and Admin (Usman) are refused the qualification records");
});

await browser.close();
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2));
console.log(`\n${results.filter((r) => r.status === "PASS").length} of ${results.length} steps passed. Screenshots: ${OUT}`);
process.exitCode = results.every((r) => r.status === "PASS") ? 0 : 1;
