// Shared domain types — see docs/SPEC-v0.1.md §3.
// MeshArrays is the single mesh currency between engine, worker, and viewer.

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
}

export interface GenerateResult {
  parts: Record<string, MeshArrays>;
  siliconeMl: number;
  outerDim: [number, number, number];
  params: GenerateParams;
  axis: Axis;
  elapsedMs: number;
  extraction: { A: number; B: number };  // free-travel mm at first clearance
  warnings: string[];
  checks: { name: string; pass: boolean; hard: boolean; detail: string }[];
  gatesPass: boolean;                    // all hard gates green — export allowed
  ports: { crown: { u: number; v: number } | null; vents: number };
}

// ---- worker protocol ----

export type WorkerRequest =
  | { type: 'ingest'; fileName: string; bytes: ArrayBuffer }
  | { type: 'generate'; params: GenerateParams }
  | { type: 'export' }
  | { type: 'cancel' };

export type WorkerResponse =
  | { type: 'progress'; stage: string; pct: number }
  | { type: 'analysis'; report: AnalysisReport; preview: MeshArrays }
  | { type: 'result'; result: GenerateResult }
  | { type: 'failure'; axis: Axis; trappedPct: number; message: string; nextAxis?: Axis; trapFlags?: Uint8Array }
  | { type: 'export'; blob: ArrayBuffer; fileName: string }
  | { type: 'error'; message: string };

export function trisOf(m: MeshArrays): number {
  return m.triVerts.length / 3;
}
