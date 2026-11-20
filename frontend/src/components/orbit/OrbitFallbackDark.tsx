import { Calendar, Coins, Folder, IdCard, Users } from "lucide-react";
import type { OrbitNodeDef } from "./OrbitSceneContent";

const ICONS = { calendar: Calendar, users: Users, coins: Coins, idCard: IdCard, folder: Folder } as const;

// Five positions around a flattened ellipse (the tilted ring, seen from the front), centred on the hub,
// spaced the same way the live 3D scene lays its cards out (72° apart, starting at the top) — generous
// margins on every side so a card can never touch the hub or its neighbour.
const POS = [
  { left: "50%", top: "10%" },
  { left: "88%", top: "33%" },
  { left: "74%", top: "75%" },
  { left: "26%", top: "75%" },
  { left: "12%", top: "33%" },
];

/**
 * The sign-in page's dark-theme static fallback for the hub-and-orbit illustration: shown whenever WebGL
 * is unavailable, the viewport is too narrow for the live scene, prefers-reduced-motion is set, or the
 * live scene errors. Pure CSS/SVG, matching the live scene's dark look (glossy blue hub, glowing yellow
 * ring, frosted glass cards with white labels) without any of it actually moving.
 */
export function OrbitFallbackDark({ nodes, hubTitle, hubSubtitle, className = "" }: { nodes: OrbitNodeDef[]; hubTitle: string; hubSubtitle?: string; className?: string }) {
  return (
    <div aria-hidden="true" className={`relative ${className}`}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        <ellipse cx="50" cy="42.5" rx="40" ry="32.5" fill="none" stroke="#ffd45c" strokeOpacity="0.45" strokeWidth="1.1" />
        <circle cx="86" cy="18" r="1.6" fill="#fff6d8" />
        <circle cx="86" cy="18" r="3.2" fill="#ffd45c" opacity="0.35" />
      </svg>

      {/* Hub */}
      <div className="absolute left-1/2 top-[42.5%] flex h-[26%] w-[26%] min-h-[88px] min-w-[88px] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-[22%] bg-gradient-to-br from-[#60a5fa] via-[#2563eb] to-[#1e40af] text-center shadow-[0_18px_40px_-14px_rgba(37,99,235,.8)] ring-1 ring-white/25">
        <span className="text-[15px] font-extrabold tracking-wide text-white sm:text-lg">{hubTitle}</span>
        {hubSubtitle && <span className="mt-0.5 text-[7px] font-bold uppercase tracking-[0.12em] text-blue-100 sm:text-[8px]">{hubSubtitle}</span>}
      </div>

      {/* Cards */}
      {nodes.slice(0, POS.length).map((node, i) => {
        const Icon = ICONS[node.icon];
        const accent = node.accent === "sun";
        return (
          <div
            key={node.label}
            className="absolute flex h-[21%] w-[27%] min-h-[64px] min-w-[72px] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-1 rounded-2xl border bg-white/[0.14] text-center shadow-[0_12px_30px_-16px_rgba(8,15,40,.6)] backdrop-blur-sm"
            style={{ left: POS[i].left, top: POS[i].top, borderColor: accent ? "#f5b700" : "rgba(255,255,255,0.35)" }}
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary">
              <Icon className="h-3.5 w-3.5 text-white" aria-hidden="true" />
            </span>
            <span className="text-[11px] font-semibold leading-none text-white sm:text-[12px]">{node.label}</span>
          </div>
        );
      })}
    </div>
  );
}
