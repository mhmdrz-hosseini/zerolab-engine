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
import { type Loops } from './contours';
import { buildEnvelope } from './envelope';
import { instanceToMeshArrays } from './offset';
import type { SdfGrid } from './offset';
import { planPorts, type PortsPlan } from './ports';
import type { ManifoldInstance, ManifoldMod } from './manifoldLoader';
import type { Axis, GenerateParams, MeshArrays } from './types';

const UNIT: Record<Axis, [number, number, number]> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
const AXES: Axis[] = ['X', 'Y', 'Z'];

// reference-derived constants (Cute Sheep measurements, docs §1/§4)
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
      crown: bb.min[vi] + bb.dim[vi] + V02.freeboard,
    };
  }
  // stable-base rule: the mold stands on the rest axis whose extreme slice
  // carries the most resting surface, like the commercial systems standing
  // figures on their feet. Triangle-AREA weighted: vertex counting flips when
  // tessellation density differs between faces (a subdivided base wins on
  // vertex count while a flat coarse face holds the real footprint).
  const vp = master.vertProperties, tv = master.triVerts;
  const contact = (a: number): number => {
    const thr = bb.min[a] + Math.max(2, bb.dim[a] * 0.02);
    let area = 0;
    for (let t = 0; t < tv.length; t += 3) {
      const i0 = tv[t] * 3, i1 = tv[t + 1] * 3, i2 = tv[t + 2] * 3;
      const ca = (vp[i0 + a] + vp[i1 + a] + vp[i2 + a]) / 3;
      if (ca > thr) continue;
      const ux = vp[i1] - vp[i0], uy = vp[i1 + 1] - vp[i0 + 1], uz = vp[i1 + 2] - vp[i0 + 2];
      const wx = vp[i2] - vp[i0], wy = vp[i2 + 1] - vp[i0 + 1], wz = vp[i2 + 2] - vp[i0 + 2];
      area += 0.5 * Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx);
    }
    return area;
  };
  const a0 = contact(rest[0]), a1 = contact(rest[1]);
  const v = a0 >= a1 ? rest[0] : rest[1];
  const d = rest.find((a) => a !== v)!;
  return {
    pull,
    vert: AXES[v],
    depth: AXES[d],
    base: bb.min[v],
    mid: bb.min[p] + bb.dim[p] / 2,
    crown: bb.min[v] + bb.dim[v] + V02.freeboard,
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

function isOk(inst: ManifoldInstance): boolean {
  const st = inst.status();
  const v = typeof st === 'object' && st !== null ? (st as { code?: number | string }).code : st;
  return v === 'NoError' || v === 0 || v === 'Ok';
}

export interface ExtractionResult { pass: boolean; freeAtMm: number }
export interface MoldPieces {
  jacketA: MeshArrays;
  jacketB: MeshArrays;
  basePlate: MeshArrays;
  skin: MeshArrays;      // the glove: cavity prism − master (silicone fill preview)
  jacketSolid: MeshArrays; // pre-split jacket (viewer "outer" layer)
}

export interface AxisAttempt {
  axis: Axis;
  frame: MoldFrame;
  pieces: MoldPieces;
  extraction: { A: ExtractionResult; B: ExtractionResult };
  jacketDim: [number, number, number];
  plateDim: [number, number, number];
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
    const pv = UNIT[axis];
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
    const envelope = buildEnvelope(mod, master, masterRot, invRotate, frame, gap, wall);
    const cavitySolid = track(envelope.cavity), outerSolid = track(envelope.outer);
    if (!isOk(cavitySolid) || !isOk(outerSolid)) throw new Error('Kernel rejected the envelope loft');
    const footprintCS = track(csCtor.ofPolygons(envelope.footprint as number[][][], 'EvenOdd'));
    const widestCS = track(csCtor.ofPolygons(envelope.widest as number[][][], 'EvenOdd'));
    let plateOutlineCS = track(track(footprintCS.offset(V02.plateMargin, 'Round', 2, 48))
      .add(track(widestCS.offset(wall * 1.2 + 2, 'Round', 2, 48))));
    const cavityLoops = envelope.widest;
    // Shell first: the cavity lies strictly inside the outer loft, so this cut
    // has no coincident faces. The old (outer+rimSlab)−cavity order re-cut
    // faces that already coincide and imprinted them as inverted slivers.
    let jacket = track(outerSolid.subtract(cavitySolid));
    // Seating rim, built as a 2D ring: plate outline minus the widest cavity
    // profile within the rim band (⊕0.05 keeps every face strictly inside the
    // wall). Same geometry as the old slab-minus-cavity, without the re-cut.
    const bandCS = track(csCtor.ofPolygons(envelope.sections[0].loops as number[][][], 'EvenOdd')) as CS;
    let band = bandCS;
    for (let k = 1; k < envelope.sections.length; k++) {
      if (envelope.sections[k].height > frame.base + V02.rimH) break;
      band = track(band.add(csCtor.ofPolygons(envelope.sections[k].loops as number[][][], 'EvenOdd')));
    }
    const rimCS = track(track(plateOutlineCS.offset(-0.3, 'Round', 2, 48))
      .subtract(track(band.offset(0.05, 'Round', 2, 48))).simplify(1e-4));
    const rimBlock = track(prismOnVert(rimCS, v, frame.base, frame.base + V02.rimH));
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
    // The cavity is shape-following (non-convex), so chords inside the rail's
    // ±2.5 mm span are NOT nested — union them so the rail clears the cavity
    // over its whole span, then keep the 0.2 mm weld margin.
    let cavitySection = track(localCavity.slice(frame.mid));
    for (const d of [-2.5, 2.5]) {
      const s = track(localCavity.slice(frame.mid + d));
      if (s.area() > 1e-6) cavitySection = track(cavitySection.add(s));
    }
    const railSection = track(track(outerSection.offset(7, 'Round', 2, 32))
      .subtract(track(cavitySection.offset(0.2, 'Round', 2, 48))).simplify(1e-4));
    const vertical = UNIT[frame.vert];
    const rail = track(track(track(prismOnPull(railSection, p, frame.mid - 2.5, frame.mid + 2.5))
      .trimByPlane([...vertical], frame.base))
      .trimByPlane(vertical.map(x => -x), -frame.crown));
    // Union without re-cutting the cavity: a second subtract along faces that
    // already coincide re-imprints them as slivers (41-component regression).
    // The rail's inner boundary is wall*0.2 mm outside the outer wall, so it
    // cannot reach the cavity — assert that invariant instead of re-cutting.
    jacket = track(jacket.add(rail));
    const intrusion = track(jacket.intersect(cavitySolid));
    if (intrusion.volume() > 0.01) throw new Error('clamp rails intrude into the silicone cavity');
    let localRail = rail;
    if (v === 0) localRail = track(track(rail.rotate(0, -90, 0)).rotate(0, 0, -90));
    if (v === 1) localRail = track(track(rail.rotate(90, 0, 0)).rotate(0, 0, 90));
    plateOutlineCS = track(plateOutlineCS.add(track(track(localRail.project()).offset(0.3, 'Round', 2, 32))));

    // Elephant-foot relief (audit §13): the bottom 0.5 mm of every bed-contact
    // face steps inward (0.2 then 0.1 mm) so first-layer squish cannot swell
    // the jacket past its seating/mating surfaces. Built as removal rings whose
    // outer boundary sits 0.5 mm in open air — never re-cutting a kept face.
    {
      let jacketV = jacket;
      if (v === 0) jacketV = track(track(jacket.rotate(0, -90, 0)).rotate(0, 0, -90));
      if (v === 1) jacketV = track(track(jacket.rotate(90, 0, 0)).rotate(0, 0, 90));
      const s0 = track(jacketV.slice(frame.base + 0.05));
      const s1 = track(jacketV.slice(frame.base + V02.footReliefH * 0.5 + 0.05));
      const cut0CS = track(track(s0.offset(0.5, 'Round', 2, 32))
        .subtract(track(s0.offset(-V02.footReliefC, 'Round', 2, 32))).simplify(1e-4));
      const cut1CS = track(track(s1.offset(0.5, 'Round', 2, 32))
        .subtract(track(s1.offset(-V02.footReliefC / 2, 'Round', 2, 32))).simplify(1e-4));
      const cut0 = track(prismOnVert(cut0CS, v, frame.base, frame.base + V02.footReliefH * 0.5));
      const cut1 = track(prismOnVert(cut1CS, v, frame.base + V02.footReliefH * 0.5, frame.base + V02.footReliefH));
      jacket = track(track(jacket.subtract(cut0)).subtract(cut1));
      if (!isOk(jacket)) throw new Error('kernel rejected the elephant-foot relief');
    }

    progress('Splitting ±' + axis + ' at the mid-plane', 0.5);
    const halfA = track(jacket.trimByPlane([...pv], frame.mid));
    const halfB = track(jacket.trimByPlane([...pv].map((n) => -n), -frame.mid));
    if (halfA.volume() < 1 || halfB.volume() < 1) throw new Error('split produced an empty half');
    const jacketSolidArr = instanceToMeshArrays(jacket);

    progress('Machining tongue, groove and vents', 0.6);
    // Take the REAL wall section at the split: no origin/symmetry assumptions.
    let localJacket = jacket;
    if (p === 0) localJacket = track(track(jacket.rotate(0, -90, 0)).rotate(0, 0, -90));
    if (p === 1) localJacket = track(track(jacket.rotate(90, 0, 0)).rotate(0, 0, 90));
    const seam = track(localJacket.slice(frame.mid));
    const inset = Math.max(0.65, wall * 0.28);
    const depth = Math.min(V02.tongue, wall * 0.65);
    const tongueCS = track(seam.offset(-inset, 'Round', 2, 32).simplify(1e-4));
    // Stepped tip taper (audit §12): the last `tipTaper` mm of the lip shrink
    // in two 0.08 mm steps so the tongue finds the flared groove mouth instead
    // of butting against it. Rings that pinch empty on thin walls are skipped.
    const tipH = Math.min(V02.tipTaper, depth * 0.45);
    const tipHighCS = track(tongueCS.offset(-0.08, 'Round', 2, 32).simplify(1e-4));
    const tipLowCS = track(tongueCS.offset(-0.16, 'Round', 2, 32).simplify(1e-4));
    const mainTongue = track(prismOnPull(tongueCS, p, frame.mid - depth + tipH, frame.mid + 0.2));
    let tongue = mainTongue;
    if (tipHighCS.area() > 1e-6) {
      tongue = track(tongue.add(track(prismOnPull(tipHighCS, p, frame.mid - depth + tipH * 0.5, frame.mid - depth + tipH))));
    }
    if (tipLowCS.area() > 1e-6) {
      tongue = track(tongue.add(track(prismOnPull(tipLowCS, p, frame.mid - depth, frame.mid - depth + tipH * 0.5))));
    }
    const grooveCS = track(tongueCS.offset(params.clearance, 'Round', 2, 32).simplify(1e-4));
    const groove = track(prismOnPull(grooveCS, p, frame.mid - depth - params.clearance, frame.mid + 0.01));
    // Lead-in flare (audit §12): the groove mouth widens for the first
    // `leadDepth` mm. Kept strictly inside the wall section (never re-cutting
    // the cavity face): flare ≤ inset − clearance − 0.1.
    const flare = Math.min(V02.leadFlare, Math.max(0, inset - params.clearance - 0.1));
    const flareCS = track(tongueCS.offset(params.clearance + flare, 'Round', 2, 32).simplify(1e-4));
    const flarePrism = track(prismOnPull(flareCS, p, frame.mid - Math.min(V02.leadDepth, depth * 0.6), frame.mid + 0.01));
    if (tongue.volume() < 0.1) throw new Error('Joint is empty: increase the wall thickness');
    let A = track(halfA.add(tongue));
    let B = track(halfB.subtract(groove));
    B = track(B.subtract(flarePrism));
    if (!isOk(A) || !isOk(B)) throw new Error('Kernel rejected the tongue/groove features');
    const overlap = track(A.intersect(B));
    if (overlap.volume() > 0.01) throw new Error('Joint halves interfere');

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
    progress('Simulating the release path', 0.82);
    // Rigid-release semantics, matching the commercial systems: the jacket
    // half slides against the FLEXIBLE cured silicone, which conforms and
    // compresses locally — the silicone is not a rigid obstruction. The rigid
    // obstructions are the MASTER (the glove cannot pass through it) and the
    // base plate (coplanar sliding contact with the seat, never penetrated).
    // A per-slice-dilated cavity always clears the master along the split
    // normal, so failures here indicate real construction defects or blocked
    // geometry, not silicone contact.
    const masterArr = instanceToMeshArrays(masterMan);
    const outside = track(masterMan.subtract(cavitySolid));
    if (outside.volume() > 0.02) throw new Error('The cavity does not fully contain the master');
    // Report the overlap VOLUME: the extraction sim fails on PRESSING-IN
    // (non-decreasing penetration = the half jams against the master), not on
    // thin construction sheets whose contact decays as the half slides away.
    const collides = (piece: ManifoldInstance, dir: number) => (distance: number) => {
      const moved = piece.translate(pv[0] * dir * distance, pv[1] * dir * distance, pv[2] * dir * distance);
      const overlap = moved.intersect(masterMan);
      try { return Math.max(0, overlap.volume()); } finally { overlap.delete(); moved.delete(); }
    };
    const exA = simulate(aArr, [masterArr], axis, 1, travelFor(master, aArr), collides(A, 1));
    progress('Simulating the release path (half B)', 0.86);
    const exB = simulate(bArr, [masterArr], axis, -1, travelFor(master, bArr), collides(B, -1));

    progress('Building the contoured base plate', 0.9);
    const plateBlank = track(prismOnVert(plateOutlineCS, v, frame.base - V02.plateT, frame.base));
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

    const ob = bboxOfArrays(jacketSolidArr);
    const jacketDim = [ob.dim[0], ob.dim[1], ob.dim[2]] as [number, number, number];
    const pb = bboxOfArrays(plateArr);
    const plateDim = [pb.dim[0], pb.dim[1], pb.dim[2]] as [number, number, number];
    if (Math.max(...jacketDim) + 20 > 250) warnings.push(`jacket ≈ ${jacketDim.map((d) => d.toFixed(0)).join('×')} mm — check printer bed`);
    if (Math.max(...plateDim) > 250) warnings.push(`base plate ≈ ${plateDim.map((d) => d.toFixed(0)).join('×')} mm — may exceed the bed`);

    return {
      axis,
      frame,
      pieces: { jacketA: aArr, jacketB: bArr, basePlate: plateArr, skin: skinArr, jacketSolid: jacketSolidArr },
      extraction: { A: exA, B: exB },
      jacketDim,
      plateDim,
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

/** Slide `piece` along ±axis in 0.5 mm steps; pass when it stops overlapping all targets.
 *  solidCollision may return a boolean (legacy) or the overlap volume in mm³ —
 *  a numeric result fails only when penetration is ≥ 0.5 mm³ AND non-decreasing
 *  (pressing in), so thin decaying construction sheets don't block the ladder. */
export function simulate(
  piece: MeshArrays, targets: MeshArrays[], axis: Axis, dir: 1 | -1, travel: number,
  solidCollision?: (distance: number) => number | boolean,
): ExtractionResult {
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
  const step = 0.5;
  const d = UNIT[axis].map((n) => n * dir) as [number, number, number];
  const p = AXES.indexOf(axis), pb = bboxOfArrays(piece);
  const bounds = targets.map(bboxOfArrays);
  try {
    for (let t = 0.05; t <= travel + step; t += step) {
      // Per-step AABB early-out: the exact BVH test only runs while the moved
      // piece's box still overlaps a target's box — sliding away from contact
      // must not pay the near-coplanar tri-tri cost at every step.
      let hit = false;
      let prevR = Infinity;
      for (let b = 0; b < targetBvhs.length; b++) {
        const bb = bounds[b];
        let overlap = true;
        for (let a = 0; a < 3 && overlap; a++) {
          const shift = d[a] * t;
          const pmin = pb.min[a] + Math.min(shift, 0), pmax = pb.min[a] + pb.dim[a] + Math.max(shift, 0);
          overlap = pmax > bb.min[a] + 0.01 && pmin < bb.min[a] + bb.dim[a] - 0.01;
        }
        if (overlap && targetBvhs[b].intersectsGeometry(pieceGeom, new THREE.Matrix4().makeTranslation(d[0] * t, d[1] * t, d[2] * t))) { hit = true; break; }
      }
      if (hit) {
        if (!solidCollision) return { pass: false, freeAtMm: t };
        const r = solidCollision(t);
        if (typeof r === 'boolean') {
          if (r) return { pass: false, freeAtMm: t };
        } else {
          // pressing-in test: penetration ≥ 0.5 mm³ and not decaying
          if (r >= 0.5 && r >= prevR) return { pass: false, freeAtMm: t };
          prevR = r;
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
  extraction: { A: ExtractionResult; B: ExtractionResult };
  jacketDim: [number, number, number];
  plateDim: [number, number, number];
  ports: PortsPlan;
  siliconeMl: number;
  cavityLoops: Loops;
  cavitySections: { height: number; loops: Loops }[];
  warnings: string[];
  failedAxes: { axis: Axis; reason: string }[];
}

/** Ranked auto-retry ladder (policy: wayfinder T003). */
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
      if (attempt.extraction.A.pass && attempt.extraction.B.pass) {
        return { ...attempt, failedAxes };
      }
      failedAxes.push({ axis, reason: `extraction failed (A ${attempt.extraction.A.pass ? '✓' : '✗'} at ${attempt.extraction.A.freeAtMm}mm, B ${attempt.extraction.B.pass ? '✓' : '✗'} at ${attempt.extraction.B.freeAtMm}mm)` });
    } catch (err) {
      failedAxes.push({ axis, reason: err instanceof Error ? err.message : String(err) });
    }
    deps.onProgress?.(`Rejected ±${axis}: ${failedAxes[failedAxes.length - 1].reason}`, (i + 1) / ranked.length);
  }
  return null;
}

