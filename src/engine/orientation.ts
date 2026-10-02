import type { MeshArrays } from './types';

export type Vec3 = [number, number, number];
export type Matrix4 = [number,number,number,number,number,number,number,number,
  number,number,number,number,number,number,number,number];
export interface CanonicalFrame { sourceToMold: Matrix4; moldToSource: Matrix4; backingNormalSource: Vec3; }
const dot=(a:Vec3,b:Vec3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a:Vec3,b:Vec3):Vec3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=(a:Vec3):Vec3=>{const len=Math.hypot(...a);if(len<1e-9||!Number.isFinite(len))throw new Error('backing normal is zero or invalid');return[a[0]/len,a[1]/len,a[2]/len]};

/** Rigidly align the approved exterior backing normal with mold -Z. */
export function canonicalizeBacking(mesh:MeshArrays, normal:Vec3):{mesh:MeshArrays;frame:CanonicalFrame}{
 const n=unit(normal), up:Vec3=[-n[0],-n[1],-n[2]];
 const ref:Vec3=Math.abs(dot(up,[1,0,0]))<0.9?[1,0,0]:[0,1,0];
 const u=unit([ref[0]-up[0]*dot(ref,up),ref[1]-up[1]*dot(ref,up),ref[2]-up[2]*dot(ref,up)]);
 const v=cross(up,u);
 const vp=mesh.vertProperties,lo:Vec3=[Infinity,Infinity,Infinity],hi:Vec3=[-Infinity,-Infinity,-Infinity];
 let plane=-Infinity;
 for(let i=0;i<vp.length;i+=3){const p:Vec3=[vp[i],vp[i+1],vp[i+2]];for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],p[k]);hi[k]=Math.max(hi[k],p[k]);}plane=Math.max(plane,dot(n,p));}
 if(!Number.isFinite(plane))throw new Error('empty backing geometry');
 const center:Vec3=[(lo[0]+hi[0])/2,(lo[1]+hi[1])/2,(lo[2]+hi[2])/2];
 const tx=-dot(u,center),ty=-dot(v,center),tz=plane;
 const out=new Float32Array(vp.length);
 for(let i=0;i<vp.length;i+=3){const p:Vec3=[vp[i],vp[i+1],vp[i+2]];out[i]=dot(u,p)+tx;out[i+1]=dot(v,p)+ty;out[i+2]=dot(up,p)+tz;}
 const sourceToMold:Matrix4=[u[0],v[0],up[0],0,u[1],v[1],up[1],0,u[2],v[2],up[2],0,tx,ty,tz,1];
 const invT:Vec3=[-u[0]*tx-v[0]*ty-up[0]*tz,-u[1]*tx-v[1]*ty-up[1]*tz,-u[2]*tx-v[2]*ty-up[2]*tz];
 const moldToSource:Matrix4=[u[0],u[1],u[2],0,v[0],v[1],v[2],0,up[0],up[1],up[2],0,...invT,1];
 return {mesh:{vertProperties:out,triVerts:mesh.triVerts},frame:{sourceToMold,moldToSource,backingNormalSource:n}};
}

/** Measured face normals, at distinct support planes. A close top/back tie
 * needs a signed user selection; the model geometry cannot invent intent. */
export function backingCandidates(mesh:MeshArrays):{normal:Vec3;areaMm2:number;supportMm:number}[]{
 const vp=mesh.vertProperties,tv=mesh.triVerts;
 const bins=new Map<string,{normal:Vec3;areaMm2:number;supportMm:number}>();
 for(let i=0;i<tv.length;i+=3){
  const a=tv[i]*3,b=tv[i+1]*3,c=tv[i+2]*3;
  const e1:Vec3=[vp[b]-vp[a],vp[b+1]-vp[a+1],vp[b+2]-vp[a+2]];
  const e2:Vec3=[vp[c]-vp[a],vp[c+1]-vp[a+1],vp[c+2]-vp[a+2]];
  const vec=cross(e1,e2),length=Math.hypot(...vec);if(length<1e-12)continue;
  const n:Vec3=[vec[0]/length,vec[1]/length,vec[2]/length];
  const d=n[0]*vp[a]+n[1]*vp[a+1]+n[2]*vp[a+2];
  const key=`${n.map(x=>Math.round(x*100)).join(',')}:${Math.round(d*10)}`;
  const old=bins.get(key);if(old)old.areaMm2+=length/2;else bins.set(key,{normal:n,areaMm2:length/2,supportMm:d});
 }
 const supportToleranceMm=0.1;
 return [...bins.values()].filter(candidate=>{
   let furthest=-Infinity;
   for(let i=0;i<vp.length;i+=3){
     furthest=Math.max(furthest,candidate.normal[0]*vp[i]+candidate.normal[1]*vp[i+1]+candidate.normal[2]*vp[i+2]);
   }
   // A broad planar face under raised embossing is not the outside backing:
   // material protrudes beyond it. The true back remains an exposed support.
   return furthest-candidate.supportMm<=supportToleranceMm;
 }).sort((a,b)=>b.areaMm2-a.areaMm2);
}

/** AUTO backing direction by the proven stable-base rule (the same scoring
 *  pickFrame in split.ts uses to stand molds on their feet): for each of the
 *  six signed axis directions, accumulate the triangle area inside the
 *  near-extreme 2% band whose normals are parallel to the direction (±6°),
 *  normalize by the perpendicular bbox face, and weight by the patch's
 *  cross-extent stability (a thin vertical wall is a mast, not a bed).
 *
 *  Unlike backingCandidates (exact plane bins — arbitrary on organic sculpts
 *  where the "largest extreme plane" can be any tessellation patch), this
 *  always returns a defensible standing direction. flatRatio tells the caller
 *  whether a genuine planar bed was found (high) or the pose is a stability
 *  fallback (low) — recorded in the package as the backing selection mode. */
export function stabilityBackingCandidates(mesh: MeshArrays): { normal: Vec3; flatRatio: number; stability: number; score: number }[] {
  const vp = mesh.vertProperties, tv = mesh.triVerts;
  const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vp.length; i += 3) for (let k = 0; k < 3; k++) {
    const v = vp[i + k];
    if (v < lo[k]) lo[k] = v;
    if (v > hi[k]) hi[k] = v;
  }
  const dim: Vec3 = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  const BED_BAND = 0.02;   // 2% of the axis dim (relative — scale-invariant)
  const COS_FLAT = 0.9945; // normals parallel to the direction within 6°
  const out: { normal: Vec3; flatRatio: number; stability: number; score: number }[] = [];
  for (let a = 0; a < 3; a++) {
    if (dim[a] <= 1e-9) continue;
    const u = (a + 1) % 3, w = (a + 2) % 3;
    const cross = Math.max(1e-9, dim[u] * dim[w]);
    for (const sign of [-1, 1] as const) {
      // band at the extreme this direction points AWAY from: outward normals
      // of the low-side band point −axis, of the high-side band point +axis
      const thr = sign < 0 ? lo[a] + dim[a] * BED_BAND : hi[a] - dim[a] * BED_BAND;
      let flat = 0;
      let pLo = [Infinity, Infinity], pHi = [-Infinity, -Infinity];
      for (let t = 0; t < tv.length; t += 3) {
        const i0 = tv[t] * 3, i1 = tv[t + 1] * 3, i2 = tv[t + 2] * 3;
        const ca = (vp[i0 + a] + vp[i1 + a] + vp[i2 + a]) / 3;
        if (sign < 0 ? ca > thr : ca < thr) continue;
        const e1x = vp[i1] - vp[i0], e1y = vp[i1 + 1] - vp[i0 + 1], e1z = vp[i1 + 2] - vp[i0 + 2];
        const e2x = vp[i2] - vp[i0], e2y = vp[i2 + 1] - vp[i0 + 1], e2z = vp[i2 + 2] - vp[i0 + 2];
        const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
        const norm = Math.hypot(nx, ny, nz);
        if (norm < 1e-12) continue;
        const na = a === 0 ? nx : a === 1 ? ny : nz;
        if (Math.abs(na) < COS_FLAT * norm) continue;
        flat += norm / 2;
        for (const i of [i0, i1, i2]) {
          const cu = vp[i + u], cw = vp[i + w];
          if (cu < pLo[0]) pLo[0] = cu;
          if (cu > pHi[0]) pHi[0] = cu;
          if (cw < pLo[1]) pLo[1] = cw;
          if (cw > pHi[1]) pHi[1] = cw;
        }
      }
      const flatRatio = flat / cross;
      if (flatRatio < 1e-6) continue;
      const extU = pHi[0] > pLo[0] ? pHi[0] - pLo[0] : 0;
      const extW = pHi[1] > pLo[1] ? pHi[1] - pLo[1] : 0;
      const stability = Math.min(extU, extW) / dim[a];
      const n: Vec3 = [0, 0, 0];
      n[a] = sign;
      out.push({ normal: n, flatRatio, stability, score: flatRatio * stability });
    }
  }
  return out.sort((x, y) => y.score - x.score);
}

export function pickStabilityBacking(mesh: MeshArrays): { normal: Vec3; flatRatio: number; stability: number } {
  const best = stabilityBackingCandidates(mesh)[0] ?? { normal: [0, 0, -1] as Vec3, flatRatio: 0, stability: 0, score: 0 };
  const { normal, flatRatio, stability } = best;
  return { normal, flatRatio, stability };
}
