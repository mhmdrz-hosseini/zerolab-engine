// Open-face relief tray (plan Task 6, M1): the face-up casting mold family.
// NOT the old jacket rotated onto its back — a horizontal support plate, a
// contour wall with NO roof, deliberate silicone backing above the highest
// feature, and an accessible open face. The cured silicone lifts straight out
// of the open tray; master demolding from the silicone stays flexible-material
// territory (siliconeDemold: unverified) exactly as in the jacket family.
//
// Construction (tray frame = the master arrives backing-plane-DOWN at z=0):
//   shadow    = exact projected outer contours, internal holes excluded
//   inner     = shadow ⊕ gap          (the clearance gap, applied ONCE)
//   outer     = inner ⊕ wall          (contour wall thickness)
//   base      = extrude(outer, plateT), spans [−plateT, 0] — master fuses to it
//   wall      = extrude(outer) − extrude(inner), spans [0, wallTop], seats on base
//   silicone  = extrude(inner, fillTop) − master; freeboard stays empty
// Through-holes in the master fill with silicone and report as withdrawable
// posts when straight — never silently filled or cored without a note.
import { isStatusOk, type ManifoldMod, type ManifoldInstance } from './manifoldLoader';
import type { CS } from './split';
import type { MeshArrays } from './types';
import { normalizePositiveShells } from './solid';
import { meshVolumeCm3 } from './clean';

export interface ReliefTrayParams {
  gap: number;      // silicone clearance around the master (mm)
  wall: number;     // contour wall thickness (mm)
  plateT: number;   // support plate thickness (mm)
  backing: number;  // deliberate silicone above the highest feature (mm)
  freeboard: number;// pour margin above the backing (mm)
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
  fillTopZ: number;
  wallTopZ: number;
  openFace: true;
  release: { openTop: true; notes: string[] };
  siliconeDemold: { status: 'unverified'; note: string };
  throughHoles: ThroughHole[];
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
  const normalized = normalizePositiveShells(mod, master);
  const man = normalized.solid;
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

    // The container follows the outside silhouette. Interior loops belong to
    // the master, not the container: extruding them creates unwanted rigid
    // islands and removes the silicone posts which must fill through-holes.
    deps.onProgress?.('Projecting the master silhouette');
    const projected = man.project();
    const exterior = (projected.toPolygons?.() ?? []).filter(poly => {
      let twiceArea = 0;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        twiceArea += a[0] * b[1] - b[0] * a[1];
      }
      return twiceArea > 0;
    });
    const sections = mod.CrossSection as { ofPolygons(polys: number[][][], fillRule?: string): CS };
    if (!exterior.length) { projected.delete(); throw new Error('relief tray: master projection is empty'); }
    const shadow = sections.ofPolygons(exterior, 'Positive');
    projected.delete();
    const shBb = shadow.bounds();
    const shSpan = Math.max(1e-6, Math.min(shBb.max[0] - shBb.min[0], shBb.max[1] - shBb.min[1]));

    // --- cavity + wall contours (gap applied ONCE; wall ONCE) ---
    deps.onProgress?.('Offsetting the contour wall');
    const inner = shadow.offset(gap, 'Round', 2, 48);
    const outer = inner.offset(wall, 'Round', 2, 48);
    const fillTop = masterTop + backing;
    const wallTop = fillTop + freeboard;

    // --- solid parts ---
    deps.onProgress?.('Building plate and wall');
    const plate = outer.extrude(plateT).translate(0, 0, -plateT);       // spans [−plateT, 0]
    const wallOuterPrism = outer.extrude(wallTop);
    const wallInnerPrism = inner.extrude(wallTop);
    const wallSolid = wallOuterPrism.subtract(wallInnerPrism);           // ring, NO roof

    // --- master fused to the plate (buried foot, same trick as the jacket) ---
    deps.onProgress?.('Fusing the master to the plate');
    const footCS = man.slice(0.01);
    const foot = footCS
      ? footCS.extrude(0.021).translate(0, 0, -0.01)
      : null;
    const plateMan = foot ? plate.add(foot) : plate;
    const masterBase = man.add(plateMan);
    if (!isStatusOk(masterBase)) throw new Error('relief tray: master/base union failed');

    // --- silicone preview: the cured negative resting on the plate ---
    deps.onProgress?.('Building the silicone preview');
    const cavityPrism = inner.extrude(fillTop);                         // freeboard is air
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

    const warnings: string[] = [...normalized.notes, 'Tray CSG regularization bounded to 0.005 mm surface displacement; protected detail remains subject to the final fidelity gate.'];
    if (throughHoles.some((h) => !h.withdrawable)) {
      warnings.push('a non-straight interior void does not withdraw along +Z — it needs a documented removable core or a cut/peel procedure before production');
    }
    if (throughHoles.length > 0) {
      warnings.push('through-hole(s) fill with silicone and cast as posts; they withdraw along +Z only when straight — verify the cured post releases without tearing');
    }

    const toArrays = (m: ManifoldInstance, toleranceMm: number): MeshArrays => {
      // Kernel simplification is displacement-bounded to 5 µm. At large
      // export scales this removes sub-print-resolution boolean pinches which
      // survive the 1 µm STL weld; source feature fidelity remains a final gate.
      const simplified = m.simplify(toleranceMm);
      const dm = simplified.getMesh();
      const out: MeshArrays = { vertProperties: Float32Array.from(dm.vertProperties), triVerts: Uint32Array.from(dm.triVerts.subarray(0, dm.numTri * 3)) };
      simplified.delete();
      m.delete();
      return out;
    };
    const basePlate = toArrays(plateMan, 0.005);
    const wallArr = toArrays(wallSolid, 0.005);
    const masterBaseArr = toArrays(masterBase, 0.005);
    const siliconeArr = toArrays(silicone, 0.005);
    // Independently simplified contact surfaces can cross by a few microns.
    // Reconcile their actual exported solids with exact CSG so the wall does
    // not collide with either the printed base or the cured silicone.
    const clipAgainst = (mesh: MeshArrays, obstacle: MeshArrays): MeshArrays => {
      const left = new mod.Manifold(new mod.Mesh({ numProp: 3, ...mesh }));
      const right = new mod.Manifold(new mod.Mesh({ numProp: 3, ...obstacle }));
      try {
        const clipped = left.subtract(right);
        if (!isStatusOk(clipped)) throw new Error('relief tray: contact reconciliation failed');
        const dm = clipped.getMesh();
        const out: MeshArrays = { vertProperties: Float32Array.from(dm.vertProperties), triVerts: Uint32Array.from(dm.triVerts.subarray(0, dm.numTri * 3)) };
        clipped.delete();
        return out;
      } finally { left.delete(); right.delete(); }
    };
    const fittedMasterBase = clipAgainst(masterBaseArr, wallArr);
    const fittedSilicone = clipAgainst(clipAgainst(siliconeArr, wallArr), fittedMasterBase);
    // free remaining intermediates
    [shadow, inner, outer, wallOuterPrism, wallInnerPrism, cavityPrism, foot].forEach((x) => { try { x?.delete(); } catch { /* freed */ } });

    return {
      pieces: { basePlate, wall: wallArr, masterBase: fittedMasterBase, siliconeSkin: fittedSilicone },
      siliconeMl: Number(meshVolumeCm3(fittedSilicone).toFixed(1)),
      masterTopZ: Number(masterTop.toFixed(2)),
      fillTopZ: Number(fillTop.toFixed(2)),
      wallTopZ: Number(wallTop.toFixed(2)),
      openFace: true,
      release: {
        openTop: true,
        notes: [
          'the tray has no roof — the cured silicone lifts straight up out of the wall',
          'printed wall/base never trap the silicone rigidly; only the master/silicone interface needs the demold review',
        ],
      },
      siliconeDemold: {
        status: 'unverified',
        note: 'Pulling the master out of the cured silicone (undercuts, tear strain) is a flexible-material review and is NOT certified by the open-top tray geometry.',
      },
      throughHoles,
      warnings,
    };
  } finally {
    try { man.delete(); } catch { /* freed */ }
  }
}
