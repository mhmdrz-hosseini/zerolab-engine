# Mold platform V3 implementation and verification plan

> Execution: use the executing-plans workflow, one tested change at a time. Track the checkboxes and evidence in the goal runbook. The user has authorized the sandbox implementation and verification loop; routine reversible work does not need repeated approval.

**Goal:** Deliver the intended, geometrically verified mold for the defined supported input classes and sizes, with correct backing orientation, printable and assemblable parts, preserved detail and measured material use; give precise review or rejection results for inputs outside that envelope.

**Architecture:** One typed request drives classification, signed backing selection, mold-frame normalization, method-specific construction, common final-output validation, candidate comparison, and per-part print transforms. A separate acceptance runner judges the actual exported files against an immutable case contract. The autonomous agent diagnoses failures and edits the algorithm; the runner records evidence and never silently changes its own acceptance criteria.

**Stack:** Existing TypeScript, React, Three.js and manifold-3d 3.5.3. TSX regression scripts. Python/Trimesh for independent topology, geometry and rendering checks. Use an installed slicer when available; record missing slicer/physical qualification instead of inventing results.

**Specification:** [V2 measured review](Mold-platform-V2-review.md), [original audit](Mold-platform-audit.md), [goal runbook](Mold-platform-V3-goal-runbook.md), [machine-readable acceptance contract](mold-v3-acceptance.json). This plan supersedes any earlier acceptance rule that equates exported metadata with production readiness.

## 1. Non-negotiable behavior

- Preserve original files, source hashes and the existing OUTPUT TEST 1, OUTPUT V2 and OUTPUT/v2 evidence.
- Never silently change intended size, required surfaces, input role, selected family or protected detail to obtain a passing export.
- Never move the master alone after construction to disguise an incorrect plate. Rebuild the family in the correct frame and revalidate every mating part.
- Never mark a known supported required-success case passed because it was rejected. Rejection is correct only for a case whose frozen contract expects rejection/review, or for an expressly documented out-of-envelope runtime input.
- Keep geometry units in millimetres, volumes in mm³ internally, displayed silicone in mL, PLA mass in grams. `mL = mm³ / 1000 = cm³`.
- Minimum wall, clearance, backing and clip dimensions are physical manufacturing parameters, not proportions that disappear when a master shrinks.
- Do not modify the master to repair its container. Repairable input defects require a bounded, recorded repair and a fidelity check; ambiguous repairs stop for review.
- Files that require supports must report supports. A watertight STL alone is not printability, assembly, demolding or material-safety evidence.
- Use separate qualification states: `digital_verified`, `slicer_verified`, `physical_verified`. Record `review_required`, `unsupported` and `rejected` explicitly. Do not use `production_ready` for metadata presence.
- Runtime candidate exhaustion is a diagnostic failure. Development retry means improving the algorithm and rerunning the same case; it does not mean an infinite blind parameter search.

## 2. Define the intended mold before building it

| Input/use class | Intended behavior | Required exclusion/review |
|---|---|---|
| Positive flat emboss/plaque, back may be open | Signed backing down, detailed face into cavity, open-face silicone tooling with a sensible outer wall | Do not stand it on an edge to satisfy a jacket split |
| Perforated relief/cap | Open-face only when approved surfaces allow it; explicit silicone posts or cores preserve holes | Do not turn holes into unintended rigid wall islands |
| Full 3D figurine | Evaluate natural backing/pour frame, then compatible split/cut jacket candidates | Do not flatten or bury protected detail for cost savings |
| Bowl/vessel, both inner and outer surfaces required | Explicit core and release plan, or review if unavailable | Do not claim a generic outer jacket solves the inner cavity |
| Existing negative mold/tooling, including a reference mold | Inspect role and requested operation; review before any positive-master workflow | Never wrap tooling just because it is an STL |
| Unknown role or ambiguous back | Present measured candidate faces and ask for the missing design decision | Do not default silently to all sides or infer semantic intent from filename |
| Invalid/non-solid mesh, mixed scene, unknown units | Deterministic diagnostic and supported repair/import route | No garbage parse or successful empty package |
| Feature below physical resolution or part beyond bed | Explain limiting feature/part and applicable profile | No arbitrary rescale or deletion of the feature |

STL/OBJ/GLB are the existing supported import routes. Support means correct handling of their declared mesh subset, not every possible file carrying those extensions. STEP and 3MF need an explicit supported conversion/import path before generation; until implemented, they must return `unsupported`. Keep a format-capability table in the release report. Any converted fixture records converter version, units, source and converted hashes, and tessellation tolerance. “Any file” means every input is handled honestly, not that every geometry can be manufactured.

## 3. Shared contracts and module boundaries

Extend `src/engine/types.ts`; avoid unsafe `panels: 1 as 2` and fake jacket entries for trays. Use a discriminated family union, with family-specific parts and validated assembly steps. Introduce these public concepts:

```ts
type Vec3 = [number, number, number];
type Matrix4 = [number,number,number,number, number,number,number,number,
                number,number,number,number, number,number,number,number];
type Family = 'open_face_relief' | 'full_3d_jacket' | 'vessel_core';
type InputRole = 'positive_master' | 'prebuilt_negative_mold' | 'tooling' | 'unknown';
type RequiredSurfaces = 'front_only' | 'all_sides' | 'inner_and_outer' | 'unspecified';
type Outcome = 'digital_verified' | 'review_required' | 'unsupported' | 'rejected';
interface DesignIntent {
  inputRole: InputRole;
  requiredSurfaces: RequiredSurfaces;
  requestedFamily: Family | 'auto';
  backingNormalSource: Vec3 | null;
  backingPointSource: Vec3 | null;
}
interface BackingCandidate {
  id: string;
  point: Vec3;
  outwardNormal: Vec3;
  connectedPatchAreaMm2: number;
  contactAreaMm2: number;
  protectedDetailConflict: boolean;
  reason: string;
}
interface CanonicalFrame {
  sourceToMold: Matrix4;
  moldToSource: Matrix4;
  backingCandidateId: string;
}
interface ValidationFinding {
  code: string;
  stage: 'intake'|'intent'|'orientation'|'construction'|'assembly'|'release'|'export'|'print'|'cost';
  hard: boolean;
  partIds: string[];
  measured: number | null;
  limit: number | null;
  units: string | null;
  reason: string;
}
```

Matrix convention: column-major, right-handed; vectors are column vectors and translation occupies entries 12–14. Document conversions to every external library. Each part records assembly transform and print transform separately. An original-file transform includes any explicitly approved unit conversion and size change; backing normalization itself is rigid and invertible.

For figurines, `all_sides` means all approved body/detail surfaces; any sacrificial backing or casting opening must be explicitly identified. It must not silently waive an arbitrary side of the body. For reliefs, `front_only` includes the approved relief sidewalls and holes as well as its front detail; the approved open back is the omitted casting surface.

| Module | Responsibility |
|---|---|
| `types.ts`, new `intent.ts` | Runtime-validated request and discriminated result; no implicit role/surface assumption |
| `moldMethod.ts` | Candidate family evidence; review outcomes are authoritative |
| New `orientation.ts` | Connected planar candidates, signed sides, rigid canonical transforms, base/pour scoring |
| `planner.ts` | Enforce intent, search permitted candidates, common validation, select feasible winner |
| `reliefTray.ts` | Correct contour, fill level, posts/cores, base/wall seating for open-face family |
| `split.ts`, `envelope.ts`, `contours.ts` | Compatible full-3D construction and removal; no base forced by prior split |
| New `assemblyAudit.ts`, `gates.ts` | Pairwise fit, seating, seal/clip access, supported removal sequence |
| `finalAudit.ts`, `clean.ts` | Actual serialized-file topology, net material, fidelity and repair ledger |
| `printability.ts`, new `cost.ts` | Per-part print evaluation and comparable material estimates |
| `export.ts` | Family-specific STL package, truthful instructions, transforms and provenance |
| `store.ts`, UI panels, `geometry.worker.ts`, CLI | Same intent and pipeline; clear review/error/qualification states |
| New `scripts/v3/` harness | Fixture contracts, fresh outputs, independent checks, visual comparisons, attempt ledger |

Avoid rewriting unrelated geometry code. Move responsibilities only when needed for these interfaces.

## 4. Execution tasks

Every task uses the same evidence sequence: failing behavioral assertion against the relevant production path, smallest justified fix, passing assertion, affected existing regressions, and a reviewable commit in the sandbox branch. The following proposed test filenames must be created; they are not claimed to exist today.

### T01 — Freeze the real acceptance contract and expose the demonstrated failures

**Files:** create `scripts/v3/fixtures.ts`, `scripts/v3/acceptance.test.ts`, `scripts/v3/evaluate.ts`, `scripts/v3/run.ts`, `docs/validation/v3/acceptance.json`; read the supplied JSON and V2 evidence. Modify `package.json` to expose `test:v3` and `audit:v3` after the commands work.

- [ ] Record HEAD, dependency lock hash, baseline tracked/untracked status, input hashes and V2 package hashes before edits.
- [ ] Copy the supplied contract into the sandbox, preserving `expectedFamily`, `expectedOutcome` and required-success cases.
- [ ] Create synthetic fixtures: asymmetric relief, same relief rotated/flipped/translated, plate with a straight hole, re-entrant hole, deep bowl, closed cube, hollow cube, open sheet, zero-volume solid, separated bodies and corrupted bytes.
- [ ] Port the V2 probe into assertions that call real `planMold` or CLI plus final-file evaluation; keep direct builder checks as lower-level diagnostics.
- [ ] Demonstrate RED for real Montagem/cap front-only delivery, tooling rejection, wall/base intersection, missing post, freeboard and the unit warning.
- [ ] Implement a runner that creates a new attempt directory and returns nonzero for any mandatory failure. Missing files, skipped required checks and timed-out cases are failures/unverified results, not passes.

Example required assertion in the runner after a real exported case is evaluated:

```ts
assert.equal(actual.outcome, contract.expectedOutcome);
if (contract.expectedFamily !== null && actual.outcome === 'digital_verified') {
  assert.equal(actual.family, contract.expectedFamily);
}
assert.equal(actual.unexecutedRequiredChecks.length, 0);
```

**Run:** `npx tsx scripts/v3/acceptance.test.ts`. Initially fail for the known defects. Preserve the red log. A parser-only or selector-only test does not satisfy this task.

### T02 — Fix material units and fill-height accounting

**Files:** `src/engine/export.ts`, `src/engine/reliefTray.ts`, new `scripts/v3/materials.test.ts`.

- [ ] Reproduce a 25.1 cm³ skin incorrectly reported as 25,100 mL.
- [ ] Remove the ×1000 conversion where cm³ is compared with mL; retain mm³/1000 only at the raw-solid boundary.
- [ ] Define `fillHeight = masterTop + backing` and `wallHeight = fillHeight + freeboard`; construct silicone to fillHeight and the wall to wallHeight. Export both dimensions and a fill instruction/mark.
- [ ] Verify net void subtraction, mix allowance separately from nominal volume, and finite nonnegative estimates.
- [ ] Run `npx tsx scripts/v3/materials.test.ts` and existing net-volume regression; commit the fix and evidence.

```ts
assert.equal(cm3ToMl(25.1), 25.1); // implement as an identity with unit-specific name
assert.ok(Math.abs(trayFreeboard2.siliconeMl - trayFreeboard7.siliconeMl) < 0.01);
assert.ok(Math.abs(trayFreeboard7.wallTopZ - trayFreeboard2.wallTopZ - 5) < 0.01);
assert.equal(volumeWarningsForMatchingVolumes.length, 0);
```

`cm3ToMl` belongs in new `src/engine/cost.ts`; `volumeWarningsForMatchingVolumes` is extracted from a real exported fixture's warnings. Values here are exact-fixture numeric tolerances, not manufacturing tolerances.

### T03 — Make intent and family routing binding

**Files:** `types.ts`, new `intent.ts`, `moldMethod.ts`, `planner.ts`, `generate_mold.ts`, new `scripts/v3/intent.test.ts`.

- [ ] Reject invalid CLI enum strings at intake rather than trusting TypeScript casts.
- [ ] Remove silent all-sides/positive-master defaults for an unconfirmed request. Represent unanswered intent as review-required with a useful question and candidate preview.
- [ ] Enforce tooling/negative/unknown role guards before construction.
- [ ] Enforce requested family. Auto mode may choose only among families compatible with approved surfaces and backed by an implemented validated strategy.
- [ ] A failed confirmed tray returns its construction diagnosis; offer a jacket alternative without marking the tray request successful.
- [ ] Until core construction is validated, inner-and-outer vessel requests return review-required with the missing strategy named.
- [ ] Run `npx tsx scripts/v3/intent.test.ts` through CLI and planner; assert no printable package for blocked roles; commit.

**Expected real result:** the current tooling reproduction changes from successful jacket export to `review_required`. Montagem/cap may still fail explicitly until T05/T06; that is a truthful intermediate result, not final acceptance.

### T04 — Signed backing selection and canonical orientation

**Files:** new `orientation.ts`, `moldMethod.ts`, `planner.ts`, `split.ts`, new `scripts/v3/orientation.test.ts`.

- [ ] Build connected coplanar patches from triangle adjacency plus angle/distance tolerance; do not call a normal bucket a connected patch.
- [ ] Evaluate both signed sides and arbitrary candidate planes. A patch normal alone is insufficient: confirm the body lies on the expected side and that backing placement does not cover protected detail.
- [ ] Rank intended backing/pour candidates before deriving compatible split axes. Never remove a required backing candidate simply because an earlier split ranking used its normal.
- [ ] Orient selected outward backing normal to mold −Z, move its support plane to Z=0, and retain the inverse. Validate round-trip positions and determinant +1.
- [ ] Call family builders in canonical coordinates; derive printer transforms for each part independently after assembly is valid.
- [ ] Test source-frame axes, 90°/180° rotations, arbitrary Euler rotations, translations and retessellation. Check selected backing patches geometrically rather than demanding an axis label tied to source coordinates.
- [ ] Run `npx tsx scripts/v3/orientation.test.ts`, existing frame/parity regressions with explicit intent, and visualize real Montagem/Körper before committing.

```ts
assert.ok(backingNormalInMold[2] < -0.999);
assert.ok(Math.abs(backingPlaneZ) < 0.01);
assert.ok(sourceRoundTripMaxErrorMm < 0.01);
assert.equal(rotatedResult.family, originalResult.family);
assert.ok(relativeDifference(rotatedVolumeMl, originalVolumeMl) <= 0.02);
```

Here `relativeDifference(a,b) = abs(a-b)/max(abs(a),abs(b),1e-9)` is a test helper in `fixtures.ts`. For symmetric ambiguous shapes, compare physically equivalent frames, not a unique arbitrary label. Raise review for semantic ambiguity that geometry cannot settle.

### T05 — Rebuild open-face containment and preserve holes/detail

**Files:** `reliefTray.ts`, `contours.ts`, `clean.ts`, new `scripts/v3/relief.test.ts`.

- [ ] Distinguish the external containment footprint from internal master holes. Use a conservative projected silhouette with error control; sparse 2 mm slices alone do not certify full-height clearance.
- [ ] Build a single intended outer boundary, or explicitly supported multi-part containment. Do not offset every interior loop into an unintended rigid wall.
- [ ] For approved through-holes, construct silicone posts connected to the silicone body; preserve the master hole. Re-entrant/locked posts require a documented core/cut strategy or review.
- [ ] Investigate Montagem's small/degenerated master/base components and cap's inner wall components. Decide by geometry and feature role, not blanket component deletion. Any bounded repair must preserve protected details and be rerun through final-file checks.
- [ ] Attach the master only at its approved backing region. Buried attachment must not replace or fill intended relief.
- [ ] Run real Montagem and cap at 50/200 mm with explicit front-only intent; the exported family must be `open_face_relief` and the intended printed components must be connected.
- [ ] Run `npx tsx scripts/v3/relief.test.ts`; inspect exploded, top, bottom and silicone cutaway renders; commit.

```ts
assert.equal(finalPackage.family, 'open_face_relief');
assert.ok(Math.abs(siliconeIntersectionWithHoleCenterProbeMm3 - 1) < 0.001);
assert.equal(unintendedRigidIslands, 0);
assert.equal(protectedHoleTopologyChanged, false);
```

The 1 mm³ probe is at the known center of the synthetic straight hole and is measured against serialized silicone geometry. Hole/feature identity comes from the fixture contract, not from the generator's claim.

### T06 — Make wall/base fit and release physically coherent

**Files:** `reliefTray.ts`, new `assemblyAudit.ts`, `planner.ts`, `gates.ts`, `split.ts`, new `scripts/v3/assembly.test.ts`.

- [ ] Choose a removable wall seated on the base as the default reusable relief assembly. Define mating regions explicitly; the wall must not extend through the solid base. A deliberately fused tray is a separate package mode, not an overlapping two-part assembly.
- [ ] Apply the calibrated profile clearance to location features; provide continuous seal contact and accessible holding lands. Include clip jaw dimensions if a clip fit is claimed.
- [ ] Add pairwise solid intersection checks for all distinct installed printed parts at seated positions, including tray wall versus fused master/base.
- [ ] Check the full seating/removal sequence against all still-installed obstacles, with a conservative sweep or demonstrably bounded sampling. Thin obstacles and starting overlap must fail. Contact-only motion must pass within the declared numeric tolerance.
- [ ] Remove the hardcoded `pass:true` tray release. Keep cured-silicone/master demolding separately qualified; a rigid release pass is not proof of flexible demolding.
- [ ] Verify seal path continuity and clip access geometrically; leave leak tightness and retention force physical-unverified until tested.
- [ ] Run `npx tsx scripts/v3/assembly.test.ts` and existing collision/release-sequence regressions; commit.

**Required numeric probe:** the V2 synthetic 3,418.36 mm³ overlap must fall below the fixed exact-fixture tolerance 0.001 mm³. Use a declared scale/precision-aware policy for other meshes; never loosen it after observing a failure merely to pass that case.

### T07 — Common final-output gates and preserved detail

**Files:** `finalAudit.ts`, `gates.ts`, `clean.ts`, `planner.ts`, `export.ts`, new `scripts/v3/final-output.test.ts`, new `scripts/v3/independent_audit.py`.

- [ ] Run identical applicable gates for all families. A tray cannot return empty successful check arrays while a jacket receives substantive validation.
- [ ] Serialize, reimport and independently evaluate every intended print part: closed two-manifold boundary, orientation, nonzero material, intended connectivity, no self-intersection detectable by the chosen checker, and kernel reconstruction.
- [ ] Distinguish nested void shells from disconnected positive material. A count of surface shells is not automatically a count of printed pieces.
- [ ] Verify master fidelity away from explicitly approved backing attachment and protected feature topology everywhere. Compare in a common frame after inverting approved transforms.
- [ ] Establish the repair error budget before repair: for the development profile, maximum surface displacement is `min(0.05 mm, finestProtectedFeatureMm / 10)` outside the approved attachment region. Record the feature measurement and tighten for a more demanding profile; unknown feature size blocks repair certification. If the feature cannot fit that budget, review/reject rather than smoothing it away.
- [ ] `suspect` geometry is review-required for release acceptance. Preserve a diagnostic preview if useful, but never count it as a verified print package.
- [ ] Run `npx tsx scripts/v3/final-output.test.ts` and `python scripts/v3/independent_audit.py --run <attempt-directory>` after implementing this CLI; commit.

Required images per failed/new family: original input, approved backing patch, assembly, exploded parts, each printed orientation, cavity cross-section through critical holes, and error overlays. Use measured mesh renders for evidence. Concept images cannot pass a gate.

### T08 — Printability and comparable cost

**Files:** `printability.ts`, `cost.ts`, `planner.ts`, `export.ts`, new `scripts/v3/print-cost.test.ts`.

- [ ] Evaluate build-volume fit, intended bed contact, unsupported islands/overhangs, minimum wall and feature thickness on each actual printed part in its print transform.
- [ ] Separate hard profile violations from estimated support advisory. Do not claim support-free output from a bounding box or surface-area heuristic.
- [ ] Compare only feasible candidates with identical source, scale, protected surfaces, fit profile, backing and material assumptions.
- [ ] Record wall PLA, base/master PLA, supports and silicone separately. CAD-solid PLA mass is an estimate; slicer filament including supports is the preferred print-cost measurement.
- [ ] Compute cost as `PLA_grams * price_per_gram + silicone_mL * density_g_per_mL * price_per_gram`; record all user/profile price inputs and mix allowance. No percentage-saving claim without paired measurements.
- [ ] Keep a feasible baseline candidate so selection cannot choose a dominated higher-cost candidate without a documented fit, support or release benefit.
- [ ] Run `npx tsx scripts/v3/print-cost.test.ts`. When a slicer is available, save version/profile, command and results; when unavailable leave slicer_verified false. Commit.

### T09 — Wire the real product and export contract

**Files:** `src/state/store.ts`, `src/ui/ImportPanel.tsx`, `GeneratePanel.tsx`, `AnalysisPanel.tsx`, `Viewer.tsx`, `src/workers/geometry.worker.ts`, `src/engine/types.ts`, `export.ts`, `scripts/generate_mold.ts`; new `scripts/v3/parity.test.ts`.

- [ ] Carry role, required surfaces, family and backing selection from controls through store and worker to planner; use the same validated CLI request.
- [ ] Show the intended base face before generation, the selected family and the resulting cavity opening after generation.
- [ ] Display reasoned review/failure states and compatible alternatives. A fallback cannot preserve a misleading green requested-method status.
- [ ] Model trays as trays throughout viewer, instructions and part lists; remove fake jacket B entries and casting-to-wrong-type shortcuts.
- [ ] Export structured signed transforms and per-part print transforms. Use real engine/version provenance; do not pretend a browser placeholder is a commit.
- [ ] Display geometry, slicer and physical qualification separately, including missing checks.
- [ ] Run `npx tsx scripts/v3/parity.test.ts` and inspect the actual browser flows for plaque, figurine and review-required input. Compare method, frame, parts, volumes, findings and outcomes against CLI. Commit.

### T10 — Full sandbox regression, diagnosis loop and release evidence

**Files:** `scripts/v3/run.ts`, `evaluate.ts`, new `scripts/v3/render.py`, `docs/validation/v3/`; `package.json`.

- [ ] Run targeted defects first. Do not spend a full batch rerun on a branch still failing a fast required test.
- [ ] Run the 20 inputs at 50 and 200 mm with explicit per-case intent; maintain independent required-success and expected-review/rejection cohorts.
- [ ] Run required target families at 20, 35, 50, 100, 200 and 300 mm. Outside profile feasibility, require a specific dimensional diagnosis; inside the fixed supported core envelope, rejection remains failure.
- [ ] Run orientation/translation/retessellation variants according to the JSON coverage contract; compare outcomes, intended backing, topology and volume.
- [ ] Diagnose each failed criterion by stage. Fix the earliest violated invariant, add the smallest reproducer, regenerate fresh output and rerun affected cohorts.
- [ ] After the last code change, run `npm run build`, relevant existing regressions, all V3 tests and the complete acceptance runner. The final report must use this exact commit and input/profile hashes.
- [ ] Produce release report, machine-readable results, before/after measured renders, package hashes, failure/review ledger, known supported envelope and physical qualification checklist.
- [ ] Integrate only verified changes into the main checkout after checking for concurrent edits. Preserve user files. Rerun the build and representative CLI cases after integration; do not silently discard another agent's changes.

## 5. Independent review focus

These five cases are mandatory despite any passing headline count:

1. A 180°-flipped plaque classified as a relief but backed on its detailed face — T04/T05.
2. A perforation whose metadata claims a post but whose final silicone center is empty — T05/T07.
3. A tray with individually valid parts that overlap in assembled position — T06.
4. A rejected tray silently replaced by a jacket and counted as successful — T03/T09/T10.
5. A smaller model that erases lettering, loses a thin post or drops below printer limits — T07/T08/T10.

## 6. What completion means

The digital goal is complete only when the required-success cases genuinely deliver the approved mold family and satisfy all mandatory digital gates; expected-review/rejection cases behave as specified; the coverage matrix has no unexecuted mandatory checks; and the release report is reproducible from the final code and recorded dependencies.

Physical print, clip fit, leakage, silicone tear/demold behavior and end-use material qualification remain a separate evidence stage. Do not claim them as completed by simulations. Provide coupons and representative print/pour procedures so those observations can feed the next calibrated profile.

This is a measurable release target, not proof that every conceivable shape or size can be molded. Newly encountered geometry joins the corpus with a frozen requirement and a failing reproducer before another algorithm change.
