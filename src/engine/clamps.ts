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
import type { PortSpec } from './ports';

export const CLAMP = {
  clipWidthMm: 18,  // mid of the 16–20 mm ZeroClip prototype band; doubles as the binder landing width for exclusion math
  pitchMm: 40,      // target station spacing along the usable rail
  endClearMm: 12,   // stay this far from the rail's base/crown trim boundaries
  exclusionMm: 2,   // extra margin around ribs/vents beyond half a clip width
  railProudMm: 7,   // construction width of the flange (split.ts rail offset) — caps any measured thickness
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
  const fail = (warning: string): ClampPlan => ({ stations: [], usableRailMm: 0, pitchMm: 0, warning });

  if (!railSection.toPolygons) return fail('clamp stations unavailable — the rail outline could not be read');
  const polys = railSection.toPolygons();
  if (polys.length === 0) return fail('clamp stations unavailable — the rail outline is empty');

  // The band's outer boundary is the loop with the largest enclosed |area|;
  // every other loop is an inner (cavity-side) boundary for thickness probing.
  const shoelace = (poly: number[][]): number => {
    let s = 0;
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
      s += x1 * y2 - x2 * y1;
    }
    return Math.abs(s / 2);
  };
  let outer = polys[0];
  for (const poly of polys) if (shoelace(poly) > shoelace(outer)) outer = poly;
  const holes = polys.filter((poly) => poly !== outer);
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
      stations: [], usableRailMm: Number(totalUsable.toFixed(1)), pitchMm: 0,
      warning: `usable seam rail ≈ ${totalUsable.toFixed(0)} mm — too short for planned clamp stations; clamp manually`,
    };
  }

  const count = Math.max(2, Math.ceil(totalUsable / CLAMP.pitchMm) + 1);
  const placeAt = (target: number): number[] => {
    let acc = 0;
    for (const r of runs) {
      if (target <= acc + r.len) {
        let s = 0;
        for (let k = r.from; k < r.to; k++) {
          const d = step(k);
          if (target <= acc + s + d) {
            const t = d > 0 ? (target - acc - s) / d : 0;
            return [P[k][0] + (P[k + 1][0] - P[k][0]) * t, P[k][1] + (P[k + 1][1] - P[k][1]) * t];
          }
          s += d;
        }
        return P[r.to];
      }
      acc += r.len;
    }
    return P[runs[runs.length - 1].to];
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
    const q = placeAt(((k + 0.5) / count) * totalUsable);
    stations.push({ position: to3(q[0], q[1]), railThickness: thicknessAt(q), index: k });
  }
  return {
    stations,
    usableRailMm: Number(totalUsable.toFixed(1)),
    pitchMm: Number((totalUsable / count).toFixed(1)),
  };
}
