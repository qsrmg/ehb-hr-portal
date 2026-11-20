"use client";

import { useEffect, useState } from "react";
import * as THREE from "three";

type LogoEntry = { texture: THREE.CanvasTexture; aspect: number } | null;
const cache = new Map<string, LogoEntry>();
const listeners = new Map<string, Set<() => void>>();

/** Loads a same-origin image (the EHB logo in public/), downscales it onto a canvas at no more than 256px
 * on the longer side (preserving alpha and aspect ratio), and returns it as a cached Three.js texture. A
 * same-origin <img> load, not a remote font/asset fetch — the same "no console errors either way" rule
 * iconTexture.ts/textTexture.ts already follow: on any failure this just stays null forever, so callers can
 * fall back to the existing text-based rendering with zero console noise. */
export function useLogoTexture(src: string): LogoEntry {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (cache.has(src)) return;
    cache.set(src, null); // placeholder so a second mount doesn't start a second load
    const img = new Image();
    img.onload = () => {
      const maxSide = 256;
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, w, h);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      cache.set(src, { texture, aspect: img.naturalWidth / img.naturalHeight });
      for (const notify of listeners.get(src) ?? []) notify();
    };
    img.onerror = () => {
      cache.set(src, null);
    };
    img.src = src;
  }, [src]);

  useEffect(() => {
    const notify = () => setTick((t) => t + 1);
    if (!listeners.has(src)) listeners.set(src, new Set());
    listeners.get(src)!.add(notify);
    return () => { listeners.get(src)?.delete(notify); };
  }, [src]);

  return cache.get(src) ?? null;
}
