// Slicer-aware printability analyzer (audit §7): coarse layer simulation of
// each exported part in its print orientation (rim-down / plate-down along the
// vert axis). Per layer, the "unsupported growth" is the section area that
// extends beyond the layer below dilated by slope·Δz (slope 1.0 = 45°) — the
// same measure as the external audit (their method: A ≈ 1,095 mm², B ≈ 2,429
// mm² unsupported growth on a comparable package). Advisory only: modern
// slicers paint supports; the numbers tell the user WHERE and HOW MUCH.
//
// V0.5 (MFG_RELIABILITY commit 4): unsupported ISLANDS — the connected
// components of each layer's overhang diff. Thresholds (grilled 2026-09-26):
// islands < 4 mm² are slicer-bridgeable (ignored), 4–15 mm² warn, > 15 mm²
// are hard-fail CANDIDATES (the gate flip lands after the corpus runs clean).
import type { ManifoldMod } from './manifoldLoader';
import { AXES, type Axis, type MeshArrays } from './types';

export const ISLAND = {
  ignoreMm2: 4,    // below: slicer bridges it — never reported
  warnMm2: 4,      // from: reported in unsupportedIslands
  hardMm2: 15,     // from: hard-fail candidate (gate flip pending corpus-clean)
};

// Bed-stability ladder (grilled 2026-09-26): slenderness = height / √bedArea.
// Brim recommendation only — never modifies geometry, never gates.
export const BRIM = {
  low: 1.5,        // below: no brim needed (with a real footprint)
  medium: 2.0,     // below: 3 mm brim
  high: 2.5,       // below: 5 mm brim; at/above: 8 mm brim + HIGH risk label
  minBedMm2: 2000, // small footprints always get at least a 3 mm brim
};

export function recommendBrim(slenderness: number, bedAreaMm2: number): number {
  if (slenderness < BRIM.low) return bedAreaMm2 >= BRIM.minBedMm2 ? 0 : 3;
  if (slenderness < BRIM.medium) return 3;
  if (slenderness < BRIM.high) return 5;
  return 8;
}

export function bedRiskOf(slenderness: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (slenderness < BRIM.low) return 'LOW';
  if (slenderness < BRIM.high) return 'MEDIUM';
  return 'HIGH';
}

export interface PrintabilityBand { zLo: number; zHi: number; areaMm2: number }
export interface PrintabilityIsland { z: number; areaMm2: number }
export interface PrintabilityReport {
  bedAreaMm2: number;          // first-layer contact (adhesion footprint)
  overhangAreaMm2: number;     // total unsupported growth @45° over all layers
  layerStep: number;
  layers: number;
  worstBands: PrintabilityBand[];  // merged height bands with the most overhang
  unsupportedIslands: PrintabilityIsland[]; // islands ≥ warnMm2, largest first (≤20)
  islandRisk: 'LOW' | 'MEDIUM' | 'HIGH';    // HIGH = hard-fail candidate present
  heightMm: number;            // print-height of the part in its orientation
  slenderness: number;         // height / √bedArea
  brimMm: 0 | 3 | 5 | 8;       // recommended brim (print-profile metadata only)
  bedRisk: 'LOW' | 'MEDIUM' | 'HIGH';       // tipping/topple indicator, warning-tier
  precisionOverhangMm2: number; // unsupported growth inside the rail/tongue band
  precisionRisk: 'CLEAR' | 'WARN';          // WARN = support likely on a precision surface
}

// The precision band: rail + tongue/groove live within ±2.5 mm of the parting
// plane (split.ts rail prism span). In a layer cross-section this is a straight
// strip along the pull coordinate. The rim seat is NOT in this check — for
// rim-down prints it IS the bed face (elephant-foot territory, handled in the
// print profile), which is why bed contact on it is guidance, not rejection.
const PRECISION_HALF_WIDTH = 2.5;
const PRECISION_WARN_MM2 = 4;

const UNIT: Record<Axis, [number, number, number]> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };

interface CS {
  area(): number;
  offset(c: number, join?: string, m?: number, seg?: number): CS;
  subtract(o: CS): CS;
  intersect(o: CS): CS;
  decompose(): CS[];
  delete(): void;
}

/** Analyze the standard export set: master_base (plate-down) + each jacket
 *  piece (rim-down). Shared by the worker and the CLI. The precision-band
 *  check runs only when pull+mid are provided (jacket parts). */
export function analyzePieces(deps: {
  mod: ManifoldMod;
  masterBase: MeshArrays;
  jackets: { name: string; mesh: MeshArrays }[];
  vert: Axis;
  base: number;    // plate top (= jacket bed face)
  crown: number;
  plateT: number;  // master_base's bed face sits plateT below `base`
  pull?: Axis;     // parting normal — enables the precision-band check
  mid?: number;    // parting-plane position along the pull axis
}): Record<string, PrintabilityReport> {
  const out: Record<string, PrintabilityReport> = {
    master_base: analyzePrintability({
      mod: deps.mod, mesh: deps.masterBase, vert: deps.vert,
      base: deps.base - deps.plateT, crown: deps.crown,
    }),
  };
  for (const j of deps.jackets) {
    out[j.name] = analyzePrintability({
      mod: deps.mod, mesh: j.mesh, vert: deps.vert, base: deps.base, crown: deps.crown,
      pull: deps.pull, mid: deps.mid,
    });
  }
  return out;
}

export function analyzePrintability(deps: {
  mod: ManifoldMod;
  mesh: MeshArrays;
  vert: Axis;          // print direction (jackets: frame.vert; master: same)
  base: number;        // vert-axis coord of the bed-contact face
  crown: number;       // vert-axis coord of the top
  layerStep?: number;  // analysis layer height (default ≈ 0.8 mm, coarse)
  slope?: number;      // tan of the support threshold (default 1.0 = 45°)
  pull?: Axis;         // parting normal — enables the precision-band check
  mid?: number;        // parting-plane position along pull
}): PrintabilityReport {
  const { mod, mesh, vert, base, crown } = deps;
  const layerStep = deps.layerStep ?? Math.max(0.6, (crown - base) / 250);
  const slope = deps.slope ?? 1.0;
  const man = new mod.Manifold(new mod.Mesh({ numProp: 3, vertProperties: mesh.vertProperties, triVerts: mesh.triVerts }));
  const v = UNIT[vert].indexOf(1);
  let rot = man;
  if (v === 1) rot = man.rotate(90, 0, 0).rotate(0, 0, 90);
  if (v === 0) rot = man.rotate(0, -90, 0).rotate(0, 0, -90);
  const slicer = rot as unknown as { slice(height: number): CS };

  // precision strip (rail/tongue band) in the layer plane, when enabled
  let strip: CS | null = null;
  if (deps.pull && deps.mid !== undefined) {
    const u3 = (v + 1) % 3;
    const pullCoordIdx = AXES.indexOf(deps.pull) === u3 ? 0 : 1;
    const csCtor = mod.CrossSection as unknown as { ofPolygons(poly: number[][][], fillRule?: string): CS };
    const BIG = 1e5;
    const rect: number[][] = pullCoordIdx === 0
      ? [[deps.mid - PRECISION_HALF_WIDTH, -BIG], [deps.mid + PRECISION_HALF_WIDTH, -BIG], [deps.mid + PRECISION_HALF_WIDTH, BIG], [deps.mid - PRECISION_HALF_WIDTH, BIG]]
      : [[-BIG, deps.mid - PRECISION_HALF_WIDTH], [BIG, deps.mid - PRECISION_HALF_WIDTH], [BIG, deps.mid + PRECISION_HALF_WIDTH], [-BIG, deps.mid + PRECISION_HALF_WIDTH]];
    strip = csCtor.ofPolygons([rect], 'EvenOdd');
  }

  const sliceCS = (z: number): CS | null => {
    const s = slicer.slice(z);
    if (s.area() <= 1e-6) { s.delete(); return null; }
    return s;
  };

  // bed contact: first section just above the base plane
  const bed = sliceCS(base + Math.min(0.05, layerStep * 0.1));
  const bedAreaMm2 = bed ? bed.area() : 0;
  bed?.delete();

  // unsupported growth per layer: S_k − dilate(S_{k−1}, slope·Δz)
  const perLayer: { z: number; area: number }[] = [];
  const islands: PrintabilityIsland[] = [];
  let islandHard = false;
  let precisionTotal = 0;
  for (let z = base + layerStep; z <= crown + 1e-9; z += layerStep) {
    const cur = sliceCS(z);
    if (!cur) continue;
    const below = sliceCS(z - layerStep);
    if (below) {
      const dilated = below.offset(slope * layerStep, 'Round', 2, 32);
      const diff = cur.subtract(dilated);
      const diffArea = diff.area();
      perLayer.push({ z, area: diffArea });
      // islands: only decompose layers whose diff could hold a warnable island
      if (diffArea >= ISLAND.warnMm2) {
        for (const comp of diff.decompose()) {
          const a = comp.area();
          comp.delete();
          if (a >= ISLAND.warnMm2) {
            islands.push({ z, areaMm2: a });
            if (a > ISLAND.hardMm2) islandHard = true;
          }
        }
      }
      // precision band: unsupported growth inside the rail/tongue strip
      if (strip && diffArea >= PRECISION_WARN_MM2) {
        const prec = diff.intersect(strip);
        precisionTotal += prec.area();
        prec.delete();
      }
      diff.delete();
      dilated.delete();
      below.delete();
    }
    cur.delete();
  }
  strip?.delete();
  try { rot.delete(); } catch { /* shared with man when vert === Z */ }
  try { man.delete(); } catch { /* freed above */ }

  const overhangAreaMm2 = perLayer.reduce((s, l) => s + l.area, 0);

  // merge consecutive layers with notable overhang into bands, keep the top 3
  const notable = Math.max(25, 0.02 * Math.max(...perLayer.map((l) => l.area), 1));
  const bands: PrintabilityBand[] = [];
  let open: PrintabilityBand | null = null;
  for (const l of perLayer) {
    if (l.area >= notable) {
      if (open && l.z - open.zHi <= layerStep * 1.5) { open.zHi = l.z; open.areaMm2 += l.area; }
      else { if (open) bands.push(open); open = { zLo: l.z, zHi: l.z, areaMm2: l.area }; }
    } else if (open) { bands.push(open); open = null; }
  }
  if (open) bands.push(open);
  bands.sort((a, b) => b.areaMm2 - a.areaMm2);
  islands.sort((a, b) => b.areaMm2 - a.areaMm2);

  const heightMm = crown - base;
  const slenderness = bedAreaMm2 > 1 ? heightMm / Math.sqrt(bedAreaMm2) : 99;

  return {
    bedAreaMm2: Number(bedAreaMm2.toFixed(0)),
    overhangAreaMm2: Number(overhangAreaMm2.toFixed(0)),
    layerStep: Number(layerStep.toFixed(2)),
    layers: perLayer.length,
    worstBands: bands.slice(0, 3).map((b) => ({ zLo: Number(b.zLo.toFixed(1)), zHi: Number(b.zHi.toFixed(1)), areaMm2: Number(b.areaMm2.toFixed(0)) })),
    unsupportedIslands: islands.slice(0, 20).map((i) => ({ z: Number(i.z.toFixed(1)), areaMm2: Number(i.areaMm2.toFixed(1)) })),
    islandRisk: islandHard ? 'HIGH' : islands.length > 0 ? 'MEDIUM' : 'LOW',
    heightMm: Number(heightMm.toFixed(1)),
    slenderness: Number(slenderness.toFixed(2)),
    brimMm: recommendBrim(slenderness, bedAreaMm2) as 0 | 3 | 5 | 8,
    bedRisk: bedRiskOf(slenderness),
    precisionOverhangMm2: Number(precisionTotal.toFixed(1)),
    precisionRisk: precisionTotal >= PRECISION_WARN_MM2 ? 'WARN' : 'CLEAR',
  };
}
