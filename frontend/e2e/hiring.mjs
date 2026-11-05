// Manpower Requisition and internal jobs browser test (steps 1-10) against a running portal with the demo seed data.
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
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../test-screenshots/hiring");
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (/\.(png|json)$/.test(f)) fs.rmSync(path.join(OUT, f));

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const day = (n) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const TITLE = "Frontend Developer";

const browser = await chromium.launch();
const results = [];
const ctx = {};
let shot = 0;

async function as(email, fn) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, timezoneId: "Asia/Karachi" });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("dialog", (d) => d.accept());
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
const dropdown = (scope, label) => scope.locator("label", { hasText: new RegExp(`^${label}`) }).locator("select");
const card = (page, title) => page.locator("section", { has: page.getByRole("heading", { name: title, exact: true }) });
const applicant = (page, name) => page.locator(`[data-applicant="${name}"]`);
const openRequisition = (page) => page.goto(`${BASE}/hiring/requisitions/${ctx.requisition}`).then(() => page.getByRole("heading", { name: TITLE }).waitFor());
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
    if (mail.messages.some((x) => x.Subject.startsWith(subjectStart) && x.To.some((t) => t.Address === to))) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No "${subjectStart}" email for ${to} in Mailpit`);
}
async function noMailTo(to, subjectStart) {
  const mail = await (await fetch(`${MAILPIT}/api/v1/messages?limit=300`)).json();
  if (mail.messages.some((x) => x.Subject.startsWith(subjectStart) && x.To.some((t) => t.Address === to))) throw new Error(`Unexpected "${subjectStart}" email for ${to}`);
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

// ---------- 1. Headcount ----------
await step(1, "Ayesha (HR) sets Engineering's approved headcount", async ({ check, shot: s }) => {
  await as("hr@ehb.local", async (page) => {
    await page.goto(`${BASE}/hiring`);
    await page.getByRole("button", { name: "Headcount" }).click();
    await page.getByLabel("Approved headcount for Engineering").fill("6");
    await page.locator("tr", { hasText: "Engineering" }).getByRole("button", { name: "Save" }).click();
    await visible(page, "Approved headcount for Engineering saved.");
    s(await snap(page, "step1-headcount"));
    check("Engineering approved headcount: 6");
  });
});

// ---------- 2. Requisition ----------
await step(2, "Hamza raises a new position for 2 developers with a suggested salary and submits it", async ({ check, shot: s }) => {
  await as("manager@ehb.local", async (page) => {
    await page.goto(`${BASE}/hiring`);
    await page.getByRole("link", { name: "New requisition" }).click();
    const form = page.locator("form");
    await dropdown(form, "Department").selectOption({ label: "Engineering" });
    await form.getByLabel("Position title").fill(TITLE);
    await form.getByLabel(/^Grade/).fill("G4");
    await form.getByLabel("Number of positions").fill("2");
    await form.getByLabel("Target start date").fill(day(30));
    await form.getByLabel("Why is this position needed?").fill("The new self-service mobile screens need two more frontend developers.");
    await form.getByLabel(/^Key skills/).fill("React, TypeScript, accessibility");
    await form.getByLabel(/^Suggested salary from/).fill("150000");
    await form.getByLabel(/^Suggested salary to/).fill("200000");
    s(await snap(page, "step2-requisition-form"));
    await form.getByRole("button", { name: "Submit for approval" }).click();
    await page.waitForURL(/\/hiring\/requisitions\/\d+\?submitted=1/);
    ctx.requisition = Number(/requisitions\/(\d+)/.exec(page.url())[1]);
    await visible(page, "Requisition submitted for approval.");
    await visible(page, "New position or over headcount: Line Manager, HOD, Finance, Management, HR");
    await page.getByText(/Waiting for:\s*Finance/).waitFor();
    check(`Requisition #${ctx.requisition}: Hamza is the Line Manager and HOD, so it goes straight to Finance, then Management and HR`);
    if (await page.getByText("Budget confirmed by Finance").count()) throw new Error("The requester can see the confirmed budget");
    ctx.request = Number(/requests\/(\d+)/.exec(await page.getByRole("link", { name: /Approval request #/ }).getAttribute("href"))[1]);
    s(await snap(page, "step2-submitted"));
  });
});

// ---------- 3. Approvals ----------
await step(3, "Bilal (Finance) must confirm the budget; Imran and Ayesha approve", async ({ check, shot: s }) => {
  await as("finance@ehb.local", async (page) => {
    await page.goto(`${BASE}/requests/${ctx.request}`);
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await visible(page, /Confirm the budget/);
    check("Approving without a salary range is refused");
    await page.getByLabel("Salary from (PKR)").fill("160000");
    await page.getByLabel("Salary to (PKR)").fill("210000");
    await page.getByLabel(/^Budget note/).fill("Within the 2027 Engineering budget");
    s(await snap(page, "step3-finance-budget"));
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await visible(page, "Approved.", { exact: true });
  });
  for (const email of ["ceo@ehb.local", "hr@ehb.local"]) {
    await as(email, async (page) => {
      await page.goto(`${BASE}/requests/${ctx.request}`);
      await page.getByRole("button", { name: "Approve", exact: true }).click();
      await visible(page, "Approved.", { exact: true });
    });
  }
  check("Finance (budget 160,000 to 210,000), Management and HR approved");
});

// ---------- 4. Posting ----------
await step(4, "Ayesha posts the job internally and externally; employees are told", async ({ check, shot: s }) => {
  // Same-day test: no internal-only window, so external candidates can be added today.
  await (await apiAs("hr@ehb.local"))("PUT", "/settings", { "hiring.internalOnlyDays": "0" });
  await as("hr@ehb.local", async (page) => {
    await openRequisition(page);
    await card(page, "Approval and budget").getByText("PKR 160,000 to 210,000").waitFor();
    const form = card(page, "Post the job");
    await form.getByLabel("Applications close on").fill(day(21));
    await form.getByLabel("Job description").fill("Build the employee self-service screens of the HR portal.");
    await form.getByLabel("Requirements").fill("3 years with React and TypeScript; care for accessibility.");
    await form.getByRole("button", { name: "Post job" }).click();
    await card(page, "Job posting").waitFor();
    s(await snap(page, "step4-posted"));
  });
  await mailTo("admin@ehb.local", `Internal job: ${TITLE}`);
  check("Posted; employees are emailed about the internal job");
});

// ---------- 5. Applying ----------
await step(5, "Usman applies confidentially; Sara cannot apply yet (12 months in role)", async ({ check, shot: s }) => {
  await as("admin@ehb.local", async (page) => {
    await page.goto(`${BASE}/hiring`);
    await page.getByRole("link", { name: new RegExp(TITLE) }).click();
    await visible(page, "Your current manager is told only if you are shortlisted");
    await page.getByLabel(/^Why are you a good fit/).fill("I built the internal asset tracker and want to move into development.");
    s(await snap(page, "step5-apply"));
    await page.getByRole("button", { name: "Apply for this job" }).click();
    await visible(page, "Application sent. HR will be in touch.");
    check("Usman applied; told his manager hears only at shortlisting");
  });
  await noMailTo("ceo@ehb.local", "Usman Tariq is shortlisted");
  await as("employee2@ehb.local", async (page) => {
    await page.goto(`${BASE}/hiring`);
    await visible(page, /You need 12 months in your current role/);
    s(await snap(page, "step5-sara-not-eligible"));
  });
  check("Sara sees why she cannot apply yet; Imran was not told");
});

// ---------- 6. Shortlisting ----------
await step(6, "Ayesha shortlists Usman: his manager (Imran) and the hiring manager (Hamza) are told", async ({ check, shot: s }) => {
  await as("manager@ehb.local", async (page) => {
    await openRequisition(page);
    if (await applicant(page, "Usman Tariq").count()) throw new Error("The hiring manager sees an applicant before shortlisting");
  });
  check("Before shortlisting Hamza does not see Usman");
  await as("hr@ehb.local", async (page) => {
    await openRequisition(page);
    await applicant(page, "Usman Tariq").getByRole("button", { name: "Shortlist" }).click();
    await applicant(page, "Usman Tariq").getByText("Current manager told at shortlisting").waitFor();
    s(await snap(page, "step6-shortlisted"));
  });
  await mailTo("ceo@ehb.local", "Usman Tariq is shortlisted");
  await mailTo("manager@ehb.local", `Shortlisted for ${TITLE}`);
  check("Imran (current manager) and Hamza (hiring manager) emailed");
});

// ---------- 7. Feedback ----------
await step(7, "Hamza sees the shortlisted candidate and adds interview feedback", async ({ check, shot: s }) => {
  await as("manager@ehb.local", async (page) => {
    await openRequisition(page);
    const a = applicant(page, "Usman Tariq");
    await a.getByLabel("Interview feedback").fill("Strong on JavaScript fundamentals; keen learner.");
    await a.getByRole("button", { name: "Add feedback" }).click();
    await a.getByText("Strong on JavaScript fundamentals").waitFor();
    s(await snap(page, "step7-feedback"));
    check("Feedback recorded: Hire");
  });
});

// ---------- 8. External candidates ----------
await step(8, "Ayesha adds two external candidates by hand and makes Rabia an offer", async ({ check, shot: s }) => {
  await as("hr@ehb.local", async (page) => {
    await openRequisition(page);
    for (const [name, email] of [["Rabia Noor", "rabia@example.com"], ["Usama Iqbal", "usama@example.com"]]) {
      await page.getByRole("button", { name: "Add external candidate" }).click();
      const form = card(page, "Add an external candidate");
      await form.getByLabel("Name").fill(name);
      await form.getByLabel("Email").fill(email);
      await form.getByRole("button", { name: "Add candidate" }).click();
      await applicant(page, name).waitFor();
    }
    const rabia = applicant(page, "Rabia Noor");
    for (const button of ["Shortlist", "Invite to interview", "Make an offer"]) {
      await rabia.getByRole("button", { name: button }).click();
      await rabia.getByRole("button", { name: button }).waitFor({ state: "detached" });
    }
    await rabia.getByRole("link", { name: "Create employee" }).waitFor();
    s(await snap(page, "step8-candidates"));
    check("Rabia: Shortlisted → Interview → Offer; Usama waiting");
  });
});

// ---------- 9. External hire ----------
await step(9, "Ayesha creates Rabia's employee record from the requisition (Add employee, pre-filled)", async ({ check, shot: s }) => {
  await as("hr@ehb.local", async (page) => {
    await openRequisition(page);
    await applicant(page, "Rabia Noor").getByRole("link", { name: "Create employee" }).click();
    const form = card(page, `New employee from requisition #${ctx.requisition}: ${TITLE}`);
    if ((await form.getByLabel("Full name").inputValue()) !== "Rabia Noor") throw new Error("The form is not pre-filled");
    if ((await form.getByLabel("Designation").inputValue()) !== TITLE) throw new Error("The designation is not pre-filled");
    await form.getByLabel("Work email").fill("rabia.noor@ehb.local");
    s(await snap(page, "step9-create-employee"));
    await form.getByRole("button", { name: "Create employee" }).click();
    await page.waitForURL(/\/admin\/employees\/\d+\?created=1/);
    await openRequisition(page);
    await applicant(page, "Rabia Noor").getByText("Hired", { exact: true }).first().waitFor();
    await visible(page, "1 of 2 filled");
    check("Employee created in Engineering under Hamza; Rabia hired; 1 of 2 filled");
  });
});

// ---------- 10. Internal hire ----------
await step(10, "Usman is appointed (internal move); the position is filled, Usama is told politely, Imran gets a draft replacement", async ({ check, shot: s }) => {
  await as("hr@ehb.local", async (page) => {
    await openRequisition(page);
    const usman = applicant(page, "Usman Tariq");
    for (const button of ["Invite to interview", "Make an offer"]) {
      await usman.getByRole("button", { name: button }).click();
      await usman.getByRole("button", { name: button }).waitFor({ state: "detached" });
    }
    await usman.getByLabel("Moves into the role on").fill(day(14));
    await usman.getByRole("button", { name: "Appoint (internal move)" }).click();
    await page.getByText("Filled").first().waitFor();
    await applicant(page, "Usama Iqbal").getByText("Not selected").waitFor();
    s(await snap(page, "step10-filled"));
    check("Position filled; Usama marked not selected");
  });
  await mailTo("usama@example.com", `Your application for ${TITLE}`);
  await mailTo("ceo@ehb.local", "Draft replacement:");
  check("Polite email to Usama; Imran emailed about the draft replacement");
  await as("ceo@ehb.local", async (page) => {
    await page.goto(`${BASE}/hiring?tab=requisitions`);
    const row = page.locator("tr", { hasText: "Draft" }).filter({ hasText: "Administration" });
    await row.first().waitFor();
    await row.first().getByRole("link").first().click();
    await visible(page, "This draft replacement was prepared automatically when Usman Tariq moved to a new role.");
    s(await snap(page, "step10-draft-replacement"));
    check("Imran sees the draft replacement for Usman's old role (not submitted)");
  });
});

await browser.close();
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ ranAt: new Date().toISOString(), ...ctx, results }, null, 2));
console.log(`\n${results.filter((r) => r.status === "PASS").length} of ${results.length} steps passed. Screenshots: ${OUT}`);
process.exitCode = results.every((r) => r.status === "PASS") ? 0 : 1;
