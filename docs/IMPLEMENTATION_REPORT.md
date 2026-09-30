# Implementation report — mold-platform reliability (M0+M1) and how the current algorithm works

**Date:** 2026-09-30 · **Engine:** `main` from `5539fc2` through `b52d1a8` (+ batch tooling)
**Plan:** the implementation plan in the audit chat outputs (`Mold-platform-implementation-plan.md`, sections M0–M3)
**Batch evidence:** `OUTPUT TEST 1/` (frozen baseline, old engine) · `OUTPUT V2/` (previous-chat M0-era run) · `OUTPUT/v2/` (this report's run, current engine)

This document describes **what was actually implemented, file by file**, **how the algorithm works end-to-end**, and **how each change maps to the plan**. It is written from the shipped code, not from intentions.

---

## 1. What was implemented, task by task

### Task 1 — Frozen acceptance manifest + verification harness · commit `6f1472e`

| Artifact | What it does |
|---|---|
| `docs/superpowers/validation/frozen-cases.json` | 41 cases: the 20 input models × {50, 200 mm} from the frozen batch plus the STEP unsupported-format case. Each record carries `sourceSha256` (from the independent audit), routing target per audit §4, `expectedOutcomeClass` (the CURRENT contract), and the immutable frozen observation. |
| `scripts/regression_methods.ts` | Runs every case through the **real CLI** (`generate_mold.ts`) into `OUTPUT VALIDATION/` — frozen evidence is never touched. Checks: fresh outcome class vs contract, the six-field production-ready metadata contract, the Körper scale-invariance pair (class/axis/silicone ±2 %), and STEP exit-2 with an explicit unsupported-format diagnosis. |
| `generate_mold.ts` STEP/3MF gate | Acceptance-matrix row "STEP input → explicit unsupported-format diagnosis": `.step/.stp/.3mf` exit 2 with a precise message instead of a garbage STL parse. |

Baseline truth established here: at the old commit the release simulation carried the audit's P0 false-pass defect. Fresh runs proved Spiderman-large and rose-large **truthfully reject** (see §3) — recorded in the manifest with per-case `acceptanceChangeNote` evidence.

### Task 2 — Truthful staged rigid release · commit `355ebf2`

Files: `src/engine/split.ts`, `src/engine/export.ts`, `scripts/generate_mold.ts`, new `scripts/release_sequence_regression.ts` + rewritten `scripts/regression_release.ts`.

- `simulate()` now takes **per-target volumetric callbacks and `targetNames`**. Every failed step names its obstacle (`result.obstacle`, e.g. `"master"`, `"base plate"`, `"jacket B1"`) and the first unsafe distance. The old code tested a part only against the master and could not say what it hit.
- The **base plate is built before** release simulation, and each removal stage tests the moving part against **every still-installed rigid body** in the published assembly order:
  - jacket A vs `[master, plate, jacket B]` (B is still seated when A slides off),
  - jacket B vs `[master, plate]` (A is off),
  - 3-piece: A vs `[master, plate, B1, B2]`; B1 vs `[master, plate, B2]`; B2 vs `[master, plate, B1]`.
- `MoldPackage.siliconeDemold = { status: 'unverified', note }` — pulling the master out of the cured silicone is a flexible-material problem and is **never** certified by the rigid check. Exported as `releaseResult` in `project.json`.
- Intake kernel throws (the japandi heart crash) became a precise exit-2 "not a manifold solid" diagnosis.

Regression coverage: contact-only slide passes, initial overlap fails at the first sample with attribution, reversed motion symmetry, multi-target attribution, still-installed-panel blocking, plus a system-level staged-release case on real built geometry.

### Task 3 — Final-file audit on serialized bytes · commit `e66c7f2`

Files: new `src/engine/finalAudit.ts`, `src/engine/export.ts`, new `scripts/regression_final_mesh.ts`.

Every exported part is judged on its **actual serialized STL bytes**: `writeStlBinary → parseStlBinary` (the float32 + 1 µm-weld reality a slicer receives) → classify → kernel round-trip.

- Verdicts: `valid` · `suspect` (closed but carrying pinched edges — ships with recorded reasons) · `invalid` (boundary edges, non-manifold edges, degenerate survivors, zero-volume components, or kernel reconstruction failure — **blocks the package** exactly like the pre-serialization gate).
- Classifications per the plan's contract: `closedSurface`, `twoManifold`, `nestedVoidShells` (inward shells subtract from material), net signed volume, plus a separate kernel volume for agreement.
- `project.json` carries `finalFileAudit` per file; the silicone mix claim is cross-checked against the serialized skin (>2 % divergence records a visible warning — the audit's 1,134.5 vs 1,141.6 mL cap discrepancy class is surfaced, not hidden).
- Reconciliation pinned by test: the frozen angel-large master the independent audit could not import **reconstructs cleanly under manifold-3d 3.5.3** (NoError, 366.4 cm³, 45 pinched edges) → `suspect`, not `invalid`.

### Task 4 — One shared candidate pipeline (CLI = browser) · commit `7d8f44a`

Files: new `src/engine/planner.ts`, `src/engine/split.ts` (exports), `src/engine/types.ts`, `src/workers/geometry.worker.ts`, `scripts/generate_mold.ts`, new `scripts/regression_parity.ts`.

`planMold()` is now the single pipeline both adapters call:

```
intake (CLI/worker) → SDF grid → rankSplitAxes → planMold
  ├─ tray phase (M1, §2.3 below)           — front_only intent + selector confirmation
  ├─ phase 2-piece: for gap in {g,4,6,8}:  — gap-retry ladder (undercuts don't shrink with the master)
  │    for axis in ranked: buildMoldForAxis → extraction → gates → fusion → export prep
  └─ phase 3-piece fallback (one retry, highest-ranked axis)
```

- **Any stage failure yields to the next candidate** and lands in the rejection ledger with its stage (`construction` / `release` / `gate` / `export`). The old ladder returned the first extractable construction and died later on gates or export.
- **Export preparation runs inside the candidate loop in every adapter** — cleanup plus the serialized-bytes final audit. A candidate whose package would fail the final audit never wins (this exact bug was caught by the parity test in decide-only mode and fixed by removing that mode).
- `project.json` carries the full production-ready contract: `method` (family/panels/splitAxis/confidence + selector evidence), `source` (inputSha256, units, scale policy, engine commit), `transforms` (structured printer orientation — a non-Z vertical never claims "as exported"), `rejectionLedger`, `finalFileAudit`, `releaseResult`.
- The CLI was rewritten onto `planMold` (~90 duplicated lines removed); the browser worker generates through the same planner (file SHA-256 hashed at ingest) and its export click transfers the planner-built, already-audited bytes.
- `regression_parity.ts`: the same fixture through the CLI subprocess **and** the library pipeline — axis/panels/silicone/transform parity on Z-up and rotated inputs; rotation invariance (±Z → ±Y under a 90° X-rotation, silicone identical).

### Task 5 — Mold-family selector (M1) · commit `984ef29`

Files: new `src/engine/moldMethod.ts`, `src/engine/types.ts` (`CastingIntent`), `src/engine/planner.ts` (selector evidence in metadata), new `scripts/regression_method_selection.ts`.

`classifyMethods(mesh, intent)` ranks `open_face_relief` / `full_3d_jacket` / `vessel_core` / `needs_review` from **measured, orientation-invariant geometry** — never filename, bbox flatness alone, or the STL Z axis (the audit's root-cause findings P1):

- the **dominant planar patch** is found by bucketing triangle normals (2-decimal quantization) + plane offsets (0.1 mm) and summing areas — the largest bucket is the backing plane;
- `backingCoverage` = patch area / projected footprint area; `flatnessRatio` = depth along the plane normal / min footprint span;
- calibrated filters from the real batch: `coverage ≥ 0.3` (the perforated lantern cap measures 0.32 because its apertures eat coverage; the poodle measures 0.35 but is excluded by flatness 1.24) and `flatness ≤ 0.25` (Montagem 0.22 in);
- **role/intent guards**: `prebuilt_negative_mold` / `tooling` → `needs_review` (the engine never wraps a mold of the tooling); unspecified intent → `needs_review` with a question, not a guess;
- real-model probe matches the audit's routing table: Montagem → open-face; giraffe, Spiderman, poodle → 3D; cap → open-face after calibration.

### Task 6 — Open-face relief tray (M1) · commits `d4abe31`, `b52d1a8`

Files: new `src/engine/reliefTray.ts`, `src/engine/planner.ts` (tray phase), `src/engine/export.ts` (method-aware packaging), `scripts/generate_mold.ts` (`--cast`, `--role` flags), new `scripts/regression_relief_tray.ts`.

The tray is a genuinely new mold family, not the jacket rotated onto its back:

- **construction**: full-height **shadow projection** (union of slices every ≤2 mm — undercut-safe), clearance `gap` applied **once** (the jacket's double-offset bug class cannot occur here), contour **wall ring with no roof**, deliberate silicone `backing` above the highest feature plus pour `freeboard`, master fused to the plate with a buried foot (same trick as the jacket base);
- **through-holes** fill with silicone and are reported as **withdrawable posts when straight** (interior loops matched between mid-height and near-top slices) — never silently filled or cored; non-straight voids raise a removable-core warning;
- **guards**: the master must arrive backing-plane-down at z≈0; depth/span > 0.5 throws with the failing property named (deep bowls never reach the tray);
- **routing**: `planMold` builds the tray **before any jacket candidate** when cast intent is confirmed `front_only` (CLI `--cast front_only`) AND the selector tops open-face; tray failure yields to the jacket ladder with a ledger entry;
- **export**: method-aware packaging — tray packages list `tray_wall` (teal in the viewer), open-top pour/peel assembly instructions, no clamps/sealant;
- measured win: a 180×90 mm plaque's tray wall is **115.7 cm³ vs ≈414.7 cm³** for the same-size generic jacket (audit §6 estimated 84.6 vs 414.7 for the hypothetical tray at 200 mm).

With default intent (`all_sides`) the jacket stays the built family, so the 41 frozen matrix classes are unchanged — recorded in the manifest.

---

## 2. How the current algorithm works (end-to-end)

### 2.1 Intake (identical in CLI and browser)

1. Parse STL/OBJ/GLB (raw STL — the kernel welds at its own tolerance; STEP/3MF rejected with a precise diagnosis).
2. Hard intake validation (NaN, degenerate); kernel manifold gate — failures exit 2 with "not a manifold solid".
3. **Explicit size confirmation**: the master is scaled to the requested largest dimension only when `--size` is given; outside 20–300 mm the CLI refuses without it. Scaling is recorded in `source.scalePolicy`.
4. SDF grid at 0.75 mm step on the full-res master; analysis mesh = `simplify(0.05)`.

### 2.2 Candidate ranking

`rankSplitAxes` orders the ±X/±Y/±Z candidates: clean axes (≤10 % trapped rays) first by the **quiet-line metric** (parting-plane contour perimeter ÷ equivalent-circle circumference at the frame mid-plane), then the rest by trapped percentage. This is a *ranking only* — the authoritative test is the per-candidate release simulation.

### 2.3 planMold — the shared pipeline

For each candidate `(family, panels, gap, axis)`, in order:

1. **Construction** (`buildMoldForAxis`): pull-clearance-windowed envelope rings (±window along the split normal so each jacket half clears the master along its pull), wall with functional thickness floors (gap 4 / wall 3 FDM, resin 2 via `fit`), air vents (optional), silicone glove = cavity − master, base plate with buried master foot. Plate is built **before** release.
2. **Staged rigid release**: feature-aware adaptive sampling (step ≤ 0.5 mm, halved to the narrowest dimension; geometry below 0.02 mm is uncertifiable), swept-AABB broad phase, volumetric overlap per target; **any ≥0.5 mm³ overlap at any sample fails**, naming the obstacle and first unsafe distance; all still-installed bodies included per removal stage (§1 Task 2).
3. **Hard gates**: master-to-jacket clearance audit (sampled min ≥ 2 mm, p10 ≥ 4.5 mm), fill/vent connectivity, seating, silicone volume sanity. Hard failures block the candidate.
4. **Fusion + export prep**: master ∪ plate union; `cleanExportMesh` (1 µm re-weld, sliver collapse, topology repair, kernel rescue); **final-file audit on the serialized bytes** (§1 Task 3). Any failure yields to the next candidate.
5. The first fully feasible candidate wins; **everything rejected ships in `rejectionLedger`**.

The tray phase (§1 Task 6) precedes the jacket ladder when intent is `front_only` and the selector confirms a flat backing plane.

### 2.4 The metadata contract (what "production-ready" means now)

A package is `production_ready` only when it carries:

| Field | Content |
|---|---|
| `method` | family actually built (e.g. `full_3d_jacket`, `open_face_relief`), panels, split axis, confidence, selector evidence (`selectorTop/Reason/Measures`) |
| `source` | input SHA-256, units (mm), scale policy, engine commit |
| `transforms` | mold vertical, pour axis, as-exported flag, exact rotation (axis + degrees) with human instruction, full frame |
| `finalFileAudit` | per-file serialized-bytes verdict incl. kernel round-trip and net volume |
| `releaseResult` | per-part staged rigid release + `siliconeDemold: unverified` |
| `rejectionLedger` | every rejected candidate, its stage and reason |

Physical qualification (M3) is still **explicitly unverified** everywhere — the digital contract does not claim print/pour/demold success.

---

## 3. Evidence: what changed in acceptance behavior, with numbers

All flips are recorded in `docs/superpowers/validation/frozen-cases.json` with per-case notes; frozen observations are never edited.

| Case | Old engine (OUTPUT TEST 1) | Current engine | Why |
|---|---|---|---|
| Spiderman 200 mm | exported | **rejected (release)** | jacket B presses into the master from −10.05 mm; probe measured overlap growing 0.02 → 85.66 mm³ by −20 mm — the old sim's false pass |
| rose bouquet 200 mm | exported | **rejected (release)** | extraction fails on every axis under the truthful sim (A ✓@94.55 / B ✗@7.05 on ±Y) |
| tackalisc 200 mm | exported | **rejected (release)** | 3-piece B2 presses into the **master** at 28.05 mm (obstacle = master, so no removal order helps) |
| Bunny 200 mm | all-axes failed | **production-ready** | gate-aware yield: old single-shot ladder gave up; planMold retries gaps and finds a fully feasible candidate |
| Medium 50 mm | export gate failed | **production-ready** | old pipeline died on the winning axis's export failure; planMold yields to another candidate that exports clean |
| Vase 50 mm | clearance gate failed | **production-ready** | same yield mechanism past the clearance failure |
| japandi both | crash (raw stack trace) | **intake rejection, precise message** | kernel throws → exit-2 diagnosis |

Verification inventory (all green at HEAD): `regression_mold`, `regression_envelope`, `regression_frame`, `release_sequence_regression`, `release_collision_regression`, `regression_final_mesh`, `regression_method_selection`, `regression_relief_tray`, `regression_parity`, `regression_methods` (41-case matrix), `smoke:reliability`, `tsc`, `vite build`. The full-matrix log after Task 4 is committed at `docs/superpowers/validation/regression-methods-task4-2026-09-29.log` (41/41 aligned after the four evidence-backed flips above).

---

## 4. This batch — `OUTPUT/v2` (results, 2026-09-30)

- **What runs:** all 20 input models from `D:/code/3d/MOLD/MOLD-generator base/input` (3MF pre-converted; STEP skipped by design) × {small 50 mm, extra-big 200 mm} through the current CLI = the shared `planMold` pipeline. Defaults identical to the frozen baseline (gap 6, wall 5, clearance 0.35, auto axis) so the only variable is the algorithm. Default intent is `all_sides` → the jacket family is built (comparable); every package's `method.selectorTop` records the selector's routing evidence.
- **Command:** `npx tsx scripts/batch_output_v2.ts --out OUTPUT/v2 --jobs 2`
- **Outcome: 31/40 OK** — same headline as the frozen baseline, but the failure SET shifted exactly along the plan's intended lines:

| vs OUTPUT TEST 1 (old engine, 31/40) | Cases | Mechanism |
|---|---|---|
| Rescued (was rejected) | Bunny 200 mm, Medium 50 mm, Vase 50 mm | gate-aware candidate yield: planMold retries gaps and yields per stage, finding fully feasible candidates the old single-shot ladder gave up on |
| Refused (was exported) | Spiderman 200 mm, rose bouquet 200 mm, tackalisc 200 mm | truthful release rejections — the old sim's P0 false pass had shipped jackets that press into the master mid-removal (v1 molds could not open) |
| Still failing, better diagnosed | japandi ×2 → precise INPUT-REJECTED (was a raw crash); cutegnome 200, Medium 200, angel 50, poodle 200 → construction/export rejections with ledger reasons | same engineering failures, now named per candidate stage |

- **Metadata:** all 31 OK packages carry the full production-ready contract; every `finalFileAudit` verdict is free of `invalid` parts; all report family `full_3d_jacket` (default intent) with selector evidence attached.
- **Outputs:** `OUTPUT/v2/<model>__{small,big}/` — full package (STLs + `project.json` + `assembly.md` + `print_profile.json`) + `run.log`; `SUMMARY.md`, `manifest.json`; contact sheets `CONTACT_SHEET_ALL.png` + per-size sheets (visually verified: 31 rendered tiles, 9 labeled failure cards, no blank tiles).
- **Reproduce any case:** `npx tsx scripts/generate_mold.ts --input <file> --size 50 --out <dir>`
- **Tray demo (new family):** `npx tsx scripts/generate_mold.ts --input "Montagem flat.stl" --size 50 --cast front_only --out <dir>` routes to the open-face relief tray — 115.7 cm³ wall vs 414.7 cm³ same-size jacket (regression-pinned in `regression_relief_tray.ts`).

## 5. What remains (per plan)

- **Task 7 (M1/M2)**: hole-aware contour/envelope construction, single-gap fix in the jacket envelope, adaptive lofting — where the large-scale construction failures (gnome/poodle/bunny at 200 mm in the old batch) live.
- **Task 8 (M2)**: printability/assembly/pour gates on final geometry (real slicer profiles, buoyancy-aware vents, clip-jaw fit with hardware dimensions).
- **Task 9 (M2)**: cost model from slicer filament grams + silicone density/mix allowance, Pareto frontier.
- **Task 10 (M2)**: robustness matrix (6 sizes, rotation/translation/retessellation fixtures).
- **Task 11 (M3)**: UI method/gate display, printed fit coupon + six representative tools, material qualification. Until then every physical claim stays `unverified` by design.
