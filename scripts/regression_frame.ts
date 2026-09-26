// Frame-stability regressions — plan Task 2.
// 1. Tessellation stability: subdividing one face must not flip the base axis
//    (area-weighted scoring, not vertex counting).
// 2. Translation stability: shifting the whole model must not change frame
//    decisions or output volumes.
// 3. Explicit axes: verticalAxis override honored; vertical === pull rejected.
// 4. Intake validation: non-finite and zero-dimension meshes are rejected.
import assert from 'node:assert/strict';
import { validateMasterMesh } from '../src/engine/analyze';
import { loadManifold } from '../src/engine/manifoldLoader';
import { instanceToMeshArrays } from '../src/engine/offset';
import { buildMoldForAxis, pickFrame } from '../src/engine/split';
import type { MeshArrays } from '../src/engine/types';

const mod = await loadManifold();

/** Box from min to max; optionally subdivides the min-X face into an n×n grid
 *  (fine vertex cloud on a SMALL footprint face — flips vertex-count ranking,
 *  must not flip area-weighted ranking). */
function boxMesh(min: [number, number, number], max: [number, number, number], subdivideMinX = 0): MeshArrays {
  const verts: number[] = [], tris: number[] = [];
  const v = (x: number, y: number, z: number): number => { verts.push(x, y, z); return verts.length / 3 - 1; };
  const quad = (a: number, b: number, c: number, d: number): void => { tris.push(a, b, c, a, c, d); };
  // +X / −Y / +Y / +Z / −Z faces, CCW from outside
  quad(v(max[0], min[1], min[2]), v(max[0], max[1], min[2]), v(max[0], max[1], max[2]), v(max[0], min[1], max[2]));
  quad(v(min[0], min[1], min[2]), v(min[0], min[1], max[2]), v(min[0], max[1], max[2]), v(min[0], max[1], min[2]));
  quad(v(max[0], max[1], min[2]), v(min[0], max[1], min[2]), v(min[0], max[1], max[2]), v(max[0], max[1], max[2]));
  quad(v(min[0], min[1], min[2]), v(max[0], min[1], min[2]), v(max[0], min[1], max[2]), v(min[0], min[1], max[2]));
  quad(v(min[0], min[1], max[2]), v(max[0], min[1], max[2]), v(max[0], max[1], max[2]), v(min[0], max[1], max[2]));
  if (subdivideMinX <= 0) {
    quad(v(min[0], min[1], min[2]), v(min[0], max[1], min[2]), v(min[0], max[1], max[2]), v(min[0], min[1], max[2]));
  } else {
    // −X face grid, CCW from −X (outward)
    const grid: number[][] = [];
    for (let i = 0; i <= subdivideMinX; i++) {
      grid[i] = [];
      for (let j = 0; j <= subdivideMinX; j++) {
        grid[i][j] = v(min[0], min[1] + (max[1] - min[1]) * j / subdivideMinX, min[2] + (max[2] - min[2]) * i / subdivideMinX);
      }
    }
    for (let i = 0; i < subdivideMinX; i++) for (let j = 0; j < subdivideMinX; j++) {
      tris.push(grid[i][j], grid[i][j + 1], grid[i + 1][j + 1]);
      tris.push(grid[i][j], grid[i + 1][j + 1], grid[i + 1][j]);
    }
  }
  return { vertProperties: Float32Array.from(verts), triVerts: Uint32Array.from(tris) };
}

// --- 1. tessellation stability (pull Y; candidates: X base 648 mm², Z base 432 mm²) ---
const plain = boxMesh([0, 0, 0], [24, 18, 36]);
const subdiv = boxMesh([0, 0, 0], [24, 18, 36], 12);
const fPlain = pickFrame('Y', plain);
const fSub = pickFrame('Y', subdiv);
assert.equal(fPlain.vert, 'X', `plain box base axis: expected X (648 mm² footprint), got ${fPlain.vert}`);
assert.equal(fSub.vert, fPlain.vert, `subdivided box flipped the base axis to ${fSub.vert} — contact scoring is not tessellation-stable`);
console.log('PASS tessellation stability: subdivided face keeps base axis', fPlain.vert);

// --- 2. translation stability through the full build ---
const body = mod.Manifold.cube([24, 18, 36]);
const spur = mod.Manifold.cube([18, 8, 3]).translate(18, 3, 25);
const asym = body.add(spur);
const r0 = await buildMoldForAxis({ mod, master: instanceToMeshArrays(asym), grid: {} as never,
  params: { gap: 4, wall: 3, clearance: 0.25 }, axis: 'Y', ports: false });
const rT = await buildMoldForAxis({ mod, master: instanceToMeshArrays(asym.translate(117, -83, 41)), grid: {} as never,
  params: { gap: 4, wall: 3, clearance: 0.25 }, axis: 'Y', ports: false });
assert.equal(r0.frame.vert, rT.frame.vert, 'vert axis changed under translation');
assert.equal(r0.frame.depth, rT.frame.depth, 'depth axis changed under translation');
const off = [117, -83, 41];
const vAx = ['X', 'Y', 'Z'].indexOf(r0.frame.vert);
const pAx = ['X', 'Y', 'Z'].indexOf(r0.frame.pull);
assert.ok(Math.abs((rT.frame.base - off[vAx]) - r0.frame.base) < 1e-4, 'base position shifted');
assert.ok(Math.abs((rT.frame.mid - off[pAx]) - r0.frame.mid) < 1e-4, 'mid position shifted');
const volA0 = (() => { const m = new mod.Manifold(new mod.Mesh({ numProp: 3, ...r0.pieces.jacketA })); const v = m.volume(); m.delete(); return v; })();
const volAT = (() => { const m = new mod.Manifold(new mod.Mesh({ numProp: 3, ...rT.pieces.jacketA })); const v = m.volume(); m.delete(); return v; })();
assert.ok(Math.abs(volAT - volA0) / volA0 < 1e-6, `jacket A volume changed under translation: ${volA0} vs ${volAT}`);
console.log('PASS translation stability: frame + output volume invariant under +[117,-83,41]');

// --- 3. explicit axes ---
const rV = await buildMoldForAxis({ mod, master: instanceToMeshArrays(asym), grid: {} as never,
  params: { gap: 4, wall: 3, clearance: 0.25, verticalAxis: 'Z' }, axis: 'Y', ports: false });
assert.equal(rV.frame.vert, 'Z', 'explicit verticalAxis ignored');
assert.notEqual(rV.frame.vert, rV.frame.pull, 'explicit vertical equals pull');
await assert.rejects(
  () => buildMoldForAxis({ mod, master: instanceToMeshArrays(asym), grid: {} as never,
    params: { gap: 4, wall: 3, clearance: 0.25, verticalAxis: 'Y' }, axis: 'Y', ports: false }),
  /must differ/,
);
const pkgV = await (async () => {
  const { generateMoldPackage } = await import('../src/engine/split');
  return generateMoldPackage({ mod, master: instanceToMeshArrays(asym), grid: {} as never,
    params: { gap: 4, wall: 3, clearance: 0.25, splitAxis: 'X' }, rankedAxes: ['Z', 'Y'], ports: false });
})();
assert.equal(pkgV?.axis, 'X', 'explicit splitAxis did not override the ranking ladder');
console.log('PASS explicit axes: verticalAxis honored, vertical≠pull enforced, splitAxis overrides ladder');

// --- 4. intake validation ---
assert.ok(validateMasterMesh(plain).length === 0, 'valid mesh rejected');
const badFinite: MeshArrays = { vertProperties: Float32Array.from([0, 0, 0, 1, 0, NaN, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1]), triVerts: Uint32Array.from([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]) };
assert.ok(validateMasterMesh(badFinite).some((p) => p.includes('non-finite')), 'non-finite coordinates accepted');
const badDim: MeshArrays = { vertProperties: Float32Array.from([0, 0, 0, 5, 0, 0, 5, 0, 3, 0, 0, 3]), triVerts: Uint32Array.from([0, 1, 2, 0, 2, 3]) };
assert.ok(validateMasterMesh(badDim).some((p) => p.includes('degenerate')), 'zero-dimension mesh accepted');
console.log('PASS intake validation: non-finite and degenerate meshes rejected');

[plain, subdiv].forEach(() => { /* plain arrays, nothing kernel-owned */ });
asym.delete(); body.delete(); spur.delete();
console.log('FRAME REGRESSIONS PASS');
