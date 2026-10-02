// Stage-time profile of the full generate path (worker parity).
//   npx tsx scripts/debug_profile.ts <model.stl> [sizeMm]
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { buildReport, computeBBox, validateMasterMesh } from '../src/engine/analyze';
import { contoursAtLayer } from '../src/engine/contours';
import { runGates } from '../src/engine/gates';
import { isStatusOk, loadManifold } from '../src/engine/manifoldLoader';
import { buildSignedDistanceGrid, instanceToMeshArrays } from '../src/engine/offset';
import { analyzePieces } from '../src/engine/printability';
import { cleanExportMesh } from '../src/engine/clean';
import { AXES } from '../src/engine/types';
import { parseStlBinary } from '../src/engine/stl';
import { generateMoldPackage, pickFrame } from '../src/engine/split';
import type { MeshArrays } from '../src/engine/types';

const file = process.argv[2] ?? 'INPUT/obj_1_Spiderman urban.stl';
const sizeArg = process.argv[3];
const SIZE = sizeArg ? Number(sizeArg) : undefined;

const t0 = Date.now();
const LIVE = 'OUTPUT/profile_live.log';
writeFileSync(LIVE, '');
const t = (label: string): void => {
  const line = `  ${((Date.now() - t0) / 1000).toFixed(1)}s  ${label}`;
  console.log(line); appendFileSync(LIVE, line + '\n');
};

const bytes = readFileSync(file);
const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
let full: MeshArrays = parseStlBinary(ab);
const problems = validateMasterMesh(full);
if (problems.length) { console.error(problems.join('; ')); process.exit(2); }
if (SIZE) {
  const bb = computeBBox(full);
  const k = SIZE / Math.max(...bb.dim);
  for (let i = 0; i < full.vertProperties.length; i++) full.vertProperties[i] *= k;
}
const bb0 = computeBBox(full);
console.log(`${file.split(/[\\/]/).pop()} · ${(full.triVerts.length / 3 / 1e3).toFixed(0)}k tris · bbox ${bb0.dim.map((d) => d.toFixed(0)).join('×')}mm`);

const mod = await loadManifold();
t('kernel load');
const man = new mod.Manifold(new mod.Mesh({ numProp: 3, vertProperties: full.vertProperties, triVerts: full.triVerts }));
if (!isStatusOk(man)) { console.error('not manifold'); process.exit(2); }
const dec = man.simplify(0.05);
const dm = dec.getMesh();
const analysis: MeshArrays = {
  vertProperties: Float32Array.from(dm.vertProperties),
  triVerts: Uint32Array.from(dm.triVerts.subarray(0, dm.numTri * 3)),
};
dec.delete();
t('decimate');
const report = buildReport(file, { ...full, vertCount: full.vertProperties.length / 3 }, analysis, analysis.triVerts.length / 3, 64);
t('buildReport (axis ray casting)');

const GAP = 6, WALL = 5;
const grid = await buildSignedDistanceGrid(full, { gap: GAP, wall: WALL, step: 0.75 });
t(`SDF grid ${grid.dims.join('×')} = ${(grid.dims[0] * grid.dims[1] * grid.dims[2] / 1e6).toFixed(0)}M cells`);

const quiet = new Map<string, number>();
for (const a of report.axes) {
  try {
    const fr = pickFrame(a.axis, analysis);
    const loops = contoursAtLayer(grid, AXES.indexOf(a.axis), fr.mid, -GAP);
    if (loops.length === 0) continue;
    let perim = 0, area = 0;
    for (const loop of loops) for (let i = 0; i < loop.length; i++) {
      const [x1, y1] = loop[i], [x2, y2] = loop[(i + 1) % loop.length];
      perim += Math.hypot(x2 - x1, y2 - y1); area += x1 * y2 - x2 * y1;
    }
    if (Math.abs(area) / 2 > 1) quiet.set(a.axis, perim / (2 * Math.sqrt(Math.PI * Math.abs(area) / 2)));
  } catch { /* informational */ }
}
t('quiet metric');
const rankedAxes = report.axes.slice().sort((a, b) => a.trappedPct - b.trappedPct).map((a) => a.axis);

let lastStage = 'start'; let lastT = Date.now();
const pkg = await generateMoldPackage({
  mod, master: full, grid,
  params: { gap: GAP, wall: WALL, clearance: 0.35, ribs: false, panels: 2 },
  rankedAxes, ports: false,
  onProgress: (stage) => {
    const now = Date.now();
    const line = `      · ${((now - lastT) / 1000).toFixed(1)}s ${lastStage}`;
    console.log(line); appendFileSync(LIVE, line + '\n');
    lastStage = stage; lastT = now;
  },
});
t(`generateMoldPackage (${pkg ? `±${pkg.axis}` : 'FAILED'})`);
if (!pkg) process.exit(1);

const gates = runGates({
  grid, gap: GAP, wall: WALL, step: grid.step, frame: pkg.frame, ports: pkg.ports, master: full,
  pieceArrays: [pkg.pieces.jacketA, pkg.pieces.jacketB, pkg.pieces.basePlate],
  siliconeMl: pkg.siliconeMl, cavityLoops: pkg.cavityLoops, cavitySections: pkg.cavitySections,
});
t(`runGates (${gates.checks.filter((c) => c.hard).every((c) => c.pass) ? 'pass' : 'FAIL'})`);

const mm = new mod.Manifold(new mod.Mesh({ numProp: 3, vertProperties: full.vertProperties, triVerts: full.triVerts }));
const pm = new mod.Manifold(new mod.Mesh({ numProp: 3, vertProperties: pkg.pieces.basePlate.vertProperties, triVerts: pkg.pieces.basePlate.triVerts }));
const fused = mm.add(pm);
const masterBase = instanceToMeshArrays(fused);
t('master/base fusion');
analyzePieces({ mod, masterBase, jackets: [{ name: 'jacket_A', mesh: pkg.pieces.jacketA }, { name: 'jacket_B', mesh: pkg.pieces.jacketB }], vert: pkg.frame.vert, base: pkg.frame.base, crown: pkg.frame.crown, plateT: pkg.plateT });
t('printability');
for (const [name, mesh] of [['master_base', masterBase], ['jacket_A', pkg.pieces.jacketA], ['jacket_B', pkg.pieces.jacketB], ['skin', pkg.pieces.skin]] as [string, MeshArrays][]) {
  const s = Date.now();
  const a = cleanExportMesh(mesh, mod).audit;
  console.log(`      · ${((Date.now() - s) / 1000).toFixed(1)}s cleanExportMesh ${name} (${(mesh.triVerts.length / 3 / 1e3).toFixed(0)}k tris) → ${a.watertight ? 'clean' : `FAIL b${a.boundaryEdges} nm${a.nonManifoldEdges} d${a.degenerateTris}`} pinched=${a.pinchedEdges}`);
}
t('export cleanup');
console.log(`TOTAL ${((Date.now() - t0) / 1000).toFixed(1)}s`);
