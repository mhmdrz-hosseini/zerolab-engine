// Mold generation CLI — plan Task 7. Same engine as the browser worker
// (generateMoldPackage + runGates + buildPrintFiles); hard gate failures block
// the package and exit non-zero.
//
// Usage:
//   npx tsx scripts/generate_mold.ts --input <model.stl|obj|glb> [--gap 6]
//     [--wall 5] [--clearance 0.35] [--out OUTPUT/dir] [--vertical X|Y|Z]
//     [--split X|Y|Z] [--size <mm>] [--no-zip]
//
// The master is expected in millimetres. Models outside the 20–300 mm band are
// REFUSED unless --size <maxdim-mm> confirms the intended physical size.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { buildReport, computeBBox, validateMasterMesh } from '../src/engine/analyze';
import { isStatusOk, loadManifold } from '../src/engine/manifoldLoader';
import { buildSignedDistanceGrid } from '../src/engine/offset';
import { planMold, rankSplitAxes } from '../src/engine/planner';
import { weldMesh } from '../src/engine/weld';
import { parseGlb } from '../src/engine/glb';
import { parseObj } from '../src/engine/obj';
import { parseStlBinary } from '../src/engine/stl';
import type { Axis, MeshArrays } from '../src/engine/types';

const args = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string): boolean => args.includes(`--${name}`);

const input = arg('input');
if (!input) {
  console.error('generate_mold: --input <model.stl|obj|glb> is required');
  process.exit(2);
}
const GAP = Number(arg('gap') ?? 6);
const WALL = Number(arg('wall') ?? 5);
// Joint clearance — audit §12: 0.25 is a calibrated-machine value; Standard
// FDM default is 0.35 (ladder: resin 0.15 / calibrated 0.25 / 0.35 / loose 0.45)
const CLEARANCE = Number(arg('clearance') ?? 0.35);
const OUT_DIR = arg('out') ?? 'OUTPUT/generated_mold';
const SIZE = arg('size') ? Number(arg('size')) : undefined;
const GAP_WINDOW = arg('gap-window') ? Number(arg('gap-window')) : undefined;
const RIBS = has('ribs');
const MATERIAL = (arg('material') as 'silicone' | 'hotWax' | undefined) ?? undefined;
const PANELS = Number(arg('panels') ?? 2) === 3 ? 3 as const : 2 as const;
const VERTICAL = arg('vertical') as Axis | undefined;
const SPLIT = arg('split') as Axis | undefined;
const NO_ZIP = has('no-zip');

const t0 = Date.now();
const el = () => `[${((Date.now() - t0) / 1000).toFixed(1)}s]`;

// --- parse (worker parity: GLB/OBJ/STL all welded) ---
const bytes = readFileSync(input);
const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const isGlb = bytes.byteLength > 12 && new DataView(ab).getUint32(0, true) === 0x46546c67;
const ext = input.toLowerCase().slice(input.lastIndexOf('.') + 1);
// acceptance matrix: STEP (and 3MF) inputs get an explicit unsupported-format
// diagnosis — never a silent guess that the bytes are an STL
if (ext === 'step' || ext === 'stp' || ext === '3mf') {
  console.error(`generate_mold: unsupported format .${ext} — this platform imports STL/OBJ/GLB only. Convert with a CAD tessellator that preserves units and tolerance, then rerun.`);
  process.exit(2);
}
let full: MeshArrays;
const warnings: string[] = [];
if (isGlb || ext === 'glb') {
  const p = parseGlb(ab);
  full = weldMesh(p.mesh.vertProperties, p.mesh.triVerts);
  warnings.push(...p.warnings);
} else if (ext === 'obj') {
  const p = parseObj(new TextDecoder().decode(bytes));
  full = weldMesh(p.mesh.vertProperties, p.mesh.triVerts);
  warnings.push(...p.warnings);
} else {
  // raw STL parse — the kernel welds the facet soup at its own tolerance;
  // pre-welding at 1 µm drops degenerate triangles that cracked sculpted
  // surfaces use as patches (measured: sheep doll lost its surface, all axes
  // failed extraction)
  full = parseStlBinary(ab);
}
const problems = validateMasterMesh(full);
if (problems.length) {
  console.error(`generate_mold: input rejected — ${problems.join('; ')}`);
  process.exit(2);
}

// --- explicit size confirmation (no silent rescaling) ---
const bb0 = computeBBox(full);
const maxDim = Math.max(...bb0.dim);
let scaleK: number | null = null;
if (SIZE !== undefined && SIZE > 0 && Math.abs(SIZE - maxDim) > 0.01) {
  const k = SIZE / maxDim;
  scaleK = k;
  for (let i = 0; i < full.vertProperties.length; i++) full.vertProperties[i] *= k;
  warnings.push(`scaled ×${k.toFixed(4)} to a ${SIZE} mm largest dimension (--size)`);
  console.log(`${el()} scaled ×${k.toFixed(4)} (--size ${SIZE})`);
} else if (maxDim > 300 || maxDim < 20) {
  console.error(`generate_mold: model is ${bb0.dim.map((d) => d.toFixed(1)).join(' × ')} (largest ${maxDim.toFixed(1)}) — outside the 20–300 mm band.\n` +
    '  Pass --size <largest-dimension-in-mm> to confirm the intended physical size, or scale the model.');
  process.exit(2);
}

// --- kernel gate + analysis ---
const mod = await loadManifold();
let analysis: MeshArrays;
try {
  const man = new mod.Manifold(new mod.Mesh({ numProp: 3, vertProperties: full.vertProperties, triVerts: full.triVerts }));
  if (!isStatusOk(man)) throw new Error('status: not manifold');
  const dec = man.simplify(0.05);
  const dm = dec.getMesh();
  analysis = {
    vertProperties: Float32Array.from(dm.vertProperties),
    triVerts: Uint32Array.from(dm.triVerts.subarray(0, dm.numTri * 3)),
  };
  dec.delete();
} catch (err) {
  console.error(`generate_mold: input rejected at intake — the mesh is not a manifold solid (${err instanceof Error ? err.message : err}). Re-export it fused/watertight from your modeling tool, then rerun.`);
  process.exit(2);
}
const report = buildReport(input, { ...full, vertCount: full.vertProperties.length / 3 }, analysis, analysis.triVerts.length / 3, 64);
console.log(`${el()} intake: ${full.triVerts.length / 3} tris, bbox ${bb0.dim.map((d) => d.toFixed(1)).join(' × ')} mm`);

// --- SDF grid + axis ranking (worker parity) ---
const grid = await buildSignedDistanceGrid(full, { gap: GAP, wall: WALL, step: 0.75 });
const rankedAxes = rankSplitAxes(report.axes, analysis, grid, GAP);
console.log(`${el()} ranked axes: ${rankedAxes.join(' → ')}`);

// --- plan: the ONE shared pipeline (CLI, browser worker and tests) ---
const inputSha256 = createHash('sha256').update(bytes).digest('hex');
let engineCommit = 'unknown';
try { engineCommit = execSync('git rev-parse HEAD').toString().trim(); } catch { /* not a git checkout */ }
const plan = await planMold({
  mod, master: full, grid, rankedAxes,
  params: { gap: GAP, wall: WALL, clearance: CLEARANCE, verticalAxis: VERTICAL, splitAxis: SPLIT, gapWindow: GAP_WINDOW, ribs: RIBS, material: MATERIAL, panels: PANELS },
  name: input.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, ''),
  source: {
    inputSha256, sourceKind: 'file', units: 'mm',
    scalePolicy: scaleK !== null
      ? `scaled ×${scaleK.toFixed(4)} to a ${SIZE} mm largest dimension (--size)`
      : 'unscaled — file units taken as millimetres',
    engineCommit,
  },
  ports: false,
  extraWarnings: [...warnings, ...report.warnings],
  onProgress: (stage) => console.log(`${el()} ${stage}`),
});
if (!plan.ok) {
  console.error(`generate_mold: ${plan.message}`);
  for (const r of plan.rejectionLedger) console.error(`  ✗ ${r.candidate} [${r.stage}] ${r.reason.slice(0, 160)}`);
  process.exit(1);
}
if (!plan.files) {
  console.error('generate_mold: internal error — plan succeeded without export files');
  process.exit(1);
}
const { pkg } = plan;
const { files, zip, fileName } = plan.files;
console.log(`${el()} method ${plan.method.family} (${plan.method.panels}-piece, split ±${pkg.axis}); rejected: ${plan.rejectionLedger.length === 0 ? 'none' : plan.rejectionLedger.map((r) => `${r.candidate} (${r.reason.slice(0, 60)})`).join('; ')}`);
for (const c of plan.checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}  (${c.detail})`);
console.log(`${el()} printability forecast…`);
for (const [name, r] of Object.entries(plan.printability)) {
  console.log(`  ${name}: bed ${r.bedAreaMm2} mm² · unsupported @45° ${r.overhangAreaMm2} mm²` +
    (r.worstBands.length ? ` · worst ${r.worstBands[0].areaMm2} mm² @ ${r.worstBands[0].zLo}–${r.worstBands[0].zHi} mm` : ''));
}

mkdirSync(OUT_DIR, { recursive: true });
for (const [path, data] of Object.entries(files)) {
  const p = `${OUT_DIR}/${path}`;
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
}
if (!NO_ZIP) {
  mkdirSync(dirname(`${OUT_DIR}/${fileName}`), { recursive: true });
  writeFileSync(`${OUT_DIR}/${fileName}`, zip);
}
console.log(`${el()} package written to ${OUT_DIR}/ ${NO_ZIP ? '' : `(+ ${fileName})`}`);
console.log(`frame: vert ${pkg.frame.vert}, pull ±${pkg.frame.pull}, base ${pkg.frame.base.toFixed(1)}, mid ${pkg.frame.mid.toFixed(1)}, crown ${pkg.frame.crown.toFixed(1)}`);
console.log(`jacket ${pkg.jacketDim.map((d) => d.toFixed(1)).join(' × ')} mm · silicone ${pkg.siliconeMl.toFixed(0)} mL · extraction A ${pkg.extraction.A.freeAtMm} / B ${pkg.extraction.B?.freeAtMm ?? `${pkg.extraction.B1?.freeAtMm}/${pkg.extraction.B2?.freeAtMm} (B1/B2)`} mm`);
