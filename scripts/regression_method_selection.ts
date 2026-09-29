// Method-selection regression (plan Task 5, M1): the selector must inspect
// required surfaces, cavities, back side and release constraints — never
// filename, bbox flatness alone, or the original STL Z. Rotated copies make
// the same family decision.
import assert from 'node:assert/strict';
import { loadManifold } from '../src/engine/manifoldLoader';
import { classifyMethods } from '../src/engine/moldMethod';
import type { CastingIntent, MeshArrays } from '../src/engine/types';

const mod = await loadManifold();
const arrays = (m: any): MeshArrays => {
  const dm = m.getMesh();
  const out: MeshArrays = { vertProperties: Float32Array.from(dm.vertProperties), triVerts: Uint32Array.from(dm.triVerts.subarray(0, dm.numTri * 3)) };
  m.delete();
  return out;
};
const top = (cands: ReturnType<typeof classifyMethods>) => cands[0];

// --- fixtures ---
// 1. Embossed plaque: 80×60×8 slab + raised boss on the +Z face, flat back.
const plaque = (() => {
  const slab = mod.Manifold.cube([80, 60, 8]);
  const boss = mod.Manifold.cube([40, 20, 3]).translate(20, 20, 8);
  return arrays(slab.add(boss));
})();
// 2. Thin perforated cap: 50×50×3 plate with a 12 mm through-hole.
const cap = (() => {
  const plate = mod.Manifold.cube([50, 50, 3]);
  const hole = mod.Manifold.cube([12, 12, 10]).translate(19, 19, -1);
  return arrays(plate.subtract(hole));
})();
// 3. Tall slender figure (giraffe-like): narrow body 20×20×70 on thin legs.
const giraffe = (() => {
  const body = mod.Manifold.cube([18, 18, 55]).translate(0, 0, 15);
  const neck = mod.Manifold.cube([8, 8, 30]).translate(5, 5, 70);
  const legs = [0, 1, 2, 3].map((i) =>
    mod.Manifold.cube([5, 5, 15]).translate((i % 2) * 12, Math.floor(i / 2) * 12, 0));
  let m = body.add(neck);
  for (const l of legs) m = m.add(l);
  return arrays(m);
})();
// 4. Low but fully 3D animal (poodle-like lying): 70×30×25, NO dominant plane.
const poodle = (() => {
  const body = mod.Manifold.cube([50, 24, 20]).translate(0, 3, 3);
  const head = mod.Manifold.cube([18, 18, 16]).translate(48, 6, 0);
  const snout = mod.Manifold.cube([10, 8, 6]).translate(64, 11, 3);
  return arrays(body.add(head).add(snout));
})();
// 5. Open cup (vessel): outer wall with a deep internal recess, open top.
const cup = (() => {
  const outer = mod.Manifold.cube([70, 70, 64]);
  const cavity = mod.Manifold.cube([56, 56, 52]).translate(7, 7, 12);
  return arrays(outer.subtract(cavity));
})();
// 6. Prebuilt negative (Fatima-like): an open tray whose cavity is the CAST —
//    feeding it back as a positive must not auto-wrap a mold of the tooling.
const prebuiltNegative = (() => {
  const slab = mod.Manifold.cube([60, 40, 10]);
  const cavity = mod.Manifold.cube([44, 24, 6]).translate(8, 8, 4);
  return arrays(slab.subtract(cavity));
})();

const master: CastingIntent = { inputRole: 'positive_master', requiredSurfaces: 'front_only' };
const allSides: CastingIntent = { inputRole: 'positive_master', requiredSurfaces: 'all_sides' };
const innerOuter: CastingIntent = { inputRole: 'positive_master', requiredSurfaces: 'inner_and_outer' };

// 1. Flat relief + front_only → open_face_relief first, full_3d second.
for (const [name, geo] of [['plaque', plaque], ['perforated cap', cap]] as const) {
  const c = classifyMethods(geo, master);
  assert.equal(top(c).method, 'open_face_relief', `${name}: expected open_face_relief first, got ${top(c).method}`);
  assert.ok(c.some((x) => x.method === 'full_3d_jacket'), `${name}: full_3d_jacket must remain a fallback candidate`);
  assert.ok(top(c).reason.length > 20, `${name}: the ranking must say why`);
  console.log(`PASS ${name} (front_only) → ${top(c).method}`);
}

// 2. Rotation invariance: standing on its edge, the SAME plaque still routes open-face.
{
  const m = new mod.Manifold(new mod.Mesh({ numProp: 3, ...plaque }));
  const rotated = arrays(m.rotate(90, 0, 0)); // standing on edge — the original audit's failure mode
  const c = classifyMethods(rotated, master);
  assert.equal(top(c).method, 'open_face_relief', `rotated plaque: got ${top(c).method} — the selector must measure planar faces, not trust the STL Z`);
  console.log('PASS rotated plaque (90° about X) → open_face_relief');
}

// 3. Sculptures with all_sides → full_3d_jacket first, NEVER open-face.
for (const [name, geo] of [['giraffe', giraffe], ['poodle (low but 3D)', poodle]] as const) {
  const c = classifyMethods(geo, allSides);
  assert.equal(top(c).method, 'full_3d_jacket', `${name}: expected full_3d_jacket first, got ${top(c).method}`);
  console.log(`PASS ${name} (all_sides) → ${top(c).method}`);
}
// the poodle must not become a relief merely because its total height is small
{
  const c = classifyMethods(poodle, master); // even with front_only intent
  assert.notEqual(top(c).method, 'open_face_relief', 'a fully-3D animal must not rank open-face (review focus #5)');
  console.log('PASS poodle with front_only intent still refuses open-face (no backing plane)');
}

// 4. inner_and_outer → vessel/core or needs_review; open-face excluded.
{
  const c = classifyMethods(cup, innerOuter);
  assert.notEqual(top(c).method, 'open_face_relief', 'a required underside excludes the open-face route');
  assert.ok(['vessel_core', 'needs_review'].includes(top(c).method), `cup: expected vessel_core/needs_review, got ${top(c).method}`);
  console.log(`PASS cup (inner_and_outer) → ${top(c).method}`);
}

// 5. Prebuilt negative / tooling role → needs_review, never silently wrapped.
{
  const c = classifyMethods(prebuiltNegative, { inputRole: 'prebuilt_negative_mold', requiredSurfaces: 'front_only' });
  assert.equal(top(c).method, 'needs_review', `prebuilt negative: got ${top(c).method} — the engine must not auto-wrap tooling as a positive master`);
  console.log('PASS prebuilt negative → needs_review (no auto re-wrapping)');
}

// 6. Ambiguous geometry without intent hints surfaces a question, not a tool.
{
  const c = classifyMethods(cup, { inputRole: 'unknown', requiredSurfaces: 'unspecified' } as CastingIntent);
  assert.equal(top(c).method, 'needs_review', 'unknown role + unspecified surfaces must ask, not guess');
  console.log('PASS unknown intent → needs_review');
}

console.log('METHOD SELECTION REGRESSIONS PASS');
