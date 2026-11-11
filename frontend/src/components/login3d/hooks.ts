"use client";

import { useSyncExternalStore } from "react";

/** Subscribes to a media query's "change" event; `useSyncExternalStore` keeps this hydration-safe
 * (the server and the client's first paint both use `false`, then it updates once mounted). */
function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Tracks the prefers-reduced-motion media query. */
export function useReducedMotion() {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}

/** Whether the viewport is at least `px` wide. Used to scale the 3D scene down on small screens. */
export function useMinWidth(px: number) {
  return useMediaQuery(`(min-width: ${px}px)`);
}

/** True once a WebGL2 (or WebGL) context can actually be created in this browser; null on the server. */
export function useWebglSupport() {
  return useSyncExternalStore(
    () => () => {}, // WebGL support does not change after the page loads; nothing to subscribe to.
    () => {
      try {
        const canvas = document.createElement("canvas");
        return !!(canvas.getContext("webgl2") || canvas.getContext("webgl") || canvas.getContext("experimental-webgl"));
      } catch {
        return false;
      }
    },
    () => null,
  );
}
