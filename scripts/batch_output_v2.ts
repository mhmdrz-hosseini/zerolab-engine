// Batch run V2: every model in "MOLD-generator base/input" through the NEW
// M1 pipeline (scripts/generate_mold.ts → planMold: mold-family selector,
// staged release w/ obstacle attribution, serialized-bytes final audit) at
// two master sizes — small 50 mm and extra-big 200 mm. Same harness, same
// defaults and sizes as OUTPUT TEST 1 so the only variable is the algorithm.
//
// Usage: npx tsx scripts/batch_output_v2.ts [--only <substring>] [--sizes small,big] [--jobs 2]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { basename, join, dirname, relative } from 'node:path';
import { unzipSync } from 'fflate';
import { writeStlBinary } from '../src/engine/stl';
import type { MeshArrays } from '../src/engine/types';

const REPO = 'D:/code/3d/MOLD/MOLDGENRATOR';
const INPUT_DIR = 'D:/code/3d/MOLD/MOLD-generator base/input';

const args = process.argv.slice(2);
const arg = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const OUT_ROOT = arg('out') ? join(REPO, arg('out')!) : join(REPO, 'OUTPUT V2');
const SIZES: Record<string, number> = { small: 50, big: 200 };
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

interface Job { file: string; sizeName: string; sizeMm: number; outDir: string; modelLabel: string }
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
    jobs.push({ file: runPath, sizeName, sizeMm: SIZES[sizeName], outDir: join(OUT_ROOT, `${slug(name)}__${sizeName}`), modelLabel: name });
}

mkdirSync(OUT_ROOT, { recursive: true });
const batchLog = join(OUT_ROOT, 'batch.log');
appendFileSync(batchLog, `\n=== batch V2 start ${new Date().toISOString()} — ${jobs.length} runs ===\n`);

interface Result { job: Job; code: number | null; ms: number; error?: string }
const results: Result[] = [];
let done = 0;

// NOTE: spawn (async), not spawnSync — spawnSync blocks the event loop, so
// "concurrent" workers serialize and a single 200 mm run stalls the batch.
function runOne(job: Job): Promise<Result> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [
      'node_modules/tsx/dist/cli.mjs', 'scripts/generate_mold.ts',
      '--input', job.file, '--size', String(job.sizeMm), '--out', job.outDir,
    ], {
      cwd: REPO, env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' },
    });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => chunks.push(d));
    child.stderr.on('data', (d: Buffer) => chunks.push(d));
    child.on('error', (err) => resolve({ job, code: -1, ms: Date.now() - t0, error: err.message }));
    child.on('close', (code) => {
      const ms = Date.now() - t0;
      const log = Buffer.concat(chunks);
      mkdirSync(job.outDir, { recursive: true });
      writeFileSync(join(job.outDir, 'run.log'), log);
      if (code !== 0 && log.length > 4000) appendFileSync(batchLog, `--- ${basename(job.outDir)} tail ---\n` + log.slice(-4000).toString() + '\n');
      resolve({ job, code, ms });
    });
  });
}

let cursor = 0;
async function worker(id: number) {
  while (cursor < jobs.length) {
    const job = jobs[cursor++];
    const label = `${basename(job.outDir)}`;
    // resume: a previous batch invocation already wrote a complete package for this run
    const prevLog = join(job.outDir, 'run.log');
    if (existsSync(prevLog) && readFileSync(prevLog, 'utf8').includes('package written to')) {
      results.push({ job, code: 0, ms: 0 });
      console.log(`[w${id}] (${++done}/${jobs.length}) SKIP  ${label} (already complete)`);
      continue;
    }
    console.log(`[w${id}] (${++done}/${jobs.length}) START ${label}`);
    let res: Result;
    try { res = await runOne(job); }
    catch (e) { res = { job, code: -1, ms: 0, error: e instanceof Error ? e.message : String(e) }; }
    results.push(res);
    console.log(`[w${id}] DONE  ${label} → exit ${res.code} (${(res.ms / 1000).toFixed(0)}s)`);
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, (_, i) => worker(i)));

// --- summary + manifest (manifest feeds the contact-sheet renderer) ---
const PRINT_PART_RE = /(01_master\/master_base\.stl|02_jacket\/[a-zA-Z0-9_]+\.stl)$/;
const line = (r: Result) => {
  const log = existsSync(join(r.job.outDir, 'run.log')) ? readFileSync(join(r.job.outDir, 'run.log'), 'utf8') : '';
  const axis = log.match(/split ±(\w)/)?.[1] ?? '—';
  const method = log.match(/method (\w[\w-]*) \((\d)-piece/);
  const ml = log.match(/silicone (\d+) mL/)?.[1] ?? '—';
  const status = r.code === 0 ? 'OK'
    : log.includes('input rejected') ? 'INPUT-REJECTED'
    : log.includes('hard gate failure') ? 'HARD-GATE-FAIL'
    : log.includes('not manifold') ? 'NOT-MANIFOLD'
    : log.includes('every candidate axis failed') ? 'ALL-AXES-FAILED'
    : `EXIT ${r.code ?? '?'}`;
  // printed parts for the renderer (master + jackets/tray wall; silicone skin is a preview, not printed)
  const parts: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true }) as any[]) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (PRINT_PART_RE.test(p.replaceAll('\\', '/'))) parts.push(relative(OUT_ROOT, p).replaceAll('\\', '/'));
    }
  };
  if (r.code === 0 && existsSync(r.job.outDir)) walk(r.job.outDir);
  parts.sort();
  return { status, axis, family: method?.[1] ?? '—', panels: method?.[2] ?? '—', ml, parts, dur: `${(r.ms / 60000).toFixed(1)}m` };
};

const rows = results
  .sort((a, b) => basename(a.job.outDir).localeCompare(basename(b.job.outDir)))
  .map((r) => ({ run: basename(r.job.outDir), model: r.job.modelLabel, size: `${r.job.sizeName} (${r.job.sizeMm}mm)`, ...line(r) }));

let md = `# OUTPUT V2 — batch report, NEW planMold pipeline (${new Date().toISOString()})\n\n` +
  `Engine: M1 shared pipeline (\`planMold\` — mold-family selector, staged release with obstacle attribution, serialized-bytes final audit, relief-tray family).\n` +
  `Same harness/defaults as OUTPUT TEST 1 (gap 6, wall 5, clearance 0.35, auto axis) — only the algorithm changed. Small = 50 mm master, extra-big = 200 mm master.\n\n` +
  `| model | run | status | family | pieces | axis | silicone | duration |\n|---|---|---|---|---|---|---|---|\n`;
for (const s of rows) md += `| ${s.model} | ${s.size} | ${s.status} | ${s.family} | ${s.panels} | ±${s.axis} | ${s.ml} mL | ${s.dur} |\n`;
if (skipped.length) md += `\n## Skipped / pre-converted\n\n` + skipped.map((s) => `- ${s}`).join('\n') + '\n';
const ok = rows.filter((s) => s.status === 'OK').length;
md += `\n**${ok}/${rows.length} runs succeeded** (OUTPUT TEST 1 baseline: 31/40). Per-run details: \`run.log\` inside each \`<model>__<size>\` folder.\n`;
writeFileSync(join(OUT_ROOT, 'SUMMARY.md'), md);
writeFileSync(join(OUT_ROOT, 'manifest.json'), JSON.stringify({ outRoot: relative(REPO, OUT_ROOT), sizes: SIZES, skipped, rows }, null, 2));
console.log(`\nBATCH V2 DONE: ${ok}/${rows.length} OK — summary at ${basename(OUT_ROOT)}/SUMMARY.md`);
