"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useMinWidth, useReducedMotion, useWebglSupport } from "@/components/login3d/hooks";
import { Canvas3DErrorBoundary } from "@/components/login3d/ErrorBoundary";
import { SceneA } from "@/components/login-scenes/SceneA";
import { OrbitFallbackDark } from "./OrbitFallbackDark";
import { useOnScreenAndVisible } from "./useOnScreen";
import type { OrbitNodeDef } from "./OrbitSceneContent";

const OrbitSceneContent = dynamic(() => import("./OrbitSceneContent").then((m) => m.OrbitSceneContent), { ssr: false, loading: () => null });

export type { OrbitNodeDef };

/**
 * A reusable "hub and orbit" 3D illustration: a glass hub with a title/subtitle, feature cards drifting
 * around it on dashed connector lines. Used today for the sign-in page's bottom-left card (full size); the
 * `compact` prop (smaller hub/cards/camera distance) and `nodes`/`hubTitle`/`hubSubtitle` props are there so
 * the dashboard header can reuse this later with its own labels — not wired up anywhere else yet.
 *
 * Falls back to a static illustration whenever WebGL is missing, the viewport is too narrow, prefers-
 * reduced-motion is set, or the scene errors — the sign-in page's calm light brand card (`SceneA`) by
 * default, or (`dark`) the matching dark/glass static layout (`OrbitFallbackDark`).
 */
export function OrbitScene3D({
  nodes, hubTitle, hubSubtitle, compact, dark, glowRing, spinSeconds, minimal, fallback: fallbackOverride, className = "",
}: {
  nodes: OrbitNodeDef[];
  hubTitle: string;
  hubSubtitle?: string;
  compact?: boolean;
  dark?: boolean;
  glowRing?: boolean;
  /** Seconds for one full revolution of the orbit ring. Defaults (via OrbitSceneContent) to 60. */
  spinSeconds?: number;
  /** Strips the node cards to bare icon + label and (once wired up) the hub to a bare logo — see
   * OrbitSceneContent. Only the dashboard header opts into this; every other caller is unaffected. */
  minimal?: boolean;
  /** Overrides the default fallback (SceneA, or OrbitFallbackDark when `dark`) — e.g. `null` for a small
   * decorative illustration that would rather just not appear than show a mismatched fallback card. */
  fallback?: React.ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const wideEnough = useMinWidth(820); // same threshold the sign-in page's other 3D variant (SceneC) already uses
  const webgl = useWebglSupport();
  const [contextLost, setContextLost] = useState(false);
  const { ref: wrapRef, active } = useOnScreenAndVisible<HTMLDivElement>();

  const showLive = wideEnough && webgl === true && !reduced && !contextLost;
  const defaultFallback = dark ? <OrbitFallbackDark nodes={nodes} hubTitle={hubTitle} hubSubtitle={hubSubtitle} className={className} /> : <SceneA className={className} />;
  const fallback = fallbackOverride !== undefined ? fallbackOverride : defaultFallback;

  if (!showLive) return fallback;
  return (
    // No card chrome here on purpose: no border, background panel or shadow, so the scene floats directly
    // on the page instead of looking boxed-in. The static fallback keeps its own look — it's a different,
    // simpler illustration, not a frozen version of this one.
    <div ref={wrapRef} aria-hidden="true" className={`relative ${className}`} style={{ minHeight: 320 }}>
      <Canvas3DErrorBoundary fallback={fallback}>
        <OrbitSceneContent nodes={nodes} hubTitle={hubTitle} hubSubtitle={hubSubtitle} compact={compact} dark={dark} glowRing={glowRing} spinSeconds={spinSeconds} minimal={minimal} active={active} onContextLost={() => setContextLost(true)} />
      </Canvas3DErrorBoundary>
    </div>
  );
}
