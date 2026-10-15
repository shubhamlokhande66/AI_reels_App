// Beat-tracking benchmark for Fast Studio: node score.mjs ../../components/studio/engine.ts (run in a folder with the
// .wav files and truth.json made by make_set1.py / make_set2.py). Score: F-measure, beats within ±70 ms.
import fs from 'fs';
const src = fs.readFileSync(process.argv[2],'utf8');
const a = src.indexOf('function songAnalysis('), b = src.indexOf('function analyseInWorker(');
let body = src.slice(a,b);
const dbg = 'globalThis.__dbg={bpm:(60*fps/P).toFixed(1)};';
body = body.replace('const ints = []; for(let i=1;i<out.length;i++)', dbg + '\n  const ints = []; for(let i=1;i<out.length;i++)');
const songAnalysis = new Function(body + '\nreturn songAnalysis;')();
const truth = JSON.parse(fs.readFileSync('truth.json','utf8'));
function readWav(f){ const d=fs.readFileSync(f); let o=12; let sr=44100, data=null;
  while(o<d.length){ const id=d.toString('ascii',o,o+4), sz=d.readUInt32LE(o+4); if(id==='fmt ') sr=d.readUInt32LE(o+12); if(id==='data'){ data=d.subarray(o+8,o+8+sz); break; } o+=8+sz; }
  const x=new Float32Array(data.length/2); for(let i=0;i<x.length;i++) x[i]=data.readInt16LE(i*2)/32768; return {x,sr}; }
const tol=0.07; let tot=0;
for(const [name, tb] of Object.entries(truth)){
  const {x,sr}=readWav(name+'.wav'); const t0=Date.now(); const r=songAnalysis(x,sr); const ms=Date.now()-t0;
  const det=r.beats; const used=new Set(); let hit=0;
  for(const t of tb){ let bi=-1, bd=tol; det.forEach((d,i)=>{ if(!used.has(i) && Math.abs(d-t)<=bd){ bd=Math.abs(d-t); bi=i; } }); if(bi>=0){ used.add(bi); hit++; } }
  const R=hit/tb.length, P=det.length?hit/det.length:0, F=2*P*R/Math.max(1e-9,P+R);
  tot+=F;
  console.log(name.padEnd(22), 'F', (F*100).toFixed(0)+'%', ' recall', (R*100).toFixed(0)+'%', ' precision', (P*100).toFixed(0)+'%', ' BPM', (60/r.period).toFixed(1), ' ', ms+'ms', JSON.stringify(globalThis.__dbg));
}
console.log('mean F', (tot/Object.keys(truth).length*100).toFixed(1)+'%');
