// M1 smoke test — runs the real engine modules on the reference corpus.
// Usage: npm run smoke [path/to/model.stl]   (default: Fatima hand)
import { readFileSync, existsSync } from 'node:fs';
import { buildReport } from '../src/engine/analyze';
import { isStatusOk, loadManifold } from '../src/engine/manifoldLoader';
import { parseStlBinary } from '../src/engine/stl';

const DEFAULT = 'REFRENCE/obj_1_Molde_mano_de_Fatima.stl';
const file = process.argv[2] ?? DEFAULT;
if (!existsSync(file)) {
  console.error(`smoke: file not found: ${file}`);
  process.exit(2);
}

let failures = 0;
function check(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (${detail})`);
  if (!ok) failures++;
}

console.log(`smoke: ${file}`);
const bytes = readFileSync(file);
const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const t0 = Date.now();
const parsed = parseStlBinary(ab, (p) => process.stdout.write(`\rparse ${(p * 100).toFixed(0)}%`));
process.stdout.write('\n');
const triCount = parsed.triVerts.length / 3;
console.log(`  parsed ${triCount} tris, ${parsed.vertProperties.length / 3} verts in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
check('binary STL parsed', triCount > 0, `${triCount} tris`);

// kernel: manifold gate + decimation (spec §4-A)
const mod = await loadManifold();
const mesh = new mod.Mesh({ numProp: 3, vertProperties: parsed.vertProperties, triVerts: parsed.triVerts });
const man = new mod.Manifold(mesh);
const st = man.status();
check('kernel manifold gate', isStatusOk(man), `status ${String(st)}`);
const dec = man.simplify(0.05);
const dm = dec.getMesh();
const analysis = {
  vertProperties: Float32Array.from(dm.vertProperties),
  triVerts: Uint32Array.from(dm.triVerts.subarray(0, dm.numTri * 3)),
};
console.log(`  decimated to ${dm.numTri} tris`);
dec.delete();
man.delete();

const report = buildReport(file, { ...parsed, vertCount: parsed.vertProperties.length / 3 }, analysis, dm.numTri, 64);
console.log(`  bbox ${report.bbox.dim.map((d) => d.toFixed(1)).join(' x ')} mm · ${report.volumeMl.toFixed(1)} mL`);
console.log(`  axes: ${report.axes.map((a) => `${a.axis} ${a.trappedPct.toFixed(1)}%`).join(' · ')}`);

const isHand = file.includes('Fatima') || file.includes('mano');
if (isHand) {
  check('hand watertight', report.watertight, `${report.boundaryEdges} boundary / ${report.nonManifoldEdges} non-manifold`);
  check('hand volume ≈ 218 mL', report.volumeMl > 180 && report.volumeMl < 260, `${report.volumeMl.toFixed(1)} mL`);
  check('hand bbox ≈ 123×148×32', report.bbox.dim.every((d, i) => Math.abs(d - [123.4, 148.1, 32.2][i]) < 5), report.bbox.dim.map((d) => d.toFixed(1)).join(' x '));
  check('hand best pull axis = Z', report.bestAxis === 'Z', report.bestAxis);
  check('hand Z straight pull clean (<5% trapped)', (report.axes.find((a) => a.axis === 'Z')?.trappedPct ?? 100) < 5, `${report.axes.find((a) => a.axis === 'Z')?.trappedPct.toFixed(2)}%`);
} else {
  check('report produced', report.axes.length === 3, `best ${report.bestAxis}`);
}

console.log(failures === 0 ? '\nSMOKE PASS' : `\nSMOKE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
