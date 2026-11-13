# EHB HR Portal: decisions before go-live

Tick each line and write the agreed value. Every item can be changed later in the portal without new development: **Rules & settings** (HR), **Expense & travel settings** (HR or Finance), **Leave types & quotas**, **Holiday calendar**, **Jobs and hiring → Headcount**, **Performance → Department templates**, **Assets** and **Employees**. "—" means no limit, or switched off.

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
| ☐ | Rating names 1 to 5 | Unsatisfactory, Needs Improvement, Meets, Exceeds, Outstanding | |
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
| ☐ | Policies and HR forms to upload | Samples | |

---

**Repository note:** line endings are enforced as LF via `.gitattributes` (`* text=auto eol=lf`, with binary file types excepted) and `core.autocrlf` is set to `false` for this repository, so Windows checkouts no longer convert files to CRLF and reintroduce whole-file diff noise.

Decided by: ____________________ (HR)   ____________________ (Finance)   ____________________ (Management)   Date: __________
