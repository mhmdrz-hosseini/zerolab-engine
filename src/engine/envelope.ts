// Shape-following envelope — the primary construction, matching the commercial
// reference design language: per-height kernel slices of the master, offset
// ⊕gap so the cavity hugs the REAL silhouette (legs, ears, wool — not the
// convex hull), unioned with a 29° printability ratchet so bands that shrink
// upward stay FDM-printable, and extended vertically through the freeboard so
// the pour aperture = head ⊕ gap like the commercial systems.
//
// Each ring unions slices at ±1.0 mm around its height (sub-sampling) so thin
// horizontal features (flanges) between ring heights cannot escape the jacket;
// the ⊕0.1 margin bounds the chord error between sub-slices. Multi-loop
// slices (legs) take their convex hull for that band. Caps are ear-clipped
// because rings may be non-convex. The conservative support-function mode
// this replaces is documented in docs/MOLD-REFERENCE-DESIGN.md.
import * as THREE from 'three';
import { ShapeUtils } from 'three';
import type { ManifoldInstance, ManifoldMod } from './manifoldLoader';
import type { MeshArrays } from './types';
import type { MoldFrame } from './split';
import type { Loops } from './contours';

interface CSLike {
  area(): number;
  hull(): CSLike;
  simplify(epsilon: number): CSLike;
  offset(c: number, join?: string, m?: number, seg?: number): CSLike;
  toPolygons(): number[][][];
  add(o: CSLike): CSLike;
  delete(): void;
}
interface CSCtor {
  ofPolygons(poly: number[][][], fillRule?: string): CSLike;
}

export interface Envelope {
  cavity: ManifoldInstance;
  outer: ManifoldInstance;
  release: ManifoldInstance;
  clearance: ManifoldInstance;   // cavity ⊖ 1.0 — boolean no-touch body for the
                                  // extraction sim: the piece slides in its own
                                  // socket (chord-depth contact ≤ ~0.5 mm is
                                  // physical); real jams penetrate ≥ gap depth
  footprint: Loops;               // master shadow (plate outline basis)
  widest: Loops;                  // widest ring (plate outline basis)
  sections: { height: number; loops: Loops }[];
}

const N_SAMPLES = 128;

export function buildEnvelope(
  mod: ManifoldMod,
  mesh: MeshArrays,
  masterRot: ManifoldInstance,     // master rotated so vert→Z; sliced along Z
  toOriginal: (m: ManifoldInstance) => ManifoldInstance,
  frame: MoldFrame,
  gap: number,
  wall: number,
  window: number = gap,            // pull-clearance window span (mm). gap → the
                                   // V0.3 behavior; smaller values hug tighter.
                                   // Must stay ≥ the ~1.5 mm ring step so thin
                                   // horizontal features between rings stay covered.
): Envelope {
  const axes = ['X', 'Y', 'Z'];
  const v = axes.indexOf(frame.vert), u = (v + 1) % 3, w = (v + 2) % 3;
  const xyz = mesh.vertProperties;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < xyz.length; i += 3) for (let a = 0; a < 3; a++) {
    lo[a] = Math.min(lo[a], xyz[i + a]); hi[a] = Math.max(hi[a], xyz[i + a]);
  }
  // fixed radial-sampling origin: the master's (u,w) bbox center — the SAME
  // point for every ring, so the angular correspondence cannot slide when
  // ring shapes morph between bands (per-ring centroids shift; this must not)
  const center = [(lo[u] + hi[u]) / 2, (lo[w] + hi[w]) / 2];
  const slicer = masterRot as unknown as { slice(height: number): CSLike };
  const junk: { delete(): void }[] = [];
  const track = <T extends { delete(): void }>(x: T): T => { junk.push(x); return x; };
  const csCtor = mod.CrossSection as unknown as CSCtor;
  const height = frame.crown - frame.base;
  const count = Math.max(16, Math.ceil(height / 1.5));
  const step = height / count;
  const slope = 0.55;          // upward shrink ratchet (29° lean)
  // Pull-clearance window: each ring unions the master's silhouettes within
  // ±window along the vert (= pull-adjacent) axis, so the cavity extends ⊕gap
  // beyond every master point along the split normal — the jacket half can
  // slide off rigidly. This windowing is also why the commercial jackets hug
  // wide features but read boxy around fine ones (their measured p50 hug ~20
  // mm): features narrower than the window in pull smear into it. The full-gap
  // window is the safe V0.3 default; smaller windows hug tighter (less
  // silicone) and are bounded by the extraction press-in sim.
  const span = Math.min(Math.max(window, step), gap);
  const subs = [-span, -span / 2, 0, span / 2, span];

  // --- polygon extraction helpers (hoisted above the ring loop: every ring is
  // resampled to N_SAMPLES points immediately, so the ratchet and all later
  // offsets run on a bounded vertex count) ---
  // Radial (angular) resampling: sample every ring at N uniform angles from
  // its centroid, taking the FARTHEST boundary hit per ray. Unlike arc-length
  // resampling, the same angle always maps to the same feature direction, so
  // the loft's vertex correspondence cannot slide around the contour and fold
  // the surface between rings (measured: 6-loop mid-band slices). The radial
  // polygon contains the original ring, so containment is preserved.
  const resampleLoop = (best: number[][]): [number, number][] => {
    const m = best.length;
    const cx = center[0], cy = center[1];
    const out: [number, number][] = [];
    let lastT = 0;
    for (let s = 0; s < N_SAMPLES; s++) {
      const th = 2 * Math.PI * s / N_SAMPLES;
      const dx = Math.cos(th), dy = Math.sin(th);
      let bestT = 0;
      for (let i = 0; i < m; i++) {
        const [ax, ay] = best[i], [bx, by] = best[(i + 1) % m];
        const ex = bx - ax, ey = by - ay;
        const den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-12) continue;
        const t = ((ax - cx) * ey - (ay - cy) * ex) / den;    // ray parameter
        const uu = ((ax - cx) * dy - (ay - cy) * dx) / den;   // edge parameter
        if (t > bestT && uu >= -1e-9 && uu <= 1 + 1e-9) bestT = t;
      }
      if (bestT <= 0) bestT = lastT; // ray missed: hold the previous radius
      lastT = bestT;
      out.push([cx + dx * bestT, cy + dy * bestT]);
    }
    return out;
  };
  const largestLoop = (polys: number[][][]): number[][] => {
    let best: number[][] = [], bestA = -1;
    for (const p of polys) {
      let a2 = 0;
      for (let i = 0; i < p.length; i++) {
        const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length];
        a2 += x1 * y2 - x2 * y1;
      }
      if (Math.abs(a2) > bestA) { bestA = Math.abs(a2); best = p; }
    }
    return best;
  };
  const csFromLoop = (poly: number[][]): CSLike =>
    track(csCtor.ofPolygons([poly as unknown as number[][]], 'EvenOdd') as unknown as CSLike);

  // --- cavity rings (CrossSections in the rotated frame, (u,w) coordinates) ---
  const rings: CSLike[] = [];
  let prev: CSLike | null = null;
  for (let k = 0; k <= count; k++) {
    const z = frame.base + k * step;
    let merged: CSLike | null = null;
    for (const d of subs) {
      const zs = z + d;
      if (zs < frame.base - 1e-9 || zs > frame.crown + 1e-9) continue;
      const s = track(slicer.slice(zs));
      if (s.area() <= 1e-6) continue;
      merged = merged ? track(merged.add(s)) : track(s);
    }
    let ring: CSLike | null = null;
    if (merged && merged.area() > 1e-6) {
      // Simplify BEFORE offsetting: wool/tessellation micro-corners multiply
      // through the 48-segment round joins, and the ratchet feeds each dense
      // ring into the next offset — measured 1.1k → 68k verts over ten rings
      // with quadratic offset time (minutes per model). 0.1 mm is two orders
      // below the silicone gap and far below the print resolution.
      const sm = track(merged.simplify(0.1));
      let r = track(sm.offset(gap + 0.1, 'Round', 2, 48));
      if (r.toPolygons().length > 1) r = track(r.hull().offset(gap + 0.1, 'Round', 2, 48));
      // resample to the working resolution, then apply the upward-shrink
      // ratchet on the light polygon and re-resample once
      let poly = resampleLoop(largestLoop(r.toPolygons()));
      let rcs = csFromLoop(poly);
      if (prev) {
        const floor = track(prev.offset(-slope * step, 'Round', 2, 32));
        if (floor.area() > 1e-6) {
          rcs = track(rcs.add(floor));
          poly = resampleLoop(largestLoop(rcs.toPolygons()));
          rcs = csFromLoop(poly);
        }
      }
      ring = rcs;
    } else if (prev) {
      ring = prev; // vertical freeboard walls above the master
    }
    if (!ring) throw new Error('envelope ring collapsed at the base — master has no usable footprint');
    rings.push(ring);
    prev = ring;
  }

  const ringPolygons: [number, number][][] = rings.map((r) => resampleLoop(largestLoop(r.toPolygons())));

  const offsetPolygons = (ring: [number, number][], c: number): [number, number][] => {
    const cs = track(csCtor.ofPolygons([ring as unknown as number[][]], 'EvenOdd').offset(c, 'Round', 2, 48));
    return resampleLoop(largestLoop(cs.toPolygons()));
  };

  // --- solids: quad strip between corresponding ring vertices + ear-clipped
  // caps (rings may be non-convex). Built in the rotated frame, then rotated
  // back to original coordinates. ---
  const loftPolygons = (polys: [number, number][][]): ManifoldInstance => {
    const perRing = polys.length;
    const vertices: number[] = [], triangles: number[] = [];
    for (let k = 0; k < perRing; k++) {
      const z = frame.base + k * step;
      for (const q of polys[k]) vertices.push(q[0], q[1], z);
    }
    for (let k = 0; k < perRing - 1; k++) for (let j = 0; j < N_SAMPLES; j++) {
      const a = k * N_SAMPLES + j, b = k * N_SAMPLES + (j + 1) % N_SAMPLES, c = b + N_SAMPLES, d = a + N_SAMPLES;
      triangles.push(a, b, c, a, c, d);
    }
    const capTris = (k: number): number[][] => ShapeUtils.triangulateShape(polys[k].map(([x, y]) => new THREE.Vector2(x, y)), []);
    const b0 = 0, t0 = (perRing - 1) * N_SAMPLES;
    for (const tri of capTris(0)) triangles.push(b0 + tri[2], b0 + tri[1], b0 + tri[0]);
    for (const tri of capTris(perRing - 1)) triangles.push(t0 + tri[0], t0 + tri[1], t0 + tri[2]);
    const solid = new mod.Manifold(new mod.Mesh({
      numProp: 3,
      vertProperties: Float32Array.from(vertices),
      triVerts: Uint32Array.from(triangles),
    }));
    return toOriginal(solid);
  };

  const cavity = loftPolygons(ringPolygons);
  const outer = loftPolygons(ringPolygons.map((r) => offsetPolygons(r, wall * 1.45)));
  const release = loftPolygons(ringPolygons.map((r) => offsetPolygons(r, -0.02)));
  const clearance = loftPolygons(ringPolygons.map((r) => offsetPolygons(r, -1.0)));

  // plate bases: the FULL master shadow (outer boundaries only) and the widest
  // ring, in (u,w) coordinates. Multi-loop on purpose: a flat text/sign master
  // slices into disjoint letter islands — taking the single largest loop
  // stranded the base plate on one island, halfway off the master. Holes are
  // dropped (negative signed area) so the plate stays solid under ring-shaped
  // letters; the union CS in split.ts offsets every loop.
  let shadow: CSLike | null = null;
  for (let k = 0; k <= count; k++) {
    const z = frame.base + k * step;
    for (const d of subs) {
      const s = track(slicer.slice(z + d));
      if (s.area() <= 1e-6) continue;
      shadow = shadow ? track(shadow.add(s)) : track(s);
    }
  }
  const signedArea2 = (loop: number[][]): number => {
    let a2 = 0;
    for (let i = 0; i < loop.length; i++) {
      const [x1, y1] = loop[i], [x2, y2] = loop[(i + 1) % loop.length];
      a2 += x1 * y2 - x2 * y1;
    }
    return a2;
  };
  let footprint: number[][][] = [];
  if (shadow) {
    const polys = shadow.toPolygons();
    const outers = polys.filter((p) => signedArea2(p) > 0);
    footprint = outers.length > 0 ? outers : polys;
  }
  let widestRing = ringPolygons[0], widestArea = -1;
  for (const r of ringPolygons) {
    const a2 = Math.abs(signedArea2(r as unknown as number[][]));
    if (a2 > widestArea) { widestArea = a2; widestRing = r; }
  }

  for (const x of junk) { try { x.delete(); } catch { /* freed */ } }
  return {
    cavity,
    outer,
    release,
    clearance,
    footprint: (footprint.length > 0 ? footprint : [ringPolygons[0]]) as unknown as Loops,
    widest: [widestRing] as unknown as Loops,
    sections: ringPolygons.map((ring, k) => ({ height: frame.base + k * step, loops: [ring] as unknown as Loops })),
  };
}
