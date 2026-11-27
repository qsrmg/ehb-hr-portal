# EHB HR Portal: decisions before go-live

Tick each line and write the agreed value. Every item can be changed later in the portal without new development: **Rules & settings** (HR), **Expense & travel settings** (HR or Finance), **Leave types & quotas**, **Holiday calendar**, **Jobs and hiring → Headcount**, **Performance → Department templates**, **Assets** and **Employees**. "—" means no limit, or switched off.

## Before go-live (needs a real decision, not a tick)

- **Maternity / Paternity days (180 / 30)** — must be checked against the current federal Act by HR/legal before go-live; the figure in the Leave table below is unconfirmed.
- **Email service for notifications** — still the Mailpit test mailbox; must be switched to a production SMTP service before real employees are added.
- **First password for new employees ("Welcome@123")** — a placeholder; HR to set the real initial-password policy.
- **Who holds each role (HR, Finance, Admin, Management, HODs)** — still demo people; HR to assign the real role holders.
- **Policies and HR forms uploaded** — still samples; HR to upload the real policy documents.
- **HR contact email (hr@ehb.local)** — a placeholder address; needs the real one.
- **Exit offboarding starter checklist content** — placeholder wording seeded by migration, not yet reviewed by HR/Admin.
- **Moon-sighted holiday dates (Eid, Muharram, Rabi-ul-Awal)** — not entered; these vary each year, so HR must enter the dates once announced.
- **Performance appeal time limit, and what Close cycle does to a pending one** — there is no deadline today; an employee can appeal any time after a result is released, even after the cycle is closed, and Close cycle does not stop a still-open acknowledgement or appeal; HR/Management to decide whether a deadline is needed and what closing a cycle should do about either.
- **Probation employees in Performance cycles** — included exactly like confirmed staff today; HR/Management to decide whether probationary employees should take part, be excluded, or be flagged differently.
- **An employee's open scorecard on exit mid-cycle** — left exactly where it was today, with no automatic action; HR/Management to decide what should happen to it.
- **A pending performance approval step when the manager changes mid-cycle** — keeps its original approver today unless HR separately runs the exit handover; HR/Management to decide whether an ordinary manager change should reassign it too.
- **Performance ratings linked to increments or promotions** — no such link exists anywhere in the system today; Management to decide whether one should be built.
- **Who corrects an HR user's own pay slip** — HR cannot edit their own pay slip; HR/Management to decide whether a second HR user or Management makes that correction instead.
- **Whether a higher degree satisfies a stated Bachelor's requirement** — the Employment Eligibility Policy's qualification records (slice 1) do not assume a Master's or other higher degree automatically satisfies a position's stated Bachelor's requirement; HR/Management to decide, before any enforcement is built.

**Attendance and office hours**

| ✓ | Setting | Now | Agreed |
|---|---|---|---|
| ☐ | Late after (HH:MM) | 09:25 | |
| ☐ | Hours for Present / Half Day (below Half Day = Absent) | 6 / 4 | |
| ☐ | Late arrivals in a month that warn HR | 3 | |
| ☐ | Attendance Updates per month / within how many days | 3 / 7 | |
| ☐ | Office hours (approval reminders only in office hours) | 09:00–18:00 | |
| ☐ | Hours between reminders to an approver | 3 | |
| ☐ | Biometric machine export format | Daily sheet or punch log | |

**Leave** (quotas per year; pro-rated for joiners)

| ✓ | Leave type | Now | Agreed |
|---|---|---|---|
| ☐ | Annual Leave: quota / notice / carry forward | 14 / 3 days / 14 | |
| ☐ | Casual Leave / Sick Leave (certificate after) | 10 / 8 (2 days) | |
| ☐ | Leave Without Pay | No quota, HR approves, 3 days' notice | |
| ☐ | Maternity / Paternity (check the federal Act) | 180 / 30 days | |
| ☐ | Moon-sighted holidays (Eid, Muharram, Rabi-ul-Awal) | Not entered | |

**Pay slips, expense claims and travel**

| ✓ | Setting | Now | Agreed |
|---|---|---|---|
| ☐ | Pay slips available by (day of month) | 5 | |
| ☐ | Expense: max per claim / max per month | — / — | |
| ☐ | Expense: Management also approves above | — | |
| ☐ | Expense: no receipt needed below / oldest claimable | PKR 500 / 30 days | |
| ☐ | Expense categories, accounting codes, monthly limits | 8 categories, no codes | |
| ☐ | Travel: Management also approves above / max advance | — / — | |
| ☐ | Travel: daily allowance / mileage per km / hotel per night | — / — / — | |
| ☐ | Travel: settlement due within (days after return) | 15 | |

**Assets, exit and hiring**

| ✓ | Setting | Now | Agreed |
|---|---|---|---|
| ☐ | Asset categories, and which must be returned on exit | 17 categories (accessories: no) | |
| ☐ | Resignation notice: confirmed / on probation | 30 / 7 days | |
| ☐ | Pay out unused Annual Leave in the final settlement | On | |
| ☐ | Experience and relieving letter wording, signatory | Draft wording, signed by the HR user who issues them | |
| ☐ | Approved headcount per department | Not set (no limit) | |
| ☐ | Grade of every employee (replacements keep the grade) | Empty | |
| ☐ | Internal jobs: internal-only days / months in role to apply | 7 / 12 | |
| ☐ | Internal jobs: minimum last performance rating | Off | |

**Employee Assets Management Policy (effective 5 October 2026) and Cyber Security Incident Response Policy (v1.0, effective 5 October 2026)**

These clauses are left open by the policies themselves; each is an HR-editable setting in *Rules & settings*, empty (off) by default, and the feature works safely either way (see [README.md](README.md#assets)).

| Setting | Controls | Default | Clause left open | Decide |
|---|---|---|---|---|
| `assets.recoveryApprovalThreshold` | Amount above which an asset-loss/damage recovery also needs Management approval before it is final | Empty (no threshold; HR's decision stands) | A6 — "subject to law and company approval" | Finance / Management |
| `assets.cyberSecurityNotifyRole` | Role also notified (one line, no employee description) when a data-bearing asset is reported lost, stolen or damaged | Empty (no extra notification) | Cyber Security Incident Response Policy's reporting requirement | IT/Security & Management |
| `assets.auditReminderMonths` | How often Admin is reminded to start an asset verification round (A13 physical audit) | Empty (no reminder; Admin can still start one any time) | A13 — "periodic asset verification or physical audits" | HR / Admin |
| `assets.policeReportRequiredTypes` | Report types (damaged, lost) for which a police report is recommended on screen; never blocking | Empty (HR or Admin decide case by case) | A6 — "a police report may be required" | HR / Admin |
| `assets.recoveryMethod` | A short label describing how recovery amounts are worked out, shown for reference on the recovery form only | Empty ("not configured yet"; Finance enters the amount by hand — no depreciation formula is built) | A6 / A11 — the policy does not set a depreciation or valuation method | Finance |

Also HR/Admin-editable per category (*Assets → Categories*), not global settings: "Can hold company data" (which categories trigger the Cyber Security notification; policy leaves the device list open) and "Authorising role for transfers" (A9's "relevant department"; empty means Admin).

**Training**

| ✓ | Setting | Now | Agreed |
|---|---|---|---|
| ☐ | Training approval chain (Line Manager → HOD → Finance): confirm with HR and Finance | Not in the PDF's roles table | |
| ☐ | Cost above which Management also approves training | — (off) | |

**Dress Code Policy**

| ✓ | Setting | Now | Agreed |
|---|---|---|---|
| ☐ | Which published policy documents require acknowledgement | HR decides per document on upload | |
| ☐ | Warnings and counselling record (D5): verbal counselling and written warnings stay a manual conversation; no record is kept in the portal | Not built; decide separately whether HR and the Line Manager need a shared record (who can record one, employee's own visibility, privacy, appeal) | |

**Performance (Balanced Scorecard)**

| ✓ | Setting | Now | Agreed |
|---|---|---|---|
| ☐ | Rating names 1 to 5 | Unsatisfactory, Needs Improvement, Meets Expectations, Exceeds Expectations, Outstanding | |
| ☐ | Score from which the result is rating 5 / 4 / 3 / 2 | 4.5 / 3.5 / 2.5 / 1.5 | |
| ☐ | Minimum weight per perspective | 0% | |
| ☐ | Joiners included if they join in the first … months | 3 | |
| ☐ | KPI templates per department | None | |
| ☐ | Cycle dates (six-monthly) | Not started | |

**General**

| ✓ | Setting | Now | Agreed |
|---|---|---|---|
| ☐ | HR contact email on the website and sign-in page | hr@ehb.local | |
| ☐ | First password for new employees (changed at first login) | Welcome@123 | |
| ☐ | Email service for notifications (SMTP) | Test mailbox (Mailpit) | |
| ☐ | Who holds each role: HR, Finance, Admin, Management, HODs | Demo people | |
| ☐ | Single sign-on (SSO) on the sign-in page | Not built — work email and password only | |
| ☐ | Policies and HR forms to upload | Samples | |

**Activity monitoring (keyboard/mouse presence time and Active %)**

Off by default (`activity.enabled`, empty/off). Browser-tab only: it records a boolean ("was there any mouse/keyboard/touch/scroll activity") per minute, never which key, mouse position, page content, URL or window title — see [README.md](README.md) and `backend/src/services/activity.ts`. Nothing from this feature feeds appraisal, increment or disciplinary decisions automatically, and nothing here does that on its own.

| Setting | Controls | Default | Decide |
|---|---|---|---|
| `activity.idleThresholdMinutes` | Minutes with no input before a minute counts as idle (a short gap after real activity still counts as active) | 5 | HR |
| `activity.retentionDays` | Days an employee's daily totals are kept before a nightly job deletes them | 90 | HR |
| `activity.breakWindows` | Daily windows (e.g. lunch, prayer) excluded from tracking entirely | Empty (none) | HR |
| `activity.allowPause` / `activity.pauseMaxMinutesPerDay` | Lets an employee pause their own tracking, capped at this many minutes a day | Both off (allowPause off, cap 0) | HR |
| Who is tracked | A single global on/off plus a per-employee exclusion list (*Admin → Activity monitoring*); per-department rules were not built | Exclusion list only | HR |
| Who sees individual day-by-day detail | Only HR (not Finance, not Management); Line Managers and HR both see only team/company averages (never a colleague's own %) | HR only | HR/Management |
| **"Checked in" proxy** | There is no live attendance check-in in this portal (attendance comes from the biometric import, after the fact — see `backend/src/modules/attendance.ts`), so tracking is gated on: office hours, not a weekend or configured holiday, no approved leave or travel for the day (reusing the existing holiday/leave/travel checks from `backend/src/services/attendance.ts`), the tab being open, acknowledged and not excluded — instead of a real check-in/check-out event. **Recommendation: keep this proxy until a real employee-initiated check-in exists.** | Office hours + working day + tab open (proxy) | HR/Management |
| Legal/HR policy review of the tracking text shown to employees (`backend/src/services/activity.ts`, `POLICY_TEXT`) | Required before switching `activity.enabled` on company-wide | Not reviewed | HR/Legal |
| Use in appraisal, increment or disciplinary decisions | **Recommended: never** — no code path connects this feature to those modules today; keep it that way | No automatic use | Management |
| A desktop agent for activity outside the browser tab | Out of scope; not built | Not built | Management |

**Tasks (task board with assignment)**

Employees create tasks for themselves only (`tasks.employeesCanCreateOwnTasks`, on by default); a Line Manager/HOD may assign within their own direct-and-indirect team (`backend/src/services/tasks.ts`, `teamIdsRecursive`), regardless of department — there is no cross-department restriction in v1. HR may assign anyone. Finance is always own-tasks-only, even if they happen to have reports. No hard delete — "Archive" only, by the creator, the assignee's direct manager, or HR. History (who changed status/assignee/due date/priority, and when) is read straight out of the existing audit log, filtered to those four fields only — comment text is never written to the audit log at all.

| Setting | Controls | Default | Decide |
|---|---|---|---|
| `tasks.defaultPriority` | Priority a new task gets when none is chosen | Medium | HR |
| `tasks.employeesCanCreateOwnTasks` | Lets an employee create a task assigned to themselves | On | HR |
| `tasks.sendEmails` | Also emails task notifications (assigned, status changed, overdue digest), not just the in-app row | On | HR |
| **ADMIN / MANAGEMENT role scope** | Not specified in the original brief; implemented as own-tasks-only in v1 (same as Finance), even though some MANAGEMENT users structurally have direct reports in the org chart. An ADMIN/MANAGEMENT user who *also* holds LINE_MANAGER or HOD gets team scope through that role instead. | Own tasks only | HR/Management |
| Tasks feeding appraisal or performance | **Recommended: never** — no code path connects Tasks to Performance today | No automatic use | Management |
| Showing activity-monitoring data alongside task data | **Recommended: no** — the two features are not cross-referenced anywhere in the UI or API | Not shown together | HR/Management |
| Sub-tasks, labels, attachments, recurring tasks, an extra "Review" column | Out of scope v1; not built | Not built | Management |
| Viewing another person's tasks as HR or Line Manager | **Recommended: not audited** — ordinary work items, not the sensitive-data class that gets `VIEW_SENSITIVE` elsewhere (payslips, CNIC, activity detail) | Not audited | HR |

**Exit and offboarding**

Clearance stays the existing four area-level cards (IT/Admin, Line Manager, HR, Finance; `backend/src/services/exits.ts`); an offboarding checklist sits underneath them as a separate, informational layer — `ExitChecklistTemplate` (HR-configurable, *Exit clearance → Checklist templates*) is snapshotted into `ExitChecklistItem` rows when a case opens, so later template edits never change an already-open case. An item with no owner role may only be toggled by HR; an item with an owner role may be toggled by that role or HR. Checklist toggle follows the clearance-card rule; the employee never toggles their own items — the one deliberate exception is a LINE_MANAGER-owned item, where toggle (not clearing) also accepts the employee's *current* manager, not only the card's originally-snapshotted approver. `GET /exits/:id/history` reads `AuditLog` filtered to this case (and its cards/checklist items/interview), field-whitelisted as in Tasks, and is restricted to HR, Finance and Admin — not the employee, the Line Manager or Management. A new `reminders`-style job (`sendDueExitClearanceReminders`, reusing the existing office-hours gate and `reminders.intervalHours`) nudges whoever owns a clearance card that has sat PENDING past the interval.

| Setting | Controls | Default | Decide |
|---|---|---|---|
| Starter checklist content | Placeholder wording seeded by migration `20261123060154_exit_checklist_and_reminders` (2 items per area: IT/Admin, Line Manager, HR, Finance) | Placeholder, not reviewed | HR/Admin |
| Checklist completion gating area clearance | Whether an incomplete checklist blocks clearing its area | Off — informational only, does not change `canClear` | HR |
| Withdrawing an approved resignation / open exit case | Whether an employee can self-service-withdraw once HR has approved it (today: HR-only, via Cancel) | Off — stays HR-only | HR/Management |
| Last working day vs. the employee's own approved leave | Whether to block a last working day that falls inside their own already-approved leave | Off — not checked | HR |
| `exit.sendEmails` | Also emails exit clearance notifications (card cleared, settlement recorded, cancelled, …), not just the in-app notification | On | HR |

**Shared policy acknowledgement**

Every "I have read / I agree" acknowledgement in the portal (a document that requires acknowledgement, and the activity-monitoring policy) is now recorded in one table, `PolicyAcknowledgement` (`backend/prisma/schema.prisma`), keyed by `policyKey` + `version` + `employeeId` and never rewritten once recorded. The two tables this replaced — `DocumentAcknowledgement` and `ActivityPolicyAcknowledgement` — are left in the schema, frozen, read-only history; migration `20261121061300_policy_acknowledgement` copies every row that existed in them into the new table and touches neither old table otherwise. HR's "who has not acknowledged" report is now a single generic endpoint, `GET /policies/:policyKey/acknowledgements` (`backend/src/services/policyAcknowledgement.ts`), used by both the Documents page and the new "Policy acknowledgement" card on the Activity admin page.

| Setting | Controls | Default | Decide |
|---|---|---|---|
| A document with acknowledgement rows | Cannot be deleted (409) — the rows are never cascaded away; a document with none can still be deleted | Blocked while rows exist | HR |
| Dropping the two old (now frozen) tables | **Recommended: not yet** — keep them as a historical record for at least one full cycle, then drop in a separate, explicit change | Kept, unused | HR/Management |

**Employment Eligibility Policy — qualification records (slice 1)**

Employment Eligibility Policy (effective 5 October 2026), slice 1 only: `EmployeeQualification` (`backend/prisma/schema.prisma`) lets HR record and verify an employee's qualification claims (type, evidence type, institution, completion date, an optional evidence file, a note); an employee may have several records, and only HR ever writes one — never the employee. A record counts as verified only once it is marked completed *and* HR has verified it (§4: enrolled/in progress is never completed). Visibility is HR and the employee themselves only — read-only for the employee (Verified / Pending verification / No qualification on record, on *My profile*, with their own evidence downloadable). Line Manager, HOD, Finance, Admin and Management get a plain 403, with no exception, including on the evidence download. Every create/update is audited with before/after values; HR opening another employee's qualification records, and anyone downloading an evidence file, are both logged as `VIEW_SENSITIVE`. A requisition/posted job can separately state a *Minimum qualification* (§3). **No gate reads any of this yet** — an unverified or missing qualification does not block an internal application, a promotion, or an intern's conversion to permanent; that is a later, separate decision (slices 2/3 of the enforcement plan, not approved or built).

| Setting | Controls | Default | Decide |
|---|---|---|---|
| Whether a higher degree (e.g. a Master's) is treated as satisfying a stated Bachelor's requirement | Not assumed anywhere in the code; HR must judge each case by hand until this is decided | Not assumed; no automatic equivalence | HR/Management |

---

**Repository note:** line endings are enforced as LF via `.gitattributes` (`* text=auto eol=lf`, with binary file types excepted) and `core.autocrlf` is set to `false` for this repository, so Windows checkouts no longer convert files to CRLF and reintroduce whole-file diff noise.

Decided by: ____________________ (HR)   ____________________ (Finance)   ____________________ (Management)   Date: __________
