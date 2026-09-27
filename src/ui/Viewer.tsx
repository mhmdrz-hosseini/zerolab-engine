import { OrbitControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { MeshArrays } from '../engine/types';

export interface LayerDef {
  mesh: MeshArrays;
  color: string;
  opacity: number;
  order: number;
  /** per-vertex trapped flags — colored red on top of the base color */
  trap?: Uint8Array;
}

function LayerMesh({ def }: { def: LayerDef }) {
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(def.mesh.vertProperties, 3));
    g.setIndex(new THREE.BufferAttribute(def.mesh.triVerts, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    if (def.trap && def.trap.length === def.mesh.vertProperties.length / 3) {
      const colors = new Float32Array(def.trap.length * 3);
      for (let i = 0; i < def.trap.length; i++) {
        const trapped = def.trap[i] === 1;
        colors[i * 3] = trapped ? 0.95 : 0.55;
        colors[i * 3 + 1] = trapped ? 0.18 : 0.58;
        colors[i * 3 + 2] = trapped ? 0.15 : 0.6;
      }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }
    return g;
  }, [def.mesh, def.trap]);
  useEffect(() => () => geom.dispose(), [geom]);
  const useVertexColors = !!def.trap;
  return (
    <mesh geometry={geom} renderOrder={def.order}>
      <meshStandardMaterial
        color={useVertexColors ? '#ffffff' : def.color}
        vertexColors={useVertexColors}
        metalness={0.05}
        roughness={0.8}
        transparent
        opacity={def.opacity}
        depthWrite={false}
      />
    </mesh>
  );
}

function Rig({ radius }: { radius: number }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as { target: THREE.Vector3; update: () => void } | null;
  useEffect(() => {
    camera.position.set(radius * 1.1, radius * 0.75, radius * 1.5);
    controls?.target.set(0, 0, 0);
    controls?.update();
  }, [radius, camera, controls]);
  return null;
}

export function Viewer({
  layers,
  center,
  radius,
  gridY,
}: {
  layers: LayerDef[];
  center: [number, number, number];
  radius: number;
  gridY: number;
}) {
  return (
    <Canvas camera={{ fov: 45, near: 1, far: 8000, position: [200, 140, 260] }} dpr={[1, 2]}>
      <color attach="background" args={['#e9edf4']} />
      <hemisphereLight args={['#ffffff', '#dfe5ee', 1.1]} />
      <directionalLight position={[180, 260, 160]} intensity={1.7} />
      <directionalLight position={[-160, 80, -140]} intensity={0.45} />
      <gridHelper args={[600, 60, '#ccd4e0', '#dde3ec']} position={[0, gridY, 0]} />
      <group position={[-center[0], -center[1], -center[2]]}>
        {layers
          .slice()
          .sort((a, b) => a.order - b.order)
          .map((def, i) => (
            <LayerMesh key={`${def.order}-${i}`} def={def} />
          ))}
      </group>
      <Rig radius={radius} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
    </Canvas>
  );
}
