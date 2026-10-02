import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
for(const file of ['obj_1_Körper.stl','obj_1_Minimalist Giraffe figurine-2.stl']){
 test(`automatic full-3D molding keeps ${file} on its natural Z base`,()=>{
  const output=mkdtempSync(join(tmpdir(),'mold-v3-figure-'));
  const cli=join(process.cwd(),'node_modules','tsx','dist','cli.mjs');
  const p=spawnSync(process.execPath,[cli,'scripts/generate_mold.ts','--input',
    `D:/code/3d/MOLD/MOLD-generator base/input/${file}`,'--size','50',
    '--role','positive_master','--cast','all_sides','--out',output,'--no-zip'],
    {cwd:process.cwd(),encoding:'utf8',timeout:120000});
  assert.equal(p.status,0,`${p.stderr}\n${p.stdout?.slice(-1500)}`);
  const folder=readdirSync(output).find(x=>x.startsWith('pourbox_'))!;
  const project=JSON.parse(readFileSync(join(output,folder,'project.json'),'utf8'));
  assert.equal(project.method.family,'full_3d_jacket');
  assert.equal(project.transforms.moldVertical,'Z',`wrong base side: ${project.transforms.moldVertical}`);
  assert.notEqual(project.method.splitAxis,'Z','backing axis cannot also be the parting pull');
 });
}
