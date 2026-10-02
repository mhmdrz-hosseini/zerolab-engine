// Mold-method selector (plan Task 5, M1). Routes each input to a mold FAMILY
// by inspecting measured geometry — required surfaces, dominant planar
// backing, depth ratios, cavities — never filename, bbox flatness alone, or
// the original STL Z (audit §4: flat designs stood on their edges; ring/bowl
// shapes mis-called embosses by total height).
//
// All measures are orientation-INVARIANT: the backing plane is the largest
// connected planar face region found by triangle normals, so a rotated copy
// makes the same family decision (review focus #4). Thresholds are candidate
// FILTERS to be calibrated from physical trials, not universal laws.
import type { CastingIntent, MeshArrays } from './types';

export type { CastingIntent, InputRole, RequiredSurfaces } from './types';
export type MoldMethod = 'open_face_relief' | 'full_3d_jacket' | 'vessel_core' | 'needs_review';

/** Best-fit DEFAULT intent for a freshly ingested master (UX: the app
 *  suggests, the user confirms or overrides). Derived from the same measured
 *  coverage/flatness the family selector uses — never from the filename or
 *  the original Z. A vessel is NEVER suggested: hollowness alone cannot know
 *  the user wants the interior cast — that intent must come from the user
 *  (the selector then routes it to core planning or review). */
export function suggestIntent(mesh: MeshArrays): {
  surfaces: 'front_only' | 'all_sides';
  family: 'open_face_relief' | 'full_3d_jacket';
  reason: string;
  measures: MethodCandidate['measures'];
} {
  const asFront = classifyMethods(mesh, { inputRole: 'positive_master', requiredSurfaces: 'front_only' })[0];
  if (asFront.method === 'open_face_relief') {
    return { surfaces: 'front_only', family: 'open_face_relief', reason: asFront.reason, measures: asFront.measures };
  }
  const asAll = classifyMethods(mesh, { inputRole: 'positive_master', requiredSurfaces: 'all_sides' })[0];
  return { surfaces: 'all_sides', family: 'full_3d_jacket', reason: asAll.reason, measures: asAll.measures };
}

export interface MethodCandidate {
  method: MoldMethod;
  score: number;
  reason: string;
  /** measured evidence behind the decision */
  measures: {
    backingPatchAreaMm2: number;
    backingCoverage: number;      // patch area / projected footprint area
    flatnessRatio: number;        // depth along backing normal / min footprint span
    footprintSpanMinMm: number;
    footprintSpanMaxMm: number;
  };
}

// Candidate filters — calibrated against OUTPUT TEST 1 geometry; revisit from
// physical trials (plan §Phase B).
const FLAT_MAX_RATIO = 0.25;      // depth / min footprint span
// 0.3 (not 0.5): perforated faces lose coverage to their apertures — the audit's
// lantern cap measures 0.32 and is an explicit open-face candidate. Deep 3D
// forms stay excluded by the flatness filter (poodle: coverage 0.35, flatness 1.24).
const BACKING_MIN_COVERAGE = 0.3;

interface PlaneMeasure {
  area: number;
  normal: [number, number, number]; // unit
  offset: number;
}

/** Largest connected planar region: triangles grouped by quantized (normal,
 *  plane offset). Deliberately simple — coplanar faces of the same sheet share
 *  both keys; curved surfaces never accumulate. */
function dominantPlane(vp: Float32Array, tv: Uint32Array): PlaneMeasure {
  const buckets = new Map<string, { area: number; nx: number; ny: number; nz: number; d: number }>();
  let best = { area: 0, nx: 0, ny: 1, nz: 0, d: 0 };
  for (let t = 0; t < tv.length / 3; t++) {
    const a = tv[t * 3] * 3, b = tv[t * 3 + 1] * 3, c = tv[t * 3 + 2] * 3;
    const ux = vp[b] - vp[a], uy = vp[b + 1] - vp[a + 1], uz = vp[b + 2] - vp[a + 2];
    const wx = vp[c] - vp[a], wy = vp[c + 1] - vp[a + 1], wz = vp[c + 2] - vp[a + 2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) continue;
    nx /= len; ny /= len; nz /= len;
    const area = len / 2;
    // quantize direction (2 decimals) + plane offset (0.1 mm) so one sheet's
    // triangles share a bucket; float32 noise stays inside the bucket
    const d = nx * vp[a] + ny * vp[a + 1] + nz * vp[a + 2];
    const key = `${Math.round(nx * 100)},${Math.round(ny * 100)},${Math.round(nz * 100)}|${Math.round(d * 10)}`;
    const e = buckets.get(key) ?? { area: 0, nx, ny, nz, d };
    e.area += area;
    buckets.set(key, e);
    if (e.area > best.area) best = e;
  }
  return { area: best.area, normal: [best.nx, best.ny, best.nz], offset: best.d };
}

export function classifyMethods(mesh: MeshArrays, intent: CastingIntent): MethodCandidate[] {
  const { vertProperties: vp, triVerts: tv } = mesh;
  const n = vp.length / 3;
  const plane = dominantPlane(vp, tv);
  const [nx, ny, nz] = plane.normal;

  // footprint of the projection onto the backing plane + depth along its normal
  let spanUmin = Infinity, spanUmax = -Infinity, spanVmin = Infinity, spanVmax = -Infinity;
  let dmin = Infinity, dmax = -Infinity;
  // stable perpendicular basis
  const ref = Math.abs(nz) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  let ux = ny * ref[2] - nz * ref[1], uy = nz * ref[0] - nx * ref[2], uz = nx * ref[1] - ny * ref[0];
  const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
  const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
  for (let i = 0; i < n; i++) {
    const x = vp[i * 3], y = vp[i * 3 + 1], z = vp[i * 3 + 2];
    const u = x * ux + y * uy + z * uz;
    const v = x * vx + y * vy + z * vz;
    const d = x * nx + y * ny + z * nz;
    if (u < spanUmin) spanUmin = u; if (u > spanUmax) spanUmax = u;
    if (v < spanVmin) spanVmin = v; if (v > spanVmax) spanVmax = v;
    if (d < dmin) dmin = d; if (d > dmax) dmax = d;
  }
  const spanU = spanUmax - spanUmin, spanV = spanVmax - spanVmin;
  const minSpan = Math.max(1e-6, Math.min(spanU, spanV));
  const depth = dmax - dmin;
  const footprintArea = Math.max(1e-6, spanU * spanV);
  const coverage = plane.area / footprintArea;
  const flatness = depth / minSpan;
  const measures = {
    backingPatchAreaMm2: Number(plane.area.toFixed(1)),
    backingCoverage: Number(coverage.toFixed(3)),
    flatnessRatio: Number(flatness.toFixed(3)),
    footprintSpanMinMm: Number(minSpan.toFixed(1)),
    footprintSpanMaxMm: Number(Math.max(spanU, spanV).toFixed(1)),
  };

  const hasBackingPlane = coverage >= BACKING_MIN_COVERAGE && flatness <= FLAT_MAX_RATIO;
  const cands: MethodCandidate[] = [];
  const push = (method: MoldMethod, score: number, reason: string) =>
    cands.push({ method, score, reason, measures });

  // intent guard first: unspecified surfaces or unknown role must ask, not guess
  if (intent.requiredSurfaces === 'unspecified' || intent.inputRole === 'unknown') {
    push('needs_review', 100, 'casting intent is unspecified — answer required-surfaces (front only / all sides / inner and outer) before a family can be honest');
    push('full_3d_jacket', 20, 'safe fallback once intent is confirmed');
    return cands.sort((a, b) => b.score - a.score);
  }
  // role guard: tooling and prebuilt negatives are NEVER auto-wrapped as a
  // positive master (audit §4: a mold of the tooling instead of the object)
  if (intent.inputRole !== 'positive_master') {
    push('needs_review', 100, `input role is "${intent.inputRole}" — the engine will not auto-wrap a prebuilt negative/tool as a positive master; confirm the intended cast object and surfaces`);
    push('full_3d_jacket', 10, 'only valid after the role question is resolved');
    return cands.sort((a, b) => b.score - a.score);
  }

  // measured evidence shared by the reasons
  const evidence = `backing plane ${measures.backingPatchAreaMm2} mm² (${Math.round(coverage * 100)}% of footprint), depth/span ${flatness.toFixed(2)}`;

  if (intent.requiredSurfaces === 'front_only') {
    if (hasBackingPlane) {
      push('open_face_relief', 100, `required detail is one accessible face and a flat/open back is acceptable — ${evidence}`);
      push('full_3d_jacket', 40, 'generic jacket fallback if the tray fails construction or release gates');
    } else {
      push('full_3d_jacket', 90, `no dominant flat backing plane (coverage ${Math.round(coverage * 100)}%, flatness ${flatness.toFixed(2)}) — the relief route cannot back this geometry; ${evidence}`);
      push('needs_review', 30, 'front-only intent but the geometry has no natural open face — confirm the backing side');
    }
  } else if (intent.requiredSurfaces === 'all_sides') {
    push('full_3d_jacket', 100, 'detail is required around the body — a split/cut 3D mold is the only family that reproduces every side');
    if (hasBackingPlane) push('open_face_relief', 10, 'rejected as primary: sides would not be reproduced');
    else push('needs_review', 10, 'no natural backing plane; split planning needs a review of cut paths');
  } else if (intent.requiredSurfaces === 'inner_and_outer') {
    if (flatness > FLAT_MAX_RATIO) {
      push('vessel_core', 100, `both surfaces required with a deep recess (depth/span ${flatness.toFixed(2)}) — plan a removable core or split silicone; underside and rim must be preserved`);
    } else {
      push('needs_review', 90, 'inner-and-outer intent on a shallow form — confirm whether the underside is reproduced or waived before routing');
    }
    push('full_3d_jacket', 30, 'generic jacket fallback; core strategy still required');
  }

  return cands.sort((a, b) => b.score - a.score);
}
