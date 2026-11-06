// Regression tests for two request-form bugs. See e2e/README.md. Run with `npm run e2e`.
// 1. Apply for leave: the "These dates overlap with leave request #N" error from a failed submit must
//    clear as soon as the employee changes the dates, not stay stuck once they pick dates that no longer
//    overlap.
// 2. Attendance Update: the date picker must not let the employee pick a future date or one older than
//    the request window, rather than only rejecting it after Submit.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const env = process.env;
const BASE = env.E2E_BASE_URL ?? "http://localhost:3000";
const API = env.E2E_API_URL ?? "http://localhost:5000/api";
const PASSWORD = env.E2E_PASSWORD ?? "Password@123";
const EMPLOYEE = env.E2E_EMPLOYEE_EMAIL ?? "employee@ehb.local";
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../test-screenshots/leave");
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

// Two blocks of weekdays in December 2026, well apart so they can never overlap: an "existing" day
// already booked (used to trigger the overlap error) and a "clear" pair of days used to prove it goes away.
const isWeekend = (d) => [0, 6].includes(d.getUTCDay());
const nextWeekday = (d) => { const r = new Date(d); while (isWeekend(r)) r.setUTCDate(r.getUTCDate() + 1); return r; };
const addDays = (d, n) => { const r = new Date(d); r.setUTCDate(r.getUTCDate() + n); return r; };
const ymd = (d) => d.toISOString().slice(0, 10);
const fmtDate = (s) => new Date(`${s}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });

const EXISTING_DAY = ymd(nextWeekday(new Date("2026-12-20T00:00:00Z")));
const CLEAR_START = ymd(nextWeekday(new Date("2026-12-01T00:00:00Z")));
const CLEAR_END = ymd(nextWeekday(addDays(new Date(`${CLEAR_START}T00:00:00Z`), 1)));

const browser = await chromium.launch();
const snap = async (page, name) => {
  shot++;
  await page.screenshot({ path: path.join(OUT, `${String(shot).padStart(2, "0")}-${name}.png`), fullPage: true });
};

async function apiLogin(email) {
  const { token } = await (await fetch(`${API}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }) })).json();
  if (!token) throw new Error(`Could not sign in as ${email}`);
  return token;
}

let existingRequestId;
await step(1, `Fixture: ${EMPLOYEE} already has a casual leave booked on ${EXISTING_DAY}`, async (check) => {
  const token = await apiLogin(EMPLOYEE);
  const types = await (await fetch(`${API}/leave/types`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const casual = types.find((t) => t.code === "CL");
  if (!casual) throw new Error("No Casual Leave type in the seed");
  const fd = new FormData();
  for (const [k, v] of Object.entries({ leaveTypeId: casual.id, startDate: EXISTING_DAY, endDate: EXISTING_DAY, reason: "Existing leave (e2e fixture)" })) fd.append(k, String(v));
  const created = await (await fetch(`${API}/requests/leave`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd })).json();
  if (!created.id) throw new Error(`Could not create the fixture leave request: ${created.message}`);
  existingRequestId = created.id;
  check(`Fixture leave request #${existingRequestId} created on ${EXISTING_DAY}`);
});

await step(2, "Overlapping dates: submitting shows the overlap error", async (check) => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, timezoneId: "Asia/Karachi" });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  try {
    await page.goto(`${BASE}/login`);
    await page.getByLabel("Work email").fill(EMPLOYEE);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in securely" }).click();
    await page.waitForURL(/\/dashboard$/);

    await page.goto(`${BASE}/requests/new/leave`);
    await page.getByRole("heading", { name: "Apply for leave" }).waitFor();
    await page.locator("label", { hasText: /^Leave type/ }).locator("select").selectOption({ label: "Casual Leave" });
    await page.getByLabel("From", { exact: true }).fill(EXISTING_DAY);
    await page.getByLabel("To", { exact: true }).fill(EXISTING_DAY);
    await page.getByLabel("Reason", { exact: true }).fill("Should be blocked by the overlap check");
    await page.getByRole("button", { name: "Submit leave request" }).click();

    // Scoped to `main` because Next's route announcer also has role="alert" (and no text) outside it.
    const alert = page.locator("main [role=alert]").first();
    await alert.waitFor();
    const text = await alert.innerText();
    if (!new RegExp(`overlap with leave request #${existingRequestId}\\b`).test(text)) {
      throw new Error(`Expected the overlap error for request #${existingRequestId}, got: "${text}"`);
    }
    await snap(page, "overlap-error-shown");
    check(`Submitting ${EXISTING_DAY} again shows "These dates overlap with leave request #${existingRequestId}"`);

    // Now change to dates that don't overlap at all, without touching Submit again.
    await page.getByLabel("From", { exact: true }).fill(CLEAR_START);
    await page.getByLabel("To", { exact: true }).fill(CLEAR_END);
    // Let the 250ms debounced /leave/preview call (and the fix) settle.
    await page.waitForTimeout(800);

    const stillShowing = await page.getByText(/overlap with leave request/i).count();
    await snap(page, "overlap-error-cleared");
    if (stillShowing > 0) {
      throw new Error(`The overlap message for request #${existingRequestId} is still shown after switching to non-overlapping dates ${CLEAR_START} to ${CLEAR_END}`);
    }
    check(`Switching to ${fmtDate(CLEAR_START)}–${fmtDate(CLEAR_END)} (no overlap) clears the error without resubmitting`);

    // And the form actually works now: it submits cleanly on the non-overlapping dates.
    await page.getByRole("button", { name: "Submit leave request" }).click();
    await page.waitForURL(/\/requests\/\d+(\?|$)/, { timeout: 15000 });
    check("Submits successfully on the corrected, non-overlapping dates");
  } catch (err) {
    await snap(page, "FAILED").catch(() => {});
    throw err;
  } finally {
    await context.close();
  }
});

await step(3, "Attendance Update: the date picker's min/max match the request window", async (check) => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, timezoneId: "Asia/Karachi" });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  try {
    await page.goto(`${BASE}/login`);
    await page.getByLabel("Work email").fill(EMPLOYEE);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in securely" }).click();
    await page.waitForURL(/\/dashboard$/);

    await page.goto(`${BASE}/requests/new/attendance-update`);
    await page.getByRole("heading", { name: "Attendance update" }).waitFor();
    // Not getByLabel: once the window loads, a hint ("Within the last N days") joins "Date" inside the
    // same <label>, so the accessible name is no longer exactly "Date". The date input is the only one here.
    const dateInput = page.locator('input[type="date"]');
    await dateInput.waitFor();
    // The default seed leaves the window at 7 days (SETTING_DEFAULTS["attendanceUpdate.windowDays"]).
    const windowDays = 7;
    const karachiYmd = (offsetDays = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date(Date.now() + offsetDays * 86_400_000));
    const expectedMax = karachiYmd(0);
    const expectedMin = karachiYmd(-windowDays);
    // min comes from GET /attendance/me, fetched after the form mounts; wait for it to arrive.
    await page.waitForFunction(() => document.querySelector('input[type="date"]')?.getAttribute("min"));
    const [min, max] = await Promise.all([dateInput.getAttribute("min"), dateInput.getAttribute("max")]);
    if (max !== expectedMax) throw new Error(`Expected max="${expectedMax}" (today), got "${max}"`);
    if (min !== expectedMin) throw new Error(`Expected min="${expectedMin}" (${windowDays} days ago), got "${min}"`);
    await snap(page, "attendance-update-date-bounds");
    check(`Date input has min="${min}" and max="${max}", so the browser itself refuses a future or too-old date`);
  } catch (err) {
    await snap(page, "FAILED-attendance-update").catch(() => {});
    throw err;
  } finally {
    await context.close();
  }
});

await browser.close();
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2));
console.log(`\n${results.filter((r) => r.status === "PASS").length} of ${results.length} steps passed. Screenshots: ${OUT}`);
process.exitCode = results.every((r) => r.status === "PASS") ? 0 : 1;
