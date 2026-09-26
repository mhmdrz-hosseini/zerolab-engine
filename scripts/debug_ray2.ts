// Debug: center-ray along X through box_l with the study_compare MT form.
import { parseStlBinary } from '../src/engine/stl';
import { computeBBox } from '../src/engine/analyze';
import { readFileSync } from 'node:fs';

const load = (p: string) => parseStlBinary(readFileSync(p).buffer.slice(0) as ArrayBuffer);
const jacket = load('IDEAL FOR THE STUDY/Cute+Sheep+++Silicone+Mold+System+/box_l.stl');
const master = load('IDEAL FOR THE STUDY/Cute+Sheep+++Silicone+Mold+System+/master_base.stl');
const axis = 0; const u = 1, v = 2;
const jb = computeBBox(jacket), mb = computeBBox(master);
const loU = Math.min(jb.min[u], mb.min[u]) - 1, hiU = Math.max(jb.max[u], mb.max[u]) + 1;
const loV = Math.min(jb.min[v], mb.min[v]) - 1, hiV = Math.max(jb.max[v], mb.max[v]) + 1;
const spanU = hiU - loU, spanV = hiV - loV;
console.log('u-span', spanU.toFixed(1), 'v-span', spanV.toFixed(1));
const oA = Math.min(jb.min[axis], mb.min[axis]) - 5;
console.log('oA', oA.toFixed(1));
const orig = [0, 0, 0];
orig[u] = loU + spanU / 2; orig[v] = loV + spanV / 2; orig[axis] = oA;
const dir = [0, 0, 0]; dir[axis] = 1;
console.log('ray orig', orig.map((n) => n.toFixed(1)).join(','));
let hits = 0;
const positions: string[] = [];
for (let t = 0; t < jacket.triVerts.length / 3; t++) {
  const p = [0, 0, 0], q = [0, 0, 0], r = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    p[k] = jacket.vertProperties[jacket.triVerts[t * 3 + k] * 3];
    q[k] = jacket.vertProperties[jacket.triVerts[t * 3 + k] * 3 + 1];
    r[k] = jacket.vertProperties[jacket.triVerts[t * 3 + k] * 3 + 2];
  }
  const e1 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
  const e2 = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
  const pv = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const denom = dir[0] * pv[0] + dir[1] * pv[1] + dir[2] * pv[2];
  if (Math.abs(denom) < 1e-12) continue;
  const inv = 1 / denom;
  const tv = [orig[0] - p[0], orig[1] - p[1], orig[2] - p[2]];
  const qq = [tv[1] * e2[2] - tv[2] * e2[1], tv[2] * e2[0] - tv[0] * e2[2], tv[0] * e2[1] - tv[1] * e2[0]];
  const bU = (dir[0] * qq[0] + dir[1] * qq[1] + dir[2] * qq[2]) * inv;
  const rr = [e1[1] * tv[2] - e1[2] * tv[1], e1[2] * tv[0] - e1[0] * tv[2], e1[0] * tv[1] - e1[1] * tv[0]];
  const bV = (dir[0] * rr[0] + dir[1] * rr[1] + dir[2] * rr[2]) * inv;
  const tH = (e1[0] * qq[0] + e1[1] * qq[1] + e1[2] * qq[2]) * inv;
  if (tH > 1e-9 && bU >= 0 && bV >= 0 && bU + bV <= 1) { hits++; positions.push((oA + tH).toFixed(1)); }
}
console.log('center-ray hits along X through box_l:', hits, positions.slice(0, 8).join(', '));
