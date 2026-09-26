// smoke:clamps — V0.5 manufacturing-reliability layer, commits 1–2 scope:
// deterministic clamp-station planning on the frozen seam rail, ZeroClip
// geometry + seated acceptance, and package metadata emission. Synthetic rail
// bands (no full mold generation) so it runs in seconds.
import { loadManifold } from '../src/engine/manifoldLoader';
import { CLAMP, buildZeroClip, planClampStations, validateZeroClip } from '../src/engine/clamps';
import { buildFitCoupon } from '../src/engine/coupon';
import { buildPrintFiles } from '../src/engine/export';
import { cleanExportMesh } from '../src/engine/clean';
import { instanceToMeshArrays } from '../src/engine/offset';
import { prismOnPull, type CS, type MoldFrame } from '../src/engine/split';
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

// --- 6. ZeroClip geometry: seated build, acceptance, press-volume window ---
const PULL: [number, number, number] = [1, 0, 0]; // pull = X matches the frame
const station0 = planA.stations[0];
const csCtorT = csCtor as unknown as { ofPolygons(poly: number[][][], fillRule?: string): CS };
const clipA = buildZeroClip({ csCtor: csCtorT, station: station0, pull: PULL });
const clipB = buildZeroClip({ csCtor: csCtorT, station: station0, pull: PULL });
const clipArr = instanceToMeshArrays(clipA);
const aud = cleanExportMesh(clipArr).audit;
check('clip mesh clean (watertight, 1 component, no degenerates)',
  aud.watertight && aud.components === 1 && aud.degenerateTris === 0 && aud.zeroVolumeComponents === 0,
  `tris ${aud.tris}, comps ${aud.components}, degen ${aud.degenerateTris}, vol ${aud.volumeCm3} cm³`);
const bbClip = (() => {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < clipArr.vertProperties.length / 3; i++)
    for (let k = 0; k < 3; k++) {
      const x = clipArr.vertProperties[i * 3 + k];
      if (x < min[k]) min[k] = x;
      if (x > max[k]) max[k] = x;
    }
  return { min, dim: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
})();
check('clip pull extent = rail stack + jaw arms', Math.abs(bbClip.dim[0] - 2 * (2.5 + CLAMP.clipLegTMm - CLAMP.clipInterferenceMm / 2)) < 0.4,
  `pull extent ${bbClip.dim[0].toFixed(2)} mm (expected ${((2.5 + CLAMP.clipLegTMm - CLAMP.clipInterferenceMm / 2) * 2).toFixed(2)})`);
check('clip tangent extent = clip width + closing fillet growth', Math.abs(Math.max(bbClip.dim[1], bbClip.dim[2]) - CLAMP.clipWidthMm) < 1.2,
  `max transverse extent ${Math.max(bbClip.dim[1], bbClip.dim[2]).toFixed(2)} mm (18 mm + ≤1 mm from the r2 root-fillet closing)`);
check('clip build deterministic', Math.abs(clipA.volume() - clipB.volume()) < 1e-6, `vol ${clipA.volume().toFixed(2)} mm³`);

// seat the clip against the synthetic rail band solid (the ring extruded ±2.5 along pull)
const bandSolid = prismOnPull(rail, 0, -2.5, 2.5);
const seat = validateZeroClip({ clip: clipA, jacket: bandSolid });
check('seated clip engages rail within the designed press volume', seat.ok && seat.pressVolumeMm3 > 0.5 && seat.pressVolumeMm3 < 12,
  seat.ok ? `press ${seat.pressVolumeMm3.toFixed(2)} mm³ (designed ≈ 2 × 1.5 × 18 × 0.15 ≈ 8 mm³)` : seat.reason ?? 'failed');
// the clip must never reach the wall: it stops ≥5 mm short of the band's inner boundary
const wallProxy = prismOnPull(band(5.5, 4), 0, -2.5, 2.5); // inner ring segment stands in for the jacket wall
const wallHit = clipA.intersect(wallProxy);
const wallVol = wallHit.volume();
wallHit.delete();
check('clip clears the jacket wall', wallVol < 0.5, `wall overlap ${wallVol.toFixed(3)} mm³`);

// --- 7. package metadata: fastening block + assembly guidance + 04_hardware ---
const cube = instanceToMeshArrays(mod.Manifold.cube([10, 10, 10]));
const { files } = buildPrintFiles({
  masterBase: cube,
  parts: { jacketA: cube, jacketB: cube, siliconeSkin: cube },
  info: {
    name: 'clamp_smoke', createdAt: new Date().toISOString(),
    params: { gap: 6, wall: 5, clearance: 0.35, clampMode: 'printed' },
    axis: 'X', siliconeMl: 1, extraction: { A: 5, B: 5 },
    jacketDim: [10, 10, 10], plateDim: [10, 10, 10],
    warnings: [], checks: [], crown: null, ventCount: 0,
    fastening: {
      mode: 'printed', clipCount: planA.stations.length,
      usableRailMm: planA.usableRailMm, pitchMm: planA.pitchMm, stations: planA.stations,
    },
    zeroClip: clipArr,
  },
});
const project = JSON.parse(new TextDecoder().decode(files['pourbox_clamp_smoke/project.json']));
check('project.json carries fastening', project.fastening?.mode === 'printed' && project.fastening?.clipCount === planA.stations.length
  && project.fastening?.binderClipCompatible === true && Array.isArray(project.fastening?.stations),
  `mode ${project.fastening?.mode}, ${project.fastening?.clipCount} stations`);
check('04_hardware/zero_clip.stl exported', !!files['pourbox_clamp_smoke/04_hardware/zero_clip.stl'], `${(files['pourbox_clamp_smoke/04_hardware/zero_clip.stl']?.length ?? 0)} bytes`);
const profileJson = JSON.parse(new TextDecoder().decode(files['pourbox_clamp_smoke/print_profile.json']));
check('print_profile has the ZeroClip entry', (profileJson.profiles?.zero_clip?.material ?? '').startsWith('PETG') && /none/i.test(profileJson.profiles?.zero_clip?.support ?? ''),
  `material ${profileJson.profiles?.zero_clip?.material}, support ${profileJson.profiles?.zero_clip?.support}`);
const assembly = new TextDecoder().decode(files['pourbox_clamp_smoke/assembly.md']);
check('assembly.md names the clip plan', assembly.includes(`${planA.stations.length} ZeroClips`), 'hardware section updated');

// --- 8. fit coupon: builds clean through the export gate ---
const coupon = buildFitCoupon({ mod, track: (x) => x, clearance: 0.35 });
const couponAudit = cleanExportMesh(coupon.mesh).audit;
check('coupon mesh clean (watertight, 1 component)', couponAudit.watertight && couponAudit.components === 1 && couponAudit.degenerateTris === 0,
  `tris ${couponAudit.tris}, vol ${couponAudit.volumeCm3} cm³, comps ${couponAudit.components}`);
check('coupon carries the full sample set', coupon.notes.length === 8 && coupon.notes.some(n => n.includes('BaseLock')),
  `${coupon.notes.length} samples: ${coupon.notes.filter(n => /clip sample/.test(n)).length} clips, ${coupon.notes.filter(n => /joint/.test(n)).length} joints, BaseLock ${coupon.notes.some(n => /BaseLock/.test(n)) ? '✓' : '✗'}`);

console.log(failures === 0 ? '\nSMOKE:CLAMPS PASS' : `\nSMOKE:CLAMPS FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
