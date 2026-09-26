---
id: T004
title: V0.1 feature cut & parameter freeze
type: grilling
status: closed
assignee: agent (session 2026-09-24)
blocked-by: [T003, T008]
labels: [wayfinder:grilling]
---

## Question

The brainstorm lists nine engine stages (A–J) with a V0.1/V0.2/V1.0 tiering. Freeze the actual V0.1 cut. Per stage, decide in or out for V0.1:

- Contoured seams vs planar-only parting?
- Radial 3/4-piece splits (likely governed by the failure-policy ticket)?
- Automatic vent placement (air-trap flood solver) vs fixed top funnel + manual vents?
- Adaptive/local silicone thickness vs one global gap?
- Orientation optimizer: full angular sweep vs axis candidates?
- Extraction simulation fidelity: coarse voxel sweep vs precise BVH collision walk?
- Clamping: one system (M3 captive nut) vs user-selectable?
- Fill/vent port dragging in the viewer?

Also freeze the parameter set and defaults exposed to the user (silicone gap presets, jacket wall, clearances, printer profiles) — the audience is idea-first non-CAD users, so every extra parameter is a UX cost. Output: the stage-by-stage in/out table for the spec.

## Resolution

**CLOSED 2026-09-24: cut frozen as part of the V0.1 build spec (§4, §5, §6), adopting the policies from the failure-policy and offset-strategy tickets. Summary of the freeze:**

| Feature | V0.1 | Later |
| --- | --- | --- |
| Import | STL binary only (GLB/OBJ → M5) | GLB, OBJ, 3MF |
| Repair | weld 1µm + Manifold status gate | hole-fill, solidify, voxel remesh |
| Analysis | bbox/volume/watertight + 6-direction straight-pull ranking | angular sweep, curvature, air-trap solver |
| Silicone | constant gap G, presets 6/8/10 mm | adaptive/local thickness |
| Jacket | constant wall W, SDF offset, one grid two iso-surfaces | variable wall, ribs |
| Split | 2-piece planar at ranked best axis | contoured seams, radial 3/4-piece, local cores, parting editor |
| Extraction | incremental translation sweep vs silicone+master, ranked auto-retry | BVH precise walk, trap-region mesh overlay refinement |
| Base | flat-base plate with recess + alignment | pedestal for unstable figurines |
| Joining | stepped registration lip + outer flange + 4× M3 bolt bosses + captive nuts (single system) | clips, U-clamps, tape groove |
| Ports | top funnel Ø14/8 mm + 2 automatic vents Ø2 mm at gap high points | flood-solver vents, draggable ports |
| Validation | gates: watertight, min gap, min wall, piece manifold, extraction pass, fill-path reach | flow simulation |
| Export | STL set + project.json + assembly.md, zipped | 3MF, PDF instructions, embed API |
| Printer | FDM preset (clearance 0.25) + Resin preset (0.15) | calibration profile system |

Parameter freeze: G presets {Small 6, Standard 8, Rugged 10} mm · W {FDM 3, Resin 2} mm · flange 10×5 mm · M3 bolts ×4 · funnel Ø14→8 mm · vents Ø2 mm · joint clearance FDM 0.25 / Resin 0.15 mm · user-confirmed physical height 30–300 mm.