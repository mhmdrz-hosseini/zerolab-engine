// V0.2 — commercial-reference architecture (reverse-engineered from the Cute
// Sheep system, docs/V0.2_REARCHITECTURE.md):
//   master_base = doll + contoured plate fused underneath
//   jacket      = two halves of a shadow-prism shell: cavity = doll's XY
//                 shadow ⊕ gap (hugs at the widest slices only), 5 mm vertical
//                 walls, bottom rim seated ON the plate, OPEN crown 10 mm
//                 above the doll — no cap, no pour bore
//   glove       = cavity prism − doll (the silicone fill preview)
// The extraction sim slides each finished piece along its pull axis in 2 mm
// steps and tests BVH overlap against the glove and the master.
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { trappedColumnMask } from './analyze';
import { type Loops } from './contours';
import { buildEnvelope } from './envelope';
import { instanceToMeshArrays } from './offset';
import type { SdfGrid } from './offset';
import { planPorts, type PortsPlan } from './ports';
import type { ManifoldInstance, ManifoldMod } from './manifoldLoader';
import type { Axis, GenerateParams, MeshArrays } from './types';

const UNIT: Record<Axis, [number, number, number]> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
const AXES: Axis[] = ['X', 'Y', 'Z'];

// reference-derived constants (Cute Sheep measurements, docs §1/§4), sized for
// the 150 mm reference master. For other master sizes buildMoldForAxis derives
// scaled constants from frameConstants() — these stay as the s=1 reference and
// the printer-physics floors (foot relief), which are absolute.
export const V02 = {
  plateMargin: 18,   // plate outline = shadow ⊕ 18 mm (ref ≈ 18.5)
  plateT: 4,         // plate thickness (ref 2.9)
  rimH: 3,           // jacket rim band seated on the plate (ref ≈ 3)
  freeboard: 10,     // open crown above the doll's top (ref 10.4)
  taperExtra: 5,     // cavity = shadow ⊕ (gap + taperExtra) at the plate, ⊕0 at the crown (ref draft ≈ 4–5°)
  tongue: 2,         // A→B alignment lip at the parting plane
  ventR: 1.25,
  // FDM joint-fit features (printability audit 2026-09-26 §12/§13):
  leadFlare: 0.5,    // groove-mouth widening — self-jigging lead-in
  leadDepth: 0.8,    // axial extent of that flare
  tipTaper: 0.6,     // stepped shrink of the tongue tip (eases entry)
  footReliefH: 0.5,  // elephant-foot relief band on bed-contact faces
  footReliefC: 0.2,  // …and its depth (Prusa-style 0.2 mm compensation, in geometry)
};

/**
 * Frame constants scaled to the master's largest dimension. Every
 * master-proportional constant (plate margin, plate thickness, rim, freeboard,
 * joint tongue, rails, ribs) shrinks with small masters — a 5 cm master must
 * not carry a full-size plate and gap — floored at FDM-printable minimums.
 * Printer-physics constants (elephant-foot relief) stay absolute.
 */
export interface FrameConstants {
  plateMargin: number;
  plateT: number;
  rimH: number;
  freeboard: number;
  tongue: number;
  leadFlare: number;
  leadDepth: number;
  tipTaper: number;
  railOffset: number;
  railHalfW: number;
  ribDepth: number;
  ribW: number;
  footReliefH: number;
  footReliefC: number;
}

export function frameConstants(maxMasterDim: number): FrameConstants {
  const s = Math.max(0.2, Math.min(1, maxMasterDim / 150));
  const mm = (ref: number, floor: number) => Math.max(floor, ref * s);
  return {
    plateMargin: mm(V02.plateMargin, 6),
    // physical floor (reliability brief §3): proportional scaling at tiny
    // masters thinned the plate below what a printed base needs to stay flat
    plateT: mm(V02.plateT, 3.5),
    rimH: mm(V02.rimH, 1.5),
    freeboard: mm(V02.freeboard, 4),
    tongue: mm(V02.tongue, 1),
    leadFlare: mm(V02.leadFlare, 0.3),
    leadDepth: mm(V02.leadDepth, 0.5),
    tipTaper: mm(V02.tipTaper, 0.4),
    railOffset: mm(7, 3),
    railHalfW: 2.5,          // seam-rail span sized for binder clips — absolute
    ribDepth: mm(8, 4),
    ribW: mm(2, 1.2),
    footReliefH: V02.footReliefH,
    footReliefC: V02.footReliefC,
  };
}

export interface CS {
  offset(delta: number, joinType?: string, miterLimit?: number, circularSegments?: number): CS;
  extrude(height: number, nDivisions?: number, twistDegrees?: number, scaleTop?: number | [number, number], center?: boolean): ManifoldInstance;
  translate(x: number, y?: number): CS;
  rotate(degrees: number): CS;
  mirror(normal: [number, number]): CS;
  simplify(epsilon?: number): CS;
  area(): number;
  union(other: CS): CS;
  subtract(other: CS): CS;
  add(other: CS): CS;
  toPolygons?(): number[][][];
  delete(): void;
}
type CSCtor = {
  ofPolygons(poly: number[][][], fillRule?: string): CS;
  circle(radius: number, segments?: number): CS;
  square(size: number[], cornerRadius?: number): CS;
};

export interface MoldFrame {
  pull: Axis;     // parting normal (extraction direction)
  vert: Axis;     // mold vertical (pour direction); base plate ⊥ this
  depth: Axis;
  base: number;   // base plane position along vert (= plate top = doll's feet)
  mid: number;    // parting plane position along pull
  crown: number;  // open-crown plane above the master's highest point
}

export function pickFrame(pull: Axis, master: MeshArrays, vertical?: Axis): MoldFrame {
  const bb = bboxOfArrays(master);
  const p = AXES.indexOf(pull);
  const rest = [0, 1, 2].filter((a) => a !== p);
  const K = frameConstants(Math.max(...bb.dim));
  if (vertical !== undefined) {
    const vi = AXES.indexOf(vertical);
    if (vi === p) throw new Error('The vertical (pour) axis must differ from the split (pull) axis');
    const d = rest.find((a) => a !== vi)!;
    return {
      pull,
      vert: AXES[vi],
      depth: AXES[d],
      base: bb.min[vi],
      mid: bb.min[p] + bb.dim[p] / 2,
      crown: bb.min[vi] + bb.dim[vi] + K.freeboard,
    };
  }
  // stable-base rule v2 — scale-invariant, flatness-first. The mold stands on
  // the rest axis whose minimum side makes the best BED: commercial systems
  // stand figures on their feet and flat signs on their flat back. Three
  // fixes over the original rule:
  //   • the near-extreme band is purely relative (2% of the axis dim) — the
  //     old 2 mm absolute floor ate proportionally deeper into small masters
  //     and flipped the pick (measured: a 5 cm figure stood on its side);
  //   • triangle-AREA weighting counts only faces whose normal is parallel to
  //     the axis (±6°) as flat bed area — vertex counting flipped on
  //     tessellation density;
  //   • the score multiplies flatness by the patch's stability: a thin flat
  //     WALL parallel to the extreme plane (the left edge of an "E") has large
  //     flat area but is a mast, not a bed — its cross-extent is tiny next to
  //     the height above it, so it loses to the real sole/back face.
  const vp = master.vertProperties, tv = master.triVerts;
  const BED_BAND = 0.02;   // 2% of the axis dim
  const COS_FLAT = 0.9945; // |n·axis| / |n| ≥ cos(6°)
  const score = (a: number): number => {
    const thr = bb.min[a] + bb.dim[a] * BED_BAND;
    const cross = Math.max(1e-9, bb.dim[(a + 1) % 3] * bb.dim[(a + 2) % 3]);
    const u = (a + 1) % 3, w = (a + 2) % 3;
    let flat = 0;
    const lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
    for (let t = 0; t < tv.length; t += 3) {
      const i0 = tv[t] * 3, i1 = tv[t + 1] * 3, i2 = tv[t + 2] * 3;
      const ca = (vp[i0 + a] + vp[i1 + a] + vp[i2 + a]) / 3;
      if (ca > thr) continue;
      const ux = vp[i1] - vp[i0], uy = vp[i1 + 1] - vp[i0 + 1], uz = vp[i1 + 2] - vp[i0 + 2];
      const wx = vp[i2] - vp[i0], wy = vp[i2 + 1] - vp[i0 + 1], wz = vp[i2 + 2] - vp[i0 + 2];
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const na = a === 0 ? nx : a === 1 ? ny : nz;
      const norm = Math.hypot(nx, ny, nz);
      const A = norm / 2;
      if (Math.abs(na) < COS_FLAT * norm) continue;
      flat += A;
      for (const i of [i0, i1, i2]) {
        const cu = vp[i + u], cw = vp[i + w];
        if (cu < lo[0]) lo[0] = cu; if (cu > hi[0]) hi[0] = cu;
        if (cw < lo[1]) lo[1] = cw; if (cw > hi[1]) hi[1] = cw;
      }
    }
    const flatRatio = flat / cross;
    if (flatRatio < 1e-6) return 0;
    const extU = hi[0] > lo[0] ? hi[0] - lo[0] : 0;
    const extW = hi[1] > lo[1] ? hi[1] - lo[1] : 0;
    const stability = Math.min(extU, extW) / Math.max(bb.dim[a], 1e-9);
    return flatRatio * stability;
  };
  const s0 = score(rest[0]), s1 = score(rest[1]);
  const v = s0 >= s1 ? rest[0] : rest[1];
  const d = rest.find((a) => a !== v)!;
  return {
    pull,
    vert: AXES[v],
    depth: AXES[d],
    base: bb.min[v],
    mid: bb.min[p] + bb.dim[p] / 2,
    crown: bb.min[v] + bb.dim[v] + K.freeboard,
  };
}

/**
 * Extrude a vert-frame 2D profile (coords = (u3, v3) values of the vert axis)
 * along the vert axis from `from` to `to`. Rotation paths verified against
 * Manifold's CCW-positive 2D rotate (the old X path mirrored — fixed here).
 */
function prismOnVert(cs: CS, v: number, from: number, to: number): ManifoldInstance {
  const h = to - from;
  if (v === 2) return cs.extrude(h).translate(0, 0, from);
  if (v === 1) return cs.rotate(-90).extrude(h).rotate(-90, 0, 0).translate(0, from, 0);
  return cs.extrude(h).rotate(0, 90, 0).rotate(90, 0, 0).translate(from, 0, 0);
}

/** Extrude a pull-frame 2D profile (coords = ((p+1)%3, (p+2)%3) values) along the pull axis. */
function prismOnPull(cs: CS, p: number, from: number, to: number): ManifoldInstance {
  const h = to - from;
  if (p === 2) return cs.extrude(h).translate(0, 0, from);
  if (p === 1) return cs.rotate(-90).extrude(h).rotate(-90, 0, 0).translate(0, from, 0);
  return cs.extrude(h).rotate(0, 90, 0).rotate(90, 0, 0).translate(from, 0, 0);
}

function bboxOfArrays(m: MeshArrays): { min: number[]; dim: number[] } {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.vertProperties.length / 3; i++) {
    for (let k = 0; k < 3; k++) {
      const x = m.vertProperties[i * 3 + k];
      if (x < min[k]) min[k] = x;
      if (x > max[k]) max[k] = x;
    }
  }
  return { min, dim: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

/**
 * Machine the tongue/groove joint between two complementary halves of `ref`
 * (the solid the seam section is taken from) along `axis` at plane `mid`.
 * The "pos" role receives the tapered tongue, the "neg" role the clearance
 * groove with lead-in flare. `flip` mirrors the spans for when the pos ROLE
 * is played by the axis-negative half (3-piece builds put the sub-split on
 * the groove side, so the tongue half may be the −axis one). Used for the
 * main ±pull joint and for the 3-piece sub-joint alike.
 */
function machineJoint(deps: {
  mod: ManifoldMod;
  track: <T extends { delete(): void }>(x: T) => T;
  ref: ManifoldInstance;       // solid the seam section is taken from
  axis: Axis;
  mid: number;
  wall: number;
  clearance: number;
  label: string;
  flip?: boolean;              // pos role sits on the axis-NEGATIVE side
  K: FrameConstants;           // scale-aware joint constants
}, posHalf: ManifoldInstance, negHalf: ManifoldInstance): { pos: ManifoldInstance; neg: ManifoldInstance } {
  const { track, ref, axis, mid, wall, clearance, K } = deps;
  const s = deps.flip ? -1 : 1; // direction from the face into the neg role, in axis coords
  const span = (a: number, b: number): [number, number] => a <= b ? [a, b] : [b, a];
  const p = AXES.indexOf(axis);
  let localRef = ref;
  if (p === 0) localRef = track(track(ref.rotate(0, -90, 0)).rotate(0, 0, -90));
  if (p === 1) localRef = track(track(ref.rotate(90, 0, 0)).rotate(0, 0, 90));
  const seam = track(localRef.slice(mid));
  const inset = Math.max(0.65, wall * 0.28);
  const depth = Math.min(K.tongue, wall * 0.65);
  const tongueCS = track(seam.offset(-inset, 'Round', 2, 32).simplify(1e-4));
  // Stepped tip taper (audit §12): the last `tipTaper` mm of the lip shrink
  // in two 0.08 mm steps so the tongue finds the flared groove mouth instead
  // of butting against it. Rings that pinch empty on thin walls are skipped.
  const tipH = Math.min(K.tipTaper, depth * 0.45);
  const tipHighCS = track(tongueCS.offset(-0.08, 'Round', 2, 32).simplify(1e-4));
  const tipLowCS = track(tongueCS.offset(-0.16, 'Round', 2, 32).simplify(1e-4));
  const mainTongue = track(prismOnPull(tongueCS, p, ...span(mid - s * (depth - tipH), mid + s * 0.2)));
  let tongue = mainTongue;
  if (tipHighCS.area() > 1e-6) {
    tongue = track(tongue.add(track(prismOnPull(tipHighCS, p, ...span(mid - s * (depth - tipH / 2), mid - s * (depth - tipH))))));
  }
  if (tipLowCS.area() > 1e-6) {
    tongue = track(tongue.add(track(prismOnPull(tipLowCS, p, ...span(mid - s * depth, mid - s * (depth - tipH / 2))))));
  }
  const grooveCS = track(tongueCS.offset(clearance, 'Round', 2, 32).simplify(1e-4));
  const groove = track(prismOnPull(grooveCS, p, ...span(mid - s * (depth + clearance), mid + s * 0.01)));
  // Lead-in flare (audit §12): the groove mouth widens for the first
  // `leadDepth` mm. Kept strictly inside the wall section (never re-cutting
  // the cavity face): flare ≤ inset − clearance − 0.1.
  const flare = Math.min(K.leadFlare, Math.max(0, inset - clearance - 0.1));
  const flareCS = track(tongueCS.offset(clearance + flare, 'Round', 2, 32).simplify(1e-4));
  const flarePrism = track(prismOnPull(flareCS, p, ...span(mid - s * Math.min(K.leadDepth, depth * 0.6), mid + s * 0.01)));
  if (tongue.volume() < 0.1) throw new Error(`${deps.label}: joint is empty — increase the wall thickness`);
  let pos = track(posHalf.add(tongue));
  let neg = track(negHalf.subtract(groove));
  neg = track(neg.subtract(flarePrism));
  if (!isOk(pos) || !isOk(neg)) throw new Error(`${deps.label}: kernel rejected the tongue/groove features`);
  const overlap = track(pos.intersect(neg));
  if (overlap.volume() > 0.01) throw new Error(`${deps.label}: joint halves interfere`);
  return { pos, neg };
}

function isOk(inst: ManifoldInstance): boolean {
  const st = inst.status();
  const v = typeof st === 'object' && st !== null ? (st as { code?: number | string }).code : st;
  return v === 'NoError' || v === 0 || v === 'Ok';
}

export interface ExtractionResult { pass: boolean; freeAtMm: number; obstacle?: string }
export interface MoldPieces {
  jacketA: MeshArrays;
  jacketB: MeshArrays;           // 2-piece: the −pull half. 3-piece: unused shell
  jacketB1?: MeshArrays;         // 3-piece: heavy-half sub-panels (±depth pull)
  jacketB2?: MeshArrays;
  basePlate: MeshArrays;
  skin: MeshArrays;      // the glove: cavity prism − master (silicone fill preview)
  jacketSolid: MeshArrays; // pre-split jacket (viewer "outer" layer)
}

export interface AxisAttempt {
  axis: Axis;
  frame: MoldFrame;
  pieces: MoldPieces;
  extraction: { A: ExtractionResult; B: ExtractionResult | null; B1?: ExtractionResult | null; B2?: ExtractionResult | null };
  siliconeDemold: SiliconeDemold;
  panels: 2 | 3;
  jacketDim: [number, number, number];
  plateDim: [number, number, number];
  plateT: number;               // scaled plate thickness (frameConstants)
  ports: PortsPlan;
  siliconeMl: number;
  cavityLoops: Loops;    // cavity prism outline, vert-frame (u3, v3) coords — fill-gate seed region
  cavitySections: { height: number; loops: Loops }[];
  cavity: MeshArrays;    // cavity solid (arrays copy) — used by gates and release checks
  warnings: string[];
}

export interface BuildMoldDeps {
  mod: ManifoldMod;
  master: MeshArrays;           // analysis mesh (SDF source)
  grid: SdfGrid;
  params: GenerateParams;
  axis: Axis;
  ports?: boolean;              // place air vents (§ ports.ts)
  onProgress?: (stage: string, pct: number) => void;
}

export async function buildMoldForAxis(deps: BuildMoldDeps): Promise<AxisAttempt> {
  const { mod, master, grid, params, axis } = deps;
  const progress = deps.onProgress ?? (() => {});
  const csCtor = mod.CrossSection as unknown as CSCtor;
  const frame = pickFrame(axis, master, params.verticalAxis);
  const mbb = bboxOfArrays(master);
  const K = frameConstants(Math.max(...mbb.dim));
  const warnings: string[] = [];
  const junk: { delete(): void }[] = [];
  const track = <T extends { delete(): void }>(x: T): T => { junk.push(x); return x; };
  const printable = (solid: ManifoldInstance, name: string): ManifoldInstance => {
    const components = solid.decompose().map(track);
    const substantial = components.filter(c => c.volume() > 0.0001);
    if (substantial.length !== 1) throw new Error(`${name} has ${substantial.length} disconnected solids; choose a connected master or another orientation`);
    return substantial[0]; // omit zero-volume Boolean residue, never real geometry
  };

  try {
    const p = AXES.indexOf(axis);
    const v = AXES.indexOf(frame.vert);
    const pv = UNIT[axis]; // pull direction (roles may swap for 3-piece builds)
    const { gap, wall } = params;

    if (![gap, wall, params.clearance].every(Number.isFinite) || gap <= 0 || wall < 2 || params.clearance < 0.05 || params.clearance > wall / 3) {
      throw new Error('Use positive gap, wall ≥ 2 mm, and joint clearance between 0.05 mm and one third of the wall');
    }
    progress('Lofting a smooth, releasable envelope around the master', 0.2);
    const masterMan = track(new mod.Manifold(new mod.Mesh({ numProp: 3, vertProperties: master.vertProperties, triVerts: master.triVerts })));
    if (!isOk(masterMan)) throw new Error('Kernel rejected the master mesh');
    // the envelope slices the master along its vert axis: rotate vert→Z and
    // hand the envelope an inverse callback so its solids come back in
    // original coordinates
    let masterRot = masterMan;
    if (v === 0) masterRot = track(track(masterMan.rotate(0, -90, 0)).rotate(0, 0, -90));
    if (v === 1) masterRot = track(track(masterMan.rotate(90, 0, 0)).rotate(0, 0, 90));
    const invRotate = (m: ManifoldInstance): ManifoldInstance => {
      if (v === 2) return m;
      if (v === 1) {
        const r = track(track(m.rotate(0, 0, -90)).rotate(-90, 0, 0));
        m.delete();
        return r;
      }
      const r = track(track(m.rotate(0, 0, 90)).rotate(0, 90, 0));
      m.delete();
      return r;
    };
    const envelope = buildEnvelope(mod, master, masterRot, invRotate, frame, gap, wall, params.gapWindow ?? gap);
    const cavitySolid = track(envelope.cavity), outerSolid = track(envelope.outer);
    if (!isOk(cavitySolid) || !isOk(outerSolid)) throw new Error('Kernel rejected the envelope loft');
    const footprintCS = track(csCtor.ofPolygons(envelope.footprint as number[][][], 'EvenOdd'));
    const widestCS = track(csCtor.ofPolygons(envelope.widest as number[][][], 'EvenOdd'));
    let plateOutlineCS = track(track(footprintCS.offset(K.plateMargin, 'Round', 2, 48))
      .add(track(widestCS.offset(Math.max(3, wall * 1.2 + 2), 'Round', 2, 48))));
    const cavityLoops = envelope.widest;
    // Shell first: the cavity lies strictly inside the outer loft, so this cut
    // has no coincident faces. The old (outer+rimSlab)−cavity order re-cut
    // faces that already coincide and imprinted them as inverted slivers.
    let jacket = track(outerSolid.subtract(cavitySolid));
    // Seating rim, built as a 2D ring. The exclusion band must be the cavity's
    // EXACT silhouette over the rim prism's whole vert-span: the cavity loft
    // interpolates between rings, so a band of rings below base+rimH misses the
    // interpolation toward the next (possibly much fatter) ring — measured
    // 3.9 mm³ intrusion on an 11 cm flat master that was clean at 18 cm
    // (ring step 1.475 mm vs rimH 2.2 mm lands mid-interpolation). Project the
    // cavity slab along the vert axis instead — sampled unions are wrong at any
    // fixed step for sharp-edged masters.
    let cavityV = cavitySolid;
    if (v === 0) cavityV = track(track(cavitySolid.rotate(0, -90, 0)).rotate(0, 0, -90));
    if (v === 1) cavityV = track(track(cavitySolid.rotate(90, 0, 0)).rotate(0, 0, 90));
    const rimSlab = track(track(cavityV.trimByPlane([0, 0, 1], frame.base))
      .trimByPlane([0, 0, -1], -(frame.base + K.rimH)));
    const rimCS = track(track(plateOutlineCS.offset(-0.3, 'Round', 2, 48))
      .subtract(track(rimSlab.project().offset(0.05, 'Round', 2, 48))).simplify(1e-4));
    const rimBlock = track(prismOnVert(rimCS, v, frame.base, frame.base + K.rimH));
    jacket = track(jacket.add(rimBlock));
    if (!isOk(jacket) || jacket.volume() < 1) throw new Error('Jacket has no valid volume');

    // External rails provide actual flat clamping lands at both seam edges.
    // Limit their vertical extent to the shell; an offset ring alone would
    // hang below the base and bridge across the crown.
    let localOuter = outerSolid;
    if (p === 0) localOuter = track(track(outerSolid.rotate(0, -90, 0)).rotate(0, 0, -90));
    if (p === 1) localOuter = track(track(outerSolid.rotate(90, 0, 0)).rotate(0, 0, 90));
    const outerSection = track(localOuter.slice(frame.mid));
    // Rail inner boundary = the cavity's mid-plane section ⊕0.2. The cavity is
    // convex and mirrored about the pull mid-plane, so its mid chord covers
    // every narrower chord inside the rail's ±2.5 mm span — the flange can
    // weld deep into the wall yet never touch the cavity (verified by the
    // intersection guard below, replacing the topology-destroying re-cut).
    let localCavity = cavitySolid;
    if (p === 0) localCavity = track(track(cavitySolid.rotate(0, -90, 0)).rotate(0, 0, -90));
    if (p === 1) localCavity = track(track(cavitySolid.rotate(90, 0, 0)).rotate(0, 0, 90));
    // The cavity is shape-following (non-convex) and its silhouette can jump
    // discontinuously within the rail's ±railHalfW span (sharp master edges,
    // disjoint islands on flat masters) — sampled sections miss those jumps at
    // ANY fixed step (measured: an 11 cm flat master intruded 3.9 mm³ that
    // extracted clean at 18 cm). The sampled union is approximating the slab's
    // projection, so take the projection exactly: cavity ∩ slab[mid±railHalfW],
    // projected along the pull axis, is the swept max-section the rail prism
    // must clear.
    const slab = track(track(localCavity.trimByPlane([0, 0, 1], frame.mid - K.railHalfW))
      .trimByPlane([0, 0, -1], -(frame.mid + K.railHalfW)));
    const railSection = track(track(outerSection.offset(K.railOffset, 'Round', 2, 32))
      .subtract(track(slab.project().offset(0.2, 'Round', 2, 48))).simplify(1e-4));
    const vertical = UNIT[frame.vert];
    const rail = track(track(track(prismOnPull(railSection, p, frame.mid - K.railHalfW, frame.mid + K.railHalfW))
      .trimByPlane([...vertical], frame.base))
      .trimByPlane(vertical.map(x => -x), -frame.crown));
    // Union without re-cutting the cavity: a second subtract along faces that
    // already coincide re-imprints them as slivers (41-component regression).
    // The rail's inner boundary is wall*0.2 mm outside the outer wall, so it
    // cannot reach the cavity — assert that invariant instead of re-cutting.
    jacket = track(jacket.add(rail));
    const intrusion = track(jacket.intersect(cavitySolid));
    if (intrusion.volume() > 0.01) throw new Error('jacket rim or clamp rails intrude into the silicone cavity');
    let localRail = rail;
    if (v === 0) localRail = track(track(rail.rotate(0, -90, 0)).rotate(0, 0, -90));
    if (v === 1) localRail = track(track(rail.rotate(90, 0, 0)).rotate(0, 0, 90));
    plateOutlineCS = track(plateOutlineCS.add(track(track(localRail.project()).offset(0.3, 'Round', 2, 32))));

    // External stiffening ribs (audit §3): four vertical fins at the quarter
    // positions between the seam rails. Each rib is a loft of thin radial
    // rectangles that follow the envelope's outer surface (the rings are
    // radially resampled from a fixed center, so the surface radius per angle
    // is exact), fused `FUSE` deep into the wall and never closer than 0.5 mm
    // to the cavity — the intrusion guard below stays the authority.
    if (params.ribs) {
      progress('Adding external stiffening ribs', 0.55);
      const RIB_DEPTH = K.ribDepth, RIB_W = K.ribW;
      const mb = bboxOfArrays(master);
      const u3 = (v + 1) % 3, v3 = (v + 2) % 3;
      const cu = mb.min[u3] + mb.dim[u3] / 2, cw = mb.min[v3] + mb.dim[v3] / 2;
      const rayR = (loop: number[][], dx: number, dy: number): number => {
        let bestT = 0;
        for (let i = 0; i < loop.length; i++) {
          const ax = loop[i][0] - cu, ay = loop[i][1] - cw;
          const bx = loop[(i + 1) % loop.length][0] - cu, by = loop[(i + 1) % loop.length][1] - cw;
          const ex = bx - ax, ey = by - ay;
          const den = dx * ey - dy * ex;
          if (Math.abs(den) < 1e-12) continue;
          const t = (ax * ey - ay * ex) / den;
          const uu = (ax * dy - ay * dx) / den;
          if (t > bestT && uu >= -1e-9 && uu <= 1 + 1e-9) bestT = t;
        }
        return bestT;
      };
      for (const deg of [45, 135, 225, 315]) {
        const th = (deg * Math.PI) / 180;
        const dx = Math.cos(th), dy = Math.sin(th);
        const px = -dy, py = dx; // tangential
        const corners: number[][] = [];
        let lastR = 0;
        for (const s of envelope.sections) {
          const loop = s.loops[0];
          if (!loop || loop.length < 3) continue;
          const rCav = rayR(loop, dx, dy) || lastR;
          if (rCav <= 0) continue;
          lastR = rCav;
          // the rib is a flat 2 mm slab — the cavity radius varies across its
          // tangential span, so fuse below the DEEPEST of three rays
          const dth = Math.atan(RIB_W / 2 / Math.max(rCav, 1)) + 0.004;
          const rIn = Math.max(
            rayR(loop, Math.cos(th - dth), Math.sin(th - dth)),
            rCav,
            rayR(loop, Math.cos(th + dth), Math.sin(th + dth)),
          ) + 0.5;
          const rOut = rCav + wall * 1.45 + RIB_DEPTH;
          for (const [t, q] of [[rIn, -RIB_W / 2], [rOut, -RIB_W / 2], [rOut, RIB_W / 2], [rIn, RIB_W / 2]]) {
            corners.push([cu + dx * t + px * q, cw + dy * t + py * q, s.height]);
          }
        }
        if (corners.length < 8) continue;
        const verts: number[] = [], tris: number[] = [];
        for (const c of corners) verts.push(c[0], c[1], c[2]);
        const nR = corners.length / 4;
        for (let k = 0; k < nR - 1; k++) {
          const b = k * 4, t = b + 4;
          for (let j = 0; j < 4; j++) {
            const a = b + j, bb = b + (j + 1) % 4, c = t + (j + 1) % 4, d = t + j;
            tris.push(a, bb, c, a, c, d);
          }
        }
        // side quads run bottom edges CCW / top edges CW — caps must oppose:
        // bottom reversed, top as-triangulated
        const top = (nR - 1) * 4;
        for (const tri of THREE.ShapeUtils.triangulateShape([0, 1, 2, 3].map((j) => new THREE.Vector2(corners[j][0], corners[j][1])), [])) tris.push(tri[2], tri[1], tri[0]);
        for (const tri of THREE.ShapeUtils.triangulateShape([top, top + 1, top + 2, top + 3].map((j) => new THREE.Vector2(corners[j][0], corners[j][1])), [])) tris.push(top + tri[0], top + tri[1], top + tri[2]);
        const ribRot = track(new mod.Manifold(new mod.Mesh({
          numProp: 3,
          vertProperties: Float32Array.from(verts),
          triVerts: Uint32Array.from(tris),
        })));
        if (!isOk(ribRot)) throw new Error('kernel rejected a stiffening rib');
        const rib = track(invRotate(ribRot));
        jacket = track(jacket.add(rib));
      }
      const intrusionR = track(jacket.intersect(cavitySolid));
      if (intrusionR.volume() > 0.01) throw new Error('stiffening ribs intrude into the silicone cavity');
      if (!isOk(jacket)) throw new Error('kernel rejected the ribbed jacket');
    }

    // Elephant-foot relief (audit §13): the bottom 0.5 mm of every bed-contact
    // face steps inward (0.2 then 0.1 mm) so first-layer squish cannot swell
    // the jacket past its seating/mating surfaces. Built as removal rings whose
    // outer boundary sits 0.5 mm in open air — never re-cutting a kept face.
    {
      let jacketV = jacket;
      if (v === 0) jacketV = track(track(jacket.rotate(0, -90, 0)).rotate(0, 0, -90));
      if (v === 1) jacketV = track(track(jacket.rotate(90, 0, 0)).rotate(0, 0, 90));
      const s0 = track(jacketV.slice(frame.base + 0.05));
      const s1 = track(jacketV.slice(frame.base + K.footReliefH * 0.5 + 0.05));
      const cut0CS = track(track(s0.offset(0.5, 'Round', 2, 32))
        .subtract(track(s0.offset(-K.footReliefC, 'Round', 2, 32))).simplify(1e-4));
      const cut1CS = track(track(s1.offset(0.5, 'Round', 2, 32))
        .subtract(track(s1.offset(-K.footReliefC / 2, 'Round', 2, 32))).simplify(1e-4));
      const cut0 = track(prismOnVert(cut0CS, v, frame.base, frame.base + K.footReliefH * 0.5));
      const cut1 = track(prismOnVert(cut1CS, v, frame.base + K.footReliefH * 0.5, frame.base + K.footReliefH));
      jacket = track(track(jacket.subtract(cut0)).subtract(cut1));
      if (!isOk(jacket)) throw new Error('kernel rejected the elephant-foot relief');
    }

    // P7 multi-panel: for a 3-piece build, find which pull side carries the
    // trapping (master verts inside trapped columns). The heavy side must be
    // the sub-split one and the sub-split side always carries the GROOVE
    // (cutting through the tongue would orphan its halves), so when the heavy
    // side is the +axis one the joint roles swap: the −axis half plays the
    // tongue role (machineJoint `flip` mirrors its spans).
    let tongueIsPositive = true;
    if (params.panels === 3) {
      const trap = trappedColumnMask(master, axis, 64);
      const u3t = (p + 1) % 3, v3t = (p + 2) % 3;
      const mbb = bboxOfArrays(master);
      const midP = mbb.min[p] + mbb.dim[p] / 2;
      const vp = master.vertProperties;
      let posCount = 0, negCount = 0;
      const nV = vp.length / 3;
      for (let i = 0; i < nV; i++) {
        const iu = Math.max(0, Math.min(trap.grid - 1, Math.floor(((vp[i * 3 + u3t] - trap.minU) / trap.spanU) * trap.grid)));
        const iv = Math.max(0, Math.min(trap.grid - 1, Math.floor(((vp[i * 3 + v3t] - trap.minV) / trap.spanV) * trap.grid)));
        if (!trap.mask[iv * trap.grid + iu]) continue;
        if (vp[i * 3 + p] >= midP) posCount++; else negCount++;
      }
      tongueIsPositive = posCount <= negCount; // heavy side takes the groove role
      warnings.push(`3-piece: heavy side is ${posCount > negCount ? '+' : '−'}${axis} (${Math.max(posCount, negCount)} of ${posCount + negCount} trapped verts) — sub-splitting it along ±${frame.depth}`);
    }

    progress('Splitting ±' + axis + ' at the mid-plane', 0.5);
    const halfPos = track(jacket.trimByPlane([...pv], frame.mid));
    const halfNeg = track(jacket.trimByPlane([...pv].map((n) => -n), -frame.mid));
    if (halfPos.volume() < 1 || halfNeg.volume() < 1) throw new Error('split produced an empty half');
    const jacketSolidArr = instanceToMeshArrays(jacket);

    progress('Machining tongue, groove and vents', 0.6);
    const jointed = machineJoint(
      { mod, track, ref: jacket, axis, mid: frame.mid, wall, clearance: params.clearance, label: 'main joint', flip: !tongueIsPositive, K },
      tongueIsPositive ? halfPos : halfNeg,
      tongueIsPositive ? halfNeg : halfPos,
    );
    let A = jointed.pos;       // tongue half — slides ±axis per tongueIsPositive
    let B = jointed.neg;       // groove half — the sub-split (heavy) side

    // 3-piece: sub-split the groove half along the depth axis at the master's
    // depth mid-plane. The cut opens the fold channels trapped by the single
    // ±pull pull; each sub-half then slides out sideways.
    let b1: ManifoldInstance | null = null, b2: ManifoldInstance | null = null;
    if (params.panels === 3) {
      progress('Building the third panel (sub-splitting the heavy half)', 0.66);
      const dIdx = AXES.indexOf(frame.depth);
      const db = bboxOfArrays(master);
      const dmid = db.min[dIdx] + db.dim[dIdx] / 2;
      const dv = UNIT[frame.depth];
      const b1raw = track(B.trimByPlane([...dv], dmid));
      const b2raw = track(B.trimByPlane([...dv].map((n) => -n), -dmid));
      if (b1raw.volume() < 1 || b2raw.volume() < 1) throw new Error('3-piece sub-split produced an empty half');
      const bRef = track(b1raw.add(b2raw));
      const subJointed = machineJoint(
        { mod, track, ref: bRef, axis: frame.depth, mid: dmid, wall, clearance: params.clearance, label: 'sub joint', K },
        b1raw, b2raw,
      );
      b1 = subJointed.pos;
      b2 = subJointed.neg;
    }

    let ports: PortsPlan = { crown: null, vents: [], vAx: v, u3: (v + 1) % 3, v3: (v + 2) % 3 };
    if (deps.ports) {
      progress('Placing air vents', 0.68);
      ports = planPorts(grid, { gap, wall, vert: frame.vert, pull: axis, mid: frame.mid, base: frame.base, crown: frame.crown });
      for (const spec of ports.vents) {
        const ownsA = spec.pCoord >= frame.mid;
        const boreCS = track(csCtor.circle(spec.boreR, 24).translate(spec.uPull, spec.vPull));
        const bore = track(prismOnPull(boreCS, p, frame.mid - 200, frame.mid + 200));
        const owner = ownsA ? A : B;
        const out = track(owner.subtract(bore));
        if (!isOk(out)) throw new Error('kernel rejected a vent bore');
        if (ownsA) A = out; else B = out;
      }
    }

    progress('Building the glove and simulating extraction', 0.75);
    const skin = track(cavitySolid!.subtract(masterMan));
    if (!isOk(skin)) throw new Error('kernel rejected the silicone glove');
    const siliconeMl = skin.volume() / 1000;
    progress('Cleaning up printable halves', 0.78);

    A = printable(A, 'Jacket A'); B = printable(B, 'Jacket B');
    const aArr = instanceToMeshArrays(A);
    const bArr = instanceToMeshArrays(B);
    const skinArr = instanceToMeshArrays(skin);
    let b1Arr: MeshArrays | null = null, b2Arr: MeshArrays | null = null;
    if (b1 && b2) {
      b1 = printable(b1, 'Jacket B1'); b2 = printable(b2, 'Jacket B2');
      b1Arr = instanceToMeshArrays(b1);
      b2Arr = instanceToMeshArrays(b2);
    }
    progress('Building the contoured base plate', 0.8);
    const plateBlank = track(prismOnVert(plateOutlineCS, v, frame.base - K.plateT, frame.base));
    let localMaster = masterMan;
    if (v === 0) localMaster = track(track(masterMan.rotate(0, -90, 0)).rotate(0, 0, -90));
    if (v === 1) localMaster = track(track(masterMan.rotate(90, 0, 0)).rotate(0, 0, 90));
    // A small buried foot creates a volumetric master/base connection, without
    // lifting the whole plate through the jacket's seating surface.
    const footCS = track(localMaster.slice(frame.base + 0.3));
    const foot = track(prismOnVert(footCS, v, frame.base - 0.01, frame.base + 0.31));
    const plate = printable(track(plateBlank.add(foot)), 'Base plate');
    if (!isOk(plate)) throw new Error('kernel rejected the base plate');
    const plateArr = instanceToMeshArrays(plate);

    progress('Simulating the release path', 0.84);
    // Rigid-release semantics, matching the commercial systems: the jacket
    // half slides against the FLEXIBLE cured silicone, which conforms and
    // compresses locally — the silicone is not a rigid obstruction. The rigid
    // obstructions are the MASTER (the glove cannot pass through it), the
    // base plate (coplanar sliding contact with the seat, never penetrated)
    // and any jacket panel STILL INSTALLED at that removal stage — assembly
    // order is A off first, then B (or B1/B2) one at a time. Master demolding
    // from cured silicone is flexible-material territory and is reported
    // separately (siliconeDemold), never implied by a rigid pass.
    const masterArr = instanceToMeshArrays(masterMan);
    const outside = track(masterMan.subtract(cavitySolid));
    if (outside.volume() > 0.02) throw new Error('The cavity does not fully contain the master');
    // Report the overlap VOLUME per target: the extraction sim fails on
    // PRESSING-IN (non-decreasing penetration = the half jams against the
    // obstruction), not on thin construction sheets whose contact decays as
    // the half slides away.
    const collidesOn = (piece: ManifoldInstance, dirVec: number[], targets: ManifoldInstance[]) =>
      (distance: number, targetIndex: number) => {
        const moved = piece.translate(dirVec[0] * distance, dirVec[1] * distance, dirVec[2] * distance);
        const overlap = moved.intersect(targets[targetIndex]);
        try { return Math.max(0, overlap.volume()); } finally { overlap.delete(); moved.delete(); }
      };
    const aDir = (tongueIsPositive ? 1 : -1) as 1 | -1;
    let exA: ExtractionResult;
    let exB: ExtractionResult | null = null, exB1: ExtractionResult | null = null, exB2: ExtractionResult | null = null;
    const threePiece = !!(b1 && b2 && b1Arr && b2Arr);
    if (!threePiece) {
      exA = simulate(aArr, [masterArr, plateArr, bArr], axis, aDir, travelFor(master, aArr),
        collidesOn(A, UNIT[axis].map((n) => n * aDir), [masterMan, plate, B]),
        ['master', 'base plate', 'jacket B']);
      progress('Simulating the release path (half B)', 0.88);
      const bDir = -aDir as 1 | -1;
      exB = simulate(bArr, [masterArr, plateArr], axis, bDir, travelFor(master, bArr),
        collidesOn(B, UNIT[axis].map((n) => n * bDir), [masterMan, plate]),
        ['master', 'base plate']);
    } else {
      const B1 = b1 as ManifoldInstance, B2 = b2 as ManifoldInstance;
      const b1a = b1Arr as MeshArrays, b2a = b2Arr as MeshArrays;
      exA = simulate(aArr, [masterArr, plateArr, b1a, b2a], axis, aDir, travelFor(master, aArr),
        collidesOn(A, UNIT[axis].map((n) => n * aDir), [masterMan, plate, B1, B2]),
        ['master', 'base plate', 'jacket B1', 'jacket B2']);
      progress('Simulating the release path (sub-panels B1/B2)', 0.88);
      exB1 = simulate(b1a, [masterArr, plateArr, b2a], frame.depth, 1, travelFor(master, b1a),
        collidesOn(B1, UNIT[frame.depth], [masterMan, plate, B2]),
        ['master', 'base plate', 'jacket B2']);
      exB2 = simulate(b2a, [masterArr, plateArr, b1a], frame.depth, -1, travelFor(master, b2a),
        collidesOn(B2, UNIT[frame.depth].map((n) => -n), [masterMan, plate, B1]),
        ['master', 'base plate', 'jacket B1']);
    }

    const ob = bboxOfArrays(jacketSolidArr);
    const jacketDim = [ob.dim[0], ob.dim[1], ob.dim[2]] as [number, number, number];
    const pb = bboxOfArrays(plateArr);
    const plateDim = [pb.dim[0], pb.dim[1], pb.dim[2]] as [number, number, number];
    if (Math.max(...jacketDim) + 20 > 250) warnings.push(`jacket ≈ ${jacketDim.map((d) => d.toFixed(0)).join('×')} mm — check printer bed`);
    if (Math.max(...plateDim) > 250) warnings.push(`base plate ≈ ${plateDim.map((d) => d.toFixed(0)).join('×')} mm — may exceed the bed`);

    return {
      axis,
      frame,
      pieces: {
        jacketA: aArr, jacketB: bArr, basePlate: plateArr, skin: skinArr, jacketSolid: jacketSolidArr,
        ...(b1Arr && b2Arr ? { jacketB1: b1Arr, jacketB2: b2Arr } : {}),
      },
      extraction: { A: exA, B: exB, B1: exB1, B2: exB2 },
      siliconeDemold: {
        status: 'unverified',
        note: 'Rigid jacket release is simulated; pulling the master out of the cured silicone (stretch, tear, cut path) is a separate flexible-material review and is NOT certified by this release check.',
      },
      panels: b1Arr ? 3 : 2,
      jacketDim,
      plateDim,
      plateT: K.plateT,
      ports,
      siliconeMl,
      cavityLoops,
      cavitySections: envelope.sections,
      cavity: instanceToMeshArrays(cavitySolid),
      warnings,
    };
  } finally {
    for (const x of junk) {
      try { x.delete(); } catch { /* already freed */ }
    }
  }
}

function travelFor(master: MeshArrays, piece: MeshArrays): number {
  return Math.max(...bboxOfArrays(master).dim) + Math.max(...bboxOfArrays(piece).dim) + 10;
}

/** Slide `piece` along ±axis using feature-aware steps; pass only after a clear path.
 *  A numeric collision callback reports overlap volume in mm³ per target index.
 *  Any meaningful overlap blocks release, even when the piece later moves clear;
 *  a failed step names the obstacle via `targetNames`. */
export function simulate(
  piece: MeshArrays, targets: MeshArrays[], axis: Axis, dir: 1 | -1, travel: number,
  solidCollision?: (distance: number, targetIndex: number) => number | boolean,
  targetNames?: string[],
): ExtractionResult {
  const fail = (t: number, b: number): ExtractionResult =>
    ({ pass: false, freeAtMm: t, obstacle: targetNames?.[b] ?? `target ${b}` });
  const mkGeom = (m: MeshArrays) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.vertProperties, 3));
    g.setIndex(new THREE.BufferAttribute(m.triVerts, 1));
    return g;
  };
  const pieceGeom = mkGeom(piece);
  // intersectsGeometry() dual-traverses only when the other geometry carries a
  // boundsTree — this version never assigns it in the MeshBVH constructor, so
  // set it explicitly on both sides or every step brute-forces all triangles.
  pieceGeom.boundsTree = new MeshBVH(pieceGeom);

  const targetBvhs = targets.map((t) => {
    const g = mkGeom(t);
    const bvh = new MeshBVH(g);
    g.boundsTree = bvh;
    return bvh;
  });
  const d = UNIT[axis].map((n) => n * dir) as [number, number, number];
  const p = AXES.indexOf(axis), pb = bboxOfArrays(piece);
  const bounds = targets.map(bboxOfArrays);
  const narrowest = Math.min(pb.dim[p], ...bounds.map((b) => b.dim[p]));
  // Features below this resolution cannot be certified by a sampled sweep.
  const step = Math.min(0.5, narrowest / 2);
  try {
    if (narrowest < 0.02) return { pass: false, freeAtMm: 0 };
    for (let t = Math.min(0.05, step / 2); t <= travel + step; t += step) {
      // A swept AABB is a conservative broad phase; only possible contacts
      // receive the expensive volumetric test or legacy surface test.
      let candidateOverlap = false;
      for (let b = 0; b < targetBvhs.length; b++) {
        const bb = bounds[b];
        let overlap = true;
        for (let a = 0; a < 3 && overlap; a++) {
          const shift = d[a] * t;
          const pmin = pb.min[a] + Math.min(shift, 0), pmax = pb.min[a] + pb.dim[a] + Math.max(shift, 0);
          overlap = pmax > bb.min[a] + 0.01 && pmin < bb.min[a] + bb.dim[a] - 0.01;
        }
        if (overlap) {
          candidateOverlap = true;
          if (!solidCollision && targetBvhs[b].intersectsGeometry(pieceGeom, new THREE.Matrix4().makeTranslation(d[0] * t, d[1] * t, d[2] * t))) {
            return fail(t, b);
          }
        }
      }
      // A surface-only BVH test misses one solid fully contained by another.
      // The volumetric callback must run for every broad-phase candidate.
      if (candidateOverlap && solidCollision) {
        for (let b = 0; b < targetBvhs.length; b++) {
          const bb = bounds[b];
          let overlap = true;
          for (let a = 0; a < 3 && overlap; a++) {
            const shift = d[a] * t;
            const pmin = pb.min[a] + Math.min(shift, 0), pmax = pb.min[a] + pb.dim[a] + Math.max(shift, 0);
            overlap = pmax > bb.min[a] + 0.01 && pmin < bb.min[a] + bb.dim[a] - 0.01;
          }
          if (!overlap) continue;
          const r = solidCollision(t, b);
          if (typeof r === 'boolean' ? r : r >= 0.5) return fail(t, b);
        }
      }
      const separated = bounds.every(b => dir === 1
        ? pb.min[p] + t > b.min[p] + b.dim[p] + 0.01
        : pb.min[p] + pb.dim[p] - t < b.min[p] - 0.01);
      if (separated) return { pass: true, freeAtMm: Number(t.toFixed(2)) };
    }
    return { pass: false, freeAtMm: travel };
  } finally {
    pieceGeom.dispose();
    for (const bvh of targetBvhs) bvh.geometry.dispose();
  }
}

export interface MoldPackage {
  axis: Axis;
  frame: MoldFrame;
  pieces: MoldPieces;
  extraction: { A: ExtractionResult; B: ExtractionResult | null; B1?: ExtractionResult | null; B2?: ExtractionResult | null };
  siliconeDemold: SiliconeDemold;
  panels: 2 | 3;
  jacketDim: [number, number, number];
  plateDim: [number, number, number];
  plateT: number;
  ports: PortsPlan;
  siliconeMl: number;
  cavityLoops: Loops;
  cavitySections: { height: number; loops: Loops }[];
  warnings: string[];
  failedAxes: { axis: Axis; reason: string }[];
}

/** Master demolding from the cured silicone is a FLEXIBLE-material problem
 *  (stretch, tear, cut path) that a rigid-body release sim cannot certify.
 *  Carried explicitly so no consumer can read rigid release as silicone release. */
export interface SiliconeDemold {
  status: 'unverified';
  note: string;
}

const extractionPass = (e: { A: ExtractionResult; B: ExtractionResult | null; B1?: ExtractionResult | null; B2?: ExtractionResult | null }): boolean =>
  e.A.pass && (e.B ? e.B.pass : (e.B1?.pass ?? false) && (e.B2?.pass ?? false));
const extractionFailText = (e: { A: ExtractionResult; B: ExtractionResult | null; B1?: ExtractionResult | null; B2?: ExtractionResult | null }): string => {
  const part = (name: string, r: ExtractionResult | null | undefined): string =>
    r ? `${name} ${r.pass ? '✓' : '✗'}@${r.freeAtMm}mm${!r.pass && r.obstacle ? `→${r.obstacle}` : ''}` : `${name} —`;
  return `extraction failed (${part('A', e.A)}, ${part('B', e.B)}, ${part('B1', e.B1)}, ${part('B2', e.B2)})`;
};

/** Ranked auto-retry ladder (policy: wayfinder T003). When every 2-piece
 *  candidate fails, the best axis is retried once as a 3-piece (multi-panel)
 *  build before giving up. */
export async function generateMoldPackage(deps: {
  mod: ManifoldMod;
  master: MeshArrays;
  grid: SdfGrid;
  params: GenerateParams;
  rankedAxes: Axis[];
  ports?: boolean;
  onProgress?: (stage: string, pct: number) => void;
}): Promise<MoldPackage | null> {
  const failedAxes: { axis: Axis; reason: string }[] = [];
  // Explicit split axis overrides the ranking ladder entirely.
  const ranked: Axis[] = deps.params.splitAxis ? [deps.params.splitAxis] : deps.rankedAxes;
  for (let i = 0; i < ranked.length; i++) {
    const axis = ranked[i];
    deps.onProgress?.(`Splitting along ±${axis} (candidate ${i + 1}/${ranked.length})`, (i / ranked.length) * 0.05);
    try {
      const attempt = await buildMoldForAxis({
        mod: deps.mod, master: deps.master,
        grid: deps.grid, params: deps.params, axis, ports: deps.ports, onProgress: deps.onProgress,
      });
      if (extractionPass(attempt.extraction)) {
        return { ...attempt, failedAxes };
      }
      failedAxes.push({ axis, reason: extractionFailText(attempt.extraction) });
    } catch (err) {
      failedAxes.push({ axis, reason: err instanceof Error ? err.message : String(err) });
    }
    deps.onProgress?.(`Rejected ±${axis}: ${failedAxes[failedAxes.length - 1].reason}`, (i + 1) / ranked.length);
  }
  // 2-piece exhausted: one 3-piece retry on the highest-ranked axis.
  if (deps.params.panels !== 3 && ranked.length > 0) {
    const axis = ranked[0];
    deps.onProgress?.(`No 2-piece split extracted — retrying ±${axis} as a 3-piece jacket`, 0.05);
    try {
      const attempt = await buildMoldForAxis({
        mod: deps.mod, master: deps.master,
        grid: deps.grid, params: { ...deps.params, panels: 3 }, axis, ports: deps.ports, onProgress: deps.onProgress,
      });
      if (extractionPass(attempt.extraction)) {
        return { ...attempt, failedAxes };
      }
      failedAxes.push({ axis: axis as Axis, reason: `3-piece ${extractionFailText(attempt.extraction)}` });
    } catch (err) {
      failedAxes.push({ axis: axis as Axis, reason: `3-piece: ${err instanceof Error ? err.message : String(err)}` });
    }
  }
  return null;
}

