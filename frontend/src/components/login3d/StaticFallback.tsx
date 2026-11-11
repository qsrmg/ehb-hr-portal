import { Calendar, Coins, Users } from "lucide-react";

const BLUE = "#3186FF";
const GOLD = "#FBBC05";

/**
 * A lightweight, static (no WebGL, no JavaScript animation loop) illustration of the analytics dashboard,
 * for phones, reduced motion, browsers without WebGL, and the moment before the 3D scene has loaded.
 * Built from CSS and inline SVG only, so it never costs more than the 3D scene it stands in for.
 */
export function StaticFallback({ className = "" }: { className?: string }) {
  return (
    <div className={`relative ${className}`} role="img" aria-label="Demo HR analytics: attendance, leave and pay slip, illustrated">
      <div className="rounded-[28px] border border-slate-200 bg-white/80 p-5 shadow-[0_30px_70px_-40px_rgba(16,31,58,.35)] backdrop-blur-sm">
        <div className="flex items-center gap-5">
          {/* Donut: Present 78% / Leave 12% / Absent 10%, drawn with a conic-gradient. */}
          <div
            className="relative h-28 w-28 shrink-0 rounded-full"
            style={{ background: `conic-gradient(${BLUE} 0% 78%, ${GOLD} 78% 90%, #cbd5e1 90% 100%)` }}
          >
            <div className="absolute inset-[10px] flex flex-col items-center justify-center rounded-full bg-white text-center">
              <span className="text-lg font-extrabold text-ink-950">78%</span>
              <span className="text-[10px] font-semibold text-slate-500">Present</span>
            </div>
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-end gap-1.5" aria-hidden="true">
              {[40, 65, 50, 80, 60].map((h, i) => (
                <span key={i} className="w-3 rounded-t-sm" style={{ height: `${h * 0.4}px`, background: BLUE, opacity: 0.25 + i * 0.12 }} />
              ))}
            </div>
            <div className="flex gap-3 text-xs">
              <span className="inline-flex items-center gap-1.5 font-semibold text-slate-600"><span className="h-2 w-2 rounded-full" style={{ background: BLUE }} /> Present 78%</span>
              <span className="inline-flex items-center gap-1.5 font-semibold text-slate-600"><span className="h-2 w-2 rounded-full" style={{ background: GOLD }} /> Leave 12%</span>
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2.5">
          {[
            { icon: Calendar, label: "Attendance", tone: BLUE },
            { icon: Users, label: "Leave", tone: BLUE },
            { icon: Coins, label: "Pay slip", tone: GOLD },
          ].map(({ icon: Icon, label, tone }) => (
            <div key={label} className="flex flex-col items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-2 py-3 text-center shadow-sm">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full" style={{ backgroundColor: `${tone}1a` }}>
                <Icon className="h-4 w-4" style={{ color: tone }} aria-hidden="true" />
              </span>
              <span className="text-[11px] font-semibold text-slate-600">{label}</span>
            </div>
          ))}
        </div>
      </div>
      <span className="sr-only">Demo data: Present 78%, Leave 12%, Absent 10%. Attendance, Leave Management and Pay Slip.</span>
    </div>
  );
}
