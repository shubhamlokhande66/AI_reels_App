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
export function initStudio(root, deps) {
  const { loadMediabunny, loadAacEncoder = null, beatThis: aiBeats = null, speechProbs = null, personMask = null, findFaces = null } = deps;

const $ = id => root.querySelector('#'+id);
const ac = new AbortController(), SIG = { signal: ac.signal };
let exporting = false;
const texOf = e => exporting ? (e.fc || e.fcLast) : e.el;
const fmt = t => { t = Math.max(0,t); const m = Math.floor(t/60), s = t - m*60; return m + ':' + (s<10?'0':'') + s.toFixed(2); };
let ctx = null, buf = null, mono = null;
let period = 0, phase = 0, hopSec = 0, rmsF = null, hitsStr = [], barOff = 0, beatLvl = [];
let onEnv=null, onFps=0, onOff=0, hitsRaw=[];
let cutFx = [], pfArr = null;
const DRUM_MIN = 0.7;
let beats = [], cuts = [], cutType = [], peaks = [], peakS = [];
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
  beats = beatsDP.filter(t => t >= 0 && t < dur-0.02);
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
let plan = [], basePlan = [], normGain = 1, mode = 'auto', musicToken = 0;
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
async function loadMusic(file){
  const name = file.name, token = ++musicToken;   // a newer song wins over anything still running for an older one
  stopAll();
  $('s1st').textContent = 'Analysing the song… (you can keep using the page)'; $('mname').textContent = name; $('s1').classList.remove('done');
  let whole;
  try{ whole = await decodeAnyAudio(file); }
  catch(e){ if(token !== musicToken) return; console.warn('song not readable', e); $('s1st').textContent = 'Could not read the sound of this file. Use MP3, M4A, WAV or a video with sound. (Songs in the Apple Music app are protected and cannot be opened by websites.)'; return; }
  if(token !== musicToken) return;
  const m = new Float32Array(whole.length);
  { const ch = whole.numberOfChannels; for(let c=0;c<ch;c++){ const d = whole.getChannelData(c); for(let i=0;i<m.length;i++) m[i] += d[i]/ch; } }
  song = { buf: whole, mono: m, r: null, name, key: name + '|' + whole.duration.toFixed(2) };
  buf = whole; mono = m; secStart = 0; capWords = null; capLines = null; capAll = null;
  drawMusic();
  let r;
  try{ r = await analyseInWorker(m, whole.sampleRate); }
  catch(err){ console.warn('song analysis worker unavailable, analysing on the page', err); await new Promise(rr=>setTimeout(rr,30)); r = songAnalysis(m, whole.sampleRate); }
  if(token !== musicToken) return;   // another song was chosen meanwhile
  song.r = r; song.source = 'own';
  await useSection(token);
  if(token !== musicToken) return;
  $('s1st').textContent = 'Ready'; $('s1').classList.add('done'); $('s2').classList.remove('locked'); $('lenrow').hidden = kind === 'talk';
  checkBeatsWithAi(token);
  if(capsOn) loadCaptions();
}

/* ---- how much of the song: the whole song, or a part of 15 s / 30 s / 1 min / any length ----
 * The whole song is analysed once (its beats are judged on all of its music); a part is cut out of it on whole beats,
 * so the cut lands on the grid of the whole song. "Best part" picks the part itself: full and loud, the drop early (a
 * hook in the first seconds), no quiet start; dragging on the waveform picks it by hand (snapped to the nearest beat). */
let song = null, sec = { len: 0, auto: true, start: 0 }, secStart = 0, dragStart = null, secBusy = 0;
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
  pos = 0;
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
// drag on the waveform: the part follows the finger, and is cut when let go
{ const cv = $('mwave'); let grab = 0;
  const tAt = ev => { const rc = cv.getBoundingClientRect(); return (ev.clientX - rc.left)/Math.max(1, rc.width)*song.buf.duration; };
  cv.addEventListener('pointerdown', ev => { if(!song || !song.r || !sec.len || recording) return; const t = tAt(ev), L = secLenNow();
    grab = (t >= secStart && t <= secStart + L) ? t - secStart : L/2; dragStart = Math.max(0, Math.min(song.buf.duration - L, t - grab));
    cv.setPointerCapture(ev.pointerId); if(playing) stopAll(); drawMusic(); ev.preventDefault(); }, SIG);
  cv.addEventListener('pointermove', ev => { if(dragStart == null) return; const L = secLenNow(); dragStart = Math.max(0, Math.min(song.buf.duration - L, tAt(ev) - grab)); drawMusic(); }, SIG);
  const end = () => { if(dragStart == null) return; sec.start = dragStart; sec.auto = false; dragStart = null; useSection(); };
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
async function checkBeatsWithAi(token){
  if(!aiBeats || !song) return;
  const sr = song.buf.sampleRate, m = song.mono, base = 'Ready';
  const say = t => { if(token === musicToken) $('s1st').textContent = t; };
  say(base + ' · checking the beats with the on-device AI…');
  let bt;
  try{ bt = await aiBeats(m, sr, (stage, p) => say(base + (stage === 'download' ? ' · getting the AI beat tracker (once) ' : ' · AI beat check ') + Math.round(p*100) + '%')); }
  catch(err){ beatInfo = { source: 'own', note: String(err && err.message || err) }; say(base); console.info('on-device beat tracker not used:', beatInfo.note); return; }
  if(token !== musicToken) return;
  let r;
  try{ r = await analyseInWorker(m, sr, { beats: bt.beats }); } catch(err){ r = songAnalysis(m, sr, { beats: bt.beats }); }
  if(token !== musicToken) return;
  beatInfo = { source: r.beatSource, note: '', ms: bt.ms, judge: r.beatJudge, ai: bt };
  song.r = r; song.source = r.beatSource;
  const was = playing && !recording;
  await useSection(token);
  if(token !== musicToken) return;
  say(base + (r.beatSource === 'ai' ? ' · beats confirmed by the on-device AI (Beat This!)' : ' · beats double-checked: the AI agrees or fits less well, kept'));
  if(sources.length && was) showMsg('The beats were refined, the edit follows them. Press Preview again.');
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
let addQueue = Promise.resolve(), pending = 0;
function addVideos(files){
  const list = [...files].filter(f=>f.type.startsWith('video/') || /\.(mp4|mov|webm|m4v|3gp|mkv)$/i.test(f.name));
  if(!list.length){ $('s2st').textContent = 'That is not a video. Choose MP4, MOV or WEBM.'; return; }
  if(playing){ pos = curTime(); stopAll(); }   // free the computer so reading is fast
  const jobs = list.map(f=>makeCard(f));
  pending += jobs.length; updateQ();
  jobs.forEach(job=>{ addQueue = addQueue.then(()=>readVideo(job)).catch(()=>{}).then(()=>{ pending--; updateQ(); }); });
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
async function readVideo(src){
  if(src.removed) return;
  const card = src.card, dd = card.querySelector('.dd');
  try{
    dd.textContent = 'reading…';
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
    const show = () => { dd.textContent = 'reading ' + Math.round((pm*0.6 + pf*0.4)*100) + '%'; };
    src.readMs = {};
    await Promise.all([
      scanMotion(src, p=>{ pm = p; show(); }).then(()=>{ src.readMs.motion = Math.round(performance.now()-tq); }),
      scanFaces(src, p=>{ pf = p; show(); }).then(()=>{ src.readMs.faces = Math.round(performance.now()-tq); }),
    ]);
    if(src.removed) return;
    const nf = src.faces.filter(f=>f.n>0).length, shs = src.samples.map(s=>s.sh).sort((a,b)=>a-b);
    src.shMed = shs[Math.floor(shs.length/2)] || 1;
    dd.textContent = src.dur.toFixed(1) + ' s · ' + src.w + '×' + src.h + (nf ? ' · faces ' + Math.round(nf/Math.max(1,src.faces.length)*100) + '%' : '');
    src.els = [makeVideo(src.url), makeVideo(src.url), makeVideo(src.url)];
    sources.push(src); drawSpark(src);
  }catch(e){
    if(src.removed) return;
    console.warn('clip not readable:', src.name, e && e.message || e);
    dd.textContent = 'This video does not play here (format). Remove it with ×.';
    card.style.borderColor = 'var(--drop)';
  }
}
function finishAdding(){
  updateQ(); $('clearv').hidden = !$('clips').children.length;
  if(sources.length){ $('s2').classList.add('done'); if(buf || kind === 'talk') makeEdit(); if(kind !== 'talk') aiRun(); }
}
/* =============== TALKING VIDEOS (talking head, vlog, tutorial) ===============
 * The clips' own voice is the sound of the Reel. Where people speak is found on the phone (Silero VAD; loudness when it
 * cannot run); the silences between sentences are cut (tight / natural / relaxed pauses, or none), each take keeps its
 * order, and a jump cut inside one take is framed closer (a punch-in) so it reads as intended. The voice is brought to
 * one loudness; the song, if there is one, plays under it and steps back further while someone speaks. That one sound
 * track becomes the edit's audio, so preview, captions (the voice is what is transcribed) and export work as usual. */
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
  let probs = null, hop = 512/16000, how = 'ai';
  if(speechProbs){ try{ probs = await speechProbs(pcm, sr); }catch(e){ console.info('speech model not used:', e && e.message); } }
  if(!probs){   // loudness: 10 dB over the quiet floor of the clip counts as speech
    how = 'level'; const n = Math.floor(pcm.length/(hop*sr)), db = new Float32Array(n), w = Math.round(hop*sr);
    for(let k=0;k<n;k++){ let s2 = 0; for(let i=k*w;i<(k+1)*w;i+=2) s2 += pcm[i]*pcm[i]; db[k] = 10*Math.log10(s2/(w/2) + 1e-10); }
    const floor = Float32Array.from(db).sort()[Math.floor(n*0.1)] || -60; probs = db.map(v => v > floor + 10 ? 0.9 : v > floor + 6 ? 0.4 : 0.1);
  }
  src.voice = { has: true, pcm, sr, probs, hop, how };
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
  if(!parts.length){ $('s3st').textContent = 'No voice found in these clips'; showMsg('None of these clips has a voice to follow. For a music edit, choose "Music edit" at the top.', true); return; }
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
  talk = { voice, sr, parts, songKey: song && talkMusic > 0 ? song.key : '', sig: sources.map(s=>fpOf(s)).join(',') + '|' + talkPace + '|' + T.toFixed(2) };
  // the shots: one per part; a long one is split at its quietest moment; a jump cut inside one take is a punch-in
  const shots = [];
  for(const p of parts){
    const v = sources[p.si].voice; let a = p.a, t0 = p.t0;
    while(p.b - a > 5){ const m = splitPoint(v, a, p.b); shots.push({ si: p.si, in: a, start: t0, end: t0 + (m - a) }); t0 += m - a; a = m; }
    shots.push({ si: p.si, in: a, start: t0, end: p.t1 });
  }
  const useCount = sources.map(()=>0); let zoomed = false;
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
  plan = edit.map(e => ({ start: e.start, end: e.end, type: e.type, fx: e.fx, sp: e.sp, tr: e.tr, efx: e.efx }));
  setCanvas(); edit.forEach(e=>camAt(e, 0)); renderEDL(); drawMusic();
  $('s3').classList.remove('locked'); $('s3').classList.add('done');
  const total = sources.reduce((q,s)=>q + s.dur, 0), how = sources.some(s => s.voice.how === 'level') ? ' (by loudness)' : '';
  $('s3st').textContent = edit.length + ' shots · ' + fmt(T) + ' of talk from ' + fmt(total) + ' of clips' + (talkPace !== 'off' ? ' · ' + fmt(total - T) + ' of pauses cut' + how : '');
  $('mdur').textContent = fmt(T);
  $('tinfo').textContent = mute ? mute + ' clip' + (mute > 1 ? 's' : '') + ' without a voice left out' : '';
  $('xmsg').hidden = true;
  ['play','remix','export','cover'].forEach(id=>$(id).disabled=false);
  if(capsOn) loadCaptions();
  captureLoop();
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
  if(k === 'talk'){ if(sources.length) buildTalk(); }
  else if(song){ useSection(); } else { edit = []; renderEDL(); drawFrame(0); }
}
$('kind').addEventListener('click', e => { const b = e.target.closest('button'); if(b) setKind(b.dataset.k); }, SIG);
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
  const HIT_TR = ['whip','iris','zoom','glitch','spin','bars'];
  const CUT_TR = ['hard','wipe','hard','iris','hard','bars'];
  const HIT_FX = ['punch','tilt','punch','shake'];
  let lastTr = '', hk = 0, ck = 0, fk = 0, dk = 0;
  const beatsRel = (s) => beats.filter(b=>b>s.start+0.15 && b<s.end-0.1).map(b=>b-s.start);
  // restraint: fancy transitions are rationed (whip pans 1-2 per reel), the rest are clean hard cuts
  const per = Math.max(1, buf.duration/30), budget = {snap:Math.round(2*per), whip:Math.round(2*per), spin:Math.round(1*per), glitch:Math.round(2*per), bars:Math.round(2*per), iris:Math.round(3*per), zoom:Math.round(3*per), wipe:Math.round(2*per), dissolve:Math.round(2*per)};
  const take = k => { if(budget[k]===undefined) return k; if(budget[k]>0){ budget[k]--; return k; } return 'hard'; };
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
    s.tr = tr; s.efx = fx; s.sp = sp; lastTr = tr;
  });
  if(mode==='copy' && refProfile) copyStyle();
}
const TR_NAME = {hard:'Hard cut', fadein:'Fade-in', flash:'Exposure flash', whip:'Whip pan (blur)', zoom:'Zoom-through', glitch:'Glitch RGB', dip:'Dip to black', dissolve:'Dissolve',
  iris:'Mask: iris', wipe:'Mask: soft wipe', bars:'Mask: bars', spin:'Spin + blur'};
const FX_NAME = {jump:'Punch-in (jump cut)', 'punch-soft':'Soft zoom', 'pan-soft':'Ken Burns (soft)', snap:'Photo snap (freeze + flash)', hook:'Hook zoom + RGB', none:'—', pan:'Ken Burns + beat bounce', zoomburst:'Zoom burst + RGB', drift:'Slow drift + vignette', punch:'Zoom punch', tilt:'Tilt punch', shake:'Shake', bounce:'Beat bounce'};
const TR_DUR = {hard:0, fadein:0.35, flash:0.22, whip:0.16, zoom:0.18, glitch:0.14, dip:0.26, dissolve:0.35, iris:0.24, wipe:0.22, bars:0.26, spin:0.2};

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
function aiStat(t, err){ const el = $('aistat'); el.hidden = !t; el.textContent = t || ''; el.style.color = err ? 'var(--drop)' : ''; }
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
  const n = Math.max(3, Math.min(8, Math.round(src.dur/2.5))), out = [];
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
  aiBusy = true; aiStat('AI is looking at ' + need.length + (need.length>1 ? ' clips…' : ' clip…'));
  let charged = 0, failed = 0;
  try{
    const jobs = [];
    for(const s of need){ const frames = await aiFrames(s); if(frames.length) jobs.push({ id: 'c'+jobs.length, src: s, frames }); }
    for(let k=0; k<jobs.length; k+=12){
      const part = jobs.slice(k, k+12);
      const r = await fetch('/api/studio/rank-shots', { method:'POST', headers:{'Content-Type':'application/json'}, signal: ac.signal,
        body: JSON.stringify({ clips: part.map(j=>({ id:j.id, name:j.src.name, frames:j.frames })) }) });
      const res = await r.json().catch(()=>({}));
      if(!r.ok) throw new Error((res.error && res.error.message) || ('The AI step failed (' + r.status + ').'));
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
    aiStat('AI picks are not available right now: ' + (e && e.message ? e.message : e) + ' The edit uses the on-device picks.', true);
  }
}
function aiDone(charged, failed){
  const withAi = sources.filter(s=>s.ai), n = withAi.reduce((q,s)=>q+s.ai.frames.length, 0);
  aiStat('AI scored ' + n + ' moments in ' + withAi.length + ' clip' + (withAi.length>1?'s':'') + (failed ? ' (' + failed + ' could not be read)' : '') + (charged ? ' · ' + charged + ' credit' + (charged>1?'s':'') : ''));
  if(buf && sources.length && !recording) makeEdit();
}
/* ---- AI director: one text call plans the Reel as a story ----
   The cut times are fixed by the music. For every cut the phone offers its 3 best different moments (rules + AI scores);
   the director picks one per cut plus its transition, effect and speed. Every choice is then checked here: the moment
   must still be free (no footage twice, no scene crossing, not the same clip as a neighbour), the transition must fit
   the shot and the style and stay within its ration, effects and speeds must suit the cut. Whatever fails keeps the
   rule choice. One plan per edit (style, mix and clips); a new mix or style asks again. */
let director = null, dirBusy = false, dirFailedKey = '', dirCands = null;
const dirKey = () => [mode, mixNo, plan.length, plan.map(s=>s.start.toFixed(2)).join(','), sources.map(fpOf).join(';')].join('#');
let mixNo = 0;   // a new mix asks the director again
const dirSlotOf = i => (aiOn && director && director.key===dirKey() && director.slots[i]) || null;
const dirShot = i => { const d = dirSlotOf(i); return d && d.cand ? d.cand : null; };
const TR_OK = { smooth: ['hard','dissolve','dip'], auto: Object.keys(TR_DUR).filter(k=>k!=='fadein'), fast: Object.keys(TR_DUR).filter(k=>k!=='fadein') };
const FX_OK = { smooth: ['none','pan-soft','drift'], auto: ['none','zoomburst','punch','punch-soft','tilt','shake','bounce','pan','pan-soft','drift','snap'], fast: ['none','zoomburst','punch','punch-soft','tilt','shake','bounce','pan','pan-soft','drift','snap'] };
// the director's transitions / effects / speeds, each checked; returns how many were used and how many were corrected
function applyDirectorStyle(){
  if(!aiOn || !director || director.key !== dirKey()) return null;
  let used = 0, fixed = 0, asked = 0;
  plan.forEach((s,i)=>{
    const d = director.slots[i], len = s.end - s.start;
    if(!d) return;
    // transition
    if(d.tr){ asked++; let tr = d.tr, ok = true;
      if(i===0) ok = tr==='hard' || tr==='fadein';
      else {
        if(!TR_OK[mode].includes(tr)) ok = false;
        if(s.type==='break' && !['hard','dip','dissolve','flash'].includes(tr)) ok = false;
      }
      if(ok){ s.tr = tr; s.trByDir = true; used++; } else fixed++;
    }
    // effect
    if(d.fx){ asked++; let fx = d.fx, ok = (FX_OK[mode]||[]).includes(fx) || (i===0 && fx==='hook');
      if(fx==='hook' && i!==0) ok = false;
      if(fx==='snap' && !(s.type==='drop' && len>0.7)) ok = false;
      if(s.type==='break' && !['none','drift','pan-soft'].includes(fx)) ok = false;
      if(['pan','pan-soft','drift'].includes(fx) && len < 0.8) ok = false;   // a slow move needs time
      if(ok){ s.efx = fx; used++; } else fixed++;
    }
    // speed
    if(d.sp){ asked++; let ok = true, sp = null; const bl = beats.filter(b=>b>s.start+0.15 && b<s.end-0.1).map(b=>b-s.start);
      if(mode==='smooth' && !['normal','slow'].includes(d.sp)) ok = false;
      if(d.sp==='freeze' && s.efx!=='snap') ok = false;
      if(d.sp==='ramp' && len < 0.9) ok = false;
      if(d.sp==='velocity' && (!bl.length || len < 0.9)) ok = false;
      if(d.sp==='fast' && len > 1.2) ok = false;
      if(ok) sp = d.sp==='velocity' ? velocitySpeed(len, bl) : d.sp==='ramp' ? rampSpeed(len) : d.sp==='freeze' ? snapSpeed : SPEED[d.sp];
      if(sp){ s.sp = sp; used++; } else fixed++;
    }
    if(s.efx==='snap' && s.sp!==snapSpeed) s.sp = snapSpeed;   // the photo snap is a freeze by definition
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
    if(ok && s.tr===prev.tr && !(s.type==='break' && prev.type==='break') && mode !== 'copy') ok = false;   // (a copied Reel may repeat its transition)
    if(ok && left[s.tr]!==undefined){
      if(s.trByDir){ want[s.tr]--; ok = left[s.tr] > 0; }
      else ok = left[s.tr] - (want[s.tr]||0) > 0;   // keep room for the director's
      if(ok) left[s.tr]--;
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
function directorMaybe(){
  if(!aiOn || dirBusy || !edit.length || recording || mode==='copy') return;   // copying a Reel: its style is the plan
  if(!sources.length || sources.some(s=>!s.ai && !s.aiFailed) || !sources.some(s=>s.ai)) return;   // after the AI has seen the clips
  const key = dirKey(); if((director && director.key===key) || dirFailedKey===key) return;
  if(dirCache.has(key)){ director = dirCache.get(key); makeEdit(); return; }
  directorRun(key);
}
const dirCache = new Map();
async function directorRun(key){
  dirBusy = true; aiStat('AI director is planning the Reel…');
  try{
    const cands = directorCandidates(); dirCands = cands;
    const per = Math.max(1, buf.duration/30);
    const req = { mode, duration: +buf.duration.toFixed(2), bpm: +(60/period).toFixed(1), hook: hookText.slice(0,60),
      clips: sources.map((s,k)=>({ alias:'c'+(k+1), summary: (s.ai && s.ai.summary) || '', mood: (s.ai && s.ai.mood) || '' })),
      budget: {whip:Math.round(2*per), spin:Math.round(per), glitch:Math.round(2*per), zoom:Math.round(3*per), iris:Math.round(3*per), dissolve:Math.round(2*per), snap:Math.round(2*per)},
      slots: plan.map((s,i)=>({ i, t:+s.start.toFixed(2), len:+(s.end-s.start).toFixed(2), type:s.type, beats: beats.filter(b=>b>s.start+0.1 && b<s.end-0.05).length,
        candidates: cands[i].map(({si,a,...c})=>c) })).filter(x=>x.candidates.length) };
    const r = await fetch('/api/studio/direct', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(req), signal: ac.signal });
    const res = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error((res.error && res.error.message) || ('The AI director failed (' + r.status + ').'));
    if(dirKey() !== key) return;   // the edit changed meanwhile: its own plan will be asked for
    const slots = [];
    for(const d of res.slots || []){ const c = (cands[d.i]||[]).find(x=>x.id===d.shot);
      slots[d.i] = { cand: c ? {src:c.si, in:c.a} : null, tr: d.transition, fx: d.effect, sp: d.speed, why: d.why || '' }; }
    director = { key, slots, story: res.story || '' }; dirCache.set(key, director);
    dirBusy = false; makeEdit();
  }catch(e){
    dirFailedKey = key;
    if(!(e && e.name==='AbortError')) aiStat('AI director is not available right now: ' + (e && e.message ? e.message : e) + ' The edit keeps the AI-scored picks.', true);
  }finally{ dirBusy = false; }
}
(async () => {   // is the AI step set up on this server?
  try{
    const r = await fetch('/api/studio/rank-shots', ac ? { signal: ac.signal } : undefined); if(!r.ok) return;
    aiInfo = await r.json(); if(!aiInfo || !aiInfo.available) return;
    $('aiwrap').hidden = false;
    try{ aiOn = localStorage.getItem('brs-ai') === '1'; }catch(e){}
    $('aipick').checked = aiOn;
    if(aiInfo.credits) $('aiwrap').title = 'Uses ' + aiInfo.credits + ' credit' + (aiInfo.credits>1?'s':'') + ' per Reel';
    if(aiOn && sources.length) aiRun();
  }catch(e){}
})();
$('aipick').addEventListener('change', e=>{
  aiOn = e.target.checked; try{ localStorage.setItem('brs-ai', aiOn ? '1' : '0'); }catch(err){}
  if(aiOn){ sources.forEach(s=>{ s.aiFailed = false; }); aiRun(); }
  else { aiStat(''); if(buf && sources.length && !recording) makeEdit(); }
});
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
    e.cam = camPath(src, e.in, srcPos(e, L), Math.min(1, W/(src.w*base)), Math.min(1, H/(src.h*base))); e.cam.key = key;
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
function makeEdit(){
  if(kind === 'talk'){ if(sources.length) buildTalk(); return; }
  if(!buf || !sources.length) return;
  stopAll(); plan = adaptPlan(); styleEdit(); const dirInfo = applyDirectorStyle(); if(!dirInfo) finishTransitions();
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
  edit.forEach((e,i)=>{ const d = dirSlotOf(i); e.dirWhy = d ? d.why : ''; e.cx = 0.5 + (e.cx-0.5)*(e.face>0.3 ? 1 : 0.8); if(mode!=='smooth') suitFx(e); e.kf = keyframesFor(e); e.beatsIn = beats.filter(b=>b>e.start+0.12 && b<e.end-0.05).map(b=>b-e.start); });
  setCanvas(); edit.forEach(e=>camAt(e, 0)); renderEDL();
  $('s3').classList.remove('locked'); $('s3').classList.add('done');
  const total = sources.reduce((a,s)=>a+s.dur,0);
  $('s3st').textContent = edit.length + ' shots · ' + fmt(buf.duration) + (dupCount ? ' · ' + dupCount + ' shots reused (not enough footage)' : ' · no repeated moments');
  if(dupCount) showMsg('Your clips have ' + total.toFixed(1) + ' s of footage, the song needs more. ' + dupCount + ' shots had to be reused. Add more clips and nothing repeats.', true);
  else $('xmsg').hidden = true;
  ['play','remix','export','cover'].forEach(id=>$(id).disabled=false);
  if(dirInfo){ const shots = edit.filter((e,i)=>dirShot(i)).length, kept = edit.filter(e=>e.byDir).length;
    aiStat('AI director: ' + (dirInfo.used + kept) + ' of ' + (dirInfo.asked + shots) + ' choices used' + (dirInfo.fixed + shots - kept ? ', ' + (dirInfo.fixed + shots - kept) + ' changed by the safety rules' : '') + (director.story ? '. ' + director.story : '')); }
  captureLoop();
  directorMaybe();
  if(look === 'copy' && refProfile) setTimeout(()=>{ copyLook(); }, 0);
}
function captureLoop(){
  if(!edit.length) return;
  return prepare(0, 0.6).then(()=>{ loopImg=null; const sv=showSafe, h=hookText; showSafe=false; hookText=''; drawFrame(0.6);
    const c=document.createElement('canvas'); c.width=out.width; c.height=out.height; c.getContext('2d').drawImage(out,0,0); loopImg=c;
    showSafe=sv; hookText=h; pos=0.3; return prepare(0,0.3); }).then(()=>drawFrame(0.3));
}
function kfSummary(e){
  const cam = e.cam ? {face:'camera follows the face', subject:'camera follows the subject', still:'camera locked on the subject'}[e.cam.mode] : '';
  const notes = [e.dirWhy && aiOn ? 'Director: ' + e.dirWhy : '', e.aiNote && aiOn ? 'AI: ' + e.aiNote : '', e.why, cam].filter(Boolean).join(' · ');
  const why = notes ? `<br><span style="font:11px var(--body);color:var(--muted)">${notes}</span>` : '';
  const s = e.kf && e.kf.scale; if(!s || s.length<2) return why;
  const a=s[0], b=s[s.length-1];
  return `<br><span style="font:11px var(--mono);color:var(--muted)">◆ scale ${a[1].toFixed(2)}→${b[1].toFixed(2)} · ${(b[0]-a[0]).toFixed(2)}s ${b[2]||''}</span>` + why;
}
/* ---- manual control: change any shot, the rest stays ---- */
const SPEED_KEYS = {normal:'1×', slow:'Slow 0.5×', fast:'Fast 1.6×', velocity:'Velocity (beat)', ramp:'Ramp 1.8×→0.6×', freeze:'Freeze → 1×'};
function speedFor(key, e){
  const len = e.end - e.start, bl = beats.filter(b=>b>e.start+0.15 && b<e.end-0.1).map(b=>b-e.start);
  if(key==='slow') return SPEED.slow; if(key==='fast') return SPEED.fast; if(key==='ramp') return rampSpeed(len);
  if(key==='velocity') return bl.length ? velocitySpeed(len, bl) : rampSpeed(len); if(key==='freeze') return snapSpeed; return SPEED.normal;
}
const speedKey = sp => (Object.keys(SPEED_KEYS).find(k=>SPEED_KEYS[k]===sp.label) || (sp.label.startsWith('Ramp') ? 'ramp' : 'normal'));
function assignPlayers(){ const uc = sources.map(()=>0); edit.forEach(e=>{ e.el = sources[e.src].els[(uc[e.src]++)%3]; }); }
// pick another moment of footage for shot i: never one already used, never the same clip as its neighbours
function repick(i, avoidCurrent){
  const e = edit[i], len = e.end-e.start, gmax = Math.max(1e-6, ...sources.flatMap(s=>s.samples.map(x=>x.m)));
  const used = sources.map(()=>[]); edit.forEach((x,k)=>{ if(k!==i) used[x.src].push([x.in, x.in + x.sp.pos(x.end-x.start)*x.scaleR]); });
  let best=null, bs=-Infinity;
  sources.forEach((src,si)=>{
    if(sources.length>1 && [edit[i-1],edit[i+1]].some(x=>x && x.src===si)) return;
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
    tr.children[3].appendChild(sel(TR_NAME, e.tr, v=>{ e.tr=v; changed(i,false); }));
    const fxc = tr.children[4]; fxc.appendChild(sel(FX_NAME, e.efx, v=>{ e.efx=v; if(v==='snap'){ e.sp=snapSpeed; changed(i,true); } else { if(e.sp===snapSpeed) e.sp=SPEED.normal; changed(i,true); } }));
    fxc.insertAdjacentHTML('beforeend', kfSummary(e));
    tr.children[5].appendChild(sel(SPEED_KEYS, speedKey(e.sp), v=>{ e.sp = speedFor(v, e); changed(i,true); }));
    tr.addEventListener('click', ()=>{ if(playing) startPlayback(e.start); else showShot(i); });
    tb.appendChild(tr);
  });
  if(keepScroll) box.scrollTop = sc;
  drawTimeline();
}
// timeline strip: one block per shot, coloured by clip, marker colour = shot type
function drawTimeline(){
  const cv = $('tl'); if(!cv || !buf) return;
  const dpr = window.devicePixelRatio||1, w = Math.max(1,Math.round(cv.clientWidth*dpr)), h = Math.round(46*dpr);
  cv.width=w; cv.height=h; const g=cv.getContext('2d'); g.clearRect(0,0,w,h);
  const D = buf.duration;
  edit.forEach((e,i)=>{ const x0 = e.start/D*w, x1 = e.end/D*w, hue = (e.src*67)%360;
    g.fillStyle = `hsl(${hue} 55% 55%)`; g.fillRect(x0+dpr*0.5, 10*dpr, Math.max(1,x1-x0-dpr), h-12*dpr);
    g.fillStyle = css(TCOL[e.type]); g.fillRect(x0, 0, Math.max(2*dpr, 3*dpr), 8*dpr);
    if(e.sp.label!=='1×'){ g.fillStyle='rgba(0,0,0,0.35)'; g.fillRect(x0+dpr, h-7*dpr, Math.max(1,x1-x0-2*dpr), 5*dpr); } });
  const t = playing ? curTime() : pos; g.fillStyle = css('--ink'); g.fillRect(Math.round(t/D*w)-dpr, 0, 2*dpr, h);
}
$('tl').addEventListener('click', ev=>{ if(!edit.length) return; const r=$('tl').getBoundingClientRect(), tt=(ev.clientX-r.left)/r.width*buf.duration;
  const i = segAt(tt); if(playing) startPlayback(tt); else { const rows=$('edl').children; rows[i] && rows[i].scrollIntoView({block:'nearest'}); showShot(i); } });
$('remix').onclick = () => { seed = (seed*7919 + 13) % 2147483647 || 7; mixNo++; makeEdit(); };

/* =============== RENDERER =============== */
const out = $('out'), og = out.getContext('2d');
// The live preview draws at half size (540×960 for a Reel): a quarter of the pixels, so it stays smooth on phones.
// Export and the cover switch to the full 1080p size.
const PREVIEW_SCALE = 0.5;
function setCanvas(full){ const [W0,H0]=SIZES[aspect], s = full ? 1 : PREVIEW_SCALE, w = Math.round(W0*s/2)*2, h = Math.round(H0*s/2)*2;
  if(out.width!==w||out.height!==h){ out.width=w; out.height=h; loopImg=null; } }
function segAt(t){ let lo=0,hi=edit.length-1,r=0; while(lo<=hi){ const m=(lo+hi)>>1; if(edit[m].start<=t+1e-4){ r=m; lo=m+1; } else hi=m-1; } return r; }
async function prepare(i, t){
  const e = edit[i]; if(!e) return;
  const local = Math.max(0, t - e.start), target = srcPos(e, local);
  if(e.el.readyState < 2){ try{ await videoData(e.el, 6000); }catch(err){} }
  e.el.pause(); const r0 = rateAt(e, local); if(r0>0) e.el.playbackRate = r0;
  if(Math.abs(e.el.currentTime - target) > 0.04){ e.el.currentTime = target; try{ await waitEv(e.el,'seeked',4000); }catch(err){} }
}
const srcPos = (e, l) => e.in + e.sp.pos(l)*e.scaleR;
const rateAt = (e, l) => { const r = e.sp.at(l)*e.scaleR; return r<=0 ? 0 : Math.max(0.0625, Math.min(16, r)); };
const ease = x => 1 - Math.pow(1-Math.min(1,Math.max(0,x)),3);
const LOOKS = {
  natural:{name:'Natural', filter:'contrast(1.06) saturate(1.04)', grain:0},
  vivid:{name:'Vivid', filter:'contrast(1.15) saturate(1.12) brightness(1.02)', grain:0.04},
  cine:{name:'Cinematic', filter:'contrast(1.18) saturate(0.9) brightness(0.98)', tint:true, grain:0.08},
  mono:{name:'B&W', filter:'grayscale(1) contrast(1.25)', grain:0.1},
};
let look = 'vivid', hookText = '', showSafe = true, loopImg = null, holdText = false;
const bufA = document.createElement('canvas'), gA = bufA.getContext('2d');
const bufB = document.createElement('canvas'), gB = bufB.getContext('2d');
function fitBufs(){ [bufA,bufB].forEach(b=>{ if(b.width!==out.width||b.height!==out.height){ b.width=out.width; b.height=out.height; } }); }

// draw one shot with its keyframed properties into context g
function drawShot(g, e, local, o={}){
  const W=out.width, H=out.height, v=texOf(e), L=e.end-e.start;
  if(!v || v.readyState<2) return;
  const K = e.kf || {};
  let scale = (kf(K.scale,local) ?? 1) * (o.scale||1);
  let x = (kf(K.x,local) ?? 0)*W + (o.dx||0), y = (o.dy||0), rot = (kf(K.rot,local) ?? 0) + (o.rot||0);
  const sh = kf(K.shake,local) || 0;
  if(sh){ x += Math.sin(local*97)*0.03*W*sh; y += Math.cos(local*71)*0.025*H*sh; rot += Math.sin(local*53)*2.2*sh; }
  if(K.bounce && e.beatsIn){ for(const bt of e.beatsIn){ if(local>=bt){ scale *= 1 + 0.045*Math.exp(-(local-bt)/0.11); } } }
  const sw = sources[e.src].w, shh = sources[e.src].h, [ccx, ccy] = camAt(e, local);
  const r = Math.max(W/sw, H/shh)*scale, dw = sw*r, dh = shh*r;
  let px = W/2 - ccx*dw; px = Math.min(0, Math.max(W-dw, px)) + x;
  let py0 = H/2 - ccy*dh; py0 = Math.min(0, Math.max(H-dh, py0));
  const py = py0 + y;
  const alpha = o.alpha ?? 1;
  const paint = (gg, a, extra=1, ox=0, oy=0) => {
    gg.save(); gg.globalAlpha = a;
    if(rot || extra!==1){ gg.translate(W/2,H/2); gg.rotate(rot*Math.PI/180); gg.scale(extra,extra); gg.translate(-W/2,-H/2); }
    gg.filter = LOOKS[look].filter; gg.drawImage(v, px+ox, py+oy, dw, dh); gg.restore(); };
  const rgb = (kf(K.rgb,local) || 0) + (o.rgb||0);
  if(rgb > 0.5 && !o.noFx){
    // chromatic aberration: red and blue channels pushed apart
    fitBufs(); gB.globalCompositeOperation='source-over'; gB.fillStyle='#000'; gB.fillRect(0,0,W,H);
    const chan = (col, ox) => { gA.globalCompositeOperation='source-over'; gA.clearRect(0,0,W,H); paint(gA,1,1,ox,0);
      gA.globalCompositeOperation='multiply'; gA.fillStyle=col; gA.fillRect(0,0,W,H);
      gB.globalCompositeOperation='lighter'; gB.drawImage(bufA,0,0); };
    chan('#f00', -rgb); chan('#0f0', 0); chan('#00f', rgb);
    gB.globalCompositeOperation='source-over';
    g.save(); g.globalAlpha = alpha; g.drawImage(bufB,0,0); g.restore();
  } else paint(g, alpha);
  // zoom blur: faint bigger copies
  const zb = (kf(K.zblur,local) || 0) + (o.zblur||0);
  if(zb > 0.02 && !o.noFx) for(let k=1;k<=3;k++) paint(g, 0.22*zb*alpha, 1 + 0.045*k*zb);
  let expo = kf(K.expo,local) || 0;
  if(K.bounce && e.beatsIn && !o.noFx){ for(const bt of e.beatsIn){ if(local>=bt) expo += 0.22*Math.exp(-(local-bt)/0.07); } }   // light pulse on each beat
  if(!o.noFx && e.sp && rateAt(e, local) >= 1.8) for(let k=1;k<=2;k++) paint(g, 0.16*alpha, 1 + 0.012*k);   // motion blur when fast
  if(expo > 0.01 && !o.noFx){ g.save(); g.globalCompositeOperation='lighter'; paint(g, Math.min(1,expo)*alpha); g.restore(); }
  const br = kf(K.bright,local);
  if(br !== undefined && br < 1){ g.fillStyle=`rgba(0,0,0,${(1-br)*alpha})`; g.fillRect(0,0,W,H); }
}
function wrapLines(g, text, maxW){ const words=text.split(/\s+/), lines=[]; let cur='';
  words.forEach(w=>{ const tryL = cur ? cur+' '+w : w; if(g.measureText(tryL).width > maxW && cur){ lines.push(cur); cur=w; } else cur=tryL; }); if(cur) lines.push(cur); return lines; }
/* ---- text: the hook word by word on the beats, captions of the song word by word ----
   Styles: pop (each word pops in on its beat / when it is sung), karaoke (the line is shown, the sung word lights up),
   box (words on coloured boxes), clean (calm, small). Everything stays inside Instagram's safe area (the top 220 px and
   the bottom 450 px of 1920 are its UI), captions move up when a face is in their way, and Hindi / Marathi (Devanagari)
   are drawn with a font that shapes them. Drawn into the frame itself, so the export has it too. */
let textStyle = 'pop', capsOn = false, capWords = null, capLines = null;
const ACCENT = '#FFD54A';
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
  const L = layoutWords(og, line.words.map(w=>({t:w.text, s:w.start, e:w.end})), fs, W*0.78, cy, fs*1.25);
  const lineIn = Math.min(1, (t - line.a)/0.12), lineOut = Math.max(0, (t - (line.b - 0.15))/0.15), la = lineIn*(1-lineOut);
  L.forEach(w=>{
    const sung = t >= w.s, cur = sung && t < Math.max(w.e, w.s + 0.12), state = cur ? 1 : sung ? 2 : 0;
    let a = la, sc = 1;
    if(textStyle === 'pop'){ if(!sung) return; const since = t - w.s; a *= Math.min(1, since/0.06); sc = 0.7 + 0.3*EASE.outBack(Math.min(1, since/0.16)); }
    else if(textStyle === 'karaoke' && cur) sc = 1.08;
    drawWord(og, w, fs, textStyle, state, a, sc);
  });
}
function drawText(t){ drawHook(t); drawCaptions(t); drawOverlays(t); }
/* ---- text & stickers: anything the creator writes on the Reel ----
 * Each item: text or an emoji, a style (bold outline / box / neon / clean / tag), a colour, an entrance (pop / fade /
 * slide up / typewriter / none, with a short fade out), a time (from / to, or the whole Reel), a place (dragged on the
 * preview, kept inside Instagram's safe area) and a size. Drawn into the frame, so the export has them; Hindi and Marathi
 * are shaped by the Devanagari font stack. Ready-made: a price tag, a follow / save prompt, steps, before / after,
 * festival greetings. */
let overlays = [], ovSeq = 0, ovSel = -1;
const OV_COLORS = ['#FFFFFF', '#FFD54A', '#FF4D4D', '#3DDC84', '#4DA3FF', '#FF6FD8', '#111111'];
const OV_STYLES = { bold: 'Bold', box: 'Box', neon: 'Neon', clean: 'Clean', tag: 'Tag' };
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
  g.save(); g.globalAlpha = Math.max(0, alpha);
  g.font = ov.emoji ? `${fs}px "Apple Color Emoji","Noto Color Emoji","Segoe UI Emoji",sans-serif` : fontFor(ov.text, fs, ov.style === 'clean' ? 600 : 800);
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  const lines = ov.emoji ? [txt] : wrapLines(g, txt, W*0.82), lh = fs*1.18;
  const tw = Math.max(...lines.map(l => g.measureText(l).width), fs*0.6), th = lh*lines.length;
  // the place: inside the safe area (top 220 and bottom 450 of 1920 are Instagram's)
  const top = H*(220/1920) + th/2 + fs*0.3, bot = H*(1 - 450/1920) - th/2 - fs*0.3;
  const cx = Math.max(tw/2 + W*0.05, Math.min(W - tw/2 - W*0.05, ov.x*W)), cy = Math.max(top, Math.min(bot, ov.y*H)) + dy;
  ov.box = [(cx - tw/2 - fs*0.4)/W, (cy - th/2 - fs*0.3)/H, (tw + fs*0.8)/W, (th + fs*0.6)/H];
  g.translate(cx, cy); g.scale(sc, sc);
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
      <div class="ovctl"><select class="ovs" aria-label="Style"></select><select class="ova" aria-label="Entrance"></select><span class="ovc"></span>
      <label class="ovsz">Size <input type="range" min="0.5" max="2.2" step="0.05" aria-label="Size"></label></div>
      <div class="ovctl"><span class="fname ovtm"></span><button class="btn mini ovfrom">Start here</button><button class="btn mini ovto">End here</button><label class="tog"><input type="checkbox" class="ovall"> Whole Reel</label><label class="tog"><input type="checkbox" class="ovbeh"> Behind the person</label></div>`;
    const ti = row.querySelector('.ovt'); ti.value = ov.text; if(ov.emoji){ ti.readOnly = true; ti.classList.add('emoji'); }
    ti.addEventListener('input', () => { ov.text = ti.value; redraw(); });
    const ss = row.querySelector('.ovs'), sa = row.querySelector('.ova');
    if(ov.emoji) ss.hidden = true;
    Object.entries(OV_STYLES).forEach(([k, v]) => ss.add(new Option(v, k, false, k === ov.style)));
    Object.entries(OV_ANIMS).forEach(([k, v]) => sa.add(new Option(v, k, false, k === ov.anim)));
    ss.addEventListener('change', () => { ov.style = ss.value; redraw(); }); sa.addEventListener('change', () => { ov.anim = sa.value; redraw(); });
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
  $('ovhint').hidden = !overlays.length; out.classList.toggle('ovdrag', overlays.length > 0);   // drag texts; otherwise the page scrolls over the preview
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
    if(recording || !overlays.length) return;
    const [x, y] = at(ev), t = playing ? curTime() : pos || 0;
    for(let i = overlays.length - 1; i >= 0; i--){ const ov = overlays[i], [a, b] = ovTiming(ov); if(!ov.box || !(t >= a && t < b)) continue;
      const [bx, by, bw, bh] = ov.box; if(x >= bx && x <= bx + bw && y >= by && y <= by + bh){
        drag = { i, dx: x - ov.x, dy: y - ov.y }; ovSel = i; out.setPointerCapture(ev.pointerId); renderOvList(); ev.preventDefault(); redraw(); return; } }
    if(ovSel >= 0){ ovSel = -1; renderOvList(); redraw(); }
  }, SIG);
  out.addEventListener('pointermove', ev => { if(!drag) return; const [x, y] = at(ev), ov = overlays[drag.i]; if(!ov) return;
    ov.x = Math.max(0.05, Math.min(0.95, x - drag.dx)); ov.y = Math.max(0.05, Math.min(0.95, y - drag.dy)); redraw(); }, SIG);
  const end = () => { drag = null; };
  out.addEventListener('pointerup', end, SIG); out.addEventListener('pointercancel', end, SIG); }

/* ---- the background behind the person: blurred, a colour, a photo; and text behind the person ----
 * The person is found in every frame (MediaPipe Selfie Segmentation in a worker) on the finished picture, just before the
 * text: the frame fitted into 256x256 (letterboxed), a soft mask back at full size; the person is drawn over the new
 * background, and texts marked "behind the person" go between the two. The preview uses the mask of the frame before
 * (it arrives a few ms later; when paused the frame is drawn again with its own), the export waits for each frame's own. */
let bgMode = 'none', bgColor = '#1DB954', bgImg = null, bgMask = null, bgBusy = false, bgErr = '', bgFrame = -1;
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
function bgStat(){ $('bgstat').textContent = bgErr ? 'Background tools are not available on this device (' + bgErr + ')' : (bgMode === 'photo' && !bgImg ? 'Choose a photo' : ''); }
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
  const im = new Image(); im.onload = () => { bgImg = im; bgStat(); redrawFrame(); }; im.onerror = () => { $('bgstat').textContent = 'This photo cannot be read here.'; }; im.src = URL.createObjectURL(f); }, SIG);
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
  const a = secStart - capAll.from, L = buf.duration;
  capWords = capAll.words.filter(w => w.end > a + 0.05 && w.start < a + L - 0.05).map(w => ({ ...w, start: Math.max(0, w.start - a), end: Math.min(L, w.end - a) }));
  capLines = buildCapLines(capWords); redraw();
}
function capStat(t, err){ const el = $('capstat'); el.textContent = t || ''; el.style.color = err ? 'var(--drop)' : ''; }
async function loadCaptions(){
  if(!capsOn || !buf) return;
  const tk = kind === 'talk' && talk, W = tk ? null : song ? song.buf : buf, M = tk ? talk.voice : song ? song.mono : mono, sr = tk ? talk.sr : W.sampleRate;
  const from = !tk && secStart + buf.duration > 179 ? secStart : 0;   // a part past 3 minutes: from where it starts
  const lang = $('caplang').value, key = (tk ? 'talk|' + talk.sig : song ? song.key : musicKey) + '|' + from.toFixed(2) + '|' + lang, token = musicToken;
  if(capCache.has(key)){ capAll = capCache.get(key); shiftCaptions(); capStat(capWords.length + ' words'); return; }
  capStat('Listening to the words of the song…');
  try{
    const wav = await songWav(M, sr, from);
    const r = await fetch('/api/studio/transcribe?lang=' + encodeURIComponent(lang), { method:'POST', headers:{'Content-Type':'audio/wav'}, body: wav, signal: ac.signal });
    const res = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error((res.error && res.error.message) || ('Captions failed (' + r.status + ').'));
    if(token !== musicToken) return;
    capAll = { from, words: Array.isArray(res.words) ? res.words : [] }; capCache.set(key, capAll); shiftCaptions();
    capStat(capWords.length ? capWords.length + ' words found' + (res.language && res.language !== 'auto' ? ' (' + res.language + ')' : '') + (res.charged ? ' · ' + res.charged + ' credit' + (res.charged > 1 ? 's' : '') : '') : 'No words in this song (instrumental?)');
    redraw();
  }catch(err){ if(!(err && err.name === 'AbortError')) capStat('Captions are not available right now: ' + (err && err.message ? err.message : err), true); }
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
      case 'iris': case 'wipe': case 'bars': drawShot(og, pe, pl, {noFx:true}); maskReveal(e, local, p, e.tr); break;
      case 'dip':
        if(p<0.5){ drawShot(og, pe, pl); og.fillStyle=`rgba(0,0,0,${EASE.inOut(p*2)})`; og.fillRect(0,0,W,H); }
        else { drawShot(og, e, local); og.fillStyle=`rgba(0,0,0,${1-EASE.inOut((p-0.5)*2)})`; og.fillRect(0,0,W,H); }
        break;
      case 'dissolve': drawShot(og, pe, pl, {noFx:true}); drawShot(og, e, local, {alpha:EASE.inOut(p)}); break;
      case 'fadein': drawShot(og, e, local, {alpha:q}); break;
      case 'flash': {   // exposure flash: picture blows out to white, then settles
        drawMain(e, local);
        if(e.efx!=='snap'){ og.save(); og.globalCompositeOperation='lighter'; drawShot(og, e, local, {alpha:Math.max(0,1-p*1.6), noFx:true}); og.restore(); }
        og.fillStyle=`rgba(255,255,255,${0.85*Math.pow(1-p,2)})`; og.fillRect(0,0,W,H); break; }
      default: drawShot(og, e, local);
    }
  } else drawMain(e, local);
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
uniform float rotA, rotB, zbA, zbB, rgbA, rgbB, exA, exB, brA, brB, alA, hasA;
uniform vec2 dbA, dbB, irisC;
uniform float mode, prog, mixv, time, snap, bgDark, border;
uniform float con, sat, bri, teal, mono, vig, grain, flash, loopMix, warm, lift;
uniform vec3 leak;
vec2 rotP(vec2 p, float r){ vec2 c=res*0.5; vec2 d=p-c; float cs=cos(-r), sn=sin(-r); return c+vec2(cs*d.x-sn*d.y, sn*d.x+cs*d.y); }
vec3 tap(sampler2D t, vec2 uv, float ro){ uv=clamp(uv,0.001,0.999);
  if(ro<0.0001) return texture2D(t,uv).rgb;
  return vec3(texture2D(t,clamp(uv+vec2(ro,0.),0.001,0.999)).r, texture2D(t,uv).g, texture2D(t,clamp(uv-vec2(ro,0.),0.001,0.999)).b); }
vec3 layer(sampler2D t, vec2 p, vec4 r, float rot, float zb, vec2 db, float rgb, out float inside){
  vec2 q = rotP(p, rot); vec2 uv = (q-r.xy)/r.zw;
  inside = step(0.,uv.x)*step(uv.x,1.)*step(0.,uv.y)*step(uv.y,1.);
  float ro = rgb/r.z; vec3 c = tap(t,uv,ro);
  if(zb>0.01 || length(db)>0.5){
    vec3 acc=c; vec2 du = db/r.zw;
    for(int k=1;k<10;k++){ float f=float(k)/9.; vec2 u2 = mix(uv, vec2(0.5), zb*0.1*f) + du*(f-0.5); acc += tap(t,u2,ro); }
    c = acc/10.;
  }
  return c;
}
float hash(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
void main(){
  vec2 p = vec2(gl_FragCoord.x, res.y-gl_FragCoord.y);
  float inA=0., inB=0.;
  vec3 A = vec3(0.);
  if(hasA>0.5){ A = layer(tA,p,rA,rotA,zbA,dbA,rgbA,inA); A = (A + A*exA)*brA*alA; }
  vec3 B = layer(tB,p,rB,rotB,zbB,dbB,rgbB,inB);
  if(snap>0.5){
    vec2 q = rotP(p,rotB);
    bool inFrame = q.x>frR.x && q.x<frR.x+frR.z && q.y>frR.y && q.y<frR.y+frR.w;
    bool inBorder = q.x>frR.x-border && q.x<frR.x+frR.z+border && q.y>frR.y-border && q.y<frR.y+frR.w+border;
    float ib;
    if(!inFrame) B = inBorder ? vec3(1.) : layer(tB,p,bgR,0.,0.7,vec2(0.),0.,ib)*(1.-bgDark);
  }
  B = (B + B*exB)*brB;
  vec3 col;
  if(mode<0.5) col = B;
  else if(mode<1.5) col = mix(A,B,mixv);
  else if(mode<2.5) col = prog<0.5 ? A*(1.-2.*prog) : B*(2.*prog-1.);
  else if(mode<3.5) col = inB>0.5 ? B : A;
  else if(mode<5.5){
    float band = floor(p.y/(res.y/10.)); float h = hash(vec2(band, floor(time*70.)));
    if(h<0.3 && hasA>0.5){ vec4 ra=rA; ra.x += (hash(vec2(band,1.))-0.5)*0.14*res.x; float ia; col = layer(tA,p,ra,rotA,0.,vec2(0.),0.,ia); }
    else if(h<0.5){ vec4 rb=rB; rb.x += (hash(vec2(band,2.))-0.5)*0.14*res.x; float ib2; col = layer(tB,p,rb,rotB,0.,vec2(0.),rgbB,ib2); }
    else col = B;
  }
  else if(mode<6.5){ float q=1.-pow(1.-prog,3.); vec2 far=max(irisC,res-irisC); float R=length(far)*q*1.05; float f=max(1.,R*0.18); float mk=1.-smoothstep(R-f,R,distance(p,irisC)); col=mix(A,B,mk); }
  else if(mode<7.5){ float q=1.-pow(1.-prog,3.); float s=(p.x+p.y*0.6)/(res.x+res.y*0.6); float e=-0.15+q*1.3; float mk=1.-smoothstep(e-0.08,e,s); col=mix(A,B,mk); }
  else { float k=floor(p.x/(res.x/6.)); float pk=clamp(prog*1.6-k*0.12,0.,1.); float hh=res.y*(1.-pow(1.-pk,3.)); float mk = mod(k,2.)>0.5 ? step(p.y,hh) : step(res.y-hh,p.y); col=mix(A,B,mk); }
  // colour grade
  col = lift + col*(1.-lift);   // lifted blacks (faded / matte)
  col = (col-0.5)*con + 0.5; col *= bri;
  float l = dot(col, vec3(0.299,0.587,0.114));
  col = mix(vec3(l), col, sat);
  if(teal>0.){ vec3 tint = mix(vec3(0.75,1.05,1.12), vec3(1.12,0.98,0.82), smoothstep(0.15,0.85,l)); col = mix(col, col*tint, teal); }
  col *= vec3(1.+0.12*warm, 1., 1.-0.12*warm);   // white balance: warm (+) / cool (-)
  if(leak.z>0.){ float d = distance(p, leak.xy)/(res.x*0.9); vec3 lc = vec3(1.,0.67,0.35)*leak.z*(1.-smoothstep(0.,1.,d)); col = 1.-(1.-col)*(1.-lc); }
  col = mix(col, vec3(dot(col,vec3(0.299,0.587,0.114))), mono);   // after the light leak: black and white stays black and white
  col += flash;
  vec2 uvn = p/res-0.5; float vd = length(uvn*vec2(res.x/res.y,1.)*vec2(1.,1.));
  col *= 1. - vig*smoothstep(0.3,0.75,vd);
  if(grain>0.) col += (hash(p*0.73 + fract(time*7.)*vec2(97.,13.))-0.5)*grain*0.6;
  if(loopMix>0.) col = mix(col, texture2D(tL, p/res).rgb, loopMix);
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
      const L = (pre, X) => { set('r'+pre, X.rect); set('rot'+pre, X.rot); set('zb'+pre, X.zb); set('db'+pre, X.db); set('rgb'+pre, X.rgb); set('ex'+pre, X.expo); set('br'+pre, X.bright); };
      if(S.A){ L('A', S.A); set('alA', S.A.alpha ?? 1); }
      L('B', S.B);
      set('hasA', S.A ? 1 : 0); set('mode', S.mode); set('prog', S.prog); set('mixv', S.mix); set('irisC', S.iris || [c.width/2,c.height/2]);
      set('time', S.time); set('snap', S.snap ? 1 : 0); set('bgR', S.bgR || [0,0,1,1]); set('bgDark', S.bgDark||0); set('frR', S.frR || [0,0,c.width,c.height]); set('border', S.border||0);
      const G = S.grade; set('con',G.con); set('sat',G.sat); set('bri',G.bri); set('teal',G.teal); set('mono',G.mono); set('vig',G.vig); set('grain',G.grain); set('warm',G.warm||0); set('lift',G.lift||0);
      set('flash', S.flash||0); set('leak', S.leak || [0,0,0]); set('loopMix', S.loopMix||0);
      gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    }};
  }catch(err){ console.warn('WebGL off:', err && err.message); return null; }
})();
const GRADES = { natural:{con:1.06,sat:1.04,bri:1.0,teal:0,mono:0,grain:0}, vivid:{con:1.14,sat:1.14,bri:1.02,teal:0,mono:0,grain:0.035},
  cine:{con:1.16,sat:0.92,bri:0.98,teal:0.55,mono:0,grain:0.07}, mono:{con:1.25,sat:1,bri:1.0,teal:0,mono:1,grain:0.09} };
// the same keyframed motion as the 2D path, expressed as numbers for the shader
function layerOf(e, local, o={}){
  const W=out.width, H=out.height, K=e.kf||{};
  let scale = (kf(K.scale,local) ?? 1)*(o.scale||1);
  let x = (kf(K.x,local) ?? 0)*W + (o.dx||0), y = o.dy||0, rot = (kf(K.rot,local) ?? 0) + (o.rot||0);
  const sh = kf(K.shake,local) || 0;
  if(sh){ x += Math.sin(local*97)*0.03*W*sh; y += Math.cos(local*71)*0.025*H*sh; rot += Math.sin(local*53)*2.2*sh; }
  let expo = o.noFx ? 0 : (kf(K.expo,local) || 0);
  if(K.bounce && e.beatsIn){ for(const bt of e.beatsIn){ if(local>=bt){ scale *= 1 + 0.045*Math.exp(-(local-bt)/0.11); if(!o.noFx) expo += 0.22*Math.exp(-(local-bt)/0.07); } } }
  const sw = sources[e.src].w, shh = sources[e.src].h, r = Math.max(W/sw, H/shh)*scale, dw = sw*r, dh = shh*r, [ccx, ccy] = camAt(e, local);
  let px = W/2 - ccx*dw; px = Math.min(0, Math.max(W-dw, px)) + x;
  let py = H/2 - ccy*dh; py = Math.min(0, Math.max(H-dh, py)) + y;
  let zb = o.noFx ? 0 : (kf(K.zblur,local) || 0);
  if(!o.noFx && rateAt(e, local) >= 1.8) zb += 0.35;   // motion blur when the shot runs fast
  const br = kf(K.bright,local);
  return { el:texOf(e), rect:[px,py,dw,dh], rot: rot*Math.PI/180, zb: zb + (o.zb||0), db: o.db || [0,0], rgb: (o.noFx ? 0 : (kf(K.rgb,local)||0)) + (o.rgb||0),
    expo, bright: (br===undefined ? 1 : br) * (e.type==='break' ? 0.88 : 1), alpha: o.alpha ?? 1 };
}
function drawFrameGL(t){
  const W=out.width, H=out.height, i = segAt(t), e = edit[i], local = t - e.start, pe = edit[i-1], pl = pe ? pe.end-pe.start : 0;
  const d = TR_DUR[e.tr] || 0, p = d ? Math.min(1, local/d) : 1, q = EASE.outCubic(p);
  const S = { mode:0, prog:p, mix:1, time:t, grade:{...GRADES[look]}, A:null, B:null };
  S.grade.vig = (kf(e.kf && e.kf.vig, local) ?? (look === 'copy' ? (GRADES.copy.vig || 0) : 0.22));
  const inTr = p < 1 && (pe || e.tr==='fadein');
  if(inTr && pe) S.A = layerOf(pe, pl, {noFx:true});
  S.B = layerOf(e, local);
  if(inTr){
    switch(e.tr){
      case 'whip': { const blur = 0.09*W*Math.sin(Math.PI*q); S.A = layerOf(pe, pl, {dx:-q*W, db:[blur,0], noFx:true}); S.B = layerOf(e, local, {dx:(1-q)*W, db:[blur,0]}); S.mode = 3; break; }
      case 'zoom': S.A = layerOf(pe, pl, {scale:1+0.9*p*p, zb:1.2, noFx:true}); S.B = layerOf(e, local, {scale:1.6-0.6*q, zb:1-q}); S.mode = 1; S.mix = q; break;
      case 'spin': S.A = layerOf(pe, pl, {rot:90*p*p, scale:1+0.5*p, zb:0.8, noFx:true}); S.B = layerOf(e, local, {rot:-90*(1-q), scale:1.5-0.5*q, zb:1-q}); S.mode = 1; S.mix = q; break;
      case 'glitch': S.B = layerOf(e, local, {rgb:22*(1-p)}); S.mode = 5; break;
      case 'iris': { const [px,py,dw,dh] = S.B.rect, [ccx,ccy] = camAt(e, local); S.mode = 6; S.prog = p; S.iris = [px+ccx*dw, py+ccy*dh]; break; }
      case 'wipe': S.mode = 7; S.prog = p; break;
      case 'bars': S.mode = 8; S.prog = p; break;
      case 'dip': S.mode = 2; S.prog = EASE.inOut(p); break;
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
  if(holdText) return;
  bgPass(t); drawText(t);
  if(showSafe && !recording && !coverMode) drawSafe();
  if(!exporting){ $('prog').style.width = (t/buf.duration*100).toFixed(2)+'%';
    const rows = $('edl').children; if(rows[i] && !rows[i].classList.contains('cur')){ [...rows].forEach(r=>r.classList.remove('cur')); rows[i].classList.add('cur'); } }
}
function drawFrame(t){ if(!edit.length){ og.fillStyle='#000'; og.fillRect(0,0,out.width,out.height); return; } if(GL && !GL.lost) drawFrameGL(t); else drawFrame2D(t); }

let coverMode=false;
let playing=false, src=null, startedAt=0, startOff=0, pos=0, curIdx=-1, timer=0, recording=false, latencyOn=true;
function curTime(){ if(!playing) return pos; const lat = latencyOn ? (ctx.outputLatency||ctx.baseLatency||0) : 0; return startOff + ctx.currentTime - startedAt - lat; }
function stopAll(){ playing=false; if(src){ const s=src; src=null; try{s.stop();}catch(e){} } clearInterval(timer); cancelAnimationFrame(rafId); edit.forEach(e=>e.el.pause()); $('play').textContent='▶ Preview'; }
let rafId=0;
async function startPlayback(from, destNode){
  stopAll();
  const c = getCtx(); await c.resume();
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
  $('play').textContent='❚❚ Pause';
  s.onended = () => { if(src===s){ src=null; playing=false; pos=0; edit.forEach(e=>e.el.pause()); $('play').textContent='▶ Preview'; onEnd && onEnd(); } };
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
      if(r===0){ if(!e.el.paused) e.el.pause(); if(Math.abs(e.el.currentTime-want) > 0.05) e.el.currentTime = want; }   // freeze frame
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
function saveFile(blob, name){
  const file = new File([blob], name, { type: blob.type });
  const phone = matchMedia('(pointer: coarse)').matches;
  let canShare = false; try{ canShare = phone && !!navigator.canShare && navigator.canShare({ files: [file] }); }catch(e){}
  if(savedUrl) URL.revokeObjectURL(savedUrl);
  savedUrl = URL.createObjectURL(blob);
  if(canShare){
    $('saverow').hidden = false; $('dlvid').href = savedUrl; $('dlvid').download = name;
    $('savevid').textContent = /^image\//.test(blob.type) ? 'Save to Photos / Share' : 'Save video to Photos / Share';
    $('savevid').onclick = async () => { try{ await navigator.share({ files: [file], title: name }); }catch(err){ if(err && err.name !== 'AbortError') $('dlvid').click(); } };
    return true;
  }
  const a = document.createElement('a');
  a.href = savedUrl; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  return false;
}
const savedMsg = (shared, what) => shared ? what + ' is ready: tap the button below to save it to Photos or share it.' : what + ' saved';
function showMsg(t, err){ const m=$('xmsg'); m.hidden=false; m.textContent=t; m.classList.toggle('err', !!err); }
// Real-time recording: only when this browser has no WebCodecs encoder (older Firefox / Safari)
async function recordExport(){
  const mime = pickMime();
  if(!mime || !out.captureStream){ showMsg('This browser cannot make videos. Use Chrome, Edge or a recent Safari.', true); return; }
  recording = true; latencyOn = false; ['play','remix','export','cover'].forEach(id=>$(id).disabled=true);
  setCanvas(true); await captureLoop();
  showMsg('Recording in real time (this browser has no fast encoder): '+fmt(buf.duration)+'). Keep this tab open.');
  const c = getCtx(); await c.resume();
  const dest = c.createMediaStreamDestination();
  const stream = new MediaStream([...out.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const rec = new MediaRecorder(stream, {mimeType:mime, videoBitsPerSecond: 12_000_000, audioBitsPerSecond: 256_000});
  const chunks = []; rec.ondataavailable = e=>{ if(e.data.size) chunks.push(e.data); };
  const done = new Promise(r=>rec.onstop=r);
  rec.start(500);
  onEnd = () => { onEnd=null; setTimeout(()=>rec.stop(), 150); };
  pos = 0; await startPlayback(0, dest);
  await done;
  recording = false; latencyOn = true; ['play','remix','export','cover'].forEach(id=>$(id).disabled=false);
  const ext = mime.includes('mp4') ? 'mp4' : 'webm';
  const blob = new Blob(chunks, {type: mime.split(';')[0]});
  const name = 'reel-' + aspect.replace(':','x') + '-1080p.' + ext;
  setCanvas(false); captureLoop();
  const sh = saveFile(blob, name); showMsg(savedMsg(sh, 'Video') + ': '+name+' ('+(blob.size/1e6).toFixed(1)+' MB). Ready for Instagram, TikTok and Shorts.');}

// Fast export: every frame is decoded (WebCodecs, through mediabunny), drawn and encoded off-screen, faster than real
// time and frame-accurate (no dropped frames). The sound goes through the same gain + limiter as the preview.
async function fastExport(){
  if(!window.VideoEncoder || !window.OfflineAudioContext) return false;
  const mb = await loadMediabunny();
  // Safari before 26 (iPhone iOS 16.4-18) encodes video but has no AAC encoder: a small WebAssembly AAC encoder stands in,
  // so the file is still the H.264 + AAC MP4 Instagram wants
  if(loadAacEncoder && !(await mb.canEncodeAudio('aac').catch(()=>false))){
    try{ const m = await loadAacEncoder(); if(!loadAacEncoder.done){ m.registerAacEncoder(); loadAacEncoder.done = true; } }catch(err){ console.warn('AAC encoder unavailable', err); }
  }
  const [W, H] = SIZES[aspect], fps = 30, dur = buf.duration;
  // H.264 + AAC in MP4 (what Instagram wants); browsers without an H.264 encoder get VP9 + Opus in WebM
  const vcodec = await mb.getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'], {width:W, height:H});
  if(!vcodec) return false;
  const mp4 = vcodec === 'avc';
  const acodec = await mb.getFirstEncodableAudioCodec(mp4 ? ['aac', 'opus'] : ['opus'], {numberOfChannels:2, sampleRate:48000});
  if(!acodec) return false;
  stopAll();
  recording = true; latencyOn = false; ['play','remix','export','cover'].forEach(id=>$(id).disabled=true);
  setCanvas(true); await captureLoop();   // full size; the loop-back frame at full size too
  const t0 = performance.now();
  showMsg('Exporting… 0%');
  const inputs = [];
  try{
    // sound: rendered offline, the same chain as the preview (loudness, limiter, tiny fades)
    const sr = 48000, oc = new OfflineAudioContext(2, Math.ceil(dur*sr), sr);
    const sn = oc.createBufferSource(); sn.buffer = buf;
    const g = oc.createGain(), lim = oc.createDynamicsCompressor();
    lim.threshold.value = -1.5; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.08;
    g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(normGain, 0.02);
    g.gain.setValueAtTime(normGain, Math.max(0.03, dur-0.25)); g.gain.linearRampToValueAtTime(0.0001, dur);
    sn.connect(g); g.connect(lim); lim.connect(oc.destination); sn.start(0);
    const audio = await oc.startRendering();
    const chunkOf = (k) => { // one second of the sound as its own AudioBuffer (fed in step with the picture)
      const a = Math.round(k*sr), b = Math.min(audio.length, Math.round((k+1)*sr)); if(b<=a) return null;
      const ab = new AudioBuffer({length:b-a, numberOfChannels:2, sampleRate:sr});
      for(let c=0;c<2;c++) ab.copyToChannel(audio.getChannelData(Math.min(c, audio.numberOfChannels-1)).subarray(a,b), c);
      return ab; };

    const output = new mb.Output({ format: mp4 ? new mb.Mp4OutputFormat({ fastStart: 'in-memory' }) : new mb.WebMOutputFormat(), target: new mb.BufferTarget() });
    const vs = new mb.CanvasSource(out, { codec: vcodec, bitrate: 12e6, keyFrameInterval: 2 });
    const as = new mb.AudioBufferSource({ codec: acodec, bitrate: 256e3 });
    output.addVideoTrack(vs, { frameRate: fps });
    output.addAudioTrack(as);
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
    exporting = true;
    const total = Math.round(dur*fps);
    // the frames of every shot: a frame belongs to the shot showing at its time (the same rule as drawFrame)
    const shots = []; { let f0 = 0; edit.forEach((e,i)=>{ const fEnd = i+1 < edit.length ? Math.min(total, Math.ceil(edit[i+1].start*fps - 1e-6)) : total; shots.push({ f0, fEnd }); f0 = fEnd; }); }
    const open = async (i) => {
      const e = edit[i], sh = shots[i]; if(!e || sh.fEnd <= sh.f0) return null;
      const { sink, first, half } = await sinkFor(e.src, i % 2), sdur = sources[e.src].dur, ts = [];
      for(let k=sh.f0; k<sh.fEnd; k++){ const v = first + half + Math.min(Math.max(0, srcPos(e, Math.max(0, k/fps - e.start))), sdur - 2*half - 0.01); ts.push(ts.length ? Math.max(v, ts[ts.length-1]) : v); }
      const it = sink.canvasesAtTimestamps(ts)[Symbol.asyncIterator]();
      const firstP = it.next(); firstP.catch(()=>{});
      return { it, firstP, ts, sink, first };
    };
    // yield to the page without timers (a hidden tab throttles setTimeout to once a second or less)
    const yieldNow = () => (globalThis.scheduler && scheduler.yield) ? scheduler.yield() : new Promise(r => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0); });
    let f = 0, nextAudio = 0; const prof = root.__prof = { decode:0, draw:0, encode:0, frames:0, glLostFrames:0, missing:0 }; let tq = performance.now();
    const tStart = performance.now();
    let pre = open(0);
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
        if(bgNeeded() && personMask){ holdText = true; try{ drawFrame(k/fps); } finally { holdText = false; } await maskNow(); bgPass(k/fps); drawText(k/fps); }
        else drawFrame(k/fps);
        const tb = performance.now(); prof.draw += tb - ta;
        await vs.add(k/fps, 1/fps);
        tq = performance.now(); prof.encode += tq - tb; prof.frames++;
        while(nextAudio <= k/fps + 1 && nextAudio*1 < dur){ const ab = chunkOf(nextAudio); if(ab) await as.add(ab); nextAudio++; }
        k++;
        if(k % 15 === 0){
          const done = k/total, el = (performance.now()-tStart)/1000, left = done > 0.03 ? el/done - el : null;
          $('xmsg').textContent = 'Exporting… ' + Math.round(done*100) + '%' + (left !== null ? ' · about ' + (left < 60 ? Math.ceil(left) + ' s' : Math.ceil(left/60) + ' min') + ' left' : '') + (document.hidden ? '' : ' · keep this screen on');
          $('prog').style.width = (done*100).toFixed(1) + '%';
          await yieldNow();
        }
        r = await cur.it.next();
      }
      if(e.fc){ const c = document.createElement('canvas'); c.width = e.fc.width; c.height = e.fc.height; c.getContext('2d').drawImage(e.fc,0,0); e.fcLast = c; }
      e.fc = null; f = sh.fEnd;
      { const o = edit[i-2]; if(o && o.fcLast){ o.fcLast.width = o.fcLast.height = 0; o.fcLast = null; } }   // older last frames are not drawn again
    }
    { const p2 = await pre; if(p2 && p2.it.return) try{ await p2.it.return(); }catch(err){} }
    while(nextAudio < dur){ const ab = chunkOf(nextAudio); if(ab) await as.add(ab); nextAudio++; }
    await output.finalize();
    const blob = new Blob([output.target.buffer], {type: mp4 ? 'video/mp4' : 'video/webm'});
    const name = 'reel-' + aspect.replace(':','x') + '-1080p.' + (mp4 ? 'mp4' : 'webm');
    const sh = saveFile(blob, name);
    showMsg(savedMsg(sh, 'Video') + ': ' + name + ' (' + (blob.size/1e6).toFixed(1) + ' MB, made in ' + ((performance.now()-t0)/1000).toFixed(1) + ' s). Ready for Instagram, TikTok and Shorts.');
    return true;
  } finally {
    exporting = false; edit.forEach(e=>{ e.fc = null; e.fcLast = null; });
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
$('export').onclick = async () => {
  if(recording || exportBusy) return;
  exportBusy = true; $('saverow').hidden = true; await holdScreen();
  try{
    let ok = false;
    try{ ok = await fastExport(); }
    catch(err){ console.warn('fast export failed', err); showMsg('Fast export failed (' + (err && err.message || err) + '). Recording in real time instead…', true); }
    if(!ok) await recordExport();
  } finally {
    exportBusy = false; if(wakeLock){ try{ await wakeLock.release(); }catch(err){} wakeLock = null; }
  }
};

/* ---- options ---- */
const redraw = () => { if(!playing && edit.length) drawFrame(pos || 0.3); };
$('hook').addEventListener('input', e=>{ hookText = e.target.value.trim(); if(!playing && edit.length){ pos = Math.min(pos, 1.0) || 0.6; prepare(segAt(pos), pos).then(redraw); } });
$('look').addEventListener('click', e=>{ const b=e.target.closest('button'); if(!b) return; look=b.dataset.l; [...$('look').children].forEach(x=>x.setAttribute('aria-pressed', x===b)); if(edit.length && !playing && !recording) captureLoop(); });
$('safe').addEventListener('change', e=>{ showSafe = e.target.checked; redraw(); });
const MODE_HELP = {
  auto: 'Auto: the music decides. Calm parts get longer shots, drops and hits get effects.',
  smooth: 'Smooth: fewer, longer shots on the strong beats, soft camera moves, no flashy effects.',
  fast: 'Fast: a cut on every beat, a transition on every cut, punches and speed changes on the hits.',
  copy: 'Copy a Reel: its pace (in beats), its transitions, its zooms and its colours, on this song and your clips.',
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
const REF_KINDS = { hard:'hard cuts', dissolve:'dissolves', fade:'fades', flash:'flashes', whip:'whip pans', zoom:'zoom-throughs' };
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
function cutKind(fr, hint){
  if(fr.length < 6) return hint === 'cut' ? 'hard' : hint;
  const endF = fr.filter(f=>Math.abs(f.k) >= CUT_K-1), ends = (endF.length >= 2 ? endF : [fr[0], fr[fr.length-1]]).map(f=>f.mean).sort((a,b)=>a-b), endMed = ends[Math.floor((ends.length-1)/2)];
  const mid = fr.filter(f=>Math.abs(f.k) <= 4), maxB = Math.max(...mid.map(f=>f.mean)), minB = Math.min(...mid.map(f=>f.mean));
  if(minB < 0.07 && endMed > 0.12) return 'fade';
  if(maxB > 0.78 && maxB > endMed + 0.22) return 'flash';
  // the reading may have landed at the end of a flash: a white spike a few frames earlier is the cut
  const early = fr.filter(f=>f.k < -2 && f.k > -CUT_K), eMax = early.length ? early.reduce((q,f)=>f.mean > q.mean ? f : q, early[0]) : null;
  if(eMax && eMax.mean > 0.78 && eMax.mean > endMed + 0.22){ fr.shiftTo = eMax.k; return 'flash'; }
  const before = fr.filter(f=>f.k <= 0 && f.k >= -4 && f.dx !== undefined);
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
    let rb = null;
    try{ const ab = await decodeAnyAudio(file); const m = new Float32Array(ab.length);
      for(let c=0;c<ab.numberOfChannels;c++){ const d = ab.getChannelData(c); for(let i=0;i<m.length;i++) m[i] += d[i]/ab.numberOfChannels; }
      let r; try{ r = await analyseInWorker(m, ab.sampleRate); }catch(e){ r = songAnalysis(m, ab.sampleRate); }
      if(r.beats && r.beats.length > 8) rb = r.beats; }catch(e){ /* no soundtrack: pace in seconds */ }
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
      cuts.forEach((c,i)=>{ const fr = cutFramesOf(frames.slice(i*(2*CUT_K+1), (i+1)*(2*CUT_K+1))); c.kind = cutKind(fr, c.hint); if(fr.shiftTo) c.t += fr.shiftTo/30; });
      // shots: a zoom inside them (two frames) and the colour look (the middle frame)
      onP(0.85, 'reading its look');
      const bounds = [0, ...cuts.map(c=>c.t), dur], sh = [];
      for(let i=0;i<bounds.length-1 && i<40;i++) sh.push({ a: bounds[i], b: bounds[i+1] });
      const zt = [], lt = [];
      // zoom: two frames well inside the shot (clear of its transitions); short shots are not judged
      sh.forEach(x=>{ const L = x.b - x.a, m = Math.min(0.3, 0.3*L); zt.push(x.a + m, x.b - m); lt.push(x.a + 0.5*L); });
      const zf = await fs.small(zt), lf = await fs.full(lt);
      sh.forEach((x,i)=>{ const L = x.b - x.a; shots.push({ a: x.a, b: x.b, zoom: L >= 0.9 ? zoomBetween(zf[2*i], zf[2*i+1]) : 1 }); const lk = lf[i] ? lookOfImage(lf[i], lf[i].width, lf[i].height) : null; if(lk) looks.push(lk); });
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
    return { name: file.name, dur, w, h, cuts: cuts.map(c=>({t:+c.t.toFixed(3), kind:c.kind})), shotSec, shotBeats, medianBeats: med(shotBeats), medianSec: med(shotSec),
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
  return R.cuts.length + ' cuts in ' + R.dur.toFixed(0) + ' s · ' + pace + (R.energy !== 'steady' ? ' · pace ' + R.energy : '') + ' · ' + (tr || 'no cuts') +
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
const REF_TR = { hard:'hard', dissolve:'dissolve', fade:'dip', flash:'flash', whip:'whip', zoom:'zoom' };
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
  ['flash','zoom','whip'].forEach(k=>place(k, hot)); ['dissolve','fade'].forEach(k=>place(k, calm));
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
    $('refinfo').textContent = '“' + f.name + '”: ' + describeRef(refProfile);
    // the copied look is on while it is matched (makeEdit then matches it on the new edit)
    GRADES.copy = { con:1, sat:1, bri:1, warm:0, teal:0, mono: refProfile.look && refProfile.look.sat < 0.05 ? 1 : 0, lift:0, vig:0, grain:0 }; copyLookKey = '';
    const lb = $('look').querySelector('[data-l="copy"]'); lb.hidden = false; look = 'copy'; [...$('look').children].forEach(x=>x.setAttribute('aria-pressed', x===lb));
    setMode('copy');
  }catch(err){ $('refinfo').textContent = 'Could not read that Reel: ' + (err && err.message ? err.message : err); }
});
$('refchange').addEventListener('click', ()=>$('reffile').click());

/* =============== START =============== */
root.__studio = { get overlays(){ return overlays; }, get bg(){ return { mode: bgMode, mask: !!bgMask, err: bgErr }; }, get faceHow(){ return sources.map(s => s.faceHow); }, seek: t => { pos = t; const i = segAt(t); return prepare(i, t).then(()=>drawFrame(t)); }, get talk(){ return talk; }, get audio(){ return buf; }, get kind(){ return kind; }, get section(){ return { start: secStart, len: buf ? buf.duration : 0, auto: sec.auto, whole: song ? song.buf.duration : 0, words: capWords }; }, get wakeLockHeld(){ return !!wakeLock; }, loseGL: () => GL && GL.gl.getExtension('WEBGL_lose_context'), renderedLook, get capLines(){ return capLines; }, faceYOnScreen, get edit(){ return edit; }, get plan(){ return plan; }, sources, gl: !!GL, get beats(){ return beats; }, get beatInfo(){ return beatInfo; }, get ref(){ return refProfile; }, get grade(){ return GRADES[look]; },
  frameAt: async t => { const i = segAt(t); await prepare(i, t); drawFrame(t); return i; }, camAt };   // read by tests

  return () => {
    try{ stopAll(); }catch(err){}
    ac.abort();
    sources.forEach(s=>{ (s.els||[]).forEach(v=>{ v.pause(); v.removeAttribute('src'); v.load(); }); URL.revokeObjectURL(s.url); });
    try{ ctx && ctx.close(); }catch(err){}
  };
}
