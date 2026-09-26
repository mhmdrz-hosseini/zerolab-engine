// Print-package builder — SPEC §4-I: STL set + project.json + assembly.md, zipped.
import { zipSync, type Zippable } from 'fflate';
import { writeStlBinary } from './stl';
import type { GenerateParams, MeshArrays } from './types';

export interface PackageInfo {
  name: string;
  createdAt: string;
  params: GenerateParams;
  axis: string;
  siliconeMl: number;
  extraction: { A: number; B: number };
  jacketDim: number[];
  plateDim: number[];
  warnings: string[];
  checks: { name: string; pass: boolean; detail: string }[];
  crown: { u: number; v: number } | null;
  ventCount: number;
}

export interface PrintFiles {
  files: Record<string, Uint8Array>;
  zip: Uint8Array;
  fileName: string;
}

export function buildPrintFiles(deps: {
  master?: MeshArrays;      // bare doll (legacy callers); unused when masterBase is given
  masterBase?: MeshArrays;  // doll + fused plate (V0.2)
  parts: Record<string, MeshArrays>;
  info: PackageInfo;
}): PrintFiles {
  const { master, masterBase, parts, info } = deps;
  const masterMesh = masterBase ?? master;
  if (!masterMesh) throw new Error('buildPrintFiles: no master mesh provided');
  const safe = (info.name || 'model').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 40) || 'model';
  const root = `pourbox_${safe}`;
  const stl = (m: MeshArrays) => new Uint8Array(writeStlBinary(m));

  const partDefs = [
    { name: 'master base', file: '01_master/master_base.stl', mesh: masterMesh, note: 'doll + fused base plate — print plate-down as one piece' },
    { name: 'jacket A', file: '02_jacket/jacket_A.stl', mesh: parts.jacketA, note: 'print rim-down; tongue side is the mating face' },
    { name: 'jacket B', file: '02_jacket/jacket_B.stl', mesh: parts.jacketB, note: 'print rim-down; groove side is the mating face' },
    { name: 'silicone skin preview', file: '03_preview/silicone_skin.stl', mesh: parts.siliconeSkin, note: 'NOT printed — this is the mold the silicone will become' },
  ];
  const partMeta = partDefs.map((p) => ({
    name: p.name,
    file: p.file,
    note: p.note,
    triangles: p.mesh.triVerts.length / 3,
  }));

  const project = {
    format: 'matrix-mold-pourbox/0.3',
    name: info.name,
    createdAt: info.createdAt,
    params: info.params,
    splitAxis: info.axis,
    siliconeMl: Number(info.siliconeMl.toFixed(1)),
    recommendedPrep: Number((info.siliconeMl * 1.1).toFixed(1)),
    extraction: info.extraction,
    jacketOuterMm: info.jacketDim.map((d) => Number(d.toFixed(1))),
    basePlateMm: info.plateDim.map((d) => Number(d.toFixed(1))),
    ports: { crown: null as null, ventCount: info.ventCount },
    hardware: ['6–10 binder clips (25–32 mm), gripping the flat external seam rails'],
    validation: info.checks,
    warnings: info.warnings,
    parts: partMeta,
  };

  const assembly = `# Pour Box Assembly — ${info.name}

Split axis: **±${info.axis}** · Silicone needed: **≈ ${info.siliconeMl.toFixed(0)} mL** (prepare ${(info.siliconeMl * 1.1).toFixed(0)} mL)

## Hardware
- 6–10 binder clips sized to the 5 mm seam rail stack; removable seam/base sealant

## Steps
1. Print \`master_base\` (doll + fused base plate, plate-down), \`jacket_A\` and \`jacket_B\` (rim-down).
2. Bring **jacket B** in from its side; seat its rim on the base plate.
3. Fit **jacket A** so its tongue enters B's groove; the rims register against the plate edge.
4. Clamp the flat external seam rails, evenly spaced. Seal the base and parting seams; printed joints are not liquid-tight by themselves. Seal any optional wall outlets before filling.
5. Pour RTV silicone slowly through the **open crown** until it reaches the brim.
6. Cure fully, remove clips and sealant, slide jacket A along +${info.axis} and B along -${info.axis}.
7. Demold the master from the cured silicone. Deep undercuts or enclosed handles may need a planned cut in the silicone; rigid jacket release does not prove master release.

## Parts
${partMeta.map((p) => `- **${p.name}** — \`${p.file}\` (${p.triangles.toLocaleString()} tris) — ${p.note}`).join('\n')}

${info.warnings.length ? `## Warnings\n${info.warnings.map((w) => `- ⚠ ${w}`).join('\n')}` : ''}
`;

  const files: Record<string, Uint8Array> = {
    [`${root}/01_master/master_base.stl`]: stl(masterMesh),
    [`${root}/02_jacket/jacket_A.stl`]: stl(parts.jacketA),
    [`${root}/02_jacket/jacket_B.stl`]: stl(parts.jacketB),
    [`${root}/03_preview/silicone_skin.stl`]: stl(parts.siliconeSkin),
    [`${root}/project.json`]: new TextEncoder().encode(JSON.stringify(project, null, 2)),
    [`${root}/assembly.md`]: new TextEncoder().encode(assembly),
  };
  const zip = zipSync(files as Zippable, { level: 1 });
  return { files, zip, fileName: `${root}.zip` };
}
