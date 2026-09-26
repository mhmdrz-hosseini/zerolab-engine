---
id: T002
title: Image-to-3D output reality check
type: research
status: closed
assignee: research-agent
blocked-by: []
labels: [wayfinder:research]
---

## Question

The mold module's input is whatever the upstream image-to-3D stage produces — not a hand-crafted STL. To write the input contract, establish what current image-to-3D services and open models actually output:

1. For Meshy, Tripo3D, Rodin/Hyper3D, Luma Genie, TRELLIS, Hunyuan3D, and similar: output formats (GLB/OBJ/STL/FBX), default and maximum triangle counts, and API cost/latency.
2. Are these meshes watertight/manifold in practice? Self-intersection prevalence? Thin-wall and fused-limb artifacts (critical: fingers, like the Fatima hand)?
3. Community experience on printability of these meshes (mesh repair typically needed?).
4. What triangle budget and watertightness requirement is realistic for the input contract, and how much repair workload lands on the mold module?

## Resolution

**Verdict: GLB is the one universal format (STL is natively exported by all big services — my draft claim was outdated); API services deliver 10k–300k tris but open models deliver 100k–1M+ with no decimation; nobody guarantees watertightness (vendors ship their own repair guides); repair belongs in an upstream platform-owned stage and the mold module runs a hard validation gate with diagnostics.**

Per-service (verified against current docs, Sept 2026):

| Service | Formats | Triangles | Cost/gen | Latency | Watertight reputation |
| --- | --- | --- | --- | --- | --- |
| Meshy (meshy-6/7.1) | GLB, FBX, OBJ, USDZ, STL (+3MF on request) | `target_polycount` 100–300k, **default 30k** | ~$0.40–$0.70 | ~60–90s | Hollow 1-wall shells reported; repair needed |
| Tripo (VAST v3.x) | GLB/GLTF/FBX/OBJ/USDZ/STL | `face_limit` **default 10k**; quads ≤150k (quad forces FBX) | ~$0.20–$0.40 | ~30–120s | Publishes its own "make AI models watertight" guide |
| Rodin/Hyper3D (Deemos) | GLB, USDZ, FBX, OBJ, STL | Unpublished; custom polycount override; Gen-2.5 claims 10M+ raw | $0.40 base, HighPack $1.20 | up to ~10 min (official polling) | "Production-ready" marketing, no guarantee |
| TRELLIS.2-4B (MS, MIT, open) | GLB | voxel 512³–1536³; example decimation_target **1M** | self-hosted | 3–60s on H100 | Ships hole-filling scripts itself |
| Hunyuan3D 2.x (Tencent, open) | glb/obj | octree 256 default → hundreds of thousands of faces | self-hosted | tens of seconds | Tencent tutorial: too-dense + non-manifold edges |
| Luma Genie | — | — | — | — | **Discontinued Jan 1, 2026** |

Claim corrections vs my draft: (a) STL **is** natively exported by Meshy/Tripo/Rodin — "GLB only" was outdated; (b) "open models decimate to 30k–100k" **refuted** — TRELLIS.2/Hunyuan ship 100k–1M+ raw; (c) cost floor is ~$0.10 first-party, not $0.05; (d) Rodin counts unverified (no official numbers).

**Input contract for the spec** (the deliverable):
- Accept **GLB (primary), OBJ+MTL, STL**; FBX/USDZ = conversion tier, not contract. STL strips textures — fine, a mold only cares about geometry, but detail baked into textures is lost (warn the user).
- Triangle budget: accept **5k–500k**; hard reject/decimate above **1M**; internally normalize to ~50k–150k before booleans; **prefer requesting 20k–50k from the generator** (Meshy 30k, Tripo 10–20k) so the service does the first decimation.
- **Scale: never trust native units** — all generators deliver a normalized unit cube (TRELLIS [-0.5,0.5]³, Hunyuan centered cube). Require user confirmation of physical bounding-box size (mm) before mold operations.
- Expected defect list (all routine, none edge-case): non-manifold edges/vertices, boundary holes, self-intersections, zero-thickness fins/hollow 1-wall shells, degenerate sliver triangles, unwelded duplicated vertices, flipped normals, meaningless units, texture-baked detail.
- **Repair placement: upstream of the mold module** — a platform-owned, non-user-facing stage right after mesh generation: weld → orient → hole-fill → solidify/min-wall enforcement → voxel remesh → decimate. The mold module then runs a **hard validation gate** (watertight, manifold, min feature size vs mold wall/parting thickness) and **fails with diagnostics rather than repairing itself**. Rationale: boolean offsets and split extraction need a clean solid, and every vendor's own docs agree generation never delivers one.

Sources: docs.meshy.ai/en/api/image-to-3d · developers.tripo3d.ai · github.com/DeemosTech/rodin3d-skills · huggingface.co/microsoft/TRELLIS.2-4B · github.com/Tencent-Hunyuan/Hunyuan3D-2 · fal.ai/models/fal-ai/tripo · tencentcloud.com tutorial · r/3Dprinting threads (1k4m4r7, 1qtiyuu, 1sgh403, 1q4q9uo) · tripo3d.ai watertight guide
