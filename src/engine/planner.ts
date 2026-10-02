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
import { buildMoldForAxis, extractionFailText, extractionPass, pickFrame, type AxisAttempt } from './split';
import { classifyMethods } from './moldMethod';
import { buildReliefTray } from './reliefTray';
import { backingCandidates, canonicalizeBacking, pickStabilityBacking, stabilityBackingCandidates, type CanonicalFrame, type Vec3 } from './orientation';
import { rankAxes } from './analyze';
import { runGates, type GateCheck } from './gates';
import { buildPrintFiles, type PrintFiles, type ReleaseReport, type TopologyRepairRecord } from './export';
import { analyzePieces } from './printability';
import { isStatusOk, type ManifoldInstance, type ManifoldMod } from './manifoldLoader';
import { contoursAtLayer } from './contours';
import { AXES, type Axis, type CastingIntent, type GenerateParams, type MeshArrays } from './types';
import type { SdfGrid } from './offset';
import { buildSignedDistanceGrid, extractIso, instanceToMeshArrays } from './offset';
import { normalizePositiveShells } from './solid';
import { cleanExportMesh } from './clean';
import { auditSerializedStl } from './finalAudit';

// V3 bounded skin repair (fidelity rule: displacement ≤ min(0.05 mm,
// finestProtectedFeatureMm/10)). Mesh-statistical minima cannot certify the
// feature width on sculpted sources — obj_1_Körper measures min self-clearance
// 0.000 mm from tessellation self-contacts and a 0.0012 mm shortest edge — so
// the floor is the platform's own master print profile: a 0.4 mm nozzle with
// 0.12 mm minimum layer cannot carry protected amplitude below one layer.
// Budget = min(0.05, 0.12/10) = 0.012 mm; the smallest kernel tolerance
// measured effective on the Körper pinched edge is 0.005 mm (handoff
// 2026-09-30, scratch/v3/rescue-skin.ts).
const PROTECTED_FEATURE_FLOOR_MM = 0.12;
const SKIN_REPAIR_TOLERANCE_MM = 0.005;

export interface PlanSource {
  inputSha256: string;
  sourceKind: 'file' | 'mesh';    // hash of the original file bytes, or of the mesh buffers
  units: 'mm';
  scalePolicy: string;            // e.g. "unscaled (file already mm)" or "scaled ×1.33 to 200 mm (--size)"
  engineCommit: string;
}

export interface TransformReport {
  sourceToMold?: CanonicalFrame['sourceToMold'];
  moldToSource?: CanonicalFrame['moldToSource'];
  backingSelection?: 'user-signed' | 'auto-plane' | 'auto-stability'; // how the mold frame's backing was chosen
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
  moldMaster: MeshArrays; // the approved, canonicalized master shown with the exported tooling
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
  outcome: 'review_required' | 'unsupported' | 'rejected';
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
  grid?: SdfGrid; // legacy caller hint for resolution; full-3D grid is rebuilt in the canonical frame
  rankedAxes?: Axis[];
  params: GenerateParams;
  name: string;
  source: PlanSource;
  ports?: boolean;
  castingIntent?: CastingIntent;
  extraWarnings?: string[];       // caller-specific (parse warnings, intake notes)
  // Internal: how many ALTERNATE stability poses the planner may retry when
  // the primary auto pose fails construction everywhere (one bad standing
  // direction must not condemn a moldable figure). User-signed backing never
  // retries — the signed pose is the approved one.
  poseRetryBudget?: number;
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
  const { mod, params } = req;
  let master = req.master;
  let grid = req.grid;
  let rankedAxes = req.rankedAxes ?? [];
  let fullFrame: CanonicalFrame | undefined;
  const ledger: RejectionEntry[] = [];
  const gapWarnings: string[] = [];
  const intent = req.castingIntent;
  const review = (message: string): PlanFailure => ({ ok: false, outcome: 'review_required',
    message, rejectionLedger: ledger, bestAxis: null });
  if (!intent || intent.requiredSurfaces === 'unspecified' || intent.inputRole === 'unknown') {
    return review('Confirm input role and required casting surfaces before choosing the mold family.');
  }
  if (intent.inputRole !== 'positive_master') {
    return review(`Input role ${intent.inputRole} requires review: identify the intended positive casting before generating tooling.`);
  }
  if (intent.requiredSurfaces === 'inner_and_outer' || intent.requestedFamily === 'vessel_core') {
    return review('Inner/outer vessel casting requires a validated core and demolding strategy; generic jacket generation cannot certify it.');
  }
  // Intake parity with the browser worker: a sculpt that is not a kernel-valid
  // solid gets the SDF remesh repair (level-set output is guaranteed
  // manifold) instead of a hard crash — measured on japandi+hart+klein, which
  // the worker already repairs the same way at ingest.
  {
    let probe: import('./manifoldLoader').ManifoldInstance | null = null;
    let ok = false;
    try {
      probe = new mod.Manifold(new mod.Mesh({ numProp: 3, ...master }));
      ok = isStatusOk(probe);
    } catch { ok = false; }
    probe?.delete();
    if (!ok) {
      req.onProgress?.('Topology not manifold — attempting SDF remesh repair', 0.3);
      const maxDim = Math.max(...(() => {
        let lo = Infinity, hi = -Infinity;
        for (let i = 0; i < master.vertProperties.length; i++) {
          const v = master.vertProperties[i];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        return [Math.max(hi - lo, 1)];
      })());
      const grid0 = await buildSignedDistanceGrid(master, { gap: 6, wall: 4, step: Math.max(0.75, maxDim / 200) });
      const remesh = extractIso(mod, grid0, 0);
      const repaired = instanceToMeshArrays(remesh);
      remesh.delete();
      let verify: import('./manifoldLoader').ManifoldInstance | null = null;
      try {
        verify = new mod.Manifold(new mod.Mesh({ numProp: 3, ...repaired }));
        ok = isStatusOk(verify);
      } catch { ok = false; }
      verify?.delete();
      if (!ok) return review('Input topology is not a solid and the SDF remesh repair could not reconstruct one — re-export the model fused/watertight from your modeling tool.');
      master = repaired;
      gapWarnings.push('Non-manifold topology repaired via SDF remesh — the cast surface is a reconstruction; inspect the preview before printing.');
    }
  }
  const familyCandidates = classifyMethods(master, intent);
  const requestedFamily = intent.requestedFamily ?? 'auto';
  if (requestedFamily === 'open_face_relief' && intent.requiredSurfaces !== 'front_only') {
    return review('An open-face relief requires approval of the open backing surface (front_only intent).');
  }
  const wantsTray = requestedFamily === 'open_face_relief'
    || (requestedFamily === 'auto' && intent.requiredSurfaces === 'front_only');
  if (wantsTray && familyCandidates[0].method !== 'open_face_relief') {
    return review(`Confirm a suitable backing face for this front-only request: ${familyCandidates[0].reason}`);
  }
  const possibleBacking = wantsTray ? backingCandidates(master) : [];
  if (wantsTray && !intent.backingNormalSource && possibleBacking.length > 1
      && possibleBacking[1].areaMm2 / possibleBacking[0].areaMm2 >= 0.98) {
    return review('Two backing faces have nearly equal measured support area; select the signed backing side before generating a relief tray.');
  }
  let chosenVertical: Axis | undefined = params.verticalAxis;
  // Set by the full-3D branch: a split along the (canonical Z) backing axis is
  // only admissible where its mid plane clears the master's base band.
  let zSplitClearsBaseBand: (mid: number, base: number) => boolean = () => false;
  let transformsBackingSelection: TransformReport['backingSelection'];
  // Alternate stability poses for the construction-failure retry below.
  let poseAlternatives: Vec3[] = [];
  if (!wantsTray) {
    const raw = new mod.Manifold(new mod.Mesh({ numProp: 3, ...master }));
    const rawShells = raw.decompose();
    const rawPositiveCount = rawShells.filter(x => x.volume() > 0.01).length;
    rawShells.forEach(x => x.delete()); raw.delete();
    const multiBodyHandling = intent.multiBodyHandling ?? 'auto_review';
    if (rawPositiveCount > 1 && multiBodyHandling !== 'fuse_overlapping') {
      return review(`The source has ${rawPositiveCount} positive surface shells. You requested ${multiBodyHandling === 'separate_casts' ? 'separate cast pieces' : 'no automatic joining'}; a single jacket/master package would make unsupported or merged geometry. Plan and verify one fillable mold per intended piece, with any shared overlap explicitly assigned.`);
    }
    const normalized = normalizePositiveShells(mod, master);
    const bodies = normalized.solid.decompose();
    const positiveBodies = bodies.filter(x => x.volume() > 0.01);
    const bodyVolumes = positiveBodies.map(x => x.volume()).sort((a, b) => b - a);
    bodies.forEach(x => x.delete());
    if (positiveBodies.length > 1) {
      normalized.solid.delete();
      return review(`The source has ${positiveBodies.length} disconnected positive bodies (${bodyVolumes.map(x => x.toFixed(3)).join(', ')} mm³). A single fused master/base cannot print or pour the separate detail. Preserve each as a separate cast with its own supported master, mold cavity and fill path; this multi-body package needs a dedicated plan.`);
    }
    master = instanceToMeshArrays(normalized.solid);
    normalized.solid.delete();
    const candidates = backingCandidates(master);
    if (!intent.backingNormalSource && candidates.length > 1
        && candidates[1].areaMm2 / candidates[0].areaMm2 >= 0.98) {
      return review('Two support faces have nearly equal area; select the signed backing side before generating a 3D jacket.');
    }
    // AUTO backing: the largest exact plane bin is arbitrary on organic sculpts
    // (any tessellation patch can win), which used to leave figures in poses
    // no split axis could extract. Pick the standing direction by the proven
    // stable-base scoring instead — flat bed area × cross-extent stability —
    // and record whether a genuine plane was found or this is a stability pose.
    const stabilityBacking = pickStabilityBacking(master);
    const backing = intent.backingNormalSource ?? stabilityBacking.normal;
    const backingSelection = intent.backingNormalSource
      ? 'user-signed'
      : stabilityBacking.flatRatio >= 0.1 ? 'auto-plane' : 'auto-stability';
    if (!intent.backingNormalSource) {
      // Alternates for the construction retry: keep poses with ANY measurable
      // bed — organic sculpts have low flat ratios on their side poses and a
      // 0.01 floor filtered out exactly the retries they needed (measured:
      // candle lamp standing pose fragments the plate; its lying poses were
      // never tried).
      // Every remaining direction, score-ordered: a curved-side lying pose
      // has a near-zero flat ratio but is exactly what overhung sculpts
      // (poodle, angel) need; the score ranking already puts noise directions
      // last (measured: a flat-ratio floor filtered out every retry these
      // models had).
      poseAlternatives = stabilityBackingCandidates(master).slice(1, 5).map((c) => c.normal);
    }
    const sourceVertical = backing.findIndex(x => Math.abs(x) > 0.995);
    if (chosenVertical && chosenVertical !== 'Z' && (sourceVertical < 0 || AXES[sourceVertical] !== chosenVertical)) {
      return review('The selected backing defines mold +Z; a separate vertical-axis override conflicts with this canonical frame.');
    }
    const canonical = canonicalizeBacking(master, backing);
    master = canonical.mesh;
    fullFrame = canonical.frame;
    chosenVertical = 'Z';
    // A split ALONG the backing axis is only forbidden where it would actually
    // cut the backing attachment (mid plane down in the base band). A mid-plane
    // vertical split — the classic top/bottom jacket V2 shipped for plaques,
    // vases and candle lamps — clears the base band and stays a candidate; the
    // release sim remains the honest gate.
    let canonicalHeight = 0;
    for (let i = 2; i < canonical.mesh.vertProperties.length; i += 3) {
      if (canonical.mesh.vertProperties[i] > canonicalHeight) canonicalHeight = canonical.mesh.vertProperties[i];
    }
    zSplitClearsBaseBand = (mid: number, base: number) => mid - base > Math.max(2, canonicalHeight * 0.1);
    req.onProgress?.('Rebuilding the distance field in the approved print frame', 0.58);
    grid = await buildSignedDistanceGrid(master, { gap: params.gap, wall: params.wall, step: req.grid?.step ?? 0.75 });
    rankedAxes = rankSplitAxes(rankAxes(master, 32), master, grid, params.gap);
    transformsBackingSelection = backingSelection;
  }

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
    verticalAxis: chosenVertical,
    gap: g,
    panels,
    gapWindow: params.gapWindow === undefined ? undefined : Math.min(params.gapWindow, g / 2),
  });

  // Tray phase (Task 6): a confirmed front-only cast whose backing plane
  // measures flat routes to the open-face relief tray BEFORE any jacket
  // candidate. Tray failure yields to the jacket ladder with a ledger entry.
  if (wantsTray && intent.multiBodyHandling === 'fuse_overlapping') {
    // The tray path skips the jacket branch's shell normalization; an
    // explicitly fused multi-shell relief (e.g. a 200-piece decorative flat)
    // must union here or its tray base builds as dozens of disconnected pads.
    try {
      const fused = normalizePositiveShells(mod, master);
      master = instanceToMeshArrays(fused.solid);
      fused.solid.delete();
      gapWarnings.push(...fused.notes);
    } catch (err) {
      return review(`Multi-shell input could not be fused into one solid: ${err instanceof Error ? err.message : err}`);
    }
  }
  if (wantsTray) {
    // Multi-shell reliefs are LEGITIMATE trays when every piece rests on the
    // tray floor (the floor bridges them — the frozen Montagem case ships
    // exactly this). Pieces that float above the floor make a disconnected
    // master+floor part; that specific failure converts to a review below.
    const selector = classifyMethods(master, intent);
    if (selector[0].method === 'open_face_relief') {
      req.onProgress?.('Building the open-face relief tray', 0.7);
      try {
        const chosen = intent.backingNormalSource ?? possibleBacking[0]?.normal;
        if (!chosen) throw new Error('No measurable backing plane; select a signed backing face.');
        const canonical = canonicalizeBacking(master, chosen);
        const tray = buildReliefTray({
          mod, master: canonical.mesh,
          params: { gap: params.gap, wall: params.wall, plateT: 4, backing: Math.max(4, params.gap), freeboard: 5 },
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
        // The wall is a straight vertical prism. Its complete +Z swept volume
        // below the silicone fill plane is already occupied at the starting
        // pose, so these exact intersections certify the whole lift path.
        const overlapMm3 = (a: MeshArrays, b: MeshArrays): number => {
          const left = new mod.Manifold(new mod.Mesh({ numProp: 3, ...a }));
          const right = new mod.Manifold(new mod.Mesh({ numProp: 3, ...b }));
          try { const hit = left.intersect(right); const volume = hit.volume(); hit.delete(); return volume; }
          finally { left.delete(); right.delete(); }
        };
        const wallBaseOverlap = overlapMm3(tray.pieces.wall, tray.pieces.masterBase);
        const wallSiliconeOverlap = overlapMm3(tray.pieces.wall, tray.pieces.siliconeSkin);
        if (wallBaseOverlap > 0.001 || wallSiliconeOverlap > 0.001) {
          throw new Error(`tray wall lift is blocked: master/base overlap ${wallBaseOverlap.toFixed(4)} mm³, silicone overlap ${wallSiliconeOverlap.toFixed(4)} mm³`);
        }
        const trayPrintability = analyzePieces({ mod, masterBase: tray.pieces.masterBase,
          jackets: [{ name: 'tray_wall', mesh: tray.pieces.wall }], vert: 'Z', base: 0,
          crown: tray.wallTopZ, plateT: 4 });
        if (Object.values(trayPrintability).some(r => r.bedAreaMm2 <= 0)) {
          throw new Error('tray print orientation has no measurable first-layer bed contact');
        }
        const trayRelease: ReleaseReport = {
          rigid: [{ part: 'tray wall', direction: 'lift +Z (open top)', pass: true, freeAtMm: tray.fillTopZ + 0.01 }],
          siliconeDemold: tray.siliconeDemold,
        };
        const trayTransforms = transformReport(
          { frame: { vert: 'Z', base: 0, mid: 0, crown: tray.wallTopZ, pull: 'Z', depth: 'X' }, plateT: 4, axis: 'Z', pieces: null as never, siliconeMl: tray.siliconeMl, ports: { crown: null, vents: [], vAx: 0, u3: 1, v3: 2 }, cavityLoops: [], cavitySections: [], cavity: master, warnings: [], failedAxes: [], siliconeDemold: tray.siliconeDemold, panels: 1, jacketDim: [0, 0, 0], plateDim: [0, 0, 0], extraction: { A: { pass: true, freeAtMm: 0 }, B: null } } as never,
          tray.pieces.masterBase,
        );
        trayTransforms.sourceToMold = canonical.frame.sourceToMold;
        trayTransforms.moldToSource = canonical.frame.moldToSource;
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
        const trayWarnings = [...(req.extraWarnings ?? []), ...gapWarnings, ...tray.warnings];
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
              trayGeometry: { fillHeightMm: tray.fillTopZ, wallHeightMm: tray.wallTopZ, freeboardMm: tray.wallTopZ - tray.fillTopZ },
              extraction: { A: 0, B: 0 },
              jacketDim: [trayOuterX, trayOuterY, tray.wallTopZ + 4],
              plateDim: [0, 0, 0],
              warnings: trayWarnings,
              checks: [
                { name: 'Open-face tray construction', pass: true, hard: true, detail: `wall top ${tray.wallTopZ} mm backs master top ${tray.masterTopZ} mm; silicone ${tray.siliconeMl} mL` },
                { name: 'Tray wall continuous vertical release', pass: true, hard: true, detail: `wall/master-base overlap ${wallBaseOverlap.toFixed(4)} mm³; wall/silicone overlap ${wallSiliconeOverlap.toFixed(4)} mm³; clear at +${(tray.fillTopZ + 0.01).toFixed(2)} mm` },
                { name: 'Tray print bed contact', pass: true, hard: true, detail: `base ${trayPrintability.master_base.bedAreaMm2} mm²; wall ${trayPrintability.tray_wall.bedAreaMm2} mm²` },
              ],
              printability: trayPrintability,
              crown: null, ventCount: 0,
              frame: { vert: 'Z', base: 0, plateT: 4 },
            },
          });
          return {
            ok: true, moldMaster: canonical.mesh, method: trayMethod, source: req.source, transforms: trayTransforms,
            release: trayRelease, rejectionLedger: ledger,
            pkg: { axis: 'Z', frame: trayTransforms.frame as never, pieces: { jacketA: tray.pieces.wall, jacketB: tray.pieces.wall, basePlate: tray.pieces.basePlate, skin: tray.pieces.siliconeSkin, jacketSolid: tray.pieces.wall }, extraction: { A: { pass: true, freeAtMm: 0 }, B: null }, siliconeDemold: tray.siliconeDemold, panels: 1 as 2, jacketDim: [trayOuterX, trayOuterY, tray.wallTopZ + 4], plateDim: [trayOuterX, trayOuterY, 4], plateT: 4, ports: { crown: null, vents: [], vAx: 0, u3: 1, v3: 2 }, siliconeMl: tray.siliconeMl, cavityLoops: [], cavitySections: [], cavity: canonical.mesh, warnings: trayWarnings },
            masterBase: tray.pieces.masterBase,
            printability: trayPrintability, checks: [
              { name: 'Open-face tray construction', pass: true, hard: true, detail: `wall top ${tray.wallTopZ} mm; fill ${tray.fillTopZ} mm` },
              { name: 'Tray wall continuous vertical release', pass: true, hard: true, detail: `wall/master-base overlap ${wallBaseOverlap.toFixed(4)} mm³; wall/silicone overlap ${wallSiliconeOverlap.toFixed(4)} mm³` },
              { name: 'Tray print bed contact', pass: true, hard: true, detail: `base ${trayPrintability.master_base.bedAreaMm2} mm²; wall ${trayPrintability.tray_wall.bedAreaMm2} mm²` },
            ], gapEff: params.gap,
            clearanceBand: undefined, files, warnings: trayWarnings,
          };
        } catch (err) {
          ledger.push({ candidate: 'open-face tray', stage: 'export', reason: err instanceof Error ? err.message : String(err) });
        }
      } catch (err) {
        ledger.push({ candidate: 'open-face tray', stage: 'construction', reason: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  if (wantsTray) {
    // A tray whose pieces do not rest on the tray floor is a multi-body
    // question, not a construction dead-end — ask instead of dumping the
    // kernel's component count.
    const disconnected = ledger.find(r => /disconnected components/.test(r.reason));
    if (disconnected) {
      return review(`This relief has pieces that do not rest on a shared tray floor (${disconnected.reason}). Plan one tray per piece, or confirm fusing if the pieces truly share material.`);
    }
    return { ok: false, outcome: 'rejected', bestAxis: null, rejectionLedger: ledger,
      message: `Requested open-face relief could not be constructed: ${ledger.map(r => r.reason).join('; ')}. No other mold family was substituted.` };
  }

  if (!grid) throw new Error('planner invariant: full 3D distance field was not built');
  const candidateGrid = grid;

  for (const phase of phases) {
  for (const gap of phase.gaps) {
    if (gap !== requestedGap) {
      req.onProgress?.(`Scaled gap ${requestedGap} mm could not extract — retrying at ${gap} mm`, 0.65);
    }
    // All three axes compete — the blanket vertical-axis exclusion starved the
    // ladder on figures (V2 shipped Z splits for plaques, vases, lamps). The
    // backing-axis candidate keeps an honest guard below.
    const ranked = params.splitAxis ? [params.splitAxis] : rankedAxes;
    if (ranked.length === 0) continue;
    for (let i = 0; i < ranked.length; i++) {
      const axis = ranked[i];
      const candidate = `±${axis} (${phase.panels}-piece) @gap ${gap}`;
      req.onProgress?.(`Splitting along ±${axis} (candidate ${i + 1}/${ranked.length}, gap ${gap})`, 0.65 + (i / ranked.length) * 0.05);
      let pkg: AxisAttempt | null = null;
      try {
        // A split along the canonical vertical has vert === pull, which the
        // frame builder forbids — let the stable-base rule choose that
        // candidate's print vertical instead (the package ships with the
        // matching rotate-to-bed export instruction).
        const candParams = axis === chosenVertical
          ? { ...buildParams(gap, phase.panels), verticalAxis: undefined }
          : buildParams(gap, phase.panels);
        pkg = await buildMoldForAxis({
          mod, master, grid: candidateGrid, params: candParams, axis, ports: req.ports ?? false,
          onProgress: req.onProgress,
        });
      } catch (err) {
        ledger.push({ candidate, stage: 'construction', reason: err instanceof Error ? err.message : String(err) });
        continue;
      }
      if (!pkg) continue;
      if (axis === chosenVertical && !zSplitClearsBaseBand(pkg.frame.mid, pkg.frame.base)) {
        ledger.push({ candidate, stage: 'construction', reason: `the ±${axis} split plane (${pkg.frame.mid.toFixed(1)} mm) would cut the base attachment band — this master is too flat to split along the backing axis` });
        continue;
      }
      if (!extractionPass(pkg.extraction)) {
        ledger.push({ candidate, stage: 'release', reason: extractionFailText(pkg.extraction) });
        continue;
      }

      req.onProgress?.('Running validation gates', 0.96);
      const is3 = !!(pkg.pieces.jacketB1 && pkg.pieces.jacketB2);
      const gates = runGates({
        grid: candidateGrid, gap, wall: params.wall, step: candidateGrid.step,
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
        ...(pkg.axis !== rankedAxes[0] ? [`${rankedAxes[0]} was the best preliminary pull axis, but later candidates failed — ±${pkg.axis} was selected as the first fully feasible split`] : []),
        ...gates.warnings, ...pkg.warnings,
      ];
      if (gap !== requestedGap) {
        warnings.push(`the master-scaled ${requestedGap} mm silicone gap could not extract this shape (undercuts don't shrink with the master) — generated at a ${gap} mm gap; the frame is proportionally deeper than the master`);
      }
      // The silicone and rigid envelope are built through independent CSG
      // paths. Resolve their tiny numeric crossing on the actual export meshes
      // before package creation; a material-sized loss rejects the candidate.
      // Topology repair (V3 pinched-edge blocker): boolean output can carry
      // near-coincident sheets that the float32 STL weld collapses into a
      // pinched edge. The ladder tries the EXACT kernel pass first; only when
      // the serialized bytes stay pinched does it apply a bounded 0.005 mm
      // simplification and RE-CUT every rigid blocker, so the repair can
      // neither leave silicone inside a rigid part nor move the master-facing
      // cavity surface. A skin that stays pinched/suspect rejects the
      // candidate — it is never silently shipped.
      let topologyRepair: TopologyRepairRecord | undefined;
      try {
        const originalSkin = new mod.Manifold(new mod.Mesh({ numProp: 3, ...pkg.pieces.skin }));
        let fitted = originalSkin.translate(0, 0, 0);
        const blockerMeshes = is3
          ? [pkg.pieces.jacketA, pkg.pieces.jacketB1!, pkg.pieces.jacketB2!, masterBase]
          : [pkg.pieces.jacketA, pkg.pieces.jacketB, masterBase];
        const blockerSolids = blockerMeshes.map((mesh) => new mod.Manifold(new mod.Mesh({ numProp: 3, ...mesh })));
        for (const blocker of blockerSolids) {
          const next = fitted.subtract(blocker);
          fitted.delete(); fitted = next;
        }
        if (!isStatusOk(fitted)) throw new Error('silicone/rigid contact reconciliation is invalid');
        const removedMm3 = originalSkin.volume() - fitted.volume();
        // Symmetric relative budget: boolean noise can grow the result by
        // slivers exactly as it can shave it (measured: Wichtel6 −0.124 mm³
        // on a 3×10⁴ mm³ skin — 4e-6 relative, pure float noise). A
        // material-sized correction in EITHER direction still rejects.
        if (Math.abs(removedMm3) > Math.max(0.001, originalSkin.volume() * 0.0005)) {
          throw new Error(`silicone/rigid overlap ${removedMm3.toFixed(4)} mm³ exceeds the 0.05% contact-reconciliation budget`);
        }
        // Serialized-bytes evaluation exactly as buildPrintFiles will judge
        // the shipped mesh: export cleanup, then write→parse→audit round trip.
        const surfaceAreaMm2 = (mesh: MeshArrays): number => {
          const vp = mesh.vertProperties, tv = mesh.triVerts;
          let area = 0;
          for (let t = 0; t < tv.length; t += 3) {
            const a = tv[t] * 3, b = tv[t + 1] * 3, c = tv[t + 2] * 3;
            const ux = vp[b] - vp[a], uy = vp[b + 1] - vp[a + 1], uz = vp[b + 2] - vp[a + 2];
            const vx = vp[c] - vp[a], vy = vp[c + 1] - vp[a + 1], vz = vp[c + 2] - vp[a + 2];
            area += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
          }
          return area;
        };
        const blockerAreas = blockerMeshes.map(surfaceAreaMm2);
        const evaluate = (solid: ManifoldInstance): {
          mesh: MeshArrays; verdict: string; pinchedEdges: number; overlapMm3: number; boundMm3: number;
        } => {
          const cleaned = cleanExportMesh(instanceToMeshArrays(solid), mod);
          const audit = auditSerializedStl('03_preview/silicone_skin.stl', cleaned.mesh, mod);
          // A candidate whose cleaned mesh is so broken the kernel ctor THROWS
          // is simply a non-viable rung — score it invalid and let the ladder
          // try the next one (measured: Medium/Kitten skins at 50 mm).
          let overlapMm3 = 0;
          let boundMm3 = 0.001;
          let probeFailed = false;
          try {
            const probe = new mod.Manifold(new mod.Mesh({ numProp: 3, ...cleaned.mesh }));
            let maxCoord = 1;
            for (let i = 0; i < cleaned.mesh.vertProperties.length; i++) {
              const v = Math.abs(cleaned.mesh.vertProperties[i]);
              if (v > maxCoord) maxCoord = v;
            }
            const ulpMm = Math.pow(2, Math.ceil(Math.log2(maxCoord)) - 23); // float32 ULP at this coordinate scale
            boundMm3 = Math.max(0.001, 2 * ulpMm * Math.min(surfaceAreaMm2(cleaned.mesh), ...blockerAreas));
            for (const blocker of blockerSolids) {
              const hit = probe.intersect(blocker);
              overlapMm3 = Math.max(overlapMm3, Math.abs(hit.volume()));
              hit.delete();
            }
            probe.delete();
          } catch {
            probeFailed = true;
          }
          return {
            mesh: cleaned.mesh,
            verdict: probeFailed ? 'invalid' : audit.verdict,
            pinchedEdges: audit.pinchedEdges,
            overlapMm3: probeFailed ? Infinity : overlapMm3,
            boundMm3,
          };
        };
        const budgetMm = Math.min(0.05, PROTECTED_FEATURE_FLOOR_MM / 10);
        const buildCandidate = (toleranceMm: number, recutAfter: boolean, exactPass: boolean): ManifoldInstance | null => {
          let s: ManifoldInstance = fitted.simplify(toleranceMm);
          try {
            if (!isStatusOk(s)) throw new Error('kernel simplify failed');
            if (recutAfter) {
              for (const blocker of blockerSolids) {
                const next = s.subtract(blocker);
                s.delete();
                s = next;
                if (!isStatusOk(s)) throw new Error('blocker re-cut failed');
              }
            }
            if (exactPass) {
              const next = s.simplify(0);
              s.delete();
              s = next;
              if (!isStatusOk(s)) throw new Error('exact re-regularization failed');
            }
            return s;
          } catch {
            s.delete();
            return null;
          }
        };
        // Ladder: exact first, then bounded simplification + EXACT blocker
        // re-cut, up to the full recorded fidelity budget. The last rung uses
        // the entire budget (0.012 mm = min(0.05, 0.12/10)) — measured need:
        // Kitten-50's fused skin needs more than 0.005 mm to serialize valid.
        const steps: { toleranceMm: number; recut: boolean; exactPass: boolean }[] = [
          { toleranceMm: 0, recut: false, exactPass: false },
          { toleranceMm: 0.001, recut: true, exactPass: false },
          { toleranceMm: SKIN_REPAIR_TOLERANCE_MM, recut: true, exactPass: false },
          { toleranceMm: SKIN_REPAIR_TOLERANCE_MM, recut: true, exactPass: true },
          { toleranceMm: budgetMm, recut: true, exactPass: true },
        ];
        const ladderEvidence: TopologyRepairRecord['ladder'] = [];
        let adopted: { solid: ManifoldInstance; mesh: MeshArrays; volumeMm3: number; step: (typeof steps)[number]; evalResult: ReturnType<typeof evaluate> } | null = null;
        for (const step of steps) {
          if (step.toleranceMm > budgetMm + 1e-12) continue; // fidelity rule gate
          const solid = buildCandidate(step.toleranceMm, step.recut, step.exactPass);
          if (!solid) continue;
          const result = evaluate(solid);
          ladderEvidence.push({
            toleranceMm: step.toleranceMm, recut: step.recut,
            verdict: result.verdict, pinchedEdges: result.pinchedEdges,
            blockerOverlapMm3: Number(result.overlapMm3.toFixed(6)),
          });
          if (result.verdict === 'valid' && result.overlapMm3 <= result.boundMm3) {
            adopted = { solid, mesh: result.mesh, volumeMm3: solid.volume(), step, evalResult: result };
            break;
          }
          solid.delete();
        }
        if (!adopted) {
          throw new Error(`silicone skin could not be certified on its serialized bytes (ladder: ${ladderEvidence.map((e) => `${e.toleranceMm}mm${e.recut ? '+recut' : ''}→${e.verdict}/${e.pinchedEdges} pinch`).join(', ') || 'no candidate ran'})`);
        }
        const before = ladderEvidence[0];
        topologyRepair = {
          part: '03_preview/silicone_skin.stl',
          applied: adopted.step.toleranceMm > 0,
          toleranceMm: adopted.step.toleranceMm,
          budgetMm,
          finestProtectedFeatureMm: PROTECTED_FEATURE_FLOOR_MM,
          featureBasis: 'explicit conservative lower bound: the required master print profile (0.4 mm nozzle, 0.12 mm minimum layer) cannot carry protected amplitude below one layer; mesh-statistical minima are dominated by tessellation self-contacts and cannot certify feature width',
          recutBlockers: adopted.step.recut,
          volumeBeforeMm3: Number(fitted.volume().toFixed(4)),
          volumeAfterMm3: Number(adopted.volumeMm3.toFixed(4)),
          volumeDeltaMm3: Number((fitted.volume() - adopted.volumeMm3).toFixed(4)),
          blockerOverlapAfterMm3: Number(adopted.evalResult.overlapMm3.toFixed(6)),
          overlapQuantizationBoundMm3: Number(adopted.evalResult.boundMm3.toFixed(6)),
          ladder: ladderEvidence,
        };
        pkg.pieces.skin = adopted.mesh;
        pkg.siliconeMl = adopted.volumeMm3 / 1000;
        if (removedMm3 > 0.001) warnings.push(`Removed ${removedMm3.toFixed(4)} mm³ of numerical silicone/jacket overlap by CSG contact reconciliation.`);
        if (topologyRepair.applied) {
          warnings.push(`Silicone skin pinched-edge topology repaired by a bounded ${adopted.step.toleranceMm} mm kernel simplification (fidelity budget ${budgetMm} mm = min(0.05, ${PROTECTED_FEATURE_FLOOR_MM}/10)); the cavity was then re-cut exactly against every rigid part.`);
        }
        if (before && before.pinchedEdges > 0 && adopted.step.toleranceMm === 0) {
          warnings.push('Silicone skin serialized clean on the exact kernel pass; no bounded repair was needed.');
        }
        adopted.solid.delete();
        fitted.delete(); originalSkin.delete();
        blockerSolids.forEach((b) => b.delete());
      } catch (err) {
        ledger.push({ candidate, stage: 'export', reason: err instanceof Error ? err.message : String(err) });
        continue;
      }
      const transforms = transformReport(pkg, master);
      transforms.backingSelection = transformsBackingSelection;
      transforms.sourceToMold = fullFrame?.sourceToMold;
      transforms.moldToSource = fullFrame?.moldToSource;
      const release = releaseOf(pkg);
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
        topologyRepair,
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
          moldMaster: master,
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

  // Name the dominant obstacle instead of dumping a raw count — the user must
  // learn WHAT blocked every candidate (trapped undercuts vs wall/gate limits
  // vs export defects), not just how many tried.
  const stageCounts = new Map<string, number>();
  for (const r of ledger) stageCounts.set(r.stage, (stageCounts.get(r.stage) ?? 0) + 1);
  const dominant = [...stageCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'construction';
  // Pose retry: when the PRIMARY auto pose cannot even construct (plate
  // fragmentation, unbuildable envelope), one bad standing direction must
  // not condemn a moldable figure — try the runner-up stability backings
  // before reporting failure. User-signed backings never retry.
  if (!intent.backingNormalSource && (req.poseRetryBudget ?? 1) > 0 && poseAlternatives.length > 0 && dominant === 'construction') {
    for (const alt of poseAlternatives) {
      const retryNote = `primary stability pose failed construction — retried on the runner-up backing [${alt.join(',')}]`;
      req.onProgress?.(retryNote, 0.66);
      const retry = await planMold({
        ...req,
        castingIntent: { ...intent, backingNormalSource: alt },
        extraWarnings: [...(req.extraWarnings ?? []), retryNote],
        poseRetryBudget: (req.poseRetryBudget ?? 1) - 1,
      });
      if (retry.ok) {
        return { ...retry, rejectionLedger: [...ledger, ...retry.rejectionLedger], warnings: [...(retry.warnings ?? [])] };
      }
      ledger.push(...retry.rejectionLedger);
      if (retry.outcome === 'review_required') {
        return { ...retry, rejectionLedger: [...ledger, ...retry.rejectionLedger] };
      }
    }
  }
  const distinctReasons = [...new Set(ledger.filter(r => r.stage === dominant).map(r => r.reason.split(';')[0].slice(0, 110)))].slice(0, 3);
  const obstacleText = dominant === 'release'
    ? `undercuts trap the jacket on every candidate axis (${distinctReasons.join(' | ')}) — try a 3-piece plan, a different backing side, or confirm this model can be cast as one piece`
    : dominant === 'gate'
      ? `validation limits exceeded on every candidate (${distinctReasons.join(' | ')})`
      : dominant === 'export'
        ? `export auditing failed on every candidate (${distinctReasons.join(' | ')})`
        : `construction failed on every candidate (${distinctReasons.join(' | ')})`;
  return {
    ok: false, outcome: 'rejected', rejectionLedger: ledger,
    message: `every candidate failed (${ledger.length} rejection(s) across the gap ladder ${gapLadder.join('→')} mm): ${obstacleText}`,
    bestAxis: rankedAxes[0] ?? null,
  };
}
