import { isStatusOk, type ManifoldInstance, type ManifoldMod } from './manifoldLoader';
import type { MeshArrays } from './types';

/** Multi-body classification for intent suggestion: how many positive shells
 *  the source has, whether they form ONE connected cast when unioned
 *  (overlapping/touching shells) or several truly disjoint groups (each needs
 *  its own mold), and how much material truly OVERLAPS (inclusion–exclusion
 *  ΣVᵢ − V∪ — free with the union we already build). Policy: only genuine
 *  volumetric overlap suggests fusing; shells that merely TOUCH stay a
 *  review (the giraffe rule: an intentional separate shell resting on the
 *  body must not be silently merged). Interior void shells never count. */
export function shellConnectivity(mod: ManifoldMod, mesh: MeshArrays): {
  positiveShells: number;
  connectedGroups: number;
  overlapMm3: number;
  volumeSumMm3: number;
} {
  let man: ManifoldInstance | null = null;
  try {
    man = new mod.Manifold(new mod.Mesh({ numProp: 3, ...mesh }));
    if (!isStatusOk(man)) return { positiveShells: 0, connectedGroups: 0, overlapMm3: 0, volumeSumMm3: 0 };
    const shells = man.decompose();
    let positiveShells = 0;
    let volumeSum = 0;
    for (const s of shells) {
      const v = s.volume();
      if (v > 0.01) { positiveShells++; volumeSum += v; }
      s.delete();
    }
    if (positiveShells <= 1) return { positiveShells, connectedGroups: positiveShells, overlapMm3: 0, volumeSumMm3: volumeSum };
    const unioned = normalizePositiveShells(mod, mesh);
    try {
      const comps = unioned.solid.decompose();
      let connectedGroups = 0;
      for (const c of comps) {
        if (c.volume() > 0.01) connectedGroups++;
        c.delete();
      }
      const overlapMm3 = Math.max(0, volumeSum - unioned.solid.volume());
      return { positiveShells, connectedGroups, overlapMm3, volumeSumMm3: volumeSum };
    } finally {
      unioned.solid.delete();
    }
  } catch {
    return { positiveShells: 0, connectedGroups: 0, overlapMm3: 0, volumeSumMm3: 0 };
  } finally {
    man?.delete();
  }
}

/** Normalize overlapping positive mesh shells into their geometric union.
 * No dilation, bridging or vertex displacement is used. Disjoint positives
 * remain disjoint. Negative-volume void shells are retained as supplied,
 * rather than incorrectly treated as added material.
 */
export function normalizePositiveShells(mod: ManifoldMod, mesh: MeshArrays): {
  solid: ManifoldInstance; notes: string[];
} {
  const original = new mod.Manifold(new mod.Mesh({ numProp: 3, ...mesh }));
  if (!isStatusOk(original)) { original.delete(); throw new Error('input is not a kernel-valid solid'); }
  const components = original.decompose();
  const notes: string[] = [];
  let union: ManifoldInstance | null = null;
  try {
    if (components.some(c => c.volume() < -1e-9)) {
      return { solid: original, notes: ['Input contains inward void shells; preserved signed topology without positive-shell fusion.'] };
    }
    let positiveCount = 0;
    for (const component of components) {
      const volume = component.volume();
      if (Math.abs(volume) < 1e-9) {
        const bb=component.boundingBox();
        const span=Math.max(...bb.max.map((x,i)=>x-bb.min[i]));
        if (span > 0.01) throw new Error(`zero-volume component spans ${span.toFixed(4)} mm; input repair requires review`);
        notes.push(`Removed a zero-volume input artifact: span ${span.toFixed(6)} mm, signed volume ${volume.toExponential(3)} mm³; no positive material removed.`);
        continue;
      }
      // A copy is needed because decompose() instances are freed below.
      const next: ManifoldInstance = union ? union.add(component) : component.translate(0,0,0);
      union?.delete(); union=next; positiveCount++;
    }
    if (!union || !isStatusOk(union)) throw new Error('positive-shell union did not produce valid material');
    if (positiveCount > 1) notes.push(`Boolean-unioned ${positiveCount} positive input shells; overlapping material counted once, source exterior retained.`);
    // Eliminate sub-micron boolean slivers before the STL writer's 1 µm weld
    // can pinch them. Manifold bounds simplify displacement by this tolerance;
    // record it for downstream fidelity assessment, never hide it as exact.
    const toleranceMm = 0.0001;
    const regularized = union.simplify(toleranceMm);
    if (!isStatusOk(regularized)) { regularized.delete(); throw new Error('numerical solid regularization failed'); }
    union.delete(); union = regularized;
    notes.push(`Numerical shell regularization displacement bound ${toleranceMm} mm; protected-feature fidelity still requires final audit.`);
    original.delete();
    return { solid: union, notes };
  } catch (error) {
    union?.delete(); original.delete(); throw error;
  } finally {
    components.forEach(c=>c.delete());
  }
}
