// Repro harness — flat multi-letter text model (the "EROC" failure class):
// disjoint letters with one flat back face. Runs the exact worker/CLI pipeline
// headless and prints plate/jacket/frame diagnostics + the export gate result.
//   npx tsx scripts/repro_flat.ts [--make-input] [--gap 6] [--wall 5] [--size 140]
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { buildReport, computeBBox, validateMasterMesh } from '../src/engine/analyze';
import { contoursAtLayer } from '../src/engine/contours';
import { runGates } from '../src/engine/gates';
import { isStatusOk, loadManifold } from '../src/engine/manifoldLoader';
import { buildSignedDistanceGrid, instanceToMeshArrays } from '../src/engine/offset';
import { AXES } from '../src/engine/types';
import { parseStlBinary, writeStlBinary } from '../src/engine/stl';
import { buildPrintFiles } from '../src/engine/export';
import { cleanExportMesh } from '../src/engine/clean';
import { V02, generateMoldPackage, pickFrame } from '../src/engine/split';
import type { MeshArrays } from '../src/engine/types';

const args = process.argv.slice(2);
const arg = (n: string): string | undefined => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const INPUT = 'INPUT/flat_text.stl';
const SIZE = Number(arg('size') ?? 140);
const GAP = Number(arg('gap') ?? 6);
const WALL = Number(arg('wall') ?? 5);

// --- synthesize the flat text model: letters E R O C, 34w×50h×12d, 8mm gaps ---
async function makeFlatText(): Promise<MeshArrays> {
  const mod = await loadManifold();
  const CS = mod.CrossSection as unknown as {
    square(size: [number, number]): unknown;
    ofPolygons(p: number[][][], fill?: string): unknown;
  };
  const box = (x: number, y: number, w: number, h: number): CSl =>
    (CS.square([w, h]) as unknown as { translate(x: number, y: number): CSl }).translate(x, y);
  interface CSl { add(o: CSl): CSl; subtract(o: CSl): CSl; area(): number; extrude(h: number): { translate(z: number): unknown } }
  const letterE = (): CSl => {
    let s: CSl = box(0, 0, 8, 50);
    s = s.add(box(8, 0, 24, 9));
    s = s.add(box(8, 20.5, 20, 9));
    s = s.add(box(8, 41, 24, 9));
    return s;
  };
  const letterR = (): CSl => {
    let s: CSl = box(0, 0, 8, 50);
    s = s.add(box(8, 41, 22, 9));
    s = s.add(box(22, 25, 8, 25));
    s = s.subtract(box(10, 30, 12, 9));
    s = s.add(box(14, 22, 12, 9));
    return s;
  };
  const letterO = (): CSl => {
    const outer = [[0, 0], [30, 0], [30, 50], [0, 50]] as number[][];
    const inner = [[9, 9], [21, 9], [21, 41], [9, 41]] as number[][];
    return CS.ofPolygons([outer, inner], 'EvenOdd') as unknown as CSl;
  };
  const letterC = (): CSl => {
    let s: CSl = box(0, 0, 30, 50);
    s = s.subtract(box(9, 9, 30, 32));
    return s;
  };
  const letters = [letterE(), letterR(), letterO(), letterC()];
  let solid: unknown = null;
  let x = 0;
  for (const l of letters) {
    const ext = l.extrude(12) as unknown as { translate(x: number, y?: number, z?: number): unknown };
    const placed = ext.translate(x, 0, 0) as unknown;
    solid = solid ? (solid as { add(o: unknown): unknown }).add(placed) : placed;
    x += 34 + 8;
  }
  const man = solid as { getMesh(): { vertProperties: Float32Array; triVerts: Uint32Array; numTri: number } };
  const dm = man.getMesh();
  return {
    vertProperties: Float32Array.from(dm.vertProperties),
    triVerts: Uint32Array.from(dm.triVerts.subarray(0, dm.numTri * 3)),
  };
}

if (arg('make-input') || !existsSync(INPUT)) {
  const flat = await makeFlatText();
  writeFileSync(INPUT, Buffer.from(writeStlBinary(flat)));
  console.log(`wrote ${INPUT} (${flat.triVerts.length / 3} tris)`);
}

// --- load (worker parity: raw STL parse, kernel welds) ---
const bytes = readFileSync(INPUT);
const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
let full: MeshArrays = parseStlBinary(ab);
const problems = validateMasterMesh(full);
if (problems.length) { console.error(`input rejected — ${problems.join('; ')}`); process.exit(2); }

const bb0 = computeBBox(full);
const maxDim = Math.max(...bb0.dim);
if (Math.abs(SIZE - maxDim) > 0.01) {
  const k = SIZE / maxDim;
  for (let i = 0; i < full.vertProperties.length; i++) full.vertProperties[i] *= k;
  console.log(`scaled ×${k.toFixed(4)} to ${SIZE} mm`);
}
console.log(`master bbox ${bb0.dim.map((d) => d.toFixed(1)).join(' × ')} (pre-scale)`);

const mod = await loadManifold();
const man = new mod.Manifold(new mod.Mesh({ numProp: 3, vertProperties: full.vertProperties, triVerts: full.triVerts }));
if (!isStatusOk(man)) { console.error('not manifold'); process.exit(2); }
const dec = man.simplify(0.05);
const dm = dec.getMesh();
const analysis: MeshArrays = {
  vertProperties: Float32Array.from(dm.vertProperties),
  triVerts: Uint32Array.from(dm.triVerts.subarray(0, dm.numTri * 3)),
};
dec.delete();
const report = buildReport(INPUT, { ...full, vertCount: full.vertProperties.length / 3 }, analysis, analysis.triVerts.length / 3, 64);
console.log(`axes ranked: ${report.axes.map((a) => `${a.axis}(${a.trappedPct.toFixed(1)}%)`).join(' ')}`);

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
console.log(`ranked: ${rankedAxes.join(' → ')} (quiet: ${[...quiet.entries()].map(([k, v]) => `${k}=${v.toFixed(2)}`).join(' ')})`);

const pkg = await generateMoldPackage({
  mod, master: full, grid,
  params: { gap: GAP, wall: WALL, clearance: 0.35, ribs: false, panels: 2 },
  rankedAxes, ports: false,
  onProgress: (s) => console.log(`  ${s}`),
});
if (!pkg) { console.error('ALL AXES FAILED'); process.exit(1); }

// --- diagnostics ---
const bbox = (m: MeshArrays) => {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.vertProperties.length / 3; i++)
    for (let k = 0; k < 3; k++) {
      const x = m.vertProperties[i * 3 + k];
      if (x < min[k]) min[k] = x; if (x > max[k]) max[k] = x;
    }
  return { min, max, dim: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
};
const mb = bbox(full);
const pb = bbox(pkg.pieces.basePlate);
const ja = bbox(pkg.pieces.jacketA);
const jb = bbox(pkg.pieces.jacketB);
console.log(`\nframe: vert=${pkg.frame.vert} pull=±${pkg.frame.pull} base=${pkg.frame.base.toFixed(1)} mid=${pkg.frame.mid.toFixed(1)} crown=${pkg.frame.crown.toFixed(1)}`);
console.log(`master bbox  min [${mb.min.map((v) => v.toFixed(1))}] dim [${mb.dim.map((v) => v.toFixed(1))}]`);
console.log(`plate bbox   min [${pb.min.map((v) => v.toFixed(1))}] dim [${pb.dim.map((v) => v.toFixed(1))}]`);
console.log(`jacketA bbox min [${ja.min.map((v) => v.toFixed(1))}] dim [${ja.dim.map((v) => v.toFixed(1))}]`);
console.log(`jacketB bbox min [${jb.min.map((v) => v.toFixed(1))}] dim [${jb.dim.map((v) => v.toFixed(1))}]`);

// plate coverage: fraction of the master's vert-axis footprint covered by the plate
const vAx = AXES.indexOf(pkg.frame.vert);
const u3 = (vAx + 1) % 3, v3 = (vAx + 2) % 3;
const coveredU = Math.max(0, Math.min(pb.max[u3], mb.max[u3]) - Math.max(pb.min[u3], mb.min[u3]));
const coveredV = Math.max(0, Math.min(pb.max[v3], mb.max[v3]) - Math.max(pb.min[v3], mb.min[v3]));
const masterFootprint = mb.dim[u3] * mb.dim[v3];
console.log(`plate/master footprint overlap in (u,w): ${(coveredU * coveredV / masterFootprint * 100).toFixed(1)}% of master shadow`);
console.log(`plate dim vs master dim (u,w): plate [${pb.dim[u3].toFixed(1)} × ${pb.dim[v3].toFixed(1)}] master [${mb.dim[u3].toFixed(1)} × ${mb.dim[v3].toFixed(1)}]`);

// gates
const gates = runGates({
  grid, gap: GAP, wall: WALL, step: grid.step, frame: pkg.frame, ports: pkg.ports, master: full,
  pieceArrays: [pkg.pieces.jacketA, pkg.pieces.jacketB, pkg.pieces.basePlate],
  siliconeMl: pkg.siliconeMl, cavityLoops: pkg.cavityLoops, cavitySections: pkg.cavitySections,
});
console.log(`\ngates pass=${gates.pass}`);
for (const c of gates.checks) if (!c.pass) console.log(`  FAIL ${c.name}: ${c.detail}`);

// export gate (what the user hit)
const mm = new mod.Manifold(new mod.Mesh({ numProp: 3, vertProperties: full.vertProperties, triVerts: full.triVerts }));
const pm = new mod.Manifold(new mod.Mesh({ numProp: 3, vertProperties: pkg.pieces.basePlate.vertProperties, triVerts: pkg.pieces.basePlate.triVerts }));
const fused = mm.add(pm);
const masterBase = instanceToMeshArrays(fused);
console.log(`\nexport-gate audits (cleanExportMesh):`);
for (const [name, mesh] of [['master_base', masterBase], ['jacket_A', pkg.pieces.jacketA], ['jacket_B', pkg.pieces.jacketB], ['silicone_skin', pkg.pieces.skin]] as [string, MeshArrays][]) {
  const a = cleanExportMesh(mesh).audit;
  console.log(`  ${name}: watertight=${a.watertight} boundary=${a.boundaryEdges} nonManifold=${a.nonManifoldEdges} degen=${a.degenerateTris} zeroVolComp=${a.zeroVolumeComponents} comps=${a.components} tris=${a.tris}`);
}
try {
  buildPrintFiles({
    masterBase,
    parts: { ...pkg.pieces, siliconeSkin: pkg.pieces.skin, master: full, masterBase },
    info: {
      name: 'repro_flat', createdAt: new Date().toISOString(),
      params: { gap: GAP, wall: WALL, clearance: 0.35, panels: 2 },
      axis: pkg.axis, siliconeMl: pkg.siliconeMl,
      extraction: { A: pkg.extraction.A.freeAtMm, B: pkg.extraction.B?.freeAtMm ?? 0 },
      jacketDim: [...pkg.jacketDim], plateDim: [pb.dim[0], pb.dim[1], pb.dim[2]],
      warnings: [], checks: gates.checks, crown: null, ventCount: 0,
    },
  });
  console.log('buildPrintFiles: OK');
} catch (err) {
  console.log(`buildPrintFiles FAILED: ${err instanceof Error ? err.message : err}`);
}
console.log(`\nsilicone ${pkg.siliconeMl.toFixed(0)} mL · jacket ${pkg.jacketDim.map((d) => d.toFixed(0)).join('×')} · plate T ${V02.plateT} margin ${V02.plateMargin} freeboard ${V02.freeboard}`);
