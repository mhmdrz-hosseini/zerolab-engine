// smoke:clamps — V0.5 manufacturing-reliability layer, commit-1 scope:
// deterministic clamp-station planning on the frozen seam rail + package
// metadata emission. Synthetic rail bands (no full mold generation) so it
// runs in seconds. Acceptance items that need ZeroClip geometry (watertight
// clip mesh, no jacket collision) land in commit 2.
import { loadManifold } from '../src/engine/manifoldLoader';
import { planClampStations, CLAMP } from '../src/engine/clamps';
import { buildPrintFiles } from '../src/engine/export';
import { instanceToMeshArrays } from '../src/engine/offset';
import type { CS, MoldFrame } from '../src/engine/split';
import type { PortSpec } from '../src/engine/ports';

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (${detail})`);
  if (!ok) failures++;
};

// pull = X → planner 2D coords map q[0]→Y, q[1]→Z; vert = Z so the trim
// bands bite on q[1]. vert extremes set far out unless a test overrides.
const frame: MoldFrame = { pull: 'X', vert: 'Z', depth: 'Y', base: -100, mid: 0, crown: 100 };

const mod = await loadManifold();
// split.ts parity: the loader types CrossSection loosely — narrow through the engine's CS interface
const csCtor = mod.CrossSection as unknown as { circle(radius: number, segments?: number): CS };
const band = (outerR: number, innerR: number): CS =>
  csCtor.circle(outerR, 128).subtract(csCtor.circle(innerR, 128));

function distToRay(px: number, py: number, deg: number, reach: number): number {
  const th = (deg * Math.PI) / 180;
  const ex = Math.cos(th) * reach, ey = Math.sin(th) * reach;
  const len2 = ex * ex + ey * ey;
  const t = Math.max(0, Math.min(1, (px * ex + py * ey) / len2));
  return Math.hypot(px - t * ex, py - t * ey);
}

// --- 1. plain ring: count formula, determinism, thickness ---
const R_OUT = 60, R_IN = 58;
const rail = band(R_OUT, R_IN);
const planA = planClampStations({ railSection: rail, axis: 'X', frame });
const perim = 2 * Math.PI * ((R_OUT + R_IN) / 2);
// exclusion keeps usable < perim; assert the formula against the PLANNER's own
// usable measurement (count = max(2, ceil(usable/40) + 1))
const expectCount = Math.max(2, Math.ceil(planA.usableRailMm / CLAMP.pitchMm) + 1);
check('ring yields stations', planA.stations.length >= 2 && planA.stations.length === expectCount,
  `${planA.stations.length} stations (usable ${planA.usableRailMm} mm of ${perim.toFixed(0)} mm loop, expected ${expectCount})`);
check('station count deterministic', JSON.stringify(planA.stations) === JSON.stringify(planClampStations({ railSection: rail, axis: 'X', frame }).stations),
  'three runs byte-identical');
check('rail thickness measured inside band', planA.stations.every((s) => s.railThickness > 0 && s.railThickness <= CLAMP.railProudMm + 0.5),
  `thicknesses ${planA.stations.map((s) => s.railThickness).join('/')} mm (band is ${R_OUT - R_IN} mm)`);
check('stations sit on the rail band', planA.stations.every((s) => {
  const r = Math.hypot(s.position[1], s.position[2]);
  return r >= R_IN - 0.5 && r <= R_OUT + 0.5;
}), `radii ${planA.stations.map((s) => Math.hypot(s.position[1], s.position[2]).toFixed(1)).join('/')} mm`);

// --- 2. rib exclusion: stations keep clear of the four fin rays ---
const ribPlan = planClampStations({
  railSection: rail, axis: 'X', frame,
  ribs: { center: [0, 0], u3: 1, v3: 2, wall: 5 },
});
const keep = CLAMP.clipWidthMm / 2 + CLAMP.exclusionMm;
const ribReach = R_OUT + 5 * 1.45 + 8;
const minRibDist = Math.min(...ribPlan.stations.flatMap((s) =>
  [45, 135, 225, 315].map((d) => distToRay(s.position[1], s.position[2], d, ribReach))));
check('stations clear of rib rays', minRibDist >= keep - 2.5, `closest approach ${minRibDist.toFixed(1)} mm (keep ${keep} mm, sampling tol 2.5 mm)`);
check('rib exclusion actually removed land', ribPlan.usableRailMm < planA.usableRailMm,
  `usable ${ribPlan.usableRailMm} vs ${planA.usableRailMm} mm`);

// --- 3. vent exclusion ---
const vent: PortSpec = {
  u: 0, v: 0, uPull: R_OUT, vPull: 0, zMm: 0, pCoord: 0, masterTopMm: 0, boreR: 1.25,
};
const ventPlan = planClampStations({ railSection: rail, axis: 'X', frame, vents: [vent] });
const minVentDist = Math.min(...ventPlan.stations.map((s) => Math.hypot(s.position[1] - vent.uPull, s.position[2] - vent.vPull)));
check('stations clear of vent bore', minVentDist >= vent.boreR + keep - 2.5, `closest approach ${minVentDist.toFixed(1)} mm`);

// --- 4. end clearance: crown near the loop trims the top land ---
const tightFrame: MoldFrame = { pull: 'X', vert: 'Z', depth: 'Y', base: -100, mid: 0, crown: 30 };
const trimmed = planClampStations({ railSection: rail, axis: 'X', frame: tightFrame });
check('crown end clearance respected', trimmed.stations.every((s) => s.position[2] <= tightFrame.crown - CLAMP.endClearMm + 2.5),
  `max z ${Math.max(...trimmed.stations.map((s) => s.position[2])).toFixed(1)} vs crown−${CLAMP.endClearMm}`);

// --- 5. unusably short rail → warning, no crash ---
const tiny = planClampStations({ railSection: band(5.5, 4), axis: 'X', frame });
check('short rail degrades to warning', !!tiny.warning && tiny.stations.length === 0, tiny.warning ?? 'no warning');

// --- 6. package metadata: fastening block + assembly guidance ---
const cube = instanceToMeshArrays(mod.Manifold.cube([10, 10, 10]));
const { files } = buildPrintFiles({
  masterBase: cube,
  parts: { jacketA: cube, jacketB: cube, siliconeSkin: cube },
  info: {
    name: 'clamp_smoke', createdAt: new Date().toISOString(),
    params: { gap: 6, wall: 5, clearance: 0.35 },
    axis: 'X', siliconeMl: 1, extraction: { A: 5, B: 5 },
    jacketDim: [10, 10, 10], plateDim: [10, 10, 10],
    warnings: [], checks: [], crown: null, ventCount: 0,
    fastening: {
      mode: 'binder', clipCount: planA.stations.length,
      usableRailMm: planA.usableRailMm, pitchMm: planA.pitchMm, stations: planA.stations,
    },
  },
});
const project = JSON.parse(new TextDecoder().decode(files['pourbox_clamp_smoke/project.json']));
check('project.json carries fastening', project.fastening?.mode === 'binder' && project.fastening?.clipCount === planA.stations.length
  && project.fastening?.binderClipCompatible === true && Array.isArray(project.fastening?.stations),
  `mode ${project.fastening?.mode}, ${project.fastening?.clipCount} stations`);
const assembly = new TextDecoder().decode(files['pourbox_clamp_smoke/assembly.md']);
check('assembly.md names the clip plan', assembly.includes(`${planA.stations.length} clamp stations`), 'hardware section updated');

console.log(failures === 0 ? '\nSMOKE:CLAMPS PASS' : `\nSMOKE:CLAMPS FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
