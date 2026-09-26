---
id: T001
title: Geometry kernel: Manifold WASM reality check
type: research
status: closed
assignee: research-agent
blocked-by: []
labels: [wayfinder:research]
---

## Question

The brainstorm proposes Manifold WASM as the boolean/offset kernel (minkowskiSum for dilation, levelSet as fallback) inside browser Web Workers. Verify this is real and sufficient before the spec commits to it:

1. Does the npm `manifold-3d` WASM build actually expose booleans, `minkowskiSum`, `levelSet`, split, and three.js mesh conversion? Exact API names and version.
2. What are the practical performance/memory limits in a browser worker — boolean ops and Minkowski dilation on 100k–500k-triangle AI-generated meshes?
3. What input does Manifold require (watertight? winding? self-intersections?) and what repair/simplify utilities does it ship?
4. What is the realistic strategy for a constant-distance offset (silicone gap) at those triangle counts, and what is the fallback if Minkowski with a sphere kernel is too slow?
5. License, bundle size, and the worker usage pattern.

Resolution decides the kernel + offset strategy section of the V0.1 spec.

## Resolution

**Verdict: manifold-3d v3.5.3 (Apache-2.0 — not MIT, still commercial-safe) is the primary kernel; booleans are proven at our scale, but `minkowskiSum` is brand-new in JS and unbenchmarked on non-convex meshes → benchmark it first (graduated into [Offset engine benchmark prototype](T008-offset-engine-benchmark-prototype.md)); levelSet+SDF fallback confirmed viable.**

Verified findings (full source list at bottom):

1. **API confirmed** (v3.5.3 .d.ts): instance `add/subtract/intersect`, static `Manifold.union/difference/intersection`, `split`, `splitByPlane`, `trimByPlane`; **`minkowskiSum`/`minkowskiDifference`** — but JS bindings only shipped in v3.4.0 (Mar 2026, PR #1501); `static Manifold.levelSet(sdf, bounds, edgeLength, level?, tolerance?)`; `setTolerance`/`simplify`/`refineToTolerance`; `Mesh` class with `vertProperties`/`triVerts`/`merge()`; official three.js marshaling example exists (manifoldcad.org/three.html).
2. **Version/license/size**: v3.5.3 (2026-09-07); **Apache-2.0** (patent grant included); core = `manifold.wasm` 541 KB + glue 75 KB ≈ **616 KB raw** (the 2.76 MB npm unpacked figure includes optional ManifoldCAD/gltf infra we won't ship).
3. **Performance**: third-party benchmark (Polydera, 2026): Manifold 3.5 WASM, **median 303 ms per union on 200K–1.5M-poly operands, manifold output on all 1000 pairs**. Maintainer: WASM build is single-threaded ("still fast"). Repo issue #1138: MeshGL→Impl construction of a 1M-tri mesh ≈ 139 ms — construction is ~1/3 of round-trip cost; keep inputs indexed/deduplicated. **No published benchmark exists for minkowskiSum on 100k–500k-tri non-convex meshes** — and the implementation (src/minkowski.cpp) takes a "Slower" path for non-convex inputs: ~one convex hull + one union per triangle of the mesh. Extrapolation says this may be the most expensive op in the pipeline. **Benchmark before committing.**
4. **Sphere-kernel error (computed, not cited)**: inscribed icosphere radial undershoot: 80 faces → 6.6%, 320 → 1.78%, 1,280 → 0.45% of radius r. Use `Manifold.sphere(r, segments)` with 320–1,280 faces, cached; inflate r by the known fraction for conservatism. Cost driver is non-convexity of the mesh, not kernel triangle count.
5. **Input requirements**: Manifold is **not a repairer** — needs topologically-manifold-by-index input; self-overlaps tolerated but geometrically wrong near overlaps; check `status()` after construction; `Mesh.merge()` is best-effort vertex welding for duplicated-vertex geometry. `setTolerance` both simplifies and tracks output precision. **Explicit `.delete()` required** for every Manifold/CrossSection (no GC on WASM objects); run cleanup in try/finally.
6. **levelSet fallback confirmed**: Marching Tetrahedra on a BCC grid, guaranteed-manifold output regardless of input pathology — exactly what's wanted for AI-mesh garbage. Supply SDF via winding-number sign + BVH unsigned distance (three-mesh-bvh); `level = -offset`; precompute distance field on a grid and interpolate (a 300 mm part at 0.5 mm edgeLength ≈ 4.3M evaluations).
7. **Worker pattern**: ManifoldCAD's own worker is the official precedent (persistent lazily-loaded module, message protocol, per-run `garbageCollector.cleanup()`, error = fatal → re-instantiate worker). Init: `import Module from 'manifold-3d'; const wasm = await Module(); wasm.setup();`. Transferable typed arrays in/out have no official example but are trivially supported.
8. **Cheap 2D path**: `CrossSection.offset(delta, JoinType.Round, …, circularSegments)` + `extrude()` is a mature Clipper-style implementation — orders of magnitude cheaper for prismatic mold features (flanges, ribs, base plate, vent bores).
9. **Watch item**: a `boolean2` rewrite is in progress on master — **pin the exact npm version** in CI.

**Decision for the spec**: Manifold WASM as primary kernel (pinned v3.5.x); worker pattern per ManifoldCAD; offset strategy = icosphere-kernel `minkowskiSum` **pending the benchmark prototype**, with `levelSet`+BVH-SDF as the robust fallback and `CrossSection.offset` for prismatic features; strict `.delete()`/`status()` discipline; pre-Manifold repair is a separate engine stage (see the image-to-3D contract ticket).

**UPDATE 2026-09-23 — benchmark outcome ([Offset engine benchmark prototype](T008-offset-engine-benchmark-prototype.md)):** `minkowskiSum` measured at 190–303 s on an 81k-tri mesh (per-triangle-hull scaling confirmed) → **dead as the fast path**. The offset strategy flips: **SDF grid + `levelSet` is the primary** (extraction measured at 0.36 s for 74k tris; grid build is the real cost and moves to three-mesh-bvh in production). Booleans/splits/extraction still use Manifold exactly as recommended here.

Sources: github.com/elalish/manifold (README, v3.5.3 .d.ts, src/minkowski.cpp, src/sdf.cpp, bindings/wasm/lib/worker.ts, issues #1138, PRs #666/#663/#1501) · npmjs.com/package/manifold-3d · manifoldcad.org/docs/jsapi + /docs/jsuser · polydera.com/algorithms/browser-mesh-boolean-libraries-2026 · data.jsdelivr.com/v1/packages/npm/manifold-3d@3.5.3
