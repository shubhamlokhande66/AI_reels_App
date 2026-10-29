// The full check: songAnalysis alone, Beat This! alone, and the two together (what the studio does) against the truth.
//   node ensemble.mjs ../../components/studio/engine.ts . set2 set3 deg1 deg2 deg3   (after make_set*.py, make_degraded.py, run-beatthis.ts)
// A folder without truth.json but with refs.json (real songs) is scored against those reference beats instead.
import fs from 'fs'; import path from 'path';
const src = fs.readFileSync(process.argv[2],'utf8');
const songAnalysis = new Function(src.slice(src.indexOf('function songAnalysis('), src.indexOf('function analyseInWorker(')) + '\nreturn songAnalysis;')();
const F=(det,ref,tol=0.07,skip=0)=>{ ref=ref.filter(t=>t>=skip); det=det.filter(t=>t>=skip-tol); const used=new Set(); let hit=0;
  for(const t of ref){ let bi=-1,bd=tol; det.forEach((d,i)=>{ if(!used.has(i)&&Math.abs(d-t)<=bd){bd=Math.abs(d-t);bi=i;} }); if(bi>=0){used.add(bi);hit++;} }
  const R=hit/Math.max(1,ref.length), P=hit/Math.max(1,det.length); return 2*P*R/Math.max(1e-9,P+R); };
const readWav=f=>{ const d=fs.readFileSync(f); let o=12, sr=44100, data=null; while(o<d.length){ const id=d.toString('ascii',o,o+4), sz=d.readUInt32LE(o+4); if(id==='fmt ') sr=d.readUInt32LE(o+12); if(id==='data'){ data=d.subarray(o+8,o+8+sz); break;} o+=8+sz; }
  const x=new Float32Array(data.length/2); for(let i=0;i<x.length;i++) x[i]=data.readInt16LE(i*2)/32768; return {x,sr}; };
const sets = process.argv.slice(3); const summary=[];
for(const dir of sets){
  const truthF = path.join(dir,'truth.json'), isReal = !fs.existsSync(truthF);
  const truth = isReal ? Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(path.join(dir,'refs.json')))).map(([k,v])=>[k,v.essentia])) : JSON.parse(fs.readFileSync(truthF));
  const bt = JSON.parse(fs.readFileSync(path.join(dir,'beatthis.json'))); let tO=0,tA=0,tE=0;
  for(const [k,tb] of Object.entries(truth)){
    const {x,sr}=readWav(path.join(dir,k+'.wav')), skip = isReal ? 5 : 0;
    const own=songAnalysis(x,sr).beats, ens=songAnalysis(x,sr,{beats:bt[k].beats});
    const fo=F(own,tb,0.07,skip), fa=F(bt[k].beats,tb,0.07,skip), fe=F(ens.beats,tb,0.07,skip); tO+=fo; tA+=fa; tE+=fe;
    console.log(k.padEnd(26),'own',(fo*100).toFixed(0).padStart(3)+'%','| Beat This!',(fa*100).toFixed(0).padStart(3)+'%','| ensemble',(fe*100).toFixed(0).padStart(3)+'%','chose',ens.beatSource.padEnd(3),
      'own acc %.2f steady %.2f | ai acc %.2f steady %.2f'.replace(/%\.2f/g,()=>'%s').replace('%s',ens.beatJudge.own.accent.toFixed(2)).replace('%s',ens.beatJudge.own.steady.toFixed(2)).replace('%s',ens.beatJudge.ai.accent.toFixed(2)).replace('%s',ens.beatJudge.ai.steady.toFixed(2)));
  }
  const n=Object.keys(truth).length; summary.push(`${path.basename(dir)}: own ${(tO/n*100).toFixed(1)}%  Beat This! ${(tA/n*100).toFixed(1)}%  ensemble ${(tE/n*100).toFixed(1)}%`);
}
console.log(summary.join('\n'));
