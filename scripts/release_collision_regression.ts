import assert from 'node:assert/strict';
import { loadManifold } from '../src/engine/manifoldLoader';
import { instanceToMeshArrays } from '../src/engine/offset';
import { simulate } from '../src/engine/split';

const mod = await loadManifold();
const moving = mod.Manifold.cube([2, 2, 2]);
const toArrays = instanceToMeshArrays;

function runAgainst(targetX: number, direction: 1 | -1, travel = 14, obstacleWidth = 2) {
  const inner = obstacleWidth < 1;
  const obstacle = mod.Manifold.cube([obstacleWidth, inner ? 1.8 : 2, inner ? 1.8 : 2])
    .translate(targetX, inner ? 0.1 : 0, inner ? 0.1 : 0);
  let calls = 0;
  let maxPenetration = 0;
  try {
    const result = simulate(toArrays(moving), [toArrays(obstacle)], 'X', direction, travel, (distance) => {
      const translated = moving.translate(direction * distance, 0, 0);
      const intersection = translated.intersect(obstacle);
      try {
        const penetration = Math.max(0, intersection.volume());
        calls++;
        maxPenetration = Math.max(maxPenetration, penetration);
        return penetration;
      } finally {
        intersection.delete();
        translated.delete();
      }
    });
    return { result, calls, maxPenetration };
  } finally {
    obstacle.delete();
  }
}

try {
  const through = runAgainst(3, 1);
  assert.ok(through.calls > 0, 'test must exercise the real collision callback');
  assert.ok(through.maxPenetration > 0.5, 'fixture must create material overlap');
  assert.equal(through.result.pass, false, 'a rigid part must not pass through an obstacle');

  const later = runAgainst(7, 1);
  assert.equal(later.result.pass, false, 'a later obstruction still blocks the path');

  const contained = runAgainst(2.2, 1, 14, 0.2);
  assert.equal(contained.result.pass, false, 'an enclosed obstacle still blocks the path');
  assert.ok(contained.maxPenetration >= 0.5, 'thin obstacle creates meaningful internal overlap');

  // A 0.5 mm fixed sampling interval leaps completely over this collision.
  const thinPiece = mod.Manifold.cube([0.2, 2, 2]);
  const thinObstacle = mod.Manifold.cube([0.2, 2, 2]).translate(0.35, 0, 0);
  try {
    const thin = simulate(toArrays(thinPiece), [toArrays(thinObstacle)], 'X', 1, 2, (distance) => {
      const translated = thinPiece.translate(distance, 0, 0);
      const intersection = translated.intersect(thinObstacle);
      try { return Math.max(0, intersection.volume()); }
      finally { intersection.delete(); translated.delete(); }
    });
    assert.equal(thin.pass, false, 'sample spacing must resolve thin obstacles');
  } finally { thinPiece.delete(); thinObstacle.delete(); }

  const outward = runAgainst(-3, 1);
  assert.equal(outward.result.pass, true, 'a clear outward path stays valid');

  console.log('RELEASE COLLISION REGRESSION PASS');
} finally {
  moving.delete();
}
