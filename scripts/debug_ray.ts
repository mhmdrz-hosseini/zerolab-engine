// Debug: single center-ray through box_l along Z.
import { parseStlBinary } from '../src/engine/stl';
import { readFileSync } from 'node:fs';

const load = (p: string) => parseStlBinary(readFileSync(p).buffer.slice(0) as ArrayBuffer);
const box = load('IDEAL FOR THE STUDY/Cute+Sheep+++Silicone+Mold+System+/box_l.stl');
const mas = load('IDEAL FOR THE STUDY/Cute+Sheep+++Silicone+Mold+System+/master_base.stl');
console.log('box tris', box.triVerts.length / 3, '| master tris', mas.triVerts.length / 3);

const bb = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] };
for (let i = 0; i < mas.vertProperties.length / 3; i++) {
  for (let k = 0; k < 3; k++) {
    const v = mas.vertProperties[i * 3 + k];
    if (v < bb.min[k]) bb.min[k] = v;
    if (v > bb.max[k]) bb.max[k] = v;
  }
}
console.log('master bbox min', bb.min.map((v) => v.toFixed(1)).join(','), 'max', bb.max.map((v) => v.toFixed(1)).join(','));

const px = (bb.min[0] + bb.max[0]) / 2, py = (bb.min[1] + bb.max[1]) / 2, oZ = bb.min[2] - 10;
const hits: number[] = [];
for (let t = 0; t < box.triVerts.length / 3; t++) {
  const p = [0, 0, 0], q = [0, 0, 0], r = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    p[k] = box.vertProperties[box.triVerts[t * 3 + k] * 3];
    q[k] = box.vertProperties[box.triVerts[t * 3 + k] * 3 + 1];
    r[k] = box.vertProperties[box.triVerts[t * 3 + k] * 3 + 2];
  }
  const e1 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
  const e2 = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
  const pv = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  if (Math.abs(pv[2]) < 1e-12) continue;
  const inv = 1 / pv[2];
  const tv = [px - p[0], py - p[1], oZ - p[2]];
  const qq = [tv[1] * e2[2] - tv[2] * e2[1], tv[2] * e2[0] - tv[0] * e2[2], tv[0] * e2[1] - tv[1] * e2[0]];
  const bU = qq[2] * inv;
  const rr = [e1[1] * tv[2] - e1[2] * tv[1], e1[2] * tv[0] - e1[0] * tv[2], e1[0] * tv[1] - e1[1] * tv[0]];
  const bV = rr[2] * inv;
  const tH = (e1[0] * qq[0] + e1[1] * qq[1] + e1[2] * qq[2]) * inv;
  if (tH > 1e-9 && bU >= 0 && bV >= 0 && bU + bV <= 1) hits.push(oZ + tH);
}
console.log('center-ray crossings through box_l along Z:', hits.length, hits.map((v) => v.toFixed(1)).join(', '));
