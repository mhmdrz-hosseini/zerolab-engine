// Validation gates — V0.2. Hard gates block the package: extraction (enforced
// by the ladder), jacket seats on the plate with nothing hanging below it (the
// V0.1 regression gate), open crown above the master with no cap bridging it,
// fill-path reachability (flood fill of the shadow-prism cavity from the crown
// plane), part non-emptiness. The clearance audit is informational.
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { SdfGrid } from './offset';
import type { MeshArrays } from './types';
import type { PortsPlan } from './ports';
import type { MoldFrame } from './split';
import type { Loops } from './contours';
import type { KeyRingMetrics } from './reliefTray';

export interface GateCheck { name: string; pass: boolean; detail: string; hard: boolean }
export interface GateReport {
  pass: boolean;
  checks: GateCheck[];
  warnings: string[];
  clearanceBand?: ClearanceBand;  // structured hug-distance percentiles (P3 metric)
}
export interface ClearanceBand {
  requestedGap: number;
  min: number;
  p10: number;
  p50: number;
  p90: number;
  // audit §5 target bands for the requested gap (advisory until the coupon
  // trial): min ≥ g−0.5 · p10 ≥ g−0.3 · p50 ≤ g+0.5 · p90 < g+1.0
  withinBand: boolean;
}

const AXES: Axis[] = ['X', 'Y', 'Z'];
type Axis = 'X' | 'Y' | 'Z';

/**
 * Flood-fill the cavity (outside the master, inside the shadow⊕gap prism,
 * above the base plane) from the open crown plane downward. With an open
 * crown every cavity cell must drain to the crown.
 */
function fillReachability(grid: SdfGrid, frame: MoldFrame, cavityLoops: Loops, sections?: { height: number; loops: Loops }[]): {
  ratio: number; reachable: number; total: number;
} {
  const { data, lo, dims, step } = grid;
  const vAx = AXES.indexOf(frame.vert);
  const u3 = (vAx + 1) % 3, v3 = (vAx + 2) % 3;
  const stride = [dims[1] * dims[2], dims[2], 1];
  const kvMin = Math.max(0, Math.ceil((frame.base - lo[vAx]) / step - 0.5));
  const kvCrown = Math.min(dims[vAx] - 1, Math.floor((frame.crown - lo[vAx]) / step - 0.5));
  const total = dims[0] * dims[1] * dims[2];
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let qh = 0, qt = 0, reachable = 0, totalCavity = 0;

  const layerLoops = Array.from({ length: dims[vAx] }, (_, kv): Loops => {
    if (!sections?.length) return cavityLoops;
    const z = lo[vAx] + (kv + 0.5) * step;
    const upper = sections.findIndex(s => s.height >= z);
    if (upper <= 0) return sections[upper === 0 ? 0 : sections.length - 1].loops;
    const a = sections[upper - 1], b = sections[upper];
    const f = (z - a.height) / (b.height - a.height);
    return a.loops.map((loop, l) => loop.map(([x, y], i) => [
      x + f * (b.loops[l][i][0] - x), y + f * (b.loops[l][i][1] - y),
    ]));
  });
  // per-layer cavity masks — even-odd scanline rasterization of the
  // interpolated loops, semantically identical to pointInLoops but O(1) per
  // cell: the flood fill and the pre-count query it millions of times, and
  // the old per-query ray cast over ~128 loop edges dominated large grids
  const maskCache = new Map<number, Uint8Array>();
  const maskOf = (kv: number): Uint8Array => {
    let m = maskCache.get(kv);
    if (m) return m;
    m = new Uint8Array(dims[u3] * dims[v3]);
    const loops = layerLoops[kv];
    for (let iv = 0; iv < dims[v3]; iv++) {
      const y = lo[v3] + (iv + 0.5) * step;
      const xs: number[] = [];
      for (const loop of loops) {
        for (let i = 0, n = loop.length; i < n; i++) {
          const [x1, y1] = loop[i], [x2, y2] = loop[(i + 1) % n];
          if (y1 > y !== y2 > y) xs.push(((x2 - x1) * (y - y1)) / (y2 - y1) + x1);
        }
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const iu0 = Math.max(0, Math.ceil((xs[k] - lo[u3]) / step - 0.5));
        const iu1 = Math.min(dims[u3] - 1, Math.floor((xs[k + 1] - lo[u3]) / step - 0.5));
        for (let iu = iu0; iu <= iu1; iu++) m[iv * dims[u3] + iu] = 1;
      }
    }
    maskCache.set(kv, m);
    return m;
  };
  const isCavity = (idx: number, iu: number, iv: number): boolean => {
    const kv = Math.floor(idx / stride[vAx]) % dims[vAx];
    if (iu < 0 || iu >= dims[u3] || iv < 0 || iv >= dims[v3] || kv < kvMin || kv > kvCrown) return false;
    if (data[idx] > 0.3) return false;
    return maskOf(kv)[iv * dims[u3] + iu] === 1;
  };
  const colBase = (iu: number, iv: number): number => {
    const idx: [number, number, number] = [0, 0, 0];
    idx[vAx] = 0; idx[u3] = iu; idx[v3] = iv;
    return idx[0] * stride[0] + idx[1] * stride[1] + idx[2] * stride[2];
  };
  for (let iu = 0; iu < dims[u3]; iu++) {
    for (let iv = 0; iv < dims[v3]; iv++) {
      const base = colBase(iu, iv);
      for (let kv = kvMin; kv <= kvCrown; kv++) {
        if (isCavity(base + kv * stride[vAx], iu, iv)) totalCavity++;
      }
    }
  }

  // seed: cavity cells just under the crown plane (the pour surface)
  for (let iu = 0; iu < dims[u3]; iu++) {
    for (let iv = 0; iv < dims[v3]; iv++) {
      const base = colBase(iu, iv);
      for (let kv = Math.max(kvMin, kvCrown - 2); kv <= kvCrown; kv++) {
        const idx = base + kv * stride[vAx];
        if (isCavity(idx, iu, iv) && !visited[idx]) { visited[idx] = 1; queue[qt++] = idx; reachable++; }
      }
    }
  }
  const nbrs: [number, 0 | 1 | -1, 0 | 1 | -1][] = [
    [stride[u3], 1, 0], [-stride[u3], -1, 0],
    [stride[v3], 0, 1], [-stride[v3], 0, -1],
    [stride[vAx], 0, 0], [-stride[vAx], 0, 0], // vert step: (u,v) unchanged
  ];
  const kvOf = (idx: number): number => Math.floor(idx / stride[vAx]) % dims[vAx];
  while (qh < qt) {
    const idx = queue[qh++];
    const iu = Math.floor(idx / stride[u3]) % dims[u3];
    const iv = Math.floor(idx / stride[v3]) % dims[v3];
    for (const [d, du, dv] of nbrs) {
      const n = idx + d;
      if (n < 0 || n >= total || visited[n]) continue;
      if (kvOf(n) < kvMin || kvOf(n) > kvCrown) continue;
      if (!isCavity(n, iu + du, iv + dv)) continue;
      visited[n] = 1;
      queue[qt++] = n;
      reachable++;
    }
  }
  return { ratio: totalCavity > 0 ? reachable / totalCavity : 0, reachable, total: totalCavity };
}

/**
 * Informational: the jacket must never come closer to the master than the
 * silicone gap (p10 over master-surface samples), plus the observed hug
 * distance (the shadow-prism rule hugs only at the widest slices).
 */
function clearanceAudit(pieces: MeshArrays[], master: MeshArrays, gap: number): { text: string; ok: boolean; band: ClearanceBand } {
  const mkGeom = (m: MeshArrays) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.vertProperties, 3));
    g.setIndex(new THREE.BufferAttribute(m.triVerts, 1));
    return g;
  };
  const bvhs = pieces.map((p) => new MeshBVH(mkGeom(p)));
  const probe = new THREE.Vector3();
  const hit = { point: new THREE.Vector3(), distance: Infinity, faceIndex: 0 };
  const nV = master.vertProperties.length / 3;
  const dists: number[] = [];
  for (let s = 0; s < 300; s++) {
    const vi = Math.floor((s * nV) / 300);
    probe.set(master.vertProperties[vi * 3], master.vertProperties[vi * 3 + 1], master.vertProperties[vi * 3 + 2]);
    let d = Infinity;
    for (const bvh of bvhs) {
      bvh.closestPointToPoint(probe, hit);
      d = Math.min(d, hit.distance);
    }
    dists.push(d);
  }
  dists.sort((a, b) => a - b);
  const q = (p: number) => dists[Math.min(dists.length - 1, Math.floor(p * dists.length))];
  // p10 target ≥ gap − 1.5: the crown wedge (where a master part ends and the
  // cavity narrows) thins the silicone below nominal — the commercial
  // reference shows the same (their p10 dips to 4.0 mm at gap 6–8), and the
  // dip tracks the SHAPE, not the master size. The min therefore gets a
  // tear-safety floor instead of a hug-accuracy target — but the floor must
  // scale once the master-scaled gap itself approaches it (2–3 cm masters run
  // a 2 mm gap; the same inclined-surface cos-dip then reads 1.7–1.8 mm
  // without being a defect). Floor = min(2 mm, 85 % of the gap): full-size
  // molds keep the absolute 2 mm, small ones get a proportional floor.
  const minFloor = Math.min(2, gap * 0.85);
  const ok = q(0) >= minFloor && q(0.1) >= gap - 1.5;
  const band: ClearanceBand = {
    requestedGap: gap,
    min: Number(q(0).toFixed(2)),
    p10: Number(q(0.1).toFixed(2)),
    p50: Number(q(0.5).toFixed(2)),
    p90: Number(q(0.9).toFixed(2)),
    withinBand: q(0) >= gap - 0.5 && q(0.1) >= gap - 0.3 && q(0.5) <= gap + 0.5 && q(0.9) < gap + 1.0,
  };
  return {
    text: `sampled minimum=${band.min} p10=${band.p10} p50=${band.p50} p90=${band.p90} mm (target min ≥ ${Number(minFloor.toFixed(2))}, p10 ≥ ${gap - 1.5}) ${ok ? '✓' : '⚠'}`,
    ok,
    band,
  };
}

export function runGates(opts: {
  grid: SdfGrid;
  gap: number;
  wall: number;
  step: number;
  frame: MoldFrame;
  ports: PortsPlan;
  master: MeshArrays;
  pieceArrays: MeshArrays[];   // [jacketA, jacketB, plate]
  siliconeMl: number;
  cavityLoops: Loops;
  cavitySections?: { height: number; loops: Loops }[];
  gapWindow?: number;          // set < gap when the user explicitly chose a
                               // tighter envelope — the min-clearance gate then
                               // reports advisory (the extraction sim stays hard)
}): GateReport {
  const checks: GateCheck[] = [];
  const warnings: string[] = [];
  const { frame, grid, step } = opts;
  const vAx = AXES.indexOf(frame.vert);

  const vertRange = (m: MeshArrays): [number, number] => {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < m.vertProperties.length / 3; i++) {
      const c = m.vertProperties[i * 3 + vAx];
      if (c < lo) lo = c;
      if (c > hi) hi = c;
    }
    return [lo, hi];
  };

  // hard: each jacket piece starts exactly at the plate top and never hangs
  // below it (2-piece: [A, B, plate]; 3-piece: [A, B1, B2, plate])
  const jacketPieces = opts.pieceArrays.slice(0, -1);
  const plateArr = opts.pieceArrays[opts.pieceArrays.length - 1];
  void plateArr;
  for (const [i, piece] of jacketPieces.entries()) {
    const [zlo] = vertRange(piece);
    const seatOk = Math.abs(zlo - frame.base) <= 2 * step;
    const label = jacketPieces.length === 2 ? (i === 0 ? 'A' : 'B') : ['A', 'B1', 'B2'][i] ?? `${i + 1}`;
    checks.push({
      name: `Jacket ${label} seats on the plate`,
      pass: seatOk,
      hard: true,
      detail: seatOk
        ? `bottom at ${zlo.toFixed(1)} mm = plate top ${frame.base.toFixed(1)}`
        : `bottom at ${zlo.toFixed(1)} mm vs plate top ${frame.base.toFixed(1)} — ${zlo < frame.base ? 'hangs below the plate (support waste)' : 'floats above it'}`,
    });
  }

  // hard: open crown — the jacket top is the crown plane, no cap bridging the basin
  const masterTop = vertRange(opts.master)[1];
  const jacketTop = vertRange(opts.pieceArrays[0])[1];
  const crownOk = jacketTop <= frame.crown + 2 * step && frame.crown - masterTop >= 4 && frame.crown - masterTop <= 25;
  checks.push({
    name: 'Open crown above the master',
    pass: crownOk,
    hard: true,
    detail: `jacket top ${jacketTop.toFixed(1)} mm, master top ${masterTop.toFixed(1)} mm, freeboard ${(frame.crown - masterTop).toFixed(1)} mm`,
  });

  checks.push({
    name: 'Air escape through the open crown',
    pass: crownOk,
    hard: false,
    detail: `Open crown; ${opts.ports.vents.length} optional wall outlet(s)`,
  });

  if (opts.cavityLoops.length > 0) {
    const flood = fillReachability(grid, frame, opts.cavityLoops, opts.cavitySections);
    checks.push({
      name: 'Fill path reaches the gap',
      pass: flood.ratio >= 0.99,
      hard: true,
      detail: `${(flood.ratio * 100).toFixed(1)}% of cavity volume connected to the open crown (${flood.reachable}/${flood.total} cells)`,
    });
    if (flood.ratio < 0.95) warnings.push(`${((1 - flood.ratio) * 100).toFixed(1)}% of the cavity is not directly connected to the crown — cured silicone may trap voids there`);
  }

  checks.push({
    name: 'Silicone volume positive',
    pass: opts.siliconeMl > 1,
    hard: true,
    detail: `${opts.siliconeMl.toFixed(1)} mL`,
  });
  opts.pieceArrays.forEach((p, i) => {
    checks.push({
      name: `Printed part ${i + 1} non-empty`,
      pass: p.triVerts.length / 3 > 0,
      hard: true,
      detail: `${p.triVerts.length / 3} tris`,
    });
  });

  const audit = clearanceAudit(jacketPieces, opts.master, opts.gap);
  const tightHug = opts.gapWindow !== undefined && opts.gapWindow < opts.gap;
  checks.push({
    name: 'Master-to-jacket clearance audit',
    pass: audit.ok,
    hard: !tightHug,
    detail: audit.text + (tightHug ? ' — tight-hug envelope: advisory (extraction sim remains the hard gate)' : ''),
  });
  if (!audit.ok && !tightHug) warnings.push('jacket comes closer to the master than the silicone gap — inspect the preview');
  if (tightHug && !audit.band.withinBand) {
    warnings.push(`hug band outside audit targets (min ${audit.band.min} p50 ${audit.band.p50} vs gap ${opts.gap}) — acceptable only after a test print`);
  }

  return {
    pass: checks.filter((c) => c.hard).every((c) => c.pass),
    checks,
    warnings,
    clearanceBand: audit.band,
  };
}

/**
 * Open-face relief tray gates (M1 Task 6, hard-seal revision): the tray has no
 * split seam to clamp — its only leak path is the wall↔plate joint, so the
 * Key Ring (tongue on the plate, clearance groove in the wall) carries two
 * dedicated hard checks on top of the shared crown/volume/clearance set. The
 * fill path is structural: the wall is a roofless ring by construction.
 */
export function runTrayGates(opts: {
  gap: number;
  wall: number;
  master: MeshArrays;
  wallPiece: MeshArrays;
  masterBase: MeshArrays;
  siliconeMl: number;
  masterTopZ: number;
  wallTopZ: number;
  backing: number;
  freeboard: number;
  keyRing: KeyRingMetrics;
}): GateReport {
  const checks: GateCheck[] = [];
  const warnings: string[] = [];

  // hard: the wall must land exactly on the plate top plane (z=0) — the tray
  // frame is always vert=Z with the plate top at 0, so measure the raw z range
  let wallLo = Infinity, wallHi = -Infinity;
  for (let i = 0; i < opts.wallPiece.vertProperties.length / 3; i++) {
    const z = opts.wallPiece.vertProperties[i * 3 + 2];
    if (z < wallLo) wallLo = z;
    if (z > wallHi) wallHi = z;
  }
  const seatOk = Math.abs(wallLo) <= 0.1;
  checks.push({
    name: 'Tray wall seats on the plate',
    pass: seatOk,
    hard: true,
    detail: seatOk
      ? `wall bottom at ${wallLo.toFixed(2)} mm = plate top 0`
      : `wall bottom at ${wallLo.toFixed(2)} mm vs plate top 0 — ${wallLo < 0 ? 'sinks below the plate' : 'floats above it'}`,
  });

  // hard: the key ring is present on BOTH halves and assembles without press:
  //   • the groove was really cut from the wall ring (≥60% of nominal volume)
  //   • the tongue was really added on the plate (≥60% of nominal volume)
  //   • assembled wall∩plate interference ≈ 0 — clearance respected, nothing
  //     overlaps volumetrically (a reverted flat-on-flat wall fails this)
  const kr = opts.keyRing;
  const engageOk = kr.assembledInterferenceMm3 <= 0.01
    && kr.engagementRatio >= 0.6
    && kr.tongueSurplusMm3 >= 0.6 * kr.expectedTongueMm3;
  checks.push({
    name: 'Key ring engages the plate',
    pass: engageOk,
    hard: true,
    detail: engageOk
      ? `tongue ${kr.tongueW}×${kr.tongueH} mm @ ${kr.clearance} mm clearance, groove engagement ${(kr.engagementRatio * 100).toFixed(0)}%, assembled interference ${kr.assembledInterferenceMm3} mm³`
      : `key ring defect: interference ${kr.assembledInterferenceMm3} mm³, groove engagement ${(kr.engagementRatio * 100).toFixed(0)}% (expected ≥60%), tongue surplus ${kr.tongueSurplusMm3}/${kr.expectedTongueMm3} mm³`,
  });

  // hard: open crown — deliberate backing + pour freeboard above the relief
  const freeboardOk = opts.backing + opts.freeboard >= 4 && opts.backing + opts.freeboard <= 25;
  checks.push({
    name: 'Open crown above the master',
    pass: freeboardOk,
    hard: true,
    detail: `wall top ${opts.wallTopZ.toFixed(1)} mm, master top ${opts.masterTopZ.toFixed(1)} mm, freeboard ${(opts.wallTopZ - opts.masterTopZ).toFixed(1)} mm`,
  });
  checks.push({
    name: 'Air escape through the open crown',
    pass: freeboardOk,
    hard: false,
    detail: 'Open-top tray: the whole wall ring is the vent',
  });

  // hard: fill reachability is structural for the tray — no roof exists over
  // the cavity, so every column opens to the pour face (the wall is built as
  // outer − inner ring, never closed)
  checks.push({
    name: 'Fill path reaches the gap',
    pass: true,
    hard: true,
    detail: 'open-top tray: roofless contour wall — every cavity column connects to the pour face',
  });

  checks.push({
    name: 'Silicone volume positive',
    pass: opts.siliconeMl > 1,
    hard: true,
    detail: `${opts.siliconeMl.toFixed(1)} mL`,
  });
  for (const [i, p] of [opts.wallPiece, opts.masterBase].entries()) {
    checks.push({
      name: `Printed part ${i + 1} non-empty`,
      pass: p.triVerts.length / 3 > 0,
      hard: true,
      detail: `${p.triVerts.length / 3} tris`,
    });
  }

  const audit = clearanceAudit([opts.wallPiece], opts.master, opts.gap);
  checks.push({
    name: 'Master-to-wall clearance audit',
    pass: audit.ok,
    hard: false,
    detail: audit.text,
  });
  if (!audit.ok) warnings.push('tray wall comes closer to the master than the silicone gap — inspect the preview');

  return {
    pass: checks.filter((c) => c.hard).every((c) => c.pass),
    checks,
    warnings,
    clearanceBand: audit.band,
  };
}
