"use client";

import { useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Billboard, Line, PerspectiveCamera, RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { iconTexture } from "@/components/login3d/iconTexture";
import { textTexture } from "@/components/login3d/textTexture";
import { useLogoTexture } from "./logoTexture";

const BLUE = "#2563eb";
const SUN = "#f5b700";
const LINE_BLUE = "#93c5fd";
const RING_BLUE = "#bfdbfe";
const BORDER_GREY = "#e5e7eb";
const INK = "#0f172a";
const RING_SUN = "#ffd45c";

export type OrbitNodeDef = { icon: "calendar" | "users" | "coins" | "idCard" | "folder"; label: string; accent?: "blue" | "sun" };
type RuntimeNode = OrbitNodeDef & { baseAngle: number; radius: number; phase: number };

// Render-order bands so transparent objects never fight Three's camera-distance sort: background/rings
// paint first, then the hub, then connector lines, then cards always on top — exactly "lines behind cards".
const ORDER = { background: 0, rings: 1, lines: 2, dots: 2, hub: 3, cards: 4 };

/** A soft radial-gradient disc (light blue fading to transparent), generated once onto a small canvas and
 * cached — flat and unlit, so there is no lit/faceted geometry anywhere in the backdrop. */
let glowTex: THREE.CanvasTexture | null = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(219,234,254,0.95)");
  g.addColorStop(0.6, "rgba(219,234,254,0.5)");
  g.addColorStop(1, "rgba(219,234,254,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  glowTex = new THREE.CanvasTexture(canvas);
  return glowTex;
}

/** A round glowing "platform" disc for the dark theme: a blue core fading out through a soft yellow rim —
 * the pedestal the whole hub-and-orbit group appears to float above. Generated once and cached. */
let pedestalTex: THREE.CanvasTexture | null = null;
function pedestalTexture() {
  if (pedestalTex) return pedestalTex;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(96,165,250,0.5)");
  g.addColorStop(0.45, "rgba(37,99,235,0.28)");
  g.addColorStop(0.72, "rgba(245,183,0,0.22)");
  g.addColorStop(1, "rgba(245,183,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  pedestalTex = new THREE.CanvasTexture(canvas);
  return pedestalTex;
}

/** A small two-stop diagonal gradient (for the hub face and its top gloss highlight), generated once per
 * colour pair and cached. */
const gradCache = new Map<string, THREE.CanvasTexture>();
function gradientTexture(key: string, stops: [string, number][], diagonal = true) {
  const cached = gradCache.get(key);
  if (cached) return cached;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = diagonal ? ctx.createLinearGradient(0, 0, size, size) : ctx.createLinearGradient(0, 0, 0, size);
  for (const [color, offset] of stops) g.addColorStop(offset, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  gradCache.set(key, tex);
  return tex;
}

function OrbitRingLine({ radius, opacity, color = RING_BLUE, lineWidth = 1 }: { radius: number; opacity: number; color?: string; lineWidth?: number }) {
  const points = useMemo<[number, number, number][]>(() => {
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      pts.push([Math.cos(a) * radius, 0, Math.sin(a) * radius]);
    }
    return pts;
  }, [radius]);
  return <Line points={points} color={color} lineWidth={lineWidth} transparent opacity={opacity} toneMapped={false} depthWrite={false} renderOrder={ORDER.rings} />;
}

/** The single bright dot that travels around the dark theme's glowing orbit ring (independent of the
 * cards' own hub-to-card connectors), looping once roughly every 14s. */
function RingDot({ radius }: { radius: number }) {
  const dot = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const g = dot.current;
    if (!g) return;
    const a = clock.elapsedTime * ((2 * Math.PI) / 14);
    g.position.set(Math.cos(a) * radius, 0, Math.sin(a) * radius);
  });
  return (
    <group ref={dot} renderOrder={ORDER.dots}>
      <mesh>
        <sphereGeometry args={[0.03, 10, 10]} />
        <meshBasicMaterial color="#fff6d8" toneMapped={false} />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.065, 10, 10]} />
        <meshBasicMaterial color={RING_SUN} transparent opacity={0.35} toneMapped={false} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** A large, faint transparent sphere behind the whole hub-and-orbit group (dark theme only) — a glass-look
 * backdrop, plus a thin equatorial ring to hint at its edge, both unlit so neither facets under light. */
function GlassSphere({ radius }: { radius: number }) {
  const equator = useMemo<[number, number, number][]>(() => {
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      pts.push([Math.cos(a) * radius, Math.sin(a) * radius * 0.4, 0]);
    }
    return pts;
  }, [radius]);
  return (
    <group renderOrder={ORDER.background}>
      <mesh>
        <sphereGeometry args={[radius, 32, 32]} />
        <meshBasicMaterial color="#cfe0ff" transparent opacity={0.09} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <Line points={equator} color="#dbeafe" lineWidth={1.2} transparent opacity={0.3} toneMapped={false} depthWrite={false} />
    </group>
  );
}

/** Soft blurred ellipse "contact shadow" under the hub or a card — the same cheap grounding trick used
 * elsewhere in this app's 3D work, instead of a real shadow map. */
function SoftShadow({ y, scale, opacity = 0.18 }: { y: number; scale: number; opacity?: number }) {
  return (
    <mesh position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={ORDER.background}>
      <circleGeometry args={[scale, 24]} />
      <meshBasicMaterial color="#64748b" transparent opacity={opacity} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

/** The glowing round "platform" under the scene in the dark theme: a flat disc with a blue core fading to a
 * soft yellow rim, sitting below the hub like a pedestal. */
function Pedestal({ y, scale }: { y: number; scale: number }) {
  return (
    <mesh position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={ORDER.background}>
      <circleGeometry args={[scale, 48]} />
      <meshBasicMaterial map={pedestalTexture()} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

/** The central hub: a rounded square with an actual blue gradient face (#3b82f6 to #1e40af) and a soft top
 * gloss highlight, the real EHB logo on a small white plate (falling back to plain "EHB" text with zero
 * console errors if the image hasn't loaded or fails), the "HR WORKSPACE" subtitle always fully clear of
 * every card, a soft shadow underneath, a slow float and a gentle ±6° yaw sway (not a full spin). High
 * RoundedBox smoothness throughout so corners read as smooth, not faceted. */
function Hub({ title, subtitle, compact }: { title: string; subtitle?: string; compact?: boolean }) {
  const group = useRef<THREE.Group>(null);
  const size = compact ? 0.64 : 0.82;
  const logo = useLogoTexture("/ehb-logo.png");
  const faceTex = useMemo(() => gradientTexture("hub-face", [["#3b82f6", 0], ["#2563eb", 0.55], ["#1e40af", 1]]), []);
  const glossTex = useMemo(() => gradientTexture("hub-gloss", [["rgba(255,255,255,0.45)", 0], ["rgba(255,255,255,0)", 1]], false), []);
  const titleMap = useMemo(() => textTexture(title, "#ffffff", { widthPx: 240, heightPx: 96, fontPx: 58, weight: 800 }), [title]);
  const subMap = useMemo(() => (subtitle ? textTexture(subtitle, "#dbeafe", { widthPx: 240, heightPx: 64, fontPx: 24, weight: 700 }) : null), [subtitle]);

  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    g.position.y = Math.sin(clock.elapsedTime * 0.5) * 0.05;
    g.rotation.y = Math.sin(clock.elapsedTime * 0.3) * THREE.MathUtils.degToRad(6);
  });

  const plateW = size * 0.62;
  const plateH = logo ? plateW / logo.aspect : size * 0.32;

  return (
    <group ref={group}>
      <SoftShadow y={-size * 0.62} scale={size * 0.85} opacity={0.2} />
      <mesh position={[0, 0, -0.4]} renderOrder={ORDER.background}>
        <planeGeometry args={[size * 2.6, size * 2.6]} />
        <meshBasicMaterial map={glowTexture()} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      <RoundedBox args={[size, size, size * 0.22]} radius={size * 0.2} smoothness={8} renderOrder={ORDER.hub}>
        <meshBasicMaterial map={faceTex} toneMapped={false} />
      </RoundedBox>
      {/* Top gloss: a soft, unlit highlight near the upper edge — not a lit specular, so it never facets. */}
      <mesh position={[0, size * 0.22, size * 0.112]} renderOrder={ORDER.hub}>
        <planeGeometry args={[size * 0.9, size * 0.5]} />
        <meshBasicMaterial map={glossTex} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      {logo ? (
        <>
          <RoundedBox args={[plateW * 1.22, plateH * 1.7, size * 0.04]} radius={plateH * 0.28} smoothness={6} position={[0, size * 0.16, size * 0.12]} renderOrder={ORDER.hub}>
            <meshBasicMaterial color="#ffffff" toneMapped={false} />
          </RoundedBox>
          <mesh position={[0, size * 0.16, size * 0.15]} renderOrder={ORDER.hub}>
            <planeGeometry args={[plateW, plateH]} />
            <meshBasicMaterial map={logo.texture} transparent toneMapped={false} />
          </mesh>
        </>
      ) : (
        <mesh position={[0, subtitle ? size * 0.12 : 0, size * 0.12]} renderOrder={ORDER.hub}>
          <planeGeometry args={[size * 0.78, size * 0.312]} />
          <meshBasicMaterial map={titleMap} transparent toneMapped={false} />
        </mesh>
      )}
      {subMap && (
        <mesh position={[0, -size * 0.28, size * 0.12]} renderOrder={ORDER.hub}>
          <planeGeometry args={[size * 0.82, size * 0.2187]} />
          <meshBasicMaterial map={subMap} transparent toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}

/** A feature card (billboarded, always facing the camera): a thin 1px border (grey, or a yellow accent for
 * Performance), a small blue icon tile, a readable label, and a soft shadow — unlit materials throughout so
 * the face stays clean rather than "muddy" lit grey. In the dark theme the face becomes a frosted (semi-
 * transparent white) glass card with a white label, instead of the light theme's solid white card with a
 * dark label. Bobs gently in place (the shared orbit rotation, not this component, provides the actual
 * revolving motion). Hovering scales it up ~1.06. */
function NodeCard({ node, hovered, onHover, compact, dark }: { node: RuntimeNode; hovered: boolean; onHover: (v: boolean) => void; compact?: boolean; dark?: boolean }) {
  const pos = useRef<THREE.Group>(null);
  const hoverT = useRef(0);
  // Dark theme cards are scaled up well beyond the light theme's: at this size, with the matching
  // higher-resolution label texture below, "Attendance"-length labels render crisp and >=12px effective
  // size at 1440px viewport width — the ring radius and hub leave generous clearance for it (see
  // OrbitSceneContent's radius/hub comments), so cards still clear the hub and each other with margin.
  const size = (compact ? 0.62 : 0.74) * (dark ? 2 : 1);
  const iconMap = useMemo(() => iconTexture(node.icon, "#ffffff"), [node.icon]);
  const labelColor = dark ? "#ffffff" : INK;
  const labelMap = useMemo(
    () => textTexture(node.label, labelColor, dark ? { widthPx: 420, heightPx: 108, fontPx: 56, weight: 700 } : { widthPx: 256, heightPx: 72, fontPx: 34, weight: 600 }),
    [node.label, labelColor, dark],
  );
  const borderColor = node.accent === "sun" ? SUN : dark ? "#ffffff" : BORDER_GREY;
  const x = Math.cos(node.baseAngle) * node.radius;
  const z = Math.sin(node.baseAngle) * node.radius;

  useFrame(({ clock }) => {
    const g = pos.current;
    if (!g) return;
    const bob = Math.sin(clock.elapsedTime * 0.7 + node.phase) * 0.035;
    g.position.set(x, bob, z);
    hoverT.current = THREE.MathUtils.lerp(hoverT.current, hovered ? 1 : 0, 0.15);
    g.scale.setScalar(1 + hoverT.current * 0.06);
  });

  return (
    <group ref={pos} position={[x, 0, z]}>
      <SoftShadow y={-size * 0.5} scale={size * 0.62} opacity={dark ? 0.08 : 0.14} />
      <Billboard>
        {/* Thin 1px-equivalent border: only a sliver bigger than the face, not a thick glow outline. */}
        <RoundedBox
          args={[size * 1.015, size * 0.735, 0.018]}
          radius={size * 0.165}
          smoothness={6}
          position={[0, 0, -0.009]}
          renderOrder={ORDER.cards}
          onPointerOver={(e) => { e.stopPropagation(); onHover(true); }}
          onPointerOut={() => onHover(false)}
        >
          <meshBasicMaterial color={borderColor} transparent={dark && node.accent !== "sun"} opacity={dark && node.accent !== "sun" ? 0.4 : 1} toneMapped={false} />
        </RoundedBox>
        <RoundedBox args={[size, size * 0.72, 0.016]} radius={size * 0.16} smoothness={6} renderOrder={ORDER.cards}>
          <meshBasicMaterial color="#ffffff" transparent opacity={dark ? 0.22 : 0.92} toneMapped={false} depthWrite={!dark} />
        </RoundedBox>
        {/* Small blue icon tile */}
        <RoundedBox args={[size * 0.34, size * 0.34, 0.012]} radius={size * 0.09} smoothness={5} position={[0, size * 0.13, 0.012]} renderOrder={ORDER.cards}>
          <meshBasicMaterial color={BLUE} toneMapped={false} />
        </RoundedBox>
        <mesh position={[0, size * 0.13, 0.021]} renderOrder={ORDER.cards}>
          <planeGeometry args={[size * 0.2, size * 0.2]} />
          <meshBasicMaterial map={iconMap} transparent toneMapped={false} />
        </mesh>
        <mesh position={[0, -size * 0.19, 0.012]} renderOrder={ORDER.cards}>
          <planeGeometry args={[size * 0.86, size * 0.22]} />
          <meshBasicMaterial map={labelMap} transparent toneMapped={false} />
        </mesh>
      </Billboard>
    </group>
  );
}

/** A thin curved line (quadratic bezier, arcing slightly upward) from the hub to a card's base position,
 * drawn well behind the cards (render order). In the light theme, one small yellow dot loops slowly along
 * it from hub to card; in the dark theme the connectors stay as plain lines (the single travelling dot on
 * the glowing orbit ring takes over that job), each line's dot (when shown) on its own staggered phase. */
function Connector({ to, phase, dark, glowRing }: { to: [number, number, number]; phase: number; dark?: boolean; glowRing?: boolean }) {
  const dot = useRef<THREE.Mesh>(null);
  const curve = useMemo(() => {
    const mid = new THREE.Vector3(to[0] * 0.5, Math.max(0.12, Math.abs(to[1]) + 0.18), to[2] * 0.5);
    return new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0.02, 0), mid, new THREE.Vector3(...to));
  }, [to]);
  const points = useMemo(() => curve.getPoints(24), [curve]);

  useFrame(({ clock }) => {
    const d = dot.current;
    if (!d) return;
    const t = ((clock.elapsedTime * 0.18 + phase) % 1 + 1) % 1;
    curve.getPointAt(t, d.position);
  });

  return (
    <>
      <Line points={points} color={LINE_BLUE} lineWidth={1.4} transparent opacity={dark ? 0.4 : 0.55} toneMapped={false} depthWrite={false} renderOrder={ORDER.lines} />
      {!glowRing && (
        <mesh ref={dot} renderOrder={ORDER.dots}>
          <sphereGeometry args={[0.022, 8, 8]} />
          <meshBasicMaterial color={SUN} toneMapped={false} />
        </mesh>
      )}
    </>
  );
}

/** Eases the whole scene a little toward the pointer (up to ~8deg), back to centre once it leaves. */
function Parallax({ leftRef, children }: { leftRef: React.RefObject<boolean>; children: React.ReactNode }) {
  const group = useRef<THREE.Group>(null);
  const max = THREE.MathUtils.degToRad(8);
  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    const tx = leftRef.current ? 0 : state.pointer.y * max;
    const ty = leftRef.current ? 0 : state.pointer.x * max;
    g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, tx, 0.05);
    g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, ty, 0.05);
  });
  return <group ref={group}>{children}</group>;
}

/** The whole ring (orbit guide rings, cards and their connectors) turns together, slowly and continuously —
 * one full turn in about a minute — tilted so it reads as a 3D orbit rather than a flat carousel. The light
 * theme keeps its two faint blue guide rings with a dot per connector; the dark theme instead shows one
 * glowing yellow ring with a single bright travelling dot. */
function OrbitRing({
  tilt, radius, runtimeNodes, dark, glowRing, spinSeconds,
}: {
  tilt: number;
  radius: number;
  runtimeNodes: RuntimeNode[];
  dark?: boolean;
  glowRing?: boolean;
  spinSeconds: number;
}) {
  const spin = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (spin.current) spin.current.rotation.y += delta * ((2 * Math.PI) / spinSeconds);
  });
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  return (
    <group rotation={[tilt, 0, 0]}>
      {glowRing ? (
        <>
          <OrbitRingLine radius={radius * 0.98} opacity={0.16} color={RING_SUN} lineWidth={4} />
          <OrbitRingLine radius={radius * 0.98} opacity={0.9} color={RING_SUN} lineWidth={1.4} />
          <RingDot radius={radius * 0.98} />
        </>
      ) : (
        <>
          <OrbitRingLine radius={radius * 0.72} opacity={0.55} />
          <OrbitRingLine radius={radius * 0.96} opacity={0.4} />
        </>
      )}
      <group ref={spin}>
        {runtimeNodes.map((n, i) => {
          const to: [number, number, number] = [Math.cos(n.baseAngle) * n.radius, 0, Math.sin(n.baseAngle) * n.radius];
          return (
            <group key={n.label}>
              <Connector to={to} phase={i / runtimeNodes.length} dark={dark} glowRing={glowRing} />
              <NodeCard node={n} hovered={hoveredIdx === i} onHover={(v) => setHoveredIdx(v ? i : null)} dark={dark} />
            </group>
          );
        })}
      </group>
    </group>
  );
}

export type OrbitSceneContentProps = {
  nodes: OrbitNodeDef[];
  hubTitle: string;
  hubSubtitle?: string;
  compact?: boolean;
  dark?: boolean;
  /** The glowing single yellow ring + one travelling dot, instead of the two faint blue guide rings — on
   * its own (without `dark`) for a light-background header that still wants the brighter ring look.
   * Defaults to whatever `dark` is set to. */
  glowRing?: boolean;
  /** Seconds for one full revolution of the orbit ring. Defaults to 60. */
  spinSeconds?: number;
  active: boolean;
  onContextLost: () => void;
};

/**
 * The live scene: a glass-look hub, a tilted orbit ring (two thin guide rings plus five cards) turning
 * slowly as one, curved connector lines with a travelling dot running behind every card, and a soft radial
 * glow backdrop in place of any lit/faceted geometry. The dark theme (`dark`) adds a large translucent glass
 * sphere behind the group and a glowing pedestal beneath it, swaps the guide rings for one glowing yellow
 * ring with a single travelling dot, and turns the cards into frosted glass with white labels.
 */
export function OrbitSceneContent({ nodes, hubTitle, hubSubtitle, compact, dark, glowRing = dark, spinSeconds = 60, active, onContextLost }: OrbitSceneContentProps) {
  const pointerLeft = useRef(true);
  // Generous radius: comfortably clears the hub and keeps a wide gap between neighbouring cards (5 nodes,
  // 72° apart) at the card sizes NodeCard actually renders.
  const radius = compact ? 1.3 : 1.6;
  const runtimeNodes = useMemo<RuntimeNode[]>(
    () => nodes.map((n, i) => ({ ...n, baseAngle: (i / nodes.length) * Math.PI * 2 - Math.PI / 2, radius, phase: i * 1.3 })),
    [nodes, radius],
  );
  // The compact camera is the non-compact one scaled down by the same ratio as the (smaller) compact
  // radius, so the tilted ring's lowest point stays inside frame exactly as reliably as it already does at
  // full size — the previous fixed compact distance was never actually derived this way and clipped nodes.
  const camPos: [number, number, number] = compact ? [0, 2.9, 12.65] : [0, 3.6, 15.6];
  const tilt = THREE.MathUtils.degToRad(55);
  // Where the tilted ring's lowest point sits, in world Y — the pedestal floor goes just under it.
  const pedestalY = -radius * Math.sin(tilt) * 0.62 - (compact ? 0.55 : 0.68);

  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
      frameloop={active ? "always" : "never"}
      onCreated={({ gl }) => {
        // `preventDefault()` tells the browser the app will handle recovery, which is also what allows the
        // browser to actually restore the context afterwards (otherwise it stays lost for good). A brief
        // loss is routine when a page briefly has many contexts open at once (e.g. a dev-mode hot reload
        // layering an old canvas over the new one for an instant) and usually restores within moments —
        // Three.js resumes rendering on its own once that happens, no remount needed. Only give up and
        // switch to the static fallback if it does *not* restore within a short grace period.
        let giveUp: ReturnType<typeof setTimeout> | null = null;
        gl.domElement.addEventListener("webglcontextlost", (e) => {
          e.preventDefault();
          giveUp = setTimeout(onContextLost, 2000);
        });
        gl.domElement.addEventListener("webglcontextrestored", () => {
          if (giveUp) clearTimeout(giveUp);
          giveUp = null;
        });
      }}
      onPointerMove={() => { pointerLeft.current = false; }}
      onPointerLeave={() => { pointerLeft.current = true; }}
      style={{ touchAction: "pan-y" }}
    >
      <PerspectiveCamera makeDefault position={camPos} fov={24} onUpdate={(cam) => cam.lookAt(0, -0.05, 0)} />
      <ambientLight intensity={1} />
      <directionalLight position={[1.4, 2.4, 1.8]} intensity={0.3} color="#ffffff" />
      {dark && <Pedestal y={pedestalY} scale={radius * 1.25} />}
      <Parallax leftRef={pointerLeft}>
        {dark && <GlassSphere radius={radius * 1.35} />}
        <Hub title={hubTitle} subtitle={hubSubtitle} compact={compact} />
        <OrbitRing tilt={tilt} radius={radius} runtimeNodes={runtimeNodes} dark={dark} glowRing={glowRing} spinSeconds={spinSeconds} />
      </Parallax>
    </Canvas>
  );
}
