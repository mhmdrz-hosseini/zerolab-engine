import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildReliefTray } from '../../src/engine/reliefTray';
import { buildPrintFiles } from '../../src/engine/export';
import { loadManifold, plaque, trayParams, withSolid, instanceToMeshArrays } from './fixtures';

const mod = await loadManifold();
test('freeboard changes wall height but not silicone fill or volume', () => {
  const master = plaque(mod);
  const low = buildReliefTray({ mod, master, params: { ...trayParams, freeboard: 2 } });
  const high = buildReliefTray({ mod, master, params: { ...trayParams, freeboard: 7 } });
  assert.ok(Math.abs(high.siliconeMl - low.siliconeMl) < 0.01,
    `freeboard changed silicone from ${low.siliconeMl} to ${high.siliconeMl} mL`);
  assert.ok(Math.abs(high.wallTopZ - low.wallTopZ - 5) < 0.01);
  assert.ok(Math.abs(withSolid(mod, high.pieces.siliconeSkin, m => m.boundingBox().max[2]) - 12.5) < 0.01);
});
test('export compares cm3 with mL without multiplying by 1000', () => {
  const cube = mod.Manifold.cube([10, 10, 10]);
  const mesh = instanceToMeshArrays(cube); cube.delete();
  const files = buildPrintFiles({ mod, masterBase: mesh,
    parts: { jacketA: mesh, jacketB: mesh, siliconeSkin: mesh },
    info: { name: 'units', createdAt: '2026-09-30', params: { gap: 4, wall: 4, clearance: 0.35 },
      axis: 'X', siliconeMl: 1, extraction: { A: 0, B: 0 }, jacketDim: [10,10,10], plateDim: [10,10,4],
      warnings: [], checks: [], crown: null, ventCount: 0, frame: { vert: 'Z', base: 0, plateT: 4 } },
  });
  const json = JSON.parse(new TextDecoder().decode(files.files['pourbox_units/project.json']));
  assert.equal(json.finalFileAudit['03_preview/silicone_skin.stl'].netVolumeCm3, 1);
  assert.equal(json.warnings.some((w: string) => w.includes('serialized skin')), false,
    `matching volumes must not warn: ${JSON.stringify(json.warnings)}`);
});
