// Applies each reference style (make_refs.py) to an edit and compares the edit's pace, transitions, zooms and rendered look
// with the reference.   BASE=http://localhost:3000 SONG=/path/song.mp3 CLIPS=a.mp4,b.mp4 node check-apply.cjs
// "Copy a Reel" applied: does the new edit have the reference's pace, transitions, zooms and look?
const fs=require('fs');const {chromium}=require('playwright');(async()=>{
const D=require('path').join(__dirname,'out')+'/', truth=JSON.parse(fs.readFileSync(D+'truth.json'));
const b=await chromium.launch({args:['--autoplay-policy=no-user-gesture-required','--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const p=await (await b.newContext({viewport:{width:1300,height:1000}})).newPage(); p.on('pageerror',e=>console.log('ERR',e.message));
// AI=1 lets the studio's AI run (it costs the AI provider); by default the phone's own reading and copy are measured
if(!process.env.AI) await p.route('**/api/studio/rank-shots', r=>r.fulfill({ json: { available: false } }));
await p.goto(''+(process.env.BASE||'http://localhost:3000')+(process.env.STUDIO||'/create/edit?view=all')); await p.waitForFunction(()=>document.querySelector('.brs') && document.querySelector('.brs').__studio,null,{timeout:60000});
const fc=p.waitForEvent('filechooser'); await p.click('#mpick'); await (await fc).setFiles(process.env.SONG);
await p.waitForFunction(()=>/confirmed|double-checked|^Ready$/.test(document.getElementById('s1st').textContent),null,{timeout:300000});
const fc2=p.waitForEvent('filechooser'); await p.click('#addv'); await (await fc2).setFiles(process.env.CLIPS.split(','));
await p.waitForFunction(()=>!document.getElementById('play').disabled && document.getElementById('qinfo').textContent==='',null,{timeout:400000});
// the look of the output: a few frames rendered by the studio, measured like the reference
const outLook = () => p.evaluate(async()=>{ const S=document.querySelector('.brs').__studio, E=S.edit, out=document.getElementById('out'), res=[];
  for(const f of [0.15,0.3,0.45,0.6,0.75,0.9]){ const e=E[Math.floor(f*E.length)], t=e.start+(e.end-e.start)*0.6; await S.seek(t);
    const c=document.createElement('canvas'); c.width=96; c.height=Math.round(96*out.height/out.width); const g=c.getContext('2d',{willReadFrequently:true}); g.drawImage(out,0,0,c.width,c.height);
    const d=g.getImageData(0,0,c.width,c.height).data, n=c.width*c.height; let sl=0,sl2=0,ss=0,sw=0,cen=0,cn=0,cor=0,co=0;
    for(let i=0;i<n;i++){ const r=d[i*4]/255,gg=d[i*4+1]/255,bb=d[i*4+2]/255,l=0.299*r+0.587*gg+0.114*bb,mx=Math.max(r,gg,bb),mn=Math.min(r,gg,bb); sl+=l; sl2+=l*l; ss+=mx>0.04?(mx-mn)/mx:0; sw+=r-bb;
      const x=(i%c.width)/c.width-0.5, y=((i/c.width)|0)/c.height-0.5, rr=Math.hypot(x,y)/0.7071; if(rr<0.35){cen+=l;cn++;} else if(rr>0.85){cor+=l;co++;} }
    const m=sl/n; res.push({mean:m, std:Math.sqrt(sl2/n-m*m), sat:ss/n, warm:sw/n, vig:1-(cor/co)/(cen/cn)}); }
  const o={}; for(const k of Object.keys(res[0])) o[k]=+(res.reduce((q,x)=>q+x[k],0)/res.length).toFixed(3); return o; });
await p.evaluate(()=>{ const sb=document.getElementById('safe'); if(sb.checked) sb.click(); document.querySelector('#look button[data-l="natural"]').click(); }); await p.waitForTimeout(500);
const before = await outLook(); console.log('your clips, Natural look:', JSON.stringify(before));
for(const [name,T] of Object.entries(truth).filter(([n])=>!process.env.ONLY || process.env.ONLY.split(',').includes(n))){
  const f=p.waitForEvent('filechooser');
  await p.evaluate(()=>{ const rb=document.getElementById('refbox'); (rb && !rb.hidden ? document.getElementById('refchange') : document.querySelector('#mode button[data-m="copy"]')).click(); document.getElementById('refinfo').textContent=''; });
  await (await f).setFiles(D+name+'.webm');
  await p.waitForFunction(()=>/cuts in|Could not/.test(document.getElementById('refinfo').textContent),null,{timeout:300000});
  await p.waitForTimeout(1500); await p.waitForFunction(()=>{ const m=document.querySelector('.brs').__studio.copyMatch(); return m && m.look!==null; },null,{timeout:240000}).catch(()=>console.log('   (the look was not matched in 4 min)'));   // the look is matched on the edit (a few seconds)
  const r=await p.evaluate(()=>{ const S=document.querySelector('.brs').__studio, E=S.edit, R=S.ref, per=60/Number(document.getElementById('mbpm').textContent);
    const bps=E.map(e=>(e.end-e.start)/per).sort((a,b)=>a-b), tr={}; E.slice(1).forEach(e=>{ tr[e.tr]=(tr[e.tr]||0)+1; });
    Object.keys(tr).forEach(k=>tr[k]=Math.round(tr[k]/(E.length-1)*100)+'%');
    const longE=E.filter(e=>e.end-e.start>=0.9); const short=E.slice(1).filter(e=>e.tr==='hard').map(e=>(e.end-e.start).toFixed(2)).slice(0,12).join(' ');
    return { mode: document.querySelector('#mode [aria-pressed="true"]').dataset.m, shots:E.length, medianBeats:+bps[bps.length>>1].toFixed(2), tr,
      zoomFx: Math.round(longE.filter(e=>e.efx==='pan'||e.efx==='punch-soft').length/Math.max(1,longE.length)*100)+'%', grade: S.grade,
      refTrans: Object.fromEntries(Object.entries(R.trans).map(([k,v])=>[k,Math.round(v*100)+'%'])), refZoom: Math.round(R.zoomShare*100)+'%', refLook: R.look, short }; });
  const after = await outLook(); const cal = await p.evaluate(()=>document.querySelector('.brs').__studio.renderedLook());
  console.log(`\n${name}: mode ${r.mode}, ${r.shots} shots, median ${r.medianBeats} beats/shot (reference ${T.beats_per_shot})`);
  console.log('   transitions in the edit', JSON.stringify(r.tr), '| reference', JSON.stringify(r.refTrans));
  console.log('   zoom effects on long shots', r.zoomFx, '| reference zooms', r.refZoom);
  console.log('   grade', JSON.stringify(Object.fromEntries(Object.entries(r.grade).map(([k,v])=>[k,+(+v).toFixed(2)]))));
  const L=r.refLook, cmp=k=>`${k} ${before[k]}→${after[k]} (ref ${(+L[k]).toFixed(3)})`;
  console.log('   output look (other frames):', ['sat','warm','std','mean','vig'].map(cmp).join(' | '));
  console.log('   output look (matched frames):', ['sat','warm','std','mean','vig'].map(k=>`${k} ${(+cal[k]).toFixed(3)} (ref ${(+L[k]).toFixed(3)})`).join(' | '));
  console.log('   short shots:', r.short);
  const cm = await p.evaluate(()=>document.querySelector('.brs').__studio.copyMatch());
  console.log('   match score', JSON.stringify(cm), '| on screen:', await p.evaluate(()=>document.getElementById('refmatch').textContent));
}
await b.close();})();
