// Sanity: selector measures on real batch inputs at native size.
import { readFileSync } from 'node:fs';
import { parseStlBinary } from '../src/engine/stl';
import { classifyMethods } from '../src/engine/moldMethod';
const files: [string, 'front_only' | 'all_sides'][] = [
  ['D:/code/3d/MOLD/MOLD-generator base/input/Montagem flat.stl', 'front_only'],
  ['D:/code/3d/MOLD/MOLD-generator base/input/obj_2_latern_cap.stl', 'front_only'],
  ['D:/code/3d/MOLD/MOLD-generator base/input/obj_1_Minimalist Giraffe figurine-2.stl', 'all_sides'],
  ['D:/code/3d/MOLD/MOLD-generator base/input/obj_1_Spiderman urban.stl', 'all_sides'],
  ['D:/code/3d/MOLD/MOLD-generator base/input/obj_1_sleepy_poodle.stl', 'front_only'],
];
for (const [f, surfaces] of files) {
  const ab = readFileSync(f).buffer.slice(0) as ArrayBuffer;
  const m = parseStlBinary(ab);
  const c = classifyMethods(m, { inputRole: 'positive_master', requiredSurfaces: surfaces });
  const t = c[0];
  console.log(`${f.split('/').pop()} [${surfaces}] → ${t.method} | coverage ${t.measures.backingCoverage} flatness ${t.measures.flatnessRatio} patch ${t.measures.backingPatchAreaMm2}`);
}
