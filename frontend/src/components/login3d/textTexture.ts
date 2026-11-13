import * as THREE from "three";

const cache = new Map<string, THREE.CanvasTexture>();

/**
 * Renders a short label onto a canvas and returns it as a (cached) Three.js texture — the same no-network
 * approach as iconTexture.ts. Used instead of @react-three/drei's <Text>, which falls back to fetching a
 * font from a CDN when none is given: that hidden request is slow or unreachable in some environments and
 * was leaving the dashboard page's network never idle.
 */
export function textTexture(
  text: string,
  color = "#1b2430",
  { widthPx = 512, heightPx = 192, fontPx = 64, weight = 600 }: { widthPx?: number; heightPx?: number; fontPx?: number; weight?: number } = {},
): THREE.CanvasTexture {
  const key = `${text}:${color}:${widthPx}:${heightPx}:${fontPx}:${weight}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext("2d")!;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.font = `${weight} ${fontPx}px -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;

  // Word-wrap onto as many lines as needed, each kept within the canvas width.
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > widthPx * 0.92) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);

  const lineHeight = fontPx * 1.15;
  const startY = heightPx / 2 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((l, i) => ctx.fillText(l, widthPx / 2, startY + i * lineHeight));

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  cache.set(key, texture);
  return texture;
}
