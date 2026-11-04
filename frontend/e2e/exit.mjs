// Resignation & exit clearance browser test (steps 1–9) against a running portal with the demo seed data.
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
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../test-screenshots/exit");
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (/\.(png|json|pdf)$/.test(f)) fs.rmSync(path.join(OUT, f));

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const day = (n) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const PERSONAL_EMAIL = "ali.raza.personal@example.com";

const browser = await chromium.launch();
const results = [];
const ctx = {};
let shot = 0;

async function as(email, fn) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, timezoneId: "Asia/Karachi", acceptDownloads: true });
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
  const file = `${String(shot).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: path.join(OUT, file), fullPage: true });
  return file;
};
const visible = (page, text, opts = {}) => page.getByText(text, opts).first().waitFor();
// A dropdown sits inside its <label>, so the label text also contains every option: match the label's start.
const dropdown = (scope, label) => scope.locator("label", { hasText: new RegExp(`^${label}`) }).locator("select");
const selectByText = async (select, text) => {
  const option = select.locator("option", { hasText: text }).first();
  await option.waitFor({ state: "attached" });
  await select.selectOption({ label: (await option.textContent()).trim() });
};
const clearanceCard = (page, area) => page.locator(`[data-area="${area}"]`);
const cardStatus = async (page, area) => (await clearanceCard(page, area).innerText()).split("\n").map((s) => s.trim());
async function clearCard(page, caseId, area, label, comment) {
  await page.goto(`${BASE}/exits/${caseId}`);
  const c = clearanceCard(page, area);
  if (comment) await c.getByPlaceholder("Comment (optional)").fill(comment);
  await c.getByRole("button", { name: `Clear ${label}` }).click();
  await c.getByText("Cleared by").waitFor();
}

// Setup and checks that are not about the screens go through the API.
async function apiAs(email) {
  const login = await (await fetch(`${API}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }) })).json();
  return async (method, p, body) => {
    const res = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${login.token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json();
    if (!res.ok) throw new Error(`${method} ${p}: ${data.message}`);
    return data;
  };
}
async function mailTo(to, subjectStart) {
  for (let i = 0; i < 40; i++) {
    const mail = await (await fetch(`${MAILPIT}/api/v1/messages?limit=300`)).json();
    const m = mail.messages.find((x) => x.Subject.startsWith(subjectStart) && x.To.some((t) => t.Address === to));
    if (m) return m;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No "${subjectStart}" email for ${to} in Mailpit`);
}

async function step(no, name, fn) {
  const checks = [];
  const files = [];
  try {
    await fn({ check: (c) => checks.push(c), shot: (f) => files.push(f) });
    results.push({ no, name, status: "PASS", checks, files });
  } catch (err) {
    results.push({ no, name, status: "FAIL", checks, files, error: err.message.split("\n")[0] });
  }
  const r = results[results.length - 1];
  console.log(`${r.status}  Step ${no}: ${name}${r.error ? `  — ${r.error}` : ""}`);
}

// Ali holds a laptop and has a personal email on file (for the letters).
const admin = await apiAs("admin@ehb.local");
const hrApi = await apiAs("hr@ehb.local");
const people = await hrApi("GET", "/employees");
const ali = people.find((p) => p.email === "employee@ehb.local");
await hrApi("PATCH", `/employees/${ali.id}`, { personalEmail: PERSONAL_EMAIL });
const laptopCategory = (await admin("GET", "/assets/categories")).find((c) => c.name === "Laptop");
ctx.laptop = await admin("POST", "/assets", { categoryId: laptopCategory.id, name: "Dell Latitude 7440", serialNumber: "E2E-EXIT-1", cost: 280000 });
await admin("POST", `/assets/${ctx.laptop.id}/issue`, { assigneeType: "EMPLOYEE", employeeId: ali.id });

// ---------- 1. Resign ----------
await step(1, "Ali resigns with a last day before his 30-day notice ends", async ({ check, shot: s }) => {
  await as("employee@ehb.local", async (page) => {
    await page.goto(`${BASE}/requests`);
    await page.getByRole("link", { name: "Resignation" }).click();
    await visible(page, "Your notice period is");
    const noticeText = await page.getByText("Your notice period is").innerText();
    if (!noticeText.includes("30 days") || !noticeText.includes(day(30))) throw new Error(`Unexpected notice: ${noticeText}`);
    check(`Notice shown: ${noticeText}`);
    await page.getByLabel(/^Proposed last working day/).fill(day(10));
    await visible(page, "This is before your notice period ends");
    await page.getByLabel(/^Reason for resigning/).fill("I am moving to Islamabad for family reasons.");
    s(await snap(page, "step1-resignation-form"));
    await page.getByRole("button", { name: "Submit resignation" }).click();
    await page.waitForURL(/\/requests\/\d+\?submitted=1/);
    ctx.request = Number(/\/requests\/(\d+)/.exec(page.url())[1]);
    await visible(page, "Waiting for:");
    const chain = (await page.locator("section", { has: page.getByRole("heading", { name: "Approval chain" }) }).innerText()).replace(/\s+/g, " ");
    if (!/Line Manager.*HR/.test(chain)) throw new Error(`Unexpected chain: ${chain}`);
    check(`Request #${ctx.request}: Line Manager (Hamza, also the HOD) → HR`);
    s(await snap(page, "step1-submitted"));
  });
});

// ---------- 2. Line Manager ----------
await step(2, "Hamza recommends early release and approves; Sara (a colleague) cannot open the resignation", async ({ check, shot: s }) => {
  await as("manager@ehb.local", async (page) => {
    await page.goto(`${BASE}/requests/${ctx.request}`);
    const select = dropdown(page, "Early release");
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await visible(page, /recommend releasing them early/);
    check("Approving without an early-release decision is refused");
    await select.selectOption("yes");
    s(await snap(page, "step2-recommend-early-release"));
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await visible(page, "Approved.", { exact: true });
    await visible(page, "Recommended by the Line Manager");
    check("Early release recommended; now with HR");
  });
  await as("employee2@ehb.local", async (page) => {
    await page.goto(`${BASE}/requests/${ctx.request}`);
    await visible(page, "You do not have access to this request");
    check("Sara sees: You do not have access to this request");
  });
});

// ---------- 3. HR ----------
await step(3, "Ayesha approves with a 20-day shortfall (not waived); exit clearance opens and everyone is told", async ({ check, shot: s }) => {
  await as("hr@ehb.local", async (page) => {
    await page.goto(`${BASE}/requests/${ctx.request}`);
    const lwd = page.getByLabel(/^Last working day/);
    if ((await lwd.inputValue()) !== day(10)) throw new Error(`Default last working day ${await lwd.inputValue()}`);
    await visible(page, "Waive the notice shortfall of 20 days");
    check(`Last working day ${day(10)} pre-filled; shortfall of 20 days offered for waiving`);
    s(await snap(page, "step3-hr-decision"));
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await visible(page, "Approved.", { exact: true });
    await page.getByRole("link", { name: "Open exit clearance" }).click();
    await page.waitForURL(/\/exits\/\d+$/);
    ctx.exit = Number(/\/exits\/(\d+)/.exec(page.url())[1]);
    for (const [area, status] of [["IT_ADMIN", "Pending"], ["LINE_MANAGER", "Pending"], ["HR", "Pending"], ["FINANCE", "Waits for the others"]]) {
      const text = await cardStatus(page, area);
      if (!text.includes(status)) throw new Error(`${area}: ${text.join(" | ")}`);
    }
    await visible(page, "20 day(s), deducted by Finance");
    check(`Exit case #${ctx.exit}: IT / Admin, Line Manager, HR pending; Finance waits`);
    s(await snap(page, "step3-exit-case"));
  });
  await mailTo("admin@ehb.local", "Exit clearance: Ali Raza");
  await mailTo("manager@ehb.local", "Exit clearance: Ali Raza");
  await mailTo("employee@ehb.local", "Exit clearance started");
  check("Emails to Admin, Hamza and Ali");
});

// ---------- 4. Exit interview ----------
await step(4, "Ali fills in the optional exit interview; only HR sees the answers", async ({ check, shot: s }) => {
  await as("employee@ehb.local", async (page) => {
    await page.goto(`${BASE}/exits/${ctx.exit}`);
    await dropdown(page, "Main reason for leaving").selectOption("Relocation");
    await dropdown(page, "Overall experience").selectOption("4");
    await dropdown(page, "Would you recommend").selectOption("yes");
    await page.getByLabel("What should we improve?").fill("More structured training for new joiners.");
    s(await snap(page, "step4-interview-form"));
    await page.getByRole("button", { name: "Submit exit interview" }).click();
    await visible(page, "The exit interview has been submitted");
    check("Interview submitted");
  });
  await as("manager@ehb.local", async (page) => {
    await page.goto(`${BASE}/exits/${ctx.exit}`);
    await visible(page, "The exit interview has been submitted");
    if (await page.getByText("More structured training").count()) throw new Error("The line manager can read the interview");
    check("Hamza sees only that it was submitted");
  });
});

// ---------- 5. IT / Admin ----------
await step(5, "Usman cannot clear IT / Admin while Ali holds the laptop; after the return he clears it", async ({ check, shot: s }) => {
  await as("admin@ehb.local", async (page) => {
    await page.goto(`${BASE}/exits/${ctx.exit}`);
    const c = clearanceCard(page, "IT_ADMIN");
    await c.getByText(`Return: Dell Latitude 7440 (${ctx.laptop.tag})`).waitFor();
    await c.getByRole("button", { name: "Clear IT / Admin" }).click();
    await c.getByText(/Items still to collect or revoke/).waitFor();
    check("Clearing is refused while the laptop is outstanding");
    s(await snap(page, "step5-it-admin-blocked"));
    await admin("POST", `/assets/${ctx.laptop.id}/return`, { condition: "GOOD", note: "Returned at exit" });
    await clearCard(page, ctx.exit, "IT_ADMIN", "IT / Admin", "Laptop returned, accounts revoked");
    if ((await page.locator("main").innerText()).includes("Reason")) throw new Error("Admin can see the reason for leaving");
    check("Laptop returned; IT / Admin cleared; the reason for leaving is not shown to Admin");
    s(await snap(page, "step5-it-admin-cleared"));
  });
});

// ---------- 6. Line Manager and HR ----------
await step(6, "Hamza clears Line Manager and Ayesha clears HR; Finance's card opens and Bilal is emailed", async ({ check, shot: s }) => {
  await as("manager@ehb.local", (page) => clearCard(page, ctx.exit, "LINE_MANAGER", "Line Manager", "Handover to Sara done"));
  await as("hr@ehb.local", async (page) => {
    await clearCard(page, ctx.exit, "HR", "HR", "Documents collected");
    await page.reload();
    const fin = await cardStatus(page, "FINANCE");
    if (!fin.includes("Pending")) throw new Error(`Finance: ${fin.join(" | ")}`);
    s(await snap(page, "step6-finance-open"));
  });
  await mailTo("finance@ehb.local", "Final settlement: Ali Raza");
  check("Three cards cleared; Finance pending; Bilal emailed");
});

// ---------- 7. Finance ----------
await step(7, "Bilal records the final settlement with the notice shortfall and leave encashment pre-filled", async ({ check, shot: s }) => {
  await as("finance@ehb.local", async (page) => {
    await page.goto(`${BASE}/exits/${ctx.exit}`);
    const form = page.locator("section", { has: page.getByRole("heading", { name: "Final settlement (Finance)" }) });
    await form.locator("input[value*='20 day(s) of the 30-day notice period not served']").waitFor();
    await form.locator("input[value*='unused Annual Leave day(s)']").waitFor();
    check("Pre-filled: 20 days of notice not served, unused Annual Leave days");
    await form.getByRole("button", { name: "Record final settlement and clear Finance" }).click();
    await form.getByText(/Enter the amount/).waitFor();
    check("Refused until the amounts are entered");
    await form.getByLabel("Amount for Notice period not served").fill("40000");
    await form.getByLabel("Amount for Annual Leave encashment").fill("25000");
    await form.getByLabel("Reference").fill("FS-ALI-1");
    s(await snap(page, "step7-settlement-form"));
    await form.getByRole("button", { name: "Record final settlement and clear Finance" }).click();
    const done = page.locator("section", { has: page.getByRole("heading", { name: "Final settlement", exact: true }) });
    await done.getByText("PKR 15,000 owed by the employee").waitFor();
    check("Net: PKR 15,000 owed by the employee; Finance cleared");
    s(await snap(page, "step7-settled"));
  });
});

// ---------- 8. Letters ----------
await step(8, "Ayesha issues the letters (emailed to Ali's personal email as PDFs); Complete exit waits for the last working day", async ({ check, shot: s }) => {
  await as("hr@ehb.local", async (page) => {
    await page.goto(`${BASE}/exits/${ctx.exit}`);
    await visible(page, "More structured training for new joiners.");
    check("HR sees the exit interview answers");
    await page.getByRole("button", { name: "Issue experience & relieving letters" }).click();
    await visible(page, `Letters emailed to ${PERSONAL_EMAIL}.`);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Relieving letter" }).click()]);
    await download.saveAs(path.join(OUT, "relieving-letter.pdf"));
    if (!fs.readFileSync(path.join(OUT, "relieving-letter.pdf")).subarray(0, 4).equals(Buffer.from("%PDF"))) throw new Error("The relieving letter is not a PDF");
    check("Relieving letter downloaded (PDF)");
    if (!(await page.getByRole("button", { name: "Complete exit" }).isDisabled())) throw new Error("Complete exit should wait for the last working day");
    await visible(page, `The last working day (${day(10)}) has not ended yet`);
    check("Complete exit is disabled until the last working day has ended");
    s(await snap(page, "step8-letters-issued"));
  });
  const mail = await mailTo(PERSONAL_EMAIL, "Your experience and relieving letters");
  const detail = await (await fetch(`${MAILPIT}/api/v1/message/${mail.ID}`)).json();
  const names = detail.Attachments.map((a) => a.FileName).sort();
  if (names.length !== 2 || !names.every((n) => n.endsWith(".pdf"))) throw new Error(`Attachments: ${names.join(", ")}`);
  check(`Email to ${PERSONAL_EMAIL} with ${names.join(" and ")}`);
});

// ---------- 9. Termination ----------
await step(9, "Ayesha starts a termination for Sara (last day yesterday); after clearance she completes it and Sara can no longer log in", async ({ check, shot: s }) => {
  await as("hr@ehb.local", async (page) => {
    await page.goto(`${BASE}/exits`);
    await page.getByRole("button", { name: "Start an exit" }).click();
    const form = page.locator("form", { has: page.getByRole("button", { name: "Start exit clearance" }) });
    await selectByText(dropdown(form, "Employee"), "Sara Javed");
    await dropdown(form, "Reason for the exit").selectOption("END_OF_CONTRACT");
    await form.getByLabel("Notice given on").fill(day(-1));
    await form.getByLabel(/^Last working day/).fill(day(-1));
    await form.getByLabel(/^Details/).fill("Fixed-term contract ended.");
    s(await snap(page, "step9-start-exit"));
    await form.getByRole("button", { name: "Start exit clearance" }).click();
    await page.waitForURL(/\/exits\/\d+$/);
    ctx.saraExit = Number(/\/exits\/(\d+)/.exec(page.url())[1]);
    check(`Exit case #${ctx.saraExit} (End of contract)`);
  });
  await as("admin@ehb.local", (page) => clearCard(page, ctx.saraExit, "IT_ADMIN", "IT / Admin"));
  await as("manager@ehb.local", (page) => clearCard(page, ctx.saraExit, "LINE_MANAGER", "Line Manager"));
  await as("hr@ehb.local", (page) => clearCard(page, ctx.saraExit, "HR", "HR"));
  await as("finance@ehb.local", async (page) => {
    await page.goto(`${BASE}/exits/${ctx.saraExit}`);
    const form = page.locator("section", { has: page.getByRole("heading", { name: "Final settlement (Finance)" }) });
    await form.getByRole("button", { name: "Record final settlement and clear Finance" }).waitFor();
    for (const input of await form.getByLabel(/^Amount for/).all()) if (Number(await input.inputValue()) === 0) await input.fill("10000");
    await form.getByRole("button", { name: "Record final settlement and clear Finance" }).click();
    await page.locator("section", { has: page.getByRole("heading", { name: "Final settlement", exact: true }) }).waitFor();
  });
  check("All four cards cleared");
  await as("hr@ehb.local", async (page) => {
    await page.goto(`${BASE}/exits/${ctx.saraExit}`);
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Complete exit" }).click();
    await visible(page, "Exit completed.");
    await visible(page, "Login switched off");
    check("Exit completed; login switched off");
    s(await snap(page, "step9-completed"));
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Work email").fill("employee2@ehb.local");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await page.getByRole("alert").waitFor();
  s(await snap(page, "step9-sara-login-refused"));
  await context.close();
  check("Sara's login is refused");
});

await browser.close();
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ ranAt: new Date().toISOString(), ...ctx, results }, null, 2));
console.log(`\n${results.filter((r) => r.status === "PASS").length} of ${results.length} steps passed. Screenshots: ${OUT}`);
process.exitCode = results.every((r) => r.status === "PASS") ? 0 : 1;
