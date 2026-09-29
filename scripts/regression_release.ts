// System-level release regression (plan Task 2): a real built mold must pass
// its STAGED removal sequence (A off with B still installed, then B against
// master + plate), attribute obstacles, and keep silicone demold explicitly
// separate — rigid jacket release never certifies master demolding.
import assert from 'node:assert/strict';
import { loadManifold, isStatusOk } from '../src/engine/manifoldLoader';
import { instanceToMeshArrays, type SdfGrid } from '../src/engine/offset';
import { buildMoldForAxis } from '../src/engine/split';
import type { Axis } from '../src/engine/types';

const mod = await loadManifold();
const body = mod.Manifold.cube([24, 18, 36]);
const spur = mod.Manifold.cube([18, 8, 3]).translate(18, 3, 25);
const master = body.add(spur);

const result = await buildMoldForAxis({ mod, master: instanceToMeshArrays(master), grid: {} as SdfGrid,
  params: { gap: 4, wall: 3, clearance: 0.25 }, axis: 'Y' as Axis, ports: false });

try {
  assert(result.extraction.A.pass, `jacket A staged release failed @${result.extraction.A.freeAtMm} (${result.extraction.A.obstacle})`);
  assert(result.extraction.B?.pass, `jacket B staged release failed @${result.extraction.B?.freeAtMm} (${result.extraction.B?.obstacle})`);
  assert.equal(result.extraction.A.obstacle, undefined, 'a passing release reports no obstacle');
  assert.equal(result.extraction.B!.obstacle, undefined, 'a passing release reports no obstacle');

  // every printed part is a valid single solid (unchanged contract)
  const parts = [result.pieces.jacketA, result.pieces.jacketB, result.pieces.basePlate]
    .map((mesh) => new mod.Manifold(new mod.Mesh({ numProp: 3, ...mesh })));
  for (const part of parts) {
    assert(isStatusOk(part) && part.volume() > 0, 'invalid printed part');
    const components = part.decompose();
    assert.equal(components.length, 1, 'detached printed features');
    components.forEach((x) => x.delete());
    part.delete();
  }

  // silicone demold is reported separately and is never certified by rigid release
  assert.equal(result.siliconeDemold?.status, 'unverified', 'silicone demold must be an explicit unverified stage');
  assert(result.siliconeDemold.note.length > 20, 'silicone demold note must explain the separation');

  console.log('STAGED RELEASE SYSTEM REGRESSION PASS (A+B clear, obstacles attributed, silicone demold separate)');
} finally {
  master.delete(); body.delete(); spur.delete();
}
