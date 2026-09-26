import assert from 'node:assert/strict';
import { loadManifold } from '../src/engine/manifoldLoader';
import { instanceToMeshArrays } from '../src/engine/offset';
import { simulate } from '../src/engine/split';

const mod = await loadManifold();
const piece = mod.Manifold.cube([2, 2, 2]);
const obstacle = mod.Manifold.cube([2, 4, 4]).translate(3, -1, -1);
const result = simulate(instanceToMeshArrays(piece), [instanceToMeshArrays(obstacle)], 'X', 1, 12);
piece.delete(); obstacle.delete();
assert.equal(result.pass, false, 'A jacket may not pass THROUGH an obstacle before becoming free');
console.log('RELEASE REGRESSION PASS');
