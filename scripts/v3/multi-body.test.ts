import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planMold } from '../../src/engine/planner';
import { loadManifold, instanceToMeshArrays } from './fixtures';

const mod = await loadManifold();
test('two intentional separated cast pieces are not exported as a floating single master', async () => {
  const body = mod.Manifold.cube([20, 20, 30]);
  const detail = mod.Manifold.cube([3, 3, 3]).translate(24, 8, 12);
  const source = body.add(detail);
  const result = await planMold({
    mod, master: instanceToMeshArrays(source), params: { gap: 4, wall: 4, clearance: 0.35 },
    name: 'separate detail',
    source: { inputSha256: '0'.repeat(64), sourceKind: 'mesh', units: 'mm', scalePolicy: 'test', engineCommit: 'test' },
    castingIntent: { inputRole: 'positive_master', requiredSurfaces: 'all_sides', requestedFamily: 'full_3d_jacket', multiBodyHandling: 'separate_casts' },
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.outcome, 'review_required');
  assert.match(result.message, /2 positive surface shells/);
  body.delete(); detail.delete(); source.delete();
});
