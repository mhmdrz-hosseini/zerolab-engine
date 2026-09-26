// Vent placement — V0.2 open-crown architecture: there is no crown bore (the
// jacket is an open basin; pouring needs no port). Two Ø2.5 air vents — one per
// half — are drilled **along the pull axis** at each half's highest master
// point, so air escaping an undercut peak during the pour reaches the outside
// through the wall. The bore's z is set at masterTop + gap + 1: above that
// half's master surface everywhere along the bore line, so it never cuts the
// master. Columns are read off the SDF grid along the mold's vertical axis.
import type { SdfGrid } from './offset';
import type { Axis } from './types';

const AXES: Axis[] = ['X', 'Y', 'Z'];

export interface PortSpec {
  u: number;             // column position along (vert+1)%3, mm
  v: number;             // column position along (vert+2)%3, mm
  uPull: number;         // bore center along (pull+1)%3, mm (pull-axis CS frame)
  vPull: number;         // bore center along (pull+2)%3, mm
  zMm: number;           // bore center height along the vert axis, mm
  pCoord: number;        // position along the pull axis (selects the owning half)
  masterTopMm: number;   // master surface on this column
  boreR: number;
}

export interface PortsPlan {
  crown: null;             // V0.2: open crown — no pour bore exists
  vents: PortSpec[];
  vAx: number;
  u3: number;
  v3: number;
}

export function planPorts(
  grid: SdfGrid,
  opts: { gap: number; wall: number; vert: Axis; pull: Axis; mid: number; base: number; crown: number },
): PortsPlan {
  const { data, lo, dims, step } = grid;
  const vAx = AXES.indexOf(opts.vert);
  const pAx = AXES.indexOf(opts.pull);
  const u3 = (vAx + 1) % 3, v3 = (vAx + 2) % 3;
  const uP = (pAx + 1) % 3, vP = (pAx + 2) % 3;
  const stride = [dims[1] * dims[2], dims[2], 1];
  const kvMin = Math.max(0, Math.ceil((opts.base - lo[vAx]) / step - 0.5));
  const pIsU = u3 === pAx;

  interface Col { iu: number; iv: number; masterTopMm: number; pCoord: number; u: number; v: number }
  const colIdx = (iu: number, iv: number, kv: number): number => {
    const idx: [number, number, number] = [0, 0, 0];
    idx[vAx] = kv; idx[u3] = iu; idx[v3] = iv;
    return idx[0] * stride[0] + idx[1] * stride[1] + idx[2] * stride[2];
  };
  const cols: Col[] = [];
  const W = dims[u3], H = dims[v3];
  for (let iu = 0; iu < W; iu++) {
    for (let iv = 0; iv < H; iv++) {
      // top-down: find the highest master surface on this column above the base
      let masterTop = -1;
      for (let kv = dims[vAx] - 1; kv >= kvMin; kv--) {
        if (data[colIdx(iu, iv, kv)] > 0.3) { masterTop = kv; break; }
      }
      if (masterTop < 0) continue;
      const masterTopMm = lo[vAx] + (masterTop + 0.5) * step;
      if (masterTopMm < opts.base + 2) continue;
      const pCoord = pIsU ? lo[pAx] + (iu + 0.5) * step : lo[pAx] + (iv + 0.5) * step;
      cols.push({
        iu, iv, masterTopMm, pCoord,
        u: lo[u3] + (iu + 0.5) * step,
        v: lo[v3] + (iv + 0.5) * step,
      });
    }
  }

  // one vent per half at its highest master point (an undercut peak), kept
  // clear of the tongue region at the parting plane
  const axisValue = (c: Col, a: number): number =>
    a === vAx ? c.masterTopMm : a === u3 ? c.u : c.v;
  const vents: PortSpec[] = [];
  for (const half of [1, -1] as const) {
    let best: Col | null = null;
    for (const c of cols) {
      if ((c.pCoord - opts.mid) * half < 3) continue; // own side, past the tongue
      if (!best || c.masterTopMm > best.masterTopMm) best = c;
    }
    if (!best) continue;
    const zMm = best.masterTopMm + opts.gap + 1;
    vents.push({
      u: best.u, v: best.v,
      uPull: axisValue({ ...best, masterTopMm: zMm }, uP),
      vPull: axisValue({ ...best, masterTopMm: zMm }, vP),
      zMm,
      pCoord: best.pCoord,
      masterTopMm: best.masterTopMm,
      boreR: 1.25,
    });
  }
  return { crown: null, vents, vAx, u3, v3 };
}
