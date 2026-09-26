# Manufacturing Reliability Layer — V0.5

Approved decision record from the 2026-09-26 grilling (3 rounds, all recommendations accepted).
Companion docs: `CONTEXT.md` (glossary, 7 new terms), `docs/adr/0001-seam-rail-frozen-interface.md`.

## Status (2026-09-26)

Commits 1–8 LANDED (each independently revertible, all smokes green after every landing):
`a1f4f87` station planner (+`400c1b8` pre-existing m4/clean fixes) · `4d53ba8` ZeroClip · `6f0963d` BaseLock · `09c8e86` islands · `5d268e9` bed/brim · `3b7d024` precision warning · `071dba9` fit coupon · `f632ef4` worker export fix + printRisk.

**Commit 9 (hard-gate flip) DEFERRED by its own criterion.** The flip required the corpus (hand + sheep + Spider-Man) to run clean on precision overlaps. Measured: every jacket WARNs (17–144 mm² of overhang inside the precision band) because the joint's own designed geometry — lead-in flare, tip taper — lives in the same pull-strip as the rail. A hard gate at any achievable threshold would block every package. The z-band approach cannot separate "support on the rail face" from "the joint's self-jigging features"; that needs semantic submesh tags (deliberately rejected in Round 1 as invasive). The precision warning stays advisory; revisit only with submesh tagging or a physically-validated threshold from the coupon trial.

Source brief: "ZeroLab Manufacturing Reliability Enhancement" (external). This record **overrides** the brief wherever they differ. Central rule unchanged: *additive layer around the existing engine — no rewrite of offset / envelope / split ladder / gates / tongue-groove / base / STL export.*

## Scope deltas vs the brief

- **Dropped:** `masterHollowing` (no hollowing code exists; worker already exports closed solid, `geometry.worker.ts:248`), rose fixture (exists only as reference 3MF of a finished mold — no master mesh), G-code (brief already excluded).
- **Deferred (parking lot):** sub-seam rail/clips for 3-piece jackets; seam labyrinth/step; base sealant groove; 3MF (P5).
- **Added:** worker export pass-through fix — browser zips currently omit `printability` + `clearanceBand` that CLI includes (`geometry.worker.ts:316-333`).

## P0 — ZeroClamps

- New `src/engine/clamps.ts`: `planClampStations()`, `buildZeroClip()`, `validateZeroClip()`.
- `GenerateParams += clampMode?: 'binder' | 'printed' | 'hybrid'` — default `'binder'`.
- Rail is frozen (ADR-0001); clips adapt to measured `railThickness` per station. Rail geometry is never regenerated.
- Station rules (deterministic): `count = max(2, ceil(usable/40) + 1)`; 12 mm clearance from trimmed rail ends; exclude ±(clipWidth/2 + 2 mm) around rib crossings (ribs at 45/135/225/315° protrude `wall·0.45 + 1` mm past the rail face); honor vent-plan coordinates (planned, not yet drilled). Stations emitted as metadata in **every** package — in binder mode they are the binder-clip placement guidance in `assembly.md`.
- Shipped hardware: one universal `zero_clip.stl` at 0.30 mm default interference (overridable via `calibration.clipFitOffsetMm`). A–D variants live only in the coupon.
- `hybrid` = ZeroClips at stations + binder clips as fill between.
- Clip prototype params (brief §5): width 16–20 mm, arm 20–24 mm, thickness 2.4–2.8 mm, root fillet ≥ 2 mm, lead-in ~1 mm. No hardcoded final interference until coupon results.
- **v1 targets the main seam only.** 3-piece sub-seam stays tongue/groove.
- Acceptance (brief §35): watertight, single component, no degenerates, support-free, no jacket collision at insertion, correctly on-rail, clear of crown and vents.

## P1 — BaseLock

- `GenerateParams += baseLock?: boolean` — default `false`.
- Two halves split along the main seam. Cross-section: floor ring hooks **under** the plate edge (4 mm plate, ~3 mm engagement); inner lip overhangs the **existing rim flange top** — zero change to jacket or plate geometry. Closed load path: jacket rim → collar lip → collar → hook → plate. No table anchoring.
- Join: two mini ZeroClips on integral split ears (reuses the P0 builder).
- Lips chamfered 45° underside (self-supporting). Joint clearance 0.3 mm. Assembly: plate → jacket seated → collar halves slide in laterally → clips close.
- On generation failure: warn + fall back to seam clamps only; never fail the package unless explicitly required.
- Print entry: PETG, no supports.

## P2 — Printability expansion

- **Unsupported islands:** connected components of the per-layer overhang diff. Thresholds: hard-fail candidate > 15 mm², warn 4–15 mm², ignore < 4 mm². Constants exported into `printRisk`, tunable.
- **Bed stability:** slenderness = `height / sqrt(bedArea)`. Brim: 0 below 1.5 (with bedArea ≥ 2000 mm²), 3 below 2.0, 5 below 2.5, 8 at 2.5+. HIGH risk label at 2.5+ — warning-tier only, never gating, never modifies geometry.
- **Precision surfaces:** z-bands derived from construction params (rail band = frame.mid ± 2.5; rim seat = base → base+3; tongue/groove seam band). Support-band overlap = **warning v1**. Bed-contact-on-precision is a separate class → elephant-foot compensation guidance, not rejection.
- **Gate flips:** island hard-fail and precision hard-fail both activate only after `smoke:print` across the corpus (hand + sheep + Spider-Man, 2- and 3-piece) reports zero false positives on human review — one follow-up commit, not in the initial ladder.
- Master profile additions (brief §21): support interface layers 3; warning string "Silicone reproduces support-contact scars."

## P3 — Fit coupon

- **Separate on-demand download** (UI button) — never inside the mold zip.
- Single support-free plate, target < 20 min / < 20 g: three tongue/groove samples at the current mold's clearance ± 0.10 mm; four ZeroClip-on-rail samples A 0.25 / B 0.30 / C 0.35 / D 0.40; one BaseLock segment (rim flange + collar lip + hook under miniature plate edge) **always included**. Variants identified by notch count (1–4), not text.
- `calibration { jointClearanceMm, clipFitOffsetMm, elephantFootMm }` stored in `project.json`. No cloud, no app state.

## P4 — Export & metadata

- `04_hardware/` added; `03_preview/` untouched: `zero_clip.stl`, `base_lock_A.stl`, `base_lock_B.stl`.
- `project.json` (diagnostics): += `fastening { mode, clipCount, clipMaterial, binderClipCompatible, stations[] }`, `baseLock { enabled, parts }`, per-part `printRisk { bedAreaMm2, unsupportedIslandCount, slenderness, brimMm, risk }`, `calibration`. Hybrid: `clipCount` = ZeroClip count; `assembly.md` notes binder fill.
- `print_profile.json` (actions): geometry-derived per part — `orientation` (explicit rim-down / plate-down), `brimMm`, `supportRequired`, `supportBands`; adds missing `jacket_B1`/`jacket_B2` entries for 3-piece; adds hardware entries (`zero_clip`, `base_lock_A/B`: PETG, 4–5 perimeters, 100% infill, no supports).
- Fix worker export to pass `printability` + `clearanceBand` so browser and CLI packages match.

## UI

"Printed hardware (experimental)" group in GeneratePanel: clampMode chips (Binder / Printed / Hybrid), BaseLock toggle, Fit Coupon button. Defaults: binder + off + on-demand. Default output byte-identical when untouched.

## Safety contract

1. Every feature behind its own flag; all defaults preserve current behavior exactly.
2. After every commit: `smoke`, `smoke:offset`, `smoke:m3`, `smoke:m4`, `smoke:m5` green (plus `smoke:ai`).
3. New scripts: `smoke:clamps` (clip watertight/support-free/no-collision/station determinism/BaseLock acceptance/binder rail intact), `smoke:print` (islands/brim/precision on corpus). Corpus: hand, sheep, Spider-Man.
4. Commit ladder — each independently revertible:
   1. `feat: clamp station planner + always-on station metadata`
   2. `feat: ZeroClip geometry + 04_hardware export`
   3. `feat: optional two-piece BaseLock`
   4. `feat: unsupported-island detection + thresholds`
   5. `feat: bed stability, slenderness, auto-brim`
   6. `feat: precision-surface z-band warning`
   7. `feat: fit coupon + calibration fields`
   8. `fix: worker export passes printability/clearanceBand + printRisk metadata`
   9. *(conditional, after corpus-clean)* `feat: gate printability hard fails`
5. **No default flips without physical validation** (brief §39): coupon set printed, assembled/disassembled ≥ 10×, checked for damage / seam compression / BaseLock seating — only then do `printed`/`hybrid` and `baseLock: true` become candidate defaults.
