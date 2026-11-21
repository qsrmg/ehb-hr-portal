// Run in its own process (see e2e-working-day-gate.test.ts): e2eIgnoreWorkingDayGate is computed once at
// module-load time from env vars, so the only faithful way to test every combination is a fresh process
// per combination, not re-importing the same module repeatedly in one process.
import { e2eIgnoreWorkingDayGate } from "../../src/lib/dates.js";

process.stdout.write(JSON.stringify(e2eIgnoreWorkingDayGate));
