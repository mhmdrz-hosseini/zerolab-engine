---
id: T005
title: Module UX flow prototype
type: prototype
status: closed
assignee: agent (session 2026-09-24)
blocked-by: []
labels: [wayfinder:prototype]
---

## Question

What does the module feel like? Users arrive from the parent platform with an approved 3D object and zero CAD expertise. Produce a cheap, rough, concrete artifact to react to — e.g., a clickable HTML stub or a static mock of the step flow:

receive/approve mesh → repair & analysis report → silicone preview on the model (the "this translucent skin is the mold you're making" moment) → parameter step (presets-first) → validation/extraction results → print package download.

Open UX questions the prototype should force: how much 3D interaction exists in V0.1 (passive preview vs dragging vents/planes)? Where does the live silicone-volume (mL) estimate show? How are validation failures visualized (trap-region overlay on the model)? Does the analysis report gate progress or run passively?

Link the prototype as an asset on resolution; the spec's UX section references it.

## Resolution

**CLOSED 2026-09-24: folded into the V0.1 build spec §7 (UX flow) rather than a separate clickable stub — user directed "build spec and start", so the working app itself becomes the artifact to react to. Decisions captured in the spec: step-panel wizard (Import → Size → Analyze → Generate → Export), passive 3D preview with layer toggles only (no dragging in V0.1), live silicone mL readout on the result step, failures as red trap-region overlay + one-line diagnosis + one-click axis retry, analysis runs automatically on import and gates generation.** Interactive parting/vent editing is a V0.2 item; revisit a high-fidelity prototype then if the flow needs validation.
