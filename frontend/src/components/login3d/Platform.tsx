"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

const BLUE = "#3186FF";
const GOLD = "#FBBC05";

/** A slow-turning bright point travelling around a ring, with a soft halo behind it (a cheap stand-in for a
 * real bloom pass: a larger, low-opacity sphere of the same colour, so the light reads as glowing, not just lit). */
function TravellingLight({ radius, color, speed }: { radius: number; color: string; speed: number }) {
  const group = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!group.current) return;
    const a = clock.elapsedTime * speed;
    group.current.position.set(Math.cos(a) * radius, 0, Math.sin(a) * radius);
  });
  return (
    <group ref={group}>
      <mesh>
        <sphereGeometry args={[0.05, 16, 16]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.12, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.3} toneMapped={false} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** The circular platform the dashboard appears to float above: two concentric glowing rings, a soft colour
 * wash pooling beneath them, and a receives-shadow base disc for contact shadows from the floating objects. */
export function Platform({ reduced = false }: { reduced?: boolean }) {
  const ring1 = useRef<THREE.Mesh>(null);
  const ring2 = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    if (reduced) return;
    if (ring1.current) ring1.current.rotation.z += delta * 0.06;
    if (ring2.current) ring2.current.rotation.z -= delta * 0.045;
  });

  return (
    <group position={[0, -1.35, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      {/* A soft, oversized colour wash beneath the disc: the "realistic ambient shadow / glow pooling" cue. */}
      <mesh position={[0, 0, -0.01]}>
        <circleGeometry args={[2.5, 64]} />
        <meshBasicMaterial color={BLUE} transparent opacity={0.07} toneMapped={false} depthWrite={false} />
      </mesh>
      <mesh receiveShadow>
        <circleGeometry args={[2.1, 64]} />
        <meshStandardMaterial color="#eef3fb" transparent opacity={0.55} roughness={0.55} metalness={0.05} />
      </mesh>
      <mesh ref={ring1}>
        <ringGeometry args={[1.48, 1.57, 96]} />
        <meshBasicMaterial color={BLUE} transparent opacity={0.6} toneMapped={false} />
      </mesh>
      <mesh ref={ring2}>
        <ringGeometry args={[1.69, 1.745, 96]} />
        <meshBasicMaterial color={GOLD} transparent opacity={0.5} toneMapped={false} />
      </mesh>
      {!reduced && (
        <>
          <TravellingLight radius={1.525} color={BLUE} speed={0.35} />
          <TravellingLight radius={1.7175} color={GOLD} speed={-0.22} />
        </>
      )}
    </group>
  );
}
