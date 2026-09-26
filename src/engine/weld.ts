// Vertex welding for indexed meshes (OBJ/GLB intake): merges coincident
// vertices (1 µm quantization, same tolerance as the STL parser) and drops
// degenerate triangles that welding collapses — the kernel rejects those.
import type { MeshArrays } from './types';

export function weldMesh(vp: Float32Array, tv: Uint32Array): MeshArrays {
  const n = vp.length / 3;
  const remap = new Int32Array(n).fill(-1);
  const vmap = new Map<string, number>();
  const outVp = new Float32Array(n * 3);
  let outN = 0;
  for (let i = 0; i < n; i++) {
    const x = vp[i * 3], y = vp[i * 3 + 1], z = vp[i * 3 + 2];
    const key = Math.round(x * 1000) + ',' + Math.round(y * 1000) + ',' + Math.round(z * 1000);
    let idx = vmap.get(key);
    if (idx === undefined) {
      idx = outN++;
      vmap.set(key, idx);
      outVp[idx * 3] = x; outVp[idx * 3 + 1] = y; outVp[idx * 3 + 2] = z;
    }
    remap[i] = idx;
  }
  const outTv = new Uint32Array(tv.length);
  let tN = 0;
  let dropped = 0;
  for (let t = 0; t < tv.length / 3; t++) {
    const a = remap[tv[t * 3]], b = remap[tv[t * 3 + 1]], c = remap[tv[t * 3 + 2]];
    if (a === b || b === c || a === c) { dropped++; continue; }
    outTv[tN * 3] = a; outTv[tN * 3 + 1] = b; outTv[tN * 3 + 2] = c;
    tN++;
  }
  return {
    vertProperties: outVp.slice(0, outN * 3),
    triVerts: outTv.slice(0, tN * 3),
  };
}
