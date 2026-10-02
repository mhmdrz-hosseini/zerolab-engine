import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildReliefTray } from '../../src/engine/reliefTray';
import { loadManifold, plaque, perforatedPlate, trayParams, intersectionVolume, instanceToMeshArrays, withSolid } from './fixtures';
const mod = await loadManifold();
test('seated tray wall does not occupy printed base material', () => {
  const tray = buildReliefTray({ mod, master: plaque(mod), params: trayParams });
  const overlap = intersectionVolume(mod, tray.pieces.wall, tray.pieces.masterBase);
  assert.ok(overlap < 0.001, `wall/base overlap ${overlap} mm3`);
});
test('a straight master hole becomes a connected silicone post, without a rigid inner island', () => {
  const tray = buildReliefTray({ mod, master: perforatedPlate(mod), params: trayParams });
  const probe = mod.Manifold.cube([1,1,1]).translate(24.5,24.5,1);
  const amount = intersectionVolume(mod, tray.pieces.siliconeSkin, instanceToMeshArrays(probe)); probe.delete();
  assert.ok(Math.abs(amount - 1) < 0.001, `hole center contains ${amount} mm3 silicone, expected 1`);
  for (const [name, mesh] of [['wall', tray.pieces.wall], ['silicone', tray.pieces.siliconeSkin]] as const) {
    const count = withSolid(mod, mesh, m => { const c=m.decompose(); const n=c.length; c.forEach(x=>x.delete()); return n; });
    assert.equal(count, 1, `${name} has ${count} components`);
  }
});
