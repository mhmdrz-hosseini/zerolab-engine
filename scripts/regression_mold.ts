import assert from 'node:assert/strict';
import { loadManifold, isStatusOk, type ManifoldInstance } from '../src/engine/manifoldLoader';
import { instanceToMeshArrays, type SdfGrid } from '../src/engine/offset';
import { buildMoldForAxis, frameConstants } from '../src/engine/split';
import type { Axis } from '../src/engine/types';

const mod = await loadManifold();
const body = mod.Manifold.cube([24, 18, 36]);
const spur = mod.Manifold.cube([18, 8, 3]).translate(18, 3, 25);
const asymmetric = body.add(spur);
// designed tongue protrusion for these solids (36 mm max dim, wall 3) — the
// assert below measures half of it, so small-master tongue floors don't put a
// float-exact boundary under a strict `<` comparison
const K = frameConstants(36);
const designDepth = Math.min(K.tongue, 3 * 0.65);
const cases: [string, ManifoldInstance, Axis][] = [
  ['sparse box', body, 'Y'],
  ['thin asymmetric projection', asymmetric, 'Y'],
  ['translated away from origin', asymmetric.translate(117, -83, 41), 'Y'],
  ['X pull', asymmetric.rotate(0, 0, 90), 'X'],
  ['Z pull / horizontal input', asymmetric.rotate(90, 0, 0), 'Z'],
];
for (const [name, solid, axis] of cases) {
  const result = await buildMoldForAxis({ mod, master: instanceToMeshArrays(solid), grid: {} as SdfGrid,
    params: { gap: 4, wall: 3, clearance: 0.25 }, axis, ports: false });
  assert(result.extraction.A.pass && result.extraction.B!.pass, `${name}: blocked release path`);
  const parts = [result.pieces.jacketA, result.pieces.jacketB, result.pieces.basePlate].map(mesh =>
    new mod.Manifold(new mod.Mesh({ numProp: 3, ...mesh })));
  for (const part of parts) {
    assert(isStatusOk(part) && part.volume() > 0, `${name}: invalid part`);
    const components = part.decompose();
    assert.equal(components.length, 1, `${name}: detached printed features: ${components.map(x => x.volume()).join(", ")}`);
    components.forEach(x => x.delete());
  }
  const overlap = parts[0].intersect(parts[1]);
  assert(overlap.volume() < 0.001, `${name}: joint interference`); overlap.delete();
  const fused = solid.add(parts[2]);
  const components = fused.decompose();
  assert.equal(components.length, 1, `${name}: master not attached to base`);
  components.forEach(x => x.delete()); fused.delete();
  const p = ['X', 'Y', 'Z'].indexOf(axis);
  assert(parts[0].boundingBox().min[p] < result.frame.mid - designDepth / 2, `${name}: missing tongue`);
  parts.forEach(x => x.delete());
  console.log(`PASS ${name}: solid connected parts, fitting joint, attached master, clear release`);
}
cases.forEach(([, solid]) => solid.delete()); spur.delete();
console.log('MOLD REGRESSIONS PASS');
