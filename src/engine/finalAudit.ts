// Final-file audit (plan Task 3): every shipped STL is judged on its actual
// serialized BYTES, not the in-memory mesh. writeStlBinary → parseStlBinary is
// the exact float32 + 1 µm-weld reality a slicer receives; the kernel
// round-trip is the same reconstruction test the independent audit used to
// catch the unimportable angel export.
//
// Verdicts: 'invalid' blocks the package (export gate), 'suspect' ships with a
// recorded warning, 'valid' ships clean. Pinched edges (two closed sheets
// sharing an edge, 2-forward + 2-reverse winding) are CLASSIFIED here —
// twoManifold=false — but they downgrade to 'suspect', not 'invalid': the
// sheets are locally closed and slicer-safe, and forbidding them outright
// belongs to the construction fixes (plan Task 7), not to a byte-level gate.
import { parseStlBinary, writeStlBinary } from './stl';
import { auditMeshArrays } from './clean';
import { isStatusOk, type ManifoldMod } from './manifoldLoader';
import type { MeshArrays } from './types';

export interface FinalFileAudit {
  file: string;
  serializedBytes: number;
  parse: 'ok' | 'failed';
  roundTripKernelValid: boolean;
  closedSurface: boolean;         // zero boundary edges in the parsed bytes
  twoManifold: boolean;           // closed && no non-manifold && no pinched edges
  boundaryEdges: number;
  nonManifoldEdges: number;
  pinchedEdges: number;
  degenerateTris: number;         // degenerate faces SURVIVING in the parsed bytes
  components: number;
  nestedVoidShells: number;       // inward-wound (negative-volume) components
  netVolumeCm3: number;           // signed sum — hollow shells subtract
  kernelVolumeCm3: number | null;
  verdict: 'valid' | 'suspect' | 'invalid';
  reasons: string[];
}

export function auditSerializedStl(file: string, mesh: MeshArrays, mod?: ManifoldMod): FinalFileAudit {
  const bytes = writeStlBinary(mesh);
  const reasons: string[] = [];
  let parsed;
  try {
    parsed = parseStlBinary(bytes.slice(0));
  } catch {
    return {
      file, serializedBytes: bytes.byteLength, parse: 'failed', roundTripKernelValid: false,
      closedSurface: false, twoManifold: false, boundaryEdges: 0, nonManifoldEdges: 0,
      pinchedEdges: 0, degenerateTris: 0, components: 0, nestedVoidShells: 0,
      netVolumeCm3: 0, kernelVolumeCm3: null, verdict: 'invalid',
      reasons: ['the serialized STL could not be re-parsed'],
    };
  }
  const a = auditMeshArrays(parsed.vertProperties, parsed.triVerts);

  let roundTripKernelValid = false;
  let kernelVolumeCm3: number | null = null;
  if (mod) {
    try {
      const man = new mod.Manifold(new mod.Mesh({ numProp: 3, vertProperties: parsed.vertProperties, triVerts: parsed.triVerts }));
      roundTripKernelValid = isStatusOk(man);
      if (roundTripKernelValid) kernelVolumeCm3 = Number((Math.abs(man.volume()) / 1000).toFixed(1));
      man.delete();
    } catch {
      roundTripKernelValid = false;
    }
    if (!roundTripKernelValid) reasons.push('kernel cannot reconstruct a valid solid from the serialized bytes');
  }

  const closedSurface = a.boundaryEdges === 0;
  const twoManifold = closedSurface && a.nonManifoldEdges === 0 && a.pinchedEdges === 0;
  const nestedVoidShells = Math.max(0, a.components - positiveComponentCount(parsed));
  if (!closedSurface) reasons.push(`${a.boundaryEdges} boundary edge(s) in the serialized bytes`);
  if (a.nonManifoldEdges > 0) reasons.push(`${a.nonManifoldEdges} non-manifold edge(s) in the serialized bytes`);
  if (a.degenerateTris > 0) reasons.push(`${a.degenerateTris} degenerate face(s) survive serialization`);
  if (a.zeroVolumeComponents > 0) reasons.push(`${a.zeroVolumeComponents} zero-volume component(s) in the serialized bytes`);
  if (mod && !roundTripKernelValid) reasons.push('kernel cannot reconstruct a valid solid from the serialized bytes');

  const invalid = !closedSurface || a.nonManifoldEdges > 0 || a.degenerateTris > 0
    || a.zeroVolumeComponents > 0 || (mod ? !roundTripKernelValid : false);
  if (!invalid && a.pinchedEdges > 0) reasons.push(`${a.pinchedEdges} pinched edge(s) — closed but not two-manifold`);
  const verdict: FinalFileAudit['verdict'] = invalid ? 'invalid' : a.pinchedEdges > 0 ? 'suspect' : 'valid';
  if (verdict === 'valid') reasons.length = 0;

  return {
    file,
    serializedBytes: bytes.byteLength,
    parse: 'ok',
    roundTripKernelValid,
    closedSurface,
    twoManifold,
    boundaryEdges: a.boundaryEdges,
    nonManifoldEdges: a.nonManifoldEdges,
    pinchedEdges: a.pinchedEdges,
    degenerateTris: a.degenerateTris,
    components: a.components,
    nestedVoidShells,
    netVolumeCm3: a.volumeCm3,
    kernelVolumeCm3,
    verdict,
    reasons,
  };
}

/** Components whose accumulated signed volume is positive (real material). */
function positiveComponentCount(m: MeshArrays): number {
  const n = m.vertProperties.length / 3;
  const parent = new Int32Array(n).map((_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let t = 0; t < m.triVerts.length / 3; t++) {
    const a = find(m.triVerts[t * 3]), b = find(m.triVerts[t * 3 + 1]), c = find(m.triVerts[t * 3 + 2]);
    if (a !== b) parent[b] = a;
    if (a !== c) parent[c] = a;
  }
  const vol = new Map<number, number>();
  const vp = m.vertProperties, tv = m.triVerts;
  for (let t = 0; t < tv.length / 3; t++) {
    const [i, j, k] = [tv[t * 3], tv[t * 3 + 1], tv[t * 3 + 2]];
    const v = vp[i * 3] * (vp[j * 3 + 1] * vp[k * 3 + 2] - vp[j * 3 + 2] * vp[k * 3 + 1])
      + vp[i * 3 + 1] * (vp[j * 3 + 2] * vp[k * 3] - vp[j * 3] * vp[k * 3 + 2])
      + vp[i * 3 + 2] * (vp[j * 3] * vp[k * 3 + 1] - vp[j * 3 + 1] * vp[k * 3]);
    const r = find(i);
    vol.set(r, (vol.get(r) ?? 0) + v / 6);
  }
  let positives = 0;
  for (const v of vol.values()) if (v > 1e-6) positives++;
  return positives;
}
