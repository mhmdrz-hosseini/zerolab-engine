// Mold generation CLI — plan Task 7. Same engine as the browser worker
// (generateMoldPackage + runGates + buildPrintFiles); hard gate failures block
// the package and exit non-zero.
//
// Usage:
//   npx tsx scripts/generate_mold.ts --input <model.stl|obj|glb> [--gap 6]
//     [--wall 5] [--clearance 0.25] [--out OUTPUT/dir] [--vertical X|Y|Z]
//     [--split X|Y|Z] [--size <mm>] [--no-zip]
//
// The master is expected in millimetres. Models outside the 20–300 mm band are
// REFUSED unless --size <maxdim-mm> confirms the intended physical size.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildReport, computeBBox, validateMasterMesh } from '../src/engine/analyze';
import { contoursAtLayer } from '../src/engine/contours';
import { runGates } from '../src/engine/gates';
import { isStatusOk, loadManifold } from '../src/engine/manifoldLoader';
import { buildSignedDistanceGrid, instanceToMeshArrays } from '../src/engine/offset';
import { AXES } from '../src/engine/types';
import { weldMesh } from '../src/engine/weld';
import { parseGlb } from '../src/engine/glb';
import { parseObj } from '../src/engine/obj';
import { parseStlBinary } from '../src/engine/stl';
import { buildPrintFiles } from '../src/engine/export';
import { generateMoldPackage, pickFrame } from '../src/engine/split';
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
const CLEARANCE = Number(arg('clearance') ?? 0.25);
const OUT_DIR = arg('out') ?? 'OUTPUT/generated_mold';
const SIZE = arg('size') ? Number(arg('size')) : undefined;
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
if (SIZE !== undefined && SIZE > 0 && Math.abs(SIZE - maxDim) > 0.01) {
  const k = SIZE / maxDim;
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
const man = new mod.Manifold(new mod.Mesh({ numProp: 3, vertProperties: full.vertProperties, triVerts: full.triVerts }));
if (!isStatusOk(man)) {
  console.error('generate_mold: mesh topology is not manifold — re-export fused from your modeling tool');
  process.exit(2);
}
const dec = man.simplify(0.05);
const dm = dec.getMesh();
const analysis: MeshArrays = {
  vertProperties: Float32Array.from(dm.vertProperties),
  triVerts: Uint32Array.from(dm.triVerts.subarray(0, dm.numTri * 3)),
};
dec.delete();
const report = buildReport(input, { ...full, vertCount: full.vertProperties.length / 3 }, analysis, analysis.triVerts.length / 3, 64);
console.log(`${el()} intake: ${full.triVerts.length / 3} tris, bbox ${bb0.dim.map((d) => d.toFixed(1)).join(' × ')} mm`);

// --- SDF grid + axis ranking (worker parity) ---
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
const rankedAxes = SPLIT ? [SPLIT] : [
  ...cleanAxes.sort((a, b) => (quiet.get(a.axis) ?? 99) - (quiet.get(b.axis) ?? 99)).map((a) => a.axis),
  ...restAxes.sort((a, b) => a.trappedPct - b.trappedPct).map((a) => a.axis),
];
console.log(`${el()} ranked axes: ${rankedAxes.join(' → ')}`);

// --- generate ---
const pkg = await generateMoldPackage({
  mod, master: full, grid,
  params: { gap: GAP, wall: WALL, clearance: CLEARANCE, verticalAxis: VERTICAL, splitAxis: SPLIT },
  rankedAxes, ports: false,
  onProgress: (stage) => console.log(`${el()} ${stage}`),
});
if (!pkg) {
  console.error('generate_mold: every candidate axis failed — this shape needs the multi-panel mode (not yet available). Rejected axes:');
  for (const f of rankedAxes) console.error(`  ±${f}`);
  process.exit(1);
}
console.log(`${el()} won axis ±${pkg.axis}; rejected: ${pkg.failedAxes.map((f) => `${f.axis} (${f.reason.slice(0, 60)})`).join('; ') || 'none'}`);

// --- gates: hard failures block the package ---
const gates = runGates({
  grid, gap: GAP, wall: WALL, step: grid.step,
  frame: pkg.frame,
  ports: pkg.ports,
  master: full,
  pieceArrays: [pkg.pieces.jacketA, pkg.pieces.jacketB, pkg.pieces.basePlate],
  siliconeMl: pkg.siliconeMl,
  cavityLoops: pkg.cavityLoops, cavitySections: pkg.cavitySections,
});
let failures = 0;
for (const c of gates.checks) {
  console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}  (${c.detail})`);
  if (!c.pass && c.hard) failures++;
}
if (failures > 0) {
  console.error(`generate_mold: ${failures} hard gate failure(s) — package NOT written`);
  process.exit(1);
}

// --- master_base fusion (worker parity) ---
const mm = new mod.Manifold(new mod.Mesh({ numProp: 3, vertProperties: full.vertProperties, triVerts: full.triVerts }));
const pm = new mod.Manifold(new mod.Mesh({ numProp: 3, vertProperties: pkg.pieces.basePlate.vertProperties, triVerts: pkg.pieces.basePlate.triVerts }));
const fused = mm.add(pm);
if (!isStatusOk(fused)) {
  console.error('generate_mold: master/base union failed — package NOT written');
  process.exit(1);
}
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
let files: Record<string, Uint8Array>, zip: Uint8Array, fileName: string;
try {
  ({ files, zip, fileName } = buildPrintFiles({
    masterBase,
    parts: { ...pkg.pieces, siliconeSkin: pkg.pieces.skin, master: full, masterBase },
    info: {
      name: input.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, ''),
      createdAt: new Date().toISOString(),
      params: { gap: GAP, wall: WALL, clearance: CLEARANCE },
      axis: pkg.axis,
      siliconeMl: pkg.siliconeMl,
      extraction: { A: pkg.extraction.A.freeAtMm, B: pkg.extraction.B.freeAtMm },
      jacketDim: [...pkg.jacketDim],
      plateDim: [...bbOf(pkg.pieces.basePlate)],
      warnings: [...gates.warnings, ...pkg.warnings, ...warnings, ...report.warnings],
      checks: gates.checks,
      crown: null,
      ventCount: pkg.ports.vents.length,
    },
  }));
} catch (err) {
  console.error(`generate_mold: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
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
console.log(`jacket ${pkg.jacketDim.map((d) => d.toFixed(1)).join(' × ')} mm · silicone ${pkg.siliconeMl.toFixed(0)} mL · extraction A ${pkg.extraction.A.freeAtMm} / B ${pkg.extraction.B.freeAtMm} mm`);
