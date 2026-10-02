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
import { isStatusOk, type ManifoldMod } from './manifoldLoader';
import type { MeshArrays } from './types';

export interface MeshAudit {
  tris: number;
  degenerateTris: number;      // exact zero-area faces (double precision)
  watertight: boolean;
  boundaryEdges: number;
  nonManifoldEdges: number;    // HARD defects: >2 faces with unbalanced winding
  pinchedEdges: number;        // tolerated: two CLOSED sheets sharing one edge
                               // (2 forward + 2 reverse faces) — a valid CSG
                               // pinch (e.g. coplanar master/plate contact);
                               // every sheet stays locally closed, slicer-safe
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

/** Merge verts that share a quantization bucket (first occurrence wins).
 *  SIZE FEATURE support: the bucket is scale-relative — it only needs to weld
 *  float32/manifold round-trip seams (≈1e-7 × coordinate), so a fixed 1 µm
 *  bucket would weld real features once the size panel shrinks the master to
 *  cupcake sizes. Mold geometry itself is untouched.
 *
 *  Deliberately BLIND: the kernel emits duplicated vertex patches and
 *  T-junction splits whose stitching REQUIRES merging every coincident vert
 *  at once (validated per-merge welding leaves the patches half-stitched and
 *  multiplies boundary edges — measured boundary 46 → 163). The few
 *  non-manifold fusions this can produce on coplanar geometry are repaired
 *  downstream (repairTopology, then the kernel rescue in cleanExportMesh). */
export function quantizeMerge(vp: Float32Array, tv: Uint32Array, epsOverride?: number): { vp: Float32Array; tv: Uint32Array; merged: number } {
  const n = vp.length / 3;
  let bboxMax = 0;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      const v = Math.abs(vp[i * 3 + c]);
      if (v > bboxMax) bboxMax = v;
    }
  }
  const eps = epsOverride ?? Math.max(1e-4, bboxMax * 2e-6); // mm — ≥ float32 noise, ≪ feature spacing
  const Q = 1 / eps;
  const remap = new Int32Array(n).fill(-1);
  // open-addressing hash over quantized int coords — a string-keyed Map on
  // multi-million-vertex masters allocates millions of strings (minutes);
  // typed hashing with exact bucket verification is seconds
  const q = new Int32Array(n * 3);
  let cap = 1;
  while (cap < n * 2) cap <<= 1;
  const table = new Int32Array(cap).fill(-1); // occupied slots → vertex index
  const outVp = new Float32Array(n * 3);
  let outN = 0;
  for (let i = 0; i < n; i++) {
    const x = vp[i * 3], y = vp[i * 3 + 1], z = vp[i * 3 + 2];
    const qx = Math.round(x * Q), qy = Math.round(y * Q), qz = Math.round(z * Q);
    q[i * 3] = qx; q[i * 3 + 1] = qy; q[i * 3 + 2] = qz;
    let s = (Math.imul(qx, 0x9e3779b1) ^ Math.imul(qy, 0x85ebca77) ^ Math.imul(qz, 0xc2b2ae3d)) & (cap - 1);
    let rep = -1;
    for (; ; s = (s + 1) & (cap - 1)) {
      const j = table[s];
      if (j === -1) { table[s] = i; break; }
      if (q[j * 3] === qx && q[j * 3 + 1] === qy && q[j * 3 + 2] === qz) { rep = j; break; }
    }
    if (rep === -1) {
      remap[i] = outN;
      outVp[outN * 3] = x; outVp[outN * 3 + 1] = y; outVp[outN * 3 + 2] = z;
      outN++;
    } else {
      remap[i] = remap[rep];
    }
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
 * Signed-volume (divergence theorem) of a MeshArrays solid in cm³ — SIZE
 * FEATURE helper: cheap per-part mass estimates for the size/material panel.
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
 * Collapse the closest vert pair of exact-collinear slivers that survived the
 * merge (their coincident corners are float32 round-trip seams).
 */
export function collapseSlivers(vp: Float32Array, tv: Uint32Array, maxDist = 0.1): { vp: Float32Array; tv: Uint32Array } {
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
        // SIZE FEATURE support (export hygiene, not mold geometry): short
        // exact-collinear seams (kernel boolean T-junction caps) must be
        // welded or the scaled-down master/plate union fails the watertight
        // export gate. Bounded at 1 mm — beyond that it is a reported defect,
        // never silently moved.
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

/** Audit a mesh under its own identity (assumes already welded).
 *  Edge bookkeeping uses a typed-array sort of canonical directed keys —
 *  a Map with 10M+ entries costs minutes on multi-million-tri masters; the
 *  sort pass is seconds. Keys are (p*numV+q)*2 + dirBit, exact in float64
 *  for meshes up to ~90M verts. */
export function auditMeshArrays(vp: Float32Array, tv: Uint32Array): MeshAudit {
  const triCount = tv.length / 3;
  const numV = vp.length / 3;
  let degenerateTris = 0;
  const keys = new Float64Array(triCount * 3);
  let ke = 0;
  for (let t = 0; t < triCount; t++) {
    const a = tv[t * 3], b = tv[t * 3 + 1], c = tv[t * 3 + 2];
    if (area2Of(vp, a, b, c) === 0) { degenerateTris++; continue; }
    for (let k = 0; k < 3; k++) {
      const p = tv[t * 3 + k], q = tv[t * 3 + (k + 1) % 3];
      if (p === q) continue;
      keys[ke++] = p < q ? (p * numV + q) * 2 : (q * numV + p) * 2 + 1;
    }
  }
  const view = keys.subarray(0, ke);
  view.sort();
  let boundaryEdges = 0, nonManifoldEdges = 0, pinchedEdges = 0;
  let i = 0;
  while (i < ke) {
    const base = view[i] - (view[i] % 2); // forward canonical key of this edge
    let fwd = 0, rev = 0;
    while (i < ke && view[i] === base) { fwd++; i++; }
    while (i < ke && view[i] === base + 1) { rev++; i++; }
    const total = fwd + rev;
    if (total === 1) boundaryEdges++;
    else if (total > 2) {
      // two CLOSED sheets sharing one edge (2 forward + 2 reverse faces) form
      // a valid CSG pinch — geometrically closed on both sides, slicer-safe.
      // Anything else (3+1 winding, duplicates, >4 faces) is a hard defect.
      if (total === 4 && fwd === 2 && rev === 2) pinchedEdges++;
      else nonManifoldEdges++;
    }
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
    else volumeCm3 += vol / 1000;
  }
  return {
    tris: triCount,
    degenerateTris,
    watertight,
    boundaryEdges,
    nonManifoldEdges,
    pinchedEdges,
    components,
    zeroVolumeComponents,
    // Interior void shells have reversed winding and subtract from the
    // material volume; taking each shell's absolute value overcounts them.
    volumeCm3: Number(Math.abs(volumeCm3).toFixed(1)),
  };
}

/**
 * Deterministic topology repair for weld-merge artifacts. Flat/coplanar
 * geometry (text, signs, plaques) makes the kernel emit near-coincident
 * vertices whose quantized weld leaves T-junctions, zero-area caps and
 * duplicate fins (measured on a flat master: boundary 1 · non-manifold 2 ·
 * 1 degenerate face survived). Index-only repairs, each verified against the
 * edge map:
 *   (a) a zero-area cap whose apex lies on a neighbor's long edge → split the
 *       neighbor edge at the apex and drop the cap;
 *   (b) a boundary edge bridged by a collinear T-junction vertex → split the
 *       edge so both sides register;
 *   (c) exact duplicate faces on a non-manifold edge → drop the duplicate.
 */
export function repairTopology(vp: Float32Array, tv: Uint32Array, maxPasses = 8): Uint32Array {
  const numV = vp.length / 3;
  type Face = [number, number, number];
  let faces: Face[] = [];
  for (let t = 0; t < tv.length / 3; t++) faces.push([tv[t * 3], tv[t * 3 + 1], tv[t * 3 + 2]]);

  const onSegment = (m: number, p: number, q: number): boolean => {
    const px = vp[p * 3], py = vp[p * 3 + 1], pz = vp[p * 3 + 2];
    const qx = vp[q * 3], qy = vp[q * 3 + 1], qz = vp[q * 3 + 2];
    const mx = vp[m * 3], my = vp[m * 3 + 1], mz = vp[m * 3 + 2];
    const ex = qx - px, ey = qy - py, ez = qz - pz;
    const L2 = ex * ex + ey * ey + ez * ez;
    if (L2 === 0) return false;
    const t = ((mx - px) * ex + (my - py) * ey + (mz - pz) * ez) / L2;
    if (t <= 1e-9 || t >= 1 - 1e-9) return false;
    const dx = mx - (px + t * ex), dy = my - (py + t * ey), dz = mz - (pz + t * ez);
    const tol2 = 1e-8; // (0.1 µm)² — weld-split vertices lie exactly on the edge
    return dx * dx + dy * dy + dz * dz <= tol2;
  };

  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false;

    // (c) exact duplicate faces
    {
      const seen = new Set<string>();
      const keep: Face[] = [];
      for (const f of faces) {
        const key = [f[0], f[1], f[2]].sort((x, y) => x - y).join(',');
        if (seen.has(key)) { changed = true; continue; }
        seen.add(key);
        keep.push(f);
      }
      faces = keep;
    }

    // undirected edge → faces
    const edgeFaces = new Map<number, number[]>();
    faces.forEach((f, fi) => {
      for (let k = 0; k < 3; k++) {
        const p = f[k], q = f[(k + 1) % 3];
        const key = p < q ? p * numV + q : q * numV + p;
        (edgeFaces.get(key) ?? edgeFaces.set(key, []).get(key)!).push(fi);
      }
    });
    // adjacency for T-junction search
    const adjacency = new Map<number, Set<number>>();
    for (const key of edgeFaces.keys()) {
      const p = Math.floor(key / numV), q = key % numV;
      (adjacency.get(p) ?? adjacency.set(p, new Set()).get(p)!).add(q);
      (adjacency.get(q) ?? adjacency.set(q, new Set()).get(q)!).add(p);
    }

    const drop = new Set<number>();
    const replace = new Map<number, Face[]>();

    // (a) zero-area caps: apex on a neighbor's long edge → split EVERY face
    // spanning that edge at the apex (a fin over an interior edge has two)
    // and drop the cap
    faces.forEach((f, fi) => {
      const [ia, ib, ic] = f;
      if (ia === ib || ib === ic || ia === ic) { drop.add(fi); changed = true; return; }
      if (area2Of(vp, ia, ib, ic) !== 0) return;
      const pairs: [number, number][] = [[ia, ib], [ib, ic], [ia, ic]];
      let longPair = pairs[0], longLen = -1;
      for (const pr of pairs) {
        const dx = vp[pr[0] * 3] - vp[pr[1] * 3], dy = vp[pr[0] * 3 + 1] - vp[pr[1] * 3 + 1], dz = vp[pr[0] * 3 + 2] - vp[pr[1] * 3 + 2];
        const L = dx * dx + dy * dy + dz * dz;
        if (L > longLen) { longLen = L; longPair = pr; }
      }
      const apex = ia !== longPair[0] && ia !== longPair[1] ? ia : ib !== longPair[0] && ib !== longPair[1] ? ib : ic;
      if (!onSegment(apex, longPair[0], longPair[1])) return;
      const key = longPair[0] < longPair[1] ? longPair[0] * numV + longPair[1] : longPair[1] * numV + longPair[0];
      let splitAny = false;
      for (const ni of edgeFaces.get(key) ?? []) {
        if (ni === fi || drop.has(ni) || replace.has(ni)) continue;
        const n = faces[ni];
        const w = n[0] !== longPair[0] && n[0] !== longPair[1] ? n[0] : n[1] !== longPair[0] && n[1] !== longPair[1] ? n[1] : n[2];
        const [u, v] = longPair;
        const f1: Face = [u, apex, w], f2: Face = [apex, v, w];
        if (area2Of(vp, ...f1) !== 0 && area2Of(vp, ...f2) !== 0) {
          replace.set(ni, [f1, f2]);
          splitAny = true;
          changed = true;
        }
      }
      // drop the cap only where the split re-registers its apex edges — a
      // drop without a split would open the surface into boundary edges
      if (splitAny) drop.add(fi);
    });

    // (b) boundary edges bridged by a T-junction vertex → split the edge
    for (const [key, fl] of edgeFaces) {
      if (fl.length !== 1 || drop.has(fl[0]) || replace.has(fl[0])) continue;
      const p = Math.floor(key / numV), q = key % numV;
      const pN = adjacency.get(p), qN = adjacency.get(q);
      if (!pN || !qN) continue;
      let bridge = -1;
      for (const m of pN) {
        if (m === p || m === q) continue;
        if (qN.has(m) && onSegment(m, p, q)) { bridge = m; break; }
      }
      if (bridge < 0) continue;
      const f = faces[fl[0]];
      const x = f[0] !== p && f[0] !== q ? f[0] : f[1] !== p && f[1] !== q ? f[1] : f[2];
      replace.set(fl[0], [[p, bridge, x], [bridge, q, x]]);
      changed = true;
    }

    if (!changed) break;
    const out: Face[] = [];
    faces.forEach((f, fi) => {
      if (drop.has(fi)) return;
      const rf = replace.get(fi);
      if (rf) out.push(...rf); else out.push(f);
    });
    // drop faces that a repair collapsed
    faces = out.filter((f) => f[0] !== f[1] && f[1] !== f[2] && f[0] !== f[2]);
  }

  const outTv = new Uint32Array(faces.length * 3);
  faces.forEach((f, i) => { outTv[i * 3] = f[0]; outTv[i * 3 + 1] = f[1]; outTv[i * 3 + 2] = f[2]; });
  return outTv;
}

/**
 * One TS cleanup pass: quantize-merge, drop collapsed triangles, collapse
 * near slivers, repair weld-merge topology artifacts, drop zero-volume
 * components (distinct union-find roots are vertex-disjoint by construction,
 * so dropping them cannot open the solid shells).
 */
function cleanOnce(m: MeshArrays): {
  vp: Float32Array; tv: Uint32Array; merged: number; droppedComponents: number;
} {
  const step1 = quantizeMerge(m.vertProperties, m.triVerts);
  const step2 = collapseSlivers(step1.vp, step1.tv);
  // repairTopology rebuilds the mesh face-by-face — on a multi-million-tri
  // master that costs minutes. Pre-audit and run it only when it can actually
  // help (degenerate caps / boundary T-junctions); it has no repair for
  // defect-free meshes or for nm-only residues.
  const pre = auditMeshArrays(step2.vp, step2.tv);
  const tv0 = pre.degenerateTris > 0 || pre.boundaryEdges > 0 || pre.nonManifoldEdges > 0
    ? repairTopology(step2.vp, step2.tv)
    : step2.tv;

  let vp = step2.vp, tv = tv0;
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

  return { vp, tv, merged: step1.merged, droppedComponents };
}

/** Audit score for choosing between cleanup results (higher is better). */
function auditScore(a: MeshAudit): number {
  return (a.watertight ? 100 : 0) - a.nonManifoldEdges * 3 - a.boundaryEdges * 2
    - a.degenerateTris * 4 - a.zeroVolumeComponents - a.pinchedEdges * 3;
}

/**
 * Clean an engine-generated mesh for export. TS cleanup first; when the
 * result still fails the audit and a kernel is available, a KERNEL RESCUE
 * runs: MeshGL.merge() stitches the T-junctions along open edges with the
 * kernel's own tolerant weld and the Manifold constructor re-indexes the
 * surface 2-manifold — repairing fused-sheet edges and boundary residue that
 * pure index surgery cannot (coplanar flat geometry produces both). The
 * rescue is adopted only when it strictly improves the audit.
 *
 * The export gate reads
 * `audit.degenerateTris === 0 && audit.watertight && audit.zeroVolumeComponents === 0`.
 */
export function cleanExportMesh(m: MeshArrays, mod?: ManifoldMod): CleanedMesh {
  const trisBefore = m.triVerts.length / 3;
  let r = cleanOnce(m);
  // STL round-trip contract (reliability brief §13): parseStlBinary welds at a
  // 1 µm grid — any vertex pair closer than that collapses in the reloaded
  // file (and in slicers), turning surviving sub-µm slivers into degenerate
  // faces even though the in-memory audit saw them as valid. Re-weld the
  // export at the parser's own grid and re-clean, so the shipped bytes reload
  // exactly as clean as the audit claims.
  const requantized = quantizeMerge(r.vp, r.tv, 1e-3);
  r = cleanOnce({ vertProperties: requantized.vp, triVerts: requantized.tv });
  let audit = auditMeshArrays(r.vp, r.tv);

  // Reconstruct the unmodified solid before trying further index surgery.
  // Generated CSG meshes may carry redundant boolean vertices which collapse
  // into pinches in the STL weld. Exact kernel simplification can remove those
  // vertices without moving the surface or accepting a pinched alternative.
  if (mod && (audit.pinchedEdges > 0 || !audit.watertight || audit.degenerateTris > 0)) {
    let rebuilt: import('./manifoldLoader').ManifoldInstance | null = null;
    let exact: import('./manifoldLoader').ManifoldInstance | null = null;
    try {
      rebuilt = new mod.Manifold(new mod.Mesh({ numProp: 3, ...m }));
      exact = rebuilt.simplify(0);
      if (isStatusOk(exact)) {
        const dm=exact.getMesh();
        const first=cleanOnce({vertProperties:Float32Array.from(dm.vertProperties), triVerts:Uint32Array.from(dm.triVerts.subarray(0,dm.numTri*3))});
        const welded=quantizeMerge(first.vp,first.tv,1e-3);
        const candidate=cleanOnce({vertProperties:welded.vp,triVerts:welded.tv});
        const a=auditMeshArrays(candidate.vp,candidate.tv);
        if(auditScore(a)>auditScore(audit)){r=candidate;audit=a;}
      }
    } catch { /* retain the candidate with measured diagnostics */ }
    finally { exact?.delete(); rebuilt?.delete(); }
  }

  if (mod && (!audit.watertight || audit.degenerateTris > 0 || audit.zeroVolumeComponents > 0)) {
    try {
      const meshObj = new mod.Mesh({ numProp: 3, vertProperties: r.vp, triVerts: r.tv });
      const mergeFn = (meshObj as unknown as { merge?(): boolean }).merge;
      if (typeof mergeFn === 'function') mergeFn.call(meshObj);
      const man = new mod.Manifold(meshObj);
      if (isStatusOk(man)) {
        const dm = man.getMesh();
        const rescued: MeshArrays = {
          vertProperties: Float32Array.from(dm.vertProperties),
          triVerts: Uint32Array.from(dm.triVerts.subarray(0, dm.numTri * 3)),
        };
        man.delete();
        const r2 = cleanOnce(rescued);
        const audit2 = auditMeshArrays(r2.vp, r2.tv);
        if (auditScore(audit2) > auditScore(audit)) {
          r = { vp: r2.vp, tv: r2.tv, merged: r.merged + r2.merged, droppedComponents: r.droppedComponents + r2.droppedComponents };
          audit = audit2;
        }
      } else {
        man.delete();
      }
    } catch { /* rescue unavailable for this mesh — gate on the TS-only result */ }
  }

  return {
    mesh: { vertProperties: r.vp, triVerts: r.tv },
    stats: { mergedVerts: r.merged, droppedTris: trisBefore - audit.tris, droppedComponents: r.droppedComponents },
    audit,
  };
}
