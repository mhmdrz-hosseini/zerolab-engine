/// <reference lib="webworker" />
// Geometry worker — owns ALL mesh data (master, analysis mesh, SDF grid,
// Manifold instances). UI state never holds meshes. Generation runs through
// the SAME shared planner as the CLI (plan Task 4): identical candidate
// ladder, gates, release staging and export metadata.
import { buildReport, computeBBox, trappedColumnMask, validateMasterMesh } from '../engine/analyze';
import { meshVolumeCm3 } from '../engine/clean';
import { buildPrintFiles } from '../engine/export';
import { parseGlb } from '../engine/glb';
import { isStatusOk, loadManifold, type ManifoldMod } from '../engine/manifoldLoader';
import { extractIso, instanceToMeshArrays } from '../engine/offset';
import { buildSignedDistanceGrid } from '../engine/offset';
import { parseObj } from '../engine/obj';
import { planMold, rankSplitAxes, type PlanSuccess } from '../engine/planner';
import { parseStlBinary } from '../engine/stl';
import { weldMesh } from '../engine/weld';
import { AXES, functionalFloors, type AnalysisReport, type GenerateParams, type GenerateResult, type MeshArrays, type WorkerRequest, WorkerResponse } from '../engine/types';

const ctx = self as unknown as Worker;
let mod: ManifoldMod | null = null;

interface WorkerState {
  fileName: string;
  master: MeshArrays;     // full-res welded master
  analysis: MeshArrays;   // decimated analysis mesh
  report: AnalysisReport;
  lastResult: GenerateResult | null;
  fileSha256: string | null;  // digest of the ingested file bytes
  normalizeNote: string | null; // ingest-time scale normalization record
  lastPlan: PlanSuccess | null; // shared-planner decision + built package files

}
let state: WorkerState | null = null;

function post(msg: WorkerResponse, transfer?: Transferable[]): void {
  ctx.postMessage(msg, transfer ?? []);
}

async function ensureMod(): Promise<ManifoldMod> {
  if (!mod) mod = await loadManifold();
  return mod;
}

function statusOk(inst: { status(): number | string | { code?: number | string } }): boolean {
  return isStatusOk(inst);
}

async function ingest(fileName: string, bytes: ArrayBuffer): Promise<void> {
  post({ type: 'progress', stage: 'Parsing mesh', pct: 0.05 });
  const warnings: string[] = [];
  // source identity (Task 4): digest of the EXACT bytes the user handed over
  const fileSha256 = await crypto.subtle.digest('SHA-256', bytes).then(
    (h) => [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join(''),
    () => null,
  );
  let full: MeshArrays;

  const isGlb = bytes.byteLength > 12 && new DataView(bytes).getUint32(0, true) === 0x46546c67;
  const lower = fileName.toLowerCase();
  const ext = lower.slice(lower.lastIndexOf('.') + 1);
  if (isGlb || ext === 'glb') {
    const p = parseGlb(bytes);
    full = weldMesh(p.mesh.vertProperties, p.mesh.triVerts);
    warnings.push(...p.warnings);
    const bb = computeBBox(full);
    const maxDim = Math.max(...bb.dim);
    if (maxDim > 0 && maxDim <= 10) {
      // glTF convention is meters — a ≤10-unit model is almost certainly meters
      for (let i = 0; i < full.vertProperties.length; i++) full.vertProperties[i] *= 1000;
      warnings.push('GLB coordinates looked like meters — scaled ×1000. Confirm the physical size before generating.');
    }
  } else if (ext === 'obj') {
    const p = parseObj(new TextDecoder().decode(bytes));
    full = weldMesh(p.mesh.vertProperties, p.mesh.triVerts);
    warnings.push(...p.warnings);
  } else {
    full = parseStlBinary(bytes, (p) => post({ type: 'progress', stage: 'Parsing STL', pct: 0.05 + p * 0.2 }));
  }

  // hard intake validation before any kernel work
  const problems = validateMasterMesh(full);
  if (problems.length) {
    post({ type: 'error', message: `Input rejected: ${problems.join('; ')}` });
    return;
  }

  // scale normalization (grid-budget protection until the size-confirm UI lands):
  // the SDF grid assumes a ≤300 mm master — anything outside 20–300 mm is
  // normalized to a 150 mm default height, mirroring the Standard preset.
  // Flagged: the user must confirm physical size before printing anything.
  let normalized = false;
  {
    const bb = computeBBox(full);
    const maxS = Math.max(...bb.dim);
    if (maxS > 300 || maxS < 20) {
      const k = 150 / maxS;
      for (let i = 0; i < full.vertProperties.length; i++) full.vertProperties[i] *= k;
      warnings.push(`master normalized ×${k.toFixed(3)} to a 150 mm default height (was ${maxS.toFixed(1)} units) — CONFIRM THE REAL SIZE before printing; pass the true dimensions if these are not mm`);
      normalized = true;
    }
  }

  const triCount = full.triVerts.length / 3;
  if (triCount > 5_000_000) {
    post({ type: 'error', message: `${Math.round(triCount / 1e6)}M triangles exceeds the 5M hard limit — regenerate at lower detail` });
    return;
  }
  post({ type: 'progress', stage: 'Loading geometry kernel', pct: 0.25 });
  const m = await ensureMod();
  const mesh = new m.Mesh({ numProp: 3, vertProperties: full.vertProperties, triVerts: full.triVerts });
  let man: InstanceType<ManifoldMod['Manifold']> | null = null;
  let dec: InstanceType<ManifoldMod['Manifold']> | null = null;
  try {
    post({ type: 'progress', stage: 'Kernel manifold check', pct: 0.35 });
    try {
      man = new m.Manifold(mesh);
    } catch {
      man = null;
    }
    if (!man || !statusOk(man)) {
      // V0.2-preview repair: rebuild the surface from a signed-distance grid of
      // the raw triangle soup (levelSet output is guaranteed manifold)
      post({ type: 'progress', stage: 'Topology not manifold — attempting SDF remesh repair', pct: 0.38 });
      const repairStep = Math.max(0.75, Math.max(...computeBBox(full).dim) / 200);
      const grid0 = await buildSignedDistanceGrid(full, {
        gap: 6, wall: 4, step: repairStep,
        onProgress: (stage, pct) => post({ type: 'progress', stage, pct: 0.38 + pct * 0.06 }),
      });
      const remesh = extractIso(m, grid0, 0);
      const remeshArr = instanceToMeshArrays(remesh);
      remesh.delete();
      man?.delete();
      man = new m.Manifold(new m.Mesh({ numProp: 3, vertProperties: remeshArr.vertProperties, triVerts: remeshArr.triVerts }));
      if (!statusOk(man)) throw new Error('Mesh topology is not manifold and the SDF remesh could not repair it — re-export fused from your modeling tool (full repair lands in V0.2)');
      full = remeshArr;
      warnings.push('Non-manifold topology detected and repaired via SDF remesh (V0.2 preview) — inspect the preview carefully before printing.');
    }
    post({ type: 'progress', stage: 'Decimating analysis mesh', pct: 0.45 });
    dec = man.simplify(0.05);
    const dm = dec.getMesh();
    const analysis: MeshArrays = {
      vertProperties: Float32Array.from(dm.vertProperties),
      triVerts: Uint32Array.from(dm.triVerts.subarray(0, dm.numTri * 3)),
    };
    const analysisTris = dm.numTri;
    const report = buildReport(
      fileName,
      { ...full, vertCount: full.vertProperties.length / 3 },
      analysis,
      analysisTris,
      64,
      (stage, pct) => post({ type: 'progress', stage, pct: 0.5 + pct * 0.45 }),
    );
    report.warnings.unshift(...warnings);
    if (normalized) report.needsSizeConfirm = true;
    state = {
      fileName, master: { vertProperties: full.vertProperties, triVerts: full.triVerts }, analysis, report, lastResult: null,
      fileSha256, lastPlan: null,
      normalizeNote: normalized
        ? `ingest-normalized to a 150 mm default height; physical size must be confirmed in the size panel`
        : null,
    };
    post({ type: 'progress', stage: 'Done', pct: 1 });
    post({ type: 'analysis', report, preview: analysis });
  } finally {
    dec?.delete();
    man?.delete();
  }
}

async function generate(params: GenerateParams): Promise<void> {
  if (!state) throw new Error('Import a master first');
  // gap/wall arrive master-scale-aware from the size panel; the floors are
  // functional manufacturing minimums (reliability brief §2), not kernel limits —
  // they protect CLI/API callers the same way the UI floors protect the panel.
  // Complex shapes (>10% trapped rays) tear a thin silicone skin on pull.
  // Resin keeps its 2 mm wall capability via the fit param; every FDM fit
  // floors at 3 mm — no jacket body below one FDM-safe wall.
  const trappedPct = state.report.axes[0]?.trappedPct ?? 0;
  const floors = functionalFloors(trappedPct, params.fit);
  const gap = Math.min(15, Math.max(floors.gap, params.gap));
  const wall = Math.min(8, Math.max(floors.wall, params.wall)); // 8: Heavy 6.5 preset must survive the clamp
  const m = await ensureMod();
  const t0 = Date.now();

  // SIZE FEATURE (UI layer): uniformly rescale the as-ingested master before
  // the pipeline sees it. state.master stays untouched so repeated regenerations
  // never compound; everything below this block is byte-identical to aea5dc3 —
  // it simply runs on a pre-scaled master. gap/wall remain absolute mm.
  const k = params.masterScale && params.masterScale > 0 ? params.masterScale : 1;
  const master: MeshArrays = k === 1
    ? state.master
    : {
      vertProperties: (() => {
        const out = new Float32Array(state!.master.vertProperties.length);
        for (let i = 0; i < out.length; i++) out[i] = state!.master.vertProperties[i] * k;
        return out;
      })(),
      triVerts: state.master.triVerts,
    };

  post({ type: 'progress', stage: 'Building distance field', pct: 0.05 });
  // V0.2: the grid, package and gates all run on the FULL-RES master — the
  // decimated analysis mesh shrinks pointy features (ears, fingers) by a few
  // mm, which would leave the printed master loose inside its glove
  const grid = await buildSignedDistanceGrid(master, {
    gap, wall, step: 0.75,
    onProgress: (stage, pct) => post({ type: 'progress', stage, pct: 0.05 + pct * 0.55 }),
  });

  // P8 quiet-line seam placement + the FULL candidate ladder (gap retry,
  // release staging, gates, fusion, export prep) live in the shared planner —
  // byte-identical policy to the CLI (plan Task 4).
  const rankedAxes = rankSplitAxes(state.report.axes, state.analysis, grid, gap);

  post({ type: 'progress', stage: 'Splitting jacket and simulating extraction', pct: 0.65 });
  const scaleNotes: string[] = [];
  if (state.normalizeNote) scaleNotes.push(state.normalizeNote);
  if (k !== 1) scaleNotes.push(`size panel scale ×${k.toFixed(4)} applied before analysis`);
  const plan = await planMold({
    mod: m, master, grid, rankedAxes,
    params: { ...params, gap, wall },
    name: state.fileName.replace(/\.[^.]+$/, ''),
    source: {
      inputSha256: state.fileSha256 ?? 'unavailable (hash failed)',
      sourceKind: 'file', units: 'mm',
      scalePolicy: scaleNotes.length ? scaleNotes.join('; ') : 'unscaled — file units taken as millimetres',
      engineCommit: 'browser-runtime',
    },
    ports: false,
    // mold-family intent from the panel's cast chips (same mapping as the CLI):
    // front_only routes a flat-back master to the tray branch (gates in
    // runTrayGates); everything else keeps the generic split-jacket ladder
    castingIntent: {
      inputRole: 'positive_master' as const,
      requiredSurfaces: params.cast === 'front_only' ? 'front_only' as const : 'all_sides' as const,
    },
    // export prep (cleanup + serialized-bytes audit) runs INSIDE the candidate
    // loop exactly as in the CLI — a candidate whose package would fail the
    // final audit yields to the next one before the user ever sees it
    extraWarnings: state.report.warnings,
    onProgress: (stage, pct) => post({ type: 'progress', stage, pct: 0.65 + Math.min(pct, 1) * 0.3 }),
  });

  if (!plan.ok) {
    // all candidates failed — send trap-region data for the failure overlay (T003)
    const bestAxis = plan.bestAxis ?? state.report.bestAxis;
    const trap = trappedColumnMask(state.analysis, bestAxis, 64);
    const u3 = (AXES.indexOf(bestAxis) + 1) % 3, v3 = (AXES.indexOf(bestAxis) + 2) % 3;
    const nV = state.analysis.vertProperties.length / 3;
    const flags = new Uint8Array(nV);
    const vp = state.analysis.vertProperties;
    for (let i = 0; i < nV; i++) {
      const iu = Math.max(0, Math.min(trap.grid - 1, Math.floor(((vp[i * 3 + u3] - trap.minU) / trap.spanU) * trap.grid)));
      const iv = Math.max(0, Math.min(trap.grid - 1, Math.floor(((vp[i * 3 + v3] - trap.minV) / trap.spanV) * trap.grid)));
      if (trap.mask[iv * trap.grid + iu]) flags[i] = 1;
    }
    post({ type: 'failure', axis: bestAxis, trappedPct: state.report.axes[0].trappedPct,
      message: plan.message + (params.panels === 3
        ? ' — the sub-panels may fragment into disconnected pieces on this shape at these settings.'
        : ' — the highlighted regions trap the jacket on every candidate axis'),
      trapFlags: flags }, [flags.buffer]);
    return;
  }
  const pkg = plan.pkg;
  const effGap = plan.gapEff;
  const is3 = pkg.panels === 3;
  // The planner already built + final-audited the actual package bytes — the
  // export click below just transfers them (identical to the CLI's package).
  state.lastPlan = plan;

  // Connectivity is not an air-trap solver: with no vents and a big or
  // undercuts-heavy pour, flag local high points for manual review (brief §7).
  const extraWarnings: string[] = [];
  if (pkg.ports.vents.length === 0 && (pkg.siliconeMl > 150 || trappedPct > 10)) {
    extraWarnings.push('No automatic air vents were generated. Review local high points before the production pour.');
  }
  const masterFinal = master;
  const masterBaseArr = plan.masterBase;

  const result: GenerateResult = {
    parts: {
      master: masterFinal, masterBase: masterBaseArr,
      jacketOuter: pkg.pieces.jacketSolid,
      jacketA: pkg.pieces.jacketA, jacketB: pkg.pieces.jacketB, basePlate: pkg.pieces.basePlate,
      siliconeSkin: pkg.pieces.skin,
      ...(is3 ? { jacketB1: pkg.pieces.jacketB1!, jacketB2: pkg.pieces.jacketB2! } : {}),
    },
    siliconeMl: pkg.siliconeMl, outerDim: pkg.jacketDim,
    params: { gap: effGap, wall, clearance: params.clearance, gapWindow: params.gapWindow, ribs: params.ribs, material: params.material, panels: pkg.panels, masterScale: k },
    axis: pkg.axis,
    elapsedMs: Date.now() - t0,
    extraction: {
      A: pkg.extraction.A.freeAtMm,
      B: pkg.extraction.B?.freeAtMm ?? (pkg.extraction.B1?.pass && pkg.extraction.B2?.pass ? Math.min(pkg.extraction.B1.freeAtMm, pkg.extraction.B2.freeAtMm) : 0),
      ...(is3 ? { B1: pkg.extraction.B1?.freeAtMm ?? 0, B2: pkg.extraction.B2?.freeAtMm ?? 0 } : {}),
    },
    panels: pkg.panels,
    warnings: [...extraWarnings, ...plan.warnings],
    checks: plan.checks,
    gatesPass: plan.checks.every((c) => c.pass || !c.hard),
    ports: { crown: null, vents: pkg.ports.vents.length },
    clearanceBand: plan.clearanceBand,
    printability: plan.printability,
    frame: { vert: pkg.frame.vert, base: pkg.frame.base, plateT: pkg.plateT },
    // shared-planner metadata (Task 4): export writes the same project.json as the CLI
    method: plan.method,
    source: plan.source,
    transforms: plan.transforms,
    releaseResult: plan.release,
    rejectionLedger: plan.rejectionLedger,
  };
  // SIZE FEATURE: per-part volume of everything the user actually prints (mass
  // estimates in the size panel); preview-only parts excluded
  const partVolumesCm3: Record<string, number> = {};
  for (const [name, mesh] of Object.entries(result.parts)) {
    if (name === 'master' || name === 'siliconeSkin' || name === 'jacketOuter') continue;
    partVolumesCm3[name] = Number(meshVolumeCm3(mesh).toFixed(1));
  }
  result.partVolumesCm3 = partVolumesCm3;
  result.masterScale = k;
  state.lastResult = result;
  // no transfer list — the worker keeps its own copies for the export stage
  post({ type: 'result', result });
}

async function exportPackage(): Promise<void> {
  if (!state || !state.lastResult) throw new Error('Generate a mold first');
  const r = state.lastResult;
  if (!r.gatesPass) throw new Error('Validation gates failed — fix the failed checks before exporting');
  // The shared planner already built and final-audited the package during
  // generate — the download is the exact bytes whose audit ships in
  // project.json (no second cleanup pass, no drift between shown and shipped).
  if (state.lastPlan?.ok) {
    const { zip, fileName } = state.lastPlan.files;
    const blob = zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer;
    post({ type: 'export', blob, fileName }, [blob]);
    return;
  }
  const m = await ensureMod();

  const bb = (m: MeshArrays) => {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < m.vertProperties.length / 3; i++)
      for (let k = 0; k < 3; k++) {
        const x = m.vertProperties[i * 3 + k];
        if (x < min[k]) min[k] = x;
        if (x > max[k]) max[k] = x;
      }
    return [max[0] - min[0], max[1] - min[1], max[2] - min[2]] as number[];
  };
  const { zip, fileName } = buildPrintFiles({
    mod: m,
    masterBase: r.parts.masterBase,
    parts: r.parts,
    info: {
      name: state.fileName.replace(/\.[^.]+$/, ''),
      createdAt: new Date().toISOString(),
      params: r.params,
      axis: r.axis,
      siliconeMl: r.siliconeMl,
      extraction: r.extraction,
      // same-generation diagnostics: project.json / assembly.md /
      // print_profile.json must reflect exactly what the user was shown —
      // including the shared-planner metadata (method/source/transforms/
      // release/ledger) that makes the browser package identical to the CLI's
      method: r.method,
      source: r.source,
      transforms: r.transforms as never,
      release: r.releaseResult as never,
      rejectionLedger: r.rejectionLedger,
      jacketDim: [...r.outerDim],
      plateDim: [...bb(r.parts.basePlate)],
      warnings: r.warnings,
      checks: r.checks,
      crown: r.ports.crown,
      ventCount: r.ports.vents,
      clearanceBand: r.clearanceBand,
      printability: r.printability,
      frame: r.frame,
    },
  });
  const blob = zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer;
  post({ type: 'export', blob, fileName }, [blob]);
}

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  void (async () => {
    try {
      if (req.type === 'ingest') await ingest(req.fileName, req.bytes);
      else if (req.type === 'generate') await generate(req.params);
      else if (req.type === 'export') await exportPackage();
    } catch (err) {
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  })();
};
