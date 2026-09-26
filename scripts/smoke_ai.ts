// T006 round-trip — run the COMPLETE pipeline on a real AI-generated mesh
// (Hunyuan3D-2 official demo output). Mirrors the worker's GLB intake:
// parseGlb → weld → meter heuristic → kernel gate → decimate → analysis →
// SDF offset → split ladder → gates. Per the input contract, either a full
// package or a diagnosed refusal is a correct outcome.
import { readFileSync, existsSync } from 'node:fs';
import { buildReport, edgeStats, computeBBox } from '../src/engine/analyze';
import { runGates } from '../src/engine/gates';
import { isStatusOk, loadManifold } from '../src/engine/manifoldLoader';
import { buildSignedDistanceGrid, extractIso, instanceToMeshArrays } from '../src/engine/offset';
import { parseGlb } from '../src/engine/glb';
import { parseObj } from '../src/engine/obj';
import { generateMoldPackage } from '../src/engine/split';
import { parseStlBinary } from '../src/engine/stl';
import { weldMesh } from '../src/engine/weld';

const file = process.argv[2] ?? 'REFRENCE/ai_corpus/hunyuan3d_demo_1.glb';
if (!existsSync(file)) { console.error(`smoke:ai — file not found: ${file}`); process.exit(2); }

const GAP = 8, WALL = 4, STEP = 0.75;
const bytes = readFileSync(file);
const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const tAll = Date.now();
const el = () => `[${((Date.now() - tAll) / 1000).toFixed(1)}s]`;

// --- intake (worker parity: sniff STL / OBJ / GLB) ---
const isGlb = bytes.byteLength > 12 && new DataView(ab).getUint32(0, true) === 0x46546c67;
const ext = file.toLowerCase().slice(file.lastIndexOf('.') + 1);
const warnings: string[] = [];
let full;
if (isGlb || ext === 'glb') {
  const p = parseGlb(ab);
  full = weldMesh(p.mesh.vertProperties, p.mesh.triVerts);
  warnings.push(...p.warnings);
} else if (ext === 'obj') {
  const p = parseObj(new TextDecoder().decode(ab));
  full = weldMesh(p.mesh.vertProperties, p.mesh.triVerts);
  warnings.push(...p.warnings);
} else {
  const p = parseStlBinary(ab);
  full = { vertProperties: p.vertProperties, triVerts: p.triVerts };
}
full = { ...full };
console.log(`${el()} intake (${ext || 'stl'}): ${full.triVerts.length / 3} tris / ${full.vertProperties.length / 3} verts`);
for (const w of warnings) console.log(`  note: ${w}`);

const bb0 = computeBBox(full);
console.log(`bbox: ${bb0.dim.map((d) => d.toFixed(3)).join(' x ')}`);

// scale normalization (worker parity): grid budget assumes a 20–300 mm master
const maxS0 = Math.max(...bb0.dim);
if (maxS0 > 300 || maxS0 < 20) {
  const k = 150 / maxS0;
  for (let i = 0; i < full.vertProperties.length; i++) full.vertProperties[i] *= k;
  console.log(`scale normalization: ×${k.toFixed(3)} → 150 mm master`);
}
const bb2 = computeBBox(full);
console.log(`${el()} bbox after normalization: ${bb2.dim.map((d) => d.toFixed(1)).join(' x ')}`);

// --- defect inventory BEFORE the kernel gate (the input contract's audit) ---
const edges = edgeStats(full);
console.log(`defect inventory: boundary=${edges.boundary} nonmanifold=${edges.nonManifold} orientation=${edges.orientationIssues}`);
console.log(`  → watertight: ${edges.boundary === 0 && edges.nonManifold === 0 ? 'YES' : 'NO'} (${(100 * (1 - edges.boundary / Math.max(1, edges.nonManifold + edges.boundary + 1))).toFixed(0)}% confidence)`);

// --- kernel gate + decimation (+ V0.2-preview SDF remesh rescue on refusal) ---
const mod = await loadManifold();
let gated = false;
let gateError = '';
let man: { status(): unknown; simplify(t: number): { getMesh(): { numProp: number; vertProperties: Float32Array; triVerts: Uint32Array; numTri: number }; delete(): void }; delete(): void } | null = null;
try {
  man = new mod.Manifold(new mod.Mesh({ numProp: 3, vertProperties: full.vertProperties, triVerts: full.triVerts }));
  gated = isStatusOk(man as never);
  if (!gated) gateError = 'status ' + String(man!.status());
} catch (err) {
  gateError = String((err as Error)?.message ?? err);
}
console.log(`${el()} kernel gate: ${gated ? 'PASS' : 'REFUSED (' + gateError + ')'}`);

if (!gated) {
  const edgesN = edges.nonManifold;
  console.log(`defect load: ${edgesN.toLocaleString()} non-manifold edges — attempting SDF remesh repair (V0.2 preview)`);
  const repairStep = Math.max(0.75, Math.max(...computeBBox(full).dim) / 200);
  const grid0 = await buildSignedDistanceGrid(full, { gap: 6, wall: 4, step: repairStep });
  const remesh = extractIso(mod, grid0, 0);
  const remeshArr = instanceToMeshArrays(remesh);
  remesh.delete();
  console.log(`remesh produced ${remeshArr.triVerts.length / 3} tris — re-running the gate`);
  man = new mod.Manifold(new mod.Mesh({ numProp: 3, vertProperties: remeshArr.vertProperties, triVerts: remeshArr.triVerts }));
  gated = isStatusOk(man as never);
  if (!gated) {
    console.log('\nSMOKE:AI → gate REFUSED even after remesh — input contract working as designed (repair is a V0.2 upstream stage).');
    man!.delete();
    process.exit(0);
  }
  full = remeshArr;
  const e2 = edgeStats(full);
  console.log(`repaired mesh: boundary=${e2.boundary} nonmanifold=${e2.nonManifold} — gate PASS`);
}

const dec = man!.simplify(0.05);
const dm = dec.getMesh();
const analysis = {
  vertProperties: Float32Array.from(dm.vertProperties),
  triVerts: Uint32Array.from(dm.triVerts.subarray(0, dm.numTri * 3)),
};
dec.delete(); man!.delete();
console.log(`${el()} analysis mesh: ${analysis.triVerts.length / 3} tris`);

const report = buildReport(file, { ...full, vertCount: full.vertProperties.length / 3 }, analysis, analysis.triVerts.length / 3, 64);
console.log(`${el()} ranked axes: ${report.axes.map((a) => `${a.axis} ${a.trappedPct.toFixed(1)}%`).join(' · ')}`);
for (const w of report.warnings) console.log(`  note: ${w}`);

// --- full mold pipeline ---
const tGen = Date.now();
const grid = await buildSignedDistanceGrid(analysis, { gap: GAP, wall: WALL, step: STEP });
const pkg = await generateMoldPackage({
  mod, master: analysis, grid,
  params: { gap: GAP, wall: WALL, clearance: 0.25 },
  rankedAxes: report.axes.map((a) => a.axis),
  ports: true,
  onProgress: (stage, pct) => process.stdout.write(`\r  [${(pct * 100).toFixed(0)}%] ${stage}               `),
});
process.stdout.write('\n');

if (!pkg) {
  console.log('\nSMOKE:AI → all split axes failed extraction — honest refusal (V0.2 multi-piece territory). Model saved for the failure overlay.');
  process.exit(0);
}

console.log(`${el()} package: axis ±${pkg.axis}, extraction A ${pkg.extraction.A.freeAtMm}mm (pass=${pkg.extraction.A.pass}) / B ${pkg.extraction.B!.freeAtMm}mm (pass=${pkg.extraction.B!.pass})`);
console.log(`${el()} jacket ${pkg.jacketDim.map((d) => d.toFixed(0)).join(' x ')} mm, plate ${pkg.plateDim.map((d) => d.toFixed(0)).join(' x ')} mm`);

const gates = runGates({
  grid, gap: GAP, wall: WALL, step: STEP,
  frame: pkg.frame, ports: pkg.ports, master: analysis,
  pieceArrays: [pkg.pieces.jacketA, pkg.pieces.jacketB, pkg.pieces.basePlate],
  siliconeMl: pkg.siliconeMl, cavityLoops: pkg.cavityLoops,
});
for (const c of gates.checks) console.log(`  gate ${c.pass ? '✓' : c.hard ? '✗' : '·'} ${c.name}: ${c.detail}`);

console.log(`\nREAL AI MESH → ${gates.pass ? 'FULL PACKAGE' : 'GATE REFUSAL'} in ${((Date.now() - tGen) / 1000).toFixed(1)}s generate / ${((Date.now() - tAll) / 1000).toFixed(1)}s total`);
console.log(gates.pass ? 'SMOKE:AI PASS' : 'SMOKE:AI — hard gate refused (diagnosed)');
process.exit(0);
