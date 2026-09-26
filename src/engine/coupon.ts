// Fit coupon — V0.5 P3 (docs/MFG_RELIABILITY_V0.5.md): a small standalone
// calibration print (< ~20 min, few grams, support-free) carrying samples of
// the mold's ACTUAL joint and clip geometry:
//   · 3 tongue/groove sample pairs at the mold's clearance − 0.10 / +0 / +0.10
//   · 4 rail stubs + ZeroClips at 0.25 / 0.30 / 0.35 / 0.40 mm interference
//   · 1 BaseLock capture segment (always — the least physically-proven joint)
// Variants are identified by NOTCH COUNT (1–4), never text. Everything prints
// flat on the included plate; clip samples lie beside their standing rail
// stubs in the production spring orientation, so the layered-stiffness axis
// matches real use. Delivered as a SEPARATE on-demand download — never inside
// the mold zip.
import type { CS } from './split';
import { buildZeroClip, CLAMP } from './clamps';
import { BASELOCK } from './baseLock';
import type { ManifoldInstance, ManifoldMod } from './manifoldLoader';
import type { ClampStation, MeshArrays } from './types';
import { instanceToMeshArrays } from './offset';

export const COUPON = {
  clipInterferences: [0.25, 0.3, 0.35, 0.4],
  jointDeltas: [-0.1, 0, 0.1],
};

type Track = <T extends { delete(): void }>(x: T) => T;

export function buildFitCoupon(deps: {
  mod: ManifoldMod;
  track: Track;
  clearance: number;   // the mold's joint clearance
}): { mesh: MeshArrays; notes: string[] } {
  const { mod, track, clearance } = deps;
  const csCtor = mod.CrossSection as unknown as { ofPolygons(poly: number[][][], fillRule?: string): CS };
  // every intermediate is tracked — the caller's finally frees them after the
  // mesh arrays are copied out
  const cube = (w: number, d: number, h: number, x: number, y: number, z: number): ManifoldInstance =>
    track(mod.Manifold.cube([w, d, h]).translate(x, y, z)) as unknown as ManifoldInstance;
  const notes: string[] = [];

  // plate 120 × 84 × 3 — all samples print on top of it, support-free
  let solid: ManifoldInstance = cube(120, 84, 3, 0, 0, 0);
  const notchMark = (x: number, y: number, count: number) => {
    for (let n = 0; n < count; n++) {
      solid = solid.subtract(cube(2, 1.2, 1.5, x + 1 + n * 3.2, y, 4.5));
    }
  };

  // --- joint sample pairs: tongue block + groove block, side by side ---
  // ridge 20 × 2 × 2 on a 24 × 10 × 4 base; groove slot = ridge ⊕ clearance
  COUPON.jointDeltas.forEach((delta, i) => {
    const c = Number((clearance + delta).toFixed(2));
    const x0 = 6, y0 = 6 + i * 26;
    const tongue = cube(24, 10, 4, x0, y0, 3).add(cube(20, 2, 2, x0 + 2, y0 + 4, 7));
    const slot = cube(20, 2 + 2 * c, 2, x0 + 32, y0 + 4 - c, 7);
    const grooveBlock = cube(24, 10, 4, x0 + 30, y0, 3).subtract(slot);
    solid = solid.add(tongue).add(grooveBlock);
    notchMark(x0, y0, i + 1);
    notes.push(`joint sample ${i + 1} notch(es): clearance ${c} mm — slide the ridge into the slot`);
  });

  // --- clip samples: standing rail stub + clip lying flat beside it ---
  // stub = the real rail stack (7 mm radial × 5 mm stack), 30 mm along the
  // clip's extrusion axis; the clip lies flat, spring orientation preserved
  COUPON.clipInterferences.forEach((interference, i) => {
    const x0 = 62, y0 = 6 + i * 19;
    solid = solid.add(cube(7, 5, 30, x0, y0, 3));
    notchMark(x0, y0, i + 1);
    // clip lying flat: profile (radial=X, press=Y) in the bed plane,
    // extrusion (tangent) along Z centered on plateTop + width/2
    const station: ClampStation = {
      position: [x0 + 16, y0 + 2.5, 3 + CLAMP.clipWidthMm / 2],
      normal: [1, 0, 0], bulgeMm: 0, railThickness: 7, index: i,
    };
    const clip = track(buildZeroClip({ csCtor, station, pull: [0, 1, 0], widthMm: CLAMP.clipWidthMm, interferenceMm: interference }));
    solid = solid.add(clip);
    notes.push(`clip sample ${i + 1} notch(es): interference ${interference} mm — spring it onto the stub, radial gap first`);
  });

  // --- BaseLock capture segment (always included) ---
  {
    const x0 = 90, y0 = 58;
    // rim corner: plate stub (4 tall) + rim flange (3 tall, edge inset 0.3)
    solid = solid.add(cube(14, 14, 4, x0 - 14, y0, 3).add(cube(13.7, 14, 3, x0 - 14, y0, 7)));
    // collar corner: the real BaseLock L cross-section (u = radial from the
    // plate edge, v' = vert with 0 at the flange bottom), extruded 14 mm
    const { wallClearMm, wallWidMm, plateClearMm, lipH } = BASELOCK;
    const vFlangeTop = 3;                    // hookEngageMm
    const vPlateBot = vFlangeTop + plateClearMm;
    const vPlateTop = vPlateBot + 4;
    const vRimTop = vPlateTop + 3;
    const vCapBot = vRimTop + plateClearMm;
    const vCapTop = vCapBot + lipH;
    const prof: number[][] = [
      [-3.5, 0], [wallWidMm + wallClearMm, 0],
      [wallWidMm + wallClearMm, vCapTop], [-3.5, vCapTop],
      [-3.5, vCapBot], [wallClearMm, vCapBot],
      [wallClearMm, vFlangeTop], [-3.5, vFlangeTop],
    ];
    const collarSeg = track(csCtor.ofPolygons([prof], 'EvenOdd').extrude(14).translate(x0, y0 + 17, 3)) as unknown as ManifoldInstance;
    solid = solid.add(collarSeg);
    notchMark(x0 - 14, y0, 4);
    notes.push('BaseLock segment (4 notches): slide the collar corner over the rim corner — 0.6 mm slide clearances, 0.6 mm capture travel');
  }

  return { mesh: instanceToMeshArrays(solid), notes };
}
