# Seam Rail is a frozen interface

The jacket's seam rail (the 7 × 5 mm raised land at the parting line, `split.ts` rails build) is declared a frozen interface: its geometry is never modified to suit any particular clamping hardware. All grippers — 25–32 mm binder clips today, printed ZeroClips next — must adapt to the rail as measured (each Clamp Station records its local `railThickness`), never the reverse.

Decided 2026-09-26 during the manufacturing-reliability grilling, because two clip families must share one rail: tuning the rail for the printed clip's spring characteristics would silently break binder-clip compatibility, which is the fallback fastening mode and stays the default until physical coupon validation. The cost of reversing this after clips ship is high — every printed clip dimension derives from the rail section.

## Consequences

- Any future fastening work (sub-seam rails for 3-piece jackets included) is new geometry, not rail edits.
- Rail dimensions may only change via a new explicit version/flag that acknowledges it breaks existing clip geometry.
