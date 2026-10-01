// Open-face relief tray (plan Task 6, M1): the face-up casting mold family.
// NOT the old jacket rotated onto its back — a horizontal support plate, a
// contour wall with NO roof, deliberate silicone backing above the highest
// feature, and an accessible open face. The cured silicone lifts straight out
// of the open tray; master demolding from the silicone stays flexible-material
// territory (siliconeDemold: unverified) exactly as in the jacket family.
//
// Construction (tray frame = the master arrives backing-plane-DOWN at z=0):
//   shadow    = union of master slices over its full height (undercut-safe)
//   inner     = shadow ⊕ gap          (the clearance gap, applied ONCE)
//   outer     = inner ⊕ wall          (contour wall thickness)
//   base      = extrude(outer, plateT), spans [−plateT, 0] — master fuses to it
//   key ring  = tongue ring standing ON the plate top, centered in the wall
//               footprint; the wall's seating face carries the matching
//               clearance groove, so the wall seats at z=0 located laterally,
//               stopped vertically, and sealed (the pre-pour smear backs the
//               key up — printed joints are not liquid-tight alone)
//   wall      = extrude(outer) − extrude(inner) − groove, spans [0, wallTop], no roof
//   silicone  = extrude(inner, wallTop) − master   (the cured-negative preview)
// Through-holes in the master fill with silicone and report as withdrawable
// posts when straight — never silently filled or cored without a note.
import { isStatusOk, type ManifoldMod } from './manifoldLoader';
import { frameConstants, type CS } from './split';
import type { MeshArrays } from './types';

export interface ReliefTrayParams {
  gap: number;      // silicone clearance around the master (mm)
  wall: number;     // contour wall thickness (mm)
  plateT: number;   // support plate thickness (mm)
  backing: number;  // deliberate silicone above the highest feature (mm)
  freeboard: number;// pour margin above the backing (mm)
  keyRing?: {       // wall↔plate joint; default = frameConstants tongue @ 0.35 mm
    tongueW: number;  // tongue cross-section width AND height (mm, square)
    clearance: number;// groove fit clearance from the joint-fit ladder (mm)
  };
}

/** Measured integrity of the wall↔plate key ring, in the assembled position —
 *  feeds the hard tray gates (Key Engagement, Seat Contact). */
export interface KeyRingMetrics {
  tongueW: number;
  tongueH: number;
  clearance: number;
  grooveDepth: number;
  expectedGrooveMm3: number;   // nominal groove cavity volume
  grooveDeficitMm3: number;    // material actually removed from the wall ring
  engagementRatio: number;     // grooveDeficit / expectedGroove (1 = full)
  expectedTongueMm3: number;   // nominal tongue volume above the plate
  tongueSurplusMm3: number;    // material actually added on top of the plate
  assembledInterferenceMm3: number; // wall∩plate volume — must be ~0 (clearance respected)
}

export interface ThroughHole {
  withdrawable: boolean;
  areaMm2: number;
}

export interface ReliefTrayResult {
  pieces: {
    basePlate: MeshArrays;
    wall: MeshArrays;
    masterBase: MeshArrays;
    siliconeSkin: MeshArrays;
  };
  siliconeMl: number;
  masterTopZ: number;
  wallTopZ: number;
  openFace: true;
  release: { openTop: true; notes: string[] };
  siliconeDemold: { status: 'unverified'; note: string };
  throughHoles: ThroughHole[];
  keyRing: KeyRingMetrics;
  warnings: string[];
}

// depth/footprint-span above this cannot be backed reliably by a flat tray
const MAX_DEPTH_RATIO = 0.5;

export function buildReliefTray(deps: {
  mod: ManifoldMod;
  master: MeshArrays;   // backing plane down at z≈0, millimetres
  params: ReliefTrayParams;
  onProgress?: (stage: string) => void;
}): ReliefTrayResult {
  const { mod, master, params } = deps;
  const { gap, wall, plateT, backing, freeboard } = params;
  const man = new mod.Manifold(new mod.Mesh({ numProp: 3, vertProperties: master.vertProperties, triVerts: master.triVerts }));
  if (!isStatusOk(man)) throw new Error('relief tray: master is not a valid solid');
  try {
    const bb = man.boundingBox();
    const masterTop = bb.max[2];
    if (Math.abs(bb.min[2]) > 0.5) {
      throw new Error(`relief tray: master must arrive backing-plane-down at z≈0 (min z ${bb.min[2].toFixed(2)}) — orient it first`);
    }
    const spanX = bb.max[0] - bb.min[0], spanY = bb.max[1] - bb.min[1];
    const minSpan = Math.max(1e-6, Math.min(spanX, spanY));
    const depthRatio = masterTop / minSpan;
    if (depthRatio > MAX_DEPTH_RATIO) {
      throw new Error(`relief tray: geometry is too deep for an open-face tray (depth/span ${depthRatio.toFixed(2)} > ${MAX_DEPTH_RATIO}) — route as a 3D mold or confirm the underside is waived`);
    }
    if (masterTop <= 0.2) throw new Error('relief tray: master has no relief height above the backing plane');

    // --- shadow: union of slices across the full height (undercut-safe) ---
    deps.onProgress?.('Projecting the master silhouette');
    const steps = Math.max(2, Math.ceil(masterTop / 2));
    let shadow: CS | null = null;
    for (let i = 0; i <= steps; i++) {
      const z = 0.05 + (masterTop - 0.1) * (i / steps);
      const s = man.slice(z);
      if (!s) continue;
      shadow = shadow ? shadow.add(s) : s;
    }
    if (!shadow) throw new Error('relief tray: master projection is empty');
    const shBb = shadow.bounds();
    const shSpan = Math.max(1e-6, Math.min(shBb.max[0] - shBb.min[0], shBb.max[1] - shBb.min[1]));

    // --- cavity + wall contours (gap applied ONCE; wall ONCE) ---
    deps.onProgress?.('Offsetting the contour wall');
    const inner = shadow.offset(gap, 'Round', 2, 48);
    const outer = inner.offset(wall, 'Round', 2, 48);
    const wallTop = masterTop + backing + freeboard;

    // --- solid parts ---
    deps.onProgress?.('Building plate, key ring and wall');
    const junk: { delete(): void }[] = [];
    const track = <T extends { delete(): void }>(x: T): T => { junk.push(x); return x; };

    // Key ring: an upstanding tongue on the plate, centered in the wall
    // footprint, with the matching clearance groove cut into the wall's
    // seating face. The key faces take the lateral load, the groove ceiling
    // is the vertical stop, and the groove clearance is what the pre-pour
    // smear backs up. The tongue cross-section clamps so ≥0.3 mm of land
    // remains on each side of the groove.
    const krClearance = params.keyRing?.clearance ?? 0.35;
    const Kt = frameConstants(Math.max(spanX, spanY, masterTop));
    const tongueW = Math.max(0.6, Math.min(params.keyRing?.tongueW ?? Kt.tongue, Math.max(0.6, wall - 2 * krClearance - 0.6)));
    const tongueH = tongueW; // square cross-section
    const grooveDepth = tongueH + krClearance; // wall bottom rests on the plate top
    const midWall = wall / 2;
    const tongueInDelta = midWall - tongueW / 2;
    if (tongueInDelta <= 0.05) throw new Error('relief tray: wall too thin for the key ring — increase the wall thickness');
    const tongueOuterCS = track(inner.offset(midWall + tongueW / 2, 'Round', 2, 48));
    const tongueInnerCS = track(inner.offset(tongueInDelta, 'Round', 2, 48));
    const tongueCS = track(tongueOuterCS.subtract(tongueInnerCS));
    const grooveOuterCS = track(tongueOuterCS.offset(krClearance, 'Round', 2, 48));
    const grooveInnerCS = track(tongueInnerCS.offset(-krClearance, 'Round', 2, 48));
    const grooveCS = track(grooveOuterCS.subtract(grooveInnerCS));
    const tongueSolid = track(tongueCS.extrude(tongueH + 0.5).translate(0, 0, -0.5));   // fuses 0.5 into the plate
    const grooveSolid = track(grooveCS.extrude(grooveDepth + 0.5).translate(0, 0, -0.5)); // opens through the seating face

    const plate = track(outer.extrude(plateT).translate(0, 0, -plateT));                // spans [−plateT, 0]
    const plateTongue = track(plate.add(tongueSolid));
    const wallOuterPrism = track(outer.extrude(wallTop));                               // spans [0, wallTop] —
    const wallInnerPrism = track(inner.extrude(wallTop));                               // seats ON the plate, no overlap
    const wallRing = track(wallOuterPrism.subtract(wallInnerPrism));                    // ring, NO roof
    const wallSolid = track(wallRing.subtract(grooveSolid));

    // key-ring integrity, measured in the assembled position (feeds the hard gates)
    const expectedGrooveMm3 = grooveCS.area() * grooveDepth;
    const expectedTongueMm3 = tongueCS.area() * tongueH;
    const grooveDeficitMm3 = wallRing.volume() - wallSolid.volume();
    const tongueSurplusMm3 = plateTongue.volume() - plate.volume();
    const interferenceM = track(plateTongue.intersect(wallSolid));
    const keyRing: KeyRingMetrics = {
      tongueW: Number(tongueW.toFixed(2)),
      tongueH,
      clearance: krClearance,
      grooveDepth: Number(grooveDepth.toFixed(2)),
      expectedGrooveMm3: Number(expectedGrooveMm3.toFixed(2)),
      grooveDeficitMm3: Number(grooveDeficitMm3.toFixed(2)),
      engagementRatio: Number(Math.min(1, grooveDeficitMm3 / Math.max(1e-9, expectedGrooveMm3)).toFixed(3)),
      expectedTongueMm3: Number(expectedTongueMm3.toFixed(2)),
      tongueSurplusMm3: Number(tongueSurplusMm3.toFixed(2)),
      assembledInterferenceMm3: Number(Math.max(0, interferenceM.volume()).toFixed(3)),
    };

    // --- master fused to the plate (buried foot, same trick as the jacket) ---
    deps.onProgress?.('Fusing the master to the plate');
    const footCS = man.slice(0.3);
    if (footCS) junk.push(footCS);
    const foot = footCS
      ? track(footCS.extrude(0.32).translate(0, 0, -0.01))
      : null;
    const plateMan = foot ? plateTongue.add(foot) : plateTongue;
    const masterBase = man.add(plateMan);
    if (!isStatusOk(masterBase)) throw new Error('relief tray: master/base union failed');

    // --- silicone preview: the cured negative resting on the plate ---
    deps.onProgress?.('Building the silicone preview');
    const cavityPrism = track(inner.extrude(wallTop));                   // spans [0, wallTop]
    const silicone = cavityPrism.subtract(man);
    if (!isStatusOk(silicone)) throw new Error('relief tray: silicone preview failed');
    const siliconeMl = silicone.volume() / 1000;
    if (siliconeMl <= 0) throw new Error('relief tray: empty silicone preview');

    // --- through-hole survey: interior loops present at mid AND near-top ---
    const holesAt = (z: number): { area: number; cx: number; cy: number }[] => {
      const cs = man.slice(z);
      if (!cs) return [];
      const polys = cs.toPolygons?.() ?? [];
      const out: { area: number; cx: number; cy: number }[] = [];
      for (const poly of polys) {
        let a2 = 0, cx = 0, cy = 0;
        for (let i = 0; i < poly.length; i++) {
          const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
          const cross = x1 * y2 - x2 * y1;
          a2 += cross; cx += (x1 + x2) * cross; cy += (y1 + y2) * cross;
        }
        const area = a2 / 2;
        if (area < -1) out.push({ area: -area, cx: cx / (3 * a2), cy: cy / (3 * a2) }); // CW = hole
      }
      return out;
    };
    const midHoles = holesAt(masterTop * 0.5);
    const topHoles = holesAt(Math.max(0.1, masterTop - 0.1));
    const throughHoles: ThroughHole[] = midHoles.map((h) => {
      const match = topHoles.find((t) =>
        Math.abs(t.area - h.area) / h.area < 0.25 &&
        Math.hypot(t.cx - h.cx, t.cy - h.cy) < shSpan * 0.05);
      return { withdrawable: !!match, areaMm2: Number(h.area.toFixed(1)) };
    });

    const warnings: string[] = [];
    if (throughHoles.some((h) => !h.withdrawable)) {
      warnings.push('a non-straight interior void does not withdraw along +Z — it needs a documented removable core or a cut/peel procedure before production');
    }
    if (throughHoles.length > 0) {
      warnings.push('through-hole(s) fill with silicone and cast as posts; they withdraw along +Z only when straight — verify the cured post releases without tearing');
    }

    const toArrays = (m: { getMesh(): { vertProperties: Float32Array; triVerts: Uint32Array; numTri: number }; delete(): void }): MeshArrays => {
      const dm = m.getMesh();
      const out: MeshArrays = { vertProperties: Float32Array.from(dm.vertProperties), triVerts: Uint32Array.from(dm.triVerts.subarray(0, dm.numTri * 3)) };
      m.delete();
      return out;
    };
    // manifolds consumed by toArrays must not be freed twice
    const consume = (x: { delete(): void }) => { const i = junk.indexOf(x); if (i >= 0) junk.splice(i, 1); };
    const basePlate = toArrays(plateMan);
    consume(plateMan);
    const wallArr = toArrays(wallSolid);
    consume(wallSolid);
    const masterBaseArr = toArrays(masterBase);
    const siliconeArr = toArrays(silicone);
    junk.push(shadow as CS, inner, outer);
    for (const x of junk) { try { x.delete(); } catch { /* freed */ } }

    return {
      pieces: { basePlate, wall: wallArr, masterBase: masterBaseArr, siliconeSkin: siliconeArr },
      siliconeMl: Number(siliconeMl.toFixed(1)),
      masterTopZ: Number(masterTop.toFixed(2)),
      wallTopZ: Number(wallTop.toFixed(2)),
      openFace: true,
      release: {
        openTop: true,
        notes: [
          'the tray has no roof — the cured silicone lifts straight up out of the wall',
          'the wall seats into the plate key ring: lift the wall off after cure and reuse it; smear the seam before pouring',
          'printed wall/base never trap the silicone rigidly; only the master/silicone interface needs the demold review',
        ],
      },
      siliconeDemold: {
        status: 'unverified',
        note: 'Pulling the master out of the cured silicone (undercuts, tear strain) is a flexible-material review and is NOT certified by the open-top tray geometry.',
      },
      throughHoles,
      keyRing,
      warnings,
    };
  } finally {
    try { man.delete(); } catch { /* freed */ }
  }
}
