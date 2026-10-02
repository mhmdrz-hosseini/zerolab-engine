import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planMold, type PlanRequest } from '../../src/engine/planner';
import { loadManifold, plaque } from './fixtures';
const mod = await loadManifold();
const base: PlanRequest = {
  mod, master: plaque(mod), grid: {} as PlanRequest['grid'], rankedAxes: [],
  params: { gap: 4, wall: 4, clearance: 0.35 }, name: 'intent',
  source: { inputSha256: '0'.repeat(64), sourceKind: 'mesh', units: 'mm', scalePolicy: 'test fixture', engineCommit: 'test' },
};
test('tooling role is enforced before any geometry construction', async () => {
  const result = await planMold({ ...base, castingIntent: { inputRole: 'tooling', requiredSurfaces: 'front_only' } });
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.message : '', /tooling|role/i);
  assert.equal('outcome' in result ? result.outcome : null, 'review_required');
});
test('missing intent requires review instead of defaulting to all sides', async () => {
  const result = await planMold(base);
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.message : '', /intent|surfaces/i);
  assert.equal('outcome' in result ? result.outcome : null, 'review_required');
});
test('a vessel request does not become a generic jacket', async () => {
  const result = await planMold({ ...base, castingIntent: { inputRole: 'positive_master', requiredSurfaces: 'inner_and_outer' } });
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.message : '', /core|vessel|inner/i);
  assert.equal('outcome' in result ? result.outcome : null, 'review_required');
});
