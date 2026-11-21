import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * e2eIgnoreWorkingDayGate (lib/dates.ts) is computed once at module-load time from NODE_ENV, DATABASE_URL
 * and E2E_IGNORE_WORKING_DAY_GATE — so the only faithful way to test every combination is a fresh process
 * per combination (re-importing the already-loaded module in this same process would just return the one
 * value it was computed with on its first import). Each case below spawns one.
 */

const FIXTURE = path.join(import.meta.dirname, "_fixtures", "print-working-day-gate.ts");

type EnvCase = { NODE_ENV?: string; DATABASE_URL?: string; E2E_IGNORE_WORKING_DAY_GATE?: string };

/** Runs the fixture in a fresh process with an explicitly-controlled environment (not inherited from this
 * test process, and not left to fall back to the real backend/.env for the three vars under test). */
function runGate(envCase: EnvCase): { gate: boolean } | { crashed: true; status: number | null } {
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  delete childEnv.NODE_ENV;
  delete childEnv.DATABASE_URL;
  delete childEnv.E2E_IGNORE_WORKING_DAY_GATE;
  if (envCase.NODE_ENV !== undefined) childEnv.NODE_ENV = envCase.NODE_ENV;
  if (envCase.DATABASE_URL !== undefined) childEnv.DATABASE_URL = envCase.DATABASE_URL;
  if (envCase.E2E_IGNORE_WORKING_DAY_GATE !== undefined) childEnv.E2E_IGNORE_WORKING_DAY_GATE = envCase.E2E_IGNORE_WORKING_DAY_GATE;
  childEnv.JWT_SECRET ||= "test-secret-for-gate-check";

  try {
    const stdout = execFileSync(process.execPath, ["--import", "tsx", FIXTURE], { env: childEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { gate: JSON.parse(stdout.trim()) };
  } catch (err) {
    const e = err as { status: number | null };
    return { crashed: true, status: e.status };
  }
}

const E2E_DB = "postgresql://postgres:123@localhost:5433/hr_ms_e2e?schema=public";
const DEV_DB = "postgresql://postgres:123@localhost:5433/hr_ms?schema=public";

describe("e2eIgnoreWorkingDayGate: true only when NODE_ENV != production AND the DB name ends in _e2e AND the env var is \"1\"", () => {
  test("positive control: all three conditions hold -> true", () => {
    const result = runGate({ NODE_ENV: "development", DATABASE_URL: E2E_DB, E2E_IGNORE_WORKING_DAY_GATE: "1" });
    assert.deepEqual(result, { gate: true });
  });

  test("(a) NODE_ENV=production, even with an _e2e database and the env var set to 1 -> false", () => {
    const result = runGate({ NODE_ENV: "production", DATABASE_URL: E2E_DB, E2E_IGNORE_WORKING_DAY_GATE: "1" });
    assert.deepEqual(result, { gate: false });
  });

  test("(b) NODE_ENV unset (defaults to development, i.e. not production), but the database is hr_ms, not _e2e, with the env var set to 1 -> false", () => {
    const result = runGate({ DATABASE_URL: DEV_DB, E2E_IGNORE_WORKING_DAY_GATE: "1" });
    assert.deepEqual(result, { gate: false });
  });

  test("(c) the database is an _e2e one, but the env var is absent -> false", () => {
    const result = runGate({ NODE_ENV: "development", DATABASE_URL: E2E_DB });
    assert.deepEqual(result, { gate: false });
  });

  test("(c, variant) the database is an _e2e one, but the env var is \"0\" (present but not exactly \"1\") -> false", () => {
    const result = runGate({ NODE_ENV: "development", DATABASE_URL: E2E_DB, E2E_IGNORE_WORKING_DAY_GATE: "0" });
    assert.deepEqual(result, { gate: false });
  });

  test("(d) DATABASE_URL is malformed (not a parseable URL) -> false, not a thrown error", () => {
    const result = runGate({ NODE_ENV: "development", DATABASE_URL: "not-a-valid-url", E2E_IGNORE_WORKING_DAY_GATE: "1" });
    assert.deepEqual(result, { gate: false });
  });

  test("(d, variant) DATABASE_URL is empty/missing -> the app's own env validation refuses to start at all (exit code 1), so the gate is never even reached", () => {
    const result = runGate({ NODE_ENV: "development", DATABASE_URL: "", E2E_IGNORE_WORKING_DAY_GATE: "1" });
    assert.equal("crashed" in result && result.crashed, true, "expected the process to exit non-zero instead of printing a gate value");
    assert.notEqual((result as { status: number | null }).status, 0);
  });
});
