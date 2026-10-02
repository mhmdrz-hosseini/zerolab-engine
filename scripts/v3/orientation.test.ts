import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planMold, type PlanRequest } from '../../src/engine/planner';
import { loadManifold, plaque, instanceToMeshArrays, withSolid } from './fixtures';
import { buildReliefTray } from '../../src/engine/reliefTray';
import { backingCandidates } from '../../src/engine/orientation';
const mod=await loadManifold();
const source=plaque(mod);
const tilted=withSolid(mod,source,m=>instanceToMeshArrays(m.rotate(17,31,43)));
const variants = [
  {name:'native',mesh:source,normal:[0,0,-1] as [number,number,number]},
  {name:'standing on edge',mesh:withSolid(mod,source,m=>instanceToMeshArrays(m.rotate(90,0,0))),normal:[0,1,0] as [number,number,number]},
  {name:'upside-down',mesh:withSolid(mod,source,m=>instanceToMeshArrays(m.rotate(180,0,0))),normal:[0,0,1] as [number,number,number]},
  {name:'translated',mesh:withSolid(mod,source,m=>instanceToMeshArrays(m.translate(117,-83,41))),normal:[0,0,-1] as [number,number,number]},
  {name:'arbitrary rotation',mesh:tilted,normal:backingCandidates(tilted)[0].normal},
];
for(const v of variants){
 test(`signed backing yields the same open-face geometry for ${v.name}`,async()=>{
  const plan=await planMold({mod,master:v.mesh,grid:{} as PlanRequest['grid'],rankedAxes:[],
    params:{gap:4,wall:4,clearance:0.35},name:v.name,
    source:{inputSha256:'0'.repeat(64),sourceKind:'mesh',units:'mm',scalePolicy:'test',engineCommit:'test'},
    castingIntent:{inputRole:'positive_master',requiredSurfaces:'front_only',requestedFamily:'open_face_relief',backingNormalSource:v.normal}});
  assert.equal(plan.ok,true,plan.ok?'':plan.message);
  if(!plan.ok)return;
  assert.equal(plan.method.family,'open_face_relief');
  assert.ok(Math.abs(plan.pkg.frame.base)<0.01);
  assert.ok(Math.abs(plan.pkg.frame.crown-17.5)<0.05);
  assert.ok(Math.abs(plan.pkg.siliconeMl-variantsExpectedSiliconeMl)<0.1);
  const metaKey=Object.keys(plan.files.files).find(k=>k.endsWith('/project.json'))!;
  const metadata=JSON.parse(new TextDecoder().decode(plan.files.files[metaKey]));
  assert.ok(metadata.transforms.sourceToMold,'source-to-mold matrix must be exported');
  const f=metadata.transforms.sourceToMold as number[], inv=metadata.transforms.moldToSource as number[];
  const apply=(matrix:number[],point:[number,number,number],direction=false):[number,number,number]=>[
    matrix[0]*point[0]+matrix[4]*point[1]+matrix[8]*point[2]+(direction?0:matrix[12]),
    matrix[1]*point[0]+matrix[5]*point[1]+matrix[9]*point[2]+(direction?0:matrix[13]),
    matrix[2]*point[0]+matrix[6]*point[1]+matrix[10]*point[2]+(direction?0:matrix[14]),
  ];
  const normal=apply(f,v.normal,true);
  assert.ok(Math.hypot(normal[0],normal[1],normal[2]+1)<1e-5);
  const point:[number,number,number]=[v.mesh.vertProperties[0],v.mesh.vertProperties[1],v.mesh.vertProperties[2]];
  const roundTrip=apply(inv,apply(f,point));
  assert.ok(Math.hypot(...point.map((x,i)=>x-roundTrip[i]))<0.01);
 });
}
const variantsExpectedSiliconeMl=buildReliefTray({mod,master:source,params:{gap:4,wall:4,plateT:4,backing:4,freeboard:5}}).siliconeMl;
