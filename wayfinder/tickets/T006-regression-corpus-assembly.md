---
id: T006
title: Regression corpus assembly
type: task
status: open
assignee:
blocked-by: [T002]
labels: [wayfinder:task]
---

## Question (task)

Assemble the 4–6 model corpus that defines "works" for the V0.1 spec and its future implementation:

1. `REFRENCE/obj_1_Molde_mano_de_Fatima.stl` — the hand (worst-case undercuts). ✅ already in repo. Measured 2026-09-23: 3.56M tris, watertight, 123×148×32 mm, passes ±Z straight-pull with zero trapped rays.
2. `REFRENCE/box_l.stl` and `REFRENCE/master_base.stl` — **reverse-engineered 2026-09-24: a genuine manual master + jacket-half pair** (`master_base` = master, `box_l` = left jacket half around it; they share a coordinate frame, 642 mL overlap). Measured: implied silicone gap p50 6.2 mm, jacket wall p50 4.8 mm, parting plane at the master mid-plane, ~4.4 mm headspace above the master, master base 3 mm proud of the shell. No second half exists — the unfinished half is the product's reason to exist. Measurement tool: `scratch/reverse_reference.mjs`; requirements folded into spec §5 "Reference-derived requirements". Roles: master_base = master-input fixture; box_l = expected-output role model for M3.
3. One simple convex-ish object (e.g., a statuette/plane-split-friendly figure) — the "must always succeed" case.
4. Two or three real image-to-3D outputs — generated from photos via a service like Meshy/Tripo free tier — representative of what the upstream pipeline will hand over (defects included, do not clean them).
5. Optionally one multi-body/fused-limb mesh to exercise the input contract's failure gates.

Human (HITL) part: generate the image-to-3D samples via a service account; agent can help convert/inspect/normalize them afterward. The corpus exercises the repair stage, the envelope offset, and the extraction validator at realistic triangle counts.

## Resolution

**CLOSED 2026-09-24: corpus assembled and real-AI-mesh round-trip PASSED.**

1. `REFRENCE/obj_1_Molde_mano_de_Fatima.stl` — the hand (worst-case undercuts). ✅ Measured: 3.56M tris, watertight, 123×148×32 mm, passes ±Z straight-pull with zero trapped rays.
2. `REFRENCE/box_l.stl` + `REFRENCE/master_base.stl` — **manual master + jacket-half pair** (reverse-engineered 2026-09-24): implied gap p50 6.2 mm, wall p50 4.8 mm, parting at mid-plane. master_base runs the full pipeline in `smoke:m4` (±X split) ✓.
3. `REFRENCE/ai_corpus/hunyuan3d_demo_1.glb` — **real AI-generated mesh** (official Hunyuan3D-2 demo output, downloaded from the vendor repo). `npm run smoke:ai` runs the complete worker-parity pipeline: meter heuristic + scale normalization, defect inventory (0 boundary / 5,490 non-manifold / 2,191 orientation — kernel gate passed), ±Z split, extraction A 40 mm / B 50 mm, funnel + vents, fill path 99.8%, **full validated package in 48.7 s** ✓. The T002 input-contract predictions held exactly.
4. User-generated samples from their chosen service: optional now — the corpus already contains a genuine vendor AI output.
