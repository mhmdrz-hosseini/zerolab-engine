// Moldability analysis on MeshArrays — pure functions, no DOM, Node-testable.
// straightPull is the verified Möller–Trumbore binned ray-cast from the
// benchmarking session (scratch/analyze_stl.mjs), parameterized per axis.

import { AXES, type AnalysisReport, type Axis, type AxisPull, type BBox, type MeshArrays } from './types';

export function computeBBox(m: MeshArrays): BBox {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const vp = m.vertProperties;
  for (let i = 0; i < vp.length / 3; i++) {
    for (let k = 0; k < 3; k++) {
      const v = vp[i * 3 + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  const dim: [number, number, number] = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  return { min, max, dim };
}

/** Hard intake validation — a master with any of these problems cannot generate. */
export function validateMasterMesh(m: MeshArrays): string[] {
  const problems: string[] = [];
  if (m.triVerts.length < 3 || m.vertProperties.length < 9) problems.push('mesh has no usable triangles');
  let nonFinite = 0;
  for (let i = 0; i < m.vertProperties.length; i++) if (!Number.isFinite(m.vertProperties[i])) nonFinite++;
  if (nonFinite > 0) problems.push(`${nonFinite} non-finite vertex coordinates`);
  if (!problems.length) {
    const bb = computeBBox(m);
    if (bb.dim.some((d) => !Number.isFinite(d))) problems.push('bounding box is not finite');
    else if (bb.dim.some((d) => !(d > 0))) problems.push(`degenerate bounding box (${bb.dim.map((d) => d.toFixed(3)).join(' × ')})`);
  }
  return problems;
}

export function signedVolumeMl(m: MeshArrays): number {
  const vp = m.vertProperties, tv = m.triVerts;
  let vol = 0;
  for (let t = 0; t < tv.length / 3; t++) {
    const o = tv[t * 3] * 3, p = tv[t * 3 + 1] * 3, q = tv[t * 3 + 2] * 3;
    const ax = vp[o], ay = vp[o + 1], az = vp[o + 2];
    const bx = vp[p], by = vp[p + 1], bz = vp[p + 2];
    const cx = vp[q], cy = vp[q + 1], cz = vp[q + 2];
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return Math.abs(vol) / 1000;
}

export interface EdgeStats { boundary: number; nonManifold: number; orientationIssues: number }

export function edgeStats(m: MeshArrays, quantUm = 1): EdgeStats {
  const Q = quantUm;
  const vp = m.vertProperties, tv = m.triVerts;
  const vmap = new Map<string, number>();
  const ids = new Uint32Array(tv.length);
  for (let t = 0; t < tv.length / 3; t++) {
    for (let k = 0; k < 3; k++) {
      const vi = tv[t * 3 + k];
      const key = Math.round(vp[vi * 3] * Q) + ',' + Math.round(vp[vi * 3 + 1] * Q) + ',' + Math.round(vp[vi * 3 + 2] * Q);
      let idx = vmap.get(key);
      if (idx === undefined) { idx = vmap.size; vmap.set(key, idx); }
      ids[t * 3 + k] = idx;
    }
  }
  const edges = new Map<string, { n: number; bal: number }>();
  for (let t = 0; t < tv.length / 3; t++) {
    const a = ids[t * 3], b = ids[t * 3 + 1], c = ids[t * 3 + 2];
    for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
      const key = p < q ? p + '_' + q : q + '_' + p;
      let e = edges.get(key);
      if (!e) { e = { n: 0, bal: 0 }; edges.set(key, e); }
      e.n++;
      e.bal += p < q ? 1 : -1;
    }
  }
  let boundary = 0, nonManifold = 0, orientationIssues = 0;
  for (const e of edges.values()) {
    if (e.n === 1) boundary++;
    else if (e.n > 2) nonManifold++;
    if (e.n === 2 && e.bal !== 0) orientationIssues++;
  }
  return { boundary, nonManifold, orientationIssues };
}

export interface PullDetail { pull: AxisPull; mask: Uint8Array; minU: number; minV: number; spanU: number; spanV: number }

/**
 * Straight-pull test: cast a grid of rays along `axis` and count surface
 * crossings per ray. A ray crossing exactly twice is a clean pull; >2 means
 * multi-layer geometry that traps a 2-piece planar jacket on that axis.
 * Also returns the per-column trapped mask (basis of the failure overlay).
 */
export function straightPullDetailed(m: MeshArrays, axis: Axis, grid = 64, onProgress?: (p: number) => void): PullDetail {
  const a = AXES.indexOf(axis);
  const u = (a + 1) % 3, v = (a + 2) % 3;
  const { min, dim } = computeBBox(m);
  const minU = min[u], minV = min[v];
  const spanU = dim[u] || 1e-9, spanV = dim[v] || 1e-9;
  const vp = m.vertProperties, tv = m.triVerts;
  const nT = tv.length / 3;

  // bin triangles by their 2D projection on the ray-perpendicular plane
  const cellTris: number[][] = new Array(grid * grid);
  for (let t = 0; t < nT; t++) {
    const i0 = tv[t * 3], i1 = tv[t * 3 + 1], i2 = tv[t * 3 + 2];
    const pu = [vp[i0 * 3 + u], vp[i1 * 3 + u], vp[i2 * 3 + u]];
    const pv = [vp[i0 * 3 + v], vp[i1 * 3 + v], vp[i2 * 3 + v]];
    const loU = Math.max(0, Math.floor(((Math.min(...pu) - minU) / spanU) * grid));
    const hiU = Math.min(grid - 1, Math.floor(((Math.max(...pu) - minU) / spanU) * grid));
    const loV = Math.max(0, Math.floor(((Math.min(...pv) - minV) / spanV) * grid));
    const hiV = Math.min(grid - 1, Math.floor(((Math.max(...pv) - minV) / spanV) * grid));
    for (let i = loU; i <= hiU; i++) {
      for (let j = loV; j <= hiV; j++) {
        const ci = j * grid + i;
        (cellTris[ci] ??= []).push(t);
      }
    }
  }

  const dir = [0, 0, 0];
  dir[a] = 1;
  const oA = min[a] - dim[a] * 0.5 - 1;
  const mask = new Uint8Array(grid * grid);
  let multi = 0, total = 0, maxC = 0, sumC = 0;

  for (let i = 0; i < grid; i++) {
    for (let j = 0; j < grid; j++) {
      const tris = cellTris[j * grid + i];
      if (!tris) continue;
      const orig = [0, 0, 0];
      orig[u] = minU + ((i + 0.5) / grid) * spanU;
      orig[v] = minV + ((j + 0.5) / grid) * spanV;
      orig[a] = oA;
      let crossings = 0;
      for (let x = 0; x < tris.length; x++) {
        const t = tris[x];
        const i0 = tv[t * 3], i1 = tv[t * 3 + 1], i2 = tv[t * 3 + 2];
        const ax = vp[i0 * 3], ay = vp[i0 * 3 + 1], az = vp[i0 * 3 + 2];
        const bx = vp[i1 * 3], by = vp[i1 * 3 + 1], bz = vp[i1 * 3 + 2];
        const cx = vp[i2 * 3], cy = vp[i2 * 3 + 1], cz = vp[i2 * 3 + 2];
        const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
        const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
        const pvx = e1y * e2z - e1z * e2y, pvy = e1z * e2x - e1x * e2z, pvz = e1x * e2y - e1y * e2x;
        const denom = dir[0] * pvx + dir[1] * pvy + dir[2] * pvz;
        if (Math.abs(denom) < 1e-12) continue;
        const inv = 1 / denom;
        const tvx = orig[0] - ax, tvy = orig[1] - ay, tvz = orig[2] - az;
        const q1 = tvy * e2z - tvz * e2y, q2 = tvz * e2x - tvx * e2z, q3 = tvx * e2y - tvy * e2x;
        const baryU = (dir[0] * q1 + dir[1] * q2 + dir[2] * q3) * inv;
        const r1 = e1y * tvz - e1z * tvy, r2 = e1z * tvx - e1x * tvz, r3 = e1x * tvy - e1y * tvx;
        const baryV = (dir[0] * r1 + dir[1] * r2 + dir[2] * r3) * inv;
        const tHit = (e1x * q1 + e1y * q2 + e1z * q3) * inv;
        if (tHit > 1e-9 && baryU >= 0 && baryV >= 0 && baryU + baryV <= 1) crossings++;
      }
      total++;
      sumC += crossings;
      if (crossings > maxC) maxC = crossings;
      if (crossings > 2) { multi++; mask[j * grid + i] = 1; }
    }
    onProgress?.((i + 1) / grid);
  }

  return {
    pull: { axis, rays: total, trappedPct: total ? (100 * multi) / total : 100, avgCrossings: total ? sumC / total : 0, maxCrossings: maxC },
    mask, minU, minV, spanU, spanV,
  };
}

export function straightPull(m: MeshArrays, axis: Axis, grid = 64, onProgress?: (p: number) => void): AxisPull {
  return straightPullDetailed(m, axis, grid, onProgress).pull;
}

/** Per-column trapped mask for the failure overlay (T003 policy: visual trap region). */
export interface TrapMask { mask: Uint8Array; grid: number; axis: Axis; minU: number; minV: number; spanU: number; spanV: number }
export function trappedColumnMask(m: MeshArrays, axis: Axis, grid = 64): TrapMask {
  const d = straightPullDetailed(m, axis, grid);
  return { mask: d.mask, grid, axis, minU: d.minU, minV: d.minV, spanU: d.spanU, spanV: d.spanV };
}

export function rankAxes(m: MeshArrays, grid = 64, onProgress?: (pct: number) => void): AxisPull[] {
  const axes = AXES.map((ax) => straightPull(m, ax, grid, (p) => onProgress?.(p / 3)));
  return axes.sort((p, q) => p.trappedPct - q.trappedPct);
}

export function buildReport(
  fileName: string,
  full: MeshArrays & { vertCount: number },
  analysis: MeshArrays,
  analysisTris: number,
  grid = 64,
  onProgress?: (stage: string, pct: number) => void,
): AnalysisReport {
  const bbox = computeBBox(full);
  const volumeMl = signedVolumeMl(full);
  onProgress?.('Topology check', 0.1);
  const edges = edgeStats(analysis);
  onProgress?.('Straight-pull ranking', 0.25);
  const axes = rankAxes(analysis, grid, (p) => onProgress?.('Straight-pull ranking', 0.25 + p * 0.7));
  const warnings: string[] = [];
  // Kernel gate (status ok) runs upstream; boundary edges are the hole signal.
  // Non-manifold edges on a DECIMATED mesh are simplification pinches (e.g.
  // fingers collapsing together) — informational, not input defects.
  const watertight = edges.boundary === 0;
  if (!watertight) warnings.push(`Mesh has ${edges.boundary} boundary edges (holes) — repair lands in V0.2`);
  if (full.triVerts.length / 3 > 300000) warnings.push(`${Math.round(full.triVerts.length / 3 / 1000)}k triangles — analysis decimated to ${Math.round(analysisTris / 1000)}k`);
  const best = axes[0];
  if (best.trappedPct > 10) warnings.push(`Best pull axis ${best.axis} still traps ${best.trappedPct.toFixed(1)}% of rays — expect extraction issues`);
  return {
    fileName,
    triCount: full.triVerts.length / 3,
    vertCount: full.vertCount,
    bbox,
    volumeMl,
    watertight,
    boundaryEdges: edges.boundary,
    nonManifoldEdges: edges.nonManifold,
    orientationIssues: edges.orientationIssues,
    axes,
    bestAxis: best.axis,
    analysisTris,
    warnings,
  };
}
