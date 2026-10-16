// Reads each reference Reel (make_refs.py) with the studio's "Copy a Reel" and scores cuts, transitions, pace, zooms and look
// against the truth.   BASE=http://localhost:3000 node check-analysis.cjs
// "Copy a Reel" analysis vs the known truth of the reference Reels (scripts/studio-style/make_refs.py)
const fs=require('fs');const {chromium}=require('playwright');(async()=>{
const D=require('path').join(__dirname,'out')+'/', truth=JSON.parse(fs.readFileSync(D+'truth.json'));
const b=await chromium.launch({args:['--autoplay-policy=no-user-gesture-required','--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const p=await (await b.newContext({viewport:{width:1300,height:1000}})).newPage(); p.on('pageerror',e=>console.log('ERR',e.message));
await p.goto(''+(process.env.BASE||'http://localhost:3000')+'/studio?view=all'); await p.waitForFunction(()=>document.querySelector('.brs') && document.querySelector('.brs').__studio,null,{timeout:60000});
const conf={}; let tot=0, hit=0, kindOk=0, terr=[];
for(const [name,T] of Object.entries(truth)){
  const t0=Date.now(); const fc=p.waitForEvent('filechooser');
  await p.evaluate(()=>{ const rb=document.getElementById('refbox'); (rb && !rb.hidden ? document.getElementById('refchange') : document.querySelector('#mode button[data-m="copy"]')).click(); });
  await p.evaluate(()=>{ document.getElementById('refinfo').textContent=''; });
  await (await fc).setFiles(D+name+'.webm');
  await p.waitForFunction(()=>/cuts in|Could not/.test(document.getElementById('refinfo').textContent),null,{timeout:300000});
  const R=await p.evaluate(()=>document.querySelector('.brs').__studio.ref), info=await p.evaluate(()=>document.getElementById('refinfo').textContent);
  // match cuts (±0.2 s), then check kinds
  const used=new Set(); let h=0, ok=0;
  T.cuts.forEach((tc,i)=>{ let bj=-1, bd=0.2; R.cuts.forEach((c,j)=>{ if(!used.has(j) && Math.abs(c.t-tc)<bd){ bd=Math.abs(c.t-tc); bj=j; } });
    const tk=T.transitions[i]; conf[tk]=conf[tk]||{};
    if(bj>=0){ used.add(bj); h++; terr.push(Math.abs(R.cuts[bj].t-tc)); const k=R.cuts[bj].kind; conf[tk][k]=(conf[tk][k]||0)+1; if(k===tk) ok++; } else conf[tk].missed=(conf[tk].missed||0)+1; });
  const extra=R.cuts.length-used.size; const missed=T.cuts.filter((tc,i)=>!R.cuts.some(c=>Math.abs(c.t-tc)<0.2)).map((tc)=>tc.toFixed(2)+'('+T.transitions[T.cuts.indexOf(tc)]+')');
  if(missed.length) console.log('   missed:', missed.join(' '), '| extra at', R.cuts.filter((c)=>!T.cuts.some(tc=>Math.abs(c.t-tc)<0.2)).map(c=>c.t.toFixed(2)+'('+c.kind+')').join(' ')); tot+=T.cuts.length; hit+=h; kindOk+=ok;
  console.log(`${name.padEnd(14)} ${((Date.now()-t0)/1000).toFixed(1)}s | cuts found ${h}/${T.cuts.length}, extra ${extra} | kind right ${ok}/${h} | beats/shot ${R.medianBeats} (truth ${T.beats_per_shot}) on-beat ${Math.round(R.onBeat*100)}% bpm ${R.bpm.toFixed(1)} | zoom shots ${Math.round(R.zoomShare*100)}% (truth ${Math.round(T.zoom_shots.filter(Boolean).length/T.zoom_shots.length*100)}%)`);
  console.log('   look', JSON.stringify(Object.fromEntries(Object.entries(R.look).map(([k,v])=>[k,+v.toFixed(3)]))), '| grade', JSON.stringify(T.grade));
  console.log('   says:', info.replace(/^.*?: /,''));
}
terr.sort((a,b)=>a-b);
console.log(`TOTAL cuts found ${hit}/${tot} (${(hit/tot*100).toFixed(0)}%), transition kind right ${kindOk}/${hit} (${(kindOk/hit*100).toFixed(0)}%), cut time error median ${(terr[terr.length>>1]*1000).toFixed(0)} ms`);
console.log('confusion (truth -> found):', JSON.stringify(conf));
await b.close();})();
