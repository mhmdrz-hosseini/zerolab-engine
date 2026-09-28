/// <reference lib="webworker" />
// Geometry worker — owns ALL mesh data (master, analysis mesh, SDF grid,
// Manifold instances). UI state never holds meshes.
import { buildReport, computeBBox, trappedColumnMask, validateMasterMesh } from '../engine/analyze';
import { contoursAtLayer } from '../engine/contours';
import { meshVolumeCm3 } from '../engine/clean';
import { buildPrintFiles } from '../engine/export';
import { runGates } from '../engine/gates';
import { parseGlb } from '../engine/glb';
import { isStatusOk, loadManifold, type ManifoldMod } from '../engine/manifoldLoader';
import { extractIso, instanceToMeshArrays } from '../engine/offset';
import { buildSignedDistanceGrid } from '../engine/offset';
import { analyzePieces } from '../engine/printability';
import { parseObj } from '../engine/obj';
import { generateMoldPackage, pickFrame } from '../engine/split';
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
    state = { fileName, master: { vertProperties: full.vertProperties, triVerts: full.triVerts }, analysis, report, lastResult: null };
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

  // P8 quiet-line seam placement: among axes the ray screen calls clean
  // (≤10% trapped), prefer the smoothest parting-plane contour
  const quiet = new Map<string, number>();
  for (const a of state.report.axes) {
    try {
      const fr = pickFrame(a.axis, state.analysis);
      const loops = contoursAtLayer(grid, AXES.indexOf(a.axis), fr.mid, -gap);
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
    } catch { /* informational only */ }
  }
  const cleanAxes = state.report.axes.filter((a) => a.trappedPct <= 10);
  const restAxes = state.report.axes.filter((a) => a.trappedPct > 10);
  const rankedAxes = [
    ...cleanAxes.sort((a, b) => (quiet.get(a.axis) ?? 99) - (quiet.get(b.axis) ?? 99)).map((a) => a.axis),
    ...restAxes.sort((a, b) => a.trappedPct - b.trappedPct).map((a) => a.axis),
  ];

  post({ type: 'progress', stage: 'Splitting jacket and simulating extraction', pct: 0.65 });
  const buildParams = (g: number) => ({
    gap: g, wall, clearance: params.clearance,
    verticalAxis: params.verticalAxis, splitAxis: params.splitAxis,
    gapWindow: params.gapWindow === undefined ? undefined : Math.min(params.gapWindow, g / 2),
    ribs: params.ribs, material: params.material, panels: params.panels,
  });
  // Gap-retry ladder: a master-scaled gap can fall below what the shape's
  // undercuts need for rigid extraction (undercut depth scales with FEATURES,
  // not master size — a 5 cm spiderman traps exactly like the 15 cm one).
  // Retry at ascending extraction-safe gaps; the grid stays valid (its band is
  // informational for the gates, the envelope works off kernel slices).
  let effGap = gap;
  let pkg = await generateMoldPackage({
    mod: m, master, grid,
    params: buildParams(gap),
    rankedAxes,
    ports: false,
    onProgress: (stage, pct) => post({ type: 'progress', stage, pct: 0.65 + pct * 0.3 }),
  });
  if (!pkg && gap < 8) {
    for (const g of [4, 6, 8].filter((x) => x > gap + 0.01)) {
      post({ type: 'progress', stage: `Scaled gap ${gap} mm could not extract — retrying at ${g} mm`, pct: 0.65 });
      pkg = await generateMoldPackage({
        mod: m, master, grid,
        params: buildParams(g),
        rankedAxes,
        ports: false,
        onProgress: (stage, pct) => post({ type: 'progress', stage, pct: 0.65 + pct * 0.3 }),
      });
      if (pkg) {
        effGap = g;
        pkg.warnings.push(`the master-scaled ${gap} mm silicone gap could not extract this shape (undercuts don't shrink with the master) — generated at a ${g} mm gap; the frame is proportionally deeper than the master`);
        break;
      }
    }
  }

  if (!pkg) {
    // all ranked axes failed — send trap-region data for the failure overlay (T003)
    const bestAxis = state.report.bestAxis;
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
      message: params.panels === 3
        ? 'No extractable 3-piece split — the sub-panels fragment into disconnected pieces on this shape at these settings. Try a smaller silicone gap (the sub-panels stay connected at gap ≤ ~6 on this model) or keep the 2-piece jacket with painted supports.'
        : 'No candidate axis produced an extractable 2-piece mold — the highlighted regions trap the jacket on every candidate axis',
      trapFlags: flags }, [flags.buffer]);
    return;
  }

  post({ type: 'progress', stage: 'Running validation gates', pct: 0.96 });
  const is3 = !!pkg.pieces.jacketB1 && !!pkg.pieces.jacketB2;
  const gateReport = runGates({
    grid, gap: effGap, wall, step: grid.step,
    frame: pkg.frame,
    ports: pkg.ports,
    master,
    pieceArrays: is3
      ? [pkg.pieces.jacketA, pkg.pieces.jacketB1!, pkg.pieces.jacketB2!, pkg.pieces.basePlate]
      : [pkg.pieces.jacketA, pkg.pieces.jacketB, pkg.pieces.basePlate],
    siliconeMl: pkg.siliconeMl,
    cavityLoops: pkg.cavityLoops, cavitySections: pkg.cavitySections,
    gapWindow: params.gapWindow,
  });

  // Preserve the master. The slicer controls infill; sealed CAD hollows can
  // introduce unsupported ceilings and disconnected internal surfaces.
  const extraWarnings: string[] = [];
  // The preliminary ray analysis only ranks candidates; the final rigid-jacket
  // extraction simulation is authoritative. Explain the downgrade instead of
  // letting the axis change look like a bug (reliability brief §6).
  if (pkg.axis !== state.report.bestAxis) {
    extraWarnings.push(`${state.report.bestAxis} was the best preliminary pull axis, but it failed the final rigid-jacket extraction test — ${pkg.axis} was selected as the first extractable split`);
  }
  // Connectivity is not an air-trap solver: with no vents and a big or
  // undercuts-heavy pour, flag local high points for manual review (brief §7).
  if (pkg.ports.vents.length === 0 && (pkg.siliconeMl > 150 || trappedPct > 10)) {
    extraWarnings.push('No automatic air vents were generated. Review local high points before the production pour.');
  }
  const masterFinal = master;

  // master_base = (hollowed) doll ∪ fused base plate — V0.2 architecture
  let masterBaseArr = masterFinal;
  try {
    const mm = new m.Manifold(new m.Mesh({ numProp: 3, vertProperties: masterFinal.vertProperties, triVerts: masterFinal.triVerts }));
    const pm = new m.Manifold(new m.Mesh({ numProp: 3, vertProperties: pkg.pieces.basePlate.vertProperties, triVerts: pkg.pieces.basePlate.triVerts }));
    const fused = mm.add(pm);
    if (!isStatusOk(fused)) throw new Error('Master/base union failed');
    masterBaseArr = instanceToMeshArrays(fused);
    fused.delete(); pm.delete(); mm.delete();
  } catch { throw new Error('Could not fuse the master to its base plate'); }

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
    warnings: [...extraWarnings, ...gateReport.warnings, ...pkg.warnings, ...state.report.warnings],
    checks: gateReport.checks,
    gatesPass: gateReport.pass,
    ports: { crown: null, vents: pkg.ports.vents.length },
    clearanceBand: gateReport.clearanceBand,
    printability: analyzePieces({
      mod: m, masterBase: masterBaseArr,
      jackets: is3
        ? [{ name: 'jacket_A', mesh: pkg.pieces.jacketA }, { name: 'jacket_B1', mesh: pkg.pieces.jacketB1! }, { name: 'jacket_B2', mesh: pkg.pieces.jacketB2! }]
        : [{ name: 'jacket_A', mesh: pkg.pieces.jacketA }, { name: 'jacket_B', mesh: pkg.pieces.jacketB }],
      vert: pkg.frame.vert, base: pkg.frame.base, crown: pkg.frame.crown,
      plateT: pkg.plateT,
    }),
    frame: { vert: pkg.frame.vert, base: pkg.frame.base, plateT: pkg.plateT },
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
      jacketDim: [...r.outerDim],
      plateDim: [...bb(r.parts.basePlate)],
      warnings: r.warnings,
      checks: r.checks,
      crown: r.ports.crown,
      ventCount: r.ports.vents,
      // same-generation diagnostics: project.json / assembly.md /
      // print_profile.json must reflect exactly what the user was shown
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
