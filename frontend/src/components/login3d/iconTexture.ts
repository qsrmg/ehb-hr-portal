import * as THREE from "three";

type Shape = ["path", { d: string }] | ["rect", { width: string; height: string; x: string; y: string; rx?: string }] | ["circle", { cx: string; cy: string; r: string }];

// The same path/shape data lucide-react's Calendar, Users and Coins icons are built from (24x24 viewBox,
// 2px stroke), redrawn here onto a canvas instead of the DOM so the icon can be a plain WebGL texture —
// the 3D service cards then need no DOM portal at all (see ServiceCard3D.tsx for why that matters).
const ICONS: Record<"calendar" | "users" | "coins" | "idCard" | "folder", Shape[]> = {
  calendar: [
    ["path", { d: "M8 2v4" }],
    ["path", { d: "M16 2v4" }],
    ["rect", { width: "18", height: "18", x: "3", y: "4", rx: "2" }],
    ["path", { d: "M3 10h18" }],
  ],
  users: [
    ["path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" }],
    ["circle", { cx: "9", cy: "7", r: "4" }],
    ["path", { d: "M22 21v-2a4 4 0 0 0-3-3.87" }],
    ["path", { d: "M16 3.13a4 4 0 0 1 0 7.75" }],
  ],
  coins: [
    ["circle", { cx: "8", cy: "8", r: "6" }],
    ["path", { d: "M18.09 10.37A6 6 0 1 1 10.34 18" }],
    ["path", { d: "M7 6h1v4" }],
    ["path", { d: "m16.71 13.88.7.71-2.82 2.82" }],
  ],
  idCard: [
    ["path", { d: "M16 10h2" }],
    ["path", { d: "M16 14h2" }],
    ["path", { d: "M6.17 15a3 3 0 0 1 5.66 0" }],
    ["circle", { cx: "9", cy: "11", r: "2" }],
    ["rect", { x: "2", y: "5", width: "20", height: "14", rx: "2" }],
  ],
  folder: [
    ["path", { d: "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" }],
  ],
};

const cache = new Map<string, THREE.CanvasTexture>();

/** Draws one of the icons above onto a canvas and returns it as a (cached) Three.js texture. */
export function iconTexture(name: keyof typeof ICONS, color: string): THREE.CanvasTexture {
  const key = `${name}:${color}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const scale = size / 24;
  ctx.scale(scale, scale);
  ctx.translate(2, 2); // the 24x24 icons draw close to their edges; a little padding keeps strokes from clipping
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const [kind, attrs] of ICONS[name]) {
    ctx.beginPath();
    if (kind === "path") {
      ctx.stroke(new Path2D(attrs.d));
    } else if (kind === "rect") {
      const { width, height, x, y, rx } = attrs;
      const r = rx ? Number(rx) : 0;
      ctx.roundRect(Number(x), Number(y), Number(width), Number(height), r);
      ctx.stroke();
    } else {
      ctx.arc(Number(attrs.cx), Number(attrs.cy), Number(attrs.r), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  cache.set(key, texture);
  return texture;
}
