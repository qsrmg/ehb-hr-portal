import { Bell, CalendarDays, Check, Clock, FileText, LogIn } from "lucide-react";
import { CountUp, Reveal } from "./motion";

/**
 * Hero background: slowly drifting blue light, a faint grid, a few connecting lines with yellow nodes.
 * Purely decorative and hidden from assistive technology.
 */
export function HeroBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="anim-drift absolute -inset-[15%] bg-[radial-gradient(38%_42%_at_72%_32%,rgba(37,99,235,.34),transparent_70%),radial-gradient(30%_35%_at_18%_80%,rgba(37,99,235,.16),transparent_70%)]" />
      <div className="absolute inset-0 opacity-[.07] [background-image:linear-gradient(#9fb0cc_1px,transparent_1px),linear-gradient(90deg,#9fb0cc_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(75%_70%_at_50%_40%,#000,transparent)]" />
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1440 820" preserveAspectRatio="xMidYMid slice" fill="none">
        <g stroke="#9fb0cc" strokeOpacity=".22" strokeWidth="1" className="anim-dash">
          <path d="M-20 240 L310 150 L520 300 L760 210" />
          <path d="M1460 120 L1180 250 L1300 470 L1040 610" />
          <path d="M140 760 L420 560 L640 690" />
        </g>
        {[[310, 150], [520, 300], [1180, 250], [1300, 470], [420, 560]].map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r="3" fill="#f5b700" className="anim-glint" style={{ "--i": i, transformOrigin: `${cx}px ${cy}px` } as React.CSSProperties} />
        ))}
      </svg>
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-ink-950" />
    </div>
  );
}

const tile = "anim-pop rounded-xl bg-white p-3.5 shadow-[0_1px_2px_rgba(16,31,58,.06),0_6px_16px_-10px_rgba(16,31,58,.25)] ring-1 ring-slate-900/5";

/**
 * Static picture of the dashboard with sample data, clearly marked as a demo preview. It rises in on load,
 * floats gently, its tiles appear one after another and its numbers and bars animate.
 */
export function DashboardPreview() {
  return (
    <div className="anim-rise relative mx-auto w-full max-w-[460px] lg:mx-0 lg:ml-auto" role="img" aria-label="Demo preview of the employee dashboard, with sample data only">
      <div className="anim-float" aria-hidden="true">
        {/* Floating notifications */}
        <div className="anim-pop absolute -top-16 right-6 z-20 hidden items-center gap-2.5 rounded-xl border border-white/10 bg-ink-900/90 px-3 py-2.5 shadow-[0_18px_40px_-12px_rgba(0,0,0,.7)] backdrop-blur-md sm:flex xl:-right-6" style={{ "--i": 9 } as React.CSSProperties}>
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-sun text-ink-950"><FileText className="h-4 w-4" /></span>
          <span className="leading-tight"><span className="block text-xs font-bold text-white">Pay slip ready</span><span className="text-[10px] text-haze">Sample notification</span></span>
        </div>
        <div className="anim-pop absolute -bottom-6 -left-3 z-20 hidden items-center gap-2.5 rounded-xl border border-white/10 bg-ink-900/90 px-3 py-2.5 shadow-[0_18px_40px_-12px_rgba(0,0,0,.7)] backdrop-blur-md sm:flex xl:-left-12" style={{ "--i": 10 } as React.CSSProperties}>
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white"><Check className="h-4 w-4" /></span>
          <span className="leading-tight"><span className="block text-xs font-bold text-white">Leave approved</span><span className="text-[10px] text-haze">Sample notification</span></span>
        </div>

        {/* Window */}
        <div className="relative rounded-[22px] bg-gradient-to-b from-white/25 to-white/5 p-px shadow-[0_40px_100px_-30px_rgba(0,0,0,.85)]">
          <div className="rounded-[21px] bg-mist p-4 text-ink-950">
            <div className="mb-3.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex gap-1"><i className="h-2 w-2 rounded-full bg-slate-300" /><i className="h-2 w-2 rounded-full bg-slate-300" /><i className="h-2 w-2 rounded-full bg-slate-300" /></span>
                <span className="ml-1 text-sm font-bold">EHB HR Portal</span>
              </div>
              <span className="rounded-full bg-sun px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-ink-950">Demo Preview</span>
            </div>

            <Reveal className="grid grid-cols-2 gap-2.5 text-[11px]">
              <div className={`${tile} col-span-2 flex items-center justify-between gap-3 bg-gradient-to-r from-ink-900 to-[#1d4fd8] text-white ring-0`} style={{ "--i": 0 } as React.CSSProperties}>
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold">Welcome back, Sara</div>
                  <div className="text-[10px] text-white/70">Sample employee · Wednesday, 4 November</div>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-white px-2 py-1 text-[10px] font-bold text-ink-950"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Checked in</span>
              </div>

              <div className={tile} style={{ "--i": 1 } as React.CSSProperties}>
                <div className="flex items-center gap-1.5 text-[10px] text-slate-500"><Clock className="h-3 w-3" /> Today&apos;s attendance</div>
                <div className="mt-1.5 text-base font-extrabold">On Time</div>
                <span className="mt-1 inline-block rounded-full bg-blue-100 px-2 py-0.5 text-[9px] font-bold text-blue-800">Before 9:25 AM</span>
              </div>
              <div className={tile} style={{ "--i": 2 } as React.CSSProperties}>
                <div className="flex items-center gap-1.5 text-[10px] text-slate-500"><LogIn className="h-3 w-3" /> Clock in and out</div>
                <div className="mt-2 flex justify-between"><span className="text-slate-500">In</span><span className="font-bold tabular-nums">09:12 AM</span></div>
                <div className="mt-1 flex justify-between"><span className="text-slate-500">Out</span><span className="font-bold">—</span></div>
              </div>

              <div className={`${tile} col-span-2`} style={{ "--i": 3 } as React.CSSProperties}>
                <div className="flex items-center justify-between text-[10px] text-slate-500"><span>Monthly attendance</span><span>November</span></div>
                <div className="mt-2 grid grid-cols-4 text-center">
                  {([[18, "On Time"], [2, "Late"], [1, "Half Day"], [0, "Absent"]] as const).map(([n, l]) => (
                    <div key={l}><CountUp value={n} className="block text-lg font-extrabold tabular-nums" /><div className="text-[9px] text-slate-500">{l}</div></div>
                  ))}
                </div>
                <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="grow-x h-full w-[86%] rounded-full bg-gradient-to-r from-primary to-[#60a5fa]" style={{ "--d": 200 } as React.CSSProperties} /></div>
              </div>

              <div className={tile} style={{ "--i": 4 } as React.CSSProperties}>
                <div className="flex items-center gap-1.5 text-[10px] text-slate-500"><CalendarDays className="h-3 w-3" /> Leave balance</div>
                <div className="mt-2 flex justify-between"><span>Annual</span><span className="font-bold"><CountUp value={12} /> days</span></div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-200"><div className="grow-x h-full w-[72%] rounded-full bg-primary" style={{ "--d": 400 } as React.CSSProperties} /></div>
                <div className="mt-2 flex justify-between"><span>Sick</span><span className="font-bold"><CountUp value={6} /> days</span></div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-200"><div className="grow-x h-full w-[55%] rounded-full bg-sun" style={{ "--d": 550 } as React.CSSProperties} /></div>
              </div>
              <div className={tile} style={{ "--i": 5 } as React.CSSProperties}>
                <div className="flex items-center gap-1.5 text-[10px] text-slate-500"><Bell className="h-3 w-3" /> Pending approvals</div>
                <div className="mt-1.5 text-base font-extrabold"><CountUp value={1} /> task</div>
                <span className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-bold text-amber-800">Leave request</span>
              </div>

              <div className={tile} style={{ "--i": 6 } as React.CSSProperties}>
                <div className="text-[10px] text-slate-500">Recent requests</div>
                <div className="mt-2 flex items-center justify-between gap-1"><span className="truncate">Leave · 2 days</span><span className="rounded-full bg-amber-100 px-1.5 text-[9px] font-bold text-amber-800">Pending</span></div>
                <div className="mt-1.5 flex items-center justify-between gap-1"><span className="truncate">Attendance Update</span><span className="rounded-full bg-blue-100 px-1.5 text-[9px] font-bold text-blue-800">Approved</span></div>
              </div>
              <div className={tile} style={{ "--i": 7 } as React.CSSProperties}>
                <div className="text-[10px] text-slate-500">Upcoming company events</div>
                <div className="mt-2 font-semibold">Monthly all-hands</div>
                <div className="text-[9px] text-slate-500">Fri 6 Nov · sample</div>
                <div className="mt-1.5 font-semibold">Team lunch</div>
                <div className="text-[9px] text-slate-500">Thu 12 Nov · sample</div>
              </div>
            </Reveal>
          </div>
        </div>
      </div>
    </div>
  );
}
