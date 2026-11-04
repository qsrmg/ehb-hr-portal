import Link from "next/link";
import { Logo } from "@/components/brand";
import { HR_EMAIL, Icon, type IconName } from "@/components/icons";
import { RedirectIfSignedIn } from "@/components/RedirectIfSignedIn";

// Public landing page (design pages 1–5). Signed-in users are sent straight to their dashboard.

const FEATURES: { icon: IconName; title: string; text: React.ReactNode }[] = [
  { icon: "grid", title: "Employee Dashboard", text: "Today's in-time, monthly attendance, leave balances and pending tasks on one screen." },
  { icon: "clock", title: "Attendance Management", text: "Each day shown as On Time, Late, Half Day or Absent. Fix a missed punch without overwriting the record." },
  { icon: "calendar", title: "Leave Management", text: "Working days counted for you, balance and notice period checked, documents requested when needed." },
  { icon: "wallet", title: "Payroll & Payslips", text: "Download monthly pay slips as PDF by the 5th, and view your yearly tax statement for July to June." },
  { icon: "file", title: "Employee Documents", text: "Company policies and HR forms uploaded by HR, ready to read and download." },
  { icon: "clipboard", title: "HR Requests", text: "Letters, expenses, travel and more, with 13 request forms rolling out in phases." },
  { icon: "flow", title: "Approval Workflow", text: "Every request moves to the right approver in turn, and every step is recorded." },
  { icon: "user", title: "Employee Profile", text: "Update your own contact details. HR manages job, department, manager and salary fields." },
  { icon: "bell", title: "Notifications", text: "An email at each step, plus reminders to approvers every 3 hours during office hours." },
  { icon: "lifebuoy", title: "HR Support", text: <>Questions about your records, policies or sign-in? Reach HR at <span className="text-white">{HR_EMAIL}</span>.</> },
];

const STEPS = [
  { title: "Employee sign in", text: "Log in with your work email and password." },
  { title: "Access your dashboard", text: "See in-time, attendance, balances and tasks at a glance." },
  { title: "Manage attendance and leave", text: "Apply for leave and correct missed punches yourself." },
  { title: "Submit HR requests", text: "Forms already know your name, department and manager." },
  { title: "Track approvals and updates", text: "Status moves from Pending to Approved, Rejected or Returned, with an email each time." },
];

const PATH = [
  { title: "Employee submits", text: "Form and documents." },
  { title: "Pending with approvers", text: "Approver 1, 2, 3 in turn." },
  { title: "Approved", text: "Final approver signs off." },
  { title: "Action happens", text: "Balance, letter or payout." },
];

const BENEFITS: { icon: IconName; title: string; text: string }[] = [
  { icon: "checkCircle", title: "Know where every request is", text: "Status and an email at each step, so nothing waits unseen." },
  { icon: "eye", title: "See your own records", text: "Leave balance, pay slips and tax statement, without asking HR." },
  { icon: "clock", title: "Fix a missed punch yourself", text: "Raise an Attendance Update within 7 days. The original record is kept." },
  { icon: "folder", title: "One home for policies", text: "HR policies and forms in one place, always the current version." },
];

const ROLES = [
  { title: "Employee", text: "Own dashboard, attendance, leave balance and pay slips. Applies for leave and other requests.", access: "own records only" },
  { title: "Line Manager", text: "Everything an employee does, plus approves or returns team requests and sees team attendance and leave.", access: "work information of own team only" },
  { title: "Head of Department", text: "Second-level approval for expenses, travel, resignations and hiring requests.", access: "requests routed to them" },
  { title: "HR", text: "Manages employee records, holiday calendar, leave quotas and policies. Imports attendance.", access: "authorised HR staff see CNIC, family and medical records" },
  { title: "Finance", text: "Uploads monthly payroll. Approves training, expense, travel and PF payouts.", access: "payroll and salary data" },
  { title: "Admin", text: "Books travel and handles visiting cards and company assets.", access: "travel, cards and assets" },
  { title: "Management / CEO", text: "Views reports and salary data. Sits on the PF Board / Committee.", access: "reports and salary data" },
];

const SECURITY: { icon: IconName; title: string; text: string }[] = [
  { icon: "shield", title: "Role-based views", text: "Line Managers see work information of their own team only. CNIC, bank and medical details stay with authorised HR and payroll staff." },
  { icon: "eye", title: "Salary data", text: "Visible to the employee, HR, Finance and the CEO." },
  { icon: "list", title: "Every change is logged", text: "All changes to records and all views of sensitive data are recorded with who and when." },
  { icon: "lock", title: "Protected and backed up", text: "Passwords stored encrypted, all traffic over HTTPS, data backed up daily." },
];

const PHASES = [
  { phase: "Phase 1", when: "At launch", items: ["Login and dashboard", "Employee profiles", "Attendance", "Attendance Update", "Leave", "Pay slip and tax statement", "Policies and HR documents"] },
  { phase: "Phase 2", when: "Next", items: ["Letter Request", "Expense Claim", "Travel", "Resignation and exit clearance", "Performance (BSC)", "My Inventory (assets)", "Manpower Requisition and internal jobs"] },
  { phase: "Phase 3", when: "Later", items: ["PF statement and withdrawal", "Training request", "Visiting card"] },
];

const NAV = [
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#benefits", label: "Employee benefits" },
  { href: "#security", label: "Security" },
];

function Eyebrow({ children, dot }: { children: React.ReactNode; dot?: boolean }) {
  return (
    <p className="flex items-center gap-2.5 text-xs font-bold uppercase tracking-[0.18em] text-sun">
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-sun" aria-hidden="true" />}
      {children}
    </p>
  );
}

function SectionHead({ eyebrow, title, text }: { eyebrow: string; title: React.ReactNode; text?: string }) {
  return (
    <div className="max-w-2xl">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-3 text-balance font-display text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-[2.6rem]">{title}</h2>
      {text && <p className="mt-3 text-base leading-relaxed text-haze">{text}</p>}
    </div>
  );
}

function IconCard({ icon, title, text }: { icon: IconName; title: string; text: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line/70 bg-ink-800/70 p-5">
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/20 text-[#9dbaff]">
        <Icon name={icon} className="h-[18px] w-[18px]" />
      </span>
      <h3 className="mt-4 font-display text-base font-bold text-white">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-haze">{text}</p>
    </div>
  );
}

const SignInButton = ({ className = "" }: { className?: string }) => (
  <Link href="/login" className={`inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white shadow-[0_8px_24px_-8px_rgba(37,99,235,.8)] transition hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sun ${className}`}>
    Sign in
  </Link>
);

/** Static picture of the dashboard with sample data, clearly marked as a demo preview. */
function DashboardPreview() {
  const tile = "rounded-lg bg-white p-3 shadow-[0_1px_2px_rgba(15,31,57,.08)]";
  return (
    <div className="relative mx-auto w-full max-w-[400px]" aria-label="Demo preview of the dashboard with sample data" role="img">
      <div className="absolute -right-8 -top-6 z-10 hidden items-center sm:flex gap-2.5 rounded-lg border border-line bg-ink-900/95 px-3 py-2 shadow-xl">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-sun text-ink-950"><Icon name="file" className="h-4 w-4" /></span>
        <span className="leading-tight"><span className="block text-xs font-bold text-white">Pay slip ready</span><span className="text-[10px] text-haze">Sample notification</span></span>
      </div>
      <div className="rounded-2xl bg-mist p-3.5 text-ink-950 shadow-[0_30px_80px_-20px_rgba(0,0,0,.7)]">
        <div className="mb-3 flex items-center justify-between">
          <span className="font-display text-sm font-bold">EHB HR Portal</span>
          <span className="rounded-full bg-sun px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wider">Demo preview</span>
        </div>
        <div className="mb-2.5 flex items-center justify-between gap-2 rounded-lg bg-gradient-to-r from-ink-900 to-[#1d3f8f] px-3.5 py-3 text-white">
          <div className="min-w-0">
            <div className="truncate font-display text-sm font-bold">Welcome back, Sara</div>
            <div className="text-[10px] text-white/70">Wednesday, 4 November 2026</div>
          </div>
          <span className="shrink-0 rounded-md bg-white px-2 py-1 text-[10px] font-bold text-ink-950">Checked in</span>
        </div>
        <div className="grid grid-cols-2 gap-2.5 text-[11px]">
          <div className={tile}>
            <div className="text-[10px] text-slate-500">Today&apos;s attendance</div>
            <div className="mt-1 font-display text-base font-bold">On Time</div>
            <span className="mt-1 inline-block rounded-full bg-blue-100 px-2 py-0.5 text-[9px] font-semibold text-blue-800">Before 9:25 AM</span>
          </div>
          <div className={tile}>
            <div className="text-[10px] text-slate-500">Clock in and out</div>
            <div className="mt-2 flex justify-between"><span className="text-slate-500">In</span><span className="font-bold">09:12 AM</span></div>
            <div className="mt-1 flex justify-between"><span className="text-slate-500">Out</span><span className="font-bold">—</span></div>
          </div>
          <div className={`${tile} col-span-2`}>
            <div className="text-[10px] text-slate-500">Monthly attendance</div>
            <div className="mt-1.5 grid grid-cols-4 text-center">
              {[["18", "On Time"], ["2", "Late"], ["1", "Half Day"], ["0", "Absent"]].map(([n, l]) => (
                <div key={l}><div className="font-display text-base font-bold tabular-nums">{n}</div><div className="text-[9px] text-slate-500">{l}</div></div>
              ))}
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-slate-200"><div className="h-full w-[86%] rounded-full bg-primary" /></div>
          </div>
          <div className={tile}>
            <div className="text-[10px] text-slate-500">Leave balance</div>
            <div className="mt-1.5 flex justify-between"><span>Annual</span><span className="font-bold">12 days</span></div>
            <div className="mt-1 h-1 rounded-full bg-slate-200"><div className="h-full w-[72%] rounded-full bg-primary" /></div>
            <div className="mt-1.5 flex justify-between"><span>Sick</span><span className="font-bold">6 days</span></div>
            <div className="mt-1 h-1 rounded-full bg-slate-200"><div className="h-full w-[55%] rounded-full bg-sun" /></div>
          </div>
          <div className={tile}>
            <div className="text-[10px] text-slate-500">Pending approvals</div>
            <div className="mt-1 font-display text-base font-bold">1 task</div>
            <span className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-semibold text-amber-800">Leave request</span>
          </div>
          <div className={tile}>
            <div className="text-[10px] text-slate-500">Recent requests</div>
            <div className="mt-1.5 flex items-center justify-between gap-1"><span>Leave · 2 days</span><span className="rounded-full bg-amber-100 px-1.5 text-[9px] text-amber-800">Pending</span></div>
            <div className="mt-1 flex items-center justify-between gap-1"><span className="truncate">Attendance Update</span><span className="rounded-full bg-blue-100 px-1.5 text-[9px] text-blue-800">Approved</span></div>
          </div>
          <div className={tile}>
            <div className="text-[10px] text-slate-500">Upcoming company events</div>
            <div className="mt-1.5 font-semibold">Monthly all-hands</div>
            <div className="text-[9px] text-slate-500">Fri 6 Nov · sample</div>
            <div className="mt-1 font-semibold">Team lunch</div>
            <div className="text-[9px] text-slate-500">Thu 12 Nov · sample</div>
          </div>
        </div>
      </div>
      <div className="absolute -bottom-5 -left-8 hidden items-center sm:flex gap-2.5 rounded-lg border border-line bg-ink-900/95 px-3 py-2 shadow-xl">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary text-white"><Icon name="check" className="h-4 w-4" /></span>
        <span className="leading-tight"><span className="block text-xs font-bold text-white">Leave approved</span><span className="text-[10px] text-haze">Sample notification</span></span>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-ink-950 font-display text-white">
      <RedirectIfSignedIn />
      <header className="sticky top-0 z-40 border-b border-white/5 bg-ink-950/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
          <Link href="/" className="flex items-center gap-3">
            <Logo />
            <span className="hidden border-l border-white/15 pl-3 text-sm font-bold leading-tight sm:block">HR Self-Service<br />Portal</span>
          </Link>
          <nav className="ml-auto hidden items-center gap-7 text-sm font-semibold text-white/85 md:flex" aria-label="Sections">
            {NAV.map((n) => <a key={n.href} href={n.href} className="hover:text-white">{n.label}</a>)}
          </nav>
          <SignInButton className="ml-auto md:ml-4" />
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_60%_at_75%_30%,rgba(37,99,235,.28),transparent_70%)]" />
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[.07] [background-image:linear-gradient(#9fb0cc_1px,transparent_1px),linear-gradient(90deg,#9fb0cc_1px,transparent_1px)] [background-size:56px_56px]" />
          <div className="relative mx-auto grid max-w-6xl items-center gap-16 px-4 pb-24 pt-14 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pb-28 lg:pt-20">
            <div>
              <Eyebrow dot>EHB Technologies | Human Resources</Eyebrow>
              <h1 className="mt-5 text-balance text-[2.6rem] font-extrabold leading-[1.05] tracking-tight sm:text-6xl">
                Your Entire <span className="bg-gradient-to-r from-[#7ea6ff] to-[#b9c9ff] bg-clip-text text-transparent">HR Experience.</span>{" "}
                <span className="text-sun">One Intelligent Workspace.</span>
              </h1>
              <p className="mt-6 max-w-lg text-lg leading-relaxed text-haze">
                Manage attendance, leave, payroll, requests, and employee documents through one secure, connected HR platform.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/login" className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-bold text-white shadow-[0_10px_30px_-10px_rgba(37,99,235,.9)] transition hover:bg-primary-hover">
                  Access HR Portal <Icon name="arrowRight" className="h-4 w-4" />
                </Link>
                <a href="#features" className="inline-flex items-center rounded-lg border border-white/25 px-5 py-3 text-sm font-bold text-white transition hover:border-white/50 hover:bg-white/5">Explore Features</a>
              </div>
              <p className="mt-5 text-sm text-haze">Secure access • Real-time updates • Mobile friendly</p>
            </div>
            <DashboardPreview />
          </div>
        </section>

        {/* Features */}
        <section id="features" className="scroll-mt-20 bg-ink-900 py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHead eyebrow="Features" title={<>Everything Your<br />Workday Needs.</>} text="From the first punch of the day to the last approval, every HR task lives in one connected place." />
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map((f) => <IconCard key={f.title} {...f} />)}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="scroll-mt-20 py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHead eyebrow="How it works" title="How EHB HR Works" text="One simple path from sign in to a tracked decision." />
            <ol className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-5 lg:gap-6">
              {STEPS.map((s, i) => (
                <li key={s.title}>
                  <div className="flex items-center gap-3">
                    <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full font-bold ${i === STEPS.length - 1 ? "bg-sun text-ink-950" : "bg-primary text-white"}`}>{i + 1}</span>
                    <span aria-hidden="true" className={`hidden h-0.5 flex-1 lg:block ${i < 2 ? "bg-primary/70" : "bg-sun/70"}`} />
                  </div>
                  <h3 className="mt-4 text-lg font-bold leading-snug">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-haze">{s.text}</p>
                </li>
              ))}
            </ol>

            <div className="mt-16 rounded-2xl border border-line/70 bg-ink-800/60 p-6 sm:p-8">
              <h3 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Every request follows the same path.</h3>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-haze">All 13 request forms use one approval engine. Each request type has its own chain of approvers, but the steps never change.</p>
              <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {PATH.map((p, i) => (
                  <div key={p.title} className="rounded-lg bg-ink-700/60 p-4">
                    <div className="text-[11px] font-extrabold uppercase tracking-widest text-sun">Step {i + 1}</div>
                    <div className="mt-1 font-bold">{p.title}</div>
                    <div className="mt-0.5 text-sm text-haze">{p.text}</div>
                  </div>
                ))}
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <p className="rounded-lg border border-line px-4 py-3 text-sm text-haze"><strong className="text-white">Returned.</strong> Sent back for changes. You edit and resubmit.</p>
                <p className="rounded-lg border border-line px-4 py-3 text-sm text-haze"><strong className="text-white">Rejected.</strong> Closed with a reason you can read.</p>
              </div>
              <p className="mt-5 text-xs leading-relaxed text-haze">Reminder emails go to the current approver every 3 hours, during office hours only (9 to 6, Monday to Friday). Every step is recorded: who approved, when, and any comment.</p>
            </div>
          </div>
        </section>

        {/* Employee benefits */}
        <section id="benefits" className="scroll-mt-20 bg-ink-900 py-20">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[1fr_1.4fr]">
            <SectionHead eyebrow="Employee benefits" title={<>Less chasing.<br />More clarity.</>} text="No more requests lost in email, paper or messages. You can see your own information without asking HR." />
            <div className="grid gap-4 sm:grid-cols-2">{BENEFITS.map((b) => <IconCard key={b.title} {...b} />)}</div>
          </div>
        </section>

        {/* Roles */}
        <section className="py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHead eyebrow="Who uses the portal" title="The right access for every role." text="Everyone signs in with their own account and sees only what their role allows. One person can hold more than one role." />
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {ROLES.map((r) => (
                <div key={r.title} className="flex flex-col rounded-xl border border-line/70 bg-ink-800/70 p-5">
                  <h3 className="font-bold">{r.title}</h3>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-haze">{r.text}</p>
                  <p className="mt-4 border-t border-line pt-3 text-xs text-white/85"><span className="font-bold text-sun">Access:</span> {r.access}</p>
                </div>
              ))}
              <div className="rounded-xl bg-sun p-5 text-ink-950">
                <h3 className="font-bold">Permissions decide</h3>
                <p className="mt-2 text-sm leading-relaxed">Salaries, private records and approval functions are never open to everyone. What you see follows your role.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Security */}
        <section id="security" className="scroll-mt-20 bg-ink-900 py-20">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[1fr_1.4fr]">
            <SectionHead eyebrow="Security and privacy" title={<>You see only what<br />your role allows.</>} text="Personal and salary information is shared with as few people as the work needs." />
            <div className="grid gap-4 sm:grid-cols-2">{SECURITY.map((s) => <IconCard key={s.title} {...s} />)}</div>
          </div>
        </section>

        {/* Rollout */}
        <section className="py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHead eyebrow="Rollout" title={<>Three phases, daily<br />essentials first.</>} />
            <div className="mt-12 grid gap-4 md:grid-cols-3">
              {PHASES.map((p, i) => (
                <div key={p.phase} className={`rounded-xl border p-5 ${i === 0 ? "border-sun/40 bg-ink-800/80" : "border-line/70 bg-ink-800/40"}`}>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wider ${i === 0 ? "bg-sun text-ink-950" : "bg-white/10 text-white"}`}>{p.phase}</span>
                    <span className="text-sm text-haze">{p.when}</span>
                  </div>
                  <ul className="mt-4 space-y-2 text-sm text-white/85">{p.items.map((it) => <li key={it}>{it}</li>)}</ul>
                </div>
              ))}
            </div>
            <p className="mt-6 text-sm text-haze">Not offered at EHB today: Loan, Advance Salary and Award Reimbursement.</p>
          </div>
        </section>

        {/* Call to action */}
        <section className="relative overflow-hidden border-t border-white/5 bg-ink-900">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(40%_120%_at_10%_50%,rgba(37,99,235,.35),transparent_70%)]" />
          <div className="relative mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-4 py-16 sm:px-6">
            <div>
              <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Ready when you are.</h2>
              <p className="mt-2 text-haze">Sign in with your work email to see your dashboard, leave balance and pay slips.</p>
            </div>
            <div className="text-sm">
              <Link href="/login" className="inline-flex items-center gap-2 rounded-lg bg-sun px-6 py-3 font-bold text-ink-950 transition hover:brightness-105">
                Access HR Portal <Icon name="arrowRight" className="h-4 w-4" />
              </Link>
              <p className="mt-3 text-haze">Trouble signing in? Contact HR at <a className="text-white underline-offset-2 hover:underline" href={`mailto:${HR_EMAIL}`}>{HR_EMAIL}</a></p>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/5 bg-ink-950">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-6 sm:px-6">
          <Logo size="sm" />
          <span className="text-sm text-haze">EHB Technologies · Human Resources · HR Self-Service Portal</span>
          <nav className="ml-auto flex gap-6 text-sm font-semibold" aria-label="Footer">
            <a href="#features" className="hover:text-sun">Features</a>
            <a href="#security" className="hover:text-sun">Security</a>
            <Link href="/login" className="hover:text-sun">Sign in</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
