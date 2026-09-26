// Slicer-aware printability analyzer (audit §7): coarse layer simulation of
// each exported part in its print orientation (rim-down / plate-down along the
// vert axis). Per layer, the "unsupported growth" is the section area that
// extends beyond the layer below dilated by slope·Δz (slope 1.0 = 45°) — the
// same measure as the external audit (their method: A ≈ 1,095 mm², B ≈ 2,429
// mm² unsupported growth on a comparable package). Advisory only: modern
// slicers paint supports; the numbers tell the user WHERE and HOW MUCH.
import type { ManifoldMod } from './manifoldLoader';
import type { Axis, MeshArrays } from './types';

export interface PrintabilityBand { zLo: number; zHi: number; areaMm2: number }
export interface PrintabilityReport {
  bedAreaMm2: number;          // first-layer contact (adhesion footprint)
  overhangAreaMm2: number;     // total unsupported growth @45° over all layers
  layerStep: number;
  layers: number;
  worstBands: PrintabilityBand[];  // merged height bands with the most overhang
}

const UNIT: Record<Axis, [number, number, number]> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };

interface CS {
  area(): number;
  offset(c: number, join?: string, m?: number, seg?: number): CS;
  subtract(o: CS): CS;
  delete(): void;
}

/** Analyze the standard export set: master_base (plate-down) + each jacket
 *  piece (rim-down). Shared by the worker and the CLI. */
export function analyzePieces(deps: {
  mod: ManifoldMod;
  masterBase: MeshArrays;
  jackets: { name: string; mesh: MeshArrays }[];
  vert: Axis;
  base: number;    // plate top (= jacket bed face)
  crown: number;
  plateT: number;  // master_base's bed face sits plateT below `base`
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
  for (let z = base + layerStep; z <= crown + 1e-9; z += layerStep) {
    const cur = sliceCS(z);
    if (!cur) continue;
    const below = sliceCS(z - layerStep);
    if (below) {
      const dilated = below.offset(slope * layerStep, 'Round', 2, 32);
      const diff = cur.subtract(dilated);
      perLayer.push({ z, area: diff.area() });
      diff.delete();
      dilated.delete();
      below.delete();
    }
    cur.delete();
  }
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

  return {
    bedAreaMm2: Number(bedAreaMm2.toFixed(0)),
    overhangAreaMm2: Number(overhangAreaMm2.toFixed(0)),
    layerStep: Number(layerStep.toFixed(2)),
    layers: perLayer.length,
    worstBands: bands.slice(0, 3).map((b) => ({ zLo: Number(b.zLo.toFixed(1)), zHi: Number(b.zHi.toFixed(1)), areaMm2: Number(b.areaMm2.toFixed(0)) })),
  };
}
