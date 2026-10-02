# V3 goal mode: sandbox generate, verify, diagnose and repair

## Active objective

Implement [the V3 execution plan](Mold-platform-V3-execution-plan.md) against [the V2 audit](Mold-platform-V2-review.md), and keep iterating until the defined supported-case digital acceptance contract passes. The goal is active in this chat. Creating this runbook does not itself repair or validate the platform.

This is an agent workflow, not a scheduled background service and not a claim that the application already contains a self-repairing engine. The agent edits/tests code; the application executes bounded candidate search and returns explicit outcomes. Continue in the current chat under the active goal. Do not create extra chats, automations or subagents without applicable authorization.

## Goal prompt for an executor

> Work through the V3 execution plan and acceptance JSON. Inspect repository instructions and current git state, then use an isolated checkout. Preserve the original inputs and all old output folders. Reproduce each V2 defect with a failing behavioral test at the production path. Repair the algorithm, regenerate into a new attempt directory, inspect final serialized geometry numerically and visually, and repeat until the supported-case digital contract passes. Do not substitute a jacket for a requested tray, weaken checks, erase detail, relabel a required-success case as unsupported, or claim a physical result from a digital test. Maintain an attempt ledger with source/profile/code hashes and next action. If a geometry or material decision truly requires user input, ask precisely and continue independent tasks. On completion publish reproducible results, actual before/after mesh renders, supported limits, unresolved external qualification and final commit identity.

## Sandbox and evidence locations

- Source repository: `D:/code/3d/MOLD/MOLDGENRATOR`.
- Frozen source inputs: `D:/code/3d/MOLD/MOLD-generator base/input`.
- Existing checkout `D:/code/3d/MOLD/mold-reliability-worktree` may be reusable, but inspect its branch, status and any active process before using it. Its existence does not imply it is current or free.
- Prefer a suitable attached worktree; use the worktree lifecycle tools when available. If unavailable for this projectless chat, create a conventional isolated checkout/worktree after checking the repository and preserve its path in the ledger.
- Place temporary probes/logs under this chat's `work/v3/` or the sandbox's ignored scratch area.
- New generation outputs go under the sandbox's `OUTPUT/v3/<run-id>/<case-id>/<attempt-id>/`. Never overwrite a preceding attempt or V2 evidence.
- Publish user-facing reports, final evidence indexes and representative output packages to this chat's `outputs/` directory. Repository docs may contain working copies, but final chat links should point to deliverables here.

The sandbox reduces accidental damage to the working platform; it does not replace validation. Do not install new system software or alter material/printer settings invisibly to force a test to pass.

## State machine

```text
READ CONTRACT + SNAPSHOT
       |
       v
REPRODUCE FAILING CASE ---> CLASSIFY FIRST FAILURE
                                  |
                                  v
                         FORM TESTABLE HYPOTHESIS
                                  |
                                  v
                         ADD MINIMAL FAILING TEST
                                  |
                                  v
                              REPAIR CODE
                                  |
                                  v
                     GENERATE FRESH EXPORTED FILES
                                  |
                                  v
                     INDEPENDENT METRICS + RENDERS
                                  |
                  +---------------+----------------+
                  | failed                         | passed
                  v                                v
             DIAGNOSE AGAIN                 AFFECTED REGRESSIONS
                                                   |
                                                   v
                                           FULL ACCEPTANCE MATRIX
                                                   |
                                   failed <--------+--------> passed
                                     |                          |
                                     v                          v
                                DIAGNOSE                  RELEASE REPORT
```

The failure path changes the algorithm or an evidence-backed hypothesis. It must not simply regenerate the same files and declare progress. Every new output is evaluated again after cleanup/serialization.

## Per-attempt record

The future runner writes `attempt.json` with these fields:

```json
{
  "schemaVersion": 1,
  "runId": "2026-09-30-v3-development",
  "caseId": "montagem-front-50",
  "attempt": 1,
  "status": "failed",
  "engineCommit": "record actual commit",
  "workingTreeDiffSha256": "record hash when testing uncommitted edits",
  "lockfileSha256": "record lockfile hash",
  "inputSha256": "record source hash",
  "profileSha256": "record manufacturing profile hash",
  "contractSha256": "record frozen acceptance contract hash",
  "firstFailureStage": "construction",
  "failureCode": "UNINTENDED_COMPONENTS",
  "expectedFamily": "open_face_relief",
  "actualFamily": "full_3d_jacket",
  "hypothesis": "Interior loops are being treated as containment walls",
  "experiment": "Measure wall component volumes and inspect a hole cross-section",
  "changedFiles": [],
  "commands": [],
  "checks": [],
  "artifacts": [],
  "nextAction": "Add an exported-cavity occupancy assertion before modifying contour logic"
}
```

This is a field example, not a completed experiment record. The runner must fill provenance with measured values, reject missing required fields, and never emit literal instructional strings as evidence. Commands include exit code, duration and log path. Checks include required/optional, measured value, unit, threshold, pass/fail/unverified and method used. Artifacts include hashes of all STLs and screenshots.

## Diagnose by the earliest broken invariant

| Observed failure | Investigate first | Fix that is not acceptable |
|---|---|---|
| Plate on edge or detailed face | Backing contract, signed plane, frame dependency, transform composition | Rotate the camera or finished package and call the attachment corrected |
| Relief becomes jacket | Intent transport, family enforcement, tray rejection ledger | Leave the fallback and rewrite expectedFamily |
| Disconnected wall islands | External contour versus internal holes, projection topology | Delete all small components without preserving feature semantics |
| Wall will not fit base | Assembled-position intersections, seating shoulder and clearances | Raise overlap tolerance to thousands of mm³ |
| Missing silicone post | Actual final cavity occupancy/connectivity | Assert that a metadata hole record exists |
| Material estimate increases with freeboard | Fill plane versus wall plane, units | Reduce displayed cost without changing the modeled volume |
| Flipped/translated copy behaves differently | Canonical-frame normalization and signed backing | Special-case the filename or the original STL axis |
| Thin feature vanishes | Repair/simplification tolerance and printer resolution | Smooth it away and claim fidelity |
| Release passes but part intersects | Start pose, all installed obstacles, sweep resolution | Skip the obstacle or only check the final separated pose |
| Tests pass but mesh looks wrong | Independent final-output evaluator and missing assertions | Approve based on a green process exit |

## Retry discipline

1. Prioritize the smallest real failing case, then the minimal synthetic reproducer. Preserve both.
2. State a falsifiable hypothesis and the measurement that distinguishes it from alternatives.
3. Change one causal mechanism at a time; run the narrow test before broad batches.
4. After three attempts produce the same failure signature without progress, change the diagnostic strategy: inspect intermediate contours/frames, bisect, or reduce the geometry. This is a reassessment trigger, not permission to abandon a fix or mark it complete.
5. Use per-case time/memory limits in the runner. A limit hit returns a diagnostic with the active stage; it never counts as success. Choose limits from observed baseline timings, record them, and keep the same comparison limits across an experiment.
6. Runtime candidates are deterministic and bounded. Enumerate valid family/frame/split/gap combinations within the approved profile; do not silently grow silicone gap without a cap and material report.
7. Save checkpoints before risky refactors. If a change introduces a regression, repair it or revert only the agent-owned change after preserving its evidence.
8. Reuse proven successful checks until a relevant code/profile/fixture change invalidates them. Do not waste repeated full batches on unchanged code.
9. After a fix, run affected regression cohorts; at a release candidate run the complete required suite after the final edit.

## Visual review protocol

For each required-success case, render source, backing patch, assembled tooling, exploded parts, each printed orientation and silicone cutaways. Compare at the same physical scale where material/size claims are made; label independently fitted views otherwise. Show axes, scale bar, method, source hash prefix, engine commit and part identities.

Inspect: detailed face remains exposed to silicone; base attaches only at approved backing; wall has no unintended roof; the pour opening is accessible; holes/posts are present; seams and clip lands are reachable; print orientations have plausible bed support. A visual concern creates a named issue and a numeric probe where possible. A pretty render cannot override a failed hard check. A green numeric check cannot dismiss an obvious wrong-family or inverted-detail render without investigation.

## Completion and external dependencies

The agent may mark the **digital goal** complete only when:

- Every required-success case passes the expected family and all mandatory digital tests.
- Expected review/rejection cases return the intended outcome without a misleading successful package.
- CLI and browser transport the same intent and produce equivalent verified decisions.
- No required check is skipped, timed out, or represented by metadata alone.
- The full final matrix is tied to the final commit, profile, input and contract hashes.
- No demonstrated V2 defect remains in the supported envelope; no acceptance criterion was relaxed to hide it.
- The final deliverables include measured before/after geometry, change log, regression log, coverage/failure ledger and explicit physical/slicer qualification states.

If physical trials or a genuinely missing design decision prevent a related claim, document exactly what remains. Continue independent software work. Do not call the whole platform physically qualified. Use the goal tool's blocked state only under its own repeated-blocker rules; do not mark complete merely because one turn or a compute budget ends.

Physical follow-up: print calibrated fit coupons and representative plaque, perforated relief, figurine and vessel tooling; check seating/clip engagement and leakage; pour the selected silicone; inspect feature transfer and actual demolding; record material/profile and measured tolerances. Candle and food uses require suitable qualified materials and process conditions, separately from geometry.

## Communication

Report meaningful changes and evidence during work. At a checkpoint, say: case, expected behavior, observed failure, cause established, change, tests passed, remaining uncertainty and next action. Keep the active goal unfinished until the digital completion criteria are actually met. This runbook authorizes continuing the defined work; it does not authorize sending messages, publishing releases or changing unrelated projects.
