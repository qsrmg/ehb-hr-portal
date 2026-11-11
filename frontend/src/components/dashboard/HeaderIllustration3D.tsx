"use client";

import dynamic from "next/dynamic";
import { useMinWidth, useReducedMotion, useWebglSupport } from "@/components/login3d/hooks";
import { Canvas3DErrorBoundary } from "@/components/login3d/ErrorBoundary";

const HeaderScene3D = dynamic(() => import("./HeaderScene3D").then((m) => m.HeaderScene3D), { ssr: false, loading: () => null });

/**
 * A small, purely decorative HR illustration for the header's spare corner on wide screens: never shown on
 * narrower layouts (nothing to free up there would be worth the WebGL cost), and simply renders nothing if
 * WebGL is unavailable or still loading — unlike the sign-in page's hero, a dashboard header has no room for
 * a static replacement, and losing this corner costs nothing functionally ("must never block content").
 */
export function HeaderIllustration3D() {
  const reduced = useReducedMotion();
  const wideEnough = useMinWidth(1280);
  const webgl = useWebglSupport();

  if (!wideEnough || webgl !== true) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none hidden shrink-0 xl:block" style={{ width: 160, height: 140 }}>
      <Canvas3DErrorBoundary fallback={null}>
        <HeaderScene3D reduced={reduced} />
      </Canvas3DErrorBoundary>
    </div>
  );
}
