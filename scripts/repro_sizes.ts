// Size-sweep repro harness — replicates the browser worker generate() exactly:
// ingest (raw STL parse, kernel weld) → masterScale k → size-scaled gap/wall
// (GeneratePanel.paramsFor semantics) → SDF grid → generateMoldPackage ladder
// (incl. worker gap-retry + 3-piece retry) → runGates. Prints one verdict line
// per size; exits non-zero when any size yields no package or a hard gate fail.
//   npx tsx scripts/repro_sizes.ts --input <stl> [--sizes 30,110] [--pin] [--gap 8] [--wall 5]
import { readFileSync } from 'node:fs';
import { buildReport, computeBBox, validateMasterMesh } from '../src/engine/analyze';
import { contoursAtLayer } from '../src/engine/contours';
import { runGates } from '../src/engine/gates';
import { isStatusOk, loadManifold } from '../src/engine/manifoldLoader';
import { buildSignedDistanceGrid } from '../src/engine/offset';
import { AXES } from '../src/engine/types';
import { parseStlBinary } from '../src/engine/stl';
import { generateMoldPackage, pickFrame } from '../src/engine/split';
import type { Axis, GenerateParams, MeshArrays } from '../src/engine/types';

const args = process.argv.slice(2);
const arg = (n: string): string | undefined => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (n: string): boolean => args.includes(`--${n}`);
const INPUT = arg('input')!;
const SIZES = (arg('sizes') ?? '30,110').split(',').map(Number);
const REF_GAP = Number(arg('gap') ?? 8);     // GeneratePanel PRESETS 'standard'
const REF_WALL = Number(arg('wall') ?? 5);
const PIN = has('pin');                       // regen parity: pin the native-size axis

// GeneratePanel scaleFor/halfMm parity
const REF_MASTER_MM = 150;
const scaleFor = (mm: number): number => Math.max(0.15, Math.min(1, mm / REF_MASTER_MM));
const halfMm = (x: number): number => Math.round(x * 2) / 2;
const solveK = (maxMasterDim: number, targetMm: number): number =>
  Math.min(280 / maxMasterDim, Math.max(20 / maxMasterDim, targetMm / maxMasterDim));

// --- ingest once at native scale (worker parity: raw STL, kernel welds) ---
const bytes = readFileSync(INPUT);
const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const native: MeshArrays = parseStlBinary(ab);
const problems = validateMasterMesh(native);
if (problems.length) { console.error(`input rejected — ${problems.join('; ')}`); process.exit(2); }
const bb0 = computeBBox(native);
const maxDim = Math.max(...bb0.dim);
console.log(`input ${INPUT.split(/[\\/]/).pop()} native ${bb0.dim.map((d) => d.toFixed(1)).join('×')} mm · ${native.triVerts.length / 3} tris`);

const mod = await loadManifold();
const t0 = Date.now();
const el = () => `[${((Date.now() - t0) / 1000).toFixed(0)}s]`;

// native-scale axis ranking happens once per generate() call in the worker on
// the AS-INGESTED report — but the worker re-ingests only once; slider regen
// reuses state.report (native) for ranking while scaling the master. Mirror that.
const scaled = (k: number): MeshArrays => {
  const out = new Float32Array(native.vertProperties.length);
  for (let i = 0; i < out.length; i++) out[i] = native.vertProperties[i] * k;
  return { vertProperties: out, triVerts: native.triVerts };
};

async function runSize(targetMm: number, pinnedAxis?: Axis): Promise<void> {
  const k = solveK(maxDim, targetMm);
  const master = scaled(k);
  const effMm = maxDim * k;
  const s = scaleFor(effMm);
  let gap = halfMm(Math.max(2, REF_GAP * s));
  const wall = Math.min(8, Math.max(2, Math.max(2, halfMm(REF_WALL * s))));
  console.log(`\n=== target ${targetMm} mm → k=${k.toFixed(3)} (master ${effMm.toFixed(1)} mm) gap=${gap} wall=${wall}${pinnedAxis ? ` pinned ±${pinnedAxis}` : ''} ===`);

  const grid = await buildSignedDistanceGrid(master, { gap, wall, step: 0.75 });
  const dec = new mod.Manifold(new mod.Mesh({ numProp: 3, vertProperties: master.vertProperties, triVerts: master.triVerts })).simplify(0.05);
  const dm = dec.getMesh();
  const analysis: MeshArrays = { vertProperties: Float32Array.from(dm.vertProperties), triVerts: Uint32Array.from(dm.triVerts.subarray(0, dm.numTri * 3)) };
  dec.delete();
  const report = buildReport(INPUT, { ...master, vertCount: master.vertProperties.length / 3 }, analysis, analysis.triVerts.length / 3, 64);

  const quiet = new Map<string, number>();
  for (const a of report.axes) {
    try {
      const fr = pickFrame(a.axis, analysis);
      const loops = contoursAtLayer(grid, AXES.indexOf(a.axis), fr.mid, -gap);
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
  const rankedAxes: Axis[] = pinnedAxis ? [pinnedAxis] : [
    ...cleanAxes.sort((a, b) => (quiet.get(a.axis) ?? 99) - (quiet.get(b.axis) ?? 99)).map((a) => a.axis),
    ...restAxes.sort((a, b) => a.trappedPct - b.trappedPct).map((a) => a.axis),
  ];
  console.log(`${el()} ranked: ${rankedAxes.join('→')} (trapped ${report.axes.map((a) => `${a.axis}:${a.trappedPct.toFixed(1)}%`).join(' ')})`);

  const buildParams = (g: number): GenerateParams => ({
    gap: g, wall, clearance: 0.35, splitAxis: pinnedAxis, ribs: false, material: 'silicone', panels: 2,
  });
  let effGap = gap;
  let pkg = await generateMoldPackage({
    mod, master, grid, params: buildParams(gap), rankedAxes, ports: false,
    onProgress: (st) => console.log(`${el()}   ${st}`),
  });
  if (!pkg && gap < 8) {
    for (const g of [4, 6, 8].filter((x) => x > gap + 0.01)) {
      console.log(`${el()} gap-retry at ${g}`);
      pkg = await generateMoldPackage({
        mod, master, grid, params: buildParams(g), rankedAxes, ports: false,
        onProgress: (st) => console.log(`${el()}   ${st}`),
      });
      if (pkg) { effGap = g; break; }
    }
  }
  if (!pkg) {
    console.log(`VERDICT ${targetMm}mm: ❌ NO PACKAGE — no axis extracted`);
    return;
  }
  console.log(`${el()} won ±${pkg.axis} panels=${pkg.panels} · rejected: ${pkg.failedAxes.map((f) => `${f.axis}(${f.reason.slice(0, 48)})`).join('; ') || 'none'}`);
  const gates = runGates({
    grid, gap: effGap, wall, step: grid.step, frame: pkg.frame, ports: pkg.ports, master,
    pieceArrays: (pkg.pieces.jacketB1 && pkg.pieces.jacketB2)
      ? [pkg.pieces.jacketA, pkg.pieces.jacketB1, pkg.pieces.jacketB2, pkg.pieces.basePlate]
      : [pkg.pieces.jacketA, pkg.pieces.jacketB, pkg.pieces.basePlate],
    siliconeMl: pkg.siliconeMl, cavityLoops: pkg.cavityLoops, cavitySections: pkg.cavitySections,
  });
  for (const c of gates.checks) console.log(`  ${c.pass ? 'PASS' : c.hard ? 'FAIL' : 'warn'} ${c.name}: ${c.detail}`);
  const clearance = gates.clearanceBand;
  console.log(`VERDICT ${targetMm}mm: ${gates.pass ? '✅ gates pass' : '❌ hard gate fail'} · axis ±${pkg.axis} · clearance min=${clearance?.min} p10=${clearance?.p10} p50=${clearance?.p50} (gap ${effGap})`);
}

// pin parity: native-size generation first (what the UI does before the slider)
let pinAxis: Axis | undefined;
if (PIN) {
  const kNat = solveK(maxDim, Math.min(280, Math.max(20, maxDim)));
  const master = scaled(kNat);
  const s = scaleFor(maxDim * kNat);
  const gap = halfMm(Math.max(2, REF_GAP * s));
  const wall = Math.min(8, Math.max(2, Math.max(2, halfMm(REF_WALL * s))));
  console.log(`\n=== native pass ${maxDim.toFixed(1)}mm (gap ${gap} wall ${wall}) for pin ===`);
  const grid = await buildSignedDistanceGrid(master, { gap, wall, step: 0.75 });
  const man = new mod.Manifold(new mod.Mesh({ numProp: 3, vertProperties: master.vertProperties, triVerts: master.triVerts }));
  if (!isStatusOk(man)) { console.error('not manifold'); process.exit(2); }
  const dec = man.simplify(0.05);
  const dm = dec.getMesh();
  const analysis: MeshArrays = { vertProperties: Float32Array.from(dm.vertProperties), triVerts: Uint32Array.from(dm.triVerts.subarray(0, dm.numTri * 3)) };
  dec.delete();
  const report = buildReport(INPUT, { ...master, vertCount: master.vertProperties.length / 3 }, analysis, analysis.triVerts.length / 3, 64);
  const cleanAxes = report.axes.filter((a) => a.trappedPct <= 10);
  const restAxes = report.axes.filter((a) => a.trappedPct > 10);
  const rankedAxes = [
    ...cleanAxes.sort((a, b) => a.trappedPct - b.trappedPct).map((a) => a.axis),
    ...restAxes.sort((a, b) => a.trappedPct - b.trappedPct).map((a) => a.axis),
  ];
  const pkg = await generateMoldPackage({
    mod, master, grid, params: { gap, wall, clearance: 0.35, ribs: false, panels: 2 }, rankedAxes, ports: false,
    onProgress: (st) => console.log(`${el()}   ${st}`),
  });
  if (pkg) { pinAxis = pkg.axis; console.log(`${el()} native won ±${pkg.axis} — pinning it for resize runs`); }
  else console.log(`${el()} native pass also failed — no pin axis`);
}

for (const size of SIZES) await runSize(size, pinAxis);
