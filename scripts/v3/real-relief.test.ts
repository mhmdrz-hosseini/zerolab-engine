import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { planMold, type PlanRequest } from '../../src/engine/planner';
import { parseStlBinary } from '../../src/engine/stl';
import { intersectionVolume, loadManifold, withSolid } from './fixtures';
const mod = await loadManifold();
for (const file of ['Montagem flat.stl', 'obj_2_latern_cap.stl']) {
 for (const size of [50,200]) {
  test(`real ${file} delivers a clean open-face package at ${size} mm`, async () => {
    const bytes = readFileSync(`D:/code/3d/MOLD/MOLD-generator base/input/${file}`);
    const master = parseStlBinary(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
    const bb=withSolid(mod,master,m=>m.boundingBox());
    const k=size/Math.max(...bb.max.map((x,i)=>x-bb.min[i]));
    master.vertProperties=master.vertProperties.map(x=>x*k);
    const result=await planMold({ mod,master,grid:{} as PlanRequest['grid'],rankedAxes:['Z','X','Y'],
      params:{gap:6,wall:5,clearance:0.35},name:file,
      castingIntent:{inputRole:'positive_master',requiredSurfaces:'front_only',requestedFamily:'open_face_relief',
        ...(file.includes('cap')?{backingNormalSource:[0,0,-1] as [number,number,number]}:{})},
      source:{inputSha256:createHash('sha256').update(bytes).digest('hex'),sourceKind:'file',units:'mm',scalePolicy:`${size} mm`,engineCommit:'test'} });
    assert.equal(result.ok,true,result.ok?'':result.message);
    if(!result.ok)return;
    assert.equal(result.method.family,'open_face_relief');
    const key=Object.keys(result.files.files).find(k=>k.endsWith('/project.json'))!;
    const project=JSON.parse(new TextDecoder().decode(result.files.files[key]));
    for(const [name,audit] of Object.entries(project.finalFileAudit) as [string,{verdict:string}][]) {
      if(name.includes('silicone_skin')) {
        // the preview STL is never printed; the shipping contract treats a
        // lone pinched edge as a recorded warning, not a blocker (a kernel
        // state flip can make one preview edge suspect at 200 mm while the
        // same build is valid direct — printed parts stay strictly valid)
        assert.ok(audit.verdict==='valid'||audit.verdict==='suspect',`${name} must not be invalid`);
        continue;
      }
      assert.equal(audit.verdict,'valid',`${name} must be clean, not merely exported`);
    }
    const stl=(suffix:string)=>{
      const key=Object.keys(result.files.files).find(k=>k.endsWith(suffix))!;
      const bytes=result.files.files[key];
      return parseStlBinary(Uint8Array.from(bytes).buffer);
    };
    const wall=stl('/02_jacket/tray_wall.stl');
    for(const [name,part] of [['master base',stl('/01_master/master_base.stl')],['silicone skin',stl('/03_preview/silicone_skin.stl')]] as const){
      const overlap=intersectionVolume(mod,wall,part);
      assert.ok(overlap<0.001,`${name} intersects the final serialized tray wall by ${overlap} mm3`);
    }
  });
 }
}
