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

Audit §4/§5/§10: requested 8 mm behaves as min 7.40 / P10 8.06 / **P50 10.03**. Half the surface carries ~25% excess clearance — silicone is the expensive material. Root cause hypothesis: the V0.3 ±gap pull-clearance window (anti-jam, invariant 6) unions extra silhouette width into the envelope.

- **Measure first:** extend the existing clearance audit in `analyze.ts`/`gates.ts` to emit the full percentile band into `project.json` (min/P10/P50/P90 vs target).
- **Tune `envelope.ts`:** make the pull window parameterized (window factor < 1, or directional-only union) and re-validate slide behavior via the press-in ladder — jam regression is the risk, so tightness is bounded by extraction PASS.
- **Target bands (from audit §5), advisory → hard after coupon trial:** min ≥ 7.5 · P10 ≥ 7.7 · P50 ≤ 8.5 · P90 < 9.0 for an 8 mm request (scaled linearly for other presets).
- **UI:** "Silicone efficiency" line — requested vs median actual vs excess mL — `src/ui/AnalysisPanel.tsx`.
- Acceptance: Sheep + Spiderman CLI PASS, extraction PASS, comparator aperture stays ~97% of REF, P50 within band.

### P4 — Wall architecture presets (additive; default unchanged until coupon trial)

Audit §3/§1/§2: hydrostatic pressure is ~0.25 psi — wall stiffness serves handling/clamping/reuse, not liquid pressure. Graded wall beats uniform thickness on stiffness/material ratio.

- New preset set (body / seam rail / base rim): Economy 3.2/5 · Standard 4.0/5–6 · Heavy 5.0/6–8 — implemented in `split.ts` + worker params. **Current uniform 5 mm remains the shipped default** (invariant 12) until the physical coupon trial.
- External ribs (~2 mm thick, 8–12 mm deep) as local stiffeners instead of global thickness — new `ribs` stage after jacket boolean, opt-in flag, `generate_mold.ts --ribs`.
- Acceptance: per-preset jacket mass reported in project.json; extraction PASS on all presets.

### P5 — Material intelligence & release confidence (advisory layer, no geometry)

Audit §6/§19: PLA is right for making the mold (room-temp RTV pour) but wrong as universal jacket material when hot wax stays jacketed (wax pours 57–79 °C vs PLA HDT ~55 °C). And the 11.1% trapped-ray warning must surface as a verdict, not a log line.

- Material guidance in `assembly.md` + UI: "Silicone-making only → PLA" / "Hot-wax with jacket on → PETG/ASA/HT". Selector feeds `project.json`.
- Release-confidence verdict in `AnalysisPanel.tsx` (LOW/MEDIUM/HIGH from trapped-ray %) with the recommended action.
- 3-piece jackets: this is exactly the already-planned **P7 multi-panel** work (fold-sheet concave cases) — the audit's "Generate 3-piece jacket" button becomes P7's UI entry point. No duplicate design.

### P6 — Print profiles ship with the package

Audit §8/§14/§15: one generic profile is wrong — master wants quality, jacket wants speed/structure.

- New additive `print_profile.json` in the zip: per-part nozzle, layer height, perimeters, infill, support policy, brim, seam placement, elephant-foot compensation. Master: 0.4 nozzle, 0.12–0.16 layers, organic supports. Jacket: 0.4 economy / 0.6 fast preset (0.28–0.32 layers), 2–3 perimeters, gyroid 10–15%.
- `assembly.md` gains material/temperature + slicer guidance sections.
- 3MF project export: roadmap (nice-to-have; JSON first).

## Roadmap (post-V0.4, audit items needing new subsystems)

- **Slicer-aware printability analyzer** (audit §7): 45°-overhang layer analysis per part → support map in the UI. The audit's A=1,095 / B=2,429 mm² method is the spec.
- **Gravity-flow / air-maxima validator** (audit §18): connectivity ≠ bubble-free; detect local high points in the cavity beyond the flood-fill gate.
- **SLA-master / FDM-jacket workflow** (audit §8 ideal): master profile swap for resin printers (wall 2 / clearance 0.15 already stubbed in the UI).

## Sequencing & acceptance protocol

1. P1 (no-risk reliability) → P2 (bounded presets) → P6-JSON (additive metadata) are safe to implement immediately after this commit.
2. P3 is the only core-engine change — measure, tune behind a flag, comparator-gate.
3. P4/P5/P7 ride after P3; coupon trial (user's Task 10) arbitrates default flips.
4. Every step: `regression_mold` 5/5 · `regression_envelope` 5/5 · `regression_frame` · `regression_release` · Sheep CLI · Spiderman CLI · `compare_molds.py` head-to-head PASS. New gates get fixtures in `scripts/`.
5. Rollback: tag `v0.3-baseline` (f3ebf47) — the commit before any change.
