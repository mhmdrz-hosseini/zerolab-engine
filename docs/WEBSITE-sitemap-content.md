# Website — Sitemap & Content

**Product:** Moldgenrator (module codename: *Matrix Mold*) — turns any 3D model into a print-ready silicone pour-box mold package.
**Audience:** makers, figurine/candle artists, resin casters, toy designers, and platform builders. Non-CAD users first.
**Voice:** plain-spoken maker tone. Short sentences. Concrete numbers over adjectives. No CAD jargon without a one-line explanation.
**Written:** 2026-09-24 · reflects shipped V0.1 features only; roadmap items marked "coming".

---

## Part 1 — Sitemap

```
/                          Home                 — hero, 4-step pitch, features, presets, CTA to app
/how-it-works              How It Works         — the pipeline, the four geometries, validation gates
/app                       The Generator        — the tool itself (the React app)
/gallery                   Gallery              — real models → real mold packages
/guides                    Guides & Materials   — print it, pour it, demold it
/platforms                 For Platforms        — embed the module, pipeline integration (B2B)
/pricing                   Pricing              — free while in beta (draft, see note)
/faq                       FAQ
/legal/privacy             Privacy
```

Global: top nav · footer · meta/SEO per page (Part 3 covers all three).

| URL | Page title (browser tab) | Job of the page |
| --- | --- | --- |
| `/` | Moldgenrator — 3D model to silicone mold in a minute | Convert: visitor → app launch |
| `/how-it-works` | How it works — Moldgenrator | Convince skeptics: show the engineering |
| `/app` | Generator — Moldgenrator | The product |
| `/gallery` | Gallery — Moldgenrator | Proof with eyes |
| `/guides` | Guides — Moldgenrator | Post-download success (reduce support) |
| `/platforms` | For platforms — Moldgenrator | Land the B2B embed/integration deal |
| `/pricing` | Pricing — Moldgenrator | Remove the "what does it cost" objection |
| `/faq` | FAQ — Moldgenrator | Objection handling, long-tail SEO |
| `/legal/privacy` | Privacy — Moldgenrator | Make the privacy promise contractual |

**Nav (top):** How it works · Gallery · Guides · For platforms · Pricing · **[Open the generator]** (primary button, always visible).

**Pricing note (draft):** pricing model is not decided yet. Copy below ships "free during beta" — safe because the product already runs 100% client-side with no server costs per user. Revise before commercial launch.

---

## Part 2 — Global elements

### Footer

```
Moldgenrator — from 3D model to silicone mold.

Product        Resources            For business        Legal
Generator      How it works         For platforms       Privacy
Gallery        Guides               Embed docs →        (Terms — coming)
               FAQ

Runs entirely in your browser. Your models never leave your machine.
© 2026 Moldgenrator
```

### Reusable copy blocks

- **Privacy one-liner** (use anywhere): "Every calculation happens in your browser. No uploads, no accounts, no telemetry — your model never leaves your machine."
- **Boilerplate** (press/embeds): "Moldgenrator is a web tool that turns a 3D model into a complete silicone-mold tooling package — split analysis, rigid jacket parts, base plate, pour funnel, vents, and an assembly guide — generated in about a minute, entirely in the browser."

---

## Part 3 — Page content

---

### `/` — Home

**Meta description:** Turn any 3D model into a print-ready silicone mold package in about a minute. Split analysis, rigid jacket, funnel and vents, assembly guide — all generated in your browser.

#### Hero

> **H1: Drop in a model. Get out a mold.**
>
> Moldgenrator turns any 3D model — even a messy AI-generated one — into a complete, print-ready silicone pour-box package. Split points, rigid jacket, base plate, pour funnel, vents, assembly guide. About a minute. Nothing uploaded.
>
> [ **Open the generator** ]  [ See how it works → ]
>
> *Runs in your browser · STL / OBJ / GLB · No account needed*

**Hero visual:** interactive 3D exploded view of a finished pour box — master in the middle, translucent silicone skin around it, two jacket halves and base plate hovering apart. (We already have all these parts as meshes from any package export; the R3F viewer already renders every layer with toggles.)

#### Proof strip (small caps under hero)

> **~60 s generation · 100% local · extraction-tested · print-ready zip**

#### Section — The problem

> **H2: The model was the easy part.**
>
> AI can turn a photo into a 3D model in seconds. But a model isn't a product — you need copies of it, and copies need a **mold**.
>
> Making one by hand means CAD work, split decisions, undercuts, vents, and a half a weekend of trial and error. Getting it wrong means a silicone block you can never open, or a cast figure that tears itself apart coming out.
>
> Moldgenrator does the engineering for you — and tests its own work before you print a single gram.

#### Section — How it works (4 steps)

> **H2: From mesh to mold box in four steps**

> **1. Drop your model**
> STL, OBJ, or GLB. Broken mesh from an AI generator? It gets repaired automatically — holes welded, shells fused — before anything else happens.
>
> **2. It finds the split**
> The engine ray-tests all six pull directions and ranks which way the parts come apart cleanly. Trapped regions get flagged and retried on the next-best axis — automatically.
>
> **3. It builds the mold box**
> A rigid two-part jacket at a controlled distance around your model, with registration lips, flanges, a base plate with a fitted socket, a pour funnel, and air vents at the highest points of the gap.
>
> **4. Print, pour, cast**
> Download one zip: every printable part, a silicone volume estimate, the exact hardware list (four M3 bolts — that's it), and a step-by-step assembly guide.

**Visual:** horizontal 4-panel diagram; panels reuse app states (import → analysis badges → layer viewer → zip file list).

#### Section — What's in the zip

> **H2: One download. Everything you need.**
>
> ```
> pourbox_your_model/
> ├── 01_master/master.stl          your object, sized and print-ready
> ├── 02_jacket/                    the rigid shell, in two halves + base plate
> ├── 03_preview/silicone_skin.stl  the mold itself, previewed before you pour
> ├── project.json                  every measurement and setting
> └── assembly.md                   step-by-step build + pour guide
> ```

#### Section — Features grid (6 cards)

> **H2: Engineering you'd otherwise pay a CAD person for**

> **Self-repairing intake** — AI-generated meshes arrive as broken shells. Moldgenrator welds, fuses, and re-validates them before generating. One test mesh arrived with 126,000 errors; it printed fine anyway.
>
> **Extraction tested, not guessed** — every jacket half is collision-simulated along its full pull path before you ever see a download button. If a piece can't come out, you don't get a mold; you get a fix.
>
> **A gap that's actually controlled** — the silicone distance around your model is a parameter you choose (4–15 mm), not a byproduct of eyeballing. Details stay crisp; thick sections stay strong.
>
> **Pour funnel and auto vents** — generated where the physics wants them: fill port on the split axis, two air escapes at the highest points of the cavity.
>
> **Presets, not parameters** — Small detail, Standard candle, Rugged. Pick one, done. Sliders exist if you want them; you'll never need them.
>
> **Nothing leaves your machine** — the geometry engine runs in your browser as a Web Worker. No uploads. No cloud renders. No accounts. Unplug the internet after loading the page; it still works.

#### Section — Presets table

> **H2: Start with a preset**

> | Preset | Silicone gap | Jacket wall | Good for |
> | --- | --- | --- | --- |
> | Small detail | 6 mm | 4 mm | figurines under 100 mm |
> | **Standard candle** *(default)* | **8 mm** | **4 mm** | figurines and candles 100–200 mm |
> | Rugged | 10 mm | 5 mm | large pieces, rough handling |
>
> Works with FDM and resin printers — joint clearances adjust automatically.

#### Section — Who it's for

> **H2: Made for people who make things**
>
> **Figurine & toy artists** — iterate on sculpts and cast limited runs without touching CAD.
> **Candle makers** — the default preset is literally named after you.
> **Resin casters** — validated extraction means parts release; the silicone preview shows exactly what your mold will look like.
> **3D-printing beginners** — if you can print a benchy, you can print this package. The assembly guide tells you the order and the four bolts.
> **Platforms & studios** — embed the whole module in your product with two postMessage calls. [For platforms →]

#### Section — FAQ teaser

> **H2: Questions people actually ask**
>
> - **Does my model get uploaded?** No. Everything runs in your browser — [the long version](/legal/privacy).
> - **My mesh is broken / came from an AI generator.** That's the normal case. It gets repaired on the way in.
> - **What silicone do I need?** Any pourable RTV silicone. The package tells you how many milliliters — before you buy it.
> - **What about undercuts?** The split analyzer finds them, flags them, and retries a different split direction. Complex shapes get multi-piece jackets in an upcoming release.
>
> [All questions →](/faq)

#### Final CTA band

> **H2: Your next model could be casting by tonight.**
> [ **Open the generator** ]
> *Free during beta · nothing to install*

---

### `/how-it-works` — How It Works

**Meta description:** How Moldgenrator engineers a silicone pour box from a 3D model: mesh repair, split analysis, SDF offsets, extraction simulation, validation gates, and the print package.

#### Intro

> **H1: A mold that's been tested before it exists.**
>
> Most mold tools just wrap your model in a box and hope. Moldgenrator keeps four separate geometries in play, validates every physical requirement — watertight, removable, fillable, printable — and refuses to ship a package that fails any of them. Here's the whole pipeline.

#### Section — The four geometries

> **H2: Four parts, never merged**
>
> Every mold is four distinct solids, kept separate from start to finish. That separation is why the result is printable, openable, and fillable — each constraint gets its own geometry and its own check.

> 1. **The Master** — your object, printed as-is.
> 2. **The Silicone Envelope** — the volume silicone will occupy: your model dilated outward by the gap you chose. After curing, this cured skin *is* the mold.
> 3. **The Rigid Jacket** — a printed shell around the envelope that holds wet silicone in shape until it cures, then comes off and is reusable forever.
> 4. **Assembly features** — base plate, registration lips, flanges, bolts, funnel, vents.

**Visual:** the four layers rendered in app colors, exploded, labels attached — reuse the viewer's layer-toggle rendering.

#### Section — Stage by stage

> **H2: What actually happens when you press Generate**

> **1. Intake & repair.** Your file is parsed and welded at 1 µm precision, winding is checked, and the mesh is re-validated as a solid. Broken AI exports — unfused shells, flipped triangles — are repaired here. Unrepairable inputs are refused *with a diagnosis*, never with a shrug.
>
> **2. Analysis.** The engine ray-tests all six pull directions (±X, ±Y, ±Z), counting how many rays get trapped by overhangs and undercuts. The cleanest direction becomes the split axis. It measures size, volume, and wall thickness while it's at it.
>
> **3. Offsetting.** A signed-distance field is built around your model — a grid that knows, for every point in space, exactly how far it is from your surface. The silicone envelope and the jacket are sliced out of that one grid at two different distances, so the gap between them is mathematically uniform — within half a grid step, measured.
>
> **4. The split.** The jacket is cut into two printable halves along the chosen axis, with a stepped tongue-and-groove lip so the halves register perfectly and silicone can't leak out the seam.
>
> **5. Extraction simulation.** Each half is digitally pulled out along its full escape path, in 2 mm steps, collision-tested against the master and the cured envelope at every step. This is the step that separates a mold from a paperweight. Fail here and the engine retries the next-ranked axis — you get a red overlay of exactly what's trapped and a one-click fix.
>
> **6. Ports.** A fill funnel is bored through the top on the split axis; two vent holes are drilled at the highest points of the cavity, found by scanning the silicone volume's own geometry. Air has a way out; silicone has a way in.
>
> **7. Validation gates.** Before export, the whole assembly must pass every gate: master watertight · envelope connected and gap satisfied · jacket walls at full thickness · every part a valid printable solid · both halves extract cleanly · silicone can actually flow from funnel to cavity bottom. **A package that fails any gate is never exported.** You get the diagnosis and the ranked retry instead.
>
> **8. The package.** One zip: full-resolution master, jacket halves, base plate with fitted socket, the silicone preview mesh, a project file with every measurement, and a written assembly guide with the hardware list.

#### Section — Trust numbers

> **H2: Measured, not marketed**

> | | |
> | --- | --- |
> | Generation time, typical figure | ~60 s in a browser tab |
> | Largest test model | 478,000 triangles, repaired and packaged in 61.6 s |
> | Silicone volume accuracy | gap uniform within ±0.5 × grid step, verified per part |
> | What runs on a server | nothing |
>
> The engine has been validated end-to-end on hand-sculpted scans and on meshes straight out of image-to-3D generators — the messiest inputs in the wild.

#### CTA band

> **H2: Watch it work on your own model.**
> [ **Open the generator** ]

---

### `/app` — The Generator

**Meta description:** The Moldgenrator generator — drop an STL, OBJ, or GLB and download a complete silicone pour-box package. Runs locally in your browser.

> **H1: The generator**
>
> Drop a model below. Nothing uploads — the page *is* the tool.
>
> [ — the app embeds here — ]

**On-page support copy:**

- Under the dropzone: **"STL · OBJ · GLB — up to ~500k triangles recommended. AI-generated and slightly-broken meshes welcome; they're repaired automatically."**
- Status-line microcopy (already built in the app):
  - Analyzing: *"Testing six pull directions…"*
  - Warning (repaired mesh): *"Your mesh had open shells. We repaired it — check the result looks right before casting."*
  - Success: *"Both jacket halves extract cleanly. Ready to export."*
  - Failure: *"This direction is blocked by an undercut. Try the next-best direction — one click."*
- Below the viewer, a short "reading the result" block:

> **Reading your result**
> **Teal translucent skin** — the silicone mold your pour will produce. **Two rigid halves + plate** — what you print to form it. The **mL number** is how much silicone to buy. The **✓ badges** mean each half was collision-simulated out of the box successfully.

---

### `/gallery` — Gallery

**Meta description:** Real 3D models turned into real silicone mold packages by Moldgenrator — scans, AI-generated meshes, and figurines.

> **H1: Made with Moldgenrator**
>
> Every package below was generated by the engine and validated end-to-end — split, extraction, fill path. Click a card for the model stats.

**Card template** (repeat per entry; populate from export `project.json` files):

> **[Model name]**
> Source: [hand scan / AI image-to-3D / original sculpt] · [tri count] triangles
> Split: [±Z] · Silicone: [290] mL · Jacket: [2 pieces + plate]
> *"[one-line note, e.g. 'Arrived as an unfused AI mesh — auto-repaired, packaged in 62 s.']"*

**Launch entries (real, from validation runs):**

1. **Hand study** — 3.56M-triangle scan, decimated and split clean on Z with 0% trapped rays; ~290 mL silicone at the Standard preset. *The benchmark piece.*
2. **AI demo figure** — straight out of an image-to-3D model (meters-scale GLB); auto-normalized to 150 mm and packaged in 48.7 s, all gates green.
3. **Japandi figurine** — 478k triangles, arrived as 126k unfused shell errors, auto-repaired via SDF remesh, full validated package in 61.6 s. *The "worst-case input" that became a best case.*

> **Footer note on the page:** "Have a mold to show? Post it — community gallery coming with accounts."

**Visual rule:** each card shows the silicone-skin preview mesh (teal) over the master — it's the most legible "this is a mold" image and we render it already.

---

### `/guides` — Guides & Materials

**Meta description:** Print, pour, and demold your Moldgenrator package: printer settings, silicone selection, hardware list, curing, and casting.

> **H1: From zip to casting**
>
> Your package is designed to assemble with four bolts and no instructions-deciphering. These guides cover the rest.

#### Guide 1 — Printing the parts

> **H2: Print it**
>
> **What you're printing:** the master (your object), jacket halves A and B, and the base plate.
>
> **Material:** PLA or PETG. PETG for anything that meets warm silicone. Walls are generated at 4 mm (FDM) or 2 mm (resin) — no tweaking needed.
>
> **Orientation:** jacket halves print flange-down, no supports. The base plate prints socket-side up. The master prints however it's strongest — the split was chosen so the mold doesn't care how the master was printed, but layer lines on the master *do* show in casts; a light sanding on visible faces pays off.
>
> **Slicer settings that matter:** 3+ perimeters on the jacket halves, 20%+ infill, and print the flanges slow so they stay flat — flat flanges are what make the seal.

#### Guide 2 — Assembling the pour box

> **H2: Bolt it together**
>
> 1. Seat the master in the base plate socket — it only fits one way (the socket is cut to its footprint).
> 2. Lower jacket half B onto the base, registering the perimeter channel.
> 3. Lower half A; the stepped lip aligns the halves and blocks seam leaks.
> 4. Four M3×12 bolts with hex nuts through the flanges. Snug, not gorilla.
>
> *This exact list ships as `assembly.md` inside every package, with your model's numbers filled in.*

#### Guide 3 — Mixing and pouring silicone

> **H2: Pour it**
>
> **What to buy:** pourable RTV silicone (tin-cure is cheap and fine; platinum-cure if you're casting food-adjacent or resin long-term). Buy **your package's mL number + ~10%** — the estimate already includes waste margin.
>
> **Steps:**
> 1. Mix per your silicone's instructions. Measure by weight, not eye.
> 2. Pour **slowly, from one corner**, letting silicone flow across the cavity and push air toward the vents. Thin stream, high position = fewer bubbles.
> 3. Fill until silicone sits in the funnel neck. The vents exist so trapped air can escape — if both show silicone, you're full.
> 4. Cure per instructions (typically 4–24 h at room temperature). Patience beats heat: forcing cure traps bubbles.
> 5. Unbolt, lift the two halves, flex the silicone, and pop your master free.
>
> **You now own a production mold.** The jacket comes off and stores flat; the silicone skin is reusable for dozens to hundreds of casts depending on your casting material.

#### Guide 4 — Materials & shopping list

> **H2: The shopping list**
>
> | Item | Amount | Notes |
> | --- | --- | --- |
> | RTV silicone | see `project.json` mL + 10% | pourable, room-cure |
> | M3×12 bolts + M3 hex nuts | 4 each | shipped in every `assembly.md` |
> | Casting material | your call | resin, wax, plaster, soap, chocolate(ish) |
> | Release agent | optional | most silicones don't need one on the master |
>
> **Troubleshooting quick hits:**
> - **Bubbles in the cast** → pour thinner/slower from higher up; tap the box after pouring.
> - **Silicone won't cure sticky** → tin-cure poisoned by resin residue — use platinum-safe materials or a barrier coat.
> - **Seam leak** → flanges not flat; re-surface on a known-flat plate next print.

---

### `/platforms` — For Platforms

**Meta description:** Embed Moldgenrator in your product: a self-contained mold-generation module with a two-call postMessage API. The final stage of any AI-creation pipeline.

> **H1: The last mile of your creation pipeline is a mold.**
>
> Idea → brainstorm → preview image → approval → image-to-3D… and then what? Your user has a mesh and no product. Moldgenrator is that final stage: drop the generated mesh in, hand back a manufacturable mold package — from inside your product.

#### Section — Embed in two calls

> **H2: A drop-in iframe module**
>
> Ship Moldgenrator as an embedded panel. The whole engine — geometry, validation, export — runs inside the iframe, on your user's machine. No server component of ours, none of yours, no data flows to either.
>
> ```js
> // 1. Is it up?
> iframe.contentWindow.postMessage({ type: 'matrix-mold:ping' }, '*');
> //    → 'matrix-mold:ready'
>
> // 2. Send the model (STL/OBJ/GLB bytes from your image-to-3D stage)
> iframe.contentWindow.postMessage(
>   { type: 'matrix-mold:ingest', bytes, name }, '*');
> ```
>
> Your user sizes the model, reviews the split, presses Generate, downloads the zip. Your product never touches a mesh.

#### Section — Why it holds up at the end of a pipeline

> **H2: Built for exactly these inputs**
>
> **AI-generated meshes are the design case, not the edge case.** Image-to-3D output arrives unfused, off-scale, and in meters as often as millimeters. Moldgenrator auto-repairs shells, auto-normalizes absurd scales, and asks the user to confirm physical size — because mesh units are never trusted.
>
> **Failures come back as guidance, not dead ends.** A mesh that can't be molded returns a diagnosis and ranked alternatives — including "regenerate at lower detail" — phrased for end users, not engineers.
>
> **Own the whole stack.** Greenfield codebase, permissive-licensed dependencies, pinned kernel. No third-party geometry service in the loop, ever.

#### Section — Integration notes (table)

> | | |
> | --- | --- |
> | Delivery | static bundle / iframe embed |
> | Protocol | `ping`/`ready`/`ingest` postMessage (more events on request) |
> | Input contract | STL (binary), OBJ, GLB · ≤ 500k tris recommended · size confirmed by user in-UI |
> | Compute | 100% client-side (WASM) — zero marginal server cost per user |
> | Branding | white-label theming on the embed |
> | Roadmap | platform accounts, flow-solver tier, batch generation |

#### CTA

> **H2: Put a factory at the end of your pipeline.**
> [ **Talk to us** ] · [ Read the embed contract → ]

---

### `/pricing` — Pricing *(draft — pending commercial decision)*

**Meta description:** Moldgenrator pricing — free during beta. The generator runs entirely in your browser.

> **H1: Free while it's in beta.**
>
> The generator runs on your machine, so it costs us nothing when it runs for you. Every gate, every feature, every export — free while we're in beta.
>
> **What that includes:**
> - Unlimited generations, no account
> - Full print packages, no watermarks or size caps
> - All presets and both printer profiles
>
> **Coming later:** multi-piece jackets for complex shapes, contoured base plates, and platform embed licensing. Beta users keep their perks.
>
> [ **Open the generator** ]
>
> *Note for the curious: there's no "free tier" fine print because there's no paid tier yet. When there is, generation stays free for personal use.*

---

### `/faq` — FAQ

**Meta description:** Moldgenrator FAQ — formats, privacy, mesh repair, printers, silicone, undercuts, sizes, and what's in the download package.

> **H1: Questions, answered**

**The model**

> **What file formats work?**
> STL (binary), OBJ, and GLB. Export from Blender, or straight out of any image-to-3D generator.
>
> **My mesh is broken — holes, floating shells, inverted faces. Will it work?**
> Probably. Repair runs automatically at import: vertices weld, shells fuse, orientation fixes. One real test file arrived with 126,296 unfused-shell errors and still produced a full, validated mold package. Truly unrepairable meshes are refused with a plain-English diagnosis, not a cryptic error.
>
> **How big can my model be?**
> Around 500k triangles is the comfortable zone; it handles much more (a 3.56M-triangle scan processed fine) but slows down. Physical size: set anything from 30 to 300 mm tall with the slider.
>
> **Does it work with models from AI image-to-3D tools?**
> That's the primary use case. They arrive broken and off-scale; Moldgenrator repairs and rescales them and asks you to confirm the real-world size.

**Privacy**

> **Does my model get uploaded anywhere?**
> No. The geometry engine is compiled to WebAssembly and runs in your browser tab. Your file never leaves your machine — you can load the page and disconnect from the internet.
>
> **Why no accounts?**
> Nothing to store. Your models, your packages, your disk.

**The mold**

> **What exactly do I download?**
> One zip: the master STL, two jacket halves, the base plate, a preview of the silicone mold itself, a project file with every measurement, and a written assembly guide including the bolt list.
>
> **What printer do I need?**
> FDM or resin — the package adjusts joint clearances automatically. A typical figurine package fits a 256 mm bed; smaller models fit smaller beds.
>
> **What silicone do I use?**
> Any pourable RTV silicone. The package tells you the exact milliliters you need before you buy.
>
> **What about undercuts and tricky shapes?**
> The engine ray-tests six pull directions and ranks them. Undercuts that block one direction trigger an automatic retry on the next-best. Deeply trapped shapes get multi-piece jackets in an upcoming release — complex models today may come back with that advice.
>
> **Can I reuse the mold?**
> Yes — that's the point. The printed jacket is reusable tooling; the cured silicone skin is the production mold, good for dozens to hundreds of casts depending on material.
>
> **Can I sell things I cast?**
> Yes. Your model, your mold, your casts. (Respect the license of models you didn't make — that part's on you, as with any tool.)

**Product**

> **Is it really free?**
> Free during beta, no account, no limits. See [pricing](/pricing).
>
> **Can I embed it in my product?**
> Yes — that's a designed use case. [For platforms →](/platforms)

---

### `/legal/privacy` — Privacy

**Meta description:** Moldgenrator privacy: your models never leave your machine. No uploads, no accounts, no tracking of your geometry.

> **H1: Privacy — short, because there's not much to say.**
>
> **Your models.** Moldgenrator does its work in your browser. Model files are parsed, analyzed, and packaged by code running locally in a Web Worker. Your geometry is never uploaded, transmitted, stored, or seen by us — there is no server to send it to.
>
> **No accounts.** We don't have your email, because there's nothing to sign up for.
>
> **What we'd ever collect (and currently don't):** the site may later use standard, anonymous, aggregate page analytics. Your model files and generated packages are not part of that — they can't be, they never leave the tab.
>
> **Downloads.** Packages you export are created in your browser and saved straight to your disk.
>
> **Questions?** One email at the footer address gets a human.

---

## Part 4 — Asset checklist (what to produce for the site)

1. **Exploded pour-box hero render** — master / silicone skin / jacket A / jacket B / base plate, exploded along Z, studio lighting. Render from any exported package (hand study is the benchmark).
2. **4-step diagram panels** — screenshots of real app states: dropzone, analysis badges + axis ranking, layer-toggled viewer, zip file list.
3. **Silicone-skin-on-master beauty shots** — the teal translucent skin over the master, 3/4 view; the single most communicative image the product has.
4. **The four geometries diagram** — labeled exploded render for How It Works.
5. **Gallery renders** — one per launch entry (hand study, AI demo figure, japandi figurine), silicone skin over master.
6. **OG image** — hero render + "Drop in a model. Get out a mold."

## Part 5 — Open items for the owner (non-blocking)

- Product name for public use: "Moldgenrator" used throughout as working name; "Matrix Mold" stays the module codename.
- Pricing page is beta-honest; revisit before commercial launch.
- Community gallery entry point is a placeholder until accounts exist (V1.0 roadmap).
- Roadmap claims limited to: multi-piece jackets, contoured base plates, platform accounts — matches spec §9. Anything else shipped from the V0.1.1 plan (open-top pour crown, contoured plates) can replace the corresponding copy lines once implemented.
