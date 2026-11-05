# EHB HR Portal: 20-minute demo for HR

All people and figures in the demo are made up.

## Before the demo (5 minutes, on the morning of the demo)

The demo dates follow the day you load the data, so load it on the day.

1. Stop the backend (`Ctrl+C` in the backend window).
2. Load the demo data. This **wipes** the `hr_ms` database and the `backend/uploads` folder:
   ```
   cd backend
   npm run db:demo -- --yes
   ```
3. Start the backend again (`npm run dev` in `backend/`). The frontend can keep running.
4. Open `http://localhost:3000` in a private browser window. Use a new private window for each person, so you are never signed in as two people at once.

**Logins** (all with the password `Password@123`):

| Person | Login | Role in the demo |
|---|---|---|
| Ali Raza | `ali@ehb.demo` | Employee (Senior Software Engineer) |
| Hamza Malik | `hamza@ehb.demo` | Line Manager and Head of Engineering |
| Ayesha Siddiqui | `ayesha@ehb.demo` | HR Manager |
| Bilal Ahmed | `bilal@ehb.demo` | Finance Manager |
| Usman Tariq | `usman@ehb.demo` | Admin (travel and assets) |
| Imran Qureshi | `imran@ehb.demo` | CEO (Management) |
| Others | `sara@`, `zainab@`, `fahad@`, `maryam@`, `omar@`, `hina@`, `kashif@`, `nida@`, `sana@ehb.demo` | For questions |

---

## Part 1: The employee (6 minutes), login `ali@ehb.demo`

1. **Landing page** (`http://localhost:3000`). One line: "Everything an employee needs, in one place." Click **Sign In** and log in as Ali.
2. **Dashboard.**
   - Greeting and today's date.
   - **Today's in-time** shows "imported up to yesterday": HR imports the biometric file every day.
   - **This month's attendance**: On Time, Late, Half Day, Absent.
   - **Leave balances**, with what is left.
   - **My requests**: a casual leave and an expense claim, both with his Line Manager.
   - **Pay slips**: last month's, with a Download button.
3. **Attendance** (sidebar). The month day by day. Point out the **Half Day**, and say: "a missed punch is fixed with an Attendance Update within 7 days; the machine record is never overwritten."
4. **Apply for leave** (dashboard button). Choose *Annual Leave* and pick two days next month. The form counts working days, skips weekends and holidays, and checks the balance and notice period. **Don't submit.**
5. **Pay slips & tax.** Download a pay slip PDF. Mention the yearly tax statement (July to June).
6. **Policies and documents.** Four sample policies; HR uploads the real ones.
7. **My inventory.** His laptop and email account, issued by Admin.

## Part 2: The manager (4 minutes), login `hamza@ehb.demo`

1. **Dashboard.** The blue card **Waiting for your approval: 2 tasks**.
2. Under *Waiting for your approval*, click **Approve** on Ali's casual leave. It is done in one click, and the card shows 1 task.
3. Open **Approvals** → Ali's **Expense Claim**. Show the two lines and the attached receipt, then click **Approve**. Explain: "it now goes to Finance; every step is recorded and emailed."
4. **Team.** Hamza sees only his own team's attendance and leave.

## Part 3: HR (5 minutes), login `ayesha@ehb.demo`

1. **Dashboard.** HR tiles: active employees, on leave today, late warnings.
2. **Employees.** 15 people in 7 departments. Open **Sara Javed**: job fields, **grade**, **in current role since** and **on probation until**. Mention that CNIC and bank details are visible only to authorised HR.
3. **Late warnings.** Kashif arrived late several times in a month (three or more raises a warning). HR is warned; nothing is deducted.
4. **Leave types & quotas**, **Holiday calendar** and **Rules & settings**: "every quota, limit and day count is a setting HR can change without new development" (see DECISIONS.md).
5. **Audit log.** Every change and every view of sensitive data, with who and when.

## Part 4: Phase 2 in 5 minutes

1. **Expense Claim**, login `bilal@ehb.demo`. **Approvals** → Ali's claim → **Approve**, then **Mark as paid**. Finance can reduce or reject single lines.
2. **Travel**, login `usman@ehb.demo`. **Travel** (HR Admin menu): Omar's trip to Karachi is approved and waiting to be booked. Then **Assets**: the register of laptops and accounts, with tags and warranty dates.
3. **Resignation & exit clearance**, login `ayesha@ehb.demo`. **Exit clearance** → **Zainab Hussain**.
   - Hamza has already cleared his part ("Handover to Ali completed").
   - IT / Admin can't clear until her laptop and email account are returned.
   - Finance clears last, with the final settlement.
   - After her last working day her login is switched off automatically, and her experience and relieving letters are emailed to her personal email.
4. **Performance (BSC)**, still Ayesha. **Performance** → **Cycles** → the cycle starting next month: everyone is at goal setting, from department templates. Ali's goals have already been sent to him to acknowledge.
5. **Jobs and hiring**, still Ayesha. **Requisitions** → **Digital Marketing Executive**.
   - Raised by Fahad, approved by Finance (with the budget), the CEO and HR, then posted.
   - Kashif has applied. His manager is told only if he is shortlisted.
   - Optional: click **Shortlist** to show it.

**Close:** "Phase 1 and Phase 2 are built. Phase 3 is next: PF statement and withdrawal, training requests and visiting cards. Before go-live we need your decisions on the settings in DECISIONS.md."

---

### If someone asks…

- **Emails:** every step sends one; in this setup they appear in Mailpit (`http://127.0.0.1:8025`), not real mailboxes.
- **Missed punch:** log in as `maryam@ehb.demo`. Yesterday has no check-out, so it shows as Absent until she raises an Attendance Update.
- **Laptop receipt:** log in as `sara@ehb.demo` → **My inventory** → **Confirm I received it**.
- **The leave Hamza approved** is now on Ali's attendance calendar for that day.
- **Starting again:** stop the backend, run `npm run db:demo -- --yes` and start it again.
