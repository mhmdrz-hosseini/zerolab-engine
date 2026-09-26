// Binary glTF (GLB) intake — the AI-pipeline's primary format. Supports the
// standard subset that image-to-3D services emit: triangle primitives, node
// hierarchies with matrix or TRS transforms, float32 positions, u8/u16/u32
// indices, embedded BIN chunk (plus data: URIs). Draco compression and sparse
// accessors are rejected with actionable errors.
import type { MeshArrays } from './types';

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

const COMP_SIZE: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const NUM_COMP: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

export interface ParsedGlb { mesh: MeshArrays; warnings: string[] }

export function parseGlb(bytes: ArrayBuffer): ParsedGlb {
  const warnings: string[] = [];
  const dv = new DataView(bytes);
  if (bytes.byteLength < 20 || dv.getUint32(0, true) !== GLB_MAGIC) throw new Error('Not a GLB file (bad magic)');
  if (dv.getUint32(4, true) !== 2) throw new Error('Only glTF 2.0 GLB is supported');

  let pos = 12;
  let json: any = null;
  let bin: Uint8Array | null = null;
  while (pos + 8 <= bytes.byteLength) {
    const len = dv.getUint32(pos, true);
    const type = dv.getUint32(pos + 4, true);
    const body = bytes.slice(pos + 8, pos + 8 + len);
    if (type === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(body));
    else if (type === CHUNK_BIN) bin = new Uint8Array(body);
    pos += 8 + len + ((4 - (len % 4)) % 4);
  }
  if (!json) throw new Error('GLB has no JSON chunk');
  if (json.extensionsRequired?.includes('KHR_draco_mesh_compression')) {
    throw new Error('Draco-compressed GLB — export uncompressed geometry (molds need the raw mesh)');
  }
  if (json.extensionsRequired?.includes('KHR_mesh_quantization')) {
    warnings.push('quantized accessor extension present — decoding best-effort');
  }

  const binFromDataUri = (uri: string): Uint8Array => {
    if (!uri.startsWith('data:')) throw new Error('GLB references external buffers — export a self-contained GLB');
    const b64 = uri.slice(uri.indexOf(',') + 1);
    const raw = atob(b64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  };
  const buffers: Uint8Array[] = (json.buffers ?? []).map((b: any) =>
    b.uri ? binFromDataUri(b.uri) : bin ?? (() => { throw new Error('GLB has no BIN chunk'); })(),
  );

  const readAccessor = (accIdx: number): { data: TypedArrayish; count: number; numComp: number } => {
    const acc = json.accessors[accIdx];
    if (acc.sparse) throw new Error('sparse accessors are not supported — export a dense mesh');
    const numComp = NUM_COMP[acc.type];
    const compSize = COMP_SIZE[acc.componentType];
    if (!numComp || !compSize) throw new Error(`unsupported accessor type ${acc.type}/${acc.componentType}`);
    const bv = json.bufferViews[acc.bufferView] ?? {};
    const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const stride = bv.byteStride ?? numComp * compSize;
    const buf = buffers[bv.buffer ?? 0];
    const count = acc.count;
    const out = new Float32Array(count * numComp);
    const dvv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < numComp; c++) {
        const at = base + i * stride + c * compSize;
        if (acc.componentType === 5126) out[i * numComp + c] = dvv.getFloat32(at, true);
        else if (acc.componentType === 5125) out[i * numComp + c] = dvv.getUint32(at, true);
        else if (acc.componentType === 5123) out[i * numComp + c] = dvv.getUint16(at, true);
        else if (acc.componentType === 5122) out[i * numComp + c] = dvv.getInt16(at, true);
        else if (acc.componentType === 5121) out[i * numComp + c] = dvv.getUint8(at);
        else out[i * numComp + c] = dvv.getInt8(at);
      }
    }
    return { data: out, count, numComp };
  };

  const readIndices = (accIdx: number): Uint32Array => {
    const { data, count } = readAccessor(accIdx);
    const out = new Uint32Array(count);
    for (let i = 0; i < count; i++) out[i] = data[i];
    return out;
  };

  // column-major 4x4 helpers
  const mul = (a: Float64Array, b: Float64Array): Float64Array => {
    const o = new Float64Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  };
  const fromTRS = (n: any): Float64Array => {
    if (n.matrix) return Float64Array.from(n.matrix as number[]);
    const t = n.translation ?? [0, 0, 0];
    const s = n.scale ?? [1, 1, 1];
    const q = n.rotation ?? [0, 0, 0, 1];
    const [x, y, z, w] = q;
    const r = [
      1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
      2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
      2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y),
    ];
    return new Float64Array([
      r[0] * s[0], r[3] * s[0], r[6] * s[0], 0,
      r[1] * s[1], r[4] * s[1], r[7] * s[1], 0,
      r[2] * s[2], r[5] * s[2], r[8] * s[2], 0,
      t[0], t[1], t[2], 1,
    ]);
  };
  const I = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

  const outVp: number[] = [];
  const outTv: number[] = [];
  let warnedPrims = 0;

  const visit = (nodeIdx: number, parent: Float64Array): void => {
    const node = json.nodes[nodeIdx];
    if (!node) return;
    const world = mul(parent, fromTRS(node));
    if (node.mesh !== undefined) {
      for (const prim of json.meshes[node.mesh].primitives ?? []) {
        if (prim.mode !== undefined && prim.mode !== 4) { warnedPrims++; continue; }
        if (prim.attributes?.POSITION === undefined || prim.indices === undefined) { warnedPrims++; continue; }
        const pos = readAccessor(prim.attributes.POSITION);
        const idx = readIndices(prim.indices);
        const vBase = outVp.length / 3;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.data[i * 3], y = pos.data[i * 3 + 1], z = pos.data[i * 3 + 2];
          outVp.push(
            world[0] * x + world[4] * y + world[8] * z + world[12],
            world[1] * x + world[5] * y + world[9] * z + world[13],
            world[2] * x + world[6] * y + world[10] * z + world[14],
          );
        }
        for (let i = 0; i < idx.length; i++) outTv.push(vBase + idx[i]);
      }
    }
    for (const c of node.children ?? []) visit(c, world);
  };

  const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? json.nodes?.map((_: unknown, i: number) => i) ?? [];
  for (const n of roots) visit(n, I);
  if (warnedPrims > 0) warnings.push(`${warnedPrims} non-triangle primitives skipped`);
  if (outVp.length === 0) throw new Error('GLB contains no triangle geometry');

  return { mesh: { vertProperties: new Float32Array(outVp), triVerts: new Uint32Array(outTv) }, warnings };
}

type TypedArrayish = Float32Array;
