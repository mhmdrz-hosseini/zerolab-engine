// Wavefront OBJ intake — geometry only (materials are irrelevant to a mold).
// Supports v/f lines, v/vt/vn tokens, negative (relative) indices, fan
// triangulation of ngons. Everything else is ignored.
import type { MeshArrays } from './types';

export interface ParsedObj { mesh: MeshArrays; warnings: string[] }

export function parseObj(text: string): ParsedObj {
  const warnings: string[] = [];
  const vp: number[] = [];
  const tv: number[] = [];
  let dropped = 0;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const kw = parts[0];
    if (kw === 'v') {
      vp.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
    } else if (kw === 'f') {
      const ids: number[] = [];
      for (let k = 1; k < parts.length; k++) {
        const tok = parts[k].split('/')[0];
        if (tok.length === 0) continue;
        let i = parseInt(tok, 10);
        if (Number.isNaN(i)) continue;
        if (i < 0) i = vp.length / 3 + i + 1;
        else i = i - 1;
        if (i < 0 || i >= vp.length / 3) continue;
        ids.push(i);
      }
      if (ids.length < 3) { dropped++; continue; }
      for (let k = 1; k + 1 < ids.length; k++) {
        tv.push(ids[0], ids[k], ids[k + 1]);
      }
    }
    // vn / vt / o / g / s / usemtl / mtllib … ignored by design
  }
  if (dropped > 0) warnings.push(`${dropped} degenerate or malformed faces dropped`);
  if (vp.length === 0) throw new Error('OBJ contains no vertices');
  return { mesh: { vertProperties: new Float32Array(vp), triVerts: new Uint32Array(tv) }, warnings };
}
