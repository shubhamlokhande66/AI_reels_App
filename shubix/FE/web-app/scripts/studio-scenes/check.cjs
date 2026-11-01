// Scene changes found vs the truth, shots that cross one, and how well the crop keeps the subject in frame.
// Run make_clips.py first, then: BASE=http://localhost:3000 SONG=/path/song.mp3 node check.cjs
const fs=require('fs');const {chromium}=require('playwright');(async()=>{
const b=await chromium.launch({args:['--autoplay-policy=no-user-gesture-required','--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const p=await (await b.newContext({viewport:{width:1300,height:1000}})).newPage();
p.on('pageerror',e=>console.log('ERR',e.message));
await p.addInitScript(()=>{ window.__long=[]; new PerformanceObserver(l=>{ for(const e of l.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({type:'longtask', buffered:true}); });
await p.goto((process.env.BASE||'http://localhost:3000')+'/studio?view=all');
await p.waitForFunction(()=>document.querySelector('.brs') && document.querySelector('.brs').__studio,null,{timeout:60000});
const fc=p.waitForEvent('filechooser'); await p.click('#mpick'); await (await fc).setFiles(process.env.SONG);
await p.waitForFunction(()=>document.getElementById('s1st').textContent==='Ready',null,{timeout:90000});
const t0=Date.now(); await p.evaluate(()=>window.__long.length=0);
const fc2=p.waitForEvent('filechooser'); await p.click('#addv');
await (await fc2).setFiles(['out/scenes.webm','out/subject.webm']);
await p.waitForFunction(()=>!document.getElementById('play').disabled && document.getElementById('qinfo').textContent==='',null,{timeout:300000});
console.log('clips read + edit in', ((Date.now()-t0)/1000).toFixed(1)+'s, longest block', await p.evaluate(()=>Math.max(0,...window.__long)),'ms;', await p.evaluate(()=>document.getElementById('s3st').textContent));
const truth=JSON.parse(fs.readFileSync('out/scenes.json')), subj=JSON.parse(fs.readFileSync('out/subject.json')).path;
const r = await p.evaluate(async ({truth, subj})=>{
  const S=document.querySelector('.brs').__studio, srcs=S.sources, sc=srcs.find(s=>s.name==='scenes.webm'), su=srcs.find(s=>s.name==='subject.webm');
  const res={scenes: sc.scenes.map(x=>({kind:x.kind,t0:+x.t0.toFixed(3),t1:+x.t1.toFixed(3)})), otherScenes: srcs.filter(s=>s!==sc).map(s=>s.name+':'+s.scenes.length), readMs: srcs.map(s=>s.name+' '+s.dur.toFixed(1)+'s '+JSON.stringify(s.readMs)+' samples '+s.samples.length+' maxgap '+Math.max(...s.samples.slice(1).map((x,i)=>x.t-s.samples[i].t)).toFixed(3)), faces: srcs.map(s=>s.name+':'+(s.faces||[]).filter(f=>f.n).length)};
  // shots that run across a true boundary
  const bnd = truth.boundaries.map(x=>x.kind==='cut' ? [x.t-0.001, x.t+0.001] : [x.t0, x.t1]);
  const idx = srcs.indexOf(sc), win = e => [e.in, e.in + e.sp.pos(e.end-e.start)*e.scaleR];
  const fromSc = S.edit.filter(e=>e.src===idx);
  res.shotsFromScenes = fromSc.length; res.crossing = fromSc.filter(e=>{ const [a,b2]=win(e); return bnd.some(([u,v])=>u < b2 && v > a); }).map(e=>win(e).map(x=>x.toFixed(2)).join('-'));
  // subject following
  const si = srcs.indexOf(su), shots = S.edit.map((e,i)=>[e,i]).filter(([e])=>e.src===si);
  const out = document.getElementById('out'), g = out.getContext('2d');
  const truthAt = t => { const k = Math.min(subj.length-2, Math.max(0, Math.floor(t*30))), f=t*30-k; return [subj[k][1]+(subj[k+1][1]-subj[k][1])*f, subj[k][2]+(subj[k+1][2]-subj[k][2])*f]; };
  const Wv=out.width, Hv=out.height, base=Math.max(Wv/su.w, Hv/su.h), cw=Math.min(1, Wv/(su.w*base));
  const clampX = x => Math.min(1-cw/2, Math.max(cw/2, x));
  const rows=[]; let inN=0, allN=0, offNew=0, offOld=0, inOld=0;
  for(const [e,i] of shots){
    const L=e.end-e.start, cams=[];
    for(let l=0.03; l<L-0.03; l+=1/15){
      const t=e.start+l; await S.frameAt(t);
      const d=g.getImageData(0,0,Wv,Hv).data; let n=0, sx=0;
      for(let y=0;y<Hv;y+=2) for(let x=0;x<Wv;x+=2){ const o=(y*Wv+x)*4; if(d[o]>140 && d[o]-d[o+1]>90 && d[o]-d[o+2]>90){ n++; sx+=x; } }
      const st = e.in + e.sp.pos(l)*e.scaleR, [tx] = truthAt(st);
      const oldX = 0.5 + (tx - clampX(e.cx))/cw;   // where the subject was with the old fixed crop
      const vis = n > 40, px = vis ? sx/n/Wv : null;
      allN++; if(vis && px>0.12 && px<0.88) inN++; if(oldX>0.12 && oldX<0.88) inOld++;
      offNew += vis ? Math.abs(px-0.5) : 0.5; offOld += Math.min(0.5, Math.abs(oldX-0.5));
      cams.push(S.camAt(e,l)[0]);
    }
    let acc=0, k=0; for(let j=2;j<cams.length;j++){ acc += ((cams[j]-2*cams[j-1]+cams[j-2])*su.w*base)**2; k++; }
    rows.push({shot:i, len:L.toFixed(2), in:e.in.toFixed(2), mode:e.cam&&e.cam.mode, jerkPx: k? Math.sqrt(acc/k).toFixed(2):'-'});
  }
  res.subject = {frames:allN, insideNew:(inN/allN*100).toFixed(1)+'%', insideOld:(inOld/allN*100).toFixed(1)+'%', meanOffNew:(offNew/allN*100).toFixed(1)+'% of width', meanOffOld:(offOld/allN*100).toFixed(1)+'% of width', rows};
  return res;
},{truth, subj});
console.log(JSON.stringify(r,null,1));
console.log('truth', JSON.stringify(truth.boundaries));
await b.close();})();
