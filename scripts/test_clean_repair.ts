// Unit test — cleanExportMesh topology repairs on a known-good cube:
//   A: zero-area cap fin over an interior edge (apex = exact edge midpoint)
//   B: T-junction (face edge split at a new midpoint vertex)
//   C: exact duplicate face
// Each case must be broken pre-repair and watertight + degenerate-free after.
import { loadManifold } from '../src/engine/manifoldLoader';
import { instanceToMeshArrays } from '../src/engine/offset';
import { auditMeshArrays, cleanExportMesh } from '../src/engine/clean';
import type { MeshArrays } from '../src/engine/types';

const mod = await loadManifold();
const cube = instanceToMeshArrays(new mod.Manifold(new mod.Mesh({
  numProp: 3,
  vertProperties: new Float32Array([0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0, 0, 0, 10, 10, 0, 10, 10, 10, 10, 0, 10, 10]),
  triVerts: new Uint32Array([
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4,
    1, 2, 6, 1, 6, 5,
    2, 3, 7, 2, 7, 6,
    3, 0, 4, 3, 4, 7,
  ]),
})) as never);

const clone = (m: MeshArrays): MeshArrays => ({
  vertProperties: Float32Array.from(m.vertProperties),
  triVerts: Uint32Array.from(m.triVerts),
});
const fmtA = (a: ReturnType<typeof auditMeshArrays>): string =>
  `watertight=${a.watertight} boundary=${a.boundaryEdges} nonManifold=${a.nonManifoldEdges} degen=${a.degenerateTris}`;
const fmt = (r: ReturnType<typeof cleanExportMesh>): string => fmtA(r.audit);

let failed = 0;
const expect = (name: string, cond: boolean, detail: string): void => {
  if (!cond) failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
};

// edge → faces, from the ACTUAL kernel arrays
const edgeFaces = new Map<string, number[]>();
for (let t = 0; t < cube.triVerts.length / 3; t++) {
  for (let k = 0; k < 3; k++) {
    const p = cube.triVerts[t * 3 + k], q = cube.triVerts[t * 3 + (k + 1) % 3];
    const key = p < q ? `${p},${q}` : `${q},${p}`;
    (edgeFaces.get(key) ?? edgeFaces.set(key, []).get(key)!).push(t);
  }
}
const interior = [...edgeFaces.entries()].filter(([, f]) => f.length === 2);
if (interior.length === 0) throw new Error('no interior edge found');
const [pk, qk] = interior[0][0].split(',').map(Number);
const [ax, ay, az] = [cube.vertProperties[pk * 3], cube.vertProperties[pk * 3 + 1], cube.vertProperties[pk * 3 + 2]];
const [bx, by, bz] = [cube.vertProperties[qk * 3], cube.vertProperties[qk * 3 + 1], cube.vertProperties[qk * 3 + 2]];
const mid = [(ax + bx) / 2, (ay + by) / 2, (az + bz) / 2];

const appendVert = (m: MeshArrays, p: number[]): number => {
  const idx = m.vertProperties.length / 3;
  const vp2 = new Float32Array(m.vertProperties.length + 3);
  vp2.set(m.vertProperties); vp2.set(p, idx * 3);
  m.vertProperties = vp2;
  return idx;
};

// baseline
const r0 = cleanExportMesh(cube);
expect('baseline cube clean', r0.audit.watertight && r0.audit.degenerateTris === 0, fmt(r0));

// --- case A: cap fin (pk, qk, apex=mid(pk,qk)) over the interior edge
{
  const m = clone(cube);
  const c = appendVert(m, mid);
  const tv2 = new Uint32Array(m.triVerts.length + 3);
  tv2.set(m.triVerts); tv2.set([pk, qk, c], m.triVerts.length);
  m.triVerts = tv2;
  const pre = auditMeshArrays(m.vertProperties, m.triVerts);
  console.log(`  case A pre-repair: ${fmtA(pre)}`);
  const post = cleanExportMesh(m);
  expect('A: cap fin repaired', post.audit.watertight && post.audit.degenerateTris === 0, fmt(post));
}

// --- case B: T-junction — split face interior[0].faces[0]'s edge (pk,qk) at mid
{
  const m = clone(cube);
  const faceIdx = interior[0][1][0];
  const mIdx = appendVert(m, mid);
  const tv = Array.from(m.triVerts);
  tv.splice(faceIdx * 3, 3, pk, mIdx, tv[faceIdx * 3 + 2], mIdx, qk, tv[faceIdx * 3 + 2]);
  m.triVerts = Uint32Array.from(tv);
  const pre = auditMeshArrays(m.vertProperties, m.triVerts);
  console.log(`  case B pre-repair: ${fmtA(pre)}`);
  const post = cleanExportMesh(m);
  expect('B: T-junction repaired', post.audit.watertight && post.audit.degenerateTris === 0, fmt(post));
}

// --- case C: exact duplicate face
{
  const m = clone(cube);
  const dup = m.triVerts.slice(0, 3);
  const tv2 = new Uint32Array(m.triVerts.length + 3);
  tv2.set(m.triVerts); tv2.set(dup, m.triVerts.length);
  m.triVerts = tv2;
  const pre = auditMeshArrays(m.vertProperties, m.triVerts);
  console.log(`  case C pre-repair: ${fmtA(pre)}`);
  const post = cleanExportMesh(m);
  expect('C: duplicate face dropped', post.audit.watertight && post.audit.degenerateTris === 0, fmt(post));
}

process.exit(failed > 0 ? 1 : 0);
