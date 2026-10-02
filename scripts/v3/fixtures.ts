import { loadManifold, type ManifoldInstance, type ManifoldMod } from '../../src/engine/manifoldLoader';
import { instanceToMeshArrays } from '../../src/engine/offset';
import type { MeshArrays } from '../../src/engine/types';

export { loadManifold, instanceToMeshArrays };
export const trayParams = { gap: 4, wall: 4, plateT: 4, backing: 4, freeboard: 5 };
export function plaque(mod: ManifoldMod): MeshArrays {
  const base = mod.Manifold.cube([50, 38, 6]);
  const boss = mod.Manifold.cube([22, 12, 2.5]).translate(12, 13, 6);
  const joined = base.add(boss);
  const mesh = instanceToMeshArrays(joined);
  joined.delete(); base.delete(); boss.delete();
  return mesh;
}
export function perforatedPlate(mod: ManifoldMod): MeshArrays {
  const base = mod.Manifold.cube([50, 50, 3]);
  const hole = mod.Manifold.cube([12, 12, 10]).translate(19, 19, -1);
  const shape = base.subtract(hole);
  const mesh = instanceToMeshArrays(shape);
  shape.delete(); base.delete(); hole.delete();
  return mesh;
}
export function withSolid<T>(mod: ManifoldMod, mesh: MeshArrays, read: (m: ManifoldInstance) => T): T {
  const m = new mod.Manifold(new mod.Mesh({ numProp: 3, ...mesh }));
  try { return read(m); } finally { m.delete(); }
}
export function intersectionVolume(mod: ManifoldMod, a: MeshArrays, b: MeshArrays): number {
  return withSolid(mod, a, ma => withSolid(mod, b, mb => {
    const hit = ma.intersect(mb);
    try { return hit.volume(); } finally { hit.delete(); }
  }));
}
