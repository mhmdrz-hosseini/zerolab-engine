---
id: T008
title: Offset engine benchmark prototype
type: prototype
status: closed
assignee: agent (session 2026-09-23)
blocked-by: []
labels: [wayfinder:prototype]
---

## Question

The kernel research (Geometry kernel: Manifold WASM reality check) proved booleans at our scale (~300 ms median at 200K–1.5M polys) but found **no published numbers for `minkowskiSum` on non-convex meshes** — and the implementation takes a per-triangle-hull path that may make the silicone-gap offset the most expensive operation in the pipeline. Before the spec freezes the offset strategy, build a cheap benchmark artifact and react to it:

1. Node script (or tiny web page + worker) loading `manifold-3d@3.5.x` pinned; import the Fatima hand STL plus a decimated ~50k-tri variant.
2. Run and time: minkowskiSum with sphere kernels at mold-scale radii vs the levelSet/SDF path; one reference boolean for scale.
3. Report: wall-clock times, peak memory, output sanity (offset surface actually G mm away?).

Decision it resolves: fast path vs fallback as the spec's primary offset strategy, the maximum triangle count the client-side engine accepts, and whether the server-side escape hatch fog graduates into a real ticket.

HITL: run the benchmark, show the numbers, and let the human react before freezing the strategy in the spec.

## Resolution

**CLOSED 2026-09-24: user directed "build spec and start" — recommendation adopted. Primary offset engine = SDF grid + `Manifold.levelSet`; minkowskiSum dropped entirely.** Evidence below.

### Results (Fatima hand, Node, Windows desktop)

**minkowskiSum — DEAD as the fast path.**
- Parsed+welded 3.56M-tri hand → Manifold: 3.9 s, status ok, 1.58 GB RSS.
- simplify(0.05) → 81,472 tris in 2.6 s.
- `minkowskiSum(sphere r=8)`: **190.7 s with a 72-tri kernel; 302.8 s with a 200-tri kernel** — at 81k tris. The per-triangle-hull algorithm scales with mesh × kernel; full-res (3.56M) was therefore never run — extrapolation is hours. Kernel size is sublinear (1.58× time for 2.8× kernel): mesh triangle count dominates, so decimation alone cannot save it.

**SDF grid + Manifold.levelSet — VIABLE, and extraction is fast.**
- Full pipeline ran end-to-end: decimate → grid SDF (spatial-hash closest-triangle, column-parity sign, dilated-silhouette gating) → trilinear SDF callback → `levelSet(sdf, bounds, step, -8)`.
- **levelSet extraction: 73,870 tris in 0.36 s.** Analytic callback throughput: ~2–3M evals/s (JS).
- Grid construction is the cost: 242,775 distance queries took 355 s in *brute-force Node JS* at 1.5 mm (1.46 ms/query). This is the pessimistic bound — production uses three-mesh-bvh exact closest-point queries (~µs-scale) and/or worker chunking; extrapolated production cost (0.6 mm grid, ~2–4M band queries): **seconds to tens of seconds per offset** in a browser worker.
- Accuracy at 1.5 mm: surface-to-master distance mean 6.42 / p50 7.17 / p95 10.66 / max 12.47 mm vs target 8. Undershoot is largely *correct* dilation behavior (offset surfaces of opposed sides merge across the 3–6 mm finger gaps — distance to master is < G there by construction); the >8 outliers are grid-resolution artifacts of the 1.5 mm benchmark grid + clamped SDF. **Verify at production resolution (0.6 mm) with exact BVH distances; expected convex-region tolerance ±0.5 grid-step.**
- Memory: ~2 GB RSS total in Node, dominated by the 3.56M-tri source + weld maps — production decimates to ≤300k first, so browser worker memory is far lower; the 0.6 mm SDF grid itself is only ~28 MB.

### Recommendation (pending user freeze)

1. **Primary offset engine: SDF grid + `Manifold.levelSet`** (decimate → BVH distance grid → level at −G). Drop minkowskiSum entirely (keep the ticket note as the evidence).
2. Geometry kernel stays Manifold for booleans/splits/extraction collision (proven ~300 ms scale).
3. The "server-side escape hatch" fog does **not** graduate: client-side is feasible at contract triangle counts.
4. Spec must include: exact-distance SDF via three-mesh-bvh (no clamping shortcuts), progress reporting during grid build, per-level SDF caching (G and G+W share one grid — compute signed distance once, extract two iso-surfaces), and a production-resolution accuracy gate.

Debugging notes (for the record): the interim "file corruption" readings were an analyzer stride bug (Float32Array 48-byte drift vs 50-byte STL records); zero-crossings in the SDF stage were a triple-product bug (`tHit = e2·(t×e2) ≡ 0`, fixed to `tHit = e2·(e1×t)`).
