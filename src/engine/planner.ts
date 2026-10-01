// Shared mold planner (plan Task 4): ONE candidate pipeline for CLI, browser
// worker and tests. Owns axis ranking, the gap-retry ladder, and per-candidate
// evaluation through the COMPLETE chain — construction, staged rigid release,
// validation gates, master/base fusion, export preparation (cleanup + final
// serialized-bytes audit). A candidate that fails any stage yields to the next
// one; every rejection lands in the ledger that ships in project.json.
//
// The planner coordinates pure modules (split/gates/export); it does not
// reimplement construction. Method selection starts as the generic split
// jacket — the M1 selector (moldMethod.ts / reliefTray.ts) slots into
// chooseMethod without changing this pipeline.
import { buildMoldForAxis, extractionFailText, extractionPass, frameConstants, pickFrame, type AxisAttempt } from './split';
import { classifyMethods } from './moldMethod';
import { buildReliefTray } from './reliefTray';
import { runGates, runTrayGates, type GateCheck } from './gates';
import { buildPrintFiles, type PrintFiles, type ReleaseReport } from './export';
import { analyzePieces } from './printability';
import { isStatusOk, type ManifoldMod } from './manifoldLoader';
import { contoursAtLayer } from './contours';
import { AXES, type Axis, type GenerateParams, type MeshArrays } from './types';
import type { SdfGrid } from './offset';
import { instanceToMeshArrays } from './offset';

export interface PlanSource {
  inputSha256: string;
  sourceKind: 'file' | 'mesh';    // hash of the original file bytes, or of the mesh buffers
  units: 'mm';
  scalePolicy: string;            // e.g. "unscaled (file already mm)" or "scaled ×1.33 to 200 mm (--size)"
  engineCommit: string;
}

export interface TransformReport {
  moldVertical: Axis;
  pourAxis: Axis;
  asExported: boolean;
  rotateAbout: 'X' | 'Y' | null;
  degrees: number | null;
  instruction: string;            // human-printable slicer orientation guidance
  frame: { vert: Axis; base: number; mid: number; crown: number; pull: Axis; plateT: number };
}

export type RejectionEntry = { candidate: string; stage: 'construction' | 'release' | 'gate' | 'export'; reason: string };

export interface MethodReport {
  family: string;
  panels: number;
  splitAxis: string;
  confidence: string;
  note: string;
  selectorTop?: string;
  selectorReason?: string;
  selectorMeasures?: { backingPatchAreaMm2: number; backingCoverage: number; flatnessRatio: number; footprintSpanMinMm: number; footprintSpanMaxMm: number };
}

export interface PlanSuccess {
  ok: true;
  method: MethodReport;
  source: PlanSource;
  transforms: TransformReport;
  release: ReleaseReport;
  rejectionLedger: RejectionEntry[];
  pkg: AxisAttempt;
  masterBase: MeshArrays;
  printability: ReturnType<typeof analyzePieces>;
  checks: GateCheck[];
  gapEff: number;
  clearanceBand?: { requestedGap: number; min: number; p10: number; p50: number; p90: number; withinBand: boolean };
  files: PrintFiles;
  warnings: string[];
}

export interface PlanFailure {
  ok: false;
  rejectionLedger: RejectionEntry[];
  message: string;
  bestAxis: Axis | null;
}

// --- shared candidate ranking (was duplicated in CLI and worker) ---
export function rankSplitAxes(
  axes: { axis: Axis; trappedPct: number }[], analysis: MeshArrays, grid: SdfGrid, gap: number,
): Axis[] {
  const quiet = new Map<string, number>();
  for (const a of axes) {
    try {
      const fr = pickFrame(a.axis, analysis);
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
    } catch { /* informational */ }
  }
  const cleanAxes = axes.filter((a) => a.trappedPct <= 10);
  const restAxes = axes.filter((a) => a.trappedPct > 10);
  return [
    ...cleanAxes.sort((a, b) => (quiet.get(a.axis) ?? 99) - (quiet.get(b.axis) ?? 99)).map((a) => a.axis),
    ...restAxes.sort((a, b) => a.trappedPct - b.trappedPct).map((a) => a.axis),
  ];
}

/** Printer orientation for the exported CAD: derived from the mold frame the
 *  same way export.ts words it, as structured data (audit: X/Y pour axes were
 *  told "as exported" — a non-Z vertical must never claim that). */
export function transformReport(pkg: AxisAttempt, masterMesh: MeshArrays): TransformReport {
  const { vert, base } = pkg.frame;
  const plateT = pkg.plateT;
  let asExported = vert === 'Z';
  let rotateAbout: 'X' | 'Y' | null = null;
  let degrees: number | null = null;
  let instruction = 'print plate-down, as exported — never flip it';
  if (!asExported) {
    const vi = vert === 'X' ? 0 : 1;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < masterMesh.vertProperties.length / 3; i++) {
      const v = masterMesh.vertProperties[i * 3 + vi];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const atMin = Math.abs((base - plateT) - lo) <= Math.abs(hi - (base - plateT));
    rotateAbout = vert === 'X' ? 'Y' : 'X';
    degrees = vert === 'Y' ? (atMin ? 90 : -90) : (atMin ? -90 : 90);
    instruction = `rotate ${degrees > 0 ? '+' : '−'}${Math.abs(degrees)}° about ${rotateAbout} so the base plate lies flat on the bed (mold vertical is ${vert} in the exported coordinates)`;
  }
  return {
    moldVertical: vert, pourAxis: pkg.axis,
    asExported, rotateAbout, degrees, instruction,
    frame: { vert: pkg.frame.vert, base: pkg.frame.base, mid: pkg.frame.mid, crown: pkg.frame.crown, pull: pkg.frame.pull, plateT: pkg.plateT },
  };
}

const releaseOf = (pkg: AxisAttempt): ReleaseReport => {
  const step = (part: string, direction: string, r: { pass: boolean; freeAtMm: number; obstacle?: string } | null | undefined) => ({
    part, direction, pass: !!r?.pass, freeAtMm: r?.freeAtMm ?? 0,
    ...(!r?.pass && r?.obstacle ? { obstacle: r.obstacle } : {}),
  });
  const is3pc = !!(pkg.pieces.jacketB1 && pkg.pieces.jacketB2);
  return {
    rigid: is3pc
      ? [step('jacket_A', `slide ±${pkg.axis}`, pkg.extraction.A),
         step('jacket_B1', `slide ±${pkg.frame.depth}`, pkg.extraction.B1),
         step('jacket_B2', `slide ±${pkg.frame.depth}`, pkg.extraction.B2)]
      : [step('jacket_A', `slide ±${pkg.axis}`, pkg.extraction.A),
         step('jacket_B', `slide ±${pkg.axis}`, pkg.extraction.B)],
    siliconeDemold: pkg.siliconeDemold,
  };
};

export interface PlanRequest {
  mod: ManifoldMod;
  master: MeshArrays;             // validated, scaled, millimetres
  grid: SdfGrid;
  rankedAxes: Axis[];
  params: GenerateParams;
  name: string;
  source: PlanSource;
  ports?: boolean;
  castingIntent?: { inputRole: 'positive_master' | 'prebuilt_negative_mold' | 'tooling' | 'unknown'; requiredSurfaces: 'front_only' | 'all_sides' | 'inner_and_outer' | 'unspecified' };
  extraWarnings?: string[];       // caller-specific (parse warnings, intake notes)
  // Export prep (cleanup + serialized-bytes final audit) always runs INSIDE the
  // candidate loop: a candidate whose export would fail must yield to the next
  // one, and the decision metadata must be identical in every adapter. Callers
  // that don't need the bytes can discard them; they cannot skip the audit.
  onProgress?: (stage: string, pct: number) => void;
}

/** One planMold call = the complete shared pipeline. The gap-retry ladder
 *  (worker policy, now shared) wraps the axis ladder: a master-scaled gap can
 *  fall below what undercuts need — undercuts scale with FEATURES. */
export async function planMold(req: PlanRequest): Promise<PlanSuccess | PlanFailure> {
  const { mod, master, grid, params } = req;
  const ledger: RejectionEntry[] = [];
  const gapWarnings: string[] = [];

  // Explicit split axis overrides both ladders entirely (one candidate).
  const requestedGap = params.gap;
  const gapLadder: number[] = params.splitAxis ? [requestedGap]
    : requestedGap < 8 ? [requestedGap, ...[4, 6, 8].filter((x) => x > requestedGap + 0.01)]
    : [requestedGap];
  // Panel-plan phases (policy preserved from the old ladder): the requested
  // panel count across the gap ladder; when every 2-piece candidate fails, ONE
  // 3-piece retry on the highest-ranked axis at the requested gap.
  const phases: { panels: 2 | 3; gaps: number[] }[] = params.panels === 3
    ? [{ panels: 3, gaps: gapLadder }]
    : [{ panels: 2, gaps: gapLadder }, { panels: 3, gaps: [requestedGap] }];

  const buildParams = (g: number, panels: 2 | 3): GenerateParams => ({
    ...params,
    gap: g,
    panels,
    gapWindow: params.gapWindow === undefined ? undefined : Math.min(params.gapWindow, g / 2),
  });

  // Tray phase (Task 6): a confirmed front-only cast whose backing plane
  // measures flat routes to the open-face relief tray BEFORE any jacket
  // candidate. Tray failure yields to the jacket ladder with a ledger entry.
  const intent = req.castingIntent ?? { inputRole: 'positive_master' as const, requiredSurfaces: 'all_sides' as const };
  if (intent.inputRole === 'positive_master' && intent.requiredSurfaces === 'front_only') {
    const selector = classifyMethods(master, intent);
    if (selector[0].method === 'open_face_relief') {
      req.onProgress?.('Building the open-face relief tray', 0.7);
      try {
        // frame-scaled tray constants (same scaling law as frameConstants):
        // the old hardcoded plateT 4 / freeboard 5 over-thickened small trays
        // and under-floored large ones
        let lo0 = Infinity, hi0 = -Infinity, lo1 = Infinity, hi1 = -Infinity, lo2 = Infinity, hi2 = -Infinity;
        for (let i = 0; i < master.vertProperties.length / 3; i++) {
          const x = master.vertProperties[i * 3], y = master.vertProperties[i * 3 + 1], z = master.vertProperties[i * 3 + 2];
          if (x < lo0) lo0 = x; if (x > hi0) hi0 = x;
          if (y < lo1) lo1 = y; if (y > hi1) hi1 = y;
          if (z < lo2) lo2 = z; if (z > hi2) hi2 = z;
        }
        const maxDim = Math.max(hi0 - lo0, hi1 - lo1, hi2 - lo2);
        const K = frameConstants(maxDim);
        const s = Math.max(0.2, Math.min(1, maxDim / 150));
        const trayPlateT = K.plateT;                 // floor 3.5
        const trayFreeboard = Math.max(4, 5 * s);    // tray ref 5, floor 4
        const trayBacking = Math.max(4, params.gap);
        const tray = buildReliefTray({
          mod, master,
          params: {
            gap: params.gap, wall: params.wall, plateT: trayPlateT,
            backing: trayBacking, freeboard: trayFreeboard,
            keyRing: { tongueW: K.tongue, clearance: params.clearance },
          },
        });
        // tray gates: printed parts are single valid solids, silicone positive
        for (const [name, mesh] of [['tray wall', tray.pieces.wall], ['master base', tray.pieces.masterBase]] as const) {
          const m = new mod.Manifold(new mod.Mesh({ numProp: 3, ...mesh }));
          if (!isStatusOk(m)) throw new Error(`${name} is not a valid solid`);
          const comps = m.decompose();
          if (comps.length !== 1) throw new Error(`${name} has ${comps.length} disconnected components`);
          comps.forEach((x) => x.delete());
          m.delete();
        }
        const trayGates = runTrayGates({
          gap: params.gap, wall: params.wall, master,
          wallPiece: tray.pieces.wall, masterBase: tray.pieces.masterBase,
          siliconeMl: tray.siliconeMl, masterTopZ: tray.masterTopZ, wallTopZ: tray.wallTopZ,
          backing: trayBacking, freeboard: trayFreeboard, keyRing: tray.keyRing,
        });
        const trayHardFails = trayGates.checks.filter((c) => !c.pass && c.hard);
        if (trayHardFails.length > 0) {
          ledger.push({ candidate: 'open-face tray', stage: 'gate', reason: trayHardFails.map((c) => `${c.name} (${c.detail})`).join('; ') });
        } else {
        const trayRelease: ReleaseReport = {
          rigid: [{ part: 'tray wall', direction: 'lift +Z (open top)', pass: true, freeAtMm: 0 }],
          siliconeDemold: tray.siliconeDemold,
        };
        const trayTransforms = transformReport(
          { frame: { vert: 'Z', base: 0, mid: 0, crown: tray.wallTopZ, pull: 'Z', depth: 'X' }, plateT: trayPlateT, axis: 'Z', pieces: null as never, siliconeMl: tray.siliconeMl, ports: { crown: null, vents: [], vAx: 0, u3: 1, v3: 2 }, cavityLoops: [], cavitySections: [], cavity: master, warnings: [], failedAxes: [], siliconeDemold: tray.siliconeDemold, panels: 1, jacketDim: [0, 0, 0], plateDim: [0, 0, 0], extraction: { A: { pass: true, freeAtMm: 0 }, B: null } } as never,
          tray.pieces.masterBase,
        );
        const trayMethod = {
          family: 'open_face_relief', panels: 1, splitAxis: 'Z',
          confidence: 'selector-confirmed',
          note: `open-face relief tray: ${selector[0].reason}`,
          selectorTop: selector[0].method,
          selectorReason: selector[0].reason,
          selectorMeasures: selector[0].measures,
        } as const;
        const wb = new mod.Manifold(new mod.Mesh({ numProp: 3, ...tray.pieces.wall })).boundingBox();
        const trayOuterX = wb.max[0] - wb.min[0], trayOuterY = wb.max[1] - wb.min[1];
        const trayWarnings = [...(req.extraWarnings ?? []), ...tray.warnings];
        try {
          const files = buildPrintFiles({
            mod, masterBase: tray.pieces.masterBase,
            parts: { master: master, masterBase: tray.pieces.masterBase, trayWall: tray.pieces.wall, siliconeSkin: tray.pieces.siliconeSkin },
            info: {
              name: req.name, createdAt: new Date().toISOString(),
              params: { ...params, panels: 1 as 2 },
              axis: 'Z',
              release: trayRelease, method: trayMethod, source: req.source,
              transforms: trayTransforms, rejectionLedger: ledger,
              siliconeMl: tray.siliconeMl,
              extraction: { A: 0, B: 0 },
              jacketDim: [trayOuterX, trayOuterY, tray.wallTopZ + 4],
              plateDim: [0, 0, 0],
              warnings: trayWarnings,
              checks: [...trayGates.checks, { name: 'Open-face tray construction', pass: true, hard: true, detail: `wall top ${tray.wallTopZ} mm backs master top ${tray.masterTopZ} mm; silicone ${tray.siliconeMl} mL` }],
              crown: null, ventCount: 0,
              frame: { vert: 'Z', base: 0, plateT: trayPlateT },
            },
          });
          return {
            ok: true, method: trayMethod, source: req.source, transforms: trayTransforms,
            release: trayRelease, rejectionLedger: ledger,
            pkg: { axis: 'Z', frame: trayTransforms.frame as never, pieces: { jacketA: tray.pieces.wall, jacketB: tray.pieces.wall, basePlate: tray.pieces.basePlate, skin: tray.pieces.siliconeSkin, jacketSolid: tray.pieces.wall }, extraction: { A: { pass: true, freeAtMm: 0 }, B: null }, siliconeDemold: tray.siliconeDemold, panels: 1 as 2, jacketDim: [0, 0, 0], plateDim: [0, 0, 0], plateT: trayPlateT, ports: { crown: null, vents: [], vAx: 0, u3: 1, v3: 2 }, siliconeMl: tray.siliconeMl, cavityLoops: [], cavitySections: [], cavity: master, warnings: trayWarnings },
            masterBase: tray.pieces.masterBase,
            printability: {}, checks: trayGates.checks, gapEff: params.gap,
            clearanceBand: trayGates.clearanceBand, files, warnings: trayWarnings,
          };
        } catch (err) {
          ledger.push({ candidate: 'open-face tray', stage: 'export', reason: err instanceof Error ? err.message : String(err) });
        }
        }
      } catch (err) {
        ledger.push({ candidate: 'open-face tray', stage: 'construction', reason: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  for (const phase of phases) {
  for (const gap of phase.gaps) {
    if (gap !== requestedGap) {
      req.onProgress?.(`Scaled gap ${requestedGap} mm could not extract — retrying at ${gap} mm`, 0.65);
    }
    const ranked = params.splitAxis ? [params.splitAxis] : req.rankedAxes;
    if (ranked.length === 0) continue;
    for (let i = 0; i < ranked.length; i++) {
      const axis = ranked[i];
      const candidate = `±${axis} (${phase.panels}-piece) @gap ${gap}`;
      req.onProgress?.(`Splitting along ±${axis} (candidate ${i + 1}/${ranked.length}, gap ${gap})`, 0.65 + (i / ranked.length) * 0.05);
      let pkg: AxisAttempt | null = null;
      try {
        pkg = await buildMoldForAxis({
          mod, master, grid, params: buildParams(gap, phase.panels), axis, ports: req.ports ?? false,
          onProgress: req.onProgress,
        });
      } catch (err) {
        ledger.push({ candidate, stage: 'construction', reason: err instanceof Error ? err.message : String(err) });
        continue;
      }
      if (!pkg) continue;
      if (!extractionPass(pkg.extraction)) {
        ledger.push({ candidate, stage: 'release', reason: extractionFailText(pkg.extraction) });
        continue;
      }

      req.onProgress?.('Running validation gates', 0.96);
      const is3 = !!(pkg.pieces.jacketB1 && pkg.pieces.jacketB2);
      const gates = runGates({
        grid, gap, wall: params.wall, step: grid.step,
        frame: pkg.frame, ports: pkg.ports, master,
        pieceArrays: is3
          ? [pkg.pieces.jacketA, pkg.pieces.jacketB1!, pkg.pieces.jacketB2!, pkg.pieces.basePlate]
          : [pkg.pieces.jacketA, pkg.pieces.jacketB, pkg.pieces.basePlate],
        siliconeMl: pkg.siliconeMl,
        cavityLoops: pkg.cavityLoops, cavitySections: pkg.cavitySections,
        gapWindow: buildParams(gap, phase.panels).gapWindow,
      });
      const hardFailures = gates.checks.filter((c) => !c.pass && c.hard);
      if (hardFailures.length > 0) {
        ledger.push({ candidate, stage: 'gate', reason: hardFailures.map((c) => `${c.name} (${c.detail})`).join('; ') });
        continue;
      }

      // Winner so far — prepare the actual export (cleanup + final-file audit).
      // An export failure yields to the next candidate, never ships broken.
      req.onProgress?.('Preparing the print package', 0.97);
      let masterBase: MeshArrays;
      try {
        const mm = new mod.Manifold(new mod.Mesh({ numProp: 3, vertProperties: master.vertProperties, triVerts: master.triVerts }));
        const pm = new mod.Manifold(new mod.Mesh({ numProp: 3, vertProperties: pkg.pieces.basePlate.vertProperties, triVerts: pkg.pieces.basePlate.triVerts }));
        const fused = mm.add(pm);
        if (!isStatusOk(fused)) throw new Error('master/base union is not a valid solid');
        masterBase = instanceToMeshArrays(fused);
        fused.delete(); pm.delete(); mm.delete();
      } catch (err) {
        ledger.push({ candidate, stage: 'export', reason: `master/base fusion failed: ${err instanceof Error ? err.message : err}` });
        continue;
      }
      const printability = analyzePieces({
        mod, masterBase,
        jackets: is3
          ? [{ name: 'jacket_A', mesh: pkg.pieces.jacketA }, { name: 'jacket_B1', mesh: pkg.pieces.jacketB1! }, { name: 'jacket_B2', mesh: pkg.pieces.jacketB2! }]
          : [{ name: 'jacket_A', mesh: pkg.pieces.jacketA }, { name: 'jacket_B', mesh: pkg.pieces.jacketB! }],
        vert: pkg.frame.vert, base: pkg.frame.base, crown: pkg.frame.crown, plateT: pkg.plateT,
      });
      const warnings = [
        ...(req.extraWarnings ?? []),
        ...gapWarnings,
        ...(pkg.axis !== req.rankedAxes[0] ? [`${req.rankedAxes[0]} was the best preliminary pull axis, but later candidates failed — ±${pkg.axis} was selected as the first fully feasible split`] : []),
        ...gates.warnings, ...pkg.warnings,
      ];
      if (gap !== requestedGap) {
        warnings.push(`the master-scaled ${requestedGap} mm silicone gap could not extract this shape (undercuts don't shrink with the master) — generated at a ${gap} mm gap; the frame is proportionally deeper than the master`);
      }
      const transforms = transformReport(pkg, master);
      const release = releaseOf(pkg);
      const intent = req.castingIntent ?? { inputRole: 'positive_master' as const, requiredSurfaces: 'all_sides' as const };
      const familyCandidates = classifyMethods(master, intent);
      const method = {
        family: 'full_3d_jacket', panels: pkg.panels, splitAxis: pkg.axis,
        confidence: 'heuristic-ladder',
        note: 'generic split jacket with open crown',
        selectorTop: familyCandidates[0].method,
        selectorReason: familyCandidates[0].reason,
        selectorMeasures: familyCandidates[0].measures,
      } as const;
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
      const info = {
        name: req.name,
        createdAt: new Date().toISOString(),
        params: { ...buildParams(gap, phase.panels), panels: pkg.panels },
        axis: pkg.axis,
        release,
        method,
        source: req.source,
        transforms,
        rejectionLedger: ledger,
        siliconeMl: pkg.siliconeMl,
        extraction: {
          A: pkg.extraction.A.freeAtMm,
          B: pkg.extraction.B?.freeAtMm ?? 0,
          ...(is3 ? { B1: pkg.extraction.B1?.freeAtMm ?? 0, B2: pkg.extraction.B2?.freeAtMm ?? 0 } : {}),
        } as { A: number; B: number; B1?: number; B2?: number },
        jacketDim: [...pkg.jacketDim] as number[],
        plateDim: [...bbOf(pkg.pieces.basePlate)] as number[],
        warnings,
        checks: gates.checks,
        crown: null,
        ventCount: pkg.ports.vents.length,
        clearanceBand: gates.clearanceBand,
        printability,
        frame: { vert: pkg.frame.vert, base: pkg.frame.base, plateT: pkg.plateT },
      };
      try {
        const files = buildPrintFiles({
          mod, masterBase,
          parts: { ...pkg.pieces, siliconeSkin: pkg.pieces.skin, master, masterBase },
          info,
        });
        return {
          ok: true,
          method,
          source: req.source,
          transforms,
          release,
          rejectionLedger: ledger,
          pkg, masterBase, printability, checks: gates.checks,
          gapEff: gap, files, warnings, clearanceBand: gates.clearanceBand,
        };
      } catch (err) {
        ledger.push({ candidate, stage: 'export', reason: err instanceof Error ? err.message : String(err) });
        continue;
      }
    }
  }
  }

  return {
    ok: false, rejectionLedger: ledger,
    message: `every candidate failed (${ledger.length} rejection(s) across the gap ladder ${gapLadder.join('→')} mm)`,
    bestAxis: req.rankedAxes[0] ?? null,
  };
}
