# Reference-driven open mold: design and acceptance contract

Date: 2026-09-25. This document supersedes the claims of equivalence in
`V0.2_REARCHITECTURE.md`; that document remains historical evidence.

## Product

Given a connected, watertight master in millimeters, produce a printable master
attached to a base, two removable rigid jacket halves, and a silicone preview.
The reference is `IDEAL FOR THE STUDY/Cute+Sheep+++Silicone+Mold+System+`:
`patron.stl` is the input; `box_l.stl`, `box_r.stl`, and `master_base.stl` are
the design examples. Preserve these files and `OUTPUT/pourbox_patron_v02`.

The jacket must follow the broad form while suppressing small surface texture.
Its opening is an intentional upper-neck profile, not the entire model's
projected shadow. Its mating edges have alignment and external clamp lands.
No geometry may hang beneath the seating plane. Model coordinates need not be
centered or symmetric.

## Confirmed defects

- V0.2 uses 16 constant-section slabs: visible horizontal steps are inherent.
- Its tongue/groove clipping retains above the crown and below the base in
  succession: the intersection is empty. Width estimation also assumes an
  origin-centered symmetric master.
- Its release test accepts eventual escape after intersecting the obstacle.
  `scripts/regression_release.ts` failed on that implementation.
- The old crown gate checks height, not whether an opening exists.
- The old flood-fill checks a widest-profile prism, not the tapered cavity;
  neighbor indexing can wrap across rows and includes cells above the crown.
- A plate ending exactly at the lowest master vertex does not guarantee a
  volumetric connection. Automatic sealed hollowing introduces additional
  print concerns unrelated to reproducing the reference.

Reference sections measured at Z = -45, -20, 0, 25, 50, and 60 mm change their
horizontal profile significantly. At Z = 59 mm the reference has a rounded
neck, side joining lands, and local ribs. V0.2 retains a rough whole-body
outline. Earlier reporting of an 88.7 mm 'opening' measured a half-jacket's
outer section span, not the clear aperture; do not reuse it as an aperture target.
The reference STL meshes themselves are not watertight under the current
trimesh import: use them as geometric references, not manifold-quality targets.

## Algorithm decision

Use conservative horizontal support profiles, smooth continuous lofts, and
explicit split-coordinate construction. The prototype reflects the envelope
about the pull plane and convexifies horizontal sections to favor release.
This costs some silicone for asymmetric or concave shapes; measure that cost.
Keep this conservative mode as a fallback. Do not claim it reproduces every
hand-sculpted rib or local concavity of the reference.

The minimum silicone gap is a three-dimensional distance requirement, not a
horizontal offset. Interpolated rings, smoothing, taper limits, and clamps must
be validated against that requirement. The current support-profile construction
is a candidate, not a mathematical proof of the minimum gap.

## Acceptance contract

1. Preserve the input surface and explicit scale. Reject unsupported units or
   topology with a useful message; do not silently resize a dimensioned part.
2. Exactly one connected solid per printed part; closed, consistently oriented,
   manifold meshes; no master/jacket overlap or A/B interference.
3. Master/base connection has positive volume; no floating islands.
4. Minimum master-to-jacket gap at least requested gap minus 0.25 mm, using
   adaptive verification over faces as well as vertices. Sampling is labeled
   as sampling; never call it a proof of the entire surface.
5. Wall normal thickness at least requested wall minus 0.25 mm, except explicitly
   documented mating recesses, whose residual web must be at least 1.2 mm.
6. Crown has no bridging cap; clear aperture follows the upper body envelope;
   freeboard defaults to 10 mm. No open wall outlets below the intended fill line.
7. Joint clearance uses the user parameter; tongue is connected and removable;
   flat external rails can be clamped without obstructing the opening.
8. Release path never penetrates the cavity, master, base, or remaining half
   in the documented assembly/disassembly sequence. Numerical tolerances must
   be stated. A sampled path test is not continuous collision certification.
9. Fill connectivity is evaluated in the actual cavity with bounded neighbor
   indexing. Connectivity is not proof that air cannot be trapped beneath overhangs.
10. Export and browser preview use the same engine, coordinate frame, checks,
    and parameters. Failed hard checks block export.
11. Sheep outputs include repeatable reference comparison renders and measured
    sections; generic fixtures cover translations, rotations, thin features,
    concavity, small scale, disconnected components, and invalid inputs.
12. Physical fit, sealing, and print quality require a joint coupon and one
    prototype print. Software completion must not be presented as print certification.

## Scope boundary

STL, OBJ, and GLB intake already exists. 'Any 3D file' means supported mesh
formats with explicit validation, not every CAD format or arbitrary topology.
A universal two-piece solution is impossible for arbitrary shapes and enclosed
features. This iteration supports validated two-piece rigid jackets and reports
unsupported cases. Automated multipart rigid tooling, silicone cut planning,
air entrapment simulation, and CAD repair are separate future capabilities.
