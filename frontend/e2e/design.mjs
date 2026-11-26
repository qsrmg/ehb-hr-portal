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
for (const f of fs.readdirSync(OUT)) if (/\.(png|json|webm)$/.test(f)) fs.rmSync(path.join(OUT, f));

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
/** Scrolls through the page so every scroll-in section has appeared, then back to the top. */
async function revealAll(p) {
  await p.evaluate(async () => {
    const step = Math.max(200, window.innerHeight * 0.6);
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo({ top: y, behavior: "instant" });
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  });
  await p.waitForTimeout(1600);
  const hidden = await p.locator("[data-reveal]:not([data-visible])").count();
  if (hidden) throw new Error(`${hidden} section(s) never appeared while scrolling`);
}
async function signIn(p, email) {
  await p.goto(`${BASE}/login`);
  await p.getByLabel("Work email").fill(email);
  await p.getByLabel("Password").fill(PASSWORD);
  await p.getByRole("button", { name: "Sign in securely" }).click();
  await p.waitForURL(/\/dashboard$/);
  await p.locator("main h1").first().waitFor();
}

/**
 * Text elements whose contrast with the colour actually behind them (all layers blended) is below 4.5:1.
 * `root` scopes the search (default "main", the signed-in layout's landmark); the sign-in page has no
 * <main>, so its own check passes "body" instead. `selector` checks exactly those elements instead of the
 * default tag list (e.g. the dashboard's own KPI numbers and ring percentages, by their data-testid).
 */
const lowContrast = (p, root = "main", selector) =>
  p.evaluate(({ root, selector }) => {
    // Tailwind v4's default palette (red, etc.) can report through getComputedStyle in lab()/oklch(),
    // not rgb() — parsing the string with a regex silently drops those colours. A 1x1 canvas resolves any
    // valid CSS colour (lab, oklch, color(), named, …) to concrete, unpremultiplied RGBA pixel values.
    const swatch = document.createElement("canvas");
    swatch.width = swatch.height = 1;
    const ctx = swatch.getContext("2d", { willReadFrequently: true });
    const parse = (c) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#000";
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return { r, g, b, a: a / 255 };
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
    const tags = ["td", "th", "input", "select", "textarea", "label", "button", "[role=alert]", "[role=status]", "h1", "h2", "p", "a", "dd", "dt", "li", "span"];
    const sel = selector ?? tags.map((t) => `${root} ${t}`).join(", ");
    for (const el of document.querySelectorAll(sel)) {
      if (!el.offsetParent || el.disabled || !el.textContent.trim() && !["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName)) continue;
      if (el.closest("[aria-hidden=true]")) continue;
      const st = getComputedStyle(el);
      // Gradient "clip-text" accents (e.g. the sign-in headline) report a transparent `color`; the real
      // colour comes from the background gradient, which this check cannot see. Checked separately instead.
      if (st.webkitBackgroundClip === "text" || st.backgroundClip === "text") continue;
      const fg = parse(st.color);
      if (!fg) continue;
      const bg = background(el);
      const [l1, l2] = [lum(over(fg, bg)), lum(bg)].sort((a, b) => b - a);
      const ratio = (l1 + 0.05) / (l2 + 0.05);
      if (ratio < 4.5) bad.push(`${el.tagName.toLowerCase()} "${(el.value || el.textContent).trim().slice(0, 40)}" ${ratio.toFixed(2)}:1`);
    }
    return [...new Set(bad)];
  }, { root, selector });

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
      await p.waitForTimeout(1800); // hero entrance animation
      await p.screenshot({ path: path.join(OUT, `landing-${vp.name}-first-screen.png`) });
      await revealAll(p);
      check("Every section appears as it scrolls into view");
      await shot(p, `landing-${vp.name}`);
      if (vp.isMobile) {
        await p.getByRole("button", { name: "Open menu" }).click();
        const menu = p.locator("#landing-menu");
        await menu.getByRole("link", { name: "Security" }).click();
        await p.waitForFunction(() => location.hash === "#security");
        if (await p.getByRole("button", { name: "Close menu" }).count()) throw new Error("The menu stays open after choosing a section");
        check("Phone menu opens, jumps to Security and closes");
      } else {
        await p.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "How It Works" }).click();
        await p.waitForFunction(() => document.querySelector('a[href="#how-it-works"][aria-current="true"]'), null, { timeout: 5000 });
        check("Header link of the section in view is marked as current");
      }
      await p.getByRole("link", { name: "Access HR Portal" }).first().click();
      await p.waitForURL(/\/login$/);
      await p.goto(`${BASE}/`);
      await p.getByRole("link", { name: "Sign In", exact: true }).first().click();
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
      await p.getByRole("heading", { name: "Welcome back" }).waitFor();
      await noSideScroll(p, "Sign-in");
      await p.waitForTimeout(1300); // entrance animation
      await shot(p, `login-${vp.name}`);
      await p.getByRole("button", { name: "Sign in securely" }).click();
      await p.getByText("Enter your work email.").waitFor();
      await p.getByText("Enter your password.").waitFor();
      if ((await p.getByLabel("Work email").getAttribute("aria-invalid")) !== "true") throw new Error("The empty email is not marked invalid");
      await p.getByLabel("Work email").fill("not-an-email");
      await p.getByRole("button", { name: "Sign in securely" }).click();
      await p.getByText(/Enter a valid email address/).waitFor();
      check("Empty and invalid fields show their own messages before anything is sent");
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
        for (const [surface, locator] of [["body", "body"], ["portal shell", '[data-testid="app-shell"]'], ["sidebar", "aside"]]) {
          const bg = await p.locator(locator).first().evaluate((el) => getComputedStyle(el).backgroundColor);
          const [r, g, b] = bg.match(/\d+/g).map(Number);
          const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
          if (lum < 0.9) throw new Error(`${surface} background is not near-white (${bg}, luminance ${lum.toFixed(2)})`);
        }
        check(`${who}: body, portal shell and sidebar backgrounds are all near-white`);
        const bad = await lowContrast(p, "main", 'main [data-testid="kpi-value"], main [data-testid="ring-percent"]');
        if (bad.length) throw new Error(`Low contrast on the KPI numbers / ring percentages — ${bad.join("; ")}`);
        check(`${who}: KPI numbers and ring percentages are all at least 4.5:1 against their card`);
      } finally {
        await close();
      }
    }
  });
}

// ---------- Sidebar on a 1366x768 laptop; dashboard "More requests" menu ----------
await step("sidebar", "Sidebar at 1366x768: an employee's menu fits; HR's longer menu scrolls without a visible scrollbar", async (check) => {
  for (const [who, email, mustFit] of [["employee", "employee@ehb.local", true], ["HR", "hr@ehb.local", false]]) {
    const { p, close } = await page({ name: "1366x768", width: 1366, height: 768 });
    try {
      await signIn(p, email);
      const nav = await p.locator('aside nav[aria-label="Main"]').first().evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight, bar: el.offsetWidth - el.clientWidth }));
      if (mustFit && nav.scroll > nav.client) throw new Error(`The employee menu needs scrolling (${nav.scroll}px in ${nav.client}px)`);
      if (nav.bar > 0) throw new Error(`The ${who} menu shows a ${nav.bar}px scrollbar`);
      await shot(p, `sidebar-${who}-1366x768`);
      check(`${who}: menu ${nav.scroll}px in ${nav.client}px, no visible scrollbar`);
      if (who === "employee") {
        const actions = await p.locator("main").getByRole("link", { name: /^(Apply for leave|Attendance Update)$/ }).count();
        if (actions !== 2) throw new Error("The two main request links are missing");
        await p.getByRole("button", { name: "More requests" }).click();
        await p.getByRole("menu", { name: "More requests" }).getByRole("menuitem", { name: "Claim expenses" }).waitFor();
        await p.keyboard.press("Escape");
        if (await p.getByRole("menu", { name: "More requests" }).count()) throw new Error("Escape did not close the menu");
        check("Three main actions; More requests menu opens and closes with Escape");
      }
    } finally {
      await close();
    }
  }
});

// ---------- Landing and sign-in at every target width; reduced motion ----------
const EXTRA = [
  { name: "1920", width: 1920, height: 1080 },
  { name: "1440", width: 1440, height: 900 },
  { name: "1024", width: 1024, height: 768 },
  { name: "768", width: 768, height: 1024, isMobile: true, hasTouch: true },
  { name: "390", width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: "360", width: 360, height: 780, isMobile: true, hasTouch: true },
];
await step("widths", "Landing and sign-in at 1920, 1440, 1024, 768, 390 and 360px: no sideways scroll, screenshots", async (check) => {
  for (const vp of EXTRA) {
    const { p, close } = await page(vp);
    try {
      await p.goto(`${BASE}/`);
      await p.getByRole("heading", { name: /Your Entire HR Experience/ }).waitFor();
      await p.waitForTimeout(1800);
      await p.screenshot({ path: path.join(OUT, `landing-${vp.name}-first-screen.png`) });
      await revealAll(p);
      await noSideScroll(p, `Landing at ${vp.name}px`);
      await shot(p, `landing-${vp.name}`);
      await p.goto(`${BASE}/login`);
      await p.getByRole("heading", { name: "Welcome back" }).waitFor();
      await p.waitForTimeout(1300);
      await noSideScroll(p, `Sign-in at ${vp.name}px`);
      await shot(p, `login-${vp.name}`);
      check(`${vp.name}px: no sideways scroll`);
    } finally {
      await close();
    }
  }
});

await step("motion", "Reduced motion: every section is visible straight away, nothing animates", async (check) => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, reducedMotion: "reduce" });
  const p = await context.newPage();
  try {
    await p.goto(`${BASE}/`);
    await p.getByRole("heading", { name: /Your Entire HR Experience/ }).waitFor();
    const state = await p.evaluate(() => {
      const last = [...document.querySelectorAll("[data-reveal]")].pop();
      const animated = [...document.querySelectorAll("*")].filter((el) => getComputedStyle(el).animationName !== "none").length;
      return { opacity: last ? getComputedStyle(last).opacity : "1", animated };
    });
    if (state.opacity !== "1") throw new Error(`The last section is hidden (opacity ${state.opacity}) without scrolling`);
    if (state.animated) throw new Error(`${state.animated} element(s) still animate`);
    check("Sections visible without scrolling; no running animations");
  } finally {
    await context.close();
  }
});

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
    ["employee@ehb.local", "/policies", "policies"],
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

// ---------- Sign-in page motion: runs under no-preference, silent under reduce, at both widths ----------
await step(
  "motion-login",
  "Sign-in page motion: animations run (no-preference) and are silent (reduce) at 1366/375px, contrast and no sideways scroll hold either way",
  async (check) => {
    for (const vp of WIDTHS) {
      // no-preference: animations run, settle, contrast still holds, no sideways scroll; video the 1366px run.
      const recordVideo = vp.name === "1366" ? { dir: OUT, size: { width: vp.width, height: vp.height } } : undefined;
      const liveContext = await browser.newContext({
        viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.hasTouch,
        timezoneId: "Asia/Karachi", reducedMotion: "no-preference", recordVideo,
      });
      let video = null;
      try {
        const p = await liveContext.newPage();
        p.setDefaultTimeout(15000);
        video = p.video();
        await p.goto(`${BASE}/login`);
        await p.getByRole("heading", { name: "Welcome back" }).waitFor();
        await p.waitForTimeout(400); // entrance animations under way
        const runningSoonAfterLoad = await p.evaluate(() => document.getAnimations().length);
        if (runningSoonAfterLoad === 0) throw new Error(`${vp.name}px, no-preference: no animations are running shortly after load`);
        check(`${vp.name}px, no-preference: ${runningSoonAfterLoad} animation(s) running shortly after load`);
        if (vp.name === "1366") await p.waitForTimeout(2600); // let the video also catch the ambient drift/float/sweep loops
        await noSideScroll(p, `Sign-in (no-preference) at ${vp.name}px`);
        await p.waitForTimeout(vp.name === "1366" ? 200 : 1800); // let entrance settle before the screenshot
        await shot(p, `login-motion-settled-${vp.name}`);
        const bad = await lowContrast(p, "body");
        if (bad.length) throw new Error(`${vp.name}px, no-preference: low contrast — ${bad.slice(0, 5).join("; ")}`);
        check(`${vp.name}px, no-preference: all text at least 4.5:1 after settling`);
      } finally {
        await liveContext.close();
      }
      if (video) {
        await video.saveAs(path.join(OUT, "login-motion.webm"));
        check("Video of the live run saved: test-screenshots/design/login-motion.webm");
      }

      // reduce: nothing animates, the page stays fully usable and readable.
      const reducedContext = await browser.newContext({
        viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.hasTouch,
        timezoneId: "Asia/Karachi", reducedMotion: "reduce",
      });
      try {
        const p = await reducedContext.newPage();
        p.setDefaultTimeout(15000);
        await p.goto(`${BASE}/login`);
        await p.getByRole("heading", { name: "Welcome back" }).waitFor();
        await p.waitForTimeout(500);
        const running = await p.evaluate(() => document.getAnimations().length);
        if (running !== 0) throw new Error(`${vp.name}px, reduce: ${running} animation(s) still running`);
        check(`${vp.name}px, reduce: no animations running`);
        await noSideScroll(p, `Sign-in (reduce) at ${vp.name}px`);
        const bad = await lowContrast(p, "body");
        if (bad.length) throw new Error(`${vp.name}px, reduce: low contrast — ${bad.slice(0, 5).join("; ")}`);
        check(`${vp.name}px, reduce: all text at least 4.5:1`);
      } finally {
        await reducedContext.close();
      }
    }
  },
);

await browser.close();
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2));
console.log(`\n${results.filter((r) => r.status === "PASS").length} of ${results.length} steps passed. Screenshots: ${OUT}`);
process.exitCode = results.every((r) => r.status === "PASS") ? 0 : 1;
