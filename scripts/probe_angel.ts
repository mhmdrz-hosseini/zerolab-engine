// Probe: does the frozen angel-large master_base.stl reconstruct in our kernel?
import { readFileSync } from 'node:fs';
import { loadManifold, isStatusOk } from '../src/engine/manifoldLoader';
import { parseStlBinary } from '../src/engine/stl';
import { auditMeshArrays } from '../src/engine/clean';

const mod = await loadManifold();
const p = 'OUTPUT TEST 1/obj_1_christmas_angel2__large/pourbox_obj_1_christmas_angel2/01_master/master_base.stl';
const bytes = readFileSync(p);
const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const parsed = parseStlBinary(ab);
console.log(`parsed: ${parsed.triVerts.length / 3} tris (declared ${parsed.triCountIn})`);
const a = auditMeshArrays(parsed.vertProperties, parsed.triVerts);
console.log('audit:', JSON.stringify(a));
try {
  const man = new mod.Manifold(new mod.Mesh({ numProp: 3, vertProperties: parsed.vertProperties, triVerts: parsed.triVerts }));
  console.log('kernel status:', JSON.stringify(man.status()), 'isStatusOk:', isStatusOk(man));
  if (isStatusOk(man)) console.log('kernel volume cm3:', (Math.abs(man.volume()) / 1000).toFixed(1));
  man.delete();
} catch (err) {
  console.log('kernel THREW:', err instanceof Error ? err.message : err);
}
