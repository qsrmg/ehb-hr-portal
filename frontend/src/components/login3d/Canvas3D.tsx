"use client";

import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import { DonutChart } from "./DonutChart";
import { BarChart } from "./BarChart";
import { GrowthLine } from "./GrowthLine";
import { Platform } from "./Platform";
import { ServiceCard3D } from "./ServiceCard3D";

const BLUE = "#3186FF";
const GOLD = "#FBBC05";

/** The whole scene rises gently into place once, then settles into continuous idle motion. The entrance
 * only ever moves `position.y` (a rise); the 0.78 composition scale below is fixed and never touched here,
 * so it cannot be fought over by two different parts of this animation. */
function DashboardGroup({ reduced }: { reduced: boolean }) {
  const group = useRef<THREE.Group>(null);
  const start = useRef<number | null>(null);
  // A plain ref, not state: it only ever drives imperative three.js updates below, never JSX, so there is
  // no reason to re-render the subtree when it flips.
  const settled = useRef(reduced);

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    if (!settled.current) {
      if (start.current === null) start.current = state.clock.elapsedTime;
      const t = Math.min(1, (state.clock.elapsedTime - start.current) / 1.1);
      const eased = 1 - (1 - t) ** 3;
      g.position.y = THREE.MathUtils.lerp(-0.6, 0, eased);
      if (t >= 1) settled.current = true;
    } else if (!reduced) {
      g.position.y = Math.sin(state.clock.elapsedTime * 0.5) * 0.04;
    } else {
      g.position.y = 0;
    }
  });

  return (
    <group ref={group} position={[0, reduced ? 0 : -0.6, 0]} scale={0.78}>
      <Platform reduced={reduced} />
      {/* Soft contact shadows under the donut and the bar/line group: the same cheap grounding trick as the
          service cards, since both sit well above the platform's own (distant) real shadow catcher. */}
      <mesh position={[0.8, -0.05, -0.3]} rotation={[-Math.PI / 2.4, 0, 0]}>
        <circleGeometry args={[0.46, 24]} />
        <meshBasicMaterial color="#0b1930" transparent opacity={0.12} toneMapped={false} depthWrite={false} />
      </mesh>
      <mesh position={[-0.8, -0.42, 0]} rotation={[-Math.PI / 2.4, 0, 0]}>
        <circleGeometry args={[0.32, 24]} />
        <meshBasicMaterial color="#0b1930" transparent opacity={0.1} toneMapped={false} depthWrite={false} />
      </mesh>
      <group position={[0.8, 0.45, -0.2]} scale={0.48}>
        <DonutChart reduced={reduced} />
      </group>
      <group position={[-0.8, -0.1, 0.1]} scale={0.58}>
        <BarChart reduced={reduced} />
        <GrowthLine reduced={reduced} />
      </group>
      {/* Calendar: 5s ambient loop, +/-3deg sway. */}
      <ServiceCard3D icon="calendar" label="Attendance" tone={BLUE} position={[-1.3, 0.75, 0.55]} floatSpeed={0.9} floatPhase={0} idlePeriod={5} idleRotationDeg={3} reduced={reduced} delay={1.1} />
      {/* Employee ID card: its own, slightly different timing from the calendar. */}
      <ServiceCard3D icon="users" label="Leave Management" tone={BLUE} position={[1.25, -0.35, 0.7]} floatSpeed={0.75} floatPhase={1.4} idlePeriod={6.2} idleRotationDeg={3} reduced={reduced} delay={1.3} />
      {/* Yellow HR folder: 6s loop, a smaller/"very subtle" sway than the other two. */}
      <ServiceCard3D icon="coins" label="Pay Slip" tone={GOLD} position={[-0.05, 1.05, 0.5]} floatSpeed={0.82} floatPhase={2.6} idlePeriod={6} idleRotationDeg={1.5} reduced={reduced} delay={1.5} />
    </group>
  );
}

/**
 * The live WebGL scene. Rendered only once the host component has confirmed WebGL is available and the
 * viewport is wide enough; `reduced` (prefers-reduced-motion) freezes the idle loops but keeps the chart
 * and card entrance as an instant, static layout rather than skipping it, so the page stays informative.
 */
export function Canvas3D({ reduced, onContextLost }: { reduced: boolean; onContextLost: () => void }) {
  return (
    <Canvas
      shadows="soft"
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener("webglcontextlost", (e) => {
          e.preventDefault();
          onContextLost();
        });
      }}
      style={{ touchAction: "pan-y" }}
    >
      <PerspectiveCamera makeDefault position={[0, 0.35, 5.4]} fov={34} onUpdate={(cam) => cam.lookAt(0, -0.15, 0)} />
      {/* Lower ambient + a stronger, shadow-casting key light reads as more premium/dimensional than flat,
          even lighting; the two coloured point lights carry the blue/gold brand glow and rim definition. */}
      <ambientLight intensity={0.4} />
      <directionalLight position={[1.6, 3.2, 2.4]} intensity={0.85} color="#ffffff" castShadow shadow-mapSize={[1024, 1024]} shadow-bias={-0.0005}>
        <orthographicCamera attach="shadow-camera" args={[-2.4, 2.4, 2.4, -2.4, 0.5, 8]} />
      </directionalLight>
      <pointLight position={[2.4, 2, 2]} intensity={60} color={BLUE} distance={10} decay={2} />
      <pointLight position={[-2.2, -1.2, 1.6]} intensity={45} color={GOLD} distance={10} decay={2} />
      {/* Soft rim light from behind, for a glassy edge highlight on the cards and donut. */}
      <pointLight position={[0, 0.6, -2.2]} intensity={22} color="#bcd4ff" distance={8} decay={2} />
      <DashboardGroup reduced={reduced} />
    </Canvas>
  );
}
