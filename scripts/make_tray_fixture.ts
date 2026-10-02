// Flat-back plaque STL fixture for the tray browser E2E.
import { writeFileSync, mkdirSync } from 'node:fs';
import { loadManifold } from '../src/engine/manifoldLoader';
import { writeStlBinary } from '../src/engine/stl';

const mod = await loadManifold();
// flat-back 46×34×5 mm plaque with one raised boss — a clean front_only tray
// candidate: depth/span = 7.5/34 = 0.22 stays under the selector's 0.25 filter
const slab = mod.Manifold.cube([46, 34, 5]);
const boss = mod.Manifold.cube([20, 10, 2.5]).translate(10, 12, 5);
const m = slab.add(boss);
const dm = m.getMesh();
const arr = {
  vertProperties: Float32Array.from(dm.vertProperties),
  triVerts: Uint32Array.from(dm.triVerts.subarray(0, dm.numTri * 3)),
};
mkdirSync('scratch', { recursive: true });
writeFileSync('scratch/tray_plaque.stl', Buffer.from(writeStlBinary(arr)));
console.log('fixture written:', dm.numTri, 'tris');
