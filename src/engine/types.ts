// Shared domain types — see docs/SPEC-v0.1.md §3.
// MeshArrays is the single mesh currency between engine, worker, and viewer.
import type { PrintabilityReport } from './printability';

export interface MeshArrays {
  vertProperties: Float32Array; // xyz per vertex (numProp = 3)
  triVerts: Uint32Array;        // 3 indices per triangle
}

export type Axis = 'X' | 'Y' | 'Z';
export const AXES: Axis[] = ['X', 'Y', 'Z'];

export interface AxisPull {
  axis: Axis;
  rays: number;
  trappedPct: number;   // % of rays with >2 surface crossings
  avgCrossings: number; // over intersecting rays only
  maxCrossings: number;
}

export interface BBox {
  min: [number, number, number];
  max: [number, number, number];
  dim: [number, number, number];
}

export interface AnalysisReport {
  fileName: string;
  triCount: number;       // full-res master
  vertCount: number;      // welded unique vertices
  bbox: BBox;             // mm, model units interpreted as mm
  volumeMl: number;       // signed volume of the master
  watertight: boolean;
  boundaryEdges: number;
  nonManifoldEdges: number;
  orientationIssues: number;
  axes: AxisPull[];       // ranked: best first
  bestAxis: Axis;
  analysisTris: number;   // decimated analysis mesh
  warnings: string[];
  needsSizeConfirm?: boolean; // true when units/size were auto-normalized — user must confirm before printing
}

export interface GenerateParams {
  gap: number;      // silicone gap G (mm)
  wall: number;     // jacket wall W (mm)
  clearance: number; // joint clearance (mm)
  verticalAxis?: Axis; // explicit pour axis (default: stable-base auto pick)
  splitAxis?: Axis;    // explicit pull axis (default: ranked auto ladder)
  gapWindow?: number;  // envelope pull-clearance window (mm); default = gap
                       // (V0.3 behavior). Smaller = tighter hug, less silicone.
  ribs?: boolean;      // external stiffening ribs (8 mm fins) on the jacket body
  material?: 'silicone' | 'hotWax'; // casting material — drives the material
                       // guidance (PLA fine for room-temp RTV; PETG/ASA for hot wax)
  panels?: 2 | 3;      // 3 = multi-panel jacket (heavy half sub-split ±depth)
  clampMode?: 'binder' | 'printed' | 'hybrid'; // seam fastening: binder clips
                       // (default, legacy), printed ZeroClips on the rail
                       // stations, or printed at stations + binder as filler
  baseLock?: boolean;  // optional two-piece collar capturing the jacket rim to
                       // the base plate (experimental; fail-soft)
  masterScale?: number; // uniform rescale of the as-ingested master before
                       // generation (size-confirm UI); 1 = untouched. gap/wall
                       // stay absolute mm — geometry regenerates at the target
                       // size so volumes, gates and exports stay consistent.
}

// V0.5 manufacturing-reliability layer: clip placement on the frozen seam rail.
export interface ClampStation {
  position: [number, number, number]; // clip landing center on the rail's outer face, parting plane
  normal: [number, number, number];   // outward rail-face normal at the station (unit)
  bulgeMm: number;                    // max outward deviation of the rail's outer edge from the
                                      // tangent line within the clip window (curvature + ratchet steps)
  clipWidthMm?: number;               // straight-run width for this station (≤ the prototype 18 mm) —
                                      // a flat clip wider than the local straight run loses jaw contact;
                                      // omitted = full prototype width (straight coupon/ear stubs)
  railThickness: number;              // measured radial width of the rail band here (mm)
  index: number;
}

export interface FasteningInfo {
  mode: 'binder' | 'printed' | 'hybrid';
  clipCount: number;
  usableRailMm: number;
  pitchMm: number;
  stations: ClampStation[];
  warning?: string;
}

export interface GenerateResult {
  parts: Record<string, MeshArrays>;
  siliconeMl: number;
  outerDim: [number, number, number];
  params: GenerateParams;
  axis: Axis;
  elapsedMs: number;
  extraction: { A: number; B: number; B1?: number; B2?: number };  // free-travel mm at first clearance
  panels?: 2 | 3;                        // jacket piece count (3 = multi-panel)
  warnings: string[];
  checks: { name: string; pass: boolean; hard: boolean; detail: string }[];
  gatesPass: boolean;                    // all hard gates green — export allowed
  ports: { crown: { u: number; v: number } | null; vents: number };
  clearanceBand?: { requestedGap: number; min: number; p10: number; p50: number; p90: number; withinBand: boolean };
  fastening?: FasteningInfo;
  printability?: Record<string, PrintabilityReport>;
  masterScale?: number;                     // echo of params.masterScale
  partVolumesCm3?: Record<string, number>;  // printed-part volumes for mass estimates
}

// ---- worker protocol ----

export type WorkerRequest =
  | { type: 'ingest'; fileName: string; bytes: ArrayBuffer }
  | { type: 'generate'; params: GenerateParams }
  | { type: 'export' }
  | { type: 'coupon' }
  | { type: 'cancel' };

export type WorkerResponse =
  | { type: 'progress'; stage: string; pct: number }
  | { type: 'analysis'; report: AnalysisReport; preview: MeshArrays }
  | { type: 'result'; result: GenerateResult }
  | { type: 'failure'; axis: Axis; trappedPct: number; message: string; nextAxis?: Axis; trapFlags?: Uint8Array }
  | { type: 'export'; blob: ArrayBuffer; fileName: string }
  | { type: 'coupon'; blob: ArrayBuffer; fileName: string; notes: string[] }
  | { type: 'error'; message: string };

export function trisOf(m: MeshArrays): number {
  return m.triVerts.length / 3;
}
