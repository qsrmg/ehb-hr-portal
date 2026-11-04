// Design check: landing, sign-in and dashboard at laptop (1366px) and phone (375px) width.
// Takes full-page screenshots into test-screenshots/design/ and checks routing and horizontal overflow.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const env = process.env;
const BASE = env.E2E_BASE_URL ?? "http://localhost:3000";
const PASSWORD = env.E2E_PASSWORD ?? "Password@123";
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../test-screenshots/design");
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (/\.(png|json)$/.test(f)) fs.rmSync(path.join(OUT, f));

const WIDTHS = [{ name: "1366", width: 1366, height: 900 }, { name: "375", width: 375, height: 812, isMobile: true, hasTouch: true }];
const browser = await chromium.launch();
const results = [];

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

async function page(viewport) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.isMobile, hasTouch: viewport.hasTouch, timezoneId: "Asia/Karachi" });
  const p = await context.newPage();
  p.setDefaultTimeout(15000);
  return { p, close: () => context.close() };
}
async function noSideScroll(p, where) {
  const { scroll, inner } = await p.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  if (scroll > inner + 1) throw new Error(`${where}: page scrolls sideways (${scroll}px wide in a ${inner}px window)`);
}
const shot = (p, name) => p.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
async function signIn(p, email) {
  await p.goto(`${BASE}/login`);
  await p.getByLabel("Work email").fill(email);
  await p.getByLabel("Password").fill(PASSWORD);
  await p.getByRole("button", { name: "Sign in securely" }).click();
  await p.waitForURL(/\/dashboard$/);
  await p.locator("main h1").first().waitFor();
}

for (const vp of WIDTHS) {
  await step(`${vp.name}a`, `Landing page at ${vp.name}px: sections, buttons to /login, no sideways scroll`, async (check) => {
    const { p, close } = await page(vp);
    try {
      await p.goto(`${BASE}/`);
      await p.getByRole("heading", { name: /Your Entire HR Experience/ }).waitFor();
      for (const h of ["Everything Your Workday Needs.", "How EHB HR Works", "Every request follows the same path.", "The right access for every role.", "Ready when you are."]) {
        await p.getByRole("heading", { name: h }).waitFor();
      }
      if (await p.getByText("[HR EMAIL]").count()) throw new Error("The [HR EMAIL] placeholder is still shown");
      if (await p.getByText(/View the demo dashboard/).count()) throw new Error("The demo dashboard link is still shown");
      await p.getByText("Demo preview").first().waitFor();
      check("All sections present; HR email filled in; dashboard picture labelled Demo preview");
      await noSideScroll(p, "Landing");
      await shot(p, `landing-${vp.name}`);
      await p.screenshot({ path: path.join(OUT, `landing-${vp.name}-first-screen.png`) });
      await p.getByRole("link", { name: "Access HR Portal" }).first().click();
      await p.waitForURL(/\/login$/);
      await p.goto(`${BASE}/`);
      await p.getByRole("link", { name: "Sign in", exact: true }).first().click();
      await p.waitForURL(/\/login$/);
      check("Access HR Portal and Sign in open /login");
    } finally {
      await close();
    }
  });

  await step(`${vp.name}b`, `Sign-in page at ${vp.name}px: error message kept, forgot password, sign in to /dashboard`, async (check) => {
    const { p, close } = await page(vp);
    try {
      await p.goto(`${BASE}/login`);
      await p.getByRole("heading", { name: "Sign in" }).waitFor();
      await noSideScroll(p, "Sign-in");
      await shot(p, `login-${vp.name}`);
      await p.getByLabel("Work email").fill("employee@ehb.local");
      await p.getByLabel("Password").fill("wrong-password");
      await p.getByRole("button", { name: "Sign in securely" }).click();
      check(`Wrong password: "${(await p.getByRole("alert").innerText()).trim()}"`);
      await p.getByRole("button", { name: "Forgot password?" }).click();
      check(`Forgot password: "${(await p.locator("#forgot-help").innerText()).trim()}"`);
      await p.getByRole("button", { name: "Show the characters" }).click();
      if ((await p.getByLabel("Password").getAttribute("type")) !== "text") throw new Error("Show password did not work");
      await p.getByLabel("Password").fill(PASSWORD);
      await p.getByRole("button", { name: "Sign in securely" }).click();
      await p.waitForURL(/\/dashboard$/);
      check("Signed in to /dashboard");
      await p.goto(`${BASE}/`);
      await p.waitForURL(/\/dashboard$/);
      check("A signed-in user visiting / goes straight to /dashboard");
    } finally {
      await close();
    }
  });

  await step(`${vp.name}c`, `Dashboard at ${vp.name}px for an employee and an approver`, async (check) => {
    for (const [who, email] of [["employee", "employee@ehb.local"], ["approver", "manager@ehb.local"]]) {
      const { p, close } = await page(vp);
      try {
        await signIn(p, email);
        await p.waitForLoadState("networkidle");
        await noSideScroll(p, `Dashboard (${who})`);
        await shot(p, `dashboard-${who}-${vp.name}`);
        check(`${who}: "${(await p.locator("main h1").first().innerText()).replace(/\s+/g, " ")}"`);
      } finally {
        await close();
      }
    }
  });
}

await browser.close();
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2));
console.log(`\n${results.filter((r) => r.status === "PASS").length} of ${results.length} steps passed. Screenshots: ${OUT}`);
process.exitCode = results.every((r) => r.status === "PASS") ? 0 : 1;
