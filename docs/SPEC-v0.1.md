# Mold Generator — V0.1 Build Spec

**Silicone Pour Box Generator** (module codename: *Matrix Mold*)
Status: implementation-ready · Decided: 2026-09-24 · Wayfinder map: `wayfinder/MAP.md`
Glossary: `CONTEXT.md` — Master, Silicone Envelope, Rigid Jacket, Pour Box, Parting/Split, Extraction, Print Package.

---

## 1. Positioning

The **final stage** of a larger AI pipeline (idea → brainstorm → preview image → approval → image-to-3D → **this module**). It turns an approved 3D object into a manufacturable tooling package:

> **Master (printed as-is) + Rigid Jacket (printed, multi-part) with a controlled gap; fill the gap with RTV silicone; remove jacket; the cured silicone IS the mold.**

V0.1 is a **standalone web app** (own shell) with a clean embed path for the parent platform. Everything runs **client-side** — no server, no accounts, user meshes never leave the machine. Commercial-capable: own greenfield code, MIT/Apache dependencies only.

### Input contract (boundary with the upstream image-to-3D stage)

- **Formats**: binary STL in V0.1-M1..M4; GLB/OBJ at M5. STL must be parsed with per-record 50-byte DataView reads — **never** a contiguous typed-array view (48-byte drift bug; see Wayfinder ticket *Offset engine benchmark prototype*, debugging notes).
- **Triangle budget**: accept ≤ 500k after intake decimation; warn > 300k; hard-reject > 5M with user guidance ("regenerate at lower detail"). V0.1 processes up to ~4M in the worker (measured: 3.56M-tri hand parses+welds in ~3 s, constructs in 3.9 s, ~2 GB RSS — heavy but feasible on desktop).
- **Watertightness**: never guaranteed from AI generators. The module owns a **repair gate**: 1 µm vertex weld → winding/orientation check → `Manifold.status()` gate. Hole-filling/solidify is a V0.2 stage; V0.1 rejects non-repairable meshes with a diagnosis.
- **Scale**: mesh units are never trusted. The user confirms physical size (mm) on a slider; default = model-native value interpreted as mm.
- **Reference**: Fatima hand = 3.56M tris (must decimate at intake), watertight, 123.4×148.1×32.2 mm, 217.7 mL.

---

## 2. Stack (locked)

| Layer | Choice |
| --- | --- |
| Build | Vite 5 + TypeScript (strict) |
| UI | React 18 + react-three-fiber 8 + drei 9 (viewer), zustand 5 (state) |
| Geometry kernel | `manifold-3d@3.5.3` (**exact pin** — boolean2 rewrite in flight upstream), in a dedicated Web Worker |
| Spatial analysis | `three-mesh-bvh ^0.8` (closest-point SDF queries, extraction collisions) |
| WASM loading | copy `manifold-3d/manifold.wasm` → `public/` (pinned), instantiate with `{ wasmBinary }` |
| Engine layout | pure TS modules in `src/engine/` (DOM-free, Node-testable); worker wrapper in `src/workers/` |

WASM memory discipline: every `Manifold`/`CrossSection` gets `.delete()` in `try/finally`; `status()` checked after every construction; worker treats kernel errors as fatal → re-instantiate worker.

---

## 3. The four geometries (invariant)

Kept **separate at all times** — never merged into one "mold mesh". This is what makes strength, demolding, extraction, flow, and printer constraints independently reasonable.

```
MASTER (M)  →  SILICONE ENVELOPE (S = dilate(M, G))  →  RIGID JACKET (J = O − S, O = dilate(M, G+W))
            →  ASSEMBLY FEATURES (flanges, lips, bolts, base, funnel, vents)
```

Core types (`src/engine/types.ts`):

```ts
interface MeshArrays { vertProperties: Float32Array; triVerts: Uint32Array }  // numProp = 3 always
type Axis = 'X' | 'Y' | 'Z';
interface AxisPull { axis: Axis; trappedPct: number; avgCrossings: number; maxCrossings: number; rays: number }
interface AnalysisReport { fileName; triCount; vertCount; bbox: {min:[number,number,number]; dim:[number,number,number]};
  volumeMl; watertight; boundaryEdges; nonManifoldEdges; orientationIssues; axes: AxisPull[]; bestAxis: Axis;
  analysisTris: number; warnings: string[] }
interface GenerateParams { gap: number; wall: number; clearance: number; physicalHeight?: number }
interface PartFiles { master: MeshArrays; jacketA: MeshArrays; jacketB: MeshArrays; base: MeshArrays; }
interface GenerateResult { parts: PartFiles; siliconeMl: number; outerDim: [number,number,number]; params: GenerateParams; axis: Axis }
```

---

## 4. Engine stages

### A. Intake & repair (M1)
`parseStl(bytes)` → weld 1 µm (Map of quantized coords) → orientation/orientation-consistency count → construct `Manifold` → `status()` gate → `simplify(0.05)` → **analysis mesh ≤ ~100k tris** (decimated copy; the full-res master is kept untouched for final booleans where detail matters).

### B. Moldability analysis (M1)
- bbox, signed volume, watertight/edge stats (re-weld check).
- **Straight-pull ranking**: for each of ±X/±Y/±Z, binned ray casting (grid 64 ≈ 2 mm cells, verified Möller–Trumbore) counts surface crossings per ray; rays with >2 crossings are "trapped". Output `axes: AxisPull[]` sorted by `trappedPct` ascending → `bestAxis`.
- Measured reference (Fatima hand): Z = 0.0% trapped (max 2/ray) → clean 2-piece ±Z; X/Y ≈ 90% trapped. This ranking is also the **auto-retry ladder** (policy: ranked auto-retry — Wayfinder T003).

### C. Offset engine — SDF + levelSet (M2)  ⟵ the load-bearing decision
**`minkowskiSum` is banned** (measured 191–303 s at 81k tris; per-triangle-hull scaling). Primary engine:

1. Build a **signed-distance grid** over the analysis mesh once: bounds = master bbox expanded by (G+W+2 mm); step 0.6 mm (quality preset; 0.75–1.0 acceptable for draft); distance via `three-mesh-bvh.closestPointToGeometry` (exact); sign via winding number / crossing parity.
2. The **same grid serves both envelopes**: `levelSet(sdf, bounds, step, −G)` → S (silicone outer surface); `levelSet(sdf, bounds, step, −(G+W))` → O (jacket outer surface). Measured: extraction ≈ 0.36 s per surface at 74k tris; callback throughput 2–3M evals/s.
3. Silicone preview volume = `S − M` (Manifold subtract) → live mL readout = `volume/1000 × 1.10` (+10% waste).
4. Rigid jacket volume = `O − S`.
5. Accuracy gate: production-resolution verification — convex-region surface distance must be G ± 0.5·step; finger-gap merge regions are expected (distance < G there by construction).

### D. Split & extraction simulation (M3)
- V0.1 = **2-piece planar split** along `bestAxis`: `jacketA = J ∩ halfspace+`, `jacketB = J ∩ halfspace−` (`trimByPlane`).
- **Extraction sim** per piece: translate along its pull direction in 2 mm increments until fully clear (≥ maxDim × 1.2 travel), collision-testing against Silicone Envelope + Master each step (BVH overlap / Manifold intersect-empty). 
- **On failure**: report trapped region (the colliding ray/subregion data) → UI offers next-ranked axis as one-click retry (regenerate split only). Hard refusal only when all 3 axes fail.

### E. Base & seal (M3)
Flat-base assumption (V0.1): master grounded at its min-plane along the vertical axis (the axis perpendicular to parting... vertical = the pull axis is horizontal; base sits at the bottom of the box). Base plate part: slab with a recessed socket (master footprint from SDF at z=0 slice, +0.25 clearance), perimeter channel registering both jacket halves, anti-leak ridge. Silicone gap is clipped at the base plane (no silicone under the master). Unstable figurines → sacrificial pedestal in V0.2.

### F. Joining system (M3) — single system, frozen
Stepped tongue-and-groove registration lip on the parting plane (male step 1.5 mm deep × 3 mm wide on A, female −clearance on B) → outer flange 10 mm wide × 5 mm thick (2D `CrossSection.offset` + extrude — the cheap mature path) → 4× M3 through-holes + captive-nut pockets (M3×12 + hex nut 5.5 mm across flats, pocket +0.2 mm) → joint clearance per printer preset (FDM 0.25 / Resin 0.15 mm).

### G. Fill & vents (M4)
- Funnel: top of the upper jacket piece, on the parting-axis centroid; bore Ø8 mm through the jacket wall into the gap, funnel mouth Ø14 mm with 45° cone.
- Vents: 2 × Ø2 mm bores at the highest points of the *silicone gap* region (from the SDF grid's column maxima of `SiliconeVolume`), placed through the upper piece.
- Manual dragging is V0.2.

### H. Validation gates (M4) — hard gate, no override (policy)
master watertight · envelope connected & min-gap satisfied · jacket wall ≥ W − tol · each printed piece `status() === ok` + nonzero volume · **extraction pass for both pieces** · fill path reaches gap bottom (column flood check from funnel bore) · export sanity. Failure → diagnosis + ranked retry; never a weakened package.

### I. Print package (M4)
```
pourbox_<name>/
├── 01_master/master.stl            (as-imported, size-normalized)
├── 02_jacket/jacket_A.stl, jacket_B.stl, base_plate.stl
├── 03_preview/silicone_skin.stl    (S − M; the "this is the mold" object)
├── project.json                    (schema: params, axis ranking, volumes, part list, hashes)
└── assembly.md                     (step order, hardware list: 4× M3×12 + nuts)
```
Zipped via `fflate` in the browser.

---

## 5. Parameters & presets (audience: non-CAD users — presets first)

| Preset | Gap G | Wall W | For |
| --- | --- | --- | --- |
| Small detail | 6 mm | 5 mm | figurines < 100 mm |
| **Standard candle** (default) | **8 mm** | **5 mm** | 100–200 mm figurines |
| Rugged | 10 mm | 5 mm | large / rough handling |

Printer preset: **FDM** (joint clearance 0.25 mm, W 5) / **Resin** (0.15 mm, W 2). Physical height slider 30–300 mm. Custom sliders: G 4–15, W 2–6. Everything else hidden.

### V0.1.1 amendments (2026-09-24 — adopted from the commercial corpus study, `IDEAL FOR THE STUDY/STUDY_FINDINGS.md`)
- **Contoured base plate**: outline = jacket footprint (marching squares at base+4 mm, level −(G+W)) offset +6 mm; the jacket's bottom rim seats 3 mm into the plate; master socket unchanged.
- **Open-top crown pour**: both envelopes trimmed at a crown plane = master max height + 6 mm freeboard; a Ø14 bore at the silicone gap's highest point pierces jacket crown cap + silicone cap down to the master — the cured mold keeps it as its casting hole. Wall funnel removed; the 2 auto vents remain.
- **Binder-clip flanges**: the M3 bosses/holes/nut pockets are replaced by 7 mm clip skirts on each half at the parting plane (a 14 mm double-wall band gripped by 6–10 standard 25–32 mm binder clips). Bolts may return as an option for large molds.
- **Wall default 5 mm** (corpus p50 4.6–5.6 mm).
- **Master hollowing**: the packaged master is hollowed to a 3 mm shell via an inward levelSet offset (commercial masters print at 8–27% bbox fill); skipped for thin models.
- **Quiet-line seam ranking**: among axes with ≤10% trapped rays, the ladder prefers the smoothest parting-plane contour (perimeter/circularity of the mid-plane section).
- **Stable-base frame rule**: the vertical axis is the rest axis whose extreme slice carries the most geometry (largest contact footprint).

### Reference-derived requirements (reverse-engineered from the manual pair, 2026-09-24)

`REFRENCE/master_base.stl` (master) + `REFRENCE/box_l.stl` (manually modeled jacket **half**; `scratch/reverse_reference.mjs` is the measurement tool). These numbers are craft evidence, not our invention:

| Measurement | Value | Design consequence |
| --- | --- | --- |
| Implied silicone gap (split normal, n=1969 columns) | **p50 6.2 mm, p10–p90 4.8–11.9** | Manual craft uses ~6 mm — "Small detail" preset matches it; Standard 8 stays for figurines |
| Jacket wall (split normal) | **p50 4.8 mm, p10–p90 4.0–8.0** | **FDM default wall raised 3 → 4 mm**; manual shells err thick for stiffness |
| Parting plane | master mid-plane +1.1 mm (rim at Y 1.12, master mid −0.02) | 2-piece mid-split confirmed as the default proposal |
| Headspace above master top (inner ceiling − master top) | p50 4.4 mm | Pour reservoir headspace ≥ 5 mm becomes a funnel-design constraint (M4) |
| Master bottom vs shell bottom | master protrudes 3.0 mm below the shell | Base plate registers the shell; master base seats into a base socket (M3-E) |
| Shell coverage | ~half the master's surface columns; **zero** shell/master interference along the split normal | Clean half-shell geometry — the missing second half is the manual pain point the product automates |
| Parting choice vs our metric | Author split ⊥ Y; our straight-pull ranks X first (3.5% vs 8.7% trapped) | Seam placement is a human judgment (detail aesthetics) — validates ranked auto-retry over single-proposal |

---

## 6. Architecture

```
Browser
├── React + zustand (src/state/store.ts)        ← UI state only; no mesh data in React state
├── Viewer (R3F/drei) — passive preview, layer toggles (master / silicone / jacket / base)
├── Geometry Worker (src/workers/geometry.worker.ts)
│     manifold-3d + three-mesh-bvh + src/engine/*   ← ALL mesh data lives here
│     protocol: ingest → progress[] → analysis | generate → progress[] → result | failure(axis, trapped)
└── Export (fflate zip) — package assembled in worker, transferred as blobs
```

Transferables both directions; meshes never cloned into React state; the worker owns the full-res master, the analysis mesh, the SDF grid, and all intermediates.

---

## 7. UX flow (V0.1 — passive, wizard-shaped)

1. **Import** — drop STL / file picker (+ placeholder "receive from studio" slot for the parent platform).
2. **Size** — model shown, physical-height slider, mm dims live.
3. **Analysis** — auto-runs on import: badges (watertight / tri count / decimated), axis ranking table, best-axis banner. Generate button.
4. **Result** — 3D preview with layer toggles (translucent teal silicone skin = the mold-to-be), live silicone mL, extraction badge (✓ A / ✓ B), preset switcher.
5. **Export** — package file list + zip download.
Failure state: red trap-region overlay + one-line diagnosis + "Try next axis (Y → 4.1% trapped)" button. No free 3D editing in V0.1.

---

## 8. Milestones (acceptance per row; corpus = hand + box_l + master_base, AI-mesh samples pending)

| M | Deliverable | Acceptance |
| --- | --- | --- |
| **M1 Intake + analysis** | STL parse/weld, Manifold gate, decimation, analysis report, viewer | hand: watertight ✓, bestAxis = Z with < 5% trapped; app builds & runs |
| **M2 Offset engine** | SDF grid (BVH exact), levelSet ×2, silicone preview + mL | hand: silicone skin visible, 290 mL ± 20%, < 60 s generate |
| **M3 Jacket + assembly** | O−S jacket, 2-piece split, extraction sim, base plate, lips/flanges/M3 | both pieces extract on Z; package parts each manifold; bed fit ✓ |
| **M4 Ports + validation + export** | funnel, 2 vents, all §4-H gates, zip package | full package for hand; box_l + master_base pass too |
| **M5 Formats + polish** | GLB/OBJ import, failure overlay UI, embed stub | AI-mesh corpus (T006) round-trips |

## 9. Roadmap (design later — not in this spec)
V0.2: contoured seams, radial 3/4-piece + local cores, parting editor, adaptive thickness, auto-vent flood solver, hole-filling repair, pedestal, printer calibration profiles. V1.0: glove/mother-mold mode, flow solver, platform embed API, accounts.

## 10. Risks & mitigations
- **BVH SDF cost at 500k tris** → analysis mesh decimation, worker + progress, grid step presets. (Brute-force JS measured 1.46 ms/query — BVH is orders faster; budget assumed 2–4M queries → seconds–tens of seconds.)
- **WASM memory** → `.delete()` discipline, one heavy op at a time, worker re-instantiation on kernel error.
- **SDF accuracy at small G** → 0.6 mm grid vs G ≥ 4 mm ≈ 6+ samples across the gap; accuracy gate in §4-C5.
- **Vite + wasm loading** → pinned wasm copied to `public/`, `{ wasmBinary }` instantiation, smoke-tested in CI-like `npm run smoke`.
