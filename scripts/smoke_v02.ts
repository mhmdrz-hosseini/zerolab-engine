// V0.2 acceptance smoke — the full pipeline on the Cute Sheep reference doll
// (patron.stl), headless. Writes the print package to
// OUTPUT/pourbox_patron_v02/ and prints every gate + dimension for the
// reference comparison (docs/V0.2_REARCHITECTURE.md §5).
// Usage: npx tsx scripts/smoke_v02.ts [model.stl] [gap] [wall]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { contoursAtLayer } from '../src/engine/contours';
import { runGates } from '../src/engine/gates';
import { isStatusOk, loadManifold } from '../src/engine/manifoldLoader';
import { buildSignedDistanceGrid, instanceToMeshArrays } from '../src/engine/offset';
import { AXES } from '../src/engine/types';
import { buildPrintFiles } from '../src/engine/export';
import { generateMoldPackage, pickFrame } from '../src/engine/split';
import { parseStlBinary } from '../src/engine/stl';
import { buildReport, computeBBox } from '../src/engine/analyze';
import type { MeshArrays } from '../src/engine/types';

const file = process.argv[2] ?? 'IDEAL FOR THE STUDY/Cute+Sheep+++Silicone+Mold+System+/patron.stl';
const GAP = Number(process.argv[3] ?? 6);
const WALL = Number(process.argv[4] ?? 5);
const OUT_DIR = process.argv[5] ?? 'OUTPUT/pourbox_patron_v02';
if (!existsSync(file)) { console.error(`smoke:v02 — file not found: ${file}`); process.exit(2); }

const tAll = Date.now();
const el = () => `[${((Date.now() - tAll) / 1000).toFixed(1)}s]`;
let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (${detail})`);
  if (!ok) failures++;
};

// --- intake (worker parity) ---
const bytes = readFileSync(file);
const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const parsed = parseStlBinary(ab);
let full: MeshArrays = { vertProperties: parsed.vertProperties, triVerts: parsed.triVerts };
const bb0 = computeBBox(full);
console.log(`${el()} intake: ${full.triVerts.length / 3} tris, bbox ${bb0.dim.map((d) => d.toFixed(1)).join(' × ')} mm`);
const maxS0 = Math.max(...bb0.dim);
if (maxS0 > 300 || maxS0 < 20) {
  const k = 150 / maxS0;
  for (let i = 0; i < full.vertProperties.length; i++) full.vertProperties[i] *= k;
  console.log(`scale normalization ×${k.toFixed(3)}`);
  full = { ...full };
}

// --- kernel gate + decimation (worker parity) ---
const mod = await loadManifold();
const man = new mod.Manifold(new mod.Mesh({ numProp: 3, vertProperties: full.vertProperties, triVerts: full.triVerts }));
check('kernel manifold gate', isStatusOk(man), `status ${String(man.status())}`);
const dec = man.simplify(0.05);
const dm = dec.getMesh();
const analysis: MeshArrays = {
  vertProperties: Float32Array.from(dm.vertProperties),
  triVerts: Uint32Array.from(dm.triVerts.subarray(0, dm.numTri * 3)),
};
dec.delete(); man.delete();
const report = buildReport(file, { ...full, vertCount: full.vertProperties.length / 3 }, analysis, analysis.triVerts.length / 3, 64);
console.log(`${el()} analysis mesh: ${analysis.triVerts.length / 3} tris, axes ${report.axes.map((a) => `${a.axis} ${a.trappedPct.toFixed(1)}%`).join(' · ')}`);

// --- V0.2 pipeline ---
console.log(`${el()} building distance field (gap ${GAP}, wall ${WALL})`);
const grid = await buildSignedDistanceGrid(full, { gap: GAP, wall: WALL, step: 0.75 });

const quiet = new Map<string, number>();
for (const a of report.axes) {
  try {
    const fr = pickFrame(a.axis, analysis);
    const loops = contoursAtLayer(grid, AXES.indexOf(a.axis), fr.mid, -GAP);
    if (loops.length === 0) continue;
    let perim = 0, area = 0;
    for (const loop of loops) {
      for (let i = 0; i < loop.length; i++) {
        const [x1, y1] = loop[i], [x2, y2] = loop[(i + 1) % loop.length];
        perim += Math.hypot(x2 - x1, y2 - y1);
        area += x1 * y2 - x2 * y1;
      }
    }
    area = Math.abs(area) / 2;
    if (area > 1) quiet.set(a.axis, perim / (2 * Math.sqrt(Math.PI * area)));
  } catch { /* informational */ }
}
const cleanAxes = report.axes.filter((a) => a.trappedPct <= 10);
const restAxes = report.axes.filter((a) => a.trappedPct > 10);
const rankedAxes = [
  ...cleanAxes.sort((a, b) => (quiet.get(a.axis) ?? 99) - (quiet.get(b.axis) ?? 99)).map((a) => a.axis),
  ...restAxes.sort((a, b) => a.trappedPct - b.trappedPct).map((a) => a.axis),
];
console.log(`${el()} ranked axes: ${rankedAxes.join(' → ')}`);

const pkg = await generateMoldPackage({
  mod, master: full, grid,
  params: { gap: GAP, wall: WALL, clearance: 0.25 },
  rankedAxes, ports: false,
  onProgress: (stage) => console.log(stage),
});
if (!pkg) { console.error('smoke:v02 — every candidate axis failed'); process.exit(1); }
console.log(`${el()} won axis ±${pkg.axis}; rejected: ${pkg.failedAxes.map((f) => `${f.axis} (${f.reason.slice(0, 60)})`).join('; ') || 'none'}`);

const gates = runGates({
  grid, gap: GAP, wall: WALL, step: grid.step,
  frame: pkg.frame,
  ports: pkg.ports,
  master: full,
  pieceArrays: [pkg.pieces.jacketA, pkg.pieces.jacketB, pkg.pieces.basePlate],
  siliconeMl: pkg.siliconeMl,
  cavityLoops: pkg.cavityLoops, cavitySections: pkg.cavitySections,
});
for (const c of gates.checks) check(c.name, c.pass, c.detail);

// --- hollow master + fused master_base (worker parity) ---
const masterFinal = full;
const mm = new mod.Manifold(new mod.Mesh({ numProp: 3, vertProperties: masterFinal.vertProperties, triVerts: masterFinal.triVerts }));
const pm = new mod.Manifold(new mod.Mesh({ numProp: 3, vertProperties: pkg.pieces.basePlate.vertProperties, triVerts: pkg.pieces.basePlate.triVerts }));
const fused = mm.add(pm);
const masterBase = instanceToMeshArrays(fused);
fused.delete(); pm.delete(); mm.delete();

// --- package ---
const bbOf = (m: MeshArrays) => {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.vertProperties.length / 3; i++)
    for (let k = 0; k < 3; k++) {
      const x = m.vertProperties[i * 3 + k];
      if (x < min[k]) min[k] = x;
      if (x > max[k]) max[k] = x;
    }
  return [max[0] - min[0], max[1] - min[1], max[2] - min[2]] as number[];
};
const { files } = buildPrintFiles({
  masterBase,
  parts: { ...pkg.pieces, siliconeSkin: pkg.pieces.skin, master: masterFinal, masterBase },
  info: {
    name: file.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, ''),
    createdAt: new Date().toISOString(),
    params: { gap: GAP, wall: WALL, clearance: 0.25 },
    axis: pkg.axis,
    siliconeMl: pkg.siliconeMl,
    extraction: { A: pkg.extraction.A.freeAtMm, B: pkg.extraction.B!.freeAtMm },
    jacketDim: [...pkg.jacketDim],
    plateDim: [...bbOf(pkg.pieces.basePlate)],
    warnings: [...gates.warnings, ...pkg.warnings],
    checks: gates.checks,
    crown: null,
    ventCount: pkg.ports.vents.length,
  },
});
mkdirSync(OUT_DIR, { recursive: true });
for (const [path, data] of Object.entries(files)) {
  const p = `${OUT_DIR}/${path}`;
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
}
console.log(`${el()} package written to ${OUT_DIR}/`);

console.log(`\nframe: vert ${pkg.frame.vert}, pull ±${pkg.frame.pull}, base ${pkg.frame.base.toFixed(1)}, mid ${pkg.frame.mid.toFixed(1)}, crown ${pkg.frame.crown.toFixed(1)}`);
console.log(`jacket ${pkg.jacketDim.map((d) => d.toFixed(1)).join(' × ')} mm · plate ${pkg.plateDim.map((d) => d.toFixed(1)).join(' × ')} mm · silicone ${pkg.siliconeMl.toFixed(0)} mL · extraction A ${pkg.extraction.A.freeAtMm} / B ${pkg.extraction.B!.freeAtMm} mm`);

console.log(failures === 0 ? '\nSMOKE:V02 PASS' : `\nSMOKE:V02 FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
