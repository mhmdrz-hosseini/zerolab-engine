// 2D profile extraction from the SDF grid: marching-squares iso-contours at a
// plane ⊥ a chosen axis, plus the polygon queries (point-in-filled, distance-
// to-filled) used to place bolt bosses on the flange ring.
import type { SdfGrid } from './offset';

export type Loop = [number, number][];
export type Loops = Loop[];

function sampleIndex(grid: SdfGrid, axis: number, coord: number): number {
  const i = Math.round((coord - grid.lo[axis]) / grid.step - 0.5);
  return Math.max(0, Math.min(grid.dims[axis] - 1, i));
}

/**
 * Iso-contour loops of the signed-distance field on the plane ⊥ `axis` at
 * `coord` (snapped to the nearest grid layer), for iso `level`.
 * Returns loops in the plane's (u,v) coordinates where u = (axis+1)%3,
 * v = (axis+2)%3, in mm.
 */
export function contoursAtLayer(grid: SdfGrid, axis: number, coord: number, level: number): Loops {
  const { data, lo, dims, step } = grid;
  const u3 = (axis + 1) % 3, v3 = (axis + 2) % 3;
  const ia = sampleIndex(grid, axis, coord);
  const W = dims[u3], H = dims[v3];
  const stride = [dims[1] * dims[2], dims[2], 1]; // index offset per unit of X, Y, Z

  const val = (iu: number, iv: number): number => {
    const idx = ia * stride[axis] + iu * stride[u3] + iv * stride[v3];
    return data[idx];
  };
  const px = (iu: number): number => lo[u3] + (iu + 0.5) * step;
  const py = (iv: number): number => lo[v3] + (iv + 0.5) * step;

  // marching squares: corner bits b0=(i,j) b1=(i+1,j) b2=(i+1,j+1) b3=(i,j+1)
  // edges: 0=bottom(c00-c10) 1=right(c10-c11) 2=top(c01-c11) 3=left(c00-c01)
  const CASES: Record<number, [number, number][]> = {
    1: [[3, 0]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]], 5: [[3, 0], [1, 2]],
    6: [[0, 2]], 7: [[3, 2]], 8: [[2, 3]], 9: [[0, 2]], 10: [[0, 1], [2, 3]],
    11: [[1, 2]], 12: [[3, 1]], 13: [[0, 1]], 14: [[3, 0]],
  };

  const segs: [number, number, number, number][] = []; // x1,y1,x2,y2 in mm
  const edgePoint = (edge: number, i: number, j: number): [number, number] => {
    const c00 = val(i, j), c10 = val(i + 1, j), c11 = val(i + 1, j + 1), c01 = val(i, j + 1);
    const lerp = (a: number, b: number) => (level - a) / (b - a);
    switch (edge) {
      case 0: return [px(i + lerp(c00, c10)), py(j)];
      case 1: return [px(i + 1), py(j + lerp(c10, c11))];
      case 2: return [px(i + lerp(c01, c11)), py(j + 1)];
      default: return [px(i), py(j + lerp(c00, c01))];
    }
  };

  for (let i = 0; i + 1 < W; i++) {
    for (let j = 0; j + 1 < H; j++) {
      const bits = (val(i, j) > level ? 1 : 0) | (val(i + 1, j) > level ? 2 : 0) |
        (val(i + 1, j + 1) > level ? 4 : 0) | (val(i, j + 1) > level ? 8 : 0);
      const pairs = CASES[bits];
      if (!pairs) continue;
      for (const [e1, e2] of pairs) {
        const p1 = edgePoint(e1, i, j), p2 = edgePoint(e2, i, j);
        segs.push([p1[0], p1[1], p2[0], p2[1]]);
      }
    }
  }

  // stitch segments into closed loops (endpoints coincide to ~1e-9 by construction)
  const key = (x: number, y: number) => `${Math.round(x * 1000)}_${Math.round(y * 1000)}`;
  const adj = new Map<string, number[]>();
  segs.forEach((s, idx) => {
    for (const k of [key(s[0], s[1]), key(s[2], s[3])]) {
      (adj.get(k) ?? adj.set(k, []).get(k)!).push(idx);
    }
  });
  const used = new Uint8Array(segs.length);
  const loops: Loops = [];
  for (let s0 = 0; s0 < segs.length; s0++) {
    if (used[s0]) continue;
    used[s0] = 1;
    const loop: Loop = [[segs[s0][0], segs[s0][1]]];
    let [cx, cy] = [segs[s0][2], segs[s0][3]];
    const startKey = key(segs[s0][0], segs[s0][1]);
    let guard = segs.length + 1;
    while (guard-- > 0) {
      loop.push([cx, cy]);
      if (key(cx, cy) === startKey) { loop.pop(); loops.push(loop); break; }
      const next = (adj.get(key(cx, cy)) ?? []).find((i) => !used[i]);
      if (next === undefined) break; // open chain — drop (should not happen on smooth SDFs)
      used[next] = 1;
      const s = segs[next];
      const a = key(s[0], s[1]) === key(cx, cy);
      [cx, cy] = a ? [s[2], s[3]] : [s[0], s[1]];
    }
  }
  return loops.filter((l) => l.length >= 4);
}

/** Even-odd containment over a loop set (filled region). */
export function pointInLoops(loops: Loops, x: number, y: number): boolean {
  let inside = false;
  for (const loop of loops) {
    for (let i = 0, n = loop.length; i < n; i++) {
      const [x1, y1] = loop[i], [x2, y2] = loop[(i + 1) % n];
      if (y1 > y !== y2 > y && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) inside = !inside;
    }
  }
  return inside;
}

/** Minimum distance from p to any loop segment. */
export function distToLoops(loops: Loops, x: number, y: number): number {
  let best = Infinity;
  for (const loop of loops) {
    for (let i = 0, n = loop.length; i < n; i++) {
      const [x1, y1] = loop[i];
      const [x2, y2] = loop[(i + 1) % n];
      const dx = x2 - x1, dy = y2 - y1;
      const len2 = dx * dx + dy * dy;
      let t = len2 > 0 ? ((x - x1) * dx + (y - y1) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const px = x1 + t * dx - x, py = y1 + t * dy - y;
      const d = px * px + py * py;
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}

/** Signed distance to the filled region: 0 inside, distance to boundary outside. */
export function distToFilled(loops: Loops, x: number, y: number): number {
  return pointInLoops(loops, x, y) ? 0 : distToLoops(loops, x, y);
}

/**
 * Place `count` bolt bosses on the flange ring: find positions where a disc of
 * radius `bossR` fits entirely in flange material — inside offset(outer, W=10)
 * and outside offset(inner, innerBand). Returns plane-coordinate centers.
 */
export function placeBosses(
  outer: Loops, inner: Loops, count: number, bossR: number, flangeW: number, innerBand: number,
): { x: number; y: number }[] {
  let cx = 0, cy = 0, n = 0;
  for (const loop of outer) for (const [x, y] of loop) { cx += x; cy += y; n++; }
  if (n === 0) return [];
  cx /= n; cy /= n;
  let rMax = 0;
  for (const loop of outer) for (const [x, y] of loop) rMax = Math.max(rMax, Math.hypot(x - cx, y - cy));

  const materialAt = (x: number, y: number): boolean =>
    distToFilled(outer, x, y) <= flangeW + bossR * 0.5 && distToFilled(inner, x, y) > innerBand + bossR * 0.5;
  const fits = (x: number, y: number, dx: number, dy: number): boolean =>
    materialAt(x, y) && materialAt(x + bossR * dx, y + bossR * dy) &&
    materialAt(x - bossR * dx, y - bossR * dy) && materialAt(x + bossR * -dy, y + bossR * dx) &&
    materialAt(x + bossR * dy, y - bossR * dx);

  const candidates: { x: number; y: number; t: number; theta: number }[] = [];
  for (let deg = 0; deg < 360; deg += 12) {
    const th = (deg * Math.PI) / 180;
    const dx = Math.cos(th), dy = Math.sin(th);
    let bestT = -1;
    for (let t = 2; t <= rMax + flangeW; t += 1) {
      const x = cx + t * dx, y = cy + t * dy;
      if (fits(x, y, dx, dy)) bestT = t;
    }
    if (bestT > 0) candidates.push({ x: cx + (bestT - 0.5) * dx, y: cy + (bestT - 0.5) * dy, t: bestT, theta: deg });
  }
  candidates.sort((a, b) => b.t - a.t);
  const picked: { x: number; y: number; theta: number }[] = [];
  const sep = (a: number, b: number) => {
    const d = Math.abs(((a - b) % 360 + 540) % 360 - 180);
    return 180 - d;
  };
  for (const c of candidates) {
    if (picked.length >= count) break;
    if (picked.every((p) => sep(p.theta, c.theta) >= 60)) picked.push({ x: c.x, y: c.y, theta: c.theta });
  }
  return picked.map((p) => ({ x: p.x, y: p.y }));
}
