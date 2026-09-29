// Final-file audit regression (plan Task 3): verdicts are issued on ACTUAL
// serialized bytes. Fixtures: zero-thickness sheet, open boundary, pinched
// two-solid contact, hollow solid with inward shell, detached positives —
// plus the frozen angel-large master reconciliation.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadManifold, isStatusOk } from '../src/engine/manifoldLoader';
import { parseStlBinary } from '../src/engine/stl';
import { auditSerializedStl } from '../src/engine/finalAudit';
import type { MeshArrays } from '../src/engine/types';

const mod = await loadManifold();
const arrays = (m: any): MeshArrays => {
  const dm = m.getMesh();
  const out = { vertProperties: Float32Array.from(dm.vertProperties), triVerts: Uint32Array.from(dm.triVerts.subarray(0, dm.numTri * 3)) };
  m.delete();
  return out;
};

// 1. Zero-thickness sheet: two coincident opposite-wound triangle sheets.
//    Topologically closed, but every face is degenerate and the volume is zero.
{
  const vp = new Float32Array([0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0]);
  const tv = new Uint32Array([0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2]);
  const fa = auditSerializedStl('fixture/zero_sheet.stl', { vertProperties: vp, triVerts: tv }, mod);
  assert.equal(fa.verdict, 'invalid', `zero-thickness sheet must be invalid (got ${fa.verdict})`);
  assert.ok(
    fa.reasons.some(r => /zero-volume|degenerate/.test(r)),
    `must name the zero-volume sheet: ${fa.reasons}`);
  console.log('PASS zero-thickness sheet → invalid');
}

// 2. Open boundary: a cube missing its top face (10 triangles).
{
  const v: number[] = [];
  for (const z of [0, 10]) for (const y of [0, 10]) for (const x of [0, 10]) v.push(x, y, z);
  const tv: number[] = [
    0, 2, 3, 0, 3, 1, // bottom (z=0)
    0, 1, 5, 0, 5, 4, // side x=0
    0, 4, 6, 0, 6, 2, // side y=0
    1, 3, 7, 1, 7, 5, // side y=10
    2, 6, 7, 2, 7, 3, // side x=10
    // top face deliberately absent
  ];
  const fa = auditSerializedStl('fixture/open_box.stl', { vertProperties: Float32Array.from(v), triVerts: Uint32Array.from(tv) }, mod);
  assert.equal(fa.verdict, 'invalid', `open box must be invalid (got ${fa.verdict})`);
  assert.ok(fa.reasons.some(r => /boundary/.test(r)), `must name boundary edges: ${fa.reasons}`);
  console.log('PASS open boundary → invalid');
}

// 3. Hollow solid with a legitimate inward shell: 20³ outer, 10³ void.
{
  const outer = mod.Manifold.cube([20, 20, 20]);
  const inner = mod.Manifold.cube([10, 10, 10]).translate(5, 5, 5);
  const hollow = outer.subtract(inner);
  try {
    assert.ok(isStatusOk(hollow), 'fixture must be a valid solid');
    const fa = auditSerializedStl('fixture/hollow_cube.stl', arrays(hollow), mod);
    assert.equal(fa.verdict, 'valid', `hollow solid must be valid: ${fa.reasons}`);
    assert.equal(fa.components, 2, 'hollow solid has outer + void shells');
    assert.equal(fa.nestedVoidShells, 1, 'one inward (void) shell');
    assert.ok(Math.abs(fa.netVolumeCm3 - 7.0) < 0.05, `net volume must subtract the void (got ${fa.netVolumeCm3})`);
    assert.ok(fa.kernelVolumeCm3 !== null && Math.abs(fa.kernelVolumeCm3 - 7.0) < 0.05, `kernel volume must agree (got ${fa.kernelVolumeCm3})`);
  } finally { outer.delete(); inner.delete(); }
  console.log('PASS hollow solid → valid, net volume 7.0 cm³, void shell subtracts');
}

// 4. Legitimate detached positives: two separated cubes in one file.
{
  const a = mod.Manifold.cube([10, 10, 10]);
  const b = mod.Manifold.cube([10, 10, 10]).translate(30, 0, 0);
  const both = a.add(b);
  try {
    const fa = auditSerializedStl('fixture/detached.stl', arrays(both), mod);
    assert.equal(fa.verdict, 'valid', `detached positives must be valid: ${fa.reasons}`);
    assert.equal(fa.components, 2, 'two disconnected material components');
    assert.ok(Math.abs(fa.netVolumeCm3 - 2.0) < 0.05, `both positives add (got ${fa.netVolumeCm3})`);
  } finally { a.delete(); b.delete(); }
  console.log('PASS detached positives → valid, both components counted');
}

// 5. Pinched two-solid contact: two cubes sharing exactly one edge — the CSG
//    pinch the platform tolerates as 'suspect' (closed, kernel-valid), never
//    silently 'valid'.
{
  const a = mod.Manifold.cube([10, 10, 10]);
  const b = mod.Manifold.cube([10, 10, 10]).translate(10, 10, 0);
  const pinched = a.add(b);
  try {
    assert.ok(isStatusOk(pinched), 'edge-contact union must be kernel-valid');
    const fa = auditSerializedStl('fixture/pinched.stl', arrays(pinched), mod);
    assert.equal(fa.verdict, 'suspect', `edge-contact pinch must be suspect (got ${fa.verdict})`);
    assert.ok(fa.pinchedEdges > 0, `must count pinched edges (got ${fa.pinchedEdges})`);
    assert.equal(fa.closedSurface, true, 'pinch is closed');
    assert.equal(fa.twoManifold, false, 'pinch is not two-manifold');
  } finally { a.delete(); b.delete(); }
  console.log('PASS pinched contact → suspect (closed, not two-manifold)');
}

// 6. Frozen evidence reconciliation: the angel-large master that the
//    independent audit could not import. Under our kernel oracle the
//    serialized bytes reconstruct (NoError) — the file is closed but carries
//    45 pinched edges → 'suspect', shipped with recorded reasons. This pins
//    the reconciliation instead of hiding it.
{
  const p = 'OUTPUT TEST 1/obj_1_christmas_angel2__large/pourbox_obj_1_christmas_angel2/01_master/master_base.stl';
  const bytes = readFileSync(p);
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const parsed = parseStlBinary(ab);
  const fa = auditSerializedStl('frozen angel master_base.stl', parsed, mod);
  assert.equal(fa.closedSurface, true, 'angel master is closed');
  assert.equal(fa.roundTripKernelValid, true, 'angel master reconstructs under manifold-3d 3.5.3');
  assert.equal(fa.verdict, 'suspect', `angel master must be suspect (got ${fa.verdict})`);
  assert.ok(fa.pinchedEdges >= 40, `angel pinch count (got ${fa.pinchedEdges})`);
  console.log(`PASS frozen angel master → suspect (${fa.pinchedEdges} pinched edges, kernel OK, net ${fa.netVolumeCm3} cm³)`);
}

console.log('FINAL MESH AUDIT REGRESSIONS PASS');
