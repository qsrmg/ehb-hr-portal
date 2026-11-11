"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useMinWidth, useReducedMotion, useWebglSupport } from "./hooks";
import { StaticFallback } from "./StaticFallback";
import { Canvas3DErrorBoundary } from "./ErrorBoundary";

const Canvas3D = dynamic(() => import("./Canvas3D").then((m) => m.Canvas3D), { ssr: false, loading: () => null });

/**
 * The sign-in page's "HR analytics" illustration: a real, interactive 3D scene (donut + bar + growth charts,
 * floating service cards, a circular platform) on capable desktop/tablet browsers, and a lightweight static
 * illustration everywhere else (phones, prefers-reduced-motion, no WebGL, or while the 3D bundle loads). The
 * static version is never just a placeholder: it shows the same demo data, so the page is informative either way.
 */
export function LoginAnalyticsScene({ className = "" }: { className?: string }) {
  const reduced = useReducedMotion();
  const wideEnough = useMinWidth(820); // tablet and up; phones get the static illustration
  const webgl = useWebglSupport();
  const [contextLost, setContextLost] = useState(false);

  const showLive = wideEnough && webgl === true && !contextLost;

  return (
    // Decorative, demo-data illustration (matches the dashboard preview it replaces): not announced to screen readers.
    <div className={`relative ${className}`} aria-hidden="true">
      {showLive ? (
        <Canvas3DErrorBoundary fallback={<StaticFallback className="h-full" />}>
          <div className="h-full w-full" style={{ minHeight: 320 }}>
            <Canvas3D reduced={reduced} onContextLost={() => setContextLost(true)} />
          </div>
        </Canvas3DErrorBoundary>
      ) : (
        <StaticFallback />
      )}
    </div>
  );
}
