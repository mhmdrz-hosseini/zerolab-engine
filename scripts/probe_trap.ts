// P7 probe: where does the trapping live? For a master + axis, compute the
// trapped-column mask and report the trapped vertices' distribution across
// the two pull halves and along the vert axis (height histogram).
import { readFileSync } from 'node:fs';
import { parseStlBinary } from '../src/engine/stl';
import { buildReport, computeBBox } from '../src/engine/analyze';
import { trappedColumnMask } from '../src/engine/analyze';
import { weldMesh, } from '../src/engine/weld';
import { parseObj } from '../src/engine/obj';
import { AXES } from '../src/engine/types';

const input = process.argv[2];
const axisArg = (process.argv[3] ?? 'auto') as 'X' | 'Y' | 'Z' | 'auto';

const buf = readFileSync(input);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
const ext = input.toLowerCase().slice(input.lastIndexOf('.') + 1);
let full = ext === 'obj'
  ? weldMesh(parseObj(new TextDecoder().decode(ab)).mesh.vertProperties, parseObj(new TextDecoder().decode(ab)).mesh.triVerts)
  : parseStlBinary(ab);
const bb0 = computeBBox(full);
const maxDim = Math.max(...bb0.dim);
if (maxDim > 300 || maxDim < 20) {
  const k = 150 / maxDim;
  for (let i = 0; i < full.vertProperties.length; i++) full.vertProperties[i] *= k;
}
const report = buildReport(input, { ...full, vertCount: full.vertProperties.length / 3 }, full, full.triVerts.length / 3, 64);
console.log(`axes: ${report.axes.map(a => `${a.axis}=${a.trappedPct.toFixed(1)}%`).join('  ')}`);
const axis = axisArg === 'auto' ? report.bestAxis : axisArg;
const trap = trappedColumnMask(full, axis, 64);
console.log(`axis ±${axis}: trapped columns ${(trap.mask.reduce((s, v) => s + v, 0) / trap.mask.length * 100).toFixed(1)}% of the ${trap.grid}² grid`);

// vert axis = the rest axis with the largest extent? use the frame pick: vert = axis of max bbox dim excluding pull
const p = AXES.indexOf(axis);
const dims = computeBBox(full).dim;
const vi = [0, 1, 2].filter(a => a !== p).reduce((a, b) => dims[a] >= dims[b] ? a : b);
const bb = computeBBox(full);
const midP = bb.min[p] + dims[p] / 2;
const vp = full.vertProperties;
const nV = vp.length / 3;
const u3 = (p + 1) % 3, v3 = (p + 2) % 3;

// histogram: side (±mid) x height decile
const sideCount = [0, 0];
const bins = 10;
const hist = Array.from({ length: 2 }, () => new Array(bins).fill(0));
let trappedVerts = 0;
for (let i = 0; i < nV; i++) {
  const iu = Math.max(0, Math.min(trap.grid - 1, Math.floor(((vp[i * 3 + u3] - trap.minU) / trap.spanU) * trap.grid)));
  const iv = Math.max(0, Math.min(trap.grid - 1, Math.floor(((vp[i * 3 + v3] - trap.minV) / trap.spanV) * trap.grid)));
  if (!trap.mask[iv * trap.grid + iu]) continue;
  trappedVerts++;
  const side = vp[i * 3 + p] >= midP ? 0 : 1;
  sideCount[side]++;
  const h = Math.max(0, Math.min(bins - 1, Math.floor(((vp[i * 3 + vi] - bb.min[vi]) / dims[vi]) * bins)));
  hist[side][h]++;
}
console.log(`trapped verts: ${trappedVerts}/${nV} (${(100 * trappedVerts / nV).toFixed(1)}%)`);
console.log(`side +pull: ${sideCount[0]}   side -pull: ${sideCount[1]}`);
for (const s of [0, 1]) {
  const tot = Math.max(1, sideCount[s]);
  console.log(`height deciles ${s === 0 ? '+pull' : '-pull'}: ${hist[s].map(c => (100 * c / tot).toFixed(0).padStart(3)).join(' ')}  (% of that side's trapped verts, low->high)`);
}
