// Clamp-station planning — V0.5 manufacturing-reliability layer (docs/
// MFG_RELIABILITY_V0.5.md §P0). The external seam rail built in split.ts is a
// FROZEN INTERFACE (docs/adr/0001-seam-rail-frozen-interface.md): binder clips
// and printed ZeroClips alike land on measured rail positions, and the rail is
// never regenerated to suit a clip. Stations are metadata only here — in
// binder mode they replace the old "6–10 clips" guess with a deterministic
// placement plan around the rail loop at the parting plane.
//
// Geometry note: the rail is a closed band in the plane ⊥ pull at frame.mid,
// 7 mm proud of the jacket silhouette, trimmed to [base, crown] along vert.
// Usable clip land is therefore an ARC problem, not a vertical one: stations
// distribute along the band's outer boundary, excluding the base/crown trim
// zones, rib fins (which protrude past the rail face), and vent bores.
import { AXES } from './types';
import type { Axis, ClampStation } from './types';
import type { CS, MoldFrame } from './split';
import type { ManifoldInstance } from './manifoldLoader';
import type { PortSpec } from './ports';

export const CLAMP = {
  clipWidthMm: 18,  // mid of the 16–20 mm ZeroClip prototype band; doubles as the binder landing width for exclusion math
  pitchMm: 40,      // target station spacing along the usable rail
  endClearMm: 12,   // stay this far from the rail's base/crown trim boundaries
  exclusionMm: 2,   // extra margin around ribs/vents beyond half a clip width
  railProudMm: 7,   // construction width of the flange (split.ts rail offset) — caps any measured thickness
  // ZeroClip spring profile (brief §5; final interference locked by coupon):
  clipInterferenceMm: 0.3, // total — 0.15 mm of elastic spread per jaw at seating
  clipLegTMm: 2.6,         // arm thickness (2.4–2.8 prototype band)
  clipTipUMm: -2,          // jaw grip depth past the rail's outer edge (2 mm bearing, 5 mm short of the wall)
  clipSpineGapMm: 1.5,     // air gap between the seated spine and the rail's outer edge
};

/** Rib fins (split.ts) at 45/135/225/315° protrude past the rail face; stations
 *  keep clipWidth/2 + exclusionMm clear of each fin's radial line. */
export interface RibExclusion {
  center: [number, number]; // master bbox center in the (u3, v3) plane, mm
  u3: number;               // first angular axis index (vert frame)
  v3: number;               // second angular axis index
  wall: number;             // rib outer reach ≈ max rail radius + wall·1.45 + 8 (mirrors the split.ts rib build)
}

export interface ClampPlan {
  stations: ClampStation[];
  usableRailMm: number;
  pitchMm: number;          // achieved mean spacing (usable / count)
  mode: 'binder' | 'printed' | 'hybrid'; // effective fastening mode (set by the caller; falls back to binder)
  warning?: string;
}

const SAMPLE_STEP = 2; // mm — resampling resolution along the rail loop

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const ex = bx - ax, ey = by - ay;
  const len2 = ex * ex + ey * ey || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / len2));
  return Math.hypot(px - (ax + t * ex), py - (ay + t * ey));
}

export function planClampStations(deps: {
  railSection: CS;          // rail band, pull-frame 2D coords ((p+1)%3, (p+2)%3)
  axis: Axis;
  frame: MoldFrame;
  ribs?: RibExclusion | null;
  vents?: PortSpec[];
}): ClampPlan {
  const { railSection, axis, frame } = deps;
  const p = AXES.indexOf(axis);
  const a1 = (p + 1) % 3, a2 = (p + 2) % 3; // 2D coord → world axis mapping (prismOnPull convention)
  const vi = AXES.indexOf(frame.vert);
  const vertOf = (pt: number[]): number => (vi === a1 ? pt[0] : pt[1]);
  const to3 = (a: number, b: number): [number, number, number] => {
    const c: [number, number, number] = [0, 0, 0];
    c[p] = frame.mid;
    c[a1] = a;
    c[a2] = b;
    return c;
  };
  const fail = (warning: string): ClampPlan => ({ stations: [], usableRailMm: 0, pitchMm: 0, mode: 'binder', warning });

  if (!railSection.toPolygons) return fail('clamp stations unavailable — the rail outline could not be read');
  const polys = railSection.toPolygons();
  if (polys.length === 0) return fail('clamp stations unavailable — the rail outline is empty');

  // The band's outer boundary is the loop with the largest enclosed area;
  // every other loop is an inner (cavity-side) boundary for thickness probing.
  // Signed area also gives the winding, hence the outward normal direction.
  const shoelace2 = (poly: number[][]): number => {
    let s = 0;
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
      s += x1 * y2 - x2 * y1;
    }
    return s / 2;
  };
  let outer = polys[0];
  for (const poly of polys) if (Math.abs(shoelace2(poly)) > Math.abs(shoelace2(outer))) outer = poly;
  const holes = polys.filter((poly) => poly !== outer);
  const ccw = shoelace2(outer) > 0;
  if (outer.length < 8) return fail('clamp stations unavailable — the rail outline is too coarse');

  // Resample the outer loop at a fine, even spacing so arc lengths and
  // exclusion zones resolve on straight runs as well as curves.
  const pts: number[][] = [];
  for (let i = 0; i < outer.length; i++) {
    const A = outer[i], B = outer[(i + 1) % outer.length];
    pts.push(A);
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const inner = Math.floor(len / SAMPLE_STEP);
    for (let k = 1; k <= inner; k++) {
      const t = k / (inner + 1);
      pts.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]);
    }
  }

  const keep = CLAMP.clipWidthMm / 2 + CLAMP.exclusionMm;
  const ribTests: { ax: number; ay: number; bx: number; by: number }[] = [];
  if (deps.ribs) {
    const { center, u3, v3, wall } = deps.ribs;
    let rMax = 0;
    for (const q of pts) {
      const w = to3(q[0], q[1]);
      rMax = Math.max(rMax, Math.hypot(w[u3] - center[0], w[v3] - center[1]));
    }
    const reach = rMax + wall * 1.45 + 8;
    for (const deg of [45, 135, 225, 315]) {
      const th = (deg * Math.PI) / 180;
      ribTests.push({
        ax: center[0], ay: center[1],
        bx: center[0] + Math.cos(th) * reach, by: center[1] + Math.sin(th) * reach,
      });
    }
  }

  const usable: boolean[] = pts.map((q) => {
    const z = vertOf(q);
    if (z < frame.base + CLAMP.endClearMm || z > frame.crown - CLAMP.endClearMm) return false;
    if (deps.ribs) {
      const { u3, v3 } = deps.ribs;
      const w = to3(q[0], q[1]);
      for (const rt of ribTests) {
        if (distToSegment(w[u3], w[v3], rt.ax, rt.ay, rt.bx, rt.by) < keep) return false;
      }
    }
    for (const v of deps.vents ?? []) {
      if (Math.hypot(q[0] - v.uPull, q[1] - v.vPull) < v.boreR + keep) return false;
    }
    return true;
  });

  // Rotate the closed loop so usable runs never wrap across index 0.
  const n = pts.length;
  let rot = 0;
  if (usable[0] && usable[n - 1]) {
    const cut = usable.findIndex((u) => !u);
    if (cut > 0) rot = cut;
  }
  const P = rot ? [...pts.slice(rot), ...pts.slice(0, rot)] : pts;
  const U = rot ? [...usable.slice(rot), ...usable.slice(0, rot)] : usable;
  const m = P.length;
  const step = (i: number): number => Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]);

  const runs: { from: number; to: number; len: number }[] = [];
  let i = 0;
  while (i < m - 1) {
    if (U[i] && U[i + 1]) {
      let j = i, len = 0;
      while (j < m - 1 && U[j] && U[j + 1]) { len += step(j); j++; }
      runs.push({ from: i, to: j, len });
      i = j;
    } else i++;
  }
  const totalUsable = runs.reduce((s, r) => s + r.len, 0);
  if (totalUsable < CLAMP.clipWidthMm * 2) {
    return {
      stations: [], usableRailMm: Number(totalUsable.toFixed(1)), pitchMm: 0, mode: 'binder',
      warning: `usable seam rail ≈ ${totalUsable.toFixed(0)} mm — too short for planned clamp stations; clamp manually`,
    };
  }

  const count = Math.max(2, Math.ceil(totalUsable / CLAMP.pitchMm) + 1);
  // cumulative arc length along the resampled loop (for bulge-window walks)
  const cum = new Float64Array(m);
  for (let k = 1; k < m; k++) cum[k] = cum[k - 1] + step(k - 1);
  const arcDist = (a: number, b: number): number => Math.abs(cum[b] - cum[a]);
  const placeAt = (target: number): { q: number[]; seg: [number[], number[]]; at: number } => {
    let acc = 0;
    for (const r of runs) {
      if (target <= acc + r.len) {
        let s = 0;
        for (let k = r.from; k < r.to; k++) {
          const d = step(k);
          if (target <= acc + s + d) {
            const t = d > 0 ? (target - acc - s) / d : 0;
            return {
              q: [P[k][0] + (P[k + 1][0] - P[k][0]) * t, P[k][1] + (P[k + 1][1] - P[k][1]) * t],
              seg: [P[k], P[k + 1]],
              at: k,
            };
          }
          s += d;
        }
        return { q: P[r.to], seg: [P[Math.max(0, r.to - 1)], P[r.to]], at: r.to };
      }
      acc += r.len;
    }
    const last = runs[runs.length - 1];
    return { q: P[last.to], seg: [P[Math.max(0, last.to - 1)], P[last.to]], at: last.to };
  };
  // Measured rail width at a station: distance from the outer boundary to the
  // nearest inner (cavity-side) boundary, capped at the 7 mm construction
  // width — the flange can only be pinched narrower, never wider.
  const thicknessAt = (q: number[]): number => {
    let best = Infinity;
    for (const hp of holes) {
      for (let k = 0; k < hp.length; k++) {
        const A = hp[k], B = hp[(k + 1) % hp.length];
        best = Math.min(best, distToSegment(q[0], q[1], A[0], A[1], B[0], B[1]));
      }
    }
    return Number(Math.min(best === Infinity ? CLAMP.railProudMm : best, CLAMP.railProudMm).toFixed(2));
  };

  const stations: ClampStation[] = [];
  for (let k = 0; k < count; k++) {
    const { q, seg, at } = placeAt(((k + 0.5) / count) * totalUsable);
    // Outward rail-face normal at the landing segment: right of travel for a
    // CCW outer loop, left for CW. The clip's spine and jaw faces derive from it.
    const [ax, ay] = seg[0], [bx, by] = seg[1];
    const elen = Math.hypot(bx - ax, by - ay) || 1;
    let nx = (by - ay) / elen, ny = -(bx - ax) / elen;
    if (!ccw) { nx = -nx; ny = -ny; }
    const n3 = to3(nx, ny);
    // Outward bulge of the rail's outer edge within the clip window: the clip
    // is extruded STRAIGHT along the tangent, but the real edge curves and the
    // envelope ratchet steps — the spine and lead-in must vault over the
    // farthest outward excursion or the seated clip collides with the rail's
    // outer-end face (measured 41.7 mm³ overlap on the sheep without this).
    let bulge = 0;
    for (let j = at; j < m && arcDist(at, j) <= CLAMP.clipWidthMm / 2; j++) {
      const dx = P[j][0] - q[0], dy = P[j][1] - q[1];
      bulge = Math.max(bulge, dx * nx + dy * ny);
    }
    for (let j = at; j >= 0 && arcDist(at, j) <= CLAMP.clipWidthMm / 2; j--) {
      const dx = P[j][0] - q[0], dy = P[j][1] - q[1];
      bulge = Math.max(bulge, dx * nx + dy * ny);
    }
    stations.push({
      position: to3(q[0], q[1]),
      normal: [n3[0], n3[1], n3[2]],
      bulgeMm: Number(Math.max(0, bulge).toFixed(2)),
      railThickness: thicknessAt(q),
      index: k,
    });
  }
  return {
    stations,
    usableRailMm: Number(totalUsable.toFixed(1)),
    pitchMm: Number((totalUsable / count).toFixed(1)),
    mode: 'binder',
  };
}

// ---- ZeroClip geometry (MFG V0.5 commit 2) ----
// A C-shaped leaf spring printed FLAT (the profile plane is the bed plane, so
// every feature is support-free by construction). At a station the profile's
// x = radial outward (station.normal), y = the pull axis (parting normal),
// z = the seam tangent (extrusion, centered on the station). The jaws press
// the rail's ±pull faces (split.ts rail extrusion spans mid ± 2.5 mm); the
// spine stands 1.5 mm off the rail's outer edge in free air; jaw tips reach
// 2 mm past the rail edge and stop ≥5 mm short of the jacket wall.
const RAIL_STACK_HALF_MM = 2.5; // split.ts: rail prism extruded frame.mid ± 2.5

export function buildZeroClip(deps: {
  csCtor: { ofPolygons(poly: number[][][], fillRule?: string): CS };
  station: ClampStation;
  pull: [number, number, number]; // unit parting normal
  widthMm?: number;
  interferenceMm?: number;
}): ManifoldInstance {
  const { csCtor, station, pull } = deps;
  const width = deps.widthMm ?? CLAMP.clipWidthMm;
  const interference = deps.interferenceMm ?? CLAMP.clipInterferenceMm;
  const legT = CLAMP.clipLegTMm;
  const tipU = CLAMP.clipTipUMm;
  // The spine vaults over the rail edge's outward bulge (curvature + ratchet
  // steps): seated air gap = spineGap + bulge + kernel margin.
  const spineU = CLAMP.clipSpineGapMm + station.bulgeMm + 0.3;
  const spineOutU = spineU + legT;
  const pressV = RAIL_STACK_HALF_MM - interference / 2; // jaw face at rest — 0.15 mm of elastic spread per jaw
  const legOutV = pressV + legT;
  const flatEndU = tipU + 1.5;    // flat bearing patch before the lead-in
  // Stepped lead-in: a steep knee (71°) lifts the mouth wall past the rail's
  // outer-end corner (±2.5) BEFORE the bulge zone begins, then runs level to
  // the spine. A single straight flare re-entered the rail slab on curved
  // edges (the sheep's 41.7 mm³ collision).
  const kneeU = flatEndU + 0.4, kneeV = RAIL_STACK_HALF_MM + 1.0;
  const mouthV = kneeV + 0.4;
  const poly = [
    [tipU, pressV], [flatEndU, pressV], [kneeU, kneeV], [spineU, mouthV],
    [spineU, -mouthV], [kneeU, -kneeV], [flatEndU, -pressV], [tipU, -pressV],
    [tipU, -legOutV], [spineOutU, -legOutV], [spineOutU, legOutV], [tipU, legOutV],
  ];
  let cs = csCtor.ofPolygons([poly], 'EvenOdd');
  // Morphological closing: fillets the concave arm roots (≥2 mm radius — the
  // highest-stress junction) without choking the 4.7 mm mouth channel.
  cs = cs.offset(2, 'Round', 2, 32).offset(-2, 'Round', 2, 32);
  const solid = cs.extrude(width).translate(0, 0, -width / 2);
  const n = station.normal;
  const t: [number, number, number] = [
    n[1] * pull[2] - n[2] * pull[1],
    n[2] * pull[0] - n[0] * pull[2],
    n[0] * pull[1] - n[1] * pull[0],
  ];
  const P = station.position;
  // basis-as-rows 4x4: p' = n·x + pull·y + t·z + P (verified against the kernel)
  return solid.transform([
    n[0], n[1], n[2], 0,
    pull[0], pull[1], pull[2], 0,
    t[0], t[1], t[2], 0,
    P[0], P[1], P[2], 1,
  ]);
}

export interface ZeroClipValidation {
  ok: boolean;
  reason?: string;
  pressVolumeMm3: number;
}

/** Seated-clip acceptance (brief §35): the clip may only touch the jacket at
 *  the two designed elastic press patches (~1.5 × 18 × 0.15 mm each ≈ 8 mm³)
 *  — anything more collides, anything less does not grip. Watertightness and
 *  degeneracy are the export gate's job; spring force is the coupon's. */
export function validateZeroClip(deps: {
  clip: ManifoldInstance;
  jacket: ManifoldInstance;   // assembled jacket solid (rail included)
  maxPressVolumeMm3?: number;
  minPressVolumeMm3?: number;
}): ZeroClipValidation {
  const hit = deps.clip.intersect(deps.jacket);
  const v = hit.volume();
  hit.delete();
  const max = deps.maxPressVolumeMm3 ?? 12;
  const min = deps.minPressVolumeMm3 ?? 0.5;
  if (v > max) {
    return { ok: false, reason: `clip/jacket overlap ${v.toFixed(1)} mm³ exceeds the designed press volume (${max} mm³)`, pressVolumeMm3: v };
  }
  if (v < min) {
    return { ok: false, reason: `clip does not engage the rail (${v.toFixed(2)} mm³ contact)`, pressVolumeMm3: v };
  }
  return { ok: true, pressVolumeMm3: v };
}
