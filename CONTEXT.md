# CONTEXT

## Glossary

- **Mold Module** — The final stage of the platform: turns an approved 3D object into a manufacturable silicone-mold tooling package. Also called "mold container generation".
- **Master** — The positive object to be replicated. Arrives as a mesh from the upstream image-to-3D stage; it gets 3D-printed as-is.
- **Silicone Envelope** — The volume of RTV silicone surrounding the Master at a controlled distance. After curing, this becomes the actual flexible mold.
- **Silicone Gap** — The controlled distance between the Master's surface and the Silicone Envelope's outer boundary.
- **Rigid Jacket** — The 3D-printed, multi-part rigid shell that holds the Silicone Envelope's shape during pouring and curing, then is removed and reused.
- **Pour Box** — The fully assembled tooling: Master + Rigid Jacket + base + clamping hardware, ready to receive silicone.
- **Parting / Split** — The way the Rigid Jacket divides into individually printable, removable pieces.
- **Extraction** — Removing a Rigid Jacket piece (or the Master) without collision; the core removability test.
- **Print Package** — The downloadable bundle: all printable STLs, assembly data, and material estimates.
- **Mother Mold / Glove mode** — A future alternative workflow: thin silicone skin captured by a rigid mother shell. Out of scope for V0.1.
