// Performance (BSC) browser test (steps 1-9) against a running portal with the demo seed data.
// See e2e/README.md. Run it with `npm run e2e`, which gives it a freshly seeded database.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const env = process.env;
const BASE = env.E2E_BASE_URL ?? "http://localhost:3000";
const MAILPIT = env.E2E_MAILPIT_URL ?? "http://127.0.0.1:8025";
const PASSWORD = env.E2E_PASSWORD ?? "Password@123";
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../test-screenshots/performance");
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (/\.(png|json|pdf)$/.test(f)) fs.rmSync(path.join(OUT, f));

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const day = (n) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const CYCLE = "Performance e2e cycle";
// A cycle that started 200 days ago, with the review window open today.
const DATES = { startDate: day(-200), endDate: day(20), goalsDueDate: day(-150), reviewOpensDate: day(0), reviewDueDate: day(30) };
const KPIS = [
  { perspective: "CUSTOMER", title: "Deliver sprints on time", measure: "Sprints delivered on schedule", target: "90%", weight: 50 },
  { perspective: "INTERNAL_PROCESS", title: "Reduce production defects", measure: "Defects per release", target: "Fewer than 5", weight: 30 },
  { perspective: "LEARNING_GROWTH", title: "Complete cloud training", measure: "Courses completed", target: "2 courses", weight: 20 },
];

const browser = await chromium.launch();
const results = [];
const ctx = {};
let shot = 0;

async function as(email, fn) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, timezoneId: "Asia/Karachi", acceptDownloads: true });
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
const card = (page, title) => page.locator("section", { has: page.getByRole("heading", { name: title, exact: true }) });
const openScorecard = async (page) => {
  await page.goto(`${BASE}/performance/${ctx.scorecard}`);
  await page.getByRole("heading", { name: new RegExp(`Ali Raza · ${CYCLE}`) }).waitFor();
};
async function mailTo(to, subjectStart) {
  for (let i = 0; i < 40; i++) {
    const mail = await (await fetch(`${MAILPIT}/api/v1/messages?limit=300`)).json();
    if (mail.messages.some((x) => x.Subject.startsWith(subjectStart) && x.To.some((t) => t.Address === to))) return;
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

// ---------- 1. Template ----------
await step(1, "HR creates the Engineering template (weights checked as you type)", async ({ check, shot: s }) => {
  await as("hr@ehb.local", async (page) => {
    await page.goto(`${BASE}/performance`);
    await page.getByRole("button", { name: "Department templates" }).click();
    const eng = card(page, "Engineering");
    await eng.getByRole("button", { name: "Create template" }).click();
    for (const [i, k] of KPIS.entries()) {
      if (i > 0) await eng.getByRole("button", { name: "Add KPI" }).click();
      const n = i + 1;
      await eng.getByLabel(`Perspective of KPI ${n}`).selectOption(k.perspective);
      await eng.getByLabel(`Title of KPI ${n}`).fill(k.title);
      await eng.getByLabel(`Weight of KPI ${n} (%)`).fill(i === 2 ? "10" : String(k.weight));
      await eng.getByLabel(`Measure of KPI ${n}`).fill(k.measure);
      await eng.getByLabel(`Target of KPI ${n}`).fill(k.target);
    }
    await eng.getByText("The weights add up to 90%; they must total 100%").waitFor();
    check("A 90% total is flagged before saving");
    await eng.getByLabel("Weight of KPI 3 (%)").fill("20");
    await eng.getByText("Total 100%").waitFor();
    s(await snap(page, "step1-template-editor"));
    await eng.getByRole("button", { name: "Save template" }).click();
    await eng.getByRole("button", { name: "Edit template" }).waitFor();
    await eng.getByText("Deliver sprints on time").waitFor();
    check("Engineering template saved: 3 KPIs, 50/30/20%");
  });
});

// ---------- 2. Cycle ----------
await step(2, "HR starts a cycle; everyone eligible gets a scorecard pre-filled from the template", async ({ check, shot: s }) => {
  await as("hr@ehb.local", async (page) => {
    await page.goto(`${BASE}/performance`);
    await page.getByRole("button", { name: "Cycles" }).click();
    await page.getByRole("button", { name: "Start a cycle" }).click();
    const form = page.locator("form", { has: page.getByRole("button", { name: "Start cycle" }) });
    await form.getByLabel("Name").fill(CYCLE);
    await form.getByLabel("Cycle starts").fill(DATES.startDate);
    await form.getByLabel("Cycle ends").fill(DATES.endDate);
    await form.getByLabel("Goals due").fill(DATES.goalsDueDate);
    await form.getByLabel("Review opens").fill(DATES.reviewOpensDate);
    await form.getByLabel("Review due").fill(DATES.reviewDueDate);
    await form.getByRole("button", { name: "Start cycle" }).click();
    await page.waitForURL(/\/performance\/cycles\/\d+$/);
    ctx.cycle = Number(/cycles\/(\d+)/.exec(page.url())[1]);
    const row = page.locator("tr", { hasText: "Ali Raza" });
    await row.getByText("Goal setting").waitFor();
    ctx.scorecard = Number(/performance\/(\d+)/.exec(await row.getByRole("link", { name: "Ali Raza" }).getAttribute("href"))[1]);
    const count = await page.locator("tbody tr").count();
    check(`Cycle #${ctx.cycle} with ${count} scorecards; Ali's is #${ctx.scorecard}`);
    s(await snap(page, "step2-cycle-overview"));
  });
  await mailTo("manager@ehb.local", `Set goals: ${CYCLE}`);
  check("Hamza is emailed to set goals");
});

// ---------- 3. Goals ----------
await step(3, "Hamza adjusts Ali's goals (from the template) and sends them", async ({ check, shot: s }) => {
  await as("manager@ehb.local", async (page) => {
    await page.goto(`${BASE}/performance`);
    await page.getByRole("button", { name: "My team" }).click();
    await page.locator("tr", { hasText: "Ali Raza" }).getByText("Set the goals").waitFor();
    await page.locator("tr", { hasText: "Ali Raza" }).getByRole("link", { name: "Ali Raza" }).click();
    const goals = card(page, "Set the goals");
    if ((await goals.getByLabel("Title of KPI 1").inputValue()) !== KPIS[0].title) throw new Error("The scorecard did not start from the template");
    check("Goals start from the Engineering template");
    await goals.getByLabel("Target of KPI 1").fill("95%");
    await goals.getByRole("button", { name: "Save goals" }).click();
    await goals.getByText("Saved.").waitFor();
    s(await snap(page, "step3-set-goals"));
    await goals.getByRole("button", { name: "Send to Ali" }).click();
    await visible(page, "Goals sent to Ali.");
    check("Target changed to 95% and goals sent");
  });
  await mailTo("employee@ehb.local", `Your goals for ${CYCLE}`);
});

// ---------- 4. Acknowledge + check-in ----------
await step(4, "Ali acknowledges the goals (agreed at once: Hamza is also the HOD) and adds a check-in note", async ({ check, shot: s }) => {
  await as("employee@ehb.local", async (page) => {
    await page.goto(`${BASE}/performance`);
    await page.getByRole("link", { name: new RegExp(CYCLE) }).click();
    await card(page, "Your goals").getByRole("button", { name: "Acknowledge goals" }).click();
    await visible(page, "Goals acknowledged.");
    await page.getByText("Goals agreed").first().waitFor();
    check("No duplicate HOD step: goals agreed on acknowledgement");
    const checkIns = card(page, "Check-ins");
    await checkIns.getByLabel("Add a check-in note").fill("Halfway: two sprints delivered early, one course started.");
    await checkIns.getByRole("button", { name: "Add note" }).click();
    await checkIns.getByText("Halfway: two sprints delivered early").waitFor();
    check("Check-in note added (comments only)");
    s(await snap(page, "step4-goals-agreed"));
  });
});

// ---------- 5. Self-review ----------
await step(5, "Ali submits the self-review", async ({ check, shot: s }) => {
  await as("employee@ehb.local", async (page) => {
    await openScorecard(page);
    const form = card(page, "Your self-review");
    const actuals = ["96% on time", "3 defects per release", "2 courses"];
    for (const [i, k] of KPIS.entries()) {
      await form.getByLabel(`Actual result for ${k.title}`).fill(actuals[i]);
      await form.getByLabel(`Your rating for ${k.title}`).selectOption(String([5, 4, 4][i]));
    }
    s(await snap(page, "step5-self-review"));
    await form.getByRole("button", { name: "Submit self-review" }).click();
    await page.getByText("Manager review").first().waitFor();
    check("Self-review submitted; now with Hamza");
  });
});

// ---------- 6. Manager review + confidentiality ----------
await step(6, "Hamza rates the KPIs and submits for sign-off; Admin and Finance cannot see the ratings", async ({ check, shot: s }) => {
  await as("manager@ehb.local", async (page) => {
    await openScorecard(page);
    const form = card(page, "Rate Ali's KPIs");
    for (const [i, k] of KPIS.entries()) await form.getByLabel(`Your rating for ${k.title}`).selectOption(String([5, 4, 3][i]));
    await form.getByLabel("Your overall comment").fill("Excellent delivery; keep building cloud skills.");
    await form.getByText("Weighted score: 4.30").waitFor();
    check("Live weighted score 4.30 (50%x5 + 30%x4 + 20%x3)");
    s(await snap(page, "step6-manager-review"));
    await form.getByRole("button", { name: "Submit for sign-off" }).click();
    await page.getByText("Waiting for:").waitFor();
    await page.getByText(/Waiting for:\s*HR/).waitFor();
    check("Sign-off goes straight to HR (Hamza is also the HOD)");
  });
  for (const email of ["admin@ehb.local", "finance@ehb.local"]) {
    await as(email, async (page) => {
      await page.goto(`${BASE}/performance/${ctx.scorecard}`);
      await visible(page, "You do not have access to this scorecard");
    });
  }
  check("Admin (Usman) and Finance (Bilal) are refused");
});

// ---------- 7. HR calibration and release ----------
await step(7, "Ayesha calibrates one rating with a reason, approves the sign-off and the result is released", async ({ check, shot: s }) => {
  await as("hr@ehb.local", async (page) => {
    await openScorecard(page);
    const cal = card(page, "Calibration (HR)");
    await cal.locator("label", { hasText: /^KPI/ }).locator("select").selectOption({ label: `${KPIS[2].title} (now 3)` });
    await cal.locator("label", { hasText: /^New rating/ }).locator("select").selectOption("4");
    await cal.getByRole("button", { name: "Change rating" }).click();
    await cal.getByText(/Give the reason/).waitFor();
    check("A change without a reason is refused");
    await cal.getByLabel(/^Reason/).fill("Both courses were completed with distinction.");
    await cal.getByRole("button", { name: "Change rating" }).click();
    await card(page, "Rating history").getByText("Both courses were completed with distinction.").waitFor();
    s(await snap(page, "step7-calibrated"));
    await cal.getByRole("link", { name: /Open the sign-off request/ }).click();
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await visible(page, "Approved.", { exact: true });
    check("Rating 3 → 4 with the reason; sign-off approved");
  });
  await mailTo("employee@ehb.local", "Your performance result is ready");
  check("Ali is emailed that his result is ready");
});

// ---------- 8. Appeal ----------
await step(8, "Ali sees 4.50 Outstanding with the history, appeals once; Ayesha decides (result kept)", async ({ check, shot: s }) => {
  await as("employee@ehb.local", async (page) => {
    await openScorecard(page);
    const result = page.getByRole("region", { name: "Result" });
    await result.getByText("4.50").waitFor();
    await result.getByText("Outstanding").waitFor();
    await card(page, "Rating history").getByText("3 → 4").waitFor();
    check("Result 4.50 · Outstanding; the original rating 3 stays in the history");
    s(await snap(page, "step8-result"));
    const mine = card(page, "Your result");
    await mine.getByLabel(/^Appeal to HR/).fill("I also mentored two new joiners, which the scorecard does not reflect.");
    await mine.getByRole("button", { name: "Appeal" }).click();
    await visible(page, "Your appeal has been sent to HR.");
  });
  await as("hr@ehb.local", async (page) => {
    await openScorecard(page);
    const appeal = card(page, "Appeal");
    await appeal.getByLabel(/^HR's decision/).fill("Mentoring is valued but already reflected in the delivery rating. The result stands.");
    await appeal.getByRole("button", { name: "Decide the appeal" }).click();
    await visible(page, "Appeal decided.");
    s(await snap(page, "step8-appeal-decided"));
  });
  check("Appeal decided by HR; result kept");
});

// ---------- 9. Acknowledge, PDF, overview ----------
await step(9, "Ali acknowledges and downloads the PDF; HR's overview shows the released rating", async ({ check, shot: s }) => {
  await as("employee@ehb.local", async (page) => {
    await openScorecard(page);
    if (await page.getByRole("button", { name: "Appeal", exact: true }).count()) throw new Error("A second appeal is offered");
    await card(page, "Your result").getByRole("button", { name: "Acknowledge result" }).click();
    await visible(page, "Result acknowledged.");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download PDF" }).click()]);
    const file = path.join(OUT, "scorecard.pdf");
    await download.saveAs(file);
    if (!fs.readFileSync(file).subarray(0, 4).equals(Buffer.from("%PDF"))) throw new Error("The scorecard download is not a PDF");
    check("No second appeal; acknowledged; PDF downloaded");
    s(await snap(page, "step9-acknowledged"));
  });
  await as("hr@ehb.local", async (page) => {
    await page.goto(`${BASE}/performance/cycles/${ctx.cycle}`);
    const dist = page.getByRole("list", { name: "Rating distribution" });
    await dist.locator("li", { hasText: "Outstanding" }).getByText("1", { exact: true }).waitFor();
    s(await snap(page, "step9-cycle-overview"));
    check("Cycle overview: 1 Outstanding");
  });
});

await browser.close();
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ ranAt: new Date().toISOString(), ...ctx, results }, null, 2));
console.log(`\n${results.filter((r) => r.status === "PASS").length} of ${results.length} steps passed. Screenshots: ${OUT}`);
process.exitCode = results.every((r) => r.status === "PASS") ? 0 : 1;
