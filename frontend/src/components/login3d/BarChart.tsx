"use client";

import { useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";

const VALUES = [0.32, 0.52, 0.4, 0.68, 0.48];
const BAR_WIDTH = 0.11;
const GAP = 0.06;
const BLUE = "#3186FF";

function Bar({ index, height, reduced }: { index: number; height: number; reduced: boolean }) {
  const group = useRef<THREE.Group>(null);
  const [h, setH] = useState(reduced ? height : 0.001);
  const start = useRef<number | null>(null);

  useFrame((state) => {
    if (h >= height) return;
    if (start.current === null) start.current = state.clock.elapsedTime;
    const t = Math.max(0, Math.min(1, (state.clock.elapsedTime - start.current - index * 0.1) / 0.7));
    const eased = 1 - (1 - t) ** 3;
    setH(Math.max(0.001, height * eased));
    if (group.current) group.current.position.y = (height * eased) / 2;
  });

  return (
    <group ref={group} position={[index * (BAR_WIDTH + GAP), h / 2, 0]}>
      <RoundedBox args={[BAR_WIDTH, h, BAR_WIDTH]} radius={Math.min(0.035, h / 2)} smoothness={3} castShadow>
        <meshPhysicalMaterial color={BLUE} roughness={0.15} metalness={0.1} transmission={0.05} clearcoat={0.9} clearcoatRoughness={0.1} emissive={BLUE} emissiveIntensity={0.16} />
      </RoundedBox>
    </group>
  );
}

/** A small animated 3D bar chart (demo data), growing upward from the platform. */
export function BarChart({ reduced = false }: { reduced?: boolean }) {
  const totalWidth = (VALUES.length - 1) * (BAR_WIDTH + GAP);
  return (
    <group position={[-totalWidth / 2, 0, 0]}>
      {VALUES.map((v, i) => (
        <Bar key={i} index={i} height={v} reduced={reduced} />
      ))}
    </group>
  );
}
