# Matrix Mold — Silicone Pour Box Generator (V0.1)

Turns a 3D-printable STL master into a silicone-mold tooling package: rigid printed jacket + controlled gap → pour RTV silicone → the cured silicone is the mold.

- Spec: [docs/SPEC-v0.1.md](docs/SPEC-v0.1.md)
- Status: **V0.1 complete (M1–M5)** — STL/OBJ/GLB intake → analysis → validated two-piece pour box (silicone skin mL, jacket A/B with labyrinth seam + M3 hardware, base plate with socket, fill funnel + auto vents) → zip print package. Embeddable via postMessage. See spec roadmap for V0.2 (multi-piece jackets, contoured seams, adaptive thickness, auto-vent flood solver).

## Run

```bash
npm install            # also copies the pinned manifold wasm into public/
npm run smoke          # M1 engine test on REFRENCE/obj_1_Molde_mano_de_Fatima.stl
npm run smoke:offset   # M2 acceptance: silicone skin, 290 mL ±20%, < 60 s
npm run smoke:m3       # M3 acceptance: 2-piece split, extraction sim, base plate
npm run smoke:m4       # M4 acceptance: funnel + vents + gates + zip (hand AND master_base)
npm run smoke:m5       # M5 acceptance: GLB/OBJ round-trips, ladder order, trap overlay data
npm run dev            # app at http://localhost:5173 — drop a binary STL
npm run build          # typecheck + production build
```

All geometry runs locally in a Web Worker (manifold-3d WASM). Nothing is uploaded.

## Layout

- `src/engine/` — pure TS geometry modules (parse/weld, obj/glb intake, analysis, SDF offset, contours, split/assembly, ports, gates, export). Node-testable.
- `src/workers/` — the geometry worker (owns all mesh data).
- `src/ui/`, `src/state/` — React + zustand shell (R3F viewer).
- `scripts/` — smoke/regression harness (`npm run smoke*`; regression STLs are local-only, not shipped in the repo).

## Embedding

The module is standalone-first but exposes a minimal postMessage contract for
the parent platform:

```js
iframe.contentWindow.postMessage({ type: 'matrix-mold:ping' }, '*');        // → replies 'matrix-mold:ready'
iframe.contentWindow.postMessage({ type: 'matrix-mold:ingest', bytes, name }, '*'); // bytes = STL/OBJ/GLB ArrayBuffer
```
