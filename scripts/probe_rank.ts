// Probe: compare CLI-side vs library-side ranking inputs on the parity fixture.
import { readFileSync } from 'node:fs';
import { loadManifold } from '../src/engine/manifoldLoader';
import { parseStlBinary } from '../src/engine/stl';
import { buildReport, computeBBox } from '../src/engine/analyze';
import { buildSignedDistanceGrid } from '../src/engine/offset';
import { rankSplitAxes } from '../src/engine/planner';
import type { MeshArrays } from '../src/engine/types';

const mod = await loadManifold();
const bytes = readFileSync('scratch/parity/fixture_zup.stl');
const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const full0 = parseStlBinary(ab);
const bb = computeBBox(full0);
const k = 36 / Math.max(...bb.dim);
const full: MeshArrays = { vertProperties: Float32Array.from(full0.vertProperties), triVerts: full0.triVerts };
for (let i = 0; i < full.vertProperties.length; i++) full.vertProperties[i] *= k;

const man = new mod.Manifold(new mod.Mesh({ numProp: 3, vertProperties: full.vertProperties, triVerts: full.triVerts }));
const dec = man.simplify(0.05);
const dm = dec.getMesh();
const analysis: MeshArrays = {
  vertProperties: Float32Array.from(dm.vertProperties),
  triVerts: Uint32Array.from(dm.triVerts.subarray(0, dm.numTri * 3)),
};
console.log('full tris', full.triVerts.length / 3, 'analysis tris', analysis.triVerts.length / 3);

const reportFull = buildReport('x', { ...full, vertCount: full.vertProperties.length / 3 }, full, full.triVerts.length / 3, 64);
const reportSimp = buildReport('x', { ...full, vertCount: full.vertProperties.length / 3 }, analysis, analysis.triVerts.length / 3, 64);
console.log('axes (full-mesh report):', reportFull.axes.map(a => `${a.axis}:${a.trappedPct.toFixed(1)}`).join(' '));
console.log('axes (simplified report):', reportSimp.axes.map(a => `${a.axis}:${a.trappedPct.toFixed(1)}`).join(' '));

const grid = await buildSignedDistanceGrid(full, { gap: 4, wall: 3, step: 0.75 });
console.log('ranked (simplified):', rankSplitAxes(reportSimp.axes, analysis, grid, 4).join(','));
console.log('ranked (full):', rankSplitAxes(reportFull.axes, full, grid, 4).join(','));
