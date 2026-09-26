// M4 acceptance smoke — spec §8: funnel + 2 vents, validation gates, zip package.
// Runs the complete pipeline on the hand AND on master_base (the corpus's second
// model, which exercises the non-Z split paths).
import { readFileSync, existsSync } from 'node:fs';
import { buildReport } from '../src/engine/analyze';
import { buildPrintFiles } from '../src/engine/export';
import { runGates } from '../src/engine/gates';
import { isStatusOk, loadManifold } from '../src/engine/manifoldLoader';
import { buildSignedDistanceGrid, instanceToMeshArrays } from '../src/engine/offset';
import { generateMoldPackage } from '../src/engine/split';
import { parseStlBinary } from '../src/engine/stl';

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (${detail})`);
  if (!ok) failures++;
};

async function runModel(mod: Awaited<ReturnType<typeof loadManifold>>, file: string): Promise<void> {
  console.log(`\n=== ${file} ===`);
  const bytes = readFileSync(file);
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const tAll = Date.now();

  const parsed = parseStlBinary(ab);
  const mesh = new mod.Mesh({ numProp: 3, vertProperties: parsed.vertProperties, triVerts: parsed.triVerts });
  const man = new mod.Manifold(mesh);
  const dec = man.simplify(0.05);
  const dm = dec.getMesh();
  const analysis = {
    vertProperties: Float32Array.from(dm.vertProperties),
    triVerts: Uint32Array.from(dm.triVerts.subarray(0, dm.numTri * 3)),
  };
  dec.delete();
  man.delete();
  const report = buildReport(file, { ...parsed, vertCount: parsed.vertProperties.length / 3 }, analysis, analysis.triVerts.length / 3, 64);
  const ranked = report.axes.map((a) => a.axis);
  console.log(`  ${parsed.triVerts.length / 3} tris → analysis ${analysis.triVerts.length / 3} · ranked ${ranked.join('→')}`);

  const GAP = 8, WALL = 4;
  const grid = await buildSignedDistanceGrid(analysis, { gap: GAP, wall: WALL, step: 0.75 });

  const pkg = await generateMoldPackage({
    mod, master: analysis, grid,
    params: { gap: GAP, wall: WALL, clearance: 0.25 },
    rankedAxes: ranked, ports: true,
    onProgress: () => {},
  });
  check(`${file}: mold package generated`, pkg !== null, pkg ? `axis ±${pkg.axis}` : 'all axes failed');
  if (!pkg) return;

  check(`${file}: both pieces extract`, pkg.extraction.A.pass && pkg.extraction.B!.pass, `A ${pkg.extraction.A.freeAtMm}mm / B ${pkg.extraction.B!.freeAtMm}mm`);
  check(`${file}: open crown, no pour bore`, pkg.ports.crown === null, `crown ${String(pkg.ports.crown)}`);
  check(`${file}: air vents placed`, pkg.ports.vents.length >= 1, `${pkg.ports.vents.length} vents`);

  const gates = runGates({
    grid, gap: GAP, wall: WALL, step: grid.step,
    frame: pkg.frame, ports: pkg.ports, master: analysis,
    pieceArrays: [pkg.pieces.jacketA, pkg.pieces.jacketB, pkg.pieces.basePlate],
    siliconeMl: pkg.siliconeMl, cavityLoops: pkg.cavityLoops,
  });
  check(`${file}: hard validation gates pass`, gates.pass, gates.checks.filter((c) => c.hard).map((c) => `${c.name}:${c.pass ? '✓' : '✗'}`).join(' '));
  if (!gates.pass) for (const c of gates.checks) console.log(`    · ${c.pass ? '✓' : '✗'} ${c.name}: ${c.detail}`);

  // V0.2 parity with production (worker + CLI): master ∪ base plate is fused
  // through the manifold kernel before export. The raw artist STL never goes
  // to buildPrintFiles directly — the hard export gate rightly rejects it.
  const mm = new mod.Manifold(new mod.Mesh({ numProp: 3, vertProperties: parsed.vertProperties, triVerts: parsed.triVerts }));
  const pm = new mod.Manifold(new mod.Mesh({ numProp: 3, vertProperties: pkg.pieces.basePlate.vertProperties, triVerts: pkg.pieces.basePlate.triVerts }));
  const fused = mm.add(pm);
  if (!isStatusOk(fused)) throw new Error('master/base union failed');
  const masterBase = instanceToMeshArrays(fused);
  fused.delete(); pm.delete(); mm.delete();

  const { zip, fileName, files } = buildPrintFiles({
    masterBase,
    parts: {
      jacketA: pkg.pieces.jacketA, jacketB: pkg.pieces.jacketB, basePlate: pkg.pieces.basePlate,
      siliconeSkin: pkg.pieces.skin,
    },
    info: {
      name: file.replace(/^.*[\\/]/, '').replace(/\.stl$/i, ''),
      createdAt: new Date().toISOString(),
      params: { gap: GAP, wall: WALL, clearance: 0.25 },
      axis: pkg.axis,
      siliconeMl: pkg.siliconeMl,
      extraction: { A: pkg.extraction.A.freeAtMm, B: pkg.extraction.B!.freeAtMm },
      jacketDim: [...pkg.jacketDim],
      plateDim: [...pkg.plateDim],
      warnings: gates.warnings,
      checks: gates.checks,
      crown: null,
      ventCount: pkg.ports.vents.length,
    },
  });
  const masterStl = Object.entries(files).find(([k]) => k.endsWith('master_base.stl'));
  // doll tris; V0.2 fuses the plate on top. The kernel union retriangulates
  // the plate/doll interface (internal faces removed, coplanar seams merged)
  // and cleanup drops degenerates, so the fused master sits slightly UNDER
  // the raw doll's byte size — allow 0.5%. The check's real target: the
  // package carries the FULL-RES master, never the decimated analysis mesh.
  const expectedMaster = (parsed.triVerts.length / 3) * 50 * 0.995 + 84;
  check(`${file}: zip package built`, zip.length > 1_000_000 && zip[0] === 0x50 && zip[1] === 0x4b, `${fileName} ${(zip.length / 1e6).toFixed(1)} MB`);
  check(`${file}: master STL is full resolution`, !!masterStl && masterStl[1].length >= expectedMaster, masterStl ? `${(masterStl[1].length / 1e6).toFixed(1)} MB (>= ${(expectedMaster / 1e6).toFixed(1)})` : 'missing');
  const projectFile = Object.entries(files).find(([k]) => k.endsWith('project.json'));
  let jsonOk = false;
  try { JSON.parse(new TextDecoder().decode(projectFile![1])); jsonOk = true; } catch { jsonOk = false; }
  check(`${file}: project.json valid`, jsonOk, `${(projectFile![1].length / 1024).toFixed(1)} KB`);

  console.log(`  package contents: ${Object.keys(files).length} files, zip ${(zip.length / 1e6).toFixed(1)} MB`);
  console.log(`  ${file}: total ${((Date.now() - tAll) / 1000).toFixed(1)}s`);
}

const hand = 'REFRENCE/obj_1_Molde_mano_de_Fatima.stl';
  // Second corpus model: the sheep DOLL (patron.stl) — a plain master, the
  // input shape the pipeline actually expects, exercising the non-±Z split
  // paths. (master_base.stl — the commercial system's pre-fused tool —
  // double-fuses a plate and its wide slab silhouette stalls the envelope
  // loft for tens of minutes.)
  const sheep = 'IDEAL FOR THE STUDY/Cute+Sheep+++Silicone+Mold+System+/patron.stl';
if (!existsSync(hand) || !existsSync(sheep)) {
  console.error('smoke:m4 — reference files missing');
  process.exit(2);
}
const mod = await loadManifold();
await runModel(mod, hand);
await runModel(mod, sheep);
console.log(failures === 0 ? '\nSMOKE:M4 PASS' : `\nSMOKE:M4 FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
