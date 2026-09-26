// BaseLock — V0.5 P1 (docs/MFG_RELIABILITY_V0.5.md): optional two-piece
// collar that vertically captures the jacket rim to the base plate. The
// jacket/plate geometry is untouched (frozen); the collar is an L-profile
// ring built entirely from the plate outline and the jacket's own silhouette:
//
//   floor flange  [outline−3.5, outline+6] × z [base−7.6, base−4.6]
//                 — hooks under the 4 mm plate edge with a 0.6 mm assembly
//                 slide gap under the plate bottom
//   outer wall    [outline+0.8, outline+6] × z [base−7.6, base+4.6]
//                 — 0.8 mm radial slide clearance past the plate edge
//   top cap       [lipInner, outline+6] × z [base+3.6, base+4.6]
//                 — its inner edge (the LIP) overhangs the jacket rim top
//                 (base+3); lipInner = the assembled jacket's outer
//                 silhouette at the cap's top height ⊕ 0.6 — slicing the
//                 post-rail jacket means the seam rail's own ±depth bulges
//                 are honored, and the envelope ratchet (which only widens
//                 upward) cannot flare past the slice at the cap top.
//
// Vertical capture is mutual: the plate/master lifts ≤0.6 mm into the flange
// gap; the collar cannot rise (its flange meets the plate bottom, reacting
// through the table); the jacket rim cannot lift past the cap lip. The 0.6 mm
// figures ARE the assembly slide clearances — capture ≤ clearance is
// unavoidable for slide-in assembly, and the fit coupon (§39) owns whether
// 0.6 mm is tight enough in practice.
//
// The halves split on the ±pull plane and slide in laterally. Each half owns
// ONE ear at opposite ±depth extremes (so the crossing slabs can never meet):
// an L-shaped tab — a 5 mm-thick slab on the wall's outer face extending
// 10 mm across the seam, fused back into its own half through a neck. A mini
// ZeroClip (12 mm) straddles each slab at the seam, tying the halves against
// ±pull slide-out. Prints TOP-RING-DOWN: every face is a vertical wall or a
// horizontal bed; no supports, no chamfers needed.
import { AXES } from './types';
import type { Axis, ClampStation } from './types';
import type { CS, MoldFrame } from './split';
import { prismOnVert } from './split';
import { buildZeroClip } from './clamps';
import type { ManifoldInstance } from './manifoldLoader';

export const BASELOCK = {
  plateClearMm: 0.6,     // assembly gap under the plate bottom (= vertical capture travel)
  wallClearMm: 0.8,      // radial slide clearance past the plate edge
  wallWidMm: 6,          // collar wall width outward of the plate outline
  hookEngageMm: 3,       // flange reach inward under the plate edge
  lipH: 1,               // cap/lip height
  tabWidMm: 3.2,         // ear-slab width outside the wall's outer face
  tabCrossMm: 10,        // ear-slab reach across the seam
  tabFuseMm: 3,          // ear fusion length inside its own half
  clipWidthMm: 12,       // mini ZeroClip width
};

type Track = <T extends { delete(): void }>(x: T) => T;

export interface BaseLockBuild {
  halfA: ManifoldInstance;       // +pull half
  halfB: ManifoldInstance;       // −pull half
  clip: ManifoldInstance | null; // mini ZeroClip geometry (identical ×2)
  clipCount: number;
}

/** Rotate a world-coordinate solid into the vert-frame (vert axis → +Z),
 *  matching split.ts's slicing convention. */
function toVertFrame(m: ManifoldInstance, track: Track, v: number): ManifoldInstance {
  if (v === 2) return m;
  if (v === 1) return track(track(m.rotate(90, 0, 0)).rotate(0, 0, 90));
  return track(track(m.rotate(0, -90, 0)).rotate(0, 0, -90));
}

export function buildBaseLock(deps: {
  track: Track;
  csCtor: { ofPolygons(poly: number[][][], fillRule?: string): CS };
  outline: CS;                    // plate outline, vert-frame 2D
  jacket: ManifoldInstance;       // assembled jacket (rail included), WORLD coordinates
  frame: MoldFrame;
  axis: Axis;                     // pull axis
}): BaseLockBuild {
  const { track, csCtor, outline, jacket, frame, axis } = deps;
  const v = AXES.indexOf(frame.vert);
  const p = AXES.indexOf(axis);
  const u3 = (v + 1) % 3;
  const pullIsU3 = u3 === p;
  const { plateClearMm, wallClearMm, wallWidMm, hookEngageMm, lipH, tabWidMm, tabCrossMm, tabFuseMm, clipWidthMm } = BASELOCK;
  const base = frame.base;
  const flangeZ1 = base - 4 + plateClearMm;              // plate is 4 mm (V02.plateT)
  const flangeZ0 = flangeZ1 - hookEngageMm - plateClearMm;
  const capZ1 = base + 3 + plateClearMm + lipH;          // rim top at base+3 (V02.rimH)
  const capZ0 = base + 3 + plateClearMm;
  const wallZ0 = flangeZ0, wallZ1 = capZ1;
  const slabZ0 = base - 4, slabZ1 = base + 1;            // 5 mm ear stack for the mini clip

  // Lip inner boundary from the assembled jacket at the cap's top height —
  // from the slice's OUTER contours ONLY. Subtracting the full slice (outer
  // ring minus cavity hole) would also cut the cap over the cavity opening,
  // leaving a disconnected island of cap material floating over the pour
  // basin (measured on the sheep: the ring + an island).
  const jacketVert = toVertFrame(jacket, track, v);
  const lipSlice = track(jacketVert.slice(capZ1 - 0.05));
  if (lipSlice.area() < 1) throw new Error('BaseLock: empty jacket slice at the cap height');
  const signedArea = (poly: number[][]): number => {
    let s = 0;
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
      s += x1 * y2 - x2 * y1;
    }
    return s / 2;
  };
  const allLoops = lipSlice.toPolygons?.() ?? [];
  let outerLoops = allLoops.filter((p) => signedArea(p) > 0);
  if (outerLoops.length === 0 && allLoops.length > 0) {
    outerLoops = [allLoops.reduce((a, b) => (Math.abs(signedArea(a)) > Math.abs(signedArea(b)) ? a : b))];
  }
  if (outerLoops.length === 0) throw new Error('BaseLock: no outer contour at the cap height');
  const lipOuter = track(csCtor.ofPolygons(outerLoops, 'EvenOdd'));
  const lipInner = track(lipOuter.offset(plateClearMm, 'Round', 2, 32).simplify(1e-4));
  const rimEdge = track(outline.offset(-0.3, 'Round', 2, 48));
  // The lip must overlap the rim band: the ring between the rim's outer edge
  // and the lip inner boundary is the actual press land (≥50 mm² required).
  const pressLand = track(rimEdge.subtract(lipInner));
  if (pressLand.area() < 50) {
    throw new Error('BaseLock: the jacket flares over the rim edge at the cap height — no lip press land on this shape');
  }

  const wallRing = track(track(outline.offset(wallWidMm, 'Round', 2, 48)).subtract(outline.offset(wallClearMm, 'Round', 2, 48)));
  // Cap and flange outer radii inset 0.3 mm inside the wall's outer face:
  // face-coincident unions imprint boundary edges and degenerate slivers
  // (the export gate rejects them) — every union must be strictly volumetric.
  const capRing = track(track(outline.offset(wallWidMm - 0.3, 'Round', 2, 48)).subtract(lipInner));
  const flangeRing = track(track(outline.offset(wallWidMm - 0.3, 'Round', 2, 48)).subtract(outline.offset(-hookEngageMm, 'Round', 2, 48)));
  if (flangeRing.area() < 100) throw new Error('BaseLock: plate outline too small for the hook flange');

  const wall = track(prismOnVert(wallRing, v, wallZ0, wallZ1));
  const cap = track(prismOnVert(capRing, v, capZ0, capZ1));
  const flange = track(prismOnVert(flangeRing, v, flangeZ0, flangeZ1));
  const collar = track(track(wall.add(cap)).add(flange));
  if (collar.volume() < 1000) throw new Error('BaseLock: collar has no valid volume');

  // Collision audit against the frozen geometry (seated pose).
  const hit = track(collar.intersect(jacket));
  if (hit.volume() > 0.5) {
    throw new Error(`BaseLock: collar overlaps the jacket by ${hit.volume().toFixed(2)} mm³ — clearances do not hold on this shape`);
  }

  // Split ±pull at the parting plane.
  const pv: number[] = [0, 0, 0]; pv[p] = 1;
  const nv: number[] = [0, 0, 0]; nv[p] = -1;
  let halfA = track(collar.trimByPlane([...pv], frame.mid));
  let halfB = track(collar.trimByPlane([...nv], -frame.mid));
  if (halfA.volume() < 500 || halfB.volume() < 500) throw new Error('BaseLock: split produced an empty half');

  // Ear tabs at the outline's ±depth extremes: A owns +depth, B owns −depth,
  // so the seam-crossing slabs can never collide. Slab = 5 mm stack outside
  // the wall's outer face, crossing tabCrossMm past the seam; neck = fusion
  // bridge back into the owning half's wall.
  let clip: ManifoldInstance | null = null;
  let clipCount = 0;
  const polys = outline.toPolygons?.() ?? [];
  if (polys.length > 0) {
    const area2 = (poly: number[][]): number => {
      let s = 0;
      for (let i = 0; i < poly.length; i++) {
        const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
        s += x1 * y2 - x2 * y1;
      }
      return Math.abs(s / 2);
    };
    let outerPoly = polys[0];
    for (const poly of polys) if (area2(poly) > area2(outerPoly)) outerPoly = poly;
    const dCoord = pullIsU3 ? 1 : 0; // depth-coordinate index within polygon points
    const pCoord = pullIsU3 ? 0 : 1;
    // Anchor the ears at the outline's ±depth extent NEAR THE SEAM — the
    // global depth extreme can sit far along the pull coordinate where the
    // wall band is nowhere near the ear (the neck must fuse into the wall at
    // pull ≈ mid, so the anchor must follow the outline there).
    const nearSeam = outerPoly.filter((q) => Math.abs(q[pCoord] - frame.mid) <= 1.5);
    const pool = nearSeam.length >= 2 ? nearSeam : outerPoly;
    let dMin = pool[0], dMax = pool[0];
    for (const q of pool) {
      if (q[dCoord] < dMin[dCoord]) dMin = q;
      if (q[dCoord] > dMax[dCoord]) dMax = q;
    }
    // vert-frame 2D point from (pullCoordVal, depthCoordVal), honoring which
    // outline-plane axis is which
    const pt = (aPull: number, bDepth: number): number[] =>
      pullIsU3 ? [aPull, bDepth] : [bDepth, aPull];
    const vertUnit: number[] = [0, 0, 0]; vertUnit[v] = 1;
    for (const [pStar, sign, own] of [[dMax, 1, 'A'], [dMin, -1, 'B']] as [number[], number, 'A' | 'B'][]) {
      const dEdge = pStar[dCoord];
      const slabIn = dEdge + sign * (wallWidMm + wallClearMm);
      const slabOut = slabIn + sign * tabWidMm;
      const cross = sign * tabCrossMm;
      const fuse = sign * tabFuseMm;
      // slab: [mid−cross … mid+fuse] along pull for the +pull owner, mirrored for B
      const pLo = own === 'A' ? frame.mid - cross : frame.mid - fuse;
      const pHi = own === 'A' ? frame.mid + fuse : frame.mid + cross;
      const slabPoly = [pt(pLo, slabIn), pt(pHi, slabIn), pt(pHi, slabOut), pt(pLo, slabOut)];
      const neckPoly = own === 'A'
        ? [pt(frame.mid, slabIn - sign * 1.5), pt(frame.mid + fuse, slabIn - sign * 1.5), pt(frame.mid + fuse, slabOut), pt(frame.mid, slabOut)]
        : [pt(frame.mid - fuse, slabIn - sign * 1.5), pt(frame.mid, slabIn - sign * 1.5), pt(frame.mid, slabOut), pt(frame.mid - fuse, slabOut)];
      const slab = track(prismOnVert(track(csCtor.ofPolygons([slabPoly], 'EvenOdd')), v, slabZ0, slabZ1));
      const neck = track(prismOnVert(track(csCtor.ofPolygons([neckPoly], 'EvenOdd')), v, slabZ0, slabZ1));
      const ear = track(slab.add(neck));
      if (own === 'A') {
        const fused = track(halfA.add(ear));
        halfA = fused;
      } else {
        const fused = track(halfB.add(ear));
        halfB = fused;
      }
      // mini clip centered on the seam at this ear's slab
      const n3: number[] = [0, 0, 0]; n3[depthIdx3(v, pullIsU3)] = sign;
      const pos: number[] = [0, 0, 0];
      pos[pullAxisIdx3(v, pullIsU3)] = frame.mid;
      pos[depthIdx3(v, pullIsU3)] = slabOut;
      pos[v] = (slabZ0 + slabZ1) / 2;
      const station: ClampStation = {
        position: pos as [number, number, number],
        normal: n3 as [number, number, number],
        bulgeMm: 0, railThickness: tabWidMm, index: 100 + clipCount,
      };
      const c = buildZeroClip({ csCtor, station, pull: vertUnit as [number, number, number], widthMm: clipWidthMm });
      clip = clip ?? c;
      clipCount++;
    }
  }

  // Connectivity check — returns the single substantial component. The check
  // consumes the halves (decompose() pieces must not be freed while the
  // parent is re-decomposed), so the caller never re-decomposes these.
  const singleComponent = (h: ManifoldInstance, name: string): ManifoldInstance => {
    const comps = h.decompose();
    const substantial = comps.filter((c) => c.volume() > 0.0001);
    if (substantial.length !== 1) {
      const detail = substantial.map((c) => {
        const b = c.boundingBox();
        return `vol ${c.volume().toFixed(1)} z[${b.min[2].toFixed(1)},${b.max[2].toFixed(1)}] x[${b.min[0].toFixed(1)},${b.max[0].toFixed(1)}] y[${b.min[1].toFixed(1)},${b.max[1].toFixed(1)}]`;
      }).join(' | ');
      comps.forEach((c) => c.delete());
      throw new Error(`BaseLock ${name}: ${substantial.length} disconnected solids — ${detail || 'empty'}`);
    }
    for (const c of comps) if (c !== substantial[0]) c.delete();
    return track(substantial[0]);
  };
  halfA = singleComponent(halfA, 'A');
  halfB = singleComponent(halfB, 'B');

  return { halfA, halfB, clip, clipCount };
}

function pullAxisIdx3(v: number, pullIsU3: boolean): number {
  return pullIsU3 ? (v + 1) % 3 : (v + 2) % 3;
}
function depthIdx3(v: number, pullIsU3: boolean): number {
  return pullIsU3 ? (v + 2) % 3 : (v + 1) % 3;
}
