// M2 acceptance smoke — spec §8: hand gives silicone skin, 290 mL ± 20%, < 60 s.
// Runs the real engine pipeline: parse → kernel decimate → SDF grid → levelSet ×2 → skin boolean.
import { readFileSync, existsSync } from 'node:fs';
import { MeshBVH } from 'three-mesh-bvh';
import * as THREE from 'three';
import { buildSignedDistanceGrid, extractIso, instanceToMeshArrays } from '../src/engine/offset';
import { isStatusOk, loadManifold } from '../src/engine/manifoldLoader';
import { parseStlBinary } from '../src/engine/stl';

const DEFAULT = 'REFRENCE/obj_1_Molde_mano_de_Fatima.stl';
const file = process.argv[2] ?? DEFAULT;
if (!existsSync(file)) {
  console.error(`smoke:offset — file not found: ${file}`);
  process.exit(2);
}

const GAP = 8, WALL = 4, STEP = 0.75;
let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (${detail})`);
  if (!ok) failures++;
};

console.log(`smoke:offset ${file}  (G=${GAP} W=${WALL} step=${STEP})`);
const bytes = readFileSync(file);
const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const tAll = Date.now();

const parsed = parseStlBinary(ab);
console.log(`  parsed ${parsed.triVerts.length / 3} tris in ${((Date.now() - tAll) / 1000).toFixed(1)}s`);

const mod = await loadManifold();
const mesh = new mod.Mesh({ numProp: 3, vertProperties: parsed.vertProperties, triVerts: parsed.triVerts });
const man = new mod.Manifold(mesh);
const dec = man.simplify(0.05);
const dm = dec.getMesh();
const analysis = {
  vertProperties: Float32Array.from(dm.vertProperties),
  triVerts: Uint32Array.from(dm.triVerts.subarray(0, dm.numTri * 3)),
};
console.log(`  analysis mesh ${dm.numTri} tris`);
dec.delete();
man.delete();

const tGen = Date.now();
const grid = await buildSignedDistanceGrid(analysis, {
  gap: GAP, wall: WALL, step: STEP,
  onProgress: (stage, pct) => process.stdout.write(`\r  [${(pct * 100).toFixed(0)}%] ${stage}               `),
});
process.stdout.write('\n');
console.log(`  grid ${grid.dims.join(' x ')} in ${((Date.now() - tGen) / 1000).toFixed(1)}s`);

const S = extractIso(mod, grid, -GAP);
const O = extractIso(mod, grid, -(GAP + WALL));
const skinM = new mod.Manifold(new mod.Mesh({ numProp: 3, vertProperties: analysis.vertProperties, triVerts: analysis.triVerts }));
const skin = S.subtract(skinM);

const ok = (inst: { status(): number | string | { code?: number | string } }) => isStatusOk(inst);
check('silicone envelope S manifold', ok(S), `${S.numTri()} tris`);
check('jacket outer O manifold', ok(O), `${O.numTri()} tris`);
check('skin boolean manifold', ok(skin), `${skin.numTri()} tris`);

const siliconeMl = skin.volume() / 1000;
check('silicone volume 290 mL ± 20% (232–348)', siliconeMl >= 232 && siliconeMl <= 348, `${siliconeMl.toFixed(1)} mL`);

const elapsed = Date.now() - tGen;
check('generate < 60 s', elapsed < 60_000, `${(elapsed / 1000).toFixed(1)}s (grid+extracts+boolean)`);

// informational: S surface distance to master (target ≈ G in convex regions)
const geom = new THREE.BufferGeometry();
geom.setAttribute('position', new THREE.BufferAttribute(analysis.vertProperties, 3));
geom.setIndex(new THREE.BufferAttribute(analysis.triVerts, 1));
const bvh = new MeshBVH(geom);
const Sarr = instanceToMeshArrays(S);
const nV = Sarr.vertProperties.length / 3;
const dists: number[] = [];
const probe = new THREE.Vector3();
const hit = { point: new THREE.Vector3(), distance: Infinity, faceIndex: 0 };
for (let s = 0; s < 400; s++) {
  const vi = Math.floor((s * nV) / 400);
  probe.set(Sarr.vertProperties[vi * 3], Sarr.vertProperties[vi * 3 + 1], Sarr.vertProperties[vi * 3 + 2]);
  bvh.closestPointToPoint(probe, hit);
  dists.push(hit.distance);
}
dists.sort((a, b) => a - b);
const q = (p: number) => dists[Math.min(dists.length - 1, Math.floor(p * dists.length))];
console.log(`  S→master distance: p50=${q(0.5).toFixed(2)} p90=${q(0.9).toFixed(2)} max=${q(1).toFixed(2)} (target ≈ ${GAP} in convex regions; <G where offset surfaces merge)`);

skin.delete(); skinM.delete(); S.delete(); O.delete();

console.log(`  total ${((Date.now() - tAll) / 1000).toFixed(1)}s`);
console.log(failures === 0 ? '\nSMOKE:OFFSET PASS' : `\nSMOKE:OFFSET FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
