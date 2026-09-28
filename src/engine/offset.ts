// Offset engine — SPEC §4-C. Primary strategy per wayfinder T008 benchmark:
// signed-distance grid + Manifold.levelSet (minkowskiSum banned: 191–303 s
// measured at 81k tris vs 0.36 s levelSet extraction).
//
// ONE grid serves both envelopes: level = −G gives the silicone outer surface S,
// level = −(G+W) gives the jacket outer surface O. Sign via column parity
// (exact for watertight meshes), distance via three-mesh-bvh closest-point
// (exact), gated by a dilated silhouette mask so near-vertical walls are
// correct (a point outside the silhouette can still be within `band` of the
// surface laterally — the 2D-distance-to-projection lower bound makes the
// mask gate safe).
import { MeshBVH } from 'three-mesh-bvh';
import * as THREE from 'three';
import { isStatusOk, type ManifoldInstance, type ManifoldMod } from './manifoldLoader';
import { computeBBox } from './analyze';
import type { MeshArrays } from './types';

export interface SdfGrid {
  data: Float32Array;                  // positive inside, clamped to ±band
  lo: [number, number, number];
  dims: [number, number, number];
  step: number;
  band: number;
}

export interface OffsetOpts {
  gap: number;                         // silicone gap G (mm)
  wall: number;                        // jacket wall W (mm)
  step?: number;                       // grid step mm (0.6 quality, 0.75–1.0 draft)
  onProgress?: (stage: string, pct: number) => void;
}

export async function buildSignedDistanceGrid(mesh: MeshArrays, opts: OffsetOpts): Promise<SdfGrid> {
  const stepIn = opts.step ?? 0.75;
  const band = opts.gap + opts.wall + 2;
  const { min, dim } = computeBBox(mesh);
  // grid-budget cap: the cell count grows with the cube of the master size —
  // a 300 mm master at 0.75 mm would need ~82M cells (minutes of BVH queries
  // and GBs of RAM). Raise the step isotropically when the raw budget exceeds
  // ~24M cells; masters at the 150 mm reference scale keep their exact step.
  const spans = [dim[0] + 2 * band, dim[1] + 2 * band, dim[2] + 2 * band];
  const rawCells = (spans[0] / stepIn) * (spans[1] / stepIn) * (spans[2] / stepIn);
  const MAX_CELLS = 24e6;
  const step = rawCells > MAX_CELLS ? stepIn * Math.cbrt(rawCells / MAX_CELLS) : stepIn;
  const lo: [number, number, number] = [min[0] - band, min[1] - band, min[2] - band];
  const dims: [number, number, number] = [
    Math.ceil((dim[0] + 2 * band) / step) + 1,
    Math.ceil((dim[1] + 2 * band) / step) + 1,
    Math.ceil((dim[2] + 2 * band) / step) + 1,
  ];
  const total = dims[0] * dims[1] * dims[2];
  opts.onProgress?.(`Distance field grid ${dims[0]}×${dims[1]}×${dims[2]}`, 0.12);

  // --- column parity sign: crossings of +Z per (i,j) SDF-grid column ---
  const cols = new Map<number, number[]>();
  const nT = mesh.triVerts.length / 3;
  const vp = mesh.vertProperties, tv = mesh.triVerts;
  for (let t = 0; t < nT; t++) {
    const i0 = tv[t * 3], i1 = tv[t * 3 + 1], i2 = tv[t * 3 + 2];
    const xs = [vp[i0 * 3], vp[i1 * 3], vp[i2 * 3]];
    const ys = [vp[i0 * 3 + 1], vp[i1 * 3 + 1], vp[i2 * 3 + 1]];
    const gx0 = Math.max(0, Math.floor((Math.min(...xs) - lo[0]) / step));
    const gx1 = Math.min(dims[0] - 1, Math.floor((Math.max(...xs) - lo[0]) / step));
    const gy0 = Math.max(0, Math.floor((Math.min(...ys) - lo[1]) / step));
    const gy1 = Math.min(dims[1] - 1, Math.floor((Math.max(...ys) - lo[1]) / step));
    for (let i = gx0; i <= gx1; i++) {
      for (let j = gy0; j <= gy1; j++) {
        const px = lo[0] + (i + 0.5) * step, py = lo[1] + (j + 0.5) * step;
        // Möller–Trumbore, dir = +Z (verified form: t = e1·(t×e2) with the
        // standard convention; see scratch/analyze_stl.mjs derivation)
        const ax = vp[i0 * 3], ay = vp[i0 * 3 + 1], az = vp[i0 * 3 + 2];
        const bx = vp[i1 * 3], by = vp[i1 * 3 + 1], bz = vp[i1 * 3 + 2];
        const cx = vp[i2 * 3], cy = vp[i2 * 3 + 1], cz = vp[i2 * 3 + 2];
        const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
        const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
        const pvz = e1x * e2y - e1y * e2x;
        if (Math.abs(pvz) < 1e-12) continue;
        const inv = 1 / pvz;
        const oZ = lo[2] - 100;
        const tvx = px - ax, tvy = py - ay, tvz = oZ - az;
        const q1 = tvy * e2z - tvz * e2y, q2 = tvz * e2x - tvx * e2z, q3 = tvx * e2y - tvy * e2x;
        const baryU = q3 * inv;                       // dir·(t×e2) = q3
        const baryV = (e1x * tvy - e1y * tvx) * inv;  // dir·(e1×t) = r3
        const tHit = (e1x * q1 + e1y * q2 + e1z * q3) * inv;
        if (tHit > 1e-9 && baryU >= 0 && baryV >= 0 && baryU + baryV <= 1) {
          const key = i * 4096 + j;
          (cols.get(key) ?? cols.set(key, []).get(key)!).push(oZ + tHit);
        }
      }
    }
  }
  let gzmin = Infinity, gzmax = -Infinity;
  for (const a of cols.values()) {
    a.sort((x, y) => x - y);
    if (a[0] < gzmin) gzmin = a[0];
    if (a[a.length - 1] > gzmax) gzmax = a[a.length - 1];
  }
  opts.onProgress?.('Column parity sign', 0.2);

  // --- dilated silhouette mask (Chebyshev, separable): outside it the 3D
  // distance is provably > band, so clamping is safe there ---
  const R = Math.ceil(band / step) + 1;
  const mask = new Uint8Array(dims[0] * dims[1]);
  for (const key of cols.keys()) mask[Math.floor(key / 4096) * dims[1] + (key % 4096)] = 1;
  const dil1 = new Uint8Array(dims[0] * dims[1]);
  for (let i = 0; i < dims[0]; i++) {
    for (let j = 0; j < dims[1]; j++) {
      if (!mask[i * dims[1] + j]) continue;
      for (let dj = -R; dj <= R; dj++) {
        const jj = j + dj;
        if (jj >= 0 && jj < dims[1]) dil1[i * dims[1] + jj] = 1;
      }
    }
  }
  const dil2 = new Uint8Array(dims[0] * dims[1]);
  for (let i = 0; i < dims[0]; i++) {
    for (let j = 0; j < dims[1]; j++) {
      if (!dil1[i * dims[1] + j]) continue;
      for (let di = -R; di <= R; di++) {
        const ii = i + di;
        if (ii >= 0 && ii < dims[0]) dil2[ii * dims[1] + j] = 1;
      }
    }
  }

  // --- exact distance via BVH for band points ---
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(vp, 3));
  geom.setIndex(new THREE.BufferAttribute(tv, 1));
  const bvh = new MeshBVH(geom);
  const query = new THREE.Vector3();
  const hit = { point: new THREE.Vector3(), distance: Infinity, faceIndex: 0 };

  const data = new Float32Array(total);
  const nz = dims[2];
  let queries = 0;
  for (let i = 0; i < dims[0]; i++) {
    for (let j = 0; j < dims[1]; j++) {
      const col = cols.get(i * 4096 + j);
      const px = lo[0] + (i + 0.5) * step, py = lo[1] + (j + 0.5) * step;
      const gated = dil2[i * dims[1] + j] === 1;
      for (let k = 0; k < nz; k++) {
        const pz = lo[2] + (k + 0.5) * step;
        let inside = false;
        let a = 0, b = col ? col.length : 0;
        if (col) {
          while (a < b) { const mid = (a + b) >> 1; if (col[mid] <= pz) a = mid + 1; else b = mid; }
          inside = (col.length - a) % 2 === 1;
        }
        const idx = (i * dims[1] + j) * nz + k;
        if (!gated || !col || pz < gzmin - band || pz > gzmax + band) {
          data[idx] = inside ? band : -band;
          continue;
        }
        // Exact skip: the z-distance to the nearest surface crossing on this
        // column lower-bounds the 3D distance. When it already reaches the
        // band, the exact query would clamp to ±band anyway — skip it
        // (measured: the dominant SDF cost on multi-hundred-thousand-tri
        // masters; output is bit-identical).
        const dzUp = a < col.length ? col[a] - pz : Infinity;
        const dzDown = a > 0 ? pz - col[a - 1] : Infinity;
        if (Math.min(dzUp, dzDown) >= band) {
          data[idx] = inside ? band : -band;
          continue;
        }
        query.set(px, py, pz);
        bvh.closestPointToPoint(query, hit);
        const d = hit.distance;
        queries++;
        const signed = inside ? d : -d;
        data[idx] = signed > band ? band : signed < -band ? -band : signed;
      }
    }
    if (i % 16 === 0) opts.onProgress?.('Distance field (exact BVH queries)', 0.2 + 0.45 * (i / dims[0]));
  }
  opts.onProgress?.(`Distance field done (${queries} exact queries)`, 0.65);
  return { data, lo, dims, step, band };
}

export function makeSdfSampler(grid: SdfGrid): (p: unknown) => number {
  const { data, lo, dims, step, band } = grid;
  const nz = dims[2];
  const hi: [number, number, number] = [
    lo[0] + dims[0] * step,
    lo[1] + dims[1] * step,
    lo[2] + dims[2] * step,
  ];
  return (p: unknown): number => {
    const arr = p as number[] | { x: number; y: number; z: number };
    const x = Array.isArray(arr) ? arr[0] : arr.x;
    const y = Array.isArray(arr) ? arr[1] : arr.y;
    const z = Array.isArray(arr) ? arr[2] : arr.z;
    if (x < lo[0] || x > hi[0] || y < lo[1] || y > hi[1] || z < lo[2] || z > hi[2]) return -band;
    const gx = (x - lo[0]) / step - 0.5, gy = (y - lo[1]) / step - 0.5, gz = (z - lo[2]) / step - 0.5;
    const i = Math.max(0, Math.min(dims[0] - 2, Math.floor(gx)));
    const j = Math.max(0, Math.min(dims[1] - 2, Math.floor(gy)));
    const k = Math.max(0, Math.min(dims[2] - 2, Math.floor(gz)));
    const fx = Math.min(1, Math.max(0, gx - i)), fy = Math.min(1, Math.max(0, gy - j)), fz = Math.min(1, Math.max(0, gz - k));
    const b = (di: number, dj: number, dk: number) => data[((i + di) * dims[1] + (j + dj)) * nz + (k + dk)];
    const c00 = b(0, 0, 0) * (1 - fx) + b(1, 0, 0) * fx;
    const c10 = b(0, 1, 0) * (1 - fx) + b(1, 1, 0) * fx;
    const c01 = b(0, 0, 1) * (1 - fx) + b(1, 0, 1) * fx;
    const c11 = b(0, 1, 1) * (1 - fx) + b(1, 1, 1) * fx;
    return (c00 * (1 - fy) + c10 * fy) * (1 - fz) + (c01 * (1 - fy) + c11 * fy) * fz;
  };
}

/** Extract one iso-surface of the grid as a Manifold solid (level < 0 dilates). */
export function extractIso(mod: ManifoldMod, grid: SdfGrid, level: number): ManifoldInstance {
  const sample = makeSdfSampler(grid);
  const hi: [number, number, number] = [
    grid.lo[0] + grid.dims[0] * grid.step,
    grid.lo[1] + grid.dims[1] * grid.step,
    grid.lo[2] + grid.dims[2] * grid.step,
  ];
  const inst = mod.Manifold.levelSet(sample, { min: [...grid.lo], max: [...hi] }, grid.step, level);
  if (!isStatusOk(inst)) {
    inst.delete();
    throw new Error(`levelSet(${level}) produced non-manifold geometry (status ${String(inst.status())})`);
  }
  return inst;
}

export function instanceToMeshArrays(inst: ManifoldInstance): MeshArrays {
  const dm = inst.getMesh();
  return {
    vertProperties: Float32Array.from(dm.vertProperties),
    triVerts: Uint32Array.from(dm.triVerts.subarray(0, dm.numTri * 3)),
  };
}
