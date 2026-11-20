"use client";

import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Line, PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";

const NODE_COUNT = 13;
const RADIUS = 1.5;
const NEIGHBORS = 2;

/** Evenly spread `count` points over a sphere of `radius` (the standard golden-angle construction). */
function fibonacciSphere(count: number, radius: number): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  const offset = 2 / count;
  const increment = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = i * offset - 1 + offset / 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const phi = i * increment;
    points.push(new THREE.Vector3(Math.cos(phi) * r, y, Math.sin(phi) * r).multiplyScalar(radius));
  }
  return points;
}

/** Each node's `neighbors` closest others, as deduped undirected pairs — a sparse, even network rather than a fully connected mesh. */
function nearestNeighborEdges(points: THREE.Vector3[], neighbors: number): [THREE.Vector3, THREE.Vector3][] {
  const seen = new Set<string>();
  const edges: [THREE.Vector3, THREE.Vector3][] = [];
  points.forEach((p, i) => {
    const byDistance = points.map((q, j) => ({ j, d: i === j ? Infinity : p.distanceTo(q) })).sort((a, b) => a.d - b.d);
    for (const { j } of byDistance.slice(0, neighbors)) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push([points[i], points[j]]);
      }
    }
  });
  return edges;
}

function Network() {
  const group = useRef<THREE.Group>(null);
  const nodes = useMemo(() => fibonacciSphere(NODE_COUNT, RADIUS), []);
  const edges = useMemo(() => nearestNeighborEdges(nodes, NEIGHBORS), [nodes]);

  useFrame((_, delta) => {
    if (group.current) group.current.rotation.y += delta * 0.18;
  });

  return (
    <group ref={group} rotation={[0.3, 0, 0]}>
      {edges.map(([a, b], i) => (
        <Line key={i} points={[a, b]} color="#93c5fd" lineWidth={1} transparent opacity={0.55} />
      ))}
      {nodes.map((p, i) => (
        <mesh key={i} position={p}>
          <icosahedronGeometry args={[0.075, 0]} />
          <meshStandardMaterial color="#2563eb" emissive="#60a5fa" emissiveIntensity={0.35} roughness={0.25} metalness={0.1} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Variant C's live scene: one calm, low-poly network of connected nodes (people linked together) slowly
 * rotating on a white background. No text, no charts, few objects — deliberately simpler than the sign-in
 * page's old 3D illustration.
 */
export function NodeNetworkScene({ onContextLost }: { onContextLost: () => void }) {
  return (
    <Canvas
      dpr={[1, 1.5]}
      gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener("webglcontextlost", (e) => {
          e.preventDefault();
          onContextLost();
        });
      }}
      style={{ touchAction: "pan-y" }}
    >
      <PerspectiveCamera makeDefault position={[0, 0, 4.2]} fov={32} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[2, 3, 2]} intensity={0.5} color="#ffffff" />
      <pointLight position={[-2, -1, 1.5]} intensity={18} color="#60a5fa" distance={8} decay={2} />
      <Network />
    </Canvas>
  );
}
