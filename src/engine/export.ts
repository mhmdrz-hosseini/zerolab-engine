// Print-package builder — SPEC §4-I: STL set + project.json + assembly.md, zipped.
// Every part passes through cleanExportMesh and the export mesh gate (hard):
// watertight, zero degenerate faces, zero zero-volume components — a slicer
// must never have to repair this platform's output.
import { zipSync, type Zippable } from 'fflate';
import { writeStlBinary } from './stl';
import { cleanExportMesh, type MeshAudit } from './clean';
import type { FasteningInfo, GenerateParams, MeshArrays } from './types';
import type { PrintabilityReport } from './printability';

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
  fastening?: FasteningInfo;
  zeroClip?: MeshArrays | null; // seated ZeroClip geometry — exported once, printed N×
  baseLockA?: MeshArrays | null;
  baseLockB?: MeshArrays | null;
  baseLockClip?: MeshArrays | null;
  baseLockClips?: number;
  clearanceBand?: { requestedGap: number; min: number; p10: number; p50: number; p90: number; withinBand: boolean };
  printability?: Record<string, PrintabilityReport>;
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

  // 3-piece packages swap jacket_B for the two sub-panels
  const is3 = !!(parts.jacketB1 && parts.jacketB2);
  const jacketDefs = is3
    ? [
      { name: 'jacket A', file: '02_jacket/jacket_A.stl', mesh: parts.jacketA, note: 'print rim-down; tongue side is the mating face' },
      { name: 'jacket B1', file: '02_jacket/jacket_B1.stl', mesh: parts.jacketB1!, note: 'print rim-down; slides +depth after A is off' },
      { name: 'jacket B2', file: '02_jacket/jacket_B2.stl', mesh: parts.jacketB2!, note: 'print rim-down; slides −depth after A is off' },
    ]
    : [
      { name: 'jacket A', file: '02_jacket/jacket_A.stl', mesh: parts.jacketA, note: 'print rim-down; tongue side is the mating face' },
      { name: 'jacket B', file: '02_jacket/jacket_B.stl', mesh: parts.jacketB, note: 'print rim-down; groove side is the mating face' },
    ];
  const partDefs = [
    { name: 'master base', file: '01_master/master_base.stl', mesh: masterMesh, note: 'doll + fused base plate — print plate-down as one piece' },
    ...jacketDefs,
    { name: 'silicone skin preview', file: '03_preview/silicone_skin.stl', mesh: parts.siliconeSkin, note: 'NOT printed — this is the mold the silicone will become' },
    ...(info.zeroClip ? [{
      name: `zero clip ×${info.fastening?.clipCount ?? '?'}`, file: '04_hardware/zero_clip.stl', mesh: info.zeroClip,
      note: 'print N of these in PETG, flat on the bed as exported — spring onto the rail stations; never use supports',
    }] : []),
    ...(info.baseLockA && info.baseLockB ? [
      { name: 'base lock A', file: '04_hardware/base_lock_A.stl', mesh: info.baseLockA, note: 'collar half (+pull) — print top-ring-down as exported, PETG for reuse' },
      { name: 'base lock B', file: '04_hardware/base_lock_B.stl', mesh: info.baseLockB, note: 'collar half (−pull) — slides in from the opposite side' },
      ...(info.baseLockClip ? [{
        name: `base lock clip ×${info.baseLockClips ?? 2}`, file: '04_hardware/base_lock_clip.stl', mesh: info.baseLockClip,
        note: 'mini clip tying the collar halves across the seam — print one per ear',
      }] : []),
    ] : []),
  ];

  // export mesh gate (hard): clean every part, then require a watertight,
  // degenerate-free result before anything is written
  const meshAudit: Record<string, MeshAudit & { droppedTris: number; mergedVerts: number }> = {};
  const gateFailures: string[] = [];
  for (const p of partDefs) {
    const cleaned = cleanExportMesh(p.mesh);
    p.mesh = cleaned.mesh;
    meshAudit[p.file] = { ...cleaned.audit, droppedTris: cleaned.stats.droppedTris, mergedVerts: cleaned.stats.mergedVerts };
    const a = cleaned.audit;
    if (!a.watertight) gateFailures.push(`${p.file}: not watertight (boundary ${a.boundaryEdges}, non-manifold ${a.nonManifoldEdges})`);
    if (a.degenerateTris > 0) gateFailures.push(`${p.file}: ${a.degenerateTris} degenerate face(s) survived cleanup`);
    if (a.zeroVolumeComponents > 0) gateFailures.push(`${p.file}: ${a.zeroVolumeComponents} zero-volume component(s) survived cleanup`);
  }
  if (gateFailures.length > 0) {
    throw new Error(`Export mesh gate failed — package NOT written. ${gateFailures.join(' · ')}`);
  }

  const partMeta = partDefs.map((p) => ({
    name: p.name,
    file: p.file,
    note: p.note,
    triangles: p.mesh.triVerts.length / 3,
    volumeCm3: meshAudit[p.file]?.volumeCm3,
  }));

  const materialNote = info.params.material === 'hotWax'
    ? `- **Casting material: hot wax (jacket stays on while pouring)** — print the jackets in **PETG/ASA/ABS**; common wax pours (57–79 °C) exceed PLA's ~55 °C heat-deflection point. The master can stay PLA.`
    : info.params.material === 'silicone'
      ? `- **Casting material: room-temperature RTV silicone** — **PLA is fine** for every part (the liquid pressure on these walls is ~0.25 psi).`
      : `- **Pouring RTV silicone only → PLA is fine.** **Pouring hot candle wax while the jacket stays on → use PETG/ASA/ABS** (wax pours at 57–79 °C, above PLA's ~55 °C heat-deflection point).`;

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
    clearanceBand: info.clearanceBand,
    printability: info.printability,
    castingMaterial: info.params.material ?? null,
    hardware: ['6–10 binder clips (25–32 mm), gripping the flat external seam rails'],
    fastening: info.fastening ? {
      mode: info.fastening.mode,
      clipCount: info.fastening.clipCount,
      clipMaterial: 'PETG',
      binderClipCompatible: true,
      usableRailMm: info.fastening.usableRailMm,
      pitchMm: info.fastening.pitchMm,
      stations: info.fastening.stations,
      warning: info.fastening.warning ?? null,
    } : null,
    baseLock: info.baseLockA && info.baseLockB ? { enabled: true, parts: 2, clips: info.baseLockClips ?? 2 } : null,
    validation: info.checks,
    meshAudit,
    warnings: info.warnings,
    parts: partMeta,
  };

  const assembly = `# Pour Box Assembly — ${info.name}

Split axis: **±${info.axis}** · Silicone needed: **≈ ${info.siliconeMl.toFixed(0)} mL** (prepare ${(info.siliconeMl * 1.1).toFixed(0)} mL)

## Hardware
${info.fastening && info.fastening.stations.length > 0
    ? (info.zeroClip
      ? `- Fastening: **${info.fastening.mode}** — print **${info.fastening.clipCount} ZeroClips** (\`04_hardware/zero_clip.stl\`, PETG, flat on the bed) and spring one onto each station of the external seam rail${info.fastening.mode === 'hybrid' ? '; binder clips may fill any gap between stations' : ''}. Station coordinates ship in \`project.json → fastening.stations\`.`
      : `- Clip plan: **${info.fastening.stations.length} clamp stations** evenly spaced on the external seam rail (usable rail ≈ ${info.fastening.usableRailMm.toFixed(0)} mm, spacing ≈ ${info.fastening.pitchMm.toFixed(0)} mm) — one 25–32 mm binder clip per station, flat land against the rail. Station coordinates ship in \`project.json → fastening.stations\`.`)
    : '- 6–10 binder clips sized to the 5 mm seam rail stack; removable seam/base sealant'}
- Removable seam/base sealant${info.fastening?.warning ? `\n- ⚠ ${info.fastening.warning}` : ''}
${info.baseLockA && info.baseLockB ? `- **BaseLock**: after seating the jackets, slide collar half **A** and half **B** in from opposite ±${info.axis} sides under the plate edge, then close each ear with a mini clip. **Remove the collar and clips before extracting the jackets.**` : ''}

## Material & print profiles
${materialNote}
- Per-part slicer settings ship in \`print_profile.json\` — the **master** wants quality (0.12–0.16 mm layers; the silicone reproduces its surface), the **jackets** want speed/structure (0.6 mm nozzle OK).

## Steps
1. Print \`master_base\` (doll + fused base plate, plate-down), ${is3 ? '`jacket_A`, `jacket_B1` and `jacket_B2`' : '`jacket_A` and `jacket_B`'} (rim-down).
2. ${is3
    ? 'Join **jacket B1** and **jacket B2** on the base plate — their sub-joint registers sideways; seat both rims.'
    : 'Bring **jacket B** in from its side; seat its rim on the base plate.'}
3. Fit **jacket A** so its tongue enters ${is3 ? "the B1/B2 groove" : "B's groove"}; the rims register against the plate edge.
4. Clamp the flat external seam rails, evenly spaced. Seal the base and parting seams; printed joints are not liquid-tight by themselves. Seal any optional wall outlets before filling.
5. Pour RTV silicone slowly through the **open crown** until it reaches the brim.
6. Cure fully, remove clips and sealant, ${is3
    ? `slide jacket A along +${info.axis}, then B1/B2 sideways (±depth) one at a time.`
    : `slide jacket A along +${info.axis} and B along -${info.axis}.`}
7. Demold the master from the cured silicone. Deep undercuts or enclosed handles may need a planned cut in the silicone; rigid jacket release does not prove master release.

## Parts
${partMeta.map((p) => `- **${p.name}** — \`${p.file}\` (${p.triangles.toLocaleString()} tris${p.volumeCm3 ? `, ${p.volumeCm3} cm³` : ''}) — ${p.note}`).join('\n')}

${info.printability ? `## Support forecast (coarse 45° layer analysis)\n${Object.entries(info.printability).map(([name, r]) => {
  const islands = r.unsupportedIslands?.length ?? 0;
  const risk = r.islandRisk === 'HIGH' ? ' — ⚠ unsupported island > 15 mm² (hard-fail candidate)' : islands ? ` — ${islands} unsupported island(s) ≥ 4 mm²` : '';
  const brim = r.brimMm ? ` · brim ${r.brimMm} mm (${r.bedRisk.toLowerCase()} bed risk, slenderness ${r.slenderness})` : ' · no brim needed';
  return `- **${name}**: bed contact ≈ ${r.bedAreaMm2} mm² · unsupported growth ≈ ${r.overhangAreaMm2} mm²${r.worstBands.length ? ` — paint supports around the ${r.worstBands.slice(0, 2).map((b) => `${b.areaMm2} mm² band at z ${b.zLo}–${b.zHi}`).join(' and ')}` : ''}${risk}${brim}`;
}).join('\n')}\n` : ''}
${info.warnings.length ? `## Warnings\n${info.warnings.map((w) => `- ⚠ ${w}`).join('\n')}` : ''}
`;

  const brimFor = (part: string): string => {
    const r = info.printability?.[part];
    if (!r) return 'optional';
    return r.brimMm
      ? `${r.brimMm} mm recommended (bed risk ${r.bedRisk.toLowerCase()}, slenderness ${r.slenderness})`
      : 'none needed (bed risk low)';
  };

  const printProfile = {
    format: 'matrix-mold-print-profiles/0.3',
    note: 'Per-part slicer settings. The master and the jackets have different quality requirements: the silicone reproduces the master\'s surface finish, the jacket only provides stiffness.',
    material: {
      choice: info.params.material ?? null,
      silicone_making_only: 'PLA is fine — room-temperature RTV pour, ~0.25 psi hydrostatic pressure at these heights.',
      hot_wax_with_jacket_on: 'PETG / ASA / ABS for the jackets — common wax pour temperatures (57–79 °C) exceed PLA\'s ~55 °C heat-deflection temperature.',
      resin_master_option: 'For the best surface fidelity, print the master in resin and the jackets on FDM.',
    },
    profiles: {
      master_base: {
        orientation: 'plate-down, as exported — never flip it',
        nozzle_mm: 0.4,
        layer_height_mm: [0.12, 0.16],
        perimeters: 3,
        infill_percent: [10, 15],
        infill_pattern: 'gyroid',
        top_bottom_solid_layers: 5,
        support: 'organic/tree where needed, support interface enabled',
        support_interface_layers: 3,
        seam: 'rear / least-visible surface — RTV silicone reproduces layer lines and seam scars',
        elephant_foot_compensation_mm: 0.2,
        warning: 'Silicone reproduces support-contact scars.',
        post_process: 'sand/fill if a smooth cast surface is wanted → seal (e.g. Smooth-On print coating) → release agent → pour silicone',
      },
      jacket_A: {
        orientation: 'rim-down, as exported — never seam-down',
        nozzle_mm: 0.4,
        layer_height_mm: [0.2, 0.24],
        fast_alt: { nozzle_mm: 0.6, layer_height_mm: [0.28, 0.32] },
        perimeters: '3 (4 for heavy reuse)',
        infill_percent: [10, 15],
        infill_pattern: 'gyroid',
        support: '~55° threshold, painted where necessary',
        brim: brimFor('jacket_A'),
        seam: 'rear / away from the mating rail',
        elephant_foot_compensation_mm: 0.2,
      },
      jacket_B: {
        orientation: 'rim-down, as exported — never seam-down',
        nozzle_mm: 0.4,
        layer_height_mm: [0.2, 0.24],
        fast_alt: { nozzle_mm: 0.6, layer_height_mm: [0.28, 0.32] },
        perimeters: '3 (4 for heavy reuse)',
        infill_percent: [10, 15],
        infill_pattern: 'gyroid',
        support: '~55° threshold, painted where necessary',
        brim: brimFor('jacket_B'),
        seam: 'rear / away from the mating rail',
        elephant_foot_compensation_mm: 0.2,
      },
      silicone_skin: {
        print: false,
        note: 'DO NOT PRINT — this STL is the visualization of the silicone the cavity will become.',
      },
      ...(info.zeroClip ? {
        zero_clip: {
          orientation: 'flat on the bed, as exported — never stand it up',
          material: 'PETG (PLA only as a prototype — repeated flexing fatigues PLA)',
          nozzle_mm: 0.4,
          layer_height_mm: 0.2,
          perimeters: '4–5',
          infill_percent: 100,
          support: 'none — the profile is support-free flat; supports would ruin the spring',
          quantity: info.fastening?.clipCount ?? null,
          fit_note: 'jaws grip the 5 mm rail stack with 0.3 mm total interference — if seating is impossible or slack, recalibrate via the fit coupon',
        },
      } : {}),
      ...(info.baseLockA && info.baseLockB ? {
        base_lock_A: {
          orientation: 'top-ring-down, as exported — the flat cap ring is the bed face',
          material: 'PETG',
          nozzle_mm: 0.4,
          layer_height_mm: 0.2,
          perimeters: 4,
          infill_percent: [25, 40],
          support: 'none — all faces are vertical walls or horizontal beds',
          note: 'captures the jacket rim to the plate (0.6 mm capture travel); slide on after seating the jackets',
        },
        base_lock_B: {
          orientation: 'top-ring-down, as exported — the flat cap ring is the bed face',
          material: 'PETG',
          nozzle_mm: 0.4,
          layer_height_mm: 0.2,
          perimeters: 4,
          infill_percent: [25, 40],
          support: 'none — all faces are vertical walls or horizontal beds',
          note: 'mirror of base_lock_A — slides in from the opposite side; remove both before jacket extraction',
        },
        ...(info.baseLockClip ? {
          base_lock_clip: {
            orientation: 'flat on the bed, as exported',
            material: 'PETG',
            nozzle_mm: 0.4,
            layer_height_mm: 0.2,
            perimeters: '4–5',
            infill_percent: 100,
            support: 'none',
            quantity: info.baseLockClips ?? 2,
          },
        } : {}),
      } : {}),
    },
  };

  const files: Record<string, Uint8Array> = {};
  for (const p of partDefs) files[`${root}/${p.file}`] = stl(p.mesh); // post-cleanup meshes
  files[`${root}/project.json`] = new TextEncoder().encode(JSON.stringify(project, null, 2));
  files[`${root}/assembly.md`] = new TextEncoder().encode(assembly);
  files[`${root}/print_profile.json`] = new TextEncoder().encode(JSON.stringify(printProfile, null, 2));
  const zip = zipSync(files as Zippable, { level: 1 });
  return { files, zip, fileName: `${root}.zip` };
}
