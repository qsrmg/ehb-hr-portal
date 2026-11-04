"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, Check, Eye, EyeOff, Info, Loader2, Lock, Mail, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/brand";
import { HR_EMAIL } from "@/components/icons";
import { HeroBackground } from "@/components/landing/HeroVisuals";
import { useAuth } from "@/lib/auth";

// Sign-in page: EHB story on the left, the sign-in card on the right (stacked on phones).
// Uses the existing login (POST /auth/login) and shows the server's error messages unchanged.

const POINTS = [
  ["Attendance and leave", "in a few clicks"],
  ["Pay slips and tax statement", "as PDF, any time"],
  ["Requests and approvals", "tracked end to end"],
] as const;

type FieldErrors = { email?: string; password?: string };

function validate(email: string, password: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!email.trim()) errors.email = "Enter your work email.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.email = "Enter a valid email address, like name@company.com.";
  if (!password) errors.password = "Enter your password.";
  return errors;
}

export default function LoginPage() {
  const { user, login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  // A failed attempt gives the card a short shake (restarted on every attempt; off with reduced motion).
  useEffect(() => {
    const el = form.current;
    if (!attempt || !el) return;
    el.classList.remove("anim-shake");
    void el.offsetWidth;
    el.classList.add("anim-shake");
  }, [attempt]);

  useEffect(() => {
    if (user) router.replace(user.mustChangePassword ? "/change-password" : "/dashboard");
  }, [user, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors = validate(email, password);
    setFieldErrors(errors);
    setError(null);
    if (errors.email || errors.password) {
      setAttempt((n) => n + 1);
      document.getElementById(errors.email ? "login-email" : "login-password")?.focus();
      return;
    }
    setBusy(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError((err as Error).message);
      setAttempt((n) => n + 1);
    } finally {
      setBusy(false);
    }
  };

  const field = (invalid: boolean) =>
    `peer block w-full rounded-xl border bg-white py-3 pl-11 text-[15px] text-ink-950 placeholder:text-slate-400 transition-[border-color,box-shadow] duration-200 focus:outline-none focus:ring-4 ${
      invalid ? "border-red-500 focus:border-red-500 focus:ring-red-500/15" : "border-slate-300 hover:border-slate-400 focus:border-primary focus:ring-primary/15"
    }`;
  const icon = "pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400 transition-colors duration-200 peer-focus:text-primary";

  return (
    <div className="grid min-h-full flex-1 bg-ink-950 font-display text-white lg:grid-cols-[1.1fr_1fr]">
      {/* EHB story */}
      <section className="relative isolate flex flex-col overflow-hidden px-5 py-6 sm:px-10 lg:min-h-screen lg:px-14 lg:py-10">
        <HeroBackground />
        <div className="anim-fade-up relative flex items-center justify-between gap-4">
          <Link href="/" aria-label="EHB HR Portal home" className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sun"><Logo size="lg" /></Link>
          <Link href="/" className="group inline-flex items-center gap-2 rounded-md text-sm font-semibold text-white/85 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-sun">
            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" aria-hidden="true" /> Back to home
          </Link>
        </div>
        <div className="relative my-auto max-w-xl py-8 lg:py-16">
          <p className="anim-fade-up inline-flex items-center gap-2.5 text-xs font-bold uppercase tracking-[0.2em] text-sun" style={{ "--i": 1 } as React.CSSProperties}>
            <span className="h-1.5 w-1.5 rounded-full bg-sun" aria-hidden="true" />
            EHB Technologies | Human Resources
          </p>
          <h1 className="anim-fade-up mt-5 text-balance text-[2.25rem] font-extrabold leading-[1.06] tracking-[-0.02em] sm:text-5xl" style={{ "--i": 2 } as React.CSSProperties}>
            Welcome back to your <span className="bg-gradient-to-r from-sun to-[#ffd45c] bg-clip-text text-transparent">HR workspace.</span>
          </h1>
          <p className="anim-fade-up mt-5 max-w-md text-pretty text-lg leading-relaxed text-haze" style={{ "--i": 3 } as React.CSSProperties}>
            Attendance, leave, pay slips and requests, together in one secure, connected place.
          </p>
          <ul className="mt-7 hidden space-y-3 sm:block">
            {POINTS.map(([strong, rest], i) => (
              <li key={strong} className="anim-fade-up flex items-start gap-3 text-[15px]" style={{ "--i": 4 + i } as React.CSSProperties}>
                <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sun text-ink-950"><Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" /></span>
                <span><strong className="font-bold">{strong}</strong> <span className="text-haze">{rest}</span></span>
              </li>
            ))}
          </ul>
          <div className="mt-10 hidden flex-wrap gap-3 lg:flex" aria-hidden="true">
            {[["Today's attendance", "On Time · 09:12 AM"], ["Leave request", "Approved"]].map(([label, value], i) => (
              <div key={label} className="anim-pop anim-float rounded-2xl border border-white/10 bg-white/[.06] px-4 py-3 backdrop-blur-md" style={{ "--i": i } as React.CSSProperties}>
                <div className="text-xs text-white/75">{label}</div>
                <div className="mt-1 text-lg font-bold">{value}</div>
                <div className="text-xs text-haze">Demo preview</div>
              </div>
            ))}
          </div>
        </div>
        <p className="relative hidden text-sm text-haze lg:block">EHB Technologies · Human Resources</p>
      </section>

      {/* Sign-in card */}
      <section className="relative flex items-start justify-center px-4 pb-12 lg:items-center lg:border-l lg:border-white/[.06] lg:bg-ink-900/70 lg:px-10 lg:py-12">
        <div className="anim-rise w-full max-w-[440px]">
          <form
            ref={form}
            onSubmit={submit}
            noValidate
            aria-describedby={error ? "login-error" : undefined}
            className="rounded-3xl bg-mist p-6 text-ink-950 shadow-[0_40px_90px_-40px_rgba(0,0,0,.9)] ring-1 ring-white/10 sm:p-9"
          >
            <span className="block h-1 w-10 rounded-full bg-sun" aria-hidden="true" />
            <h2 className="mt-5 text-3xl font-extrabold tracking-tight">Sign in</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-slate-600">Use your work email and password to open your HR portal.</p>

            {error && (
              <div id="login-error" role="alert" className="anim-fade-up mt-6 flex items-start gap-2.5 rounded-xl bg-red-50 px-3.5 py-3 text-sm text-red-800 ring-1 ring-inset ring-red-200">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            <label htmlFor="login-email" className="mt-6 block text-sm font-bold">Work email</label>
            <div className="relative mt-2">
              <input
                id="login-email" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false}
                value={email} onChange={(e) => { setEmail(e.target.value); if (fieldErrors.email) setFieldErrors({ ...fieldErrors, email: undefined }); }}
                placeholder="name@company.com" aria-invalid={!!fieldErrors.email} aria-describedby={fieldErrors.email ? "login-email-error" : undefined}
                className={`${field(!!fieldErrors.email)} pr-3`}
              />
              <Mail className={icon} aria-hidden="true" />
            </div>
            {fieldErrors.email && <p id="login-email-error" className="anim-fade-up mt-1.5 text-sm font-medium text-red-700">{fieldErrors.email}</p>}

            <div className="mt-5 flex items-center justify-between gap-3">
              <label htmlFor="login-password" className="text-sm font-bold">Password</label>
              <button type="button" onClick={() => setForgot((v) => !v)} aria-expanded={forgot} aria-controls="forgot-help" className="rounded text-sm font-bold text-primary underline decoration-primary/40 underline-offset-4 transition-colors hover:text-primary-hover hover:decoration-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                Forgot password?
              </button>
            </div>
            <div className="relative mt-2">
              <input
                id="login-password" type={showPassword ? "text" : "password"} autoComplete="current-password"
                value={password} onChange={(e) => { setPassword(e.target.value); if (fieldErrors.password) setFieldErrors({ ...fieldErrors, password: undefined }); }}
                aria-invalid={!!fieldErrors.password} aria-describedby={fieldErrors.password ? "login-password-error" : undefined}
                className={`${field(!!fieldErrors.password)} pr-12`}
              />
              <Lock className={icon} aria-hidden="true" />
              <button
                type="button" onClick={() => setShowPassword((v) => !v)} aria-pressed={showPassword} aria-label={showPassword ? "Hide the characters" : "Show the characters"}
                className="absolute right-1.5 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-ink-950 focus-visible:outline-2 focus-visible:outline-primary"
              >
                {showPassword ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
              </button>
            </div>
            {fieldErrors.password && <p id="login-password-error" className="anim-fade-up mt-1.5 text-sm font-medium text-red-700">{fieldErrors.password}</p>}

            <div className={`grid transition-[grid-template-rows] duration-300 ${forgot ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
              <div className="min-h-0 overflow-hidden">
                <p id="forgot-help" className="mt-3 flex items-start gap-2 rounded-xl bg-white px-3.5 py-3 text-sm text-slate-700 ring-1 ring-slate-200" hidden={!forgot}>
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <span>Forgot your password? Ask HR to reset it: <a href={`mailto:${HR_EMAIL}`} className="font-semibold text-primary underline-offset-2 hover:underline">{HR_EMAIL}</a></span>
                </p>
              </div>
            </div>

            <button
              type="submit" disabled={busy} aria-busy={busy}
              className="group mt-7 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-base font-bold text-white shadow-[0_14px_34px_-14px_rgba(37,99,235,.95)] transition duration-200 hover:-translate-y-0.5 hover:bg-primary-hover hover:shadow-[0_18px_38px_-14px_rgba(37,99,235,1)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:translate-y-0 disabled:cursor-wait disabled:opacity-80"
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Lock className="h-5 w-5" aria-hidden="true" />}
              {busy ? "Signing in…" : "Sign in securely"}
            </button>

            <p className="mt-7 flex items-center gap-2 border-t border-slate-200 pt-5 text-sm text-slate-600">
              <ShieldCheck className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" /> Secured with HTTPS. Passwords are stored encrypted.
            </p>
          </form>
        </div>
      </section>
    </div>
  );
}
