---
id: T003
title: V0.1 failure & escalation policy
type: grilling
status: closed
assignee: agent (session 2026-09-23)
blocked-by: []
labels: [wayfinder:grilling]
---

## Question

The primary regression model is a hand (Fatima hand STL): fingers are worst-case undercuts that a 2-piece planar jacket will almost certainly fail to extract. V0.1 must decide what it promises when geometry can't be molded by what it can generate. Candidates:

- **A. Honest rejection**: V0.1 generates 2-piece jackets only; extraction simulation runs; on failure the module clearly explains *why* (which region traps) and refuses to emit a package. Users with hard models are told "not yet supported".
- **B. Auto-escalation**: V0.1 implements the 2 → 3 → 4-piece + local-core escalation ladder from the brainstorm (much bigger engine scope).
- **C. Assisted manual split**: V0.1 generates 2-piece by default, lets the user reposition/rotate the parting plane (and add one local split) interactively, re-validating on each change.

Related sub-decisions: does the module ever silently weaken validation to produce *something*? What does the failure report contain (visual trap-region overlay vs text)?

This decision sizes the engine: A is a validation gate, C adds an interactive parting editor, B adds a whole planner tier. It also defines the product's honesty for the rest of the platform's users.

## Resolution

**CLOSED 2026-09-24: user directed "build spec and start" — the recorded recommendations are adopted as the V0.1 policy.**

1. **Ranked auto-retry**: V0.1 proposes the best parting axis, validates extraction, and on failure offers next-ranked axes as one-click retries. Hard refusal with trap report only when all candidates fail. Multi-piece escalation → V0.2; free parting-plane editing → V0.2.
2. **Hard validation gate, no override**: no print package without passing extraction and geometry validation; no "override at own risk" in V0.1.
3. **Visual trap overlay + one-line diagnosis** on failure.

Supporting facts (measured 2026-09-23): Fatima hand watertight (0 boundary edges / 5.3M), 123×148×32 mm, 218 mL; ±Z straight-pull 0.0% trapped rays (max 2 crossings/ray); X/Y ~90% trapped; 3.56M tris = 12× contract budget → intake decimation mandatory. `scratch/analyze_stl.mjs` is the reference implementation.

### Measured facts (agent, 2026-09-23 — `scratch/analyze_stl.mjs`)

Fatima hand STL (correct 50-byte binary parse; earlier "corruption" readings were an analyzer stride bug, not file damage):
- 3,563,554 tris, **0 bad triangles, 100% unit normals, 0 boundary edges** — effectively watertight (118/5.3M suspect edges = 1µm-weld noise)
- bbox **123.4 × 148.1 × 32.2 mm** — flat relief-style Hamsa hand, 217.7 mL
- **Straight-pull analysis: axis Z = 0.0% trapped rays, max 2 crossings per ray** → a ±Z two-piece split is geometrically viable; X/Y fail (~90% trapped, fingers overlap laterally)
- 3.56M tris = 12× the 300k input-contract budget → intake decimation mandatory before any boolean work
- User-provided `box_l.stl` (120×56×109 mm, near-clean ±Y pull) and `master_base.stl` (116×109×102 mm, ~perfectly watertight) look like prior manual box/base attempts — added to the regression corpus ticket

### Agent recommendations (pending user confirmation)

1. **Policy: ranked auto-retry.** V0.1 always proposes the best parting axis, validates extraction, and on failure offers next-ranked axes as one-click retries (the orientation analyzer scores all axes anyway — retry is nearly free). Hard refusal with trap report only when all candidates fail. Multi-piece escalation → V0.2 roadmap; free parting-plane editing → V0.2. Rationale: the hand passes out of the box; non-CAD users can't place parting planes by hand, but they CAN click "try next orientation".
2. **Honesty floor: hard gate, no override.** No package without passing validation; no "override at own risk" in V0.1 — the parent-platform audience cannot evaluate mold risk themselves.
3. **Failure UX: visual trap overlay + one-line diagnosis.** The ray-cast analysis already knows which regions trap; coloring them on the model is the differentiator vs existing tools and reuses existing data.
