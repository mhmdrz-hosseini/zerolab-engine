// Batch run: every model in "MOLD-generator base/input" through the platform
// engine (scripts/generate_mold.ts) at two master sizes — small 50 mm and
// large 200 mm (the UI slider band is 2–20 cm). Each run is an isolated child
// process; logs land in the run folder, summary in OUTPUT TEST 1/SUMMARY.md.
//
// Usage: npx tsx scripts/batch_output_test1.ts [--only <substring>] [--sizes small,large]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { unzipSync } from 'fflate';
import { writeStlBinary } from '../src/engine/stl';
import type { MeshArrays } from '../src/engine/types';

const REPO = 'D:/code/3d/MOLD/MOLDGENRATOR';
const INPUT_DIR = 'D:/code/3d/MOLD/MOLD-generator base/input';
const OUT_ROOT = join(REPO, 'OUTPUT TEST 1');
const SIZES: Record<string, number> = { small: 50, large: 200 };

const args = process.argv.slice(2);
const arg = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const ONLY = arg('only')?.toLowerCase() ?? '';
const SIZE_FILTER = arg('sizes')?.split(',') ?? Object.keys(SIZES);
const CONCURRENCY = Number(arg('jobs') ?? 2);

const slug = (s: string) =>
  s.replace(/\.[^.]+$/, '')
    .replace(/[<>:"/\\|?*+]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 60) || 'model';

// --- 3mf → binary STL (3mf is a zip around an XML mesh; the platform reads stl/obj/glb) ---
function convert3mf(path: string): string {
  const zip = unzipSync(new Uint8Array(readFileSync(path)));
  const model = Object.entries(zip).find(([n]) => n.endsWith('.model'));
  if (!model) throw new Error('no 3dmodel.model entry in 3mf');
  const xml = new TextDecoder().decode(model[1]);
  const verts: number[] = [];
  for (const m of xml.matchAll(/<vertex\s[^>]*?x="([-\d.eE+]+)"[^>]*?y="([-\d.eE+]+)"[^>]*?z="([-\d.eE+]+)"/g))
    verts.push(Number(m[1]), Number(m[2]), Number(m[3]));
  const tris: number[] = [];
  for (const m of xml.matchAll(/<triangle\s[^>]*?v1="(\d+)"[^>]*?v2="(\d+)"[^>]*?v3="(\d+)"/g))
    tris.push(Number(m[1]), Number(m[2]), Number(m[3]));
  if (!verts.length || !tris.length) throw new Error(`3mf mesh empty (${verts.length / 3} verts, ${tris.length / 3} tris)`);
  const mesh: MeshArrays = { vertProperties: Float32Array.from(verts), triVerts: Uint32Array.from(tris) };
  const out = join(REPO, 'scratch', 'converted_3mf', slug(basename(path)) + '.stl');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(writeStlBinary(mesh)));
  return out;
}

interface Job { file: string; sizeName: string; sizeMm: number; outDir: string }
const jobs: Job[] = [];
const skipped: string[] = [];

const entries = readdirSync(INPUT_DIR) as string[];
for (const name of entries.sort()) {
  const lower = name.toLowerCase();
  const full = join(INPUT_DIR, name);
  if (ONLY && !lower.includes(ONLY)) continue;
  let runPath = full;
  if (lower.endsWith('.3mf')) {
    try { runPath = convert3mf(full); skipped.push(`${name} — converted 3mf→STL, run as ${basename(runPath)}`); }
    catch (e) { skipped.push(`${name} — 3mf conversion failed: ${e instanceof Error ? e.message : e}`); continue; }
  } else if (lower.endsWith('.step') || lower.endsWith('.stp')) {
    skipped.push(`${name} — STEP not supported by the platform (imports stl/obj/glb; STEP needs a CAD kernel)`);
    continue;
  } else if (!lower.endsWith('.stl') && !lower.endsWith('.obj') && !lower.endsWith('.glb')) {
    skipped.push(`${name} — unsupported extension`);
    continue;
  }
  for (const sizeName of SIZE_FILTER)
    jobs.push({ file: runPath, sizeName, sizeMm: SIZES[sizeName], outDir: join(OUT_ROOT, `${slug(name)}__${sizeName}`) });
}

mkdirSync(OUT_ROOT, { recursive: true });
const batchLog = join(OUT_ROOT, 'batch.log');
appendFileSync(batchLog, `\n=== batch start ${new Date().toISOString()} — ${jobs.length} runs ===\n`);

interface Result { job: Job; code: number | null; ms: number; error?: string }
const results: Result[] = [];
let done = 0;

function runOne(job: Job): Result {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [
    'node_modules/tsx/dist/cli.mjs', 'scripts/generate_mold.ts',
    '--input', job.file, '--size', String(job.sizeMm), '--out', job.outDir,
  ], {
    cwd: REPO, encoding: 'buffer', maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' },
  });
  const ms = Date.now() - t0;
  const log = Buffer.concat([r.stdout ?? Buffer.alloc(0), Buffer.alloc(0), r.stderr ?? Buffer.alloc(0)]);
  mkdirSync(job.outDir, { recursive: true });
  writeFileSync(join(job.outDir, 'run.log'), log);
  if (r.status !== 0 && log.length > 4000) appendFileSync(batchLog, `--- ${basename(job.outDir)} tail ---\n` + log.slice(-4000).toString() + '\n');
  return { job, code: r.status, ms, error: r.error?.message };
}

let cursor = 0;
async function worker(id: number) {
  while (cursor < jobs.length) {
    const job = jobs[cursor++];
    const label = `${basename(job.outDir)}`;
    console.log(`[w${id}] (${++done}/${jobs.length}) START ${label}`);
    let res: Result;
    try { res = runOne(job); }
    catch (e) { res = { job, code: -1, ms: 0, error: e instanceof Error ? e.message : String(e) }; }
    results.push(res);
    console.log(`[w${id}] DONE  ${label} → exit ${res.code} (${(res.ms / 1000).toFixed(0)}s)`);
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, (_, i) => worker(i)));

// --- summary ---
const line = (r: Result) => {
  const log = existsSync(join(r.job.outDir, 'run.log')) ? readFileSync(join(r.job.outDir, 'run.log'), 'utf8') : '';
  const axis = log.match(/won axis ±?(\w)/)?.[1] ?? '—';
  const ml = log.match(/silicone (\d+) mL/)?.[1] ?? '—';
  const status = r.code === 0 ? 'OK'
    : log.includes('hard gate failure') ? 'HARD-GATE-FAIL'
    : log.includes('input rejected') ? 'INPUT-REJECTED'
    : log.includes('not manifold') ? 'NOT-MANIFOLD'
    : log.includes('every candidate axis failed') ? 'ALL-AXES-FAILED'
    : `EXIT ${r.code ?? '?'}`;
  return { status, axis, ml, dur: `${(r.ms / 60000).toFixed(1)}m` };
};

let md = `# OUTPUT TEST 1 — batch report (${new Date().toISOString()})\n\n` +
  `Engine: platform CLI (\`scripts/generate_mold.ts\`, same generateMoldPackage + gates + export as the browser app).\n` +
  `Defaults: gap 6, wall 5, clearance 0.35, 2 panels, auto axis. Small = 50 mm master, large = 200 mm master (slider band 2–20 cm).\n\n` +
  `| model | run | status | axis | silicone | duration |\n|---|---|---|---|---|---|\n`;
for (const r of results.sort((a, b) => basename(a.job.outDir).localeCompare(basename(b.job.outDir)))) {
  const s = line(r);
  md += `| ${basename(r.job.file)} | ${r.job.sizeName} (${r.job.sizeMm}mm) | ${s.status} | ±${s.axis} | ${s.ml} mL | ${s.dur} |\n`;
}
if (skipped.length) md += `\n## Skipped / pre-converted\n\n` + skipped.map((s) => `- ${s}`).join('\n') + '\n';
const ok = results.filter((r) => r.code === 0).length;
md += `\n**${ok}/${results.length} runs succeeded.** Per-run details: \`run.log\` inside each \`<model>__<size>\` folder.\n`;
writeFileSync(join(OUT_ROOT, 'SUMMARY.md'), md);
console.log(`\nBATCH DONE: ${ok}/${results.length} OK — summary at OUTPUT TEST 1/SUMMARY.md`);
