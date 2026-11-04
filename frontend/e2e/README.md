# Browser tests (Playwright)

`travel.mjs` runs steps 0–8 of the Travel test script in a real browser as Finance, HR, the traveller, the line manager (Ayesha), the HOD (Hamza) and Admin (Usman), and takes screenshots at each important step.

## Before you run it

- The backend, the frontend and Mailpit are running (`npm run dev` in `backend/` and `frontend/`, `npm run mailpit` in `backend/`).
- The database has the demo accounts (`npm run db:seed`), all with password `Password@123`.
- Chromium for Playwright is installed once: `npx playwright install chromium` (in `frontend/`).

## Run

```
cd frontend
npm run e2e:travel
```

Screenshots and a `results.json` go to `test-screenshots/travel/` at the project root (ignored by git). The console prints PASS/FAIL per step, and the exit code is 1 if any step failed.

**It changes data.** It sets the travel rates (daily allowance 2,000, mileage 45, hotel limit 12,000), makes the traveller report to Ayesha Siddiqui, and creates two trips and a settlement. Use it on a development database only.

## Re-running on the same day

The test uses a same-day trip so the settlement can be submitted straight away. Trips may not overlap, so each traveller can do this once per day. Use another demo account for the next run:

```
# PowerShell
$env:E2E_TRAVELLER_EMAIL="employee@ehb.local"; $env:E2E_TRAVELLER_NAME="Ali Raza"; npm run e2e:travel
```

The traveller must be in a department whose HOD is Hamza Malik (Engineering).

## Settings

| Variable | Default |
|---|---|
| `E2E_BASE_URL` | `http://localhost:3000` |
| `E2E_MAILPIT_URL` | `http://127.0.0.1:8025` |
| `E2E_PASSWORD` | `Password@123` |
| `E2E_TRAVELLER_EMAIL` / `E2E_TRAVELLER_NAME` | `employee2@ehb.local` / `Sara Javed` |
| `ONLY` + `TRIP1` | Re-run some steps against an existing trip, e.g. `ONLY=3,5,6` `TRIP1=9` |

## Notes for writing selectors

- A dropdown sits inside its `<label>`, so the label's text also contains every option. Find dropdowns with the `dropdown(scope, "Label")` helper, which matches the start of the label, instead of `getByLabel(...)`.
- Playwright's `isDisabled()` reports `false` for `<option>` elements; read `option.disabled` with `evaluate` instead.
