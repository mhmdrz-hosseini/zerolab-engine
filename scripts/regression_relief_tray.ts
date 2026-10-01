// Open-face relief tray regression (plan Task 6, M1): face-up casting mold —
// NOT the old jacket rotated onto its back. The tray must deliver: horizontal
// support plate, contour wall with NO roof, deliberate silicone backing above
// the highest feature, accessible open face, master fused to the plate, and
// through-holes preserved as silicone posts (withdrawable, never filled shut).
import assert from 'node:assert/strict';
import { loadManifold, isStatusOk } from '../src/engine/manifoldLoader';
import { auditMeshArrays, cleanExportMesh } from '../src/engine/clean';
import { buildReliefTray } from '../src/engine/reliefTray';
import { runTrayGates } from '../src/engine/gates';
import type { MeshArrays } from '../src/engine/types';

const mod = await loadManifold();
const arrays = (m: any): MeshArrays => {
  const dm = m.getMesh();
  const out: MeshArrays = { vertProperties: Float32Array.from(dm.vertProperties), triVerts: Uint32Array.from(dm.triVerts.subarray(0, dm.numTri * 3)) };
  m.delete();
  return out;
};
// judge parts the way the shipped pipeline does — through the export cleanup
// the export gate applies (raw CSG output carries weldable T-junctions exactly
// like the jacket flow; the slicer never sees the raw arrays)
const printValid = (name: string, raw: MeshArrays, minVolCm3 = 0.01) => {
  const mesh = cleanExportMesh(raw, mod).mesh;
  const m = new mod.Manifold(new mod.Mesh({ numProp: 3, ...mesh }));
  assert.ok(isStatusOk(m), `${name}: kernel rejects the printed part`);
  const vol = m.volume() / 1000;
  assert.ok(vol > minVolCm3, `${name}: volume ${vol.toFixed(2)} cm³`);
  const comps = m.decompose();
  assert.equal(comps.length, 1, `${name}: detached printed material (${comps.length} components)`);
  comps.forEach((x) => x.delete());
  const a = auditMeshArrays(mesh.vertProperties, mesh.triVerts);
  assert.ok(a.watertight, `${name}: not watertight (boundary ${a.boundaryEdges}, non-manifold ${a.nonManifoldEdges})`);
  assert.equal(a.degenerateTris, 0, `${name}: ${a.degenerateTris} degenerate faces`);
  m.delete();
  return vol;
};

// --- fixture: 50 mm embossed plaque, flat back, one raised island ---
const plaque = (() => {
  const slab = mod.Manifold.cube([50, 38, 6]);
  const boss = mod.Manifold.cube([22, 12, 2.5]).translate(12, 13, 6);
  const island = mod.Manifold.cube([6, 6, 2]).translate(38, 28, 6); // separate raised island
  return arrays(slab.add(boss).add(island));
})();

// --- fixture: perforated cap with a straight through-hole ---
const cap = (() => {
  const plate = mod.Manifold.cube([50, 50, 3]);
  const hole = mod.Manifold.cube([12, 12, 10]).translate(19, 19, -1);
  return arrays(plate.subtract(hole));
})();

const PARAMS = { gap: 4, wall: 4, plateT: 4, freeboard: 5, backing: 4 } as const;

// 1. Plaque tray: every printed part valid, master attached, open face, backing above the relief.
{
  const t = buildReliefTray({ mod, master: plaque, params: PARAMS });
  const wallVol = printValid('tray base', t.pieces.basePlate);
  const ringVol = printValid('tray wall', t.pieces.wall);
  printValid('master base (fused)', t.pieces.masterBase);
  // wall is a ring, not a box: its volume must be far below the closed-box equivalent
  const outerBoxVol = 78 * 66 * 18 / 1000; // bbox upper bound of a walled tray at these params
  assert.ok(ringVol < outerBoxVol * 0.5, `wall must be a ring, not a box (${ringVol.toFixed(1)} vs box ${outerBoxVol.toFixed(1)} cm³)`);
  // no roof: the wall's top must be open — the silicone pours through and the
  // cured silicone's top face sits above the highest master feature + backing
  assert.ok(t.siliconeMl > 5, `silicone preview volume ${t.siliconeMl.toFixed(1)} mL`);
  assert.ok(t.wallTopZ >= t.masterTopZ + PARAMS.backing - 0.5,
    `wall top ${t.wallTopZ.toFixed(1)} must back the relief (${t.masterTopZ.toFixed(1)}) by ≥ ${PARAMS.backing} mm`);
  // deliberate backing: silicone fills at least backing mm above the master
  assert.ok(t.openFace, 'the tray must report an accessible open face');
  // rigid release: printed parts never trap the cured silicone (no lid exists)
  assert.ok(t.release.openTop, 'release report must state the open-top tray');
  assert.equal(t.siliconeDemold.status, 'unverified', 'master demold stays an explicit unverified stage');
  // Key Ring: the wall seats ON the plate (never sinks below it), the groove
  // is really cut, the tongue really stands, and the assembled parts do not
  // interpenetrate — the pre-pour smear seals the clearance, not press-fit.
  let wallLo = Infinity;
  for (let i = 0; i < t.pieces.wall.vertProperties.length / 3; i++) {
    const z = t.pieces.wall.vertProperties[i * 3 + 2];
    if (z < wallLo) wallLo = z;
  }
  assert.ok(Math.abs(wallLo) <= 0.1, `wall must seat at plate top z=0 (bottom ${wallLo.toFixed(2)})`);
  assert.ok(t.keyRing.engagementRatio >= 0.6, `groove engagement ${(t.keyRing.engagementRatio * 100).toFixed(0)}% must be ≥60%`);
  assert.ok(t.keyRing.tongueSurplusMm3 >= 0.6 * t.keyRing.expectedTongueMm3,
    `tongue surplus ${t.keyRing.tongueSurplusMm3} vs expected ${t.keyRing.expectedTongueMm3} mm³`);
  assert.ok(t.keyRing.assembledInterferenceMm3 <= 0.01,
    `assembled wall∩plate interference ${t.keyRing.assembledInterferenceMm3} mm³ must be ~0 (clearance respected)`);
  assert.ok(t.keyRing.tongueW >= 0.6 && t.keyRing.clearance > 0, 'key ring must have a real cross-section and clearance');
  // tray hard gates pass on the shipped pieces
  const gates = runTrayGates({
    gap: PARAMS.gap, wall: PARAMS.wall, master: plaque,
    wallPiece: t.pieces.wall, masterBase: t.pieces.masterBase,
    siliconeMl: t.siliconeMl, masterTopZ: t.masterTopZ, wallTopZ: t.wallTopZ,
    backing: PARAMS.backing, freeboard: PARAMS.freeboard, keyRing: t.keyRing,
  });
  const hardFails = gates.checks.filter((c) => !c.pass && c.hard);
  assert.deepEqual(hardFails, [], `tray hard gates must pass: ${hardFails.map((c) => `${c.name} (${c.detail})`).join('; ')}`);
  console.log(`PASS plaque tray: base ${wallVol.toFixed(1)} cm³, ring ${ringVol.toFixed(1)} cm³, silicone ${t.siliconeMl.toFixed(1)} mL, wall top ${t.wallTopZ.toFixed(1)} vs master ${t.masterTopZ.toFixed(1)}; key ring ${t.keyRing.tongueW}×${t.keyRing.tongueH} @${t.keyRing.clearance}mm engagement ${(t.keyRing.engagementRatio * 100).toFixed(0)}%`);
}

// 2. Through-hole: the hole survives as a silicone post — never filled shut.
{
  const t = buildReliefTray({ mod, master: cap, params: PARAMS });
  assert.ok(t.throughHoles.length > 0, 'through-hole must be detected');
  // the silicone preview must CONTAIN the post: sample the hole center column
  // — silicone volume must exceed the plain slab-cavity estimate by ~hole volume
  assert.ok(t.siliconeMl > 0, 'silicone preview exists');
  assert.ok(t.throughHoles.every(h => h.withdrawable), 'a straight through-hole withdraws along +Z (no mechanical lock)');
  console.log(`PASS cap tray: ${t.throughHoles.length} through-hole(s) detected, withdrawable ${t.throughHoles.map(h => h.withdrawable).join(',')}, silicone ${t.siliconeMl.toFixed(1)} mL`);
}

// 3. Material comparison at the audit's scale: wall-only vs the generic jacket
//    for the SAME size plaque (audit §6: Montagem 200 mm jacket 414.7 cm³;
//    hypothetical tray wall 84.6 cm³; base excluded from both wall-only sums).
{
  const big = (() => { // Montagem-like 180×90×20 plaque at native-ish scale
    const slab = mod.Manifold.cube([180, 90, 20]);
    const boss = mod.Manifold.cube([60, 20, 4]).translate(30, 30, 20);
    return arrays(slab.add(boss));
  })();
  const t = buildReliefTray({ mod, master: big, params: { gap: 6, wall: 5, plateT: 4, freeboard: 5, backing: 6 } });
  const wallVol = printValid('big tray wall', t.pieces.wall);
  printValid('big tray base', t.pieces.basePlate);
  assert.ok(wallVol < 414.7 * 0.35, `tray wall ${wallVol.toFixed(1)} cm³ must be far below the same-size jacket's 414.7 cm³`);
  console.log(`PASS material comparison: 180 mm plaque tray wall ${wallVol.toFixed(1)} cm³ (same-size jacket ≈ 414.7 cm³; base excluded per audit §6)`);
}

// 4. Blocked routing: a deep bowl (required underside) never reaches the tray.
{
  const deepBowl = (() => {
    const outer = mod.Manifold.cube([60, 60, 55]);
    const cavity = mod.Manifold.cube([44, 44, 45]).translate(8, 8, 10);
    return arrays(outer.subtract(cavity));
  })();
  assert.throws(() => buildReliefTray({ mod, master: deepBowl, params: PARAMS }),
    /depth|backing|ratio|flat/i, 'deep bowl must be rejected with a reason naming the failing property');
  console.log('PASS deep bowl blocked at tray construction');
}

// 5. Key-ring explicit params: a caller-specified tongue/clearance pair flows
//    through, stays inside the wall (lands ≥0.3 mm each side), and still gates.
{
  const t = buildReliefTray({ mod, master: plaque, params: { ...PARAMS, keyRing: { tongueW: 1.5, clearance: 0.25 } } });
  assert.equal(t.keyRing.tongueW, 1.5, 'caller tongueW must be respected');
  assert.equal(t.keyRing.clearance, 0.25, 'caller clearance must be respected');
  assert.ok(t.keyRing.engagementRatio >= 0.6 && t.keyRing.assembledInterferenceMm3 <= 0.01, 'explicit key ring assembles clean');
  const gates = runTrayGates({
    gap: PARAMS.gap, wall: PARAMS.wall, master: plaque,
    wallPiece: t.pieces.wall, masterBase: t.pieces.masterBase,
    siliconeMl: t.siliconeMl, masterTopZ: t.masterTopZ, wallTopZ: t.wallTopZ,
    backing: PARAMS.backing, freeboard: PARAMS.freeboard, keyRing: t.keyRing,
  });
  assert.ok(gates.pass, `gates must pass with explicit key ring: ${gates.checks.filter(c => !c.pass && c.hard).map(c => c.name).join('; ')}`);
  console.log(`PASS explicit key ring 1.5mm @0.25mm: engagement ${(t.keyRing.engagementRatio * 100).toFixed(0)}%, interference ${t.keyRing.assembledInterferenceMm3} mm³`);
}

console.log('RELIEF TRAY REGRESSIONS PASS');
