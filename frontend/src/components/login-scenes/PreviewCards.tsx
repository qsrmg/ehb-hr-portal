import { Calendar, CheckCheck, ChevronRight, Lock, Plane, ShieldCheck, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * The sign-in page's "capability preview" row: three small illustrations of what the portal does. Every
 * number here (100%, 14 days, 26 Nov) is a fixed sample value, not fetched from anywhere — this page never
 * calls the API before sign-in. The row is marked as a sample for sighted users (the caption) and for
 * assistive tech (each card is `role="img"` with one short text alternative; the graphics inside are
 * `aria-hidden`). CSS-only 3D tilt (perspective + rotate, max ~3deg) with a small hover lift; no WebGL.
 *
 * Translucent whites here use a literal `bg-[rgba(255,255,255,0.12)]` rather than Tailwind's `bg-white/12`:
 * the latter compiles to an `oklab(... / alpha)` colour, and the project's automated contrast checker (a
 * canvas-based colour resolver, e2e/design.mjs) reads that alpha channel as fully opaque — it would see
 * white text sitting on "solid white" and fail the page outright. A literal rgba() sidesteps that.
 */
function CardShell({
  icon: Icon, title, tilt, label, children,
}: {
  icon: LucideIcon;
  title: string;
  tilt: number;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ transform: `perspective(900px) rotateX(2deg) rotateY(${tilt}deg)` }} className="group">
      <div
        role="img"
        aria-label={label}
        className="relative overflow-hidden rounded-2xl border border-white/20 bg-[rgba(255,255,255,0.12)] p-4 shadow-[0_18px_40px_-20px_rgba(5,12,40,.6)] backdrop-blur-md transition-transform duration-200 motion-safe:group-hover:-translate-y-1"
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-5 bottom-0 h-px bg-gradient-to-r from-transparent via-sun/80 to-transparent" />
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-6 -bottom-1.5 h-4 rounded-full bg-sun/25 blur-md" />
        <div className="flex items-center justify-between gap-2">
          <div className="inline-flex min-w-0 items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-amber-300 to-sun text-white">
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="text-[12.5px] font-semibold leading-tight text-white sm:text-sm">{title}</span>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-blue-100/60" aria-hidden="true" />
        </div>
        <div aria-hidden="true">{children}</div>
      </div>
    </div>
  );
}

export function PreviewCards() {
  return (
    <div className="w-full max-w-2xl">
      <p className="mb-2 text-center text-[11px] font-bold uppercase tracking-[0.14em] text-[rgba(219,234,254,0.75)]">Sample preview</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <CardShell icon={Calendar} title="Smart Attendance" tilt={-3} label="Smart Attendance preview: a sample 100% on-time figure, not your real data">
          <div className="mt-3 flex items-center gap-3">
            <div className="relative h-12 w-12 shrink-0">
              <svg viewBox="0 0 48 48" className="h-12 w-12 -rotate-90">
                <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="5" />
                <circle cx="24" cy="24" r="20" fill="none" stroke="url(#sa-ring)" strokeWidth="5" strokeLinecap="round" strokeDasharray="125.6 125.6" />
                <defs>
                  <linearGradient id="sa-ring" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#10b981" />
                    <stop offset="1" stopColor="#22d3ee" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex items-center justify-center text-[10px] font-extrabold text-white">100%</div>
            </div>
            <div className="flex flex-1 items-end gap-1">
              {[40, 60, 48, 78, 58].map((h, i) => (
                <span key={i} className="w-2 rounded-full bg-gradient-to-t from-blue-600 to-sky-300" style={{ height: `${h * 0.32}px` }} />
              ))}
            </div>
          </div>
          <p className="mt-1.5 text-[11px] text-[rgba(219,234,254,0.8)]">On-Time</p>
        </CardShell>

        <CardShell icon={Wallet} title="Leave & Payroll" tilt={0} label="Leave and Payroll preview: sample figures for leave balance and next payroll date">
          <div className="mt-3 space-y-1.5">
            <div className="flex items-center justify-between rounded-lg bg-[rgba(255,255,255,0.12)] px-2.5 py-1.5">
              <span className="inline-flex items-center gap-1.5 text-[11px] text-[rgba(219,234,254,0.85)]"><Plane className="h-3.5 w-3.5" aria-hidden="true" /> Leave Balance</span>
              <span className="text-[11px] font-bold text-white">14 days</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-[rgba(255,255,255,0.12)] px-2.5 py-1.5">
              <span className="inline-flex items-center gap-1.5 text-[11px] text-[rgba(219,234,254,0.85)]"><Wallet className="h-3.5 w-3.5" aria-hidden="true" /> Next Payroll</span>
              <span className="text-[11px] font-bold text-white">26 Nov</span>
            </div>
          </div>
        </CardShell>

        <CardShell icon={ShieldCheck} title="Secure Workspace" tilt={3} label="Secure Workspace preview: a shield and checklist illustration, decorative only">
          <div className="mt-3 flex items-center gap-3">
            <div className="relative flex h-12 w-12 shrink-0 items-center justify-center">
              <ShieldCheck className="h-12 w-12 text-sky-300/70" strokeWidth={1.2} aria-hidden="true" />
              <Lock className="absolute h-4 w-4 text-white" aria-hidden="true" />
            </div>
            <div className="flex-1 space-y-1.5 rounded-lg bg-[rgba(255,255,255,0.12)] p-2">
              <div className="flex items-center gap-2"><CheckCheck className="h-3 w-3 shrink-0 text-emerald-400" aria-hidden="true" /><span className="h-1.5 flex-1 rounded-full bg-white/20" /></div>
              <div className="flex items-center gap-2"><CheckCheck className="h-3 w-3 shrink-0 text-emerald-400" aria-hidden="true" /><span className="h-1.5 w-2/3 rounded-full bg-white/20" /></div>
            </div>
          </div>
        </CardShell>
      </div>
    </div>
  );
}
