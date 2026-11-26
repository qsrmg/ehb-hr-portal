// Pay slip correction (HR edits a pay slip after upload) browser test, steps 1-5, against the standard
// seed data (backend/prisma/seed.ts already uploads two months of pay slips for Ali and others).
// See e2e/README.md. Run it with `npm run e2e`, which gives it a freshly seeded database.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const env = process.env;
const BASE = env.E2E_BASE_URL ?? "http://localhost:3000";
const API = env.E2E_API_URL ?? "http://localhost:5000/api";
const MAILPIT = env.E2E_MAILPIT_URL ?? "http://127.0.0.1:8025";
const PASSWORD = env.E2E_PASSWORD ?? "Password@123";
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../test-screenshots/payroll");
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
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, timezoneId: "Asia/Karachi" });
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
const money = (n) => n.toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

async function apiLogin(email) {
  const { token } = await (await fetch(`${API}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }) })).json();
  if (!token) throw new Error(`Could not sign in as ${email}`);
  return token;
}
const apiCall = async (token, method, p, body) => {
  const res = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json() };
};

async function mailTo(to, subjectStart) {
  for (let i = 0; i < 40; i++) {
    const mail = await (await fetch(`${MAILPIT}/api/v1/messages?limit=300`)).json();
    const m = mail.messages.find((x) => x.Subject.startsWith(subjectStart) && x.To.some((t) => t.Address === to));
    if (m) return m;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No "${subjectStart}" email for ${to} in Mailpit`);
}

await step(1, "Fixture: Ali has an uploaded pay slip (from the seed) to correct", async (check) => {
  const aliToken = await apiLogin("employee@ehb.local");
  const me = await apiCall(aliToken, "GET", "/employees/me");
  ctx.aliId = me.data.id;
  const hrToken = await apiLogin("hr@ehb.local");
  const slips = await apiCall(hrToken, "GET", `/payroll/payslips?employeeId=${ctx.aliId}`);
  if (!slips.data.length) throw new Error("Ali has no seeded pay slips");
  ctx.slip = slips.data[0];
  check(`Ali's most recent seeded pay slip: ${ctx.slip.monthName} ${ctx.slip.year} (id ${ctx.slip.id}, basic ${ctx.slip.basic})`);
});

await step(2, "HR corrects Ali's pay slip from his employee record, with a reason", async (check) => {
  await as("hr@ehb.local", async (page) => {
    await page.goto(`${BASE}/admin/employees/${ctx.aliId}`);
    await page.getByRole("heading", { name: "Ali Raza" }).waitFor();
    // exact: true, not the sidebar's "Pay slips & tax" nav link, which also matches a plain substring search.
    await page.getByRole("link", { name: "Pay slips", exact: true }).click();
    await page.waitForURL(/\/payslips\?employeeId=/);
    const row = page.locator("tr", { has: page.getByText(`${ctx.slip.monthName} ${ctx.slip.year}`) });
    await row.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Basic").fill(String(ctx.slip.basic + 1000));
    await page.getByLabel(/^Reason/).fill("Basic allowance was under-entered on the uploaded sheet.");
    await page.getByRole("button", { name: "Save correction" }).click();
    await visible(page, "Corrected by HR on");
    const expectedGross = ctx.slip.gross + 1000;
    await visible(page, money(expectedGross));
    ctx.expectedNetPay = ctx.slip.netPay + 1000;
    await snap(page, "hr-corrects-payslip");
    check(`Gross recalculated to ${expectedGross}; "Corrected by HR" banner shown; the edit form never asked for gross/net pay directly`);
  });
});

await step(3, "Finance and Admin cannot edit the pay slip or see its history, even by calling the API directly", async (check) => {
  for (const email of ["finance@ehb.local", "admin@ehb.local"]) {
    const token = await apiLogin(email);
    const edit = await apiCall(token, "PATCH", `/payroll/payslips/${ctx.slip.id}`, { basic: 1, reason: "Should be refused" });
    if (edit.status !== 403) throw new Error(`${email} editing a pay slip: expected 403, got ${edit.status}`);
    const history = await apiCall(token, "GET", `/payroll/payslips/${ctx.slip.id}/revisions`);
    if (history.status !== 403) throw new Error(`${email} reading correction history: expected 403, got ${history.status}`);
  }
  check("Finance (Bilal) and Admin (Usman) are refused both the edit and the correction history");
});

await step(4, "Ali sees the correction on his own pay slip, with the reason but no edit controls", async (check) => {
  await as("employee@ehb.local", async (page) => {
    await page.goto(`${BASE}/payslips`);
    await page.getByRole("heading", { name: "Pay slips and tax statement" }).waitFor();
    await visible(page, `Corrected by HR on`);
    await visible(page, "Basic allowance was under-entered on the uploaded sheet.");
    await visible(page, money(ctx.expectedNetPay));
    if (await page.getByRole("button", { name: "Edit" }).count()) throw new Error("Ali must never see an Edit control on his own pay slip");
    await snap(page, "ali-sees-correction");
    check("Ali sees the reason and the corrected net pay, with no Edit button and no old-vs-new breakdown");
  });
});

await step(5, "Ali is told by notification, with no amount and no reason in the email", async (check) => {
  const mail = await mailTo("employee@ehb.local", "Pay slip corrected");
  const detail = await (await fetch(`${MAILPIT}/api/v1/message/${mail.ID}`)).json();
  if (!detail.Text.includes("Open Pay slips to see the details")) throw new Error(`Unexpected email body: ${detail.Text}`);
  if (detail.Text.includes("under-entered")) throw new Error("The reason must never appear in the email");
  if (detail.Text.includes(String(ctx.expectedNetPay)) || detail.Text.includes(String(ctx.slip.basic + 1000))) throw new Error("An amount leaked into the email");
  check(`Email to Ali: "Pay slip corrected" with no reason and no amount — only "Open Pay slips to see the details"`);
});

await browser.close();
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2));
console.log(`\n${results.filter((r) => r.status === "PASS").length} of ${results.length} steps passed. Screenshots: ${OUT}`);
process.exitCode = results.every((r) => r.status === "PASS") ? 0 : 1;
