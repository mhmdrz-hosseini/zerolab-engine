// Binary STL parsing + 1µm vertex welding.
// CRITICAL: STL records are 50 bytes (48 float bytes + 2-byte attribute) — parse
// with per-record DataView reads, never a contiguous typed-array view (a 48-byte
// implicit stride drifts 2 bytes/record and silently destroys every statistic;
// this exact bug burned the first analysis session — see wayfinder T008 notes).

import type { MeshArrays } from './types';

export interface ParsedStl extends MeshArrays {
  triCountIn: number; // triangles as declared in the file
}

export function looksBinaryStl(bytes: ArrayBuffer): boolean {
  const head = new TextDecoder('ascii').decode(new Uint8Array(bytes, 0, Math.min(200, bytes.byteLength)));
  const size = bytes.byteLength;
  if (size < 84) return false;
  const declared = new DataView(bytes).getUint32(80, true);
  if (84 + declared * 50 === size) return true; // stride arithmetic confirms binary
  return !(head.slice(0, 5).toLowerCase() === 'solid' && head.includes('facet'));
}

export function parseStlBinary(bytes: ArrayBuffer, onProgress?: (pct: number) => void): ParsedStl {
  if (bytes.byteLength < 84) throw new Error('File too small to be a binary STL');
  const dv = new DataView(bytes);
  const triCount = dv.getUint32(80, true);
  if (84 + triCount * 50 !== bytes.byteLength) {
    const head = new TextDecoder('ascii').decode(new Uint8Array(bytes, 0, Math.min(200, bytes.byteLength)));
    if (head.slice(0, 5).toLowerCase() === 'solid' && head.includes('facet')) {
      throw new Error('ASCII STL detected — export a binary STL (V0.1 imports binary only)');
    }
    throw new Error(`Corrupt STL: declared ${triCount} triangles but size does not match`);
  }

  const Q = 1000; // 1 µm weld quantization
  const vmap = new Map<string, number>();
  const vp: number[] = [];
  const tv = new Uint32Array(triCount * 3);

  for (let t = 0; t < triCount; t++) {
    const ro = 84 + t * 50;
    for (let k = 0; k < 3; k++) {
      const x = dv.getFloat32(ro + 12 + k * 12, true);
      const y = dv.getFloat32(ro + 16 + k * 12, true);
      const z = dv.getFloat32(ro + 20 + k * 12, true);
      const key = Math.round(x * Q) + ',' + Math.round(y * Q) + ',' + Math.round(z * Q);
      let idx = vmap.get(key);
      if (idx === undefined) {
        idx = vp.length / 3;
        vp.push(x, y, z);
        vmap.set(key, idx);
      }
      tv[t * 3 + k] = idx;
    }
    if (onProgress && (t & 0x7ffff) === 0) onProgress(t / triCount);
  }

  return { vertProperties: new Float32Array(vp), triVerts: tv, triCountIn: triCount };
}

export function writeStlBinary(m: MeshArrays): ArrayBuffer {
  // little-endian binary STL, per-triangle normals computed here
  const tris = m.triVerts.length / 3;
  const out = new ArrayBuffer(84 + tris * 50);
  const dv = new DataView(out);
  const header = 'Matrix Mold V0.1';
  for (let i = 0; i < header.length; i++) dv.setUint8(i, header.charCodeAt(i));
  dv.setUint32(80, tris, true);
  for (let t = 0; t < tris; t++) {
    const ro = 84 + t * 50;
    const [ia, ib, ic] = [m.triVerts[t * 3], m.triVerts[t * 3 + 1], m.triVerts[t * 3 + 2]];
    const ax = m.vertProperties[ia * 3], ay = m.vertProperties[ia * 3 + 1], az = m.vertProperties[ia * 3 + 2];
    const bx = m.vertProperties[ib * 3], by = m.vertProperties[ib * 3 + 1], bz = m.vertProperties[ib * 3 + 2];
    const cx = m.vertProperties[ic * 3], cy = m.vertProperties[ic * 3 + 1], cz = m.vertProperties[ic * 3 + 2];
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    dv.setFloat32(ro, nx, true); dv.setFloat32(ro + 4, ny, true); dv.setFloat32(ro + 8, nz, true);
    dv.setFloat32(ro + 12, ax, true); dv.setFloat32(ro + 16, ay, true); dv.setFloat32(ro + 20, az, true);
    dv.setFloat32(ro + 24, bx, true); dv.setFloat32(ro + 28, by, true); dv.setFloat32(ro + 32, bz, true);
    dv.setFloat32(ro + 36, cx, true); dv.setFloat32(ro + 40, cy, true); dv.setFloat32(ro + 44, cz, true);
    dv.setUint16(ro + 48, 0, true);
  }
  return out;
}
