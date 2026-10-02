// Regression test for the V3 Körper pinched-edge blocker (handoff 2026-09-30
// step 5): generating obj_1_Körper.stl at 50 mm through the shared planner
// must produce a silicone skin whose FINAL SERIALIZED bytes are a valid
// two-manifold solid — verdict 'valid', zero pinched edges — and must not
// overlap any rigid part beyond float32 serialization noise. This test fails
// on the un-repaired output (attempt-002 of pilot-three-20260930-c: skin
// 'suspect', 1 pinched edge, master_base ∩ skin = 2.6926 mm³).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { planMold, type PlanRequest } from '../../src/engine/planner';
import { parseStlBinary } from '../../src/engine/stl';
import { intersectionVolume, loadManifold, withSolid } from './fixtures';

const mod = await loadManifold();

test('koerper 50mm full-3D package ships a pinch-free, non-overlapping serialized skin', async () => {
  const bytes = readFileSync('D:/code/3d/MOLD/MOLD-generator base/input/obj_1_Körper.stl');
  const master = parseStlBinary(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const bb = withSolid(mod, master, (m) => m.boundingBox());
  const k = 50 / Math.max(...bb.max.map((x, i) => x - bb.min[i]));
  master.vertProperties = master.vertProperties.map((x) => x * k);
  const result = await planMold({
    mod, master, grid: {} as PlanRequest['grid'],
    params: { gap: 6, wall: 5, clearance: 0.35 },
    name: 'obj_1_Körper',
    castingIntent: { inputRole: 'positive_master', requiredSurfaces: 'all_sides', requestedFamily: 'full_3d_jacket' },
    source: { inputSha256: createHash('sha256').update(bytes).digest('hex'), sourceKind: 'file', units: 'mm', scalePolicy: '50 mm', engineCommit: 'test' },
  });
  assert.equal(result.ok, true, result.ok ? '' : `${result.outcome}: ${result.message}`);
  if (!result.ok) return;
  assert.equal(result.method.family, 'full_3d_jacket');

  const projectKey = Object.keys(result.files.files).find((x) => x.endsWith('/project.json'))!;
  const project = JSON.parse(new TextDecoder().decode(result.files.files[projectKey])) as {
    finalFileAudit: Record<string, { verdict: string; pinchedEdges: number }>;
    topologyRepair?: { applied: boolean; toleranceMm: number; budgetMm: number; finestProtectedFeatureMm: number; recutBlockers: boolean } | null;
  };
  for (const [name, audit] of Object.entries(project.finalFileAudit)) {
    assert.equal(audit.verdict, 'valid', `${name} must serialize clean, not merely export — got ${audit.verdict}`);
  }
  const skinAudit = project.finalFileAudit['03_preview/silicone_skin.stl'];
  assert.equal(skinAudit.pinchedEdges, 0, 'the serialized silicone skin must carry zero pinched edges');

  // The repair, when applied, must stay inside the recorded fidelity budget.
  const repair = project.topologyRepair ?? null;
  if (repair) {
    assert.ok(repair.toleranceMm <= repair.budgetMm + 1e-12, `repair tolerance ${repair.toleranceMm} exceeds budget ${repair.budgetMm}`);
    assert.equal(repair.budgetMm, Math.min(0.05, repair.finestProtectedFeatureMm / 10));
    if (repair.applied) assert.equal(repair.recutBlockers, true, 'a displacement repair must re-cut the rigid blockers');
  }

  // Serialized rigid/silicone intersections stay inside float32 noise.
  const stl = (suffix: string) => {
    const key = Object.keys(result.files.files).find((x) => x.endsWith(suffix))!;
    return parseStlBinary(Uint8Array.from(result.files.files[key]).buffer);
  };
  const skin = stl('/03_preview/silicone_skin.stl');
  let maxCoord = 1;
  for (let i = 0; i < skin.vertProperties.length; i++) {
    const v = Math.abs(skin.vertProperties[i]);
    if (v > maxCoord) maxCoord = v;
  }
  const ulpMm = Math.pow(2, Math.ceil(Math.log2(maxCoord)) - 23);
  for (const [name, part] of [['master base', stl('/01_master/master_base.stl')], ['jacket A', stl('/02_jacket/jacket_A.stl')], ['jacket B', stl('/02_jacket/jacket_B.stl')]] as const) {
    const overlap = intersectionVolume(mod, part, skin);
    assert.ok(overlap <= 0.01, `${name} intersects the final serialized skin by ${overlap.toFixed(4)} mm³ (target ≤ 0.001 mm³, float32 noise bound at this size ≈ ${ulpMm.toFixed(9)} mm/axis)`);
  }
});
