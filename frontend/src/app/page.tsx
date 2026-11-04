import Link from "next/link";
import {
  ArrowRight, Bell, CalendarDays, ChartNoAxesColumn, CircleCheck, ClipboardList, Clock, Contact, Eye, FileText, FolderOpen, KeyRound,
  Landmark, LayoutDashboard, LifeBuoy, ListChecks, Lock, Network, Package, ShieldCheck, UserRound, UsersRound, Wallet, Workflow,
  type LucideIcon,
} from "lucide-react";
import { Logo } from "@/components/brand";
import { HR_EMAIL } from "@/components/icons";
import { RedirectIfSignedIn } from "@/components/RedirectIfSignedIn";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { DashboardPreview, HeroBackground } from "@/components/landing/HeroVisuals";
import { CountUp, Reveal } from "@/components/landing/motion";

// Public landing page. Signed-in users are sent straight to their dashboard.
// Layout: full-bleed navy bands alternating deep navy and midnight blue, content 80rem wide, cards on a lighter navy.

const FEATURES: { icon: LucideIcon; title: string; text: React.ReactNode }[] = [
  { icon: LayoutDashboard, title: "Employee Dashboard", text: "Today's in-time, monthly attendance, leave balances and pending tasks on one screen." },
  { icon: Clock, title: "Attendance Management", text: "Each day shown as On Time, Late, Half Day or Absent. Fix a missed punch without overwriting the record." },
  { icon: CalendarDays, title: "Leave Management", text: "Working days counted for you, balance and notice period checked, documents requested when needed." },
  { icon: Wallet, title: "Payroll & Payslips", text: "Download monthly pay slips as PDF by the 5th, and view your yearly tax statement for July to June." },
  { icon: FileText, title: "Employee Documents", text: "Company policies and HR forms uploaded by HR, ready to read and download." },
  { icon: ClipboardList, title: "HR Requests", text: "Letters, expenses, travel and more, with 13 request forms rolling out in phases." },
  { icon: Workflow, title: "Approval Workflow", text: "Every request moves to the right approver in turn, and every step is recorded." },
  { icon: UserRound, title: "Employee Profile", text: "Update your own contact details. HR manages job, department, manager and salary fields." },
  { icon: Bell, title: "Notifications", text: "An email at each step, plus reminders to approvers every 3 hours during office hours." },
  { icon: LifeBuoy, title: "HR Support", text: <>Questions about your records, policies or sign-in? Reach HR at <a href={`mailto:${HR_EMAIL}`} className="font-semibold text-white underline-offset-2 hover:underline">{HR_EMAIL}</a>.</> },
];

const STEPS = [
  { title: "Employee Sign In", text: "Log in with your work email and password." },
  { title: "Access Personal Dashboard", text: "See in-time, attendance, balances and tasks at a glance." },
  { title: "Manage Attendance and Leave", text: "Apply for leave and correct missed punches yourself." },
  { title: "Submit HR Requests", text: "Forms already know your name, department and manager." },
  { title: "Track Approvals and Updates", text: "Pending, Approved, Rejected or Returned, with an email each time." },
];

const PATH = [
  { title: "Employee submits", text: "Form and documents." },
  { title: "Pending with approvers", text: "Approver 1, 2, 3 in turn." },
  { title: "Approved", text: "Final approver signs off." },
  { title: "Action happens", text: "Balance, letter or payout." },
];

const BENEFITS: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: CircleCheck, title: "Know where every request is", text: "Status and an email at each step, so nothing waits unseen." },
  { icon: Eye, title: "See your own records", text: "Leave balance, pay slips and tax statement, without asking HR." },
  { icon: Clock, title: "Fix a missed punch yourself", text: "Raise an Attendance Update within 7 days. The original record is kept." },
  { icon: FolderOpen, title: "One home for policies", text: "HR policies and forms in one place, always the current version." },
];

// The portal's real roles; each sees only what its permissions allow.
const ROLES: { icon: LucideIcon; title: string; text: string; access: string }[] = [
  { icon: UserRound, title: "Employees", text: "Own dashboard, attendance, leave balance and pay slips. Apply for leave and other requests.", access: "Own records only" },
  { icon: UsersRound, title: "Line Managers", text: "Everything an employee does, plus approve or return team requests and see team attendance and leave.", access: "Work information of their own team" },
  { icon: Network, title: "Heads of Department", text: "Second-level approval for expenses, travel, resignations and hiring requests.", access: "Requests routed to them" },
  { icon: Contact, title: "HR Department", text: "Manages employee records, holiday calendar, leave quotas and policies. Imports attendance.", access: "Authorised HR staff see CNIC, family and medical records" },
  { icon: Landmark, title: "Finance Department", text: "Uploads monthly payroll. Approves training, expense, travel and PF payouts.", access: "Payroll and salary data" },
  { icon: Package, title: "Admin", text: "Books travel and handles visiting cards and company assets.", access: "Travel, cards and assets" },
  { icon: ChartNoAxesColumn, title: "Management / CEO", text: "Views reports and salary data. Sits on the PF Board / Committee.", access: "Reports and salary data" },
];

const SECURITY: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: ShieldCheck, title: "Role-based views", text: "Line Managers see work information of their own team only. CNIC, bank and medical details stay with authorised HR and payroll staff." },
  { icon: Eye, title: "Salary data", text: "Visible to the employee, HR, Finance and the CEO." },
  { icon: ListChecks, title: "Every change is logged", text: "All changes to records and all views of sensitive data are recorded with who and when." },
  { icon: Lock, title: "Protected and backed up", text: "Passwords stored encrypted, all traffic over HTTPS, data backed up daily." },
];

const PHASES = [
  { phase: "Phase 1", when: "At launch", items: ["Login and dashboard", "Employee profiles", "Attendance", "Attendance Update", "Leave", "Pay slip and tax statement", "Policies and HR documents"] },
  { phase: "Phase 2", when: "Next", items: ["Letter Request", "Expense Claim", "Travel", "Resignation and exit clearance", "Performance (BSC)", "My Inventory (assets)", "Manpower Requisition and internal jobs"] },
  { phase: "Phase 3", when: "Later", items: ["PF statement and withdrawal", "Training request", "Visiting card"] },
];

const FACTS = [
  { value: 13, suffix: "", label: "request forms on one approval engine" },
  { value: 7, suffix: "", label: "roles, each with its own permissions" },
  { value: 3, suffix: "", label: "hours between approval reminders" },
  { value: 24, suffix: "/7", label: "access to pay slips and balances" },
];

const container = "mx-auto max-w-7xl px-4 sm:px-6 lg:px-8";

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="inline-flex items-center gap-2.5 text-xs font-bold uppercase tracking-[0.2em] text-sun">
      <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
        <span className="anim-glint absolute inset-0 rounded-full bg-sun" />
        <span className="relative h-1.5 w-1.5 rounded-full bg-sun" />
      </span>
      {children}
    </p>
  );
}

function SectionHead({ eyebrow, title, text, id }: { eyebrow: string; title: React.ReactNode; text?: string; id?: string }) {
  return (
    <Reveal className="max-w-2xl">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 id={id} className="mt-4 text-balance text-[2rem] font-extrabold leading-[1.1] tracking-tight text-white sm:text-[2.75rem]">{title}</h2>
      {text && <p className="mt-4 text-pretty text-base leading-relaxed text-haze sm:text-lg">{text}</p>}
    </Reveal>
  );
}

function IconCard({ icon: Icon, title, text, index }: { icon: LucideIcon; title: string; text: React.ReactNode; index: number }) {
  return (
    <Reveal
      index={index % 4}
      className="group relative h-full rounded-2xl border border-white/[.07] bg-gradient-to-b from-ink-800/90 to-ink-900/70 p-6 transition duration-300 hover:-translate-y-1 hover:border-primary/50 hover:shadow-[0_24px_50px_-28px_rgba(37,99,235,.65)]"
    >
      <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-[#93b4ff] ring-1 ring-inset ring-primary/25 transition duration-300 group-hover:bg-primary group-hover:text-white group-hover:ring-primary">
        <Icon className="h-5 w-5 transition-transform duration-300 group-hover:scale-110" aria-hidden="true" />
      </span>
      <h3 className="mt-5 text-base font-bold text-white">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-haze">{text}</p>
    </Reveal>
  );
}

function PrimaryCta({ tone = "blue" }: { tone?: "blue" | "yellow" }) {
  return (
    <Link
      href="/login"
      className={`group inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-sm font-bold transition duration-200 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sun ${
        tone === "blue"
          ? "bg-primary text-white shadow-[0_14px_34px_-12px_rgba(37,99,235,.95)] hover:bg-primary-hover hover:shadow-[0_18px_40px_-12px_rgba(37,99,235,1)]"
          : "bg-sun text-ink-950 shadow-[0_14px_34px_-14px_rgba(245,183,0,.8)] hover:brightness-105"
      }`}
    >
      Access HR Portal
      <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" aria-hidden="true" />
    </Link>
  );
}

export default function LandingPage() {
  return (
    <div className="flex min-h-full flex-1 flex-col overflow-x-clip bg-ink-950 font-display text-white">
      <RedirectIfSignedIn />
      <a href="#main" className="sr-only z-[60] rounded-md bg-sun px-3 py-2 font-bold text-ink-950 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Skip to content</a>
      <LandingHeader />

      <main id="main">
        {/* Hero */}
        <section id="top" className="relative isolate overflow-hidden pt-[72px]">
          <HeroBackground />
          <div className={`${container} relative grid items-center gap-16 pb-24 pt-12 sm:pt-16 lg:grid-cols-[1.08fr_1fr] lg:gap-10 lg:pb-32 lg:pt-24`}>
            <div className="max-w-xl">
              <div className="anim-fade-up" style={{ "--i": 0 } as React.CSSProperties}>
                <Eyebrow>EHB Technologies | Human Resources</Eyebrow>
              </div>
              <h1 className="anim-fade-up mt-6 text-balance text-[2.5rem] font-extrabold leading-[1.04] tracking-[-0.025em] sm:text-6xl xl:text-[4.1rem]" style={{ "--i": 1 } as React.CSSProperties}>
                Your Entire{" "}
                <span className="bg-gradient-to-r from-[#6f9bff] via-[#9ab8ff] to-[#c7d6ff] bg-clip-text text-transparent">HR Experience.</span>
                <br className="hidden sm:block" />{" "}
                One <span className="bg-gradient-to-r from-sun to-[#ffd45c] bg-clip-text text-transparent">Intelligent Workspace.</span>
              </h1>
              <p className="anim-fade-up mt-6 max-w-lg text-pretty text-lg leading-relaxed text-haze" style={{ "--i": 2 } as React.CSSProperties}>
                Manage attendance, leave, payroll, requests, and employee documents through one secure, connected HR platform.
              </p>
              <div className="anim-fade-up mt-9 flex flex-col gap-3 sm:flex-row" style={{ "--i": 3 } as React.CSSProperties}>
                <PrimaryCta />
                <a
                  href="#features"
                  className="inline-flex items-center justify-center rounded-xl border border-white/20 bg-white/[.03] px-6 py-3.5 text-sm font-bold text-white transition duration-200 hover:-translate-y-0.5 hover:border-white/40 hover:bg-white/[.07] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sun"
                >
                  Explore Features
                </a>
              </div>
              <ul className="anim-fade-up mt-7 flex flex-wrap gap-x-5 gap-y-2 text-sm text-haze" style={{ "--i": 4 } as React.CSSProperties} aria-label="Highlights">
                {["Secure access", "Real-time updates", "Mobile friendly"].map((t) => (
                  <li key={t} className="inline-flex items-center gap-1.5"><CircleCheck className="h-4 w-4 text-sun" aria-hidden="true" />{t}</li>
                ))}
              </ul>
            </div>
            <DashboardPreview />
          </div>
        </section>

        {/* Facts strip */}
        <section aria-label="The portal in numbers" className="relative border-y border-white/[.06] bg-ink-900/60">
          <dl className={`${container} grid grid-cols-2 gap-y-8 py-10 lg:grid-cols-4`}>
            {FACTS.map((f, i) => (
              <Reveal key={f.label} index={i} className="flex flex-col gap-1 border-white/[.08] px-2 sm:px-6 lg:border-l lg:first:border-l-0">
                <dt className="order-2 text-sm leading-snug text-haze">{f.label}</dt>
                <dd className="order-1 text-3xl font-extrabold tracking-tight text-white sm:text-4xl"><CountUp value={f.value} />{f.suffix}</dd>
              </Reveal>
            ))}
          </dl>
        </section>

        {/* Features */}
        <section id="features" className="scroll-mt-20 py-24 sm:py-28">
          <div className={container}>
            <SectionHead eyebrow="Features" title={<>Everything Your <br className="hidden sm:block" />Workday Needs.</>} text="From the first punch of the day to the last approval, every HR task lives in one connected place." />
            <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {FEATURES.map((f, i) => <IconCard key={f.title} {...f} index={i} />)}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="relative scroll-mt-20 overflow-hidden bg-ink-900 py-24 sm:py-28">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(45%_60%_at_85%_0%,rgba(37,99,235,.16),transparent_70%)]" />
          <div className={`${container} relative`}>
            <SectionHead eyebrow="How it works" title="How EHB HR Works" text="One simple path from sign in to a tracked decision." />
            <Reveal as="ol" className="relative mt-14 grid lg:grid-cols-5 lg:gap-6">
              {STEPS.map((s, i) => (
                <li key={s.title} className="relative flex gap-5 pb-10 last:pb-0 lg:block lg:pb-0">
                  {/* Connector: vertical on phones and tablets, horizontal on desktop; grows when the section comes into view */}
                  {i < STEPS.length - 1 && (
                    <>
                      <span aria-hidden="true" className="absolute bottom-0 left-[21px] top-12 w-px bg-white/10 lg:hidden">
                        <span className="grow-y block h-full w-full bg-gradient-to-b from-primary to-sun/80" style={{ "--d": i * 220 } as React.CSSProperties} />
                      </span>
                      <span aria-hidden="true" className="absolute left-14 right-[-12px] top-[21px] hidden h-0.5 rounded-full bg-white/10 lg:block">
                        <span className={`grow-x block h-full rounded-full ${i < 2 ? "bg-primary" : "bg-gradient-to-r from-primary to-sun"}`} style={{ "--d": i * 220 } as React.CSSProperties} />
                      </span>
                    </>
                  )}
                  <span className={`relative z-10 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-extrabold shadow-[0_0_0_6px_var(--color-ink-900)] ${i === STEPS.length - 1 ? "bg-sun text-ink-950" : "bg-primary text-white"}`}>{i + 1}</span>
                  <div className="lg:mt-5">
                    <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-haze">Step {i + 1}</div>
                    <h3 className="mt-1 text-lg font-bold leading-snug">{s.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-haze">{s.text}</p>
                  </div>
                </li>
              ))}
            </Reveal>

            <Reveal className="mt-16 rounded-3xl border border-white/[.07] bg-ink-800/60 p-6 sm:p-10">
              <div className="grid gap-8 lg:grid-cols-[1fr_1.6fr] lg:items-center">
                <div>
                  <h3 className="text-balance text-2xl font-extrabold tracking-tight sm:text-3xl">Every request follows the same path.</h3>
                  <p className="mt-3 text-sm leading-relaxed text-haze">All 13 request forms use one approval engine. Each request type has its own chain of approvers, but the steps never change.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {PATH.map((p, i) => (
                    <div key={p.title} className="rounded-2xl bg-ink-950/50 p-4 ring-1 ring-white/[.06]">
                      <div className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-sun">Step {i + 1}</div>
                      <div className="mt-1 font-bold">{p.title}</div>
                      <div className="mt-0.5 text-sm text-haze">{p.text}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <p className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-haze"><strong className="text-white">Returned.</strong> Sent back for changes. You edit and resubmit.</p>
                <p className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-haze"><strong className="text-white">Rejected.</strong> Closed with a reason you can read.</p>
              </div>
              <p className="mt-5 text-xs leading-relaxed text-haze">Reminder emails go to the current approver every 3 hours, during office hours only (9 to 6, Monday to Friday). Every step is recorded: who approved, when, and any comment.</p>
            </Reveal>
          </div>
        </section>

        {/* Employee benefits */}
        <section id="benefits" className="scroll-mt-20 py-24 sm:py-28">
          <div className={`${container} grid gap-12 lg:grid-cols-[1fr_1.35fr] lg:items-start`}>
            <SectionHead eyebrow="Employee benefits" title={<>Less chasing. <br className="hidden sm:block" />More clarity.</>} text="No more requests lost in email, paper or messages. You can see your own information without asking HR." />
            <div className="grid gap-4 sm:grid-cols-2">{BENEFITS.map((b, i) => <IconCard key={b.title} {...b} index={i} />)}</div>
          </div>
        </section>

        {/* Roles */}
        <section className="bg-ink-900 py-24 sm:py-28" aria-labelledby="roles-title">
          <div className={container}>
            <SectionHead id="roles-title" eyebrow="Who uses the portal" title="The right access for every role." text="Everyone signs in with their own account and sees only what their role allows. One person can hold more than one role." />
            <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {ROLES.map((r, i) => (
                <Reveal key={r.title} index={i % 4} className="flex h-full flex-col rounded-2xl border border-white/[.07] bg-ink-800/70 p-6 transition duration-300 hover:-translate-y-1 hover:border-white/20">
                  <r.icon className="h-5 w-5 text-[#93b4ff]" aria-hidden="true" />
                  <h3 className="mt-4 font-bold">{r.title}</h3>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-haze">{r.text}</p>
                  <p className="mt-5 flex items-start gap-2 border-t border-white/10 pt-4 text-xs leading-relaxed text-white/85">
                    <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sun" aria-hidden="true" />
                    <span><span className="font-bold text-sun">Access:</span> {r.access}</span>
                  </p>
                </Reveal>
              ))}
              <Reveal index={3} className="flex h-full flex-col justify-between rounded-2xl bg-gradient-to-br from-sun to-[#ffcf3d] p-6 text-ink-950">
                <ShieldCheck className="h-6 w-6" aria-hidden="true" />
                <div>
                  <h3 className="mt-6 text-lg font-extrabold">Permissions decide</h3>
                  <p className="mt-2 text-sm leading-relaxed">Salaries, private records and approval functions are never open to everyone. What you see follows your role.</p>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* Security */}
        <section id="security" className="scroll-mt-20 py-24 sm:py-28">
          <div className={`${container} grid gap-12 lg:grid-cols-[1fr_1.35fr] lg:items-start`}>
            <SectionHead eyebrow="Security and privacy" title={<>You see only what <br className="hidden sm:block" />your role allows.</>} text="Personal and salary information is shared with as few people as the work needs." />
            <div className="grid gap-4 sm:grid-cols-2">{SECURITY.map((s, i) => <IconCard key={s.title} {...s} index={i} />)}</div>
          </div>
        </section>

        {/* Rollout */}
        <section className="bg-ink-900 py-24 sm:py-28" aria-labelledby="rollout-title">
          <div className={container}>
            <SectionHead id="rollout-title" eyebrow="Rollout" title="Three phases, daily essentials first." />
            <div className="mt-14 grid gap-4 md:grid-cols-3">
              {PHASES.map((p, i) => (
                <Reveal key={p.phase} index={i} className={`h-full rounded-2xl border p-6 ${i === 0 ? "border-sun/40 bg-ink-800/80" : "border-white/[.07] bg-ink-800/40"}`}>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wider ${i === 0 ? "bg-sun text-ink-950" : "bg-white/10 text-white"}`}>{p.phase}</span>
                    <span className="text-sm text-haze">{p.when}</span>
                  </div>
                  <ul className="mt-5 space-y-2.5 text-sm text-white/85">
                    {p.items.map((it) => (
                      <li key={it} className="flex items-start gap-2"><CircleCheck className={`mt-0.5 h-4 w-4 shrink-0 ${i === 0 ? "text-sun" : "text-white/30"}`} aria-hidden="true" />{it}</li>
                    ))}
                  </ul>
                </Reveal>
              ))}
            </div>
            <p className="mt-6 text-sm text-haze">Not offered at EHB today: Loan, Advance Salary and Award Reimbursement.</p>
          </div>
        </section>

        {/* Call to action */}
        <section className="relative isolate overflow-hidden">
          <div aria-hidden="true" className="anim-drift pointer-events-none absolute -inset-[20%] -z-10 bg-[radial-gradient(35%_60%_at_15%_50%,rgba(37,99,235,.4),transparent_70%),radial-gradient(25%_50%_at_90%_60%,rgba(245,183,0,.12),transparent_70%)]" />
          <Reveal className={`${container} flex flex-col items-start justify-between gap-8 py-20 lg:flex-row lg:items-center`}>
            <div>
              <h2 className="text-balance text-3xl font-extrabold tracking-tight sm:text-[2.75rem]">Ready when you are.</h2>
              <p className="mt-3 text-lg text-haze">Sign in with your work email to see your dashboard, leave balance and pay slips.</p>
            </div>
            <div className="text-sm">
              <PrimaryCta tone="yellow" />
              <p className="mt-3 text-haze">Trouble signing in? Contact HR at <a className="font-semibold text-white underline-offset-2 hover:underline" href={`mailto:${HR_EMAIL}`}>{HR_EMAIL}</a></p>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="border-t border-white/[.06] bg-ink-950">
        <div className={`${container} flex flex-col gap-5 py-8 sm:flex-row sm:items-center`}>
          <div className="flex items-center gap-3">
            <Logo size="sm" />
            <span className="text-sm text-haze">EHB Technologies · Human Resources · HR Self-Service Portal</span>
          </div>
          <nav className="flex gap-6 text-sm font-semibold sm:ml-auto" aria-label="Footer">
            <a href="#features" className="transition-colors hover:text-sun">Features</a>
            <a href="#security" className="transition-colors hover:text-sun">Security</a>
            <Link href="/login" className="transition-colors hover:text-sun">Sign In</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
