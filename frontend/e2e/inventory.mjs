// My Inventory browser test (steps 1–12 of the My Inventory test script) against a running portal.
// See e2e/README.md. It creates real data (assets, a request) in the database the portal uses.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const env = process.env;
const BASE = env.E2E_BASE_URL ?? "http://localhost:3000";
const MAILPIT = env.E2E_MAILPIT_URL ?? "http://127.0.0.1:8025";
const PASSWORD = env.E2E_PASSWORD ?? "Password@123";
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../test-screenshots/inventory");
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (/\.(png|json|csv)$/.test(f)) fs.rmSync(path.join(OUT, f));

// Every run uses its own names and tags, so the test can be repeated on the same database.
const RUN = Date.now().toString(36).slice(-4).toUpperCase();
const ITEM = {
  laptop: `Dell Latitude 5440 ${RUN}`,
  spare: `HP EliteBook 840 ${RUN}`,
  spareTag: `OLD-LT-${RUN}`,
  mouse: `Logitech M185 ${RUN}`,
  email: `Google Workspace email ${RUN}`,
  monitor: `Dell P2422H ${RUN}`,
};
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const inYears = (n) => `${Number(today.slice(0, 4)) + n}${today.slice(4)}`;

// Demo accounts by name: the requester's line manager is read from the approval chain (other tests may change it).
const ACCOUNTS = { "Hamza Malik": "manager@ehb.local", "Ayesha Siddiqui": "hr@ehb.local", "Imran Qureshi": "ceo@ehb.local", "Bilal Ahmed": "finance@ehb.local", "Usman Tariq": "admin@ehb.local" };

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
const card = (page, title) => page.locator("section", { has: page.getByRole("heading", { name: title }) });
// Admin / HR / Management action forms on the asset page carry their title as text.
const action = (page, title) => page.locator("form").filter({ has: page.getByText(title, { exact: true }) }).first();
const selectByText = async (select, text) => {
  const option = select.locator("option", { hasText: text }).first();
  await option.waitFor({ state: "attached" });
  await select.selectOption({ label: (await option.textContent()).trim() });
};
const approve = async (page, requestId) => {
  await page.goto(`${BASE}/requests/${requestId}`);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await visible(page, "Approved.", { exact: true });
};
async function waitForEmail(to, subjectStart) {
  for (let i = 0; i < 40; i++) {
    const mail = await (await fetch(`${MAILPIT}/api/v1/messages?limit=300`)).json();
    if (mail.messages.some((m) => m.Subject.startsWith(subjectStart) && m.To.some((t) => t.Address === to))) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No "${subjectStart}" email for ${to} in Mailpit`);
}

async function addAsset(page, { category, name, tag = "", serial = "", cost = "", warranty = "" }) {
  await page.goto(`${BASE}/admin/assets`);
  await page.getByRole("button", { name: "Add an asset" }).click();
  const form = page.locator("form", { has: page.getByRole("button", { name: "Add asset" }) });
  await selectByText(dropdown(form, "Category"), category);
  await form.getByLabel("Name (make / model, or account)").fill(name);
  if (tag) await form.getByLabel(/^Tag/).fill(tag);
  if (serial) await form.getByLabel("Serial number / account").fill(serial);
  if (cost) await form.getByLabel("Cost (PKR)").fill(cost);
  if (warranty) await form.getByLabel("Warranty until").fill(warranty);
  await form.getByRole("button", { name: "Add asset" }).click();
  await page.waitForURL(/\/admin\/assets\/\d+$/);
  await page.getByRole("heading", { name }).waitFor();
  const id = Number(/\/admin\/assets\/(\d+)/.exec(page.url())[1]);
  const subtitle = await page.locator("main p").first().innerText();
  return { id, tag: subtitle.split(" · ")[0].trim() };
}
async function issueToEmployee(page, assetId, who, title = "Issue", button = "Issue item") {
  await page.goto(`${BASE}/admin/assets/${assetId}`);
  const form = action(page, title);
  await dropdown(form, "Issue to").selectOption("EMPLOYEE");
  await selectByText(dropdown(form, "Employee"), who);
  await form.getByRole("button", { name: button }).click();
  await visible(page, new RegExp(`With\\s+${who}`));
}
const clearanceText = async (page) => {
  await page.goto(`${BASE}/admin/employees`);
  await page.getByRole("link", { name: "Sara Javed" }).click();
  const c = card(page, "Asset clearance");
  await c.getByText(/Cleared|Blocked/).first().waitFor();
  return c.innerText();
};

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

// ---------- 1. Register ----------
await step(1, "Admin adds a laptop (generated tag), a laptop with its own tag, a mouse and an email account", async ({ check, shot: s }) => {
  await as("admin@ehb.local", async (page) => {
    ctx.laptop = await addAsset(page, { category: "Laptop", name: ITEM.laptop, serial: `7XK2Q73-${RUN}`, cost: "285000", warranty: inYears(3) });
    if (!/^EHB-AST-\d{4}$/.test(ctx.laptop.tag)) throw new Error(`Expected a generated EHB-AST tag, got ${ctx.laptop.tag}`);
    check(`Laptop added with generated tag ${ctx.laptop.tag}`);
    s(await snap(page, "step1-laptop-added"));
    ctx.spare = await addAsset(page, { category: "Laptop", name: ITEM.spare, tag: ITEM.spareTag, cost: "240000" });
    if (ctx.spare.tag !== ITEM.spareTag) throw new Error(`Own tag not kept: ${ctx.spare.tag}`);
    check(`Own tag kept: ${ctx.spare.tag}`);
    ctx.mouse = await addAsset(page, { category: "Accessories", name: ITEM.mouse });
    ctx.email = await addAsset(page, { category: "Access & accounts", name: ITEM.email, serial: `sara.${RUN.toLowerCase()}@ehb.pk` });
    check(`Mouse (${ctx.mouse.tag}) and email account (${ctx.email.tag}) added`);
    await page.goto(`${BASE}/admin/assets`);
    await page.getByPlaceholder("Search tag, name or serial").fill(RUN);
    await page.getByRole("link", { name: ctx.laptop.tag }).waitFor();
    s(await snap(page, "step1-register"));
  });
});

// ---------- 2. Issue ----------
await step(2, "Admin issues the laptop and mouse to Sara and grants her the email account", async ({ check, shot: s }) => {
  await as("admin@ehb.local", async (page) => {
    await issueToEmployee(page, ctx.laptop.id, "Sara Javed");
    await issueToEmployee(page, ctx.mouse.id, "Sara Javed");
    await issueToEmployee(page, ctx.email.id, "Sara Javed", "Grant access", "Grant access");
    if (/awaiting their confirmation/.test(await page.locator("main").innerText())) throw new Error("Access item should not need confirmation");
    check("Laptop and mouse issued; email granted without confirmation");
    s(await snap(page, "step2-email-granted"));
  });
  await waitForEmail("employee2@ehb.local", `Item issued to you: ${ITEM.laptop}`);
  check("Sara got the 'Item issued to you' email");
});

// ---------- 3. Employee confirms and reports ----------
await step(3, "Sara confirms the laptop and reports it lost", async ({ check, shot: s }) => {
  await as("employee2@ehb.local", async (page) => {
    await page.goto(`${BASE}/inventory`);
    const laptop = page.locator("li", { hasText: ITEM.laptop });
    const mouse = page.locator("li", { hasText: ITEM.mouse });
    const email = page.locator("li", { hasText: ITEM.email });
    await laptop.getByRole("button", { name: "Confirm I received it" }).waitFor();
    await mouse.getByRole("button", { name: "Confirm I received it" }).waitFor();
    await email.getByText("Confirmed").waitFor();
    check("Laptop and mouse wait for confirmation; email already confirmed");
    s(await snap(page, "step3-my-inventory"));
    await laptop.getByRole("button", { name: "Confirm I received it" }).click();
    await laptop.getByText("Confirmed").waitFor();
    await laptop.getByRole("button", { name: "Report a problem" }).click();
    await dropdown(laptop, "Problem").selectOption("LOST");
    await laptop.getByLabel("What happened?").fill("Left in a taxi on Monday");
    await laptop.getByRole("button", { name: "Send to Admin" }).click();
    await visible(page, "Your report was sent to Admin.");
    check("Laptop confirmed, then reported lost");
    s(await snap(page, "step3-reported-lost"));
  });
});

// ---------- 4. Admin records it ----------
await step(4, "Admin records the report as Lost; HR and Management are told", async ({ check, shot: s }) => {
  await as("admin@ehb.local", async (page) => {
    await page.goto(`${BASE}/admin/assets`);
    await page.getByRole("button", { name: "Damage & loss", exact: true }).click();
    await page.getByRole("link", { name: ITEM.laptop }).click();
    const form = action(page, "Record this report");
    await dropdown(form, "Confirmed as").selectOption("LOST");
    await form.getByRole("button", { name: "Record", exact: true }).click();
    await page.locator("main").getByText("Lost", { exact: true }).first().waitFor();
    await visible(page, "Awaiting HR / Management");
    check("Laptop status Lost; incident awaiting HR / Management");
    s(await snap(page, "step4-recorded-lost"));
  });
  await waitForEmail("hr@ehb.local", "Asset lost");
  await waitForEmail("ceo@ehb.local", "Asset lost");
  check("HR and Management got the 'Asset lost' email");
});

// ---------- 5. HR ----------
await step(5, "HR: Sara's clearance blocked; recovery screen shows purchase cost and date; recovery 45,000 set", async ({ check, shot: s }) => {
  await as("hr@ehb.local", async (page) => {
    const before = await clearanceText(page);
    if (!/Blocked/.test(before) || !before.includes(ITEM.laptop) || !before.includes(ITEM.email)) throw new Error(`Clearance should be blocked by the laptop and email: ${before.replace(/\s+/g, " ")}`);
    if (!/Recover or write off/.test(before) || !/Revoke/.test(before)) throw new Error("Expected 'Recover or write off' and 'Revoke'");
    if (!before.includes(ITEM.mouse) || !/not required on exit/.test(before)) throw new Error("The mouse should be listed as not required on exit");
    check("Clearance blocked: laptop (recover or write off), email (revoke); mouse not required");
    s(await snap(page, "step5-clearance-blocked"));

    await page.goto(`${BASE}/admin/assets/${ctx.laptop.id}`);
    if ((await card(page, "Details").innerText()).includes("Cost")) throw new Error("HR can see the cost in the item details");
    const form = action(page, "Set a recovery amount (HR)");
    await form.getByText(/Purchase cost:\s*PKR 285,000/).waitFor();
    check("Recovery screen shows the purchase cost (PKR 285,000) and date; item details still hide the cost");
    s(await snap(page, "step5-recovery-form-with-cost"));
    await form.getByLabel(/Amount \(PKR\)/).fill("45000");
    await form.getByLabel("Reason").fill("Depreciated value, 3 years old");
    await form.getByRole("button", { name: "Set recovery" }).click();
    await visible(page, /Recovery PKR 45,000 set by Ayesha Siddiqui/);
    const after = await clearanceText(page);
    if (!/Recoveries for the final settlement: PKR 45,000/.test(after)) throw new Error("Recovery not shown on the clearance card");
    if (after.includes(ITEM.laptop) && /Blocked: 2/.test(after)) throw new Error("The laptop should no longer block clearance");
    check("Recovery 45,000 set; clearance now lists the recovery and only the email blocks");
    s(await snap(page, "step5-clearance-after-recovery"));
  });
  await waitForEmail("employee2@ehb.local", `Recovery set: ${ITEM.laptop}`);
  check("Sara got the 'Recovery set' email");
});

// ---------- 6. Management ----------
await step(6, "Management writes off the laptop; the recovery no longer applies", async ({ check, shot: s }) => {
  await as("ceo@ehb.local", async (page) => {
    await page.goto(`${BASE}/admin/assets/${ctx.laptop.id}`);
    const form = action(page, "Write off (Management)");
    await form.getByLabel("Reason").fill("Theft reported to police; long-serving employee");
    await form.getByRole("button", { name: "Write off" }).click();
    await visible(page, /Written off by Imran Qureshi/);
    if (/Recovery PKR 45,000/.test(await page.locator("main").innerText())) throw new Error("The recovery is still shown after the write-off");
    check("Written off by Management; recovery removed");
    s(await snap(page, "step6-written-off"));
  });
  await waitForEmail("employee2@ehb.local", `Written off: ${ITEM.laptop}`);
  check("Sara got the 'Written off' email");
});

// ---------- 7. Revoke ----------
await step(7, "Admin revokes the email account; Sara's clearance becomes Cleared", async ({ check, shot: s }) => {
  await as("admin@ehb.local", async (page) => {
    await page.goto(`${BASE}/admin/assets/${ctx.email.id}`);
    await action(page, "Revoke access").getByRole("button", { name: "Revoke" }).click();
    await page.locator("main").getByText("In stock", { exact: true }).first().waitFor();
    check("Email account revoked");
  });
  await as("hr@ehb.local", async (page) => {
    const text = await clearanceText(page);
    if (!/Cleared/.test(text)) throw new Error(`Expected Cleared: ${text.replace(/\s+/g, " ")}`);
    check("Clearance shows Cleared, although Sara still has the mouse");
    s(await snap(page, "step7-clearance-cleared"));
  });
});

// ---------- 8. Repairs ----------
await step(8, "Admin sends the spare laptop for repair and records its return with cost 18,000; HR does not see the cost", async ({ check, shot: s }) => {
  await as("admin@ehb.local", async (page) => {
    await page.goto(`${BASE}/admin/assets/${ctx.spare.id}`);
    const send = action(page, "Send for repair");
    await send.getByLabel("Vendor").fill("Dell Service Centre");
    await send.getByRole("button", { name: "Send for repair" }).click();
    await page.locator("main").getByText("In repair", { exact: true }).first().waitFor();
    const back = page.locator("form").filter({ hasText: /^Back from repair/ }).first();
    await back.getByLabel("Repair cost (PKR)").fill("18000");
    await back.getByRole("button", { name: "Record repair return" }).click();
    await card(page, "Repair log").getByText("18,000").waitFor();
    check("Repair logged: Dell Service Centre, cost 18,000, item back in stock");
    s(await snap(page, "step8-repair-log"));
  });
  await as("hr@ehb.local", async (page) => {
    await page.goto(`${BASE}/admin/assets/${ctx.spare.id}`);
    const log = await card(page, "Repair log").innerText();
    if (/18,000/.test(log) || /\bCost\b/i.test(log.split("\n")[0] ?? "")) throw new Error("HR can see the repair cost");
    if (log.indexOf("Dell Service Centre") < 0) throw new Error("HR cannot see the repair log");
    check("HR sees the repair log without the cost");
  });
});

// ---------- 9. Department item ----------
await step(9, "Admin issues the spare laptop to the Engineering department (confirmed automatically)", async ({ check, shot: s }) => {
  await as("admin@ehb.local", async (page) => {
    await page.goto(`${BASE}/admin/assets/${ctx.spare.id}`);
    const form = action(page, "Issue");
    await dropdown(form, "Issue to").selectOption("DEPARTMENT");
    await selectByText(dropdown(form, "Department"), "Engineering");
    await form.getByRole("button", { name: "Issue item" }).click();
    await visible(page, /With\s+Department: Engineering/);
    if (/awaiting their confirmation/.test(await page.locator("main").innerText())) throw new Error("Department items should not need confirmation");
    check("Issued to Department: Engineering, no confirmation needed");
    s(await snap(page, "step9-department-item"));
  });
});

// ---------- 10. Request ----------
await step(10, "Ali requests a monitor; his line manager and Admin approve; Admin issues one from stock; Ali sees it", async ({ check, shot: s }) => {
  await as("employee@ehb.local", async (page) => {
    await page.goto(`${BASE}/requests/new/asset`);
    await selectByText(dropdown(page, "What do you need"), "Monitor");
    await page.getByLabel("Why do you need it?").fill("Second screen for code reviews");
    await page.getByRole("button", { name: "Submit request" }).click();
    await page.waitForURL(/\/requests\/\d+/);
    ctx.request = Number(/\/requests\/(\d+)/.exec(page.url())[1]);
    const chain = (await card(page, "Approval chain").innerText()).replace(/\s+/g, " ");
    const manager = Object.keys(ACCOUNTS).find((n) => chain.includes(`Line Manager Pending ${n}`));
    if (!manager || !/Admin Waiting/.test(chain)) throw new Error(`Expected Line Manager → Admin, got: ${chain}`);
    ctx.lineManager = manager;
    check(`Request #${ctx.request}: Line Manager (${manager}) → Admin`);
  });
  await as(ACCOUNTS[ctx.lineManager], (page) => approve(page, ctx.request));
  await as("admin@ehb.local", async (page) => {
    await approve(page, ctx.request);
    ctx.monitor = await addAsset(page, { category: "Monitor", name: ITEM.monitor, serial: `MON-${RUN}` });
    await page.goto(`${BASE}/requests/${ctx.request}`);
    const panel = card(page, "Asset request");
    await selectByText(dropdown(panel, "Issue a monitor from stock"), ITEM.monitor);
    await panel.getByRole("button", { name: "Issue to the employee" }).click();
    await panel.getByText(new RegExp(`${ITEM.monitor} \\(${ctx.monitor.tag}\\)`)).waitFor();
    check(`Approved by ${ctx.lineManager} and Admin; ${ctx.monitor.tag} issued from stock`);
    s(await snap(page, "step10-request-fulfilled"));
  });
  await waitForEmail("admin@ehb.local", "Asset to issue: Monitor");
  await as("employee@ehb.local", async (page) => {
    await page.goto(`${BASE}/inventory`);
    await page.locator("li", { hasText: ITEM.monitor }).getByRole("button", { name: "Confirm I received it" }).waitFor();
    check("Ali sees the monitor in My Inventory, awaiting his confirmation");
    s(await snap(page, "step10-ali-inventory"));
  });
});

// ---------- 11. Import ----------
await step(11, "Admin downloads the template and imports a file (existing tag, generated tag, unknown category skipped)", async ({ check, shot: s }) => {
  await as("admin@ehb.local", async (page) => {
    await page.goto(`${BASE}/admin/assets`);
    await page.getByRole("button", { name: "Import", exact: true }).click();
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download the Excel template" }).click()]);
    if (download.suggestedFilename() !== "asset-import-template.xlsx") throw new Error(`Unexpected template file ${download.suggestedFilename()}`);
    check("Excel template downloaded");
    // Same columns as the template, saved as CSV (the import accepts both)
    const csv = [
      "Tag,Category,Name,Serial number,Purchase date,Cost,Warranty until,Condition,Storage location,Notes,Assigned to employee,Assigned to department,Assigned to location",
      `IMP-${RUN},Monitor,Samsung S24 ${RUN},SS-${RUN},10/02/2025,42000,10/02/2028,Good,IT store,,,,`,
      `,Other,Epson projector ${RUN},EP-${RUN},,,,Fair,,,,,Meeting room 2`,
      `,Drones,DJI Mini ${RUN},,,,,,,,,,`,
    ].join("\n");
    const file = path.join(os.tmpdir(), `asset-import-${RUN}.csv`);
    fs.writeFileSync(file, csv);
    await page.locator('input[type="file"]').setInputFiles(file);
    await page.getByRole("button", { name: "Import", exact: true }).last().click();
    await visible(page, /Read 3 rows · added 2 assets/);
    await visible(page, /row 4: Unknown category "Drones"/);
    check("Imported 2 assets (IMP tag kept, one generated); row 4 skipped: unknown category Drones");
    s(await snap(page, "step11-import-result"));
    await page.getByRole("button", { name: "Register", exact: true }).click();
    await page.getByPlaceholder("Search tag, name or serial").fill(`IMP-${RUN}`);
    await page.getByRole("link", { name: `IMP-${RUN}` }).waitFor();
    check(`Imported item IMP-${RUN} is in the register`);
  });
});

// ---------- 12. Team view ----------
await step(12, "Ali's line manager sees his monitor under Team → Assets, without costs", async ({ check, shot: s }) => {
  if (!ctx.lineManager) throw new Error("No line manager found in step 10");
  await as(ACCOUNTS[ctx.lineManager], async (page) => {
    await page.goto(`${BASE}/team`);
    await page.getByRole("button", { name: "Assets", exact: true }).click();
    const row = page.locator("tr", { hasText: ITEM.monitor });
    await row.getByText("Ali Raza").waitFor();
    if (/PKR|\bCost\b/.test(await page.locator("main").innerText())) throw new Error("Costs are visible to the line manager");
    check(`${ctx.lineManager} sees Ali's monitor, no cost shown`);
    s(await snap(page, "step12-team-assets"));
  });
});

await browser.close();
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ ranAt: new Date().toISOString(), run: RUN, ...ctx, results }, null, 2));
console.log(`\n${results.filter((r) => r.status === "PASS").length} of ${results.length} steps passed. Screenshots: ${OUT}`);
process.exitCode = results.every((r) => r.status === "PASS") ? 0 : 1;
