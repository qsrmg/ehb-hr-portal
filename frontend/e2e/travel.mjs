// Travel browser test (steps 0–8 of the Travel test script) against a running portal.
// See e2e/README.md. It creates real data (trips, a settlement) in the database the portal uses.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const env = process.env;
const BASE = env.E2E_BASE_URL ?? "http://localhost:3000";
const MAILPIT = env.E2E_MAILPIT_URL ?? "http://127.0.0.1:8025";
const PASSWORD = env.E2E_PASSWORD ?? "Password@123";
// The traveller. A same-day trip can be settled straight away, but only once per traveller per day
// (trips may not overlap), so re-runs on the same day need another account, e.g. employee@ehb.local / Ali Raza.
const TRAVELLER = env.E2E_TRAVELLER_EMAIL ?? "employee2@ehb.local";
const TRAVELLER_NAME = env.E2E_TRAVELLER_NAME ?? "Sara Javed";
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../test-screenshots/travel");
const ONLY = env.ONLY ? env.ONLY.split(",") : null;
fs.mkdirSync(OUT, { recursive: true });
if (!ONLY) for (const f of fs.readdirSync(OUT)) if (/\.(png|json)$/.test(f)) fs.rmSync(path.join(OUT, f));

// A tiny valid PDF to use as ticket / receipt
const PDF = path.join(os.tmpdir(), "hr-portal-e2e-receipt.pdf");
fs.writeFileSync(PDF, "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

const karachiYmd = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
};
const TODAY = karachiYmd(0);
const TOMORROW = karachiYmd(1);
const fmtDate = (ymd) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

const browser = await chromium.launch();
const results = [];
let shot = fs.readdirSync(OUT).filter((f) => f.endsWith(".png")).length;
const ctx = { trip1: null, settlement: null, trip2: null };

async function as(email, fn) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, timezoneId: "Asia/Karachi", acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  try {
    await page.goto(`${BASE}/login`);
    await page.getByLabel("Work email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.getByRole("heading", { name: /Welcome/ }).waitFor();
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
const card = (page, title) => page.locator("section", { has: page.getByRole("heading", { name: title }) });
const approve = async (page, requestId) => {
  await page.goto(`${BASE}/requests/${requestId}`);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await visible(page, "Approved.", { exact: true });
};

// ONLY=3,5,6 TRIP1=<trip id> re-runs some steps against an existing trip.
if (env.TRIP1) ctx.trip1 = Number(env.TRIP1);
async function step(no, name, fn) {
  if (ONLY && !ONLY.includes(String(no))) return;
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

// ---------- Step 0: setup ----------
await step("0a", "Finance sets travel rates (allowance 2000, mileage 45, hotel limit 12000)", async ({ check, shot: s }) => {
  await as("finance@ehb.local", async (page) => {
    await page.goto(`${BASE}/admin/expense-settings`);
    const travel = card(page, "Travel rules and rates");
    await travel.getByLabel(/Daily allowance per trip day/).fill("2000");
    await travel.getByLabel(/Own-car mileage rate per km/).fill("45");
    await travel.getByLabel(/Hotel limit per night/).fill("12000");
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/settings") && r.request().method() === "PUT"),
      travel.getByRole("button", { name: "Save rules" }).click(),
    ]);
    if (response.status() !== 200) throw new Error(`Saving failed: HTTP ${response.status()}`);
    await page.waitForTimeout(800);
    const confirmed = (await travel.innerText()).includes("Saved.");
    s(await snap(page, "step0-finance-travel-settings-after-save"));
    await page.reload();
    for (const [label, value] of [[/Daily allowance per trip day/, "2000"], [/Own-car mileage rate per km/, "45"], [/Hotel limit per night/, "12000"]]) {
      const v = await card(page, "Travel rules and rates").getByLabel(label).inputValue();
      if (v !== value) throw new Error(`${label} is "${v}" after reload, expected ${value}`);
    }
    check("Travel rules saved by Finance (HTTP 200) and still there after reloading the page");
    check(confirmed ? "'Saved.' confirmation shown" : "DEFECT: no 'Saved.' confirmation stays on screen after saving changed values");
    s(await snap(page, "step0-finance-travel-settings"));
  });
});

await step("0b", "HR sets the traveller's line manager to Ayesha Siddiqui", async ({ check, shot: s }) => {
  await as("hr@ehb.local", async (page) => {
    await page.goto(`${BASE}/admin/employees`);
    await page.getByRole("link", { name: TRAVELLER_NAME }).click();
    // The dropdown sits inside its <label>, so the label's text also contains every option: match the label, then its select.
    const select = page.locator("label", { hasText: "Line manager" }).locator("select");
    await page.locator("option", { hasText: "Ayesha Siddiqui" }).first().waitFor({ state: "attached" });
    const label = (await page.locator("option", { hasText: "Ayesha Siddiqui" }).first().textContent()).trim();
    await select.selectOption({ label });
    await page.getByRole("button", { name: "Save changes" }).click();
    await visible(page, /^Saved\./);
    check(`Line manager set to "${label}"`);
    s(await snap(page, "step0-hr-sara-line-manager"));
  });
});

// ---------- Step 1: employee requests travel ----------
await step(1, "Traveller requests a same-day trip Lahore → Karachi with 15,000 advance", async ({ check, shot: s }) => {
  await as(TRAVELLER, async (page) => {
    await page.goto(`${BASE}/requests/new/travel`);
    await page.getByLabel("Purpose of the trip").fill("Client workshop at Engro, Karachi");
    await page.getByLabel("From", { exact: true }).fill("Lahore");
    await page.getByLabel("To (within Pakistan)").fill("Karachi");
    await page.getByLabel("Departure date").fill(TODAY);
    await page.getByLabel("Return date").fill(TODAY);
    await dropdown(page, "Travel by").selectOption("AIR");
    await page.getByLabel("I need a hotel").check();
    await page.getByLabel("Transport", { exact: true }).fill("25000");
    await page.getByLabel("Hotel", { exact: true }).fill("12000");
    await page.getByLabel("Meals", { exact: true }).fill("3000");
    await page.getByLabel(/Travel advance/).fill("15000");
    s(await snap(page, "step1-travel-form"));
    await page.getByRole("button", { name: "Submit travel request" }).click();
    await page.waitForURL(/\/requests\/\d+/);
    ctx.trip1 = Number(/\/requests\/(\d+)/.exec(page.url())[1]);
    const chain = await card(page, "Approval chain").innerText();
    for (const label of ["Line Manager", "Head of Department", "Finance"]) if (!chain.includes(label)) throw new Error(`Approval chain is missing "${label}": ${chain}`);
    if (!chain.includes("Ayesha Siddiqui") || !chain.includes("Hamza Malik")) throw new Error(`Unexpected approvers: ${chain.replace(/\s+/g, " ")}`);
    check(`Trip #${ctx.trip1} submitted; chain Line Manager (Ayesha) → HOD (Hamza) → Finance`);
    s(await snap(page, "step1-trip-submitted"));
  });
});

// ---------- Step 2: approvals ----------
await step(2, "Ayesha (LM), Hamza (HOD) and Bilal (Finance) approve; trip Approved", async ({ check, shot: s }) => {
  if (!ctx.trip1) throw new Error("No trip from step 1");
  await as("hr@ehb.local", async (page) => { await approve(page, ctx.trip1); check("Ayesha approved as Line Manager"); });
  await as("manager@ehb.local", async (page) => { await approve(page, ctx.trip1); check("Hamza approved as HOD"); });
  await as("finance@ehb.local", async (page) => {
    await approve(page, ctx.trip1);
    await page.reload();
    const header = await page.locator("main").innerText();
    if (/Waiting for:/.test(header)) throw new Error("Trip still waiting for an approver");
    check("Bilal approved the Finance step; trip is Approved");
    s(await snap(page, "step2-trip-approved"));
  });
});

// ---------- Step 3: Admin books ----------
await step(3, "Usman (Admin) books the flight with a ticket, marks hotel 'employee to arrange', marks Booked", async ({ check, shot: s }) => {
  await as("admin@ehb.local", async (page) => {
    await page.goto(`${BASE}/admin/travel`);
    await page.getByRole("link", { name: "Lahore → Karachi" }).first().waitFor();
    check("Trip listed under Travel → To book");
    s(await snap(page, "step3-admin-to-book"));
    await page.goto(`${BASE}/requests/${ctx.trip1}`);
    const add = card(page, "Add a booking (Admin)");
    await dropdown(add, "Item").selectOption("AIR");
    await dropdown(add, "Arranged by").selectOption("ADMIN");
    await add.getByLabel("Details").fill("PK-302 08:00");
    await add.getByLabel("Provider").fill("PIA");
    await add.getByLabel("Booking reference").fill("X7Y2Q");
    await add.getByLabel("Cost (PKR)").fill("24000");
    await add.locator('input[type="file"]').setInputFiles(PDF);
    await add.getByRole("button", { name: "Add booking" }).click();
    await card(page, "Bookings").getByText("PK-302 08:00").waitFor();
    await dropdown(add, "Item").selectOption("HOTEL");
    await dropdown(add, "Arranged by").selectOption("EMPLOYEE");
    await add.getByRole("button", { name: "Add booking" }).click();
    await card(page, "Bookings").getByText("Employee to arrange").first().waitFor();
    await page.getByRole("button", { name: "Mark as booked and notify the traveller" }).click();
    await card(page, "Trip").getByText("Booked", { exact: true }).waitFor();
    check("Air booked by Admin with ticket; hotel marked 'Employee to arrange'; trip shows Booked");
    s(await snap(page, "step3-admin-booked"));
  });
});

// ---------- Step 4: Finance pays the advance ----------
await step(4, "Bilal (Finance) pays the 15,000 advance (bank transfer, ADV-1)", async ({ check, shot: s }) => {
  await as("finance@ehb.local", async (page) => {
    await page.goto(`${BASE}/admin/travel`);
    await page.getByRole("button", { name: "Advances to pay" }).click();
    await page.getByRole("link", { name: "Lahore → Karachi" }).first().waitFor();
    check("Trip listed under Travel → Advances to pay");
    s(await snap(page, "step4-finance-advances-to-pay"));
    await page.goto(`${BASE}/requests/${ctx.trip1}`);
    const pay = card(page, "Pay the advance (Finance)");
    await dropdown(pay, "Method").selectOption("BANK_TRANSFER");
    await pay.getByLabel("Reference", { exact: true }).fill("ADV-1");
    await pay.getByRole("button", { name: "Mark advance as paid" }).click();
    await card(page, "Travel advance").getByText(/ref ADV-1/).waitFor();
    check("Advance shown as paid by bank transfer, ref ADV-1");
    s(await snap(page, "step4-advance-paid"));
  });
});

// ---------- Step 5: employee checks and settles ----------
await step(5, "Traveller: booked notice, ticket download, On duty / Travel, settlement (hotel limit, allowance, meals blocked, return 500)", async ({ check, shot: s }) => {
  await as(TRAVELLER, async (page) => {
    await page.goto(`${BASE}/notifications`);
    await visible(page, /Your travel is booked/);
    check("Notification 'Your travel is booked' received");
    s(await snap(page, "step5-notifications"));

    // Emails go through the background queue (polled every few seconds), so wait for it.
    const booked = (m) => m.Subject.startsWith("Your travel is booked") && m.To.some((t) => t.Address === TRAVELLER);
    let found = false;
    for (let i = 0; i < 40 && !found; i++) {
      const mail = await (await fetch(`${MAILPIT}/api/v1/messages?limit=200`)).json();
      found = mail.messages.some(booked);
      if (!found) await page.waitForTimeout(500);
    }
    if (!found) throw new Error(`Mailpit has no 'Your travel is booked' email for ${TRAVELLER} after 20 seconds`);
    check("Email 'Your travel is booked' is in Mailpit");

    await page.goto(`${BASE}/requests/${ctx.trip1}`);
    const [download] = await Promise.all([page.waitForEvent("download"), card(page, "Bookings").getByRole("button", { name: "Download" }).first().click()]);
    check(`Ticket downloaded (${download.suggestedFilename()})`);

    await page.goto(`${BASE}/attendance`);
    const row = page.locator("tr", { hasText: fmtDate(TODAY) });
    await row.getByText("On duty / Travel").waitFor();
    check(`Attendance shows ${fmtDate(TODAY)} as On duty / Travel`);
    s(await snap(page, "step5-attendance-travel"));

    await page.goto(`${BASE}/requests/${ctx.trip1}`);
    await page.getByRole("link", { name: "Submit trip settlement" }).click();
    await page.getByRole("button", { name: "+ Hotel" }).waitFor();

    // Hotel 1 night at 13,000: above the 12,000 limit
    await page.getByRole("button", { name: "+ Hotel" }).click();
    const hotel = page.locator("fieldset").nth(0);
    await hotel.getByLabel("Nights").fill("1");
    await hotel.getByLabel("Description").fill("Hotel One, Shahrah-e-Faisal");
    await hotel.getByLabel("Amount (PKR)").fill("13000");
    await hotel.locator('input[type="file"]').setInputFiles(PDF);
    await visible(page, /above the hotel limit of PKR 12,000 per night/);
    check("Hotel 13,000 for 1 night is refused: above the hotel limit");
    s(await snap(page, "step5-hotel-limit-error"));
    await hotel.getByLabel("Amount (PKR)").fill("11000");

    // Daily allowance: 1 day, computed as 2,000
    await page.getByRole("button", { name: "+ Daily allowance" }).click();
    const allowance = page.locator("fieldset").nth(1);
    if ((await allowance.getByLabel("Days").inputValue()) !== "1") throw new Error("Daily allowance days not prefilled with 1");

    // Expense with receipt: local transport 1,500; meals are covered by the allowance
    await page.getByRole("button", { name: "+ Expense with receipt" }).click();
    const transport = page.locator("fieldset").nth(2);
    const meals = transport.locator("option", { hasText: "Meals while travelling" });
    // Playwright isDisabled() reports false for <option>; read the DOM property instead.
    if (!(await meals.evaluate((o) => o.disabled))) throw new Error("Meals category is not disabled while the daily allowance is on");
    check("Meals category is disabled (covered by daily allowance)");
    await dropdown(transport, "Category").selectOption({ label: "Local transport at destination" });
    await transport.getByLabel("Description").fill("Careem rides to Engro");
    await transport.getByLabel("Amount (PKR)").fill("1500");
    await transport.locator('input[type="file"]').setInputFiles(PDF);

    await visible(page, "You return to Finance");
    const summary = await page.locator("main").innerText();
    if (!/Total claimed\s*PKR 14,500/.test(summary)) throw new Error(`Total is not PKR 14,500: ${summary.match(/Total claimed[^\n]*\n?[^\n]*/)?.[0]}`);
    if (!/You return to Finance\s*PKR 500/.test(summary)) throw new Error("Expected 'You return to Finance PKR 500'");
    if ((await allowance.getByLabel(/Amount \(PKR\)/).inputValue()) !== "2,000") throw new Error("Daily allowance amount is not 2,000");
    check("Allowance computed as 2,000; total 14,500; advance 15,000; 'You return to Finance PKR 500'");
    s(await snap(page, "step5-settlement-form"));
    await page.getByRole("button", { name: "Submit settlement" }).click();
    await page.waitForURL(/\/requests\/\d+\?submitted=1/);
    ctx.settlement = Number(/\/requests\/(\d+)/.exec(page.url())[1]);
    check(`Settlement #${ctx.settlement} submitted`);
    s(await snap(page, "step5-settlement-submitted"));
  });
});

// ---------- Step 6: settlement approvals, Finance reduces, advance return ----------
await step(6, "Ayesha approves; Bilal reduces transport to 1,200 and approves; return of 800 recorded; no Mark as paid", async ({ check, shot: s }) => {
  if (!ctx.settlement) throw new Error("No settlement from step 5");
  await as("hr@ehb.local", async (page) => { await approve(page, ctx.settlement); check("Ayesha approved the settlement as Line Manager"); });
  await as("finance@ehb.local", async (page) => {
    await page.goto(`${BASE}/requests/${ctx.settlement}`);
    const row = card(page, /^Expenses/).locator("tr", { hasText: "Careem rides to Engro" });
    await row.getByRole("button", { name: "Reduce" }).click();
    await row.getByPlaceholder(/New amount/).fill("1200");
    await row.getByPlaceholder(/Reason/).fill("Fare chart for Karachi");
    await row.locator('button[type="submit"]').click();
    await row.getByText("Reduced").waitFor();
    check("Local transport reduced to 1,200 with a reason");
    s(await snap(page, "step6-finance-reduced-line"));
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await visible(page, "Approved.", { exact: true });
    await page.reload();
    await visible(page, /The employee returns PKR 800 of the advance/);
    if (await page.getByRole("heading", { name: "Mark as paid (Finance)" }).count()) throw new Error("'Mark as paid' is offered although the advance covers the settlement");
    check("Settlement approved: employee returns PKR 800; no 'Mark as paid' offered");
    s(await snap(page, "step6-settlement-approved"));

    await page.goto(`${BASE}/admin/travel`);
    await page.getByRole("button", { name: "Advance returns due" }).click();
    await page.locator("tr", { hasText: "Lahore → Karachi" }).getByText("PKR 800 to recover").waitFor();
    check("Travel → Advance returns due shows PKR 800");
    s(await snap(page, "step6-returns-due"));
    await page.goto(`${BASE}/requests/${ctx.trip1}`);
    const ret = card(page, /Record the returned advance: PKR 800/);
    await dropdown(ret, "How").selectOption("SALARY_DEDUCTION");
    await ret.getByRole("button", { name: "Record return" }).click();
    await card(page, "Travel advance").getByText(/Returned PKR 800 by salary deduction/).waitFor();
    check("Return of PKR 800 by salary deduction recorded");
    s(await snap(page, "step6-advance-returned"));
  });
});

// ---------- Step 7: cancellation ----------
await step(7, "Second trip tomorrow: approved, booked, cancelled by Ayesha; Admin fee 3,000; Finance note", async ({ check, shot: s }) => {
  await as(TRAVELLER, async (page) => {
    await page.goto(`${BASE}/requests/new/travel`);
    await page.getByLabel("Purpose of the trip").fill("Vendor meeting in Islamabad");
    await page.getByLabel("To (within Pakistan)").fill("Islamabad");
    await page.getByLabel("Departure date").fill(TOMORROW);
    await page.getByLabel("Return date").fill(TOMORROW);
    await dropdown(page, "Travel by").selectOption("AIR");
    await page.getByLabel("Transport", { exact: true }).fill("18000");
    await page.getByRole("button", { name: "Submit travel request" }).click();
    await page.waitForURL(/\/requests\/\d+/);
    ctx.trip2 = Number(/\/requests\/(\d+)/.exec(page.url())[1]);
    check(`Trip #${ctx.trip2} submitted (no advance)`);
  });
  await as("hr@ehb.local", async (page) => approve(page, ctx.trip2));
  await as("manager@ehb.local", async (page) => approve(page, ctx.trip2));
  check("Approved by Ayesha and Hamza");
  await as("admin@ehb.local", async (page) => {
    await page.goto(`${BASE}/requests/${ctx.trip2}`);
    const add = card(page, "Add a booking (Admin)");
    await add.getByLabel("Details").fill("PK-371 LHE→ISB 07:00");
    await add.getByRole("button", { name: "Add booking" }).click();
    await card(page, "Bookings").getByText("PK-371").waitFor();
    check("Usman added a booking");
  });
  await as("hr@ehb.local", async (page) => {
    await page.goto(`${BASE}/requests/${ctx.trip2}`);
    const cancel = card(page, "Cancel this trip");
    await cancel.getByLabel(/Reason/).fill("Vendor postponed the meeting");
    await cancel.getByRole("button", { name: "Cancel trip" }).click();
    await visible(page, /Cancelled by Ayesha Siddiqui/);
    check("Ayesha (line manager) cancelled the trip");
    s(await snap(page, "step7-cancelled-by-manager"));
  });
  await as("admin@ehb.local", async (page) => {
    await page.goto(`${BASE}/requests/${ctx.trip2}`);
    const fee = card(page, "Cancellation fee (Admin)");
    await fee.getByLabel(/Fee \(PKR/).fill("3000");
    await fee.getByLabel("Note").fill("PIA change fee");
    await fee.getByRole("button", { name: /Record fee|Update fee/ }).click();
    await visible(page, /Cancellation fee PKR 3,000 \(paid by the company\): PIA change fee/);
    check("Usman recorded a cancellation fee of PKR 3,000 with a note");
  });
  await as("finance@ehb.local", async (page) => {
    await page.goto(`${BASE}/requests/${ctx.trip2}`);
    const note = card(page, "Finance note");
    await note.locator("textarea").fill("Fee booked to the travel cost centre");
    await note.getByRole("button", { name: "Save note" }).click();
    await visible(page, /Finance note: Fee booked to the travel cost centre/);
    check("Bilal added a Finance note; both fee and note show on the trip");
    s(await snap(page, "step7-fee-and-finance-note"));
  });
});

// ---------- Step 8: forms are separate ----------
await step(8, "Expense Claim shows only local categories (no travel categories)", async ({ check, shot: s }) => {
  await as(TRAVELLER, async (page) => {
    await page.goto(`${BASE}/requests/new/expense`);
    const select = page.getByLabel("Category").first();
    await select.locator("option").nth(1).waitFor({ state: "attached" });
    const options = (await select.locator("option").allInnerTexts()).map((o) => o.trim()).filter((o) => o && o !== "Choose…");
    const travel = options.filter((o) => ["Fare (self-arranged ticket)", "Local transport at destination", "Meals while travelling", "Other travel cost"].includes(o));
    if (travel.length) throw new Error(`Travel categories offered in Expense Claim: ${travel.join(", ")}`);
    check(`Expense Claim categories: ${options.join(", ")}`);
    await select.focus();
    s(await snap(page, "step8-expense-claim-categories"));
  });
});

await browser.close();
fs.writeFileSync(path.join(OUT, ONLY ? `results-rerun-${env.ONLY.replace(/,/g, "-")}.json` : "results.json"), JSON.stringify({ ranAt: new Date().toISOString(), today: TODAY, traveller: TRAVELLER, ...ctx, results }, null, 2));
console.log(`\n${results.filter((r) => r.status === "PASS").length} of ${results.length} steps passed. Screenshots: ${OUT}`);
process.exitCode = results.every((r) => r.status === "PASS") ? 0 : 1;
