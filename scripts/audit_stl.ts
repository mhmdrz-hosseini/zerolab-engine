// STL mesh-cleanliness audit — measures an exported binary STL the way an
// external slicer/mesh tool would: NO welding, bitwise-exact vertex identity.
// Reports zero-area faces, connected components, zero-volume components and
// watertightness. Usage: npx tsx scripts/audit_stl.ts <file.stl> [...]
import { readFileSync } from 'node:fs';

interface Audit {
  file: string;
  tris: number;
  zeroAreaFaces: number;       // |e1×e2| exactly 0 in double precision
  repeatedIndexFaces: number;  // two bitwise-identical corners
  components: number;
  zeroVolumeComponents: number;
  degenerateComponents: number; // components made only of zero-area faces
  watertight: boolean;
  boundaryEdges: number;
  nonManifoldEdges: number;
  volumeCm3: number;
}

function audit(file: string): Audit {
  const buf = readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const dv = new DataView(ab);
  const triCount = dv.getUint32(80, true);
  if (84 + triCount * 50 !== ab.byteLength) throw new Error(`${file}: not a size-consistent binary STL`);

  // bitwise-exact vertex identity (no welding) via float32 bit keys
  const keyOf = new Map<string, number>(); // bitkey -> vert id
  const verts: number[] = [];              // xyz per vert id
  const triVert: number[] = [];            // 3 ids per triangle
  const bit = (f: number): string => String(new Float32Array([f])[0] === f ? new Uint32Array(new Float32Array([f]).buffer)[0] : 0);
  for (let t = 0; t < triCount; t++) {
    const ro = 84 + t * 50;
    const ids: number[] = [];
    for (let k = 0; k < 3; k++) {
      const x = dv.getFloat32(ro + 12 + k * 12, true);
      const y = dv.getFloat32(ro + 16 + k * 12, true);
      const z = dv.getFloat32(ro + 20 + k * 12, true);
      const key = `${bit(x)},${bit(y)},${bit(z)}`;
      let id = keyOf.get(key);
      if (id === undefined) {
        id = verts.length / 3;
        keyOf.set(key, id);
        verts.push(x, y, z);
      }
      ids.push(id);
    }
    triVert.push(ids[0], ids[1], ids[2]);
  }

  const V = (i: number): [number, number, number] => [verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]];
  const sub = (a: [number, number, number], b: [number, number, number]): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a: [number, number, number], b: [number, number, number]): [number, number, number] =>
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

  let zeroAreaFaces = 0, repeatedIndexFaces = 0;
  const zeroAreaTri = new Uint8Array(triCount);
  for (let t = 0; t < triCount; t++) {
    const [a, b, c] = [triVert[t * 3], triVert[t * 3 + 1], triVert[t * 3 + 2]];
    const rep = a === b || b === c || a === c ? 1 : 0;
    const n = cross(sub(V(b), V(a)), sub(V(c), V(a)));
    const area2 = n[0] * n[0] + n[1] * n[1] + n[2] * n[2];
    const zero = area2 === 0 ? 1 : 0;
    repeatedIndexFaces += rep;
    zeroAreaFaces += zero;
    zeroAreaTri[t] = zero || rep;
  }

  // union-find over triangles sharing a bitwise-identical vertex
  const parent = new Int32Array(verts.length / 3).map((_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const uni = (a: number, b: number): void => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };
  for (let t = 0; t < triCount; t++)
    uni(triVert[t * 3], triVert[t * 3 + 1]), uni(triVert[t * 3 + 1], triVert[t * 3 + 2]);

  const compVolume = new Map<number, number>();
  const compTris = new Map<number, { total: number; degenerate: number }>();
  for (let t = 0; t < triCount; t++) {
    const r = find(triVert[t * 3]);
    const [a, b, c] = [V(triVert[t * 3]), V(triVert[t * 3 + 1]), V(triVert[t * 3 + 2])];
    const vol = (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    compVolume.set(r, (compVolume.get(r) ?? 0) + vol);
    const ct = compTris.get(r) ?? { total: 0, degenerate: 0 };
    ct.total++; ct.degenerate += zeroAreaTri[t];
    compTris.set(r, ct);
  }

  // edge pairing on bitwise-identical verts
  const directed = new Map<string, number>();
  for (let t = 0; t < triCount; t++) {
    if (zeroAreaTri[t]) continue;
    for (let k = 0; k < 3; k++) {
      const a = triVert[t * 3 + k], b = triVert[t * 3 + (k + 1) % 3];
      if (a === b) continue;
      const key = a < b ? `${a}>${b}` : `${b}>${a}`;
      const rev = a < b ? `${b}>${a}` : `${a}>${b}`;
      directed.set(key, (directed.get(key) ?? 0) + 1);
      void rev;
    }
  }
  // watertight: every undirected edge shared by exactly 2 non-degenerate tris
  let boundaryEdges = 0, nonManifoldEdges = 0;
  const undirected = new Map<string, number>();
  for (const [key] of directed) {
    const [a, b] = key.split('>');
    const fwd = directed.get(`${a}>${b}`) ?? 0;
    const rev = directed.get(`${b}>${a}`) ?? 0;
    undirected.set(key, fwd + rev);
  }
  for (const [, n] of undirected) {
    if (n === 1) boundaryEdges++;
    else if (n > 2) nonManifoldEdges++;
  }
  const watertight = boundaryEdges === 0 && nonManifoldEdges === 0;

  let components = 0, zeroVolumeComponents = 0, degenerateComponents = 0;
  let volumeCm3 = 0;
  const seenRoots = new Set<number>();
  for (const [root, vol] of compVolume) {
    if (seenRoots.has(root)) continue;
    seenRoots.add(root);
    components++;
    const ct = compTris.get(root)!;
    if (Math.abs(vol) < 1e-6) {
      zeroVolumeComponents++;
      if (ct.degenerate === ct.total) degenerateComponents++;
    } else {
      volumeCm3 += Math.abs(vol) / 1000;
    }
  }

  return {
    file, tris: triCount, zeroAreaFaces, repeatedIndexFaces, components,
    zeroVolumeComponents, degenerateComponents, watertight, boundaryEdges,
    nonManifoldEdges, volumeCm3: Number(volumeCm3.toFixed(1)),
  };
}

for (const f of process.argv.slice(2)) {
  try {
    const a = audit(f);
    console.log(
      `${a.file}\n` +
      `  tris=${a.tris.toLocaleString()} vol=${a.volumeCm3} cm³\n` +
      `  zero-area faces: ${a.zeroAreaFaces} (repeated-index: ${a.repeatedIndexFaces})\n` +
      `  components: ${a.components} (zero-volume: ${a.zeroVolumeComponents}, all-degenerate: ${a.degenerateComponents})\n` +
      `  watertight: ${a.watertight ? 'yes' : `NO (boundary ${a.boundaryEdges}, non-manifold ${a.nonManifoldEdges})`}`
    );
  } catch (e) {
    console.error(`${f}: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  }
}
