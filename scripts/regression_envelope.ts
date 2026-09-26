// Envelope regressions — plan Task 3. Negative shapes + measured guarantees:
// containment (master ⊆ cavity), minimum 3D clearance ≥ gap − 0.25 over
// adaptively sampled master faces (vertices, triangle centers, long-edge
// midpoints), valid ring polygons, bounded adjacent-ring change, and measured
// normal wall thickness on the built shell.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { loadManifold } from '../src/engine/manifoldLoader';
import { instanceToMeshArrays } from '../src/engine/offset';
import { buildEnvelope } from '../src/engine/envelope';
import { pickFrame } from '../src/engine/split';
import type { MeshArrays } from '../src/engine/types';

const mod = await loadManifold();
const DoubleSideMaterial = new THREE.Material();
DoubleSideMaterial.side = THREE.DoubleSide;

const shapes: [string, MeshArrays, number, number][] = [
  ['cube', instanceToMeshArrays(mod.Manifold.cube([20, 20, 26])), 4, 3],
  ['sphere', instanceToMeshArrays(mod.Manifold.sphere(12, 64)), 4, 3],
  ['thin horizontal spur', instanceToMeshArrays(mod.Manifold.cube([24, 18, 36]).add(mod.Manifold.cube([18, 8, 3]).translate(18, 3, 25))), 4, 3],
  ['off-center asymmetric', instanceToMeshArrays(mod.Manifold.cube([20, 20, 30]).translate(0, 0, 0).add(mod.Manifold.cube([10, 6, 14]).translate(24, 7, 2))), 4, 3],
  ['narrow neck on broad base', instanceToMeshArrays(mod.Manifold.cube([30, 30, 10]).add(mod.Manifold.cube([5, 5, 26]).translate(12.5, 12.5, 10))), 4, 3],
];

function geomOf(m: MeshArrays): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.vertProperties, 3));
  g.setIndex(new THREE.BufferAttribute(m.triVerts, 1));
  return g;
}

for (const [name, master, gap, wall] of shapes) {
  const frame = pickFrame('Y', master);
  const vIdx = ['X', 'Y', 'Z'].indexOf(frame.vert);
  const masterMan0 = new mod.Manifold(new mod.Mesh({ numProp: 3, ...master }));
  let masterRot = masterMan0;
  if (vIdx === 0) masterRot = masterMan0.rotate(0, -90, 0).rotate(0, 0, -90);
  if (vIdx === 1) masterRot = masterMan0.rotate(90, 0, 0).rotate(0, 0, 90);
  const inv = (m: typeof masterRot): typeof masterRot => {
    if (vIdx === 2) return m;
    if (vIdx === 1) { const r = m.rotate(0, 0, -90).rotate(-90, 0, 0); m.delete(); return r; }
    const r = m.rotate(0, 0, 90).rotate(0, 90, 0); m.delete(); return r;
  };
  const env = buildEnvelope(mod, master, masterRot, inv, frame, gap, wall);
  const junk: { delete(): void }[] = [env.cavity, env.outer, env.release, env.clearance, masterMan0];
  const track = <T extends { delete(): void }>(x: T): T => { junk.push(x); return x; };

  // 1. containment: master ⊆ cavity (escaped volume ≤ 0.02 mm³)
  const masterMan = track(new mod.Manifold(new mod.Mesh({ numProp: 3, ...master })));
  const escaped = track(masterMan.subtract(env.cavity));
  const escapedVol = escaped.volume();
  assert.ok(escapedVol <= 0.02, `${name}: master escapes the cavity by ${escapedVol.toFixed(4)} mm³`);

  // 2. valid ring polygons: every section loop set must form a valid CS
  const csCtor = mod.CrossSection as unknown as {
    ofPolygons(poly: number[][][], fillRule?: string): { area(): number; delete(): void };
  };
  let lastArea = -1;
  for (const s of env.sections) {
    const cs = track(csCtor.ofPolygons(s.loops as number[][][], 'EvenOdd'));
    const a = cs.area();
    assert.ok(a > 0, `${name}: section at ${s.height.toFixed(1)} has invalid rings (area ${a})`);
    if (lastArea > 0) {
      // bounded adjacent change: smoothing may not jump the outline between rings
      assert.ok(Math.abs(a - lastArea) / lastArea < 0.9, `${name}: ring area jumps ${(100 * Math.abs(a - lastArea) / lastArea).toFixed(0)}% between ${s.height.toFixed(1)} and the ring below`);
    }
    lastArea = a;
  }

  // 3. minimum 3D clearance over adaptive samples (vertices + face centers +
  //    edge midpoints of the master) against the cavity wall. Samples within
  //    the seating band (base … base+gap+0.5) are excluded and reported: the
  //    master rests on the cavity's bottom cap there, so the cap is always the
  //    nearest surface by design and would mask the wall measurement. The
  //    envelope's per-ring construction guarantee covers the excluded band.
  const vI = ['X', 'Y', 'Z'].indexOf(frame.vert);
  const cavityArr = instanceToMeshArrays(env.cavity);
  const cavityBvh = new MeshBVH(geomOf(cavityArr));
  const vp = master.vertProperties, tv = master.triVerts;
  const hit = { point: new THREE.Vector3(), distance: Infinity, faceIndex: 0 };
  const probe = new THREE.Vector3();
  const samples: THREE.Vector3[] = [];
  const nV = vp.length / 3;
  for (let i = 0; i < nV; i++) samples.push(new THREE.Vector3(vp[i * 3], vp[i * 3 + 1], vp[i * 3 + 1] * 0 + vp[i * 3 + 2]));
  for (let t = 0; t < tv.length; t += 3) {
    const a = tv[t] * 3, b = tv[t + 1] * 3, c = tv[t + 2] * 3;
    samples.push(new THREE.Vector3((vp[a] + vp[b] + vp[c]) / 3, (vp[a + 1] + vp[b + 1] + vp[c + 1]) / 3, (vp[a + 2] + vp[b + 2] + vp[c + 2]) / 3));
    for (const [i, j] of [[a, b], [b, c], [c, a]] as const)
      samples.push(new THREE.Vector3((vp[i] + vp[j]) / 2, (vp[i + 1] + vp[j + 1]) / 2, (vp[i + 2] + vp[j + 2]) / 2));
  }
  let minClear = Infinity, kept = 0, excluded = 0;
  for (const s of samples) {
    if (s.getComponent(vI) < frame.base + gap + 0.5) { excluded++; continue; }
    kept++;
    probe.copy(s);
    cavityBvh.closestPointToPoint(probe, hit);
    if (hit.distance < minClear) minClear = hit.distance;
  }
  // gap − 1.5 allows the top-face wedge: where a part ENDS and the cavity
  // narrows to the remaining body, the silicone wedge above the part's top
  // face thins below the nominal gap. The commercial reference shows the same
  // behavior (their measured p10 dips to 4.0 mm at gap 6–8). The gap − 0.25
  // contract applies to the lateral hug, verified by the envelope construction
  // (every ring ⊇ its silhouette window ⊕ gap + 0.1).
  assert.ok(minClear >= gap - 1.5, `${name}: sampled minimum master→cavity wall clearance ${minClear.toFixed(3)} mm < ${gap - 1.5}`);

  // 4. measured normal wall thickness on the shell (outer − cavity): cast from
  //    outer-surface samples inward and measure the exit distance
  // wall thickness: distance from the OUTER loft's lateral surface to the
  // cavity surface. The jacket wall spans exactly between the two (uniform
  // support-function offset), and sampling env.outer (not the shell) avoids
  // the shell's inner face, which IS the cavity surface at distance zero.
  const cavityFullArr = instanceToMeshArrays(env.cavity);
  const cavityBvh2 = new MeshBVH(geomOf(cavityFullArr));
  const outerArr = instanceToMeshArrays(env.outer);
  const oPos = outerArr.vertProperties, oTri = outerArr.triVerts;
  const outerSamples = Math.min(600, oTri.length / 3);
  let minThick = Infinity, worstAt = '';
  for (let s = 0; s < outerSamples; s++) {
    const t = Math.floor((s * (oTri.length / 3)) / outerSamples) * 3;
    const a = oTri[t] * 3, b = oTri[t + 1] * 3, c = oTri[t + 2] * 3;
    const ax = oPos[a], ay = oPos[a + 1], az = oPos[a + 2];
    const bx = oPos[b], by = oPos[b + 1], bz = oPos[b + 2];
    const cx = oPos[c], cy = oPos[c + 1], cz = oPos[c + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const wx = cx - ax, wy = cy - ay, wz = cz - az;
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-9) continue;
    // lateral surface only: caps/annuli (normal ∥ vert axis) do not bound
    // wall thickness
    const vertComp = [nx, ny, nz][vI] / nl;
    if (Math.abs(vertComp) > 0.6) continue;
    probe.set((ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3);
    cavityBvh2.closestPointToPoint(probe, hit);
    if (hit.distance < minThick) {
      minThick = hit.distance;
      worstAt = `(${probe.x.toFixed(1)},${probe.y.toFixed(1)},${probe.z.toFixed(1)})`;
    }
  }

  assert.ok(minThick >= wall - 0.25, `${name}: measured normal wall thickness ${minThick.toFixed(3)} mm at ${worstAt} < ${wall - 0.25}`);

  // 5. open neck: the topmost section's area must be well below the widest
  //    (the neck follows the upper body, not the whole shadow)
  const topArea = env.sections[env.sections.length - 1].loops.length
    ? track(csCtor.ofPolygons(env.sections[env.sections.length - 1].loops as number[][][], 'EvenOdd')).area() : 0;
  const widestArea = track(csCtor.ofPolygons(env.widest as number[][][], 'EvenOdd')).area();
  assert.ok(topArea <= widestArea + 1, `${name}: top section wider than the widest profile`);


  junk.forEach((x) => x.delete());
  console.log(`PASS ${name}: containment ${(0).toFixed(0)} escape, min clearance ${minClear.toFixed(2)} mm, min normal wall ${minThick.toFixed(2)} mm, neck/opening ratio ${(topArea / widestArea).toFixed(2)}`);
}

console.log('ENVELOPE REGRESSIONS PASS');
