import { OrbitControls, Environment, Lightformer } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { Axis, MeshArrays } from '../engine/types';

export interface LayerDef {
  mesh: MeshArrays;
  color: string;
  opacity: number;
  order: number;
  /** part key — drives exploded-view offsets and the real-view material */
  id?: string;
  /** per-vertex trapped flags — colored red on top of the base color */
  trap?: Uint8Array;
}

/** Physically-plausible palette for the real-view toggle (printed resin,
 *  translucent silicone, cast master). */
const REAL_COLORS: Record<string, string> = {
  master: '#c9b9a4',
  siliconeSkin: '#8fd8c2',
  jacketA: '#d7dade',
  jacketB: '#d7dade',
  jacketB1: '#d7dade',
  jacketB2: '#d7dade',
  basePlate: '#c6cbd2',
};

const AXIS_INDEX: Record<Axis, 0 | 1 | 2> = { X: 0, Y: 1, Z: 2 };

/** Runtime separation for the exploded view: A pulls +axis, B (and the B1/B2
 *  sub-panels, which also spread laterally) push −axis. */
function explodeOffset(id: string | undefined, axis: Axis, dist: number, explode: number): [number, number, number] {
  if (!id || explode <= 0 || dist <= 0) return [0, 0, 0];
  const ax = AXIS_INDEX[axis];
  const lat = (ax === 0 ? 1 : 0) as 0 | 1 | 2;
  const e = explode * dist;
  switch (id) {
    case 'jacketA': return ax === 0 ? [e, 0, 0] : ax === 1 ? [0, e, 0] : [0, 0, e];
    case 'jacketB': return ax === 0 ? [-e, 0, 0] : ax === 1 ? [0, -e, 0] : [0, 0, -e];
    case 'jacketB1': {
      const v: [number, number, number] = [0, 0, 0];
      v[ax] = -e; v[lat] = -e * 0.35;
      return v;
    }
    case 'jacketB2': {
      const v: [number, number, number] = [0, 0, 0];
      v[ax] = -e; v[lat] = e * 0.35;
      return v;
    }
    default: return [0, 0, 0];
  }
}

function LayerMesh({ def, real }: { def: LayerDef; real: boolean }) {
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
  const useVertexColors = !!def.trap && !real;
  const isSkin = def.id === 'siliconeSkin';
  const opaque = real && !isSkin;
  const color = real && def.id && REAL_COLORS[def.id] ? REAL_COLORS[def.id] : def.color;
  return (
    <mesh geometry={geom} renderOrder={def.order}>
      <meshStandardMaterial
        color={color}
        vertexColors={useVertexColors}
        metalness={real ? 0.02 : 0.05}
        roughness={real ? 0.42 : 0.8}
        transparent={!opaque}
        opacity={real ? (isSkin ? 0.55 : 1) : def.opacity}
        depthWrite={opaque}
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
  axis,
  explode = 0,
  explodeDist = 0,
  real = false,
}: {
  layers: LayerDef[];
  center: [number, number, number];
  radius: number;
  gridY: number;
  axis?: Axis;
  explode?: number;
  explodeDist?: number;
  real?: boolean;
}) {
  return (
    <Canvas camera={{ fov: 45, near: 1, far: 8000, position: [200, 140, 260] }} dpr={[1, 2]}>
      <color attach="background" args={['#e9edf4']} />
      <hemisphereLight args={['#ffffff', '#dfe5ee', 1.1]} />
      <directionalLight position={[180, 260, 160]} intensity={1.7} />
      <directionalLight position={[-160, 80, -140]} intensity={0.45} />
      {real && (
        <Environment resolution={128} frames={1}>
          <Lightformer intensity={1.6} position={[0, 5, 0]} rotation-x={Math.PI / 2} scale={[12, 12, 1]} color="#ffffff" />
          <Lightformer intensity={0.8} position={[5, 1, 3]} rotation-y={-Math.PI / 2} scale={[8, 4, 1]} color="#f2f6ff" />
          <Lightformer intensity={0.6} position={[-5, 1, -3]} rotation-y={Math.PI / 2} scale={[8, 4, 1]} color="#fdf3e7" />
        </Environment>
      )}
      <gridHelper args={[600, 60, '#ccd4e0', '#dde3ec']} position={[0, gridY, 0]} />
      <group position={[-center[0], -center[1], -center[2]]}>
        {layers
          .slice()
          .sort((a, b) => a.order - b.order)
          .map((def, i) => {
            const off = explodeOffset(def.id, axis ?? 'Y', explodeDist, explode);
            const moved = off[0] !== 0 || off[1] !== 0 || off[2] !== 0;
            return (
              <group key={`${def.order}-${i}`} position={moved ? off : undefined}>
                <LayerMesh def={def} real={real} />
              </group>
            );
          })}
      </group>
      <Rig radius={radius} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
    </Canvas>
  );
}
