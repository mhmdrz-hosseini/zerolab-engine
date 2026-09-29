// Release-sequence regression (plan Task 2 remainder). Unit-level semantics of
// simulate(): contact-only tolerance, initial overlap, reversed motion,
// obstacle attribution across targets, and still-installed-panel checks.
// Complements release_collision_regression.ts (through/late/contained/thin).
import assert from 'node:assert/strict';
import { loadManifold } from '../src/engine/manifoldLoader';
import { instanceToMeshArrays } from '../src/engine/offset';
import { simulate } from '../src/engine/split';

const mod = await loadManifold();
const toArrays = instanceToMeshArrays;

/** Volumetric callback against a list of Manifold targets, indexed like simulate's target array. */
const volumetric = (piece: any, targets: any[], dirVec: number[]) =>
  (distance: number, targetIndex: number) => {
    if (targetIndex == null) throw new Error('simulate must attribute volumetric probes to a target index');
    const moved = piece.translate(dirVec[0] * distance, dirVec[1] * distance, dirVec[2] * distance);
    const overlap = moved.intersect(targets[targetIndex]);
    try { return Math.max(0, overlap.volume()); } finally { overlap.delete(); moved.delete(); }
  };

{
  // 1. Contact-only coupon: the piece slides along a flush wall — touching,
  //    never penetrating — then separates once it clears the wall's end.
  //    Must pass (zero-volume contact is not a collision).
  {
    const piece = mod.Manifold.cube([2, 2, 2]);
    const wall = mod.Manifold.cube([6, 2, 2]).translate(0, 2, 0); // flush +Y face contact
    try {
      const r = simulate(toArrays(piece), [toArrays(wall)], 'X', 1, 10, volumetric(piece, [wall], [1, 0, 0]), ['wall']);
      assert.equal(r.pass, true, `contact-only slide must pass (got fail @${r.freeAtMm})`);
      assert.ok(r.freeAtMm >= 5.5 && r.freeAtMm <= 8, `must separate after clearing the wall (freeAtMm ${r.freeAtMm})`);
    } finally { piece.delete(); wall.delete(); }
    console.log('PASS contact-only slide passes');
  }

  // 2. Initial overlap: the piece starts intersecting the target — reject at
  //    the first sample, and name the obstacle.
  {
    const piece = mod.Manifold.cube([2, 2, 2]);
    const block = mod.Manifold.cube([2, 2, 2]).translate(1, 0, 0); // 1 mm deep initial overlap
    try {
      const r = simulate(toArrays(piece), [toArrays(block)], 'X', 1, 10, volumetric(piece, [block], [1, 0, 0]), ['block']);
      assert.equal(r.pass, false, 'initial overlap must fail');
      assert.ok(r.freeAtMm <= 1, `initial overlap must be caught immediately (freeAtMm ${r.freeAtMm})`);
      assert.equal(r.obstacle, 'block', 'initial overlap must name its obstacle');
    } finally { piece.delete(); block.delete(); }
    console.log('PASS initial overlap rejected at first sample with obstacle attribution');
  }

  // 3. Reversed motion: ±direction symmetry — blocked behind, clear ahead.
  {
    const piece = mod.Manifold.cube([2, 2, 2]);
    const behind = mod.Manifold.cube([2, 2, 2]).translate(-3, 0, 0);
    try {
      const blocked = simulate(toArrays(piece), [toArrays(behind)], 'X', -1, 10, volumetric(piece, [behind], [-1, 0, 0]), ['behind']);
      assert.equal(blocked.pass, false, 'reversed motion through an obstacle must fail');
      assert.equal(blocked.obstacle, 'behind', 'reversed motion must name its obstacle');
      const ahead = behind.translate(20, 0, 0); // obstacle now on the far +X side
      const clear = simulate(toArrays(piece), [toArrays(ahead)], 'X', -1, 10, volumetric(piece, [ahead], [-1, 0, 0]), ['ahead']);
      assert.equal(clear.pass, true, 'reversed motion along a clear path must pass');
    } finally { piece.delete(); behind.delete(); }
    console.log('PASS reversed motion symmetrical');
  }

  // 4. Multi-target attribution: clear of the first target, blocked by the
  //    second — the result must name the second and the first unsafe distance.
  {
    const piece = mod.Manifold.cube([2, 2, 2]);
    const master = mod.Manifold.cube([2, 2, 2]).translate(10, 0, 0);  // far ahead, never touched
    const panelB = mod.Manifold.cube([1, 4, 4]).translate(4, -1, -1); // blocks +X at x=4..5
    try {
      const targets = [master, panelB];
      const r = simulate(toArrays(piece), targets.map(toArrays), 'X', 1, 14,
        volumetric(piece, targets, [1, 0, 0]), ['master', 'panel B']);
      assert.equal(r.pass, false, 'blocked multi-target path must fail');
      assert.equal(r.obstacle, 'panel B', `obstacle must be panel B (got ${r.obstacle})`);
      assert.ok(r.freeAtMm > 1 && r.freeAtMm < 5, `first unsafe distance must be at the panel (got ${r.freeAtMm})`);
    } finally { piece.delete(); master.delete(); panelB.delete(); }
    console.log('PASS multi-target obstacle attribution');
  }

  // 5. Still-installed panel: jacket A's path is clear of the master but
  //    blocked by jacket B, which has not been removed yet — the staged
  //    release must reject exactly as if B were the master.
  {
    const piece = mod.Manifold.cube([2, 2, 2]);
    const master = mod.Manifold.cube([2, 2, 2]).translate(-10, 0, 0); // behind, irrelevant
    const installedB = mod.Manifold.cube([1.2, 4, 4]).translate(3.5, -1, -1);
    try {
      const targets = [master, installedB];
      const r = simulate(toArrays(piece), targets.map(toArrays), 'X', 1, 12,
        volumetric(piece, targets, [1, 0, 0]), ['master', 'installed jacket B']);
      assert.equal(r.pass, false, 'a still-installed panel must block the path');
      assert.equal(r.obstacle, 'installed jacket B', 'the installed panel must be named');
    } finally { piece.delete(); master.delete(); installedB.delete(); }
    console.log('PASS still-installed panel blocks release');
  }

  console.log('RELEASE SEQUENCE UNIT REGRESSIONS PASS');
}
