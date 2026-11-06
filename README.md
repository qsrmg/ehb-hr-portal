# EHB HR Self-Service Portal

Phase 1 of the portal described in `EHB_HR_Portal_Project_Overview11.pdf`: login and dashboard, employee profiles, attendance import, Attendance Update, leave, pay slips and tax statement, policies and HR documents. It also includes the shared approval engine and the Letter Request form.

| Part      | Stack                                              | Folder      | Port |
|-----------|----------------------------------------------------|-------------|------|
| Frontend  | Next.js 16 (App Router, TypeScript, Tailwind v4)   | `frontend/` | 3000 |
| Backend   | Node.js + Express 5 + TypeScript + Prisma 7        | `backend/`  | 5000 |
| Database  | PostgreSQL 18 (local, port 5433)                   | —           | —    |

## Setup

1. In `backend/.env`, set `DATABASE_URL` to your Postgres user and password (see `backend/.env.example`).
2. Backend:
   ```
   cd backend
   npm install
   npm run db:migrate      # creates the hr_ms database and tables
   npm run db:seed         # demo data (only runs on an empty database)
   npm run dev             # http://localhost:5000/api/health
   ```
3. Frontend (second terminal):
   ```
   cd frontend
   npm install
   npm run dev             # http://localhost:3000
   ```

`npm run db:reset` in `backend/` drops all data, re-applies migrations and re-seeds.

## Demo for HR

- **Demo data:** `npm run db:demo -- --yes` (in `backend/`, with the backend stopped) **wipes** the database in `backend/.env` and the `uploads` folder, then loads realistic fake data: 15 employees in 7 departments, a month of attendance, leave, an expense claim, a trip, assets, a resignation in progress, a performance cycle at goal setting and an open internal job. Logins: `<name>@ehb.demo` / `Password@123`.
- **[DEMO.md](DEMO.md):** the 20-minute demo script.
- **[DECISIONS.md](DECISIONS.md):** the printable checklist of settings HR and Finance must decide before go-live.

## Landing page and HR email

`/` is the public landing page; signed-in users go straight to `/dashboard`. *Sign in* and *Access HR Portal* open `/login`.

The HR contact address on the landing and sign-in pages comes from `NEXT_PUBLIC_HR_EMAIL` in `frontend/.env.local` (default `hr@ehb.local`; restart `npm run dev` in `frontend/` after changing it). The logo is `frontend/public/ehb-logo.png`; until that file exists a lettered placeholder is shown.

## Demo accounts

Password for all accounts: `Password@123`

| Email                 | Name            | Roles                    | Use it to test |
|-----------------------|-----------------|--------------------------|----------------|
| `employee@ehb.local`  | Ali Raza        | Employee                 | Has late arrivals, a half day, an absence and a missed punch this month |
| `employee2@ehb.local` | Sara Javed      | Employee                 | Joined April 2026 (pro-rated leave); has approved Annual Leave |
| `manager@ehb.local`   | Hamza Malik     | Line Manager, HOD        | Approves Ali's and Sara's leave and attendance updates; Team page |
| `hr@ehb.local`        | Ayesha Siddiqui | HR, HOD                  | Employee records, imports, holidays, leave quotas, letters, settings, audit |
| `finance@ehb.local`   | Bilal Ahmed     | Finance, HOD             | Payroll upload |
| `admin@ehb.local`     | Usman Tariq     | Admin                    | Read-only employee list |
| `ceo@ehb.local`       | Imran Qureshi   | Management               | All requests, audit log, salary data |

## Test script

1. **Dashboard**: log in as Ali. You should see this month's On Time / Late / Half Day / Absent counts, leave balances, open requests and the latest pay slip.
2. **Attendance Update**: on *Attendance*, click **Fix** on the last day (missed punch). Enter a check-out time and submit. Log in as Hamza; it appears under *Approvals*. Approve it. Back as Ali, the day shows the corrected status, with the machine values struck through. The original record is kept.
3. **Leave**: as Ali, apply for Annual Leave over a range that includes a weekend. The form counts working days only and checks the balance and the 3-day notice period. Try Sick Leave for 3+ days without an attachment; it asks for a medical certificate. Hamza approves; the balance drops.
4. **Return and resubmit**: Hamza returns a request with a comment. Ali sees *Returned*, edits it and resubmits, and the chain restarts.
5. **Leave Without Pay**: needs Line Manager **and** HR approval (two-step chain).
6. **Letter Request**: Ali requests a Salary Certificate. Ayesha (HR) approves. Ali downloads the PDF letter.
7. **Attendance import**: as Ayesha, open *Attendance Import* and upload `backend/samples/attendance-daily.csv` or `attendance-punch-log.csv`. Machine ID 999 is reported as unmatched. Ali already has 3 late arrivals, so a late warning appears under *Late Warnings*.
8. **Payroll**: as Bilal, open *Payroll Upload* and upload `backend/samples/payroll-october-2026.csv` for October 2026. Employees get pay slips (PDF) and a July–June tax statement.
9. **Employee import**: as Ayesha, open *Employees* and import `backend/samples/employees-google-form.csv`. Codes such as EHB-2026-008 are generated, and the new employees must change the initial password `Welcome@123`.
10. **Privacy**: as Hamza, open Ali's profile from *Team*. Only work information is shown. As Ayesha, the CNIC, bank and family fields are visible, and the view is logged in *Audit Log*.
11. **Settings**: as Ayesha, change the late cutoff, Attendance Update limit or reminder interval under *Rules & Settings*.

## Emails

Every approval step sends an email to the employee and to the next approver: submitted, approved at a step, final approval, returned, rejected, resubmitted, and cancelled (the approver is told). While a request waits, the current approver gets a reminder every 3 hours, Monday to Friday 09:00–18:00 Pakistan time, skipping public holidays. The interval and office hours are HR settings. The same messages appear under the bell icon.

Emails go through a background job queue ([pg-boss](https://github.com/timgit/pg-boss)), which keeps its jobs in the same PostgreSQL database (schema `pgboss`). Failed emails are retried up to 5 times with increasing delays, and the reminder check runs every 10 minutes on a schedule.

**Seeing emails locally (Mailpit).** Nothing reaches real inboxes in development:

```
cd backend
npm run mailpit          # third terminal; keep it running
```

Open http://localhost:8025 to read every email the portal sends. Mailpit is in `tools/mailpit/` and listens on this computer only. To skip Mailpit, set `SMTP_HOST=` (empty) in `backend/.env` and emails are printed in the backend console instead. In production, put your real SMTP server in `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM`.

## Tests

```
cd backend
npm test
```

The tests use a separate `hr_ms_test` database (created automatically), so your demo data is never touched. They cover:

- the emails at every approval step, and retries when the mail server fails;
- the 3-hour reminders: office hours, weekends, holidays and the interval;
- pro-rata entitlement and Annual Leave carry forward, including the automatic run on 1 January;
- recalculation of balances when HR changes a joining date or a quota;
- resignation and exit clearance: notice periods, early release, the four clearances, the final settlement, letters, deactivation and handover;
- performance (BSC): settings, templates, cycle eligibility, goals with and without the HOD step, confidentiality, self and manager review, calibration, appeal, the cycle overview;
- hiring: who can raise requisitions, the three approval routes, Finance's budget confirmation, headcount, returned/rejected/withdrawn requisitions, posting windows, eligibility, confidentiality until shortlisting, external candidates, internal and external hires, the draft replacement.

### Browser tests (e2e)

```
cd frontend
npm run e2e
```

One command runs every browser test (design screenshots, Travel, My Inventory, Resignation & exit clearance, Performance, Hiring, Apply for leave, then the demo walk-through on the demo data). Before **each** test it drops, migrates and seeds a separate `hr_ms_e2e` database, so the tests never touch `hr_ms` and don't depend on each other or on earlier runs. It starts its own backend (port 5100), frontend (3100) and Mailpit (8125) and stops them at the end. You don't need to start anything, and your own dev servers on 3000/5000/8025 can stay running. Details are in [frontend/e2e/README.md](frontend/e2e/README.md).

## Resignation & exit clearance

- **Resignation** (My Requests → Resignation): Line Manager → HOD → HR. For an HOD's own resignation, Management takes the HOD step. The employee can withdraw it until HR's final approval; after that only HR can cancel the exit.
- **Notice period:** 30 days for confirmed staff, 7 days on probation (until the *On probation until* date on the employee record). Both are in *Rules & Settings*.
- **Early release:** if the proposed last day is before the notice ends, the Line Manager recommends (or not) and HR sets the last working day. Finance deducts the days not served unless HR waives them.
- **Exit clearance** opens on HR's approval, or when HR starts an exit for a termination, end of contract or other reason (*Exit Clearance → Start an exit*):
  - IT / Admin, the Line Manager and HR clear in parallel;
  - IT / Admin can only clear once My Inventory shows the employee as cleared and no asset incident is waiting for a decision;
  - Finance clears last, by recording the final settlement. It comes pre-filled with asset recoveries, unsettled travel advances, approved claims not yet paid, notice days not served, and unused Annual Leave days (leave encashment can be switched off in *Rules & Settings*). Finance enters the amounts; the portal does not calculate salary.
- **Letters:** once all four have cleared, HR issues the experience and relieving letters. They are emailed as PDFs to the employee's personal email, and HR can download them.
- **Deactivation:** the login is switched off automatically at the end of the last working day (hourly job), even if clearance is not finished. HR then completes the exit. *Complete exit* is blocked until every card is cleared and the leaver's team, departments, pending approvals and clearance cards are reassigned (one click on the exit page). HR is warned about this when approving the resignation.
- **Exit interview:** optional, filled in by the employee (or recorded by HR) and visible to HR only.

## Performance (BSC)

Six-monthly Balanced Scorecard cycles (sidebar: *Performance*).

- **Cycles:** HR starts a cycle. Everyone active at the start is included, plus people who join in its first 3 months (a setting); later joiners wait for the next cycle. HR can add or remove someone by hand.
- **Goals:**
  - HR keeps a KPI template per department, and new scorecards start from it.
  - The Line Manager adjusts the KPIs: the four BSC perspectives, at most 10 KPIs, each at least 5%, 100% in total. A minimum weight per perspective is a setting (default 0).
  - The employee acknowledges the goals or asks for changes, then the HOD approves them. If the Line Manager is also the HOD, there is no duplicate step and the goals are agreed on acknowledgement.
- **Check-in:** at 3 months; comments only, no score.
- **Review:**
  - When the review opens, the employee submits a self-review and the Line Manager rates each KPI (1–5).
  - Sign-off then runs Line Manager → HOD → HR through the approval engine, so it appears in *Approvals* with the usual emails and reminders.
  - HR can change a rating during calibration, with a required reason; the original rating stays visible in the rating history.
  - The overall result is the weighted average. The scale names and the bands (4.5 / 3.5 / 2.5 / 1.5) are in *Rules & settings*.
- **Result:** the employee acknowledges it (a comment is kept on record) or appeals once to HR; HR's decision is final. The scorecard downloads as a PDF.
- **Confidentiality:** ratings are visible only to the employee, their Line Manager, the HOD, HR and Management. Finance and Admin cannot open scorecards.
- **Attendance:** the attendance and leave summary is shown for reference only and is not scored. There is no link to salary.

## Manpower Requisition and internal jobs

Sidebar: *Jobs and hiring*.

- **Requisitions:** Line Managers and HODs raise them for their own department, and HR for any department. A requisition is a **new position** or a **replacement**: for someone whose resignation or exit is approved, or for an employee who moved internally.
- **Approval routes** (the usual duplicate-step skipping and Management stand-in apply):
  - New position, or over the approved headcount: Line Manager → HOD → Finance → Management → HR.
  - Replacement at the same grade, within headcount: Line Manager → HOD → HR.
  - Replacement at a different grade: Line Manager → HOD → Finance → HR.
- **Budget:** the requester's salary range is only a suggestion; Line Managers don't see confirmed salaries. Finance must enter the confirmed salary range at its step. HR maintains the approved headcount per department (*Headcount* tab). Going over it isn't blocked, but adds Finance and Management.
- **Posting:** HR posts an approved position as internal only, external only, or both. For both, it is internal only for the first 7 days (a setting).
- **Who can apply:** active employees who are not on probation, with at least 12 months in their current role (a setting). A minimum last performance rating is also a setting, off by default.
- **Confidentiality:** applications are confidential. The applicant's current manager is told only at shortlisting, and the applicant is told this when applying.
- **Tracking:** HR moves applicants through Applied → Shortlisted → Interview → Offer → Hired or Not selected. The hiring manager sees shortlisted candidates and adds interview feedback. Candidates who are not selected get a polite email and a status update in the portal. HR adds external candidates by hand.
- **Hiring:**
  - **Internal hire:** the employee moves (department, manager, designation, grade; "in current role since" starts again), and their former manager gets a draft replacement requisition. It is not submitted.
  - **External hire:** *Create employee* opens Add employee, pre-filled from the requisition.
  - The position closes when every place is filled, and the remaining applicants are told. HR can also close it with a reason.
- **Employee record:** two new HR fields, *Grade* and *In current role since*.

## Leave year-end

Carry forward runs automatically at 00:05 on 1 January (Pakistan time) through the job queue. If the server is off at that moment, it runs once when the server starts again. HR can also run it from *Leave Types & Quotas*; running it again gives the same result, so it is safe to re-run after correcting last year's leave.

## Not yet decided (placeholders)

- Leave quotas, notice periods and maternity/paternity days are placeholders until *HR Portal — Final Rules v1* is signed off. HR can edit them under *Leave Types & Quotas*.
- Biometric export format: the import accepts a daily sheet (ID, Date, Check In, Check Out) or a raw punch log (ID, Date/Time).
- Only fixed-date public holidays are seeded. HR adds Eid and other moon-sighted holidays.
