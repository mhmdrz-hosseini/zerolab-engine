---
id: T007
title: Author the V0.1 build spec
type: task
status: closed
assignee:
blocked-by: [T003, T004, T005, T006, T008]
labels: [wayfinder:task]
---

## Question (task)

Consume every closed ticket and write the destination artifact: the implementation-ready V0.1 build spec (`docs/SPEC-v0.1.md`). Required contents:

- Module positioning + input contract (from the image-to-3D reality check) with the repair-stage gate.
- Greenfield stack: Vite + React + TypeScript + react-three-fiber + Zustand, geometry in Web Workers on Manifold WASM + three-mesh-bvh (per kernel research), standalone-first with an embed contract.
- The four-geometry engine pipeline (Master → Silicone Envelope → Rigid Jacket → Assembly Features) with TypeScript interfaces and the exact algorithm choices per stage: repair, analysis, offset (decimate → minkowski low-poly sphere; SDF/levelSet fallback), split planner at the frozen feature cut, extraction simulation, flanges/registration/anti-leak seam, base/pedestal, fill/vent, validation gates.
- Parameter defaults and presets table (audience: non-CAD users).
- Print package format (files, project.json schema, material estimates).
- UX flow referencing the prototype asset.
- Milestone plan for the implementing agent, and the regression corpus as acceptance criteria.
- Roadmap section: V0.2/V1.0 outlook only (no detailed design — that's a future effort).

Keep the glossary (`CONTEXT.md`) in sync as terms sharpen. This ticket closes the map.

## Resolution

**CLOSED 2026-09-24: spec authored at [docs/SPEC-v0.1.md](../../docs/SPEC-v0.1.md).** Consumes: input contract (T002), kernel + SDF-offset decisions (T001+T008), failure/escalation policy (T003), feature cut (T004), UX flow (T005 folded). Milestones M1–M5 with per-milestone acceptance; implementation started at M1 in the same session.
