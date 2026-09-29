import assert from 'node:assert/strict';
import { loadManifold } from '../src/engine/manifoldLoader';
import { instanceToMeshArrays } from '../src/engine/offset';
import { auditMeshArrays } from '../src/engine/clean';

const mod = await loadManifold();
const outer = mod.Manifold.cube([20, 20, 20]);
const voidSolid = mod.Manifold.cube([10, 10, 10]).translate(5, 5, 5);
const hollow = outer.subtract(voidSolid);
try {
  const mesh = instanceToMeshArrays(hollow);
  const audit = auditMeshArrays(mesh.vertProperties, mesh.triVerts);
  assert.equal(audit.watertight, true);
  assert.equal(audit.components, 2);
  assert.equal(audit.volumeCm3, 7.0, 'internal void volume must subtract from material volume');
  console.log('NET VOLUME REGRESSION PASS');
} finally {
  hollow.delete();
  voidSolid.delete();
  outer.delete();
}
