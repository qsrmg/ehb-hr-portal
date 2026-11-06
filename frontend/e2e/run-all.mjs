// Runs every browser test against its own, freshly seeded database (hr_ms_e2e) and its own
// backend, frontend and Mailpit on separate ports, then stops them again. The development
// servers (3000/5000/8025) and the hr_ms database are never touched. See e2e/README.md.
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const env = process.env;
const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(FRONTEND, "..");
const BACKEND = path.join(ROOT, "backend");
const LOGS = path.join(ROOT, "test-screenshots", "e2e-logs");

const DB_NAME = env.E2E_DB_NAME ?? "hr_ms_e2e";
const API_PORT = Number(env.E2E_API_PORT ?? 5100);
const WEB_PORT = Number(env.E2E_WEB_PORT ?? 3100);
const MAIL_PORT = Number(env.E2E_MAIL_PORT ?? 8125);
const SMTP_PORT = Number(env.E2E_SMTP_PORT ?? 1125);
const UPLOAD_DIR = path.join(BACKEND, "uploads-e2e");
const SPECS = (env.E2E_SPECS ?? "design,travel,inventory,exit,performance,hiring,leave,demo").split(",").map((s) => s.trim()).filter(Boolean);

// Safety: this script drops the database, so it only ever works on one whose name ends in _e2e.
if (!/_e2e$/.test(DB_NAME)) {
  console.error(`Refusing to reset "${DB_NAME}": the e2e database name must end in _e2e.`);
  process.exit(2);
}

const require = createRequire(path.join(BACKEND, "package.json"));
const dotenv = require("dotenv");
const pg = require("pg");
const devEnv = dotenv.parse(fs.readFileSync(path.join(BACKEND, ".env")));
const dbUrl = new URL(devEnv.DATABASE_URL);
dbUrl.pathname = `/${DB_NAME}`;
const adminUrl = new URL(dbUrl);
adminUrl.pathname = "/postgres";
adminUrl.search = "";

const backendEnv = {
  ...env,
  ...devEnv,
  NODE_ENV: "development",
  DATABASE_URL: dbUrl.toString(),
  PORT: String(API_PORT),
  CORS_ORIGIN: `http://localhost:${WEB_PORT}`,
  APP_URL: `http://localhost:${WEB_PORT}`,
  UPLOAD_DIR,
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: String(SMTP_PORT),
  SMTP_SECURE: "false",
};

const children = [];
fs.mkdirSync(LOGS, { recursive: true });

function start(name, cmd, args, opts) {
  const log = fs.createWriteStream(path.join(LOGS, `${name}.log`), { flags: "a" });
  const child = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  children.push(child);
  return child;
}

function stop(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") {
    try { execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: "ignore" }); } catch { /* already gone */ }
  } else child.kill("SIGTERM");
  children.splice(children.indexOf(child), 1);
}

function stopAll() {
  for (const child of [...children]) stop(child);
}
process.on("SIGINT", () => { stopAll(); process.exit(130); });

async function reachable(url) {
  try { await fetch(url, { signal: AbortSignal.timeout(2000) }); return true; } catch { return false; }
}

async function waitFor(name, url, child, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`${name} exited early; see test-screenshots/e2e-logs/${name}.log`);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${name} did not start within ${timeoutMs / 1000}s; see test-screenshots/e2e-logs/${name}.log`);
}

// The demo walk-through runs on the HR demo data (prisma/demo.ts); every other test on the standard seed.
const SEEDS = { demo: "npx tsx prisma/demo.ts --skip-reset" };

async function resetDatabase(spec) {
  const client = new pg.Client({ connectionString: adminUrl.toString() });
  await client.connect();
  await client.query(`drop database if exists "${DB_NAME}" with (force)`);
  await client.query(`create database "${DB_NAME}"`);
  await client.end();
  const opts = { cwd: BACKEND, env: backendEnv, stdio: "pipe" };
  execSync("npx prisma migrate deploy", opts);
  fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
  execSync(SEEDS[spec] ?? "npx prisma db seed", opts);
}

function runSpec(spec) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(FRONTEND, "e2e", `${spec}.mjs`)], {
      cwd: FRONTEND,
      stdio: "inherit",
      env: { ...env, E2E_BASE_URL: `http://localhost:${WEB_PORT}`, E2E_API_URL: `http://localhost:${API_PORT}/api`, E2E_MAILPIT_URL: `http://127.0.0.1:${MAIL_PORT}` },
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

const results = [];
let failed = false;
try {
  for (const [name, port] of [["backend", API_PORT], ["frontend", WEB_PORT], ["mailpit", MAIL_PORT]]) {
    if (await reachable(`http://127.0.0.1:${port}`)) throw new Error(`Port ${port} (e2e ${name}) is already in use; stop whatever runs there first.`);
  }

  console.log(`Starting e2e Mailpit on ${MAIL_PORT} and frontend on ${WEB_PORT} (logs in test-screenshots/e2e-logs/)...`);
  const mailpit = start("mailpit", path.join(ROOT, "tools", "mailpit", process.platform === "win32" ? "mailpit.exe" : "mailpit"),
    ["--smtp", `127.0.0.1:${SMTP_PORT}`, "--listen", `127.0.0.1:${MAIL_PORT}`], { cwd: ROOT });
  const frontend = start("frontend", process.execPath, [path.join(FRONTEND, "node_modules", "next", "dist", "bin", "next"), "dev", "-p", String(WEB_PORT)], {
    cwd: FRONTEND,
    env: { ...env, NEXT_DIST_DIR: ".next-e2e", NEXT_PUBLIC_API_URL: `http://localhost:${API_PORT}/api` },
  });
  await waitFor("mailpit", `http://127.0.0.1:${MAIL_PORT}/api/v1/info`, mailpit, 30_000);
  await waitFor("frontend", `http://localhost:${WEB_PORT}/login`, frontend, 180_000);

  for (const spec of SPECS) {
    console.log(`\n=== ${spec}: resetting and seeding ${DB_NAME} ===`);
    await resetDatabase(spec);
    await fetch(`http://127.0.0.1:${MAIL_PORT}/api/v1/messages`, { method: "DELETE" });
    const backend = start("backend", process.execPath, ["--import", "tsx", "src/index.ts"], { cwd: BACKEND, env: backendEnv });
    try {
      await waitFor("backend", `http://localhost:${API_PORT}/api/health`, backend, 60_000);
      const code = await runSpec(spec);
      results.push({ spec, ok: code === 0 });
      if (code !== 0) failed = true;
    } finally {
      stop(backend);
    }
  }
} catch (err) {
  console.error(`\n${err.message}`);
  failed = true;
} finally {
  stopAll();
}

console.log("\n=== e2e summary ===");
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.spec}`);
process.exit(failed ? 1 : 0);
