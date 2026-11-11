"use client";

import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ServiceCard3D } from "@/components/login3d/ServiceCard3D";

const BLUE = "#3186FF";
const GOLD = "#FBBC05";

/** A small ring with a soft travelling light, orbiting smoothly and continuously — the same technique as
 * the sign-in page's platform, trimmed down for a compact header corner. */
function OrbitRing({ radius, color, speed, tilt }: { radius: number; color: string; speed: number; tilt: number }) {
  const light = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!light.current) return;
    const a = clock.elapsedTime * speed;
    light.current.position.set(Math.cos(a) * radius, Math.sin(a) * radius * Math.sin(tilt), Math.sin(a) * radius * Math.cos(tilt));
  });
  return (
    <group rotation={[tilt, 0, 0]}>
      <mesh>
        <ringGeometry args={[radius - 0.015, radius + 0.015, 72]} />
        <meshBasicMaterial color={color} transparent opacity={0.4} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <group ref={light}>
        <mesh>
          <sphereGeometry args={[0.04, 12, 12]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
        <mesh>
          <sphereGeometry args={[0.09, 12, 12]} />
          <meshBasicMaterial color={color} transparent opacity={0.3} toneMapped={false} depthWrite={false} />
        </mesh>
      </group>
    </group>
  );
}

/** Calendar, Employee ID card and HR folder, gently floating/tilting, with two orbiting brand-colour rings. */
export function HeaderScene3D({ reduced }: { reduced: boolean }) {
  return (
    <Canvas dpr={[1, 1.5]} gl={{ antialias: true, alpha: true, powerPreference: "low-power" }} camera={{ position: [0, 0, 4.4], fov: 32 }}>
      <ambientLight intensity={0.55} />
      <pointLight position={[2, 1.6, 2]} intensity={40} color={BLUE} distance={8} decay={2} />
      <pointLight position={[-1.8, -1, 1.4]} intensity={30} color={GOLD} distance={8} decay={2} />
      <directionalLight position={[1, 2, 2]} intensity={0.5} />
      <group scale={0.85}>
        <OrbitRing radius={1.35} color={BLUE} speed={reduced ? 0 : 0.3} tilt={0.3} />
        <OrbitRing radius={1.55} color={GOLD} speed={reduced ? 0 : -0.22} tilt={-0.25} />
        <ServiceCard3D icon="calendar" label="Calendar" tone={BLUE} position={[-0.75, 0.35, 0.3]} floatSpeed={0.9} floatPhase={0} idlePeriod={5} idleRotationDeg={3} reduced={reduced} delay={0.3} />
        <ServiceCard3D icon="idCard" label="Employee ID" tone={BLUE} position={[0.8, -0.25, 0.4]} floatSpeed={0.75} floatPhase={1.4} idlePeriod={6.2} idleRotationDeg={3} reduced={reduced} delay={0.5} />
        <ServiceCard3D icon="folder" label="HR Documents" tone={GOLD} position={[0.05, 0.8, 0.5]} floatSpeed={0.82} floatPhase={2.6} idlePeriod={6} idleRotationDeg={1.5} reduced={reduced} delay={0.7} />
      </group>
    </Canvas>
  );
}
