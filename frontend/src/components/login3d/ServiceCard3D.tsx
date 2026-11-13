"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { iconTexture } from "./iconTexture";
import { textTexture } from "./textTexture";

const MAX_TILT = THREE.MathUtils.degToRad(8);

export type ServiceCardProps = {
  icon: "calendar" | "users" | "coins" | "idCard" | "folder";
  label: string;
  tone: string;
  position: [number, number, number];
  floatSpeed: number;
  floatPhase: number;
  /** Seconds for one full ambient float+sway loop (each card uses its own, so they never move in sync). */
  idlePeriod: number;
  /** Ambient sway range in degrees, e.g. 3 means -3deg to +3deg (independent of the pointer-parallax tilt). */
  idleRotationDeg: number;
  reduced?: boolean;
  delay?: number;
};

/**
 * One floating glass card for a HR service (Attendance/Calendar, Leave Management/ID card, Pay Slip/Folder).
 * The icon and label are drawn as WebGL textures/text (see iconTexture.ts), not DOM content: @react-three/drei's
 * <Html> portal was tried first but a DOM "removeChild" race with it was reproducible even in a production
 * build with this React/R3F/drei combination, so the card stays pure three.js instead — also a better fit
 * for "real 3D". Two independent, non-fighting rotations run at once: a slow ambient sway on Z (its own
 * period and range per card, continuous, no resets) and a pointer-parallax tilt on X/Y (reacts to the cursor).
 */
export function ServiceCard3D({ icon, label, tone, position, floatSpeed, floatPhase, idlePeriod, idleRotationDeg, reduced = false, delay = 0 }: ServiceCardProps) {
  const group = useRef<THREE.Group>(null);
  const idleRotation = THREE.MathUtils.degToRad(idleRotationDeg);

  const start = useRef<number | null>(null);
  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    let appeared = 1;
    if (!reduced) {
      if (start.current === null) start.current = state.clock.elapsedTime;
      const t = Math.max(0, Math.min(1, (state.clock.elapsedTime - start.current - delay) / 0.7));
      appeared = 1 - (1 - t) ** 3;
    }

    const floatY = reduced ? 0 : Math.sin(state.clock.elapsedTime * floatSpeed + floatPhase) * 0.09;
    g.position.set(position[0], position[1] + floatY, position[2]);
    g.scale.setScalar(appeared);

    if (!reduced) {
      g.rotation.z = Math.sin((state.clock.elapsedTime / idlePeriod) * Math.PI * 2 + floatPhase) * idleRotation;
      // state.pointer is the normalised (-1..1) pointer position over the whole canvas, tracked by R3F itself.
      const targetRotY = state.pointer.x * MAX_TILT;
      const targetRotX = -state.pointer.y * MAX_TILT;
      g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, targetRotY, 0.06);
      g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, targetRotX, 0.06);
    }
  });

  const texture = useMemo(() => iconTexture(icon, tone), [icon, tone]);
  const labelTexture = useMemo(() => textTexture(label, "#1b2430", { widthPx: 512, heightPx: 192, fontPx: 64 }), [label]);

  return (
    <group ref={group} position={position} scale={0}>
      {/* A soft contact shadow pooling beneath the card: grounds it, a cheap but effective "floating above
          something" cue that reads well even without the real shadow map catching every frame. */}
      <mesh position={[0, -0.34, -0.1]} rotation={[-Math.PI / 2.6, 0, 0]}>
        <circleGeometry args={[0.42, 24]} />
        <meshBasicMaterial color="#0b1930" transparent opacity={0.14} toneMapped={false} depthWrite={false} />
      </mesh>
      {/* A thin, tone-coloured rim just behind the glass face: a bright premium edge without a real bevel pass. */}
      <RoundedBox args={[0.82, 0.64, 0.08]} radius={0.09} smoothness={4} position={[0, 0, -0.03]}>
        <meshBasicMaterial color={tone} transparent opacity={0.5} toneMapped={false} />
      </RoundedBox>
      <RoundedBox args={[0.78, 0.6, 0.12]} radius={0.08} smoothness={4} castShadow>
        <meshPhysicalMaterial
          color="#ffffff"
          transparent
          opacity={0.72}
          transmission={0.35}
          roughness={0.08}
          metalness={0}
          clearcoat={1}
          clearcoatRoughness={0.06}
          ior={1.5}
          reflectivity={0.6}
          envMapIntensity={1.2}
        />
      </RoundedBox>
      <mesh position={[0, 0.11, 0.08]}>
        <circleGeometry args={[0.15, 32]} />
        <meshBasicMaterial color={tone} transparent opacity={0.16} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.11, 0.09]}>
        <planeGeometry args={[0.24, 0.24]} />
        <meshBasicMaterial map={texture} transparent toneMapped={false} />
      </mesh>
      <mesh position={[0, -0.14, 0.08]}>
        <planeGeometry args={[0.66, 0.25]} />
        <meshBasicMaterial map={labelTexture} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}
