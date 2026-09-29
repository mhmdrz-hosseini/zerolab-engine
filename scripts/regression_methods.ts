// Regression harness for the frozen acceptance manifest
// (docs/superpowers/validation/frozen-cases.json). Every case is a REAL CLI run
// of the shipped pipeline (scripts/generate_mold.ts) into a separate output
// directory — frozen OUTPUT TEST 1 evidence is never touched.
//
// Checks per case:
//   1. fresh outcome class must equal the manifest's expectedOutcomeClass
//      (the CURRENT contract; frozen observed outcomes are drift INFO only).
//   2. any produced package must carry the production-ready metadata contract:
//      method, source (inputSha256/units/scale), transforms, finalFileAudit,
//      releaseResult, rejectionLedger. Missing fields fail the harness —
//      this is the planned red state until Tasks 2–4 land the metadata.
//   3. duplicate-shape groups (obj_1_Körper / obj_2_Körper) must make
//      equivalent decisions at equal size: class, split axis, silicone ±2%.
//   4. needs_input cases (STEP) must exit 2 with an explicit unsupported-format
//      diagnosis, never a silent STL guess.
//
// Usage:
//   npx tsx scripts/regression_methods.ts [--filter <substr>] [--sizes small,large]
//     [--jobs 2] [--keep-output]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const REPO = process.cwd();
const MANIFEST = 'docs/superpowers/validation/frozen-cases.json';
const OUT_ROOT = join(REPO, 'OUTPUT VALIDATION');
const LAST = 'docs/superpowers/validation/last-verification.json';

const args = process.argv.slice(2);
const arg = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const has = (n: string) => args.includes(`--${n}`);
const FILTER = arg('filter')?.toLowerCase() ?? '';
const SIZE_FILTER = arg('sizes')?.split(',') ?? ['small', 'large'];
const JOBS = Number(arg('jobs') ?? 2);
const KEEP = has('keep-output');

interface FrozenCase {
  case: string; model: string; sourceFile: string; sourceSha256: string | null;
  sizeMm: number | null; inputRole: string; methodExpected: string; requiredSurfaces: string;
  castingIntentNote: string; duplicateShapeGroup: string | null;
  expectedOutcomeClass: string; routingEnforced: boolean;
  frozenObserved: { outcomeClass: string; failureStage: string | null; siliconeMl: number | null; splitAxis: string | null; detail: string };
}
interface Manifest { productionReadyContract: string[]; inputDir: string; convertedInputs: Record<string, string>; cases: FrozenCase[] }

const manifest: Manifest = JSON.parse(readFileSync(join(REPO, MANIFEST), 'utf8'));
const engineCommit = execSync('git rev-parse HEAD', { cwd: REPO }).toString().trim();

type FreshClass = 'exported_metadata_incomplete' | 'production_ready' | 'rejected' | 'intake_rejected' | 'needs_input' | 'crashed';
interface Fresh {
  outcomeClass: FreshClass; failureStage: string | null; exitCode: number | null;
  splitAxis: string | null; siliconeMl: number | null; deliveredMethod: string | null;
  contractViolations: string[]; detail: string; durationS: number;
}

function resolveInput(c: FrozenCase): string {
  const converted = manifest.convertedInputs[c.sourceFile];
  if (converted) {
    const p = join(REPO, converted.split('→ ')[1].trim());
    if (!existsSync(p)) throw new Error(`converted input missing: ${p}`);
    return p;
  }
  return join(manifest.inputDir, c.sourceFile);
}

function classifyFailure(stderr: string, stdout = ''): { stage: string; detail: string } {
  const both = stdout + '\n' + stderr; // gate FAIL lines go to stdout, summaries to stderr
  const ledgerLines = both.split('\n').filter(l => /✗ .+\[(construction|release|gate|export)\]/.test(l));
  if (/every candidate (axis )?failed/.test(stderr)) {
    const last = ledgerLines[ledgerLines.length - 1];
    const stage = last?.match(/\[(construction|release|gate|export)\]/)?.[1] ?? 'construction';
    return { stage, detail: (ledgerLines.slice(-3).join(' | ') || stderr.trim().split('\n').slice(-1)[0]) };
  }
  if (/Export mesh gate failed/.test(stderr)) return { stage: 'export', detail: both.trim().split('\n').slice(-1)[0] };
  if (/hard gate failure/.test(stderr)) {
    const gate = both.split('\n').find(l => /^FAIL /.test(l));
    const name = gate?.replace(/^FAIL\s+/, '').replace(/\s+\(.*/, '') ?? 'hard gate';
    return { stage: name.toLowerCase().includes('clearance') ? 'clearance' : 'gate', detail: gate ?? both.trim().split('\n').slice(-1)[0] };
  }
  if (/union failed/.test(stderr)) return { stage: 'construction', detail: both.trim().split('\n').slice(-1)[0] };
  return { stage: 'unknown', detail: both.trim().split('\n').slice(-2).join(' | ').slice(0, 400) };
}

function runCase(c: FrozenCase): Fresh {
  const t0 = Date.now();
  const outDir = join(OUT_ROOT, c.case);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const input = resolveInput(c);
  const sizeArgs = c.sizeMm ? ['--size', String(c.sizeMm)] : [];
  const r = spawnSync(process.execPath, [
    'node_modules/tsx/dist/cli.mjs', 'scripts/generate_mold.ts',
    '--input', input, ...sizeArgs, '--out', outDir, '--no-zip',
  ], {
    cwd: REPO, encoding: 'buffer', maxBuffer: 256 * 1024 * 1024, timeout: 15 * 60_000,
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' },
  });
  const durationS = (Date.now() - t0) / 1000;
  const stderr = (r.stderr ?? Buffer.alloc(0)).toString();
  const stdout = (r.stdout ?? Buffer.alloc(0)).toString();
  try {
    if (c.expectedOutcomeClass === 'needs_input') {
      const ok = r.status === 2 && /unsupported format/i.test(stderr) && new RegExp(`\\.${c.sourceFile.split('.').pop()}`, 'i').test(stderr);
      return {
        outcomeClass: ok ? 'needs_input' : 'crashed', failureStage: 'intake', exitCode: r.status,
        splitAxis: null, siliconeMl: null, deliveredMethod: null, contractViolations: [],
        detail: ok ? 'explicit unsupported-format diagnosis' : `expected exit 2 + unsupported-format message, got exit ${r.status}: ${stderr.slice(0, 200)}`,
        durationS,
      };
    }
    if (r.status === 0) {
      const root = readdirSync(outDir).find(n => n.startsWith('pourbox_'));
      const pjPath = root ? join(outDir, root, 'project.json') : null;
      if (!pjPath || !existsSync(pjPath)) {
        return { outcomeClass: 'crashed', failureStage: 'export', exitCode: 0, splitAxis: null, siliconeMl: null, deliveredMethod: null, contractViolations: ['project.json missing from a successful run'], detail: 'exit 0 but no package manifest', durationS };
      }
      const pj = JSON.parse(readFileSync(pjPath, 'utf8'));
      const v: string[] = [];
      const method = pj.method as { family?: string; panels?: number; splitAxis?: string; confidence?: string } | null | undefined;
      if (!method || typeof method.family !== 'string' || !method.family) v.push('method missing/empty');
      if (!pj.source || typeof pj.source.inputSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(pj.source.inputSha256)) v.push('source.inputSha256 missing');
      else if (c.sourceSha256 && pj.source.inputSha256 !== c.sourceSha256) v.push(`source.inputSha256 mismatch (got ${pj.source.inputSha256.slice(0, 12)}…)`);
      if (pj.source && pj.source.units !== 'mm') v.push('source.units not recorded as mm');
      if (!pj.transforms || typeof pj.transforms !== 'object') v.push('transforms missing');
      if (!pj.finalFileAudit || typeof pj.finalFileAudit !== 'object') v.push('finalFileAudit missing');
      if (pj.releaseResult == null) v.push('releaseResult missing');
      if (!Array.isArray(pj.rejectionLedger)) v.push('rejectionLedger missing');
      const splitAxis = typeof pj.splitAxis === 'string' ? pj.splitAxis : null;
      return {
        outcomeClass: v.length ? 'exported_metadata_incomplete' : 'production_ready',
        failureStage: null, exitCode: 0, splitAxis,
        siliconeMl: typeof pj.siliconeMl === 'number' ? pj.siliconeMl : null,
        deliveredMethod: (pj.method as { family?: string } | null | undefined)?.family ?? null,
        contractViolations: v,
        detail: `exported; silicone ${pj.siliconeMl} mL; axis ±${splitAxis}`,
        durationS,
      };
    }
    if (r.status === 2) {
      return { outcomeClass: 'intake_rejected', failureStage: 'intake', exitCode: 2, splitAxis: null, siliconeMl: null, deliveredMethod: null, contractViolations: [], detail: stderr.trim().split('\n').slice(-1)[0].slice(0, 300), durationS };
    }
    if (r.status === 1) {
      const f = classifyFailure(stderr || stdout, stdout);
      return { outcomeClass: 'rejected', failureStage: f.stage, exitCode: 1, splitAxis: null, siliconeMl: null, deliveredMethod: null, contractViolations: [], detail: f.detail.slice(0, 300), durationS };
    }
    return { outcomeClass: 'crashed', failureStage: 'crash', exitCode: r.status, splitAxis: null, siliconeMl: null, deliveredMethod: null, contractViolations: [], detail: (r.error?.message ?? stderr.slice(-300)), durationS };
  } finally {
    if (!KEEP) rmSync(outDir, { recursive: true, force: true });
  }
}

// --- run the matrix with bounded concurrency, report in manifest order ---
const selected = manifest.cases.filter(c =>
  (!c.sizeMm || SIZE_FILTER.includes(c.sizeMm === 50 ? 'small' : 'large')) && c.case.toLowerCase().includes(FILTER));
const results = new Map<string, Fresh>();
let cursor = 0, done = 0;
async function worker(id: number) {
  while (cursor < selected.length) {
    const c = selected[cursor++];
    process.stdout.write(`[w${id}] (${++done}/${selected.length}) RUN  ${c.case}\n`);
    let f: Fresh;
    try { f = runCase(c); } catch (e) { f = { outcomeClass: 'crashed', failureStage: 'crash', exitCode: -1, splitAxis: null, siliconeMl: null, deliveredMethod: null, contractViolations: [], detail: e instanceof Error ? e.message : String(e), durationS: 0 }; }
    results.set(c.case, f);
    process.stdout.write(`[w${id}] (${done}/${selected.length}) DONE ${c.case} → ${f.outcomeClass}${f.failureStage ? `/${f.failureStage}` : ''} (${f.durationS.toFixed(0)}s)\n`);
  }
}
await Promise.all(Array.from({ length: Math.min(JOBS, selected.length) }, (_, i) => worker(i)));

// --- verdicts ---
let failures = 0;
const lines: string[] = [];
for (const c of manifest.cases) {
  const f = results.get(c.case);
  if (!f) continue; // filtered out
  const problems: string[] = [];
  if (f.outcomeClass !== c.expectedOutcomeClass) problems.push(`class ${f.outcomeClass}${f.failureStage ? `/${f.failureStage}` : ''} ≠ expected ${c.expectedOutcomeClass}`);
  if (f.contractViolations.length) problems.push(`production-ready contract: ${f.contractViolations.join('; ')}`);
  const verdict = problems.length ? 'FAIL' : 'PASS';
  if (problems.length) failures++;
  lines.push(`${verdict}  ${c.case}  (${f.outcomeClass}${f.failureStage ? `/${f.failureStage}` : ''}${problems.length ? ` — ${problems.join(' · ')}` : ''})`);
  // drift vs frozen evidence is INFO, not a gate — the frozen record is immutable history
  const fo = c.frozenObserved;
  const drift: string[] = [];
  if (fo.outcomeClass !== 'skipped' && f.outcomeClass !== fo.outcomeClass) drift.push(`class ${fo.outcomeClass}→${f.outcomeClass}`);
  if (fo.splitAxis && f.splitAxis && fo.splitAxis !== f.splitAxis) drift.push(`axis ±${fo.splitAxis}→±${f.splitAxis}`);
  if (fo.siliconeMl && f.siliconeMl && Math.abs(f.siliconeMl - fo.siliconeMl) / fo.siliconeMl > 0.05) drift.push(`silicone ${fo.siliconeMl}→${f.siliconeMl} mL`);
  if (drift.length) lines.push(`INFO drift vs frozen: ${c.case} — ${drift.join('; ')}`);
}

// duplicate-shape equivalence (koerper pair at equal size)
const groups = new Map<string, FrozenCase[]>();
for (const c of manifest.cases) if (c.duplicateShapeGroup && results.has(c.case)) (groups.get(c.duplicateShapeGroup) ?? groups.set(c.duplicateShapeGroup, []).get(c.duplicateShapeGroup)!).push(c);
for (const [g, members] of groups) {
  const bySize = new Map<number, FrozenCase[]>();
  for (const c of members) (bySize.get(c.sizeMm!) ?? bySize.set(c.sizeMm!, []).get(c.sizeMm!)!).push(c);
  for (const [size, pair] of bySize) {
    if (pair.length < 2) continue;
    const [a, b] = pair.map(x => ({ c: x, f: results.get(x.case)! }));
    const eqClass = a.f.outcomeClass === b.f.outcomeClass;
    const eqAxis = !a.f.splitAxis || !b.f.splitAxis || a.f.splitAxis === b.f.splitAxis;
    const eqSilicone = !a.f.siliconeMl || !b.f.siliconeMl || Math.abs(a.f.siliconeMl - b.f.siliconeMl) / a.f.siliconeMl <= 0.02;
    if (eqClass && eqAxis && eqSilicone) lines.push(`PASS  equivalence ${g} @${size}mm (class, axis, silicone within 2%)`);
    else { failures++; lines.push(`FAIL  equivalence ${g} @${size}mm — ${[!eqClass && `class ${a.f.outcomeClass} vs ${b.f.outcomeClass}`, !eqAxis && `axis ±${a.f.splitAxis} vs ±${b.f.splitAxis}`, !eqSilicone && `silicone ${a.f.siliconeMl} vs ${b.f.siliconeMl} mL`].filter(Boolean).join('; ')}`); }
  }
}

const summary = {
  generatedAt: new Date().toISOString(), engineCommit,
  command: 'npx tsx scripts/regression_methods.ts',
  totals: { run: results.size, pass: results.size - failures, fail: failures },
  perCase: Object.fromEntries([...results].map(([k, v]) => [k, v])),
};
writeFileSync(join(REPO, LAST), JSON.stringify(summary, null, 2) + '\n');

console.log('\n' + lines.join('\n'));
console.log(`\nREGRESSION METHODS: ${failures === 0 ? 'PASS' : `FAIL (${failures} failing check(s) over ${results.size} cases)`} — details in ${LAST}`);
process.exit(failures === 0 ? 0 : 1);
