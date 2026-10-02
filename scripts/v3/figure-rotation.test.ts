import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planMold } from '../../src/engine/planner';
import { buildSignedDistanceGrid } from '../../src/engine/offset';
import { loadManifold, instanceToMeshArrays } from './fixtures';
const mod=await loadManifold();
const main=mod.Manifold.cube([24,18,36]);
const boss=mod.Manifold.cube([8,8,5]).translate(8,5,36);
const figure=main.add(boss);
const cases=[
  {name:'native',mesh:instanceToMeshArrays(figure),normal:[0,0,-1] as [number,number,number]},
  {name:'rotated',mesh:instanceToMeshArrays(figure.rotate(90,0,0)),normal:[0,1,0] as [number,number,number]},
];
const results:{name:string;volume:number}[]=[];
for(const c of cases){
 test(`full 3D ${c.name} builds from the approved backing plane`,async()=>{
  const grid=await buildSignedDistanceGrid(c.mesh,{gap:4,wall:3,step:0.75});
  const result=await planMold({mod,master:c.mesh,grid,rankedAxes:['Z','X','Y'],
    params:{gap:4,wall:3,clearance:0.35},name:c.name,
    castingIntent:{inputRole:'positive_master',requiredSurfaces:'all_sides',requestedFamily:'full_3d_jacket',backingNormalSource:c.normal},
    source:{inputSha256:'0'.repeat(64),sourceKind:'mesh',units:'mm',scalePolicy:'test',engineCommit:'test'} });
  assert.equal(result.ok,true,result.ok?'':`${result.message}\n${JSON.stringify(result.rejectionLedger)}`);
  if(!result.ok)return;
  // Policy (V3 corpus fix): a split ALONG the backing axis is allowed only
  // where its mid plane clears the base attachment band — the blanket ban
  // starved the candidate ladder on real figures. The vertical frame is Z
  // for X/Y splits; a backing-axis split exports with its auto print
  // vertical and a rotate-to-bed instruction.
  assert.ok(['X','Y','Z'].includes(result.transforms.moldVertical),'valid print vertical');
  if(result.method.splitAxis==='Z'){
    assert.ok(result.pkg.frame.mid-result.pkg.frame.base>2,'a backing-axis split must clear the base attachment band');
  }
  assert.ok(result.transforms.sourceToMold,'source-to-mold transform missing');
  results.push({name:c.name,volume:result.pkg.siliconeMl});
 });
}
test('rotating the same solid does not materially change its silicone volume',()=>{
 assert.equal(results.length,2);
 assert.ok(Math.abs(results[0].volume-results[1].volume)/results[0].volume<0.02);
});
