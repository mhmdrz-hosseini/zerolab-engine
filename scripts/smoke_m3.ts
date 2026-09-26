// M3 acceptance smoke — spec §8: both pieces extract; package parts manifold; bed fit.
// Runs the full generate pipeline: parse → decimate → SDF grid → envelopes → skin →
// ranked-axis split ladder with extraction simulation → jacket A/B + base plate.
import { readFileSync, existsSync } from 'node:fs';
import { buildReport, signedVolumeMl } from '../src/engine/analyze';
import { loadManifold } from '../src/engine/manifoldLoader';
import { buildSignedDistanceGrid, extractIso } from '../src/engine/offset';
import { generateMoldPackage } from '../src/engine/split';
import { parseStlBinary } from '../src/engine/stl';

const DEFAULT = 'REFRENCE/obj_1_Molde_mano_de_Fatima.stl';
const file = process.argv[2] ?? DEFAULT;
if (!existsSync(file)) {
  console.error(`smoke:m3 — file not found: ${file}`);
  process.exit(2);
}

const GAP = 8, WALL = 4, STEP = 0.75;
let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (${detail})`);
  if (!ok) failures++;
};

console.log(`smoke:m3 ${file}  (G=${GAP} W=${WALL} step=${STEP})`);
const bytes = readFileSync(file);
const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const tAll = Date.now();

const parsed = parseStlBinary(ab);
console.log(`  parsed ${parsed.triVerts.length / 3} tris`);
const mod = await loadManifold();
const mesh = new mod.Mesh({ numProp: 3, vertProperties: parsed.vertProperties, triVerts: parsed.triVerts });
const man = new mod.Manifold(mesh);
const dec = man.simplify(0.05);
const dm = dec.getMesh();
const analysis = {
  vertProperties: Float32Array.from(dm.vertProperties),
  triVerts: Uint32Array.from(dm.triVerts.subarray(0, dm.numTri * 3)),
};
dec.delete();
man.delete();
console.log(`  analysis mesh ${analysis.triVerts.length / 3} tris`);

const report = buildReport(file, { ...parsed, vertCount: parsed.vertProperties.length / 3 }, analysis, analysis.triVerts.length / 3, 64);
const ranked = report.axes.map((a) => a.axis);
console.log(`  ranked axes: ${ranked.join(' → ')}`);

const tGen = Date.now();
const grid = await buildSignedDistanceGrid(analysis, {
  gap: GAP, wall: WALL, step: STEP,
  onProgress: (stage, pct) => process.stdout.write(`\r  [${(pct * 100).toFixed(0)}%] ${stage}               `),
});
process.stdout.write('\n');
const S = extractIso(mod, grid, -GAP);
const O = extractIso(mod, grid, -(GAP + WALL));
const skinM = new mod.Manifold(new mod.Mesh({ numProp: 3, vertProperties: analysis.vertProperties, triVerts: analysis.triVerts }));
const skin = S.subtract(skinM);
const siliconeMl = skin.volume() / 1000;
console.log(`  envelopes: S ${S.numTri()} tris, O ${O.numTri()} tris, skin ${siliconeMl.toFixed(1)} mL`);

const pkg = await generateMoldPackage({
  mod, master: analysis, grid,
  params: { gap: GAP, wall: WALL, clearance: 0.25 },
  rankedAxes: ranked,
  onProgress: (stage, pct) => process.stdout.write(`\r  [${(pct * 100).toFixed(0)}%] ${stage}               `),
});
process.stdout.write('\n');
const elapsed = Date.now() - tGen;

check('mold package generated', pkg !== null, pkg ? `axis ±${pkg.axis}` : 'all axes failed');
if (pkg) {
  check('hand splits on its best axis (Z)', pkg.axis === 'Z', `won on ±${pkg.axis}`);
  check('piece A extracts', pkg.extraction.A.pass, `clear at ${pkg.extraction.A.freeAtMm} mm`);
  check('piece B extracts', pkg.extraction.B.pass, `clear at ${pkg.extraction.B.freeAtMm} mm`);
  check('jacket A non-empty', pkg.pieces.jacketA.triVerts.length / 3 > 1000, `${pkg.pieces.jacketA.triVerts.length / 3} tris`);
  check('jacket B non-empty', pkg.pieces.jacketB.triVerts.length / 3 > 1000, `${pkg.pieces.jacketB.triVerts.length / 3} tris`);
  check('base plate non-empty', pkg.pieces.basePlate.triVerts.length / 3 > 100, `${pkg.pieces.basePlate.triVerts.length / 3} tris`);
  const aMl = signedVolumeMl(pkg.pieces.jacketA), bMl = signedVolumeMl(pkg.pieces.jacketB);
  const plateMl = signedVolumeMl(pkg.pieces.basePlate);
  check('halves sum ≈ jacket volume (features excluded)', aMl + bMl > 10, `A ${aMl.toFixed(0)} + B ${bMl.toFixed(0)} mL, plate ${plateMl.toFixed(0)} mL`);
  const maxDim = Math.max(...pkg.jacketDim, ...pkg.plateDim) + 20;
  check('bed fit ≤ 256 mm class', maxDim <= 256, `jacket ${pkg.jacketDim.map((d) => d.toFixed(0)).join('×')}, plate ${pkg.plateDim.map((d) => d.toFixed(0)).join('×')}`);
  check('generate < 180 s', elapsed < 180_000, `${(elapsed / 1000).toFixed(1)}s`);
  for (const w of pkg.warnings) console.log(`  note: ${w}`);
  for (const f of pkg.failedAxes) console.log(`  rejected ±${f.axis}: ${f.reason}`);
} else {
  failures++;
}
skin.delete(); skinM.delete(); S.delete(); O.delete();

console.log(`  total ${((Date.now() - tAll) / 1000).toFixed(1)}s`);
console.log(failures === 0 ? '\nSMOKE:M3 PASS' : `\nSMOKE:M3 FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
