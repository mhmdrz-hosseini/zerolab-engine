// Probe: for Spiderman-large ±Y, find WHERE jacket B first collides with the
// master under the fixed release sim — decides truthful rejection vs regression.
import { loadManifold } from '../src/engine/manifoldLoader';
import { parseStlBinary } from '../src/engine/stl';
import { buildSignedDistanceGrid } from '../src/engine/offset';
import { buildMoldForAxis } from '../src/engine/split';
import type { Axis } from '../src/engine/types';
import { readFileSync } from 'node:fs';

const mod = await loadManifold();
const bytes = readFileSync('D:/code/3d/MOLD/MOLD-generator base/input/obj_1_Spiderman urban.stl');
const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
let full = parseStlBinary(ab);
const maxDim = Math.max(...((() => {
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < full.vertProperties.length / 3; i++)
    for (let k = 0; k < 3; k++) {
      const x = full.vertProperties[i * 3 + k];
      if (x < min[k]) min[k] = x;
      if (x > max[k]) max[k] = x;
    }
  return [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
})()));
const k = 200 / maxDim;
for (let i = 0; i < full.vertProperties.length; i++) full.vertProperties[i] *= k;
console.log(`master scaled ×${k.toFixed(4)} to 200 mm`);

const grid = await buildSignedDistanceGrid(full, { gap: 6, wall: 5, step: 0.75 });
const r = await buildMoldForAxis({ mod, master: full, grid, params: { gap: 6, wall: 5, clearance: 0.35 }, axis: 'Y' as Axis, ports: false });
console.log('extraction:', JSON.stringify(r.extraction.A), JSON.stringify(r.extraction.B));

const B = new mod.Manifold(new mod.Mesh({ numProp: 3, ...r.pieces.jacketB }));
const master = new mod.Manifold(new mod.Mesh({ numProp: 3, vertProperties: full.vertProperties, triVerts: full.triVerts }));
// B pulls −Y (opposite A's tongue direction). A passes @47.55 → aDir=+1, B −1.
for (const t of [6, 8, 9, 9.5, 10.05, 10.5, 12, 20]) {
  const moved = B.translate(0, -t, 0);
  const inter = moved.intersect(master);
  const v = inter.volume();
  if (v > 0.001) {
    const bb = inter.boundingBox();
    console.log(`t=-${t}mm overlap ${v.toFixed(2)} mm³ at x[${bb.min[0].toFixed(1)},${bb.max[0].toFixed(1)}] y[${bb.min[1].toFixed(1)},${bb.max[1].toFixed(1)}] z[${bb.min[2].toFixed(1)},${bb.max[2].toFixed(1)}]`);
  } else console.log(`t=-${t}mm overlap ~0`);
  inter.delete();
  moved.delete();
}
B.delete(); master.delete();
