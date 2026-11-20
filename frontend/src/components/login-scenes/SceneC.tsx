"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useMinWidth, useReducedMotion, useWebglSupport } from "@/components/login3d/hooks";
import { Canvas3DErrorBoundary } from "@/components/login3d/ErrorBoundary";
import { SceneA } from "./SceneA";

const NodeNetworkScene = dynamic(() => import("./NodeNetworkScene").then((m) => m.NodeNetworkScene), { ssr: false, loading: () => null });

/**
 * Variant C — "Light 3D, much simpler": one calm react-three-fiber scene. Falls back to Variant A
 * entirely — not just a frozen canvas — whenever WebGL is missing, the viewport is narrow, or
 * prefers-reduced-motion is set, reusing the same capability hooks the original sign-in 3D scene relies on.
 */
export function SceneC({ className = "" }: { className?: string }) {
  const reduced = useReducedMotion();
  const wideEnough = useMinWidth(820); // tablet and up; phones get Variant A
  const webgl = useWebglSupport();
  const [contextLost, setContextLost] = useState(false);

  const showLive = wideEnough && webgl === true && reduced === false && !contextLost;

  if (!showLive) return <SceneA className={className} />;
  return (
    <div className={`relative ${className}`} aria-hidden="true">
      <Canvas3DErrorBoundary fallback={<SceneA className="h-full" />}>
        <div
          className="h-full w-full overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_30px_70px_-40px_rgba(16,31,58,.35)]"
          style={{ minHeight: 320 }}
        >
          <NodeNetworkScene onContextLost={() => setContextLost(true)} />
        </div>
      </Canvas3DErrorBoundary>
    </div>
  );
}
