# V0.3 Execution — Reverse-Engineer the Cute Sheep Ideal, Iterate to Parity, Validate on Spiderman

Execute the existing feedback plan `docs/superpowers/plans/2026-09-25-open-mold-reference-fix.md` to software completion, in an order that front-loads your three named gaps (joining edge, top open entry, overall shape), with a measurable sheep-vs-reference iteration loop, then validate on Spiderman. The acceptance contract is `docs/MOLD-REFERENCE-DESIGN.md`.

## Verified current state (working tree audit)

Prototype partially executed: envelope.ts (smooth loft) + seam/rails/foot in split.ts are in; regression_release passes. BLOCKED: regression_mold FAILS (Float32 export round-trip re-fragments a thin projection into 11 components); gates.ts crown check is height-only; pickFrame vertex-count ranking unstable under tessellation; smoke_v02 silently rescales; OUTPUT/pourbox_patron_v03 predates latest edits. Missing entirely: compare_molds.py, validation_v03, regression_frame/envelope/gates, joints.ts, release.ts, pipeline.ts, generate_mold.ts, test:mold.

## Stage A — Comparator + frozen baseline (Task 1)

- Create `scripts/compare_molds.py` (trimesh+matplotlib confirmed working): REF box_l/box_r/master_base vs frozen V0.2 vs candidate, in original assembled coordinates; horizontal sections at Z = −40, 10, 59 mm; bounds, volume, watertightness, component count, **inner aperture measured separately from outer bounds**; labeled same-scale render columns (front/top/section/exploded).
- Record input + source hashes, run `regression_release.ts`, `regression_mold.ts`, `tsc --noEmit`, save failures unchanged into `OUTPUT/validation_v03/`.

## Stage B — Fix blocking failures (Tasks 2+3 hard parts)

1. **Fragmentation fix (the 11-component failure):** repair degenerate faces before export and recheck the *exported* STL (rebuild kernel solid from Float32 arrays, decompose, assert 1 substantial component ≥1e-4 mm³, fail loudly on larger pieces — never silently discard). Target: regression_mold all 5 cases PASS.
2. **Frame stability:** replace vertex-count base-contact ranking with triangle-area-weighted scoring; translation regression (+[117,−83,41]) and subdivided-box tessellation regression (`regression_frame.ts`); optional `verticalAxis`/`splitAxis` override with vert≠pull validation; replace silent rescale with explicit size/units confirmation in intake (worker + CLI), reject non-finite/zero-dim inputs.
3. **Envelope negative tests** (`regression_envelope.ts`): cube, sphere, thin horizontal spur, off-center body, narrow-neck+broad-base; master ⊆ cavity (`escaped.volume() ≤ 0.02`); half-plane-valid support rings; clearance verified to ≤0.25 mm bound over adaptively sampled faces; wall **normal** thickness measured on the final Boolean.

## Stage C — Shape fidelity: make the primary envelope hug like the reference (Task 3 core + your "overall design" gap)

The current convexified/pull-mirrored profile is the *fallback*, not the target (per the contract). Implement the primary mode: **shape-following non-convex continuous loft** — per-height CrossSection slices offset ⊕ gap (Clipper round joins), smoothed outward-only, ~1.5 mm ring pitch (no slab steps), upper-neck profile derived from the upper fifth of the body (not the whole shadow), freeboard 10 mm. Releasability is proven per half by the extraction sim (ground truth), falling back to convexification only where the sim fails. Measure the silicone cost difference between modes and record it.

## Stage D — Joining edge + crown aperture gates (Tasks 4+6)

- Extract `src/engine/joints.ts` with `buildJointPair(mod, jacket, frame, wall, clearance)`; clearance variants 0.15/0.25/0.40 in tests; groove residual web ≥1.2 mm; 7 mm external lands validated as flat clamp patches at 3 heights; subtract cavity AFTER rail union; clip rails with correct half-space direction.
- Crown gate: intersect crown probe rays with **final solids** to measure the actual top aperture vs the planned neck — a capped jacket fixture must FAIL even when the top height equals frame.crown. Flood-fill fixtures: disconnected pocket + row-wrap cases must FAIL.
- `regression_gates.ts` with capped/leaking/disconnected/colliding/valid fixtures.

## Stage E — Release-path defensibility (Task 5)

Keep the tunneling fixture; add thin-obstacle-between-samples and containment-without-crossing fixtures; disassembly sequence tested (A vs cavity/base/B, then B after A removal; tongue clearance *during motion*); label results `sampled-solid` with explicit 0.001 mm³ tolerance; keep axis retry with recorded reasons.

## Stage F — Unify pipeline + real CLI (Task 7)

- `src/engine/pipeline.ts` → `generateValidatedPackage()` shared by worker and CLI; hard-gate failure blocks export in BOTH UI and CLI (nonzero exit, no ZIP); project.json gains params/version/frame/validation-method/warnings/input-hash; assembly instructions rewritten (lateral assembly, rail clipping, seam/base sealing, release sequence); ZIP + extracted files; print transforms or plate-down rotation for non-Z molds.
- CLI: `npx tsx scripts/generate_mold.ts --input <stl> --gap 6 --wall 5 --clearance 0.25 --out OUTPUT/<dir>`.

## Stage G — Sheep iteration loop ("again and again until it's right")

Loop over the patron.stl base: regenerate → `compare_molds.py` REF vs V0.2 vs candidate → tune envelope constants (neck fraction, slope 0.55, smoothing passes, rail/land dims, clearance) → repeat. **Exit criteria (all must hold):**
1. regression_mold (5 cases) + regression_release + regression_gates + regression_envelope + regression_frame ALL green; `tsc --noEmit` clean.
2. Comparator: no slab steps; Z=59 aperture follows the upper-body neck (area within ±25% of REF, far below the full-shadow span); silicone volume in the REF class (~250 mL vs V0.2's 370); sampled min clearance ≥ gap−0.25; 1 component per printed part; nothing below the seating plane.
3. Labeled renders (front/top/section/exploded, same scale) reviewed — joining edge, open crown entry, and overall silhouette visibly in the reference's design language, residual differences documented as deliberate tradeoffs (hand-sculpted ribs/asymmetry).

## Stage H — Generality corpus + Spiderman validation (Task 8)

- Fixture matrix at gap/wall (4,2), (6,5), (10,6) × every pull axis + translated/sparse/narrow-neck/concave/disconnected/non-finite cases; add `test:mold` to package.json; review legacy smokes for contradicted assumptions only.
- Real models: patron, Fatima hand (smoke:m4), `INPUT/japandi+hart+klein.stl`, and **`INPUT/obj_1_Spiderman urban.stl` as the acceptance validation case** — full package, all gates green, report recorded.
- Browser workflow exercise (import, generate, toggle parts, crown/rails/exploded, ZIP round-trip, invalid input error, blocked export); `npm run build`; duration/memory tracked vs 2× sheep baseline.

## Stage I — Deliverables (Tasks 9+10 prep)

Regenerate final `OUTPUT/pourbox_patron_v03` from final sources; `docs/V0.3_VALIDATION.md` with renders, metrics table (silicone mL, jacket volume, measured gap/thickness, aperture area, dims, components, release method), commands + exit codes, unresolved limits; mark V0.2 equivalence claims superseded; export seam/seating joint coupons at clearances 0.15/0.25/0.40 to `OUTPUT/fit_coupons` for your physical print trial (Task 10 execution is yours; software reports "physical validation pending").

## Guardrails

`IDEAL FOR THE STUDY/` and `OUTPUT/pourbox_patron_v02` are frozen baselines — never modified. All new output → `OUTPUT/pourbox_patron_v03`, `OUTPUT/validation_v03`, `OUTPUT/fit_coupons`. No git operations (not a repo). manifold-3d stays 3.5.3. Known kernel gotchas honored: 50-byte DataView STL parsing, `isStatusOk()` not string compare, `trimByPlane(n,o)` keeps {n·x ≥ o}, BFS passes the INDEX to predicates, worker results never use the transfer list, decimated meshes can pinch (full-res for geometry).

## Definition of done (software)

Tasks 1–9 green per the plan's gates; sheep package regenerated and comparator-verified against the reference; Spiderman validation case passes with a recorded report; physical printing remains explicitly pending your coupon trial.