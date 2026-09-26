# Wayfinder Map: Mold Container Generation Module (V0.1 Spec)

Label: `wayfinder:map`

## Destination

An implementation-ready **V0.1 build spec** for the Mold Container Generation Module — the final stage of a larger AI pipeline (idea → brainstorm → preview image → approval → image-to-3D → **this module**). The spec defines: the input contract for AI-generated meshes, the client-side geometry engine (Master → Silicone Envelope → Rigid Jacket → Assembly Features, kept separate at all times), split/extraction/vent planning, validation gates, the print package, and a milestone plan — concrete enough for an agent to implement without further product decisions.

## Notes

- **Tracker**: local markdown. Tickets live in `wayfinder/tickets/` as `<id>-<slug>.md` with frontmatter (`id`, `title`, `type`, `status`, `assignee`, `blocked-by`). Claim = set `assignee`. Close = `status: closed` + a `## Resolution` section. Blocking = the `blocked-by` list.
- **Skills to consult per session**: `grilling` + `domain-modeling` for decision tickets, `research` for research tickets, `prototype` for T005.
- **Standing decisions from charting** (settled with the user 2026-09-23, not re-openable by tickets):
  1. Destination artifact = V0.1 build spec (not code, not decisions-only).
  2. Scope = mold module only; the upstream AI pipeline (idea→image→3D) is a separate effort. The boundary is a written **input contract**.
  3. The module is built **standalone-first** (own app shell) with a clean embed/integration contract for the parent platform.
  4. Geometry runs **client-side** (Web Workers + WASM); server escape hatch only if proven necessary.
  5. **Own greenfield architecture** — no forking SliceForge or porting MoldForge GPL code. Clean-room implementation; MIT/Apache dependencies only (commercial-capable).
  6. Core workflow = **pour jacket only** (thick silicone + rigid jacket). Mother Mold / Glove mode is out of scope for V0.1.
  7. Audience implication: users arrive from the parent platform with a raw idea and zero CAD expertise — presets over parameters (confirm in the UX prototype).
- **Execution override**: the destination is a document, so authoring the spec is carried inside the map as the final task ticket (Author the V0.1 build spec).
- Reference asset in repo: `REFRENCE/obj_1_Molde_mano_de_Fatima.stl` (a hand — worst-case undercuts from fingers; primary regression model).

## Decisions so far

- [Geometry kernel: Manifold WASM reality check](tickets/T001-geometry-kernel-manifold-wasm-reality-check.md): Manifold v3.5.3 (Apache-2.0, ~616 KB WASM) is the primary kernel — booleans proven at 200K–1.5M polys (~303 ms median); `minkowskiSum` later measured unusable (see T008); `levelSet`+BVH-SDF confirmed as the offset path; `CrossSection.offset` for prismatic features.
- [Image-to-3D output reality check](tickets/T002-image-to-3d-output-reality-check.md): input contract = GLB primary (STL/FBX available), 5k–500k accepted / 1M hard ceiling, scale is always a normalized unit cube needing user-confirmed mm, defects (holes, non-manifold, hollow shells) are routine — **repair is an upstream platform-owned stage**; the mold module validates hard and fails with diagnostics.
- [V0.1 failure & escalation policy](tickets/T003-v01-failure-and-escalation-policy.md): ranked auto-retry over parting axes; hard validation gate (no override); visual trap overlay + one-line diagnosis. Hand measured: ±Z straight-pull clean, 2-piece viable.
- [Offset engine benchmark prototype](tickets/T008-offset-engine-benchmark-prototype.md): **SDF grid + `Manifold.levelSet` is the primary offset engine; `minkowskiSum` banned** (191–303 s measured at 81k tris vs 0.36 s levelSet extraction). No server escape hatch needed.
- [V0.1 feature cut & parameter freeze](tickets/T004-v01-feature-cut-and-parameter-freeze.md): full in/out table frozen in spec §4–§5; presets G {6,8,10}/W {3,2}; single M3 joining system; STL-only import until M5.
- [Module UX flow prototype](tickets/T005-module-ux-flow-prototype.md): folded into spec §7 — the working app is the prototype; passive preview + layer toggles, no 3D editing in V0.1.
- [Author the V0.1 build spec](tickets/T007-author-the-v01-build-spec.md): spec delivered at `docs/SPEC-v0.1.md`; implementation started (M1) 2026-09-24.
- [Regression corpus assembly](tickets/T006-regression-corpus-assembly.md): hand + box_l + master_base in repo; AI-mesh samples still pending (not blocking M1–M4).

## Not yet specified

*(empty — all fog graduated or resolved through the V0.1 spec; V0.2/V1.0 items are parked in the spec roadmap section and return as a fresh effort when pursued.)*

## Out of scope

- **Upstream AI pipeline** (idea brainstorm, preview image generation, image-to-3D generation): separate effort. This map only defines the input contract at the boundary.
- **Forking SliceForge / porting MoldForge or matta174/mold-maker code**: ruled out at charting (commercial-capable + own design). Their concepts remain fair game as references.
- **Mother Mold / Glove mode**: beyond the V0.1 destination; returns as a fresh effort if pursued.
- **Monetization, accounts, auth, pricing**: the module is standalone-first; platform concerns come later.
