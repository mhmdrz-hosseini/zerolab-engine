// Probe: run planMold exactly like the parity library adapter, print ledger.
import { readFileSync } from 'node:fs';
import { loadManifold } from '../src/engine/manifoldLoader';
import { parseStlBinary } from '../src/engine/stl';
import { buildReport, computeBBox } from '../src/engine/analyze';
import { buildSignedDistanceGrid } from '../src/engine/offset';
import { planMold, rankSplitAxes } from '../src/engine/planner';
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
dec.delete(); man.delete();
const report = buildReport('x', { ...full, vertCount: full.vertProperties.length / 3 }, analysis, analysis.triVerts.length / 3, 64);
const grid = await buildSignedDistanceGrid(full, { gap: 4, wall: 3, step: 0.75 });
const rankedAxes = rankSplitAxes(report.axes, analysis, grid, 4);
console.log('ranked:', rankedAxes.join(','));

const plan = await planMold({
  mod, master: full, grid, rankedAxes,
  params: { gap: 4, wall: 3, clearance: 0.25 },
  name: 'probe', ports: false,
  source: { inputSha256: '0'.repeat(64), sourceKind: 'file', units: 'mm', scalePolicy: 'probe', engineCommit: 'probe' },
});
if (plan.ok) {
  console.log('WINNER', plan.pkg.axis, 'gap', plan.gapEff, 'panels', plan.pkg.panels, 'silicone', plan.pkg.siliconeMl.toFixed(2));
  console.log('ledger:', plan.rejectionLedger.map(r => `${r.candidate} [${r.stage}] ${r.reason.slice(0, 80)}`).join('\n  '));
} else {
  console.log('FAILED:', plan.message);
  console.log('ledger:', plan.rejectionLedger.map(r => `${r.candidate} [${r.stage}] ${r.reason.slice(0, 90)}`).join('\n  '));
}
