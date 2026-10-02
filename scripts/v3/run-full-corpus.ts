// Full-corpus batch (V3 standards): every STL in the frozen input root × the
// requested sizes, generated with EXACTLY the intent the platform now
// auto-suggests (suggestIntent + shellConnectivity). Writes packages + a
// per-case verdict under OUTPUT/v3/<runId>/ and a machine-readable summary.
// Success bar: every case either ships a package whose serialized audits are
// all 'valid', or stops with a specific truthful review/rejection reason.
// A crash or a generic unexplained failure is a defect.
//
// PROCESS ISOLATION: a pathological case can corrupt the WASM kernel's heap
// and poison every later case in the same process (measured: after a 480 s
// fused 3-shell case, the next seven models died instantly with "null
// function or function signature mismatch"). Each case therefore runs in its
// own process:
//   --list <sizes>              print "file<TAB>size" lines to drive a loop
//   --one <runId> <file> <size> run ONE case, write _cases/<caseId>.json
//   --summarize <runId>         merge _cases/*.json into summary.json
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { validateMasterMesh } from '../../src/engine/analyze';
import { planMold } from '../../src/engine/planner';
import { parseStlBinary } from '../../src/engine/stl';
import { suggestIntent } from '../../src/engine/moldMethod';
import { shellConnectivity } from '../../src/engine/solid';
import { pickStabilityBacking } from '../../src/engine/orientation';
import { loadManifold } from '../../src/engine/manifoldLoader';

const INPUT = 'D:/code/3d/MOLD/MOLD-generator base/input';
const args = process.argv.slice(2);

const stemOf = (file: string) =>
  file.replace(/\.(stl|obj|glb|3mf|step|stp)$/i, '').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 40);

interface CaseRecord {
  caseId: string;
  sourceFile: string;
  sizeMm: number;
  suggested: { surfaces: string; family: string; multiBodyHandling: string; positiveShells: number; connectedGroups: number; overlapMm3: number };
  status: 'generated' | 'review_required' | 'rejected' | 'intake_failed' | 'crash' | 'generated_invalid_audit';
  family?: string;
  splitAxis?: string;
  panels?: number;
  siliconeMl?: number;
  allAuditsValid?: boolean;
  pinchedEdges?: number;
  message?: string;
  topRejections?: { stage: string; reason: string }[];
  warnings?: string[];
  seconds: number;
}

async function runCase(runId: string, file: string, size: number): Promise<CaseRecord> {
  const stem = stemOf(file);
  const caseId = `${stem}-${size}`;
  const t0 = Date.now();
  const line = (s: string) => console.log(`[${caseId}] ${s}`);
  const lower = file.toLowerCase();
  if (lower.endsWith('.step') || lower.endsWith('.stp') || lower.endsWith('.3mf')) {
    return {
      caseId: `${stem}-intake`, sourceFile: file, sizeMm: 0,
      suggested: { surfaces: '-', family: '-', multiBodyHandling: '-', positiveShells: 0, connectedGroups: 0, overlapMm3: 0 },
      status: 'intake_failed',
      message: 'unsupported format — expected intake diagnostic (STL/OBJ/GLB only); convert and re-import',
      seconds: 0,
    };
  }
  const bytes = readFileSync(join(INPUT, file));
  const inputSha256 = createHash('sha256').update(bytes).digest('hex');
  const caseDir = join('OUTPUT/v3', runId, caseId);
  try {
    const master = parseStlBinary(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const problems = validateMasterMesh(master);
    if (problems.length) throw Object.assign(new Error(`intake rejected: ${problems.join('; ')}`), { intake: true });
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < master.vertProperties.length; i++) {
      const v = master.vertProperties[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const k = size / Math.max(hi - lo, 1e-6);
    master.vertProperties = master.vertProperties.map((x) => x * k);
    let engineCommit = 'unknown';
    try { engineCommit = execSync('git rev-parse HEAD').toString().trim(); } catch { /* not a git checkout */ }
    const mod = await loadManifold();
    const suggestion = suggestIntent(master);
    const shells = shellConnectivity(mod, master);
    const stability = pickStabilityBacking(master);
    // Same policy the UI suggests: fuse only on genuine volumetric overlap;
    // touching-only or disjoint shells stay a truthful review. The backing
    // side is the suggested stability direction — exactly what the UI
    // pre-fills (without it, ambiguous-backing models like the lantern cap
    // stop at the signed-selection review).
    const multiBodyHandling = shells.positiveShells > 1 && shells.connectedGroups === 1 && shells.overlapMm3 > Math.max(1, 0.01 * Math.max(1, shells.volumeSumMm3)) ? 'fuse_overlapping' as const : 'auto_review' as const;
    line(`suggested ${suggestion.surfaces}/${suggestion.family}, shells ${shells.positiveShells}→${shells.connectedGroups} (overlap ${shells.overlapMm3.toFixed(2)}mm³) → ${multiBodyHandling}`);
    const result = await planMold({
      mod, master, grid: undefined,
      params: { gap: 6, wall: 5, clearance: 0.35 },
      name: stem,
      castingIntent: { inputRole: 'positive_master', requiredSurfaces: suggestion.surfaces, requestedFamily: suggestion.family, multiBodyHandling, backingNormalSource: stability.normal },
      source: { inputSha256, sourceKind: 'file', units: 'mm', scalePolicy: `scaled ×${k.toFixed(4)} to ${size} mm`, engineCommit },
      extraWarnings: [suggestion.reason],
    });
    const seconds = Number(((Date.now() - t0) / 1000).toFixed(1));
    const suggestedRec = { surfaces: suggestion.surfaces, family: suggestion.family, multiBodyHandling, positiveShells: shells.positiveShells, connectedGroups: shells.connectedGroups, overlapMm3: Number(shells.overlapMm3.toFixed(3)) };
    if (result.ok) {
      mkdirSync(caseDir, { recursive: true });
      for (const [path, data] of Object.entries(result.files.files)) {
        const p = join(caseDir, path);
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, data);
      }
      writeFileSync(join(caseDir, `${stem}.zip`), result.files.zip);
      const project = JSON.parse(new TextDecoder().decode(result.files.files[Object.keys(result.files.files).find((x) => x.endsWith('/project.json'))!]));
      const audits = Object.values(project.finalFileAudit) as { verdict: string; pinchedEdges: number }[];
      const allValid = audits.every((a) => a.verdict === 'valid');
      const pinches = audits.reduce((a, b) => a + b.pinchedEdges, 0);
      line(`OK ${project.method.family} ±${project.splitAxis} silicone ${project.siliconeMl} mL audits ${allValid ? 'ALL VALID' : 'INVALID'} (${seconds}s)`);
      return {
        caseId, sourceFile: file, sizeMm: size, suggested: suggestedRec,
        status: allValid ? 'generated' : 'generated_invalid_audit',
        family: project.method.family, splitAxis: project.splitAxis, panels: project.method.panels,
        siliconeMl: project.siliconeMl, allAuditsValid: allValid, pinchedEdges: pinches,
        warnings: project.warnings, seconds,
      };
    }
    line(`${result.outcome.toUpperCase()} (${seconds}s): ${result.message.slice(0, 160)}`);
    return {
      caseId, sourceFile: file, sizeMm: size, suggested: suggestedRec,
      status: result.outcome === 'review_required' ? 'review_required' : 'rejected',
      message: result.message,
      topRejections: result.rejectionLedger.slice(0, 4).map((r) => ({ stage: r.stage, reason: r.reason.slice(0, 160) })),
      seconds,
    };
  } catch (err) {
    const seconds = Number(((Date.now() - t0) / 1000).toFixed(1));
    const intake = (err as { intake?: boolean }).intake === true;
    line(`${intake ? 'INTAKE-FAILED' : 'CRASH'} (${seconds}s): ${err instanceof Error ? err.message : String(err)}`);
    return {
      caseId, sourceFile: file, sizeMm: size,
      suggested: { surfaces: '-', family: '-', multiBodyHandling: '-', positiveShells: 0, connectedGroups: 0, overlapMm3: 0 },
      status: intake ? 'intake_failed' : 'crash',
      message: err instanceof Error ? err.message : String(err),
      seconds,
    };
  }
}

if (args[0] === '--one') {
  const [, runId, file, sizeArg] = args;
  const rec = await runCase(runId, file, Number(sizeArg));
  const outDir = join('OUTPUT/v3', runId, '_cases');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${rec.caseId}.json`), JSON.stringify(rec, null, 2));
  process.exit(0);
}

if (args[0] === '--summarize') {
  const dir = join('OUTPUT/v3', args[1], '_cases');
  const records: CaseRecord[] = readdirSync(dir).filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf-8')) as CaseRecord)
    .sort((a, b) => a.caseId.localeCompare(b.caseId));
  writeFileSync(join('OUTPUT/v3', args[1], 'summary.json'), JSON.stringify(records, null, 2));
  const by = (s: string) => records.filter((r) => r.status === s).length;
  console.log(`=== ${args[1]}: ${records.length} cases — generated ${by('generated')}, review ${by('review_required')}, rejected ${by('rejected')}, intake ${by('intake_failed')}, crash ${by('crash')}, invalid-audit ${by('generated_invalid_audit')} ===`);
  process.exit(0);
}

// --list <sizes>: enumerate cases for the driver loop
{
  const sizes = (args[1] ?? '50,200').split(',').map(Number);
  for (const file of readdirSync(INPUT).sort()) {
    const lower = file.toLowerCase();
    if (!/\.(stl|3mf|step|stp)$/.test(lower)) continue;
    for (const size of sizes) console.log(`${stemOf(file)}\t${file}\t${size}`);
  }
}
