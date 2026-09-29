// CLI/browser parity regression (plan Task 4): the SAME input through BOTH
// adapters — the CLI subprocess and the shared planMold pipeline the browser
// worker calls — must produce equivalent decisions and complete metadata.
// Also asserts rotation invariance of the family decision and that a non-Z
// vertical never claims "as exported".
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { loadManifold } from '../src/engine/manifoldLoader';
import { parseStlBinary, writeStlBinary } from '../src/engine/stl';
import { buildReport, computeBBox } from '../src/engine/analyze';
import { buildSignedDistanceGrid } from '../src/engine/offset';
import { planMold, rankSplitAxes } from '../src/engine/planner';
import type { MeshArrays } from '../src/engine/types';

const REPO = process.cwd();
const OUT = join(REPO, 'scratch', 'parity');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// --- asymmetric fixture (box + spur), written Z-up and rotated Y-up ---
const mod = await loadManifold();
const solid = (() => {
  const body = mod.Manifold.cube([24, 18, 36]);
  const spur = mod.Manifold.cube([18, 8, 3]).translate(18, 3, 25);
  const s = body.add(spur);
  const dm = s.getMesh();
  const arr: MeshArrays = { vertProperties: Float32Array.from(dm.vertProperties), triVerts: Uint32Array.from(dm.triVerts.subarray(0, dm.numTri * 3)) };
  s.delete(); body.delete(); spur.delete();
  return arr;
})();
const zUp = join(OUT, 'fixture_zup.stl');
const yUp = join(OUT, 'fixture_yup.stl');
writeFileSync(zUp, Buffer.from(writeStlBinary(solid)));
{
  // rotate 90° about X: Y↔Z — the rotated STL is the SAME physical mold input
  const m = new mod.Manifold(new mod.Mesh({ numProp: 3, vertProperties: solid.vertProperties, triVerts: solid.triVerts }));
  const r = m.rotate(90, 0, 0);
  const dm = r.getMesh();
  writeFileSync(yUp, Buffer.from(writeStlBinary({
    vertProperties: Float32Array.from(dm.vertProperties),
    triVerts: Uint32Array.from(dm.triVerts.subarray(0, dm.numTri * 3)),
  })));
  r.delete(); m.delete();
}

const CLI = ['node_modules/tsx/dist/cli.mjs', 'scripts/generate_mold.ts'];
const cliRun = (input: string, out: string) => {
  const r = spawnSync(process.execPath, [...CLI, '--input', input, '--size', '36', '--gap', '4', '--wall', '3', '--clearance', '0.25', '--out', out, '--no-zip'],
    { cwd: REPO, encoding: 'buffer', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' } });
  assert.equal(r.status, 0, `CLI run failed for ${input}: ${(r.stderr ?? Buffer.alloc(0)).toString().slice(-400)}`);
  const root = readdirSync(out).find((n) => n.startsWith('pourbox_'));
  assert.ok(root, `no package dir in ${out}`);
  return JSON.parse(readFileSync(join(out, root, 'project.json'), 'utf8'));
};

// library adapter — the exact calls the browser worker makes
async function libraryRun(input: string) {
  const bytes = readFileSync(input);
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const full = parseStlBinary(ab);
  const bb = computeBBox(full);
  const maxDim = Math.max(...bb.dim);
  const k = 36 / maxDim;
  for (let i = 0; i < full.vertProperties.length; i++) full.vertProperties[i] *= k;
  // parity with the CLI/browser intake: ranking and analysis use the SIMPLIFIED mesh
  const man = new mod.Manifold(new mod.Mesh({ numProp: 3, vertProperties: full.vertProperties, triVerts: full.triVerts }));
  const dec = man.simplify(0.05);
  const dm = dec.getMesh();
  const analysis: MeshArrays = {
    vertProperties: Float32Array.from(dm.vertProperties),
    triVerts: Uint32Array.from(dm.triVerts.subarray(0, dm.numTri * 3)),
  };
  dec.delete(); man.delete();
  const report = buildReport(input, { ...full, vertCount: full.vertProperties.length / 3 }, analysis, analysis.triVerts.length / 3, 64);
  const grid = await buildSignedDistanceGrid(full, { gap: 4, wall: 3, step: 0.75 });
  const rankedAxes = rankSplitAxes(report.axes, analysis, grid, 4);
  const plan = await planMold({
    mod, master: full, grid, rankedAxes,
    params: { gap: 4, wall: 3, clearance: 0.25 },
    name: 'parity', ports: false,
    source: {
      inputSha256: createHash('sha256').update(bytes).digest('hex'),
      sourceKind: 'file', units: 'mm', scalePolicy: `scaled ×${k.toFixed(4)} to 36 mm`,
      engineCommit: 'library-parity',
    },
  });
  assert.ok(plan.ok, `library plan failed: ${plan.ok ? '' : plan.message}`);
  return plan;
}

const GAP_TOL = 0.02;

// --- 1. CLI vs library on the SAME input (the core parity claim) ---
for (const [label, file] of [['Z-up', zUp], ['Y-up (rotated)', yUp]] as const) {
  const cliPkg = cliRun(file, join(OUT, `cli_${label === 'Z-up' ? 'zup' : 'yup'}`));
  const lib = await libraryRun(file);

  assert.equal(cliPkg.method.family, lib.method!.family, `${label}: method family parity`);
  assert.equal(cliPkg.method.panels, lib.method!.panels, `${label}: panel count parity`);
  assert.equal(cliPkg.splitAxis, lib.pkg.axis, `${label}: split axis parity`);
  assert.ok(Math.abs(cliPkg.siliconeMl - lib.pkg.siliconeMl) / cliPkg.siliconeMl <= GAP_TOL,
    `${label}: silicone ${cliPkg.siliconeMl} vs ${lib.pkg.siliconeMl} mL`);
  assert.ok(Array.isArray(cliPkg.rejectionLedger), `${label}: CLI writes a rejection ledger`);
  assert.ok(lib.rejectionLedger.length >= 0, `${label}: library carries a ledger`);

  // CLI metadata contract (Task 4): frame-bearing transforms present
  assert.ok(cliPkg.source?.inputSha256?.length === 64, `${label}: CLI source hash present`);
  assert.ok(cliPkg.transforms && typeof cliPkg.transforms.instruction === 'string', `${label}: CLI transform present`);
  assert.ok(cliPkg.finalFileAudit, `${label}: CLI final-file audit present`);
  assert.ok(cliPkg.releaseResult, `${label}: CLI release result present`);

  // transform correctness: a non-Z vertical must NEVER say "as exported"
  const vert = cliPkg.transforms.moldVertical;
  if (vert !== 'Z') {
    assert.equal(cliPkg.transforms.asExported, false, `${label}: non-Z vertical claims as-exported`);
    assert.match(cliPkg.transforms.instruction, /rotate/i, `${label}: missing rotation instruction`);
  }
  console.log(`PASS ${label}: CLI ≡ library (axis ±${cliPkg.splitAxis}, ${cliPkg.siliconeMl.toFixed(1)} mL, ${cliPkg.method.panels}-piece, transform "${cliPkg.transforms.instruction.slice(0, 44)}…")`);
}

// --- 2. Rotation invariance: same physical mold, rotated input ---
{
  const a = cliRun(zUp, join(OUT, 'inv_zup'));
  const b = cliRun(yUp, join(OUT, 'inv_yup'));
  assert.equal(a.method.panels, b.method.panels, 'panel count must be rotation-invariant');
  assert.ok(Math.abs(a.siliconeMl - b.siliconeMl) / a.siliconeMl <= 0.05,
    `silicone volume must be ~invariant under rigid rotation (${a.siliconeMl} vs ${b.siliconeMl} mL)`);
  // split axes must map under the rotation (Y↔Z swap, X stays)
  const map: Record<string, string> = { X: 'X', Y: 'Z', Z: 'Y' };
  assert.equal(map[a.splitAxis], b.splitAxis, `split axis must map under 90° X-rotation (±${a.splitAxis} → ±${map[a.splitAxis]}, got ±${b.splitAxis})`);
  console.log(`PASS rotation invariance: ±${a.splitAxis} (Z-up) → ±${b.splitAxis} (rotated), silicone ${a.siliconeMl.toFixed(1)} → ${b.siliconeMl.toFixed(1)} mL`);
}

console.log('PARITY REGRESSIONS PASS');
