// The engine's edit core: how a Reel's shots are chosen and placed. Moved from components/studio/engine.ts, with its state in
// one object (ES) and what stays in the page behind hooks (EH), on the way to running the phone's brain without the hidden page.
// The golden test (scripts/engine-golden.mjs) says it still makes the same Reel.
// @ts-nocheck
import { endWell, crossesScene, fmt, TAIL, windowStats, srcPosF, srcPos, aiBonus, moveWords, rampSpeed, velocitySpeed, curveSpeed } from './pure';
import { TR_DUR } from '@mobile/core/lib/shaders';
import { describeCut, soundMap, sectionsOf } from '../components/studio/soundmap';

export function createEditBrain(ES, EH){
function flickPick(e, local){ const n = ES.flickPool.length, f = Math.floor((e.start + local)*30 + 1e-6), st = n % 5 ? 5 : n % 3 ? 3 : 1; return ES.flickPool[((f*st) % n + n) % n]; }
   // beats the creator tapped in (song time): cuts can land on them like on the song's own beats
function withMarks(b, dur){ if(!ES.userMarks.length) return b; const out = b.slice();
  for(const m of ES.userMarks){ const t = m - ES.secStart; if(t > 0.05 && t < dur - 0.05 && !out.some(x => Math.abs(x - t) < 0.08)) out.push(t); }
  return out.sort((x, y) => x - y); }
function drumness(t){ const c=Math.round((t-ES.onOff)*ES.onFps); let m=0; for(let j=c-2;j<=c+4;j++) if(j>=0 && j<ES.pfArr.length && ES.pfArr[j]>m) m=ES.pfArr[j]; return m; }
function snap(t, w){
  let best=t, bs=0;
  let lo=0, hi=ES.peaks.length; while(lo<hi){ const m=(lo+hi)>>1; if(ES.peaks[m]<t-w) lo=m+1; else hi=m; }
  for(let i=lo; i<ES.peaks.length && ES.peaks[i]<=t+w; i++){ const sc = ES.peakS[i]*(1-Math.abs(ES.peaks[i]-t)/(w*1.5)); if(sc>bs){ bs=sc; best=ES.peaks[i]; } }
  return best;
}
   // the template's kind of Reel (car, wedding...): with Shubix AI its trend leads the AI's guide
// Style: Auto follows the music as analysed; Smooth keeps fewer, longer shots on the strong beats; Fast cuts on every beat.
// (a copied Reel keeps its short shots: no flash-cut merging; another song puts them on its beats, copyPlan)
function adaptPlan(){ return EH.copyTimed() ? copyPlanTimed() : ES.mode === 'copy' && ES.refProfile ? endWell(adaptPlan0()) : beatEdit(endWell(noFlashCuts(adaptPlan0()))); }
/* ---- the beat edit of car, bike and sports Reels (measured on such Reels: cuts land on the drum hits, 88% of them) ----
 * Where the song's strong drum hits are dense (5 a second or more, for 2 s or longer: a fast verse, a dhol or snare roll,
 * a build-up) a cut on every hit, never closer than a third of a beat; where it stays loud with no strong hits for 1.5 s
 * or more and the drums come back right after (a riser, a held note before the drop) a flicker montage (a different still
 * of the clips on every frame, at most 3 s); elsewhere the plan as it is. "Strong": at least the song's median hit (all of
 * a busy mix's onsets are dense everywhere). Smooth keeps its calm; a copied Reel keeps its own edit. */
// ai: the AI's pace (its sections with "hits" and "flicker" are used as they are, in any style; nothing else is added)
function beatEdit(p, ai){
  if(!(ES.mode === 'auto' || ES.mode === 'fast' || ai) || ES.mode === 'copy' || !ES.buf || !ES.rmsF || !ES.hopSec || !ES.hitsRaw || ES.hitsRaw.length < 8 || p.length < 2 || !(ES.period > 0)) return p;
  const dur = ES.buf.duration, H = ES.hitsRaw.filter(t => t > 0.1 && t < dur - 0.15), W = 1, step = 0.25;
  const ss = (ES.hitsStr || []).slice().sort((a,b)=>a-b), sMed = ss.length ? ss[ss.length>>1] : 0;
  const HS = ES.hitsRaw.filter((t, i) => (ES.hitsStr[i] || 0) >= sMed && t > 0.1 && t < dur - 0.15);   // the strong hits
  const dbAt = (a, b) => { const fa = Math.max(0, Math.floor(a/ES.hopSec)), fb = Math.min(ES.rmsF.length, Math.ceil(b/ES.hopSec)); let s2 = 0; for(let f=fa; f<fb; f++) s2 += ES.rmsF[f]*ES.rmsF[f]; return 10*Math.log10(s2/Math.max(1, fb-fa) + 1e-10); };
  const cnt = (A, a, b) => { let n = 0; for(const h of A) if(h >= a && h < b) n++; return n; };
  const wins = []; for(let t=0; t+W <= dur + 1e-6; t+=step) wins.push({ t, n: cnt(HS, t, t+W), db: dbAt(t, t+W) });
  if(wins.length < 8) return p;
  const lv = wins.map(w => w.db).filter(x => x > -60).sort((a,b)=>a-b), med = lv.length ? lv[lv.length>>1] : -20;
  const runsOf = (test, minLen) => { const out = []; let a = null;
    wins.forEach((w, i) => { const on = test(w); if(on && a === null) a = w.t; if((!on || i === wins.length-1) && a !== null){ const b = on ? w.t + W : wins[i-1].t + W; if(b - a >= minLen) out.push([a, Math.min(dur, b)]); a = null; } });
    return out; };
  const burst = ai ? ai.filter(x => x.every === 'hits').map(x => [x.t, Math.min(dur, x.t + x.len)]) : runsOf(w => w.n >= 5 && w.db >= med - 3, 2);
  const flick = (ai ? ai.filter(x => x.every === 'flicker').map(x => { const b = Math.min(dur - 0.15, x.t + x.len); return [Math.max(x.t, b - 3), b]; })
    : runsOf(w => w.n <= 1 && w.db >= med + 1, 1.5).filter(([, b]) => cnt(HS, b, b + 2) >= 6).map(([a, b]) => [Math.max(a + 0.25, b - 3.25), b - 0.25])).filter(([a, b]) => b - a >= 0.5);
  if(!burst.length && !flick.length) return p;
  const inR = (t, R) => R.some(([a, b]) => t > a + 0.02 && t < b - 0.02);
  // the cut points: the plan's own, outside the bursts and flickers; every hit inside a burst; both ends of a flicker
  let pts = p.slice(1).map(x => x.start).filter(t => !inR(t, burst) && !inR(t, flick));
  const gap = Math.max(0.13, ES.period/3);
  burst.forEach(([a, b]) => { let last = -9; H.forEach(h => { const t = h - 1/30; if(t > a && t < b && t - last >= gap && !inR(t, flick)){ pts.push(t); last = t; } }); });
  flick.forEach(([a, b]) => { pts.push(a, b); });
  pts = pts.filter(t => t > 0.12 && t < dur - 0.15).sort((x,y)=>x-y).filter((t, i, A) => !i || t - A[i-1] >= 0.1);
  const of = t => p.find(x => t >= x.start - 1e-3 && t < x.end) || p[p.length-1];
  const starts = [0, ...pts], out = starts.map((a, i) => { const b = i + 1 < starts.length ? starts[i+1] : dur, src = of(a), own = Math.abs(src.start - a) < 0.02;
    return { ...src, start: a, end: b, type: own ? src.type : 'cut', fx: own ? src.fx : 'Hard cut', flick: flick.some(([fa, fb]) => Math.abs(fa - a) < 0.02 && Math.abs(fb - b) < 0.02) || undefined }; });
  return out;
}
function noFlashCuts(p){
  for(let i=1;i<p.length;i++){ const s = p[i], pt = partAt(s.start + 0.05); if(s.end - s.start >= (pt === 'drop' || pt === 'up' ? 0.4 : 0.6)) continue;
    const keepStart = s.type === 'drop' || s.type === 'break' || EH.isPartStart(s.start + 1/30);
    if(keepStart && p[i+1] && !(p[i+1].type === 'drop' || p[i+1].type === 'break' || EH.isPartStart(p[i+1].start + 1/30))){ s.end = p[i+1].end; p.splice(i+1, 1); i--; }
    else if(!keepStart){ p[i-1].end = s.end; p.splice(i, 1); i--; } }
  return p;
}
function adaptPlan0(){
  if(ES.mode==='copy' && ES.refProfile) return copyPlan();
  if(ES.mode==='smooth'){
    const bar = Math.min(3, Math.max(1.4, ES.period*4)), outP = [];
    ES.basePlan.forEach(s=>{ const last = outP[outP.length-1], minLen = outP.length === 1 ? Math.min(bar, 2.6) : partAt(s.start) === 'drop' ? (bar > 2.2 ? bar/2 : bar) : Math.min(4, 2*bar);
      const keep = !last || s.type==='drop' || s.type==='break' || EH.isPartStart(s.start) || (s.start-last.start) >= minLen - 0.1 || (s.end-last.start) > (partAt(s.start) === 'drop' ? 4.5 : 5.2);
      if(keep) outP.push({...s}); else last.end = s.end; });
    return outP;
  }
  if(ES.mode==='fast'){
    const outP = [];
    ES.basePlan.forEach(s=>{
      const G = gridOf(ES.buf.duration), one = ES.period < 0.4 ? 2*ES.period - 0.02 : 0.3, bs = G.map(b=>b-1/30).filter(b=>b>s.start+0.3 && b<s.end-0.3);
      let a = s.start, first = true;
      for(const b of bs){ const pt = partAt(b), step = pt === 'drop' || pt === 'up' ? one : Math.max(one, 1.9*ES.period);
        if(b-a >= step && s.end-b >= Math.min(step, 0.6)){ outP.push({...s, start:a, end:b, type:first?s.type:'cut', fx:first?s.fx:'Hard cut'}); a=b; first=false; } }
      outP.push({...s, start:a, end:s.end, type:first?s.type:'cut', fx:first?s.fx:'Hard cut'});
    });
    return outP;
  }
  return ES.basePlan.map(s=>({...s}));
}
   // [{start,end,type,fx}]
function buildPlan(){
  const dur = ES.buf.duration, list = [];
  const cs = ES.cuts.slice(), ts = ES.cutType.slice(), fx = ES.cutFx.slice();
  if(!cs.length || cs[0] > 0.05){ cs.unshift(0); ts.unshift('cut'); fx.unshift('Hard cut'); } else cs[0] = 0;
  // cut one frame (1/30 s) before the beat: on screen it feels exactly on the beat, with more energy
  for(let i=1;i<cs.length;i++) cs[i] = Math.max(cs[i-1]+0.05, cs[i]-1/30);
  for(let i=0;i<cs.length;i++){ const end = i+1<cs.length ? cs[i+1] : dur; if(end-cs[i] < 0.08) continue; list.push({start:cs[i], end, type:ts[i], fx:fx[i]}); }
  // pattern interrupt: no shot longer than 3.5 s; split long ones on a beat
  const outL = [], G = gridOf(dur);
  list.forEach(s=>{
    let a = s.start; const segs = [];
    while(s.end - a > 3.5){
      const mid = a + Math.min(3.0, (s.end-a)/2);
      const btG = G.filter(b=>b>a+1.2 && b<s.end-1.0).reduce((best,b)=>best==null || Math.abs(b-mid)<Math.abs(best-mid)?b:best, null) ?? mid;
      const bt = btG - 1/30;
      segs.push([a, bt]); a = bt;
    }
    segs.push([a, s.end]);
    segs.forEach(([x,y],k)=>outL.push({start:x, end:y, type: k ? 'cut' : s.type, fx: k ? 'Hard cut' : s.fx}));
  });
  ES.basePlan = outL; ES.plan = adaptPlan();
}
// whole beats nearest to the length asked (never longer by more than a few hundredths), whole bars when that costs at
// most one beat; no steady beat: the length as asked
function partBeats(L){
  const r = ES.song && ES.song.r, p = r && r.period;
  if(!p || !r.beats || r.beats.length < 8) return { n: 0, len: L };
  let n = Math.floor((L + 0.05)/p); if(n % 4 && (n - n % 4) >= 4 && (n % 4) <= 1) n -= n % 4;
  return { n: Math.max(4, n), len: Math.max(4, n)*p };
}
function bestPart(L){
  const r = ES.song.r, D = ES.song.buf.duration, bt = r.beats || [], hs = r.hopSec, E = r.rmsF;
  if(D <= L + 0.5) return 0;
  const starts = bt.length >= 8 ? bt.filter(t => t + L <= D - 0.05) : Array.from({length: Math.floor((D-L)/0.5)+1}, (_,i)=>i*0.5);
  if(!starts.length) return 0;
  const eAt = (a, b) => { const fa = Math.max(0, Math.floor(a/hs)), fb = Math.min(E.length, Math.ceil(b/hs)); let s2 = 0; for(let f=fa; f<fb; f++) s2 += E[f]; return s2/Math.max(1, fb-fa); };
  let eMax = 1e-9; const ew = starts.map(t => { const v = eAt(t, t+L); if(v > eMax) eMax = v; return v; });
  const pt = partsOfSong(), byParts = pt && pt.length;
  const drops = byParts ? pt.filter(x => x.ty === 'drop').map(x => x.t) : (r.cuts || []).filter((c,k)=>r.cutType[k] === 'drop'),
    brk = byParts ? pt.filter(x => x.ty === 'break').map(x => x.t) : (r.cuts || []).filter((c,k)=>r.cutType[k] === 'break');
  // how hard each beat hits (a bar's first beat usually hits hardest): a part starts best on a strong one
  const hit = t => eAt(t, t + 0.12), hMax = Math.max(1e-9, ...starts.map(hit));
  let best = 0, bs = -Infinity;
  starts.forEach((t, i) => {
    const full = ew[i]/eMax, head = eAt(t, t + Math.min(2, L*0.15));
    let sc = full;
    // a drop on the part's first beat counts (it is found a few ms before or after its beat)
    if(drops.some(d => d >= t - 0.12 && d <= t + 0.4*L)) sc += 0.35; else if(drops.some(d => d > t + 0.4*L && d < t + L)) sc += 0.12;
    if(head < 0.55*ew[i]) sc -= 0.3;                                   // quiet start: no hook
    if(brk.some(b => b > t && b < t + 0.25*L)) sc -= 0.15;              // a break right away
    sc += 0.12*hit(t)/hMax - 0.04*t/D;                                  // a strong first beat; the first chorus over a later one
    if(sc > bs){ bs = sc; best = t; }
  });
  return best;
}
function snapToBeat(t){ const bt = ES.song.r.beats || []; if(bt.length < 8) return Math.max(0, t); let b = bt[0]; for(const x of bt) if(Math.abs(x - t) < Math.abs(b - t)) b = x; return b; }
/* ---- the song's parts, the way an editor hears them: intro, build-up, DROP, break ----
 * Loudness and low end (kick + bass) per beat; a part starts where both change for good (8 beats before vs after),
 * placed on the exact beat and on the bar line. A rise into one of the loudest parts is a drop, a fall is a break.
 * The edit's drops and breaks come only from here, so every Reel cuts where the song changes and nowhere else. */
function songParts(mono, sr, beats){
  if(!beats || beats.length < 16) return [];
  let n = beats.length; const p = (beats[n-1]-beats[0])/(n-1), dur = mono.length/sr;
  // a quiet intro or ending has no beats found: its pulse goes on, on the same grid
  { const g = beats.slice(); for(let t=g[0]-p; t>=0; t-=p) g.unshift(t); for(let t=g[g.length-1]+p; t<dur-p; t+=p) g.push(t); beats = g; n = g.length; }
  // per beat: loudness and low end (kick + bass), in dB
  let lp = 0; const a = Math.exp(-2*Math.PI*150/sr), low = new Float32Array(mono.length);
  for(let i=0;i<mono.length;i++){ lp = (1-a)*mono[i] + a*lp; low[i] = lp; }
  const db = (arr, t0, t1) => { const i0 = Math.max(0, Math.round(t0*sr)), i1 = Math.min(arr.length, Math.round(t1*sr)); let s = 0; for(let i=i0;i<i1;i+=2) s += arr[i]*arr[i]; return 10*Math.log10(s/Math.max(1,(i1-i0)/2) + 1e-9); };
  const F = beats.map((b,k) => { const e = k+1<n ? beats[k+1] : b+p; return [db(mono,b,e), db(low,b,e)]; });
  const W = 8, nov = beats.map((_,k) => { if(k < 4 || k > n-4) return 0; const w = Math.min(W, k, n-k);
    let d = 0; for(const j of [0,1]){ let A=0,B=0; for(let q=1;q<=w;q++){ A += F[k-q][j]; B += F[k+q-1][j]; } d += (B-A)/w; } return d/2; });
  // boundaries: strongest changes, at least 8 beats apart
  const cand = nov.map((v,k)=>({k, v})).filter(c => c.v >= 3 || c.v <= -3.5).sort((x,y)=>Math.abs(y.v)-Math.abs(x.v)), keep = [];
  cand.forEach(c => { if(keep.every(o => Math.abs(o.k-c.k) >= 8)) keep.push(c); });
  // the exact beat: where the sound changes most from one beat to the next (same direction), near the coarse change
  const step = (k, w) => { let A=0,B=0; for(let q=1;q<=w;q++){ A += F[k-q][0]+F[k-q][1]; B += F[k+q-1][0]+F[k+q-1][1]; } return (B-A)/(2*w); };
  keep.forEach(c => { let bk = c.k, bv = 0; for(let k=Math.max(2,c.k-3); k<=Math.min(n-2,c.k+3); k++){ const v = step(k, 2)*Math.sign(c.v); if(v > bv){ bv = v; bk = k; } } c.k = bk; });
  // bars: the phase most changes agree on; a change one beat off a bar line moves onto it
  const ph = [0,1,2,3].map(r => keep.reduce((s,c)=>s + (c.k%4===r ? Math.abs(c.v) : 0), 0)), P = ph.indexOf(Math.max(...ph));
  keep.forEach(c => { const o = ((c.k - P)%4+4)%4; if(o === 1) c.k -= 1; else if(o === 3) c.k += 1; });
  for(let i=keep.length-1;i>=0;i--) if(beats[n-1] - beats[Math.min(n-1,keep[i].k)] < 4*p || keep[i].k >= n) keep.splice(i,1);
  keep.sort((x,y)=>x.k-y.k);
  const all = F.map(f=>f[0]).sort((x,y)=>x-y), hi = all[Math.floor(all.length*0.55)];
  const segE = (k0,k1) => { const v = F.slice(k0, Math.max(k0+1,k1)).map(f=>f[0]).sort((x,y)=>x-y); return v[v.length>>1]; };   // median: a silent tail does not count
  return keep.map((c,i) => { const nx = i+1<keep.length ? keep[i+1].k : n; const e = segE(c.k, nx);
    return { t: beats[c.k], ty: c.v > 0 && e >= hi ? 'drop' : c.v < 0 ? 'break' : 'up', v: +c.v.toFixed(1) }; });
}
// the analysis' cuts, put on the beat grid and on the song's parts (st, L: the part of the song in use)
function applyParts(r, parts, st, L){
  const p = r.period, bt = r.beats || [];
  if(!p || !r.cuts) return r;
  const cuts = r.cuts.slice(), ty = r.cutType.slice(), fx = r.cutFx.slice();
  // the grid: beats, carried on before the first and after the last one (a quiet intro still has a pulse)
  const grid = [];
  if(bt.length >= 8){ for(let t=bt[0]-p; t>-0.05; t-=p) grid.unshift(t); grid.push(...bt); for(let t=bt[bt.length-1]+p; t<L; t+=p) grid.push(t); }
  const near = (t, step) => { let b = null, bd = Infinity; for(const g of grid) for(let q=0; q<1; q+=step){ const c = g + q*p, d = Math.abs(c - t); if(d < bd){ bd = d; b = c; } } return [b, bd]; };
  const rel = (parts || []).map(x => ({ t: Math.max(0, x.t - st), ty: x.ty })).filter(x => x.t >= 0 && x.t < L - 0.5 && (x.t > 0 || x.ty === 'drop'));
  // on the beat; half beats only in a build-up (its roll speeds up)
  const inBuild = t => { let ty = ''; for(const x of rel){ if(x.t <= t + 0.02) ty = x.ty; else break; } return ty === 'up'; };
  if(grid.length) for(let i=0;i<cuts.length;i++){ if(cuts[i] < 0.05) continue;
    const [b1, d1] = near(cuts[i], 1), [b2] = near(cuts[i], 0.5);
    cuts[i] = d1 <= 0.1 || !inBuild(cuts[i]) ? b1 : b2; }
  const FX = { drop: 'Best shot · flash + zoom-in', break: 'Slow-mo / freeze / text' };
  rel.forEach(x => {
    let j = -1, bd = 0.25; cuts.forEach((c,k) => { const d = Math.abs(c - x.t); if(d < bd){ bd = d; j = k; } });
    const T = x.ty === 'drop' || x.ty === 'break' ? x.ty : (j >= 0 && ty[j] !== 'drop' && ty[j] !== 'break' ? ty[j] : 'cut');
    if(j >= 0){ cuts[j] = x.t; ty[j] = T; fx[j] = FX[T] || fx[j]; }
    else { let k = cuts.findIndex(c => c > x.t); if(k < 0) k = cuts.length; cuts.splice(k, 0, x.t); ty.splice(k, 0, T); fx.splice(k, 0, FX[T] || 'Hard cut'); }
  });
  const isPart = t => rel.some(q => Math.abs(q.t - t) < 0.01);
  // a drop or break anywhere else is only a hit / a cut; a cut right after a part's start goes (the part's shot plays)
  const out = { c: [], t: [], f: [] }, ord = cuts.map((c,k) => k).sort((x,y) => cuts[x] - cuts[y]);
  ord.forEach(k => { const c = cuts[k]; let T = ty[k], F = fx[k];
    if(parts && parts.length && (T === 'drop' || T === 'break') && !isPart(c)){ T = T === 'drop' ? 'hit' : 'cut'; F = T === 'hit' ? 'Zoom punch' : 'Hard cut'; }
    const n = out.c.length - 1;
    if(n >= 0 && c - out.c[n] < 0.3){ if(isPart(c) && !isPart(out.c[n])){ out.c[n] = c; out.t[n] = T; out.f[n] = F; }
      else if(!isPart(out.c[n]) && out.t[n] === 'cut' && T !== 'cut'){ out.t[n] = T; out.f[n] = F; } return; }
    out.c.push(c); out.t.push(T); out.f.push(F); });
  return { ...r, cuts: out.c, cutType: out.t, cutFx: out.f, parts: rel };
}
function partAt(t){ let ty = 'intro'; for(const x of ES.songPartsRel){ if(x.t <= t + 0.02) ty = x.ty; else break; } return ty; }
function gridOf(dur){ const g = []; if(ES.beats.length < 8 || !ES.period) return ES.beats.slice();
  for(let t=ES.beats[0]-ES.period; t>0.05; t-=ES.period) g.unshift(t); g.push(...ES.beats); for(let t=ES.beats[ES.beats.length-1]+ES.period; t<dur-0.05; t+=ES.period) g.push(t); return g; }
// the last shot is a whole one (a cut just before the end looks like a mistake)
// a cut wherever a part of the song starts (the AI's pace keeps drops and breaks; a build-up's start too)
function withPartCuts(p){
  ES.songPartsRel.forEach(x => { const t = x.t - 1/30; if(t < 0.3) return;
    if(p.some(s => Math.abs(s.start - t) < 0.1)) return;
    const k = p.findIndex(s => s.start < t && s.end > t); if(k < 0) return;
    const s = p[k], T = x.ty === 'drop' || x.ty === 'break' ? x.ty : 'cut';
    p.splice(k + 1, 0, { ...s, start: t, type: T, fx: T === 'drop' ? 'Best shot · flash + zoom-in' : T === 'break' ? 'Slow-mo / freeze / text' : 'Hard cut' }); s.end = t; });
  return p;
}
function partsOfSong(){
  if(ES.song && ES.song.r && ES.song.partsOf !== ES.song.r){ try{ ES.song.parts = songParts(ES.song.mono, ES.song.buf.sampleRate, ES.song.r.beats); }catch(e){ console.warn('song parts', e); ES.song.parts = []; }
    ES.song.partsOf = ES.song.r; }
  return ES.song ? ES.song.parts : [];
}
function colorHist(d){
  const h = new Float32Array(EH.FEAT), gs = new Float32Array(40); let n = 0;
  for(let i=0;i<d.length;i+=4){
    h[((d[i]>>6)<<4) | ((d[i+1]>>6)<<2) | (d[i+2]>>6)]++;
    const y = 0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]; h[64 + Math.min(15, y>>4)]++;
    const p = i>>2, x = p % EH.SW, yy = (p / EH.SW) | 0; const gi = Math.min(4, (yy*5/EH.SH)|0)*8 + Math.min(7, (x*8/EH.SW)|0); h[80 + gi] += y/255; gs[gi]++;
    n++; }
  for(let k=0;k<80;k++) h[k] /= n;
  for(let k=0;k<40;k++) h[80+k] /= Math.max(1, gs[k]);
  return h;
}
// Frequency-tuned saliency (Achanta et al. 2009) on the small frame: how far each pixel's colour (in a Lab-like space)
// is from the picture's average colour. Its centre and how concentrated it is say where the eye goes.
function saliency(d){
  const n = EH.SW*EH.SH, L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n); let mL=0, mA=0, mB=0;
  for(let i=0;i<n;i++){ const r=d[i*4]/255, g=d[i*4+1]/255, b=d[i*4+2]/255;
    L[i] = 0.3*r+0.59*g+0.11*b; A[i] = r-g; B[i] = 0.5*(r+g)-b; mL+=L[i]; mA+=A[i]; mB+=B[i]; }
  mL/=n; mA/=n; mB/=n;
  const s = new Float32Array(n); let sm=0, sq=0;
  for(let i=0;i<n;i++){ const v = Math.hypot(0.6*(L[i]-mL), 1.6*(A[i]-mA), 1.6*(B[i]-mB)); s[i]=v; sm+=v; sq+=v*v; }
  const mean = sm/n, sd = Math.sqrt(Math.max(0, sq/n-mean*mean)), th = mean + 1.5*sd;
  let w=0, x=0, y=0, xx=0, yy=0;
  for(let i=0;i<n;i++){ const r = s[i]-th; if(r>0){ const px=((i%EH.SW)+0.5)/EH.SW, py=(((i/EH.SW)|0)+0.5)/EH.SH; w+=r; x+=r*px; y+=r*py; xx+=r*px*px; yy+=r*py*py; } }
  if(w < 1e-4 || sd < 0.03) return {x:0.5, y:0.5, w:0};
  x/=w; y/=w; const spread = Math.sqrt(Math.max(0, xx/w-x*x + yy/w-y*y));
  return {x, y, w: Math.min(1, sd/0.12) * Math.max(0, 1 - spread/0.25)};   // strong contrast, in one place
}
// camera motion is estimated as one global shift (block matching on the 48x27 frame), what still differs after that
// shift is the subject: its centre, its weight and how concentrated it is
function subjectMotion(prev, cur){
  const R = 3; let best = Infinity, bdx = 0, bdy = 0;
  for(let dy=-R; dy<=R; dy++) for(let dx=-R; dx<=R; dx++){
    let s = 0; for(let y=R; y<EH.SH-R; y++){ const o=y*EH.SW, op=(y-dy)*EH.SW-dx; for(let x=R; x<EH.SW-R; x++) s += Math.abs(cur[o+x]-prev[op+x]); }
    s += 0.002*(dx*dx+dy*dy)*EH.SW*EH.SH;   // prefer "no camera move" when it is a tie
    if(s < best){ best = s; bdx = dx; bdy = dy; }
  }
  let w = 0, x = 0, y = 0, xx = 0, yy = 0, n = 0;
  for(let yy0=R; yy0<EH.SH-R; yy0++) for(let x0=R; x0<EH.SW-R; x0++){
    const r = Math.abs(cur[yy0*EH.SW+x0] - prev[(yy0-bdy)*EH.SW + x0-bdx]) - 0.05; n++;   // 0.05: noise / compression
    if(r > 0){ const px=(x0+0.5)/EH.SW, py=(yy0+0.5)/EH.SH; w+=r; x+=r*px; y+=r*py; xx+=r*px*px; yy+=r*py*py; }
  }
  if(w < 1e-3) return {x:0.5, y:0.5, w:0, gx: bdx, gy: bdy};
  x/=w; y/=w; const spread = Math.sqrt(Math.max(0, xx/w-x*x + yy/w-y*y));
  // weight: enough moving pixels, and in one place (a whole-frame change is lighting or a fast pan, not a subject)
  const conc = Math.max(0, 1 - spread/0.32);
  return {x, y, w: Math.min(1, w/n*25) * conc, gx: bdx, gy: bdy};
}
// One face is followed through the clip: a detection is kept only when a face is seen at about the same place in a
// neighbouring look (a lone hit is usually a false face in a pattern), and when there are several faces the one the
// track already follows wins over a bigger one that would make the crop jump.
function trackFaces(raw){
  const near = (a, b) => Math.hypot(a.x-b.x, a.y-b.y) < Math.max(0.12, 1.2*Math.max(a.s, b.s)) && Math.max(a.s,b.s)/Math.min(a.s,b.s) < 1.8;
  const ok = raw.map((f,i)=>f.rects.filter(r=>{
    if(r.s > 0.22) return true;   // a big face is reliable on its own
    for(const j of [i-2,i-1,i+1,i+2]) if(raw[j] && raw[j].rects.some(q=>near(r,q))) return true;
    return false; }));
  const out = []; let cur = null;
  raw.forEach((f,i)=>{
    const rs = ok[i];
    if(!rs.length){ out.push({t:f.t, n:0}); if(cur && out.length>2 && !out[out.length-2].n) cur = null; return; }
    let pick = rs.reduce((a,b)=>a.s>b.s?a:b);
    if(cur){ const cont = rs.filter(r=>near(r,cur)); if(cont.length) pick = cont.reduce((a,b)=>Math.hypot(a.x-cur.x,a.y-cur.y) < Math.hypot(b.x-cur.x,b.y-cur.y) ? a : b); }
    cur = pick; out.push({t:f.t, n:rs.length, fx:pick.x, fy:pick.y, fs:pick.s});
  });
  return out;
}
function previewBatchClose(){
  if(ES.previewBatchUi){ES.previewBatchUi.overlay.remove();ES.previewBatchUi=null;}
  ES.previewBatchCompressed=0; ES.previewBatchDetected=0;
}
// speech parts of a clip in seconds: in above 0.5, out after 0.2 s below 0.35, then padded and short pauses kept
function speechParts(v, dur, pace){
  if(pace === 'off') return [[0, dur]];
  const P = EH.PACE[pace] || EH.PACE.natural, out = [], h = v.hop; let on = -1, low = 0;
  v.probs.forEach((p, k) => { if(on < 0){ if(p > 0.5) on = k; } else if(p < 0.35){ if(++low*h >= 0.2){ out.push([on*h, (k-low+1)*h]); on = -1; low = 0; } } else low = 0; });
  if(on >= 0) out.push([on*h, v.probs.length*h]);
  const pad = out.filter(([a,b]) => b - a >= 0.12).map(([a,b]) => [Math.max(0, a - P.pre), Math.min(dur, b + P.post)]), merged = [];
  for(const s of pad){ const L = merged[merged.length-1]; if(L && s[0] - L[1] < P.merge) L[1] = Math.max(L[1], s[1]); else merged.push(s.slice()); }
  return merged.filter(([a,b]) => b - a >= 0.25);
}
function rng(){ ES.seed = (ES.seed*16807) % 2147483647; return (ES.seed-1)/2147483646; }
function kf(track, l){
  if(!track) return undefined;
  if(l <= track[0][0]) return track[0][1];
  for(let k=1;k<track.length;k++){ const [t1,v1,ez]=track[k], [t0,v0]=track[k-1];
    if(l <= t1){ const p=(l-t0)/Math.max(1e-6,t1-t0); return v0 + (v1-v0)*(EH.EASE[ez||'lin'])(p); } }
  return track[track.length-1][1];
}
function uAt(list, l){
  if(!list || !list.length) return null;
  if(l <= list[0].t) return list[0];
  for(let k=1;k<list.length;k++){ const b = list[k]; if(l <= b.t){ const a = list[k-1], p = (EH.EASE[b.ez||'inOut'] || EH.EASE.inOut)((l-a.t)/Math.max(1e-6, b.t-a.t)), u = {};
    for(const n of EH.UK_PROPS) u[n] = a[n] + (b[n]-a[n])*p; return u; } }
  return list[list.length-1];
}
function accentAt(e, local){
  const A = e.acc; if(!A || !A.length) return null;
  let s = 1, sh = 0, ex = 0, rgb = 0, any = false;
  for(const a of A){ const d = local - a.at; if(d < 0 || d > EH.ACC_T) continue; any = true;
    if(a.do==='punch'){ s *= 1 + 0.13*Math.exp(-d/0.1); rgb += 6*Math.exp(-d/0.08); }
    else if(a.do==='pulse') s *= 1 + 0.05*Math.exp(-d/0.1);
    else if(a.do==='shake'){ sh += Math.exp(-d/0.12); s *= 1.04; }
    else if(a.do==='flash') ex += 0.85*Math.exp(-d/0.08); }
  return any ? {s, sh, ex, rgb} : null;
}
function reelIdNow(){ if(!ES.reelId) ES.reelId = EH.newId(); return ES.reelId; }
// The AI's view of footage [a,b]: frames nearby (same scene only), weighted by distance
// what a clip is about: the vision AI's subjects seen in at least a third of its frames (one stray frame says little)
function aiTags(src){
  const F = ES.aiOn && src.ai ? src.ai.frames : [], n = {};
  F.forEach(f=>(f.tags||[]).forEach(t=>{ n[t] = (n[t]||0) + 1; }));
  return Object.keys(n).filter(t=>n[t]*3 >= F.length);
}
function aiAt(src, a, b){
  if(!ES.aiOn || !src.ai || !src.ai.frames.length) return null;
  const F = src.ai.frames, sg = Math.max(0.6, 0.45*src.dur/F.length);
  let w = 0, s = 0, bw = 0, best = null; const R = {};
  for(const f of F){
    const d = f.t < a ? a-f.t : f.t > b ? f.t-b : 0;
    if(d > 0 && crossesScene(src, Math.min(f.t,a), Math.max(f.t,b))) continue;   // another scene says nothing about this one
    const k = Math.exp(-0.5*(d/sg)**2); if(k < 0.02) continue;
    w += k; s += k*f.score; f.roles.forEach(r=>{ R[r] = (R[r]||0) + k; }); if(k > bw){ bw = k; best = f; }
  }
  if(w < 0.05) return null;
  const roles = {}; for(const r in R) roles[r] = R[r]/w;
  return { score: s/w, conf: Math.min(1, w), roles, note: best ? best.note : '' };
}
// how much the AI's opinion adds to a candidate moment for this slot
// which moments to show: evenly over the clip, the sharpest well-lit moment of each part, never on a scene change
function aiTimes(src){
  const n = Math.max(3, Math.min(5, Math.round(src.dur/3))), out = [];
  for(let k=0;k<n;k++){
    const a = src.dur*k/n, b = src.dur*(k+1)/n, c0 = a+(b-a)*0.2, c1 = a+(b-a)*0.8;
    let best = null, bs = -1;
    for(const s of src.samples){ if(s.t < c0 || s.t > c1 || s.cut || crossesScene(src, s.t-0.2, s.t+0.2)) continue;
      const v = s.sh * (s.b > 0.08 ? 1 : 0.2); if(v > bs){ bs = v; best = s.t; } }
    out.push(Math.min(src.dur-0.05, best ?? (a+b)/2));
  }
  return out;
}
// the plan, shot by shot, in words: which clip and what is in it, the transition into it, its effect, speed and keyframes
function planLine(s, i, slots){
    const d = slots[i] || {}, c = d.cand, src = c ? EH.sources[c.src] : null;
    const cand = c && ES.dirCands && (ES.dirCands[i] || []).find(x => x.si === c.src && Math.abs(x.a - c.in) < 0.05);
    const what = (cand && cand.note) || (src && src.ai && src.ai.summary) || '';
    const bits = [];
    if(i && d.tr && d.tr !== 'hard') bits.push('↪ ' + (EH.TR_NAME[d.tr] || d.tr));
    if(d.fx && d.fx !== 'none') bits.push('✦ ' + (d.fx === 'hook' ? 'Hook' : EH.FX_NAME[d.fx] || d.fx));
    if(d.sp && d.sp !== 'normal') bits.push('⏱ ' + d.sp);
    if(d.keys && d.keys.length) bits.push('◆ ' + d.keys.map(k => k.do).join(', '));
    if(d.move && d.move.length) bits.push('◆ camera move');
    return fmt(s.start).replace(/\.\d+$/, '') + ' · ' + (src ? src.name.replace(/\.[^.]+$/, '') + (c ? ' @' + c.in.toFixed(1) + 's' : '') : 'best moment') + (what ? ' — ' + what : '') + (s.type === 'drop' ? ' · DROP' : s.type === 'break' ? ' · break' : '') + '\n' + (bits.length ? bits.join('  ') : 'clean cut, no effect') + (d.why ? ' · ' + d.why : '');
}
function recipeNow(){
  let h = 0; for(const c of String(ES.musicKey || '')) h = (h*31 + c.charCodeAt(0)) >>> 0;
  const r = EH.RECIPES[(h + ES.mixNo) % EH.RECIPES.length];
  // Smooth keeps soft transitions; Fast keeps quick ones
  if(ES.mode === 'smooth') return { ...r, drop: r.drop === 'dissolve' || r.drop === 'flash' ? r.drop : 'dissolve', brk: r.brk === 'blur' ? 'blur' : 'dip' };
  if(ES.mode === 'fast') return { ...r, drop: r.drop === 'dissolve' ? 'whip' : r.drop };
  return r;
}
function tastePlan(){
  if(ES.mode === 'copy' || !ES.plan.length || !ES.buf || EH.aiTrusted()) return;
  const L = ES.buf.duration, style = EH.TR_STYLE[ES.mode] || EH.TR_STYLE.auto;
  const most = Math.max(1, Math.round(L / 7)), apart = Math.max(4, L / 6);
  let used = 0, last = -99, lastAcc = -99;
  // a song without a drop or a break (found): its hits, or else its long shots, are where it changes
  const marked = ES.plan.some(s => s.type === 'drop' || s.type === 'break'), hits = ES.plan.some(s => s.type === 'hit');
  ES.plan.forEach((s, i) => {
    const len = s.end - s.start, prev = ES.plan[i - 1];
    // transitions: only where the song changes, room on both sides, spaced, one style
    if(i > 0 && s.tr !== 'hard'){
      const at = s.type === 'drop' || s.type === 'break' || (ES.songPartsRel.length ? EH.isPartStart(s.start) : s.type === 'hit' && (!marked || s.start - last >= 2 * apart))
        || (!marked && !hits && len >= 1.5);
      const room = len >= 1 && prev && prev.end - prev.start >= 1;
      if(!at || !room || used >= most || s.start - last < apart) s.tr = 'hard';
      else {
        const rc = recipeNow();
        if(s.type === 'drop') s.tr = rc.drop; else if(s.type === 'break') s.tr = rc.brk; else if(!EH.TR_CLASSY.has(s.tr)) s.tr = style[1];
        if((TR_DUR[s.tr] || 0) > 0.6 * len) s.tr = 'hard'; else { used++; last = s.start; }
      }
    }
    // the AI's keyframe kicks: on a drop or a hit only, one per shot, spaced
    if(s.acc && s.acc.length){
      if((s.type === 'drop' || s.type === 'hit') && s.start - lastAcc >= 3){ s.acc = s.acc.slice(0, 1); lastAcc = s.start; }
      else s.acc = [];
    }
  });
}
function finishTransitions(){
  const per = Math.max(1, ES.buf.duration/30), left = {snap:Math.round(2*per), whip:Math.round(2*per), spin:Math.round(1*per), glitch:Math.round(2*per), bars:Math.round(2*per), iris:Math.round(3*per), zoom:Math.round(3*per), wipe:Math.round(2*per), dissolve:Math.round(2*per) + (ES.mode==='smooth' ? 99 : 0), flash:Math.round(6*per) + (ES.mode==='fast' ? 99 : 0)};
  if(ES.mode==='copy' && ES.copyBudget){ Object.keys(left).forEach(k=>{ left[k] = ES.copyBudget[k] || 0; }); }   // copying a Reel: its own counts are the ration
  ES.plan.forEach((s,i)=>{
    if(i===0 || s.tr==='hard') return;
    const len = s.end - s.start, prev = ES.plan[i-1];
    const fit = (s.tr==='flash' || s.tr==='glitch') ? 0.9 : 0.6;   // a flash / glitch is an overlay: it needs less room than a dissolve
    let ok = TR_DUR[s.tr] <= fit*len && TR_DUR[s.tr] <= 0.8*(prev.end-prev.start);
    // a copied Reel's transition on a short shot is as quick as the Reel's own (a whip of 3 frames between shots of 0.2 s)
    s.trd = undefined;
    // the AI's own transition is never taken out: on a short shot it is just quicker (as short as the two shots allow)
    if(s.trByDir){ if(!ok) s.trd = +Math.max(1/30, Math.min(TR_DUR[s.tr] || 0, fit*len, 0.8*(prev.end-prev.start))).toFixed(3); return; }
    if(!ok && s.trByRef && EH.copyTimed()){ const d = Math.min(TR_DUR[s.tr] || 0, 0.6*len, 0.8*(prev.end-prev.start)); if(d >= 2/30){ s.trd = +d.toFixed(3); ok = true; } }
    // the rules' choices are rationed and never repeat
    if(ok && s.tr===prev.tr && !(s.type==='break' && prev.type==='break') && ES.mode !== 'copy') ok = false;   // (a copied Reel may repeat its transition)
    if(ok && left[s.tr]!==undefined && s.trByRef) left[s.tr]--;
    else if(ok && left[s.tr]!==undefined){ ok = left[s.tr] > 0; if(ok) left[s.tr]--; }
    if(!ok) s.tr = 'hard';
  });
}
// For each cut: the moment it has now, plus up to 2 alternatives from footage that no other cut has or is offered, so
// any combination the director chooses fits together (cuts that matter most get their alternatives first).
function directorCandidates(){
  const gmax = Math.max(1e-6, ...EH.sources.flatMap(s=>s.samples.map(x=>x.m)));
  const reserved = EH.sources.map(()=>[]);
  ES.edit.forEach(e=>reserved[e.src].push([e.in, e.in + e.sp.pos(e.end-e.start)*e.scaleR]));
  const free = (si, a, b) => !reserved[si].some(([u,v])=>Math.min(v,b+0.05)-Math.max(u,a-0.05) > 0);
  const order = ES.plan.map((s,i)=>i).sort((a,b)=>{ const pr={drop:0,hit:1,break:2,cut:3}; return (a===0?-1:pr[ES.plan[a].type]) - (b===0?-1:pr[ES.plan[b].type]) || a-b; });
  const out = ES.plan.map(()=>[]);
  const describe = (i, k, si, a, need, w) => { const src = EH.sources[si], S = src.samples.filter(x=>x.t>=a && x.t<=a+need);
    const gx = S.length ? S.reduce((q,x)=>q+(x.gx||0),0)/S.length : 0, m = w.m;
    return { id: i + 'abc'[k], si, a, clip: 'c'+(si+1), at: +a.toFixed(2), score: +w.sc.toFixed(2), note: w.ai ? w.ai.note : '',
      roles: w.ai ? Object.keys(w.ai.roles).filter(r=>w.ai.roles[r] > 0.4) : [], motion: m < 0.08 ? 'still' : m < 0.3 ? 'low' : m < 0.6 ? 'medium' : 'high', people: w.st.face > 0.3,
      camera: Math.abs(gx) < 0.35 ? 'still' : gx > 0 ? 'pans left' : 'pans right' }; };
  order.forEach(i=>{
    const s = ES.plan[i], e = ES.edit[i], len = s.end - s.start, nb = [ES.edit[i-1], ES.edit[i+1]].filter(Boolean).map(x=>x.src);
    const cur = e.sp.pos(len)*e.scaleR;
    out[i].push(describe(i, 0, e.src, e.in, cur, scoreWindow(i, EH.sources[e.src], e.in, cur, gmax)));
    const all = [];
    EH.sources.forEach((src,si)=>{
      if(EH.sources.length > 1 && nb.includes(si)) return;   // not the clip of a neighbour
      let need = s.sp.pos(len); if(need > src.dur-TAIL) need *= Math.max(0.05, (src.dur-TAIL)/need*0.98);
      const stepT = Math.max(0.2, Math.min(0.5, src.dur/60));
      for(let a=0; a<=src.dur-need-TAIL+1e-6; a+=stepT){ if(crossesScene(src, a, a+need) || !free(si, a, a+need)) continue; all.push({si, a, need, w: scoreWindow(i, src, a, need, gmax)}); }
    });
    all.sort((x,y)=>y.w.sc-x.w.sc);
    for(const c of all){
      if(out[i].length === 3) break;
      if(!free(c.si, c.a, c.a+c.need)) continue;
      if(out[i].length === 1 && c.si === e.src && all.some(o=>o.si!==e.src && free(o.si,o.a,o.a+o.need) && o.w.sc > c.w.sc-0.6)) continue;   // prefer another clip
      out[i].push(describe(i, out[i].length, c.si, c.a, c.need, c.w)); reserved[c.si].push([c.a, c.a+c.need]);
    }
  });
  return out;
}
function mixStore(){ const b = EH.dirBase(); if(!EH.aiMixes.has(b)) EH.aiMixes.set(b, { plans: [], asked: false, busy: false }); return EH.aiMixes.get(b); }
// what the music does under every cut (the AI reads it; a fitted plan matches on it)
function cutMusic(){
  const sm = getSoundMap(), cx = { hits: ES.hitsRaw || [], hitStr: ES.hitsStr || [], drops: ES.plan.filter(s=>s.type==='drop').map(s=>s.start), beats: ES.beats };
  return ES.plan.map(s => sm ? describeCut(sm, s.start, s.end, cx) : null);
}
// the AI's answer -> one entry per cut (its shot as a moment of a clip)
// An AI plan made for other cuts (the song's part moved), fitted to these: every cut takes the choices of the AI's cut
// whose music is most alike (a drop's transition goes to the new drop, the hook stays the hook), its keyframes land on
// this cut's own hits, and its moments of the clips are kept where this cut can use them. withShots false: the phone
// picks the moments (its own mix), the style stays the AI's. Every choice is still checked (applyDirectorStyle).
function refitDirector(src, withShots){
  const old = src.ctx.filter(c => src.slots[c.i]).map(c => ({ ...c, d: src.slots[c.i] }));
  if(!old.length || !ES.plan.length) return null;
  const music = cutMusic(), cands = withShots ? directorCandidates() : null;
  const pool = withShots ? src.slots.filter(d => d && d.cand).map(d => ({ ...d.cand })) : [];
  const near = (c) => pool.findIndex(p => p.src === c.si && Math.abs(p.in - c.a) < 0.6);
  const slots = []; let prev = null;
  ES.plan.forEach((s,i)=>{
    const m = music[i], len = s.end - s.start;
    let best = null, bs = -Infinity;
    for(const o of old){
      if(old.length > 1 && (i === 0) !== (o.i === 0)) continue;   // the hook from the hook
      let sc = (o.type === s.type ? 3 : 0) - Math.abs(Math.log(Math.max(0.05, len) / Math.max(0.05, o.len)));
      if(m && o.music) sc -= 2*(Math.abs(m.loud - o.music.loud) + Math.abs(m.drums - o.music.drums) + Math.abs(m.bass - o.music.bass)) - (m.trend === o.music.trend ? 0.5 : 0);
      if(o === prev) sc -= 1.5;   // not the same choices twice in a row
      if(sc > bs){ bs = sc; best = o; }
    }
    if(!best) best = old[0];
    prev = best;
    const d = best.d, hits = m && m.hits ? m.hits.slice().sort((a,b)=>b.p-a.p) : [];
    const keys = (d.keys || []).map((k,n) => ({ at: hits[n] ? hits[n].at : +(k.at / Math.max(0.05, best.len) * len).toFixed(2), do: k.do }));
    let cand = null;
    if(cands){ const c = (cands[i] || []).find(c => near(c) >= 0); if(c){ pool.splice(near(c), 1); cand = { src: c.si, in: c.a }; } }
    slots[i] = { cand, tr: d.tr, fx: d.fx, sp: d.sp, keys, move: (d.move || []).slice(), cs: d.cs || null, why: d.why || '' };
  });
  return slots;
}
function getSoundMap(){
  if(!ES.mono || !ES.buf) return null;
  if(ES.smapKey !== ES.musicKey){ try{ ES.smapVal = soundMap(ES.mono, ES.buf.sampleRate); }catch(e){ console.warn('sound map:', e); ES.smapVal = null; } ES.smapKey = ES.musicKey; }
  return ES.smapVal;
}
// a reference's shots, kept inside what the server accepts (numbers in range, known words only)
function cleanMoments(list, max = 40){   // max: 40 for the AI's request, 200 in a fingerprint (the style library)
  const c = (v, a, b) => Math.min(b, Math.max(a, Number.isFinite(+v) ? +v : 0)), KINDS = ['start', ...Object.keys(EH.REF_KINDS)];
  return (list || []).slice(0, max).map(m => { const o = { beats: c(m.beats, 0, 64), sec: c(m.sec, 0, 60), tr: KINDS.includes(m.tr) ? m.tr : 'hard', zoom: ['in','out','none'].includes(m.zoom) ? m.zoom : 'none' };
    for(const k of ['loud','drums','bass','voice']) if(m[k] !== undefined) o[k] = c(m[k], 0, 1);
    if(['rising','falling','steady'].includes(m.trend)) o.trend = m.trend;
    if(['kick','dhol','snare','hat'].includes(m.hit)) o.hit = m.hit;
    if(m.drop) o.drop = true; if(m.shake) o.shake = true; if(m.flick) o.flick = true; if(m.black) o.black = true; if(Number.isFinite(+m.at)) o.at = c(m.at, 0, 600); if(m.freeze !== undefined && m.freeze !== null) o.freeze = c(m.freeze, 0, 1);
    if(Array.isArray(m.move) && m.move.length >= 2){ o.move = m.move.slice(0, 5).map(k => ({ f: c(k.f, 0, 1), s: c(k.s, 0.4, 2.5), x: c(k.x, -0.6, 0.6), y: c(k.y, -0.6, 0.6), r: c(k.r, -60, 60) }));
      if(['lin','inOut','outCubic','outExpo','outBack'].includes(m.ease)) o.ease = m.ease; }
    return o; });
}
// "Copy a Reel" / a saved or learned style, for the AI: its numbers and, shot by shot, what it does on which music
function refContext(){
  if(ES.mode !== 'copy' || !ES.refProfile) return undefined;
  const R = ES.refProfile, c01 = v => Math.min(1, Math.max(0, +v || 0));
  const trans = {}; for(const [k, v] of Object.entries(R.trans || {})) trans[k] = +c01(v).toFixed(3);
  return { name: String(R.name || '').slice(0, 80), medianBeats: Math.min(64, +R.medianBeats || 0), hookBeats: Math.min(64, +R.hookBeats || 0), onBeat: c01(R.onBeat),
    energy: ['rising','falling','steady'].includes(R.energy) ? R.energy : 'steady', zoomShare: c01(R.zoomShare), trans, moments: cleanMoments(R.moments) };
}
// the whole song in sections (null: no part is used, or the song is too long or has too many sections to ask at once)
function wholeSections(){
  if(!EH.partOn() || !ES.song.r || !ES.song.mono) return null;
  const D = ES.song.buf.duration, r = ES.song.r; if(D > 600 || !(r.cuts || []).length || (r.beats || []).length < 8) return null;
  if(ES.wholeMapKey !== ES.song.key){ try{ ES.wholeMap = soundMap(ES.song.mono, ES.song.buf.sampleRate); }catch(e){ ES.wholeMap = null; } ES.wholeMapKey = ES.song.key; }
  if(!ES.wholeMap) return null;
  const cs = r.cuts, wp = cs.map((t,k)=>({ start: t, end: k+1 < cs.length ? cs[k+1] : D, type: r.cutType[k], fx: r.cutFx[k] }));
  const ws = sectionsOf(ES.wholeMap, wp, r.beats, r.period, D);
  return ws.length && ws.length <= 24 ? ws : null;
}
function paceFromSong(sp){
  const sm = getSoundMap(); if(!sm) return null;
  const secs = sectionsOf(sm, ES.basePlan, ES.beats, ES.period, ES.buf.duration).slice(0, 24); if(!secs.length) return null;
  return { story: sp.story, why: [], secs: secs.map(x => { const a = x.t + ES.secStart, b = a + x.len; let best = null, bo = 0;
    for(const w of sp.secs){ const o = Math.min(b, w.t + w.len) - Math.max(a, w.t); if(o > bo){ bo = o; best = w; } }
    return { t: x.t, len: x.len, every: best ? best.every : x.now }; }) };
}
/* ---- virtual camera: the crop follows the subject smoothly ----
   Like a camera operator: hold still while the subject stays near the middle (a locked-off shot looks professional),
   pan smoothly when it moves away, never twitch. Positions come from the tracked face, else from what moves on its own
   (camera motion removed). The path is smoothed in both directions in time (no lag), so it leads the subject a little
   instead of chasing it. Paths are in footage time, so slow motion and speed ramps follow the same subject. */
function camPath(src, a, b, cw, ch){
  const DT = 0.05, n = Math.max(2, Math.ceil((b-a)/DT)+1);
  const st = windowStats(src, a, Math.max(b, a+0.05));
  const still = (x, y, mode) => ({a, dt:DT, x:new Float32Array(n).fill(x), y:new Float32Array(n).fill(y), mode});
  const clampX = x => cw >= 0.999 ? 0.5 : Math.min(1-cw/2, Math.max(cw/2, x));
  const clampY = y => ch >= 0.999 ? 0.5 : Math.min(1-ch/2, Math.max(ch/2, y));
  // observations
  const F = (src.faces||[]).filter(f=>f.t>=a-0.6 && f.t<=b+0.6), Fon = F.filter(f=>f.n>0);
  let obs = [], mode = 'none', sigma;
  if(Fon.length && Fon.length >= 0.3*F.length){
    // a face sits a little above the middle (40% from the top), like a portrait framing
    obs = Fon.map(f=>({t:f.t, x:f.fx, y:f.fy + 0.1*ch, w:1})); mode = 'face'; sigma = 0.35;
  } else {
    // what moves on its own, and what stands out in the picture (it may stand still)
    const M = (src.samples||[]).filter(s=>s.t>=a-0.3 && s.t<=b+0.3 && !s.cut);
    const O = []; M.forEach(s=>{ if(s.sw > 0.12) O.push({t:s.t, x:s.sx, y:s.sy, w:s.sw}); if(s.aw > 0.15) O.push({t:s.t, x:s.ax, y:s.ay, w:0.8*s.aw}); });
    // the AI's subject box (when AI picks are on): it knows WHAT the subject is, so it weighs the most
    if(ES.aiOn && src.ai) src.ai.frames.forEach(f=>{ if(f.subject && f.t>=a-0.8 && f.t<=b+0.8 && !crossesScene(src, Math.min(f.t,a), Math.max(f.t,a)))
      O.push({t:f.t, x:f.subject.x+f.subject.w/2, y:f.subject.y+f.subject.h*(f.person?0.35:0.5), w:1.5, ai:true}); });
    const wsum = O.reduce((q,o)=>q+o.w, 0);
    if((O.length >= 3 && wsum > 0.8) || O.some(o=>o.ai)){ obs = O; mode = 'subject'; sigma = 0.3; }
  }
  if(!obs.length) return still(clampX(st.face>0.3 ? st.fx : 0.5+(st.cx-0.5)*0.8), clampY(st.face>0.3 ? st.fy + 0.1*ch : 0.45), 'none');
  // outliers: far from the median of their neighbours (a false face, a bird crossing the frame)
  const med = arr => { const q=[...arr].sort((x,y)=>x-y); return q[q.length>>1]; };
  obs = obs.filter(o=>{ const nb = obs.filter(p=>Math.abs(p.t-o.t) <= 0.7); if(nb.length < 3) return true;
    return Math.abs(o.x - med(nb.map(p=>p.x))) < 0.2 && Math.abs(o.y - med(nb.map(p=>p.y))) < 0.2; });
  if(!obs.length) return still(clampX(0.5+(st.cx-0.5)*0.8), clampY(0.45), 'none');
  const smoothAt = (t, sg) => { let sw=0, sx=0, sy=0, nearest=obs[0];
    for(const o of obs){ const k = o.w*Math.exp(-0.5*((t-o.t)/sg)**2); sw+=k; sx+=k*o.x; sy+=k*o.y; if(Math.abs(o.t-t) < Math.abs(nearest.t-t)) nearest=o; }
    return sw > 1e-6 ? [sx/sw, sy/sw] : [nearest.x, nearest.y]; };
  const X = new Float32Array(n), Y = new Float32Array(n), Xs = new Float32Array(n), Ys = new Float32Array(n);
  for(let k=0;k<n;k++){ const t = a + k*DT, [x,y] = smoothAt(t, sigma), [x2,y2] = smoothAt(t, sigma*2.2);
    X[k]=clampX(x); Y[k]=clampY(y); Xs[k]=clampX(x2); Ys[k]=clampY(y2); }
  // 1) locked: one position keeps the subject in the middle 40% of the frame for the whole shot
  const rng2 = A => { let lo=Infinity, hi=-Infinity; for(const v of A){ if(v<lo) lo=v; if(v>hi) hi=v; } return [lo,hi]; };
  const [x0,x1] = rng2(X), [y0,y1] = rng2(Y);
  if(x1-x0 <= 0.4*cw && y1-y0 <= 0.4*ch) return still(clampX((x0+x1)/2), clampY((y0+y1)/2), 'still');
  // 2) a slow, smooth pan if it keeps the subject within the middle 60%; 3) otherwise the closer follow
  let dev = 0; for(let k=0;k<n;k++) dev = Math.max(dev, Math.abs(Xs[k]-X[k])/cw, Math.abs(Ys[k]-Y[k])/ch);
  const useX = dev <= 0.3 ? Xs : X, useY = dev <= 0.3 ? Ys : Y;
  // a still axis stays still (no drifting up and down while the subject walks sideways)
  const [ax0,ax1] = rng2(useX), [ay0,ay1] = rng2(useY);
  if(ax1-ax0 <= 0.4*cw) useX.fill(clampX((ax0+ax1)/2));
  if(ay1-ay0 <= 0.4*ch) useY.fill(clampY((ay0+ay1)/2));
  return {a, dt:DT, x:useX, y:useY, mode};
}
// where the camera looks at this moment of the shot (fraction of the source frame); built once per shot and format
function camAt(e, local){
  const src = EH.sources[e.src]; if(!src) return [0.5, 0.5];
  const L = e.end - e.start, key = ES.aspect+'|'+e.src+'|'+e.in+'|'+e.scaleR+'|'+e.sp.label+'|'+L+'|'+(ES.aiOn && src.ai ? 1 : 0);
  if(!e.cam || e.cam.key !== key){
    const [W,H] = EH.SIZES[ES.aspect], base = Math.max(W/src.w, H/src.h);
    e.cam = camPath(src, e.in, srcPosF(e, L), Math.min(1, W/(src.w*base)), Math.min(1, H/(src.h*base))); e.cam.key = key;
  }
  const c = e.cam, u = Math.max(0, Math.min(c.x.length-1.0001, (srcPos(e, Math.max(0, Math.min(L, local))) - c.a)/c.dt)), k = Math.floor(u), f = u-k;
  return [c.x[k] + (c.x[k+1]-c.x[k])*f, c.y[k] + (c.y[k+1]-c.y[k])*f];
}
function clipFlaw(src){
  const key = EH.sources.length; if(src._flaw && src._flaw.key === key) return src._flaw.v;
  const med = a => { const x = a.filter(v => isFinite(v)).sort((p,q)=>p-q); return x.length ? x[x.length>>1] : 0; };
  const S = src.samples || [];
  const jit = med(S.slice(1).map((x,i) => Math.abs((x.gx||0) - (S[i].gx||0)) + Math.abs((x.gy||0) - (S[i].gy||0))));
  const shAll = med(EH.sources.filter(o => !o.removed && o.samples && o.samples.length).map(o => med(o.samples.map(x => x.sh))));
  const soft = shAll > 0 && EH.sources.length > 1 ? med(S.map(x => x.sh))/shAll : 1;
  const v = (jit >= 1.5 ? 3 : 0) + (soft < 0.15 ? 3 : 0);
  src._flaw = { key, v }; return v;
}
function scoreWindow(i, src, a, need, gmax){
  const s = ES.plan[i], st = windowStats(src, a, a+need), m = st.m/gmax;
  let sc;
  if(s.type==='drop') sc = 2.2*m;
  else if(s.type==='hit') sc = 1.5*m;
  else if(s.type==='break') sc = 1 - Math.abs(m-0.18)*2;
  else sc = 1 - Math.abs(m-0.55);
  if(i===0) sc = 2.4*m;   // hook: the most action-packed moment opens the reel
  if(st.b < 0.08) sc -= 1;                              // too dark
  const sharp = st.sh / (src.shMed||1);
  if(sharp < 0.45) sc -= 0.9; else sc += 0.25*Math.min(1.5, sharp); sc -= clipFlaw(src);   // blurry / shaky footage is avoided
  sc += st.face * ((s.type==='drop'||s.type==='hit'||i===0) ? 0.8 : 0.45);   // people make shots stronger
  const ai = aiAt(src, a, a+need); if(ai) sc += aiBonus(ai, i===0 ? 'hook' : s.type, i===ES.plan.length-1);
  return {sc, st, m, ai};
}
// the creator's keyframes stay on their shots when the edit is made again (the AI's scores or the director arriving,
// New mix): the shots at the same time as before (the music fixes the times) get them back
// (their clip settings too: on the same shot, or else on the shot playing at the old shot's middle)
function ukKeep(){ return ES.edit.filter(e => (e.uk && e.uk.length) || e.cs).map(e => { let cs = e.cs;
  if(cs && cs.auto){ cs = { ...cs }; for(const k of cs.auto) delete cs[k]; delete cs.auto; if(!Object.keys(cs).length) cs = undefined; }
  return { s: e.start, e: e.end, uk: e.uk, cs }; }); }
function ukRestore(kept){ for(const k of kept){ const e = ES.edit.find(x => Math.abs(x.start - k.s) < 0.02 && Math.abs(x.end - k.e) < 0.02);
  if(e && k.uk && k.uk.length) e.uk = k.uk;
  if(k.cs){ const m = (k.s + k.e)/2, c = e || ES.edit.find(x => x.start <= m && x.end > m); if(c && !c.cs) c.cs = k.cs; } } }
function seqSlots(n){
  const S = EH.sources, avg = S.reduce((a,s)=>a+s.dur,0)/S.length, w = S.map(s=>Math.min(2*avg, Math.max(0.5*avg, s.dur))), tot = w.reduce((a,b)=>a+b,0);
  const sum = c => c.reduce((a,b)=>a+b,0);
  const cnt = w.map(x => Math.max(n >= S.length ? 1 : 0, Math.round(n*x/tot)));   // every clip once while there are shots enough
  while(sum(cnt) > n){ const k = cnt.lastIndexOf(Math.max(...cnt)); cnt[k]--; }   // (fewer shots than clips: the last clips wait)
  while(sum(cnt) < n){ let k = 0, b = -Infinity; cnt.forEach((c,j)=>{ const r = n*w[j]/tot - c; if(r > b){ b = r; k = j; } }); cnt[k]++; }
  return cnt.flatMap((c, si) => Array(c).fill(si));   // shot i -> its clip
}
function seqPick(seq, res, gmax){
  const n = ES.plan.length, lenOf = i => ES.plan[i].end - ES.plan[i].start, fast = new Array(n).fill(false);
  for(let i = 0; i < n;){ let j = i; while(j < n && lenOf(j) <= EH.SEQ_FAST) j++; if(j - i >= 4) for(let k = i; k < j; k++) fast[k] = true; i = Math.max(j, i + 1); }
  for(const si of [...new Set(seq)]){
    const src = EH.sources[si], ids = seq.map((x, i) => x === si ? i : -1).filter(i => i >= 0), foot = Math.max(0.05, src.dur - TAIL);
    const need = ids.map(i => ES.plan[i].sp.pos(lenOf(i))), sum = a => a.reduce((x, y) => x + y, 0);
    const fastNeed = sum(need.filter((x, k) => fast[ids[k]])), spare = foot - sum(need);
    const scale = ids.map(i => spare < 0 ? Math.max(0.005, foot / sum(need)*0.98) : fast[i] && fastNeed > 0 ? Math.min(EH.SEQ_MAX, 1 + spare*0.6/fastNeed) : 1);
    const use = need.map((x, k) => x*scale[k]);
    let cur = 0;
    ids.forEach((i, k) => {
      const nd = use[k], rest = sum(use.slice(k + 1)), maxA = Math.max(cur, foot - nd - rest);
      // its share of the room left (so the clip's later shots still have theirs)
      const hi = Math.min(maxA, cur + (maxA - cur)*2/(ids.length - k)), stepT = Math.max(0.05, Math.min(0.5, src.dur/120));
      let best = null, bs = -Infinity;
      for(let a = cur; a <= hi + 1e-6; a += fast[i] ? Infinity : stepT){   // a fast shot runs straight on from the last
        const w = scoreWindow(i, src, a, nd, gmax), sc = w.sc - (crossesScene(src, a, a + nd) ? 1 : 0) + rng()*0.15;
        if(sc > bs){ const st = w.st; bs = sc; best = { src: si, in: a, scaleR: scale[k], cx: st.face>0.3 ? st.fx : st.cx, cy: st.face>0.3 ? st.fy : 0.45, face: st.face, fs: st.fs, mot: w.m, ov: 0, aiNote: w.ai ? w.ai.note : '', byDir: false }; }
      }
      res[i] = best; cur = best.in + nd;
    });
  }
}
// an AI camera move in words: "zoom 1.00→1.18, slides right, turns 4°, fast then settles"
function kfSummary(e){
  const cam = e.cam ? {face:'camera follows the face', subject:'camera follows the subject', still:'camera locked on the subject'}[e.cam.mode] : '';
  const notes = [e.dirWhy && ES.aiOn ? 'Shubix: ' + e.dirWhy : '', e.aiNote && ES.aiOn ? 'Shubix saw: ' + e.aiNote : '', e.why, cam].filter(Boolean).join(' · ');
  const why = (notes ? `<br><span style="font:11px var(--body);color:var(--muted)">${notes}</span>` : '')
    + (e.uk && e.uk.length ? `<br><span style="font:11px var(--body);color:#c99a00">◆ ${e.uk.length} keyframe${e.uk.length > 1 ? 's' : ''} of yours</span>` : '')
    + (e.acc && e.acc.length && ES.aiOn ? `<br><span style="font:11px var(--body);color:var(--muted)">Shubix keyframes: ${e.acc.map(a => a.do + ' at ' + a.at.toFixed(2) + ' s').join(', ')}</span>` : '')
    + (e.ak && e.ak.length && ES.aiOn ? `<br><span style="font:11px var(--body);color:var(--muted)">Shubix camera move: ${moveWords(e.ak)}</span>` : '');
  const s = e.kf && e.kf.scale; if(!s || s.length<2) return why;
  const a=s[0], b=s[s.length-1];
  return `<br><span style="font:11px var(--mono);color:var(--muted)">◆ scale ${a[1].toFixed(2)}→${b[1].toFixed(2)} · ${(b[0]-a[0]).toFixed(2)}s ${b[2]||''}</span>` + why;
}
/* a custom speed curve: five speeds across the shot (start, 1/4, middle, 3/4, end; 0.2x-4x), smooth in between; the clip
 * time is the integral of the speed (precomputed in 96 steps) */
function speedFor(key, e){
  const len = e.end - e.start, bl = ES.beats.filter(b=>b>e.start+0.15 && b<e.end-0.1).map(b=>b-e.start);
  if(key==='slow') return EH.SPEED.slow; if(key==='fast') return EH.SPEED.fast; if(key==='ramp') return rampSpeed(len);
  if(key==='velocity') return bl.length ? velocitySpeed(len, bl) : rampSpeed(len); if(key==='freeze') return EH.snapSpeed; if(key==='hold') return EH.holdSpeed; if(key==='curve') return curveSpeed(len, e.cs && e.cs.curve); return EH.SPEED.normal;
}
function assignPlayers(){ const uc = EH.sources.map(()=>0); ES.edit.forEach(e=>{ e.el = EH.sources[e.src].els[(uc[e.src]++)%3]; }); }
// pick another moment of footage for shot i: never one already used, never the same clip as its neighbours
function repick(i, avoidCurrent, onlySrc){
  const e = ES.edit[i], len = e.end-e.start, gmax = Math.max(1e-6, ...EH.sources.flatMap(s=>s.samples.map(x=>x.m)));
  const used = EH.sources.map(()=>[]); ES.edit.forEach((x,k)=>{ if(k!==i) used[x.src].push([x.in, x.in + x.sp.pos(x.end-x.start)*x.scaleR]); });
  let best=null, bs=-Infinity;
  EH.sources.forEach((src,si)=>{
    if(onlySrc != null ? si !== onlySrc : EH.sources.length>1 && [ES.edit[i-1],ES.edit[i+1]].some(x=>x && x.src===si)) return;
    let need = e.sp.pos(len), scaleR = 1; if(need > src.dur-TAIL){ scaleR = Math.max(0.05, (src.dur-TAIL)/need*0.98); need *= scaleR; }
    for(let a=0; a<=src.dur-need-TAIL+1e-6; a+=Math.max(0.1, Math.min(0.5, src.dur/120))){
      if(avoidCurrent && si===e.src && Math.abs(a-e.in) < Math.max(0.3, need*0.5)) continue;
      if(used[si].some(([u0,u1])=>Math.min(u1,a+need)-Math.max(u0,a) > 0.001)) continue;
      if(crossesScene(src, a, a+need)) continue;
      const st = windowStats(src, a, a+need), m = st.m/gmax;
      let sc = e.type==='drop' ? 2.2*m : e.type==='hit' ? 1.5*m : e.type==='break' ? 1-Math.abs(m-0.18)*2 : 1-Math.abs(m-0.55);
      if(st.b < 0.08) sc -= 1; const sharp = st.sh/(src.shMed||1); if(sharp<0.45) sc -= 0.9; else sc += 0.25*Math.min(1.5,sharp); sc -= clipFlaw(src);
      sc += st.face*0.6 + rng()*0.3;
      const ai = aiAt(src, a, a+need); if(ai) sc += aiBonus(ai, i===0 ? 'hook' : e.type, i===ES.edit.length-1);
      if(sc>bs){ bs=sc; best={src:si, in:a, scaleR, cx: st.face>0.3 ? st.fx : 0.5+(st.cx-0.5)*0.8, cy: st.face>0.3 ? st.fy : 0.45, face:st.face, fs: st.fs, mot: m, aiNote: ai ? ai.note : ''}; }
    }
  });
  if(!best) return false;
  Object.assign(e, best); e.cam = null; assignPlayers(); return true;
}
// keyframes: kxOp add (the shot as it is here), del (the key here), clear; with keys, a keyframed field changes the key at the
// playhead (made there if none: every keyed field as it shows now); what is left of the patch goes to the shot itself
function kxSet(e, patch){
  const l = Math.max(0, Math.min(e.end - e.start, ES.pos - e.start)), K = ((e.cs && e.cs.kx) || []).map(k => ({ ...k, ...(k.mk ? { mk: { ...k.mk } } : {}) })), rest = { ...patch }, op = rest.kxOp; delete rest.kxOp;
  const now = EH.csOf(e, l), here = () => { let k = K.find(q => Math.abs(q.t - l) < 0.05); if(k) return k;
    k = { t: +l.toFixed(3) }; const used = new Set(K.flatMap(q => Object.keys(q)));
    for(const n of EH.KX) if(used.has(n) || (op === 'add' && !((n === 'cx' || n === 'cy') && now[n] == null))) k[n] = now[n] ?? EH.KX_D[n] ?? 0;   // automatic framing (follows the face) stays automatic
    if(now.mk && (used.has('mk') || op === 'add')) k.mk = Object.fromEntries(EH.KX_MK.map(n => [n, now.mk[n]]));
    K.push(k); K.sort((a, b) => a.t - b.t); return k; };
  if(op === 'add') here();
  else if(op === 'del'){ const i = K.findIndex(q => Math.abs(q.t - l) < 0.05); if(i >= 0) K.splice(i, 1); }
  else if(op === 'clear') K.length = 0;
  else if(K.length){
    for(const n of EH.KX) if(n in rest && typeof rest[n] === 'number'){ here()[n] = rest[n]; delete rest[n]; }
    if(rest.mk && e.cs && e.cs.mk){ const k = here(); k.mk = Object.fromEntries(EH.KX_MK.map(n => [n, rest.mk[n]])); rest.mk = { ...rest.mk, ...Object.fromEntries(EH.KX_MK.map(n => [n, e.cs.mk[n]])) }; }
  }
  rest.kx = K.length ? K : null; return rest;
}
function histSnap(){ const ov = ES.overlays.map(o => { const c = { ...o }; delete c.box; return c; }), ed = editOf(), ly = EH.lyOf(); return { ed, ov, ly, sig: JSON.stringify([ed, ov, ly]) }; }
function histBase(){ return ES.kind + '|' + EH.sources.map(s => s.name + s.dur).join() + '|' + (ES.buf ? ES.buf.duration.toFixed(2) : ''); }
function segAt(t){ let lo=0,hi=ES.edit.length-1,r=0; while(lo<=hi){ const m=(lo+hi)>>1; if(ES.edit[m].start<=t+1e-4){ r=m; lo=m+1; } else hi=m-1; } return r; }
function strongHit(t){
  if(ES.strongFor !== ES.hitsRaw){ ES.strongFor = ES.hitsRaw; const v = (ES.hitsStr || []).slice().sort((a,b)=>a-b), cut = v[Math.floor(v.length*0.67)] ?? 0;
    ES.strongList = (ES.hitsRaw || []).filter((h, i) => (ES.hitsStr[i] || 0) >= cut).sort((a,b)=>a-b); }
  if(!ES.strongList.length) return true;
  let lo = 0, hi = ES.strongList.length - 1; while(lo < hi){ const m = (lo + hi) >> 1; if(ES.strongList[m] < t) lo = m + 1; else hi = m; }
  return Math.abs(ES.strongList[lo] - t) < 0.08 || (lo > 0 && Math.abs(ES.strongList[lo-1] - t) < 0.08);
}
function beatPulse(e, local){
  let s = 1, ex = 0, last = -Infinity;
  for(const bt of e.beatsIn){ if(bt > local) break; if(bt - last < EH.PULSE_GAP || !strongHit(e.start + bt)) continue; last = bt;
    s *= 1 + 0.018*Math.exp(-(local-bt)/0.12); ex += 0.05*Math.exp(-(local-bt)/0.08); }
  return { s, ex };
}
function drawWord(g, L, fs, style, state, a, sc){   // state: 0 not yet, 1 current, 2 done
  const txt = EH.shown(L.t); g.save(); g.globalAlpha = a; g.translate(L.x, L.y); g.scale(sc, sc);
  g.font = EH.fontFor(L.t, fs); g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  if(style === 'box'){
    const pw = L.w + fs*0.36, ph = fs*1.18, r = fs*0.18;
    g.fillStyle = state === 1 ? ES.ACCENT : 'rgba(0,0,0,0.62)'; g.beginPath(); g.roundRect ? g.roundRect(-pw/2, -ph/2, pw, ph, r) : g.rect(-pw/2, -ph/2, pw, ph); g.fill();
    g.fillStyle = state === 1 ? '#111' : '#fff'; g.fillText(txt, 0, fs*0.03);
  } else if(style === 'clean'){
    g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = fs*0.25; g.fillStyle = state === 0 ? 'rgba(255,255,255,0.55)' : '#fff'; g.fillText(txt, 0, 0);
  } else {
    g.lineWidth = fs*0.14; g.strokeStyle = 'rgba(0,0,0,0.85)'; g.strokeText(txt, 0, 0);
    g.shadowColor = 'rgba(0,0,0,0.4)'; g.shadowBlur = fs*0.2;
    g.fillStyle = style === 'karaoke' ? (state === 1 ? ES.ACCENT : state === 2 ? '#fff' : 'rgba(255,255,255,0.55)') : (state === 1 && style === 'pop' ? ES.ACCENT : '#fff');
    g.fillText(txt, 0, 0);
  }
  g.restore();
}
function speakingVoice(){ if(ES.kind === 'talk' && ES.talk) return { x: ES.talk.voice, sr: ES.talk.sr }; if(ES.vo) return { x: ES.vo.pcm, sr: ES.vo.sr }; return null; }
function markKeyWords(lines){
  const V = speakingVoice(); if(!lines) return;
  const loud = w => { if(!V) return 0; const a = Math.max(0, Math.floor(w.start*V.sr)), b = Math.min(V.x.length, Math.ceil(Math.max(w.end, w.start + 0.08)*V.sr)); let s2 = 0; for(let i=a;i<b;i+=4) s2 += V.x[i]*V.x[i]; return Math.sqrt(s2/Math.max(1, (b-a)/4)); };
  for(const L of lines){
    L.words.forEach(w => { w.key = false; w.emoji = ''; });
    if(!ES.keyOn || !V) continue;
    const cands = L.words.map(w => { const t = String(w.text).replace(/[.,!?।"'“”]/g, ''), low = t.toLowerCase();
      if(!t || EH.STOP.has(low) || (t.length < 3 && !/\d/.test(t))) return null;
      return { w, sc: loud(w)*(1 + 0.08*Math.min(8, [...t].length)) * (/\d|₹/.test(t) ? 1.4 : 1) }; }).filter(Boolean);
    if(!cands.length) continue;
    const top = cands.reduce((q, c) => c.sc > q.sc ? c : q, cands[0]);
    top.w.key = true; const em = EH.EMOJI.find(([re]) => re.test(top.w.text)); top.w.emoji = em ? em[1] : '';
  }
}
// the zoom punch at time t: 1 when there is none
function emphAt(t){
  if(!ES.keyOn || !ES.capsOn || !ES.capLines || !speakingVoice()) return 1;
  let z = 1;
  for(const L of ES.capLines){ if(L.a > t + 0.01 || L.b < t - 1) continue; for(const w of L.words){ if(!w.key) continue; const d = t - w.start; if(d < 0 || d > 0.72) continue;
    z = Math.max(z, d < 0.12 ? 1 + 0.08*EH.EASE.outCubic(d/0.12) : 1 + 0.08*(1 - EH.EASE.inOut((d - 0.12)/0.6))); } }
  return z;
}
function ovTiming(ov){ const L = EH.reelLen(); return ov.all ? [0, L] : [Math.max(0, Math.min(ov.t0, L)), Math.max(0, Math.min(ov.t1, L))]; }
function kxAt(c, l){ const K = c.kx; if(!Array.isArray(K) || !K.length || l === undefined) return c;
  let a = K[0], b = K[0], p = 0;
  if(l >= K[K.length-1].t) a = b = K[K.length-1];
  else if(l > K[0].t) for(let k=1;k<K.length;k++) if(l <= K[k].t){ a = K[k-1]; b = K[k]; p = (EH.EASE[b.ez || 'inOut'] || EH.EASE.inOut)((l - a.t)/Math.max(1e-6, b.t - a.t)); break; }
  const o = { ...c }, mix = (x, y, d) => { const A = x ?? d, B = y ?? d; return A + (B - A)*p; };
  for(const n of EH.KX) if(n in a || n in b) o[n] = mix(a[n], b[n], c[n] ?? EH.KX_D[n] ?? EH.CS0[n] ?? 0);
  if(c.mk && (a.mk || b.mk)){ o.mk = { ...c.mk }; for(const n of EH.KX_MK) o.mk[n] = mix(a.mk && a.mk[n], b.mk && b.mk[n], c.mk[n]); }
  return o; }
   // display -> source, per quarter turn
// display uv -> source uv: the picture is turned, then mirrored / flipped
function csMat(c){ const R = EH.ROTI[(c.rot/90)&3], fx = c.fh ? -1 : 1, fy = c.fv ? -1 : 1; return [R[0]*fx, R[1]*fy, R[2]*fx, R[3]*fy]; }
// a point of the source (0..1) on the display
function csFwd(c, x, y){ const R = EH.ROTI[(c.rot/90)&3], sx = x-0.5, sy = y-0.5; return [(R[0]*sx + R[2]*sy)*(c.fh?-1:1) + 0.5, (R[1]*sx + R[3]*sy)*(c.fv?-1:1) + 0.5]; }
function csCam(e, local, c){ if(c.cx != null && c.cy != null) return [c.cx, c.cy]; const [x, y] = camAt(e, local); return c.rot || c.fh || c.fv ? csFwd(c, x, y) : [x, y]; }
/* stabilize (basic): the camera's own shake, measured while the clip was read (a global shift per frame), is taken out:
 * the path of the camera is smoothed over about 0.8 s and the picture is moved by what the smoothing removed, a little
 * zoomed so no edge shows */
function stabPath(src){
  if(src._stab) return src._stab; const S = src.samples || []; if(S.length < 4) return null;
  const t = S.map(x => x.t), cx = [0], cy = [0];
  for(let k = 1; k < S.length; k++){ cx.push(cx[k-1] + (S[k].gx || 0)/EH.SW); cy.push(cy[k-1] + (S[k].gy || 0)/EH.SH); }
  const dt = Math.max(1e-3, (t[t.length-1] - t[0])/(t.length - 1)), R = Math.max(2, Math.round(0.4/dt));
  const sm = a => a.map((_, k) => { let s = 0, w = 0; for(let j = Math.max(0, k - R); j <= Math.min(a.length - 1, k + R); j++){ const g = Math.exp(-(((j - k)/(R*0.6))**2)); s += a[j]*g; w += g; } return s/w; });
  const sx = sm(cx), sy = sm(cy);
  return (src._stab = { t, dx: cx.map((v, k) => sx[k] - v), dy: cy.map((v, k) => sy[k] - v) });
}
function stabAt(src, st){ const P = stabPath(src); if(!P) return null; const t = P.t; let lo = 0, hi = t.length - 1;
  if(st <= t[0]) return [P.dx[0], P.dy[0]]; if(st >= t[hi]) return [P.dx[hi], P.dy[hi]];
  while(hi - lo > 1){ const m = (lo + hi) >> 1; if(t[m] <= st) lo = m; else hi = m; } const f = (st - t[lo])/Math.max(1e-6, t[hi] - t[lo]);
  return [P.dx[lo] + (P.dx[hi] - P.dx[lo])*f, P.dy[lo] + (P.dy[hi] - P.dy[lo])*f]; }
// a clip smaller than it is shown (a 480p or 720p video in a 1080p or 4K Reel): sharpened in step with how much it is
// enlarged, so the chosen quality looks like that quality (a clip at its own size or larger: untouched)
function upSharp(e, dh){ const src = EH.sources[e.src], h = src && (src.h || src.w); if(!h || !(dh > 0)) return 0; const up = dh / h; return up > 1.15 ? Math.min(0.55, (up - 1) * 0.3) : 0; }
function captionOf(){
  const t = EH.CAP_TPL[ES.tplName] || ['', ES.kind === 'talk' ? '#reels #creator #reelsindia' : '#reels #reelsinstagram #trending #explorepage'];
  const tplHook = ES.tplName && ES.TEMPLATES[ES.tplName] ? ES.TEMPLATES[ES.tplName].hook : undefined;
  const hook = ES.hookText && ES.hookText !== tplHook ? ES.hookText.trim() : '';
  const songName = ES.kind !== 'talk' && ES.song && ES.song.name ? ES.song.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() : '';
  const lines = [];
  if(hook) lines.push(hook === hook.toUpperCase() ? hook.charAt(0) + hook.slice(1).toLowerCase() : hook);   // the screen's CAPITALS read as shouting in a caption
  if(t[0]) lines.push(t[0]);
  if(songName && !/^(audio|song|track|music|rec|recording|voice)\s*\d*$/i.test(songName)) lines.push('🎵 ' + songName);
  if(!lines.length) lines.push('✨');
  return lines.join('\n') + '\n\n' + t[1];
}
function noSongTip(){
  if(ES.kind === 'talk') return 'your voice is in the video; add any song as Instagram\'s sound, quietly under it.';
  const nm = ES.song ? ES.song.name.replace(/\.[^.]+$/, '') : 'the song';
  return 'in Instagram tap "Add audio", choose "' + nm + '" and start it at ' + fmt(ES.secStart).replace(/\.\d+$/, '') + (ES.vo ? ' (your voiceover is in the video)' : '') + ' — the cuts land on its beats.';
}
function exportDims(){ const [W0,H0] = EH.SIZES[ES.aspect], k = EH.XQ[EH.xq.res].scale; return [Math.round(W0*k/2)*2, Math.round(H0*k/2)*2]; }
function cutKind(fr, hint){
  if(fr.length < 6) return hint === 'cut' ? 'hard' : hint;
  const endF = fr.filter(f=>Math.abs(f.k) >= EH.CUT_K-1), ends = (endF.length >= 2 ? endF : [fr[0], fr[fr.length-1]]).map(f=>f.mean).sort((a,b)=>a-b), endMed = ends[Math.floor((ends.length-1)/2)];
  const mid = fr.filter(f=>Math.abs(f.k) <= 4), maxB = Math.max(...mid.map(f=>f.mean)), minB = Math.min(...mid.map(f=>f.mean));
  if(minB < 0.07 && endMed > 0.12) return 'fade';
  // a flash is brighter than BOTH shots around it (a cut into a bright shot is not a flash)
  const endOf = side => { const q = fr.filter(f=>side < 0 ? f.k <= -(EH.CUT_K-1) : f.k >= EH.CUT_K-1).map(f=>f.mean); return q.length ? q.reduce((a,b)=>a+b,0)/q.length : endMed; };
  const brighter = maxB - Math.max(endOf(-1), endOf(1));
  if(maxB > 0.78 && maxB > endMed + 0.22 && brighter > 0.15) return 'flash';
  // the reading may have landed at the end of a flash: a white spike a few frames earlier is the cut
  const early = fr.filter(f=>f.k < -2 && f.k >= -EH.CUT_K), eMax = early.length ? early.reduce((q,f)=>f.mean > q.mean ? f : q, early[0]) : null;
  if(eMax && eMax.mean > 0.78){
    // the shot after it (from 2 frames past the cut read) and whatever comes before the white frame
    const after = fr.filter(f=>f.k >= 2).map(f=>f.mean).sort((a,b)=>a-b), before = fr.filter(f=>f.k < eMax.k).map(f=>f.mean);
    const aMed = after.length ? after[(after.length-1)>>1] : endMed;
    if(eMax.mean > aMed + 0.22 && (!before.length || eMax.mean > Math.max(...before) + 0.08)){ fr.shiftTo = eMax.k; return 'flash'; }
  }
  const before = fr.filter(f=>f.k <= 0 && f.k >= -4 && f.dx !== undefined);
  const whip = before.filter(f=>Math.abs(f.dx) >= 5 || f.aniso < 0.3).length >= 2;   // a sideways jump or blur
  if(fr.spin && !whip) return 'spin';
  if(fr.glitch) return 'glitch';
  if(whip) return 'whip';
  if(before.filter(f=>f.sc >= 1.06).length >= 2) return 'zoom';
  if(hint === 'dissolve') return 'dissolve';
  if(hint === 'fade') return 'fade';
  return 'hard';
}
function describeRef(R){
  const L = R.look || {}, words = [];
  if(L.sat < 0.05) words.push('black & white'); else if(L.sat > 0.42) words.push('saturated'); else if(L.sat < 0.22) words.push('muted colours');
  if(L.sat >= 0.05){ if(L.warm > 0.07) words.push('warm'); else if(L.warm < -0.05) words.push('cool'); if(L.split > 0.25) words.push('teal-orange'); }
  if(L.std > 0.25) words.push('high contrast'); if(L.p5 > 0.12) words.push('faded blacks'); if(L.vig > 0.25) words.push('vignette'); if(L.grain > 0.01) words.push('film grain');
  const tr = Object.entries(R.trans).sort((a,b)=>b[1]-a[1]).map(([k,v])=>Math.round(v*100)+'% '+EH.REF_KINDS[k]).join(', ');
  const pace = R.medianBeats ? 'a cut every ' + R.medianBeats + ' beat' + (R.medianBeats===1?'':'s') + ' (' + Math.round(R.onBeat*100) + '% on the beat)' : 'a cut every ' + R.medianSec.toFixed(1) + ' s';
  return (R.learned ? 'typically ' : R.cuts.length + ' cuts in ' + R.dur.toFixed(0) + ' s · ') + pace + (R.energy !== 'steady' ? ' · pace ' + R.energy : '') + ' · ' + (tr || 'no cuts') +
    (R.zoomShare > 0.15 ? ' · zooms in ' + Math.round(R.zoomShare*100) + '% of shots' : '') + (words.length ? ' · ' + words.join(', ') : '');
}
function copyPlanTimed(){
  const R = ES.refProfile, M = R.moments, dur = ES.buf.duration, off = ES.secStart || 0, out = [];
  const typeAt = t => { const b = ES.basePlan.find(s=>Math.abs(s.start - t) < 0.06); return b ? b.type : 'cut'; };
  M.forEach((m, i) => {
    const a = Math.max(0, m.at - off), b = Math.min(dur, m.at + m.sec - off);
    if(b - a < 1/30 - 1e-3 || a >= dur - 1/30) return;
    out.push({ start: out.length ? a : 0, end: b, type: out.length ? typeAt(a) : (ES.basePlan[0] ? ES.basePlan[0].type : 'cut'), fx: 'Hard cut', ref: i, flick: !!m.flick, black: !!m.black });
  });
  if(!out.length) return copyPlan();
  for(let i=1;i<out.length;i++) out[i].start = out[i-1].end;   // no gaps
  out[out.length-1].end = dur;   // the song goes on past the last shot read: the last shot holds
  return out;
}
// the edit's cut points: the reference's sequence of shot lengths (in beats), on this song's beats; its drops and breaks stay
function copyPlan(){
  const R = ES.refProfile, dur = ES.buf.duration, P0 = ES.period || 0.5;
  const bt = ES.beats.map(b=>b-1/30).filter(b=>b>0.2 && b<dur-0.3);
  const keep = ES.basePlan.filter(s=>s.type==='drop' || s.type==='break').map(s=>s.start);
  const seq = R.shotBeats.length ? R.shotBeats.slice(1) : [], wantAt = k => R.medianBeats ? (seq.length ? seq[(k) % seq.length] : R.medianBeats) : 0;
  const typeAt = t => { const b = ES.basePlan.find(s=>Math.abs(s.start - t) < 0.06); return b ? b.type : 'cut'; };
  // which of the reference's shots shot k copies: the hook, then its sequence over and over
  const nRef = R.medianBeats ? (R.shotBeats || []).length : (R.shotSec || []).length;
  const refIdx = k => nRef < 2 ? 0 : k === 0 ? 0 : R.medianBeats ? 1 + (k-1) % (nRef-1) : k % nRef;
  // as long as the reference's own longest shot (a calm Reel's 5 s shot stays 5 s), never under 3.5 s nor over 12 s
  const LMAX = Math.min(12, Math.max(3.5, ...(R.medianBeats ? (R.shotBeats || []).map(b=>b*P0) : (R.shotSec || []))) + 0.05);
  const out = []; let start = 0, k = 0;
  while(start < dur - 0.3){
    let len = R.medianBeats ? (k === 0 ? (R.hookBeats || wantAt(0)) : wantAt(k-1))*P0 : (k === 0 ? R.hookSec : R.shotSec[k % R.shotSec.length]);
    // pace curve: a rising Reel gets shorter shots towards the end (already in its sequence when it repeats; scaled here)
    len = Math.min(LMAX, Math.max(0.1, len));   // a stutter of a tenth of a second stays one
    let end = start + len;
    const drop = keep.find(t => t > start + 0.08 && t < end + 0.5*P0);
    if(drop !== undefined && drop - start < 0.5*len && out.length){ out[out.length-1].end = drop; start = drop; continue; }   // a sliver before a drop joins the shot before it
    if(drop !== undefined) end = drop;
    else if(bt.length){
      // on the beat; a shot shorter than a beat (the Reel's eighth-note cuts, its stutters) on half beats
      const half = len < 0.9*P0, grid = half ? bt.concat(bt.slice(1).map((x,i)=>(x + bt[i])/2)) : bt, step = half ? P0/2 : P0;
      const b = grid.reduce((q,x)=>Math.abs(x-end) < Math.abs(q-end) ? x : q, grid[0]); if(Math.abs(b-end) < 0.6*step && b > start + Math.min(0.25, 0.6*len)) end = b; }
    if(end > dur - 0.35) end = dur;
    out.push({ start, end, type: k === 0 ? (ES.basePlan[0] ? ES.basePlan[0].type : 'cut') : typeAt(start), fx: 'Hard cut', ref: refIdx(k) });
    start = end; k++;
  }
  return out;
}
function copyStyle(){
  const R = ES.refProfile, n = ES.plan.length - 1; if(n < 1) return;
  const kinds = Object.keys(R.trans), want = {};
  let acc = 0; kinds.forEach(k=>{ want[k] = Math.floor(R.trans[k]*n); acc += want[k]; });
  kinds.map(k=>[k, R.trans[k]*n - want[k]]).sort((a,b)=>b[1]-a[1]).slice(0, n-acc).forEach(([k])=>{ want[k]++; });
  const energy = i => { const s = ES.plan[i]; return (s.type==='drop' ? 3 : s.type==='hit' ? 2 : s.type==='break' ? -1 : 0) - 0.3*(s.end-s.start); };
  const idx = ES.plan.map((s,i)=>i).slice(1), free = new Set(idx);
  ES.plan.forEach((s,i)=>{ s.tr = i===0 ? 'hard' : 'hard'; s.efx = i===0 ? 'none' : 'none'; s.sp = EH.SPEED.normal; });
  const place = (k, order) => { let c = want[k] || 0; for(const i of order){ if(!c) break; if(!free.has(i)) continue;
      if(ES.plan[i-1] && ES.plan[i-1].tr === EH.REF_TR[k] && k !== 'hard') continue; ES.plan[i].tr = EH.REF_TR[k]; free.delete(i); c--; }
    for(const i of order){ if(!c) break; if(free.has(i)){ ES.plan[i].tr = EH.REF_TR[k]; free.delete(i); c--; } } };
  const hot = [...idx].sort((a,b)=>energy(b)-energy(a)), calm = [...idx].sort((a,b)=>energy(a)-energy(b));
  ['flash','zoom','whip','glitch','spin','blur'].forEach(k=>place(k, hot)); ['dissolve','fade','iris','diamond','heart','star','wipe','bars'].forEach(k=>place(k, calm));
  // zooms inside shots: on that share of shots, the longest first
  const longI = [...ES.plan.keys()].filter(i=>ES.plan[i].end-ES.plan[i].start >= 0.9), zn = Math.round(Math.min(1, R.zoomShare)*longI.length);
  longI.sort((a,b)=>(ES.plan[b].end-ES.plan[b].start)-(ES.plan[a].end-ES.plan[a].start)).slice(0, zn).forEach(i=>{ ES.plan[i].efx = (ES.plan[i].end-ES.plan[i].start) > 1.2 ? 'pan' : 'punch-soft'; });
  ES.copyBudget = {}; Object.entries(want).forEach(([k,v])=>{ if(k!=='hard') ES.copyBudget[EH.REF_TR[k]] = v; });
  copyShots();
}
function copyShots(){
  if(!EH.copyExact()) return;
  const M = ES.refProfile.moments, clip = (x, a, b) => Math.min(b, Math.max(a, Number.isFinite(+x) ? +x : a));
  ES.plan.forEach((s,i)=>{
    const m = M[s.ref ?? i]; if(!m) return;
    const len = s.end - s.start;
    if(i > 0 && !ES.refProfile.learned){ const tr = m.tr === 'start' ? 'hard' : EH.REF_TR[m.tr] || 'hard'; s.tr = tr; s.trByRef = tr !== 'hard'; }
    s.efx = 'none'; s.ak = []; s.flick = !!m.flick; s.black = !!m.black && EH.copyTimed();   // the black end only where the Reel had it
    if(s.flick || s.black) return;   // a flicker: a new still of the clips on every frame (flickPick), no move of its own
    if(Array.isArray(m.move) && m.move.length >= 2 && len >= 0.3){
      const ez = m.move.length === 2 ? (m.ease || 'inOut') : 'lin';   // more keys: the path's own shape is in them
      s.ak = m.move.map(k=>({ t: +(clip(k.f, 0, 1)*len).toFixed(3), s: clip(k.s, 0.4, 2.5), x: clip(k.x, -0.6, 0.6), y: clip(k.y, -0.6, 0.6), r: clip(k.r, -60, 60), o: 1, ez }));
    } else if(m.zoom === 'in' || m.zoom === 'out') s.efx = len > 1.2 ? 'pan' : 'punch-soft';
    if(m.shake && !s.ak.length) s.efx = 'shake';
  });
}
function copyMatch(){
  const R = ES.refProfile; if(ES.mode !== 'copy' || !R || !ES.edit.length) return null;
  const M = R.moments || [], P0 = ES.period || 0.5, r = x => Math.round(x*100), timed = EH.copyTimed();
  let pace = 0, pn = 0, tr = 0, tn = 0, mv = 0, mn = 0;
  ES.edit.forEach((e,i)=>{
    const m = M[e.ref ?? i]; if(!m || i === ES.edit.length - 1) return;
    const want = timed ? m.sec : R.medianBeats && m.beats ? m.beats*P0 : m.sec, got = e.end - e.start;
    if(want > 0){ pace += Math.max(0, 1 - Math.abs(Math.log2(got/want))); pn++; }
    if(i > 0 && !R.learned){ tr += e.tr === (m.tr === 'start' ? 'hard' : EH.REF_TR[m.tr] || 'hard') ? 1 : 0; tn++; }
    const wantMove = !!(m.move && m.move.length >= 2) || m.zoom === 'in' || m.zoom === 'out', gotMove = !!(e.ak && e.ak.length >= 2) || ['pan','punch-soft','pan-soft'].includes(e.efx);
    mv += wantMove === gotMove ? 1 : 0; mn++;
  });
  if(!pn) return null;
  // a learned style: the edit's transition shares against the style's (half the summed difference = 0)
  if(R.learned && ES.edit.length > 2){ const got = {}, n = ES.edit.length - 1; ES.edit.slice(1).forEach(e=>{ got[e.tr] = (got[e.tr]||0) + 1/n; });
    const want = {}; Object.entries(R.trans || {}).forEach(([k,v])=>{ const t = EH.REF_TR[k] || 'hard'; want[t] = (want[t]||0) + v; });
    let l1 = 0; new Set([...Object.keys(got), ...Object.keys(want)]).forEach(k=>{ l1 += Math.abs((got[k]||0) - (want[k]||0)); }); tr = 1 - l1/2; tn = 1; }
  // shots the edit does not have count as misses (an edit with a third of the Reel's cuts is not 90% alike)
  const inSong = timed ? M.filter(m => m.at - (ES.secStart || 0) < ES.buf.duration - 0.05 && m.at + m.sec - (ES.secStart || 0) > 0).length : 0;
  const cover = inSong ? Math.min(1, ES.edit.length/inSong) : 1;
  const parts = { rhythm: cover*pace/pn, transitions: tn ? tr/tn : 1, moves: mn ? mv/mn : 1, look: ES.copyLookScore };
  const w = { rhythm: 0.35, transitions: 0.3, moves: 0.15, look: 0.2 }; let s = 0, ws = 0;
  for(const k of Object.keys(w)) if(parts[k] !== null && parts[k] !== undefined){ s += w[k]*parts[k]; ws += w[k]; }
  return { total: r(s/ws), rhythm: r(parts.rhythm), transitions: r(parts.transitions), moves: r(parts.moves), look: parts.look === null ? null : r(parts.look), shots: pn };
}
function fingerprintOf(R){
  const tr = {}; for(const [k, v] of Object.entries(R.trans || {})) if(Object.keys(EH.REF_KINDS).includes(k)) tr[k] = EH.clip(v, 0, 1);
  const L = R.look || null, look = L ? Object.fromEntries(['mean','std','sat','warm','p5','p95','vig','grain','split'].filter(k => Number.isFinite(L[k])).map(k => [k, EH.clip(L[k], k === 'warm' || k === 'vig' || k === 'split' ? -1 : 0, k === 'sat' ? 2 : 1)])) : null;
  return { dur: EH.clip(R.dur, 1, 600), bpm: EH.clip(R.bpm || 0, 0, 300), medianBeats: EH.clip(R.medianBeats || 0, 0, 64), medianSec: EH.clip(R.medianSec || 0, 0, 60), hookBeats: EH.clip(R.hookBeats || 0, 0, 64), hookSec: EH.clip(R.hookSec || 0, 0, 60),
    onBeat: EH.clip(R.onBeat || 0, 0, 1), energy: ['steady','rising','falling'].includes(R.energy) ? R.energy : 'steady', zoomShare: EH.clip(R.zoomShare || 0, 0, 1), trans: tr, look,
    shotBeats: (R.shotBeats || []).slice(0, 300).map(x => EH.clip(x, 0, 64)), shotSec: (R.shotSec || []).slice(0, 300).map(x => EH.clip(x, 0, 60)),
    moments: cleanMoments(R.moments, 200) };
}
function voPcm(){ if(!ES.vo) return null; if(ES.au.vfx === 'none') return ES.vo.pcm;
  const k = ES.vo.key + '|' + ES.au.vfx + '|' + ES.denoiseOn; if(!EH.fxCache.has(k)){ EH.fxCache.clear(); EH.fxCache.set(k, voiceFx(ES.vo.pcm, ES.vo.sr, ES.au.vfx)); } return EH.fxCache.get(k); }
function sfxSynth(kind, sr){
  const key = kind + sr; if(EH.sfxCache.has(key)) return EH.sfxCache.get(key);
  const len = { whoosh: 0.42, pop: 0.09, boom: 0.9, click: 0.09, riser: 1.2, ding: 0.7, swish: 0.22, impact: 0.6, glitch: 0.35, laser: 0.3, heartbeat: 0.8, tick: 0.03, chime: 1.4, drop: 1.4, rewind: 0.7, notify: 0.45 }[kind] || 0.3, n = Math.round(len*sr), y = new Float32Array(n);
  let seed = 7; const rnd = () => { seed = (seed*16807) % 2147483647; return seed/2147483647*2 - 1; };
  let lp = 0, ph = 0;
  for(let i = 0; i < n; i++){ const t = i/sr, f = t/len;
    if(kind === 'whoosh'){ const cut = 400 + 5000*Math.sin(Math.PI*f), a = Math.exp(-2*Math.PI*cut/sr); lp = (1 - a)*rnd() + a*lp; y[i] = lp*Math.sin(Math.PI*f)**1.5*1.6; }
    else if(kind === 'pop'){ ph += 2*Math.PI*(700 - 450*f)/sr; y[i] = Math.sin(ph)*Math.exp(-t/0.025); }
    else if(kind === 'boom'){ ph += 2*Math.PI*(70 - 30*f)/sr; y[i] = Math.sin(ph)*Math.exp(-t/0.28) + rnd()*0.3*Math.exp(-t/0.03); }
    else if(kind === 'click'){ y[i] = rnd()*(Math.exp(-t/0.004) + (t > 0.045 ? 0.7*Math.exp(-(t - 0.045)/0.006) : 0)); }
    else if(kind === 'riser'){ const a = Math.exp(-2*Math.PI*(300 + 6000*f*f)/sr); lp = (1 - a)*rnd() + a*lp; ph += 2*Math.PI*(200 + 900*f*f)/sr; y[i] = (lp*1.4 + Math.sin(ph)*0.25)*f*f; }
    else if(kind === 'ding'){ y[i] = (Math.sin(2*Math.PI*1320*t) + 0.5*Math.sin(2*Math.PI*1980*t))*Math.exp(-t/0.18)*0.7; }
    else if(kind === 'swish'){ const a = Math.exp(-2*Math.PI*(2500 + 6000*f)/sr); lp = (1 - a)*rnd() + a*lp; y[i] = (rnd() - lp)*Math.sin(Math.PI*f)**2; }
    else if(kind === 'impact'){ ph += 2*Math.PI*(55 - 20*f)/sr; y[i] = Math.tanh(2*Math.sin(ph))*Math.exp(-t/0.2) + rnd()*0.6*Math.exp(-t/0.015); }
    else if(kind === 'glitch'){ const blk = Math.floor(t*40); ph += 2*Math.PI*(200 + (blk*397 % 1800))/sr; y[i] = ((blk % 3) ? Math.sign(Math.sin(ph))*0.5 : rnd()*0.7)*(blk % 5 === 4 ? 0 : 1); }
    else if(kind === 'laser'){ ph += 2*Math.PI*(2400*Math.exp(-f*3) + 200)/sr; y[i] = Math.sign(Math.sin(ph))*0.4*Math.exp(-t/0.15); }
    else if(kind === 'heartbeat'){ const b = (x, at) => { const d = x - at; return d < 0 ? 0 : Math.sin(2*Math.PI*55*d)*Math.exp(-d/0.06); }; y[i] = b(t, 0) + 0.8*b(t, 0.22); }
    else if(kind === 'tick'){ y[i] = Math.sin(2*Math.PI*3200*t)*Math.exp(-t/0.004); }
    else if(kind === 'chime'){ y[i] = [1, 1.5, 2, 2.67].reduce((s, m, k) => s + Math.sin(2*Math.PI*880*m*t)*Math.exp(-Math.max(0, t - k*0.08)/0.5)*(t >= k*0.08 ? 1 : 0), 0)*0.3; }
    else if(kind === 'drop'){ ph += 2*Math.PI*(180*Math.exp(-f*4) + 35)/sr; y[i] = Math.sin(ph)*(1 - f)**0.5; }
    else if(kind === 'rewind'){ const a = Math.exp(-2*Math.PI*(800 + 3000*(1 - f))/sr); lp = (1 - a)*rnd() + a*lp; ph += 2*Math.PI*(1400 - 1000*f)/sr; y[i] = (lp + 0.25*Math.sin(ph)*Math.sin(2*Math.PI*18*t))*Math.sin(Math.PI*f); }
    else if(kind === 'notify'){ const tone = t < 0.15 ? 988 : 1319, d = t < 0.15 ? t : t - 0.15; y[i] = Math.sin(2*Math.PI*tone*t)*Math.exp(-d/0.12)*0.6; } }
  let pk = 0; for(const v of y) pk = Math.max(pk, Math.abs(v)); for(let i = 0; i < n; i++) y[i] *= 0.5/Math.max(1e-6, pk);
  EH.sfxCache.set(key, y); return y;
}
function sfxEvents(){
  const out = ES.sfxList.map(x => ({ at: x.at, kind: x.kind }));
  if(ES.au.sfx && ES.kind !== 'talk'){ let lastW = -9;
    ES.edit.forEach((e, i) => { if(!i) return;
      if(EH.WHOOSH_TR.includes(e.tr) && e.start - lastW > 0.8){ out.push({ at: Math.max(0, e.start - 0.2), kind: 'whoosh' }); lastW = e.start; }
      else if((e.tr === 'flash' || e.tr === 'burn') && e.type === 'drop') out.push({ at: e.start, kind: 'boom' });
      if(e.efx === 'snap' || (e.sp && e.sp.label === 'Freeze frame')) out.push({ at: e.start, kind: 'click' }); });
    for(const o of ES.overlays) if(o.anim === 'pop' && !o.all && o.t0 > 0.05) out.push({ at: o.t0, kind: 'pop' }); }
  return out;
}
/* ---- voice changer (on the phone): deep, chipmunk, robot, radio, echo ---- */
// pitch without changing the length: two crossfaded read heads sliding through a short delay line
function pitchShift(x, sr, ratio){
  const W = Math.round(0.05*sr), y = new Float32Array(x.length); let ph = 0; const step = (1 - ratio)/W;
  for(let i=0;i<x.length;i++){
    ph += step; ph -= Math.floor(ph);
    const d1 = ph*W, d2 = ((ph + 0.5) % 1)*W, g1 = 1 - Math.abs(2*ph - 1), g2 = 1 - g1;
    const r = (d) => { const p = i - d, k = Math.floor(p), f = p - k; return k < 0 ? 0 : (x[k] || 0)*(1 - f) + (x[k+1] || 0)*f; };
    y[i] = r(d1)*g1 + r(d2)*g2;
  }
  return y;
}
function voiceFx(x, sr, fx){
  if(fx === 'deep') return pitchShift(x, sr, 0.74);
  if(fx === 'chipmunk') return pitchShift(x, sr, 1.55);
  const y = new Float32Array(x.length);
  if(fx === 'robot'){ const p = pitchShift(x, sr, 0.92); for(let i=0;i<x.length;i++) y[i] = p[i]*(0.55 + 0.45*Math.sin(2*Math.PI*55*i/sr))*1.4; return y; }
  if(fx === 'radio'){ // telephone band (300-3400 Hz) and a little crunch
    let lp = 0, hp = 0, px = 0; const a1 = Math.exp(-2*Math.PI*3400/sr), a2 = Math.exp(-2*Math.PI*300/sr);
    for(let i=0;i<x.length;i++){ lp = (1 - a1)*x[i] + a1*lp; hp = a2*(hp + lp - px); px = lp; y[i] = Math.tanh(hp*3)*0.6; } return y; }
  if(fx === 'enhance'){ // voice enhance (as CapCut's): rumble out (high-pass 90 Hz), the voice's presence (2-5 kHz) up, gently levelled, peaks at -1 dB
    let hp = 0, px = 0, lo = 0, lo2 = 0, env = 0; const ah = Math.exp(-2*Math.PI*90/sr), aL = Math.exp(-2*Math.PI*5000/sr), aH = Math.exp(-2*Math.PI*2000/sr), att = Math.exp(-1/(0.005*sr)), rel = Math.exp(-1/(0.12*sr));
    for(let i=0;i<x.length;i++){ hp = ah*(hp + x[i] - px); px = x[i]; lo = (1 - aL)*hp + aL*lo; lo2 = (1 - aH)*hp + aH*lo2;
      const v = hp + 0.45*(lo - lo2), a = Math.abs(v); env = a > env ? att*env + (1 - att)*a : rel*env + (1 - rel)*a;
      y[i] = v*(env > 0.12 ? Math.pow(0.12/env, 0.5) : 1); }
    let pk = 0; for(let i=0;i<y.length;i++) pk = Math.max(pk, Math.abs(y[i])); if(pk > 0){ const g = Math.min(4, 0.89/pk); for(let i=0;i<y.length;i++) y[i] *= g; } return y; }
  if(fx === 'echo'){ const d = Math.round(0.24*sr); for(let i=0;i<x.length;i++) y[i] = x[i] + (i >= d ? y[i-d]*0.42 : 0); return y; }
  return x;
}
function csAutoSet(e, patch){
  e.cs = e.cs || {}; const auto = e.cs.auto || [];
  for(const k in patch){ if(k in e.cs && !auto.includes(k)) continue; e.cs[k] = patch[k]; if(!auto.includes(k)) auto.push(k); }
  if(auto.length) e.cs.auto = auto; if(!Object.keys(e.cs).length) e.cs = undefined;
}
function csAutoClear(e){ if(!e.cs || !e.cs.auto) return; for(const k of e.cs.auto) delete e.cs[k]; delete e.cs.auto; if(!Object.keys(e.cs).length) e.cs = undefined; }
function speechShare(s, a, b){ const S = s.speech; if(!S) return 0; const i0 = Math.max(0, Math.floor(a/S.hop)), i1 = Math.min(S.p.length, Math.ceil(b/S.hop)); let n = 0; for(let i=i0;i<i1;i++) if(S.p[i] > 0.5) n++; return i1 > i0 ? n/(i1 - i0) : 0; }
async function storyVoice(text, voice, onP){
  if(!EH.tts) throw new Error('Text to speech is not available here.');
  const ss = EH.storySentences(text); if(!ss.length) throw new Error('Write a few sentences first.');
  const parts = []; let sr = 22050;
  for(let k=0;k<ss.length;k++){ const r = await EH.tts.speak(ss[k], voice, (p) => onP && onP((k + (p.stage === 'speak' ? p.p : p.p*0.5))/ss.length, p.stage)); parts.push(r.pcm); sr = r.sr; }
  // the speech of each sentence without its silent ends, then a short pause; a breath before the first and after the last
  const trim = (x) => { let a = 0, b = x.length; while(a < b && Math.abs(x[a]) < 0.01) a++; while(b > a && Math.abs(x[b-1]) < 0.01) b--; return x.subarray(Math.max(0, a - Math.round(0.03*sr)), Math.min(x.length, b + Math.round(0.05*sr))); };
  const lead = Math.round(0.35*sr), gap = Math.round(0.32*sr), tail = Math.round(0.8*sr), cut = parts.map(trim);
  const N = lead + cut.reduce((q, x) => q + x.length, 0) + gap*(cut.length - 1) + tail, pcm = new Float32Array(N), scenes = [], words = [];
  let o = lead;
  cut.forEach((x, k) => { pcm.set(x, o); const a = o/sr, b = (o + x.length)/sr; scenes.push({ a, b, text: ss[k] });
    // each word's time: its share of the sentence's letters (the voice speaks at an even pace)
    const ws = ss[k].split(/\s+/).filter(Boolean), L = ws.reduce((q, w) => q + w.length + 1, 0); let c = 0;
    for(const w of ws){ const s0 = a + (b - a)*c/L; c += w.length + 1; words.push({ text: w, start: s0, end: a + (b - a)*c/L }); }
    o += x.length + gap; });
  return { pcm, sr, scenes, words, dur: N/sr };
}
function remakeOk(){ if(!ES.restoring) ES.keepSaved = false; }
function editOf(){
  return ES.kind === 'talk' ? [] : ES.edit.map(e => ({ start: e.start, end: e.end, type: e.type, fx: e.fx, tr: e.tr, efx: e.efx, sp: EH.speedKey(e.sp), src: e.src, in: e.in, scaleR: e.scaleR, cx: e.cx, cy: e.cy, face: e.face, fs: e.fs, uk: e.uk && e.uk.length ? e.uk : undefined, acc: e.acc && e.acc.length ? e.acc : undefined, ak: e.ak && e.ak.length ? e.ak : undefined, cs: e.cs ? JSON.parse(JSON.stringify(e.cs)) : undefined, flick: e.flick || undefined, trd: e.trd ?? undefined, black: e.black || undefined }));
}
  return { flickPick, withMarks, drumness, snap, adaptPlan, beatEdit, noFlashCuts, adaptPlan0, buildPlan, partBeats, bestPart, snapToBeat, songParts, applyParts, partAt, gridOf, withPartCuts, partsOfSong, colorHist, saliency, subjectMotion, trackFaces, previewBatchClose, speechParts, rng, kf, uAt, accentAt, reelIdNow, aiTags, aiAt, aiTimes, planLine, recipeNow, tastePlan, finishTransitions, directorCandidates, mixStore, cutMusic, refitDirector, getSoundMap, cleanMoments, refContext, wholeSections, paceFromSong, camPath, camAt, clipFlaw, scoreWindow, ukKeep, ukRestore, seqSlots, seqPick, kfSummary, speedFor, assignPlayers, repick, kxSet, histSnap, histBase, segAt, strongHit, beatPulse, drawWord, speakingVoice, markKeyWords, emphAt, ovTiming, kxAt, csMat, csFwd, csCam, stabPath, stabAt, upSharp, captionOf, noSongTip, exportDims, cutKind, describeRef, copyPlanTimed, copyPlan, copyStyle, copyShots, copyMatch, fingerprintOf, voPcm, sfxSynth, sfxEvents, pitchShift, voiceFx, csAutoSet, csAutoClear, speechShare, storyVoice, remakeOk, editOf };
}
