"use client";

import { OrbitScene3D, type OrbitNodeDef } from "@/components/orbit/OrbitScene3D";

const NODES: OrbitNodeDef[] = [
  { icon: "calendar", label: "Attendance" },
  { icon: "users", label: "Leave" },
  { icon: "coins", label: "Pay Slips" },
  { icon: "idCard", label: "Requests" },
  { icon: "folder", label: "Performance", accent: "sun" },
];

/**
 * The dashboard header's hero illustration: the same "hub and orbit" scene as the sign-in page
 * (components/orbit/OrbitScene3D), compact and light-themed to sit on the header's white-to-pale-blue
 * card. Gating (WebGL/viewport/reduced-motion/on-screen) and the static fallback are entirely
 * OrbitScene3D's own. Below `xl` it sits in normal flow, smaller, below the quick-action buttons (live or
 * static, whichever OrbitScene3D's own width gate already picks); at `xl` and up it becomes an absolute
 * overlay filling the header's full height on the right, fading in from the left edge.
 */
export function HeaderOrbit3D() {
  return (
    <div
      aria-hidden="true"
      className="relative mt-1 h-[160px] w-full xl:pointer-events-none xl:absolute xl:inset-y-0 xl:right-0 xl:mt-0 xl:h-auto xl:w-1/2 xl:overflow-hidden xl:[-webkit-mask-image:linear-gradient(to_right,transparent_0%,black_16%)] xl:[mask-image:linear-gradient(to_right,transparent_0%,black_16%)]"
    >
      <OrbitScene3D
        nodes={NODES}
        hubTitle="EHB"
        hubSubtitle="HR WORKSPACE"
        compact
        glowRing
        className="h-full w-full xl:absolute xl:inset-0"
      />
    </div>
  );
}
