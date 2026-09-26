// Head-to-head study: run OUR V0.1.1 pipeline on a commercial system's master
// and compare the resulting mold against THEIR jacket pieces, measured with
// identical ray metrics. Writes our package STLs next to the commercial files.
// Usage: npx tsx scripts/study_compare.ts [folderName] [gap] [wall]
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeBBox } from '../src/engine/analyze';
import { runGates } from '../src/engine/gates';
import { generateMoldPackage } from '../src/engine/split';
import { isStatusOk, loadManifold } from '../src/engine/manifoldLoader';
import { buildSignedDistanceGrid, extractIso, instanceToMeshArrays } from '../src/engine/offset';
import { parseStlBinary, writeStlBinary } from '../src/engine/stl';
import type { MeshArrays } from '../src/engine/types';

const FOLDER = process.argv[2] ?? 'Cute+Sheep+++Silicone+Mold+System+';
const GAP = parseFloat(process.argv[3] ?? '6');   // match their measured p50 gap
const WALL = parseFloat(process.argv[4] ?? '5');  // match their measured p50 wall
const DIR = join('IDEAL FOR THE STUDY', FOLDER);
if (!existsSync(DIR)) { console.error(`missing folder: ${DIR}`); process.exit(2); }

const AXES = ['X', 'Y', 'Z'] as const;
type Ax = 0 | 1 | 2;
let failures = 0;

// ---- shared ray measurement (verified MT) ----
function measurePair(jacket: MeshArrays, master: MeshArrays, axis: Ax) {
  const u = (axis + 1) % 3, v = (axis + 2) % 3;
  const jb = computeBBox(jacket), mb = computeBBox(master);
  const loU = Math.min(jb.min[u], mb.min[u]) - 1, hiU = Math.max(jb.max[u], mb.max[u]) + 1;
  const loV = Math.min(jb.min[v], mb.min[v]) - 1, hiV = Math.max(jb.max[v], mb.max[v]) + 1;
  const spanU = hiU - loU, spanV = hiV - loV;
  const G = 112;
  const bin = (m: MeshArrays) => {
    const cells: number[][] = new Array(G * G);
    const nT = m.triVerts.length / 3;
    for (let t = 0; t < nT; t++) {
      const pu = [0, 0, 0], pv = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        pu[k] = m.vertProperties[m.triVerts[t * 3 + k] * 3 + u];
        pv[k] = m.vertProperties[m.triVerts[t * 3 + k] * 3 + v];
      }
      const i0 = Math.max(0, Math.floor(((Math.min(...pu) - loU) / spanU) * G));
      const i1 = Math.min(G - 1, Math.floor(((Math.max(...pu) - loU) / spanU) * G));
      const j0 = Math.max(0, Math.floor(((Math.min(...pv) - loV) / spanV) * G));
      const j1 = Math.min(G - 1, Math.floor(((Math.max(...pv) - loV) / spanV) * G));
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) (cells[j * G + i] ??= []).push(t);
    }
    return cells;
  };
  const jCells = bin(jacket), mCells = bin(master);
  const crossings = (m: MeshArrays, cells: (number[] | undefined)[], i: number, j: number, oA: number): number[] => {
    const tris = cells[j * G + i];
    if (!tris) return [];
    const orig = [0, 0, 0];
    orig[u] = loU + ((i + 0.5) / G) * spanU;
    orig[v] = loV + ((j + 0.5) / G) * spanV;
    orig[axis] = oA;
    const dir = [0, 0, 0]; dir[axis] = 1;
    const out: number[] = [];
    for (const t of tris) {
      const p = [0, 0, 0], q = [0, 0, 0], r = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        p[k] = m.vertProperties[m.triVerts[t * 3 + k] * 3];
        q[k] = m.vertProperties[m.triVerts[t * 3 + k] * 3 + 1];
        r[k] = m.vertProperties[m.triVerts[t * 3 + k] * 3 + 2];
      }
      const e1 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
      const e2 = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
      const pv = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const denom = dir[0] * pv[0] + dir[1] * pv[1] + dir[2] * pv[2];
      if (Math.abs(denom) < 1e-12) continue;
      const inv = 1 / denom;
      const tv = [orig[0] - p[0], orig[1] - p[1], orig[2] - p[2]];
      const qq = [tv[1] * e2[2] - tv[2] * e2[1], tv[2] * e2[0] - tv[0] * e2[2], tv[0] * e2[1] - tv[1] * e2[0]];
      const bU = (dir[0] * qq[0] + dir[1] * qq[1] + dir[2] * qq[2]) * inv;
      const rr = [e1[1] * tv[2] - e1[2] * tv[1], e1[2] * tv[0] - e1[0] * tv[2], e1[0] * tv[1] - e1[1] * tv[0]];
      const bV = (dir[0] * rr[0] + dir[1] * rr[1] + dir[2] * rr[2]) * inv;
      const tH = (e1[0] * qq[0] + e1[1] * qq[1] + e1[2] * qq[2]) * inv;
      if (tH > 1e-9 && bU >= 0 && bV >= 0 && bU + bV <= 1) out.push(oA + tH);
    }
    return out.sort((a, b) => a - b);
  };
  const oA = Math.min(computeBBox(jacket).min[axis], computeBBox(master).min[axis]) - 5;
  const walls: number[] = [], gaps: number[] = [];
  let raysJ = 0, raysM = 0, raysBoth = 0, negGaps = 0;
  for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) {
    const cj = crossings(jacket, jCells, i, j, oA);
    const cm = crossings(master, mCells, i, j, oA);
    if (cj.length >= 2) raysJ++;
    if (cm.length >= 1) raysM++;
    if (cj.length >= 2 && cm.length >= 2 && cm[cm.length - 1] - cm[0] >= 8) {
      raysBoth++;
      const wall = cj[1] - cj[0], gap = cm[0] - cj[1];
      if (wall > 0.5 && wall < 30) walls.push(wall);
      if (gap > 0 && gap < 40) gaps.push(gap);
      else if (gap <= 0) negGaps++;
    }
  }
  if (gaps.length < 30 && process.env.DEBUG_RAY) {
    let dumped = 0;
    for (let i = 0; i < G && dumped < 3; i++) for (let j = 0; j < G && dumped < 3; j++) {
      const cm = crossings(master, mCells, i, j, oA);
      if (cm.length >= 1) {
        dumped++;
        const cj = crossings(jacket, jCells, i, j, oA);
        console.log(`    col(${i},${j}) cm=[${cm.map((v) => v.toFixed(1)).join(',')}] cj=[${cj.map((v) => v.toFixed(1)).join(',')}]`);
      }
    }
  }
  const q = (arr: number[], p: number) => arr.length ? [...arr].sort((a, b) => a - b)[Math.floor(p * arr.length)] : NaN;
  return { wallP50: q(walls, 0.5), wallP10: q(walls, 0.1), gapP50: q(gaps, 0.5), gapP10: q(gaps, 0.1), n: gaps.length };
}

const fmt = (r: ReturnType<typeof measurePair>) =>
  r.n >= 8 ? `wall p50=${r.wallP50?.toFixed(1)} (p10 ${r.wallP10?.toFixed(1)}) | gap p50=${r.gapP50?.toFixed(1)} (p10 ${r.gapP10?.toFixed(1)})` : 'insufficient hits';

// ---- load the commercial system ----
const loadStl = (name: string): MeshArrays => {
  const p = join(DIR, name);
  if (!existsSync(p)) throw new Error(`missing ${p}`);
  return parseStlBinary(readFileSync(p).buffer.slice(0) as ArrayBuffer);
};
const concatMesh = (a: MeshArrays, b: MeshArrays): MeshArrays => {
  const vp = new Float32Array(a.vertProperties.length + b.vertProperties.length);
  vp.set(a.vertProperties); vp.set(b.vertProperties, a.vertProperties.length);
  const tv = new Uint32Array(a.triVerts.length + b.triVerts.length);
  tv.set(a.triVerts);
  const off = a.vertProperties.length / 3;
  for (let i = 0; i < b.triVerts.length; i++) tv[a.triVerts.length + i] = b.triVerts[i] + off;
  return { vertProperties: vp, triVerts: tv };
};
const theirMaster = loadStl('master_base.stl');
const theirBoxL = loadStl('box_l.stl');
const theirBoxR = loadStl('box_r.stl');
const theirJacket = concatMesh(theirBoxL, theirBoxR); // the assembled mold wraps the master
console.log(`=== commercial system: ${FOLDER} ===`);
console.log(`their master_base: ${theirMaster.triVerts.length / 3} tris | box_l ${theirBoxL.triVerts.length / 3} | box_r ${theirBoxR.triVerts.length / 3}`);

console.log('\n--- THEIR mold, measured (assembled jacket) ---');
const theirMeas = [0, 1, 2].map((a) => measurePair(theirJacket, theirMaster, a as Ax));
for (let a = 0; a < 3; a++) {
  console.log(`  axis ${AXES[a]}: ${fmt(theirMeas[a])}`);
}

// ---- OUR pipeline on their master ----
console.log(`\n=== OUR V0.1.1 pipeline (G=${GAP} W=${WALL}) ===`);
const t0 = Date.now();
const parsed = theirMaster;
const mod = await loadManifold();
const man = new mod.Manifold(new mod.Mesh({ numProp: 3, vertProperties: parsed.vertProperties, triVerts: parsed.triVerts }));
if (!isStatusOk(man)) { console.error('kernel gate refused their master'); process.exit(1); }
const dec = man.simplify(0.05);
const dm = dec.getMesh();
const analysis: MeshArrays = {
  vertProperties: Float32Array.from(dm.vertProperties),
  triVerts: Uint32Array.from(dm.triVerts.subarray(0, dm.numTri * 3)),
};
dec.delete(); man.delete();

const grid = await buildSignedDistanceGrid(analysis, { gap: GAP, wall: WALL, step: 0.75 });
const pkg = await generateMoldPackage({
  mod, master: analysis, grid,
  params: { gap: GAP, wall: WALL, clearance: 0.25 },
  rankedAxes: [0, 1, 2].map((i) => AXES[i]) as ('X' | 'Y' | 'Z')[],
  ports: true,
  onProgress: (stage, pct) => process.stdout.write(`\r  [${(pct * 100).toFixed(0)}%] ${stage}               `),
});
process.stdout.write('\n');
if (!pkg) { console.error('our pipeline failed to find a split'); process.exit(1); }

// V0.2: the glove comes straight from the package (cavity prism − master)
const siliconeMl = pkg.siliconeMl;
const siliconeSkin = pkg.pieces.skin;

// hollow master (worker parity)
const inner = extractIso(mod, grid, 3.0);
const fullMan = new mod.Manifold(new mod.Mesh({ numProp: 3, vertProperties: parsed.vertProperties, triVerts: parsed.triVerts }));
const mv = fullMan.volume();
let masterOut = parsed;
if (inner.volume() > 0.05 * mv) {
  const hollow = fullMan.subtract(inner);
  if (isStatusOk(hollow) && hollow.volume() > 0.2 * mv) masterOut = instanceToMeshArrays(hollow);
  hollow.delete();
}
inner.delete(); fullMan.delete();

const gates = runGates({
  grid, gap: GAP, wall: WALL, step: grid.step,
  frame: pkg.frame, ports: pkg.ports, master: analysis,
  pieceArrays: [pkg.pieces.jacketA, pkg.pieces.jacketB, pkg.pieces.basePlate],
  siliconeMl, cavityLoops: pkg.cavityLoops,
});

console.log(`\n--- OUR mold ---`);
console.log(`axis ±${pkg.axis} | extraction A ${pkg.extraction.A.freeAtMm}mm (pass=${pkg.extraction.A.pass}) / B ${pkg.extraction.B!.freeAtMm}mm (pass=${pkg.extraction.B!.pass})`);
console.log(`jacket ${pkg.jacketDim.map((d) => d.toFixed(0)).join('×')} mm | plate ${pkg.plateDim.map((d) => d.toFixed(0)).join('×')} mm | silicone ${siliconeMl.toFixed(0)} mL`);
for (const c of gates.checks) console.log(`  gate ${c.pass ? '✓' : c.hard ? '✗' : '·'} ${c.name}: ${c.detail}`);

console.log('\n--- OUR mold, measured with the same ray metrics ---');
const ourJacket = concatMesh(pkg.pieces.jacketA, pkg.pieces.jacketB);
const ourMeas = [0, 1, 2].map((a) => measurePair(ourJacket, analysis, a as Ax));
for (let a = 0; a < 3; a++) {
  console.log(`  axis ${AXES[a]}: ${fmt(ourMeas[a])}`);
}

// ---- write our package next to theirs ----
const outDir = join('IDEAL FOR THE STUDY', `OUR_V011_${FOLDER.replace(/\+/g, '_')}`);
mkdirSync(join(outDir, '02_jacket'), { recursive: true });
mkdirSync(join(outDir, '03_preview'), { recursive: true });
writeFileSync(join(outDir, '01_master_hollow.stl'), Buffer.from(writeStlBinary(masterOut)));
writeFileSync(join(outDir, '02_jacket/jacket_A.stl'), Buffer.from(writeStlBinary(pkg.pieces.jacketA)));
writeFileSync(join(outDir, '02_jacket/jacket_B.stl'), Buffer.from(writeStlBinary(pkg.pieces.jacketB)));
writeFileSync(join(outDir, '02_jacket/base_plate.stl'), Buffer.from(writeStlBinary(pkg.pieces.basePlate)));
writeFileSync(join(outDir, '03_preview/silicone_skin.stl'), Buffer.from(writeStlBinary(siliconeSkin)));

const cmp = `# Head-to-head: ${FOLDER}

Master: ${(analysis.triVerts.length).toLocaleString()} tris (analysis) · our G=${GAP} W=${WALL} · split ±${pkg.axis}

| metric | THEIRS (measured) | OURS (measured) |
| --- | --- | --- |
| silicone gap | see axis lines above | see axis lines above |
| jacket wall | see axis lines above | see axis lines above |
| jacket pieces | 2 halves (box_l/r) + master+base combined | 2 halves + fused master_base (V0.2) |
| pour | open top | open crown (V0.2) |
| clamping | (listing) | 6–10 binder clips on 14 mm band |
| master print | solid per listing | hollowed 3 mm shell |

Files: commercial box_l/box_r/master_base in this folder · our parts in \`OUR_V011_*/\`.
Open both in any STL viewer to compare shapes.
`;
writeFileSync(join(outDir, 'COMPARISON.md'), cmp);
console.log(`\nwrote our package to ${outDir}`);
console.log(`total ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(failures === 0 ? 'STUDY:COMPARE PASS' : `STUDY:COMPARE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
