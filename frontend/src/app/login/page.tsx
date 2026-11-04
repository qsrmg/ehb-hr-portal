"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/brand";
import { HR_EMAIL, Icon } from "@/components/icons";
import { useAuth } from "@/lib/auth";

// Sign-in page (design page 6): the story on the dark left panel, the light sign-in card on the right.

const POINTS = [
  ["Attendance and leave", "in a few clicks"],
  ["Pay slips and tax statement", "as PDF, any time"],
  ["Requests and approvals", "tracked end to end"],
] as const;

export default function LoginPage() {
  const { user, login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) router.replace(user.mustChangePassword ? "/change-password" : "/dashboard");
  }, [user, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const input =
    "block w-full rounded-lg border border-slate-300 bg-white py-3 pl-11 text-[15px] text-ink-950 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30";

  return (
    <div className="grid min-h-full flex-1 bg-ink-950 font-display text-white lg:grid-cols-[1.15fr_1fr]">
      {/* Story panel */}
      <section className="relative flex flex-col overflow-hidden px-5 py-6 sm:px-10 lg:py-10">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_55%_at_20%_10%,rgba(37,99,235,.35),transparent_70%)]" />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[.06] [background-image:linear-gradient(#9fb0cc_1px,transparent_1px),linear-gradient(90deg,#9fb0cc_1px,transparent_1px)] [background-size:56px_56px]" />
        <div className="relative flex items-center justify-between gap-4">
          <Link href="/" aria-label="EHB HR Portal home"><Logo size="lg" /></Link>
          <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-white/90 hover:text-white">
            <Icon name="arrowLeft" className="h-4 w-4" /> Back to home
          </Link>
        </div>
        <div className="relative my-auto max-w-xl py-10 lg:py-16">
          <p className="flex items-center gap-2.5 text-xs font-bold uppercase tracking-[0.18em] text-white/85">
            <span className="h-1.5 w-1.5 rounded-full bg-sun" aria-hidden="true" />
            EHB Technologies | Human Resources
          </p>
          <h1 className="mt-5 text-balance text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl">
            Welcome back to your <span className="text-sun">HR workspace.</span>
          </h1>
          <p className="mt-5 max-w-md text-lg leading-relaxed text-haze">Attendance, leave, pay slips and requests, together in one secure, connected place.</p>
          <ul className="mt-7 space-y-3">
            {POINTS.map(([strong, rest]) => (
              <li key={strong} className="flex items-start gap-3 text-[15px]">
                <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sun text-ink-950"><Icon name="check" className="h-3.5 w-3.5" /></span>
                <span><strong className="font-bold">{strong}</strong> <span className="text-haze">{rest}</span></span>
              </li>
            ))}
          </ul>
          <div className="mt-9 hidden flex-wrap gap-3 sm:flex" aria-hidden="true">
            <div className="rounded-xl border border-white/10 bg-white/[.06] px-4 py-3 backdrop-blur">
              <div className="text-xs text-white/75">Today&apos;s attendance</div>
              <div className="mt-1 text-lg font-bold">On Time · 09:12 AM</div>
              <div className="text-xs text-haze">Demo preview</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[.06] px-4 py-3 backdrop-blur">
              <div className="text-xs text-white/75">Leave request</div>
              <div className="mt-1 text-lg font-bold">Approved</div>
              <div className="text-xs text-haze">Demo preview</div>
            </div>
          </div>
        </div>
        <p className="relative hidden text-sm text-haze lg:block">EHB Technologies · Human Resources</p>
      </section>

      {/* Sign-in card */}
      <section className="flex items-start justify-center bg-ink-950 px-4 pb-12 lg:items-center lg:bg-ink-900/60 lg:py-12">
        <form onSubmit={submit} className="w-full max-w-md rounded-2xl bg-mist p-6 text-ink-950 shadow-[0_30px_80px_-30px_rgba(0,0,0,.8)] sm:p-8">
          <span className="block h-1 w-9 rounded-full bg-sun" aria-hidden="true" />
          <h2 className="mt-4 text-3xl font-extrabold tracking-tight">Sign in</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-slate-600">Use your work email and password to open your HR portal.</p>

          {error && (
            <div role="alert" className="mt-5 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-inset ring-red-200">{error}</div>
          )}

          <label htmlFor="login-email" className="mt-6 block text-sm font-bold">Work email</label>
          <div className="relative mt-2">
            <Icon name="mail" className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
            <input id="login-email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" className={`${input} pr-3`} />
          </div>

          <div className="mt-5 flex items-center justify-between gap-3">
            <label htmlFor="login-password" className="text-sm font-bold">Password</label>
            <button type="button" onClick={() => setForgot((v) => !v)} aria-expanded={forgot} aria-controls="forgot-help" className="text-sm font-bold text-primary underline underline-offset-2 hover:text-primary-hover">
              Forgot password?
            </button>
          </div>
          <div className="relative mt-2">
            <Icon name="lock" className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
            <input
              id="login-password" type={showPassword ? "text" : "password"} autoComplete="current-password" required value={password}
              onChange={(e) => setPassword(e.target.value)} className={`${input} pr-12`}
            />
            <button
              type="button" onClick={() => setShowPassword((v) => !v)} aria-pressed={showPassword} aria-label={showPassword ? "Hide the characters" : "Show the characters"}
              className="absolute right-2 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-ink-950"
            >
              <Icon name={showPassword ? "eyeOff" : "eye"} className="h-5 w-5" />
            </button>
          </div>
          {forgot && (
            <p id="forgot-help" className="mt-3 rounded-lg bg-white px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-200">
              Forgot your password? Ask HR to reset it: <a href={`mailto:${HR_EMAIL}`} className="font-semibold text-primary">{HR_EMAIL}</a>
            </p>
          )}

          <button
            type="submit" disabled={busy}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-3.5 text-base font-bold text-white shadow-[0_12px_30px_-12px_rgba(37,99,235,.9)] transition hover:bg-primary-hover disabled:opacity-60"
          >
            {busy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden="true" /> : <Icon name="lock" className="h-5 w-5" />}
            Sign in securely
          </button>

          <p className="mt-6 flex items-center gap-2 border-t border-slate-200 pt-5 text-sm text-slate-600">
            <Icon name="shield" className="h-4 w-4 shrink-0" /> Secured with HTTPS. Passwords are stored encrypted.
          </p>
        </form>
      </section>
    </div>
  );
}
