"use client";

import { useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { textTexture } from "./textTexture";

export type DonutSlice = { label: string; value: number; color: string };

const INNER = 0.62;
const OUTER = 1;
const DEPTH = 0.32;
const GAP = 0.025; // radians between slices

/** A flat-top, extruded ring segment: the building block of the 3D donut chart. */
function sliceGeometry(startAngle: number, endAngle: number) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, OUTER, startAngle, endAngle, false);
  shape.lineTo(INNER * Math.cos(endAngle), INNER * Math.sin(endAngle));
  shape.absarc(0, 0, INNER, endAngle, startAngle, true);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: DEPTH, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2, curveSegments: 24 });
  geo.center();
  return geo;
}

function Slice({ startAngle, endAngle, color, reduced, delay }: { startAngle: number; endAngle: number; color: string; reduced: boolean; delay: number }) {
  const [hovered, setHovered] = useState(false);
  const [progress, setProgress] = useState(reduced ? 1 : 0);
  const mesh = useRef<THREE.Mesh>(null);
  const start = useRef<number | null>(null);

  // Grows from 0 to its full sweep on mount (entrance), then settles; also eases the hover lift.
  useFrame((state) => {
    if (progress < 1) {
      if (start.current === null) start.current = state.clock.elapsedTime;
      const t = Math.max(0, Math.min(1, (state.clock.elapsedTime - start.current - delay) / 0.8));
      const eased = 1 - (1 - t) ** 3;
      if (t > 0 || eased > 0) setProgress(eased);
    }
    if (mesh.current) {
      const targetOffset = hovered ? 0.1 : 0;
      mesh.current.position.z = THREE.MathUtils.lerp(mesh.current.position.z, targetOffset, reduced ? 1 : 0.15);
      const targetScale = hovered ? 1.05 : 1;
      mesh.current.scale.x = THREE.MathUtils.lerp(mesh.current.scale.x, targetScale, reduced ? 1 : 0.2);
      mesh.current.scale.y = mesh.current.scale.x;
    }
  });

  const sweep = (endAngle - startAngle) * Math.max(0.0001, progress);
  const geometry = useMemo(() => sliceGeometry(startAngle, startAngle + sweep), [startAngle, sweep]);
  const mid = startAngle + (endAngle - startAngle) / 2;
  const pct = Math.round(((endAngle - startAngle) / (2 * Math.PI)) * 100);
  const pctTexture = useMemo(() => textTexture(`${pct}%`, "#1b2430", { widthPx: 256, heightPx: 256, fontPx: 96 }), [pct]);

  return (
    <mesh
      ref={mesh}
      geometry={geometry}
      castShadow
      receiveShadow
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
      onPointerOut={() => setHovered(false)}
    >
      {/* A glossy, mostly-opaque "polished enamel" finish reads cleaner than real glass transmission
          here: without an environment map to refract, high transmission just looked murky/brownish. */}
      <meshPhysicalMaterial
        color={color}
        transmission={0.06}
        thickness={0.4}
        roughness={0.12}
        metalness={0.08}
        clearcoat={1}
        clearcoatRoughness={0.08}
        emissive={color}
        emissiveIntensity={hovered ? 0.4 : 0.14}
      />
      {progress > 0.92 && (
        <group position={[Math.cos(mid) * (OUTER + 0.3), Math.sin(mid) * (OUTER + 0.3), DEPTH / 2 + 0.02]}>
          <mesh>
            <circleGeometry args={[0.15, 24]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.92} toneMapped={false} />
          </mesh>
          <mesh position={[0, 0, 0.01]}>
            <planeGeometry args={[0.28, 0.28]} />
            <meshBasicMaterial map={pctTexture} transparent toneMapped={false} />
          </mesh>
        </group>
      )}
    </mesh>
  );
}

/** Present / Leave / Absent, as a glass-look 3D donut. Demo data only. */
export function DonutChart({ reduced = false }: { reduced?: boolean }) {
  const data: DonutSlice[] = [
    { label: "Present", value: 78, color: "#3186FF" },
    { label: "Leave", value: 12, color: "#FBBC05" },
    { label: "Absent", value: 10, color: "#cbd5e1" },
  ];
  const total = data.reduce((s, d) => s + d.value, 0);
  let angle = -Math.PI / 2;
  const slices = data.map((d, i) => {
    const sweep = (d.value / total) * Math.PI * 2;
    const s = { ...d, start: angle + GAP / 2, end: angle + sweep - GAP / 2, delay: i * 0.18 };
    angle += sweep;
    return s;
  });

  return (
    <group rotation={[-0.5, 0, 0]}>
      {slices.map((s) => (
        <Slice key={s.label} startAngle={s.start} endAngle={s.end} color={s.color} reduced={reduced} delay={s.delay} />
      ))}
    </group>
  );
}
