/* eslint-disable */
// @ts-nocheck
/**
 * Fast Studio: the whole Reel editor in the browser (nothing is uploaded).
 *  - music: own FFT, drum/voice split by median filtering, tempo, sudden rises/falls in loudness -> drops, hits, breaks
 *  - clips: motion, sharpness (Laplacian), brightness, faces (tracking.js, loaded by the page) -> best moments, face crop
 *  - edit: pacing by section and style (Auto / Smooth / Fast), no moment used twice, effects only where they suit the shot
 *  - picture: WebGL shaders (transitions, masks, blur, grade), 2D canvas fallback
 *  - export: WebCodecs through mediabunny (fast, frame-accurate MP4), MediaRecorder as the fallback
 * Plain JS on purpose (ported from the standalone page); the page mounts it with initStudio(root).
 */
import { createTasks } from './tasks';
import { soundMap, describeCut, sectionsOf, repace } from './soundmap';
import { revealShape, motionBetween, shotMove, shapeInside, SHAPE_REACH } from './refread';

export function initStudio(root, deps) {
  const { loadMediabunny, loadAacEncoder = null, beatThis: aiBeats = null, speechProbs = null, personMask = null, findFaces = null, loadRnnoise = null, cloud = null, tts = null } = deps;

const $ = id => root.querySelector('#'+id);
const tasks = createTasks(root);   // what is happening now, always in view (components/studio/tasks.ts)
const ac = new AbortController(), SIG = { signal: ac.signal };
let exporting = false;
// the Shubix watermark on exported Reels (bottom right). Removing it ("Remove Watermark" in the export sheet) is for paid
// plans (and the administrator): wmPaid comes from the server when the sheet opens; until then the watermark stays
let wmOff = false, wmPaid = false;
const wmImg = typeof Image !== 'undefined' ? Object.assign(new Image(), { src: '/brand/shubix-logo-sm.webp' }) : null;
const texOf = (e, local) => exporting ? (e.fc || e.fcLast) : e.rc && e.cs && e.cs.rev && local !== undefined ? revFrame(e, local) : e.el;
const fmt = t => { t = Math.max(0,t); const m = Math.floor(t/60), s = t - m*60; return m + ':' + (s<10?'0':'') + s.toFixed(2); };
let ctx = null, buf = null, mono = null;
let period = 0, phase = 0, hopSec = 0, rmsF = null, hitsStr = [], barOff = 0, beatLvl = [];
let onEnv=null, onFps=0, onOff=0, hitsRaw=[];
let cutFx = [], pfArr = null;
const DRUM_MIN = 0.7;
let beats = [], cuts = [], cutType = [], peaks = [], peakS = [];
let userMarks = [];   // beats the creator tapped in (song time): cuts can land on them like on the song's own beats
function withMarks(b, dur){ if(!userMarks.length) return b; const out = b.slice();
  for(const m of userMarks){ const t = m - secStart; if(t > 0.05 && t < dur - 0.05 && !out.some(x => Math.abs(x - t) < 0.08)) out.push(t); }
  return out.sort((x, y) => x - y); }
function addMark(t){ if(!buf || !edit.length) return false; userMarks.push(+(secStart + t).toFixed(3)); beats = withMarks(beats, buf.duration); makeEdit(); notify('Beat added at ' + t.toFixed(1) + ' s: a cut can land there now'); return true; }
function clearMarks(){ if(!userMarks.length) return false; const ts = userMarks.map(m => m - secStart); userMarks = []; beats = beats.filter(b => !ts.some(t => Math.abs(t - b) < 0.005)); makeEdit(); notify('Your beats are cleared'); return true; }
// On an iPhone the page's sound is muted by the ring/silent switch unless it says it is playing media (Audio Session API)
function getCtx(){ if(!ctx){ try{ if(navigator.audioSession) navigator.audioSession.type = 'playback'; }catch(e){} ctx = new (window.AudioContext||window.webkitAudioContext)(); } return ctx; }
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const TCOL = {drop:'--drop', hit:'--hit', cut:'--cut', break:'--break'};
const TNAME = {drop:'DROP', hit:'HIT', cut:'CUT', break:'BREAK'};

/* =============== MUSIC ENGINE =============== */
// Self-contained on purpose: its source is also run in a Web Worker, so the page never freezes while a song is analysed.
function songAnalysis(monoIn, sampleRate, opts){
  opts = opts || {};
  const ALT_FAST = opts.altFast ?? 0.55;
  const DRUM_MIN = 0.7;
  const buf = { sampleRate, length: monoIn.length, duration: monoIn.length/sampleRate, numberOfChannels: 1, getChannelData: () => monoIn };
  let mono = null, period = 0, phase = 0, hopSec = 0, rmsF = null, hitsStr = [], barOff = 0, beatLvl = [];
  let onEnv = null, onFps = 0, onOff = 0, hitsRaw = [], cutFx = [], pfArr = null;
  let beats = [], beatsDP = [], cuts = [], cutType = [], peaks = [], peakS = [], beatSource = 'own', beatJudge = null;
/* ---------- FFT ---------- */
function makeFFT(n){
  const lev = Math.log2(n), rev = new Uint32Array(n), cos = new Float64Array(n/2), sin = new Float64Array(n/2);
  for(let i=0;i<n;i++){ let r=0,x=i; for(let j=0;j<lev;j++){ r=(r<<1)|(x&1); x>>=1; } rev[i]=r; }
  for(let i=0;i<n/2;i++){ cos[i]=Math.cos(2*Math.PI*i/n); sin[i]=-Math.sin(2*Math.PI*i/n); }
  return (re, im) => {
    for(let i=0;i<n;i++){ const j=rev[i]; if(j>i){ let t=re[i]; re[i]=re[j]; re[j]=t; t=im[i]; im[i]=im[j]; im[j]=t; } }
    for(let size=2; size<=n; size<<=1){
      const half=size>>1, step=n/size;
      for(let i=0;i<n;i+=size) for(let j=0,k=0;j<half;j++,k+=step){
        const a=i+j, b=a+half, tr=re[b]*cos[k]-im[b]*sin[k], ti=re[b]*sin[k]+im[b]*cos[k];
        re[b]=re[a]-tr; im[b]=im[a]-ti; re[a]+=tr; im[a]+=ti;
      }
    }
  };
}

/* ---------- Beat tracking ---------- */
// 1) global tempo from the autocorrelation of the onset envelope; 2) the metrical level: a slow song is not heard at double
// speed when the off-beats are only hi-hats, a fast one (drum & bass) keeps its snare on 2 and 4; 3) local tempo every
// second (windowed autocorrelation + a smooth path), so drifting and changing tempos are followed; 4) Ellis' dynamic
// programming places each beat on the strongest onsets at that local spacing.
function trackBeats(env, bodyEnv, fps, kickEnv, midEnv){
  const n = env.length;
  if(n < fps*2) return { beats: [], period: fps*0.5 };
  const mean = a => { let s=0; for(const v of a) s+=v; return s/Math.max(1,a.length); };
  const sd = (a, m) => { let s=0; for(const v of a) s+=(v-m)*(v-m); return Math.sqrt(s/Math.max(1,a.length)) || 1; };
  const em = mean(env), es = sd(env, em), E = Float64Array.from(env, v => v/es), Z = Float64Array.from(env, v => (v-em)/es);   // Z: zero-mean, for autocorrelation
  const acAt = (a, L, i0, i1) => { let s=0, c=0; for(let i=i0; i+L<i1; i++){ s+=a[i]*a[i+L]; c++; } return c ? s/c : 0; };
  // 1) tempo per 8 s window (40–240 BPM, broad preference around 115 BPM), each checked for the right level (2),
  //    then the median: a song that changes tempo is not averaged into a tempo it never has
  const lmin = Math.max(2, Math.floor(60*fps/240)), lmax = Math.min(n-2, Math.ceil(60*fps/40));
  const bpmOf = q => 60*fps/q;
  // 2) metrical level, judged on the low end (kick, snare body; hi-hats left out)
  //    too fast? every other "beat" is weak (only hats/fills): the real beat is twice as long;
  //    too slow? a real hit (the snare of drum & bass) lands halfway between: the real beat is half as long.
  const levelStats = (a, q, i0, i1) => { let best = -1, res = null;
    for(let ph=0; ph<q; ph+=0.5){ let ev=0, od=0, mid=0, ce=0, co=0, k=0;
      for(let x=i0+ph; x<i1; x+=q, k++){ const v=a[Math.round(x)]||0, m=a[Math.round(x+q/2)]||0; if(k%2){ od+=v; co++; } else { ev+=v; ce++; } mid+=m; }
      ev/=Math.max(1,ce); od/=Math.max(1,co); mid/=Math.max(1,ce+co); const on=(ev+od)/2;
      if(on>best){ best=on; res={on, alt: Math.min(ev,od)/Math.max(ev,od,1e-9), mid: mid/Math.max(on,1e-9)}; } }
    return res || {on:0, alt:1, mid:0}; };
  const tempoIn = (i0, i1) => {
    const ac = new Float64Array(lmax+2);
    for(let L=lmin-1; L<=lmax+1; L++) ac[L] = acAt(Z, L, i0, i1);
    let L0 = lmin, bv = -Infinity;
    for(let L=lmin; L<=lmax; L++){ const w = ac[L]*Math.exp(-0.5*Math.pow(Math.log2(bpmOf(L)/115)/1.0, 2)); if(w > bv){ bv = w; L0 = L; } }
    const y0=ac[L0-1]||0, y1=ac[L0]||0, y2=ac[L0+1]||0, d=y0-2*y1+y2;
    const q = L0 + (d!==0 ? Math.max(-0.5, Math.min(0.5, 0.5*(y0-y2)/d)) : 0);
    return { q, i0, i1, strength: Math.max(0, bv) };
  };
  const wl = Math.round(8*fps), est = [];
  if(n <= wl*1.25) est.push(tempoIn(0, n));
  else for(let c=0; c+wl<=n; c+=Math.round(2*fps)) est.push(tempoIn(c, c+wl));
  const qs = est.filter(e=>e.strength>0).map(e=>e.q).sort((a,b)=>a-b);
  let P = qs.length ? qs[Math.floor(qs.length/2)] : tempoIn(0, n).q;
  // every window on the same level as the median (a real change like 95 -> 128 stays; a stray double / half is folded)
  est.forEach(e=>{ e.q = [e.q/2, e.q, 2*e.q].reduce((b,x)=>Math.abs(Math.log(x/P)) < Math.abs(Math.log(b/P)) ? x : b, e.q); });
  // one level decision for the whole song, from the averages over all windows (single windows are noisy)
  { let alt = 0, mid = 0, c = 0;
    est.forEach(e=>{ const s = levelStats(bodyEnv, e.q, e.i0, e.i1); alt += s.alt; mid += s.mid; c++; });
    alt /= Math.max(1,c); mid /= Math.max(1,c);
    let f = 1;
    if(bpmOf(2*P) >= 55 && alt < 0.38) f = 2;            // every other "beat" is only hats / fills: the beat is twice as long
    else if(bpmOf(P/2) <= 200 && mid > 0.42) f = 0.5;    // a real hit halfway (drum & bass snare): the beat is half as long
    if(f !== 1){ P *= f; est.forEach(e=>{ e.q *= f; }); } }
  // 3) local period: the window estimates themselves (kept on the same level as the median, so a stray window cannot
  //    double or halve the tempo, while real changes like 95 -> 128 are followed), median-smoothed, interpolated per frame
  const step = Math.round(2*fps), cen = [], val = [];
  if(n <= wl*1.25){ cen.push(n/2); val.push(P); }
  else est.forEach((e,k)=>{ let q = e.q; const c2 = [q/2, q, 2*q]; q = c2.reduce((b,x)=>Math.abs(Math.log(x/P)) < Math.abs(Math.log(b/P)) ? x : b, q);
    cen.push(k*step + wl/2); val.push(q); });
  const sm = val.map((v,k)=>{ const w=[val[k-1]??v, v, val[k+1]??v].sort((a,b)=>a-b); return w[1]; });
  const per = new Float64Array(n);
  for(let i=0, k=0; i<n; i++){
    while(k+1 < cen.length && cen[k+1] <= i) k++;
    if(i <= cen[0]) per[i] = sm[0];
    else if(k+1 >= cen.length) per[i] = sm[sm.length-1];
    else { const w2 = (i-cen[k])/(cen[k+1]-cen[k]); per[i] = sm[k]*(1-w2) + sm[k+1]*w2; }
  }
  const pathL = sm;
  // 4) dynamic programming (tightness 100, like Ellis 2007 / librosa)
  const bm = mean(bodyEnv), bs = sd(bodyEnv, bm), km = mean(kickEnv), ks = sd(kickEnv, km);
  const S = Float64Array.from(E, (v,i) => 0.25*v + 0.5*bodyEnv[i]/bs + 1.2*kickEnv[i]/ks);   // beats sit on the kick, then snare, more than on hats
  const score = new Float64Array(n), back = new Int32Array(n).fill(-1), tight = 1600;   // firm: the local tempo is accurate (scripts/studio-beats sweep), the beats follow it; the attack step does the fine timing
  for(let i=0;i<n;i++){
    const p = per[i], a0 = Math.max(0, i - Math.round(2*p)), a1 = i - Math.max(1, Math.round(p/2));
    let b = -Infinity, bi = -1;
    for(let j=a0; j<=a1; j++){ const r = Math.log((i-j)/p), v = score[j] - tight*r*r; if(v > b){ b = v; bi = j; } }
    score[i] = S[i] + (bi >= 0 ? Math.max(b, 0) : 0); back[i] = bi >= 0 && b > 0 ? bi : -1;
  }
  // last beat: the best score in the final beat period; then follow the links back
  let end = n-1; { const p = per[n-1]; let b = -Infinity; for(let i=Math.max(0, n-1-Math.round(p*1.5)); i<n; i++) if(score[i] > b){ b = score[i]; end = i; } }
  const out = []; for(let i=end; i>=0; i=back[i]){ out.push(i); if(back[i] < 0) break; }
  out.reverse();
  // the chain may stop early (silence at the start): extend it backwards at the local spacing
  while(out.length && out[0] - per[out[0]] > per[out[0]]*0.3){ const f = out[0] - per[out[0]]; let bf = Math.round(f), bs = -1;
    for(let j=Math.max(0, Math.round(f-3)); j<=Math.min(n-1, Math.round(f+3)); j++) if(S[j] > bs){ bs = S[j]; bf = j; }
    if(bf >= out[0]) break; out.unshift(bf); }
  const ints = []; for(let i=1;i<out.length;i++) ints.push(out[i]-out[i-1]); ints.sort((a,b)=>a-b);
  return { beats: out, period: ints.length ? ints[Math.floor(ints.length/2)] : P };
}

/* ---------- No beat where there is no pulse ----------
   A free-time intro or outro (a slow vocal, a harmonium alone) has no beat; a tracker still fills it with an even grid.
   Leading / trailing runs of at least 4 beats that land on almost nothing (below 30% of the song's typical beat) are
   dropped; the cuts there follow the music's own accents instead. A quiet break in the middle keeps its beats. */
function trimNoPulse(bt, strength){
  if(bt.length < 12) return bt;
  const v = bt.map(strength), s2 = [...v].sort((x,y)=>x-y), med = s2[s2.length>>1] || 0;
  if(med <= 0) return bt;
  const weak = i => { let w = 0; for(let j=i; j<Math.min(bt.length, i+3); j++) if(v[j] < 0.3*med) w++; return w >= 2; };   // mostly weak around here
  let a = 0; while(a < bt.length-8 && weak(a)) a++;
  let b = bt.length; while(b > a+8 && weak(Math.max(0, b-3))) b--;
  if(a < 4) a = 0; if(bt.length - b < 4) b = bt.length;
  return bt.slice(a, b);
}

/* ---------- Beat timing: each beat on its attack ----------
   The grid above is found on 11.6 ms frames, and its kick band (the lowest FFT bins) rises slowly, so on real mixes
   (long 808s, compressed masters) beats land tens of ms after the hit. Here a fine onset function (2.9 ms steps, whole
   spectrum, the low end at half weight) puts every beat on the attack nearest to it. The correction is checked against
   the beats around it: the local median correction is applied in full, a single beat may differ from it by at most
   25 ms (an off-beat hi-hat or a flam cannot pull one beat away from the groove). */
function refineBeats(bt, periodSec){
  if(!bt.length) return bt;
  const sr = buf.sampleRate, fN = 512, fH = 128, len = mono.length, nF = Math.max(1, Math.floor((len-fN)/fH)+1), half = fN/2;
  const fft = makeFFT(fN), re = new Float64Array(fN), im = new Float64Array(fN), win = new Float64Array(fN), prev = new Float64Array(half);
  for(let i=0;i<fN;i++) win[i] = 0.5-0.5*Math.cos(2*Math.PI*i/(fN-1));
  const kLow = Math.max(2, Math.round(200*fN/sr)), kTop = Math.min(half, Math.round(12000*fN/sr));
  const fe = new Float32Array(nF);
  for(let f=0; f<nF; f++){
    const o = f*fH; for(let i=0;i<fN;i++){ re[i] = (mono[o+i]||0)*win[i]; im[i] = 0; }
    fft(re, im); let s = 0;
    for(let k=1;k<kTop;k++){ const m = Math.log1p(100*Math.hypot(re[k], im[k])), d = m - prev[k]; if(d > 0 && f > 0) s += k < kLow ? 0.5*d : d; prev[k] = m; }
    fe[f] = s;
  }
  const fps2 = sr/fH, off = (fN/2)/sr, tOf = i => i/fps2 + off, idx = t => (t-off)*fps2;
  // smoothed copy (±6 ms): tolerant to small timing spread when lining up several beats at once
  const g = new Float32Array(nF); for(let i=0;i<nF;i++){ let s2=0, ws=0; for(let j=-3;j<=3;j++){ const v = fe[i+j]; if(v!==undefined){ const ww = Math.exp(-0.5*(j/1.5)**2); s2 += ww*v; ws += ww; } } g[i] = s2/ws; }
  const gAt = t => { const x = idx(t), i = Math.floor(x); if(i < 0 || i >= nF-1) return 0; return g[i] + (g[i+1]-g[i])*(x-i); };
  // 1) phase: shift the grid locally (±12% of a beat: enough for a late 808, never as far as the next triplet or 16th) to where the 9 beats around
  //    each beat land best on attacks; a weak preference for no shift
  const P = periodSec, maxS = 0.12*P, stepS = 1/fps2, shift = bt.map((b,k)=>{
    let best = 0, bv = -Infinity;
    for(let d=-maxS; d<=maxS+1e-9; d+=stepS){
      let sc = 0; for(let j=Math.max(0,k-4); j<=Math.min(bt.length-1,k+4); j++) sc += gAt(bt[j]+d) * (j===k ? 1.5 : 1);
      sc *= Math.exp(-0.5*(d/(0.3*P))**2);
      if(sc > bv){ bv = sc; best = d; } }
    return best; });
  // the shift itself is smoothed over neighbours (a groove does not jump around)
  const shiftS = shift.map((v,k)=>{ const w = shift.slice(Math.max(0,k-2), k+3).sort((x,y)=>x-y); return w[w.length>>1]; });
  const grid = bt.map((b,k)=>b + shiftS[k]);
  // local level: median over ±0.4 s, sampled
  const levelAt = i => { const a = Math.max(0, i - Math.round(0.4*fps2)), b = Math.min(nF-1, i + Math.round(0.4*fps2)), v = [];
    for(let j=a;j<=b;j+=3) v.push(fe[j]); v.sort((x,y)=>x-y); return v[v.length>>1] || 0; };
  // 2) each beat onto its own attack, within 40 ms of the aligned grid
  const w = Math.min(0.04, 0.1*P), raw = grid.map(b=>{
    const i0 = Math.max(1, Math.floor(idx(b-w))), i1 = Math.min(nF-2, Math.ceil(idx(b+w)));
    let best = -1, bv = 0;
    for(let i=i0;i<=i1;i++){ const v = fe[i]; if(v >= fe[i-1] && v > fe[i+1]){ const gg = Math.exp(-0.5*((tOf(i)-b)/0.02)**2), sc = v*gg; if(sc > bv){ bv = sc; best = i; } } }
    if(best < 0 || fe[best] < 1.6*levelAt(best)) return null;   // no clear attack here: keep the grid
    const y0 = fe[best-1], y1 = fe[best], y2 = fe[best+1], d = y0 - 2*y1 + y2;
    return tOf(best + (d !== 0 ? Math.max(-0.5, Math.min(0.5, 0.5*(y0-y2)/d)) : 0)) - b;
  });
  return grid.map((b,k)=>{
    const near = []; for(let j=Math.max(0,k-4); j<=Math.min(grid.length-1,k+4); j++) if(raw[j] !== null) near.push(raw[j]);
    if(near.length < 3) return raw[k] !== null ? b + Math.max(-0.025, Math.min(0.025, raw[k])) : b;
    near.sort((x,y)=>x-y); const med = near[near.length>>1];
    const own = raw[k] !== null ? raw[k] : med;
    return b + med + Math.max(-0.025, Math.min(0.025, own - med));
  });
}

/* ---------- Beat analysis ---------- */
function analyse(){
  const sr = buf.sampleRate, N = 1024, H = 512, nb = N/2;
  const ch = buf.numberOfChannels, len = buf.length;
  mono = new Float32Array(len);
  for(let c=0;c<ch;c++){ const d = buf.getChannelData(c); for(let i=0;i<len;i++) mono[i] += d[i]/ch; }
  const frames = Math.max(1, Math.floor((len-N)/H)+1);
  const win = new Float64Array(N); for(let i=0;i<N;i++) win[i]=0.5-0.5*Math.cos(2*Math.PI*i/(N-1));
  const fft = makeFFT(N), re = new Float64Array(N), im = new Float64Array(N);
  // 1) magnitude spectrogram (up to ~11 kHz)
  const B = Math.min(257, nb), Mag = new Float32Array(frames*B);
  for(let f=0; f<frames; f++){
    const o = f*H;
    for(let i=0;i<N;i++){ re[i]=(mono[o+i]||0)*win[i]; im[i]=0; }
    fft(re,im);
    for(let k=0;k<B;k++) Mag[f*B+k]=Math.hypot(re[k],im[k]);
  }
  // 2) separate drums from voice/melody (median filtering: smooth in time = tonal, smooth in frequency = drums)
  const hw=8, tmp=new Float32Array(2*hw+1), Hm=new Float32Array(frames*B), Pm=new Float32Array(frames*B);
  for(let k=0;k<B;k++) for(let f=0;f<frames;f++){
    for(let j=-hw;j<=hw;j++){ const ff=f+j<0?0:(f+j>=frames?frames-1:f+j); tmp[j+hw]=Mag[ff*B+k]; }
    tmp.sort(); Hm[f*B+k]=tmp[hw];
  }
  for(let f=0;f<frames;f++) for(let k=0;k<B;k++){
    for(let j=-hw;j<=hw;j++){ const kk=k+j<0?0:(k+j>=B?B-1:k+j); tmp[j+hw]=Mag[f*B+kk]; }
    tmp.sort(); Pm[f*B+k]=tmp[hw];
  }
  // 3) onset strength of the drum part only
  //    plus bass/808 hits (below 300 Hz) and new synth/instrument attacks (above 300 Hz)
  pfArr = new Float32Array(frames);
  const flux = new Float64Array(frames), fLow = new Float64Array(frames), fHi = new Float64Array(frames), fBody = new Float64Array(frames), fKick = new Float64Array(frames), fMid = new Float64Array(frames), fTop = new Float64Array(frames);
  const prev = new Float64Array(B), prevF = new Float64Array(B), kSplit = Math.round(300*N/sr), kBody = Math.round(800*N/sr), kKick = Math.max(2, Math.round(150*N/sr)), kMid = Math.round(4000*N/sr);
  for(let f=0;f<frames;f++){
    let s=0, sl=0, sh=0, pn=0, pdn=0, sb=0, sk=0, sm2=0, st2=0;
    for(let k=1;k<B;k++){
      const i=f*B+k, p2=Pm[i]*Pm[i], h2=Hm[i]*Hm[i], m=Math.log1p(100*Mag[i]*p2/(p2+h2+1e-12)), e2=Mag[i]*Mag[i];
      pn += e2*p2/(p2+h2+1e-12); pdn += e2;
      const d=m-prev[k]; if(d>0&&f>0){ s+=d; if(k<kBody) sb+=d; else if(k<kMid) sm2+=d; else st2+=d; if(k<=kKick) sk+=d; } prev[k]=m;
      const mf=Math.log1p(100*Mag[i]), df=mf-prevF[k]; if(df>0&&f>0){ if(k<kSplit) sl+=df; else sh+=df; } prevF[k]=mf;
    }
    flux[f]=s; fLow[f]=sl; fHi[f]=sh; fBody[f]=sb; fKick[f]=sk; fMid[f]=sm2; fTop[f]=st2; pfArr[f]=pdn>0 ? pn/pdn : 0;
  }
  // local-mean subtract
  const env = new Float64Array(frames), W=8;
  const cs = new Float64Array(frames+1); for(let i=0;i<frames;i++) cs[i+1]=cs[i]+flux[i];
  for(let i=0;i<frames;i++){ const a=Math.max(0,i-W), b=Math.min(frames,i+W+1); env[i]=Math.max(0, flux[i]-(cs[b]-cs[a])/(b-a)); }
  rmsF = new Float32Array(frames);
  for(let f=0;f<frames;f++){ let s=0; const o=f*H; for(let i=0;i<N;i+=2){ const v=mono[o+i]||0; s+=v*v; } rmsF[f]=Math.sqrt(s/(N/2)); }
  const fps = sr/H;
  // ---- beats: the right tempo level, a tempo that may drift or change, dynamic programming ----
  const bodyEnv = new Float64Array(frames);
  { const cb = new Float64Array(frames+1); for(let i=0;i<frames;i++) cb[i+1]=cb[i]+fBody[i];
    for(let i=0;i<frames;i++){ const a=Math.max(0,i-W), b=Math.min(frames,i+W+1); bodyEnv[i]=Math.max(0, fBody[i]-(cb[b]-cb[a])/(b-a)); } }
  const kickEnv = new Float64Array(frames);
  { const ck = new Float64Array(frames+1); for(let i=0;i<frames;i++) ck[i+1]=ck[i]+fKick[i];
    for(let i=0;i<frames;i++){ const a=Math.max(0,i-W), b=Math.min(frames,i+W+1); kickEnv[i]=Math.max(0, fKick[i]-(ck[b]-ck[a])/(b-a)); } }
  const midEnv = new Float64Array(frames);
  { const cm = new Float64Array(frames+1); for(let i=0;i<frames;i++) cm[i+1]=cm[i]+fMid[i];
    for(let i=0;i<frames;i++){ const a=Math.max(0,i-W), b=Math.min(frames,i+W+1); midEnv[i]=Math.max(0, fMid[i]-(cm[b]-cm[a])/(b-a)); } }
  const trk = trackBeats(env, bodyEnv, fps, kickEnv, midEnv);
  let own = trk.beats.map(f => f/fps + (N/2)/sr), ownPeriod = trk.period/fps;
  beatSource = 'own';
  if(opts.forceBeats && opts.forceBeats.length >= 4){
    // a part of a song: its beats come from the whole song's analysis (more music to judge from, the same grid)
    own = opts.forceBeats.slice(); const ib = own.slice(1).map((t,i)=>t-own[i]).sort((x,y)=>x-y); ownPeriod = ib[ib.length>>1] || ownPeriod; beatSource = opts.forceSource || 'own';
  } else if(opts.beats && opts.beats.length >= 8){
    // two trackers: this one and the neural network (Beat This!). Keep the one whose beats land on stronger hits (every
    // band, hats at half weight) and keep a steady pulse; each misses different songs (see scripts/studio-beats).
    const bandsA = [[fKick, 1], [fBody, 1], [fMid, 1], [fTop, 0.5]].map(([a, w]) => { let m = 0; for(const v of a) m += v; m = m/Math.max(1, a.length) || 1; return [a, w/m]; });
    const A = new Float64Array(frames); for(const [a, w] of bandsA) for(let i=0;i<frames;i++) A[i] += w*a[i];
    let Am = 0; for(const v of A) Am += v; Am = Am/frames || 1;
    const accAt = t => { const f = Math.round((t - (N/2)/sr)*fps); let m = 0; for(let j=f-3;j<=f+3;j++) if(A[j] > m) m = A[j]; return m; };
    const medIbi = bt => { const ib = bt.slice(1).map((t,i)=>t-bt[i]).sort((x,y)=>x-y); return ib[ib.length>>1] || 1; };
    const judge = (bt) => {
      let s2 = 0, c = 0; for(const t of bt){ s2 += accAt(t); c++; }
      const ibi = bt.slice(1).map((t,i)=>t-bt[i]); let steady = 0;
      ibi.forEach((d,i)=>{ const w = ibi.slice(Math.max(0,i-4), i+5).sort((x,y)=>x-y), med = w[w.length>>1]; if(Math.abs(d-med) <= 0.15*med) steady++; });
      const reg = steady/Math.max(1, ibi.length);
      return { accent: s2/Math.max(1,c)/Am, steady: reg, score: (s2/Math.max(1,c)/Am) * reg*reg };
    };
    const jo = judge(own), jn = judge(opts.beats);
    beatJudge = { own: jo, ai: jn };
    let pickAi = jn.score > jo.score;
    // one counts twice as fast as the other: a slower grid always looks "stronger" (it only touches the big hits), so
    // decide on the in-between beats of the faster one instead: real hits there (a snare on 2 and 4) make it the beat
    const r = medIbi(own)/medIbi(opts.beats);
    if(Math.abs(Math.log2(r)) > 0.85 && Math.abs(Math.log2(r)) < 1.15 && jo.steady > 0.8 && jn.steady > 0.8){
      const fast = r > 1 ? opts.beats : own, slow = r > 1 ? own : opts.beats, tol = 0.25*medIbi(fast);
      let on = 0, no = 0, mid = 0, nm = 0;
      for(const t of fast){ let near = false; for(const u of slow){ if(Math.abs(u-t) < tol){ near = true; break; } } if(near){ on += accAt(t); no++; } else { mid += accAt(t); nm++; } }
      const alt = (mid/Math.max(1,nm)) / Math.max(1e-9, on/Math.max(1,no));
      beatJudge.alt = alt;
      pickAi = (alt > ALT_FAST) === (r > 1);   // the faster grid wins when its in-between beats are real hits
    }
    if(pickAi){ const ib = opts.beats.slice(1).map((t,i)=>t-opts.beats[i]).sort((x,y)=>x-y); own = opts.beats.slice(); ownPeriod = ib[ib.length>>1]; beatSource = 'ai'; }
  }
  beatsDP = opts.forceBeats && opts.forceBeats.length >= 4 ? own.slice() : trimNoPulse(refineBeats(own, ownPeriod), t => { const f = Math.round((t - (N/2)/sr)*fps); let m = 0; for(let j=f-3;j<=f+3;j++) if(env[j] > m) m = env[j]; return m; });
  period = ownPeriod; phase = beatsDP.length ? beatsDP[0] : 0; hopSec = H/sr;
  // accent strength = drums + bass + instrument attacks (voice counts only half)
  const detrend = a => { const c=new Float64Array(frames+1); for(let i=0;i<frames;i++) c[i+1]=c[i]+a[i]; const o=new Float64Array(frames);
    for(let i=0;i<frames;i++){ const lo=Math.max(0,i-W), hi=Math.min(frames,i+W+1); o[i]=Math.max(0,a[i]-(c[hi]-c[lo])/(hi-lo)); }
    const s=[...o].sort((x,y)=>x-y), p98=s[Math.floor(s.length*0.98)]||1; for(let i=0;i<frames;i++) o[i]/=p98; return o; };
  const e1=detrend(flux), e2=detrend(fLow), e3=detrend(fHi);
  const acc = new Float64Array(frames); for(let i=0;i<frames;i++) acc[i]=e1[i]+e2[i]+0.5*e3[i];
  onEnv = acc; onFps = fps; onOff = (N/2)/sr; detectHits();
  rebuild();
}

function detectHits(){
  const k = 2.4, e = onEnv, n = e.length, W = Math.round(onFps*0.4);
  const c1 = new Float64Array(n+1); for(let i=0;i<n;i++) c1[i+1]=c1[i]+e[i];
  const gmean = c1[n]/n;
  peaks = []; peakS = [];
  for(let i=1;i<n-1;i++){ if(e[i]<=gmean*0.6) continue; let mx=true; for(let j=Math.max(0,i-3); j<=Math.min(n-1,i+3); j++) if(e[j]>e[i]){ mx=false; break; } if(mx){ peaks.push(i/onFps+onOff); peakS.push(e[i]/gmean); } }
  hitsRaw = []; hitsStr = []; let last = -1;
  for(let i=1;i<n-1;i++){
    if(e[i]<=0) continue;
    let isMax = true; for(let j=Math.max(0,i-4); j<=Math.min(n-1,i+4); j++) if(e[j]>e[i]){ isMax=false; break; }
    if(!isMax) continue;
    const a=Math.max(0,i-W), b=Math.min(n,i+W+1), m=(c1[b]-c1[a])/(b-a);
    if(e[i] > k*m && e[i] > gmean*1.2){ const t = i/onFps + onOff; if(t-last > 0.06){ hitsRaw.push(t); hitsStr.push(e[i]/gmean); last = t; } }
  }
}

const mod = (a,n) => ((a%n)+n)%n;
// how much of the sound at time t is drum/beat (0–1) rather than voice or held notes
function drumness(t){ const c=Math.round((t-onOff)*onFps); let m=0; for(let j=c-2;j<=c+4;j++) if(j>=0 && j<pfArr.length && pfArr[j]>m) m=pfArr[j]; return m; }
// strongest real drum hit near t (closer = better)
function snap(t, w){
  let best=t, bs=0;
  let lo=0, hi=peaks.length; while(lo<hi){ const m=(lo+hi)>>1; if(peaks[m]<t-w) lo=m+1; else hi=m; }
  for(let i=lo; i<peaks.length && peaks[i]<=t+w; i++){ const sc = peakS[i]*(1-Math.abs(peaks[i]-t)/(w*1.5)); if(sc>bs){ bs=sc; best=peaks[i]; } }
  return best;
}
function rebuild(){
  const p = period, dur = buf.duration;
  beats = withMarks(beatsDP.filter(t => t >= 0 && t < dur-0.02), dur);
  const first = beats.length ? beats[0] : 0;
  barOff = 0;
  // loudness every 5 ms; a cut only where the sound suddenly jumps UP or suddenly falls DOWN
  const sr = buf.sampleRate, hop = Math.round(0.005*sr), win = Math.round(0.02*sr);
  const nF = Math.max(1, Math.floor((mono.length-win)/hop)+1), L = new Float64Array(nF), lt = new Float64Array(nF);
  for(let f=0; f<nF; f++){ let s=0; const o=f*hop; for(let k=0;k<win;k+=2){ const v=mono[o+k]; s+=v*v; } L[f]=10*Math.log10(s/(win/2)+1e-10); lt[f]=(o+win/2)/sr; }
  const kk = 12; // look back 60 ms
  const rise = new Float64Array(nF), drop = new Float64Array(nF);
  for(let f=0; f<nF; f++){ let mn=Infinity, mx=-Infinity; for(let j=Math.max(0,f-kk); j<=f; j++){ if(L[j]<mn) mn=L[j]; if(L[j]>mx) mx=L[j]; } rise[f]=L[f]-mn; drop[f]=mx-L[f]; }
  const events = (sig, th, isUp) => { const out=[]; let f=0;
    while(f<nF){ if(sig[f]>=th){ let g=f; while(g<nF && sig[g]>=th*0.5) g++;
        let m=f; for(let q=f;q<g;q++) if(sig[q]>sig[m]) m=q;
        let s=Math.max(1,m-kk), best=s; for(let q=s;q<=m;q++){ const d=L[q]-L[q-1]; if(isUp ? d>L[best]-L[best-1] : d<L[best]-L[best-1]) best=q; }
        out.push({t:lt[best], s:sig[m]}); f=g; } else f++; }
    return out; };
  const pct = (a,q) => { const s=a.map(x=>x.s).sort((x,y)=>x-y); return s.length ? s[Math.floor((s.length-1)*q)] : 0; };
  let ups = events(rise, 4, true), downs = events(drop, 5, false);
  const pu = pct(ups.filter(u=>u.t>0.1), 0.9), pd = pct(downs.filter(d=>d.t<dur-0.3), 0.75);
  ups = ups.filter(u=>u.s >= Math.max(6, 0.5*pu));
  downs = downs.filter(d=>d.s >= Math.max(6, 0.5*pd) && d.t < dur-0.15 && !ups.some(u=>u.t-d.t>=0 && u.t-d.t<=0.15));
  // ---- PRO pacing (how editors cut to music) ----
  // 1) intensity of the song over time (loudness averaged over 1.5 s), as a 0–1 rank
  const sm = Math.round(0.75/0.005), cL = new Float64Array(nF+1); for(let f=0;f<nF;f++) cL[f+1]=cL[f]+L[f];
  const avg = (a,b) => { a=Math.max(0,a); b=Math.min(nF,b); return b>a ? (cL[b]-cL[a])/(b-a) : -100; };
  const smooth = new Float64Array(nF); for(let f=0;f<nF;f++) smooth[f]=avg(f-sm,f+sm);
  const sortedS = Array.from(smooth).sort((a,b)=>a-b);
  const fIdx = tt => Math.max(0, Math.min(nF-1, Math.round((tt-0.01)/0.005)));
  const intensity = tt => { const v=smooth[fIdx(tt)]; let lo=0,hi=sortedS.length; while(lo<hi){ const m=(lo+hi)>>1; if(sortedS[m]<v) lo=m+1; else hi=m; } return lo/sortedS.length; };
  // 2) must-cut moments: DROP = big jump up into a louder part; BREAK = sudden fall that stays down
  const s1s = Math.round(1/0.005), s03 = Math.round(0.3/0.005);
  const pU = pct(ups, 0.85);
  const DR = DRUM_MIN, forced = [];
  ups.forEach(u=>{ const f=fIdx(u.t); if(u.s >= Math.max(8, pU) && drumness(u.t) >= DR && avg(f, f+s1s) - avg(f-s1s, f) >= 3) forced.push({t:u.t, ty:'drop', s:u.s}); });
  downs.forEach(d=>{ const f=fIdx(d.t); if(d.s >= 8 && avg(f, f+s03) <= avg(f-s03, f) - 6) forced.push({t:d.t, ty:'break', s:d.s}); });
  // HIT = every strong jump in volume: these are never skipped (CapCut's grid misses them)
  const pH = 0.35*pct(ups.filter(u=>u.t>0.1), 0.9);
  ups.forEach(u=>{ if(u.s >= Math.max(7, pH) && drumness(u.t) >= DR && !forced.some(f=>Math.abs(f.t-u.t)<0.05)) forced.push({t:u.t, ty:'hit', s:u.s}); });
  forced.sort((a,b)=>a.t-b.t);
  // strong hits closer than 0.25 s to a bigger one are dropped, so it never gets frantic
  { const rank=x=>x.ty==='hit'?x.s:100+x.s, keep=[];
    [...forced].sort((a,b)=>rank(b)-rank(a)).forEach(x=>{ if(keep.every(y=>Math.abs(y.t-x.t)>=0.25)) keep.push(x); });
    forced.length=0; keep.sort((a,b)=>a.t-b.t).forEach(x=>forced.push(x)); }
  // 3) candidates = every real hit, scored by strength, bonus when it sits on the beat grid
  const onGrid = tt => { let lo=0, hi=beats.length; while(lo<hi){ const m=(lo+hi)>>1; if(beats[m]<tt) lo=m+1; else hi=m; }
    return (lo<beats.length && Math.abs(beats[lo]-tt) < 0.05) || (lo>0 && Math.abs(beats[lo-1]-tt) < 0.05); };
  // only real beats are candidates: if it is just voice or a held note, no cut there
  const cands = peaks.map((pt,k)=>({t:pt, sc: peakS[k]*(onGrid(pt)?1.4:1)})).filter(c=>drumness(c.t) >= DR-0.1);
  ups.forEach(u=>{ if(drumness(u.t) >= DR-0.1) cands.push({t:u.t, sc: u.s/4 + (onGrid(u.t)?1:0)}); });
  cands.sort((a,b)=>a.t-b.t);
  // 4) walk through the song: clip length depends on intensity (4 / 2 / 1 beats)
  const beatsFor = I => I<0.3 ? 4 : I<0.75 ? 2 : 1;   // short-video pacing: never longer than 4 beats
  const out = []; let fi = 0;
  let cur = ups.length ? Math.min(ups[0].t, forced.length?forced[0].t:Infinity) : first;
  out.push({t:cur, ty: forced.length && Math.abs(forced[0].t-cur)<0.01 ? forced[0].ty : 'cut'});
  while(fi<forced.length && forced[fi].t <= cur+0.01) fi++;
  while(cur < dur - 0.3){
    while(fi<forced.length && forced[fi].t - cur < 0.2) fi++;
    const nb = beatsFor(intensity(cur)), target = cur + nb*p, w = Math.min(1, nb/2)*p;
    if(fi<forced.length && forced[fi].t < target + w && forced[fi].t - cur >= 0.2){ cur = forced[fi].t; out.push({t:cur, ty:forced[fi].ty}); fi++; continue; }
    let best=null, bs=-1;
    for(const c of cands){ if(c.t < target-w || c.t > target+w || c.t-cur < 0.25) continue; const sc=c.sc*(1-0.35*Math.abs(c.t-target)/w); if(sc>bs){ bs=sc; best=c.t; } }
    if(best===null){ // no beat in the window (only voice/music): hold the shot until the next real beat
      const nx = cands.find(c=>c.t > target+w), nf = fi<forced.length ? forced[fi].t : Infinity;
      if(!nx && nf===Infinity) break;
      if(nf <= (nx?nx.t:Infinity)){ cur = nf; out.push({t:cur, ty:forced[fi].ty}); fi++; continue; }
      best = nx.t; }
    if(best >= dur-0.15) break;
    cur = best; out.push({t:cur, ty:'cut'});
  }
  out.sort((a,b)=>a.t-b.t);
  cuts = []; cutType = [];
  out.forEach(c=>{ const Lx=cuts.length-1; if(Lx>=0 && c.t-cuts[Lx] < 0.15){ if(c.ty!=='cut'){ cuts[Lx]=c.t; cutType[Lx]=c.ty; } return; } cuts.push(c.t); cutType.push(c.ty); });
  // effect for each clip, the way pro editors choose them
  cutFx = cuts.map((c,k)=>{ const ty=cutType[k], len=(k+1<cuts.length?cuts[k+1]:dur)-c, prevLen = k>0 ? c-cuts[k-1] : 9;
    if(ty==='drop') return 'Best shot · flash + zoom-in';
    if(ty==='break') return 'Slow-mo / freeze / text';
    if(len < 0.3) return 'Fast cut · shake';
    if(ty==='hit') return 'Zoom punch';
    if(len > 1.6) return 'Long shot · smooth pan';
    return 'Hard cut'; });
  const nDrop = cutType.filter(x=>x==='drop').length, nBreak = cutType.filter(x=>x==='break').length;
}




  analyse();
  return { period, phase, hopSec, rmsF, onEnv, onFps, onOff, hitsRaw, hitsStr, pfArr, beats, cuts, cutType, cutFx, peaks, peakS, barOff, beatSource, beatJudge };
}
function analyseInWorker(m, sr, opts){
  return new Promise((resolve, reject) => {
    let url = null, w = null;
    try{
      const code = 'const songAnalysis = ' + songAnalysis.toString() + ';\n' +
        'onmessage = e => { try{ postMessage({ ok: true, r: songAnalysis(e.data.mono, e.data.sr, e.data.opts) }); } catch(err){ postMessage({ ok: false, err: String(err && err.message || err) }); } };';
      url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      w = new Worker(url);
      const done = () => { try{ w.terminate(); }catch(err){} URL.revokeObjectURL(url); };
      w.onmessage = ev => { done(); ev.data.ok ? resolve(ev.data.r) : reject(new Error(ev.data.err)); };
      w.onerror = ev => { done(); reject(new Error(ev.message || 'worker failed')); };
      const copy = m.slice(); w.postMessage({ mono: copy, sr, opts: opts || {} }, [copy.buffer]);
    }catch(err){ if(url) URL.revokeObjectURL(url); reject(err); }
  });
}
// the page keeps these for the edit (same as inside songAnalysis)
const mod = (a,n) => ((a%n)+n)%n;
function drumness(t){ const c=Math.round((t-onOff)*onFps); let m=0; for(let j=c-2;j<=c+4;j++) if(j>=0 && j<pfArr.length && pfArr[j]>m) m=pfArr[j]; return m; }
function snap(t, w){
  let best=t, bs=0;
  let lo=0, hi=peaks.length; while(lo<hi){ const m=(lo+hi)>>1; if(peaks[m]<t-w) lo=m+1; else hi=m; }
  for(let i=lo; i<peaks.length && peaks[i]<=t+w; i++){ const sc = peakS[i]*(1-Math.abs(peaks[i]-t)/(w*1.5)); if(sc>bs){ bs=sc; best=peaks[i]; } }
  return best;
}

/* =============== STEP 1: MUSIC =============== */
let plan = [], basePlan = [], normGain = 1, mode = 'auto', musicToken = 0, editGen = 0;
// Style: Auto follows the music as analysed; Smooth keeps fewer, longer shots on the strong beats; Fast cuts on every beat.
function adaptPlan(){
  if(mode==='copy' && refProfile) return copyPlan();
  if(mode==='smooth'){
    const minLen = Math.min(3, Math.max(1.4, period*4)), outP = [];
    basePlan.forEach(s=>{ const last = outP[outP.length-1];
      const keep = !last || s.type==='drop' || s.type==='break' || (s.start-last.start) >= minLen || (s.end-last.start) > 4.5;
      if(keep) outP.push({...s}); else last.end = s.end; });
    return outP;
  }
  if(mode==='fast'){
    const outP = [];
    basePlan.forEach(s=>{
      const bs = beats.map(b=>b-1/30).filter(b=>b>s.start+0.3 && b<s.end-0.3);
      let a = s.start, first = true;
      for(const b of bs){ if(b-a >= 0.3){ outP.push({...s, start:a, end:b, type:first?s.type:'cut', fx:first?s.fx:'Hard cut'}); a=b; first=false; } }
      outP.push({...s, start:a, end:s.end, type:first?s.type:'cut', fx:first?s.fx:'Hard cut'});
    });
    return outP;
  }
  return basePlan.map(s=>({...s}));
}   // [{start,end,type,fx}]
function buildPlan(){
  const dur = buf.duration, list = [];
  const cs = cuts.slice(), ts = cutType.slice(), fx = cutFx.slice();
  if(!cs.length || cs[0] > 0.05){ cs.unshift(0); ts.unshift('cut'); fx.unshift('Hard cut'); } else cs[0] = 0;
  // cut one frame (1/30 s) before the beat: on screen it feels exactly on the beat, with more energy
  for(let i=1;i<cs.length;i++) cs[i] = Math.max(cs[i-1]+0.05, cs[i]-1/30);
  for(let i=0;i<cs.length;i++){ const end = i+1<cs.length ? cs[i+1] : dur; if(end-cs[i] < 0.08) continue; list.push({start:cs[i], end, type:ts[i], fx:fx[i]}); }
  // pattern interrupt: no shot longer than 3.5 s; split long ones on a beat
  const outL = [];
  list.forEach(s=>{
    let a = s.start; const segs = [];
    while(s.end - a > 3.5){
      const mid = a + Math.min(3.0, (s.end-a)/2);
      const bt = beats.filter(b=>b>a+1.2 && b<s.end-1.0).reduce((best,b)=>Math.abs(b-mid)<Math.abs(best-mid)?b:best, mid) - 1/30;
      segs.push([a, bt]); a = bt;
    }
    segs.push([a, s.end]);
    segs.forEach(([x,y],k)=>outL.push({start:x, end:y, type: k ? 'cut' : s.type, fx: k ? 'Hard cut' : s.fx}));
  });
  basePlan = outL; plan = adaptPlan();
}
function drawMusic(){
  const cv = $('mwave'), dpr = window.devicePixelRatio||1, w = Math.max(1,Math.round(cv.clientWidth*dpr)), h = Math.round(84*dpr);
  cv.width = w; cv.height = h; const g = cv.getContext('2d'); g.clearRect(0,0,w,h);
  const M = song ? song.mono : mono; if(!M) return;
  const D = song ? song.buf.duration : buf.duration, part = song && sec.len && buf !== song.buf;
  const a0 = part ? Math.round((dragStart ?? secStart)/D*w) : 0, a1 = part ? Math.round(((dragStart ?? secStart) + (dragStart != null ? secLenNow() : buf.duration))/D*w) : w;
  const spp = M.length/w, wave = css('--wave');
  for(let x=0;x<w;x++){ let mx=0; const a=Math.floor(x*spp), b=Math.min(M.length,Math.floor((x+1)*spp)); for(let i=a;i<b;i+=4){ const v=Math.abs(M[i]); if(v>mx) mx=v; } const bh=Math.max(1,mx*h*0.9);
    g.globalAlpha = (x >= a0 && x <= a1) ? 1 : 0.28; g.fillStyle = wave; g.fillRect(x,(h-bh)/2,1,bh); }
  g.globalAlpha = 1;
  if(part){ g.strokeStyle = css('--accent') || css('--drop'); g.lineWidth = 2*dpr; g.strokeRect(a0+dpr, dpr, Math.max(2, a1-a0-2*dpr), h-2*dpr); }
  if(dragStart == null) plan.forEach(s=>{ g.fillStyle = css(TCOL[s.type]); g.fillRect(Math.round((secStart + s.start)/D*w),0,Math.max(2,dpr*1.5),h); });
  // where the song's part is playing (or was paused)
  const ph = song && (partSrc || partPos != null) ? partNow() : null;
  if(ph != null && dragStart == null){ const x = Math.round(ph/D*w); g.fillStyle = css('--foreground') || '#fff'; g.fillRect(x - dpr, 0, 2*dpr, h); g.beginPath(); g.arc(x, 4*dpr, 4*dpr, 0, Math.PI*2); g.fill(); }
}
// The sound of any file: the browser's own decoder first (MP3, M4A, WAV, AAC, MP4 ...). Safari cannot decode the sound of a
// QuickTime .MOV (every iPhone video) that way, and decoding a big video whole would need it all in memory: for those,
// mediabunny copies just the sound track, unchanged, into a small .m4a that the browser's decoder accepts (fast, any
// browser); a sound that cannot be copied so is decoded with WebCodecs where the browser has an audio decoder.
async function decodeAnyAudio(file){
  const c = getCtx(), isVideo = /^video\//.test(file.type) || /\.(mov|mp4|m4v|3gp|webm|mkv)$/i.test(file.name);
  let firstErr = null;
  if(!isVideo || file.size < 60e6){
    try{ return await c.decodeAudioData(await file.arrayBuffer()); }catch(e){ firstErr = e; }
  }
  const mb = await loadMediabunny();
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  try{
    const track = await input.getPrimaryAudioTrack();
    if(!track) throw new Error('no sound in this file');
    try{
      const output = new mb.Output({ format: new mb.Mp4OutputFormat(), target: new mb.BufferTarget() });
      const conv = await mb.Conversion.init({ input, output, video: { discard: true }, audio: { forceTranscode: false } });
      if(conv.isValid){ await conv.execute(); return await c.decodeAudioData(output.target.buffer); }
    }catch(e){ console.warn('copying the sound track did not work', e); }
    if(!(await track.canDecode())) throw firstErr || new Error('this sound cannot be read here');
    // decoded here; a decoder that stops giving sound must not hang the page (8 s without output: give up)
    const parts = []; let n = 0, sr = track.sampleRate, ch = track.numberOfChannels;
    const it = new mb.AudioBufferSink(track).buffers();
    for(;;){
      let to; const r = await Promise.race([it.next(), new Promise(res=>{ to = setTimeout(()=>res(null), 8000); })]); clearTimeout(to);
      if(!r){ try{ it.return(); }catch(e){} throw new Error('the audio decoder stopped'); }
      if(r.done) break;
      parts.push(r.value.buffer); n += r.value.buffer.length; sr = r.value.buffer.sampleRate; ch = r.value.buffer.numberOfChannels;
    }
    if(!n) throw new Error('no sound in this file');
    const out = c.createBuffer(ch, n, sr);
    for(let k=0;k<ch;k++){ const d = out.getChannelData(k); let o = 0; for(const p of parts){ d.set(p.getChannelData(Math.min(k, p.numberOfChannels-1)), o); o += p.length; } }
    return out;
  } finally { try{ input.dispose(); }catch(e){} }
}
async function loadMusic(file, cached = null){
  const name = file.name, token = ++musicToken;   // a newer song wins over anything still running for an older one
  stopAll();
  $('s1st').textContent = 'Analysing the song… (you can keep using the page)'; $('mname').textContent = name; $('s1').classList.remove('done');
  tasks.start('song', 'music', 'Adding your song', 'Reading the sound of ' + name.replace(/\.[^.]+$/, ''));
  let whole;
  try{ whole = await decodeAnyAudio(file); }
  catch(e){ if(token !== musicToken) return; console.warn('song not readable', e); tasks.fail('song', 'This file has no sound we can read. Try an MP3, M4A or WAV.'); $('s1st').textContent = 'Could not read the sound of this file. Use MP3, M4A, WAV or a video with sound. (Songs in the Apple Music app are protected and cannot be opened by websites.)'; return; }
  if(token !== musicToken) return;
  const m = new Float32Array(whole.length);
  { const ch = whole.numberOfChannels; for(let c=0;c<ch;c++){ const d = whole.getChannelData(c); for(let i=0;i<m.length;i++) m[i] += d[i]/ch; } }
  song = { buf: whole, mono: m, r: null, name, file, key: name + '|' + whole.duration.toFixed(2) };
  buf = whole; mono = m; secStart = 0; capWords = null; capLines = null; capAll = null;
  drawMusic();
  let r = cached && cached.r;
  tasks.update('song', null, r ? 'Using the beats found before' : 'Finding the beats, drops and breaks');
  if(!r){
    try{ r = await analyseInWorker(m, whole.sampleRate); }
    catch(err){ console.warn('song analysis worker unavailable, analysing on the page', err); await new Promise(rr=>setTimeout(rr,30)); r = songAnalysis(m, whole.sampleRate); }
  }
  if(token !== musicToken) return;   // another song was chosen meanwhile
  song.r = r; song.source = r.beatSource || 'own';
  await useSection(token);
  if(token !== musicToken) return;
  $('s1st').textContent = 'Ready'; $('s1').classList.add('done'); $('s2').classList.remove('locked'); $('lenrow').hidden = kind === 'talk';
  tasks.done('song', 'Song ready' + (sources.length ? '' : ' · now add your clips'));
  if(cached && cached.aiDone){ $('s1st').textContent = 'Ready · beats as checked before'; rememberSong(file, r, true); }
  else { rememberSong(file, r, false); checkBeatsWithAi(token); }
  if(capsOn) loadCaptions();
}

/* ---- how much of the song: the whole song, or a part of 15 s / 30 s / 1 min / any length ----
 * The whole song is analysed once (its beats are judged on all of its music); a part is cut out of it on whole beats,
 * so the cut lands on the grid of the whole song. "Best part" picks the part itself: full and loud, the drop early (a
 * hook in the first seconds), no quiet start; dragging on the waveform picks it by hand (snapped to the nearest beat). */
let song = null, sec = { len: 0, auto: true, start: 0 }, secStart = 0, dragStart = null, secBusy = 0, partSrc = null, partFrom = 0, partT0 = 0, partPos = null, partRaf = 0;   // part*: the song's part heard on the waveform (playPart)
const secLenNow = () => partBeats(sec.len).len;
// whole beats nearest to the length asked (never longer by more than a few hundredths), whole bars when that costs at
// most one beat; no steady beat: the length as asked
function partBeats(L){
  const r = song && song.r, p = r && r.period;
  if(!p || !r.beats || r.beats.length < 8) return { n: 0, len: L };
  let n = Math.floor((L + 0.05)/p); if(n % 4 && (n - n % 4) >= 4 && (n % 4) <= 1) n -= n % 4;
  return { n: Math.max(4, n), len: Math.max(4, n)*p };
}
function bestPart(L){
  const r = song.r, D = song.buf.duration, bt = r.beats || [], hs = r.hopSec, E = r.rmsF;
  if(D <= L + 0.5) return 0;
  const starts = bt.length >= 8 ? bt.filter(t => t + L <= D - 0.05) : Array.from({length: Math.floor((D-L)/0.5)+1}, (_,i)=>i*0.5);
  if(!starts.length) return 0;
  const eAt = (a, b) => { const fa = Math.max(0, Math.floor(a/hs)), fb = Math.min(E.length, Math.ceil(b/hs)); let s2 = 0; for(let f=fa; f<fb; f++) s2 += E[f]; return s2/Math.max(1, fb-fa); };
  let eMax = 1e-9; const ew = starts.map(t => { const v = eAt(t, t+L); if(v > eMax) eMax = v; return v; });
  const drops = (r.cuts || []).filter((c,k)=>r.cutType[k] === 'drop'), brk = (r.cuts || []).filter((c,k)=>r.cutType[k] === 'break');
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
function snapToBeat(t){ const bt = song.r.beats || []; if(bt.length < 8) return Math.max(0, t); let b = bt[0]; for(const x of bt) if(Math.abs(x - t) < Math.abs(b - t)) b = x; return b; }
async function useSection(token = musicToken){
  if(!song || !song.r) return;
  if(kind === 'talk'){ drawMusic(); if(sources.length && !recording && !(talk && talk.songKey === song.key)) buildTalk(); return; }
  const run = ++secBusy, W = song.buf, D = W.duration, sr = W.sampleRate;
  let r;
  if(!sec.len || sec.len >= D - 0.3){
    buf = W; mono = song.mono; secStart = 0; r = song.r;
  } else {
    const pb = partBeats(sec.len), L = Math.min(pb.len, D);
    let st = sec.auto ? bestPart(L) : snapToBeat(sec.start);
    st = Math.max(0, Math.min(st, D - L)); sec.start = st;
    const a = Math.round(st*sr), n = Math.min(W.length - a, Math.round(L*sr));
    const part = getCtx().createBuffer(W.numberOfChannels, n, sr), fi = Math.round(0.006*sr), fo = Math.round(Math.min(0.35, L*0.05)*sr);
    for(let c=0;c<W.numberOfChannels;c++){ const d = part.getChannelData(c); d.set(W.getChannelData(c).subarray(a, a+n));
      for(let i=0;i<fi;i++) d[i] *= i/fi; for(let i=0;i<fo;i++) d[n-1-i] *= i/fo; }   // no click in, a short fade out
    const m = song.mono.slice(a, a+n);
    const given = (song.r.beats || []).filter(t => t >= st - 0.01 && t < st + L - 0.02).map(t => Math.max(0, t - st));
    const opts = given.length >= 4 ? { forceBeats: given, forceSource: song.source } : {};
    try{ r = await analyseInWorker(m, sr, opts); }catch(err){ r = songAnalysis(m, sr, opts); }
    if(run !== secBusy || token !== musicToken) return;
    // drops and breaks are judged on the whole song (a drop needs what came before it, which the part may not have; a
    // part's own edges look like breaks): each cut of the part takes the kind of the whole song's cut at the same
    // moment; one the whole song does not have is a plain cut; a part that starts on a drop starts with one
    { const W2 = (song.r.cuts || []).map((c,k)=>({ t: c - st, ty: song.r.cutType[k], fx: song.r.cutFx[k] })).filter(c => c.t > -0.15 && c.t < L + 0.15);
      const near = t => { let b = null, bd = 0.12; for(const c of W2){ const d = Math.abs(c.t - t); if(d < bd){ bd = d; b = c; } } return b; };
      r = { ...r, cuts: r.cuts.slice(), cutType: r.cutType.slice(), cutFx: r.cutFx.slice() };
      r.cuts.forEach((t,k)=>{ const w = near(t);
        if(w){ r.cutType[k] = w.ty; r.cutFx[k] = w.fx; }
        else if(r.cutType[k] === 'drop' || r.cutType[k] === 'break'){ r.cutType[k] = 'cut'; r.cutFx[k] = 'Hard cut'; } });
      const d0 = W2.find(c => c.ty === 'drop' && Math.abs(c.t) < 0.12);
      if(d0 && !(r.cuts.length && r.cuts[0] < 0.12)){ r.cuts.unshift(0); r.cutType.unshift('drop'); r.cutFx.unshift(d0.fx); } }
    buf = part; mono = m; secStart = st;
  }
  musicKey = song.key + (secStart || buf !== W ? '@' + secStart.toFixed(2) + '+' + buf.duration.toFixed(2) : '');
  applyAnalysis(r);
  { let s=0,n=0; for(let i=0;i<mono.length;i+=64){ const v=mono[i]; if(Math.abs(v)>0.003){ s+=v*v; n++; } }
    const rms = 10*Math.log10(s/Math.max(1,n)+1e-12); normGain = Math.pow(10, Math.max(-6, Math.min(9, -14 - rms))/20); }
  $('mdur').textContent = fmt(buf.duration) + (buf !== W ? ' of ' + fmt(D) : '');
  $('sinfo').textContent = sec.len && buf === W ? 'the song is ' + fmt(D).replace(/\.\d+$/,'') + ' long: all of it is used' : buf !== W ? fmt(secStart).replace(/\.\d+$/,'') + ' – ' + fmt(secStart + buf.duration).replace(/\.\d+$/,'') + (sec.auto ? ' · best part' : ' · your pick') : '';
  pos = 0; baseBuf = buf; baseNorm = normGain; if(vo) applyVo();
  if(capsOn){ if(capAll && (secStart < capAll.from || secStart + buf.duration > capAll.from + 180)) loadCaptions(); else shiftCaptions(); }
  if(sources.length && !recording) makeEdit();
}
function setLen(L){
  if(recording) return;
  sec.len = L; sec.auto = true;
  [...$('slen').children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.l === (L === 0 ? '0' : [15,30,60].includes(L) ? String(L) : 'c'))));
  $('slencw').hidden = $('slen').querySelector('[data-l="c"]').getAttribute('aria-pressed') !== 'true';
  $('sauto').hidden = !L; $('lenhint').hidden = !L; $('mwave').classList.toggle('drag', !!L);
  if(playing) stopAll();
  useSection();
}
$('slen').addEventListener('click', e => { const b = e.target.closest('button'); if(!b) return;
  setLen(b.dataset.l === 'c' ? Math.max(5, Math.min(180, +$('slenc').value || 45)) : +b.dataset.l); }, SIG);
$('slenc').addEventListener('change', () => setLen(Math.max(5, Math.min(180, +$('slenc').value || 45))), SIG);
$('sauto').addEventListener('click', () => { sec.auto = true; if(playing) stopAll(); useSection(); }, SIG);
// the song's part, heard on the waveform: let go of the part and it plays from its start; a tap pauses it and a tap
// plays it again from there; a line on the waveform shows where it is. It stops when the Reel plays.
function partNow(){ return partSrc ? partFrom + (getCtx().currentTime - partT0) : partPos; }
function stopPart(keep){
  if(partSrc){ const s = partSrc, at = partNow(); partSrc = null; try{ s.stop(); }catch(e){} partPos = keep ? at : null; }
  else if(!keep) partPos = null;
  cancelAnimationFrame(partRaf); if(song) drawMusic();
}
function playPart(from, base){
  if(!song || !song.buf) return; stopPart();
  const D = song.buf.duration, a = base ?? secStart, end = Math.min(D, a + (sec.len ? secLenNow() : D - a));
  let st = from ?? a; if(st < a || st >= end - 0.15) st = a;
  const len = end - st; if(len < 0.2) return;
  const c = getCtx(); if(c.state === 'suspended') c.resume();
  const s = c.createBufferSource(), g = c.createGain(), t = c.currentTime + 0.02;
  s.buffer = song.buf; s.connect(g); g.connect(c.destination);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 0.06); g.gain.setValueAtTime(1, Math.max(t + 0.06, t + len - 0.3)); g.gain.linearRampToValueAtTime(0, t + len);
  s.onended = () => { if(partSrc !== s) return; partSrc = null; partPos = null; cancelAnimationFrame(partRaf); drawMusic(); };
  s.start(t, st, len); partSrc = s; partFrom = st; partT0 = t; partPos = null;
  const tick = () => { if(partSrc !== s) return; drawMusic(); partRaf = requestAnimationFrame(tick); };
  partRaf = requestAnimationFrame(tick);
}
// drag on the waveform: the part follows the finger, and is cut (and heard) when let go
{ const cv = $('mwave'); let grab = 0, downX = 0, moved = false, down = false, wasPlaying = false;
  const tAt = ev => { const rc = cv.getBoundingClientRect(); return (ev.clientX - rc.left)/Math.max(1, rc.width)*song.buf.duration; };
  cv.addEventListener('pointerdown', ev => { if(!song || !song.r || recording) return;
    down = true; moved = false; downX = ev.clientX; wasPlaying = !!partSrc;
    if(sec.len){ const t = tAt(ev), L = secLenNow(); grab = (t >= secStart && t <= secStart + L) ? t - secStart : L/2; }
    cv.setPointerCapture(ev.pointerId); ev.preventDefault(); }, SIG);
  cv.addEventListener('pointermove', ev => { if(!down || !sec.len) return;
    if(!moved && Math.abs(ev.clientX - downX) < 6) return;   // a tap, not a drag (yet)
    if(!moved){ moved = true; stopPart(); if(playing) stopAll(); }
    const L = secLenNow(); dragStart = Math.max(0, Math.min(song.buf.duration - L, tAt(ev) - grab)); drawMusic(); }, SIG);
  const end = () => { if(!down) return; down = false;
    if(!moved){ if(wasPlaying) stopPart(true); else { const at = partPos; if(playing) stopAll(); playPart(at); } return; }   // a tap: pause, or play (on from where it was)
    sec.start = dragStart; sec.auto = false; dragStart = null; const st = sec.start; useSection(); playPart(st, st); };
  cv.addEventListener('pointerup', end, SIG); cv.addEventListener('pointercancel', end, SIG); }
let beatInfo = { source: 'own', note: '' };
function applyAnalysis(r){
  ({ period, phase, hopSec, rmsF, onEnv, onFps, onOff, hitsRaw, hitsStr, pfArr, beats, cuts, cutType, cutFx, peaks, peakS, barOff } = r);
  buildPlan(); drawMusic();
  $('mbpm').textContent = (60/period).toFixed(0);
  $('mclips').textContent = plan.length; $('mdrop').textContent = plan.filter(s=>s.type==='drop').length; $('mbreak').textContent = plan.filter(s=>s.type==='break').length;
}
// Second opinion on the beats: Beat This! (a neural network trained on thousands of hand-annotated songs) runs on this
// device in the background; the analysis then keeps whichever beats land on stronger hits with a steadier pulse (each
// tracker misses different songs) and the edit follows. The page stays usable; the first edit never waits for it.
let beatsBusy = false;
async function checkBeatsWithAi(token){
  if(!aiBeats || !song) return;
  beatsBusy = true; try{ await checkBeatsInner(token); } finally { beatsBusy = false; }
}
async function checkBeatsInner(token){
  const sr = song.buf.sampleRate, m = song.mono, base = 'Ready';
  const say = t => { if(token === musicToken) $('s1st').textContent = t; };
  say(base + ' · Shubix is checking the beats on this phone…');
  let beatStage = '';
  if(token === musicToken) tasks.start('beats', 'ai', 'Checking the beats', 'Shubix listens to your song on this phone');
  let bt;
  try{ bt = await aiBeats(m, sr, (stage, p) => { say(base + (stage === 'download' ? ' · getting the Shubix beat tracker (once) ' : ' · Shubix beat check ') + Math.round(p*100) + '%'); if(token !== musicToken) return;
      if(stage !== beatStage){ beatStage = stage; tasks.start('beats', 'ai', stage === 'download' ? 'Getting the Shubix beat tracker' : 'Checking the beats', stage === 'download' ? 'Only the first time · kept on this phone' : 'Shubix listens to your song on this phone'); }
      tasks.update('beats', p, stage === 'download' && p >= 1 ? 'Downloaded · starting Shubix' : undefined); }); }
  catch(err){ beatInfo = { source: 'own', note: String(err && err.message || err) }; say(base); tasks.clear('beats'); console.info('on-device beat tracker not used:', beatInfo.note); return; }
  if(token !== musicToken) return;
  let r;
  try{ r = await analyseInWorker(m, sr, { beats: bt.beats }); } catch(err){ r = songAnalysis(m, sr, { beats: bt.beats }); }
  if(token !== musicToken) return;
  beatInfo = { source: r.beatSource, note: '', ms: bt.ms, judge: r.beatJudge, ai: bt };
  while(exportBusy) await new Promise(rr=>setTimeout(rr, 500));   // the video being made keeps its edit; the better beats come after
  if(token !== musicToken) return;
  song.r = r; song.source = r.beatSource; rememberSong(song.file, r, true);
  const was = playing && !recording;
  await useSection(token);
  if(token !== musicToken) return;
  say(base + (r.beatSource === 'ai' ? ' · beats confirmed by Shubix on this phone (Beat This!)' : ' · beats double-checked: Shubix agrees or fits less well, kept'));
  if(token === musicToken) tasks.done('beats', 'Beats checked');
  if(sources.length && was) showMsg('Beats fine-tuned: your edit now follows them. Tap Preview to see it.');
}
$('mpick').onclick = () => $('mfile').click();
$('mfile').addEventListener('change', e=>{ const f=e.target.files[0]; e.target.value=''; if(f) loadMusic(f); });
window.addEventListener('resize', ()=>{ drawMusic(); sources.forEach(drawSpark); drawTimeline(); }, SIG);

/* =============== STEP 2: VIDEOS =============== */
const sources = []; // {name,url,dur,w,h,samples:[{t,m,b,cx}], els:[v,v], use:0}
const SW = 48, SH = 27;
function waitEv(el, ev, ms=8000){ return new Promise((res,rej)=>{ const t=setTimeout(()=>{ cleanup(); rej(new Error('timeout '+ev)); }, ms); const ok=()=>{ cleanup(); res(); }; const bad=()=>{ cleanup(); const me = el.error; rej(new Error('error' + (me ? ' ' + me.code + (me.message ? ': ' + me.message : '') : ''))); }; function cleanup(){ clearTimeout(t); el.removeEventListener(ev,ok); el.removeEventListener('error',bad); } el.addEventListener(ev,ok,{once:true}); el.addEventListener('error',bad,{once:true}); }); }
function makeVideo(url){ const v=document.createElement('video'); v.muted=true; v.defaultMuted=true; v.playsInline=true; v.setAttribute('playsinline',''); v.setAttribute('webkit-playsinline',''); v.setAttribute('muted',''); v.preload='auto'; v.crossOrigin='anonymous'; v.src=url; return v; }
// A video's pictures, ready to draw. iPhone Safari loads only the metadata of a video nobody has played ('preload' is
// ignored there), so a video that never played has no picture to draw or seek to; a muted inline video may play without a
// tap, and a moment of playing brings its pictures in. Other browsers return at once.
async function videoData(v, ms=12000){
  if(v.readyState >= 2) return;
  if(v.readyState < 1) await waitEv(v, 'loadedmetadata', ms);
  if(v.readyState >= 2) return;
  const got = waitEv(v, 'loadeddata', ms);
  const nudge = setTimeout(()=>{ if(v.readyState < 2){ const p = v.play(); if(p && p.then) p.then(()=>v.pause(), ()=>{}); } }, 400);
  try{ await got; } finally { clearTimeout(nudge); if(!v.paused) v.pause(); }
}
// Frames of a clip, for reading it (motion, scene changes, faces, the AI's look): decoded with WebCodecs through mediabunny
// where the browser can (the same frames on every phone, as fast as the decoder, whatever the browser does with <video>
// elements), else taken from a video element by seeking. frames(ts) gives one drawable per time (null when there is none),
// to be used before the next one is asked for; at(t) gives one.
async function clipReader(src, maxSide){
  try{
    const mb = await loadMediabunny();
    const input = new mb.Input({ source: new mb.BlobSource(src.file), formats: mb.ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if(!track || !(await track.canDecode())){ try{ input.dispose(); }catch(e){} throw new Error('no WebCodecs decoder'); }
    const first = await track.getFirstTimestamp(), sc = Math.min(1, maxSide/Math.max(src.w, src.h));
    const sink = new mb.CanvasSink(track, { width: Math.max(2, Math.round(src.w*sc/2)*2), height: Math.max(2, Math.round(src.h*sc/2)*2), fit: 'fill', poolSize: 2 });
    return { fast: true,
      async *frames(ts){ for await (const wc of sink.canvasesAtTimestamps(ts.map(t=>first + t))) yield wc ? wc.canvas : null; },
      async at(t){ const wc = await sink.getCanvas(first + t); return wc ? wc.canvas : null; },
      close(){ try{ input.dispose(); }catch(e){} } };
  }catch(err){
    const v = makeVideo(src.url); await videoData(v);
    const at = async (t) => { t = Math.min(Math.max(0, t), Math.max(0, v.duration - 0.02)); if(Math.abs(v.currentTime - t) < 1e-3) return v;
      v.currentTime = t; try{ await waitEv(v, 'seeked', 3000); }catch(e){ return null; } return v; };
    return { fast: false, v,
      async *frames(ts){ for(const t of ts) yield await at(t); },
      at,
      close(){ v.removeAttribute('src'); v.load(); } };
  }
}

async function scanMotion(src, onProgress){
  // read the clip's frames (see clipReader) and compare small frames: how much moves, where it moves, how bright
  const rd = await clipReader(src, 256);
  const c = document.createElement('canvas'); c.width=SW; c.height=SH; const g = c.getContext('2d', {willReadFrequently:true});
  const c2 = document.createElement('canvas'); c2.width=128; c2.height=72; const g2 = c2.getContext('2d', {willReadFrequently:true});
  let prev = null; const out = [], hists = [], lums = [];
  const grab = (v, t) => {
    g.drawImage(v,0,0,SW,SH); const d = g.getImageData(0,0,SW,SH).data;
    const lum = new Float32Array(SW*SH); let b=0;
    for(let i=0;i<SW*SH;i++){ const y=(d[i*4]*0.3+d[i*4+1]*0.59+d[i*4+2]*0.11)/255; lum[i]=y; b+=y; }
    hists.push(colorHist(d)); lums.push(lum);
    const sal = saliency(d);   // what stands out from the picture (a person in red on a grey street), moving or not
    let m=0, mx=0;
    if(prev){ for(let i=0;i<lum.length;i++){ const df=Math.abs(lum[i]-prev[i]); m+=df; mx+=df*((i%SW)+0.5)/SW; } }
    const sub = prev ? subjectMotion(prev, lum) : null;   // where something moves on its own (camera motion removed)
    // sharpness: how strong the fine edges are (Laplacian variance) - blurry or shaky frames score low
    g2.drawImage(v,0,0,128,72); const d2 = g2.getImageData(0,0,128,72).data, L2 = new Float32Array(128*72);
    for(let i=0;i<L2.length;i++) L2[i] = d2[i*4]*0.3+d2[i*4+1]*0.59+d2[i*4+2]*0.11;
    let sm=0, sq=0, n=0;
    for(let y=1;y<71;y++) for(let x=1;x<127;x++){ const i=y*128+x, lap = 4*L2[i]-L2[i-1]-L2[i+1]-L2[i-128]-L2[i+128]; sm+=lap; sq+=lap*lap; n++; }
    const sh = sq/n - (sm/n)*(sm/n);
    out.push({t, m: prev ? m/lum.length : 0, b:b/lum.length, cx: m>1e-6 ? mx/m : 0.5, sh,
      sx: sub ? sub.x : -1, sy: sub ? sub.y : -1, sw: sub ? sub.w : 0, gx: sub ? sub.gx : 0, gy: sub ? sub.gy : 0, ax: sal.x, ay: sal.y, aw: sal.w});
    prev = lum;
  };
  // a frame every 1/30 s for short clips, sparser for long ones (at most every 0.2 s): about what playing the clip at 2-12x
  // speed on a 60 Hz screen used to sample, which the thresholds below were tuned on
  const step = Math.max(1/30, Math.min(12, Math.max(2, src.dur/6))/60), ts = [];
  for(let t=0; t<src.dur-0.02; t+=step) ts.push(+t.toFixed(4));
  try{
    let k = 0;
    for await (const img of rd.frames(ts)){ const t = ts[k++]; if(img) grab(img, t); if(k % 8 === 0) onProgress(t/src.dur); }
  }catch(err){ console.warn('reading frames failed', err); }
  if(!out.length) { rd.close(); throw new Error('no frames could be read'); }
  // order by time (callbacks can arrive out of order around the end); keep histograms paired with their samples
  const idx = out.map((s,i)=>i).sort((a,b)=>out[a].t-out[b].t);
  const S = idx.map(i=>out[i]), H = idx.map(i=>hists[i]), LM = idx.map(i=>lums[i]);
  if(S.length>1) S[0].m = S[1].m;
  // scene changes inside the clip (hard cuts, fades through black, dissolves): no shot may cross one
  try{ src.scenes = await findScenes(rd, src, S, H, LM); } finally { rd.close(); }
  // a cut inside the clip looks like a burst of "action": the samples at a cut get the motion of their neighbours
  for(const sc of src.scenes){ S.forEach((s,i)=>{ if(s.t >= sc.t0-0.01 && s.t <= sc.t1+0.3){ const a=S[i-2]||S[i+2]||s; s.m = Math.min(s.m, a.m); s.sw = 0; s.cut = true; } }); }
  // smooth motion a little
  src.samples = S.map((s,i)=>({...s, m: (S[Math.max(0,i-1)].m + s.m + S[Math.min(S.length-1,i+1)].m)/3}));
}

/* ---- scene changes inside a clip ---- */
// What a scene looks like, for spotting a change of scene: a 4x4x4 RGB colour histogram (blind to motion, very sensitive
// to new colours), a 16-bin brightness histogram and the brightness of an 8x5 grid of blocks (these two catch the cuts a
// colour histogram cannot see: black and white footage, night scenes, two shots in the same colours). Normalised.
const FEAT = 64 + 16 + 40;
function colorHist(d){
  const h = new Float32Array(FEAT), gs = new Float32Array(40); let n = 0;
  for(let i=0;i<d.length;i+=4){
    h[((d[i]>>6)<<4) | ((d[i+1]>>6)<<2) | (d[i+2]>>6)]++;
    const y = 0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]; h[64 + Math.min(15, y>>4)]++;
    const p = i>>2, x = p % SW, yy = (p / SW) | 0; const gi = Math.min(4, (yy*5/SH)|0)*8 + Math.min(7, (x*8/SW)|0); h[80 + gi] += y/255; gs[gi]++;
    n++; }
  for(let k=0;k<80;k++) h[k] /= n;
  for(let k=0;k<40;k++) h[80+k] /= Math.max(1, gs[k]);
  return h;
}
// Frequency-tuned saliency (Achanta et al. 2009) on the small frame: how far each pixel's colour (in a Lab-like space)
// is from the picture's average colour. Its centre and how concentrated it is say where the eye goes.
function saliency(d){
  const n = SW*SH, L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n); let mL=0, mA=0, mB=0;
  for(let i=0;i<n;i++){ const r=d[i*4]/255, g=d[i*4+1]/255, b=d[i*4+2]/255;
    L[i] = 0.3*r+0.59*g+0.11*b; A[i] = r-g; B[i] = 0.5*(r+g)-b; mL+=L[i]; mA+=A[i]; mB+=B[i]; }
  mL/=n; mA/=n; mB/=n;
  const s = new Float32Array(n); let sm=0, sq=0;
  for(let i=0;i<n;i++){ const v = Math.hypot(0.6*(L[i]-mL), 1.6*(A[i]-mA), 1.6*(B[i]-mB)); s[i]=v; sm+=v; sq+=v*v; }
  const mean = sm/n, sd = Math.sqrt(Math.max(0, sq/n-mean*mean)), th = mean + 1.5*sd;
  let w=0, x=0, y=0, xx=0, yy=0;
  for(let i=0;i<n;i++){ const r = s[i]-th; if(r>0){ const px=((i%SW)+0.5)/SW, py=(((i/SW)|0)+0.5)/SH; w+=r; x+=r*px; y+=r*py; xx+=r*px*px; yy+=r*py*py; } }
  if(w < 1e-4 || sd < 0.03) return {x:0.5, y:0.5, w:0};
  x/=w; y/=w; const spread = Math.sqrt(Math.max(0, xx/w-x*x + yy/w-y*y));
  return {x, y, w: Math.min(1, sd/0.12) * Math.max(0, 1 - spread/0.25)};   // strong contrast, in one place
}
// 0 = the same scene, 1 = nothing shared: the strongest of the three views (colours, brightness, layout)
// (brightness: the earth mover's distance between the two histograms, i.e. how far the brightness moved, so a change of
// grain or compression on a flat picture does not count, a jump to a darker or brighter scene does)
const colourD = (a, b) => { let c=0; for(let k=0;k<64;k++) c += Math.abs(a[k]-b[k]); return c/2; };
const histD = (a, b) => { let c=0, l=0, ca=0, cb=0, g=0; for(let k=0;k<64;k++) c += Math.abs(a[k]-b[k]);
  for(let k=64;k<80;k++){ ca += a[k]; cb += b[k]; l += Math.abs(ca-cb); }
  for(let k=80;k<FEAT;k++) g += Math.abs(a[k]-b[k]);
  return Math.max(c/2, Math.min(1, 2.5*l/15), Math.min(1, 2.5*g/40)); };
// camera motion is estimated as one global shift (block matching on the 48x27 frame), what still differs after that
// shift is the subject: its centre, its weight and how concentrated it is
function subjectMotion(prev, cur){
  const R = 3; let best = Infinity, bdx = 0, bdy = 0;
  for(let dy=-R; dy<=R; dy++) for(let dx=-R; dx<=R; dx++){
    let s = 0; for(let y=R; y<SH-R; y++){ const o=y*SW, op=(y-dy)*SW-dx; for(let x=R; x<SW-R; x++) s += Math.abs(cur[o+x]-prev[op+x]); }
    s += 0.002*(dx*dx+dy*dy)*SW*SH;   // prefer "no camera move" when it is a tie
    if(s < best){ best = s; bdx = dx; bdy = dy; }
  }
  let w = 0, x = 0, y = 0, xx = 0, yy = 0, n = 0;
  for(let yy0=R; yy0<SH-R; yy0++) for(let x0=R; x0<SW-R; x0++){
    const r = Math.abs(cur[yy0*SW+x0] - prev[(yy0-bdy)*SW + x0-bdx]) - 0.05; n++;   // 0.05: noise / compression
    if(r > 0){ const px=(x0+0.5)/SW, py=(yy0+0.5)/SH; w+=r; x+=r*px; y+=r*py; xx+=r*px*px; yy+=r*py*py; }
  }
  if(w < 1e-3) return {x:0.5, y:0.5, w:0, gx: bdx, gy: bdy};
  x/=w; y/=w; const spread = Math.sqrt(Math.max(0, xx/w-x*x + yy/w-y*y));
  // weight: enough moving pixels, and in one place (a whole-frame change is lighting or a fast pan, not a subject)
  const conc = Math.max(0, 1 - spread/0.32);
  return {x, y, w: Math.min(1, w/n*25) * conc, gx: bdx, gy: bdy};
}
// Candidates come from the samples (adaptive threshold: a cut is a spike far above the change around it, a fast pan is
// not; a flash returns to the same picture and is not a cut). Hard cuts are then pinned to the frame by bisection.
async function findScenes(rd, src, S, H, LM){
  const n = S.length, out = []; if(n < 3) return out;
  const c = new Float32Array(n); for(let i=1;i<n;i++) c[i] = histD(H[i-1], H[i]);
  const isCut = new Uint8Array(n);
  for(let i=1;i<n;i++){
    let s=0, k=0; for(let j=Math.max(1,i-5); j<=Math.min(n-1,i+5); j++) if(Math.abs(j-i)>1){ s+=c[j]; k++; }
    const local = k ? s/k : 0;
    if(c[i] < 0.28 || c[i] < 2.6*local + 0.08) continue;
    if(c[i] < c[i-1] || (i+1<n && c[i] < c[i+1])) continue;   // the peak of a two-sample change
    // a flash or a passing object: the picture soon returns to what it was
    let back = false; for(let j=i+1; j<n && S[j].t <= S[i].t+0.5; j++) if(histD(H[i-1], H[j]) < 0.45*c[i]){ back = true; break; }
    if(back) continue;
    // and the picture well before must differ from the picture well after (coming back from a flash is not a cut)
    const pre = nearestS(S, S[i-1].t-0.45), post = nearestS(S, S[i].t+0.35);
    if(histD(H[pre], H[post]) < 0.5*c[i]) continue;
    isCut[i] = 1;
  }
  const grabH = async (t) => { let v; try{ v = await rd.at(t); }catch(e){ return null; } if(!v) return null;
    const cv = grabH.cv || (grabH.cv = Object.assign(document.createElement('canvas'), {width:SW, height:SH})), g = cv.getContext('2d', {willReadFrequently:true});
    g.drawImage(v,0,0,SW,SH); return colorHist(g.getImageData(0,0,SW,SH).data); };
  for(let i=1;i<n;i++) if(isCut[i]){
    // bisection between the last sample of the old scene and the first of the new one, to about one frame
    let lo = S[i-1].t, hi = S[i].t; const hA = H[i-1], hB = H[i];
    for(let it=0; it<8 && hi-lo > 1/60; it++){
      const mid = (lo+hi)/2, h = await grabH(mid); if(!h) break;
      if(histD(h, hA) <= histD(h, hB)) lo = mid; else hi = mid;
    }
    out.push({t0:lo, t1:hi, kind:'cut'});
  }
  // fade through black (or white): the picture goes to one flat level and comes back. The whole fade is covered: from
  // where the brightness starts to slide until it stops. A white flash in one scene is not a fade (same picture after).
  const gap = n > 1 ? (S[n-1].t - S[0].t)/(n-1) : 0.2;
  for(let i=1;i<n-1;i++){
    const dark = S[i].b < 0.05, flat = dark || S[i].b > 0.96; if(!flat) continue;
    const same = j => dark ? S[j].b < 0.05 : S[j].b > 0.96;
    let a=i; while(a>0 && same(a-1)) a--;
    let b=i; while(b<n-1 && same(b+1)) b++;
    if(a>0 && b<n-1){
      const sl = (j, k) => dark ? S[j].b > S[k].b + 0.004 : S[j].b < S[k].b - 0.004;   // still sliding towards the flat level
      let a2 = a-1; while(a2>0 && sl(a2-1, a2) && S[a].t - S[a2-1].t < 2) a2--;
      let b2 = b+1; while(b2<n-1 && sl(b2+1, b2) && S[b2+1].t - S[b].t < 2) b2++;
      // the picture just before the fade against just after it (a flash returns to the same picture)
      const pre = nearestS(S, S[a2].t-0.2), post = nearestS(S, S[b2].t+0.2);
      // through white, the colours must change (a camera pan changes the layout, not the colours: a flash in a pan is no cut)
      const changes = (dark ? histD(H[pre], H[post]) : colourD(H[pre], H[post])) > 0.3, long = dark && S[b].t - S[a].t >= 0.1;
      if(changes || long) out.push({t0:S[a2].t - gap, t1:S[b2].t + gap, kind:'fade', tc:(S[a].t + S[b].t)/2, white: !dark});   // tc: the darkest / brightest moment
    }
    i = b;
  }
  // dissolve: a short stretch (0.25-2.2 s) of steady change between two still stretches, ending on a different picture,
  // where each pixel of the middle frame is a blend of the frames before and after (a camera pan is not a blend)
  const cs = [...c].slice(1).sort((x,y)=>x-y), base = cs[cs.length>>1] || 0, thr = Math.max(0.03, 2.5*base);
  // settled: the picture barely changes in the two samples before a (it is where a transition starts) / after b (ends)
  const calmTh = Math.max(0.06, 1.5*base);
  const settledBefore = a => { const v = [c[a], c[a-1]].filter(x=>x!==undefined); return !v.length || v.reduce((q,x)=>q+x,0)/v.length < calmTh; };
  const settledAfter = b => { const v = [c[b+1], c[b+2]].filter(x=>x!==undefined); return !v.length || v.reduce((q,x)=>q+x,0)/v.length < calmTh; };
  for(let i=1;i<n;i++){
    if(c[i] <= thr) continue;
    let j = i; while(j+1<n && c[j+1] > thr) j++;
    const a = i-1, b = j, dur = S[b].t - S[a].t;
    if(dur >= 0.25 && dur <= 2.2 && histD(H[a], H[b]) >= 0.35){
      const m = (a+b)>>1, A = LM[a], B = LM[b], M = LM[m];
      let dA=0, dB=0; for(let k=0;k<M.length;k++){ dA += Math.abs(M[k]-A[k]); dB += Math.abs(M[k]-B[k]); }
      let be = Infinity; for(let al=0.05; al<0.96; al+=0.05){ let e=0; for(let k=0;k<M.length;k++) e += Math.abs(M[k] - (al*A[k] + (1-al)*B[k])); be = Math.min(be, e); }
      if(be < 0.5*Math.min(dA, dB)) out.push({t0:S[a].t - gap, t1:S[b].t + gap, kind:'dissolve'});   // a full sample of margin: its first / last frames are faint
      else if(dur <= 0.5 && settledBefore(a) && settledAfter(b)) out.push({t0:S[a].t, t1:S[b].t, kind:'cut'});   // a quick slide / whip / zoom into another scene
    } else if(dur > 0.05 && dur < 0.25 && histD(H[a], H[b]) >= 0.35 && settledBefore(a) && settledAfter(b) && !out.some(o=>o.t1 >= S[a].t - 0.05 && o.t0 <= S[b].t + 0.05)){
      out.push({t0:S[a].t, t1:S[b].t, kind:'cut'});
    }
    i = j;
  }
  // merge what overlaps (a cut found inside a fade is the fade)
  out.sort((x,y)=>x.t0-y.t0);
  const merged = [];
  for(const o of out){ const l = merged[merged.length-1]; if(l && o.t0 <= l.t1 + 0.05){ l.t1 = Math.max(l.t1, o.t1); if(l.kind==='cut'){ l.kind = o.kind; if(o.tc !== undefined){ l.tc = o.tc; l.white = o.white; } } } else merged.push({...o}); }
  return merged;
}
function nearestS(S, t){ let lo=0, hi=S.length-1; while(lo<hi){ const m=(lo+hi)>>1; if(S[m].t < t) lo=m+1; else hi=m; } return (lo>0 && Math.abs(S[lo-1].t-t) < Math.abs(S[lo].t-t)) ? lo-1 : lo; }
// does the stretch of footage [a,b] cross a scene change? (a small margin either side)
function crossesScene(src, a, b){
  const sc = src.scenes; if(!sc || !sc.length) return false;
  for(const s of sc){ if(s.t0 > b + 0.06) break; if(s.t1 >= a - 0.03 && s.t0 <= b + 0.06) return true; }
  return false;
}
async function scanFaces(src, onProgress){
  // faces: up to 2.5 looks a second (at most about 60 per clip), then cleaned up over time (see trackFaces)
  src.faces = [];
  const vj = window.tracking && tracking.ViolaJones && tracking.ViolaJones.classifiers && tracking.ViolaJones.classifiers.face;
  let blaze = !!findFaces; src.faceHow = blaze ? 'blazeface' : 'viola-jones';
  if(!blaze && !vj) return;
  const rd = await clipReader(src, 480);
  const w = 240, h = Math.round(240*src.h/src.w), c = document.createElement('canvas'); c.width=w; c.height=h;
  const g = c.getContext('2d', {willReadFrequently:true});
  const step = Math.min(1.5, Math.max(0.4, src.dur/60)), raw = [], ts = [];
  for(let tt=0.1; tt<src.dur; tt+=step) ts.push(tt);
  let k = 0;
  try{ for await (const v of rd.frames(ts)){ const tt = ts[k++]; if(!v) continue;
    if(blaze){
      try{ raw.push({t:tt, rects: await blazeFaces(v, src.w, src.h)}); }
      catch(err){ console.info('BlazeFace not used:', err && err.message); blaze = false; src.faceHow = 'viola-jones'; if(!vj) break; }
    }
    if(!blaze){
      g.drawImage(v,0,0,w,h); const px = g.getImageData(0,0,w,h).data;
      let rects = [];
      try{ rects = tracking.ViolaJones.detect(px, w, h, 1.0, 1.25, 1.5, 0.2, tracking.ViolaJones.classifiers.face) || []; }catch(e){}
      raw.push({t:tt, rects: rects.filter(r=>r.width > w*0.06).map(r=>({x:(r.x+r.width/2)/w, y:(r.y+r.height/2)/h, s:r.width/w}))});
    }
    onProgress(tt/src.dur);
    await new Promise(r=>setTimeout(r,0));
  } }catch(err){ console.warn('reading frames for faces failed', err); } finally { rd.close(); }
  src.faces = trackFaces(raw);
}
// Faces with BlazeFace (MediaPipe, in a worker): the whole frame fitted into a 128x128 square, and squares as wide as
// the frame along its long side (top, middle, bottom of a vertical video), where a face is twice as many pixels; the
// finds of all squares are merged (overlapping boxes: the surer one). Result as {x, y, s}: centre and width, fractions.
const faceSq = Object.assign(document.createElement('canvas'), {width:128, height:128}), faceG = faceSq.getContext('2d', {willReadFrequently:true});
async function blazeFaces(img, W, H){
  const L = Math.max(W, H), S = Math.min(W, H), regions = [[ (W-L)/2, (H-L)/2, L ]];
  if(L/S > 1.3) for(const f of [0, 0.5, 1]){ const o = (L - S)*f; regions.push(W >= H ? [o, 0, S] : [0, o, S]); }
  const squares = regions.map(([rx, ry, rs]) => { const k = 128/rs; faceG.fillStyle = '#000'; faceG.fillRect(0,0,128,128);
    faceG.drawImage(img, -rx*k, -ry*k, W*k, H*k); return faceG.getImageData(0,0,128,128).data; });
  const found = await findFaces(squares), all = [];
  found.forEach((list, i) => { const [rx, ry, rs] = regions[i]; for(const [sc, cx, cy, fw] of list) all.push({ sc, x: (rx + cx*rs)/W, y: (ry + cy*rs)/H, s: fw*rs/W }); });
  all.sort((a,b) => b.sc - a.sc);
  const keep = [];
  for(const f of all){ if(f.s < 0.03 || f.x < 0 || f.x > 1 || f.y < 0 || f.y > 1) continue;
    if(keep.some(k => Math.hypot((k.x - f.x)*W, (k.y - f.y)*H) < 0.5*Math.max(k.s, f.s)*W)) continue; keep.push(f); }
  return keep.slice(0, 4).map(({x, y, s}) => ({x, y, s}));
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
function drawSpark(src){
  const cv = src.spark; if(!cv || !src.samples) return;
  const dpr = window.devicePixelRatio||1, w = Math.max(1,Math.round(cv.clientWidth*dpr)), h = Math.round(22*dpr);
  cv.width=w; cv.height=h; const g=cv.getContext('2d'); g.clearRect(0,0,w,h);
  const mx = Math.max(1e-6, ...src.samples.map(s=>s.m));
  g.fillStyle = css('--drop'); g.globalAlpha=.8;
  src.samples.forEach(s=>{ const x=Math.round(s.t/src.dur*w), bh=Math.max(1,s.m/mx*h); g.fillRect(x,h-bh,Math.max(1,dpr),bh); });
}
// uploads go into a queue: you can add more videos any time, even while others are still being read
let addQueue = Promise.resolve(), pending = 0, batchN = 0, batchDone = 0;
function addVideos(files){
  const list = [...files].filter(f=>f.type.startsWith('video/') || /\.(mp4|mov|webm|m4v|3gp|mkv)$/i.test(f.name));
  if(!list.length){ $('s2st').textContent = 'That is not a video. Choose MP4, MOV or WEBM.'; return; }
  if(playing){ pos = curTime(); stopAll(); }   // free the computer so reading is fast
  const jobs = list.map(f=>makeCard(f));
  if(!pending){ batchN = 0; batchDone = 0; }
  batchN += jobs.length; pending += jobs.length; updateQ();
  tasks.start('clips', 'clips', 'Reading your clips', 'Finding the best moments in ' + batchN + ' clip' + (batchN > 1 ? 's' : ''));
  jobs.forEach(job=>{ addQueue = addQueue.then(()=>readVideo(job)).catch(()=>{}).then(()=>{ pending--; batchDone++; updateQ(); }); });
  addQueue = addQueue.then(()=>{ if(!pending) finishAdding(); });
}
function updateQ(){ $('qinfo').textContent = pending ? pending + ' clips left to read…' : ''; $('s2st').textContent = pending ? 'Reading clips…' : (sources.length + ' clips ready'); }
function makeCard(f){
  const url = URL.createObjectURL(f);
  const card = document.createElement('div'); card.className='clip';
  card.innerHTML = `<canvas class="th"></canvas><button class="del" title="Remove this clip" aria-label="Remove this clip">×</button><div class="meta"><div class="nm"></div><div class="dd">waiting…</div><canvas></canvas></div>`;
  card.querySelector('.nm').textContent = f.name; $('clips').appendChild(card);
  const src = {name:f.name, file:f, url, card, spark: card.querySelector('.meta canvas'), removed:false};
  card.__src = src; card.querySelector('.del').addEventListener('click', ()=>removeVideo(src));
  return src;
}
/* ---- what was found in a clip, kept on this phone next to the clip's file ----
 * Reading a clip (action, scene changes, faces; where people speak) takes the longest part of making a Reel, and gives the
 * same answer for the same file every time. So it is kept in the saved Reels' file store ("a:"/"v:" + the file's
 * fingerprint): opening a draft again, or adding the same clip again, uses it at once. SCAN_V: raise it when the reading
 * changes so old results are read again. They go with their clip's file (lib/drafts.ts deleteDraft; keptSweep for leftovers). */
const SCAN_V = 1;
async function keptGet(pre, f){ if(typeof indexedDB === 'undefined' || !f) return null; try{ return await idb('files', 'readonly', s => s.get(pre + fileFp(f))) || null; }catch(e){ return null; } }
function keptPut(pre, f, val){ if(typeof indexedDB === 'undefined' || !f) return; idb('files', 'readwrite', s => s.put(val, pre + fileFp(f))).catch(e => console.info('clip reading not kept:', e && e.message)); }
async function scanGet(src){
  const k = await keptGet('a:', src.file);
  return k && k.v === SCAN_V && Math.abs((k.dur || 0) - src.dur) < 0.05 && k.w === src.w && Array.isArray(k.samples) && k.samples.length ? k : null;
}
function scanPut(src){ keptPut('a:', src.file, { v: SCAN_V, dur: src.dur, w: src.w, scenes: src.scenes || [], samples: src.samples, faces: src.faces || [], faceHow: src.faceHow }); }
// results whose file is gone (its Reels deleted from Fast Studio or from My Reels): removed now and then
async function keptSweep(){
  try{ const keys = await idb('files', 'readonly', s => s.getAllKeys()) || [], have = new Set(keys.filter(k => String(k).startsWith('f:')).map(k => String(k).slice(2)));
    const old = keys.filter(k => /^[av]:/.test(String(k)) && !have.has(String(k).slice(2)));
    if(old.length) await idb('files', 'readwrite', s => { old.forEach(k => s.delete(k)); });
  }catch(e){}
}
async function readVideo(src){
  if(src.removed) return;
  const card = src.card, dd = card.querySelector('.dd');
  try{
    dd.textContent = 'reading…'; dd.dataset.st = 'read'; dd.dataset.p = '0';
    const v = makeVideo(src.url); await waitEv(v,'loadedmetadata', 15000);
    src.dur = v.duration; src.w = v.videoWidth; src.h = v.videoHeight;
    if(!isFinite(src.dur) || src.dur<=0 || !src.w) throw new Error('bad');
    await videoData(v);
    v.currentTime = Math.min(src.dur*0.3, 2); await waitEv(v,'seeked');
    const th = card.querySelector('.th'); th.width=320; th.height=180; const tg=th.getContext('2d');
    const r = Math.max(320/src.w, 180/src.h); tg.drawImage(v,(320-src.w*r)/2,(180-src.h*r)/2,src.w*r,src.h*r);
    v.removeAttribute('src'); v.load();
    if(src.removed) return;
    // action + scene changes and faces are read at the same time (two decoders): about 40% faster per clip
    const tq = performance.now(); let pm = 0, pf = 0;
    const show = () => { const f = pm*0.6 + pf*0.4; dd.textContent = 'reading ' + Math.round(f*100) + '%'; dd.dataset.p = String(Math.round(f*100));
      tasks.update('clips', (batchDone + f) / Math.max(1, batchN), 'Clip ' + Math.min(batchN, batchDone + 1) + ' of ' + batchN + ' · ' + src.name); };
    src.readMs = {};
    const kept = await scanGet(src);   // read before (a saved Reel opened again, or the same clip added again): used as it is
    if(kept){ src.scenes = kept.scenes; src.samples = kept.samples; src.faces = kept.faces; src.faceHow = kept.faceHow; src.readMs.kept = true; pm = pf = 1; show(); }
    else {
      await Promise.all([
        scanMotion(src, p=>{ pm = p; show(); }).then(()=>{ src.readMs.motion = Math.round(performance.now()-tq); }),
        scanFaces(src, p=>{ pf = p; show(); }).then(()=>{ src.readMs.faces = Math.round(performance.now()-tq); }),
      ]);
      if(!src.removed) scanPut(src);
    }
    if(src.removed) return;
    const nf = src.faces.filter(f=>f.n>0).length, shs = src.samples.map(s=>s.sh).sort((a,b)=>a-b);
    src.shMed = shs[Math.floor(shs.length/2)] || 1;
    dd.textContent = src.dur.toFixed(1) + ' s · ' + src.w + '×' + src.h + (nf ? ' · faces ' + Math.round(nf/Math.max(1,src.faces.length)*100) + '%' : '');
    dd.dataset.st = 'ok'; dd.dataset.len = fmt(src.dur).replace(/\.\d+$/, '');
    src.els = [makeVideo(src.url), makeVideo(src.url), makeVideo(src.url)];
    sources.push(src); drawSpark(src);
  }catch(e){
    if(src.removed) return;
    console.warn('clip not readable:', src.name, e && e.message || e);
    dd.textContent = 'This video does not play here (format). Remove it with ×.'; dd.dataset.st = 'bad';
    card.style.borderColor = 'var(--drop)';
  }
}
// Do the clips have a sound of their own? Then the person chooses what the Reel keeps (Mute it is the default).
let clipSoundTold = false;
async function clipSoundCheck(){
  const box = $('clipsnd'); if(!box) return;
  if(kind === 'talk' || !sources.length){ box.hidden = true; return; }
  let any = false;
  for(let i=0;i<sources.length && !any;i++){ const P = await clipPcm(i); if(!P) continue; let q = 0, n = 0; for(let k=0;k<P.x.length;k+=64){ q += P.x[k]*P.x[k]; n++; } if(Math.sqrt(q/Math.max(1,n)) > 0.004) any = true; }
  const was = !box.hidden;
  box.hidden = !any || kind === 'talk';
  // said once: what happens to it, and where to change it
  if(!box.hidden && !was && !clipSoundTold){ clipSoundTold = true; notify((au.clip || 'mute') === 'mute' ? "Your clips' own sound is muted under the song. Change it in Music." : "Your clips' own sound: change it in Music."); }
  [...$('csnd').children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.c === (au.clip || 'mute'))));
}
$('csnd').addEventListener('click', e => { const b = e.target.closest('button'); if(!b) return;
  au = { ...au, clip: b.dataset.c }; [...$('csnd').children].forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  if(au.clip === 'voices') speechScan();
  autoTools(); applyVo(); clipMixKey = ''; if(!playing) redrawFrame();
  notify(au.clip === 'mute' ? "The clips' own sound is muted." : au.clip === 'voices' ? 'Only the voices in your clips are kept.' : "All of your clips' sound is kept, under the song.");
}, SIG);
function finishAdding(){
  updateQ(); $('clearv').hidden = !$('clips').children.length; clipSoundCheck();
  if(sources.length) tasks.done('clips', sources.length + ' clip' + (sources.length > 1 ? 's' : '') + ' ready' + (buf || kind === 'talk' ? ' · making your Reel' : ' · now choose a song'));
  else tasks.fail('clips', 'These videos do not play here. Try MP4 or MOV.');
  if(sources.length){ $('s2').classList.add('done'); if(buf || kind === 'talk') makeEdit(); if(kind !== 'talk') aiRun(); }
  if(tplWaiting){ tplNeed = false; tplApplySoon(); }
}
/* =============== TALKING VIDEOS (talking head, vlog, tutorial) ===============
 * The clips' own voice is the sound of the Reel. Where people speak is found on the phone (Silero VAD; loudness when it
 * cannot run); the silences between sentences are cut (tight / natural / relaxed pauses, or none), each take keeps its
 * order, and a jump cut inside one take is framed closer (a punch-in) so it reads as intended. The voice is brought to
 * one loudness; the song, if there is one, plays under it and steps back further while someone speaks. That one sound
 * track becomes the edit's audio, so preview, captions (the voice is what is transcribed) and export work as usual. */
/* ---- voice noise cleanup: RNNoise (Xiph, BSD; WebAssembly build Apache-2.0) over the voice, 10 ms frames at 48 kHz ----
 * Traffic, fans, crowd and hiss come down, the voice stays. Run once per clip (and on a voiceover), before speech is looked
 * for, so finding the pauses works better in noise too. Its 10 ms delay is taken out. */
let denoiseOn = true, rnP = null;
async function resampleTo(x, from, to){
  if(from === to) return x;
  const n = Math.ceil(x.length*to/from), oc = new OfflineAudioContext(1, n, to), b = oc.createBuffer(1, x.length, from); b.copyToChannel(x, 0);
  const s = oc.createBufferSource(); s.buffer = b; s.connect(oc.destination); s.start(); return (await oc.startRendering()).getChannelData(0).slice();
}
async function denoise(pcm, sr){
  if(!loadRnnoise) throw new Error('not built in');
  const R = await (rnP ??= loadRnnoise().then(m => m.Rnnoise.load()).catch(e => { rnP = null; throw e; }));
  const x = await resampleTo(pcm, sr, 48000), F = R.frameSize, st = R.createDenoiseState(), y = new Float32Array(x.length), fr = new Float32Array(F), D = F;   // RNNoise's delay: one frame
  try{
    for(let i=0;i<x.length;i+=F){
      for(let k=0;k<F;k++) fr[k] = (x[i+k] || 0)*32768;
      st.processFrame(fr);
      for(let k=0;k<F;k++){ const o = i + k - D; if(o >= 0 && o < y.length) y[o] = fr[k]/32768; }
      if((i/F) % 500 === 499) await new Promise(r => setTimeout(r, 0));
    }
  } finally { st.destroy(); }
  return resampleTo(y, 48000, sr);
}
let kind = 'music', talkPace = 'natural', talkMusic = 0.09, talk = null, talkToken = 0;
const PACE = { tight: { pre: 0.08, post: 0.12, merge: 0.22 }, natural: { pre: 0.12, post: 0.2, merge: 0.42 }, relaxed: { pre: 0.18, post: 0.3, merge: 0.8 } };
const VOICE_RMS = 0.12;   // about -18 dBFS of speech: room for the music and the limiter
async function voiceOf(src){
  if(src.voice) return src.voice;
  let ab = null;
  try{ ab = await decodeAnyAudio(src.file); }catch(e){ ab = null; }
  if(!ab || ab.duration < 0.3){ src.voice = { has: false }; return src.voice; }
  const sr = ab.sampleRate, pcm = new Float32Array(ab.length);
  for(let c=0;c<ab.numberOfChannels;c++){ const d = ab.getChannelData(c); for(let i=0;i<pcm.length;i++) pcm[i] += d[i]/ab.numberOfChannels; }
  let pk = 0; for(let i=0;i<pcm.length;i+=8) pk = Math.max(pk, Math.abs(pcm[i]));
  if(pk < 0.003){ src.voice = { has: false }; return src.voice; }   // a silent track
  let clean = null;
  try{ clean = await denoise(pcm, sr); }catch(e){ console.info('noise cleanup not used:', e && e.message); }
  let probs = null, hop = 512/16000, how = 'ai';
  const keptV = await keptGet('v:', src.file);   // where people speak, found before for this clip
  if(keptV && keptV.v === SCAN_V && keptV.probs){ probs = keptV.probs; hop = keptV.hop; }
  else if(speechProbs){ try{ probs = await speechProbs(clean || pcm, sr); if(probs) keptPut('v:', src.file, { v: SCAN_V, probs, hop }); }catch(e){ console.info('speech model not used:', e && e.message); } }
  if(!probs){   // loudness: 10 dB over the quiet floor of the clip counts as speech
    how = 'level'; const n = Math.floor(pcm.length/(hop*sr)), db = new Float32Array(n), w = Math.round(hop*sr);
    for(let k=0;k<n;k++){ let s2 = 0; for(let i=k*w;i<(k+1)*w;i+=2) s2 += pcm[i]*pcm[i]; db[k] = 10*Math.log10(s2/(w/2) + 1e-10); }
    const floor = Float32Array.from(db).sort()[Math.floor(n*0.1)] || -60; probs = db.map(v => v > floor + 10 ? 0.9 : v > floor + 6 ? 0.4 : 0.1);
  }
  src.voice = { has: true, raw: pcm, clean, get pcm(){ return denoiseOn && this.clean ? this.clean : this.raw; }, sr, probs, hop, how };
  return src.voice;
}
// speech parts of a clip in seconds: in above 0.5, out after 0.2 s below 0.35, then padded and short pauses kept
function speechParts(v, dur, pace){
  if(pace === 'off') return [[0, dur]];
  const P = PACE[pace] || PACE.natural, out = [], h = v.hop; let on = -1, low = 0;
  v.probs.forEach((p, k) => { if(on < 0){ if(p > 0.5) on = k; } else if(p < 0.35){ if(++low*h >= 0.2){ out.push([on*h, (k-low+1)*h]); on = -1; low = 0; } } else low = 0; });
  if(on >= 0) out.push([on*h, v.probs.length*h]);
  const pad = out.filter(([a,b]) => b - a >= 0.12).map(([a,b]) => [Math.max(0, a - P.pre), Math.min(dur, b + P.post)]), merged = [];
  for(const s of pad){ const L = merged[merged.length-1]; if(L && s[0] - L[1] < P.merge) L[1] = Math.max(L[1], s[1]); else merged.push(s.slice()); }
  return merged.filter(([a,b]) => b - a >= 0.25);
}
// where to split a long take: the quietest moment (lowest speech probability) 2.5-4.5 s in
function splitPoint(v, a, b){
  const h = v.hop; let best = Math.min(b, a + 3.2), bp = Infinity;
  for(let t = a + 2.5; t <= Math.min(b - 1, a + 4.5); t += h){ const p = v.probs[Math.round(t/h)] ?? 1; if(p < bp){ bp = p; best = t; } }
  return best;
}
function rmsOf(x, gate = 0.01){ let s2 = 0, n = 0; for(let i=0;i<x.length;i+=4){ const v = x[i]; if(Math.abs(v) > gate){ s2 += v*v; n++; } } return Math.sqrt(s2/Math.max(1, n)); }
async function buildTalk(){
  const token = ++talkToken;
  if(!sources.length) return;
  stopAll();
  $('s3st').textContent = 'Finding where you speak…';
  for(const src of sources){ await voiceOf(src); if(token !== talkToken) return; }
  const parts = [];
  sources.forEach((src, si) => { if(!src.voice.has) return; for(const [a,b] of speechParts(src.voice, src.dur, talkPace)) parts.push({ si, a, b }); });
  const mute = sources.filter(s => !s.voice.has).length;
  if(!parts.length){ $('s3st').textContent = 'No voice found in these clips'; showMsg('We could not hear anyone talking in these clips. For a music Reel, choose "Music Reel" at the top.', true); return; }
  const sr = getCtx().sampleRate, T = parts.reduce((q,p)=>q + p.b - p.a, 0), N = Math.round(T*sr), voice = new Float32Array(N), act = new Float32Array(N);
  // the voice: the parts end to end, 8 ms fades at every join (no clicks), one loudness for every clip
  const fade = Math.round(0.008*sr); let o = 0;
  for(const p of parts){
    const v = sources[p.si].voice, g = VOICE_RMS/Math.max(0.005, rmsOf(v.pcm)), a = Math.round(p.a*v.sr), n = Math.min(N - o, Math.round((p.b - p.a)*sr));
    p.t0 = o/sr;
    for(let i=0;i<n;i++){ const j = a + Math.round(i*v.sr/sr); let x = (v.pcm[j] || 0)*g; if(i < fade) x *= i/fade; else if(i > n - fade) x *= (n - i)/fade; voice[o+i] = x;
      act[o+i] = (v.probs[Math.floor((p.a + i/sr)/v.hop)] || 0) > 0.5 ? 1 : 0; }
    o += n; p.t1 = o/sr;
  }
  // the music under it: the song's best part as long as the talk (repeated if the talk is longer), at one loudness,
  // stepping back while someone speaks (80 ms down, 400 ms back up)
  const mix = getCtx().createBuffer(2, N, sr);
  for(let c=0;c<2;c++) mix.getChannelData(c).set(voice);
  if(song && talkMusic > 0){
    const W = song.buf, st = W.duration > T + 0.5 ? bestPart(T) : 0, gm = talkMusic*VOICE_RMS/Math.max(0.005, rmsOf(song.mono)), ws = W.sampleRate;
    const dn = Math.exp(-1/(0.08*sr)), up = Math.exp(-1/(0.4*sr)); let env = 1;
    const chans = [W.getChannelData(0), W.getChannelData(Math.min(1, W.numberOfChannels-1))];
    for(let i=0;i<N;i++){
      const target = act[i] ? 1 : 2.2; env = target < env ? target + (env - target)*dn : target + (env - target)*up;
      let ts = st + i/sr; if(ts >= W.duration) ts = ts % W.duration;
      const j = Math.floor(ts*ws), edge = Math.min(1, i/(0.3*sr), (N - i)/(0.6*sr));
      for(let c=0;c<2;c++) mix.getChannelData(c)[i] += chans[c][j]*gm*env*edge;
    }
  }
  if(token !== talkToken) return;
  buf = mix; mono = new Float32Array(N); { const L = mix.getChannelData(0), R = mix.getChannelData(1); for(let i=0;i<N;i++) mono[i] = (L[i] + R[i])/2; }
  normGain = 1; secStart = 0; beats = []; period = 0.5; peaks = []; peakS = [];
  talk = { voice, sr, parts, songKey: song && talkMusic > 0 ? song.key : '', sig: sources.map(s=>fpOf(s)).join(',') + '|' + talkPace + '|' + (denoiseOn ? 'clean' : 'raw') + '|' + T.toFixed(2) };
  // the shots: one per part; a long one is split at its quietest moment; a jump cut inside one take is a punch-in
  const shots = [];
  for(const p of parts){
    const v = sources[p.si].voice; let a = p.a, t0 = p.t0;
    while(p.b - a > 5){ const m = splitPoint(v, a, p.b); shots.push({ si: p.si, in: a, start: t0, end: t0 + (m - a) }); t0 += m - a; a = m; }
    shots.push({ si: p.si, in: a, start: t0, end: p.t1 });
  }
  const useCount = sources.map(()=>0); let zoomed = false;
  const keptUk = ukKeep();
  edit = shots.map((sh, i) => {
    const prev = shots[i-1], sameTake = prev && prev.si === sh.si;
    zoomed = sameTake ? !zoomed : false;
    const src = sources[sh.si], e = { start: sh.start, end: sh.end, type: 'cut', fx: 'Hard cut', tr: 'hard', efx: zoomed ? 'jump' : 'none', sp: SPEED.normal,
      src: sh.si, in: sh.in, scaleR: 1, cx: 0.5, cy: 0.45, face: 0, fs: 0, mot: 0, ov: 0, el: src.els[(useCount[sh.si]++)%3], dirWhy: '', why: sameTake ? 'jump cut: framed closer' : '' };
    const fz = (src.faces || []).filter(f => f.n > 0 && f.t >= sh.in && f.t <= sh.in + (sh.end - sh.start));
    if(fz.length){ e.face = fz.length/Math.max(1, (src.faces || []).filter(f => f.t >= sh.in && f.t <= sh.in + (sh.end - sh.start)).length);
      e.cx = fz.reduce((q,f)=>q + f.fx, 0)/fz.length; e.cy = fz.reduce((q,f)=>q + f.fy, 0)/fz.length; e.fs = fz.reduce((q,f)=>q + (f.fs || 0), 0)/fz.length; }
    e.kf = keyframesFor(e); e.beatsIn = [];
    return e;
  });
  plan = edit.map(e => ({ start: e.start, end: e.end, type: e.type, fx: e.fx, sp: e.sp, tr: e.tr, efx: e.efx, acc: e.acc, ak: e.ak }));
  setCanvas(); edit.forEach(e=>camAt(e, 0)); renderEDL(); drawMusic();
  $('s3').classList.remove('locked'); $('s3').classList.add('done');
  const total = sources.reduce((q,s)=>q + s.dur, 0), how = sources.some(s => s.voice.how === 'level') ? ' (by loudness)' : '';
  $('s3st').textContent = edit.length + ' shots · ' + fmt(T) + ' of talk from ' + fmt(total) + ' of clips' + (talkPace !== 'off' ? ' · ' + fmt(total - T) + ' of pauses cut' + how : '');
  $('mdur').textContent = fmt(T);
  $('tinfo').textContent = mute ? mute + ' clip' + (mute > 1 ? 's' : '') + ' without a voice left out' : '';
  $('xmsg').hidden = true;
  ['play','remix','export','cover'].forEach(id=>$(id).disabled=false);
  if(capsOn) loadCaptions();
  ukRestore(keptUk);
  if(talkKfs && talkKfs.length === edit.length){ edit.forEach((e, k) => { if(talkKfs[k]) e.uk = talkKfs[k].map(q => ({ ...q })); }); }
  talkKfs = null;
  captureLoop(); editGen++;
}
function setKind(k){
  if(recording || k === kind) return;
  kind = k; if(playing) stopAll();
  [...$('kind').children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === k)));
  root.classList.toggle('talkmode', k === 'talk');
  $('s1').querySelector('h2').textContent = k === 'talk' ? 'Music (optional)' : 'Music';
  $('s2').querySelector('h2').textContent = k === 'talk' ? 'Your talking clips' : 'Clips';
  $('talkrow').hidden = k !== 'talk'; $('lenrow').hidden = k === 'talk' || !song;
  if(k === 'talk'){ $('s2').classList.remove('locked'); $('s1st').textContent = song ? 'Plays quietly under the voice' : 'Optional: a song to play quietly under the voice'; }
  else if(!song) $('s2').classList.add('locked');
  capAll = null; capWords = null; capLines = null;
  clipSoundCheck();   // a talking Reel's sound is its clips' own: no choice to make
  if(k === 'talk'){ if(sources.length) buildTalk(); }
  else if(song){ useSection(); } else { edit = []; renderEDL(); drawFrame(0); }
}
$('kind').addEventListener('click', e => { const b = e.target.closest('button'); if(b) setKind(b.dataset.k); }, SIG);
// /create/talking (or music, photo): Home's "Talking Reel" / "Music Reel" / "Photo Reel" open the studio on that kind
// (after the whole studio is set up: setKind uses state declared further down, e.g. the captions)
queueMicrotask(() => { if(ac.signal.aborted) return; const q = new URLSearchParams(location.search), t0 = q.get('tpl');
  // the kind: /create/music|talking|photo (the Create flow's addresses)
  const k0 = ({ music: 'music', talking: 'talk', photo: 'photo' })[location.pathname.split('/')[2]];
  // a template from Home or Templates: /create/edit?tpl=<template> (picked as if tapped)
  if(t0 && TEMPLATES[t0]){ const b = root.querySelector('#tpl [data-t="' + t0 + '"]'); if(b){ b.click(); return; } }
  if(k0 === 'photo'){ const b = $('photokind'); if(b){ b.click(); return; } }
  if(k0 === 'talk' || k0 === 'music'){ const b = root.querySelector('#kind [data-k="' + k0 + '"]'); if(b) b.click(); else setKind(k0); } });
function setDenoise(on){ denoiseOn = on; $('dn1').checked = on; $('dn2').checked = on; capAll = null; if(kind === 'talk'){ if(sources.length) buildTalk(); } else if(vo){ applyVo(); afterVo(); } }
$('dn1').addEventListener('change', e => setDenoise(e.target.checked), SIG); $('dn2').addEventListener('change', e => setDenoise(e.target.checked), SIG);
$('tpace').addEventListener('click', e => { const b = e.target.closest('button'); if(!b || recording) return; talkPace = b.dataset.p;
  [...$('tpace').children].forEach(x => x.setAttribute('aria-pressed', String(x === b))); buildTalk(); }, SIG);
$('tmusic').addEventListener('click', e => { const b = e.target.closest('button'); if(!b || recording) return; talkMusic = +b.dataset.v;
  [...$('tmusic').children].forEach(x => x.setAttribute('aria-pressed', String(x === b))); buildTalk(); }, SIG);

function removeVideo(src){
  if(recording) return;
  if(playing){ pos = curTime(); stopAll(); }
  src.removed = true;
  const k = sources.indexOf(src); if(k>=0) sources.splice(k,1);
  (src.els||[]).forEach(v=>{ v.pause(); v.removeAttribute('src'); v.load(); });
  setTimeout(()=>URL.revokeObjectURL(src.url), 1000);
  src.card.remove();
  $('clearv').hidden = !$('clips').children.length;
  if(sources.length){ makeEdit(); }
  else { edit = []; renderEDL(); drawFrame(0); $('s2').classList.remove('done'); $('s3').classList.add('locked'); $('s3').classList.remove('done');
    $('s3st').textContent = 'The edit appears once there are clips'; ['play','remix','export','cover'].forEach(id=>$(id).disabled=true); $('xmsg').hidden = true; }
  updateQ();
}
$('clearv').onclick = () => { if(recording) return; if(playing) stopAll();
  [...$('clips').children].map(c=>c.__src).filter(Boolean).forEach(s=>{ s.removed = true; (s.els||[]).forEach(v=>{ v.pause(); v.removeAttribute('src'); v.load(); }); setTimeout(()=>URL.revokeObjectURL(s.url), 1000); s.card.remove(); });
  sources.length = 0; pos = 0; removeVideoCleanup(); };
function removeVideoCleanup(){ $('clearv').hidden = true; edit = []; renderEDL(); drawFrame(0); $('s2').classList.remove('done'); $('s3').classList.add('locked'); $('s3').classList.remove('done');
  $('s3st').textContent = 'The edit appears once there are clips'; ['play','remix','export','cover'].forEach(id=>$(id).disabled=true); updateQ(); }
$('addv').onclick = () => $('vfile').click();
$('vfile').addEventListener('change', e=>{ const fl = [...e.target.files]; e.target.value=''; addVideos(fl); });
const dz = $('dropzone');
dz.addEventListener('click', ()=>$('vfile').click());
dz.addEventListener('keydown', e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); $('vfile').click(); } });
['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev, e=>{ e.preventDefault(); dz.classList.add('over'); }));
['dragleave','drop'].forEach(ev=>dz.addEventListener(ev, e=>{ e.preventDefault(); dz.classList.remove('over'); }));
dz.addEventListener('drop', e=>addVideos(e.dataTransfer.files));

let aspect = '9:16';
const SIZES = {'9:16':[1080,1920], '4:5':[1080,1350], '1:1':[1080,1080], '16:9':[1920,1080]};   // Instagram / YouTube full HD
$('aspect').addEventListener('click', e=>{ const b=e.target.closest('button'); if(!b) return; aspect=b.dataset.a;
  [...$('aspect').children].forEach(x=>x.setAttribute('aria-pressed', x===b)); setCanvas(); if(edit.length && !playing && !recording) captureLoop(); });

/* =============== STEP 3: AUTO-EDIT =============== */
let edit = [], seed = 1;
function rng(){ seed = (seed*16807) % 2147483647; return (seed-1)/2147483646; }
// Window statistics in O(log n): prefix sums over the clip's samples and faces (built once per clip). The edit scores
// thousands of windows, so a plain loop here froze the page on long videos.
function statsIndex(src){
  if(src._st) return src._st;
  const S = src.samples, n = S.length, T = new Float64Array(n), cm = new Float64Array(n+1), cb = new Float64Array(n+1), cc = new Float64Array(n+1), cs = new Float64Array(n+1);
  for(let i=0;i<n;i++){ T[i]=S[i].t; cm[i+1]=cm[i]+S[i].m; cb[i+1]=cb[i]+S[i].b; cc[i+1]=cc[i]+S[i].cx*S[i].m; cs[i+1]=cs[i]+S[i].sh; }
  const F = src.faces || [], k = F.length, FT = new Float64Array(k), cn = new Float64Array(k+1), cfx = new Float64Array(k+1), cfy = new Float64Array(k+1), cfs = new Float64Array(k+1);
  for(let i=0;i<k;i++){ const f=F[i], on=f.n?1:0; FT[i]=f.t; cn[i+1]=cn[i]+on; cfx[i+1]=cfx[i]+(on?f.fx:0); cfy[i+1]=cfy[i]+(on?f.fy:0); cfs[i+1]=cfs[i]+(on?f.fs:0); }
  return (src._st = {T, cm, cb, cc, cs, FT, cn, cfx, cfy, cfs});
}
const lowerB = (A, x) => { let lo=0, hi=A.length; while(lo<hi){ const m=(lo+hi)>>1; if(A[m]<x) lo=m+1; else hi=m; } return lo; };
const upperB = (A, x) => { let lo=0, hi=A.length; while(lo<hi){ const m=(lo+hi)>>1; if(A[m]<=x) lo=m+1; else hi=m; } return lo; };
const TAIL = 0.15;   // seconds of clip kept free after a shot's window
function windowStats(src, a, b){
  const X = statsIndex(src);
  let i0 = lowerB(X.T, a), i1 = upperB(X.T, b), n = i1 - i0, m, br, cx, sh;
  if(n > 0){ m = X.cm[i1]-X.cm[i0]; br = X.cb[i1]-X.cb[i0]; cx = X.cc[i1]-X.cc[i0]; sh = X.cs[i1]-X.cs[i0]; }
  else { const k = Math.min(Math.max(i0,0), src.samples.length-1), k2 = Math.max(0, k-1), s = Math.abs(src.samples[k2].t-a) < Math.abs(src.samples[k].t-a) ? src.samples[k2] : src.samples[k];
    m = s.m; br = s.b; cx = s.cx*s.m; sh = s.sh; n = 1; }
  const f0 = lowerB(X.FT, a-0.5), f1 = upperB(X.FT, b+0.5), fT = f1-f0, fN = X.cn[f1]-X.cn[f0];
  return { m: m/n, b: br/n, cx: m>1e-6 ? cx/m : 0.5, sh: sh/n, face: fT ? fN/fT : 0,
    fx: fN ? (X.cfx[f1]-X.cfx[f0])/fN : 0.5, fy: fN ? (X.cfy[f1]-X.cfy[f0])/fN : 0.5, fs: fN ? (X.cfs[f1]-X.cfs[f0])/fN : 0 };
}
/* ---- editing style: transition in, effect during, speed ---- */
const SPEED = {
  normal: {label:'1×', at:()=>1, pos:l=>l},
  slow:   {label:'Slow 0.5×', at:()=>0.5, pos:l=>0.5*l},
  fast:   {label:'Fast 1.6×', at:()=>1.6, pos:l=>1.6*l},
};
// velocity edit: slow-mo after each beat, fast whoosh into the next one
function velocitySpeed(len, bl){
  const pts = [0, ...bl.filter(b=>b>0.15 && b<len-0.1), len], segs = [];
  let acc = 0;
  for(let k=0;k<pts.length-1;k++){ const a=pts[k], b=pts[k+1], T=b-a, m=a+0.6*T;
    segs.push([a,m,0.45,acc]); acc += 0.45*(m-a); segs.push([m,b,2.2,acc]); acc += 2.2*(b-m); }
  const find = l => segs.find(s=>l<=s[1]) || segs[segs.length-1];
  return {label:'Velocity (beat)', at:l=>find(l)[2], pos:l=>{ const s=find(l); return s[3] + s[2]*(Math.min(l,s[1])-s[0]); }};
}
// photo snap: freeze 0.32 s like a camera shot, then play
const SNAP_T = 0.32;
const snapSpeed = {label:'Freeze → 1×', at:l=> l<SNAP_T ? 0 : 1, pos:l=> l<SNAP_T ? 0 : l-SNAP_T};
function rampSpeed(len){ const sp = 0.45*len;   // fast, then slow into the next beat
  return {label:'Ramp 1.8×→0.6×', at:l=> l<sp ? 1.8 : 0.6, pos:l=> l<sp ? 1.8*l : 1.8*sp + 0.6*(l-sp)}; }
function styleEdit(){
  // pros mostly hard-cut; special transitions go on hits, drops and section changes, never twice in a row
  const HIT_TR = ['whip','iris','zoom','glitch','swipeup','spin','dropin','bars','pixelate'];
  const CUT_TR = ['hard','wipe','hard','iris','slideleft','hard','bars','blur','hard','luma','doors'];
  const HIT_FX = ['punch','tilt','punch','shake'];
  let lastTr = '', hk = 0, ck = 0, fk = 0, dk = 0;
  const beatsRel = (s) => beats.filter(b=>b>s.start+0.15 && b<s.end-0.1).map(b=>b-s.start);
  // restraint: fancy transitions are rationed (whip pans 1-2 per reel), the rest are clean hard cuts
  const per = Math.max(1, buf.duration/30), budget = {snap:Math.round(2*per), whip:Math.round(2*per), spin:Math.round(1*per), glitch:Math.round(2*per), bars:Math.round(2*per), iris:Math.round(3*per), zoom:Math.round(3*per), wipe:Math.round(2*per), dissolve:Math.round(2*per)};
  const take = k => { if(budget[k]===undefined) return k; if(budget[k]>0){ budget[k]--; return k; } return 'hard'; };
  // beat shapes on a few longer shots and some drops: a different set and order with each seed / mix, never one twice in a row
  const SH_ROT = ['boxgrow','frame','grid','circle','strips','triple','heartbeat','starbeat'], SH_DROP = ['kaleido','strobe','triple','rgbpulse','mirror','vhs'];
  const shOff = ((seed||1)*5 + mixNo*3) % SH_ROT.length; let shLeft = Math.max(1, Math.round(2*per)), shK = 0, lastSh = '';
  plan.forEach((s,i)=>{
    const len = s.end - s.start, next = plan[i+1], prev = plan[i-1];
    let tr='hard', fx='none', sp=SPEED.normal;
    if(i===0){ tr='hard'; fx='hook'; }   // hook: no soft fade, start mid-action with a sharp zoom
    else if(s.type==='drop'){
      tr='flash';
      if((dk++ % 2)===1 && len>0.7 && take('snap')==='snap'){ fx='snap'; sp=snapSpeed; }   // photographer signature, rationed
      else { fx='zoomburst'; const bl=beatsRel(s); if(len>0.9) sp = bl.length ? velocitySpeed(len, bl) : rampSpeed(len); }
    }
    else if(s.type==='break'){ tr='dip'; fx='drift'; sp=SPEED.slow; }
    else if(s.type==='hit'){
      let k = HIT_TR[hk++ % HIT_TR.length]; if(k===lastTr) k = HIT_TR[hk++ % HIT_TR.length]; tr = take(k);
      fx = len<0.3 ? 'shake' : HIT_FX[fk++ % HIT_FX.length];
      if(len<0.5) sp = SPEED.fast;
    } else {
      if(len<0.3){ tr='hard'; fx='shake'; sp=SPEED.fast; }
      else if(len>1.6 && (!prev || prev.type!=='drop')){ tr = take((i%2) ? 'dissolve' : 'wipe'); fx='pan'; }
      else if(len>1.0 && next && (next.type==='drop'||next.type==='hit')){ tr='hard'; fx='pan'; const bl=beatsRel(s); sp = bl.length ? velocitySpeed(len, bl) : rampSpeed(len); }
      else { let k = CUT_TR[ck++ % CUT_TR.length]; if(k===lastTr && k!=='hard') k='hard'; tr=take(k); fx='bounce'; }
    }
    if(prev && prev.type==='break' && s.type!=='break') tr = 'flash';
    if(mode==='smooth'){   // soft camera moves only: no punches, flashes or speed tricks
      tr = i===0 ? 'fadein' : s.type==='break' ? 'dip' : (s.type==='drop' || (prev && prev.type==='break')) ? 'dissolve' : 'hard';
      fx = len>1.2 ? 'pan-soft' : 'none'; sp = s.type==='break' ? SPEED.slow : SPEED.normal;
    } else if(mode==='fast'){   // every cut moves: a transition on each, punches on the hits, speed on the long ones
      if(i>0 && tr==='hard'){ let k = HIT_TR[hk++ % HIT_TR.length]; if(k===lastTr) k = HIT_TR[hk++ % HIT_TR.length]; tr = k; }
      if(fx==='none' || fx==='bounce' || fx==='punch-soft') fx = len<0.3 ? 'shake' : HIT_FX[fk++ % HIT_FX.length];
      if(sp===SPEED.normal){ const bl = beatsRel(s); if(len>0.9) sp = bl.length ? velocitySpeed(len, bl) : rampSpeed(len); else if(len<0.45) sp = SPEED.fast; }
    }
    if(i > 0 && shLeft > 0 && len >= (mode==='smooth' ? 1.8 : 1.2) && beatsRel(s).length >= 2 && s.type !== 'drop' && ['pan','bounce','none','pan-soft'].includes(fx)){
      let k = mode==='smooth' ? ['frame','circle'][shK++ % 2] : SH_ROT[(shOff + shK++) % SH_ROT.length]; if(k === lastSh) k = SH_ROT[(shOff + shK++) % SH_ROT.length];
      fx = k; shLeft--; lastSh = k; }
    else if(s.type === 'drop' && mode !== 'smooth' && dk % 3 === 0 && fx === 'zoomburst' && len >= 0.8){ fx = SH_DROP[(shOff + dk) % SH_DROP.length]; lastSh = fx; }
    s.tr = tr; s.efx = fx; s.sp = sp; lastTr = tr;
  });
  if(mode==='copy' && refProfile) copyStyle();
}
const TR_NAME = {hard:'Hard cut', fadein:'Fade-in', flash:'Exposure flash', whip:'Whip pan (blur)', zoom:'Zoom-through', glitch:'Glitch RGB', dip:'Dip to black', dissolve:'Dissolve',
  iris:'Mask: iris', wipe:'Mask: soft wipe', bars:'Mask: bars', spin:'Spin + blur', diamond:'Mask: diamond', heart:'Mask: heart', star:'Mask: star',
  slideleft:'Push left', slideright:'Push right', slideup:'Push up', slidedown:'Push down', swipeup:'Swipe up (feed scroll)', zoomout:'Zoom out', blur:'Blur through', flip:'Card flip',
  luma:'Light fade (by brightness)', pixelate:'Pixelate', clock:'Clock wipe', doors:'Doors open', ripple:'Ripple', burn:'Film burn', dropin:'Drop in (bounce)'};
const FX_NAME = {jump:'Punch-in (jump cut)', 'punch-soft':'Soft zoom', 'pan-soft':'Ken Burns (soft)', snap:'Photo snap (freeze + flash)', hook:'Hook zoom + RGB', none:'—', pan:'Ken Burns + beat bounce', zoomburst:'Zoom burst + RGB', drift:'Slow drift + vignette', punch:'Zoom punch', tilt:'Tilt punch', shake:'Shake', bounce:'Beat bounce',
  boxgrow:'Shape: box grows on the beat', grid:'Shape: grid opens on the beat', strips:'Shape: strips on the beat', circle:'Shape: circle pulse', heartbeat:'Shape: heart pulse', starbeat:'Shape: star pulse',
  frame:'Frame in frame', mirror:'Mirror', kaleido:'Kaleidoscope', triple:'Triple split', vhs:'VHS retro', strobe:'Strobe on the beat', rgbpulse:'RGB split on the beat', blurpulse:'Blur pulse on the beat'};
const TR_DUR = {hard:0, fadein:0.35, flash:0.22, whip:0.16, zoom:0.18, glitch:0.14, dip:0.26, dissolve:0.35, iris:0.24, wipe:0.22, bars:0.26, spin:0.2, diamond:0.36, heart:0.42, star:0.4,
  slideleft:0.24, slideright:0.24, slideup:0.24, slidedown:0.24, swipeup:0.2, zoomout:0.3, blur:0.35, flip:0.3, luma:0.45, pixelate:0.4, clock:0.4, doors:0.35, ripple:0.45, burn:0.4, dropin:0.32};

/* ---- keyframes: [time, value, ease] per property, local to the shot ---- */
const EASE = {
  lin: x=>x, outCubic: x=>1-Math.pow(1-x,3), outExpo: x=> x>=1 ? 1 : 1-Math.pow(2,-10*x),
  outBack: x=>{ const c1=1.70158, c3=c1+1; return 1 + c3*Math.pow(x-1,3) + c1*Math.pow(x-1,2); },
  inOut: x=> -(Math.cos(Math.PI*x)-1)/2, inQuad: x=>x*x,
};
function kf(track, l){
  if(!track) return undefined;
  if(l <= track[0][0]) return track[0][1];
  for(let k=1;k<track.length;k++){ const [t1,v1,ez]=track[k], [t0,v0]=track[k-1];
    if(l <= t1){ const p=(l-t0)/Math.max(1e-6,t1-t0); return v0 + (v1-v0)*(EASE[ez||'lin'])(p); } }
  return track[track.length-1][1];
}
/* ---- the creator's own keyframes (◆): position, zoom, rotation, opacity of a shot or a text, at times local to it.
   Each keyframe holds all five; the ease of a keyframe shapes the move INTO it. One keyframe = a fixed setting. ---- */
EASE.hold = x => x < 1 ? 0 : 1;
const UK0 = {x:0, y:0, s:1, r:0, o:1}, UK_PROPS = ['x','y','s','r','o'];
function uAt(list, l){
  if(!list || !list.length) return null;
  if(l <= list[0].t) return list[0];
  for(let k=1;k<list.length;k++){ const b = list[k]; if(l <= b.t){ const a = list[k-1], p = (EASE[b.ez||'inOut'] || EASE.inOut)((l-a.t)/Math.max(1e-6, b.t-a.t)), u = {};
    for(const n of UK_PROPS) u[n] = a[n] + (b[n]-a[n])*p; return u; } }
  return list[list.length-1];
}
// a shot that is moved, made smaller or turned shows black around it (not stretched edge pixels)
function panClamp(p, W, dw){ return dw <= W + 0.5 ? (W - dw)/2 : Math.min(0, Math.max(W - dw, p)); }
// The AI director's keyframes on the hits inside a shot, on top of the shot's own effect: a punch (quick zoom), a shake,
// a flash of light or a small pulse, each starting exactly on its hit and gone within 0.4 s.
const ACCENTS = ['punch','shake','flash','pulse'], ACC_T = 0.4;
function accentAt(e, local){
  const A = e.acc; if(!A || !A.length) return null;
  let s = 1, sh = 0, ex = 0, rgb = 0, any = false;
  for(const a of A){ const d = local - a.at; if(d < 0 || d > ACC_T) continue; any = true;
    if(a.do==='punch'){ s *= 1 + 0.13*Math.exp(-d/0.1); rgb += 6*Math.exp(-d/0.08); }
    else if(a.do==='pulse') s *= 1 + 0.05*Math.exp(-d/0.1);
    else if(a.do==='shake'){ sh += Math.exp(-d/0.12); s *= 1.04; }
    else if(a.do==='flash') ex += 0.85*Math.exp(-d/0.08); }
  return any ? {s, sh, ex, rgb} : null;
}
function keyframesFor(e){
  const L = e.end - e.start;
  switch(e.efx){
    case 'snap': return {expo:[[0,1.1],[0.14,0,'outCubic']]};
    case 'hook': return {scale:[[0,1.4],[0.55,1,'outExpo']], zblur:[[0,1],[0.35,0,'outCubic']], rgb:[[0,12],[0.3,0,'outCubic']], bounce:[[0,1]]};
    case 'zoomburst': return {scale:[[0,1.32],[0.45,1,'outExpo']], zblur:[[0,1],[0.3,0,'outCubic']], expo:[[0,0.9],[0.28,0,'outCubic']], rgb:[[0,16],[0.3,0,'outCubic']], vig:[[0,0.35]]};
    case 'punch': return {scale:[[0,1.16],[0.32,1,'outBack']], rgb:[[0,7],[0.16,0,'outCubic']]};
    case 'tilt': return {scale:[[0,1.18],[0.3,1.02,'outBack']], rot:[[0,-4],[0.3,0,'outBack']]};
    case 'shake': return {scale:[[0,1.08]], shake:[[0,1],[0.3,0,'outCubic']], rgb:[[0,5],[0.12,0]]};
    case 'pan': return {scale:[[0,1.04],[L,1.14,'inOut']], x:[[0,-0.02],[L,0.02,'inOut']], bounce:[[0,1]]};
    case 'pan-soft': return {scale:[[0,1.02],[L,1.09,'inOut']], x:[[0,-0.015],[L,0.015,'inOut']]};
    case 'drift': return {scale:[[0,1],[L,1.07,'inOut']], bright:[[0,0.86]], vig:[[0,0.6]]};
    case 'bounce': return {scale:[[0,1.06],[0.25,1,'outCubic']], bounce:[[0,1]]};
    case 'punch-soft': return {scale:[[0,1.07],[0.3,1,'outCubic']]};
    case 'jump': return {scale:[[0,1.14]]};   // a jump cut inside one take: framed closer, so the cut reads as intended
    default: return {};
  }
}

let dupCount = 0;
/* ---- optional AI: which moment goes where ----
   The phone sends a few small frames per clip; a vision model scores each moment like a pro editor (strength, what it
   suits, what is wrong, where the subject is). Timing stays with the music analysis; the AI only steers the choice of
   moment and the framing. Scores are cached per clip (also across visits), so re-edits cost nothing. */
let aiOn = false, aiBusy = false, aiInfo = null;
const aiCache = new Map();
const fpOf = src => [src.name, src.file ? src.file.size : 0, src.file ? src.file.lastModified : 0].join('|');
function aiStat(t, err){ const el = $('aistat'); el.hidden = !t; el.textContent = t || '';
  if(!t) tasks.clear('ai'); else if(/…$/.test(t)) tasks.start('ai', 'ai', 'Shubix at work', t.replace(/…$/, '')); else if(err) tasks.fail('ai', t); else if(tasks.has('ai')) tasks.done('ai', t); el.style.color = err ? 'var(--drop)' : ''; }
// The AI's view of footage [a,b]: frames nearby (same scene only), weighted by distance
function aiAt(src, a, b){
  if(!aiOn || !src.ai || !src.ai.frames.length) return null;
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
function aiBonus(ai, slot, last){
  const role = slot==='hook' ? 'hook' : (slot==='drop' || slot==='hit') ? 'action' : slot==='break' ? 'calm' : last ? 'ending' : null;
  let fit = 0;
  if(role) fit = 0.6*(ai.roles[role] || 0) + (role==='hook' ? 0.3*(ai.roles.action || 0) : 0);
  if(last && role!=='ending') fit += 0.3*(ai.roles.ending || 0);
  return ai.conf * (2.2*(ai.score - 0.5) + fit);
}
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
async function aiFrames(src){
  const rd = await clipReader(src, 768);
  const sc = Math.min(1, 384/Math.max(src.w, src.h)), w = Math.max(2, Math.round(src.w*sc)), h = Math.max(2, Math.round(src.h*sc));
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  const out = [], ts = aiTimes(src).slice().sort((a,b)=>a-b);
  let k = 0;
  try{ for await (const v of rd.frames(ts)){ const t = ts[k++]; if(!v) continue;
    g.drawImage(v, 0, 0, w, h); const url = c.toDataURL('image/jpeg', 0.72);
    out.push({ t: +t.toFixed(2), image: url.slice(url.indexOf(',')+1) });
  } } finally { rd.close(); }
  return out;
}
function aiRestore(src){
  const fp = fpOf(src); let c = aiCache.get(fp);
  if(!c){ try{ const j = localStorage.getItem('brs-ai:'+fp); if(j) c = JSON.parse(j); }catch(e){} }
  if(c && Array.isArray(c.frames)) src.ai = c;
}
async function aiRun(){
  if(!aiOn || aiBusy || !sources.length) return;
  sources.forEach(s=>{ if(!s.ai) aiRestore(s); });
  const need = sources.filter(s=>!s.ai && !s.aiFailed && !s.removed);
  if(!need.length){ aiDone(); return; }
  aiBusy = true; aiStat('Shubix is looking at ' + need.length + (need.length>1 ? ' clips…' : ' clip…'));
  let charged = 0, failed = 0;
  try{
    const jobs = [];
    for(const s of need){ const frames = await aiFrames(s); if(frames.length) jobs.push({ id: 'c'+jobs.length, src: s, frames }); }
    for(let k=0; k<jobs.length; k+=12){
      const part = jobs.slice(k, k+12);
      const r = await fetch('/api/studio/rank-shots', { method:'POST', headers:{'Content-Type':'application/json'}, signal: ac.signal,
        body: JSON.stringify({ clips: part.map(j=>({ id:j.id, name:j.src.name, frames:j.frames })) }) });
      const res = await r.json().catch(()=>({}));
      if(!r.ok) throw new Error((res.error && res.error.message) || ('Shubix could not do this step (' + r.status + ').'));
      charged += res.charged || 0;
      for(const c of res.clips || []){ const j = part.find(x=>x.id===c.id); if(!j) continue;
        j.src.ai = { frames: c.frames, summary: c.summary, mood: c.mood }; const fp = fpOf(j.src); aiCache.set(fp, j.src.ai);
        try{ localStorage.setItem('brs-ai:'+fp, JSON.stringify(j.src.ai)); }catch(e){} }
      for(const f of res.failed || []){ const j = part.find(x=>x.id===f.id); if(j){ j.src.aiFailed = true; failed++; } }
    }
    aiBusy = false;
    if(sources.some(s=>!s.ai && !s.aiFailed && !s.removed) && !pending) return aiRun();   // clips added meanwhile
    aiDone(charged, failed);
  }catch(e){
    aiBusy = false;
    if(e && e.name === 'AbortError') return;
    console.warn('AI picks not used:', e); aiStat('Your Reel uses the best moments picked on your phone.');
  }
}
function aiDone(charged, failed){
  const withAi = sources.filter(s=>s.ai), n = withAi.reduce((q,s)=>q+s.ai.frames.length, 0);
  aiStat('Shubix scored ' + n + ' moments in ' + withAi.length + ' clip' + (withAi.length>1?'s':'') + (failed ? ' (' + failed + ' skipped)' : '') + (charged ? ' · ' + charged + ' credit' + (charged>1?'s':'') : ''));
  if(buf && sources.length && !recording) makeEdit();
}
/* ---- AI director: one text call plans the Reel as a story ----
   The cut times are fixed by the music. For every cut the phone offers its 3 best different moments (rules + AI scores);
   the director picks one per cut plus its transition, effect and speed. Every choice is then checked here: the moment
   must still be free (no footage twice, no scene crossing, not the same clip as a neighbour), the transition must fit
   the shot and the style and stay within its ration, effects and speeds must suit the cut. Whatever fails keeps the
   rule choice. One plan per edit (style, mix and clips); a new mix or style asks again. */
let director = null, dirBusy = false, dirFailedKey = '', dirCands = null;
const dirKey = () => [mode, mode === 'copy' && refProfile ? refProfile.name + '|' + refProfile.dur : '', mixNo, plan.length, plan.map(s=>s.start.toFixed(2)).join(','), sources.map(fpOf).join(';')].join('#');
let mixNo = 0;   // which mix: 0 = the AI's plan, 1-4 = its other mixes (one call), then the phone's own mixes in its style
const dirSlotOf = i => (aiOn && director && director.key===dirKey() && director.slots[i]) || null;
const dirShot = i => { const d = dirSlotOf(i); return d && d.cand ? d.cand : null; };
const TR_OK = { smooth: ['hard','dissolve','dip','iris','diamond','heart','star','wipe'], auto: Object.keys(TR_DUR).filter(k=>k!=='fadein'), fast: Object.keys(TR_DUR).filter(k=>k!=='fadein'), copy: Object.keys(TR_DUR).filter(k=>k!=='fadein') };
// the beat shapes and beat effects (drawn in drawFrameGL; see shapeAt)
const BEAT_FX = ['boxgrow','grid','strips','circle','heartbeat','starbeat','frame','mirror','kaleido','triple','vhs','strobe','rgbpulse','blurpulse'];
const FX_OK = { smooth: ['none','pan-soft','drift'], auto: ['none','zoomburst','punch','punch-soft','tilt','shake','bounce','pan','pan-soft','drift','snap'], fast: ['none','zoomburst','punch','punch-soft','tilt','shake','bounce','pan','pan-soft','drift','snap'] };
FX_OK.auto.push(...BEAT_FX); FX_OK.fast.push(...BEAT_FX); FX_OK.smooth.push('frame', 'circle');
FX_OK.copy = FX_OK.auto;
// the director's transitions / effects / speeds, each checked; returns how many were used and how many were corrected
function applyDirectorStyle(){
  if(!aiOn || !director || director.key !== dirKey()) return null;
  let used = 0, fixed = 0, asked = 0;
  plan.forEach((s,i)=>{
    const d = director.slots[i], len = s.end - s.start;
    if(!d) return;
    // The AI is free: any known tool in any style. Only what cannot be played is refused (the opener has nothing
    // before it to transition from; a freeze needs a moment to hold; a speed on the beats needs beats).
    if(d.tr){ asked++; const tr = d.tr;
      const ok = i===0 ? (tr==='hard' || tr==='fadein') : tr in TR_DUR;
      if(ok){ s.tr = tr; s.trByDir = true; used++; } else fixed++;
    }
    // effect: "hook" is the opener's own; a slow move needs time; the photo snap needs a moment to freeze
    if(d.fx){ asked++; const fx = d.fx;
      let ok = fx in FX_NAME;
      if(fx==='snap' && len <= 0.7) ok = false;
      if(ok){ s.efx = fx; s.fxByDir = true; used++; } else fixed++;
    }
    // speed: only what the shot can play (and what Smooth allows)
    if(d.sp){ asked++; let ok = true, sp = null; const bl = beats.filter(b=>b>s.start+0.15 && b<s.end-0.1).map(b=>b-s.start);
      if(d.sp==='freeze' && s.efx!=='snap') ok = false;
      if(d.sp==='ramp' && len < 0.4) ok = false;
      if(d.sp==='velocity' && !bl.length) ok = false;
      if(ok) sp = d.sp==='velocity' ? velocitySpeed(len, bl) : d.sp==='ramp' ? rampSpeed(len) : d.sp==='freeze' ? snapSpeed : d.sp==='hold' ? holdSpeed : SPEED[d.sp];
      if(sp){ s.sp = sp; used++; } else fixed++;
    }
    if(s.efx==='snap' && s.sp!==snapSpeed) s.sp = snapSpeed;   // the photo snap is a freeze by definition
    // the camera moves inside the shot: the AI's keyframes (at = fraction of the shot), on top of the shot's framing;
    // its effect steps aside (a zoom effect and a zoom keyframe would fight)
    s.ak = [];
    if(d.move && d.move.length >= 2 && len >= 0.3){ asked++;
      s.ak = d.move.map(k=>({ t: +(k.at*len).toFixed(3), s: k.s, x: k.x, y: k.y, r: k.r, o: 1, ez: k.ez || 'inOut' }));
      if(!['snap','hook'].includes(s.efx) && !(d.fx && d.fx !== 'none')) s.efx = 'none';
      used++; }
    // keyframes on the hits: inside the shot, not in the first frames of a transition, none in a Smooth Reel
    s.acc = [];
    if(d.keys && d.keys.length){ asked += d.keys.length;
      for(const k of d.keys){ if(k.at > Math.max(0.04, (i && TR_DUR[s.tr]) || 0) && k.at < len-0.05 && ACCENTS.includes(k.do)){ s.acc.push({at:k.at, do:k.do}); used++; } else fixed++; } }
  });
  const undone = finishTransitions();
  return {used: used - undone, fixed: fixed + undone, asked};
}
// One last pass over every cut, whoever chose it: special transitions stay within their ration (the director's own
// choices are served first), finish well inside both shots, and the same special one never runs twice in a row.
// Returns how many of the director's transitions had to become hard cuts.
function finishTransitions(){
  const per = Math.max(1, buf.duration/30), left = {snap:Math.round(2*per), whip:Math.round(2*per), spin:Math.round(1*per), glitch:Math.round(2*per), bars:Math.round(2*per), iris:Math.round(3*per), zoom:Math.round(3*per), wipe:Math.round(2*per), dissolve:Math.round(2*per) + (mode==='smooth' ? 99 : 0), flash:Math.round(6*per) + (mode==='fast' ? 99 : 0)};
  if(mode==='copy' && copyBudget){ Object.keys(left).forEach(k=>{ left[k] = copyBudget[k] || 0; }); }   // copying a Reel: its own counts are the ration
  const want = {}; plan.forEach(s=>{ if(s.trByDir && left[s.tr]!==undefined) want[s.tr] = (want[s.tr]||0) + 1; });
  let undone = 0;
  plan.forEach((s,i)=>{
    if(i===0 || s.tr==='hard') return;
    const len = s.end - s.start, prev = plan[i-1];
    const fit = (s.tr==='flash' || s.tr==='glitch') ? 0.9 : 0.6;   // a flash / glitch is an overlay: it needs less room than a dissolve
    let ok = TR_DUR[s.tr] <= fit*len && TR_DUR[s.tr] <= 0.8*(prev.end-prev.start);
    // the AI director's own choices only have to fit in time (its taste decides the mix); the rules' choices are
    // rationed and never repeat, leaving room for the director's
    if(ok && !s.trByDir && s.tr===prev.tr && !(s.type==='break' && prev.type==='break') && mode !== 'copy') ok = false;   // (a copied Reel may repeat its transition)
    if(ok && left[s.tr]!==undefined){
      if(s.trByDir){ want[s.tr]--; left[s.tr]--; }
      else { ok = left[s.tr] - (want[s.tr]||0) > 0; if(ok) left[s.tr]--; }
    }
    if(!ok){ if(s.trByDir) undone++; s.tr = 'hard'; }
  });
  return undone;
}
// For each cut: the moment it has now, plus up to 2 alternatives from footage that no other cut has or is offered, so
// any combination the director chooses fits together (cuts that matter most get their alternatives first).
function directorCandidates(){
  const gmax = Math.max(1e-6, ...sources.flatMap(s=>s.samples.map(x=>x.m)));
  const reserved = sources.map(()=>[]);
  edit.forEach(e=>reserved[e.src].push([e.in, e.in + e.sp.pos(e.end-e.start)*e.scaleR]));
  const free = (si, a, b) => !reserved[si].some(([u,v])=>Math.min(v,b+0.05)-Math.max(u,a-0.05) > 0);
  const order = plan.map((s,i)=>i).sort((a,b)=>{ const pr={drop:0,hit:1,break:2,cut:3}; return (a===0?-1:pr[plan[a].type]) - (b===0?-1:pr[plan[b].type]) || a-b; });
  const out = plan.map(()=>[]);
  const describe = (i, k, si, a, need, w) => { const src = sources[si], S = src.samples.filter(x=>x.t>=a && x.t<=a+need);
    const gx = S.length ? S.reduce((q,x)=>q+(x.gx||0),0)/S.length : 0, m = w.m;
    return { id: i + 'abc'[k], si, a, clip: 'c'+(si+1), at: +a.toFixed(2), score: +w.sc.toFixed(2), note: w.ai ? w.ai.note : '',
      roles: w.ai ? Object.keys(w.ai.roles).filter(r=>w.ai.roles[r] > 0.4) : [], motion: m < 0.08 ? 'still' : m < 0.3 ? 'low' : m < 0.6 ? 'medium' : 'high', people: w.st.face > 0.3,
      camera: Math.abs(gx) < 0.35 ? 'still' : gx > 0 ? 'pans left' : 'pans right' }; };
  order.forEach(i=>{
    const s = plan[i], e = edit[i], len = s.end - s.start, nb = [edit[i-1], edit[i+1]].filter(Boolean).map(x=>x.src);
    const cur = e.sp.pos(len)*e.scaleR;
    out[i].push(describe(i, 0, e.src, e.in, cur, scoreWindow(i, sources[e.src], e.in, cur, gmax)));
    const all = [];
    sources.forEach((src,si)=>{
      if(sources.length > 1 && nb.includes(si)) return;   // not the clip of a neighbour
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
// The AI's plans, kept per song, clips and style (not per part of the song): moving the song's part fits them to the
// new cuts on this phone (by what the music does under each cut), and New mix uses the AI's other mixes, asked once.
// The AI is asked again only for a new song, other clips or another style.
const VARIANTS = 4;
const aiMixes = new Map();   // dirBase -> { plans: [{ slots, ctx, sig, story }] by mix, asked, busy }
const dirBase = () => [mode, mode === 'copy' && refProfile ? refProfile.name + '|' + refProfile.dur : '', sources.map(fpOf).join(';'), song ? song.key : ''].join('#');
const planSig = () => plan.length + ':' + plan.map(s=>s.start.toFixed(2)).join(',');
function mixStore(){ const b = dirBase(); if(!aiMixes.has(b)) aiMixes.set(b, { plans: [], asked: false, busy: false }); return aiMixes.get(b); }
// what the music does under every cut (the AI reads it; a fitted plan matches on it)
function cutMusic(){
  const sm = getSoundMap(), cx = { hits: hitsRaw || [], hitStr: hitsStr || [], drops: plan.filter(s=>s.type==='drop').map(s=>s.start), beats };
  return plan.map(s => sm ? describeCut(sm, s.start, s.end, cx) : null);
}
/* ---- every Reel feels new: the tools each finished Reel used are kept on the phone (last 6 Reels) and the AI is told
 * which ones this creator used lately, most used first, so it makes other choices ---- */
const RECENT_KEY = 'brs-recent-tools';
function recentTools(){ let L = []; try{ L = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); }catch(e){}
  const n = new Map(); for(const r of Array.isArray(L) ? L : []) for(const k of r) n.set(k, (n.get(k) || 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k]) => k); }
function rememberTools(){ if(!edit.length) return; const used = new Set();
  for(const e of edit){ if(e.tr && e.tr !== 'hard') used.add(e.tr); if(e.efx && e.efx !== 'none') used.add(e.efx); if(e.sp && e.sp.label && e.sp.label !== '1×') used.add('speed ' + e.sp.label); }
  try{ const L = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); L.push([...used].slice(0, 30)); localStorage.setItem(RECENT_KEY, JSON.stringify(L.slice(-6))); }catch(e){} }
function dirRequest(cands){
  const per = Math.max(1, buf.duration/30), music = cutMusic(), pc = paceNow();
  const req = { mode, duration: +buf.duration.toFixed(2), bpm: +(60/period).toFixed(1), hook: hookText.slice(0,60), story: (pc && pc.story || '').slice(0,160), reference: refContext(),
    clips: sources.map((s,k)=>({ alias:'c'+(k+1), summary: (s.ai && s.ai.summary) || '', mood: (s.ai && s.ai.mood) || '' })),
    recent: recentTools(),
    budget: mode === 'copy' && copyBudget ? copyBudget : {whip:Math.round(2*per), spin:Math.round(per), glitch:Math.round(2*per), zoom:Math.round(3*per), iris:Math.round(3*per), dissolve:Math.round(2*per), snap:Math.round(2*per)},
    slots: plan.map((s,i)=>({ i, t:+s.start.toFixed(2), len:+(s.end-s.start).toFixed(2), type:s.type, beats: beats.filter(b=>b>s.start+0.1 && b<s.end-0.05).length,
      ...(music[i] ? { music: music[i] } : {}),
      candidates: cands[i].map(({si,a,...c})=>c) })).filter(x=>x.candidates.length) };
  const ctx = plan.map((s,i)=>({ i, len: s.end - s.start, type: s.type, music: music[i] }));
  return { req, ctx };
}
// the AI's answer -> one entry per cut (its shot as a moment of a clip)
function toSlots(list, cands){
  const slots = [];
  for(const d of list || []){ const c = (cands[d.i]||[]).find(x=>x.id===d.shot);
    slots[d.i] = { cand: c ? {src:c.si, in:c.a} : null, tr: d.transition, fx: d.effect, sp: d.speed, keys: Array.isArray(d.keys) ? d.keys : [], move: Array.isArray(d.move) ? d.move : [], cs: d.clip && typeof d.clip === 'object' ? d.clip : null, why: d.why || '' }; }
  return slots;
}
// An AI plan made for other cuts (the song's part moved), fitted to these: every cut takes the choices of the AI's cut
// whose music is most alike (a drop's transition goes to the new drop, the hook stays the hook), its keyframes land on
// this cut's own hits, and its moments of the clips are kept where this cut can use them. withShots false: the phone
// picks the moments (its own mix), the style stays the AI's. Every choice is still checked (applyDirectorStyle).
function refitDirector(src, withShots){
  const old = src.ctx.filter(c => src.slots[c.i]).map(c => ({ ...c, d: src.slots[c.i] }));
  if(!old.length || !plan.length) return null;
  const music = cutMusic(), cands = withShots ? directorCandidates() : null;
  const pool = withShots ? src.slots.filter(d => d && d.cand).map(d => ({ ...d.cand })) : [];
  const near = (c) => pool.findIndex(p => p.src === c.si && Math.abs(p.in - c.a) < 0.6);
  const slots = []; let prev = null;
  plan.forEach((s,i)=>{
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
function directorMaybe(){
  if(!aiOn || dirBusy || !edit.length || recording) return;
  if(!sources.length || sources.some(s=>!s.ai && !s.aiFailed)) return;   // after the AI has looked at the clips (or could not)
  if(paceBusy || paceWanted()) return;   // the pace first: it decides where the cuts are
  const key = dirKey(); if((director && director.key===key && !director.interim) || dirFailedKey===key) return;
  if(dirCache.has(key)){ director = dirCache.get(key); makeEdit(); return; }
  const st = mixStore();
  if(mixNo > 0 && !st.asked && st.plans[0]) variantsRun(st);   // the first New mix: the AI's other mixes, in one call
  const own = st.plans[mixNo];
  if(own){   // the AI's plan for this mix: as it is on the same cuts, else fitted to these (the song's part moved)
    const slots = own.sig === planSig() ? own.slots : refitDirector(own, true);
    if(slots){ director = { key, slots, story: own.story }; dirCache.set(key, director); makeEdit(); return; }
  }
  if(mixNo > 0 && st.plans.length){   // past the AI's mixes, or while they come: the phone's own mix in the AI's style
    if(director && director.key===key && director.interim) return;   // waiting for the AI's mixes
    const from = st.plans.filter(Boolean), src = from[mixNo % from.length], slots = refitDirector(src, false);
    if(slots){ director = { key, slots, story: src.story, interim: st.busy }; if(!st.busy) dirCache.set(key, director); makeEdit(); return; }
  }
  directorRun(key);
}
// New mix: the AI's other plans for these cuts, all in one call (the input is sent once)
async function variantsRun(st){
  st.asked = true; st.busy = true;
  aiStat('Shubix is making ' + VARIANTS + ' more mixes for New mix…');
  const tm = timeoutSignal(90000);
  let n = 0;
  try{
    const cands = directorCandidates(), { req, ctx } = dirRequest(cands), sig = planSig();
    const r = await fetch('/api/studio/direct', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ ...req, variants: VARIANTS }), signal: tm.signal });
    const res = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error((res.error && res.error.message) || ('Shubix could not make the mixes (' + r.status + ').'));
    let k = 1;
    for(const pl of res.plans || []){ while(st.plans[k]) k++; st.plans[k] = { slots: toSlots(pl.slots, cands), ctx, sig, story: pl.story || '' }; n++; }
    aiStat('Shubix made ' + n + ' more mix' + (n === 1 ? '' : 'es') + ' · press New mix to see each.');
  }catch(e){
    if(!(e && e.name==='AbortError') || tm.timedOut()) console.warn('AI mixes not used:', e);
    aiStat('New mix uses the phone\'s own mixes in Shubix\'s style.');
  }finally{ st.busy = false; tm.done(); }
  if(mixNo > 0 && buf && sources.length && !recording) makeEdit();
}
const dirCache = new Map();
// a request that gives up after ms (the phone's own edit is already on screen, so nobody waits for a slow AI)
function timeoutSignal(ms){
  const c = new AbortController(); let late = false;
  const t = setTimeout(()=>{ late = true; c.abort(); }, ms), stop = () => c.abort();
  ac.signal.addEventListener('abort', stop);
  return { signal: c.signal, timedOut: () => late, done: () => { clearTimeout(t); ac.signal.removeEventListener('abort', stop); } };
}
/* ---- the sound map: what the AI hears (components/studio/soundmap.ts), measured once per song part ---- */
let smapKey = '', smapVal = null;
function getSoundMap(){
  if(!mono || !buf) return null;
  if(smapKey !== musicKey){ try{ smapVal = soundMap(mono, buf.sampleRate); }catch(e){ console.warn('sound map:', e); smapVal = null; } smapKey = musicKey; }
  return smapVal;
}
/* ---- the AI's first decision: how fast to cut in each section of the song ----
   The phone splits the song into sections (at drops, breaks and big changes) and describes each; the AI chooses a cut
   every 1, 2, 4 or 8 beats per section; the cuts then land on the real beats (repace). The edit on screen does not wait:
   the phone's own pace shows first and the AI's replaces it when it arrives. */
let pacing = null, paceBusy = false, paceFailedKey = '';
const paceCache = new Map();
const paceKey = () => [musicKey, mode, mode === 'copy' && refProfile ? refProfile.name + '|' + refProfile.dur : '', root.classList.contains('photomode') ? 'p' : 'v', sources.length, Math.round(sources.reduce((a,s)=>a+(s.removed?0:s.dur||0),0))].join('#');
const paceUsable = () => aiOn && kind !== 'talk' && buf && beats.length >= 8 && sources.length && !recording;
const paceNow = () => (paceUsable() && pacing && pacing.key === paceKey()) ? pacing : null;
const paceWanted = () => paceUsable() && !paceNow() && paceFailedKey !== paceKey();
// a reference's shots, kept inside what the server accepts (numbers in range, known words only)
function cleanMoments(list){
  const c = (v, a, b) => Math.min(b, Math.max(a, Number.isFinite(+v) ? +v : 0)), KINDS = ['start', ...Object.keys(REF_KINDS)];
  return (list || []).slice(0, 40).map(m => { const o = { beats: c(m.beats, 0, 64), sec: c(m.sec, 0, 60), tr: KINDS.includes(m.tr) ? m.tr : 'hard', zoom: ['in','out','none'].includes(m.zoom) ? m.zoom : 'none' };
    for(const k of ['loud','drums','bass','voice']) if(m[k] !== undefined) o[k] = c(m[k], 0, 1);
    if(['rising','falling','steady'].includes(m.trend)) o.trend = m.trend;
    if(['kick','dhol','snare','hat'].includes(m.hit)) o.hit = m.hit;
    if(m.drop) o.drop = true; if(m.shake) o.shake = true; if(m.freeze !== undefined && m.freeze !== null) o.freeze = c(m.freeze, 0, 1);
    if(Array.isArray(m.move) && m.move.length >= 2){ o.move = m.move.slice(0, 5).map(k => ({ f: c(k.f, 0, 1), s: c(k.s, 0.4, 2.5), x: c(k.x, -0.6, 0.6), y: c(k.y, -0.6, 0.6), r: c(k.r, -60, 60) }));
      if(['lin','inOut','outCubic','outExpo','outBack'].includes(m.ease)) o.ease = m.ease; }
    return o; });
}
// "Copy a Reel" / a saved or learned style, for the AI: its numbers and, shot by shot, what it does on which music
function refContext(){
  if(mode !== 'copy' || !refProfile) return undefined;
  const R = refProfile, c01 = v => Math.min(1, Math.max(0, +v || 0));
  const trans = {}; for(const [k, v] of Object.entries(R.trans || {})) trans[k] = +c01(v).toFixed(3);
  return { name: String(R.name || '').slice(0, 80), medianBeats: Math.min(64, +R.medianBeats || 0), hookBeats: Math.min(64, +R.hookBeats || 0), onBeat: c01(R.onBeat),
    energy: ['rising','falling','steady'].includes(R.energy) ? R.energy : 'steady', zoomShare: c01(R.zoomShare), trans, moments: cleanMoments(R.moments) };
}
// The pace is asked for every section of the whole song (when a part of it is used), so moving the part needs no new
// question: each of the part's sections takes the pace of the song's section it lies in.
const songPace = new Map();   // paceSongKey -> { secs: [{ t, len, every }] in the song's time, story }
const paceSongKey = () => song ? [song.key, mode, mode === 'copy' && refProfile ? refProfile.name + '|' + refProfile.dur : '', root.classList.contains('photomode') ? 'p' : 'v', sources.length, Math.round(sources.reduce((a,s)=>a+(s.removed?0:s.dur||0),0))].join('#') : '';
const partOn = () => !!song && buf !== song.buf;
let wholeMapKey = '', wholeMap = null;
// the whole song in sections (null: no part is used, or the song is too long or has too many sections to ask at once)
function wholeSections(){
  if(!partOn() || !song.r || !song.mono) return null;
  const D = song.buf.duration, r = song.r; if(D > 600 || !(r.cuts || []).length || (r.beats || []).length < 8) return null;
  if(wholeMapKey !== song.key){ try{ wholeMap = soundMap(song.mono, song.buf.sampleRate); }catch(e){ wholeMap = null; } wholeMapKey = song.key; }
  if(!wholeMap) return null;
  const cs = r.cuts, wp = cs.map((t,k)=>({ start: t, end: k+1 < cs.length ? cs[k+1] : D, type: r.cutType[k], fx: r.cutFx[k] }));
  const ws = sectionsOf(wholeMap, wp, r.beats, r.period, D);
  return ws.length && ws.length <= 24 ? ws : null;
}
function paceFromSong(sp){
  const sm = getSoundMap(); if(!sm) return null;
  const secs = sectionsOf(sm, basePlan, beats, period, buf.duration).slice(0, 24); if(!secs.length) return null;
  return { story: sp.story, why: [], secs: secs.map(x => { const a = x.t + secStart, b = a + x.len; let best = null, bo = 0;
    for(const w of sp.secs){ const o = Math.min(b, w.t + w.len) - Math.max(a, w.t); if(o > bo){ bo = o; best = w; } }
    return { t: x.t, len: x.len, every: best ? best.every : x.now }; }) };
}
function paceMaybe(){
  if(paceBusy || !paceWanted()) return;
  const key = paceKey();
  if(paceCache.has(key)){ pacing = paceCache.get(key); makeEdit(); return; }
  const sp = songPace.get(paceSongKey()), p = sp && paceFromSong(sp);
  if(p){ pacing = { key, ...p }; paceCache.set(key, pacing); makeEdit(); return; }
  paceRun(key);
}
async function paceRun(key){
  const sm = getSoundMap(); if(!sm){ paceFailedKey = key; return; }
  const whole = wholeSections(), songKey = paceSongKey();
  const secs = whole || sectionsOf(sm, basePlan, beats, period, buf.duration).slice(0, 24);
  if(!secs.length){ paceFailedKey = key; return; }
  paceBusy = true; aiStat('Shubix is listening to the song and choosing the pace…');
  const tm = timeoutSignal(25000);
  try{
    const req = { mode, duration: +(whole ? song.buf.duration : buf.duration).toFixed(2), bpm: +(60/(whole ? song.r.period : period)).toFixed(1), clips: sources.filter(s=>!s.removed).length,
      footage: +sources.reduce((a,s)=>a+(s.removed?0:s.dur||0),0).toFixed(1), kind: root.classList.contains('photomode') ? 'photo' : 'music', sections: secs, reference: refContext(),
      ...(whole ? { reel: +buf.duration.toFixed(2) } : {}) };
    const r = await fetch('/api/studio/pace', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(req), signal: tm.signal });
    const res = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error((res.error && res.error.message) || ('Shubix could not choose the pace (' + r.status + ').'));
    const every = new Map((res.sections || []).map(x=>[x.i, x.every]));
    const answer = secs.map(s=>({ t: s.t, len: s.len, every: every.get(s.i) || s.now }));
    if(whole) songPace.set(songKey, { secs: answer, story: res.story || '' });   // kept even if the part moved meanwhile
    if(paceKey() !== key){ paceBusy = false; if(buf && sources.length && !recording) paceMaybe(); return; }
    if(whole){ const p = paceFromSong(songPace.get(songKey)); pacing = p ? { key, ...p, why: res.sections || [] } : null; }
    else pacing = { key, story: res.story || '', secs: answer, why: res.sections || [] };
    if(!pacing){ paceFailedKey = key; paceBusy = false; return; }
    paceCache.set(key, pacing);
    aiStat('Shubix chose the pace' + (pacing.story ? ': ' + pacing.story : '') + '. Now planning the shots…');
    paceBusy = false; makeEdit();
  }catch(e){
    paceFailedKey = key;
    if(!(e && e.name==='AbortError') || tm.timedOut()) console.warn('AI pace not used:', e);
    paceBusy = false; if(buf && sources.length && !recording) directorMaybe();
    // the director did not start (already planned, or no edit yet): the line must not stay on "choosing the pace…"
    if(!dirBusy && /…$/.test($('aistat').textContent || '')) aiStat('Your Reel keeps the song\'s own pace.');
  }finally{ paceBusy = false; tm.done(); }
}
async function directorRun(key){
  dirBusy = true; aiStat('Shubix is choosing every shot, transition and effect…');
  const tm = timeoutSignal(45000);
  try{
    const cands = directorCandidates(); dirCands = cands;
    const { req, ctx } = dirRequest(cands), sig = planSig(), mix = mixNo, st = mixStore();
    const r = await fetch('/api/studio/direct', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(req), signal: tm.signal });
    const res = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error((res.error && res.error.message) || ('Shubix could not plan the Reel (' + r.status + ').'));
    const slots = toSlots(res.slots, cands);
    if(!st.plans[mix]) st.plans[mix] = { slots, ctx, sig, story: res.story || '' };   // kept for the song's other parts
    // the edit changed meanwhile (the song's part moved): the plan is fitted to it, or a new one asked (other clips)
    if(dirKey() !== key){ dirBusy = false; if(buf && sources.length && !recording) directorMaybe(); return; }
    director = { key, slots, story: res.story || '' }; dirCache.set(key, director);
    dirBusy = false; makeEdit();
  }catch(e){
    dirFailedKey = key;
    if(tm.timedOut()) aiStat('Shubix took too long this time. Your Reel uses the phone\'s own smart edit.');
    else if(!(e && e.name==='AbortError')){ console.warn('AI director not used:', e); aiStat('Shubix is busy right now. Your Reel uses the phone\'s own smart edit.'); }
  }finally{ dirBusy = false; tm.done(); }
}
(async () => {   // is the studio's AI on? The administrator decides (Administration -> Features -> AI director) and the
  // server has an AI provider; people never choose: when it is on, every Reel is edited by the AI
  try{
    const r = await fetch('/api/studio/rank-shots', ac ? { signal: ac.signal } : undefined); if(!r.ok) return;
    aiInfo = await r.json(); if(!aiInfo || !aiInfo.available) return;
    aiOn = true;
    if(sources.length) aiRun();
  }catch(e){}
})();
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
    if(aiOn && src.ai) src.ai.frames.forEach(f=>{ if(f.subject && f.t>=a-0.8 && f.t<=b+0.8 && !crossesScene(src, Math.min(f.t,a), Math.max(f.t,a)))
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
  const src = sources[e.src]; if(!src) return [0.5, 0.5];
  const L = e.end - e.start, key = aspect+'|'+e.src+'|'+e.in+'|'+e.scaleR+'|'+e.sp.label+'|'+L+'|'+(aiOn && src.ai ? 1 : 0);
  if(!e.cam || e.cam.key !== key){
    const [W,H] = SIZES[aspect], base = Math.max(W/src.w, H/src.h);
    e.cam = camPath(src, e.in, srcPosF(e, L), Math.min(1, W/(src.w*base)), Math.min(1, H/(src.h*base))); e.cam.key = key;
  }
  const c = e.cam, u = Math.max(0, Math.min(c.x.length-1.0001, (srcPos(e, Math.max(0, Math.min(L, local))) - c.a)/c.dt)), k = Math.floor(u), f = u-k;
  return [c.x[k] + (c.x[k+1]-c.x[k])*f, c.y[k] + (c.y[k+1]-c.y[k])*f];
}
// Should this shot get a zoom effect at all? A punch on a big face or on footage that already moves a lot looks messy,
// and a punch in the middle of a long calm shot is out of place: those get a softer move instead.
function suitFx(e){
  e.why = '';
  if(!['punch','tilt','zoomburst','hook','bounce'].includes(e.efx)) return;
  const len = e.end - e.start;
  if((e.face||0) > 0.3 && (e.fs||0) > 0.28){ e.efx = (e.efx==='zoomburst' || e.efx==='hook') ? 'punch-soft' : 'none'; e.why = 'close-up: kept gentle'; }
  else if((e.mot||0) > 0.75 && e.efx!=='hook'){ e.efx = 'punch-soft'; e.why = 'busy shot: softer zoom'; }
  else if(len > 2.2 && (e.efx==='punch' || e.efx==='tilt')){ e.efx = 'pan'; e.why = 'long shot: slow move instead'; }
}
// how good footage [a, a+need] of src is for cut i (the rules, plus the AI's opinion of the moment when it is on)
function scoreWindow(i, src, a, need, gmax){
  const s = plan[i], st = windowStats(src, a, a+need), m = st.m/gmax;
  let sc;
  if(s.type==='drop') sc = 2.2*m;
  else if(s.type==='hit') sc = 1.5*m;
  else if(s.type==='break') sc = 1 - Math.abs(m-0.18)*2;
  else sc = 1 - Math.abs(m-0.55);
  if(i===0) sc = 2.4*m;   // hook: the most action-packed moment opens the reel
  if(st.b < 0.08) sc -= 1;                              // too dark
  const sharp = st.sh / (src.shMed||1);
  if(sharp < 0.45) sc -= 0.9; else sc += 0.25*Math.min(1.5, sharp);   // blurry / shaky footage is avoided
  sc += st.face * ((s.type==='drop'||s.type==='hit'||i===0) ? 0.8 : 0.45);   // people make shots stronger
  const ai = aiAt(src, a, a+need); if(ai) sc += aiBonus(ai, i===0 ? 'hook' : s.type, i===plan.length-1);
  return {sc, st, m, ai};
}
// the creator's keyframes stay on their shots when the edit is made again (the AI's scores or the director arriving,
// New mix): the shots at the same time as before (the music fixes the times) get them back
// (their clip settings too: on the same shot, or else on the shot playing at the old shot's middle)
function ukKeep(){ return edit.filter(e => (e.uk && e.uk.length) || e.cs).map(e => { let cs = e.cs;
  if(cs && cs.auto){ cs = { ...cs }; for(const k of cs.auto) delete cs[k]; delete cs.auto; if(!Object.keys(cs).length) cs = undefined; }
  return { s: e.start, e: e.end, uk: e.uk, cs }; }); }
function ukRestore(kept){ for(const k of kept){ const e = edit.find(x => Math.abs(x.start - k.s) < 0.02 && Math.abs(x.end - k.e) < 0.02);
  if(e && k.uk && k.uk.length) e.uk = k.uk;
  if(k.cs){ const m = (k.s + k.e)/2, c = e || edit.find(x => x.start <= m && x.end > m); if(c && !c.cs) c.cs = k.cs; } } }
let remakeAfterExport = false;
function makeEdit(){
  if(exportBusy){ remakeAfterExport = true; return; }   // a late AI answer: the video being made keeps its edit
  if(kind === 'talk'){ if(sources.length) buildTalk(); return; }
  if(story && storyEdit()) return;
  if(!buf || !sources.length) return;
  const keptUk = ukKeep();
  stopAll(); plan = adaptPlan(); { const pc = paceNow(); if(pc) plan = repace(basePlan, pc.secs, beats, buf.duration, mode); } styleEdit(); const dirInfo = applyDirectorStyle(); if(!dirInfo) finishTransitions();
  const gmax = Math.max(1e-6, ...sources.flatMap(s=>s.samples.map(x=>x.m)));
  const used = sources.map(()=>[]);
  // the opening shot picks first (the first 2 seconds decide if people keep watching), then drops, hits, breaks, the rest
  const order = plan.map((s,i)=>i).sort((a,b)=>{ const pr={drop:0,hit:1,break:2,cut:3}; return (a===0?-1:pr[plan[a].type]) - (b===0?-1:pr[plan[b].type]) || a-b; });
  const res = new Array(plan.length); dupCount = 0;
  // the director's chosen moments are held for their own cuts
  const held = plan.map((s,i)=>{ const d = dirShot(i); return d ? {i, si:d.src, a:d.in, b:d.in + s.sp.pos(s.end-s.start)} : null; }).filter(Boolean);
  const pick = (i, allowNeighbour, allowOverlap, anyScene) => {
    const s = plan[i], len = s.end - s.start, dir = dirShot(i);
    let best=null, bs=-Infinity;
    sources.forEach((src,si)=>{
      let need = s.sp.pos(len), scaleR = 1;
      if(need > src.dur-TAIL){ scaleR = Math.max(0.05, (src.dur-TAIL)/need*0.98); need *= scaleR; }
      if(!allowNeighbour && sources.length>1 && [res[i-1],res[i+1]].some(x=>x && x.src===si)) return;
      const stepT = Math.max(0.1, Math.min(0.5, src.dur/120));
      const tryAt = (a) => {
        let ov = 0; used[si].forEach(([u0,u1])=>{ ov += Math.max(0, Math.min(u1,a+need)-Math.max(u0,a)); });
        if(!allowOverlap && ov > 0.001) return;          // a moment of footage is used only once
        if(!allowOverlap && held.some(h=>h.i!==i && h.si===si && !res[h.i] && Math.min(h.b,a+need)-Math.max(h.a,a) > 0.001)) return;
        if(!anyScene && crossesScene(src, a, a+need)) return;   // a shot never runs across a cut inside the clip
        const w = scoreWindow(i, src, a, need, gmax);
        let sc = w.sc - 5*ov/need + rng()*0.15;
        const isDir = dir && dir.src===si && Math.abs(a-dir.in) < 0.26;
        if(isDir) sc += 4;   // the director's choice wins whenever the rules allow it
        if(sc>bs){ const st=w.st; bs=sc; best={src:si, in:a, scaleR, cx: st.face>0.3 ? st.fx : st.cx, cy: st.face>0.3 ? st.fy : 0.45, face: st.face, fs: st.fs, mot: w.m, ov, aiNote: w.ai ? w.ai.note : '', byDir: isDir}; }
      };
      for(let a=0; a<=src.dur-need-TAIL+1e-6; a+=stepT) tryAt(a);
      if(dir && dir.src===si && dir.in <= src.dur-need-TAIL+1e-6) tryAt(dir.in);   // its exact moment too (off the scan grid)
    });
    return best;
  };
  order.forEach(i=>{
    const len = plan[i].end - plan[i].start;
    let best = pick(i,false,false) || pick(i,true,false) || pick(i,true,true) || pick(i,true,true,true) || {src:0,in:0,scaleR:1,cx:0.5,cy:0.5,face:0,ov:0};
    if(best.ov > 0.001) dupCount++;
    used[best.src].push([best.in, best.in + plan[i].sp.pos(len)*best.scaleR]);
    res[i] = best;
  });
  const useCount = sources.map(()=>0);   // (players re-assigned by assignPlayers on manual edits)
  edit = plan.map((s,i)=>({...s, ...res[i], el: sources[res[i].src].els[(useCount[res[i].src]++)%3]}));
  edit.forEach((e,i)=>{ const d = dirSlotOf(i); e.dirWhy = d ? d.why : ''; e.cx = 0.5 + (e.cx-0.5)*(e.face>0.3 ? 1 : 0.8); if(mode!=='smooth' && !e.fxByDir) suitFx(e); e.kf = keyframesFor(e); e.beatsIn = beats.filter(b=>b>e.start+0.12 && b<e.end-0.05).map(b=>b-e.start); });
  ukRestore(keptUk);
  setCanvas(); edit.forEach(e=>camAt(e, 0)); renderEDL();
  autoTools(); speechScan();
  $('s3').classList.remove('locked'); $('s3').classList.add('done');
  const total = sources.reduce((a,s)=>a+s.dur,0);
  $('s3st').textContent = edit.length + ' shots · ' + fmt(buf.duration) + (dupCount ? ' · ' + dupCount + ' shots reused (not enough footage)' : ' · no repeated moments');
  if(dupCount) showMsg('Your clips are a little short for this song, so ' + dupCount + ' shot' + (dupCount>1?'s repeat':' repeats') + '. Add more clips to avoid repeats.');
  else $('xmsg').hidden = true;
  ['play','remix','export','cover'].forEach(id=>$(id).disabled=false);
  if(dirInfo && !director.interim){ const shots = edit.filter((e,i)=>dirShot(i)).length, kept = edit.filter(e=>e.byDir).length;
    const keys = edit.reduce((n,e)=>n+((e.acc&&e.acc.length)||0), 0);
    aiStat('Shubix planned your Reel' + (director.story ? ': ' + director.story : '.') + (keys ? ' · ' + keys + ' keyframe' + (keys>1?'s':'') + ' on the hits' : '')); }
  captureLoop(); editGen++;
  paceMaybe(); directorMaybe();
  if(look === 'copy' && refProfile) setTimeout(()=>{ copyLook(); }, 0);
}
function captureLoop(){
  if(!edit.length) return;
  // the edit made again (a late AI answer, New mix): the playhead stays where the creator left it
  const at = () => pos > 0.31 && buf && pos < buf.duration - 0.05 ? pos : 0.3;
  return prepare(0, 0.6).then(()=>{ loopImg=null; const sv=showSafe, h=hookText; showSafe=false; hookText=''; drawFrame(0.6);
    const c=document.createElement('canvas'); c.width=out.width; c.height=out.height; c.getContext('2d').drawImage(out,0,0); loopImg=c;
    showSafe=sv; hookText=h; pos = at(); return prepare(segAt(pos), pos); }).then(()=>{ drawFrame(pos); if(kfOpen()) kfSync(); });
}
// an AI camera move in words: "zoom 1.00→1.18, slides right, turns 4°, fast then settles"
function moveWords(K){
  const a = K[0], b = K[K.length-1], w = [];
  if(Math.abs(b.s - a.s) > 0.02) w.push('zoom ' + a.s.toFixed(2) + '→' + b.s.toFixed(2));
  if(Math.abs(b.x - a.x) > 0.01) w.push(b.x > a.x ? 'slides right' : 'slides left');
  if(Math.abs(b.y - a.y) > 0.01) w.push(b.y > a.y ? 'slides down' : 'slides up');
  if(Math.abs(b.r - a.r) >= 1) w.push('turns ' + Math.round(b.r - a.r) + '°');
  const ez = { outExpo: 'fast then settles', outCubic: 'quick then eases', outBack: 'overshoots', inOut: 'smooth', lin: 'steady' }[b.ez];
  return (w.join(', ') || 'moves') + (ez ? ' · ' + ez : '') + ' · ' + K.length + ' keyframes';
}
function kfSummary(e){
  const cam = e.cam ? {face:'camera follows the face', subject:'camera follows the subject', still:'camera locked on the subject'}[e.cam.mode] : '';
  const notes = [e.dirWhy && aiOn ? 'Shubix: ' + e.dirWhy : '', e.aiNote && aiOn ? 'Shubix saw: ' + e.aiNote : '', e.why, cam].filter(Boolean).join(' · ');
  const why = (notes ? `<br><span style="font:11px var(--body);color:var(--muted)">${notes}</span>` : '')
    + (e.uk && e.uk.length ? `<br><span style="font:11px var(--body);color:#c99a00">◆ ${e.uk.length} keyframe${e.uk.length > 1 ? 's' : ''} of yours</span>` : '')
    + (e.acc && e.acc.length && aiOn ? `<br><span style="font:11px var(--body);color:var(--muted)">Shubix keyframes: ${e.acc.map(a => a.do + ' at ' + a.at.toFixed(2) + ' s').join(', ')}</span>` : '')
    + (e.ak && e.ak.length && aiOn ? `<br><span style="font:11px var(--body);color:var(--muted)">Shubix camera move: ${moveWords(e.ak)}</span>` : '');
  const s = e.kf && e.kf.scale; if(!s || s.length<2) return why;
  const a=s[0], b=s[s.length-1];
  return `<br><span style="font:11px var(--mono);color:var(--muted)">◆ scale ${a[1].toFixed(2)}→${b[1].toFixed(2)} · ${(b[0]-a[0]).toFixed(2)}s ${b[2]||''}</span>` + why;
}
/* ---- manual control: change any shot, the rest stays ---- */
const SPEED_KEYS = {normal:'1×', slow:'Slow 0.5×', fast:'Fast 1.6×', velocity:'Velocity (beat)', ramp:'Ramp 1.8×→0.6×', freeze:'Freeze → 1×', hold:'Freeze frame'};
const holdSpeed = {label:'Freeze frame', at:()=>0, pos:()=>0};   // the picture stands still for the whole shot
SPEED_KEYS.curve = 'Custom curve';
/* a custom speed curve: five speeds across the shot (start, 1/4, middle, 3/4, end; 0.2x-4x), smooth in between; the clip
 * time is the integral of the speed (precomputed in 96 steps) */
function curveSpeed(len, cv){
  const v = ['a','b','c','d','e'].map(k => Math.min(4, Math.max(0.2, +(cv && cv[k]) || 1)));
  const at = l => { const x = Math.min(1, Math.max(0, l/Math.max(1e-6, len)))*4, i = Math.min(3, Math.floor(x)), f = x - i, s2 = f*f*(3 - 2*f); return v[i] + (v[i+1] - v[i])*s2; };
  const N = 96, cum = new Float64Array(N + 1); for(let k = 0; k < N; k++){ const a = k*len/N, b = (k + 1)*len/N; cum[k+1] = cum[k] + (at(a) + at(b))/2*(b - a); }
  const pos = l => { const x = Math.min(N, Math.max(0, l/Math.max(1e-6, len)*N)), i = Math.min(N - 1, Math.floor(x)); return cum[i] + (cum[i+1] - cum[i])*(x - i); };
  return { label:'Custom curve', at, pos };
}
function speedFor(key, e){
  const len = e.end - e.start, bl = beats.filter(b=>b>e.start+0.15 && b<e.end-0.1).map(b=>b-e.start);
  if(key==='slow') return SPEED.slow; if(key==='fast') return SPEED.fast; if(key==='ramp') return rampSpeed(len);
  if(key==='velocity') return bl.length ? velocitySpeed(len, bl) : rampSpeed(len); if(key==='freeze') return snapSpeed; if(key==='hold') return holdSpeed; if(key==='curve') return curveSpeed(len, e.cs && e.cs.curve); return SPEED.normal;
}
const speedKey = sp => (Object.keys(SPEED_KEYS).find(k=>SPEED_KEYS[k]===sp.label) || (sp.label.startsWith('Ramp') ? 'ramp' : 'normal'));
function assignPlayers(){ const uc = sources.map(()=>0); edit.forEach(e=>{ e.el = sources[e.src].els[(uc[e.src]++)%3]; }); }
// pick another moment of footage for shot i: never one already used, never the same clip as its neighbours
function repick(i, avoidCurrent, onlySrc){
  const e = edit[i], len = e.end-e.start, gmax = Math.max(1e-6, ...sources.flatMap(s=>s.samples.map(x=>x.m)));
  const used = sources.map(()=>[]); edit.forEach((x,k)=>{ if(k!==i) used[x.src].push([x.in, x.in + x.sp.pos(x.end-x.start)*x.scaleR]); });
  let best=null, bs=-Infinity;
  sources.forEach((src,si)=>{
    if(onlySrc != null ? si !== onlySrc : sources.length>1 && [edit[i-1],edit[i+1]].some(x=>x && x.src===si)) return;
    let need = e.sp.pos(len), scaleR = 1; if(need > src.dur-TAIL){ scaleR = Math.max(0.05, (src.dur-TAIL)/need*0.98); need *= scaleR; }
    for(let a=0; a<=src.dur-need-TAIL+1e-6; a+=Math.max(0.1, Math.min(0.5, src.dur/120))){
      if(avoidCurrent && si===e.src && Math.abs(a-e.in) < Math.max(0.3, need*0.5)) continue;
      if(used[si].some(([u0,u1])=>Math.min(u1,a+need)-Math.max(u0,a) > 0.001)) continue;
      if(crossesScene(src, a, a+need)) continue;
      const st = windowStats(src, a, a+need), m = st.m/gmax;
      let sc = e.type==='drop' ? 2.2*m : e.type==='hit' ? 1.5*m : e.type==='break' ? 1-Math.abs(m-0.18)*2 : 1-Math.abs(m-0.55);
      if(st.b < 0.08) sc -= 1; const sharp = st.sh/(src.shMed||1); if(sharp<0.45) sc -= 0.9; else sc += 0.25*Math.min(1.5,sharp);
      sc += st.face*0.6 + rng()*0.3;
      const ai = aiAt(src, a, a+need); if(ai) sc += aiBonus(ai, i===0 ? 'hook' : e.type, i===edit.length-1);
      if(sc>bs){ bs=sc; best={src:si, in:a, scaleR, cx: st.face>0.3 ? st.fx : 0.5+(st.cx-0.5)*0.8, cy: st.face>0.3 ? st.fy : 0.45, face:st.face, fs: st.fs, mot: m, aiNote: ai ? ai.note : ''}; }
    }
  });
  if(!best) return false;
  Object.assign(e, best); e.cam = null; assignPlayers(); return true;
}
async function showShot(i){ pos = edit[i].start + Math.min(0.4, (edit[i].end-edit[i].start)*0.5);
  await Promise.all([edit[i-1]?prepare(i-1,edit[i-1].end-0.01):0, prepare(i, pos)]); drawFrame(pos); drawTimeline(); }
function changed(i, refit){
  stopAll(); const e = edit[i]; e.kf = keyframesFor(e);
  if(refit){ const need = e.sp.pos(e.end-e.start)*e.scaleR, src = sources[e.src];
    const clash = edit.some((x,k)=>k!==i && x.src===e.src && Math.min(x.in+x.sp.pos(x.end-x.start)*x.scaleR, e.in+need)-Math.max(x.in,e.in) > 0.001);
    if(e.in + need > src.dur || clash || crossesScene(src, e.in, e.in+need)) repick(i, false); }
  renderEDL(true); showShot(i);
}
/* ---- shot tools (as in every editor): split, duplicate, delete, replace. The song's timing stays: a shot's time goes to
 * its neighbours, so the Reel keeps its length and every cut stays on the beat. ---- */
const MIN_SHOT = 0.3;
function shotOp(op, arg){
  if(kind === 'talk' || !edit.length || exporting || recording) return false;
  stopAll();
  const i = segAt(pos), e = edit[i], L = editOf(), x = L[i];
  const done = (list, j, msg) => { if(!restoreEdit(list)) return false; j = Math.min(j, edit.length - 1); pos = edit[j].start + 0.05; showShot(j); if(msg) notify(msg); return true; };
  if(op === 'split' || op === 'dup'){
    // split: where the playhead is (on a beat when one is close); duplicate: in the middle, and the moment plays twice
    let t = op === 'dup' ? (e.start + e.end) / 2 : pos;
    const nb = beats.filter(b => b > e.start + MIN_SHOT && b < e.end - MIN_SHOT).sort((a, b) => Math.abs(a - t) - Math.abs(b - t))[0];
    if(nb != null && Math.abs(nb - t) < (op === 'dup' ? (e.end - e.start) / 4 : 0.15)) t = nb;
    if(t - e.start < MIN_SHOT || e.end - t < MIN_SHOT){ notify(op === 'dup' ? 'This shot is too short to play twice.' : 'Move the playhead inside the shot to split it there.'); return false; }
    const at = t - e.start, uk = x.uk || [];
    const ua = uk.filter(k => k.t < at), ub = op === 'dup' ? ua.map(k => ({ ...k })) : uk.filter(k => k.t >= at).map(k => ({ ...k, t: k.t - at }));
    const a = { ...x, end: t, uk: ua.length ? ua : undefined };
    if(x.cs && x.cs.rev && op === 'split') a.in = srcPos(e, at);
    const b = { ...x, start: t, uk: ub.length ? ub : undefined, in: op === 'dup' ? x.in : x.cs && x.cs.rev ? x.in : srcPosF(e, at),
      tr: op === 'dup' ? (x.tr === 'hard' ? 'flash' : x.tr) : 'hard' };   // a replay reads better with a little transition
    L.splice(i, 1, a, b);
    return done(L, i + 1, op === 'dup' ? 'Shot ' + (i + 1) + ' now plays twice.' : 'Shot ' + (i + 1) + ' split in two.');
  }
  if(op === 'freeze'){
    // freeze frame: the picture at the playhead stands still (1 s, or up to the next beat), then the shot plays on from there
    const t = Math.max(e.start, Math.min(e.end - MIN_SHOT, pos)), at = t - e.start, src = x.cs && x.cs.rev ? srcPos(e, at) : srcPosF(e, at);
    const nb = beats.find(b => b > t + 0.45 && b < t + 1.6), hold = Math.min(e.end - t, nb ? nb - t : 1);
    if(hold < 0.25){ notify('Move the playhead earlier in the shot to freeze it there.'); return false; }
    const parts = [];
    if(at >= MIN_SHOT) parts.push({ ...x, end: t, uk: undefined });
    parts.push({ ...x, start: t, end: t + hold, in: src, sp: 'hold', tr: at >= MIN_SHOT ? 'flash' : x.tr, efx: 'none', uk: undefined });
    if(e.end - (t + hold) >= MIN_SHOT) parts.push({ ...x, start: t + hold, in: src, tr: 'hard', uk: undefined });
    else parts[parts.length - 1].end = e.end;
    L.splice(i, 1, ...parts);
    return done(L, i + (at >= MIN_SHOT ? 1 : 0), 'Freeze frame added to shot ' + (i + 1) + '.');
  }
  if(op === 'delete'){
    if(L.length < 2){ notify('A Reel needs at least one shot.'); return false; }
    // its time goes to the shot before (the first shot's to the next one), which then gets enough footage
    const j = i > 0 ? i - 1 : 1, y = L[j];
    if(i > 0) y.end = x.end;
    else { const d = y.start - x.start; y.start = x.start; y.tr = x.tr; if(y.uk) y.uk = y.uk.map(k => ({ ...k, t: k.t + d })); }
    L.splice(i, 1);
    const k = i > 0 ? i - 1 : 0;
    if(!done(L, k, 'Shot ' + (i + 1) + ' deleted.')) return false;
    changed(k, true); return true;
  }
  if(op === 'replace'){
    const si = +arg; if(!sources[si]) return false;
    if(!repick(i, si === e.src, si)){ notify('Every moment of that clip is already in the Reel. Pick another clip.'); return false; }
    e.kf = keyframesFor(e); renderEDL(true); showShot(i); editGen++;
    notify('Shot ' + (i + 1) + ' now uses ' + sources[si].name.replace(/\.[^.]+$/, '') + '.'); return true;
  }
  return false;
}
// the current shot's clip settings: read, change (a patch; null resets them all)
function shotCs(){ return edit.length && kind !== 'talk' ? { ...csOf(edit[segAt(pos)]), i: segAt(pos) } : null; }
function shotSet(patch){
  if(!edit.length || kind === 'talk' || exporting || recording) return;
  const e = edit[segAt(pos)]; e.cs = patch === null ? undefined : { ...(e.cs || {}), ...patch };
  if(e.cs && e.cs.auto){ e.cs.auto = e.cs.auto.filter(k => !(k in patch)); if(!e.cs.auto.length) delete e.cs.auto; }
  if(e.cs) for(const k of Object.keys(e.cs)) if(JSON.stringify(e.cs[k]) === JSON.stringify(CS0[k])) delete e.cs[k];
  if(e.cs && !Object.keys(e.cs).length) e.cs = undefined;
  if(patch && 'curve' in patch){ e.sp = speedFor('curve', e); changed(segAt(pos), true); }
  if(!playing) redrawFrame();
}
// slip: the same shot, an earlier or later moment of its clip (the shot's place in the song stays)
function shotSlip(d){
  if(!edit.length || kind === 'talk') return false; stopAll();
  const i = segAt(pos), e = edit[i], need = e.sp.pos(e.end - e.start)*e.scaleR, max = Math.max(0, sources[e.src].dur - need - TAIL);
  const v = Math.max(0, Math.min(max, e.in + d)); if(Math.abs(v - e.in) < 1e-3){ notify(d < 0 ? 'This is the start of the clip.' : 'This is the end of the clip.'); return false; }
  e.in = v; e.cam = null; e.kf = keyframesFor(e); renderEDL(true); showShot(i); editGen++; return true;
}
// trim: the shot's end moves one beat (the next shot starts there), so the cuts stay on the beat
function shotTrim(dir){
  if(!edit.length || kind === 'talk') return false; stopAll();
  const i = segAt(pos), e = edit[i], nx = edit[i+1];
  if(!nx){ notify('The last shot ends with the song.'); return false; }
  const grid = beats.length ? beats : [];
  const to = dir > 0 ? grid.find(b => b > e.end + 0.05 && b < nx.end - MIN_SHOT) : [...grid].reverse().find(b => b < e.end - 0.05 && b > e.start + MIN_SHOT);
  if(to == null){ notify(dir > 0 ? 'The next shot is too short to give a beat.' : 'This shot is already as short as it can be.'); return false; }
  const L = editOf(), d = to - L[i+1].start; L[i].end = to; L[i+1].start = to;
  if(L[i+1].uk) L[i+1].uk = L[i+1].uk.map(k => ({ ...k, t: k.t - d })).filter(k => k.t >= 0);
  if(!restoreEdit(L)) return false; changed(i, true); changed(i+1, true); pos = edit[i].start + 0.05; showShot(i); return true;
}
// Undo / Redo: a step is kept each time the edit or the texts change (any control, a new mix, a split…). The list starts
// again when the song or the clips change, because an older edit would not fit them.
const hist = { u: [], r: [], cur: null, cand: '', base: '' };
const HIST_MAX = 60;
const lyOf = () => layers.map(L => { const c = JSON.parse(JSON.stringify({ ...L, fc: undefined })); return c; });
function histSnap(){ const ov = overlays.map(o => { const c = { ...o }; delete c.box; return c; }), ed = editOf(), ly = lyOf(); return { ed, ov, ly, sig: JSON.stringify([ed, ov, ly]) }; }
function histBase(){ return kind + '|' + sources.map(s => s.name + s.dur).join() + '|' + (buf ? buf.duration.toFixed(2) : ''); }
function histTick(){
  if(restoring || exporting || recording || pending || playing) return;
  const base = histBase();
  if(base !== hist.base){ hist.base = base; hist.u = []; hist.r = []; hist.cur = edit.length || overlays.length ? histSnap() : null; hist.cand = ''; histUI(); return; }
  if(!edit.length && !overlays.length && !layers.length) return;
  const now = histSnap(); if(!hist.cur){ hist.cur = now; return; }
  if(now.sig === hist.cur.sig){ hist.cand = ''; return; }
  if(now.sig !== hist.cand){ hist.cand = now.sig; return; }   // kept once it stops changing (a drag is one step)
  hist.u.push(hist.cur); if(hist.u.length > HIST_MAX) hist.u.shift(); hist.r = []; hist.cur = now; hist.cand = ''; histUI();
}
function histGo(back){
  if(exporting || recording || restoring) return;
  const now = histSnap(); if(hist.cur && now.sig !== hist.cur.sig){ hist.u.push(hist.cur); hist.r = []; hist.cur = now; }
  const from = back ? hist.u : hist.r, to = back ? hist.r : hist.u; if(!from.length || !hist.cur) return;
  to.push(hist.cur); const s = from.pop(); hist.cand = '';
  if(kind !== 'talk' && s.ed.length) restoreEdit(s.ed);
  overlays = s.ov.map(o => ({ ...o })); ovSel = -1; renderOvList();
  if(s.ly){ layers = s.ly.map(L => ({ ...L })); lySel = Math.min(lySel, layers.length - 1); lyUI(); clipMixKey = ''; }
  if(edit.length) showShot(Math.min(segAt(pos), edit.length - 1)); else redrawFrame();
  hist.cur = histSnap(); histUI(); notify(back ? 'Undone' : 'Redone');
}
function histUI(){ const u = $('undo'), r = $('redo'); if(u) u.disabled = !hist.u.length; if(r) r.disabled = !hist.r.length; }
setInterval(histTick, 500);
$('undo').addEventListener('click', () => histGo(true), SIG);
$('redo').addEventListener('click', () => histGo(false), SIG);
addEventListener('keydown', ev => {
  if(!(ev.ctrlKey || ev.metaKey) || ev.altKey) return; const k = ev.key.toLowerCase(); if(k !== 'z' && k !== 'y') return;
  const t = ev.target; if(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;   // their own undo
  if(!root.isConnected) return; ev.preventDefault(); histGo(k === 'z' && !ev.shiftKey);
}, SIG);
function sel(opts, val, onch){ const s=document.createElement('select'); Object.entries(opts).forEach(([k,v])=>{ const o=document.createElement('option'); o.value=k; o.textContent=v; if(k===val) o.selected=true; s.appendChild(o); });
  s.addEventListener('click', ev=>ev.stopPropagation()); s.addEventListener('change', ()=>onch(s.value)); return s; }
function renderEDL(keepScroll){
  const box = $('edl').parentElement.parentElement, sc = box.scrollTop;
  const tb = $('edl'); tb.textContent='';
  edit.forEach((e,i)=>{
    const tr=document.createElement('tr');
    tr.innerHTML = `<td class="t">${fmt(e.start)}<br><span style="color:var(--muted)">${(e.end-e.start).toFixed(2)}s</span></td><td><span class="pill" style="background:var(${TCOL[e.type]})">${TNAME[e.type]}</span>${e.face>0.3?'<br><span title="face in shot">🙂</span>':''}</td><td class="clipc"></td><td></td><td></td><td></td>`;
    const cc = tr.children[2]; const nm = document.createElement('span'); nm.textContent = sources[e.src].name.replace(/\.[^.]+$/,'') + ' @ ' + e.in.toFixed(1) + 's'; cc.appendChild(nm);
    const rb = document.createElement('button'); rb.className='mini'; rb.textContent='↻ other moment'; rb.title='Use a different moment here (never a repeat)';
    rb.addEventListener('click', ev=>{ ev.stopPropagation(); stopAll(); if(repick(i, true)){ renderEDL(true); showShot(i); } else showMsg('No unused footage left for this shot. Add more clips.', true); });
    cc.appendChild(document.createElement('br')); cc.appendChild(rb);
    tr.children[3].appendChild(sel(TR_NAME, e.tr, v=>{ noteEdit(e.type, 'tr', e.tr, v, e.trByDir); e.tr=v; e.trByDir=false; changed(i,false); }));
    const fxc = tr.children[4]; fxc.appendChild(sel(FX_NAME, e.efx, v=>{ noteEdit(e.type, 'efx', e.efx, v, e.fxByDir); e.efx=v; e.fxByDir=false; if(v==='snap'){ e.sp=snapSpeed; changed(i,true); } else { if(e.sp===snapSpeed) e.sp=SPEED.normal; changed(i,true); } }));
    fxc.insertAdjacentHTML('beforeend', kfSummary(e));
    tr.children[5].appendChild(sel(SPEED_KEYS, speedKey(e.sp), v=>{ noteEdit(e.type, 'sp', speedKey(e.sp), v, e.dirWhy && aiOn); e.sp = speedFor(v, e); changed(i,true); }));
    tr.addEventListener('click', ()=>{ if(playing) startPlayback(e.start); else showShot(i); });
    tb.appendChild(tr);
  });
  if(keepScroll) box.scrollTop = sc;
  drawTimeline();
}
// the clips' colours on the timelines (muted, as in the studio's design)
const CLIP_COL = ['#6b5540','#46596a','#5a4766','#476452','#6e4a44','#5f5a3c','#3f5d63','#6a5a2e'];
// timeline strip: one block per shot, coloured by clip, marker colour = shot type
function drawTimeline(){
  const cv = $('tl'); if(!cv || !buf) return;
  const dpr = window.devicePixelRatio||1, w = Math.max(1,Math.round(cv.clientWidth*dpr)), h = Math.round(46*dpr);
  cv.width=w; cv.height=h; const g=cv.getContext('2d'); g.clearRect(0,0,w,h);
  const D = buf.duration;
  edit.forEach((e,i)=>{ const x0 = e.start/D*w, x1 = e.end/D*w;
    g.fillStyle = CLIP_COL[e.src % CLIP_COL.length]; g.fillRect(x0+dpr*0.5, 10*dpr, Math.max(1,x1-x0-dpr), h-12*dpr);
    g.fillStyle = css(TCOL[e.type]); g.fillRect(x0, 0, Math.max(2*dpr, 3*dpr), 8*dpr);
    if(e.sp.label!=='1×'){ g.fillStyle='rgba(0,0,0,0.35)'; g.fillRect(x0+dpr, h-7*dpr, Math.max(1,x1-x0-2*dpr), 5*dpr); }
    if(e.uk && e.uk.length){ const cx = (x0+x1)/2, cy = h/2 + 5*dpr, r = 5*dpr; g.beginPath(); g.moveTo(cx, cy-r); g.lineTo(cx+r, cy); g.lineTo(cx, cy+r); g.lineTo(cx-r, cy); g.closePath(); g.fillStyle = '#FFD54A'; g.fill(); g.strokeStyle = '#000'; g.lineWidth = dpr; g.stroke(); } });
  for(const m of userMarks){ const x = (m - secStart)/D*w; if(x >= 0 && x <= w){ g.fillStyle = '#FFD54A'; g.beginPath(); g.moveTo(x - 4*dpr, 0); g.lineTo(x + 4*dpr, 0); g.lineTo(x, 7*dpr); g.closePath(); g.fill(); } }
  const t = playing ? curTime() : pos; g.fillStyle = css('--ink'); g.fillRect(Math.round(t/D*w)-dpr, 0, 2*dpr, h);
  if(tlZoom > 1){ const sc = cv.parentElement, px = t/D*cv.clientWidth; if(sc && (px < sc.scrollLeft + 20 || px > sc.scrollLeft + sc.clientWidth - 20)) sc.scrollLeft = px - sc.clientWidth/2; }
}
/* timeline zoom: 1x shows the whole Reel; 2x-8x widen the shot strip and the lanes, which then scroll and follow the playhead */
let tlZoom = 1;
function setTlZoom(z){ tlZoom = Math.max(1, Math.min(8, z)); for(const id of ['tl','lanes']){ const c = $(id); if(c) c.style.width = (tlZoom*100) + '%'; }
  root.classList.toggle('tlzoomed', tlZoom > 1); $('tlz').textContent = tlZoom + '×'; drawTimeline(); if(typeof drawLanes === 'function') try{ drawLanes(); }catch(e){} }
$('tlzi').addEventListener('click', () => setTlZoom(tlZoom*2), SIG);
$('tlzo').addEventListener('click', () => setTlZoom(tlZoom/2), SIG);
$('addbeat').addEventListener('click', () => addMark(playing ? curTime() : pos), SIG);
$('clrbeat').addEventListener('click', () => clearMarks(), SIG);
$('tl').addEventListener('click', ev=>{ if(!edit.length) return; const r=$('tl').getBoundingClientRect(), tt=(ev.clientX-r.left)/r.width*buf.duration;
  const i = segAt(tt); if(playing) startPlayback(tt); else { const rows=$('edl').children; rows[i] && rows[i].scrollIntoView({block:'nearest'}); showShot(i); } });
$('remix').onclick = () => { seed = (seed*7919 + 13) % 2147483647 || 7; mixNo++; makeEdit(); };

/* =============== RENDERER =============== */
const out = $('out'), og = out.getContext('2d');
// The live preview draws at half size (540×960 for a Reel): a quarter of the pixels, so it stays smooth on phones.
// Export and the cover switch to the full 1080p size.
const PREVIEW_SCALE = 0.5;
function setCanvas(full, scale = 1){ const [W0,H0]=SIZES[aspect], s = full ? scale : PREVIEW_SCALE, w = Math.round(W0*s/2)*2, h = Math.round(H0*s/2)*2;
  if(out.width!==w||out.height!==h){ out.width=w; out.height=h; loopImg=null; } }
function segAt(t){ let lo=0,hi=edit.length-1,r=0; while(lo<=hi){ const m=(lo+hi)>>1; if(edit[m].start<=t+1e-4){ r=m; lo=m+1; } else hi=m-1; } return r; }
async function prepare(i, t){
  const e = edit[i]; if(!e) return;
  if(layers.length && !playing) await prepLayers(t);
  const local = Math.max(0, t - e.start), target = srcPos(e, local);
  if(e.el.readyState < 2){ try{ await videoData(e.el, 6000); }catch(err){} }
  e.el.pause(); const r0 = rateAt(e, local); if(r0>0) e.el.playbackRate = r0;
  if(Math.abs(e.el.currentTime - target) > 0.04){ e.el.currentTime = target; try{ await waitEv(e.el,'seeked',4000); }catch(err){} }
}
const srcPosF = (e, l) => e.in + e.sp.pos(l)*e.scaleR;
const srcPos = (e, l) => e.cs && e.cs.rev ? e.in + (e.sp.pos(e.end - e.start) - e.sp.pos(l))*e.scaleR : srcPosF(e, l);
const rateAt = (e, l) => { const r = e.sp.at(l)*e.scaleR; return r<=0 ? 0 : Math.max(0.0625, Math.min(16, r)); };
const ease = x => 1 - Math.pow(1-Math.min(1,Math.max(0,x)),3);
const LOOKS = {
  natural:{name:'Natural', filter:'contrast(1.06) saturate(1.04)', grain:0},
  vivid:{name:'Vivid', filter:'contrast(1.15) saturate(1.12) brightness(1.02)', grain:0.04},
  cine:{name:'Cinematic', filter:'contrast(1.18) saturate(0.9) brightness(0.98)', tint:true, grain:0.08},
  mono:{name:'B&W', filter:'grayscale(1) contrast(1.25)', grain:0.1},
  copy:{name:'Copied', filter:'none', grain:0},   // until the copied look is matched (copyLook sets it)
};
let look = 'vivid', hookText = '', showSafe = true, loopImg = null, holdText = false;
const bufA = document.createElement('canvas'), gA = bufA.getContext('2d');
const bufB = document.createElement('canvas'), gB = bufB.getContext('2d');
function fitBufs(){ [bufA,bufB].forEach(b=>{ if(b.width!==out.width||b.height!==out.height){ b.width=out.width; b.height=out.height; } }); }

// draw one shot with its keyframed properties into context g
function drawShot(g, e, local, o={}){
  const W=out.width, H=out.height, v=texOf(e, local), L=e.end-e.start;
  if(!v || v.readyState<2) return;
  const K = e.kf || {};
  let scale = (kf(K.scale,local) ?? 1) * (o.scale||1) * (o.noFx ? 1 : emphAt(e.start + local));
  let x = (kf(K.x,local) ?? 0)*W + (o.dx||0), y = (o.dy||0), rot = (kf(K.rot,local) ?? 0) + (o.rot||0);
  const sh = kf(K.shake,local) || 0;
  if(sh){ x += Math.sin(local*97)*0.03*W*sh; y += Math.cos(local*71)*0.025*H*sh; rot += Math.sin(local*53)*2.2*sh; }
  if(K.bounce && e.beatsIn){ for(const bt of e.beatsIn){ if(local>=bt){ scale *= 1 + 0.045*Math.exp(-(local-bt)/0.11); } } }
  const ac = o.noFx ? null : accentAt(e, local);
  if(ac){ scale *= ac.s; if(ac.sh){ x += Math.sin(local*97)*0.03*W*ac.sh; y += Math.cos(local*71)*0.025*H*ac.sh; rot += Math.sin(local*53)*2.2*ac.sh; } }
  const am = uAt(e.ak, local);   // the AI director's camera keyframes
  if(am){ scale *= am.s; rot += am.r; x += am.x*W; y += am.y*H; }
  const u = uAt(e.uk, local), ux = u ? u.x*W : 0, uy = u ? u.y*H : 0;
  if(u){ scale *= u.s; rot += u.r; }
  const cs0 = csOf(e); let stab = null;
  if(cs0.stab > 0 && !o.noStab){ stab = stabAt(sources[e.src], srcPos(e, local)); scale *= 1 + 0.12*cs0.stab; }
  const G = csGeom(e, scale), c = G.c, dw = G.dw, dh = G.dh, [ccx, ccy] = csCam(e, local, c);
  if(stab){ x += stab[0]*dw*cs0.stab; y += stab[1]*dh*cs0.stab; }
  let px = W/2 - ccx*dw; px = panClamp(px, W, dw) + x;
  let py0 = H/2 - ccy*dh; py0 = panClamp(py0, H, dh);
  const py = py0 + y;
  const alpha = (o.alpha ?? 1) * (u ? Math.max(0, Math.min(1, u.o)) : 1);
  const paint = (gg, a, extra=1, ox=0, oy=0) => {
    gg.save(); gg.globalAlpha = a;
    if(ux || uy) gg.translate(ux, uy);   // the creator's move: after the turn, so a moved shot turns about its own middle
    if(rot || extra!==1){ gg.translate(W/2,H/2); gg.rotate(rot*Math.PI/180); gg.scale(extra,extra); gg.translate(-W/2,-H/2); }
    gg.filter = LOOKS[look].filter + csFilter(c); csDraw(gg, v, c, px+ox, py+oy, dw, dh); gg.restore(); };
  // a fitted picture: its canvas (blurred copy or a colour) and border, under the picture
  const canvasBg = (g, alpha) => { if(!c.fit) return;
    g.save(); g.globalAlpha = alpha;
    if(ux || uy) g.translate(ux, uy);
    if(c.bg === 'blur'){ const rb = Math.max(W/G.sw, H/G.sh)*1.12; g.filter = 'blur(' + Math.round(W*0.03) + 'px) brightness(0.62)'; csDraw(g, v, c, W/2 - G.sw*rb/2, H/2 - G.sh*rb/2, G.sw*rb, G.sh*rb); g.filter = 'none'; }
    else { g.fillStyle = c.bgc; g.fillRect(-W, -H, 3*W, 3*H); }
    if(c.bd > 0){ const b = c.bd*0.04*W; if(rot){ g.translate(W/2,H/2); g.rotate(rot*Math.PI/180); g.translate(-W/2,-H/2); } g.fillStyle = c.bdc; g.fillRect(px-b, py-b, dw+2*b, dh+2*b); }
    g.restore(); };
  const rgb = (kf(K.rgb,local) || 0) + (o.rgb||0) + (ac ? ac.rgb : 0);
  if(rgb > 0.5 && !o.noFx){
    // chromatic aberration: red and blue channels pushed apart
    fitBufs(); gB.globalCompositeOperation='source-over'; gB.fillStyle='#000'; gB.fillRect(0,0,W,H);
    const chan = (col, ox) => { gA.globalCompositeOperation='source-over'; gA.clearRect(0,0,W,H); canvasBg(gA,1); paint(gA,1,1,ox,0);
      gA.globalCompositeOperation='multiply'; gA.fillStyle=col; gA.fillRect(0,0,W,H);
      gB.globalCompositeOperation='lighter'; gB.drawImage(bufA,0,0); };
    chan('#f00', -rgb); chan('#0f0', 0); chan('#00f', rgb);
    gB.globalCompositeOperation='source-over';
    g.save(); g.globalAlpha = alpha; g.drawImage(bufB,0,0); g.restore();
  } else { canvasBg(g, alpha); paint(g, alpha); }
  // zoom blur: faint bigger copies
  const zb = (kf(K.zblur,local) || 0) + (o.zblur||0);
  if(zb > 0.02 && !o.noFx) for(let k=1;k<=3;k++) paint(g, 0.22*zb*alpha, 1 + 0.045*k*zb);
  let expo = (kf(K.expo,local) || 0) + (ac ? ac.ex : 0);
  if(K.bounce && e.beatsIn && !o.noFx){ for(const bt of e.beatsIn){ if(local>=bt) expo += 0.22*Math.exp(-(local-bt)/0.07); } }   // light pulse on each beat
  if(!o.noFx && e.sp && rateAt(e, local) >= 1.8) for(let k=1;k<=2;k++) paint(g, 0.16*alpha, 1 + 0.012*k);   // motion blur when fast
  if(expo > 0.01 && !o.noFx){ g.save(); g.globalCompositeOperation='lighter'; paint(g, Math.min(1,expo)*alpha); g.restore(); }
  const br = (kf(K.bright,local) ?? 1) * csFade(c, local, L);
  if(br < 1){ g.fillStyle=`rgba(0,0,0,${(1-br)*alpha})`; g.fillRect(0,0,W,H); }
}
// the shot's colour as a canvas filter (the shader's adj(); warmth as a sepia / hue nudge)
function csFilter(c){ if(!c.bri && !c.con && !c.sat && !c.warm) return '';
  return ` brightness(${(1+c.bri*0.5).toFixed(3)}) contrast(${(1+c.con).toFixed(3)}) saturate(${(1+c.sat).toFixed(3)})` + (c.warm ? (c.warm > 0 ? ` sepia(${(c.warm*0.25).toFixed(3)})` : ` hue-rotate(${(c.warm*-12).toFixed(1)}deg)`) : ''); }
// the picture in its display rect: turned, then mirrored / flipped
function csDraw(g, v, c, x, y, w, h){
  if(!c.rot && !c.fh && !c.fv){ g.drawImage(v, x, y, w, h); return; }
  const odd = (c.rot/90)&1; g.save(); g.translate(x + w/2, y + h/2); g.scale(c.fh ? -1 : 1, c.fv ? -1 : 1); g.rotate(c.rot*Math.PI/180);
  const sw = odd ? h : w, sh = odd ? w : h; g.drawImage(v, -sw/2, -sh/2, sw, sh); g.restore();
}
// mosaic and magnifier on the 2D canvas (the shader does them in its own pass)
function lensPass2D(g, e){
  const c = csOf(e); if(!c.mz && !c.mg) return; const W = out.width, H = out.height, Z = lensOf(e); fitBufs();
  gA.globalCompositeOperation = 'source-over'; gA.clearRect(0,0,W,H); gA.drawImage(out, 0, 0);
  if(c.mz){ const [x,y,w,h] = Z.mz, tw = Math.max(1, Math.round(w/Z.mzc)), th = Math.max(1, Math.round(h/Z.mzc));
    gB.clearRect(0,0,W,H); gB.drawImage(bufA, x, y, w, h, 0, 0, tw, th); g.save(); g.imageSmoothingEnabled = false; g.drawImage(bufB, 0, 0, tw, th, x, y, w, h); g.restore();
    gA.clearRect(0,0,W,H); gA.drawImage(out, 0, 0); }
  if(c.mg){ const [cx,cy,R,z] = Z.mg; g.save(); g.beginPath(); g.arc(cx, cy, R, 0, 2*Math.PI); g.clip(); g.drawImage(bufA, cx-R/z, cy-R/z, 2*R/z, 2*R/z, cx-R, cy-R, 2*R, 2*R); g.restore();
    g.save(); g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = Math.max(2, W*0.004); g.beginPath(); g.arc(cx, cy, R, 0, 2*Math.PI); g.stroke(); g.restore(); }
}

/* =============== OVERLAY TRACK: videos and photos on top of the Reel ===============
 * Each layer: a video or photo (lmedia) shown from t0 to t1, placed at x / y (its middle, 0..1 of the frame), s wide
 * (0..1 of the frame), turned r degrees, op opacity, cropped (crop l/t/r/b, 0..1 of the picture), mirrored / flipped,
 * masked (mask: none / circle / rect / line / mirror, with mk size, angle, feather, invert), faded in / out, and for a
 * video its own sound (vol). Drawn over the shot, under texts and captions, the same way in the preview and the export
 * (where each video layer has its own decoder). Saved with the Reel; Undo keeps them. Layouts place a layer in one tap. */
let lmedia = [], layers = [], lySeq = 0, lySel = -1;
const LY0 = { x:0.5, y:0.5, s:0.5, r:0, op:1, fh:false, fv:false, crop:{l:0,t:0,r:0,b:0}, mask:'none', mk:{w:0.8,h:0.8,a:0,f:0.12,inv:false}, fin:0, fout:0, vol:0, rad:0 };
let lyBuf = null, lyG = null;
async function addLayerMedia(file){
  const url = URL.createObjectURL(file), photo = /^image\//.test(file.type) || /\.(jpe?g|png|webp|heic|gif)$/i.test(file.name);
  if(photo){ const img = new Image(); img.src = url; await img.decode(); return { kind:'photo', file, url, img, w: img.naturalWidth, h: img.naturalHeight, dur: Infinity, name: file.name }; }
  const el = document.createElement('video'); el.muted = true; el.playsInline = true; el.preload = 'auto'; el.src = url;
  await new Promise((res, rej) => { el.onloadedmetadata = res; el.onerror = () => rej(new Error('This video cannot be opened.')); });
  return { kind:'video', file, url, el, w: el.videoWidth, h: el.videoHeight, dur: el.duration, name: file.name };
}
async function layerAdd(files){
  if(!edit.length){ notify('Make the Reel first, then add videos or photos on top.'); return; }
  for(const f of files){
    let M; try{ M = await addLayerMedia(f); }catch(err){ notify(String(err.message || err), 'err'); continue; }
    lmedia.push(M); const D = buf.duration, t0 = Math.min(pos, Math.max(0, D - 1)), len = M.kind === 'video' ? Math.min(M.dur, D - t0) : Math.min(3, D - t0);
    layers.push({ id: ++lySeq, m: lmedia.length - 1, t0, t1: t0 + Math.max(0.5, len), in: 0, ...JSON.parse(JSON.stringify(LY0)), x: 0.68, y: 0.3, s: 0.45 });
    lySel = layers.length - 1;
  }
  lyUI(); await prepLayers(pos); redrawFrame();
}
const lyOn = (L, t) => t >= L.t0 && t < L.t1;
const lyTime = (L, t) => L.in + (t - L.t0);
// the layer's picture, cropped, masked and faded, in its own canvas; then placed on the frame
function drawLayers(g, t){
  for(const L of layers){ if(!lyOn(L, t)) continue; const M = lmedia[L.m]; if(!M) continue;
    const src = M.kind === 'photo' ? M.img : exporting ? L.fc : M.el;
    if(!src || (M.kind === 'video' && !exporting && M.el.readyState < 2)) continue;
    const W = out.width, H = out.height, c = L.crop, sw0 = src.videoWidth || src.naturalWidth || src.width, sh0 = src.videoHeight || src.naturalHeight || src.height;
    const sx = sw0*c.l, sy = sh0*c.t, sw = Math.max(2, sw0*(1 - c.l - c.r)), sh = Math.max(2, sh0*(1 - c.t - c.b));
    const dw = Math.max(2, Math.round(L.s*W)), dh = Math.max(2, Math.round(dw*sh/sw*(M.h && M.w ? (M.w/M.h)/(sw0/sh0) : 1)));
    if(!lyBuf){ lyBuf = document.createElement('canvas'); lyG = lyBuf.getContext('2d'); }
    if(lyBuf.width !== dw || lyBuf.height !== dh){ lyBuf.width = dw; lyBuf.height = dh; }
    const q = lyG; q.save(); q.globalCompositeOperation = 'source-over'; q.clearRect(0, 0, dw, dh); q.drawImage(src, sx, sy, sw, sh, 0, 0, dw, dh);
    if(L.key && L.key.on) chromaKey(q, dw, dh, L.key);
    if(L.mask !== 'none' || L.rad > 0){ layerMask(q, L, dw, dh); }
    q.restore();
    const life = t - L.t0, left = L.t1 - t, a = L.op * Math.min(L.fin > 0 ? Math.min(1, life/L.fin) : 1, L.fout > 0 ? Math.min(1, left/L.fout) : 1);
    g.save(); g.globalAlpha = Math.max(0, Math.min(1, a)); g.globalCompositeOperation = L.blend || 'source-over'; g.translate(L.x*W, L.y*H); if(L.r) g.rotate(L.r*Math.PI/180); g.scale(L.fh ? -1 : 1, L.fv ? -1 : 1);
    g.drawImage(lyBuf, -dw/2, -dh/2); g.restore();
    if(L === layers[lySel] && !exporting && !recording && !playing){   // the chosen layer: a thin frame (preview only)
      g.save(); g.translate(L.x*W, L.y*H); if(L.r) g.rotate(L.r*Math.PI/180); g.strokeStyle = 'rgba(176,92,255,0.95)'; g.lineWidth = Math.max(2, W*0.004); g.setLineDash([W*0.012, W*0.008]); g.strokeRect(-dw/2, -dh/2, dw, dh); g.restore(); }
  }
}
/* chroma key (green screen): pixels near the key colour become see-through, with a soft edge and the colour's spill
 * taken off the edges (a green rim turns neutral) */
function chromaKey(q, w, h, K){
  const im = q.getImageData(0, 0, w, h), d = im.data, [kr, kg, kb] = hexRgb(K.c).map(v => v*255), tol = 40 + (K.tol ?? 0.35)*180, soft = 40;
  const kmax = Math.max(kr, kg, kb), dom = kg === kmax ? 1 : kb === kmax ? 2 : 0;
  for(let i = 0; i < d.length; i += 4){
    const r = d[i], g = d[i+1], b = d[i+2], dist = Math.hypot(r - kr, g - kg, b - kb);
    if(dist < tol){ d[i+3] = 0; continue; }
    if(dist < tol + soft){ d[i+3] = Math.round(d[i+3]*(dist - tol)/soft);
      if(dom === 1 && g > Math.max(r, b)) d[i+1] = Math.max(r, b); else if(dom === 2 && b > Math.max(r, g)) d[i+2] = Math.max(r, g); }
  }
  q.putImageData(im, 0, 0);
}
// keep only the mask's shape (or cut it out, inverted); soft edges with a blur
function layerMask(q, L, w, h){
  const k = L.mk, f = Math.max(0, k.f)*Math.min(w, h)*0.5;
  q.globalCompositeOperation = k.inv && L.mask !== 'none' ? 'destination-out' : 'destination-in';
  q.filter = f > 0.5 ? 'blur(' + f.toFixed(1) + 'px)' : 'none'; q.fillStyle = '#000'; q.beginPath();
  const cx = w/2, cy = h/2;
  if(L.mask === 'circle') q.ellipse(cx, cy, Math.max(1, k.w*w/2 - f), Math.max(1, k.h*h/2 - f), k.a*Math.PI/180, 0, 2*Math.PI);
  else if(L.mask === 'rect'){ q.translate(cx, cy); q.rotate(k.a*Math.PI/180); const rw = k.w*w - 2*f, rh = k.h*h - 2*f; if(q.roundRect) q.roundRect(-rw/2, -rh/2, rw, rh, L.rad*Math.min(rw, rh)/2); else q.rect(-rw/2, -rh/2, rw, rh); }
  else if(L.mask === 'line'){ q.translate(cx, cy); q.rotate(k.a*Math.PI/180); const R = Math.hypot(w, h); q.rect(-R, -R, 2*R, R + (k.h - 0.5)*h); }
  else if(L.mask === 'mirror'){ q.translate(cx, cy); q.rotate(k.a*Math.PI/180); const R = Math.hypot(w, h), bh = k.h*h; q.rect(-R, -bh/2, 2*R, bh); }
  else { const r = L.rad*Math.min(w, h)/2; if(q.roundRect) q.roundRect(0, 0, w, h, r); else q.rect(0, 0, w, h); }   // rounded corners only
  q.fill(); q.filter = 'none';
}
// video layers follow the playhead: paused (seek and wait) or playing (kept in step)
async function prepLayers(t){
  const waits = [];
  for(const L of layers){ const M = lmedia[L.m]; if(!M || M.kind !== 'video') continue;
    if(!lyOn(L, t)){ M.el.pause(); continue; }
    M.el.pause(); const want = Math.min(M.dur - 0.05, lyTime(L, t));
    if(Math.abs(M.el.currentTime - want) > 0.04){ M.el.currentTime = want; waits.push(waitEv(M.el, 'seeked', 3000).catch(()=>{})); } }
  await Promise.all(waits);
}
function syncLayers(t){
  for(const L of layers){ const M = lmedia[L.m]; if(!M || M.kind !== 'video') continue;
    if(!lyOn(L, t)){ if(!M.el.paused) M.el.pause(); continue; }
    const want = lyTime(L, t); if(want >= M.dur - 0.05){ if(!M.el.paused) M.el.pause(); continue; }
    if(Math.abs(M.el.currentTime - want) > 0.25) M.el.currentTime = want;
    if(M.el.paused) M.el.play().catch(()=>{}); }
}
const stopLayers = () => lmedia.forEach(M => M.el && M.el.pause());
// layouts: one tap places the chosen layer
const LAYOUTS = { tl:{x:0.27,y:0.2,s:0.42}, tr:{x:0.73,y:0.2,s:0.42}, bl:{x:0.27,y:0.78,s:0.42}, br:{x:0.73,y:0.78,s:0.42}, top:'top', bottom:'bottom', left:'left', right:'right', full:'full' };
function layoutLayer(L, k){
  const M = lmedia[L.m], W = out.width, H = out.height, ar = M ? M.w/M.h : 1; L.r = 0;
  const P = LAYOUTS[k]; if(typeof P === 'object'){ Object.assign(L, P); L.crop = {l:0,t:0,r:0,b:0}; return; }
  // a half or the whole frame: cropped to fill it exactly
  const box = k === 'full' ? [0.5, 0.5, 1, 1] : k === 'top' ? [0.5, 0.25, 1, 0.5] : k === 'bottom' ? [0.5, 0.75, 1, 0.5] : k === 'left' ? [0.25, 0.5, 0.5, 1] : [0.75, 0.5, 0.5, 1];
  const want = box[2]*W/(box[3]*H);   // the box's own shape
  L.crop = {l:0,t:0,r:0,b:0}; if(ar > want){ const cut = (1 - want/ar)/2; L.crop.l = L.crop.r = cut; } else { const cut = (1 - ar/want)/2; L.crop.t = L.crop.b = cut; }
  L.x = box[0]; L.y = box[1]; L.s = box[2];
}
function lyUI(){
  const box = $('lylist'); if(!box) return; box.innerHTML = '';
  layers.forEach((L, i) => { const M = lmedia[L.m], b = document.createElement('button'); b.type = 'button'; b.className = 'lyitem'; b.setAttribute('aria-pressed', String(i === lySel));
    b.innerHTML = '<span class="ln"></span><span class="lt"></span>'; b.querySelector('.ln').textContent = (M ? (M.kind === 'photo' ? '🖼 ' : '🎬 ') + M.name.replace(/\.[^.]+$/, '') : 'Missing file');
    b.querySelector('.lt').textContent = fmt(L.t0).replace(/\.\d+$/, '') + '–' + fmt(L.t1).replace(/\.\d+$/, '');
    b.addEventListener('click', () => { lySel = i; lyUI(); pos = Math.max(pos, L.t0); if(!lyOn(L, pos)) pos = L.t0 + 0.05; prepare(segAt(pos), pos).then(() => prepLayers(pos)).then(redrawFrame); });
    box.appendChild(b); });
  const L = layers[lySel], ed = $('lyedit'); ed.hidden = !L; if(!L) return;
  if(!L.key) L.key = { on: false, c: '#00FF00', tol: 0.35 }; if(!L.blend) L.blend = 'source-over';
  const M = lmedia[L.m];
  for(const el of ed.querySelectorAll('[data-ly]')){ const k = el.dataset.ly, v = k.includes('.') ? L[k.split('.')[0]][k.split('.')[1]] : L[k];
    if(el.type === 'checkbox') el.checked = !!v; else el.value = v; const o = el.parentElement.querySelector('output'); if(o) o.textContent = lyFmt(k, +v); }
  [...$('lymask').children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.m === L.mask)));
  $('lymaskopts').hidden = L.mask === 'none'; $('lyvolrow').hidden = !M || M.kind !== 'video';
  $('lytime').textContent = fmt(L.t0) + ' – ' + fmt(L.t1);
}
const lyFmt = (k, v) => /^(x|y|s|op|crop|mk\.(w|h|f)|vol)/.test(k) ? Math.round(v*100) + '%' : /^(r|mk\.a)$/.test(k) ? Math.round(v) + '°' : /^(fin|fout|rad)$/.test(k) ? (k === 'rad' ? Math.round(v*100) + '%' : v.toFixed(1) + ' s') : String(v);
function lySet(k, v){ const L = layers[lySel]; if(!L) return;
  if(k.includes('.')){ const [a, b] = k.split('.'); L[a] = { ...L[a], [b]: v }; } else L[k] = v;
  if(k === 'vol') clipMixKey = '';
  if(!playing) redrawFrame(); }
$('lyadd').addEventListener('click', () => $('lyfile').click(), SIG);
$('lyfile').addEventListener('change', e => { const f = [...e.target.files]; e.target.value = ''; if(f.length) layerAdd(f); }, SIG);
$('lyedit').addEventListener('input', e => { const el = e.target, k = el.dataset && el.dataset.ly; if(!k) return; const v = el.type === 'checkbox' ? el.checked : el.tagName === 'SELECT' ? el.value : +el.value; lySet(k, v); const o = el.parentElement.querySelector('output'); if(o && el.type !== 'checkbox') o.textContent = lyFmt(k, v); }, SIG);
$('lyedit').addEventListener('click', e => { const t = e.target.closest('button'); if(!t) return; const L = layers[lySel]; if(!L) return;
  if(t.dataset.m){ L.mask = t.dataset.m; lyUI(); redrawFrame(); }
  else if(t.dataset.lay){ layoutLayer(L, t.dataset.lay); lyUI(); redrawFrame(); }
  else if(t.dataset.lyt === 'start'){ L.t0 = Math.min(pos, L.t1 - 0.3); lyUI(); redrawFrame(); }
  else if(t.dataset.lyt === 'end'){ L.t1 = Math.max(pos, L.t0 + 0.3); lyUI(); redrawFrame(); }
  else if(t.dataset.lyt === 'all'){ L.t0 = 0; L.t1 = buf.duration; lyUI(); redrawFrame(); }
  else if(t.dataset.lyf){ L[t.dataset.lyf] = !L[t.dataset.lyf]; redrawFrame(); }
  else if(t.dataset.lykey){ L.key = { ...(L.key || { tol: 0.35 }), on: true, c: t.dataset.lykey }; lyUI(); redrawFrame(); }
  else if(t.dataset.lydel){ layers.splice(lySel, 1); lySel = Math.min(lySel, layers.length - 1); clipMixKey = ''; lyUI(); redrawFrame(); }
}, SIG);
function wrapLines(g, text, maxW){ const words=text.split(/\s+/), lines=[]; let cur='';
  words.forEach(w=>{ const tryL = cur ? cur+' '+w : w; if(g.measureText(tryL).width > maxW && cur){ lines.push(cur); cur=w; } else cur=tryL; }); if(cur) lines.push(cur); return lines; }
/* ---- text: the hook word by word on the beats, captions of the song word by word ----
   Styles: pop (each word pops in on its beat / when it is sung), karaoke (the line is shown, the sung word lights up),
   box (words on coloured boxes), clean (calm, small). Everything stays inside Instagram's safe area (the top 220 px and
   the bottom 450 px of 1920 are its UI), captions move up when a face is in their way, and Hindi / Marathi (Devanagari)
   are drawn with a font that shapes them. Drawn into the frame itself, so the export has it too. */
let textStyle = 'pop', capsOn = false, capWords = null, capLines = null;
let ACCENT = '#FFD54A';   // the captions' highlight (a copied Reel can change it)
const isIndic = s2 => /[ऀ-෿]/.test(s2);
const fontFor = (txt, px, weight=800) => isIndic(txt) ? `${weight} ${px}px "Noto Sans Devanagari", "Nirmala UI", "Mangal", "Kohinoor Devanagari", sans-serif` : `${weight} ${px}px "Bricolage Grotesque", "Arial Black", system-ui, sans-serif`;
const shown = txt => isIndic(txt) ? txt : txt.toUpperCase();
// words laid out in lines centred on (W/2, cy): [{word, x, y, w}], wrapped to maxW
function layoutWords(g, words, fs, maxW, cy, lh){
  const rows = [[]]; let rw = 0; const sp = fs*0.3;
  words.forEach((w,i)=>{ g.font = fontFor(w.t, fs); const ww = g.measureText(shown(w.t)).width;
    if(rows[rows.length-1].length && rw + sp + ww > maxW){ rows.push([]); rw = 0; }
    rows[rows.length-1].push({...w, i, w: ww}); rw += (rows[rows.length-1].length > 1 ? sp : 0) + ww; });
  const W = out.width, outL = [];
  rows.forEach((r,k)=>{ const total = r.reduce((q,x)=>q+x.w,0) + sp*(r.length-1); let x = W/2 - total/2; const y = cy + (k-(rows.length-1)/2)*lh;
    r.forEach(x2=>{ outL.push({...x2, x: x + x2.w/2, y}); x += x2.w + sp; }); });
  return outL;
}
function drawWord(g, L, fs, style, state, a, sc){   // state: 0 not yet, 1 current, 2 done
  const txt = shown(L.t); g.save(); g.globalAlpha = a; g.translate(L.x, L.y); g.scale(sc, sc);
  g.font = fontFor(L.t, fs); g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  if(style === 'box'){
    const pw = L.w + fs*0.36, ph = fs*1.18, r = fs*0.18;
    g.fillStyle = state === 1 ? ACCENT : 'rgba(0,0,0,0.62)'; g.beginPath(); g.roundRect ? g.roundRect(-pw/2, -ph/2, pw, ph, r) : g.rect(-pw/2, -ph/2, pw, ph); g.fill();
    g.fillStyle = state === 1 ? '#111' : '#fff'; g.fillText(txt, 0, fs*0.03);
  } else if(style === 'clean'){
    g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = fs*0.25; g.fillStyle = state === 0 ? 'rgba(255,255,255,0.55)' : '#fff'; g.fillText(txt, 0, 0);
  } else {
    g.lineWidth = fs*0.14; g.strokeStyle = 'rgba(0,0,0,0.85)'; g.strokeText(txt, 0, 0);
    g.shadowColor = 'rgba(0,0,0,0.4)'; g.shadowBlur = fs*0.2;
    g.fillStyle = style === 'karaoke' ? (state === 1 ? ACCENT : state === 2 ? '#fff' : 'rgba(255,255,255,0.55)') : (state === 1 && style === 'pop' ? ACCENT : '#fff');
    g.fillText(txt, 0, 0);
  }
  g.restore();
}
// the hook: one word per beat from the start (first word at once), each pops in; the hook stays until a little after its
// last word and pulses on the beats while it is up
function drawHook(t){
  if(!hookText) return;
  const W=out.width, H=out.height, words = hookText.split(/\s+/).filter(Boolean).slice(0, 8);
  const bt = beats.filter(b=>b > 0.15).slice(0, words.length);
  const at = words.map((w,k)=> k === 0 ? 0.05 : (bt[k-1] ?? (0.05 + 0.35*k)));
  const T = Math.max(2.2, at[at.length-1] + 1.1); if(t > T && !coverMode) return;
  const outP = coverMode ? 0 : Math.max(0, (t-(T-0.25))/0.25);
  const fs = Math.round(Math.min(W,H*0.5625)*(textStyle === 'clean' ? 0.075 : 0.1)), cy = H*(H>W ? 0.27 : 0.3);
  const L = layoutWords(og, words.map((w,k)=>({t:w, at:at[k]})), fs, W*0.8, cy, fs*1.12);
  const pulse = beats.reduce((q,b)=> t >= b && t-b < 0.2 ? Math.max(q, 1 - (t-b)/0.2) : q, 0);
  L.forEach(w=>{ const since = coverMode ? 9 : t - w.at; if(since < 0) return;
    const pin = Math.min(1, since/0.18), sc = (textStyle === 'clean' ? 1 : 0.65 + 0.35*EASE.outBack(pin)) * (1 + 0.04*pulse), a = Math.min(1, since/0.08)*(1-outP);
    const cur = !coverMode && since < 0.45; drawWord(og, w, fs, textStyle, textStyle === 'karaoke' ? 2 : (cur ? 1 : 2), a, sc); });
}
// lines of the song's words: a new line at a pause, after 4 words, or when it gets long
function buildCapLines(words){
  const lines = []; let cur = [];
  const flush = () => { if(cur.length) lines.push(cur); cur = []; };
  words.forEach((w,i)=>{ const prev = cur[cur.length-1], chars = cur.reduce((q,x)=>q+x.text.length+1,0) + w.text.length;
    if(prev && (w.start - prev.end > 0.45 || cur.length >= 4 || chars > (isIndic(w.text) ? 20 : 24) || /[.,!?।]$/.test(prev.text))) flush();
    cur.push(w); });
  flush();
  return lines.map((ws,k)=>({ words: ws, a: ws[0].start - 0.12, b: ws[ws.length-1].end + 0.3 })).map((l,k,arr)=>({ ...l, b: arr[k+1] ? Math.min(l.b, arr[k+1].a - 0.02) : l.b }));
}
// where a face is on the screen at t (fraction of the height), if the shot follows one
function faceYOnScreen(t){
  if(!edit.length) return null;
  const e = edit[segAt(t)], src = sources[e.src]; if(!src || !src.faces) return null;
  const st = srcPos(e, Math.max(0, t - e.start)), near = src.faces.filter(f=>f.n && Math.abs(f.t - st) < 0.6);
  if(!near.length) return null;
  const f = near.reduce((q,x)=>Math.abs(x.t-st) < Math.abs(q.t-st) ? x : q, near[0]);
  const W=out.width, H=out.height, r = Math.max(W/src.w, H/src.h), dh = src.h*r, [, ccy] = camAt(e, t - e.start);
  let py = H/2 - ccy*dh; py = Math.min(0, Math.max(H-dh, py));
  return (py + f.fy*dh)/H;
}
function drawCaptions(t){
  if(!capsOn || !capLines) return;
  const line = capLines.find(l => t >= l.a && t < l.b); if(!line) return;
  const W=out.width, H=out.height, fs = Math.round(Math.min(W,H*0.5625)*(textStyle === 'clean' ? 0.06 : 0.072));
  const hookUp = hookText && t < 2.6, fy = faceYOnScreen(t);
  let cy = H*(H>W ? 0.70 : 0.78);                                                  // above Instagram's caption / username
  if(fy !== null && fy > 0.52 && fy < 0.86 && !hookUp) cy = H*(H>W ? 0.36 : 0.3);  // a face is there: move up
  const lineIn = Math.min(1, (t - line.a)/0.12), lineOut = Math.max(0, (t - (line.b - 0.15))/0.15), la = lineIn*(1-lineOut);
  const tr = trOf(line);
  if(tr && trOnly){   // only the translation: the whole line, as one block
    const TL = layoutWords(og, tr.split(/\s+/).filter(Boolean).map(x => ({t: x})), fs, W*0.8, cy, fs*1.25);
    TL.forEach(w => drawWord(og, w, fs, textStyle === 'karaoke' ? 'pop' : textStyle, 2, la, 1)); return;
  }
  const L = layoutWords(og, line.words.map(w=>({t: w.key && w.emoji ? w.text + ' ' + w.emoji : w.text, s:w.start, e:w.end, key: w.key})), fs, W*0.78, cy, fs*1.25);
  if(tr){   // both: the translation under the line, smaller and calm
    const fs2 = Math.round(fs*0.74), y0 = Math.max(...L.map(w => w.y)) + fs*0.62 + fs2*0.62, TL = layoutWords(og, tr.split(/\s+/).filter(Boolean).map(x => ({t: x})), fs2, W*0.84, 0, fs2*1.2);
    const top = Math.min(...TL.map(w => w.y)); TL.forEach(w => drawWord(og, { ...w, y: w.y - top + y0 }, fs2, 'clean', 2, la, 1));
  }
  L.forEach(w=>{
    const sung = t >= w.s, cur = sung && t < Math.max(w.e, w.s + 0.12), state = w.key && sung ? 1 : cur ? 1 : sung ? 2 : 0;
    let a = la, sc = w.key && sung ? 1.16 : 1;
    if(textStyle === 'pop'){ if(!sung) return; const since = t - w.s; a *= Math.min(1, since/0.06); sc = 0.7 + 0.3*EASE.outBack(Math.min(1, since/0.16)); }
    else if(textStyle === 'karaoke' && cur) sc = 1.08;
    drawWord(og, w, fs, textStyle, state, a, sc);
  });
}
function drawText(t){ drawHook(t); drawCaptions(t); drawOverlays(t); if((exporting || recording) && !wmOff) drawWatermark(); }   // both ways of exporting (WebCodecs, or in real time)
function drawWatermark(){
  if(!wmImg || !wmImg.complete || !wmImg.naturalWidth) return;
  const W = out.width, H = out.height, w = Math.round(Math.min(W, H*0.5625)*0.24), h = Math.round(w*wmImg.naturalHeight/wmImg.naturalWidth), m = Math.round(Math.min(W, H)*0.035);
  og.save(); og.globalAlpha = 0.85; og.drawImage(wmImg, W - w - m, H - h - m*1.6, w, h); og.restore();
}
/* ---- captions for talking: the key word of each line, highlighted, and a zoom punch on it ----
 * In talking videos and voiceovers one word per caption line is the key word: the one said hardest (its loudness against
 * the line's) that is not a small word, numbers and long words counting a little more. It is drawn in the accent colour,
 * bigger, with an emoji when one fits, and the picture punches in on it (8% over 0.12 s, eased back over 0.6 s). */
let keyOn = true;
const STOP = new Set('a an the and or but so to of in on at for with from by is are was were be been am i you he she it we they me my your our this that these those do does did not no yes just very really then than if as up out about into over also can will would there here what when how why who all any some more most much many one'.split(' ')
  .concat('है हैं था थी थे और या के की का को में से पर यह वह ये वो तो भी ही ना न हाँ आणि हे ते ती तो आहे आहेत होता होती चा ची चे ला ने मध्ये पण तर ही'.split(' ')));
const EMOJI = [[/money|paisa|rupee|₹|पैसा|पैसे|रुपये/i, '💰'], [/love|pyaar|प्यार|प्रेम/i, '❤️'], [/tip|idea|trick|hack|secret/i, '💡'], [/fire|hot|viral/i, '🔥'],
  [/fast|quick|speed|जल्दी|लवकर/i, '⚡'], [/food|eat|recipe|खाना|जेवण/i, '🍲'], [/win|best|top|great|amazing|बेस्ट/i, '🏆'], [/wrong|mistake|never|गलत|चूक/i, '❌'], [/right|correct|always|सही|बरोबर/i, '✅'],
  [/time|minute|second|समय|वेळ/i, '⏰'], [/hook|start|first/i, '👀'], [/short|small/i, '✂️'], [/caption|text|write/i, '✍️'], [/ganpati|bappa|गणपती|बाप्पा/i, '🌺'], [/diwali|दिवाळी|दीवाली|दिवाली/i, '🪔']];
function speakingVoice(){ if(kind === 'talk' && talk) return { x: talk.voice, sr: talk.sr }; if(vo) return { x: vo.pcm, sr: vo.sr }; return null; }
function markKeyWords(lines){
  const V = speakingVoice(); if(!lines) return;
  const loud = w => { if(!V) return 0; const a = Math.max(0, Math.floor(w.start*V.sr)), b = Math.min(V.x.length, Math.ceil(Math.max(w.end, w.start + 0.08)*V.sr)); let s2 = 0; for(let i=a;i<b;i+=4) s2 += V.x[i]*V.x[i]; return Math.sqrt(s2/Math.max(1, (b-a)/4)); };
  for(const L of lines){
    L.words.forEach(w => { w.key = false; w.emoji = ''; });
    if(!keyOn || !V) continue;
    const cands = L.words.map(w => { const t = String(w.text).replace(/[.,!?।"'“”]/g, ''), low = t.toLowerCase();
      if(!t || STOP.has(low) || (t.length < 3 && !/\d/.test(t))) return null;
      return { w, sc: loud(w)*(1 + 0.08*Math.min(8, [...t].length)) * (/\d|₹/.test(t) ? 1.4 : 1) }; }).filter(Boolean);
    if(!cands.length) continue;
    const top = cands.reduce((q, c) => c.sc > q.sc ? c : q, cands[0]);
    top.w.key = true; const em = EMOJI.find(([re]) => re.test(top.w.text)); top.w.emoji = em ? em[1] : '';
  }
}
// the zoom punch at time t: 1 when there is none
function emphAt(t){
  if(!keyOn || !capsOn || !capLines || !speakingVoice()) return 1;
  let z = 1;
  for(const L of capLines){ if(L.a > t + 0.01 || L.b < t - 1) continue; for(const w of L.words){ if(!w.key) continue; const d = t - w.start; if(d < 0 || d > 0.72) continue;
    z = Math.max(z, d < 0.12 ? 1 + 0.08*EASE.outCubic(d/0.12) : 1 + 0.08*(1 - EASE.inOut((d - 0.12)/0.6))); } }
  return z;
}
$('kwon').addEventListener('change', e => { keyOn = e.target.checked; markKeyWords(capLines); redraw(); }, SIG);
/* ---- translated captions: each caption line also in another language (or only in it) ----
 * The lines the phone already has go to the server once (one text call); each translated line is shown for the same
 * seconds as its original, under it and a little smaller, or alone. Lines already translated are kept (by their text), so
 * a new part of the song or a style change asks for nothing again. */
let trTo = '', trOnly = false, trBusy = false; const trCache = new Map();
const trOf = line => trTo ? trCache.get(trTo + '|' + line.words.map(w => w.text).join(' ')) : null;
async function translateSoon(){
  if(!trTo || !capLines || !capLines.length || trBusy) return;
  const need = capLines.map(l => l.words.map(w => w.text).join(' ')).filter((t, i, a) => t && a.indexOf(t) === i && !trCache.has(trTo + '|' + t)).slice(0, 120);
  if(!need.length){ redraw(); return; }
  trBusy = true; const to = trTo; capStat('Translating the captions…');
  try{
    const r = await fetch('/api/studio/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to, lines: need.map((text, i) => ({ i, text: text.slice(0, 160) })) }), signal: ac.signal });
    const res = await r.json().catch(() => ({}));
    if(!r.ok) throw new Error((res.error && res.error.message) || ('Translation failed (' + r.status + ').'));
    for(const l of res.lines || []) if(need[l.i] !== undefined) trCache.set(to + '|' + need[l.i], l.text);
    capStat((capWords ? capWords.length + ' words · ' : '') + 'translated');
  }catch(err){ if(!(err && err.name === 'AbortError')) { console.warn('translation failed:', err); capStat('Translation did not work this time. Please try again.', true); } }
  finally{ trBusy = false; if(trTo !== to) translateSoon(); redraw(); }
}
$('captr').addEventListener('change', e => { trTo = e.target.value; $('trwrap').hidden = !trTo; translateSoon(); redraw(); }, SIG);
$('tronly').addEventListener('change', e => { trOnly = e.target.checked; redraw(); }, SIG);

/* ---- text & stickers: anything the creator writes on the Reel ----
 * Each item: text or an emoji, a style (bold outline / box / neon / clean / tag), a colour, an entrance (pop / fade /
 * slide up / typewriter / none, with a short fade out), a time (from / to, or the whole Reel), a place (dragged on the
 * preview, kept inside Instagram's safe area) and a size. Drawn into the frame, so the export has them; Hindi and Marathi
 * are shaped by the Devanagari font stack. Ready-made: a price tag, a follow / save prompt, steps, before / after,
 * festival greetings. */
let overlays = [], ovSeq = 0, ovSel = -1;
const OV_COLORS = ['#FFFFFF', '#FFD54A', '#FF4D4D', '#3DDC84', '#4DA3FF', '#FF6FD8', '#111111'];
const OV_STYLES = { bold: 'Bold', box: 'Box', neon: 'Neon', clean: 'Clean', tag: 'Tag', outline: 'Outline only', shadow: 'Hard shadow', bubble: 'Speech bubble', glow: 'Soft glow', stack: 'Double outline' };
/* ---- fonts for texts: loaded from Google Fonts the first time one is picked (cached by the browser after that), so a
 * Reel looks the same in the preview and the export. Devanagari ones for Marathi / Hindi. ---- */
const OV_FONTS = {
  auto: ['Auto', ''], anton: ['Anton', 'Anton'], bebas: ['Bebas Neue', 'Bebas+Neue'], poppins: ['Poppins', 'Poppins:wght@600;800'],
  montserrat: ['Montserrat', 'Montserrat:wght@600;800'], oswald: ['Oswald', 'Oswald:wght@600'], bangers: ['Bangers', 'Bangers'],
  marker: ['Permanent Marker', 'Permanent+Marker'], pacifico: ['Pacifico', 'Pacifico'], lobster: ['Lobster', 'Lobster'],
  dancing: ['Dancing Script', 'Dancing+Script:wght@700'], caveat: ['Caveat', 'Caveat:wght@700'], playfair: ['Playfair Display', 'Playfair+Display:wght@700'],
  mukta: ['Mukta', 'Mukta:wght@600;800'], baloo: ['Baloo 2', 'Baloo+2:wght@600;800'], yatra: ['Yatra One', 'Yatra+One'], kalam: ['Kalam', 'Kalam:wght@700'], rozha: ['Rozha One', 'Rozha+One'],
};
const fontReady = new Set(), fontWait = new Map();
function loadFont(key){
  const f = OV_FONTS[key]; if(!f || !f[1] || fontReady.has(key)) return Promise.resolve();
  if(fontWait.has(key)) return fontWait.get(key);
  const pr = new Promise(res => {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=' + f[1] + '&display=block'; l.onerror = () => res(); document.head.appendChild(l);
    l.onload = () => Promise.all([document.fonts.load('800 40px "' + f[0] + '"'), document.fonts.load('800 40px "' + f[0] + '"', 'अ')]).catch(() => {}).then(() => { fontReady.add(key); res(); redrawSoon(); });
    setTimeout(res, 6000);
  });
  fontWait.set(key, pr); return pr;
}
function redrawSoon(){ clearTimeout(redrawSoon.h); redrawSoon.h = setTimeout(() => { if(!playing && edit.length) redraw(); }, 50); }
const ovFont = (ov, fs, weight) => { const f = OV_FONTS[ov.font]; if(!f || !f[1]) return fontFor(ov.text, fs, weight); loadFont(ov.font);
  return `${weight} ${fs}px "${f[0]}", ${isIndic(ov.text) ? '"Noto Sans Devanagari", ' : ''}"Arial Black", sans-serif`; };
const OV_ANIMS = { pop: 'Pop', fade: 'Fade', slide: 'Slide up', type: 'Typewriter', none: 'None' };
const OV_EMOJI = ['🔥','😂','😍','👇','👉','✅','❌','⭐','💯','🎉','❤️','👀','🙏','🪔','🌺','🎵','📍','💰','⚡','😱'];
const OV_PRESETS = {
  price:   { text: '₹999 only', style: 'tag', color: '#FFD54A', y: 0.62, size: 1 },
  follow:  { text: 'Follow for more 👉', style: 'box', color: '#FF4D4D', y: 0.66, size: 0.85, end: true },
  save:    { text: 'Save this for later 📌', style: 'box', color: '#4DA3FF', y: 0.66, size: 0.85, end: true },
  step1:   { text: 'Step 1', style: 'box', color: '#FFD54A', y: 0.2, size: 0.9 },
  before:  { text: 'BEFORE', style: 'box', color: '#111111', y: 0.2, size: 0.9 },
  after:   { text: 'AFTER', style: 'box', color: '#3DDC84', y: 0.2, size: 0.9 },
  ganpati: { text: 'गणपती बाप्पा मोरया 🌺', style: 'neon', color: '#FFD54A', y: 0.28, size: 1, all: true },
  diwali:  { text: 'शुभ दीपावली 🪔', style: 'neon', color: '#FFD54A', y: 0.28, size: 1, all: true },
  hdiwali: { text: 'Happy Diwali 🪔', style: 'neon', color: '#FFD54A', y: 0.28, size: 1, all: true },
};
const reelLen = () => (buf ? buf.duration : 0);
function addOverlay(o){
  const L = reelLen(), now = Math.max(0, Math.min(L - 0.5, (playing ? curTime() : pos) || 0));
  const t0 = o.all ? 0 : o.end ? Math.max(0, L - 3) : now, t1 = o.all ? L : o.end ? L : Math.min(L, t0 + 3);
  const ov = { id: ++ovSeq, text: o.text || '', emoji: !!o.emoji, style: o.style || 'bold', color: o.color || '#FFFFFF', anim: o.anim || (o.emoji ? 'pop' : 'pop'),
    t0, t1, x: o.x ?? 0.5, y: o.y ?? 0.4, size: o.size || 1, all: !!o.all };
  overlays.push(ov); ovSel = overlays.length - 1; renderOvList(); redraw();
  return ov;
}
function ovTiming(ov){ const L = reelLen(); return ov.all ? [0, L] : [Math.max(0, Math.min(ov.t0, L)), Math.max(0, Math.min(ov.t1, L))]; }
// one item at time t; its box is kept (fractions of the frame) for picking it on the preview
function drawOverlay(g, ov, t){
  const [a, b] = ovTiming(ov); if(!(t >= a && t < b)) return;
  const W = out.width, H = out.height, base = Math.min(W, H*0.5625), since = t - a, left = b - t;
  const fs = Math.round(base*(ov.emoji ? 0.16 : 0.075)*ov.size);
  let alpha = Math.min(1, left/0.15), sc = 1, dy = 0, txt = ov.emoji ? ov.text : (isIndic(ov.text) ? ov.text : ov.text);
  if(!coverMode){
    if(ov.anim === 'pop'){ const q = Math.min(1, since/0.22); sc = 0.6 + 0.4*EASE.outBack(q); alpha *= Math.min(1, since/0.08); }
    else if(ov.anim === 'fade') alpha *= Math.min(1, since/0.35);
    else if(ov.anim === 'slide'){ const q = Math.min(1, since/0.3); dy = (1 - EASE.outCubic(q))*fs*1.2; alpha *= q; }
    else if(ov.anim === 'type'){ const chars = [...txt]; txt = chars.slice(0, Math.max(1, Math.ceil(since/0.05))).join(''); }
    if(ov.emoji) sc *= 1 + 0.05*Math.sin(t*6);   // stickers breathe a little
  }
  const u = uAt(ov.uk, since);   // the creator's keyframes: moved, sized, turned, faded over its time
  if(u){ sc *= Math.max(0.01, u.s); alpha *= Math.max(0, Math.min(1, u.o)); }
  g.save(); g.globalAlpha = Math.max(0, alpha);
  g.font = ov.emoji ? `${fs}px "Apple Color Emoji","Noto Color Emoji","Segoe UI Emoji",sans-serif` : ovFont(ov, fs, ov.style === 'clean' ? 600 : 800);
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  const lines = ov.emoji ? [txt] : wrapLines(g, txt, W*0.82), lh = fs*1.18;
  const tw = Math.max(...lines.map(l => g.measureText(l).width), fs*0.6), th = lh*lines.length;
  // the place: inside the safe area (top 220 and bottom 450 of 1920 are Instagram's)
  const top = H*(220/1920) + th/2 + fs*0.3, bot = H*(1 - 450/1920) - th/2 - fs*0.3;
  let cx = Math.max(tw/2 + W*0.05, Math.min(W - tw/2 - W*0.05, ov.x*W)), cy = Math.max(top, Math.min(bot, ov.y*H)) + dy;
  if(u){ cx += u.x*W; cy += u.y*H; }
  if(ov.track && edit.length && !ov.emoji || ov.track && ov.emoji){   // follows the person / subject of the shot playing
    const e = edit[segAt(t)], lo = t - e.start, B = layerOf(e, lo, {noFx:true}), [ax, ay] = camAt(e, lo), [px, py, dw, dh] = B.rect;
    cx = Math.max(tw/2, Math.min(W - tw/2, px + ax*dw + (ov.x - 0.5)*W)); cy = Math.max(th/2, Math.min(H - th/2, py + ay*dh + (ov.y - 0.5)*H)) + dy; }
  const bs = u ? Math.max(0.2, u.s) : 1;
  ov.box = [(cx - (tw/2 + fs*0.4)*bs)/W, (cy - (th/2 + fs*0.3)*bs)/H, (tw + fs*0.8)*bs/W, (th + fs*0.6)*bs/H];
  g.translate(cx, cy); if(u && u.r) g.rotate(u.r*Math.PI/180); g.scale(sc, sc);
  const dark = c => { const n = parseInt(c.slice(1), 16); return ((n>>16)*0.299 + ((n>>8)&255)*0.587 + (n&255)*0.114) < 140; };
  if(!ov.emoji && (ov.style === 'box' || ov.style === 'tag')){
    const tag = ov.style === 'tag', pw = tw + fs*(tag ? 1.05 : 0.6), ph = th + fs*0.36, r = tag ? fs*0.5 : fs*0.2;
    g.fillStyle = ov.color; g.beginPath(); g.roundRect ? g.roundRect(-pw/2, -ph/2, pw, ph, r) : g.rect(-pw/2, -ph/2, pw, ph); g.fill();
    if(tag){ g.fillStyle = dark(ov.color) ? '#fff' : '#111'; g.beginPath(); g.arc(-pw/2 + fs*0.36, 0, fs*0.1, 0, Math.PI*2); g.fill(); g.translate(fs*0.24, 0); }   // the tag's hole, left of the text
    g.fillStyle = dark(ov.color) ? '#fff' : '#111';
    lines.forEach((l, k) => g.fillText(l, 0, (k - (lines.length-1)/2)*lh + fs*0.03));
  } else if(!ov.emoji && ov.style === 'neon'){
    g.shadowColor = ov.color; g.shadowBlur = fs*0.6; g.fillStyle = '#fff';
    lines.forEach((l, k) => { const y = (k - (lines.length-1)/2)*lh; g.fillText(l, 0, y); g.fillText(l, 0, y); });
    g.shadowBlur = 0; g.lineWidth = fs*0.04; g.strokeStyle = ov.color; lines.forEach((l, k) => g.strokeText(l, 0, (k - (lines.length-1)/2)*lh));
  } else if(!ov.emoji && ov.style === 'outline'){   // hollow letters
    g.lineWidth = fs*0.07; g.strokeStyle = ov.color; g.shadowColor = 'rgba(0,0,0,0.5)'; g.shadowBlur = fs*0.12;
    lines.forEach((l, k) => g.strokeText(l, 0, (k - (lines.length-1)/2)*lh));
  } else if(!ov.emoji && ov.style === 'shadow'){   // a hard, offset shadow in the contrasting colour
    const off = fs*0.09; g.fillStyle = dark(ov.color) ? '#fff' : '#111';
    lines.forEach((l, k) => g.fillText(l, off, (k - (lines.length-1)/2)*lh + off));
    g.fillStyle = ov.color; lines.forEach((l, k) => g.fillText(l, 0, (k - (lines.length-1)/2)*lh));
  } else if(!ov.emoji && ov.style === 'bubble'){   // a speech bubble with a tail
    const pw = tw + fs*0.9, ph = th + fs*0.6, r = fs*0.45;
    g.fillStyle = ov.color; g.beginPath(); g.roundRect ? g.roundRect(-pw/2, -ph/2, pw, ph, r) : g.rect(-pw/2, -ph/2, pw, ph); g.fill();
    g.beginPath(); g.moveTo(-pw*0.22, ph/2 - 2); g.lineTo(-pw*0.34, ph/2 + fs*0.5); g.lineTo(-pw*0.06, ph/2 - 2); g.closePath(); g.fill();
    g.fillStyle = dark(ov.color) ? '#fff' : '#111'; lines.forEach((l, k) => g.fillText(l, 0, (k - (lines.length-1)/2)*lh + fs*0.03));
  } else if(!ov.emoji && ov.style === 'glow'){   // white letters in a soft glow of the colour
    g.shadowColor = ov.color; g.shadowBlur = fs*0.9; g.fillStyle = ov.color; lines.forEach((l, k) => g.fillText(l, 0, (k - (lines.length-1)/2)*lh));
    g.shadowBlur = fs*0.3; g.fillStyle = '#fff'; lines.forEach((l, k) => g.fillText(l, 0, (k - (lines.length-1)/2)*lh));
  } else if(!ov.emoji && ov.style === 'stack'){   // two outlines: the colour, then black, around white letters
    g.lineWidth = fs*0.34; g.strokeStyle = '#111'; lines.forEach((l, k) => g.strokeText(l, 0, (k - (lines.length-1)/2)*lh));
    g.lineWidth = fs*0.18; g.strokeStyle = ov.color; lines.forEach((l, k) => g.strokeText(l, 0, (k - (lines.length-1)/2)*lh));
    g.fillStyle = '#fff'; lines.forEach((l, k) => g.fillText(l, 0, (k - (lines.length-1)/2)*lh));
  } else if(!ov.emoji && ov.style === 'clean'){
    g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = fs*0.25; g.fillStyle = ov.color;
    lines.forEach((l, k) => g.fillText(l, 0, (k - (lines.length-1)/2)*lh));
  } else {
    if(!ov.emoji){ g.lineWidth = fs*0.16; g.strokeStyle = dark(ov.color) ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.88)'; lines.forEach((l, k) => g.strokeText(l, 0, (k - (lines.length-1)/2)*lh)); }
    g.shadowColor = 'rgba(0,0,0,0.4)'; g.shadowBlur = fs*0.18; g.fillStyle = ov.color;
    lines.forEach((l, k) => g.fillText(l, 0, (k - (lines.length-1)/2)*lh));
  }
  g.restore();
  if(ovSel >= 0 && overlays[ovSel] === ov && !recording && !exporting && !coverMode){   // the one being edited: a dashed frame
    const [bx, by, bw, bh] = ov.box; g.save(); g.setLineDash([10, 8]); g.lineWidth = 3; g.strokeStyle = 'rgba(255,213,74,0.95)'; g.strokeRect(bx*W, by*H, bw*W, bh*H); g.restore(); }
}
function drawOverlays(t){ for(const ov of overlays) if(!ov.behind || !personMask || !bgMask) drawOverlay(og, ov, t); }
// the list under "Text & stickers": edit the words, style, colour, entrance, size, when it shows
function renderOvList(){
  const box = $('ovlist'); box.innerHTML = '';
  overlays.forEach((ov, i) => {
    const row = document.createElement('div'); row.className = 'ov' + (i === ovSel ? ' sel' : '');
    const [a, b] = ovTiming(ov);
    row.innerHTML = `<div class="ovtop"><input class="ovt" maxlength="80" aria-label="Text"><button class="ovdel" title="Remove" aria-label="Remove">×</button></div>
      <div class="ovctl"><select class="ovs" aria-label="Style"></select><select class="ovf" aria-label="Font"></select><select class="ova" aria-label="Entrance"></select><span class="ovc"></span>
      <label class="ovsz">Size <input type="range" min="0.5" max="2.2" step="0.05" aria-label="Size"></label></div>
      <div class="ovctl"><span class="fname ovtm"></span><button class="btn mini ovfrom">Start here</button><button class="btn mini ovto">End here</button><label class="tog"><input type="checkbox" class="ovall"> Whole Reel</label><label class="tog"><input type="checkbox" class="ovtrk"> Follow the person</label><label class="tog"><input type="checkbox" class="ovbeh"> Behind the person</label></div>`;
    const tk = row.querySelector('.ovtrk'); tk.checked = !!ov.track; tk.addEventListener('change', () => { ov.track = tk.checked; if(tk.checked){ ov.x = 0.5; ov.y = ov.emoji ? 0.38 : 0.32; } redraw(); });
    const ti = row.querySelector('.ovt'); ti.value = ov.text; if(ov.emoji){ ti.readOnly = true; ti.classList.add('emoji'); }
    ti.addEventListener('input', () => { ov.text = ti.value; redraw(); });
    const ss = row.querySelector('.ovs'), sa = row.querySelector('.ova');
    if(ov.emoji) ss.hidden = true;
    Object.entries(OV_STYLES).forEach(([k, v]) => ss.add(new Option(v, k, false, k === ov.style)));
    Object.entries(OV_ANIMS).forEach(([k, v]) => sa.add(new Option(v, k, false, k === ov.anim)));
    ss.addEventListener('change', () => { ov.style = ss.value; redraw(); }); sa.addEventListener('change', () => { ov.anim = sa.value; redraw(); });
    const sf = row.querySelector('.ovf'); if(ov.emoji) sf.hidden = true;
    Object.entries(OV_FONTS).forEach(([k, v]) => sf.add(new Option(v[0], k, false, k === (ov.font || 'auto'))));
    sf.addEventListener('change', () => { ov.font = sf.value === 'auto' ? undefined : sf.value; loadFont(sf.value).then(redraw); redraw(); });
    const cs = row.querySelector('.ovc'); if(ov.emoji) cs.hidden = true;
    OV_COLORS.forEach(c => { const b2 = document.createElement('button'); b2.className = 'sw' + (c === ov.color ? ' on' : ''); b2.style.background = c; b2.title = c; b2.setAttribute('aria-label', 'Colour ' + c);
      b2.addEventListener('click', () => { ov.color = c; [...cs.children].forEach(x => x.classList.toggle('on', x === b2)); redraw(); }); cs.appendChild(b2); });
    const sz = row.querySelector('.ovsz input'); sz.value = ov.size; sz.addEventListener('input', () => { ov.size = +sz.value; redraw(); });
    const tm = row.querySelector('.ovtm'), showT = () => { const [x, y] = ovTiming(ov); tm.textContent = ov.all ? 'whole Reel' : fmt(x) + ' → ' + fmt(y); };
    showT();
    const now = () => Math.max(0, Math.min(reelLen(), playing ? curTime() : pos || 0));
    row.querySelector('.ovfrom').addEventListener('click', () => { ov.all = false; ov.t0 = now(); if(ov.t1 <= ov.t0 + 0.3) ov.t1 = Math.min(reelLen(), ov.t0 + 3); row.querySelector('.ovall').checked = false; showT(); redraw(); });
    row.querySelector('.ovto').addEventListener('click', () => { ov.all = false; ov.t1 = Math.max(now(), ov.t0 + 0.3); row.querySelector('.ovall').checked = false; showT(); redraw(); });
    const bh = row.querySelector('.ovbeh'); bh.checked = !!ov.behind; bh.addEventListener('change', () => { ov.behind = bh.checked; if(bh.checked && !personMask) $('bgstat').textContent = 'Text behind the person needs the background tools'; bgMask = null; bgFrame = -1; redrawFrame(); });
    const al = row.querySelector('.ovall'); al.checked = ov.all; al.addEventListener('change', () => { ov.all = al.checked; showT(); redraw(); });
    row.querySelector('.ovdel').addEventListener('click', () => { overlays.splice(i, 1); ovSel = -1; renderOvList(); redraw(); });
    row.addEventListener('focusin', () => { if(ovSel !== i){ ovSel = i; [...box.children].forEach((r, k) => r.classList.toggle('sel', k === i)); redraw(); } });
    box.appendChild(row);
  });
  $('ovhint').hidden = !overlays.length; out.classList.toggle('ovdrag', overlays.length > 0 || kfOpen());
  if(typeof kfSync === 'function') kfSync();   // drag texts; otherwise the page scrolls over the preview
}
$('ovtext').addEventListener('click', () => { const ov = addOverlay({ text: 'Your text', style: 'bold', color: '#FFFFFF', y: 0.4 }); const inp = $('ovlist').lastElementChild.querySelector('.ovt'); inp.focus(); inp.select(); }, SIG);
$('ovsticker').addEventListener('click', () => { $('emojis').hidden = !$('emojis').hidden; }, SIG);
OV_EMOJI.forEach(em => { const b = document.createElement('button'); b.textContent = em; b.className = 'em'; b.setAttribute('aria-label', 'Sticker ' + em);
  b.addEventListener('click', () => { addOverlay({ text: em, emoji: true, y: 0.5, x: 0.72, size: 1 }); $('emojis').hidden = true; }); $('emojis').appendChild(b); });
$('ovpreset').addEventListener('change', e => { const p = OV_PRESETS[e.target.value]; e.target.value = ''; if(p) addOverlay(p); }, SIG);
// drag on the preview: the item under the finger moves with it (a tap selects it)
{ let drag = null;
  const at = ev => { const r = out.getBoundingClientRect(); return [(ev.clientX - r.left)/r.width, (ev.clientY - r.top)/r.height]; };
  out.addEventListener('pointerdown', ev => {
    if(recording) return;
    const [x, y] = at(ev), t = playing ? curTime() : pos || 0;
    for(let i = overlays.length - 1; i >= 0; i--){ const ov = overlays[i], [a, b] = ovTiming(ov); if(!ov.box || !(t >= a && t < b)) continue;
      const [bx, by, bw, bh] = ov.box; if(x >= bx && x <= bx + bw && y >= by && y <= by + bh){
        drag = { i, dx: x - ov.x, dy: y - ov.y }; ovSel = i; out.setPointerCapture(ev.pointerId); renderOvList(); ev.preventDefault(); redraw(); return; } }
    if(ovSel >= 0){ ovSel = -1; renderOvList(); redraw(); }
    if(kfOpen() && edit.length){   // the keyframe panel is open: dragging the picture moves the shot (a keyframe at the playhead)
      if(playing){ pos = curTime(); stopAll(); }
      const T = kfTarget(), u = T && (uAt(T.obj.uk, kfLocal(T)) || UK0);
      if(T){ drag = { shot: true, x0: x, y0: y, ux: u.x, uy: u.y }; out.setPointerCapture(ev.pointerId); ev.preventDefault(); kfSync(); }
    }
  }, SIG);
  out.addEventListener('pointermove', ev => { if(!drag) return; const [x, y] = at(ev);
    if(drag.shot){ kfSet({ x: drag.ux + x - drag.x0, y: drag.uy + y - drag.y0 }); return; }
    const ov = overlays[drag.i]; if(!ov) return;
    ov.x = Math.max(0.05, Math.min(0.95, x - drag.dx)); ov.y = Math.max(0.05, Math.min(0.95, y - drag.dy)); redraw(); }, SIG);
  const end = () => { drag = null; };
  out.addEventListener('pointerup', end, SIG); out.addEventListener('pointercancel', end, SIG); }

/* ---- ◆ Keyframes: the creator animates a shot or a text: position, zoom, rotation, opacity, with an ease ----
 * The target is the selected text / sticker, else the shot under the playhead. Moving a slider (or dragging the picture)
 * writes a keyframe at the playhead, as in the big editors: on a keyframe it changes it, between keyframes it adds one
 * holding the in-between values. The shot or text moves from keyframe to keyframe; each keyframe's ease shapes the move
 * into it. Ready-made moves fill the keyframes in one tap. Saved with the Reel. */
let talkKfs = null, kfTimer = 0, kfLast = 0;
const KF_NEAR = 0.04;
const KF_SL = { x: { min: -1, max: 1, step: 0.005, show: v => Math.round(v*100) + '%' }, y: { min: -1, max: 1, step: 0.005, show: v => Math.round(v*100) + '%' },
  s: { min: 0.1, max: 4, step: 0.01, show: v => v.toFixed(2) + '×' }, r: { min: -360, max: 360, step: 1, show: v => Math.round(v) + '°' }, o: { min: 0, max: 1, step: 0.01, show: v => Math.round(v*100) + '%' } };
const KF_NAME = { x: 'Move ↔', y: 'Move ↕', s: 'Zoom', r: 'Rotate', o: 'Opacity' };
const KF_EASE = { inOut: 'Smooth', lin: 'Linear', outCubic: 'Ease out', inQuad: 'Ease in', outBack: 'Overshoot', outExpo: 'Fast stop', hold: 'Hold (jump)' };
const kq = (t, v = {}, ez) => ({ ...UK0, ...v, t, ...(ez ? { ez } : {}) });
const KF_PRESETS = {
  zoomin: { name: 'Slow zoom in', make: d => [kq(0), kq(d, { s: 1.3 }, 'lin')] },
  zoomout: { name: 'Slow zoom out', make: d => [kq(0, { s: 1.3 }), kq(d, {}, 'outCubic')] },
  panlr: { name: 'Pan left → right', make: d => [kq(0, { s: 1.3, x: 0.1 }), kq(d, { s: 1.3, x: -0.1 }, 'inOut')] },
  panud: { name: 'Pan up', make: d => [kq(0, { s: 1.3, y: -0.08 }), kq(d, { s: 1.3, y: 0.08 }, 'inOut')] },
  punch: { name: 'Zoom punch', make: d => [kq(0, { s: 1.3 }), kq(Math.min(0.3, d), {}, 'outBack')] },
  popin: { name: 'Pop in', make: d => [kq(0, { s: 0.2, o: 0 }), kq(Math.min(0.35, d), {}, 'outBack')] },
  spinin: { name: 'Spin in', make: d => [kq(0, { s: 0.3, r: -180, o: 0 }), kq(Math.min(0.5, d), {}, 'outCubic')] },
  slidein: { name: 'Slide in from left', make: d => [kq(0, { x: -1 }), kq(Math.min(0.4, d), {}, 'outExpo')] },
  rise: { name: 'Rise in', make: d => [kq(0, { y: 0.12, o: 0 }), kq(Math.min(0.4, d), {}, 'outCubic')] },
  fade: { name: 'Fade in + out', make: d => { const f = Math.min(0.3, d/3); return [kq(0, { o: 0 }), kq(f, {}, 'inOut'), kq(d - f), kq(d, { o: 0 }, 'inOut')]; } },
  tilt: { name: 'Tilt + zoom', make: d => [kq(0, { s: 1.15, r: -6 }), kq(d, { s: 1.15, r: 6 }, 'inOut')] },
};
function kfOpen(){ const b = $('kfbox'); return !!(b && b.open); }
function kfNow(){ return Math.max(0, playing ? curTime() : pos || 0); }
function kfTarget(){
  if(!edit.length) return null;
  if(ovSel >= 0 && overlays[ovSel]){ const ov = overlays[ovSel], [a, b] = ovTiming(ov);
    return { what: 'text', obj: ov, a, b: Math.max(a + 0.05, b), name: ov.emoji ? 'Sticker ' + ov.text : 'Text “' + (ov.text.length > 22 ? ov.text.slice(0, 21) + '…' : ov.text) + '”' }; }
  const i = segAt(kfNow()), e = edit[i];
  return { what: 'shot', obj: e, i, a: e.start, b: e.end, name: 'Shot ' + (i + 1) + ' · ' + sources[e.src].name.replace(/\.[^.]+$/, '') };
}
function kfLocal(T){ return Math.max(0, Math.min(T.b - T.a - 0.01, kfNow() - T.a)); }
function kfAtHead(T){ const l = kfLocal(T); return (T.obj.uk || []).find(q => Math.abs(q.t - l) < KF_NEAR) || null; }
function kfSeek(t){
  if(playing){ stopAll(); }
  pos = Math.max(0, Math.min(buf.duration - 0.01, t)); const i = segAt(pos); kfSync();   // the panel follows at once, the picture once decoded
  return Promise.all([edit[i-1] ? prepare(i-1, edit[i-1].end - 0.01) : 0, prepare(i, pos)]).then(() => { drawFrame(pos); drawTimeline(); kfSync(); });
}
// write values at the playhead: change the keyframe there, or add one holding the in-between values
function kfSet(vals){
  const T = kfTarget(); if(!T) return;
  if(playing){ pos = curTime(); stopAll(); }
  const L = T.obj.uk || (T.obj.uk = []), l = kfLocal(T);
  let k = kfAtHead(T);
  if(!k){ const u = uAt(L, l) || UK0; k = { x: u.x, y: u.y, s: u.s, r: u.r, o: u.o, t: l, ez: 'inOut' }; L.push(k); L.sort((p, q) => p.t - q.t); }
  for(const [n, v] of Object.entries(vals)){ const c = KF_SL[n]; k[n] = Math.max(c.min, Math.min(c.max, v)); }
  redraw(); kfSync(); kfListSoon();
}
let kfListT = 0; function kfListSoon(){ clearTimeout(kfListT); kfListT = setTimeout(() => { if(!playing) renderEDL(true); }, 400); }
function kfSoon(){ const now = performance.now(); if(now - kfLast > 120){ kfLast = now; kfSync(); } else if(!kfTimer) kfTimer = setTimeout(() => { kfTimer = 0; kfLast = performance.now(); kfSync(); }, 130); }
function kfSync(){
  if(!kfOpen()) return;
  const T = kfTarget(), box = $('kfbox');
  box.classList.toggle('none', !T);
  if(!T){ $('kftarget').textContent = 'Make the edit first'; return; }
  $('kftarget').textContent = T.name + ' · ' + fmt(T.a) + ' → ' + fmt(T.b);
  const L = T.obj.uk || [], l = kfLocal(T), u = uAt(L, l) || UK0, k = kfAtHead(T);
  for(const n of UK_PROPS){ const inp = $('kf_' + n); if(document.activeElement !== inp) inp.value = u[n]; $('kfv_' + n).textContent = KF_SL[n].show(u[n]); }
  $('kfadd').textContent = k ? '◆ On a keyframe' : '◇ Add keyframe'; $('kfadd').classList.toggle('on', !!k);
  $('kfdel').disabled = !k; $('kfease').disabled = !k || L.indexOf(k) === 0; $('kfease').value = k ? (k.ez || 'inOut') : 'inOut';
  $('kfprev').disabled = !L.some(q => q.t < l - KF_NEAR); $('kfnext').disabled = !L.some(q => q.t > l + KF_NEAR); $('kfclear').disabled = !L.length;
  $('kfinfo').textContent = !L.length ? 'No keyframes: move a slider (or drag the picture) to add one here.'
    : L.length === 1 ? '1 keyframe: a fixed setting. Move the playhead and change something to animate.' : L.length + ' keyframes';
  // the strip: the target's time, its keyframes (◆) and the playhead
  const cv = $('kftl'), dpr = window.devicePixelRatio || 1, w = Math.max(1, Math.round(cv.clientWidth*dpr)), h = Math.round(34*dpr), D = T.b - T.a;
  cv.width = w; cv.height = h; const g = cv.getContext('2d'); g.clearRect(0, 0, w, h);
  g.fillStyle = css('--line') || '#333'; g.fillRect(0, h/2 - 3*dpr, w, 6*dpr);
  for(let k2 = 1; k2 < L.length; k2++){ const x0 = L[k2-1].t/D*w, x1 = L[k2].t/D*w; g.fillStyle = 'rgba(255,213,74,0.55)'; g.fillRect(x0, h/2 - 3*dpr, x1 - x0, 6*dpr); }
  const ph = l/D*w;
  for(const q of L){ const x = Math.min(w - 7*dpr, Math.max(7*dpr, q.t/D*w)), r = 7*dpr; g.beginPath(); g.moveTo(x, h/2 - r); g.lineTo(x + r, h/2); g.lineTo(x, h/2 + r); g.lineTo(x - r, h/2); g.closePath();
    g.fillStyle = q === k ? '#FFD54A' : '#fff'; g.fill(); g.lineWidth = 1.5*dpr; g.strokeStyle = '#000'; g.stroke(); }
  g.fillStyle = css('--hot') || '#ff3d6e'; g.fillRect(Math.round(ph) - dpr, 0, 2*dpr, h);
}
for(const n of UK_PROPS){ const c = KF_SL[n], row = document.createElement('label'); row.className = 'kfsl';
  row.innerHTML = `<span>${KF_NAME[n]}</span><input type="range" id="kf_${n}" min="${c.min}" max="${c.max}" step="${c.step}" aria-label="${KF_NAME[n]}"><b id="kfv_${n}"></b>`;
  row.querySelector('input').addEventListener('input', ev => kfSet({ [n]: +ev.target.value }), SIG);
  row.querySelector('input').addEventListener('dblclick', () => kfSet({ [n]: UK0[n] }), SIG);   // double-tap: back to normal
  $('kfsliders').appendChild(row); }
Object.entries(KF_EASE).forEach(([k, v]) => $('kfease').add(new Option(v, k)));
Object.entries(KF_PRESETS).forEach(([k, v]) => $('kfpreset').add(new Option(v.name, k)));
$('kfbox').addEventListener('toggle', () => { out.classList.toggle('ovdrag', overlays.length > 0 || kfOpen()); kfSync(); }, SIG);
$('kfadd').addEventListener('click', () => { const T = kfTarget(); if(T && !kfAtHead(T)) kfSet({}); }, SIG);
$('kfdel').addEventListener('click', () => { const T = kfTarget(), k = T && kfAtHead(T); if(!k) return; T.obj.uk.splice(T.obj.uk.indexOf(k), 1); if(!T.obj.uk.length) delete T.obj.uk; redraw(); kfSync(); kfListSoon(); }, SIG);
$('kfclear').addEventListener('click', () => { const T = kfTarget(); if(T){ delete T.obj.uk; redraw(); kfSync(); kfListSoon(); } }, SIG);
$('kfease').addEventListener('change', ev => { const T = kfTarget(), k = T && kfAtHead(T); if(k){ k.ez = ev.target.value; redraw(); kfSync(); } }, SIG);
$('kfprev').addEventListener('click', () => { const T = kfTarget(); if(!T) return; const l = kfLocal(T), q = (T.obj.uk || []).filter(x => x.t < l - KF_NEAR).pop(); if(q) kfSeek(T.a + q.t); }, SIG);
$('kfnext').addEventListener('click', () => { const T = kfTarget(); if(!T) return; const l = kfLocal(T), q = (T.obj.uk || []).find(x => x.t > l + KF_NEAR); if(q) kfSeek(T.a + q.t); }, SIG);
$('kfpreset').addEventListener('change', ev => { const p = KF_PRESETS[ev.target.value]; ev.target.value = ''; const T = kfTarget(); if(!p || !T) return;
  T.obj.uk = p.make(Math.max(0.05, T.b - T.a - 0.01)); kfSeek(T.a + 0.001); kfListSoon(); }, SIG);
// the strip: tap to move the playhead inside the shot or text (a tap near a keyframe lands on it)
$('kftl').addEventListener('pointerdown', ev => { const T = kfTarget(); if(!T) return; const r = $('kftl').getBoundingClientRect(), D = T.b - T.a;
  let l = Math.max(0, Math.min(1, (ev.clientX - r.left)/r.width))*D;
  const near = (T.obj.uk || []).find(q => Math.abs(q.t - l)/D*r.width < 12); if(near) l = near.t;
  kfSeek(T.a + Math.min(l, D - 0.01)); }, SIG);

/* ---- the background behind the person: blurred, a colour, a photo; and text behind the person ----
 * The person is found in every frame (MediaPipe Selfie Segmentation in a worker) on the finished picture, just before the
 * text: the frame fitted into 256x256 (letterboxed), a soft mask back at full size; the person is drawn over the new
 * background, and texts marked "behind the person" go between the two. The preview uses the mask of the frame before
 * (it arrives a few ms later; when paused the frame is drawn again with its own), the export waits for each frame's own. */
let bgMode = 'none', bgColor = '#1DB954', bgImg = null, bgFile = null, bgMask = null, bgBusy = false, bgErr = '', bgFrame = -1;
const segC = Object.assign(document.createElement('canvas'), {width:256, height:256}), segG = segC.getContext('2d', {willReadFrequently:true});
const mC = Object.assign(document.createElement('canvas'), {width:256, height:256}), mG = mC.getContext('2d');
let rawC = null, rawG = null, perC = null, perG = null;
const bgNeeded = () => bgMode !== 'none' || overlays.some(o => o.behind);
function segRegion(){ const W = out.width, H = out.height, k = 256/Math.max(W, H); return [W*k, H*k, (256 - W*k)/2, (256 - H*k)/2]; }
// the finished frame (before text) into the 256x256 letterbox, as RGBA
function segInput(){ const [w, h, ox, oy] = segRegion(); segG.fillStyle = '#000'; segG.fillRect(0,0,256,256); segG.drawImage(out, ox, oy, w, h); return segG.getImageData(0,0,256,256).data; }
function setMask(m){ const id = mG.createImageData(256, 256); for(let i=0;i<65536;i++){ const a = Math.max(0, Math.min(1, (m[i] - 0.25)/0.5)); id.data[i*4+3] = Math.round(a*255); } mG.putImageData(id, 0, 0); bgMask = true; }
async function maskNow(){   // export: this frame's own mask
  if(!personMask || bgErr) return;
  try{ setMask(await personMask(segInput())); }catch(err){ bgErr = String(err && err.message || err); bgStat(); }
}
function maskSoon(t){   // preview: ask for the next one, use it when it comes (paused: once per frame, then drawn again)
  const key = playing ? -1 : Math.round(t*1000);
  if(!personMask || bgBusy || bgErr || (key >= 0 && key === bgFrame)) return;
  bgBusy = true; const data = segInput();
  personMask(data).then(m => { setMask(m); bgBusy = false; bgFrame = key; if(!playing && key >= 0) redrawFrame(); }, err => { bgBusy = false; bgErr = String(err && err.message || err); bgStat(); });
}
const redrawFrame = () => { if(!playing && edit.length) drawFrame(pos || 0.3); };
function bgStat(){ $('bgstat').textContent = bgErr ? 'Background effects do not work on this phone.' : (bgMode === 'photo' && !bgImg ? 'Choose a photo' : ''); }
function bgPass(t){
  if(!bgNeeded() || !personMask) return;
  if(!exporting) maskSoon(t);
  if(!bgMask) return;
  const W = out.width, H = out.height;
  if(!rawC || rawC.width !== W || rawC.height !== H){ rawC = Object.assign(document.createElement('canvas'), {width:W, height:H}); rawG = rawC.getContext('2d'); perC = Object.assign(document.createElement('canvas'), {width:W, height:H}); perG = perC.getContext('2d'); }
  rawG.globalCompositeOperation = 'copy'; rawG.drawImage(out, 0, 0); rawG.globalCompositeOperation = 'source-over';
  // the person: the frame where the mask is (the mask's letterboxed part stretched back over the frame)
  const [w, h, ox, oy] = segRegion();
  perG.globalCompositeOperation = 'copy'; perG.drawImage(mC, ox, oy, w, h, 0, 0, W, H);
  perG.globalCompositeOperation = 'source-in'; perG.drawImage(rawC, 0, 0); perG.globalCompositeOperation = 'source-over';
  // the background
  og.save();
  if(bgMode === 'blur'){ og.filter = `blur(${Math.round(Math.max(W, H)/90)}px)`; og.drawImage(rawC, -W*0.03, -H*0.03, W*1.06, H*1.06); og.filter = 'none'; }
  else if(bgMode === 'color'){ og.fillStyle = bgColor; og.fillRect(0, 0, W, H); }
  else if(bgMode === 'photo' && bgImg){ const r = Math.max(W/bgImg.width, H/bgImg.height); og.drawImage(bgImg, (W - bgImg.width*r)/2, (H - bgImg.height*r)/2, bgImg.width*r, bgImg.height*r); }
  og.restore();
  for(const ov of overlays) if(ov.behind) drawOverlay(og, ov, t);   // text behind the person
  og.drawImage(perC, 0, 0);
}
$('bgmode').addEventListener('click', e => { const b = e.target.closest('button'); if(!b || recording) return; bgMode = b.dataset.b;
  [...$('bgmode').children].forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  $('bgrow').hidden = bgMode !== 'color' && bgMode !== 'photo'; $('bgcolors').hidden = bgMode !== 'color'; $('bgpick').hidden = bgMode !== 'photo';
  if(!personMask && bgMode !== 'none') bgErr = 'not built in'; bgStat(); bgMask = null; bgFrame = -1; redrawFrame(); }, SIG);
['#1DB954','#FFFFFF','#111111','#FFD54A','#FF6FD8','#4DA3FF'].forEach(c => { const b = document.createElement('button'); b.className = 'sw' + (c === bgColor ? ' on' : ''); b.style.background = c; b.setAttribute('aria-label', 'Background ' + c);
  b.addEventListener('click', () => { bgColor = c; [...$('bgcolors').children].forEach(x => x.classList.toggle('on', x === b)); redrawFrame(); }); $('bgcolors').appendChild(b); });
$('bgpick').addEventListener('click', () => $('bgfile').click(), SIG);
$('bgfile').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if(!f) return;
  bgFile = f; const im = new Image(); im.onload = () => { bgImg = im; bgStat(); redrawFrame(); }; im.onerror = () => { $('bgstat').textContent = 'This photo cannot be read here.'; }; im.src = URL.createObjectURL(f); }, SIG);
// the song as speech recognition wants it: 16 kHz mono, the vocal band (drums and bass mostly out), normalised, as WAV
async function songWav(src = mono, sr = buf.sampleRate, from = 0){
  const a = Math.round(from*sr), len = Math.min(src.length - a, Math.round(180*sr)), n16 = Math.max(1, Math.ceil(len*16000/sr));
  const oc = new OfflineAudioContext(1, n16, 16000), b = oc.createBuffer(1, len, sr); b.copyToChannel(src.slice(a, a + len), 0);
  const s2 = oc.createBufferSource(); s2.buffer = b;
  const hp = oc.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 150;
  const lp = oc.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4200;
  s2.connect(hp); hp.connect(lp); lp.connect(oc.destination); s2.start();
  const y = (await oc.startRendering()).getChannelData(0); let pk = 0; for(let i=0;i<y.length;i++) if(Math.abs(y[i]) > pk) pk = Math.abs(y[i]);
  const gain = pk > 0 ? 0.9/pk : 1, dv = new DataView(new ArrayBuffer(44 + y.length*2)), str = (o, x) => { for(let i=0;i<x.length;i++) dv.setUint8(o+i, x.charCodeAt(i)); };
  str(0,'RIFF'); dv.setUint32(4, 36 + y.length*2, true); str(8,'WAVE'); str(12,'fmt '); dv.setUint32(16,16,true); dv.setUint16(20,1,true); dv.setUint16(22,1,true);
  dv.setUint32(24,16000,true); dv.setUint32(28,32000,true); dv.setUint16(32,2,true); dv.setUint16(34,16,true); str(36,'data'); dv.setUint32(40, y.length*2, true);
  for(let i=0;i<y.length;i++) dv.setInt16(44 + i*2, Math.max(-32768, Math.min(32767, Math.round(y[i]*gain*32767))), true);
  return dv.buffer;
}
const capCache = new Map(); let musicKey = '', capAll = null;
// The words are transcribed once for the whole song (up to 3 minutes, from where the part starts if it starts later)
// and the part's words are taken from them: changing the part costs nothing and the words keep their sung timing.
function shiftCaptions(){
  if(!capAll) return;
  const a = (vo && kind !== 'talk') ? 0 : secStart - capAll.from, L = buf.duration;
  capWords = capAll.words.filter(w => w.end > a + 0.05 && w.start < a + L - 0.05).map(w => ({ ...w, start: Math.max(0, w.start - a), end: Math.min(L, w.end - a) }));
  capLines = buildCapLines(capWords); markKeyWords(capLines); redraw(); if(trTo) translateSoon();
}
function capStat(t, err){ const el = $('capstat'); el.textContent = t || '';
  if(!t) tasks.clear('caps'); else if(/…$/.test(t)) tasks.start('caps', 'voice', 'Captions', t.replace(/…$/, '')); else if(err) tasks.fail('caps', t); else if(tasks.has('caps')) tasks.done('caps', t); el.style.color = err ? 'var(--drop)' : ''; }
async function loadCaptions(){
  if(!capsOn || !buf) return;
  const tk = kind === 'talk' && talk, vk = !tk && vo, W = tk || vk ? null : song ? song.buf : buf, M = tk ? talk.voice : vk ? vo.pcm : song ? song.mono : mono, sr = tk ? talk.sr : vk ? vo.sr : W.sampleRate;
  const from = !tk && !vk && secStart + buf.duration > 179 ? secStart : 0;   // a part past 3 minutes: from where it starts
  const lang = $('caplang').value, key = (tk ? 'talk|' + talk.sig : vk ? 'vo|' + vo.key : song ? song.key : musicKey) + '|' + from.toFixed(2) + '|' + lang, token = musicToken;
  if(capCache.has(key)){ capAll = capCache.get(key); capKeyNow = key; shiftCaptions(); capStat(capWords.length + ' words'); return; }
  capStat('Listening to the words of the song…');
  try{
    const wav = await songWav(M, sr, from);
    const r = await fetch('/api/studio/transcribe?lang=' + encodeURIComponent(lang), { method:'POST', headers:{'Content-Type':'audio/wav'}, body: wav, signal: ac.signal });
    const res = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error((res.error && res.error.message) || ('Captions failed (' + r.status + ').'));
    if(token !== musicToken) return;
    capAll = { from, words: Array.isArray(res.words) ? res.words : [] }; capCache.set(key, capAll); capKeyNow = key; shiftCaptions();
    capStat(capWords.length ? capWords.length + ' words found' + (res.language && res.language !== 'auto' ? ' (' + res.language + ')' : '') + (res.charged ? ' · ' + res.charged + ' credit' + (res.charged > 1 ? 's' : '') : '') : 'No words in this song (instrumental?)');
    redraw();
  }catch(err){ if(!(err && err.name === 'AbortError')) { console.warn('captions failed:', err); capStat('Captions could not be made this time. Please try again.', true); } }
}
(async () => {   // is speech recognition set up on this server?
  try{ const r = await fetch('/api/studio/transcribe', { signal: ac.signal }); if(!r.ok) return; const j = await r.json(); if(!j || !j.available) return;
    $('capwrap').hidden = false; if(j.credits) $('capwrap').title = 'Uses ' + j.credits + ' credit' + (j.credits > 1 ? 's' : '') + ' per song'; }catch(e){}
})();
$('caps').addEventListener('change', e=>{ capsOn = e.target.checked; $('caprow').hidden = !capsOn; if(capsOn) loadCaptions(); else { capStat(''); redraw(); } });
$('caplang').addEventListener('change', ()=>{ if(capsOn) loadCaptions(); });
$('tstyle').addEventListener('click', e=>{ const b = e.target.closest('button'); if(!b) return; textStyle = b.dataset.t; [...$('tstyle').children].forEach(x=>x.setAttribute('aria-pressed', x===b)); redraw(); });
function drawSafe(){
  const W=out.width, H=out.height; if(aspect!=='9:16') return;
  og.save(); og.fillStyle='rgba(255,40,80,0.18)';
  og.fillRect(0,0,W,H*220/1920); og.fillRect(0,H-H*450/1920,W,H*450/1920); og.fillRect(W-W*120/1080,H*0.45,W*120/1080,H*0.55-H*450/1920);
  og.strokeStyle='rgba(255,255,255,0.5)'; og.setLineDash([12,10]); og.lineWidth=3;
  og.strokeRect(0,(H-H*1440/1920)/2,W,H*1440/1920);   // 3:4 profile grid crop
  og.fillStyle='rgba(255,255,255,0.85)'; og.font=`600 ${Math.round(W*0.026)}px system-ui, sans-serif`; og.textAlign='center';
  og.fillText('Instagram UI (keep text out)', W/2, H*110/1920); og.fillText('Caption / username', W/2, H-H*225/1920);
  og.restore();
}
const grainC = (()=>{ const c=document.createElement('canvas'); c.width=c.height=256; const g=c.getContext('2d'), im=g.createImageData(256,256);
  for(let i=0;i<im.data.length;i+=4){ const v=Math.random()*255; im.data[i]=im.data[i+1]=im.data[i+2]=v; im.data[i+3]=255; } g.putImageData(im,0,0); return c; })();
let grainPat = null;
function grain(g, amt){   // film grain: shifts every frame, very light
  if(!amt) return; if(!grainPat) grainPat = g.createPattern(grainC, 'repeat');
  g.save(); g.globalCompositeOperation='overlay'; g.globalAlpha=amt; g.translate(Math.random()*256, Math.random()*256);
  g.fillStyle=grainPat; g.fillRect(-256,-256,out.width+512,out.height+512); g.restore();
}
function vignette(g, amt){
  const W=out.width, H=out.height, gr = g.createRadialGradient(W/2,H/2,Math.min(W,H)*0.35,W/2,H/2,Math.hypot(W,H)*0.62);
  gr.addColorStop(0,'rgba(0,0,0,0)'); gr.addColorStop(1,`rgba(0,0,0,${amt})`); g.fillStyle=gr; g.fillRect(0,0,W,H);
}
// mask transition: new shot drawn through a soft-edged shape over the previous shot
function maskReveal(e, local, p, kind){
  const W=out.width, H=out.height; fitBufs();
  gA.globalCompositeOperation='source-over'; gA.clearRect(0,0,W,H); drawShot(gA, e, local);
  gA.globalCompositeOperation='destination-in';
  const q = EASE.outCubic(p);
  if(kind==='iris'){
    const cx = e.cx*W, cy = H/2, R = Math.hypot(Math.max(cx,W-cx), H/2)*q*1.05, f = Math.max(1, R*0.18);
    const gr = gA.createRadialGradient(cx,cy,Math.max(0,R-f),cx,cy,R+1); gr.addColorStop(0,'#000'); gr.addColorStop(1,'rgba(0,0,0,0)');
    gA.fillStyle=gr; gA.fillRect(0,0,W,H);
  } else if(kind==='wipe'){
    const span = W+H, edge = -0.25*span + q*1.5*span, f = span*0.12;
    const gr = gA.createLinearGradient(0,0,W,H*0.6); const a=Math.min(1,Math.max(0,(edge-f)/span)), b=Math.min(1,Math.max(0,edge/span));
    gr.addColorStop(0,'#000'); gr.addColorStop(Math.max(0,Math.min(a,0.999)),'#000'); gr.addColorStop(Math.max(b,Math.min(a,0.999)+0.001),'rgba(0,0,0,0)'); gr.addColorStop(1,'rgba(0,0,0,0)');
    gA.fillStyle=gr; gA.fillRect(0,0,W,H);
  } else if(kind==='diamond' || kind==='heart' || kind==='star'){
    const cx = e.cx*W, cy = H/2, R = Math.hypot(Math.max(cx,W-cx), H/2)*EASE.inOut(p)*SHAPE_REACH[kind], path = new Path2D(), N = 72;
    for(let k=0;k<N;k++){ const a = k/N*Math.PI*2; let r = 1;
      // the edge of the unit shape along this direction (refread.shapeInside), by bisection
      let lo = 0, hi = 2.5; for(let it=0; it<14; it++){ const m = (lo+hi)/2; if(shapeInside(kind, Math.cos(a)*m, Math.sin(a)*m)) lo = m; else hi = m; } r = lo;
      const x = cx + Math.cos(a)*r*R, y = cy + Math.sin(a)*r*R; k ? path.lineTo(x, y) : path.moveTo(x, y); }
    path.closePath(); gA.fillStyle='#000'; gA.fill(path);
  } else if(kind==='bars'){
    const n=6, bw=W/n; gA.fillStyle='#000';
    for(let k=0;k<n;k++){ const pk = Math.min(1,Math.max(0,(p*1.6 - k*0.12))); const hh = H*EASE.outCubic(pk); gA.fillRect(k*bw-0.5, k%2 ? 0 : H-hh, bw+1, hh); }
  }
  gA.globalCompositeOperation='source-over';
  og.drawImage(bufA,0,0);
}
function drawMain(e, local){
  const W=out.width, H=out.height;
  if(!(e.efx==='snap' && local < SNAP_T+0.16)) return drawShot(og, e, local);
    // photo print: blurred dark backdrop, tilted frame with white border, then it opens back to full frame
    const q = Math.max(0, (local-SNAP_T)/0.16), k = EASE.outCubic(q), sc = 0.84 + 0.16*k, rot = -3*(1-k), bw = W*0.025*(1-k);
    drawShot(og, e, local, {scale:1.15, noFx:true}); og.fillStyle=`rgba(0,0,0,${0.55*(1-k)})`; og.fillRect(0,0,W,H);
    og.save(); og.translate(W/2,H/2); og.rotate(rot*Math.PI/180); og.scale(sc,sc);
    if(bw>0.5){ og.shadowColor='rgba(0,0,0,0.5)'; og.shadowBlur=W*0.04; og.fillStyle='#fff'; og.fillRect(-W/2-bw,-H/2-bw,W+2*bw,H+2*bw); og.shadowBlur=0; }
    og.beginPath(); og.rect(-W/2,-H/2,W,H); og.clip(); og.translate(-W/2,-H/2); drawShot(og, e, local); og.restore();
    if(local < 0.12){ og.fillStyle=`rgba(255,255,255,${0.9*(1-local/0.12)})`; og.fillRect(0,0,W,H); }
}
function drawFrame2D(t){
  const W=out.width, H=out.height; og.globalCompositeOperation='source-over'; og.fillStyle='#000'; og.fillRect(0,0,W,H);
  if(!edit.length) return;
  const i = segAt(t), e = edit[i], local = t - e.start, pe = edit[i-1], pl = pe ? pe.end-pe.start : 0;
  const d = TR_DUR[e.tr] || 0, p = d ? Math.min(1, local/d) : 1;
  if(p < 1 && (pe || e.tr==='fadein')){
    const q = EASE.outCubic(p);
    switch(e.tr){
      case 'whip': {   // slide with motion blur trails
        for(let k=4;k>=0;k--){ const a = k ? 0.18 : 1; drawShot(og, pe, pl, {alpha:a, dx:-q*W - k*0.05*W, noFx:true}); }
        for(let k=4;k>=0;k--){ const a = k ? 0.18 : 1; drawShot(og, e, local, {alpha:a, dx:(1-q)*W + k*0.05*W, noFx:!!k}); }
        break; }
      case 'zoom': drawShot(og, pe, pl, {scale:1+0.9*EASE.inQuad(p), zblur:1, noFx:false}); drawShot(og, e, local, {alpha:q, scale:1.6-0.6*q, zblur:1-q}); break;
      case 'spin': drawShot(og, pe, pl, {rot:90*EASE.inQuad(p), scale:1+0.5*p, alpha:1-q}); drawShot(og, e, local, {rot:-90*(1-q), scale:1.5-0.5*q, alpha:q, zblur:1-q}); break;
      case 'glitch': {
        drawShot(og, e, local, {rgb:18*(1-p)});
        const strips = 10, sh = H/strips;
        for(let k=0;k<strips;k++){ if(((k*7 + Math.floor(local*70))%3)!==0) continue;
          og.save(); og.beginPath(); og.rect(0, k*sh, W, sh*0.7); og.clip();
          drawShot(og, k%2 ? pe : e, k%2 ? pl : local, {dx:((k*37)%11-5)*0.015*W, noFx:true}); og.restore(); }
        break; }
      case 'iris': case 'wipe': case 'bars': case 'diamond': case 'heart': case 'star': drawShot(og, pe, pl, {noFx:true}); maskReveal(e, local, p, e.tr); break;
      case 'dip':
        if(p<0.5){ drawShot(og, pe, pl); og.fillStyle=`rgba(0,0,0,${EASE.inOut(p*2)})`; og.fillRect(0,0,W,H); }
        else { drawShot(og, e, local); og.fillStyle=`rgba(0,0,0,${1-EASE.inOut((p-0.5)*2)})`; og.fillRect(0,0,W,H); }
        break;
      case 'slideleft': case 'slideright': case 'slideup': case 'slidedown': case 'swipeup': case 'zoomout': case 'blur': case 'flip': case 'luma': case 'pixelate': case 'clock': case 'doors': case 'ripple': case 'burn': case 'dropin':   // the 2D renderer: a dissolve
      case 'dissolve': drawShot(og, pe, pl, {noFx:true}); drawShot(og, e, local, {alpha:EASE.inOut(p)}); break;
      case 'fadein': drawShot(og, e, local, {alpha:q}); break;
      case 'flash': {   // exposure flash: picture blows out to white, then settles
        drawMain(e, local);
        if(e.efx!=='snap'){ og.save(); og.globalCompositeOperation='lighter'; drawShot(og, e, local, {alpha:Math.max(0,1-p*1.6), noFx:true}); og.restore(); }
        og.fillStyle=`rgba(255,255,255,${0.85*Math.pow(1-p,2)})`; og.fillRect(0,0,W,H); break; }
      default: drawShot(og, e, local);
    }
  } else drawMain(e, local);
  lensPass2D(og, e);
  if(e.type==='drop' && local < 0.7){   // warm light leak sweeping across on drops
    const q = local/0.7, lx = -0.3*W + q*1.6*W, gr = og.createRadialGradient(lx, H*0.35, 0, lx, H*0.35, W*0.9);
    gr.addColorStop(0, `rgba(255,170,90,${0.38*(1-q)})`); gr.addColorStop(1,'rgba(255,120,60,0)');
    og.save(); og.globalCompositeOperation='screen'; og.fillStyle=gr; og.fillRect(0,0,W,H); og.restore(); }
  grain(og, LOOKS[look].grain);
  if(LOOKS[look].tint){ // teal shadows, warm highlights
    og.save(); og.globalCompositeOperation='soft-light'; og.fillStyle='rgba(0,110,130,0.36)'; og.fillRect(0,0,W,H);
    og.globalCompositeOperation='overlay'; og.fillStyle='rgba(255,150,70,0.12)'; og.fillRect(0,0,W,H); og.restore(); }
  const vg = kf(e.kf && e.kf.vig, local); vignette(og, vg !== undefined ? vg : 0.22);
  // seamless loop: the last 0.4 s melts into the opening frame
  const dur = buf.duration;
  if(loopImg && t > dur-0.4){ og.globalAlpha = EASE.inOut((t-(dur-0.4))/0.4); og.drawImage(loopImg,0,0,W,H); og.globalAlpha=1; }
  if(layers.length) drawLayers(og, t);
  if(holdText) return;
  bgPass(t); drawText(t);
  if(showSafe && !recording && !coverMode) drawSafe();
  if(!exporting){ $('prog').style.width = (t/buf.duration*100).toFixed(2)+'%';
    const rows = $('edl').children; if(rows[i] && !rows[i].classList.contains('cur')){ [...rows].forEach(r=>r.classList.remove('cur')); rows[i].classList.add('cur'); } }
}

/* =============== GPU RENDERER (WebGL) =============== */
const GLSL_V = `attribute vec2 a; void main(){ gl_Position = vec4(a,0.,1.); }`;
const GLSL_F = `precision highp float;
uniform sampler2D tA, tB, tL;
uniform vec2 res;
uniform vec4 rA, rB, bgR, frR;
uniform float rotA, rotB, zbA, zbB, rgbA, rgbB, exA, exB, brA, brB, alA, alB, clA, clB, hasA;
uniform vec2 dbA, dbB, irisC, offA, offB;
uniform float mode, prog, mixv, time, snap, bgDark, border;
uniform float con, sat, bri, teal, mono, vig, grain, flash, loopMix, warm, lift;
uniform vec3 leak;
uniform vec4 tfA, tfB, bgA, bgB, bgrA, bgrB, bdA, bdB, adA, adB, mz, mg;
uniform vec4 ad2A, ad2B, tsh, thi;   /* a shot's highlights, shadows, hue, sharpen and the look's shadow and highlight tints */
uniform float beA, beB;   /* skin smoothing of a shot */
uniform float mzc;
uniform vec4 shp, shq;   // a beat shape of the shot: kind, level, centre, and the grid / strips count
vec2 rotP(vec2 p, float r){ vec2 c=res*0.5; vec2 d=p-c; float cs=cos(-r), sn=sin(-r); return c+vec2(cs*d.x-sn*d.y, sn*d.x+cs*d.y); }
vec3 tap(sampler2D t, vec2 uv, float ro){ uv=clamp(uv,0.001,0.999);
  if(ro<0.0001) return texture2D(t,uv).rgb;
  return vec3(texture2D(t,clamp(uv+vec2(ro,0.),0.001,0.999)).r, texture2D(t,uv).g, texture2D(t,clamp(uv-vec2(ro,0.),0.001,0.999)).b); }
vec3 layer(sampler2D t, vec2 p, vec4 r, float rot, float zb, vec2 db, float rgb, vec4 tf, out float inside){
  vec2 q = rotP(p, rot); vec2 uv = (q-r.xy)/r.zw;
  inside = step(0.,uv.x)*step(uv.x,1.)*step(0.,uv.y)*step(uv.y,1.);
  uv = vec2(dot(tf.xy, uv-0.5), dot(tf.zw, uv-0.5)) + 0.5;   // turned / mirrored / flipped
  float ro = rgb/r.z; vec3 c = tap(t,uv,ro);
  if(zb>0.01 || length(db)>0.5){
    vec3 acc=c; vec2 du = db/r.zw;
    for(int k=1;k<10;k++){ float f=float(k)/9.; vec2 u2 = mix(uv, vec2(0.5), zb*0.1*f) + du*(f-0.5); acc += tap(t,u2,ro); }
    c = acc/10.;
  }
  return c;
}
// a shot with its clip settings: border and canvas around a fitted picture, then its own colour
vec3 adj(vec3 c, vec4 a){ c *= 1.+a.x*0.5; c = (c-0.5)*(1.+a.y)+0.5; float l = dot(c, vec3(0.299,0.587,0.114)); c = mix(vec3(l), c, 1.+a.z); return c*vec3(1.+0.15*a.w, 1., 1.-0.15*a.w); }
vec3 hueRot(vec3 c, float a){ float l = dot(c, vec3(0.299,0.587,0.114)); vec3 k = c - l; float cs = cos(a), sn = sin(a);
  vec3 u = normalize(vec3(1.,-0.5,-0.5)), v = normalize(vec3(0.,0.866,-0.866)); float x = dot(k,u), y = dot(k,v);
  return l + u*(x*cs - y*sn) + v*(x*sn + y*cs) + (k - u*x - v*y); }
vec3 shotL(sampler2D t, vec2 p, vec4 r, float rot, float zb, vec2 db, float rgb, vec4 tf, vec4 bg, vec4 bgr, vec4 bd, vec4 ad, vec4 ad2, float be, out float inside){
  vec3 c = layer(t,p,r,rot,zb,db,rgb,tf,inside);
  if(inside>0.5 && (ad2.w>0.01 || be>0.01)){
    float ib; vec2 o = vec2(1.6,0.);
    vec3 bl = (layer(t,p+o,r,rot,0.,vec2(0.),0.,tf,ib)+layer(t,p-o,r,rot,0.,vec2(0.),0.,tf,ib)+layer(t,p+o.yx,r,rot,0.,vec2(0.),0.,tf,ib)+layer(t,p-o.yx,r,rot,0.,vec2(0.),0.,tf,ib))*0.25;
    if(ad2.w>0.01) c += (c-bl)*ad2.w*2.5;
    if(be>0.01){
      vec2 o2 = vec2(4.5,0.);
      vec3 wb = (layer(t,p+o2,r,rot,0.,vec2(0.),0.,tf,ib)+layer(t,p-o2,r,rot,0.,vec2(0.),0.,tf,ib)+layer(t,p+o2.yx,r,rot,0.,vec2(0.),0.,tf,ib)+layer(t,p-o2.yx,r,rot,0.,vec2(0.),0.,tf,ib)+bl*4.)/8.;
      float skin = smoothstep(0.02,0.1,c.r-c.g)*smoothstep(0.0,0.06,c.g-c.b)*step(0.2,c.r);
      float flatness = 1.-smoothstep(0.03,0.14,length(c-wb));
      c = mix(c, wb*1.02+0.01, clamp(be*skin*flatness,0.,0.9));
    }
  }
  if(inside<0.5 && bd.w>0.){ vec2 q = rotP(p,rot); if(q.x>r.x-bd.w && q.x<r.x+r.z+bd.w && q.y>r.y-bd.w && q.y<r.y+r.w+bd.w){ c = bd.rgb; inside = 1.; } }
  if(inside<0.5 && bg.w>-0.5){ float ib; c = bg.w>0.5 ? layer(t,p,bgr,0.,1.,vec2(0.),0.,tf,ib)*0.62 : bg.rgb; inside = 1.; }
  c = adj(c, ad);
  if(ad2.x!=0. || ad2.y!=0.){ float l = dot(c, vec3(0.299,0.587,0.114)); c += ad2.x*0.28*smoothstep(0.45,1.,l) + ad2.y*0.28*(1.-smoothstep(0.,0.55,l)); }
  if(ad2.z!=0.) c = hueRot(c, ad2.z*3.14159);
  return c;
}
float hash(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
/* Beat shapes (the shot's effect, stepping on its beats): 1 box that grows, 2 grid of windows, 3 strips, 4 circle,
 * 5 heart, 6 star, 7 frame in frame, 8 mirror, 9 kaleidoscope, 10 triple split, 11 VHS. Outside a shape: the same shot,
 * blurred and dark. shp = (kind, level, centre x, centre y); shq.x = cells across for the grid / strips. */
float rbox(vec2 d, vec2 h, float r){ vec2 q = abs(d)-h+r; return length(max(q,0.))+min(max(q.x,q.y),0.)-r; }
vec2 shWarp(vec2 p){
  if(shp.x<8.5){ if(p.x>res.x*0.5) p.x = res.x-p.x; return p; }
  if(shp.x<9.5){ vec2 c = res*0.5; return c-abs(p-c); }
  if(shp.x<10.5){ float h = res.y/3.; return vec2(p.x, mod(p.y,h)+h); }
  float jump = step(0.985, hash(vec2(floor(p.y*0.02), floor(time*9.))));
  p.x += sin(p.y*0.045+time*23.)*res.x*0.0025 + jump*res.x*0.02; return p;
}
float shMask(vec2 p0, out float rim){
  float k = shp.x, lv = shp.y; vec2 c = shp.zw; rim = 0.;
  float w = res.x*0.007;   // the white edge
  if(k<1.5 || (k>6.5 && k<7.5)){
    vec2 hh = res*0.5*lv; float r = res.x*0.035; float d = rbox(p0-c, hh, r);
    float wk = k>6.5 ? w*1.8 : w; rim = smoothstep(-1.,1.,d)*(1.-smoothstep(wk-1.,wk+1.,d))*step(lv,0.995);
    return 1.-smoothstep(-1.,1.,d); }
  if(k<3.5){
    float n = max(1.,shq.x), gap = res.x*0.01;
    vec2 cell = k<2.5 ? res/n : vec2(res.x/n, res.y);
    vec2 id = floor(p0/cell); float idx = k<2.5 ? id.y*n+id.x : id.x;
    vec2 l = mod(p0, cell)-cell*0.5; float d = rbox(l, cell*0.5-gap, gap*1.4);
    return step(idx+0.5, lv)*(1.-smoothstep(-1.,1.,d)); }
  float L = length(max(c,res-c)); vec2 dd = p0-c;
  if(k<4.5){ float R = lv*L; float d = length(dd)-R; rim = smoothstep(-1.,1.,d)*(1.-smoothstep(w-1.,w+1.,d))*step(lv,0.995); return 1.-smoothstep(-1.,1.,d); }
  if(k<5.5){ vec2 u = dd/(lv*L*1.9+1e-3); float X = u.x*1.15, Y = -u.y*1.15+0.3; float a = X*X+Y*Y-1.; float h = a*a*a-X*X*Y*Y*Y; return 1.-smoothstep(-0.02,0.02,h); }
  if(k<6.5){ float r = length(dd)/(lv*L*1.85+1e-3); float an = atan(dd.y,dd.x); float lim = 0.55+0.45*pow(0.5+0.5*cos(5.*an+1.5708),3.); return 1.-smoothstep(lim-0.03,lim,r); }
  if(k>9.5 && k<10.5){ float h = res.y/3.; float idx = floor(p0.y/h); float e = abs(mod(p0.y,h)); rim = 0.; return step(idx+0.5, lv)*step(1.5, e)*step(e, h-1.5); }
  return 1.;
}
void main(){
  vec2 p0 = vec2(gl_FragCoord.x, res.y-gl_FragCoord.y);
  // mosaic (blocks) and magnifier (a round lens) of the shot, on screen
  if(mz.z>0. && p0.x>mz.x && p0.x<mz.x+mz.z && p0.y>mz.y && p0.y<mz.y+mz.w) p0 = mz.xy + (floor((p0-mz.xy)/mzc)+0.5)*mzc;
  float ring = 0.;
  if(mg.z>0.){ float dd = distance(p0, mg.xy); ring = smoothstep(mg.z-5., mg.z-2., dd)*(1.-smoothstep(mg.z, mg.z+2., dd)); if(dd<mg.z) p0 = mg.xy + (p0-mg.xy)/mg.w; }
  if(mode>12.5 && mode<13.5){ float blk = max(1., res.x*0.07*sin(3.14159*prog)); p0 = (floor(p0/blk)+0.5)*blk; }
  if(mode>15.5 && mode<16.5){ vec2 dd = p0-res*0.5; float rr = length(dd); p0 += (dd/(rr+1e-3))*sin(rr*0.06-prog*20.)*res.x*0.02*sin(3.14159*prog); }
  vec2 p = p0 - offB, pA = p0 - offA;   // the creator's keyframed move of each layer
  float inA=0., inB=0.;
  vec3 A = vec3(0.);
  if(hasA>0.5){ A = shotL(tA,pA,rA,rotA,zbA,dbA,rgbA,tfA,bgA,bgrA,bdA,adA,ad2A,beA,inA); A = (A + A*exA)*brA*alA*mix(1.,inA,clA); }
  vec2 pS = shp.x>7.5 ? shWarp(p) : p;   // mirror, kaleidoscope, triple split, VHS move the picture itself
  vec3 B = shotL(tB,pS,rB,rotB,zbB,dbB,rgbB,tfB,bgB,bgrB,bdB,adB,ad2B,beB,inB);
  B *= mix(1.,inB,clB)*alB;
  if(shp.x>0.5 && (shp.x<7.5 || (shp.x>9.5 && shp.x<10.5))){
    float rim; float mk = shMask(p0, rim);
    if(mk<0.999 || rim>0.){ float ib; vec3 bgc = layer(tB,p,rB,rotB,1.,vec2(0.),0.,tfB,ib)*0.34; B = mix(bgc, B, mk); B = mix(B, vec3(1.), rim*0.92); }
  }
  if(snap>0.5){
    vec2 q = rotP(p,rotB);
    bool inFrame = q.x>frR.x && q.x<frR.x+frR.z && q.y>frR.y && q.y<frR.y+frR.w;
    bool inBorder = q.x>frR.x-border && q.x<frR.x+frR.z+border && q.y>frR.y-border && q.y<frR.y+frR.w+border;
    float ib;
    if(!inFrame) B = inBorder ? vec3(1.) : layer(tB,p,bgR,0.,0.7,vec2(0.),0.,tfB,ib)*(1.-bgDark);
  }
  B = (B + B*exB)*brB;
  vec3 col;
  if(mode<0.5) col = B;
  else if(mode<1.5) col = mix(A,B,mixv);
  else if(mode<2.5) col = prog<0.5 ? A*(1.-2.*prog) : B*(2.*prog-1.);
  else if(mode<3.5) col = inB>0.5 ? B : A;
  else if(mode<5.5){
    float band = floor(p0.y/(res.y/10.)); float h = hash(vec2(band, floor(time*70.)));
    if(h<0.3 && hasA>0.5){ vec4 ra=rA; ra.x += (hash(vec2(band,1.))-0.5)*0.14*res.x; float ia; col = layer(tA,pA,ra,rotA,0.,vec2(0.),0.,tfA,ia); }
    else if(h<0.5){ vec4 rb=rB; rb.x += (hash(vec2(band,2.))-0.5)*0.14*res.x; float ib2; col = layer(tB,p,rb,rotB,0.,vec2(0.),rgbB,tfB,ib2); }
    else col = B;
  }
  else if(mode<6.5){ float q=1.-pow(1.-prog,3.); vec2 far=max(irisC,res-irisC); float R=length(far)*q*1.05; float f=max(1.,R*0.18); float mk=1.-smoothstep(R-f,R,distance(p0,irisC)); col=mix(A,B,mk); }
  else if(mode<7.5){ float q=1.-pow(1.-prog,3.); float s=(p0.x+p0.y*0.6)/(res.x+res.y*0.6); float e=-0.15+q*1.3; float mk=1.-smoothstep(e-0.08,e,s); col=mix(A,B,mk); }
  else if(mode>11.5){
    if(mode<12.5){ float lb = dot(B, vec3(0.299,0.587,0.114)); col = mix(A, B, smoothstep(0., 0.15, prog*1.2-(1.-lb))); }
    else if(mode<13.5 || mode>15.5) col = mix(A, B, smoothstep(0.35, 0.65, prog));
    else if(mode<14.5){ vec2 dd = p0-res*0.5; float a = mod(atan(dd.x, -dd.y)+6.28318, 6.28318)/6.28318; col = mix(A, B, 1.-smoothstep(prog-0.01, prog, a)); }
    else { float hw = prog*res.x*0.5; col = mix(A, B, 1.-smoothstep(hw-2., hw, abs(p0.x-res.x*0.5))); }
  }
  else if(mode>8.5){ float q=prog*prog*(3.-2.*prog);   /* smooth in and out: the shape is seen growing */ vec2 far=max(irisC,res-irisC); float L=length(far); vec2 d=p0-irisC; float mk;
    if(mode<9.5){ float R=L*1.45*q+1e-3; float v=(abs(d.x)+abs(d.y))/R; mk=1.-smoothstep(0.93,1.,v); }
    else if(mode<10.5){ float R=L*1.9*q+1e-3; vec2 u=d/R; float X=u.x*1.15; float Y=-u.y*1.15+0.3; float a=X*X+Y*Y-1.; float h=a*a*a-X*X*Y*Y*Y; mk=1.-smoothstep(-0.03,0.03,h); }
    else { float R=L*1.85*q+1e-3; float r=length(d)/R; float an=atan(d.y,d.x); float lim=0.55+0.45*pow(0.5+0.5*cos(5.*an+1.5708),3.); mk=1.-smoothstep(lim-0.05,lim,r); }
    col=mix(A,B,mk); }
  else { float k=floor(p0.x/(res.x/6.)); float pk=clamp(prog*1.6-k*0.12,0.,1.); float hh=res.y*(1.-pow(1.-pk,3.)); float mk = mod(k,2.)>0.5 ? step(p0.y,hh) : step(res.y-hh,p0.y); col=mix(A,B,mk); }
  // colour grade
  col = lift + col*(1.-lift);   // lifted blacks (faded / matte)
  col = (col-0.5)*con + 0.5; col *= bri;
  float l = dot(col, vec3(0.299,0.587,0.114));
  col = mix(vec3(l), col, sat);
  if(teal>0.){ vec3 tint = mix(vec3(0.75,1.05,1.12), vec3(1.12,0.98,0.82), smoothstep(0.15,0.85,l)); col = mix(col, col*tint, teal); }
  col *= vec3(1.+0.12*warm, 1., 1.-0.12*warm);   // white balance: warm (+) / cool (-)
  if(tsh.w>0. || thi.w>0.){ float lt = dot(col, vec3(0.299,0.587,0.114)); col = mix(col, col*tsh.rgb*2., tsh.w*(1.-smoothstep(0.,0.6,lt))); col = mix(col, col*thi.rgb*2., thi.w*smoothstep(0.4,1.,lt)); }
  if(leak.z>0.){ float d = distance(p0, leak.xy)/(res.x*0.9); vec3 lc = vec3(1.,0.67,0.35)*leak.z*(1.-smoothstep(0.,1.,d)); col = 1.-(1.-col)*(1.-lc); }
  col = mix(col, vec3(dot(col,vec3(0.299,0.587,0.114))), mono);   // after the light leak: black and white stays black and white
  col += flash;
  if(shp.x>10.5 && shp.x<11.5){ col *= 0.86+0.14*sin(p0.y*1.7); col += (hash(vec2(p0.y*0.13, floor(time*24.)))-0.5)*0.07; col = mix(vec3(dot(col,vec3(0.299,0.587,0.114))), col, 0.78); col.r *= 1.04; col.b *= 0.93; }
  vec2 uvn = p0/res-0.5; float vd = length(uvn*vec2(res.x/res.y,1.)*vec2(1.,1.));
  col *= 1. - vig*smoothstep(0.3,0.75,vd);
  if(grain>0.) col += (hash(p0*0.73 + fract(time*7.)*vec2(97.,13.))-0.5)*grain*0.6;
  col = mix(col, vec3(1.), ring*0.9);   // the magnifier's rim
  if(loopMix>0.) col = mix(col, texture2D(tL, p0/res).rgb, loopMix);
  gl_FragColor = vec4(clamp(col,0.,1.),1.);
}`;
// WebGL renderer. Phones can take the GPU context away (memory pressure, the app in the background): then frames are
// drawn by the 2D renderer until the context comes back, when everything is set up again - never a black frame.
const GL = (()=>{
  try{
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl', {preserveDrawingBuffer:true, premultipliedAlpha:false, antialias:false});
    if(!gl) return null;
    let lost = false, tex = [], U = {}, loopSrc = null;
    const init = () => {
      const sh = (type, src) => { const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER,GLSL_V)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER,GLSL_F)); gl.linkProgram(pr);
      if(!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
      gl.useProgram(pr);
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,b); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(pr,'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
      tex = [0,1,2].map(k=>{ const t=gl.createTexture(); gl.activeTexture(gl.TEXTURE0+k); gl.bindTexture(gl.TEXTURE_2D,t);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0,255])); return t; });
      U = {}; const n = gl.getProgramParameter(pr, gl.ACTIVE_UNIFORMS);
      for(let i=0;i<n;i++){ const info=gl.getActiveUniform(pr,i); U[info.name]=gl.getUniformLocation(pr,info.name); }
      gl.uniform1i(U.tA,0); gl.uniform1i(U.tB,1); gl.uniform1i(U.tL,2);
      loopSrc = null;
    };
    init();
    c.addEventListener('webglcontextlost', e=>{ e.preventDefault(); lost = true; });
    c.addEventListener('webglcontextrestored', ()=>{ try{ init(); lost = false; }catch(err){ console.warn('WebGL could not be restored:', err && err.message); } });
    const upload = (k, src) => { if(!src) return; if(src.readyState!==undefined && src.readyState<2) return; gl.activeTexture(gl.TEXTURE0+k); gl.bindTexture(gl.TEXTURE_2D,tex[k]);
      try{ gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,src); }catch(e){} };
    const set = (name, v) => { const l=U[name]; if(!l) return; if(typeof v==='number') gl.uniform1f(l,v); else if(v.length===2) gl.uniform2fv(l,v); else if(v.length===3) gl.uniform3fv(l,v); else gl.uniform4fv(l,v); };
    return { canvas:c, gl, get lost(){ return lost || gl.isContextLost(); }, render(S){
      if(c.width!==out.width || c.height!==out.height){ c.width=out.width; c.height=out.height; }
      gl.viewport(0,0,c.width,c.height);
      if(S.A) upload(0, S.A.el); upload(1, S.B.el);
      if(S.loopImg && S.loopImg!==loopSrc){ upload(2, S.loopImg); loopSrc = S.loopImg; }
      set('res',[c.width,c.height]);
      const L = (pre, X) => { set('r'+pre, X.rect); set('rot'+pre, X.rot); set('zb'+pre, X.zb); set('db'+pre, X.db); set('rgb'+pre, X.rgb); set('ex'+pre, X.expo); set('br'+pre, X.bright);
        set('off'+pre, X.off || [0,0]); set('cl'+pre, X.clip || 0);
        set('tf'+pre, X.tf || [1,0,0,1]); set('bg'+pre, X.bg || [0,0,0,-1]); set('bgr'+pre, X.bgr || [0,0,1,1]); set('bd'+pre, X.bd || [0,0,0,0]); set('ad'+pre, X.ad || [0,0,0,0]); set('ad2'+pre, X.ad2 || [0,0,0,0]); set('be'+pre, X.be || 0); };
      if(S.A){ L('A', S.A); set('alA', S.A.alpha ?? 1); } else { set('offA', [0,0]); set('clA', 0); }
      L('B', S.B); set('alB', S.B.uo ?? 1);
      set('hasA', S.A ? 1 : 0); set('mode', S.mode); set('prog', S.prog); set('mixv', S.mix); set('irisC', S.iris || [c.width/2,c.height/2]);
      set('time', S.time); set('snap', S.snap ? 1 : 0); set('bgR', S.bgR || [0,0,1,1]); set('bgDark', S.bgDark||0); set('frR', S.frR || [0,0,c.width,c.height]); set('border', S.border||0);
      const G = S.grade; set('con',G.con); set('sat',G.sat); set('bri',G.bri); set('teal',G.teal); set('mono',G.mono); set('vig',G.vig); set('grain',G.grain); set('warm',G.warm||0); set('lift',G.lift||0); set('tsh', G.tsh || [0.5,0.5,0.5,0]); set('thi', G.thi || [0.5,0.5,0.5,0]);
      set('flash', S.flash||0); set('leak', S.leak || [0,0,0]); set('loopMix', S.loopMix||0);
      const LZ = S.lens || { mz:[0,0,0,0], mzc:1, mg:[0,0,0,1] }; set('mz', LZ.mz); set('mzc', LZ.mzc); set('mg', LZ.mg);
      set('shp', S.shp ? S.shp.a : [0,0,0,0]); set('shq', S.shp ? S.shp.b : [0,0,0,0]);
      gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    }};
  }catch(err){ console.warn('WebGL off:', err && err.message); return null; }
})();
const GRADES = { natural:{con:1.06,sat:1.04,bri:1.0,teal:0,mono:0,grain:0}, vivid:{con:1.14,sat:1.14,bri:1.02,teal:0,mono:0,grain:0.035},
  cine:{con:1.16,sat:0.92,bri:0.98,teal:0.55,mono:0,grain:0.07}, mono:{con:1.25,sat:1,bri:1.0,teal:0,mono:1,grain:0.09},
  /* filters: the same controls in other mixes, plus a tint in the shadows and one in the highlights (split toning) */
  warmfilm:{con:1.05,sat:1.0,bri:1.0,teal:0,mono:0,grain:0.06,warm:0.5,lift:0.05},
  cool:{con:1.06,sat:0.95,bri:1.0,teal:0,mono:0,grain:0,warm:-0.55},
  retro:{con:0.98,sat:0.8,bri:1.0,teal:0,mono:0,grain:0.09,warm:0.3,lift:0.1,tsh:[0.42,0.56,0.6,0.35]},
  moody:{con:1.22,sat:0.7,bri:0.92,teal:0.2,mono:0,grain:0.05,vig:0.5},
  wedding:{con:0.95,sat:0.95,bri:1.05,teal:0,mono:0,grain:0,warm:0.2,lift:0.05,thi:[0.56,0.52,0.48,0.25]},
  golden:{con:1.06,sat:1.12,bri:1.02,teal:0,mono:0,grain:0.03,warm:0.7,thi:[0.6,0.52,0.4,0.3]},
  tealorange:{con:1.12,sat:1.05,bri:1.0,teal:0.95,mono:0,grain:0.03},
  faded:{con:0.88,sat:0.85,bri:1.02,teal:0,mono:0,grain:0.04,lift:0.15},
  noir:{con:1.45,sat:1,bri:0.97,teal:0,mono:1,grain:0.12,vig:0.55},
  sepia:{con:1.05,sat:1,bri:1.0,teal:0,mono:1,grain:0.08,tsh:[0.58,0.48,0.38,0.7],thi:[0.6,0.54,0.44,0.6]},
  cyber:{con:1.15,sat:1.2,bri:1.0,teal:0,mono:0,grain:0.03,tsh:[0.55,0.35,0.65,0.6],thi:[0.4,0.6,0.62,0.45]},
  pastel:{con:0.9,sat:0.75,bri:1.06,teal:0,mono:0,grain:0,lift:0.12,thi:[0.55,0.5,0.56,0.25]},
  dramatic:{con:1.35,sat:0.85,bri:0.97,teal:0.3,mono:0,grain:0.05,vig:0.6},
  summer:{con:1.06,sat:1.22,bri:1.04,teal:0,mono:0,grain:0,warm:0.4},
  night:{con:1.1,sat:0.8,bri:0.86,teal:0,mono:0,grain:0.06,warm:-0.4,tsh:[0.38,0.45,0.66,0.5]},
  vintage:{con:0.95,sat:0.7,bri:1.0,teal:0,mono:0,grain:0.11,warm:0.35,lift:0.12,thi:[0.6,0.55,0.42,0.3]},
  matte:{con:0.92,sat:0.92,bri:1.0,teal:0,mono:0,grain:0.03,lift:0.1},
  punchy:{con:1.26,sat:1.3,bri:1.02,teal:0,mono:0,grain:0.02},
  forest:{con:1.08,sat:0.95,bri:0.98,teal:0,mono:0,grain:0.04,tsh:[0.44,0.58,0.46,0.45],thi:[0.56,0.56,0.46,0.2]},
  rose:{con:1.0,sat:1.0,bri:1.03,teal:0,mono:0,grain:0.02,lift:0.04,tsh:[0.6,0.44,0.5,0.4],thi:[0.6,0.5,0.52,0.25]} };
const LOOK_EXTRA = { warmfilm:'Warm film', cool:'Cool', retro:'Retro', moody:'Moody', wedding:'Wedding', golden:'Golden hour', tealorange:'Teal & orange', faded:'Faded', noir:'Noir', sepia:'Sepia',
  cyber:'Cyber', pastel:'Pastel', dramatic:'Dramatic', summer:'Summer', night:'Night', vintage:'Vintage', matte:'Matte', punchy:'Punchy', forest:'Forest', rose:'Rose' };
for(const [k, n] of Object.entries(LOOK_EXTRA)){ const G = GRADES[k];   // the 2D renderer's version of each filter, and its button in Look
  LOOKS[k] = { name: n, filter: (G.mono ? 'grayscale(1) ' : '') + 'contrast(' + G.con + ') saturate(' + G.sat + ') brightness(' + G.bri + ')' + (G.warm > 0.2 ? ' sepia(' + (G.warm*0.3).toFixed(2) + ')' : ''), grain: G.grain || 0 };
  const lb = $('look'), cp = lb && lb.querySelector('[data-l="copy"]'); if(lb && !lb.querySelector('[data-l="' + k + '"]')){ const b = document.createElement('button'); b.dataset.l = k; b.setAttribute('aria-pressed', 'false'); b.textContent = n; lb.insertBefore(b, cp); } }
// the same keyframed motion as the 2D path, expressed as numbers for the shader
/* ---- Clip tools: each shot's own settings (e.cs), drawn the same by both renderers and in the export.
 * rot 0/90/180/270 (clockwise), fh / fv mirror and flip, fit (whole picture) on a canvas (bg 'blur' or a colour) with a
 * border, bri / con / sat / warm (-1..1), fin / fout fades (s), mz mosaic {x,y,w,h,s} and mg magnifier {x,y,r,z}
 * (0..1 of the frame). The AI can set the same fields. ---- */
const CS0 = { rev:false, zoom:1, cx:null, cy:null, vol:0, rot:0, fh:false, fv:false, fit:false, bg:'blur', bgc:'#000000', bd:0, bdc:'#ffffff', bri:0, con:0, sat:0, warm:0, hi:0, sh:0, hue:0, sharp:0, vig:0, beauty:0, stab:0, curve:null, fin:0, fout:0, mz:null, mg:null };
const csOf = e => e && e.cs ? { ...CS0, ...e.cs } : CS0;
const ROTI = [[1,0,0,1],[0,1,-1,0],[-1,0,0,-1],[0,-1,1,0]];   // display -> source, per quarter turn
// display uv -> source uv: the picture is turned, then mirrored / flipped
function csMat(c){ const R = ROTI[(c.rot/90)&3], fx = c.fh ? -1 : 1, fy = c.fv ? -1 : 1; return [R[0]*fx, R[1]*fy, R[2]*fx, R[3]*fy]; }
// a point of the source (0..1) on the display
function csFwd(c, x, y){ const R = ROTI[(c.rot/90)&3], sx = x-0.5, sy = y-0.5; return [(R[0]*sx + R[2]*sy)*(c.fh?-1:1) + 0.5, (R[1]*sx + R[3]*sy)*(c.fv?-1:1) + 0.5]; }
const hexRgb = h => { const n = parseInt(String(h).replace('#',''), 16) || 0; return [(n>>16&255)/255, (n>>8&255)/255, (n&255)/255]; };
// the picture's size on the display (turned a quarter: width and height swap) and its scale (fill or fit)
function csGeom(e, scale){
  const W=out.width, H=out.height, c = csOf(e), odd = (c.rot/90)&1, s0 = sources[e.src];
  const sw = odd ? s0.h : s0.w, sh = odd ? s0.w : s0.h, r = (c.fit ? Math.min(W/sw, H/sh) : Math.max(W/sw, H/sh))*scale*(c.zoom || 1);
  return { c, odd, sw, sh, dw: sw*r, dh: sh*r };
}
const csFade = (c, local, L) => Math.min(c.fin > 0 ? Math.min(1, local/c.fin) : 1, c.fout > 0 ? Math.min(1, Math.max(0, (L-local)/c.fout)) : 1);
function csCam(e, local, c){ if(c.cx != null && c.cy != null) return [c.cx, c.cy]; const [x, y] = camAt(e, local); return c.rot || c.fh || c.fv ? csFwd(c, x, y) : [x, y]; }
/* stabilize (basic): the camera's own shake, measured while the clip was read (a global shift per frame), is taken out:
 * the path of the camera is smoothed over about 0.8 s and the picture is moved by what the smoothing removed, a little
 * zoomed so no edge shows */
function stabPath(src){
  if(src._stab) return src._stab; const S = src.samples || []; if(S.length < 4) return null;
  const t = S.map(x => x.t), cx = [0], cy = [0];
  for(let k = 1; k < S.length; k++){ cx.push(cx[k-1] + (S[k].gx || 0)/SW); cy.push(cy[k-1] + (S[k].gy || 0)/SH); }
  const dt = Math.max(1e-3, (t[t.length-1] - t[0])/(t.length - 1)), R = Math.max(2, Math.round(0.4/dt));
  const sm = a => a.map((_, k) => { let s = 0, w = 0; for(let j = Math.max(0, k - R); j <= Math.min(a.length - 1, k + R); j++){ const g = Math.exp(-(((j - k)/(R*0.6))**2)); s += a[j]*g; w += g; } return s/w; });
  const sx = sm(cx), sy = sm(cy);
  return (src._stab = { t, dx: cx.map((v, k) => sx[k] - v), dy: cy.map((v, k) => sy[k] - v) });
}
function stabAt(src, st){ const P = stabPath(src); if(!P) return null; const t = P.t; let lo = 0, hi = t.length - 1;
  if(st <= t[0]) return [P.dx[0], P.dy[0]]; if(st >= t[hi]) return [P.dx[hi], P.dy[hi]];
  while(hi - lo > 1){ const m = (lo + hi) >> 1; if(t[m] <= st) lo = m; else hi = m; } const f = (st - t[lo])/Math.max(1e-6, t[hi] - t[lo]);
  return [P.dx[lo] + (P.dx[hi] - P.dx[lo])*f, P.dy[lo] + (P.dy[hi] - P.dy[lo])*f]; }
function layerOf(e, local, o={}){
  const W=out.width, H=out.height, K=e.kf||{};
  let scale = (kf(K.scale,local) ?? 1)*(o.scale||1)*(o.noFx ? 1 : emphAt(e.start + local));
  let x = (kf(K.x,local) ?? 0)*W + (o.dx||0), y = o.dy||0, rot = (kf(K.rot,local) ?? 0) + (o.rot||0);
  const sh = kf(K.shake,local) || 0;
  if(sh){ x += Math.sin(local*97)*0.03*W*sh; y += Math.cos(local*71)*0.025*H*sh; rot += Math.sin(local*53)*2.2*sh; }
  let expo = o.noFx ? 0 : (kf(K.expo,local) || 0);
  if(K.bounce && e.beatsIn){ for(const bt of e.beatsIn){ if(local>=bt){ scale *= 1 + 0.045*Math.exp(-(local-bt)/0.11); if(!o.noFx) expo += 0.22*Math.exp(-(local-bt)/0.07); } } }
  const ac = o.noFx ? null : accentAt(e, local);
  if(ac){ scale *= ac.s; expo += ac.ex; if(ac.sh){ x += Math.sin(local*97)*0.03*W*ac.sh; y += Math.cos(local*71)*0.025*H*ac.sh; rot += Math.sin(local*53)*2.2*ac.sh; } }
  const am = uAt(e.ak, local);   // the AI director's camera keyframes
  if(am){ scale *= am.s; rot += am.r; x += am.x*W; y += am.y*H; }
  const u = uAt(e.uk, local);
  if(u){ scale *= u.s; rot += u.r; }
  const cs0 = csOf(e); let stab = null;
  if(cs0.stab > 0 && !o.noStab){ stab = stabAt(sources[e.src], srcPos(e, local)); scale *= 1 + 0.12*cs0.stab; }
  const G = csGeom(e, scale), c = G.c, dw = G.dw, dh = G.dh, [ccx, ccy] = csCam(e, local, c);
  if(stab){ x += stab[0]*dw*cs0.stab; y += stab[1]*dh*cs0.stab; }
  let px = W/2 - ccx*dw; px = panClamp(px, W, dw) + x;
  let py = H/2 - ccy*dh; py = panClamp(py, H, dh) + y;
  const rb = Math.max(W/G.sw, H/G.sh)*1.12, fade = csFade(c, local, e.end - e.start);
  let zb = o.noFx ? 0 : (kf(K.zblur,local) || 0);
  if(!o.noFx && rateAt(e, local) >= 1.8) zb += 0.35;   // motion blur when the shot runs fast
  const br = kf(K.bright,local);
  return { el:texOf(e, local), rect:[px,py,dw,dh], rot: rot*Math.PI/180, zb: zb + (o.zb||0), db: o.db || [0,0], rgb: (o.noFx ? 0 : (kf(K.rgb,local)||0)) + (o.rgb||0) + (ac ? ac.rgb : 0),
    expo, bright: (br===undefined ? 1 : br) * (e.type==='break' ? 0.88 : 1) * fade, alpha: (o.alpha ?? 1) * (u ? Math.max(0, Math.min(1, u.o)) : 1),
    off: u ? [u.x*W, u.y*H] : [0,0], clip: u ? 1 : 0, uo: u ? Math.max(0, Math.min(1, u.o)) : 1,
    tf: csMat(c), bg: !c.fit ? [0,0,0,-1] : c.bg === 'blur' ? [0,0,0,1] : [...hexRgb(c.bgc), 0], bgr: [W/2 - G.sw*rb/2, H/2 - G.sh*rb/2, G.sw*rb, G.sh*rb],
    bd: c.fit && c.bd > 0 ? [...hexRgb(c.bdc), c.bd*0.04*W] : [0,0,0,0], ad: [c.bri, c.con, c.sat, c.warm], ad2: [c.hi || 0, c.sh || 0, c.hue || 0, c.sharp || 0], be: c.beauty || 0 };
}
/* ---- Reverse: a shot played backwards ----
 * The preview plays it from its frames, decoded once at a small size (rc); the export decodes it forwards in windows of
 * a dozen frames (a ring of canvases, so a long or 4K shot never fills the memory) and hands them out backwards. ---- */
const REV_MAX = 8;   // seconds of clip a shot may play backwards
function revFrame(e, local){
  const rc = e.rc, st = srcPos(e, local), k = Math.max(0, Math.min(rc.frames.length - 1, Math.round((st - rc.a)/rc.dt)));
  return rc.frames[k] || e.el;
}
async function revCache(e){
  const need = e.sp.pos(e.end - e.start)*e.scaleR, key = e.src + '|' + e.in.toFixed(3) + '|' + need.toFixed(3);
  if(e.rc && e.rc.key === key) return;
  if(e.rc) e.rc.frames.forEach(f => f && f.close && f.close()); e.rc = null;
  const s = sources[e.src], mb = await loadMediabunny(), input = new mb.Input({ source: new mb.BlobSource(s.file), formats: mb.ALL_FORMATS });
  try{
    const track = await input.getPrimaryVideoTrack(), first = await track.getFirstTimestamp(), sc = Math.min(1, 480/Math.max(s.w, s.h));
    const sink = new mb.CanvasSink(track, { width: Math.max(16, Math.round(s.w*sc/2)*2), height: Math.max(16, Math.round(s.h*sc/2)*2), fit: 'fill', poolSize: 2 });
    const dt = 1/30, ts = []; for(let t = e.in; t <= e.in + need + 1e-6; t += dt) ts.push(first + Math.min(s.dur - 0.02, t));
    const frames = []; for await (const wc of sink.canvasesAtTimestamps(ts)) frames.push(wc ? await createImageBitmap(wc.canvas) : null);
    e.rc = { key, a: e.in, dt, frames };
  } finally { try{ input.dispose(); }catch(err){} }
}
async function shotReverse(){
  if(!edit.length || kind === 'talk') return false; stopAll();
  const i = segAt(pos), e = edit[i];
  if(e.cs && e.cs.rev){ shotSet({ rev: false }); if(e.rc){ e.rc.frames.forEach(f => f && f.close && f.close()); e.rc = null; } prepare(i, pos).then(redrawFrame); return true; }
  if(e.sp.pos(e.end - e.start)*e.scaleR > REV_MAX){ notify('This shot is too long to reverse (up to ' + REV_MAX + ' s of clip).'); return false; }
  shotSet({ rev: true }); tasks.start('rev', 'clips', 'Reversing the shot', 'Shot ' + (i + 1));
  try{ await revCache(e); tasks.done('rev', 'Shot ' + (i + 1) + ' plays backwards'); }
  catch(err){ console.warn('reverse', err); tasks.fail('rev', 'Could not read this clip backwards. The paused frame still shows it.'); }
  await prepare(i, pos); redrawFrame(); return true;
}
// reversed shots get their frames again when they change (Slip, Trim, a new mix) or a saved Reel opens
setInterval(() => { if(playing || exporting || recording) return; for(const e of edit) if(e.cs && e.cs.rev && !e._revBusy){
  const need = e.sp.pos(e.end - e.start)*e.scaleR, key = e.src + '|' + e.in.toFixed(3) + '|' + need.toFixed(3);
  if(!e.rc || e.rc.key !== key){ e._revBusy = true; revCache(e).catch(()=>{}).finally(() => { e._revBusy = false; }); break; } } }, 1500);
// export: the timestamps come newest first; each window is decoded oldest first, then handed out backwards
async function* revFramesExport(sink, tsDesc){
  const WIN = 12, ring = [];
  for(let a = 0; a < tsDesc.length; a += WIN){
    const asc = tsDesc.slice(a, a + WIN).reverse(), got = [];
    for(let j = 1; j < asc.length; j++) asc[j] = Math.max(asc[j], asc[j-1]);
    let j = 0;
    for await (const wc of sink.canvasesAtTimestamps(asc)){
      if(wc){ const c = ring[j] || (ring[j] = document.createElement('canvas')); if(c.width !== wc.canvas.width || c.height !== wc.canvas.height){ c.width = wc.canvas.width; c.height = wc.canvas.height; }
        c.getContext('2d').drawImage(wc.canvas, 0, 0); got[j] = c; } else got[j] = null;
      j++; }
    for(let q = got.length - 1; q >= 0; q--) yield got[q] ? { canvas: got[q] } : null;
  }
}
// mosaic and magnifier of the shot on screen: pixels (shared by both renderers)
function lensOf(e){ const c = csOf(e), W = out.width, H = out.height;
  return { mz: c.mz ? [c.mz.x*W, c.mz.y*H, c.mz.w*W, c.mz.h*H] : [0,0,0,0], mzc: c.mz ? Math.max(3, (c.mz.s || 0.035)*W) : 1,
    mg: c.mg ? [c.mg.x*W, c.mg.y*H, c.mg.r*W, Math.max(1.1, c.mg.z || 2)] : [0,0,0,1] }; }
/* ---- Beat shapes and beat effects: the shot shown through a shape that steps on its beats ----
 * boxgrow: a small box, bigger on the next beat, then the whole frame · grid: 2x2 (3x3 on long shots) windows open one a
 * beat · strips: 3 strips one a beat · circle / heartbeat / starbeat: the shape pulses on each beat · frame: the shot in
 * a white-edged frame on its own blurred copy, bumping on the beats · mirror, kaleido · triple: the shot three times,
 * one band a beat · vhs: retro tape. Shot without beats (talking): a step every 0.6 s. Drawn by the WebGL renderer. */
const SHAPE_K = { boxgrow:1, grid:2, strips:3, circle:4, heartbeat:5, starbeat:6, frame:7, mirror:8, kaleido:9, triple:10, vhs:11 };
const shotBeats = e => { const L = e.end - e.start, b = (e.beatsIn || []).filter(x => x > 0.08 && x < L - 0.05); if(b.length) return b; const o = []; for(let x = 0.6; x < L - 0.1; x += 0.6) o.push(x); return o; };
function shapeAt(e, local, B){
  const k = SHAPE_K[e.efx]; if(!k) return null;
  const W = out.width, H = out.height, bts = shotBeats(e), past = bts.filter(b => local >= b), n = past.length, since = n ? local - past[n-1] : local;
  const step = (levels) => { const a = levels[Math.min(n, levels.length - 1)], b0 = n ? levels[Math.min(n - 1, levels.length - 1)] : a*0.7, q = Math.min(1, since/0.16); return b0 + (a - b0)*EASE.outBack(q); };
  const bump = n ? Math.exp(-since/0.12) : 0;
  let lv = 1, cells = 0;
  if(k === 1) lv = step([0.4, 0.62, 0.84, 1]);
  else if(k === 2){ cells = (e.end - e.start) > 2.4 && bts.length >= 6 ? 3 : 2; lv = Math.min(cells*cells, 1 + n); }
  else if(k === 3){ cells = 3; lv = Math.min(3, 1 + n); }
  else if(k === 4) lv = 0.5*(1 + 0.14*bump);
  else if(k === 5) lv = 0.36*(1 + 0.16*bump);
  else if(k === 6) lv = 0.42*(1 + 0.16*bump);
  else if(k === 7) lv = 0.8*(1 + 0.035*bump);
  else if(k === 10) lv = Math.min(3, 1 + n);
  // the shape's centre: on the subject, kept so the shape stays in the frame
  let cx = W/2, cy = H/2;
  if(k === 1 || (k >= 4 && k <= 6)){ const [px,py,dw,dh] = B.rect, [ax, ay] = camAt(e, local), off = B.off || [0,0];
    const sx = px + ax*dw + off[0], sy = py + ay*dh + off[1], m = k === 1 ? lv*0.5 : 0.25;
    cx = Math.min(W*(1 - m), Math.max(W*m, sx)); cy = Math.min(H*(1 - m), Math.max(H*m, sy)); }
  return { a: [k, lv, cx, cy], b: [cells, 0, 0, 0] };
}
// beat effects that ride on the picture's own settings: an RGB split or a blur on each beat
function beatFxOf(e, local){
  if(e.efx !== 'rgbpulse' && e.efx !== 'blurpulse' && e.efx !== 'vhs') return null;
  if(e.efx === 'vhs') return { rgb: 5 + 3*Math.abs(Math.sin(local*7)), zb: 0 };
  let r = 0; for(const b of shotBeats(e)){ const d = local - b; if(d >= 0 && d < 0.4) r = Math.max(r, Math.exp(-d/0.09)); }
  return e.efx === 'rgbpulse' ? { rgb: 18*r, zb: 0 } : { rgb: 0, zb: 1.4*r };
}
function drawFrameGL(t){
  const W=out.width, H=out.height, i = segAt(t), e = edit[i], local = t - e.start, pe = edit[i-1], pl = pe ? pe.end-pe.start : 0;
  const d = TR_DUR[e.tr] || 0, p = d ? Math.min(1, local/d) : 1, q = EASE.outCubic(p);
  const S = { mode:0, prog:p, mix:1, time:t, grade:{...GRADES[look]}, A:null, B:null, lens: lensOf(e) };
  S.grade.vig = (kf(e.kf && e.kf.vig, local) ?? (look === 'copy' ? (GRADES.copy.vig || 0) : (GRADES[look].vig ?? 0.22))) + (csOf(e).vig || 0)*0.9;
  const inTr = p < 1 && (pe || e.tr==='fadein');
  if(inTr && pe) S.A = layerOf(pe, pl, {noFx:true});
  S.B = layerOf(e, local);
  { const bf = beatFxOf(e, local); if(bf){ S.B.rgb += bf.rgb; S.B.zb += bf.zb; } }
  S.shp = shapeAt(e, local, S.B);
  if(e.efx === 'strobe'){ const bts = shotBeats(e).filter(b => local >= b), d = bts.length ? local - bts[bts.length-1] : 9; if(d < 0.1){ S.grade.mono = 1; S.flash = Math.max(S.flash||0, 0.3*(1 - d/0.1)); S.grade.con *= 1.25; } }
  if(inTr){
    switch(e.tr){
      case 'whip': { const blur = 0.09*W*Math.sin(Math.PI*q); S.A = layerOf(pe, pl, {dx:-q*W, db:[blur,0], noFx:true}); S.B = layerOf(e, local, {dx:(1-q)*W, db:[blur,0]}); S.mode = 3; break; }
      case 'zoom': S.A = layerOf(pe, pl, {scale:1+0.9*p*p, zb:1.2, noFx:true}); S.B = layerOf(e, local, {scale:1.6-0.6*q, zb:1-q}); S.mode = 1; S.mix = q; break;
      case 'spin': S.A = layerOf(pe, pl, {rot:90*p*p, scale:1+0.5*p, zb:0.8, noFx:true}); S.B = layerOf(e, local, {rot:-90*(1-q), scale:1.5-0.5*q, zb:1-q}); S.mode = 1; S.mix = q; break;
      case 'glitch': S.B = layerOf(e, local, {rgb:22*(1-p)}); S.mode = 5; break;
      case 'iris': { const [px,py,dw,dh] = S.B.rect, [ccx,ccy] = camAt(e, local); S.mode = 6; S.prog = p; S.iris = [px+ccx*dw+S.B.off[0], py+ccy*dh+S.B.off[1]]; break; }
      case 'wipe': S.mode = 7; S.prog = p; break;
      case 'bars': S.mode = 8; S.prog = p; break;
      case 'diamond': case 'heart': case 'star': { const [px,py,dw,dh] = S.B.rect, [ccx,ccy] = camAt(e, local); S.mode = {diamond:9, heart:10, star:11}[e.tr]; S.prog = p; S.iris = [px+ccx*dw+S.B.off[0], py+ccy*dh+S.B.off[1]]; break; }
      case 'dip': S.mode = 2; S.prog = EASE.inOut(p); break;
      case 'slideleft': case 'slideright': { const sg = e.tr === 'slideleft' ? -1 : 1; S.A = layerOf(pe, pl, {dx:sg*q*W, noFx:true}); S.B = layerOf(e, local, {dx:-sg*(1-q)*W}); S.mode = 3; break; }
      case 'slideup': case 'slidedown': { const sg = e.tr === 'slideup' ? -1 : 1; S.A = layerOf(pe, pl, {dy:sg*q*H, noFx:true}); S.B = layerOf(e, local, {dy:-sg*(1-q)*H}); S.mode = 3; break; }
      case 'swipeup': { const k = EASE.outExpo(p), bl = 0.08*H*Math.sin(Math.PI*p); S.A = layerOf(pe, pl, {dy:-k*H, db:[0,bl], noFx:true}); S.B = layerOf(e, local, {dy:(1-k)*H, db:[0,bl]}); S.mode = 3; break; }
      case 'zoomout': S.A = layerOf(pe, pl, {scale:1-0.45*p, zb:0.6*p, noFx:true}); S.B = layerOf(e, local, {scale:1.3-0.3*q}); S.mode = 1; S.mix = q; break;
      case 'blur': S.A = layerOf(pe, pl, {zb:2.2*p, noFx:true}); S.B = layerOf(e, local, {zb:2.2*(1-q)}); S.mode = 1; S.mix = EASE.inOut(p); break;
      case 'flip': { const first = p < 0.5, X = first ? layerOf(pe, pl, {noFx:true}) : S.B, k = first ? 1 - 2*p : 2*p - 1, [x, y, w, h] = X.rect;
        X.rect = [W/2 - (W/2 - x)*k, y, Math.max(1, w*k), h]; X.clip = 1; S.B = X; S.A = null; S.mode = 0; break; }
      case 'luma': S.mode = 12; S.prog = EASE.inOut(p); break;
      case 'pixelate': S.mode = 13; S.prog = p; break;
      case 'clock': S.mode = 14; S.prog = EASE.inOut(p); break;
      case 'doors': S.mode = 15; S.prog = EASE.outCubic(p); break;
      case 'ripple': S.mode = 16; S.prog = p; break;
      case 'burn': S.mode = 1; S.mix = EASE.inOut(p); S.leak = [W*0.55, H*0.4, 1.5*Math.sin(Math.PI*p)]; S.flash = 0.25*Math.sin(Math.PI*p); break;
      case 'dropin': S.A = layerOf(pe, pl, {noFx:true}); S.B = layerOf(e, local, {dy:-(1 - EASE.outBack(p))*H}); S.mode = 3; break;
      case 'dissolve': S.mode = 1; S.mix = EASE.inOut(p); break;
      case 'fadein': S.mode = 1; S.mix = q; if(!pe) S.A = null; break;
      case 'flash': S.flash = 0.85*Math.pow(1-p,2); if(e.efx!=='snap') S.B.expo += Math.max(0, 1-p*1.6); break;
    }
  }
  if(e.efx==='snap' && local < SNAP_T+0.16){
    const k = EASE.outCubic(Math.max(0,(local-SNAP_T)/0.16)), sc = 0.84+0.16*k;
    const full = layerOf(e, local), [px,py,dw,dh] = full.rect;
    // shrink the visible frame (not the picture) like a printed photo, tilted, on a blurred backdrop
    const cxw = W/2, cyh = H/2;
    S.B.rect = [cxw + (px-cxw)*sc, cyh + (py-cyh)*sc, dw*sc, dh*sc];
    S.B.rot = (-3*(1-k))*Math.PI/180; S.snap = true; S.border = W*0.025*(1-k);
    S.frR = [cxw - W*sc/2, cyh - H*sc/2, W*sc, H*sc];
    S.bgR = layerOf(e, local, {scale:1.15, noFx:true}).rect; S.bgDark = 0.55*(1-k);
    // the photo must not show outside the canvas-sized frame: clip by forcing the border area around the frame
    if(local < 0.12) S.flash = Math.max(S.flash||0, 0.9*(1-local/0.12));
  }
  if(e.type==='drop' && local < 0.7){ const lq = local/0.7; S.leak = [-0.3*W + lq*1.6*W, H*0.35, 0.38*(1-lq)]; }
  const dur = buf.duration; if(loopImg && t > dur-0.4){ S.loopMix = EASE.inOut((t-(dur-0.4))/0.4); S.loopImg = loopImg; }
  GL.render(S); if(playing && (Math.floor(t*10)%3===0)) drawTimeline();
  og.globalCompositeOperation='source-over'; og.globalAlpha=1; og.drawImage(GL.canvas, 0, 0);
  if(layers.length) drawLayers(og, t);
  if(holdText) return;
  bgPass(t); drawText(t);
  if(showSafe && !recording && !coverMode) drawSafe();
  if(!exporting){ $('prog').style.width = (t/buf.duration*100).toFixed(2)+'%';
    const rows = $('edl').children; if(rows[i] && !rows[i].classList.contains('cur')){ [...rows].forEach(r=>r.classList.remove('cur')); rows[i].classList.add('cur'); } }
}
function drawFrame(t){ if(!edit.length){ og.fillStyle='#000'; og.fillRect(0,0,out.width,out.height); return; } if(GL && !GL.lost) drawFrameGL(t); else drawFrame2D(t);
  if(!exporting && !recording && kfOpen()) kfSoon(); }

let coverMode=false;
let playing=false, src=null, startedAt=0, startOff=0, pos=0, curIdx=-1, timer=0, recording=false, latencyOn=true;
function curTime(){ if(!playing) return pos; const lat = latencyOn ? (ctx.outputLatency||ctx.baseLatency||0) : 0; return startOff + ctx.currentTime - startedAt - lat; }
// button labels: the text beside the button's icon (the icon stays)
function setLabel(id, t){ const el = $(id); if(!el) return; const sp = el.querySelector('span'); if(sp) sp.textContent = t;
  else { const tn = [...el.childNodes].reverse().find(n => n.nodeType === 3 && n.textContent.trim()); if(tn) tn.textContent = t; else el.append(t); } }
const PLAY_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';
const PAUSE_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>';
function setPlayLabel(on){ $('play').innerHTML = (on ? PAUSE_SVG : PLAY_SVG) + '<span>' + (on ? 'Pause' : 'Preview') + '</span>'; }
function stopAll(){ stopPart(); stopLayers(); playing=false; if(src){ const s=src; src=null; try{s.stop();}catch(e){} } clearInterval(timer); cancelAnimationFrame(rafId); edit.forEach(e=>e.el.pause()); setPlayLabel(false); }
let rafId=0;
async function startPlayback(from, destNode){
  stopAll();
  const c = getCtx(); await c.resume(); await ensureMix();
  edit.forEach(x=>{ x._cued = false; });
  curIdx = segAt(from); if(edit[curIdx-1]) await prepare(curIdx-1, edit[curIdx-1].end-0.01); await prepare(curIdx, from); if(edit[curIdx+1]) prepare(curIdx+1, edit[curIdx+1].start);
  const s = c.createBufferSource(); s.buffer = buf;
  // loudness: bring the song to about -14 LUFS (social media level), limiter stops clipping, tiny fades stop clicks
  const g = c.createGain(), lim = c.createDynamicsCompressor();
  lim.threshold.value = -1.5; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.08;
  const now = c.currentTime, endAt = now + (buf.duration - from);
  g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(normGain, now+0.02);
  g.gain.setValueAtTime(normGain, Math.max(now+0.03, endAt-0.25)); g.gain.linearRampToValueAtTime(0.0001, endAt);
  s.connect(g); g.connect(lim);
  if(destNode){ lim.connect(destNode); } lim.connect(c.destination);
  s.start(0, from); src = s; startedAt = c.currentTime; startOff = from; playing = true;
  edit[curIdx].el.play().catch(()=>{});
  setPlayLabel(true);
  s.onended = () => { if(src===s){ src=null; playing=false; pos=0; edit.forEach(e=>e.el.pause()); setPlayLabel(false); onEnd && onEnd(); } };
  const loop = () => {
    if(!playing) return;
    const t = Math.max(0, curTime()), i = segAt(t);
    if(i !== curIdx){
      const prevEl = edit[curIdx]?.el; curIdx = i; const e = edit[i], l = t-e.start;
      const r1 = rateAt(e, l), want = srcPos(e, l);
      if(Math.abs(e.el.currentTime-want) > 0.12) e.el.currentTime = want;
      if(r1>0){ e.el.playbackRate = r1; e.el.play().catch(()=>{}); } else e.el.pause();
      if(prevEl && prevEl!==e.el) prevEl.pause();     // stays on its last frame for the transition
      if(edit[i+1]) prepare(i+1, edit[i+1].start);
    } else {
      const e = edit[i], l = t-e.start, r = rateAt(e, l), want = srcPos(e, l);
      if(e.cs && e.cs.rev){ if(!e.el.paused) e.el.pause(); if(!e.rc && Math.abs(e.el.currentTime-want) > 0.12) e.el.currentTime = want; }
      else if(r===0){ if(!e.el.paused) e.el.pause(); if(Math.abs(e.el.currentTime-want) > 0.05) e.el.currentTime = want; }   // freeze frame
      else {   // speed ramps + gentle catch-up: nudge the speed a little instead of jumping (a jump shows as a hitch)
        const diff = want - e.el.currentTime;
        if(Math.abs(diff) > 0.45) e.el.currentTime = want;
        const nr = Math.max(0.0625, Math.min(16, r * (1 + Math.max(-0.2, Math.min(0.2, diff*1.2)))));
        if(Math.abs(e.el.playbackRate - nr) > 0.01) e.el.playbackRate = nr;
        if(e.el.paused) e.el.play().catch(()=>{}); }
      // the shot after next is cued once this one's transition is over (its player may be the one that transition used)
      const n2 = edit[i+2];
      if(n2 && !n2._cued && l > (TR_DUR[e.tr]||0) + 0.05){ n2._cued = true; prepare(i+2, n2.start); }
    }
    if(layers.length) syncLayers(t);
    drawFrame(t);
  };
  const raf = () => { loop(); if(playing) rafId = requestAnimationFrame(raf); };
  rafId = requestAnimationFrame(raf);
  timer = setInterval(()=>{ if(document.hidden) loop(); }, 33);
}
let onEnd = null;
$('play').onclick = () => { if(recording) return; if(playing){ pos = curTime(); stopAll(); } else startPlayback(pos >= buf.duration-0.05 ? 0 : pos); };

/* =============== EXPORT =============== */
function pickMime(){
  const c = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'];
  for(const m of c) if(window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
  return '';
}
const _sm=0;
// On a phone the video goes to the share sheet ("Save Video" puts it in Photos, or straight to Instagram); a download would
// land in Files on an iPhone, where Instagram cannot see it. Sharing needs a tap, so a button appears for it. Computers
// download it as before.
let savedUrl = null;
/* ---- the post's caption: a first line and hashtags that fit the Reel (its template, song, hook), ready to paste ----
 * Made on the phone from what the Reel already is; the person can change it, and what they write is kept while they stay. */
const CAP_TPL = {
  montage: ['', '#reels #reelsinstagram #trending #beatsync #explorepage'],
  beforeafter: ['Wait for the after ✨', '#beforeandafter #transformation #reels #reelsinstagram'],
  talking: ['', '#reels #creator #reelsindia #talkinghead'],
  tutorial: ['Save this for later 📌', '#tutorial #howto #learnoninstagram #reels'],
  product: ['New arrival ✨ DM to order 📩', '#newarrival #shopnow #smallbusiness #dmtoorder #reels'],
  recipe: ['Easy recipe 🍳 Save it for later!', '#recipe #easyrecipe #foodreels #homecooking #reels'],
  travel: ['📍', '#travel #travelreels #explore #wanderlust #reels'],
  ganpati: ['गणपती बाप्पा मोरया 🌺', '#ganpati #ganeshchaturthi #ganpatibappamorya #bappa #reels'],
  diwali: ['शुभ दीपावली 🪔', '#diwali #happydiwali #festivaloflights #reels'],
};
let tplName = '', capEdited = false;
function captionOf(){
  const t = CAP_TPL[tplName] || ['', kind === 'talk' ? '#reels #creator #reelsindia' : '#reels #reelsinstagram #trending #explorepage'];
  const tplHook = tplName && TEMPLATES[tplName] ? TEMPLATES[tplName].hook : undefined;
  const hook = hookText && hookText !== tplHook ? hookText.trim() : '';
  const songName = kind !== 'talk' && song && song.name ? song.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() : '';
  const lines = [];
  if(hook) lines.push(hook === hook.toUpperCase() ? hook.charAt(0) + hook.slice(1).toLowerCase() : hook);   // the screen's CAPITALS read as shouting in a caption
  if(t[0]) lines.push(t[0]);
  if(songName && !/^(audio|song|track|music|rec|recording|voice)\s*\d*$/i.test(songName)) lines.push('🎵 ' + songName);
  if(!lines.length) lines.push('✨');
  return lines.join('\n') + '\n\n' + t[1];
}
function fillCaption(){
  const box = $('postcap'); if(!box) return;
  box.hidden = false; if(!capEdited) $('postcapt').value = captionOf(); $('postcapst').textContent = '';
}
async function copyCaption(text, sharing){
  let ok = false;
  try{ await navigator.clipboard.writeText(text); ok = true; }catch(e){
    try{ const ta = $('postcapt'); ta.focus(); ta.select(); ok = document.execCommand('copy'); }catch(e2){} }
  $('postcapst').textContent = ok ? (sharing ? 'Caption copied: paste it in Instagram' : 'Copied ✓') : 'Select the text and copy it';
  if(ok && sharing) notify('Caption copied: paste it when you post', 'ok');
  return ok;
}
let lastVideo = null;
let exportKeep = false, exportP = 0, lastName = '';
function saveFile(blob, name){
  if(/^video\//.test(blob.type)){ lastVideo = blob; fillCaption(); rememberTools(); }
  if(exportKeep){ lastName = name; return false; }
  const file = new File([blob], name, { type: blob.type });
  const phone = matchMedia('(pointer: coarse)').matches;
  let canShare = false; try{ canShare = phone && !!navigator.canShare && navigator.canShare({ files: [file] }); }catch(e){}
  if(savedUrl) URL.revokeObjectURL(savedUrl);
  savedUrl = URL.createObjectURL(blob);
  $('dlvid').href = savedUrl; $('dlvid').download = name;   // the made file, also for the Create flow's "Reel Exported" screen (flow.ts)
  if(canShare){
    $('saverow').hidden = false;
    $('savevid').textContent = /^image\//.test(blob.type) ? 'Save to Photos / Share' : 'Save video to Photos / Share';
    $('savevid').onclick = async () => {
      // the caption goes along (WhatsApp puts it under the video) and to the clipboard (Instagram: paste it)
      const isVid = /^video\//.test(blob.type), text = isVid ? $('postcapt').value.trim() : '';
      if(text){ copyCaption(text, true); }
      const data = text ? { files: [file], title: name, text } : { files: [file], title: name };
      try{ await navigator.share(data); }
      catch(err){
        if(err && err.name === 'AbortError') return;
        if(text){ try{ await navigator.share({ files: [file], title: name }); return; }catch(e2){ if(e2 && e2.name === 'AbortError') return; } }   // an app that takes no text with a file
        $('dlvid').click();
      }
    };
    return true;
  }
  const a = document.createElement('a');
  a.href = savedUrl; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  return false;
}
const savedMsg = (shared, what) => shared ? what + ' is ready: tap the button below to save it to Photos or share it.' : what + ' saved';
function showMsg(t, err){ const m=$('xmsg'); m.hidden=false; m.textContent=t; m.classList.toggle('err', !!err); if(err) notify(t, 'err'); }
// a short note that pops up at the bottom and goes away by itself (errors stay a little longer)
function notify(t, kind){
  const box = $('toasts'); if(!box || !t) return;
  const n = document.createElement('div'); n.className = 'toast' + (kind ? ' ' + kind : ''); n.textContent = t;
  box.appendChild(n); while(box.children.length > 3) box.firstChild.remove();
  requestAnimationFrame(() => n.classList.add('in'));
  setTimeout(() => { n.classList.remove('in'); setTimeout(() => n.remove(), 300); }, kind === 'err' ? 6000 : 3500);
}
// a yes / no question inside the studio (instead of the browser's own box)
function askConfirm(text, okLabel){
  return new Promise(res => {
    const d = document.createElement('div'); d.className = 'askbg';
    d.innerHTML = '<div class="ask" role="alertdialog" aria-modal="true"><p></p><div class="askrow"><button type="button" class="btn">Cancel</button><button type="button" class="btn danger"></button></div></div>';
    d.querySelector('p').textContent = text;
    const [no, yes] = d.querySelectorAll('button'); yes.textContent = okLabel;
    const key = e => { if(e.key === 'Escape') done(false); };
    const done = v => { d.remove(); removeEventListener('keydown', key); res(v); };
    no.onclick = () => done(false); yes.onclick = () => done(true); d.onclick = e => { if(e.target === d) done(false); };
    addEventListener('keydown', key); root.appendChild(d); yes.focus();
  });
}
// Real-time recording: only when this browser has no WebCodecs encoder (older Firefox / Safari)
async function recordExport(){
  const mime = pickMime();
  if(!mime || !out.captureStream){ showMsg('This browser cannot save videos. Please open the studio in Chrome or Safari.', true); return; }
  recording = true; latencyOn = false; ['play','remix','export','cover'].forEach(id=>$(id).disabled=true);
  setCanvas(true, XQ[xq.res].scale); await captureLoop();
  showMsg('Saving your Reel in real time on this browser (' + fmt(buf.duration) + '). Please keep this screen open.');
  tasks.start('export', 'export', 'Exporting your Reel', 'In real time on this browser · keep this screen open');
  { const t0 = performance.now(), D = buf.duration*1000, tick = setInterval(() => { if(!recording){ clearInterval(tick); return; } tasks.update('export', Math.min(0.99, (performance.now()-t0)/D)); }, 500); }
  const c = getCtx(); await c.resume();
  const dest = c.createMediaStreamDestination();
  const stream = new MediaStream([...out.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const rec = new MediaRecorder(stream, {mimeType:mime, videoBitsPerSecond: 12_000_000, audioBitsPerSecond: 256_000});
  const chunks = []; rec.ondataavailable = e=>{ if(e.data.size) chunks.push(e.data); };
  const done = new Promise(r=>rec.onstop=r);
  rec.start(500);
  onEnd = () => { onEnd=null; setTimeout(()=>rec.stop(), 150); };
  const keepBuf = buf, keepNorm = normGain; if(noSong){ const sd = exportSound(); buf = sd ? sd.buf : c.createBuffer(2, Math.ceil(keepBuf.duration*c.sampleRate), c.sampleRate); normGain = sd ? sd.gain : 1; }
  pos = 0; try{ await startPlayback(0, dest); await done; } finally { buf = keepBuf; normGain = keepNorm; }
  recording = false; latencyOn = true; ['play','remix','export','cover'].forEach(id=>$(id).disabled=false);
  const ext = mime.includes('mp4') ? 'mp4' : 'webm';
  const blob = new Blob(chunks, {type: mime.split(';')[0]});
  const name = 'reel-' + aspect.replace(':','x') + '-1080p.' + ext;
  setCanvas(false); captureLoop();
  const sh = saveFile(blob, name); tasks.done('export', 'Your Reel is ready · ' + (blob.size/1e6).toFixed(1) + ' MB'); notify('Your Reel is ready', 'ok'); showMsg(savedMsg(sh, 'Video') + ': '+name+' ('+(blob.size/1e6).toFixed(1)+' MB). Ready for Instagram, TikTok and Shorts.');}

// Fast export: every frame is decoded (WebCodecs, through mediabunny), drawn and encoded off-screen, faster than real
// time and frame-accurate (no dropped frames). The sound goes through the same gain + limiter as the preview.
// "Export without the song": for adding the same song as Instagram's own sound (trending audio, which this app may not
// include). The voice stays (talking videos, voiceovers); with nothing else there is no sound track at all. The message
// says which song and from where, so the beat cuts line up when the sound is added in Instagram.
let noSong = false;
function exportSound(){
  if(!noSong) return { buf, gain: normGain };
  const c = getCtx();
  const one = (x, sr, g) => { const b = c.createBuffer(2, x.length, sr); for(let k=0;k<2;k++){ const d = b.getChannelData(k); for(let i=0;i<x.length;i++) d[i] = x[i]*g; } return { buf: b, gain: 1 }; };
  if(kind === 'talk' && talk) return one(talk.voice, talk.sr, 1);
  if(vo){ let s2 = 0, n = 0; for(let i=0;i<vo.pcm.length;i+=4){ const x = vo.pcm[i]; if(Math.abs(x) > 0.01){ s2 += x*x; n++; } } return one(vo.pcm, vo.sr, 0.2/Math.max(0.003, Math.sqrt(s2/Math.max(1, n)))); }
  return null;
}
function noSongTip(){
  if(kind === 'talk') return 'your voice is in the video; add any song as Instagram\'s sound, quietly under it.';
  const nm = song ? song.name.replace(/\.[^.]+$/, '') : 'the song';
  return 'in Instagram tap "Add audio", choose "' + nm + '" and start it at ' + fmt(secStart).replace(/\.\d+$/, '') + (vo ? ' (your voiceover is in the video)' : '') + ' — the cuts land on its beats.';
}
$('nosong').addEventListener('change', e => { noSong = e.target.checked; }, SIG);
// a check that may never answer on some browsers gets a time limit (then the export takes the other way)
const inTime = (p, ms, fallback) => Promise.race([Promise.resolve(p).catch(() => fallback), new Promise(r => setTimeout(() => r(fallback), ms))]);
async function fastExport(){
  if(!window.VideoEncoder || !window.OfflineAudioContext) return false;
  tasks.update('export', null, 'Getting the encoder ready');
  const mb = await loadMediabunny();
  // Safari before 26 (iPhone iOS 16.4-18) encodes video but has no AAC encoder: a small WebAssembly AAC encoder stands in,
  // so the file is still the H.264 + AAC MP4 Instagram wants
  // asked with the exact settings: some browsers have AAC but not at 256 kbps stereo 48 kHz (then the export used to fail)
  const AUD = { numberOfChannels: 2, sampleRate: 48000, bitrate: 256e3 };
  if(loadAacEncoder && !(await inTime(mb.canEncodeAudio('aac', AUD), 8000, false))){
    try{ const m = await inTime(loadAacEncoder(), 15000, null); if(m && !loadAacEncoder.done){ m.registerAacEncoder(); loadAacEncoder.done = true; } else if(!m) console.warn('AAC encoder did not load in time'); }catch(err){ console.warn('AAC encoder unavailable', err); }
  }
  const [W, H] = exportDims(), fps = xq.fps, dur = buf.duration;
  // H.264 + AAC in MP4 (what Instagram wants); browsers without an H.264 encoder get VP9 + Opus in WebM
  const vcodec = await inTime(mb.getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'], {width:W, height:H}), 10000, null);
  if(!vcodec) return false;
  const mp4 = vcodec === 'avc';
  const acodec = await inTime(mb.getFirstEncodableAudioCodec(mp4 ? ['aac', 'opus'] : ['opus'], AUD), 10000, null);
  if(!acodec){ console.warn('fast export: no audio encoder for', vcodec); return false; }
  console.info('fast export:', vcodec, acodec, W + 'x' + H, fps + ' fps');
  stopAll();
  recording = true; latencyOn = false; ['play','remix','export','cover'].forEach(id=>$(id).disabled=true);
  setCanvas(true, XQ[xq.res].scale); await captureLoop();   // export size; the loop-back frame at that size too
  const t0 = performance.now();
  showMsg('Exporting… 0%');
  tasks.update('export', null, XQ[xq.res].label + ' · ' + xq.fps + ' fps · keep this screen on');
  const inputs = [];
  let pre = null;   // the next shot's decoder, seeking ahead (finished before the decoders are let go)
  try{
    // sound: rendered offline, the same chain as the preview (loudness, limiter, tiny fades)
    await ensureMix();
    const snd = exportSound(), sr = 48000, oc = new OfflineAudioContext(2, Math.ceil(dur*sr), sr);
    const sn = oc.createBufferSource(); sn.buffer = snd ? snd.buf : oc.createBuffer(2, Math.ceil(dur*sr), sr);
    const g = oc.createGain(), lim = oc.createDynamicsCompressor();
    lim.threshold.value = -1.5; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.08;
    const eg = snd ? snd.gain : 1;
    g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(eg, 0.02);
    g.gain.setValueAtTime(eg, Math.max(0.03, dur-0.25)); g.gain.linearRampToValueAtTime(0.0001, dur);
    sn.connect(g); g.connect(lim); lim.connect(oc.destination); sn.start(0);
    tasks.update('export', null, 'Mixing the sound');
    const audio = snd ? await oc.startRendering() : null;
    tasks.update('export', 0, 'Putting your Reel together · keep this screen on');
    const chunkOf = (k) => { // one second of the sound as its own AudioBuffer (fed in step with the picture)
      const a = Math.round(k*sr), b = Math.min(audio.length, Math.round((k+1)*sr)); if(b<=a) return null;
      const ab = new AudioBuffer({length:b-a, numberOfChannels:2, sampleRate:sr});
      for(let c=0;c<2;c++) ab.copyToChannel(audio.getChannelData(Math.min(c, audio.numberOfChannels-1)).subarray(a,b), c);
      return ab; };

    const output = new mb.Output({ format: mp4 ? new mb.Mp4OutputFormat({ fastStart: 'in-memory' }) : new mb.WebMOutputFormat(), target: new mb.BufferTarget() });
    const vs = new mb.CanvasSource(out, { codec: vcodec, bitrate: XQ[xq.res].bitrate * (fps > 30 ? 1.5 : 1), keyFrameInterval: 2 });
    const as = audio ? new mb.AudioBufferSource({ codec: acodec, bitrate: 256e3 }) : null;   // no sound at all: no audio track
    output.addVideoTrack(vs, { frameRate: fps });
    if(as) output.addAudioTrack(as);
    await output.start();

    // Two decoders per clip (shots alternate between them), frames scaled to what the output needs (not the full 4K),
    // each with a small ring of reused canvases. While a shot is drawn, the next shot's decoder already seeks to its
    // first frame: phone video has a keyframe only every 1-2 s, so that seek is the slow part of a cut.
    // At most a few decoders live at once: each holds a ring of full-size canvases, and iPhone Safari caps the memory all
    // canvases of a page may use (a Reel from ten clips would pass it); the ones not used for longest are let go.
    const sinks = new Map(), LIVE = 4;
    const sinkFor = async (si, slot) => {
      const key = si + ':' + slot;
      if(sinks.has(key)){ const v = sinks.get(key); sinks.delete(key); sinks.set(key, v); }   // most recently used last
      else {
        while(sinks.size >= LIVE){ const [k0, old] = sinks.entries().next().value; sinks.delete(k0); try{ old.input.dispose(); }catch(err){} const ii = inputs.indexOf(old.input); if(ii >= 0) inputs.splice(ii, 1); }
        const s0 = sources[si], input = new mb.Input({ source: new mb.BlobSource(s0.file), formats: mb.ALL_FORMATS }); inputs.push(input);
        const track = await input.getPrimaryVideoTrack();
        const r = Math.min(1, Math.max(W/s0.w, H/s0.h)*1.3);
        let sfps = 30; try{ const stt = await track.computePacketStats(90); if(stt && stt.averagePacketRate > 1) sfps = stt.averagePacketRate; }catch(err){}
        sinks.set(key, { input, sink: new mb.CanvasSink(track, { width: Math.max(16, Math.round(s0.w*r/2)*2), height: Math.max(16, Math.round(s0.h*r/2)*2), fit: 'fill', poolSize: 4 }), first: await track.getFirstTimestamp(), half: 0.5/sfps });
      }
      return sinks.get(key);
    };
    // video layers: one decoder each, its frames asked for in time order (one per output frame while it shows)
    const lyIts = [];
    for(const L of layers){ const M = lmedia[L.m]; if(!M || M.kind !== 'video') continue;
      const input = new mb.Input({ source: new mb.BlobSource(M.file), formats: mb.ALL_FORMATS }); inputs.push(input);
      const track = await input.getPrimaryVideoTrack(); if(!track) continue;
      const r = Math.min(1, (L.s*W)/M.w*1.4), first = await track.getFirstTimestamp();
      const sink = new mb.CanvasSink(track, { width: Math.max(16, Math.round(M.w*r/2)*2), height: Math.max(16, Math.round(M.h*r/2)*2), fit: 'fill', poolSize: 3 });
      const k0 = Math.ceil(L.t0*fps - 1e-6), k1 = Math.min(Math.round(dur*fps), Math.ceil(L.t1*fps - 1e-6)), ts = [];
      for(let k=k0;k<k1;k++){ const v = first + Math.min(M.dur - 0.05, Math.max(0, lyTime(L, k/fps))); ts.push(ts.length ? Math.max(v, ts[ts.length-1]) : v); }
      lyIts.push({ L, k0, k1, it: sink.canvasesAtTimestamps(ts)[Symbol.asyncIterator]() }); }
    const layerFrames = async (k) => { for(const q of lyIts){ if(k < q.k0 || k >= q.k1) continue; const r = await q.it.next(); if(!r.done && r.value) q.L.fc = r.value.canvas; } };
    exporting = true;
    const total = Math.round(dur*fps);
    // the frames of every shot: a frame belongs to the shot showing at its time (the same rule as drawFrame)
    const shots = []; { let f0 = 0; edit.forEach((e,i)=>{ const fEnd = i+1 < edit.length ? Math.min(total, Math.ceil(edit[i+1].start*fps - 1e-6)) : total; shots.push({ f0, fEnd }); f0 = fEnd; }); }
    const open = async (i) => {
      const e = edit[i], sh = shots[i]; if(!e || sh.fEnd <= sh.f0) return null;
      const { sink, first, half } = await sinkFor(e.src, i % 2), sdur = sources[e.src].dur, ts = [];
      for(let k=sh.f0; k<sh.fEnd; k++){ const v = first + half + Math.min(Math.max(0, srcPos(e, Math.max(0, k/fps - e.start))), sdur - 2*half - 0.01); ts.push(!ts.length ? v : e.cs && e.cs.rev ? Math.min(v, ts[ts.length-1]) : Math.max(v, ts[ts.length-1])); }
      const it = (e.cs && e.cs.rev ? revFramesExport(sink, ts) : sink.canvasesAtTimestamps(ts))[Symbol.asyncIterator]();
      const firstP = it.next(); firstP.catch(()=>{});
      return { it, firstP, ts, sink, first };
    };
    // yield to the page without timers (a hidden tab throttles setTimeout to once a second or less)
    const yieldNow = () => (globalThis.scheduler && scheduler.yield) ? scheduler.yield() : new Promise(r => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0); });
    let f = 0, nextAudio = 0; const prof = root.__prof = { decode:0, draw:0, encode:0, frames:0, glLostFrames:0, missing:0 }; let tq = performance.now();
    const tStart = performance.now();
    pre = open(0);
    for(let i=0; i<edit.length; i++){
      const e = edit[i], sh = shots[i], cur = await pre; pre = null;
      if(!cur){ pre = open(i+1); continue; }
      let k = sh.f0, r = await cur.firstP;
      pre = open(i+1);   // the next shot starts seeking now, while this one is drawn
      while(!r.done){
        const wc = r.value;
        const ta = performance.now(); prof.decode += ta - tq;
        if(wc) e.fc = wc.canvas; else prof.missing++;
        if(!wc && !e.fc){   // no frame for this time (variable frame rate, an edit list gap): take the nearest real one, never the previous shot
          const g = (await cur.sink.getCanvas(cur.ts[k-sh.f0] + 0.05)) || (await cur.sink.getCanvas(cur.first + 0.02));
          if(g) e.fc = g.canvas;
        }
        if(GL && GL.lost) prof.glLostFrames++;
        if(lyIts.length) await layerFrames(k);
        if(bgNeeded() && personMask){ holdText = true; try{ drawFrame(k/fps); } finally { holdText = false; } await maskNow(); bgPass(k/fps); drawText(k/fps); }
        else drawFrame(k/fps);
        const tb = performance.now(); prof.draw += tb - ta;
        await vs.add(k/fps, 1/fps);
        tq = performance.now(); prof.encode += tq - tb; prof.frames++;
        while(as && nextAudio <= k/fps + 1 && nextAudio*1 < dur){ const ab = chunkOf(nextAudio); if(ab) await as.add(ab); nextAudio++; }
        k++;
        if(k % 15 === 0){
          const done = k/total, el = (performance.now()-tStart)/1000, left = done > 0.03 ? el/done - el : null;
          $('xmsg').textContent = 'Exporting… ' + Math.round(done*100) + '%' + (left !== null ? ' · about ' + (left < 60 ? Math.ceil(left) + ' s' : Math.ceil(left/60) + ' min') + ' left' : '') + (document.hidden ? '' : ' · keep this screen on');
          $('prog').style.width = (done*100).toFixed(1) + '%';
          tasks.update('export', done, done < 0.95 ? 'Putting your Reel together · keep this screen on' : 'Finishing the video file'); exportP = done;
          await yieldNow();
        }
        r = await cur.it.next();
      }
      if(e.fc){ const c = document.createElement('canvas'); c.width = e.fc.width; c.height = e.fc.height; c.getContext('2d').drawImage(e.fc,0,0); e.fcLast = c; }
      e.fc = null; f = sh.fEnd;
      { const o = edit[i-2]; if(o && o.fcLast){ o.fcLast.width = o.fcLast.height = 0; o.fcLast = null; } }   // older last frames are not drawn again
    }
    { const p2 = await pre; pre = null; if(p2 && p2.it.return) try{ await p2.it.return(); }catch(err){} }
    while(as && nextAudio < dur){ const ab = chunkOf(nextAudio); if(ab) await as.add(ab); nextAudio++; }
    await output.finalize();
    const blob = new Blob([output.target.buffer], {type: mp4 ? 'video/mp4' : 'video/webm'});
    const name = 'reel-' + aspect.replace(':','x') + '-' + XQ[xq.res].label + (fps > 30 ? '-' + fps + 'fps' : '') + '.' + (mp4 ? 'mp4' : 'webm');
    const sh = saveFile(blob, name);
    tasks.done('export', 'Your Reel is ready · ' + (blob.size/1e6).toFixed(1) + ' MB');
    if(noSong){ notify('Your Reel is ready', 'ok'); showMsg(savedMsg(sh, 'Video') + ' without the song: ' + noSongTip()); return true; }
    notify('Your Reel is ready', 'ok'); showMsg(savedMsg(sh, 'Video') + ': ' + name + ' (' + (blob.size/1e6).toFixed(1) + ' MB). Ready for Instagram, TikTok and Shorts.');
    return true;
  } finally {
    exporting = false; edit.forEach(e=>{ e.fc = null; e.fcLast = null; }); layers.forEach(L => { L.fc = null; });
    // a read-ahead still running (the export stopped early) ends first: letting its decoder go under it fails
    if(pre){ try{ const p2 = await pre; if(p2 && p2.it.return) await p2.it.return(); }catch(err){} pre = null; }
    inputs.forEach(x=>{ try{ x.dispose(); }catch(err){} });
    recording = false; latencyOn = true; ['play','remix','export','cover'].forEach(id=>$(id).disabled=false);
    setCanvas(false); if(edit.length) captureLoop();
  }
}
// While exporting, the screen is kept on (Screen Wake Lock): a phone that dims and locks halfway stops the page and with
// it the export. The lock is taken again if the page comes back from the background; it is let go at the end.
let wakeLock = null, exportBusy = false;
async function holdScreen(){ try{ if(navigator.wakeLock && !document.hidden){ wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', ()=>{ wakeLock = null; }); } }catch(err){ wakeLock = null; } }
document.addEventListener('visibilitychange', ()=>{ if(exportBusy && !document.hidden && !wakeLock) holdScreen(); }, SIG);
async function autoExport(){
  if(exportBusy) return null; exportKeep = true; exportP = 0; lastVideo = null;
  try{ await runExport(false); } finally { exportKeep = false; }
  return lastVideo;
}
async function runExport(toCloud){
  if(recording || exportBusy) return;
  exportBusy = true; $('saverow').hidden = true; lastVideo = null;
  tasks.start('export', 'export', 'Exporting your Reel', 'Getting ready');   // in view at once, whatever comes next
  await holdScreen();
  try{
    let ok = false;
    try{ ok = await fastExport(); }
    catch(err){ console.warn('fast export failed', err); tasks.update('export', null, 'Switching to a slower way to save on this phone…'); showMsg('Switching to a slower way to save on this phone. Please keep this screen open…'); }
    if(!ok) await recordExport();
    if(toCloud && lastVideo) await saveToMyReels(lastVideo);
  } finally {
    exportBusy = false; if(wakeLock){ try{ await wakeLock.release(); }catch(err){} wakeLock = null; }
    if(remakeAfterExport){ remakeAfterExport = false; if(buf && sources.length && !recording) makeEdit(); }
  }
}

/* ---- the export sheet: quality, frame rate, the file size, "Export to phone" or "Export & save to My Reels" ---- */
// bitrates for 30 fps (60 fps gets half as much again); 4K is offered only where this browser can encode it
const XQ = { '720': { scale: 2/3, bitrate: 6e6, label: '720p' }, '1080': { scale: 1, bitrate: 12e6, label: '1080p' }, '4k': { scale: 2, bitrate: 35e6, label: '4K' } };
const xq = { res: '1080', fps: 30, nowm: false, my: true };
try{ const v = JSON.parse(localStorage.getItem('studio-export') || 'null'); if(v && XQ[v.res]) xq.res = v.res; if(v && (v.fps === 30 || v.fps === 60)) xq.fps = v.fps; if(v && typeof v.nowm === 'boolean') xq.nowm = v.nowm; if(v && typeof v.my === 'boolean') xq.my = v.my; }catch(e){}
wmOff = false;   // set from the person's plan when the sheet opens (sheetOpen)
let can4k = null, cloudInfo = null;
function exportDims(){ const [W0,H0] = SIZES[aspect], k = XQ[xq.res].scale; return [Math.round(W0*k/2)*2, Math.round(H0*k/2)*2]; }
function sheetPaint(){
  [...$('xres').children].forEach(b => { b.setAttribute('aria-pressed', b.dataset.r === xq.res); if(b.dataset.r === '4k'){ b.disabled = can4k === false; b.title = can4k === false ? 'This phone cannot make 4K videos' : ''; } });
  [...$('xfps').children].forEach(b => b.setAttribute('aria-pressed', +b.dataset.f === xq.fps));
  const [W, H] = exportDims(), dur = buf ? buf.duration : 0, mb = (XQ[xq.res].bitrate * (xq.fps > 30 ? 1.5 : 1) + 256e3) * dur / 8 / 1e6;
  $('xsize').textContent = W + ' × ' + H + ' · ' + xq.fps + ' fps · up to ' + (mb < 10 ? mb.toFixed(1) : Math.round(mb)) + ' MB';
  // Remove Watermark, and Save to My Reels (when the account has My Reels); "Export to phone" does what they say
  $('xwm').disabled = !wmPaid; $('xwm').checked = wmPaid && xq.nowm; $('xwmpro').hidden = wmPaid;
  wmOff = wmPaid && xq.nowm;
  const cb = $('xgocloud'), note = $('xcloudnote'), my = $('xmy');
  cb.hidden = true;
  $('xmyrow').hidden = note.hidden = !cloudInfo;
  if(cloudInfo){
    const full = cloudInfo.used >= cloudInfo.limit;
    my.disabled = full; my.checked = xq.my && !full;
    note.textContent = full ? 'My Reels is full (' + cloudInfo.used + ' of ' + cloudInfo.limit + '). Delete a Reel there to make room.' : 'Also kept in your account, to watch, download or share anywhere · ' + cloudInfo.used + ' of ' + cloudInfo.limit + ' used';
  }
}
function sheetOpen(open){
  $('xsheet').hidden = !open;
  if(!open) return;
  sheetPaint();
  $('xgo').focus();
  if(can4k === null) loadMediabunny().then(mb => { const [W0,H0] = SIZES[aspect]; return mb.getFirstEncodableVideoCodec(['avc','vp9','av1'], {width: W0*2, height: H0*2}); })
    .then(c => { can4k = !!c; if(!can4k && xq.res === '4k') xq.res = '1080'; sheetPaint(); }, () => { can4k = false; sheetPaint(); });
  if(cloud) cloud.usage().then(u => { cloudInfo = u; sheetPaint(); }, () => {});
  // a paid plan (or the administrator) may remove the watermark
  fetch('/api/credits', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null).then(c => { wmPaid = !!(c && c.enabled && c.plan && c.plan !== 'free') || root.classList.contains('admin'); sheetPaint(); }, () => { wmPaid = root.classList.contains('admin'); sheetPaint(); });
}
const sheetPick = () => { try{ localStorage.setItem('studio-export', JSON.stringify(xq)); }catch(e){} sheetPaint(); };
$('xres').addEventListener('click', e => { const b = e.target.closest('button'); if(!b || b.disabled) return; xq.res = b.dataset.r; sheetPick(); }, SIG);
$('xfps').addEventListener('click', e => { const b = e.target.closest('button'); if(!b) return; xq.fps = +b.dataset.f; sheetPick(); }, SIG);
$('xshclose').addEventListener('click', () => sheetOpen(false), SIG);
$('xsheet').addEventListener('click', e => { if(e.target === $('xsheet')) sheetOpen(false); }, SIG);
addEventListener('keydown', e => { if(e.key === 'Escape' && !$('xsheet').hidden) sheetOpen(false); }, SIG);
$('xwm').addEventListener('change', e => { if(!wmPaid){ e.target.checked = false; return; } xq.nowm = e.target.checked; wmOff = xq.nowm; sheetPick(); }, SIG);
$('xmy').addEventListener('change', e => { xq.my = e.target.checked; sheetPick(); }, SIG);
$('xgo').addEventListener('click', () => { wmOff = wmPaid && xq.nowm; sheetOpen(false); runExport(!!cloudInfo && cloudInfo.used < cloudInfo.limit && xq.my); }, SIG);
$('xgocloud').addEventListener('click', () => { sheetOpen(false); runExport(true); }, SIG);
$('export').onclick = () => { if(recording || exportBusy) return; sheetOpen(true); };

async function saveToMyReels(blob){
  if(!cloud) return;
  const [W, H] = exportDims(), name = (song && song.name ? song.name.replace(/\.[^.]+$/, '') : sources[0] ? sources[0].name.replace(/\.[^.]+$/, '') : 'Reel');
  const msg = $('xmsg').textContent;
  try{
    showMsg('Saving to My Reels… 0%');
    tasks.start('cloud', 'cloud', 'Saving to My Reels', (blob.size/1e6).toFixed(1) + ' MB · you can keep editing');
    await cloud.save(blob, { name, dur: buf ? Math.round(buf.duration*10)/10 : 0, width: W, height: H, fps: xq.fps, thumb: thumbOf() || undefined },
      p => { $('xmsg').textContent = 'Saving to My Reels… ' + Math.round(p*100) + '%'; $('prog').style.width = (p*100).toFixed(1) + '%'; tasks.update('cloud', p); });
    tasks.done('cloud', 'Saved to My Reels');
    if(cloudInfo) cloudInfo.used++;
    showMsg(msg + ' Also saved to My Reels.');
  }catch(err){
    console.warn('My Reels:', err);
    showMsg(msg); tasks.fail('cloud', err && err.code ? err.message : 'Your Reel is saved on your phone, but not in My Reels. Please try again.');
  }
}

/* ---- options ---- */
const redraw = () => { if(!playing && edit.length) drawFrame(pos || 0.3); };
$('hook').addEventListener('input', e=>{ hookText = e.target.value.trim(); if(!playing && edit.length){ pos = Math.min(pos, 1.0) || 0.6; prepare(segAt(pos), pos).then(redraw); } });
$('look').addEventListener('click', e=>{ const b=e.target.closest('button'); if(!b) return; look=b.dataset.l; [...$('look').children].forEach(x=>x.setAttribute('aria-pressed', x===b)); if(edit.length && !playing && !recording) captureLoop(); });
$('safe').addEventListener('change', e=>{ showSafe = e.target.checked; redraw(); });
const MODE_HELP = {
  auto: 'Auto: the music decides. Calm parts get longer shots, drops and hits get effects.',
  smooth: 'Smooth: fewer, longer shots on the strong beats, soft camera moves, no flashy effects.',
  fast: 'Fast: a cut on every beat, a transition on every cut, punches and speed changes on the hits.',
  copy: 'Copy a Reel: its pace, transitions and shapes, camera moves, speed and colours, on this song and your clips. With Shubix on, it copies what the Reel does on each kind of music moment.',
};
function setMode(m){ mode = m; [...$('mode').children].forEach(x=>x.setAttribute('aria-pressed', x.dataset.m===m)); $('modehelp').textContent = MODE_HELP[mode];
  $('refbox').hidden = !refProfile;
  if(buf){ plan = adaptPlan(); drawMusic(); $('mclips').textContent = plan.length; }
  if(buf && sources.length) makeEdit(); }
$('mode').addEventListener('click', e=>{ const b=e.target.closest('button'); if(!b || recording) return;
  if(b.dataset.m === 'copy' && !refProfile){ $('reffile').click(); return; }
  setMode(b.dataset.m); });
$('cover').onclick = async () => {
  // cover: the best drop shot (or the hook) with the hook text, full frame
  const d = edit.find(x=>x.type==='drop') || edit[0], tt = d.start + Math.min(0.6, (d.end-d.start)*0.6);
  setCanvas(true); coverMode = true; const i = segAt(tt); await prepare(i, tt); drawFrame(tt);
  const blob = await new Promise(r=>out.toBlob(r,'image/jpeg',0.92)); coverMode = false; setCanvas(false); captureLoop();
  const sh = saveFile(blob, 'reel-cover.jpg'); showMsg(savedMsg(sh, 'Cover') + '. Pick it under "Edit cover" when you post.');
};


/* =============== COPY A REEL ===============
   The person uploads a Reel they like. Measured on this device: every cut (the scene-change reader of the clips,
   frame-accurate), the transition at each cut (flash, fade, whip pan, zoom-through, dissolve or a hard cut, from the
   frames around it), zooms inside shots, the shot lengths in beats of its own song (so the pace carries over to a song
   at another tempo), whether it cuts on the beat, its hook, and its colour look (brightness, contrast, saturation,
   warmth, teal-orange split, black and white, faded blacks, vignette, grain). "Copy a Reel" then cuts the new edit at
   that pace on this song's beats, uses that mix of transitions and effects, and grades the clips toward that look. */
let refProfile = null;
const REF_KINDS = { hard:'hard cuts', dissolve:'dissolves', fade:'fades', flash:'flashes', whip:'whip pans', zoom:'zoom-throughs', glitch:'glitches', spin:'spins',
  iris:'circle reveals', diamond:'diamond reveals', heart:'heart reveals', star:'star reveals', wipe:'wipes', bars:'bar reveals' };
// colour statistics of the frame drawn into g (w x h), plus a 1:1 crop for grain
function lookStats(g, w, h, crop){
  const d = g.getImageData(0,0,w,h).data, n = w*h, L = new Float32Array(n);
  let sl=0, sl2=0, ss=0, sw=0, hiW=0, hiN=0, loW=0, loN=0, cen=0, cn=0, cor=0, co=0;
  for(let i=0;i<n;i++){ const r=d[i*4]/255, gg=d[i*4+1]/255, b=d[i*4+2]/255, l=0.299*r+0.587*gg+0.114*b, mx=Math.max(r,gg,b), mn=Math.min(r,gg,b);
    L[i]=l; sl+=l; sl2+=l*l; ss += mx>0.04 ? (mx-mn)/mx : 0; const wv=r-b; sw+=wv; if(l>0.6){ hiW+=wv; hiN++; } else if(l<0.35){ loW+=wv; loN++; }
    const x=(i%w)/w-0.5, y=((i/w)|0)/h-0.5, rr=Math.hypot(x,y)/0.7071; if(rr<0.35){ cen+=l; cn++; } else if(rr>0.85){ cor+=l; co++; } }
  const mean=sl/n, sorted=Float32Array.from(L).sort();
  let grain = 0;
  if(crop){ const cd = crop.getImageData(0,0,96,96).data; let gs=0, gc=0;
    const Y = i => 0.299*cd[i*4]+0.587*cd[i*4+1]+0.114*cd[i*4+2];
    for(let y=1;y<95;y++) for(let x=1;x<95;x++){ const i=y*96+x, c=Y(i), avg=(Y(i-1)+Y(i+1)+Y(i-96)+Y(i+96))/4; const grad = Math.abs(Y(i-1)-Y(i+1)) + Math.abs(Y(i-96)-Y(i+96));
      if(grad < 24){ gs += Math.abs(c-avg); gc++; } }
    grain = gc ? gs/gc/255 : 0; }
  return { mean, std: Math.sqrt(Math.max(0, sl2/n-mean*mean)), p5: sorted[Math.floor(n*0.05)], p95: sorted[Math.floor(n*0.95)], sat: ss/n, warm: sw/n,
    split: (hiN ? hiW/hiN : 0) - (loN ? loW/loN : 0), vig: cn && co ? Math.max(0, 1 - (cor/co)/Math.max(1e-3, cen/cn)) : 0, grain };
}
const avgLook = arr => { const o = {}; if(!arr.length) return null; for(const k of Object.keys(arr[0])) o[k] = arr.reduce((q,x)=>q+x[k],0)/arr.length; return o; };
// colour statistics of one full-size frame (canvas or video): a 96-wide copy for colours, a 1:1 centre crop for grain
function lookOfImage(img, w, h){
  const cw = 96, ch = Math.max(2, Math.round(96*h/w)), c = document.createElement('canvas'); c.width=cw; c.height=ch; const g = c.getContext('2d', {willReadFrequently:true}); g.drawImage(img,0,0,cw,ch);
  const c2 = document.createElement('canvas'); c2.width=96; c2.height=96; const g2 = c2.getContext('2d', {willReadFrequently:true}); g2.drawImage(img, Math.max(0,w/2-48), Math.max(0,h/2-48), 96, 96, 0, 0, 96, 96);
  return lookStats(g, cw, ch, g2);
}
async function frameLook(v, t, w, h){
  v.currentTime = t; try{ await waitEv(v,'seeked',3000); }catch(e){ return null; }
  return lookOfImage(v, w, h);
}
// Frames of a video at exact times. WebCodecs (through mediabunny) decodes them in one pass, in order; without it the
// video element seeks to each one (slower, works everywhere).
async function frameSource(file, v, w, h){
  const SH2 = Math.max(8, Math.round(64*h/w));
  try{
    const mb = await loadMediabunny();
    const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack(); if(!track || !(await track.canDecode())) throw new Error('no decoder');
    const first = await track.getFirstTimestamp();
    const small = new mb.CanvasSink(track, { width: 64, height: SH2, fit: 'fill' }), full = new mb.CanvasSink(track, {});
    const at = async (sink, ts) => { const order = ts.map((t,i)=>[t,i]).sort((x,y)=>x[0]-y[0]), out = new Array(ts.length); let k = 0;
      for await (const wc of sink.canvasesAtTimestamps(order.map(o=>first + Math.max(0, o[0])))){ out[order[k][1]] = wc ? wc.canvas : null; k++; }
      return out; };
    return { small: ts => at(small, ts), full: ts => at(full, ts), close: () => { try{ input.dispose && input.dispose(); }catch(e){} }, fast: true };
  }catch(e){
    try{ await videoData(v); }catch(err){}
    const grab = async (ts, cw, ch) => { const out = [];
      for(const t of ts){ v.currentTime = Math.min(Math.max(0.01, t), v.duration-0.02); try{ await waitEv(v,'seeked',3000); }catch(err){ out.push(null); continue; }
        const c = document.createElement('canvas'); c.width = cw || v.videoWidth; c.height = ch || v.videoHeight; c.getContext('2d').drawImage(v,0,0,c.width,c.height); out.push(c); }
      return out; };
    return { small: ts => grab(ts, 64, SH2), full: ts => grab(ts), close: () => {}, fast: false };
  }
}
const CUT_K = 7;   // frames each side of a cut that are looked at (a fade's dark middle and its clean ends both fit)
function greyOf(canvas){
  const FW = canvas.width, FH = canvas.height, d = canvas.getContext('2d', {willReadFrequently:true}).getImageData(0,0,FW,FH).data, Y = new Float32Array(FW*FH); let m = 0, gx = 0, gy = 0;
  for(let i=0;i<Y.length;i++){ Y[i] = (0.299*d[i*4]+0.587*d[i*4+1]+0.114*d[i*4+2])/255; m += Y[i]; }
  for(let y=1;y<FH-1;y++) for(let x=1;x<FW-1;x++){ const i=y*FW+x; gx += (Y[i+1]-Y[i-1])**2; gy += (Y[i+FW]-Y[i-FW])**2; }
  return { Y, FW, FH, mean: m/Y.length, aniso: gx/Math.max(1e-6, gy) };
}
// around one cut: brightness, blur direction, the sideways jump and the scale change from one frame to the next
function cutFramesOf(canvases){
  const out = canvases.map((c,i)=>c ? {k: i-CUT_K, ...greyOf(c)} : null).filter(Boolean);
  const shift = (A, B, FW, FH) => { let best = Infinity, bx = 0; for(let dx=-16; dx<=16; dx++) for(let dy=-2; dy<=2; dy++){ let s2 = 0, n = 0;
      for(let y=4;y<FH-4;y+=2) for(let x=17;x<FW-17;x+=2){ s2 += Math.abs(B[y*FW+x] - A[(y-dy)*FW + x-dx]); n++; } s2 = s2/n + 0.0004*(dx*dx+dy*dy); if(s2 < best){ best = s2; bx = dx; } } return bx; };
  const scale = (A, B, FW, FH) => { let best = Infinity, bs = 1; for(let sc=0.9; sc<=1.3; sc+=0.02){ let s2 = 0, n = 0;
      for(let y=FH*0.2;y<FH*0.8;y+=2) for(let x=FW*0.2;x<FW*0.8;x+=2){ const sx = Math.round(FW/2 + (x-FW/2)/sc), sy = Math.round(FH/2 + (y-FH/2)/sc); s2 += Math.abs(B[Math.round(y)*FW+Math.round(x)] - A[sy*FW+sx]); n++; }
      s2 /= n; if(s2 < best){ best = s2; bs = sc; } } return bs; };
  for(let i=1;i<out.length;i++){ if(out[i].k - out[i-1].k !== 1) continue; out[i].dx = shift(out[i-1].Y, out[i].Y, out[i].FW, out[i].FH); out[i].sc = scale(out[i-1].Y, out[i].Y, out[i].FW, out[i].FH); }
  return out;
}
// how much a shot zooms between two of its frames (scale and a small shift together: drifting sideways is not zooming)
function zoomBetween(ca, cb){
  if(!ca || !cb) return 1;
  const a = greyOf(ca), b = greyOf(cb), A = a.Y, B = b.Y, FW = a.FW, FH = a.FH; let best = Infinity, zoom = 1;
  if(Math.abs(a.mean - b.mean) > 0.08) return 1;   // the light changed (a fade, a flash): not a zoom to judge
  for(let sc=0.85; sc<=1.25; sc+=0.02) for(let dx=-6; dx<=6; dx+=2) for(let dy=-6; dy<=6; dy+=2){ let s2=0, n=0;
    for(let y=FH*0.25;y<FH*0.75;y+=2) for(let x=FW*0.25;x<FW*0.75;x+=2){ const sx=Math.round(FW/2+(x-FW/2)/sc)+dx, sy=Math.round(FH/2+(y-FH/2)/sc)+dy; if(sx<0||sy<0||sx>=FW||sy>=FH) continue; s2+=Math.abs(B[Math.round(y)*FW+Math.round(x)]-A[sy*FW+sx]); n++; }
    if(n && s2/n < best){ best = s2/n; zoom = sc; } }
  return zoom;
}
// a glitch: the red and blue of a frame pushed sideways apart (measured on the small colour frame)
function rgbShiftOf(canvas){
  if(!canvas) return 0;
  const W2 = canvas.width, H2 = canvas.height, d = canvas.getContext('2d', {willReadFrequently:true}).getImageData(0,0,W2,H2).data;
  let best = 0, bv = Infinity, base = 0;
  for(let sh=-6; sh<=6; sh++){ let s2 = 0, n = 0;
    for(let y=2;y<H2-2;y+=2) for(let x=8;x<W2-8;x++){ const i=(y*W2+x)*4, j=(y*W2+x+sh)*4; s2 += Math.abs(d[i]-d[j+2]); n++; }
    const v = s2/Math.max(1,n); if(sh===0) base = v; if(v < bv){ bv = v; best = sh; } }
  return Math.abs(best) >= 2 && bv < 0.8*base ? Math.abs(best) : 0;
}
function cutKind(fr, hint){
  if(fr.length < 6) return hint === 'cut' ? 'hard' : hint;
  const endF = fr.filter(f=>Math.abs(f.k) >= CUT_K-1), ends = (endF.length >= 2 ? endF : [fr[0], fr[fr.length-1]]).map(f=>f.mean).sort((a,b)=>a-b), endMed = ends[Math.floor((ends.length-1)/2)];
  const mid = fr.filter(f=>Math.abs(f.k) <= 4), maxB = Math.max(...mid.map(f=>f.mean)), minB = Math.min(...mid.map(f=>f.mean));
  if(minB < 0.07 && endMed > 0.12) return 'fade';
  // a flash is brighter than BOTH shots around it (a cut into a bright shot is not a flash)
  const endOf = side => { const q = fr.filter(f=>side < 0 ? f.k <= -(CUT_K-1) : f.k >= CUT_K-1).map(f=>f.mean); return q.length ? q.reduce((a,b)=>a+b,0)/q.length : endMed; };
  const brighter = maxB - Math.max(endOf(-1), endOf(1));
  if(maxB > 0.78 && maxB > endMed + 0.22 && brighter > 0.15) return 'flash';
  // the reading may have landed at the end of a flash: a white spike a few frames earlier is the cut
  const early = fr.filter(f=>f.k < -2 && f.k > -CUT_K), eMax = early.length ? early.reduce((q,f)=>f.mean > q.mean ? f : q, early[0]) : null;
  if(eMax && eMax.mean > 0.78 && eMax.mean > endMed + 0.22 && eMax.mean - Math.max(endOf(-1), endOf(1)) > 0.15){ fr.shiftTo = eMax.k; return 'flash'; }
  const before = fr.filter(f=>f.k <= 0 && f.k >= -4 && f.dx !== undefined);
  if(fr.spin) return 'spin';
  if(fr.glitch) return 'glitch';
  if(before.filter(f=>Math.abs(f.dx) >= 5 || f.aniso < 0.3).length >= 2) return 'whip';
  if(before.filter(f=>f.sc >= 1.06).length >= 2) return 'zoom';
  if(hint === 'dissolve') return 'dissolve';
  if(hint === 'fade') return 'fade';
  return 'hard';
}
async function analyzeReference(file, onP){
  const url = URL.createObjectURL(file);
  try{
    const v = makeVideo(url); await waitEv(v,'loadedmetadata', 15000); const dur = v.duration, w = v.videoWidth, h = v.videoHeight;
    if(!isFinite(dur) || dur <= 1 || !w) throw new Error('This video cannot be read here.');
    onP(0.02, 'listening to its music');
    // its music: the beats (shot lengths are measured in beats, so the pace carries over to another tempo)
    let rb = null, rr = null, rmap = null;
    try{ const ab = await decodeAnyAudio(file); const m = new Float32Array(ab.length);
      for(let c=0;c<ab.numberOfChannels;c++){ const d = ab.getChannelData(c); for(let i=0;i<m.length;i++) m[i] += d[i]/ab.numberOfChannels; }
      let r; try{ r = await analyseInWorker(m, ab.sampleRate); }catch(e){ r = songAnalysis(m, ab.sampleRate); }
      if(r.beats && r.beats.length > 8) rb = r.beats;
      rr = r; try{ rmap = soundMap(m, ab.sampleRate); }catch(e){ rmap = null; } }catch(e){ /* no soundtrack: pace in seconds */ }
    // its cuts: the same reading as a clip (scene changes, frame-accurate)
    const ps = { url, dur, w, h };
    await scanMotion(ps, p => onP(0.05 + 0.45*p, 'finding its cuts'));
    const cuts = [];
    // a cut: its first new frame; a fade / flash: its darkest / brightest moment; a dissolve: its middle
    for(const sc of ps.scenes || []){ const t = sc.kind === 'cut' ? sc.t1 : sc.tc !== undefined ? sc.tc : (sc.t0 + sc.t1)/2; if(t > 0.15 && t < dur - 0.15 && (!cuts.length || t - cuts[cuts.length-1].t > 0.12)) cuts.push({t, hint: sc.kind}); }
    const shots = [], looks = [];
    // what happens at each cut: the frames around it, decoded in one pass
    onP(0.5, 'reading its transitions');
    const fs = await frameSource(file, v, w, h);
    try{
      const ts = []; cuts.forEach(c=>{ for(let k=-CUT_K;k<=CUT_K;k++) ts.push(Math.min(Math.max(0.005, c.t + k/30 + 0.005), dur-0.02)); });
      const frames = ts.length ? await fs.small(ts) : [];
      cuts.forEach((c,i)=>{ const cv = frames.slice(i*(2*CUT_K+1), (i+1)*(2*CUT_K+1)), fr = cutFramesOf(cv);
        const at = k => fr.find(f=>f.k===k);
        // a spin: the picture turns over the frames before the cut
        { let turned = 0; for(let k=-4;k<0;k++){ const a = at(k), b = at(k+1); if(a && b && Math.abs(motionBetween(a.Y, b.Y, a.FW, a.FH).r) >= 6) turned++; } fr.spin = turned >= 2; }
        // a glitch: red and blue pulled apart on two frames or more around the cut
        fr.glitch = cv.slice(CUT_K-3, CUT_K+4).filter(x=>rgbShiftOf(x) >= 2).length >= 2;
        c.kind = cutKind(fr, c.hint); if(fr.shiftTo) c.t += fr.shiftTo/30;
        // a reveal through a shape (circle, diamond, heart, star, wipe, bars): the frames in the middle of the transition
        if(['hard','dissolve','fade'].includes(c.kind)){ const A = at(-CUT_K), B = at(CUT_K);
          if(A && B) for(const k of [0,-1,1,-2,2,-3,3]){ const F = at(k); if(!F) continue; const sh = revealShape(A.Y, B.Y, F.Y, A.FW, A.FH); if(sh){ c.kind = sh; break; } } } });
      // shots: a zoom inside them (two frames) and the colour look (the middle frame)
      onP(0.85, 'reading its look');
      const bounds = [0, ...cuts.map(c=>c.t), dur], sh = [];
      for(let i=0;i<bounds.length-1 && i<40;i++) sh.push({ a: bounds[i], b: bounds[i+1] });
      const zt = [], zi = [], lt = [];
      // the camera move: frames every ~0.12 s inside the shot (clear of its transitions), at most 9; short shots are not judged
      sh.forEach((x,i)=>{ const L = x.b - x.a, m = Math.min(0.2, 0.15*L), n = L >= 0.5 ? Math.max(3, Math.min(9, Math.round((L-2*m)/0.12)+1)) : 0;
        for(let k=0;k<n;k++){ const t = x.a + m + (L-2*m)*k/(n-1); zt.push(t); zi.push([i, (t - x.a)/L]); } lt.push(x.a + 0.5*L); });
      const zf = await fs.small(zt), lf = await fs.full(lt);
      sh.forEach((x,i)=>{ const L = x.b - x.a, mine = zi.map((z,k)=>[z,k]).filter(([z])=>z[0]===i), gr = mine.map(([,k])=>zf[k] ? greyOf(zf[k]) : null);
        let move = null;
        if(gr.length >= 3 && gr.every(Boolean)) move = shotMove(gr.map(g=>g.Y), mine.map(([z])=>z[1]), gr[0].FW, gr[0].FH);
        shots.push({ a: x.a, b: x.b, zoom: move ? (move.zoom === 'in' ? 1.06 : move.zoom === 'out' ? 0.94 : 1) : 1, move });
        const lk = lf[i] ? lookOfImage(lf[i], lf[i].width, lf[i].height) : null; if(lk) looks.push(lk); });
    } finally { fs.close(); }
    v.removeAttribute('src'); v.load();
    // pace
    const P = rb ? (()=>{ const ib = rb.slice(1).map((t,i)=>t-rb[i]).sort((x,y)=>x-y); return ib[ib.length>>1]; })() : 0;
    const shotSec = shots.map(s=>s.b-s.a), toBeats = x => P ? Math.max(0.5, Math.round(x/P*2)/2) : 0;
    const shotBeats = P ? shotSec.map(toBeats) : [];
    const onBeat = rb && cuts.length ? cuts.filter(c=>rb.some(b=>Math.abs(b-c.t) <= 0.07)).length/cuts.length : 0;
    const med = a => { const q=[...a].sort((x,y)=>x-y); return q.length ? q[q.length>>1] : 0; };
    const k3 = Math.max(1, Math.floor(shotSec.length/3)), first = shotSec.slice(0,k3), last = shotSec.slice(-k3), mean = a => a.reduce((q,x)=>q+x,0)/Math.max(1,a.length);
    const energy = shotSec.length < 6 ? 'steady' : mean(last) < 0.75*mean(first) ? 'rising' : mean(last) > 1.33*mean(first) ? 'falling' : 'steady';
    const trans = {}; cuts.forEach(c=>{ trans[c.kind] = (trans[c.kind]||0) + 1; });
    Object.keys(trans).forEach(k=>{ trans[k] /= cuts.length; });
    const look = avgLook(looks);
    const drops = rr ? (rr.cuts || []).filter((c,k)=>rr.cutType[k] === 'drop') : [];
    const moments = shots.slice(0, 40).map((s,i)=>{
      const mm = { beats: shotBeats[i] || 0, sec: +shotSec[i].toFixed(2), tr: i ? (cuts[i-1] ? cuts[i-1].kind : 'hard') : 'start', zoom: s.zoom > 1.03 ? 'in' : s.zoom < 0.97 ? 'out' : 'none' };
      if(s.move){ if(s.move.keys.length >= 2 && (s.move.zoom !== 'none' || s.move.keys.some(k=>Math.abs(k.x) > 0.02 || Math.abs(k.y) > 0.02 || Math.abs(k.r) >= 2))){ mm.move = s.move.keys; mm.ease = s.move.ease; }
        if(s.move.shake) mm.shake = true; if(s.move.freeze !== null) mm.freeze = +s.move.freeze.toFixed(2); }
      if(rmap && rr){ const dm = describeCut(rmap, s.a, s.b, { hits: rr.hitsRaw || [], hitStr: rr.hitsStr || [], drops, beats: rr.beats || [] });
        Object.assign(mm, { loud: dm.loud, trend: dm.trend, drums: dm.drums, bass: dm.bass, voice: dm.voice });
        if(dm.hits && dm.hits.length) mm.hit = dm.hits.slice().sort((x,y)=>y.p-x.p)[0].k;
        if(drops.some(d=>Math.abs(d - s.a) < 0.15)) mm.drop = true; }
      return mm; });
    return { name: file.name, dur, w, h, moments, cuts: cuts.map(c=>({t:+c.t.toFixed(3), kind:c.kind})), shotSec, shotBeats, medianBeats: med(shotBeats), medianSec: med(shotSec),
      hookBeats: shotBeats[0] || 0, hookSec: shotSec[0] || 0, onBeat, energy, trans,
      zoomShare: shots.filter(s=>s.zoom >= 1.05 || s.zoom <= 0.95).length/Math.max(1, shots.filter(s=>s.b-s.a >= 0.9).length),   // of the shots long enough to judge
      look, bpm: P ? 60/P : 0 };
  } finally { setTimeout(()=>URL.revokeObjectURL(url), 1000); }
}
function describeRef(R){
  const L = R.look || {}, words = [];
  if(L.sat < 0.05) words.push('black & white'); else if(L.sat > 0.42) words.push('saturated'); else if(L.sat < 0.22) words.push('muted colours');
  if(L.sat >= 0.05){ if(L.warm > 0.07) words.push('warm'); else if(L.warm < -0.05) words.push('cool'); if(L.split > 0.25) words.push('teal-orange'); }
  if(L.std > 0.25) words.push('high contrast'); if(L.p5 > 0.12) words.push('faded blacks'); if(L.vig > 0.25) words.push('vignette'); if(L.grain > 0.01) words.push('film grain');
  const tr = Object.entries(R.trans).sort((a,b)=>b[1]-a[1]).map(([k,v])=>Math.round(v*100)+'% '+REF_KINDS[k]).join(', ');
  const pace = R.medianBeats ? 'a cut every ' + R.medianBeats + ' beat' + (R.medianBeats===1?'':'s') + ' (' + Math.round(R.onBeat*100) + '% on the beat)' : 'a cut every ' + R.medianSec.toFixed(1) + ' s';
  return (R.learned ? 'typically ' : R.cuts.length + ' cuts in ' + R.dur.toFixed(0) + ' s · ') + pace + (R.energy !== 'steady' ? ' · pace ' + R.energy : '') + ' · ' + (tr || 'no cuts') +
    (R.zoomShare > 0.15 ? ' · zooms in ' + Math.round(R.zoomShare*100) + '% of shots' : '') + (words.length ? ' · ' + words.join(', ') : '');
}
// the edit's cut points: the reference's sequence of shot lengths (in beats), on this song's beats; its drops and breaks stay
function copyPlan(){
  const R = refProfile, dur = buf.duration, P0 = period || 0.5;
  const bt = beats.map(b=>b-1/30).filter(b=>b>0.2 && b<dur-0.3);
  const keep = basePlan.filter(s=>s.type==='drop' || s.type==='break').map(s=>s.start);
  const seq = R.shotBeats.length ? R.shotBeats.slice(1) : [], wantAt = k => R.medianBeats ? (seq.length ? seq[(k) % seq.length] : R.medianBeats) : 0;
  const typeAt = t => { const b = basePlan.find(s=>Math.abs(s.start - t) < 0.06); return b ? b.type : 'cut'; };
  const out = []; let start = 0, k = 0;
  while(start < dur - 0.3){
    let len = R.medianBeats ? (k === 0 ? (R.hookBeats || wantAt(0)) : wantAt(k-1))*P0 : (k === 0 ? R.hookSec : R.shotSec[k % R.shotSec.length]);
    // pace curve: a rising Reel gets shorter shots towards the end (already in its sequence when it repeats; scaled here)
    len = Math.min(3.5, Math.max(0.3, len));
    let end = start + len;
    const drop = keep.find(t => t > start + 0.08 && t < end + 0.5*P0);
    if(drop !== undefined && drop - start < 0.5*len && out.length){ out[out.length-1].end = drop; start = drop; continue; }   // a sliver before a drop joins the shot before it
    if(drop !== undefined) end = drop;
    else if(bt.length){ const b = bt.reduce((q,x)=>Math.abs(x-end) < Math.abs(q-end) ? x : q, bt[0]); if(Math.abs(b-end) < 0.6*P0 && b > start + 0.25) end = b; }
    if(end > dur - 0.35) end = dur;
    out.push({ start, end, type: k === 0 ? (basePlan[0] ? basePlan[0].type : 'cut') : typeAt(start), fx: 'Hard cut' });
    start = end; k++;
  }
  return out;
}
// the reference's mix of transitions and effects, placed where they suit (energetic ones on drops and hits, soft ones
// on calm, long shots), counted so the shares match
const REF_TR = { hard:'hard', dissolve:'dissolve', fade:'dip', flash:'flash', whip:'whip', zoom:'zoom', glitch:'glitch', spin:'spin', iris:'iris', diamond:'diamond', heart:'heart', star:'star', wipe:'wipe', bars:'bars' };
let copyBudget = null;
function copyStyle(){
  const R = refProfile, n = plan.length - 1; if(n < 1) return;
  const kinds = Object.keys(R.trans), want = {};
  let acc = 0; kinds.forEach(k=>{ want[k] = Math.floor(R.trans[k]*n); acc += want[k]; });
  kinds.map(k=>[k, R.trans[k]*n - want[k]]).sort((a,b)=>b[1]-a[1]).slice(0, n-acc).forEach(([k])=>{ want[k]++; });
  const energy = i => { const s = plan[i]; return (s.type==='drop' ? 3 : s.type==='hit' ? 2 : s.type==='break' ? -1 : 0) - 0.3*(s.end-s.start); };
  const idx = plan.map((s,i)=>i).slice(1), free = new Set(idx);
  plan.forEach((s,i)=>{ s.tr = i===0 ? 'hard' : 'hard'; s.efx = i===0 ? 'none' : 'none'; s.sp = SPEED.normal; });
  const place = (k, order) => { let c = want[k] || 0; for(const i of order){ if(!c) break; if(!free.has(i)) continue;
      if(plan[i-1] && plan[i-1].tr === REF_TR[k] && k !== 'hard') continue; plan[i].tr = REF_TR[k]; free.delete(i); c--; }
    for(const i of order){ if(!c) break; if(free.has(i)){ plan[i].tr = REF_TR[k]; free.delete(i); c--; } } };
  const hot = [...idx].sort((a,b)=>energy(b)-energy(a)), calm = [...idx].sort((a,b)=>energy(a)-energy(b));
  ['flash','zoom','whip','glitch','spin'].forEach(k=>place(k, hot)); ['dissolve','fade','iris','diamond','heart','star','wipe','bars'].forEach(k=>place(k, calm));
  // zooms inside shots: on that share of shots, the longest first
  const longI = [...plan.keys()].filter(i=>plan[i].end-plan[i].start >= 0.9), zn = Math.round(Math.min(1, R.zoomShare)*longI.length);
  longI.sort((a,b)=>(plan[b].end-plan[b].start)-(plan[a].end-plan[a].start)).slice(0, zn).forEach(i=>{ plan[i].efx = (plan[i].end-plan[i].start) > 1.2 ? 'pan' : 'punch-soft'; });
  copyBudget = {}; Object.entries(want).forEach(([k,v])=>{ if(k!=='hard') copyBudget[REF_TR[k]] = v; });
}
// The copied look, matched on the edit itself (like a colourist with scopes): render a few frames of the edit, measure
// them exactly as the reference was measured, correct the grade, measure again. The edit's crops, zooms and effects are
// part of what is measured, so the result lands on the reference's numbers, not just near them.
let copyLookKey = '', copyLookBusy = false;
async function renderedLook(){
  if(!edit.length) return null;
  const sv = showSafe, h = hookText, res = []; showSafe = false; hookText = '';
  try{
    for(const f of [0.06, 0.15, 0.24, 0.33, 0.42, 0.51, 0.6, 0.69, 0.78, 0.87, 0.95]){
      const e = edit[Math.min(edit.length-1, Math.floor(f*edit.length))], L = e.end - e.start, t = e.start + Math.min(L - 0.03, Math.max(0.75, 0.9*L));   // after the shot's own flash / leak
      await prepare(segAt(t), t); drawFrame(t); res.push(lookOfImage(out, out.width, out.height));
    }
  } finally { showSafe = sv; hookText = h; }
  return avgLook(res);
}
async function copyLook(){
  const R = refProfile; if(!R || !R.look || copyLookBusy || look !== 'copy') return;
  const T = R.look, cl = (x,a,b)=>Math.min(b, Math.max(a, x)), mono = T.sat < 0.05 ? 1 : 0;
  const key = R.name + '|' + R.dur + '|' + sources.map(fpOf).join(';') + '|' + aspect;
  if(key === copyLookKey && GRADES.copy) return;
  const G = { con:1, sat:1, bri:1, warm:0, teal:0, mono, lift:0, vig:0, grain:0 };
  GRADES.copy = { ...G };
  if(!edit.length || !buf || playing || recording) return;
  copyLookBusy = true;
  try{
    for(let pass=0; pass<4; pass++){
      const O = await renderedLook(); if(!O) break;
      const k = pass === 0 ? 1 : 0.85;
      G.con = cl(G.con * Math.pow(T.std/Math.max(0.02, O.std), k), 0.7, 2.0);
      if(!mono) G.sat = cl(G.sat * Math.pow(T.sat/Math.max(0.02, O.sat), k), 0.35, 2);
      G.bri = cl(G.bri * Math.pow(T.mean/Math.max(0.03, O.mean), k), 0.6, 1.4);
      if(!mono) G.warm = cl(G.warm + k*(T.warm - O.warm)/0.11, -1.6, 1.6);
      G.vig = cl(G.vig + k*(T.vig - O.vig)*1.4, 0, 0.9);
      G.lift = cl(G.lift + k*(T.p5 - O.p5), 0, 0.15);
      G.grain = cl(G.grain + k*(T.grain - O.grain)*3, 0, 0.15);
      if(pass === 0 && !mono) G.teal = cl((T.split - O.split - 0.1)/0.3, 0, 0.8);   // only a clear split beyond what the clips have
      GRADES.copy = { ...G };
    }
    copyLookKey = key;
  } finally { copyLookBusy = false; }
  LOOKS.copy = { name: 'Copied', filter: 'contrast(' + G.con.toFixed(2) + ') saturate(' + (mono ? 0 : G.sat).toFixed(2) + ') brightness(' + G.bri.toFixed(2) + ')', grain: G.grain };
  if(!playing && !recording) captureLoop();
}
$('reffile').addEventListener('change', async e=>{
  const f = e.target.files && e.target.files[0]; e.target.value = ''; if(!f) return;
  $('refbox').hidden = false; $('refinfo').textContent = 'Reading the Reel…';
  try{
    refProfile = await analyzeReference(f, (p, what)=>{ $('refinfo').textContent = 'Reading the Reel: ' + what + ' ' + Math.round(p*100) + '%'; });
    $('refinfo').textContent = '“' + f.name + '”: ' + describeRef(refProfile); $('stsaverow').hidden = false; $('ststat').textContent = ''; learnedKind = '';
    // the copied look is on while it is matched (makeEdit then matches it on the new edit)
    GRADES.copy = { con:1, sat:1, bri:1, warm:0, teal:0, mono: refProfile.look && refProfile.look.sat < 0.05 ? 1 : 0, lift:0, vig:0, grain:0 }; copyLookKey = '';
    const lb = $('look').querySelector('[data-l="copy"]'); lb.hidden = false; look = 'copy'; [...$('look').children].forEach(x=>x.setAttribute('aria-pressed', x===lb));
    setMode('copy');
    refLookRun(f, refProfile);   // its texts, stickers, captions, background: the AI reads them (when it is on)
  }catch(err){ console.warn('reference not read:', err); $('refinfo').textContent = 'We could not read that Reel. Please try another video.'; notify('We could not read that Reel. Please try another video.', 'err'); }
});
$('refchange').addEventListener('click', ()=>$('reffile').click());
/* ---- Copy a Reel, what is written and stuck on it ----
 * The phone measures the reference's cuts, moves and colours itself; what is WRITTEN on it (a hook, a price, "follow for
 * more"), its stickers, its captions' style and a replaced background need eyes. When the administrator turned the
 * studio's AI on, 10 small frames go to /api/studio/ref-look and the answer is put on the new Reel: the same texts in
 * the same places, styles, colours and timing (stretched to the new Reel's length), the stickers as emoji, the caption
 * style and highlight colour, and the background. They are ordinary texts afterwards: tap one to change its words. */
let refLookBusy = false;
async function refLookRun(file, R){
  if(!aiOn || !R || refLookBusy) return;
  refLookBusy = true; const url = URL.createObjectURL(file), note = t => { if(refProfile === R) $('refinfo').textContent = '“' + R.name + '”: ' + describeRef(R) + (t ? ' · ' + t : ''); };
  try{
    note('Shubix is reading its texts and stickers…');
    const N = 10, ts = Array.from({ length: N }, (_, i) => +((i + 0.5)*R.dur/N).toFixed(2));
    const rd = await clipReader({ url, file, name: R.name, dur: R.dur, w: R.w, h: R.h }, 768);
    const sc = Math.min(1, 512/Math.max(R.w, R.h)), w = Math.max(2, Math.round(R.w*sc)), h = Math.max(2, Math.round(R.h*sc));
    const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'), frames = [];
    let k = 0;
    try{ for await (const v of rd.frames(ts)){ const t = ts[k++]; if(!v) continue; g.drawImage(v, 0, 0, w, h);
      let q = 0.75, d = c.toDataURL('image/jpeg', q); while(d.length > 150000 && q > 0.35){ q -= 0.15; d = c.toDataURL('image/jpeg', q); }   // under the server's 120 KB
      frames.push({ t, image: d.slice(d.indexOf(',') + 1) }); } } finally { rd.close(); }
    if(frames.length < 2) throw new Error('frames not readable');
    const r = await fetch('/api/studio/ref-look', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ac.signal, body: JSON.stringify({ name: R.name.slice(0, 200), dur: R.dur, frames }) });
    const res = await r.json().catch(() => ({}));
    if(!r.ok) throw new Error((res.error && res.error.message) || ('Shubix could not do this step (' + r.status + ').'));
    if(refProfile !== R) return;   // another Reel was picked meanwhile
    R.design = res; R.designDone = false; refLookApplySoon(R);
  }catch(err){
    if(err && err.name === 'AbortError') return;
    console.warn('reference texts not read:', err); note('its texts could not be read this time');
  }finally{ refLookBusy = false; setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
// once the new Reel has its edit (song part and clips in)
function refLookApplySoon(R){
  clearTimeout(refLookApplySoon.h);
  refLookApplySoon.h = setTimeout(() => { if(refProfile !== R || R.designDone || mode !== 'copy') return;
    if(!edit.length || pending || !reelLen()){ refLookApplySoon(R); return; }
    refLookApply(R); }, 600);
}
function refLookApply(R){
  const D = R.design, L = reelLen(); if(!D || !L) return;
  R.designDone = true;
  const k = L / Math.max(0.5, R.dur), base = Math.min(R.w, R.h*0.5625);
  // its sizes: letters (about 3/4 of the font size) and emoji, measured on the reference, in the studio's own units
  const sizeOf = (hf, emoji) => clip(emoji ? hf*R.h/(base*0.16) : hf*R.h/0.75/(base*0.075), 0.4, 2.6);
  const timing = (ov, x) => { const whole = x.t0 <= 0.05 && x.t1 >= R.dur - 0.05; ov.all = whole; ov.t0 = whole ? 0 : Math.max(0, Math.min(L - 0.5, x.t0*k)); ov.t1 = whole ? L : Math.min(L, Math.max(ov.t0 + 0.5, x.t1*k)); ov.ref = true; };
  overlays = overlays.filter(o => !o.ref);   // an earlier reference's texts go
  for(const x of D.texts || []){ const ov = addOverlay({ text: x.text, style: x.style, color: x.color, anim: x.anim, x: x.x, y: x.y, size: sizeOf(x.h, false) }); timing(ov, x); }
  for(const x of D.stickers || []){ const ov = addOverlay({ text: x.emoji, emoji: true, x: x.x, y: x.y, size: sizeOf(x.h, true) }); timing(ov, x); }
  const said = [];
  if(D.texts && D.texts.length) said.push(D.texts.length + ' text' + (D.texts.length > 1 ? 's' : ''));
  if(D.stickers && D.stickers.length) said.push(D.stickers.length + ' sticker' + (D.stickers.length > 1 ? 's' : ''));
  if(D.captions){ press('tstyle', 't', D.captions.style); ACCENT = D.captions.color || ACCENT;
    if(!capsOn && !$('capwrap').hidden){ $('caps').checked = true; capsOn = true; $('caprow').hidden = false; loadCaptions(); }
    said.push($('tstyle').querySelector('[data-t="' + D.captions.style + '"]').textContent.toLowerCase() + ' captions'); }
  if(D.background && D.background.mode !== 'none' && sources.some(s => s.faces && s.faces.some(f => f.n > 0))){
    if(D.background.mode === 'color' && D.background.color) bgColor = D.background.color;
    press('bgmode', 'b', D.background.mode); said.push(D.background.mode === 'blur' ? 'blurred background' : 'colour background'); }
  ovSel = -1; renderOvList(); redraw();
  const msg = said.length ? 'Copied ' + said.join(', ') + (D.texts && D.texts.length ? '. Tap a text to change its words.' : '.') : 'Nothing written on it to copy.';
  $('refinfo').textContent = '“' + R.name + '”: ' + describeRef(R) + ' · ' + msg;
  if(said.length) notify(msg, 'ok');
}
/* ---- style library: reference Reels kept as styles, learned styles, and learning from corrections ----
 * A Reel read by "Copy a Reel" can be saved to the creator's style library under a kind (wedding, travel, festival...);
 * only its measured fingerprint goes to the server (never the video). "Use a learned style" asks the server what the
 * Reels of a kind have in common (mine, or with everyone's shared ones) and copies that like a reference Reel. Every
 * change made to a shot's transition, effect or speed is sent too, so the learned styles follow the creator's taste. */
const STYLE_KINDS = { wedding: 'Wedding', travel: 'Travel', festival: 'Festival', dance: 'Dance', talking: 'Talking', product: 'Product', food: 'Food', fitness: 'Fitness', vlog: 'Vlog', birthday: 'Birthday', other: 'Other' };
let learnedKind = '', editsQ = [], editsT = 0;
const clip = (x, a, b) => Math.min(b, Math.max(a, Number.isFinite(x) ? x : a));
function fingerprintOf(R){
  const tr = {}; for(const [k, v] of Object.entries(R.trans || {})) if(Object.keys(REF_KINDS).includes(k)) tr[k] = clip(v, 0, 1);
  const L = R.look || null, look = L ? Object.fromEntries(['mean','std','sat','warm','p5','p95','vig','grain','split'].filter(k => Number.isFinite(L[k])).map(k => [k, clip(L[k], k === 'warm' || k === 'vig' || k === 'split' ? -1 : 0, k === 'sat' ? 2 : 1)])) : null;
  return { dur: clip(R.dur, 1, 600), bpm: clip(R.bpm || 0, 0, 300), medianBeats: clip(R.medianBeats || 0, 0, 64), medianSec: clip(R.medianSec || 0, 0, 60), hookBeats: clip(R.hookBeats || 0, 0, 64), hookSec: clip(R.hookSec || 0, 0, 60),
    onBeat: clip(R.onBeat || 0, 0, 1), energy: ['steady','rising','falling'].includes(R.energy) ? R.energy : 'steady', zoomShare: clip(R.zoomShare || 0, 0, 1), trans: tr, look,
    shotBeats: (R.shotBeats || []).slice(0, 300).map(x => clip(x, 0, 64)), shotSec: (R.shotSec || []).slice(0, 300).map(x => clip(x, 0, 60)),
    moments: cleanMoments(R.moments) };
}
async function api(path, opts){ const r = await fetch(path, { signal: ac.signal, ...opts }); const j = await r.json().catch(() => ({}));
  if(r.status === 401) throw new Error('sign in to keep a style library'); if(!r.ok) throw new Error((j.error && j.error.message) || ('error ' + r.status)); return j; }
$('stsave').addEventListener('click', async () => {
  if(!refProfile || refProfile.learned) return;
  $('ststat').textContent = 'Saving…';
  try{ const r = await api('/api/studio/styles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: (refProfile.name || 'Reel').slice(0, 120), category: $('stcat').value, shared: $('stshare').checked, fp: fingerprintOf(refProfile) }) });
    $('ststat').textContent = 'Saved to your ' + STYLE_KINDS[r.category] + ' styles ✓'; loadKinds(); }
  catch(err){ console.warn('style not saved:', err); $('ststat').textContent = 'Could not save your style. Please try again.'; notify('Could not save your style. Please try again.', 'err'); }
}, SIG);
async function loadKinds(){
  try{ const r = await api('/api/studio/styles'); const sel = $('lcat'), keep = sel.value; sel.innerHTML = '';
    for(const [k, name] of Object.entries(STYLE_KINDS)){ const c = r.categories[k] || { mine: 0, shared: 0 }; const o = new Option(name + ' (' + c.mine + ' mine' + (c.shared ? ', ' + c.shared + ' shared' : '') + ')', k); o.disabled = !c.mine && !c.shared; sel.add(o); }
    if(keep) sel.value = keep; $('learnrow').hidden = false;
    $('stlist').innerHTML = ''; for(const s of r.mine.slice(0, 40)){ const li = document.createElement('li'); li.textContent = STYLE_KINDS[s.category] + ': ' + s.name + ' · ' + s.pace + (s.trans ? ' · ' + s.trans : '') + (s.shared ? ' · shared' : '') + ' ';
      const del = document.createElement('button'); del.className = 'btn mini'; del.textContent = 'Delete'; del.addEventListener('click', async () => { try{ await api('/api/studio/styles/' + s.id, { method: 'DELETE' }); loadKinds(); }catch(e){} }); li.appendChild(del); $('stlist').appendChild(li); }
  }catch(err){ $('learnrow').hidden = true; }
}
$('luse').addEventListener('click', async () => {
  const k = $('lcat').value; if(!k) return; $('linfo').textContent = 'Learning…';
  try{ const scope = $('lscope').querySelector('[aria-pressed="true"]').dataset.s, r = await api('/api/studio/styles/learned?category=' + encodeURIComponent(k) + '&scope=' + scope);
    if(!r.fp){ $('linfo').textContent = 'No Reels of this kind yet.'; return; }
    learnedKind = k;
    refProfile = { ...r.fp, name: 'Learned ' + STYLE_KINDS[k] + ' style', cuts: [], learned: true };
    GRADES.copy = { con:1, sat:1, bri:1, warm:0, teal:0, mono: refProfile.look && refProfile.look.sat < 0.05 ? 1 : 0, lift:0, vig:0, grain:0 }; copyLookKey = '';
    const lb = $('look').querySelector('[data-l="copy"]'); lb.hidden = false; look = refProfile.look ? 'copy' : look; [...$('look').children].forEach(x=>x.setAttribute('aria-pressed', x.dataset.l === look));
    $('linfo').textContent = 'Learned from ' + r.n + ' Reel' + (r.n > 1 ? 's' : '') + (r.accuracy ? ' · predicts a new ' + STYLE_KINDS[k].toLowerCase() + ' Reel ' + Math.round(r.accuracy.learned*100) + '% (default style ' + Math.round(r.accuracy.baseline*100) + '%)' : '') + (r.corrections ? ' · ' + r.corrections + ' of your changes' : '');
    setMode('copy'); $('refinfo').textContent = refProfile.name + ': ' + describeRef(refProfile); $('stsaverow').hidden = true;
  }catch(err){ console.warn('learned style:', err); $('linfo').textContent = 'Your learned style is not ready yet.'; }
}, SIG);
$('lscope').addEventListener('click', e => { const b = e.target.closest('button'); if(!b) return; [...$('lscope').children].forEach(x => x.setAttribute('aria-pressed', String(x === b))); }, SIG);
// corrections: what the creator changes, a few seconds later in one request
function noteEdit(type, field, from, to, byAi){
  if(from === to) return;
  editsQ.push({ type: ['drop','hit','cut','break'].includes(type) ? type : 'cut', field, from: String(from).slice(0, 24), to: String(to).slice(0, 24), ...(byAi ? { ai: true } : {}) });
  clearTimeout(editsT); editsT = setTimeout(() => { const q = editsQ.splice(0, 100); if(!q.length) return;
    api('/api/studio/styles/edits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category: learnedKind || 'general', edits: q }) }).catch(() => {}); }, 3000);
}
loadKinds();


/* =============== START =============== */
/* ---- voiceover: your voice recorded over the Reel while it plays ----
 * The microphone goes through an AudioWorklet in the same audio clock as the song, so every captured block knows when
 * it was heard; the voice is placed on the Reel at that moment minus the time the sound took to reach the speaker (what
 * you reacted to). While recording the song plays softer; in the Reel it steps back under the voice (80 ms down, 400 ms
 * up). The voice is brought to one loudness; captions, when on, are made from it. Saved with the Reel. */
let vo = null, voRec = null, baseBuf = null, baseNorm = 1;
const VO_WORKLET = `class R extends AudioWorkletProcessor{constructor(){super();this.on=false;this.b=new Float32Array(4096);this.n=0;this.t=0;this.port.onmessage=e=>{this.on=e.data.on;if(!this.on&&this.n){this.port.postMessage({t:this.t,d:this.b.slice(0,this.n)});this.n=0;}};}
process(inp){const ch=inp[0]&&inp[0][0];if(this.on&&ch){if(!this.n)this.t=currentTime;this.b.set(ch,this.n);this.n+=ch.length;if(this.n+128>this.b.length){this.port.postMessage({t:this.t,d:this.b.slice(0,this.n)});this.n=0;}}return true;}}
registerProcessor('vo-rec',R);`;
let voWorkletReady = null;
function voStat(t){ $('vostat').textContent = t; }
/* ---- the Reel's sound: one mix that the preview and the export both play ----
 * the song part (baseBuf, with its loudness from useSection) at the music volume with its fades, the voiceover (through
 * the voice changer; the song steps back while it speaks) and each shot's own sound at its volume (cs.vol). ---- */
// clip: the clips' own sound under the song: mute (the default: no wind, traffic or chatter), voices (only where
// people speak), all (every shot's sound, a little under the song)
const AU0 = { mvol: 1, mfin: 0, mfout: 0, vfx: 'none', ai: true, clip: 'mute' };
const musicOut = () => au.mfout || (au.ai ? 0.8 : 0);
let au = { ...AU0 }, clipMixKey = '';
const fxCache = new Map();
function voPcm(){ if(!vo) return null; if(au.vfx === 'none') return vo.pcm;
  const k = vo.key + '|' + au.vfx + '|' + denoiseOn; if(!fxCache.has(k)){ fxCache.clear(); fxCache.set(k, voiceFx(vo.pcm, vo.sr, au.vfx)); } return fxCache.get(k); }
// a shot's own sound, decoded once per clip (null: the clip has no sound)
async function clipPcm(si){
  const s = sources[si]; if(!s) return null; if(s.pcm !== undefined) return s.pcm;
  try{ const b = await decodeAnyAudio(s.file), m = new Float32Array(b.length), ch = b.numberOfChannels;
    for(let c=0;c<ch;c++){ const d = b.getChannelData(c); for(let i=0;i<m.length;i++) m[i] += d[i]/ch; }
    s.pcm = { x: m, sr: b.sampleRate }; }catch(e){ s.pcm = null; }
  return s.pcm;
}
const clipVoiced = () => kind !== 'talk' && edit.some(e => e.cs && e.cs.vol > 0);
/* ---- text to speech (on the phone, Piper voices): each piece of speech starts at its time and is mixed like the
 * voiceover (the voice changer works on it too; the song steps back while it speaks) ---- */
let ttsClips = [], ttsSeq = 0;
const ttsPcm = (c) => { if(!c.pcm) return null; if(au.vfx === 'none') return c.pcm; const k = 'tts' + c.id + '|' + au.vfx; if(!fxCache.has(k)) fxCache.set(k, voiceFx(c.pcm, c.sr, au.vfx)); return fxCache.get(k); };
async function ttsMake(c, quiet){
  if(c.pcm || !tts) return; const id = 'tts' + c.id;
  if(!quiet) tasks.start(id, 'voice', 'Making the voice', '"' + c.text.slice(0, 40) + (c.text.length > 40 ? '…' : '') + '"');
  try{ const r = await tts.speak(c.text, c.voice, (pr) => { if(!quiet) tasks.update(id, pr.p, pr.stage === 'download' ? 'Getting the voice (once, about 60 MB)' : 'Speaking'); });
    c.pcm = r.pcm; c.sr = r.sr; if(!quiet) tasks.done(id, 'Voice ready'); }
  catch(err){ console.warn('tts', err); if(!quiet) tasks.fail(id, 'Could not make the voice. Check the internet for the first download and try again.'); throw err; }
}
async function ttsAdd(){
  const text = $('ttstext').value.trim(), voice = $('ttsvoice').value; if(!text || !voice) return;
  if(!tts){ notify('Text to speech is not available here.', 'err'); return; }
  const c = { id: ++ttsSeq, text, voice, at: edit.length ? Math.max(0, Math.min(pos, (buf ? buf.duration : 0) - 0.5)) : 0 };
  $('ttsadd').disabled = true;
  try{ await ttsMake(c); ttsClips.push(c); $('ttstext').value = ''; ttsList(); applyVo(); clipMixKey = ''; if(!playing) redrawFrame(); notify('Speech added at ' + fmt(c.at).replace(/\.\d+$/, '') + '.'); }
  catch(e){} finally{ $('ttsadd').disabled = false; }
}
function ttsList(){
  const box = $('ttslist'); box.innerHTML = '';
  for(const c of ttsClips){ const d = document.createElement('div'); d.className = 'ttsitem';
    d.innerHTML = '<span class="tt"></span><span class="tm"></span><button type="button" class="btn mini" aria-label="Remove this speech">×</button>';
    d.querySelector('.tt').textContent = '"' + c.text + '"'; d.querySelector('.tm').textContent = fmt(c.at).replace(/\.\d+$/, '') + ' · ' + ((tts && tts.voices.find(v => v.key === c.voice) || {}).label || c.voice) + (c.pcm ? ' · ' + (c.pcm.length/c.sr).toFixed(1) + ' s' : ' · not made yet');
    d.querySelector('button').addEventListener('click', () => { ttsClips = ttsClips.filter(x => x !== c); ttsList(); applyVo(); clipMixKey = ''; });
    box.appendChild(d); }
}
if(tts){ $('ttsvoice').innerHTML = tts.voices.map(v => `<option value="${v.key}">${v.label}</option>`).join(''); }
else $('ttsbox').hidden = true;
$('ttsadd').addEventListener('click', ttsAdd, SIG);
// the mix is made again only when something in it changed (called before playing and exporting)
async function ensureMix(){
  if(kind === 'talk' || !baseBuf) return;
  const shots = clipVoiced() ? edit.filter(e => e.cs && e.cs.vol > 0) : [];
  for(const e of shots) await clipPcm(e.src);
  for(const c of ttsClips) if(!c.pcm) try{ await ttsMake(c, false); }catch(e){}
  for(const L of layers){ const M = lmedia[L.m]; if(L.vol > 0 && M && M.kind === 'video' && M.pcm === undefined){ try{ const b = await decodeAnyAudio(M.file), x = new Float32Array(b.length); for(let c=0;c<b.numberOfChannels;c++){ const d = b.getChannelData(c); for(let i=0;i<x.length;i++) x[i] += d[i]/b.numberOfChannels; } M.pcm = { x, sr: b.sampleRate }; }catch(e){ M.pcm = null; } } }
  const key = JSON.stringify([au, vo && vo.key, ttsClips.map(c => [c.id, c.at, !!c.pcm]), layers.map(L => [L.id, L.t0, L.t1, L.in, L.vol]), denoiseOn, baseBuf.length, shots.map(e => [e.start, e.end, e.src, e.in, e.scaleR, speedKey(e.sp), e.cs.vol, e.cs.fin, e.cs.fout])]);
  if(key !== clipMixKey){ clipMixKey = key; applyVo(); }
}
function applyVo(){   // (the name stays: everything that changes the sound calls it)
  if(kind === 'talk' || !baseBuf) return;
  const shots = edit.filter(e => e.cs && e.cs.vol > 0 && sources[e.src] && sources[e.src].pcm);
  const lyVoiced = layers.filter(L => L.vol > 0 && lmedia[L.m] && lmedia[L.m].pcm);
  const speech = ttsClips.filter(c => c.pcm);
  const plain = !vo && !shots.length && !speech.length && !lyVoiced.length && au.mvol === 1 && !au.mfin && !musicOut();
  if(plain){ buf = baseBuf; normGain = baseNorm; return; }
  const B = baseBuf, sr = B.sampleRate, N = B.length, v = voPcm() || new Float32Array(0), vr = vo ? vo.sr : sr;
  // voice loudness: its speaking parts at about -14 dBFS
  let s2 = 0, n = 0; for(let i=0;i<v.length;i+=4){ const x = v[i]; if(Math.abs(x) > 0.01){ s2 += x*x; n++; } }
  const gv = 0.2/Math.max(0.003, Math.sqrt(s2/Math.max(1, n)));
  const mix = getCtx().createBuffer(2, N, sr), dn = Math.exp(-1/(0.08*sr)), up = Math.exp(-1/(0.4*sr));
  // the music's volume with its fade in / out
  const fi = Math.round(au.mfin*sr), fo = Math.round(musicOut()*sr), mv = (i) => au.mvol * (fi && i < fi ? i/fi : 1) * (fo && i > N - fo ? Math.max(0, (N - i)/fo) : 1);
  // the shots' own sound (mono), placed where each shot plays, at its speed; silent while a shot is frozen
  const cs = new Float32Array(N);
  for(const e of shots){ const P = sources[e.src].pcm, c = csOf(e), a = Math.round(e.start*sr), b = Math.min(N, Math.round(e.end*sr)), L = e.end - e.start;
    // the shot's loudness: about -16 dBFS at volume 100%, short fades at its cuts
    let q2 = 0, qn = 0; const i0 = Math.round(e.in*P.sr), i1 = Math.min(P.x.length, i0 + Math.round(L*P.sr*2)); for(let k=i0;k<i1;k+=8){ q2 += P.x[k]*P.x[k]; qn++; }
    const gain = c.vol * Math.min(6, 0.16/Math.max(0.002, Math.sqrt(q2/Math.max(1, qn)))), ramp = Math.round(0.012*sr);
    for(let i=a;i<b;i++){ const l = (i - a)/sr; if(rateAt(e, l) <= 0) continue;
      const k = Math.floor(srcPos(e, l)*P.sr); if(k < 0 || k >= P.x.length) continue;
      const edge = Math.min(1, (i - a)/ramp, (b - i)/ramp) * csFade(c, l, L);
      cs[i] += P.x[k]*gain*edge; } }
  for(const L of lyVoiced){ const P = lmedia[L.m].pcm, a = Math.round(L.t0*sr), b = Math.min(N, Math.round(L.t1*sr)), ramp = Math.round(0.02*sr);
    let q2 = 0, qn = 0; for(let k=0;k<P.x.length;k+=16){ q2 += P.x[k]*P.x[k]; qn++; } const g = L.vol*Math.min(6, 0.16/Math.max(0.002, Math.sqrt(q2/Math.max(1, qn))));
    for(let i=a;i<b;i++){ const k = Math.floor((L.in + (i - a)/sr)*P.sr); if(k >= P.x.length) break; cs[i] += P.x[k]*g*Math.min(1, (i - a)/ramp, (b - i)/ramp); } }
  // text to speech: each at its time, at the voiceover's loudness (resampled with a straight line between samples)
  for(const c of speech){ const P = ttsPcm(c), a = Math.round(c.at*sr), r = c.sr/sr; let q2 = 0, qn = 0;
    for(let k=0;k<P.length;k+=4){ if(Math.abs(P[k]) > 0.01){ q2 += P[k]*P[k]; qn++; } } const g = 0.2/Math.max(0.003, Math.sqrt(q2/Math.max(1, qn)));
    for(let i=a;i<N;i++){ const t = (i - a)*r, k = Math.floor(t); if(k + 1 >= P.length) break; cs[i] += (P[k] + (P[k+1] - P[k])*(t - k))*g; } }
  let env = 1, lv = 0;
  for(let c=0;c<2;c++){ const src = B.getChannelData(Math.min(c, B.numberOfChannels-1)), d = mix.getChannelData(c); env = 1; lv = 0;
    for(let i=0;i<N;i++){
      const j = Math.floor(i*vr/sr), x = (v[j] || 0)*gv;
      lv = Math.max(Math.abs(x) + Math.abs(cs[i])*0.6, lv*0.9995);           // a follower of the voice (and the shots' sound)
      const target = lv > 0.04 ? 0.22 : 0.75; env = target < env ? target + (env - target)*dn : target + (env - target)*up;
      d[i] = src[i]*baseNorm*mv(i)*env + x + cs[i];
    } }
  buf = mix; normGain = 1;
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
  if(fx === 'echo'){ const d = Math.round(0.24*sr); for(let i=0;i<x.length;i++) y[i] = x[i] + (i >= d ? y[i-d]*0.42 : 0); return y; }
  return x;
}

/* ---- AI touch-ups: after the edit is made, the AI uses the same clip tools a person would ----
 * - a clip that would lose most of its picture to the crop (a landscape clip in a Reel) and has no face to follow is
 *   fitted whole on a blurred copy of itself
 * - a dark shot gets brighter (a very bright one a little darker)
 * - a shot where someone speaks keeps its own sound under the music (the music steps back)
 * - one strong hit or drop, past the opening, plays backwards
 * - the last shot fades out with the music
 * What the AI set is listed in cs.auto; anything the creator changes is theirs and stays. Off: au.ai = false. ---- */
// the AI's shot settings, each a known field of the clip tools in its range (the server checked them too)
const AI_CS = c => { const o = {}, n = (k, a, b) => { const v = Number(c[k]); if(Number.isFinite(v) && v) o[k] = Math.min(b, Math.max(a, v)); };
  if([90,180,270].includes(c.rot)) o.rot = c.rot; for(const k of ['fh','fv','fit']) if(c[k] === true) o[k] = true;
  if(o.fit){ if(c.bg === 'blur' || c.bg === 'color') o.bg = c.bg; if(/^#[0-9a-f]{6}$/i.test(c.bgc || '')) o.bgc = c.bgc; n('bd', 0, 1); if(/^#[0-9a-f]{6}$/i.test(c.bdc || '')) o.bdc = c.bdc; }
  n('stab', 0, 1); n('bri', -1, 1); n('con', -1, 1); n('sat', -1, 1); n('warm', -1, 1); n('hi', -1, 1); n('sh', -1, 1); n('hue', -1, 1); n('sharp', 0, 1); n('vig', 0, 1); n('beauty', 0, 1); n('fin', 0, 1.5); n('fout', 0, 1.5); return o; };
function csAutoSet(e, patch){
  e.cs = e.cs || {}; const auto = e.cs.auto || [];
  for(const k in patch){ if(k in e.cs && !auto.includes(k)) continue; e.cs[k] = patch[k]; if(!auto.includes(k)) auto.push(k); }
  if(auto.length) e.cs.auto = auto; if(!Object.keys(e.cs).length) e.cs = undefined;
}
function csAutoClear(e){ if(!e.cs || !e.cs.auto) return; for(const k of e.cs.auto) delete e.cs[k]; delete e.cs.auto; if(!Object.keys(e.cs).length) e.cs = undefined; }
function speechShare(s, a, b){ const S = s.speech; if(!S) return 0; const i0 = Math.max(0, Math.floor(a/S.hop)), i1 = Math.min(S.p.length, Math.ceil(b/S.hop)); let n = 0; for(let i=i0;i<i1;i++) if(S.p[i] > 0.5) n++; return i1 > i0 ? n/(i1 - i0) : 0; }
function autoTools(){
  if(kind === 'talk' || !edit.length) return;
  edit.forEach(csAutoClear);
  if(!au.ai){ if(au.clip === 'all') edit.forEach(e => csAutoSet(e, { vol: 0.7 })); clipMixKey = ''; return; }
  const W = out.width, H = out.height;
  edit.forEach((e) => {
    const s = sources[e.src]; if(!s || !s.w) return;
    const keep = Math.min(W/s.w, H/s.h)/Math.max(W/s.w, H/s.h);   // the share of the picture a filled frame keeps
    if(keep < 0.5 && !(e.face > 0.3)) csAutoSet(e, { fit: true, bg: 'blur' });
    const need = e.sp.pos(e.end - e.start)*e.scaleR, st = s.samples && s.samples.length ? windowStats(s, e.in, e.in + need) : null;
    if(st && st.b < 0.3) csAutoSet(e, { bri: +Math.min(0.4, (0.42 - st.b)*1.4).toFixed(2), con: 0.08 });
    else if(st && st.b > 0.82) csAutoSet(e, { bri: -0.12 });
    // the clips' own sound, as chosen (a shot's own volume set by hand always stays)
    if(au.clip === 'all') csAutoSet(e, { vol: 0.7 });
    else if(au.clip === 'voices' && speechShare(s, e.in, e.in + need) > 0.4) csAutoSet(e, { vol: 0.9 });
  });
  // the AI director's own look for a shot (mirror, black and white, a framed photo, a fade...), like a person's clip tools
  edit.forEach((e, i) => { const d = dirSlotOf(i); if(d && d.cs) csAutoSet(e, AI_CS(d.cs)); });
  const cand = edit.map((e, i) => ({ e, i })).filter(({ e, i }) => i > 2 && e.start > 3 && (e.type === 'drop' || e.type === 'hit') && e.end - e.start >= 0.5 && e.end - e.start <= 1.6
    && (e.mot || 0) > 0.45 && e.sp.label === '1×' && e.efx !== 'snap' && !(e.cs && 'rev' in e.cs));
  if(cand.length) csAutoSet(cand[Math.floor(cand.length/2)].e, { rev: true });
  const last = edit[edit.length - 1]; csAutoSet(last, { fout: +Math.min(0.6, (last.end - last.start)*0.5).toFixed(2) });
  clipMixKey = ''; renderEDL(true); if(!playing) redrawFrame();
}
// where people speak in each clip (Silero VAD on the phone): read in the background once the clips are in
let speechBusy = false;
async function speechScan(){
  if(speechBusy || !speechProbs || kind === 'talk' || !au.ai) return; speechBusy = true; let found = false;
  try{ for(const s of sources){ if(s.speech !== undefined || s.removed) continue;
      const P = await clipPcm(sources.indexOf(s)); if(!P){ s.speech = null; continue; }
      try{ const p = await speechProbs(P.x, P.sr); s.speech = { p, hop: 512/16000 }; found = found || p.some(x => x > 0.5); }catch(e){ s.speech = null; } }
  } finally { speechBusy = false; }
  if(found && edit.length) autoTools();
}

/* =============== STORY -> REEL (on the phone) ===============
 * A written story becomes a narrated Reel: each sentence is spoken by a text-to-speech voice (Piper, on the phone), the
 * narration is the Reel's voiceover (the song, if any, plays quietly under it), each sentence is a scene cut from the
 * creator's clips or photos (a soft zoom or drift on each shot, a dissolve between scenes), and the captions are the
 * story's own words timed to the speech. Nothing is uploaded and nothing is charged. ---- */
let story = null;   // { scenes: [{ a, b, text }], dur }
const storySentences = (t) => (t.replace(/\s+/g, ' ').match(/[^.!?।]+[.!?।]*/g) || []).map(s => s.trim()).filter(s => s.length > 1);
async function storyVoice(text, voice, onP){
  if(!tts) throw new Error('Text to speech is not available here.');
  const ss = storySentences(text); if(!ss.length) throw new Error('Write a few sentences first.');
  const parts = []; let sr = 22050;
  for(let k=0;k<ss.length;k++){ const r = await tts.speak(ss[k], voice, (p) => onP && onP((k + (p.stage === 'speak' ? p.p : p.p*0.5))/ss.length, p.stage)); parts.push(r.pcm); sr = r.sr; }
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
// a quiet track the length of the story, for a Reel without a song (the edit needs a sound to follow)
function silentWav(sec){
  const sr = 22050, n = Math.ceil(sec*sr), b = new ArrayBuffer(44 + n*2), v = new DataView(b), s = (o, t) => { for(let i=0;i<t.length;i++) v.setUint8(o + i, t.charCodeAt(i)); };
  s(0, 'RIFF'); v.setUint32(4, 36 + n*2, true); s(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr*2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, n*2, true);
  return new File([b], 'Story.wav', { type: 'audio/wav', lastModified: Date.now() });
}
// the edit of a story: the scenes cover the whole Reel, each in shots of about 3 s, clips taken in turn
function storyEdit(){
  if(!story || !sources.length || !buf || kind === 'talk') return false;
  const D = buf.duration, n = sources.length, list = [], sc = story.scenes;
  sc.forEach((s, j) => { const a = j ? (sc[j-1].b + s.a)/2 : 0, b = j < sc.length - 1 ? (s.b + sc[j+1].a)/2 : D, parts = Math.max(1, Math.round((b - a)/3.2));
    for(let k=0;k<parts;k++) list.push({ start: a + (b - a)*k/parts, end: a + (b - a)*(k + 1)/parts, type: k ? 'cut' : 'hit', fx: 'Story', tr: k ? 'hard' : j ? 'dissolve' : 'fadein',
      efx: (j + k) % 2 ? 'pan-soft' : 'punch-soft', sp: 'normal', src: (j + k) % n, in: 0, scaleR: 1, cx: 0.5, cy: 0.45, face: 0, fs: 0 }); });
  if(!restoreEdit(list)) return false;
  edit.forEach((e, i) => { if(!repick(i, false, e.src)) repick(i, false); });
  assignPlayers(); edit.forEach(e => { e.cam = null; e.kf = keyframesFor(e); camAt(e, 0); }); renderEDL(); autoTools();
  $('s3').classList.remove('locked'); $('s3').classList.add('done'); ['play','remix','export','cover'].forEach(id => $(id).disabled = false);
  captureLoop(); editGen++; return true;
}
// the whole story: voice, sound, clips, captions (Story -> Reel drives it and shows the progress)
async function storyRun(text, voice, songFile, clipFiles, onStage){
  onStage && onStage('voice', 0);
  const S = await storyVoice(text, voice, (p, stage) => onStage && onStage('voice', p, stage));
  story = { scenes: S.scenes, dur: S.dur };
  vo = { raw: S.pcm, sr: S.sr, key: 'story' + Date.now().toString(36), clean: null };
  Object.defineProperty(vo, 'pcm', { configurable: true, get(){ return this.raw; } });
  capCache.set('vo|' + vo.key + '|0.00|' + $('caplang').value, { from: 0, words: S.words });
  setKind('music'); onStage && onStage('song', 0);
  if(songFile){ await loadMusic(songFile); setLen(Math.max(5, Math.min(180, Math.ceil(S.dur)))); au = { ...au, mvol: Math.min(au.mvol, 0.6) }; }
  else await loadMusic(silentWav(S.dur));
  onStage && onStage('clips', 0); addVideos(clipFiles); await addQueue;
  if(!edit.length || !story) makeEdit();
  $('caps').checked = true; capsOn = true; $('caprow').hidden = false; await loadCaptions();
  afterVo();
}
// No song (Music Reel: "No song? Use my clips' own sound"): clips where people talk make a talking Reel (their voice leads, pauses cut); otherwise the
// loudest clip's own sound becomes the song. 'none': no clip has any sound.
async function autoSound(){
  let talkShare = 0, loud = -1, loudV = 0;
  for(let i=0;i<sources.length;i++){ const P = await clipPcm(i); if(!P) continue;
    let q = 0, n = 0; for(let k=0;k<P.x.length;k+=32){ q += P.x[k]*P.x[k]; n++; } const r = Math.sqrt(q/Math.max(1, n)); if(r > loudV){ loudV = r; loud = i; }
    if(speechProbs){ try{ const p = await speechProbs(P.x, P.sr); sources[i].speech = { p, hop: 512/16000 }; talkShare = Math.max(talkShare, p.filter(x => x > 0.5).length/Math.max(1, p.length)); }catch(e){} } }
  if(talkShare >= 0.3){ setKind('talk'); return 'talk'; }
  if(loud >= 0 && loudV > 0.003){ await extractAudio(loud); return 'extract'; }
  return 'none';
}
// Extract audio: a clip's own sound becomes the Reel's song (its beats lead the cuts, as with any song)
async function extractAudio(si){
  const s = sources[si]; if(!s || !s.file) return;
  const P = await clipPcm(si); if(!P){ notify('That clip has no sound to use.', 'err'); return; }
  const f = new File([s.file], s.name.replace(/\.[^.]+$/, '') + ' (sound).' + (s.name.split('.').pop() || 'mp4'), { type: s.file.type, lastModified: s.file.lastModified });
  notify('Using the sound of ' + s.name.replace(/\.[^.]+$/, '') + ' as the song…'); await loadMusic(f);
}
function auUI(){
  const set = (id, v, t) => { const el = $(id); if(el){ el.value = v; const o = el.parentElement.querySelector('output'); if(o) o.textContent = t; } };
  set('mvol', au.mvol, Math.round(au.mvol*100) + '%'); set('mfin', au.mfin, au.mfin.toFixed(1) + ' s'); set('mfout', au.mfout, au.mfout.toFixed(1) + ' s');
  [...$('vfx').children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.f === au.vfx))); $('aitouch').checked = au.ai !== false;
  const ex = $('xclip'); if(ex){ const k = ex.value; ex.innerHTML = '<option value="">Use a clip\'s sound as the song…</option>' + sources.map((s, i) => `<option value="${i}">${s.name.replace(/[<&"]/g, '')}</option>`).join(''); ex.value = k && sources[+k] ? '' : ''; }
}
const auSet = (patch) => { au = { ...au, ...patch }; auUI(); applyVo(); if(!playing) redrawFrame(); };
for(const [id, k] of [['mvol','mvol'], ['mfin','mfin'], ['mfout','mfout']]) $(id).addEventListener('input', e => auSet({ [k]: +e.target.value }), SIG);
$('aitouch').addEventListener('change', e => { au = { ...au, ai: e.target.checked }; autoTools(); if(au.ai) speechScan(); applyVo(); clipMixKey = ''; }, SIG);
$('vfx').addEventListener('click', e => { const b = e.target.closest('button'); if(!b) return; if(!vo) notify('Record a voiceover first; the voice changer works on it.'); auSet({ vfx: b.dataset.f }); }, SIG);
$('xclip').addEventListener('focus', auUI, SIG);
$('xclip').addEventListener('change', e => { const v = e.target.value; e.target.value = ''; if(v !== '') extractAudio(+v); }, SIG);
async function recordVoiceover(){
  if(voRec){ voRec.stop(); return; }
  if(!edit.length || kind === 'talk') return;
  const c = getCtx(); await c.resume();
  let stream;
  try{ stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
  catch(err){ voStat('The microphone is not available (' + (err && err.name || err) + '). Allow it for this site and try again.'); return; }
  try{ voWorkletReady ??= c.audioWorklet.addModule(URL.createObjectURL(new Blob([VO_WORKLET], { type: 'text/javascript' }))); await voWorkletReady; }
  catch(err){ voWorkletReady = null; stream.getTracks().forEach(t => t.stop()); voStat('Recording is not supported in this browser.'); return; }
  // record over the song alone (no older voice), softer
  const hadVo = vo; vo = null; applyVo(); const keepNorm = normGain; normGain = keepNorm*0.45;
  const mic = c.createMediaStreamSource(stream), node = new AudioWorkletNode(c, 'vo-rec'), sink = c.createGain(); sink.gain.value = 0;
  mic.connect(node); node.connect(sink); sink.connect(c.destination);
  const blocks = []; node.port.onmessage = e => blocks.push(e.data);
  let done; const finished = new Promise(r => done = r);
  voRec = { stop: () => { if(playing){ pos = curTime(); stopAll(); } done(); } };
  setLabel('vorec', 'Stop recording'); voStat('Recording… speak now (headphones keep the song out of your voice)');
  pos = 0; await startPlayback(0);
  const t0 = startedAt, lat = (c.outputLatency || c.baseLatency || 0) + 0.015;
  node.port.postMessage({ on: true });
  onEnd = () => { onEnd = null; done(); };
  await finished;
  node.port.postMessage({ on: false }); await new Promise(r => setTimeout(r, 120));
  mic.disconnect(); node.disconnect(); sink.disconnect(); stream.getTracks().forEach(t => t.stop());
  normGain = keepNorm; voRec = null; setLabel('vorec', 'Record voiceover');
  const sr = c.sampleRate, L = Math.round(buf.duration*sr), pcm = new Float32Array(L); let got = 0;
  for(const b of blocks){ const at = Math.round((b.t - t0 - lat)*sr); for(let i=0;i<b.d.length;i++){ const k = at + i; if(k >= 0 && k < L){ pcm[k] = b.d[i]; got++; } } }
  if(got < sr*0.5){ vo = hadVo; applyVo(); voStat('Nothing was recorded.'); return; }
  vo = { raw: pcm, sr, key: Date.now().toString(36) }; await cleanVo();
  applyVo(); afterVo();
}
async function cleanVo(){
  if(!vo) return; try{ vo.clean = await denoise(vo.raw, vo.sr); }catch(e){ vo.clean = null; }
  Object.defineProperty(vo, 'pcm', { configurable: true, get(){ return denoiseOn && this.clean ? this.clean : this.raw; } });
}
function afterVo(){
  voStat(vo ? 'Voiceover ✓ ' + fmt(vo.pcm.length/vo.sr).replace(/\.\d+$/, '') + ' · the song steps back while you speak' : '');
  $('vodel').hidden = !vo; capAll = null; capWords = null; capLines = null; if(capsOn) loadCaptions(); redraw();
}
$('vorec').addEventListener('click', () => { if(!recording) recordVoiceover(); }, SIG);
$('vodel').addEventListener('click', () => { if(voRec) return; vo = null; applyVo(); afterVo(); }, SIG);

/* ---- templates: one tap sets a Reel up for its kind ----
 * Each template chooses the kind (music edit / talking), the edit's pace, the look, the length of the song, captions,
 * the background, and places its texts on the edit when there is one: steps at the thirds of a tutorial, BEFORE / AFTER
 * at the halves, the price and a follow card on a product, a greeting on a festival Reel. Everything stays editable. */
const TEMPLATES = {
  talking:  { kind: 'talk', look: 'natural', pace: 'natural', music: 0.05, caps: true, style: 'karaoke', bg: 'none' },
  tutorial: { kind: 'talk', look: 'natural', pace: 'tight', music: 0.05, caps: true, style: 'box',
              texts: L => [ { text: 'Step 1', style: 'box', color: '#FFD54A', y: 0.2, at: [0, L/3] }, { text: 'Step 2', style: 'box', color: '#FFD54A', y: 0.2, at: [L/3, 2*L/3] }, { text: 'Step 3', style: 'box', color: '#FFD54A', y: 0.2, at: [2*L/3, L] }, { text: 'Save this for later 📌', style: 'box', color: '#4DA3FF', y: 0.66, size: 0.85, at: [L - 3, L] } ] },
  recipe:   { kind: 'music', mode: 'smooth', look: 'vivid', len: 30, style: 'box',
              texts: L => [ { text: 'Easy recipe in 30 seconds', style: 'box', color: '#FFD54A', y: 0.22, at: [0, 2.6] }, { text: 'Save this recipe 📌', style: 'box', color: '#FF4D4D', y: 0.66, size: 0.85, at: [L - 3, L] } ] },
  beforeafter: { kind: 'music', mode: 'auto', look: 'vivid', len: 15, style: 'pop',
              texts: L => [ { text: 'BEFORE', style: 'box', color: '#111111', y: 0.2, at: [0, L/2] }, { text: 'AFTER', style: 'box', color: '#3DDC84', y: 0.2, at: [L/2, L] } ] },
  product:  { kind: 'music', mode: 'auto', look: 'vivid', len: 15, style: 'pop',
              texts: L => [ { text: 'New arrival ✨', style: 'neon', color: '#FFD54A', y: 0.22, at: [0, 2.4] }, { text: '₹999 only', style: 'tag', color: '#FFD54A', y: 0.62, at: [L*0.35, L - 3] }, { text: 'DM to order 👉', style: 'box', color: '#FF4D4D', y: 0.66, size: 0.85, at: [L - 3, L] } ] },
  montage:  { kind: 'music', mode: 'fast', look: 'cine', len: 15, style: 'pop', hook: 'WAIT FOR THE DROP' },
  travel:   { kind: 'music', mode: 'smooth', look: 'cine', len: 30, style: 'clean',
              texts: L => [ { text: '📍 Your place', style: 'clean', color: '#FFFFFF', y: 0.25, at: [0, 3] } ] },
  ganpati:  { kind: 'music', mode: 'auto', look: 'vivid', len: 30, style: 'pop',
              texts: L => [ { text: 'गणपती बाप्पा मोरया 🌺', style: 'neon', color: '#FFD54A', y: 0.26, all: true } ] },
  diwali:   { kind: 'music', mode: 'smooth', look: 'cine', len: 30, style: 'pop',
              texts: L => [ { text: 'शुभ दीपावली 🪔', style: 'neon', color: '#FFD54A', y: 0.26, all: true } ] },
};
let tplWaiting = null, tplGen = 0, tplNeed = false;
function placeTemplateTexts(t){
  const L = reelLen(); if(!t.texts || !L) return;
  overlays = overlays.filter(o => !o.tpl);   // texts of an earlier template go
  for(const x of t.texts(L)){ const ov = addOverlay({ ...x, all: !!x.all }); ov.tpl = true; if(x.at){ ov.t0 = Math.max(0, x.at[0]); ov.t1 = Math.min(L, x.at[1]); ov.all = false; } }
  ovSel = -1; renderOvList(); redraw();
}
function useTemplate(name){
  const t = TEMPLATES[name]; if(!t || recording) return;
  tplName = name;
  [...$('tpl').children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.t === name)));
  setKind(t.kind);
  if(t.look) press('look', 'l', t.look);
  if(t.style) press('tstyle', 't', t.style);
  if(t.mode) press('mode', 'm', t.mode);
  if(t.kind === 'talk'){ press('tpace', 'p', t.pace); press('tmusic', 'v', String(t.music)); }
  if(t.bg) press('bgmode', 'b', t.bg);
  if(t.hook !== undefined){ hookText = t.hook; $('hook').value = t.hook; }
  if(t.caps && !capsOn && !$('capwrap').hidden){ $('caps').checked = true; capsOn = true; $('caprow').hidden = false; loadCaptions(); }
  const gen0 = editGen, kind0 = kind;
  if(t.kind === 'music' && t.len !== undefined && song) setLen(t.len); else if(t.kind === 'music' && t.len !== undefined){ sec.len = t.len; sec.auto = true; }
  tplWaiting = t; tplGen = gen0; tplNeed = sources.length > 0 && (editGen === gen0 ? (t.len !== undefined && !!song) || kind0 !== kind || kind === 'talk' : false);
  $('tplhelp').textContent = edit.length ? '' : 'Now add ' + (t.kind === 'talk' ? 'your talking clips' : 'a song and your clips') + ': the template is applied to the edit.';
  tplApplySoon();
}
// the texts go on once the edit has its final length (after the song part and the clips are in)
function tplApplySoon(){
  clearTimeout(tplApplySoon.h);
  tplApplySoon.h = setTimeout(() => { if(!tplWaiting) return; if(!edit.length || pending || (tplNeed && editGen === tplGen) || (kind === 'talk' && /Finding/.test($('s3st').textContent))){ tplApplySoon(); return; }
    placeTemplateTexts(tplWaiting); tplWaiting = null; $('tplhelp').textContent = ''; }, 600);
}
$('tpl').addEventListener('click', e => { const b = e.target.closest('button'); if(b) useTemplate(b.dataset.t); }, SIG);
$('postcapt').addEventListener('input', () => { capEdited = true; $('postcapst').textContent = ''; }, SIG);
$('postcopy').addEventListener('click', () => copyCaption($('postcapt').value.trim()), SIG);

/* =============== SAVED REELS ===============
 * Every Reel is kept on this phone (IndexedDB, which every browser has; nothing is uploaded): its song and clips (each
 * file once, shared between Reels), the settings, the exact edit (every shot's moment, transition, effect, speed), the
 * texts, the part of the song and the captions already transcribed. It is saved a few seconds after anything changes;
 * "Your Reels" opens one again exactly as it was (the page reloads into it). */
const PDB = 'brs-projects';
let proj = null, lastSig = '', restoring = false, capKeyNow = '';
const fileFp = f => f ? [f.name, f.size, f.lastModified].join('|') : '';
let voF = null; const voFile = () => (voF && voF.name === 'voiceover-' + vo.key + '.f32') ? voF : (voF = new File([vo.raw], 'voiceover-' + vo.key + '.f32', { type: 'application/octet-stream', lastModified: parseInt(vo.key, 36) || 1 }));
function pdb(){ return new Promise((res, rej) => { const r = indexedDB.open(PDB, 2);
  r.onupgradeneeded = () => { const d = r.result; if(!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'id' }); if(!d.objectStoreNames.contains('files')) d.createObjectStore('files');
    if(!d.objectStoreNames.contains('songs')) d.createObjectStore('songs', { keyPath: 'fp' }); };
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
function idb(store, mode, fn){ return pdb().then(d => new Promise((res, rej) => { const t = d.transaction(store, mode), req = fn(t.objectStore(store));
  t.oncomplete = () => { d.close(); res(req && 'result' in req ? req.result : undefined); }; t.onerror = () => { d.close(); rej(t.error); }; t.onabort = () => { d.close(); rej(t.error || new Error('storage full')); }; })); }
function editOf(){
  return kind === 'talk' ? [] : edit.map(e => ({ start: e.start, end: e.end, type: e.type, fx: e.fx, tr: e.tr, efx: e.efx, sp: speedKey(e.sp), src: e.src, in: e.in, scaleR: e.scaleR, cx: e.cx, cy: e.cy, face: e.face, fs: e.fs, uk: e.uk && e.uk.length ? e.uk : undefined, acc: e.acc && e.acc.length ? e.acc : undefined, ak: e.ak && e.ak.length ? e.ak : undefined, cs: e.cs ? JSON.parse(JSON.stringify(e.cs)) : undefined }));
}
function stateOf(){
  return { kind, song: song && song.file ? { fp: fileFp(song.file), name: song.name } : null, sec: { len: sec.len, auto: sec.auto, start: sec.start },
    clips: sources.map(s => ({ fp: fileFp(s.file), name: s.name })),
    settings: { au, tts: ttsClips.map(c => ({ id: c.id, text: c.text, voice: c.voice, at: c.at })), trTo, trOnly, tr: trTo ? [...trCache].filter(([k]) => k.startsWith(trTo + '|')).slice(0, 200) : [], denoise: denoiseOn, mode: mode === 'copy' ? 'auto' : mode, look: look === 'copy' ? 'vivid' : look, aspect, textStyle, hookText, capsOn, caplang: $('caplang').value, talkPace, talkMusic, bgMode, bgColor, marks: userMarks.slice(0, 200), capColor: ACCENT, seed, bg: bgFile ? fileFp(bgFile) : '' },
    overlays: overlays.map(o => { const c = { ...o }; delete c.box; return c; }),
    lmedia: lmedia.map(M => ({ fp: fileFp(M.file), name: M.name })), layers: lyOf(),
    edit: editOf(),
    kfs: kind === 'talk' && edit.some(e => e.uk && e.uk.length) ? edit.map(e => e.uk && e.uk.length ? e.uk : null) : undefined,
    caps: capAll && capKeyNow ? { key: capKeyNow, all: capAll } : null, vo: vo ? { key: vo.key, sr: vo.sr, fp: fileFp(voFile()) } : null };
}
async function putFile(f){ const k = 'f:' + fileFp(f); if(await idb('files', 'readonly', s => s.getKey(k)) === undefined) await idb('files', 'readwrite', s => s.put(f, k)); }
function thumbOf(){ if(!edit.length) return ''; const c = document.createElement('canvas'), H = 240, W = Math.round(H*out.width/out.height); c.width = W; c.height = H; c.getContext('2d').drawImage(out, 0, 0, W, H); try{ return c.toDataURL('image/jpeg', 0.7); }catch(e){ return ''; } }
let saving = false;
async function saveProject(st, sig){
  if(saving) return; saving = true;
  try{
    if(!proj){ proj = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), created: Date.now() }; try{ navigator.storage && navigator.storage.persist && navigator.storage.persist(); }catch(e){} }
    if(song && song.file) await putFile(song.file);
    for(const s of sources) if(s.file) await putFile(s.file);
    if(bgFile) await putFile(bgFile);
    for(const M of lmedia) await putFile(M.file);
    if(vo) await putFile(voFile());
    const name = (song && song.name ? song.name.replace(/\.[^.]+$/, '') : sources[0] ? sources[0].name.replace(/\.[^.]+$/, '') : 'Reel');
    await idb('meta', 'readwrite', s => s.put({ id: proj.id, created: proj.created, updated: Date.now(), name, kind, dur: buf ? buf.duration : 0, shots: edit.length, thumb: thumbOf(), state: st }));
    lastSig = sig; $('psaved').textContent = 'Saved on this phone ✓ ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }catch(err){ console.warn('project not saved:', err); $('psaved').textContent = 'Not saved'; notify('Could not save this Reel on your phone. It may be low on space.', 'err'); }
  finally{ saving = false; }
}
setInterval(() => {
  if(restoring || recording || exporting || pending || (!song && !sources.length) || typeof indexedDB === 'undefined') return;
  const st = stateOf(), sig = JSON.stringify(st); if(sig !== lastSig) saveProject(st, sig);
}, 3000);
const press = (seg, attr, val) => { const b = $(seg).querySelector(`[data-${attr}="${val}"]`); if(b && b.getAttribute('aria-pressed') !== 'true') b.click(); };
async function openProject(id){
  restoring = true; const say = t => { $('psaved').textContent = t; };
  try{
    const p = await idb('meta', 'readonly', s => s.get(id)); if(!p){ say('That Reel is no longer on this phone.'); return; }
    const st = p.state, getF = async (fp, name) => { const b = fp ? await idb('files', 'readonly', s => s.get('f:' + fp)) : null; return b ? new File([b], name || b.name || 'file', { type: b.type, lastModified: +fp.split('|').pop() || Date.now() }) : null; };
    say('Opening "' + p.name + '"…'); proj = { id: p.id, created: p.created };
    const S = st.settings || {};
    talkKfs = st.kind === 'talk' && st.kfs ? st.kfs : null;
    if(st.kind === 'talk') setKind('talk');
    press('aspect', 'a', S.aspect); press('look', 'l', S.look); press('tstyle', 't', S.textStyle); if(S.mode && S.mode !== 'auto') press('mode', 'm', S.mode);
    press('tpace', 'p', S.talkPace); press('tmusic', 'v', String(S.talkMusic));
    if(S.au) au = { ...AU0, ...S.au }; auUI();
    if(S.tts && S.tts.length){ ttsClips = S.tts.map(c => ({ ...c })); ttsSeq = ttsClips.reduce((q, c) => Math.max(q, c.id), 0); ttsList(); }
    hookText = S.hookText || ''; $('hook').value = hookText; seed = S.seed || 1; if(S.denoise === false){ denoiseOn = false; $('dn1').checked = false; $('dn2').checked = false; }
    if(S.caplang !== undefined) $('caplang').value = S.caplang;
    if(S.trTo){ for(const [k, v] of S.tr || []) trCache.set(k, v); trTo = S.trTo; trOnly = !!S.trOnly; $('captr').value = trTo; $('tronly').checked = trOnly; $('trwrap').hidden = false; }
    if(st.caps && st.caps.key) capCache.set(st.caps.key, st.caps.all);
    if(st.vo && st.vo.fp){ const vf = await getF(st.vo.fp, 'voiceover-' + st.vo.key + '.f32'); if(vf){ vo = { raw: new Float32Array(await vf.arrayBuffer()), sr: st.vo.sr, key: st.vo.key }; await cleanVo(); } }
    if(S.bg){ const bf = await getF(S.bg, 'background'); if(bf){ bgFile = bf; const im = new Image(); im.onload = () => { bgImg = im; redrawFrame(); }; im.src = URL.createObjectURL(bf); } }
    if(S.capColor) ACCENT = S.capColor;
    if(Array.isArray(S.marks)) userMarks = S.marks.filter(Number.isFinite);
    bgColor = S.bgColor || bgColor; if(S.bgMode && S.bgMode !== 'none') press('bgmode', 'b', S.bgMode);
    overlays = (st.overlays || []).map(o => ({ ...o })); ovSeq = overlays.reduce((q, o) => Math.max(q, o.id || 0), 0); renderOvList();
    if(st.sec){ sec.len = st.sec.len; sec.auto = st.sec.auto; sec.start = st.sec.start;
      [...$('slen').children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.l === (!sec.len ? '0' : [15,30,60].includes(sec.len) ? String(sec.len) : 'c'))));
      if(sec.len && ![15,30,60].includes(sec.len)){ $('slenc').value = sec.len; $('slencw').hidden = false; } $('sauto').hidden = !sec.len; $('lenhint').hidden = !sec.len; $('mwave').classList.toggle('drag', !!sec.len); }
    const clips = []; for(const c of st.clips || []){ const f = await getF(c.fp, c.name); if(f) clips.push(f); }
    const sf = st.song ? await getF(st.song.fp, st.song.name) : null;
    if(sf){ let cs = null; try{ cs = await idb('songs', 'readonly', s => s.get(st.song.fp)); }catch(e){} await loadMusic(sf, cs && cs.r ? { r: cs.r, aiDone: cs.aiDone } : null); }
    if(clips.length){ addVideos(clips); await addQueue; }
    if(st.kind !== 'talk' && st.edit && st.edit.length && st.edit.length && clips.length === (st.clips || []).length) restoreEdit(st.edit);
    if(st.layers && st.layers.length){ const ms = []; for(const c of st.lmedia || []){ const f = await getF(c.fp, c.name); try{ ms.push(f ? await addLayerMedia(f) : null); }catch(e){ ms.push(null); } }
      lmedia = ms.filter(Boolean); const idx = ms.map((m, i) => m ? ms.slice(0, i).filter(Boolean).length : -1);
      layers = st.layers.filter(L => idx[L.m] >= 0).map(L => ({ ...L, m: idx[L.m] })); lySeq = layers.reduce((q, L) => Math.max(q, L.id), 0); lyUI(); }
    if(S.capsOn && !capsOn){ $('caps').checked = true; capsOn = true; $('caprow').hidden = false; loadCaptions(); }
    if(vo) afterVo();
    redrawFrame();
    const missing = (st.clips || []).length - clips.length + (st.song && !sf ? 1 : 0);
    say(missing ? missing + ' file(s) of this Reel are no longer on this phone' : 'Opened "' + p.name + '" · saved on this phone');
  }catch(err){ console.warn('project not opened:', err); say('This Reel could not be opened.'); notify('This Reel could not be opened.', 'err'); }
  finally{ lastSig = JSON.stringify(stateOf()); restoring = false; }
}
function restoreEdit(list){
  if(!list.every(x => sources[x.src])) return false;
  stopAll(); const uc = sources.map(() => 0);
  edit = list.map(x => { const e = { ...x, el: sources[x.src].els[(uc[x.src]++) % 3], dirWhy: '', why: '' }; e.sp = speedFor(x.sp, e); e.kf = keyframesFor(e); e.beatsIn = beats.filter(b => b > e.start + 0.12 && b < e.end - 0.05).map(b => b - e.start); return e; });
  plan = edit.map(e => ({ start: e.start, end: e.end, type: e.type, fx: e.fx, sp: e.sp, tr: e.tr, efx: e.efx, acc: e.acc, ak: e.ak }));
  setCanvas(); edit.forEach(e => camAt(e, 0)); renderEDL(); drawMusic(); captureLoop(); editGen++;
  return true;
}
{ const q = new URLSearchParams(location.search).get('p'); if(q && typeof indexedDB !== 'undefined') openProject(q); else keptSweep(); }

/* ---- My music: the songs used lately, on this phone, picked again in one tap ----
 * Each song is kept once (with the saved Reels' files) together with its finished analysis (beats, drops, AI check), so
 * picking it again is instant. Up to 12; the oldest go (their file too, unless a saved Reel uses it). */
const RECENT_MAX = 12;
async function rememberSong(file, r, aiDone){
  if(typeof indexedDB === 'undefined' || !file) return;
  try{ await putFile(file); const fp = fileFp(file);
    await idb('songs', 'readwrite', s => s.put({ fp, name: file.name, type: file.type, dur: song ? song.buf.duration : 0, usedAt: Date.now(), r, aiDone: !!aiDone }));
    const all = (await idb('songs', 'readonly', s => s.getAll()) || []).sort((a, b) => b.usedAt - a.usedAt);
    for(const old of all.slice(RECENT_MAX)) await forgetSong(old.fp, true);
    listRecent();
  }catch(e){ console.info('recent song not kept:', e && e.message); }
}
async function forgetSong(fp, quiet){
  await idb('songs', 'readwrite', s => s.delete(fp));
  const metas = await idb('meta', 'readonly', s => s.getAll()) || [];
  const used = metas.some(p => p.state && ((p.state.song && p.state.song.fp === fp) || (p.state.clips || []).some(c => c.fp === fp)));
  if(!used) await idb('files', 'readwrite', s => s.delete('f:' + fp));
  if(!quiet) listRecent();
}
async function listRecent(){
  let all = []; try{ all = (await idb('songs', 'readonly', s => s.getAll()) || []).sort((a, b) => b.usedAt - a.usedAt); }catch(e){ return; }
  const box = $('rlist'); box.innerHTML = '';
  for(const sg of all){
    const d = document.createElement('div'); d.className = 'rsong' + (song && song.file && fileFp(song.file) === sg.fp ? ' cur' : '');
    d.innerHTML = '<button class="rpick" type="button"><span class="rn"></span><span class="rd"></span></button><button class="rdel" type="button" aria-label="Remove from recent songs" title="Remove">×</button>';
    d.querySelector('.rn').textContent = '♪ ' + sg.name.replace(/\.[^.]+$/, ''); d.querySelector('.rd').textContent = fmt(sg.dur || 0).replace(/\.\d+$/, '');
    d.querySelector('.rpick').addEventListener('click', () => pickRecent(sg.fp));
    d.querySelector('.rdel').addEventListener('click', () => forgetSong(sg.fp));
    box.appendChild(d);
  }
  $('recent').hidden = !all.length;
}
async function pickRecent(fp){
  if(recording) return;
  const sg = await idb('songs', 'readonly', s => s.get(fp)), b = sg && await idb('files', 'readonly', s => s.get('f:' + fp));
  if(!sg || !b){ await forgetSong(fp); return; }
  const f = new File([b], sg.name, { type: sg.type || b.type, lastModified: +fp.split('|').pop() || Date.now() });
  loadMusic(f, sg.r ? { r: sg.r, aiDone: sg.aiDone } : null);
}
listRecent();

root.__studio = { get songR(){ return song && song.r; }, get now(){ return playing ? Math.max(0, curTime()) : (pos || 0); }, get playing(){ return playing; }, get dur(){ return buf ? buf.duration : 0; }, get songName(){ return song && song.name ? song.name.replace(/\.[^.]+$/, '') : ''; }, get title(){ return song && song.name ? song.name.replace(/\.[^.]+$/, '') : sources[0] ? sources[0].name.replace(/\.[^.]+$/, '') : ''; }, get hook(){ return hookText; }, get capsOn(){ return capsOn; }, segAt, drawTimeline, state: () => stateOf(), get pos(){ return pos; }, get playing(){ return playing; }, kfSet, kfTarget: () => kfTarget(), kfSeek, uAt, emph: emphAt, get capLines(){ return capLines; }, get editGen(){ return editGen; }, get vo(){ return vo; }, get base(){ return { buf: baseBuf, norm: baseNorm }; }, get overlays(){ return overlays; }, get bg(){ return { mode: bgMode, mask: !!bgMask, err: bgErr }; }, get faceHow(){ return sources.map(s => s.faceHow); }, seek: t => { pos = t; const i = segAt(t); return prepare(i, t).then(()=>drawFrame(t)); }, get talk(){ return talk; }, get audio(){ return buf; }, get kind(){ return kind; }, get section(){ return { start: secStart, len: buf ? buf.duration : 0, auto: sec.auto, whole: song ? song.buf.duration : 0, words: capWords }; }, get wakeLockHeld(){ return !!wakeLock; }, loseGL: () => GL && GL.gl.getExtension('WEBGL_lose_context'), renderedLook, get capLines(){ return capLines; }, faceYOnScreen, get edit(){ return edit; }, get plan(){ return plan; }, sources, gl: !!GL, get beats(){ return beats; }, get beatInfo(){ return beatInfo; }, get ref(){ return refProfile; }, get grade(){ return GRADES[look]; },
  shotOp, shotCs, shotSet, shotSlip, shotTrim, shotReverse, addMark, clearMarks, setTlZoom, setLook: k => { const b = $('look').querySelector('[data-l="' + k + '"]'); if(b) b.click(); return look; }, get marks(){ return userMarks; }, autoExport, extractAudio, autoSound, storyRun, saveLast: () => lastVideo && saveFile(lastVideo, lastName || 'reel.mp4'),
  get work(){ return { song: !!song || kind === 'talk', songReady: kind === 'talk' || !!(song && buf && song.r), beats: beatsBusy, pending, clips: sources.length, shots: edit.length, ai: aiBusy, dir: dirBusy, speech: speechBusy, exporting: exportBusy, exportP }; }, shotExtract: () => edit.length && extractAudio(edit[segAt(pos)].src), get au(){ return au; }, ensureMix, get canUndo(){ return hist.u.length > 0; }, get layers(){ return layers; }, get lmedia(){ return lmedia; }, get canRedo(){ return hist.r.length > 0; },
  frameAt: async t => { const i = segAt(t); await prepare(i, t); drawFrame(t); return i; }, camAt };   // read by tests

  return () => {
    try{ stopAll(); }catch(err){}
    ac.abort(); tasks.dispose();
    sources.forEach(s=>{ (s.els||[]).forEach(v=>{ v.pause(); v.removeAttribute('src'); v.load(); }); URL.revokeObjectURL(s.url); });
    try{ ctx && ctx.close(); }catch(err){}
  };
}
