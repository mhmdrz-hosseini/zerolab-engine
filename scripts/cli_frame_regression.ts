import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadManifold } from '../src/engine/manifoldLoader';
import { instanceToMeshArrays } from '../src/engine/offset';
import { writeStlBinary } from '../src/engine/stl';

const repo = process.cwd();
const out = join(repo, 'scratch', 'cli-frame-regression');
mkdirSync(out, { recursive: true });
const input = join(out, 'flat_fixture.stl');
const mod = await loadManifold();
const fixture = mod.Manifold.cube([80, 50, 5]);
try { writeFileSync(input, Buffer.from(writeStlBinary(instanceToMeshArrays(fixture)))); }
finally { fixture.delete(); }
const run = spawnSync(process.execPath, [
  'node_modules/tsx/dist/cli.mjs', 'scripts/generate_mold.ts',
  '--input', input, '--vertical', 'Y', '--split', 'Z', '--out', out, '--no-zip',
], { cwd: repo, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
assert.equal(run.status, 0, `CLI generation failed:\n${run.stdout}\n${run.stderr}`);
const folder = readdirSync(out).find((name) => name.startsWith('pourbox_'));
assert.ok(folder, 'package folder is present');
const root = join(out, folder);
const project = JSON.parse(readFileSync(join(root, 'project.json'), 'utf8'));
const assembly = readFileSync(join(root, 'assembly.md'), 'utf8');
assert.equal(project.frame?.vert, 'Y', 'CLI must export the selected non-Z pour axis');
assert.match(assembly, /rotate \+90° about X/, 'print instructions must match the final geometry');
console.log('CLI FRAME REGRESSION PASS');
