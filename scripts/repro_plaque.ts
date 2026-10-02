// Repro #2 — nastier flat model: plaque with embossed letters (varying depths),
// script ridge on the front, circle O — the "flat sign" failure class.
//   npx tsx scripts/repro_plaque.ts [--size 140]
import { readFileSync, writeFileSync } from 'node:fs';
import { buildReport, computeBBox, validateMasterMesh } from '../src/engine/analyze';
import { contoursAtLayer } from '../src/engine/contours';
import { runGates } from '../src/engine/gates';
import { isStatusOk, loadManifold } from '../src/engine/manifoldLoader';
import { buildSignedDistanceGrid, instanceToMeshArrays } from '../src/engine/offset';
import { AXES } from '../src/engine/types';
import { parseStlBinary, writeStlBinary } from '../src/engine/stl';
import { buildPrintFiles } from '../src/engine/export';
import { cleanExportMesh } from '../src/engine/clean';
import { generateMoldPackage, pickFrame } from '../src/engine/split';
import type { MeshArrays } from '../src/engine/types';

const sizeIdx = process.argv.indexOf('--size');
const SIZE = Number(sizeIdx >= 0 ? process.argv[sizeIdx + 1] : '140');

const mod = await loadManifold();
const M = mod.Manifold as unknown as { new (m: unknown): unknown; levelSet?: unknown };
const CS = mod.CrossSection as unknown as {
  square(s: [number, number]): { translate(x: number, y?: number): unknown };
  circle(r: number, seg?: number): { translate(x: number, y?: number): unknown };
};
type CSl = { add(o: CSl): CSl; subtract(o: CSl): CSl; extrude(h: number): { translate(z: number): unknown } };
const box = (x: number, y: number, w: number, h: number): CSl => CS.square([w, h]).translate(x, y) as CSl;

// plaque 150 × 60 × 8 (z 0..8), letters embossed on TOP (z 8..10 or 8..12)
let solid = box(0, 0, 150, 60).extrude(8) as unknown as { add(o: unknown): unknown; delete(): void };
const letter = (x: number, depth: number): unknown => {
  // "E" as bars, extruded to a per-letter depth above the plaque top (z=8)
  let e = box(x, 15, 6, 30) as CSl;
  e = e.add(box(x + 6, 15, 16, 6));
  e = e.add(box(x + 6, 27, 14, 6));
  e = e.add(box(x + 6, 39, 16, 6));
  return e.extrude(depth).translate(8) as unknown;
};
let x = 12;
let embossed: unknown = null;
for (const d of [4, 3, 5, 3]) {
  const l = letter(x, d);
  embossed = embossed ? (embossed as { add(o: unknown): unknown }).add(l) : l;
  x += 34;
}
// circle "O" ring as a torus-ish: circle with hole, extruded
const ring = (mod.CrossSection as unknown as { ofPolygons(p: number[][][], f?: string): CSl }).ofPolygons(
  [
    Array.from({ length: 32 }, (_, i) => [x + 15 + 15 * Math.cos((2 * Math.PI * i) / 32), 30 + 15 * Math.sin((2 * Math.PI * i) / 32)]),
    Array.from({ length: 32 }, (_, i) => [x + 15 + 8 * Math.cos(-(2 * Math.PI * i) / 32), 30 + 8 * Math.sin(-(2 * Math.PI * i) / 32)]),
  ],
  'EvenOdd',
).extrude(3.5).translate(8) as unknown;
embossed = (embossed as { add(o: unknown): unknown }).add(ring);
// script ridge: thin wavy bar across the front top of the plaque
let script: unknown = null;
for (let i = 0; i < 40; i++) {
  const bx = 8 + i * 3.4;
  const h = 2.2 + Math.sin(i * 0.7) * 0.8;
  const b = box(bx, 4, 3.2, 4).extrude(h).translate(8) as unknown;
  script = script ? (script as { add(o: unknown): unknown }).add(b) : b;
}
solid = ((solid as { add(o: unknown): unknown }).add(embossed) as { add(o: unknown): unknown }).add(script) as typeof solid;

const dm0 = (solid as unknown as { getMesh(): { vertProperties: Float32Array; triVerts: Uint32Array; numTri: number } }).getMesh();
const raw: MeshArrays = {
  vertProperties: Float32Array.from(dm0.vertProperties),
  triVerts: Uint32Array.from(dm0.triVerts.subarray(0, dm0.numTri * 3)),
};
writeFileSync('INPUT/flat_plaque.stl', Buffer.from(writeStlBinary(raw)));
console.log(`wrote INPUT/flat_plaque.stl (${raw.triVerts.length / 3} tris)`);

// --- pipeline (worker parity) ---
{
  const b = readFileSync('INPUT/flat_plaque.stl');
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  var full: MeshArrays = parseStlBinary(ab);
}
const problems = validateMasterMesh(full);
if (problems.length) { console.error(`input rejected — ${problems.join('; ')}`); process.exit(2); }
{
  const bb = computeBBox(full);
  const k = SIZE / Math.max(...bb.dim);
  for (let i = 0; i < full.vertProperties.length; i++) full.vertProperties[i] *= k;
}
console.log(`master bbox ${computeBBox(full).dim.map((d) => d.toFixed(1)).join(' × ')}`);

const man = new M(new mod.Mesh({ numProp: 3, vertProperties: full.vertProperties, triVerts: full.triVerts })) as unknown as Parameters<typeof isStatusOk>[0] & { delete(): void };
if (!isStatusOk(man)) { console.error('not manifold'); process.exit(2); }
const dec = (man as unknown as { simplify(e: number): { getMesh(): { vertProperties: Float32Array; triVerts: Uint32Array; numTri: number }; delete(): void } }).simplify(0.05);
const dm = dec.getMesh();
const analysis: MeshArrays = {
  vertProperties: Float32Array.from(dm.vertProperties),
  triVerts: Uint32Array.from(dm.triVerts.subarray(0, dm.numTri * 3)),
};
dec.delete();
const report = buildReport('plaque', { ...full, vertCount: full.vertProperties.length / 3 }, analysis, analysis.triVerts.length / 3, 64);
console.log(`axes: ${report.axes.map((a) => `${a.axis}(${a.trappedPct.toFixed(1)}%)`).join(' ')}`);

const GAP = 6, WALL = 5;
const grid = await buildSignedDistanceGrid(full, { gap: GAP, wall: WALL, step: 0.75 });
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
console.log(`ranked: ${rankedAxes.join(' → ')}`);

const pkg = await generateMoldPackage({
  mod, master: full, grid,
  params: { gap: GAP, wall: WALL, clearance: 0.35, ribs: false, panels: 2 },
  rankedAxes, ports: false,
  onProgress: (s) => console.log(`  ${s}`),
});
if (!pkg) { console.error('ALL AXES FAILED'); process.exit(1); }

const bbox = (m: MeshArrays) => {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.vertProperties.length / 3; i++)
    for (let k = 0; k < 3; k++) {
      const c = m.vertProperties[i * 3 + k];
      if (c < min[k]) min[k] = c; if (c > max[k]) max[k] = c;
    }
  return { min, max, dim: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
};
const mb = bbox(full), pb = bbox(pkg.pieces.basePlate);
console.log(`frame: vert=${pkg.frame.vert} pull=±${pkg.frame.pull} base=${pkg.frame.base.toFixed(1)}`);
console.log(`master min [${mb.min.map((v) => v.toFixed(1))}] dim [${mb.dim.map((v) => v.toFixed(1))}]`);
console.log(`plate  min [${pb.min.map((v) => v.toFixed(1))}] dim [${pb.dim.map((v) => v.toFixed(1))}]`);
const vAx = AXES.indexOf(pkg.frame.vert);
const u3 = (vAx + 1) % 3, v3 = (vAx + 2) % 3;
const covU = Math.max(0, Math.min(pb.max[u3], mb.max[u3]) - Math.max(pb.min[u3], mb.min[u3]));
const covV = Math.max(0, Math.min(pb.max[v3], mb.max[v3]) - Math.max(pb.min[v3], mb.min[v3]));
console.log(`plate covers ${(covU * covV / (mb.dim[u3] * mb.dim[v3]) * 100).toFixed(1)}% of master footprint`);

const gates = runGates({
  grid, gap: GAP, wall: WALL, step: grid.step, frame: pkg.frame, ports: pkg.ports, master: full,
  pieceArrays: [pkg.pieces.jacketA, pkg.pieces.jacketB, pkg.pieces.basePlate],
  siliconeMl: pkg.siliconeMl, cavityLoops: pkg.cavityLoops, cavitySections: pkg.cavitySections,
});
console.log(`gates pass=${gates.pass}`);
for (const c of gates.checks) if (!c.pass) console.log(`  FAIL ${c.name}: ${c.detail}`);

const mm = new M(new mod.Mesh({ numProp: 3, vertProperties: full.vertProperties, triVerts: full.triVerts })) as unknown;
const pm = new M(new mod.Mesh({ numProp: 3, vertProperties: pkg.pieces.basePlate.vertProperties, triVerts: pkg.pieces.basePlate.triVerts })) as unknown;
const fused = (mm as unknown as { add(o: unknown): unknown }).add(pm);
const masterBase = instanceToMeshArrays(fused as Parameters<typeof instanceToMeshArrays>[0]);
console.log('export-gate audits:');
for (const [name, mesh] of [['master_base', masterBase], ['jacket_A', pkg.pieces.jacketA], ['jacket_B', pkg.pieces.jacketB], ['silicone_skin', pkg.pieces.skin]] as [string, MeshArrays][]) {
  const a = cleanExportMesh(mesh).audit;
  console.log(`  ${name}: watertight=${a.watertight} boundary=${a.boundaryEdges} nonManifold=${a.nonManifoldEdges} degen=${a.degenerateTris} zeroVolComp=${a.zeroVolumeComponents}`);
}
try {
  buildPrintFiles({
    masterBase,
    parts: { ...pkg.pieces, siliconeSkin: pkg.pieces.skin, master: full, masterBase },
    info: {
      name: 'repro_plaque', createdAt: new Date().toISOString(),
      params: { gap: GAP, wall: WALL, clearance: 0.35, panels: 2 },
      axis: pkg.axis, siliconeMl: pkg.siliconeMl,
      extraction: { A: pkg.extraction.A.freeAtMm, B: pkg.extraction.B?.freeAtMm ?? 0 },
      jacketDim: [...pkg.jacketDim], plateDim: [...pb.dim],
      warnings: [], checks: gates.checks, crown: null, ventCount: 0,
    },
  });
  console.log('buildPrintFiles: OK');
} catch (err) {
  console.log(`buildPrintFiles FAILED: ${err instanceof Error ? err.message : err}`);
}
