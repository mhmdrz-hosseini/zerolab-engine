# Reference-quality Open Mold Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to execute this
> plan task by task in the current session. Do not dispatch agents without
> user authorization. Checkboxes record verified work, not intention.

**Goal:** Produce smooth, fitting, verifiably removable open-jacket tooling
from supported master meshes, using the sheep system as the design benchmark.

**Architecture:** Separate the frame, envelope, joint, and validation concerns
behind geometry-only functions. Use the same orchestration for browser and CLI.
Validate actual resulting solids before creating the print package.

**Tech stack:** TypeScript, Three.js/BVH, pinned manifold-3d 3.5.3, React/Vite,
tsx; Python/trimesh/matplotlib for independent measurement and plots.

**Spec:** [Design and acceptance contract](../../MOLD-REFERENCE-DESIGN.md).
Read it before implementation; the V0.2 study is historical, not the target spec.

## Global constraints

- Run from `D:\code\3d\MOLD\MOLDGENRATOR` in PowerShell.
- Preserve `IDEAL FOR THE STUDY` and `OUTPUT/pourbox_patron_v02`.
- Write new output into `OUTPUT/pourbox_patron_v03` or a later version.
- Keep manifold-3d at 3.5.3; no dependency upgrade is required.
- Dimensions and tolerances are millimeters; volumes exported in mL.
- Do not promise that arbitrary shapes admit two rigid jacket halves.
- Do not treat an STL exported successfully as a printable or releasable part.
- This folder is not a Git repository. Do not issue commits or resets here;
  save checkpoints outside the reference/output directories.

## Current checkpoint — read before running anything

Changes already exist in the working files. They are a prototype, not a completed
release. Do not overwrite them by starting from the old study instructions.

| Item | Observed status (2026-09-25, V0.3 execution) |
| --- | --- |
| Release regression against old implementation | Failed as intended, then fixed; passes (`regression_release.ts`) |
| Continuous shape-following envelope | Implemented in `src/engine/envelope.ts`: kernel slices ⊕gap with ±gap pull window, 29° ratchet, radial resampling from a fixed origin, ear-clipped caps |
| Real seam section, clearance, external rails | Implemented in `src/engine/split.ts`; coplanar re-cuts eliminated (41-component regression root-caused and fixed) |
| Sheep integration | PASS via `scripts/generate_mold.ts`; aperture 2946 mm² = 97% of reference; silicone 196 mL; all gates green; 63.6 s |
| Synthetic suite | `regression_mold.ts` 5/5, `regression_envelope.ts` 5/5, `regression_frame.ts` pass, `regression_release.ts` pass |
| Latest TypeScript check | `npx tsc --noEmit` passes |
| Base attachment, no automatic hollowing, explicit intake validation | Implemented and verified |
| Cavity sections flood fill | Uses the actual ring polygons; 100% reachability on sheep and Spiderman |
| Default wall outlets | Disabled; open crown is the escape route |
| Extraction semantics | Rigid release vs master + base with pressing-in test; dual-BVH (140× speedup) |
| Spiderman validation case | PASS on first ranked axis; 18.6 s; OUTPUT/pourbox_spiderman_v03 |
| Crown aperture gate fixtures (Task 6 fixtures), joints.ts extraction (Task 4 refactor), release interval subdivision (Task 5 continuous) | Remaining work: sim semantics verified empirically; fixtures/refactors pending |
| Physical print or silicone pour | Not performed (Task 10 is the user's coupon trial) |

The existing V0.3 output predates some source edits. Regenerate it after final
checks. `scratch/v03/sections.png` also predates the final rails; it is diagnostic
evidence, not the final deliverable.

## Execution order and completion gates

Run tasks 1–9 in order. A failed gate returns execution to that task; do not
weaken the assertion to preserve a green result. Task 10 is physical validation
and must be reported separately from software completion.

### Task 1 — Capture a reproducible baseline and finish the regression loop

**Files:** existing `scripts/regression_release.ts`, `scripts/regression_mold.ts`,
`scripts/smoke_v02.ts`; create `scripts/compare_molds.py` and
`OUTPUT/validation_v03/baseline.json`.

**Interface:** comparator consumes reference and generated STL paths and writes
JSON with bounds, volume, watertightness, significant component count, and
cross-section loops in original coordinates.

- [ ] Record each input's hash and current source hashes before edits:

```powershell
New-Item -ItemType Directory -Force OUTPUT/validation_v03
Get-FileHash 'IDEAL FOR THE STUDY/Cute+Sheep+++Silicone+Mold+System+/*.stl' |
  Export-Csv OUTPUT/validation_v03/reference-hashes.csv -NoTypeInformation
Get-FileHash src/engine/*.ts |
  Export-Csv OUTPUT/validation_v03/source-hashes.csv -NoTypeInformation
```

- [ ] Run the current regression suite and save failures unchanged:

```powershell
npx tsx scripts/regression_release.ts
npx tsx scripts/regression_mold.ts
npx tsc --noEmit
```

- [ ] In the comparator, keep reference, V0.2, and candidate meshes in their
  original assembled coordinates. Take horizontal sections at -40, 10, and
  59 mm for sheep. Use `mesh.section(plane_origin=[0,0,z], plane_normal=[0,0,1])`.
  Measure inner aperture separately from outer bounds; never infer aperture
  from a half-jacket bounding box.
- [ ] Render separate labeled columns with identical axes and scale. Include
  front, top, section, and exploded views. Seed any random sampling with 0.

**Pass:** commands are reproducible; the release regression rejects the
obstructed path; reports distinguish invalid reference meshes from design quality.

### Task 2 — Stabilize orientation, units, and base attachment

**Files:** modify `src/engine/split.ts`, `src/workers/geometry.worker.ts`,
`src/engine/types.ts`, `src/ui/GeneratePanel.tsx`; create
`scripts/regression_frame.ts`.

**Interfaces:** retain `pickFrame(pull, master): MoldFrame`; extend
`GenerateParams` with optional `verticalAxis?: Axis` and `splitAxis?: Axis`.
Automatic choices remain defaults. The same explicit frame must reach every
geometry and gate function.

- [ ] Add a regression that translates all vertices by `[117,-83,41]`, then
  compares translated frame values and output volume with the untranslated case.
- [ ] Add a tessellation regression: a box and the same subdivided box must
  choose the same base axis. Current vertex-count contact ranking fails this
  requirement; replace it with triangle-area-weighted near-base support scoring.
- [ ] Honor explicit axes; reject identical vertical/split axes before generating.
- [ ] Replace silent scale normalization with explicit unit/size confirmation in
  intake; reject non-finite coordinates, zero dimensions, and unusable meshes.
- [ ] Keep the small buried base connector; check the union has one significant
  component. If it does not, return a base-attachment error, never a bare master.
- [ ] Keep the original master solid; let slicer infill control internal printing.

```ts
assert.equal(fused.decompose().filter(p => p.volume() > 1e-4).length, 1);
assert.equal(frame.vert, requestedVerticalAxis);
assert.notEqual(frame.vert, frame.pull);
```

**Pass:** frame and geometry are translation/tessellation stable; explicit
orientation works on X/Y/Z; master has positive-volume attachment to the plate.

### Task 3 — Complete and validate the smooth envelope

**Files:** modify `src/engine/envelope.ts`, `src/engine/split.ts`; extend
`scripts/regression_mold.ts`; create `scripts/regression_envelope.ts`.

**Existing interface:**

```ts
buildEnvelope(mod, mesh, frame, gap, wall): Envelope
// Envelope contains cavity, outer, release, footprint, widest, sections.
// Caller owns and deletes the returned Manifold solids.
```

- [ ] Preserve triangle-to-height-band clipping; do not revert to sparse
  whole-model slices or vertex-only samples, which miss thin/tall features.
- [ ] Test a cube, sphere, thin horizontal spur, off-center asymmetric body,
  and narrow-neck body with a broad base. Verify the master lies within cavity:

```ts
const escaped = masterSolid.subtract(envelope.cavity);
assert(escaped.volume() <= 0.02);
escaped.delete();
```

- [ ] Validate that support values form valid convex polygons. Intersections of
  adjacent support lines can become redundant or reverse edges after smoothing;
  resolve with half-plane intersection when needed rather than accepting a
  self-intersecting ring. Maintain consistent ring correspondence for the loft.
- [ ] Keep smoothing outward-conservative; bound change between adjacent heights.
  Verify minimum 3D clearance over adaptively sampled faces, including triangle
  centers, long edges, and high-curvature areas. Refine until the distance bound
  is within 0.25 mm, or label the result unverified and block production export.
- [ ] Derive a clean upper-neck profile from upper-body support, extend it through
  the 10 mm freeboard, and verify that it never squeezes the master allowance.
- [ ] Measure normal wall thickness on the final Boolean result. The current
  horizontal wall multiplier is provisional; do not equate it to measured
  normal thickness without checking slopes in both horizontal directions.
- [ ] Compare all sheep sections with reference; record the difference in
  silicone volume and silhouette. Keep symmetry/convexity as a stated release
  tradeoff, not as a claim of exact reference reproduction.

**Pass:** smooth connected walls, no slab terraces, no master intersection,
validated clearance/thickness, a deliberate open neck, and consistent rings.

### Task 4 — Finish the seam, clamp rails, and seating interface

**Files:** modify `src/engine/split.ts`; create `src/engine/joints.ts` when
extracting the tested construction; extend `scripts/regression_mold.ts`.

**Interface to introduce:**

```ts
type JointPair = { A: ManifoldInstance; B: ManifoldInstance };
// Returned solids are caller-owned. Inputs are not mutated or deleted.
buildJointPair(mod: ManifoldMod, jacket: ManifoldInstance,
  frame: MoldFrame, wall: number, clearance: number): JointPair;
```

- [ ] Derive the seam from the actual jacket section in pull coordinates.
  Verify local/world transformations independently for each pull axis.
- [ ] Retain connected tongues and parameterized grooves; use clearance values
  0.15, 0.25, and 0.40 mm in tests. Check groove residual webs remain ≥1.2 mm.
- [ ] Keep 7 mm external lands and 5 mm assembled rail stack as provisional
  defaults. Validate flat clamp contact patches at three heights on each seam.
- [ ] Subtract the cavity after unioning rails, so flanges cannot intrude into
  silicone. Clip rails to the base/crown using the correct half-space direction.
- [ ] Test actual joint overlap and presence:

```ts
const interference = A.intersect(B);
assert(interference.volume() < 0.001);
assert(A.boundingBox().min[pullIndex] < frame.mid - 1);
interference.delete();
```

- [ ] Remove only numerical fragments under 0.0001 mm³. If multiple larger
  components exist, fail with their volumes; never discard a real detached piece.
- [ ] Repeat the component check after converting to Float32 mesh arrays and
  reconstructing the kernel solid. The latest failure occurs at this boundary:
  cleaning the original kernel object alone does not prevent tiny disconnected
  faces from reappearing on export. Repair degenerate mesh faces before export
  and recheck the exported STL, without merging or removing substantive features.
- [ ] Verify every seating rim lies on supported plate area. Add explicit
  registration stops outside the cavity if lateral location is otherwise free;
  ensure stops do not obstruct the release paths in Task 5.

**Pass:** joints survive translation/rotation tests, fit without interference,
have adequate web thickness, and provide real external clamp lands.

### Task 5 — Replace eventual escape with a defensible release-path check

**Files:** modify `src/engine/split.ts`; create `src/engine/release.ts` and
extend `scripts/regression_release.ts`.

**Interface to introduce:**

```ts
type ReleaseCheck = {
  pass: boolean;
  freeAtMm: number;
  checkedStepMm: number;
  collisionToleranceMm3: number;
  method: 'sampled-solid' | 'continuous';
};
```

- [ ] Keep the existing failing fixture: a 2 mm box moves through an obstacle
  before reaching freedom. Add an obstacle beyond the first two clear samples,
  a thin obstacle between sample locations, and containment without surface crossing.
- [ ] Check the starting assembly and entire route to bounding-box separation.
  BVH surface overlap is a broad phase only; Boolean volume resolves coplanar
  contacts and detects containment. The current 0.5 mm sampling cannot certify
  obstacles thinner than its step.
- [ ] Implement interval subdivision with swept bounds and conservative distance
  bounds, or explicitly retain `sampled-solid` status and block a 'certified'
  label. Record the 0.001 mm³ overlap tolerance in results.
- [ ] Test the real disassembly sequence: A against cavity, base, and B;
  then B against cavity and base after A is removed. Test tongue clearance
  during motion, not merely assembled A/B intersection.
- [ ] Dispose all temporary kernel solids and geometries on failure paths.
- [ ] Keep axis retry; preserve reasons for every rejected axis in the user result.

**Pass:** no tunneling, no missed containment, correct sequence, explicit
numerical tolerance and verification method, actionable failure messages.

### Task 6 — Make validation gates measure actual geometry

**Files:** modify `src/engine/gates.ts`, `src/engine/ports.ts`,
`src/engine/types.ts`; create `scripts/regression_gates.ts`.

**Existing input:** `runGates` accepts frame, master, pieces, grid, cavityLoops,
and optional `cavitySections`. Require cavitySections for the new envelope.

- [ ] Add a negative crown fixture by placing a solid cap over a valid jacket.
  It must fail even if the top height equals `frame.crown`.
- [ ] Compute the actual top inner aperture or intersect crown probe rays with
  final solids; compare with the planned neck. A height-only check is forbidden.
- [ ] Flood-fill only cells inside the interpolated cavity sections and below
  the crown, outside the master. Check all three neighbor coordinates before
  flattening indices. Add disconnected-pocket and row-wrap regression fixtures.
- [ ] Keep crown outlets as default; optional lateral holes must be above the
  intended fill level or plugged. Do not claim a wall hole vents an internal
  undercut without a connected channel to that air pocket.
- [ ] Add hard checks for manifoldness, positive volume, connected parts,
  master/base attachment, minimum gap, joint interference, and crown opening.
- [ ] Add separate labels for sampled checks, proven Boolean containment,
  approximate fill connectivity, and unverified physical performance.

```ts
assert.equal(runGates(cappedFixture).pass, false);
assert.equal(runGates(disconnectedCavityFixture).pass, false);
assert.equal(runGates(validOpenFixture).pass, true);
```

The fixture variables above are constructed in `scripts/regression_gates.ts`
from the same generated cube package, adding respectively a crown cap or an
isolated cavity pocket; pass the unchanged package as `validOpenFixture`.

**Pass:** deliberately capped, leaking, disconnected, colliding, or under-thickness
packages cannot pass because of unrelated bounding-box checks.

### Task 7 — Unify worker/CLI generation and correct export semantics

**Files:** modify `src/workers/geometry.worker.ts`, `src/engine/export.ts`,
`src/engine/types.ts`, `scripts/smoke_v02.ts`; create `src/engine/pipeline.ts`
and `scripts/generate_mold.ts`.

**Interface to introduce:**

```ts
generateValidatedPackage({ mod, master, params, onProgress }): Promise<{
  result: GenerateResult;
  frame: MoldFrame;
}>;
```

- [ ] Move shared analysis/ranking/generation/base-fusion/gates into the pipeline.
  The worker handles messages and cancellation; CLI handles filesystem paths.
- [ ] Add positive-solid connection checks after master/base fusion. Remove
  fallback export of an unfused master and old sealed-hollow branches.
- [ ] Export assembled coordinates plus vertical-axis metadata and print
  transforms, or rotate separate print STLs plate-down onto Z=0. Never advise
  'rim-down' without supplying the actual orientation for non-Z molds.
- [ ] Save ZIP as well as extracted files; save parameters, version, frame,
  validation method, warnings, and input hash in project.json.
- [ ] Block both UI and direct worker/CLI export when hard gates fail.
- [ ] Update assembly instructions: lateral assembly, rails for clips, seam/base
  sealing, documented release sequence, and separate silicone-demolding limits.

**CLI to implement:**

```powershell
npx tsx scripts/generate_mold.ts --input 'IDEAL FOR THE STUDY/Cute+Sheep+++Silicone+Mold+System+/patron.stl' --gap 6 --wall 5 --clearance 0.25 --out OUTPUT/pourbox_patron_v03
```

**Pass:** worker and CLI produce matching dimensions/volumes/checks; failed
checks yield nonzero CLI exit and no production ZIP.

### Task 8 — Validate the corpus and browser workflow

**Files:** extend `scripts/regression_mold.ts`, `scripts/smoke_m3.ts`,
`scripts/smoke_m4.ts`, `scripts/smoke_m5.ts`, `scripts/smoke_ai.ts`; update
`package.json` with a `test:mold` command.

- [ ] Run all synthetic fixtures at gap/wall pairs (4,2), (6,5), and (10,6).
  Cover each pull axis, translated inputs, sparse triangles, narrow necks,
  concave outlines, disconnected meshes, and non-finite coordinates.
- [ ] Run sheep, the hand reference, `INPUT/japandi+hart+klein.stl`, and
  `INPUT/obj_1_Spiderman urban.stl`. Preserve failures as named cases.
- [ ] Review legacy tests before updating expected outcomes: old tests may assume
  fixed axes, wall vents, or eventual-escape semantics. Replace only assumptions
  contradicted by the contract; retain real geometry assertions.
- [ ] Run:

```powershell
npx tsx scripts/regression_release.ts
npx tsx scripts/regression_mold.ts
npm run smoke:m3
npm run smoke:m4
npm run smoke:m5
npm run smoke:ai
npm run build
```

- [ ] Exercise the browser: import sheep, set parameters, generate, toggle each
  part, inspect crown/rails/exploded view, download and reopen ZIP. Repeat with
  a non-Z mold and a known invalid input; verify useful errors and blocked export.
- [ ] Track generation duration and peak memory; investigate regressions exceeding
  twice the measured sheep baseline before calling the workflow usable.

**Pass:** fixture matrix is recorded, supported models pass all hard checks,
unsupported models fail explicitly, and browser output matches the CLI.

### Task 9 — Regenerate deliverables and publish an honest comparison

**Files:** `OUTPUT/pourbox_patron_v03`, `OUTPUT/validation_v03`,
`docs/V0.3_VALIDATION.md`, `README.md`, `docs/V0.2_REARCHITECTURE.md`.

- [ ] Regenerate sheep only after the final code changes pass their tests.
- [ ] Run the comparator from Task 1 on reference, frozen V0.2, and final V0.3.
- [ ] Deliver assembled, exploded, crown close-up, seam close-up, and section
  views with consistent scale. Include a compact metrics table: silicone mL,
  jacket volume, measured gap/thickness, aperture area, part dimensions,
  component count, and release method.
- [ ] Mark V0.2 equivalence claims superseded. Document why the reference's
  local ribs or asymmetries may differ from the generalized envelope.
- [ ] Include commands and actual exit results in the validation report; list
  unresolved limitations without presenting prototype output as final.

**Pass:** new package, repeatable evidence, and documentation describe the
same source revision; reference and V0.2 inputs remain unchanged.

### Task 10 — Physical fit and molding validation

**Files:** create `scripts/export_joint_coupon.ts`, export coupons to
`OUTPUT/fit_coupons`, record results in `docs/V0.3_PRINT_TRIAL.md`.

- [ ] Extract a representative 20 mm-high seam segment and seating section.
  Export clearance variants 0.15, 0.25, and 0.40 mm with labels in filenames.
- [ ] Print coupons on the intended printer/material and record layer height,
  shrinkage, fit, clip access, residual webs, and sealing behavior.
- [ ] Use the successful clearance to print the sheep tooling. Inspect support
  needs and base contact before pouring; record leakage and disassembly.
- [ ] Validate the silicone cut/demolding strategy separately from jacket release.

**Pass:** the user records a successful print/fit/seal/release trial. Until then,
report 'software-validated prototype; physical validation pending'.

## Definition of done

Tasks 1–9 constitute software completion. Task 10 establishes the physical
manufacturing result. Neither permits a claim of universal two-piece tooling
for every shape. Deliver the working generalized generator, explicit rejections,
the regenerated sheep package, and evidence sufficient to review its limitations.
