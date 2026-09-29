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

## Open (not yet implemented)

Per the plan status file: open-face relief tray + method selector (M1), strict final-STL
round-trip gate (`finalAudit`), hole-aware contours / double-offset removal, planner unification
with rejection-ledger export, full size/rotation matrix, slicer + physical qualification.
