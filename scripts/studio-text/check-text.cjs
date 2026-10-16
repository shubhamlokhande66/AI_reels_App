/* eslint-disable @typescript-eslint/no-require-imports */
// Captions and the beat hook, checked on the rendered frames (a stand-in transcriber returns known words, Devanagari
// included).   BASE=http://localhost:3000 SONG=/path/song.mp3 CLIPS=a.mp4,b.mp4 node check-text.cjs
const fs=require('fs');const {chromium}=require('playwright');(async()=>{
const b=await chromium.launch({args:['--autoplay-policy=no-user-gesture-required','--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const ctx=await b.newContext({viewport:{width:1300,height:1000}});
const WORDS=[ {text:'we',start:3.0,end:3.3},{text:'light',start:3.35,end:3.8},{text:'up',start:3.85,end:4.2},{text:'tonight',start:4.3,end:5.0},
  {text:'नाचू',start:7.0,end:7.5},{text:'आज',start:7.6,end:8.0},{text:'सारे',start:8.1,end:8.7},
  {text:'feel',start:12.0,end:12.4},{text:'the',start:12.45,end:12.6},{text:'beat',start:12.65,end:13.2} ];
let req=null;
await ctx.route('**/api/studio/transcribe**', async route=>{ const r=route.request();
  if(r.method()==='GET') return route.fulfill({json:{available:true, credits:0, languages:['hi','mr','en']}});
  const body=r.postDataBuffer(); req={bytes:body.length, riff:body.toString('ascii',0,4), wave:body.toString('ascii',8,12), sr:body.readUInt32LE(24), ch:body.readUInt16LE(22), bits:body.readUInt16LE(34), lang:new URL(r.url()).searchParams.get('lang')};
  return route.fulfill({json:{words:WORDS, duration:22, language:'auto', charged:0}}); });
const p=await ctx.newPage(); p.on('pageerror',e=>console.log('ERR',e.message));
await p.goto((process.env.BASE||'http://localhost:3000')+'/studio'); await p.waitForFunction(()=>document.querySelector('.brs') && document.querySelector('.brs').__studio,null,{timeout:60000});
const fc=p.waitForEvent('filechooser'); await p.click('#mpick'); await (await fc).setFiles(process.env.SONG);
await p.waitForFunction(()=>/^Ready/.test(document.getElementById('s1st').textContent),null,{timeout:120000});
const fc2=p.waitForEvent('filechooser'); await p.click('#addv'); await (await fc2).setFiles(process.env.CLIPS.split(','));
await p.waitForFunction(()=>!document.getElementById('play').disabled && document.getElementById('qinfo').textContent==='',null,{timeout:300000});
await p.waitForFunction(()=>/confirmed|double-checked|^Ready$/.test(document.getElementById('s1st').textContent),null,{timeout:300000});
await p.waitForTimeout(1500);
console.log('captions switch shown:', await p.evaluate(()=>!document.getElementById('capwrap').hidden));
await p.evaluate(()=>{ const s=document.getElementById('safe'); if(s.checked) s.click(); });
await p.click('#caps'); await p.waitForFunction(()=>/words found|No words|not available/.test(document.getElementById('capstat').textContent),null,{timeout:60000});
console.log('request:', JSON.stringify(req), '| status:', await p.evaluate(()=>document.getElementById('capstat').textContent), '| lines', await p.evaluate(()=>document.querySelector('.brs').__studio.capLines.map(l=>l.words.map(w=>w.text).join(' ')).join(' / ')));
// ink in a band: white / accent text pixels; accent = yellow
const ink = (t, y0, y1) => p.evaluate(async({t,y0,y1})=>{ const S=document.querySelector('.brs').__studio; await S.frameAt(t); const o=document.getElementById('out'), g=o.getContext('2d'), H=o.height, W=o.width;
  const d=g.getImageData(0,Math.round(y0*H),W,Math.round((y1-y0)*H)).data; let white=0, acc=0, ax=0;
  for(let i=0;i<d.length;i+=4){ const r=d[i],gg=d[i+1],bb=d[i+2]; if(r>235&&gg>235&&bb>235) white++; else if(r>230&&gg>190&&bb<120&&gg<235){ acc++; ax+=((i/4)%W)/W; } }
  return {white, acc, ax: acc? +(ax/acc).toFixed(3):null}; }, {t,y0,y1});
// timing
const rows=[];
for(const t of [2.6, 3.15, 3.6, 4.0, 4.6, 5.6, 7.2, 7.8, 8.4, 10.0, 12.2, 12.9, 14.5]){ const lo=await ink(t,0.6,0.8); rows.push(`${t}s:${lo.white+lo.acc>200?'TEXT':'—'}(${lo.white+lo.acc})`); }
console.log('caption band (lines at 3.0-5.3, 7.0-9.0, 12.0-13.5):', rows.join(' '));
// karaoke highlight travels across the line
await p.evaluate(()=>document.querySelector('#tstyle button[data-t="karaoke"]').click());
const kx=[]; for(const t of [3.1,3.6,4.0,4.7]){ const k=await ink(t,0.6,0.8); kx.push(k.ax); }
console.log('karaoke: highlighted word position (x) at 3.1 / 3.6 / 4.0 / 4.7 s:', kx.join(' → '), kx.every((v,i)=>i===0||v>kx[i-1]) ? '(moves left to right ✓)' : '(NOT monotonic)');
// Devanagari line drawn
const dv=await ink(7.8,0.6,0.8); console.log('Devanagari line at 7.8 s: ink', dv.white+dv.acc, dv.white+dv.acc>200?'✓':'✗');
// hook words one per beat
await p.evaluate(()=>document.querySelector('#tstyle button[data-t="pop"]').click());
await p.fill('#hook','WAIT FOR THE DROP');
const bt=await p.evaluate(()=>document.querySelector('.brs').__studio.beats.filter(b=>b>0.15).slice(0,4));
const hk=[]; for(const t of [0.1, (bt[0]+0.05), (bt[1]+0.05), (bt[2]+0.05)]){ const h=await ink(t,0.17,0.37); hk.push(h.white+h.acc); }
const before=[]; for(const t of [bt[0]-0.06, bt[1]-0.06, bt[2]-0.06]){ const h=await ink(t,0.17,0.37); before.push(h.white+h.acc); }
console.log('hook ink just after word 1 / beat 1 / beat 2 / beat 3:', hk.join(' → '), '| just before beats 1-3:', before.join(' '), hk.every((v,i)=>i===0||v>hk[i-1]) ? '(a word more on each beat ✓)':'');
// a face in the caption band: the captions move up
const moved = await p.evaluate(async()=>{ const S=document.querySelector('.brs').__studio; const e=S.edit[S.edit.findIndex(x=>x.start<=12.9&&x.end>12.9)], src=S.sources[e.src];
  src.faces = Array.from({length:Math.ceil(src.dur/0.4)},(_,k)=>({t:k*0.4, n:1, fx:0.5, fy:0.8, fs:0.25})); e.cam=null; return S.faceYOnScreen(12.9); });
const up=await ink(12.9,0.26,0.46), low=await ink(12.9,0.6,0.8);
console.log('face put at', moved && moved.toFixed(2), 'of the height → captions in the upper band:', up.white+up.acc, '| lower band:', low.white+low.acc);
await b.close();})();
