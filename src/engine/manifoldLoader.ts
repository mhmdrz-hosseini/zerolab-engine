// Loads the pinned manifold-3d WASM kernel in Node (smoke tests) and in the
// browser worker (wasm copied to public/ by scripts/sync-wasm.mjs, instantiated
// with { wasmBinary } so bundler asset resolution can never break it).

export interface ManifoldStatus { code: number }
export interface ManifoldMesh {
  numProp: number;
  vertProperties: Float32Array;
  triVerts: Uint32Array;
  numTri: number;
}
export interface ManifoldInstance {
  slice(height: number): import('./split').CS;
  project(): import('./split').CS;
  decompose(): ManifoldInstance[];
  numTri(): number;
  /** JS binding returns the string enum "NoError" on success (older docs said numeric). */
  status(): number | string | { code?: number | string };
  simplify(tolerance: number): ManifoldInstance;
  getMesh(): ManifoldMesh;
  volume(): number;
  boundingBox(): { min: number[]; max: number[] };
  translate(x: number, y?: number, z?: number): ManifoldInstance;
  rotate(x?: number, y?: number, z?: number): ManifoldInstance;
  /** 4×4 affine, column-major: consecutive groups of 4 are the x/y/z image
   *  axes, then the translation (verified against the kernel: a basis-as-rows
   *  layout maps p' = n·x + u·y + t·z + T). */
  transform(m: number[]): ManifoldInstance;
  delete(): void;
  // boolean ops
  add(other: ManifoldInstance): ManifoldInstance;
  subtract(other: ManifoldInstance): ManifoldInstance;
  intersect(other: ManifoldInstance): ManifoldInstance;
  trimByPlane(normal: number[], originOffset: number): ManifoldInstance;
}
export interface ManifoldMod {
  Manifold: {
    new (mesh?: unknown): ManifoldInstance;
    levelSet(sdf: (p: number[]) => number, bounds: { min: number[]; max: number[] }, edgeLength: number, level?: number, tolerance?: number): ManifoldInstance;
    sphere(radius: number, segments?: number): ManifoldInstance;
    cube(size: number[], cornerRadius?: number): ManifoldInstance;
  };
  Mesh: new (o: { numProp: number; vertProperties: Float32Array; triVerts: Uint32Array }) => unknown;
  CrossSection?: unknown;
  setup?: () => void;
}

export function isStatusOk(inst: { status(): number | string | { code?: number | string } }): boolean {
  const st = inst.status();
  const v = typeof st === 'object' && st !== null ? st.code : st;
  return v === 'NoError' || v === 0 || v === 'Ok';
}

export async function loadManifold(): Promise<ManifoldMod> {
  const isNode = typeof process !== 'undefined' && !!(process as { versions?: { node?: string } }).versions?.node;
  const imported = (await import('manifold-3d')) as unknown as { default?: unknown };
  const factory = (imported.default ?? imported) as unknown as (opts?: { wasmBinary?: ArrayBuffer }) => Promise<ManifoldMod> | ManifoldMod;
  if (isNode) {
    const mod = await factory();
    mod.setup?.();
    return mod;
  }
  const res = await fetch('/manifold.wasm');
  if (!res.ok) throw new Error('public/manifold.wasm missing — run npm install (postinstall sync-wasm)');
  const wasmBinary = await res.arrayBuffer();
  const instance = await factory({ wasmBinary });
  instance.setup?.();
  return instance;
}
