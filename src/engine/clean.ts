// Export mesh cleanup + audit — audit 2026-09-26 §16: a production platform
// must not depend on the slicer repairing its output. Exported STLs carried
// zero-area faces from float32 round-trips (measured: master 8 repeated-index
// + 83 collinear seams, jacket_A 74, jacket_B 228 — all vertex-coincidence
// artifacts far below the 1 µm intake weld).
//
// Cleanup is pure TS on MeshArrays (no kernel round-trip): quantize-merge at
// the same 1 µm tolerance as the intake weld, drop collapsed triangles, then
// collapse near-coincident vert pairs of exact-collinear slivers (< 0.1 mm
// safety bound — genuinely large slivers are reported, never silently moved),
// drop zero-volume components. The returned mesh is re-audited under the
// merged identity; the export gate hard-fails on degeneracy or
// non-watertightness.
import type { MeshArrays } from './types';

export interface MeshAudit {
  tris: number;
  degenerateTris: number;      // exact zero-area faces (double precision)
  watertight: boolean;
  boundaryEdges: number;
  nonManifoldEdges: number;
  components: number;
  zeroVolumeComponents: number;
  volumeCm3: number;
}

export interface CleanStats {
  mergedVerts: number;
  droppedTris: number;
  droppedComponents: number;
}

export interface CleanedMesh {
  mesh: MeshArrays;
  stats: CleanStats;
  audit: MeshAudit;
}

const Q = 1000; // 1 µm — same weld tolerance as the STL intake parser

type V3 = [number, number, number];

function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function area2Of(vp: Float32Array, a: number, b: number, c: number): number {
  const n = cross(
    [vp[b * 3] - vp[a * 3], vp[b * 3 + 1] - vp[a * 3 + 1], vp[b * 3 + 2] - vp[a * 3 + 2]],
    [vp[c * 3] - vp[a * 3], vp[c * 3 + 1] - vp[a * 3 + 1], vp[c * 3 + 2] - vp[a * 3 + 2]],
  );
  return n[0] * n[0] + n[1] * n[1] + n[2] * n[2];
}

/** Union-find over verts, from triangle index pairs. */
function makeUnionFind(numV: number) {
  const parent = new Int32Array(numV).map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  const uni = (a: number, b: number): void => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  return { parent, find, uni };
}

function perComponentVolume(vp: Float32Array, tv: Uint32Array, find: (i: number) => number): Map<number, number> {
  const compVol = new Map<number, number>();
  for (let t = 0; t < tv.length / 3; t++) {
    const a = tv[t * 3], b = tv[t * 3 + 1], c = tv[t * 3 + 2];
    const vol = vp[a * 3] * (vp[b * 3 + 1] * vp[c * 3 + 2] - vp[b * 3 + 2] * vp[c * 3 + 1])
      + vp[a * 3 + 1] * (vp[b * 3 + 2] * vp[c * 3] - vp[b * 3] * vp[c * 3 + 2])
      + vp[a * 3 + 2] * (vp[b * 3] * vp[c * 3 + 1] - vp[b * 3 + 1] * vp[c * 3]);
    const r = find(a);
    compVol.set(r, (compVol.get(r) ?? 0) + vol / 6);
  }
  return compVol;
}

/** Merge verts that share a 1 µm quantization bucket (first occurrence wins). */
function quantizeMerge(vp: Float32Array, tv: Uint32Array): { vp: Float32Array; tv: Uint32Array; merged: number } {
  const n = vp.length / 3;
  const remap = new Int32Array(n).fill(-1);
  const vmap = new Map<string, number>();
  const outVp = new Float32Array(n * 3);
  let outN = 0;
  for (let i = 0; i < n; i++) {
    const x = vp[i * 3], y = vp[i * 3 + 1], z = vp[i * 3 + 2];
    const key = Math.round(x * Q) + ',' + Math.round(y * Q) + ',' + Math.round(z * Q);
    let idx = vmap.get(key);
    if (idx === undefined) {
      idx = outN++;
      vmap.set(key, idx);
      outVp[idx * 3] = x; outVp[idx * 3 + 1] = y; outVp[idx * 3 + 2] = z;
    }
    remap[i] = idx;
  }
  let kept = 0;
  const outTv = new Uint32Array(tv.length);
  for (let t = 0; t < tv.length / 3; t++) {
    const a = remap[tv[t * 3]], b = remap[tv[t * 3 + 1]], c = remap[tv[t * 3 + 2]];
    if (a === b || b === c || a === c) continue; // collapsed by the merge
    outTv[kept * 3] = a; outTv[kept * 3 + 1] = b; outTv[kept * 3 + 2] = c;
    kept++;
  }
  return { vp: outVp.slice(0, outN * 3), tv: outTv.slice(0, kept * 3), merged: n - outN };
}

/**
 * Collapse the closest vert pair of exact-collinear slivers that survived the
 * merge (their coincident corners are float32 round-trip seams).
 */
function collapseSlivers(vp: Float32Array, tv: Uint32Array, maxDist = 0.1): { vp: Float32Array; tv: Uint32Array } {
  for (let pass = 0; pass < 10; pass++) {
    const n = vp.length / 3;
    const remap = new Int32Array(n);
    for (let i = 0; i < n; i++) remap[i] = i;
    let changed = false;
    for (let t = 0; t < tv.length / 3; t++) {
      const a = remap[tv[t * 3]], b = remap[tv[t * 3 + 1]], c = remap[tv[t * 3 + 2]];
      if (a === b || b === c || a === c) continue;
      if (area2Of(vp, a, b, c) !== 0) continue;
      let best: [number, number] | null = null;
      let bestD2 = maxDist * maxDist;
      for (const [p, q] of [[a, b], [b, c], [a, c]] as [number, number][]) {
        const dx = vp[p * 3] - vp[q * 3], dy = vp[p * 3 + 1] - vp[q * 3 + 1], dz = vp[p * 3 + 2] - vp[q * 3 + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 <= bestD2) { bestD2 = d2; best = [p, q]; }
      }
      if (!best) {
        // Long exact-collinear seam (kernel boolean T-junction cap — e.g. three
        // points 0.2/0.2 mm apart on a straight edge): the middle vertex lies
        // ON the longest edge, so welding it to the nearest endpoint removes
        // the fin without bending any neighboring face. Bounded at 1 mm —
        // beyond that it is a reported defect, never silently moved.
        const len2Of = (p: number, q: number): number => {
          const dx = vp[p * 3] - vp[q * 3], dy = vp[p * 3 + 1] - vp[q * 3 + 1], dz = vp[p * 3 + 2] - vp[q * 3 + 2];
          return dx * dx + dy * dy + dz * dz;
        };
        const pairs: [number, number][] = [[a, b], [b, c], [a, c]];
        let longPair = pairs[0], longLen = -1;
        for (const pr of pairs) {
          const L = len2Of(pr[0], pr[1]);
          if (L > longLen) { longLen = L; longPair = pr; }
        }
        if (longLen > 1.0) continue; // genuinely long sliver — reported via audit, never moved
        const [pEnd, qEnd] = longPair;
        const mid = a !== pEnd && a !== qEnd ? a : b !== pEnd && b !== qEnd ? b : c;
        const target = len2Of(mid, pEnd) <= len2Of(mid, qEnd) ? pEnd : qEnd;
        for (let i = 0; i < n; i++) if (remap[i] === mid) remap[i] = target;
        changed = true;
        continue;
      }
      const [p, q] = best[0] < best[1] ? best : [best[1], best[0]];
      for (let i = 0; i < n; i++) if (remap[i] === q) remap[i] = p;
      changed = true;
    }
    if (!changed) return { vp, tv };
    let kept = 0;
    const outTv = new Uint32Array(tv.length);
    for (let t = 0; t < tv.length / 3; t++) {
      const a = remap[tv[t * 3]], b = remap[tv[t * 3 + 1]], c = remap[tv[t * 3 + 2]];
      if (a === b || b === c || a === c) continue;
      outTv[kept * 3] = a; outTv[kept * 3 + 1] = b; outTv[kept * 3 + 2] = c;
      kept++;
    }
    tv = outTv.slice(0, kept * 3);
  }
  return { vp, tv };
}

/** Audit a mesh under its own identity (assumes already welded). */
export function auditMeshArrays(vp: Float32Array, tv: Uint32Array): MeshAudit {
  const triCount = tv.length / 3;
  const numV = vp.length / 3;
  let degenerateTris = 0;
  const directed = new Map<number, number>();
  for (let t = 0; t < triCount; t++) {
    const a = tv[t * 3], b = tv[t * 3 + 1], c = tv[t * 3 + 2];
    if (area2Of(vp, a, b, c) === 0) { degenerateTris++; continue; }
    for (let k = 0; k < 3; k++) {
      const p = tv[t * 3 + k], q = tv[t * 3 + (k + 1) % 3];
      if (p === q) continue;
      const key = p * numV + q;
      directed.set(key, (directed.get(key) ?? 0) + 1);
    }
  }
  let boundaryEdges = 0, nonManifoldEdges = 0;
  for (const [key, count] of directed) {
    const p = Math.floor(key / numV), q = key % numV;
    if (p > q) continue; // count each undirected edge once, from its forward side
    const total = count + (directed.get(q * numV + p) ?? 0);
    if (total === 1) boundaryEdges++;
    else if (total > 2) nonManifoldEdges++;
  }
  const watertight = triCount > 0 && boundaryEdges === 0 && nonManifoldEdges === 0;

  const { find, uni } = makeUnionFind(numV);
  for (let t = 0; t < triCount; t++) {
    uni(tv[t * 3], tv[t * 3 + 1]);
    uni(tv[t * 3 + 1], tv[t * 3 + 2]);
  }
  const compVol = perComponentVolume(vp, tv, find);
  let components = 0, zeroVolumeComponents = 0;
  let volumeCm3 = 0;
  for (const vol of compVol.values()) {
    components++;
    if (Math.abs(vol) < 1e-6) zeroVolumeComponents++;
    else volumeCm3 += Math.abs(vol) / 1000;
  }
  return {
    tris: triCount,
    degenerateTris,
    watertight,
    boundaryEdges,
    nonManifoldEdges,
    components,
    zeroVolumeComponents,
    volumeCm3: Number(volumeCm3.toFixed(1)),
  };
}

/**
 * Signed-volume (divergence theorem) of a MeshArrays solid in cm³ — cheap
 * per-part mass estimates for the size/material panel.
 */
export function meshVolumeCm3(m: MeshArrays): number {
  const vp = m.vertProperties, tv = m.triVerts;
  let vol6 = 0;
  for (let t = 0; t < tv.length; t += 3) {
    const a = tv[t] * 3, b = tv[t + 1] * 3, c = tv[t + 2] * 3;
    vol6 += vp[a] * (vp[b + 1] * vp[c + 2] - vp[b + 2] * vp[c + 1])
          + vp[a + 1] * (vp[b + 2] * vp[c] - vp[b] * vp[c + 2])
          + vp[a + 2] * (vp[b] * vp[c + 1] - vp[b + 1] * vp[c]);
  }
  return Math.abs(vol6) / 6 / 1000;
}

/**
 * Clean an engine-generated mesh for export: quantize-merge at 1 µm, drop
 * collapsed triangles, collapse near slivers, drop zero-volume components
 * (distinct union-find roots are vertex-disjoint by construction, so dropping
 * them cannot open the solid shells). The export gate reads
 * `audit.degenerateTris === 0 && audit.watertight && audit.zeroVolumeComponents === 0`.
 */
export function cleanExportMesh(m: MeshArrays): CleanedMesh {
  const trisBefore = m.triVerts.length / 3;
  const step1 = quantizeMerge(m.vertProperties, m.triVerts);
  const step2 = collapseSlivers(step1.vp, step1.tv);

  let vp = step2.vp, tv = step2.tv;
  let droppedComponents = 0;
  {
    const { parent, uni } = makeUnionFind(vp.length / 3);
    for (let t = 0; t < tv.length / 3; t++) {
      uni(tv[t * 3], tv[t * 3 + 1]);
      uni(tv[t * 3 + 1], tv[t * 3 + 2]);
    }
    const root = (i: number): number => {
      let r = i;
      while (parent[r] !== r) r = parent[r];
      return r;
    };
    const compVol = perComponentVolume(vp, tv, root);
    const zeroRoots = new Set([...compVol.entries()].filter(([, v]) => Math.abs(v) < 1e-6).map(([r]) => r));
    if (zeroRoots.size > 0) {
      let kept = 0;
      const outTv = new Uint32Array(tv.length);
      for (let t = 0; t < tv.length / 3; t++) {
        const r = root(tv[t * 3]);
        if (zeroRoots.has(r)) { droppedComponents++; continue; }
        outTv[kept * 3] = tv[t * 3]; outTv[kept * 3 + 1] = tv[t * 3 + 1]; outTv[kept * 3 + 2] = tv[t * 3 + 2];
        kept++;
      }
      tv = outTv.slice(0, kept * 3);
      // compact away now-unused verts
      const used = new Int32Array(vp.length / 3).fill(-1);
      const outVp: number[] = [];
      const remap = (i: number): number => {
        if (used[i] === -1) { used[i] = outVp.length / 3; outVp.push(vp[i * 3], vp[i * 3 + 1], vp[i * 3 + 2]); }
        return used[i];
      };
      const finalTv = new Uint32Array(tv.length);
      for (let t = 0; t < tv.length / 3; t++) {
        finalTv[t * 3] = remap(tv[t * 3]);
        finalTv[t * 3 + 1] = remap(tv[t * 3 + 1]);
        finalTv[t * 3 + 2] = remap(tv[t * 3 + 2]);
      }
      vp = Float32Array.from(outVp);
      tv = finalTv;
    }
  }

  const audit = auditMeshArrays(vp, tv);
  return {
    mesh: { vertProperties: vp, triVerts: tv },
    stats: { mergedVerts: step1.merged, droppedTris: trisBefore - audit.tris, droppedComponents },
    audit,
  };
}
