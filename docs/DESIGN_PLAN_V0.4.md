# DESIGN PLAN V0.4 — Printability & Reliability Hardening

**Source:** external output audit, 2026-09-26 (full ZIP audit of the Spiderman package: master_base, jacket_A/B, silicone_skin, project.json, assembly.md — geometric measurement + FDM/PLA guidance review).
**Guardrail:** [CORE_MODULE.md](CORE_MODULE.md) invariants hold. Core output stays steady — every geometry-affecting change ships as a preset beside the current default and graduates only after the regression battery + physical coupon trial.

## What the audit confirmed (no action — keep steady)

- Tooling concept (master + gap + jacket), open crown, `silicone_skin` preview concept: correct.
- Jacket orientation (vertical, base/rim down) beats flipped AND seam-down on both halves — measured, not opinion.
- Master orientation upright/plate-down correct; integrated base plate (~8,367 mm² contact) is a good decision.
- 5 mm uniform wall is reliable, merely conservative — not a bug, not urgent.
- Package fits common build volumes; project.json internal math is coherent (576.1 − 226.3 ≈ 349.7 mL checks out).

## Workstreams

### P1 — Export integrity (pure reliability, zero core-output change) — FIRST

Audit §16: exported STLs carry zero-area degenerate triangles (master 8, jacket_A 54, jacket_B 242 faces; jacket_B reads as 122 "components" = 1 real + 121 zero-volume artifacts). A production platform must not depend on slicer repair.

- **Cleanup pass before export** in `src/engine/export.ts` (implemented on top of `weld.ts`): remove zero-area triangles → merge coincident vertices → drop zero-volume components → recalc normals.
- **Hard gates** in `src/engine/gates.ts`: watertight/manifold per exported part and degenerate-face count == 0. Failure blocks the zip, same as the extraction gate.
- Acceptance: regression suites green; re-export Spiderman package; `grep`-level triangle audit shows 0 degenerates; part dimensions/volumes unchanged within 0.1%.

### P2 — Joint fit presets + first-layer relief (small, bounded geometry deltas)

Audit §12/§13: 0.25 mm clearance is too optimistic for a 160 mm tongue/groove on unaudited machines; elephant's-foot compensation belongs in geometry, not the slicer.

- Clearance preset ladder in `src/ui/GeneratePanel.tsx` (+ `scripts/generate_mold.ts` flags): Resin 0.15–0.20 · Calibrated FDM 0.25–0.30 · **Standard FDM 0.35 (new FDM default)** · Loose 0.40–0.45. Current 0.25 stays available as "Calibrated".
- Lead-in chamfer 0.5–1.0 mm at tongue entry — `src/engine/split.ts` (rail geometry).
- Bed-contact relief: 0.4–0.6 mm tall, 0.2–0.3 mm inward chamfer on mating surfaces touching the plate — `split.ts`, applied per-part at the rim.
- Acceptance: extraction press-in sim still passes at every preset; comparator sections unchanged away from the rail.

### P3 — Silicone gap accuracy (the top cost lever; the one deliberate engine evolution)

Audit §4/§5/§10: requested 8 mm behaves as min 7.40 / P10 8.06 / **P50 10.03**. Half the surface carries ~25% excess clearance — silicone is the expensive material.

**Shipped (2026-09-26):** measured, parameterized, and exposed — default unchanged pending the coupon trial (invariant 12).

- **Measured:** the clearance audit now emits a structured band (min/P10/P50/P90 + audit-target flag) into `project.json` (`clearanceBand`). Our gap-8 baseline reproduces the external audit's numbers exactly (7.40/8.06/10.03) — measurement chain validated.
- **Root cause decomposed** (Spiderman, gap 6 → 8 sweeps of `--gap-window`):
  - The ±gap pull-clearance window (invariant 6) accounts for ~0.9–1.3 mm of the P50 excess. Extraction passes at every window down to 1.5 mm on the corpus; the binding constraint is the min-clearance dip, not jamming.
  - The remaining excess (P90 ~10–13 mm) is structural to the shape-following design: the 29° ratchet keeps upper rings fat over steeply narrowing features, and farthest-hit radial resampling bridges fine concave detail. The commercial reference shows the same behavior (their p50 hug reads boxy; p10 dips to 4.0 at gap 6–8 — deeper than our tight-hug p10 of 6.06).
- **Knobs shipped:** `--gap-window <mm>` (CLI), `gapWindow` param (engine), and a UI "Full clearance / Tight hug (½ gap)" pair. Tight hug = gap/2: Spiderman 263→236 mL (−10%), sheep 196→176 mL (−10%), median hug 7.78→6.86, extraction PASS, comparator aperture unchanged (2944 vs 2946 mm², ~97% of REF).
- **Gate policy:** at the default window the min-clearance gate stays hard. When the user explicitly tightens, it flips to advisory with the full band reported — the extraction press-in sim remains the hard gate in every mode. A warning fires when the band misses the audit targets.
- **UI:** "Silicone efficiency" line — requested vs median hug vs excess mL estimate.
- **Acceptance status:** Sheep + Spiderman CLI PASS, extraction PASS, comparator aperture holds. The audit's full band (P50 ≤ 8.5 at gap 8) is NOT reachable by window tuning alone — see P3b.
- **P3b (roadmap):** directional/adaptive window — union pull-direction clearance asymmetrically and keep the hug tight perpendicular to the pull; attack the ratchet's vertical fattening over steeply narrowing features. This is the path to the audit's full target bands.

### P4 — Wall architecture presets (additive; default unchanged until coupon trial) — SHIPPED 2026-09-26

Audit §3/§1/§2: hydrostatic pressure is ~0.25 psi — wall stiffness serves handling/clamping/reuse, not liquid pressure.

- Wall preset chips: **Light 4 mm (audit-recommended) / Standard 5 mm (V0.3 default) / Heavy 6.5 mm**. The seam rails (wall + 7 mm external flange) and seating rim were already reinforced by construction, so the chip sizes the body shell.
- **External ribs shipped** (`--ribs` / UI toggle): four vertical 8 mm fins at the quarter positions between the seam rails, lofted from the envelope's own radial rings (exact surface radius per angle), adaptive 0.5 mm cavity-safe fuse (three-ray max per ring — a flat slab spans tangential radius variation), cavity-intrusion guarded. Measured +4.6 cm³ per jacket on Spiderman; extraction unchanged.
- Jacket volumes now reported in the package parts meta.
- Acceptance: spiderman ribs+hotWax PASS, sheep light-wall+ribs PASS, all regressions green.

### P5 — Material intelligence & release confidence (advisory layer, no geometry) — SHIPPED 2026-09-26

Audit §6/§19: PLA is right for making the mold (room-temp RTV pour) but wrong as universal jacket material when hot wax stays jacketed (wax pours 57–79 °C vs PLA HDT ~55 °C). And the trapped-ray warning must surface as a verdict, not a log line.

- Casting-material chips (Silicone → PLA ok / Hot wax → PETG/ASA) flow into `project.json` (`castingMaterial`), `print_profile.json` (`material.choice`), and a dedicated `assembly.md` guidance line.
- Release-confidence verdict (HIGH ≤ 5% / MEDIUM ≤ 12% / LOW trapped-ray share of the chosen axis) in the UI result box with a test-print recommendation and the multi-panel pointer.
- 3-piece jackets remain **P7 multi-panel** work — the audit's "Generate 3-piece jacket" action is P7's UI entry point.

### P6 — Print profiles ship with the package

Audit §8/§14/§15: one generic profile is wrong — master wants quality, jacket wants speed/structure.

- New additive `print_profile.json` in the zip: per-part nozzle, layer height, perimeters, infill, support policy, brim, seam placement, elephant-foot compensation. Master: 0.4 nozzle, 0.12–0.16 layers, organic supports. Jacket: 0.4 economy / 0.6 fast preset (0.28–0.32 layers), 2–3 perimeters, gyroid 10–15%.
- `assembly.md` gains material/temperature + slicer guidance sections.
- 3MF project export: roadmap (nice-to-have; JSON first).

## Roadmap (post-V0.4, audit items needing new subsystems)

- **P7 multi-panel 3-piece jackets — SHIPPED 2026-09-26** (audit §11's "Generate 3-piece jacket"): when the 2-piece ladder is insufficient (or `--panels 3` / the UI button is used), the trap-heavy half is sub-split along the depth axis at the master's depth mid-plane, so concave fold channels (arm–torso gaps, splayed limbs) open sideways. The heavy side always takes the groove role (a cut tongue orphans its halves); a heavy +pull side swaps the joint roles via `machineJoint`'s flip switch. Sub-panels get their own tongue/groove sub-joint, printable check, ±depth extraction sim, and seat gates. Trigger: auto-retry once when every 2-piece axis fails. Validated: Spiderman 3-piece (A 36.55 / B1 35.05 / B2 33.05 mm), 2-piece parity exact, regressions green. Probe tool: `scripts/probe_trap.ts` (trap distribution per side/height — Spiderman: 3× more trapped verts on −pull).
- **Slicer-aware printability analyzer — SHIPPED 2026-09-26** (audit §7): per-part coarse-layer 45° unsupported-growth + bed-contact analysis (`src/engine/printability.ts`), in project.json, assembly.md (paint hints), and a UI line. Self-validated against the audit's measurements (bed areas within 2%); our jackets measure 492/508 mm² unsupported vs their package's 1,095/2,429.
- **Gravity-flow / air-maxima validator** (audit §18): connectivity ≠ bubble-free; detect local high points in the cavity beyond the flood-fill gate.
- **SLA-master / FDM-jacket workflow** (audit §8 ideal): master profile swap for resin printers (wall 2 / clearance 0.15 already stubbed in the UI).

## Sequencing & acceptance protocol

1. P1 (no-risk reliability) → P2 (bounded presets) → P6-JSON (additive metadata) are safe to implement immediately after this commit.
2. P3 is the only core-engine change — measure, tune behind a flag, comparator-gate.
3. P4/P5/P7 ride after P3; coupon trial (user's Task 10) arbitrates default flips.
4. Every step: `regression_mold` 5/5 · `regression_envelope` 5/5 · `regression_frame` · `regression_release` · Sheep CLI · Spiderman CLI · `compare_molds.py` head-to-head PASS. New gates get fixtures in `scripts/`.
5. Rollback: tag `v0.3-baseline` (f3ebf47) — the commit before any change.
