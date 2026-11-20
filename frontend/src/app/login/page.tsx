"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, Clock, Eye, EyeOff, Info, LayoutGrid, Loader2, Lock, Mail, ShieldCheck, Check } from "lucide-react";
import { HR_EMAIL } from "@/components/icons";
import { OrbitScene3D, type OrbitNodeDef } from "@/components/orbit/OrbitScene3D";
import { PreviewCards } from "@/components/login-scenes/PreviewCards";
import { useAuth } from "@/lib/auth";

// Sign-in page: a dark, immersive EHB story on the left (logo, 3D hub-and-orbit illustration, feature
// columns), a frosted-glass sign-in card on the right (stacked, card first, on phones).
// Uses the existing login (POST /auth/login) and shows the server's error messages unchanged.

/** The full-screen dark backdrop: a deep navy-to-blue gradient, soft light blobs, a warm glow top-right and
 * bottom-right, and flowing wave shapes along the bottom — CSS/SVG only, no new dependencies. */
function DarkHeroBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden bg-gradient-to-br from-[#0b1b4d] via-[#1e40af] to-[#3b82f6]">
      <div className="anim-drift will-change-transform absolute -left-32 top-1/4 h-[460px] w-[460px] rounded-full bg-sky-300/15 blur-3xl" />
      <div className="anim-drift-2 will-change-transform absolute left-1/4 -top-32 h-[380px] w-[380px] rounded-full bg-blue-300/15 blur-3xl" />
      <div className="absolute -right-24 -top-24 h-[420px] w-[420px] rounded-full bg-amber-400/25 blur-[100px]" />
      <div className="absolute -right-16 bottom-0 h-[360px] w-[360px] rounded-full bg-amber-400/20 blur-[100px]" />
      <div className="absolute inset-0 opacity-[.04] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(75%_70%_at_50%_35%,#000,transparent)]" />
      <svg aria-hidden="true" viewBox="0 0 1440 220" preserveAspectRatio="none" className="absolute bottom-0 left-0 h-[160px] w-full sm:h-[220px]">
        <path d="M0,120 C240,180 480,60 720,100 C960,140 1200,40 1440,90 L1440,220 L0,220 Z" fill="rgba(255,255,255,0.05)" />
        <path d="M0,160 C300,100 600,210 900,150 C1100,110 1300,190 1440,150 L1440,220 L0,220 Z" fill="rgba(255,255,255,0.07)" />
      </svg>
    </div>
  );
}

const FEATURES = [
  { icon: ShieldCheck, title: "Secure Access", hint: "Role-based, audited access" },
  { icon: LayoutGrid, title: "All HR Services", hint: "In one workspace" },
  { icon: Clock, title: "Always Available", hint: "Anytime, anywhere" },
] as const;

const ORBIT_NODES: OrbitNodeDef[] = [
  { icon: "calendar", label: "Attendance" },
  { icon: "users", label: "Leave" },
  { icon: "coins", label: "Pay slips" },
  { icon: "idCard", label: "Requests" },
  { icon: "folder", label: "Performance", accent: "sun" },
];

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
  const [success, setSuccess] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  // Set once sign-in succeeds, so the redirect effect below leaves the navigation to the success animation instead.
  const justSignedIn = useRef(false);

  // A failed attempt gives the card a short shake (restarted on every attempt; off with reduced motion).
  useEffect(() => {
    const el = form.current;
    if (!attempt || !el) return;
    el.classList.remove("anim-shake");
    void el.offsetWidth;
    el.classList.add("anim-shake");
  }, [attempt]);

  useEffect(() => {
    if (user && !justSignedIn.current) router.replace(user.mustChangePassword ? "/change-password" : "/dashboard");
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
      const me = await login(email.trim(), password);
      const dest = me.mustChangePassword ? "/change-password" : "/dashboard";
      // The success check and page fade are purely cosmetic and skipped under reduced motion, so this
      // never slows down the sign-in itself: the only difference is how soon the page navigates away.
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        router.replace(dest);
        return;
      }
      justSignedIn.current = true;
      setSuccess(true);
      window.setTimeout(() => router.replace(dest), 280);
    } catch (err) {
      setError((err as Error).message);
      setAttempt((n) => n + 1);
      setBusy(false);
    }
  };

  const field = (invalid: boolean) =>
    `peer block w-full rounded-xl border bg-white py-3 pl-11 text-[15px] text-ink-950 placeholder:text-slate-400 transition-[border-color,box-shadow] duration-200 focus:outline-none focus:ring-4 ${
      invalid ? "border-red-500 focus:border-red-500 focus:ring-red-500/15" : "border-slate-300 hover:border-slate-400 focus:border-primary focus:ring-primary/15"
    }`;
  const icon = "pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400 transition-colors duration-200 peer-focus:text-primary";

  return (
    // `bg-[#0b1b4d]` here is a real background-colour under DarkHeroBackdrop's gradient image: invisible
    // (the gradient fully covers it), but it gives automated contrast checks — which only see
    // `background-color`, not `background-image` — a real dark colour to find on this ancestor instead of
    // seeing through to the page's own light `body` background several levels up.
    <div className={`relative flex min-h-full flex-1 flex-col bg-[#0b1b4d] font-display transition-opacity duration-300 ${success ? "opacity-0" : "opacity-100"}`}>
      <DarkHeroBackdrop />

      {/* Everything below (top bar + the two-column story/form layout) shares one centered, max-1440px
          container with identical left/right padding, so the "Back to home" link gets the same right
          padding the logo gets on the left and the row can never overflow — the backdrop above stays
          full-bleed since it's a sibling, not a child, of this container. */}
      <div className="relative z-10 mx-auto flex w-full max-w-[1440px] flex-1 flex-col px-5 sm:px-10 lg:px-14">
        {/* Shared top bar: logo (always first, mobile and desktop) and a way back to the landing page. */}
        <div className="anim-fade-up flex items-center justify-between gap-4 py-6 lg:py-10">
          <Link href="/" aria-label="EHB HR Self-Service Portal home" className="shrink-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sun">
            {/* eslint-disable-next-line @next/next/no-img-element -- a local SVG, no chip/card */}
            <img src="/brand/ehb-hr-logo-white.svg" alt="EHB HR Self-Service Portal" className="h-auto w-40 sm:w-[220px]" />
          </Link>
          <Link href="/" className="group inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold text-blue-100/80 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-sun">
            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" aria-hidden="true" /> Back to home
          </Link>
        </div>

        {/* The two-column split waits for `xl` (1280px) rather than `lg` (1024px): between those two, an
            `lg`-triggered split would halve the column width before there's room for it, clipping the
            preview cards' fixed-size text — the single, full-width stacked column has plenty of room. */}
        <div className="grid flex-1 xl:grid-cols-2 xl:gap-10">
          {/* EHB story: the 3D hub-and-orbit illustration, then feature columns. First visually on desktop
              (left column); stacked below the sign-in card on phones/tablets. */}
          <section className="order-2 flex flex-col items-center justify-center gap-6 pb-10 lg:pb-14 xl:order-1">
            <div className="hidden min-[480px]:block w-full max-w-2xl">
              <OrbitScene3D
                nodes={ORBIT_NODES}
                hubTitle="EHB"
                hubSubtitle="HR WORKSPACE"
                dark
                className="h-[clamp(300px,31vw,480px)] w-full"
              />
            </div>
            <div className="hidden min-[480px]:block">
              <PreviewCards />
            </div>
            <div className="grid w-full max-w-2xl grid-cols-1 divide-y divide-white/15 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              {FEATURES.map(({ icon: Icon, title, hint }) => (
                <div key={title} className="flex flex-col items-center gap-1.5 px-4 py-4 text-center first:pt-0 sm:py-0">
                  <Icon className="h-5 w-5 text-sun" aria-hidden="true" />
                  <p className="text-sm font-bold text-white">{title}</p>
                  <p className="text-xs text-blue-100/75">{hint}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Sign-in card: a frosted-glass panel over the dark backdrop. First on phones/tablets. */}
          <section className="order-1 flex items-center justify-center pb-6 pt-2 lg:py-12 xl:order-2">
            <div className="anim-rise w-full max-w-[440px]">
            <form
              ref={form}
              onSubmit={submit}
              noValidate
              aria-describedby={error ? "login-error" : undefined}
              className="overflow-hidden rounded-[32px] bg-white/85 p-6 text-ink-950 shadow-[0_40px_90px_-30px_rgba(5,12,40,.55)] ring-1 ring-white/60 backdrop-blur-xl motion-safe:transition-[transform,box-shadow] motion-safe:duration-300 motion-safe:focus-within:-translate-y-1 motion-safe:focus-within:shadow-[0_50px_110px_-30px_rgba(5,12,40,.6)] sm:p-9"
            >
              <span className="block h-1.5 w-12 rounded-full bg-sun" aria-hidden="true" />
              <h2 className="mt-5 text-3xl font-extrabold tracking-tight">Welcome back</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-slate-600">Use your work email and password to access your HR workspace securely.</p>

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
                <button type="button" onClick={() => setForgot((v) => !v)} aria-expanded={forgot} aria-controls="forgot-help" className="rounded text-sm font-bold text-blue-800 underline decoration-blue-800/40 underline-offset-4 transition-colors hover:text-primary-hover hover:decoration-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
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
                  {showPassword ? <EyeOff key="off" className="anim-icon-fade h-5 w-5" aria-hidden="true" /> : <Eye key="on" className="anim-icon-fade h-5 w-5" aria-hidden="true" />}
                </button>
              </div>
              {fieldErrors.password && <p id="login-password-error" className="anim-fade-up mt-1.5 text-sm font-medium text-red-700">{fieldErrors.password}</p>}

              <div className={`grid transition-[grid-template-rows] duration-300 ${forgot ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                <div className="min-h-0 overflow-hidden">
                  <p id="forgot-help" className="mt-3 flex items-start gap-2 rounded-xl bg-slate-50 px-3.5 py-3 text-sm text-slate-700 ring-1 ring-slate-200" hidden={!forgot}>
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <span>Forgot your password? Ask HR to reset it: <a href={`mailto:${HR_EMAIL}`} className="font-semibold text-primary underline-offset-2 hover:underline">{HR_EMAIL}</a></span>
                  </p>
                </div>
              </div>

              <button
                type="submit" disabled={busy} aria-busy={busy}
                className="anim-sheen group relative mt-7 inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-primary bg-gradient-to-r from-primary to-blue-600 py-3.5 text-base font-bold text-white shadow-[0_18px_40px_-14px_rgba(37,99,235,.95)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_22px_46px_-14px_rgba(37,99,235,1)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-safe:active:scale-[0.98] disabled:translate-y-0 disabled:cursor-wait disabled:opacity-80"
              >
                {success ? <Check className="h-5 w-5" aria-hidden="true" /> : busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Lock className="h-5 w-5" aria-hidden="true" />}
                {success ? "Signed in" : busy ? "Signing in…" : "Sign in securely"}
              </button>

              <p className="mt-7 flex items-center gap-2 border-t border-slate-200 pt-5 text-sm text-slate-600">
                <ShieldCheck className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" /> Secured with HTTPS. Passwords are stored encrypted.
              </p>
            </form>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
