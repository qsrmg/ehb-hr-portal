# Browser tests (Playwright)

| Script | What it covers | Screenshots |
|---|---|---|
| `design.mjs` | Landing, sign-in and dashboard at 1366px and 375px: sections, Sign in / Access HR Portal go to `/login`, signed-in users go from `/` to `/dashboard`, no sideways scrolling; the 10 most-used signed-in pages in the dark theme, with every text element checked for a contrast of at least 4.5:1; full-page screenshots | `test-screenshots/design/` |
| `travel.mjs` | Travel steps 0–8: request, approvals, Admin booking, advance, settlement, cancellation | `test-screenshots/travel/` |
| `inventory.mjs` | My Inventory steps 1–12: register, issue, confirm, report lost, HR recovery (with purchase cost), Management write-off, revoke, exit clearance, repairs, department items, asset request, Excel import, team view | `test-screenshots/inventory/` |
| `exit.mjs` | Resignation & exit clearance steps 1–9: resignation with early release, HR decision, exit interview, IT / Admin blocked by a laptop, parallel clearances, Finance settlement, letters by email, termination completed and login refused | `test-screenshots/exit/` |
| `performance.mjs` | Performance (BSC) steps 1–9: HR's department template, a cycle, goals adjusted and sent, acknowledged (no duplicate HOD step), check-in, self-review, manager ratings, Admin and Finance refused, HR calibration and release, appeal decided, acknowledgement and PDF, cycle overview | `test-screenshots/performance/` |

`travel.mjs` runs in a real browser as Finance, HR, the traveller (Sara), the line manager (Ayesha), the HOD (Hamza) and Admin (Usman), and takes screenshots at each important step.

`exit.mjs` uses Ali as the leaver (Hamza is his line manager and HOD), Ayesha (HR), Usman (Admin), Bilal (Finance) and Sara for the termination. It sets up Ali's laptop and personal email through the API, so it needs the freshly seeded database that `npm run e2e` gives it.

`inventory.mjs` uses Admin (Usman), Sara as the holder, Ali as the requester, his line manager (read from the approval chain), HR, Management and Finance.

## Run all tests (isolated)

Once, install Chromium for Playwright: `npx playwright install chromium` (in `frontend/`). PostgreSQL must be running. Then:

```
cd frontend
npm run e2e
```

That is all; you don't need to start any server. `e2e/run-all.mjs`:

1. starts its own Mailpit (web 8125, SMTP 1125) and Next.js dev server (port 3100, build folder `.next-e2e/`, API URL pointing at port 5100);
2. for **each** test file:
   1. drops and recreates the `hr_ms_e2e` database;
   2. applies the migrations and runs the seed (demo accounts, password `Password@123`);
   3. empties `backend/uploads-e2e/` and Mailpit;
   4. starts a backend on port 5100 against `hr_ms_e2e`;
   5. runs the test, then stops that backend;
3. stops everything it started and prints a PASS/FAIL summary. The exit code is 1 if anything failed.

Because every test starts from the fresh seed, the tests don't depend on each other, and you can re-run them as often as you like on the same day.

It never touches the development database `hr_ms`, its `uploads/` folder or the dev servers on 3000/5000/8025, which can keep running. The database credentials are taken from `backend/.env`; only the database name is replaced. As a safety check, the runner refuses to reset a database whose name doesn't end in `_e2e`.

The server logs go to `test-screenshots/e2e-logs/` (ignored by git, like the screenshots). If a port is already in use, the run stops before changing anything.

| Variable | Default |
|---|---|
| `E2E_SPECS` | `design,travel,inventory,exit,performance` (e.g. `E2E_SPECS=performance` to run one) |
| `E2E_DB_NAME` | `hr_ms_e2e` (must end in `_e2e`) |
| `E2E_API_PORT` / `E2E_WEB_PORT` | `5100` / `3100` |
| `E2E_MAIL_PORT` / `E2E_SMTP_PORT` | `8125` / `1125` |

## Running one script against your own servers

`npm run e2e:travel` and `npm run e2e:inventory` run a single script against whatever is already running (by default your dev servers on 3000 and Mailpit on 8025, so **against `hr_ms`**). They change that data: Travel sets the travel rates, makes the traveller report to Ayesha and creates trips. Because trips may not overlap, each traveller can run Travel only once per day; choose another one with `E2E_TRAVELLER_EMAIL` / `E2E_TRAVELLER_NAME`. `npm run e2e:exit` expects the demo seed data unchanged (Ali still employed, no open exits), so it works only once on a development database. Prefer `npm run e2e`.

| Variable | Default |
|---|---|
| `E2E_BASE_URL` | `http://localhost:3000` |
| `E2E_MAILPIT_URL` | `http://127.0.0.1:8025` |
| `E2E_API_URL` | `http://localhost:5000/api` (used by `exit.mjs` for setup) |
| `E2E_PASSWORD` | `Password@123` |
| `E2E_TRAVELLER_EMAIL` / `E2E_TRAVELLER_NAME` | `employee2@ehb.local` / `Sara Javed` |
| `ONLY` + `TRIP1` | Travel: re-run some steps against an existing trip, e.g. `ONLY=3,5,6` `TRIP1=9` |

## Notes for writing selectors

- A dropdown sits inside its `<label>`, so the label's text also contains every option. Find dropdowns with the `dropdown(scope, "Label")` helper, which matches the start of the label, instead of `getByLabel(...)`.
- Playwright's `isDisabled()` reports `false` for `<option>` elements; read `option.disabled` with `evaluate` instead.
- Don't assume who someone's line manager is; read it from the approval chain (see `inventory.mjs` step 10).
