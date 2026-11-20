import { Calendar, Clock, Wallet } from "lucide-react";
import { Logo } from "@/components/brand";

const BENEFITS = [
  { icon: Calendar, label: "Leave", hint: "apply and track in a tap" },
  { icon: Clock, label: "Attendance", hint: "check-in times at a glance" },
  { icon: Wallet, label: "Payslips", hint: "download any month, any time" },
] as const;

/**
 * Variant A — "Calm light brand panel": a self-contained, CSS-only illustration. No WebGL, no 3D library,
 * nothing but the shared `anim-*` utilities (globals.css), which are already switched off under
 * prefers-reduced-motion. Used as the default sign-in scene, and as Variant C's automatic fallback.
 */
export function SceneA({ className = "" }: { className?: string }) {
  return (
    <div className={`relative ${className}`} aria-hidden="true">
      <div className="relative h-full overflow-hidden rounded-[28px] border border-slate-200 bg-gradient-to-br from-sky-50 via-white to-blue-50 shadow-[0_30px_70px_-40px_rgba(16,31,58,.35)]">
        <span className="anim-drift will-change-transform absolute -left-10 -top-12 h-40 w-40 rounded-full bg-primary/15 blur-2xl" />
        <span className="anim-drift-2 will-change-transform absolute -bottom-14 -right-8 h-36 w-36 rounded-full bg-sun/20 blur-2xl" />
        <span className="anim-float will-change-transform absolute right-9 top-9 h-2.5 w-2.5 rounded-full bg-primary/40" />
        <span className="anim-float will-change-transform absolute bottom-16 left-10 h-2 w-2 rounded-full bg-sun/60" style={{ animationDelay: "1.4s" }} />

        <div className="relative flex h-full flex-col justify-center gap-4 p-6 sm:gap-5 sm:p-8">
          <span className="inline-flex w-fit rounded-xl ring-1 ring-slate-200 shadow-sm">
            <Logo size="sm" />
          </span>
          <p className="max-w-[15rem] text-base font-extrabold leading-snug text-ink-950 sm:text-lg">
            Everything your workday needs, in one calm place.
          </p>
          <ul className="space-y-2">
            {BENEFITS.map(({ icon: Icon, label, hint }, i) => (
              <li key={label} className="anim-tick-pop flex items-center gap-3" style={{ "--i": i } as React.CSSProperties}>
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-primary ring-1 ring-slate-200 shadow-sm">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="text-sm leading-tight text-ink-950">
                  <span className="font-bold">{label}</span> <span className="text-slate-600">· {hint}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
