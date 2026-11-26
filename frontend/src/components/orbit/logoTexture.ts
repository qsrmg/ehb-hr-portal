"use client";

import { useEffect, useState } from "react";
import * as THREE from "three";

type LogoEntry = { texture: THREE.CanvasTexture; aspect: number } | null;
const cache = new Map<string, LogoEntry>();
const listeners = new Map<string, Set<() => void>>();

/** Loads a same-origin image (an EHB logo in public/ — a raster PNG or an SVG, either works since this is a
 * plain <img> load, not a parser specific to one format), downscales it onto a canvas at no more than
 * `maxSide` px on the longer side (preserving alpha and aspect ratio), and returns it as a cached Three.js
 * texture. A same-origin <img> load, not a remote font/asset fetch — the same "no console errors either way"
 * rule iconTexture.ts/textTexture.ts already follow: on any failure this just stays null forever, so callers
 * can fall back to the existing text-based rendering with zero console noise. `maxSide` is part of the cache
 * key (via `src`+`maxSide`) so the same logo can be cached at more than one resolution for different callers. */
export function useLogoTexture(src: string, maxSide = 256): LogoEntry {
  const key = `${src}:${maxSide}`;
  const [, setTick] = useState(0);
  useEffect(() => {
    if (cache.has(key)) return;
    cache.set(key, null); // placeholder so a second mount doesn't start a second load
    const img = new Image();
    img.onload = () => {
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
      cache.set(key, { texture, aspect: img.naturalWidth / img.naturalHeight });
      for (const notify of listeners.get(key) ?? []) notify();
    };
    img.onerror = () => {
      cache.set(key, null);
    };
    img.src = src;
  }, [src, maxSide, key]);

  useEffect(() => {
    const notify = () => setTick((t) => t + 1);
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key)!.add(notify);
    return () => { listeners.get(key)?.delete(notify); };
  }, [key]);

  return cache.get(key) ?? null;
}
