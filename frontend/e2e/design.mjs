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

// ---------- The 10 most-used signed-in pages, dark theme, with a contrast check ----------
const API = env.E2E_API_URL ?? "http://localhost:5000/api";
async function apiAs(email) {
  const { token } = await (await fetch(`${API}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }) })).json();
  return async (method, p, body) => {
    const res = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json();
    if (!res.ok) throw new Error(`${method} ${p}: ${data.message}`);
    return data;
  };
}

/** Text elements whose contrast with the colour actually behind them (all layers blended) is below 4.5:1. */
const lowContrast = (p) =>
  p.evaluate(() => {
    const parse = (c) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return { r, g, b, a };
    };
    const over = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
    const background = (el) => {
      const layers = [];
      for (let e = el; e; e = e.parentElement) {
        const c = parse(getComputedStyle(e).backgroundColor);
        if (c && c.a > 0) layers.push(c);
        if (c && c.a === 1) break;
      }
      return layers.reverse().reduce((acc, c) => over(c, acc), { r: 9, g: 24, b: 47, a: 1 });
    };
    const lum = ({ r, g, b }) => {
      const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const bad = [];
    for (const el of document.querySelectorAll("main td, main th, main input, main select, main textarea, main label, main button, main [role=alert], main [role=status], main h1, main h2, main p, main a, main dd, main dt, main li, main span")) {
      if (!el.offsetParent || el.disabled || !el.textContent.trim() && !["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName)) continue;
      if (el.closest("[aria-hidden=true]")) continue;
      const st = getComputedStyle(el);
      const fg = parse(st.color);
      if (!fg) continue;
      const bg = background(el);
      const [l1, l2] = [lum(over(fg, bg)), lum(bg)].sort((a, b) => b - a);
      const ratio = (l1 + 0.05) / (l2 + 0.05);
      if (ratio < 4.5) bad.push(`${el.tagName.toLowerCase()} "${(el.value || el.textContent).trim().slice(0, 40)}" ${ratio.toFixed(2)}:1`);
    }
    return [...new Set(bad)];
  });

await step("pages", "10 most-used signed-in pages in the dark theme: screenshots at 1366px, text contrast at least 4.5:1", async (check) => {
  // A leave request from Ali waiting with Hamza, so the request page shows the approver's decision form.
  const ali = await apiAs("employee@ehb.local");
  const types = await ali("GET", "/leave/types");
  const casual = types.find((t) => t.code === "CL") ?? types[0];
  const start = new Date(Date.now() + 21 * 86_400_000);
  while ([0, 6].includes(start.getUTCDay())) start.setUTCDate(start.getUTCDate() + 1);
  const leaveDay = start.toISOString().slice(0, 10);
  const fd = new FormData();
  for (const [k, v] of Object.entries({ leaveTypeId: casual.id, startDate: leaveDay, endDate: leaveDay, reason: "Family wedding" })) fd.append(k, String(v));
  const { token } = await (await fetch(`${API}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "employee@ehb.local", password: PASSWORD }) })).json();
  const created = await (await fetch(`${API}/requests/leave`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd })).json();
  if (!created.id) throw new Error(`Could not create a leave request: ${created.message}`);

  const pages = [
    ["employee@ehb.local", "/attendance", "attendance"],
    ["employee@ehb.local", "/leave", "leave"],
    ["employee@ehb.local", "/requests", "my-requests"],
    ["employee@ehb.local", "/requests/new/leave", "leave-form-with-error"],
    ["employee@ehb.local", "/payslips", "payslips"],
    ["employee@ehb.local", "/documents", "policies"],
    ["employee@ehb.local", "/profile", "profile"],
    ["manager@ehb.local", "/approvals", "approvals"],
    ["manager@ehb.local", `/requests/${created.id}`, "request-decision"],
    ["hr@ehb.local", "/admin/employees", "hr-employees"],
  ];
  const problems = [];
  for (const [email, url, name] of pages) {
    const { p, close } = await page(WIDTHS[0]);
    try {
      await signIn(p, email);
      await p.goto(`${BASE}${url}`);
      await p.locator("main h1").first().waitFor();
      await p.waitForLoadState("networkidle");
      if (name === "leave-form-with-error") {
        // An error message from the server, to check that errors stay readable.
        await p.locator("label", { hasText: /^Leave type/ }).locator("select").selectOption({ index: 0 });
        await p.getByLabel("From", { exact: true }).fill("2020-01-06");
        await p.getByLabel("To", { exact: true }).fill("2020-01-06");
        await p.getByLabel("Reason", { exact: true }).fill("Checking the error message");
        await p.getByRole("button", { name: "Submit leave request" }).click({ force: true });
        await p.getByRole("alert").first().waitFor().catch(() => {});
      }
      await noSideScroll(p, url);
      await shot(p, `page-${String(pages.findIndex((x) => x[2] === name) + 1).padStart(2, "0")}-${name}`);
      const bad = await lowContrast(p);
      if (bad.length) problems.push(`${url}: ${bad.slice(0, 5).join("; ")}${bad.length > 5 ? ` (+${bad.length - 5} more)` : ""}`);
      else check(`${url}: all text at least 4.5:1`);
    } finally {
      await close();
    }
  }
  if (problems.length) throw new Error(`Low contrast — ${problems.join(" | ")}`);
});

await browser.close();
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2));
console.log(`\n${results.filter((r) => r.status === "PASS").length} of ${results.length} steps passed. Screenshots: ${OUT}`);
process.exitCode = results.every((r) => r.status === "PASS") ? 0 : 1;
