# CORE MODULE — Locked Platform Invariants

**Status: LOCKED.** These are the platform's load-bearing decisions. Features may be added around them; they do not change without a validated reason, a regression-suite pass, and an explicit version bump. External audits may challenge *parameters* (gaps, walls, clearances) but not these principles.

## What the platform is

A **silicone-mold tooling package generator**: a 3D master in → a print package out:

```text
master (printed positive, fused base plate)
  + controlled silicone gap        → silicone_skin.stl (PREVIEW ONLY)
  + rigid 2-piece jacket + rail    → jacket_A.stl / jacket_B.stl
  → project.json + assembly.md     → zip print package
```

The cured silicone glove — not the printed jacket — is the production mold. The jacket is a reusable mother shell. This is the correct tooling concept; the 2026-09-26 printability audit confirms it ("geometry concept: very good").

## Locked invariants

1. **Tooling architecture.** master + gap + jacket + base plate. Never a direct casting mold, never a solid pour box around the master.

2. **Open crown default** for figurines; cavity must pass the flood-fill reachability gate from the crown plane. No lid geometry over the master.

3. **Jackets print vertically, rim/base down.** Never seam-down: the audit's layer analysis confirms current orientation beats flipped (1,095 mm² vs 3,577 mm² unsupported growth on A) and seam-down ruins first-layer accuracy of the registration rail.

4. **Master prints upright, plate down**, with its own quality profile. Master surface fidelity is sacred: RTV silicone reproduces FDM layer lines, so the master always gets the high-quality profile, never the jacket's fast profile.

5. **`silicone_skin.stl` is always preview-only**, labeled DO NOT PRINT. It is the truth object for silicone volume math.

6. **Shape-following envelope (V0.3 engine).** Per-height kernel slices ⊕(gap+0.1), unioned over the ±gap pull-clearance window (anti-jam), 29° upward ratchet, vertical freeboard, rings resampled radially from a FIXED origin (master bbox center). No per-ring centroids, no arc-length resampling — both fold the loft.

7. **Rigid-release semantics.** Extraction is simulated against the MASTER, never the silicone (the cured glove flexes). Press-in ladder: numeric overlap fails only when ≥ 0.5 mm³ AND non-decreasing.

8. **Hard gates block export; warnings inform.** Extraction, seating, crown, fill reachability, non-emptiness are hard. New reliability checks (mesh cleanliness) join the hard list; cost/quality observations (clearance percentiles, release confidence) stay advisory until physically validated.

9. **All geometry is local** in the Web Worker (manifold-3d WASM pinned). Nothing uploads. STL intake parses RAW 50-byte DataView records — pre-welding at parse time cracked sculpted surfaces; the 1 µm weld lives only where proven safe.

10. **Package contract.** STL set + `project.json` + `assembly.md`, zipped; CLI (`scripts/generate_mold.ts`) and browser worker produce parity output. New metadata files (print profiles) are *additive* — existing consumers never break.

11. **The regression suites are the acceptance authority.** `regression_mold` 5/5, `regression_envelope` 5/5, `regression_frame`, `regression_release`, Sheep CLI, Spiderman CLI, and the `compare_molds.py` head-to-head vs the Cute Sheep reference must stay green across every change. V0.2 and IDEAL FOR THE STUDY remain frozen untouched.

12. **Defaults move only through validated presets.** Any parameter the audit recommends changing (wall, clearance, gap solver) ships first as a named preset beside the current default, graduates to default only after the physical coupon trial proves it. No silent rescales, no silent retunes.

## Parameter posture (audited 2026-09-26)

| Parameter | Current | Audit verdict | Disposition |
|---|---|---|---|
| Jacket wall 5 mm uniform | `generate_mold.ts` WALL=5 | "Reliable, somewhat conservative, not disastrous" | Keep as default; graded-wall preset comes beside it |
| Silicone gap (UI presets 6/8/10) | user-selectable | Nominal 8 behaves as median ~10 — fix the solver, not the preset meaning | Tune engine, keep preset semantics |
| Joint clearance 0.25 mm | FDM default | "Too optimistic as universal default" | Preset ladder (see DESIGN_PLAN_V0.4) |
| Orientation rules | vertical, rim down | Confirmed correct on all parts | Locked (invariants 3–4) |
| Open crown | default | Confirmed smart; add air-trap analysis later | Locked (invariant 2) |

See [DESIGN_PLAN_V0.4.md](DESIGN_PLAN_V0.4.md) for the change plan that respects these invariants.
