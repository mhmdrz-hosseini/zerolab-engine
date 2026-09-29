# Validation log — reliability implementation (M0)

Plan: `Mold-platform-implementation-plan.md` (audit chat outputs, 2026-09-29).
Repository: `D:/code/3d/MOLD/MOLDGENRATOR`. Frozen evidence: `OUTPUT TEST 1/` (never overwritten).

## Baseline (Task 1) — 2026-09-29, engine commit `5539fc2`

| Command | Exit | Outcome |
|---|---|---|
| `npm run build` | 0 | pass (bundle-size warnings pre-existing) |
| `npm run smoke:reliability` | 0 | pass (Spider-Man live gen, sizing floors, plaque case) |
| `npx tsx scripts/regression_mold.ts` | 0 | pass (5 geometric cases) |
| `npx tsx scripts/regression_methods.ts` (full 41-case matrix) | 1 | **expected red** — see below |

Full log: `regression-methods-baseline-2026-09-29.log`. Frozen manifest: `frozen-cases.json`
(41 cases: 40 batch runs + the STEP unsupported-format case; SHA-256s from the independent audit's
`input-metrics.json`; per-case observations from `case-metrics.json`).

### Baseline findings (fresh runs at `5539fc2` vs frozen evidence at `681fdb6`)

The only engine delta between the two commits is the release-collision fix (P0). Its effects,
verified by probe:

1. **Truthful rejections (accepted-behavior change, recorded in the manifest):**
   - `obj_1_Spiderman_urban__large`: previously exported; now rejected — jacket B presses into the
     master at −10.05 mm with monotonically growing overlap (0.02 → 1.19 → 3.89 → 16.97 → 85.66 mm³
     by −20 mm; probe `scripts/probe_spiderman.ts`). The frozen pass was the P0 false pass.
   - `obj_1_情人节玫瑰花束摆件__large`: previously exported; extraction now fails on every axis
     (A ✓@94.55 / B ✗@7.05 on ±Y, etc.). Same truthful-rejection class.
2. **Candidate re-ranking (informational drift):** kittie small/large, Candle-lamp large and
   angel large changed winning axis (±Z→±Y, ±Y→±X) because their previously-winning axis now
   truthfully fails extraction; silicone volume changes follow the new split. Frozen observations
   remain the immutable batch record.
3. **japandi intake crash:** the non-manifold heart crashed with a raw `ManifoldError` stack trace
   (exit 1, no diagnosis). Fixed in this wave: intake kernel errors now exit 2 with an explicit
   "not a manifold solid" rejection.
4. **Production-ready metadata contract:** all 29 exported packages at baseline lack `method`,
   `source`, `transforms`, `finalFileAudit`, `releaseResult` (added in Task 2), and
   `rejectionLedger` — the harness fails them by design until Tasks 2–4 land the fields.

## Task 2 — staged rigid release + separated silicone demold

Engine changes (`src/engine/split.ts`, `src/engine/export.ts`, `scripts/generate_mold.ts`):

- `simulate()` accepts per-target volumetric callbacks and `targetNames`; every failed step names
  its obstacle and the first unsafe distance.
- The base plate is built **before** extraction simulation. Removal stages test the moving part
  against master + plate + every still-installed panel: A vs [master, plate, B] (or B1/B2);
  B vs [master, plate]; B1 vs [master, plate, B2]; B2 vs [master, plate, B1] — matching the
  published assembly order.
- `MoldPackage.siliconeDemold` carries an explicit `unverified` stage: rigid jacket release never
  certifies master demolding. Exported as `releaseResult` in `project.json`.
- Intake kernel errors → exit 2 with a precise non-manifold diagnosis (japandi class).

New tests: `scripts/release_sequence_regression.ts` (contact-only pass, initial overlap, reversed
motion, multi-target attribution, still-installed panel), rewritten `scripts/regression_release.ts`
(system-level staged release on real geometry).

### Verification after Task 2 (commit under review)

| Command | Exit | Outcome |
|---|---|---|
| `npx tsc --noEmit` | 0 | clean |
| `npm run build` | 0 | pass |
| `npx tsx scripts/release_sequence_regression.ts` | 0 | 5/5 unit cases |
| `npx tsx scripts/release_collision_regression.ts` | 0 | through/late/contained/thin/clear |
| `npx tsx scripts/regression_release.ts` | 0 | staged release, attribution, silicone separation |
| `npx tsx scripts/regression_mold.ts` | 0 | 5 geometric cases |
| `npx tsx scripts/regression_envelope.ts` | 0 | containment/clearance cases |
| `npx tsx scripts/regression_frame.ts` | 0 | frame cases |
| `npm run smoke:reliability` | 0 | pass |

Harness re-checks: japandi → `intake_rejected` ✓; Spiderman-large and rose-large →
`rejected/construction` matching the manifest's recorded acceptance change ✓; Körper pair
equivalence ✓ (class, axis, silicone ±2%). Remaining red: the other five production-ready contract
fields (`method`, `source`, `transforms`, `finalFileAudit`, `rejectionLedger`) — Tasks 3 and 4.

## Task 3 — final-file audit on serialized bytes

Engine changes (`src/engine/finalAudit.ts` new, `src/engine/export.ts`):

- Every part is judged on its **actual serialized STL bytes**: write → parse back → classify →
  kernel round-trip. Verdicts: `valid`, `suspect` (closed but pinched — ships with recorded
  reasons), `invalid` (boundary edges, non-manifold, degenerate survivors, zero-volume components,
  or kernel reconstruction failure — blocks the package like the pre-serialization gate).
- Classifications per the plan's contract: `closed_surface`, `two_manifold`, `nested_void_shells`,
  net signed volume (void shells subtract), separate kernel volume for agreement checking.
- `finalFileAudit` is written into `project.json` per file; the silicone mix claim is cross-checked
  against the serialized skin (>2% divergence records a visible warning — the 1,134.5 vs 1,141.6 mL
  cap discrepancy class is now surfaced, not hidden).

Audit reconciliation (probed, not assumed): the frozen angel-large `master_base.stl` that the
independent audit could not import **reconstructs cleanly under manifold-3d 3.5.3** (NoError,
366.4 cm³) — it is closed with 45 pinched edges → classified `suspect`, not `invalid`. The audit's
rejection is not reproduced on the single part; recorded in `regression_final_mesh.ts` case 6
instead of being papered over.

New test: `scripts/regression_final_mesh.ts` — zero-thickness sheet → invalid; open boundary →
invalid; hollow solid → valid with net 7.0 cm³ and one void shell; detached positives → valid
(2.0 cm³, 2 components); pinched edge-contact → suspect; frozen angel master → suspect/kernel-OK.

Verification: `tsc` clean, build pass, `regression_mold` pass, `smoke:reliability` pass, harness
shows `finalFileAudit` + `releaseResult` present in real packages (Körper small: all four files
`valid` with kernel volumes agreeing; Montagem small: master + skin `suspect` at 18 pinched edges,
shipping with warnings). Remaining contract violations: `method`, `source`, `transforms`,
`rejectionLedger` — Task 4 scope.

## Task 4 — one shared candidate pipeline (CLI = browser)

Engine changes (`src/engine/planner.ts` new, `src/engine/split.ts`, `src/engine/export.ts`,
`src/engine/types.ts`, `src/workers/geometry.worker.ts`, `scripts/generate_mold.ts`):

- `planMold()` owns the complete candidate evaluation: `rankSplitAxes` (shared quiet-line ranking),
  the gap-retry ladder (4→6→8 undercuts don't shrink with the master), the 3-piece fallback phase,
  and per candidate: construction → staged rigid release → hard gates → master/base fusion →
  export prep (cleanup + serialized-bytes final audit). Any stage failure yields to the next
  candidate and lands in the rejection ledger. Export-prep runs INSIDE the loop in every adapter —
  a candidate whose package would fail the final audit never wins (verified: the parity fixture's
  ±X@gap-4 candidate is kernel-invalid after serialization and is rejected by both adapters).
- `project.json` now carries the full production-ready contract: `method` (family/panels/splitAxis/
  confidence), `source` (inputSha256, units, scale policy, engine commit), `transforms` (structured
  printer orientation — a non-Z vertical never claims "as exported"), `rejectionLedger`,
  `finalFileAudit`, `releaseResult`.
- The CLI was rewritten on planMold (~90 duplicated lines removed); the browser worker generates
  through the same planner (file SHA-256 hashed at ingest) and its export click transfers the
  planner-built, already-audited bytes — browser packages are metadata-identical to the CLI's.
- New test: `scripts/regression_parity.ts` — same fixture through the CLI subprocess AND the
  library pipeline: axis/panels/silicone/transform parity on Z-up and rotated inputs, rotation
  invariance (±Z → ±Y under a 90° X-rotation, silicone identical), transform correctness.
- Acceptance change recorded in the manifest: the 29 exported cases flip
  `exported_metadata_incomplete` → `production_ready` (the digital contract; physical qualification
  stays an explicit `unverified` M3 stage).

Verification: tsc clean; build pass; regression_mold / envelope / frame / release-sequence /
release-collision / final-mesh all pass; smoke:reliability pass; harness Körper + Montagem +
STEP cases pass with `production_ready`; full 41-case matrix log
`regression-methods-task4-2026-09-29.log`.

**M0 complete at `7d8f44a`.** Per the plan's release rule, M0 ships as a reliability improvement
on its own; M1 (method selector, relief tray), M2 (cost/printability) and M3 (physical
qualification) remain planned work.

## Tasks 5+6 — method selector + open-face relief tray (M1)

Commits `984ef29` (selector), `d4abe31` (tray builder), `b52d1a8` (integration).

- **Selector** (`src/engine/moldMethod.ts`): ranks `open_face_relief` / `full_3d_jacket` /
  `vessel_core` / `needs_review` from measured, orientation-invariant geometry — dominant planar
  patch via triangle normals + plane offsets, backing coverage vs projected footprint, depth/span
  flatness. Role and intent guards return `needs_review` for prebuilt negatives/tooling and
  unspecified intent (the engine never auto-wraps a mold of the tooling). Calibrated filters from
  the batch: coverage ≥ 0.3 (perforated cap 0.32 in; poodle 0.35 out via flatness 1.24), flatness
  ≤ 0.25. Real-model probe matches audit §4 routing: Montagem → open-face; giraffe/Spiderman/
  poodle → 3D; cap → open-face after calibration.
- **Tray** (`src/engine/reliefTray.ts`): full-height shadow projection (undercut-safe), gap applied
  ONCE, contour wall ring with NO roof, deliberate backing, master fused to the plate with a buried
  foot; through-holes fill and report withdrawable posts when straight. Depth/span > 0.5 throws
  with the failing property named. Regression: parts valid via export-grade cleanup, ring ≠ box,
  backing verified, 180 mm plaque wall 115.7 cm³ vs 414.7 cm³ same-size jacket, deep bowl blocked.
- **Integration**: `planMold` tray phase runs before any jacket candidate when intent is confirmed
  `front_only` AND the selector tops open-face; tray failure yields to the jacket ladder (ledger
  entry). Export is method-aware (tray parts + open-top pour/peel assembly). CLI `--cast`/`--role`
  flags; default stays `all_sides` → jacket, so the 41 frozen classes are unchanged (manifest note).
- E2E: `flat_plaque --cast front_only` → `method open_face_relief`, all files `valid` in
  `finalFileAudit`, tray release semantics, tray assembly text.

Verification: build, all 9 regression scripts, smoke:reliability, harness spot-checks — green.

## Open (not yet implemented)

Per the plan status file: open-face relief tray + method selector (M1), strict final-STL
round-trip gate (`finalAudit`), hole-aware contours / double-offset removal, planner unification
with rejection-ledger export, full size/rotation matrix, slicer + physical qualification.
