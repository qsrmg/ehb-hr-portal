"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { SceneA } from "./SceneA";
import { SceneB } from "./SceneB";
import { SceneC } from "./SceneC";

/** Reads `?scene=a|b|c` on /login to pick the sign-in illustration; `a` is the default, including for a
 * missing or unrecognised value. Wrapped in Suspense because `useSearchParams` requires it even here, in a
 * client component that already opts out of static rendering. */
function ScenePicker({ className }: { className?: string }) {
  const scene = useSearchParams().get("scene");
  if (scene === "b") return <SceneB className={className} />;
  if (scene === "c") return <SceneC className={className} />;
  return <SceneA className={className} />;
}

export function LoginScene({ className = "" }: { className?: string }) {
  return (
    <Suspense fallback={<SceneA className={className} />}>
      <ScenePicker className={className} />
    </Suspense>
  );
}
