// smoke:print — V0.5 printability-expansion corpus run (commits 4–6 scope):
// generates the standard corpus (hand + sheep doll + Spider-Man, 2-piece) and
// asserts the expanded analyzer output: island data present and deterministic,
// bed/slenderness/brim fields sane, precision-band warnings computed. This is
// the deterministic criterion the hard-gate flip (commit 9) will re-use.
import { readFileSync, existsSync } from 'node:fs';
import { buildReport } from '../src/engine/analyze';
import { isStatusOk, loadManifold } from '../src/engine/manifoldLoader';
import { buildSignedDistanceGrid, instanceToMeshArrays } from '../src/engine/offset';
import { analyzePieces } from '../src/engine/printability';
import { generateMoldPackage, V02 } from '../src/engine/split';
import { parseStlBinary } from '../src/engine/stl';
import type { MeshArrays } from '../src/engine/types';

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (${detail})`);
  if (!ok) failures++;
};

const CORPUS: { name: string; file: string }[] = [
  { name: 'hand', file: 'REFRENCE/obj_1_Molde_mano_de_Fatima.stl' },
  { name: 'sheep', file: 'IDEAL FOR THE STUDY/Cute+Sheep+++Silicone+Mold+System+/patron.stl' },
  { name: 'spiderman', file: 'INPUT/obj_1_Spiderman urban.stl' },
];

for (const model of CORPUS) {
  if (!existsSync(model.file)) {
    console.error(`smoke:print — missing corpus file ${model.file}`);
    process.exit(2);
  }
  const bytes = readFileSync(model.file);
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const parsed = parseStlBinary(ab);
  const mod = await loadManifold();
  const mesh = new mod.Mesh({ numProp: 3, vertProperties: parsed.vertProperties, triVerts: parsed.triVerts });
  const man = new mod.Manifold(mesh);
  if (!isStatusOk(man)) { check(`${model.name}: intake`, false, 'not manifold'); continue; }
  const dec = man.simplify(0.05);
  const dm = dec.getMesh();
  const analysis: MeshArrays = {
    vertProperties: Float32Array.from(dm.vertProperties),
    triVerts: Uint32Array.from(dm.triVerts.subarray(0, dm.numTri * 3)),
  };
  dec.delete(); man.delete();
  buildReport(model.file, { ...parsed, vertCount: parsed.vertProperties.length / 3 }, analysis, analysis.triVerts.length / 3, 64);
  const grid = await buildSignedDistanceGrid(analysis, { gap: 8, wall: 4, step: 0.75 });
  const pkg = await generateMoldPackage({
    mod, master: analysis, grid,
    params: { gap: 8, wall: 4, clearance: 0.25 },
    rankedAxes: ['X', 'Y', 'Z'], ports: false,
  });
  if (!pkg) { check(`${model.name}: mold generated`, false, 'all axes failed'); continue; }
  check(`${model.name}: mold generated`, true, `axis ±${pkg.axis}`);

  // master_base fusion (worker/CLI parity)
  const mm = new mod.Manifold(new mod.Mesh({ numProp: 3, vertProperties: analysis.vertProperties, triVerts: analysis.triVerts }));
  const pm = new mod.Manifold(new mod.Mesh({ numProp: 3, vertProperties: pkg.pieces.basePlate.vertProperties, triVerts: pkg.pieces.basePlate.triVerts }));
  const fused = mm.add(pm);
  const masterBase = instanceToMeshArrays(fused);
  fused.delete(); pm.delete(); mm.delete();

  const is3 = !!(pkg.pieces.jacketB1 && pkg.pieces.jacketB2);
  const jacketsArg = is3
    ? [{ name: 'jacket_A', mesh: pkg.pieces.jacketA }, { name: 'jacket_B1', mesh: pkg.pieces.jacketB1! }, { name: 'jacket_B2', mesh: pkg.pieces.jacketB2! }]
    : [{ name: 'jacket_A', mesh: pkg.pieces.jacketA }, { name: 'jacket_B', mesh: pkg.pieces.jacketB! }];
  const report1 = analyzePieces({
    mod, masterBase, jackets: jacketsArg,
    vert: pkg.frame.vert, base: pkg.frame.base, crown: pkg.frame.crown, plateT: V02.plateT,
    pull: pkg.axis, mid: pkg.frame.mid,
  });
  const report2 = analyzePieces({
    mod, masterBase, jackets: jacketsArg,
    vert: pkg.frame.vert, base: pkg.frame.base, crown: pkg.frame.crown, plateT: V02.plateT,
    pull: pkg.axis, mid: pkg.frame.mid,
  });
  for (const [part, r] of Object.entries(report1)) {
    check(`${model.name}/${part}: fields present`,
      Number.isFinite(r.bedAreaMm2) && Number.isFinite(r.overhangAreaMm2)
        && Array.isArray(r.unsupportedIslands) && ['LOW', 'MEDIUM', 'HIGH'].includes(r.islandRisk)
        && Number.isFinite(r.slenderness) && [0, 3, 5, 8].includes(r.brimMm) && ['LOW', 'MEDIUM', 'HIGH'].includes(r.bedRisk)
        && Number.isFinite(r.precisionOverhangMm2) && ['CLEAR', 'WARN'].includes(r.precisionRisk),
      `bed ${r.bedAreaMm2} · overhang ${r.overhangAreaMm2} mm² · islands ${r.unsupportedIslands.length} (${r.islandRisk}) · brim ${r.brimMm} (${r.bedRisk}) · precision ${r.precisionOverhangMm2} mm² (${r.precisionRisk})`);
    check(`${model.name}/${part}: deterministic`, JSON.stringify(r) === JSON.stringify(report2[part]), 'two runs identical');
    check(`${model.name}/${part}: island areas ≥ warn threshold`, r.unsupportedIslands.every((i) => i.areaMm2 >= 4), `${r.unsupportedIslands.length} islands`);
    check(`${model.name}/${part}: slenderness ↔ brim ladder consistent`,
      (r.slenderness < 2.0 ? r.brimMm <= 3 : r.slenderness < 2.5 ? r.brimMm <= 5 : r.brimMm === 8)
        && (r.bedRisk === 'HIGH') === (r.slenderness >= 2.5),
      `slender ${r.slenderness} → brim ${r.brimMm}, risk ${r.bedRisk}`);
  }
}

console.log(failures === 0 ? '\nSMOKE:PRINT PASS' : `\nSMOKE:PRINT FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
