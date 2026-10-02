import { readFileSync } from 'node:fs';
import { loadManifold } from '../src/engine/manifoldLoader';
import { parseStlBinary } from '../src/engine/stl';
const mod = await loadManifold();
const bytes = readFileSync('IDEAL FOR THE STUDY/Cute+Sheep+++Silicone+Mold+System+/master_base.stl');
const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const parsed = parseStlBinary(ab);
const man = new mod.Manifold(new mod.Mesh({ numProp: 3, vertProperties: parsed.vertProperties, triVerts: parsed.triVerts }));
const rot = man.rotate(90, 0, 0).rotate(0, 0, 90);
const slicer = rot as unknown as { slice(h: number): any };
for (const z of [20, 40, 60, 70, 80, 90, 100]) {
  const s = slicer.slice(z);
  const polys = s.toPolygons();
  const nv = polys.reduce((a: number, p: number[][]) => a + p.length, 0);
  const t = Date.now();
  const off = s.offset(6.1, 'Round', 2, 48);
  const dt = Date.now() - t;
  const nvo = off.toPolygons().reduce((a: number, p: number[][]) => a + p.length, 0);
  console.log(`z=${z}: slice ${nv} verts (${polys.length} polys) → offset ${dt}ms → ${nvo} verts`);
  s.delete(); off.delete();
}
