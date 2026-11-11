"use client";

import { useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";

const GOLD = "#FBBC05";
// A gentle upward growth curve across the same width as the bar chart beneath it.
const POINTS: [number, number, number][] = [
  [-0.4, 0.15, 0.12], [-0.2, 0.3, 0.12], [0, 0.26, 0.12], [0.2, 0.5, 0.12], [0.4, 0.62, 0.12],
];

function Point({ position, visible }: { position: [number, number, number]; visible: boolean }) {
  const group = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (!group.current) return;
    const target = visible ? 1 : 0;
    group.current.scale.setScalar(THREE.MathUtils.lerp(group.current.scale.x, target, 0.25));
    const pulse = 1 + Math.sin(state.clock.elapsedTime * 2.4 + position[0] * 4) * 0.08;
    group.current.scale.multiplyScalar(pulse);
  });
  return (
    <group position={position} scale={0} ref={group}>
      <mesh>
        <sphereGeometry args={[0.035, 16, 16]} />
        <meshBasicMaterial color={GOLD} toneMapped={false} />
      </mesh>
      {/* Halo behind the core point, the same cheap glow trick used on the platform's travelling lights. */}
      <mesh>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshBasicMaterial color={GOLD} transparent opacity={0.25} toneMapped={false} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** A golden growth line with glowing data points, drawn progressively on entrance. */
export function GrowthLine({ reduced = false }: { reduced?: boolean }) {
  const [shown, setShown] = useState(reduced ? POINTS.length : 0);
  const start = useRef<number | null>(null);

  useFrame((state) => {
    if (shown >= POINTS.length) return;
    if (start.current === null) start.current = state.clock.elapsedTime;
    const t = (state.clock.elapsedTime - start.current - 0.6) / 0.9;
    setShown(Math.max(0, Math.min(POINTS.length, Math.floor(t * POINTS.length) + (t > 0 ? 1 : 0))));
  });

  const visiblePoints = useMemo(() => POINTS.slice(0, Math.max(2, shown)), [shown]);

  return (
    <group>
      {visiblePoints.length > 1 && <Line points={visiblePoints} color={GOLD} lineWidth={3} toneMapped={false} />}
      {POINTS.map((p, i) => (
        <Point key={i} position={p} visible={i < shown} />
      ))}
    </group>
  );
}
