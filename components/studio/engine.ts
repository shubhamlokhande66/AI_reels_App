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
export function initStudio(root, { loadMediabunny }) {

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
function getCtx(){ if(!ctx) ctx = new (window.AudioContext||window.webkitAudioContext)(); return ctx; }
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const TCOL = {drop:'--drop', hit:'--hit', cut:'--cut', break:'--break'};
const TNAME = {drop:'DROP', hit:'HIT', cut:'CUT', break:'BREAK'};

/* =============== MUSIC ENGINE =============== */
// Self-contained on purpose: its source is also run in a Web Worker, so the page never freezes while a song is analysed.
function songAnalysis(monoIn, sampleRate){
  const DRUM_MIN = 0.7;
  const buf = { sampleRate, length: monoIn.length, duration: monoIn.length/sampleRate, numberOfChannels: 1, getChannelData: () => monoIn };
  let mono = null, period = 0, phase = 0, hopSec = 0, rmsF = null, hitsStr = [], barOff = 0, beatLvl = [];
  let onEnv = null, onFps = 0, onOff = 0, hitsRaw = [], cutFx = [], pfArr = null;
  let beats = [], beatsDP = [], cuts = [], cutType = [], peaks = [], peakS = [];
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
function trackBeats(env, bodyEnv, fps, kickEnv){
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
  const score = new Float64Array(n), back = new Int32Array(n).fill(-1), tight = 100;
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
  const flux = new Float64Array(frames), fLow = new Float64Array(frames), fHi = new Float64Array(frames), fBody = new Float64Array(frames), fKick = new Float64Array(frames);
  const prev = new Float64Array(B), prevF = new Float64Array(B), kSplit = Math.round(300*N/sr), kBody = Math.round(800*N/sr), kKick = Math.max(2, Math.round(150*N/sr));
  for(let f=0;f<frames;f++){
    let s=0, sl=0, sh=0, pn=0, pdn=0, sb=0, sk=0;
    for(let k=1;k<B;k++){
      const i=f*B+k, p2=Pm[i]*Pm[i], h2=Hm[i]*Hm[i], m=Math.log1p(100*Mag[i]*p2/(p2+h2+1e-12)), e2=Mag[i]*Mag[i];
      pn += e2*p2/(p2+h2+1e-12); pdn += e2;
      const d=m-prev[k]; if(d>0&&f>0){ s+=d; if(k<kBody) sb+=d; if(k<=kKick) sk+=d; } prev[k]=m;
      const mf=Math.log1p(100*Mag[i]), df=mf-prevF[k]; if(df>0&&f>0){ if(k<kSplit) sl+=df; else sh+=df; } prevF[k]=mf;
    }
    flux[f]=s; fLow[f]=sl; fHi[f]=sh; fBody[f]=sb; fKick[f]=sk; pfArr[f]=pdn>0 ? pn/pdn : 0;
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
  const trk = trackBeats(env, bodyEnv, fps, kickEnv);
  beatsDP = trk.beats.map(f => f/fps + (N/2)/sr);
  period = trk.period/fps; phase = beatsDP.length ? beatsDP[0] : 0; hopSec = H/sr;
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
  return { period, phase, hopSec, rmsF, onEnv, onFps, onOff, hitsRaw, hitsStr, pfArr, beats, cuts, cutType, cutFx, peaks, peakS, barOff };
}
function analyseInWorker(m, sr){
  return new Promise((resolve, reject) => {
    let url = null, w = null;
    try{
      const code = 'const songAnalysis = ' + songAnalysis.toString() + ';\n' +
        'onmessage = e => { try{ postMessage({ ok: true, r: songAnalysis(e.data.mono, e.data.sr) }); } catch(err){ postMessage({ ok: false, err: String(err && err.message || err) }); } };';
      url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      w = new Worker(url);
      const done = () => { try{ w.terminate(); }catch(err){} URL.revokeObjectURL(url); };
      w.onmessage = ev => { done(); ev.data.ok ? resolve(ev.data.r) : reject(new Error(ev.data.err)); };
      w.onerror = ev => { done(); reject(new Error(ev.message || 'worker failed')); };
      const copy = m.slice(); w.postMessage({ mono: copy, sr }, [copy.buffer]);
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
  if(!mono) return;
  const spp = mono.length/w; g.fillStyle = css('--wave');
  for(let x=0;x<w;x++){ let mx=0; const a=Math.floor(x*spp), b=Math.min(mono.length,Math.floor((x+1)*spp)); for(let i=a;i<b;i+=4){ const v=Math.abs(mono[i]); if(v>mx) mx=v; } const bh=Math.max(1,mx*h*0.9); g.fillRect(x,(h-bh)/2,1,bh); }
  plan.forEach(s=>{ g.fillStyle = css(TCOL[s.type]); g.fillRect(Math.round(s.start/buf.duration*w),0,Math.max(2,dpr*1.5),h); });
}
async function loadMusic(arrayBuf, name){
  stopAll();
  $('s1st').textContent = 'Analysing the song… (you can keep using the page)'; $('mname').textContent = name; $('s1').classList.remove('done');
  try{ buf = await getCtx().decodeAudioData(arrayBuf); }
  catch(e){ $('s1st').textContent = 'Could not read this file. Use MP3, WAV, M4A or MP4.'; return; }
  const token = ++musicToken;
  { const ch = buf.numberOfChannels, len = buf.length; mono = new Float32Array(len);
    for(let c=0;c<ch;c++){ const d = buf.getChannelData(c); for(let i=0;i<len;i++) mono[i] += d[i]/ch; } }
  drawMusic();
  let r;
  try{ r = await analyseInWorker(mono, buf.sampleRate); }
  catch(err){ console.warn('song analysis worker unavailable, analysing on the page', err); await new Promise(rr=>setTimeout(rr,30)); r = songAnalysis(mono, buf.sampleRate); }
  if(token !== musicToken) return;   // another song was chosen meanwhile
  ({ period, phase, hopSec, rmsF, onEnv, onFps, onOff, hitsRaw, hitsStr, pfArr, beats, cuts, cutType, cutFx, peaks, peakS, barOff } = r);
  buildPlan(); drawMusic();
  { let s=0,n=0; for(let i=0;i<mono.length;i+=64){ const v=mono[i]; if(Math.abs(v)>0.003){ s+=v*v; n++; } }
    const rms = 10*Math.log10(s/Math.max(1,n)+1e-12); normGain = Math.pow(10, Math.max(-6, Math.min(9, -14 - rms))/20); }
  $('mdur').textContent = fmt(buf.duration); $('mbpm').textContent = (60/period).toFixed(0);
  $('mclips').textContent = plan.length; $('mdrop').textContent = plan.filter(s=>s.type==='drop').length; $('mbreak').textContent = plan.filter(s=>s.type==='break').length;
  $('s1st').textContent = 'Ready'; $('s1').classList.add('done'); $('s2').classList.remove('locked');
  if(sources.length) makeEdit();
}
$('mpick').onclick = () => $('mfile').click();
$('mfile').addEventListener('change', async e=>{ const f=e.target.files[0]; e.target.value=''; if(f) loadMusic(await f.arrayBuffer(), f.name); });
window.addEventListener('resize', ()=>{ drawMusic(); sources.forEach(drawSpark); drawTimeline(); }, SIG);

/* =============== STEP 2: VIDEOS =============== */
const sources = []; // {name,url,dur,w,h,samples:[{t,m,b,cx}], els:[v,v], use:0}
const SW = 48, SH = 27;
function waitEv(el, ev, ms=8000){ return new Promise((res,rej)=>{ const t=setTimeout(()=>{ cleanup(); rej(new Error('timeout '+ev)); }, ms); const ok=()=>{ cleanup(); res(); }; const bad=()=>{ cleanup(); rej(new Error('error')); }; function cleanup(){ clearTimeout(t); el.removeEventListener(ev,ok); el.removeEventListener('error',bad); } el.addEventListener(ev,ok,{once:true}); el.addEventListener('error',bad,{once:true}); }); }
function makeVideo(url){ const v=document.createElement('video'); v.muted=true; v.playsInline=true; v.preload='auto'; v.crossOrigin='anonymous'; v.src=url; return v; }

async function scanMotion(src, onProgress){
  // play the clip fast (muted) and compare small frames: how much moves, where it moves, how bright
  const v = makeVideo(src.url); await waitEv(v,'loadeddata');
  const c = document.createElement('canvas'); c.width=SW; c.height=SH; const g = c.getContext('2d', {willReadFrequently:true});
  const c2 = document.createElement('canvas'); c2.width=128; c2.height=72; const g2 = c2.getContext('2d', {willReadFrequently:true});
  let prev = null; const out = [];
  const grab = () => {
    g.drawImage(v,0,0,SW,SH); const d = g.getImageData(0,0,SW,SH).data;
    const lum = new Float32Array(SW*SH); let b=0;
    for(let i=0;i<SW*SH;i++){ const y=(d[i*4]*0.3+d[i*4+1]*0.59+d[i*4+2]*0.11)/255; lum[i]=y; b+=y; }
    let m=0, mx=0;
    if(prev){ for(let i=0;i<lum.length;i++){ const df=Math.abs(lum[i]-prev[i]); m+=df; mx+=df*((i%SW)+0.5)/SW; } }
    // sharpness: how strong the fine edges are (Laplacian variance) - blurry or shaky frames score low
    g2.drawImage(v,0,0,128,72); const d2 = g2.getImageData(0,0,128,72).data, L2 = new Float32Array(128*72);
    for(let i=0;i<L2.length;i++) L2[i] = d2[i*4]*0.3+d2[i*4+1]*0.59+d2[i*4+2]*0.11;
    let sm=0, sq=0, n=0;
    for(let y=1;y<71;y++) for(let x=1;x<127;x++){ const i=y*128+x, lap = 4*L2[i]-L2[i-1]-L2[i+1]-L2[i-128]-L2[i+128]; sm+=lap; sq+=lap*lap; n++; }
    const sh = sq/n - (sm/n)*(sm/n);
    out.push({t:v.currentTime, m: prev ? m/lum.length : 0, b:b/lum.length, cx: m>1e-6 ? mx/m : 0.5, sh});
    prev = lum;
  };
  v.playbackRate = Math.min(16, Math.max(2, src.dur/6));
  await new Promise(res=>{
    let done=false; const finish=()=>{ if(!done){ done=true; v.pause(); res(); } };
    const useVFC = 'requestVideoFrameCallback' in v;
    let lastT = -1;
    const step = () => { if(done) return; if(v.currentTime!==lastT){ lastT=v.currentTime; grab(); onProgress(v.currentTime/src.dur); } if(v.ended || v.currentTime>=src.dur-0.05) return finish(); useVFC ? v.requestVideoFrameCallback(step) : requestAnimationFrame(step); };
    v.addEventListener('ended', finish, {once:true});
    v.play().then(()=>{ useVFC ? v.requestVideoFrameCallback(step) : requestAnimationFrame(step); }).catch(async ()=>{
      // cannot play fast here: fall back to seeking 4 times a second
      for(let t=0;t<src.dur;t+=0.25){ v.currentTime=t; try{ await waitEv(v,'seeked',3000); }catch(e){} grab(); onProgress(t/src.dur); }
      finish();
    });
    setTimeout(finish, Math.max(20000, src.dur/ v.playbackRate*1000*3));
  });
  v.removeAttribute('src'); v.load();
  out.sort((a,b)=>a.t-b.t);
  if(out.length>1) out[0].m = out[1].m;
  // smooth motion a little
  src.samples = out.map((s,i)=>({...s, m: (out[Math.max(0,i-1)].m + s.m + out[Math.min(out.length-1,i+1)].m)/3}));
}
async function scanFaces(src, onProgress){
  // AI vision: find faces (where people are) about 40 times across the clip
  src.faces = [];
  if(!window.tracking || !tracking.ViolaJones || !tracking.ViolaJones.classifiers || !tracking.ViolaJones.classifiers.face) return;
  const v = makeVideo(src.url); await waitEv(v,'loadeddata');
  const w = 240, h = Math.round(240*src.h/src.w), c = document.createElement('canvas'); c.width=w; c.height=h;
  const g = c.getContext('2d', {willReadFrequently:true});
  const step = Math.min(2, Math.max(0.4, src.dur/40));
  for(let tt=0.1; tt<src.dur; tt+=step){
    v.currentTime = tt; try{ await waitEv(v,'seeked',3000); }catch(e){ continue; }
    g.drawImage(v,0,0,w,h); const px = g.getImageData(0,0,w,h).data;
    let rects = [];
    try{ rects = tracking.ViolaJones.detect(px, w, h, 1.0, 1.25, 1.5, 0.2, tracking.ViolaJones.classifiers.face) || []; }catch(e){}
    rects = rects.filter(r=>r.width > w*0.06);
    if(rects.length){ const big = rects.reduce((a,b)=>a.width>b.width?a:b);
      src.faces.push({t:tt, n:rects.length, fx:(big.x+big.width/2)/w, fy:(big.y+big.height/2)/h, fs:big.width/w}); }
    else src.faces.push({t:tt, n:0});
    onProgress(tt/src.dur);
    await new Promise(r=>setTimeout(r,0));
  }
  v.removeAttribute('src'); v.load();
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
    const v = makeVideo(src.url); await waitEv(v,'loadedmetadata');
    src.dur = v.duration; src.w = v.videoWidth; src.h = v.videoHeight;
    if(!isFinite(src.dur) || src.dur<=0 || !src.w) throw new Error('bad');
    v.currentTime = Math.min(src.dur*0.3, 2); await waitEv(v,'seeked');
    const th = card.querySelector('.th'); th.width=320; th.height=180; const tg=th.getContext('2d');
    const r = Math.max(320/src.w, 180/src.h); tg.drawImage(v,(320-src.w*r)/2,(180-src.h*r)/2,src.w*r,src.h*r);
    v.removeAttribute('src'); v.load();
    if(src.removed) return;
    await scanMotion(src, p=>{ dd.textContent = 'finding action ' + Math.round(p*100) + '%'; });
    if(src.removed) return;
    await scanFaces(src, p=>{ dd.textContent = 'finding faces ' + Math.round(p*100) + '%'; });
    if(src.removed) return;
    const nf = src.faces.filter(f=>f.n>0).length, shs = src.samples.map(s=>s.sh).sort((a,b)=>a-b);
    src.shMed = shs[Math.floor(shs.length/2)] || 1;
    dd.textContent = src.dur.toFixed(1) + ' s · ' + src.w + '×' + src.h + (nf ? ' · faces ' + Math.round(nf/Math.max(1,src.faces.length)*100) + '%' : '');
    src.els = [makeVideo(src.url), makeVideo(src.url), makeVideo(src.url)];
    sources.push(src); drawSpark(src);
  }catch(e){
    if(src.removed) return;
    dd.textContent = 'This video does not play here (format). Remove it with ×.';
    card.style.borderColor = 'var(--drop)';
  }
}
function finishAdding(){
  updateQ(); $('clearv').hidden = !$('clips').children.length;
  if(sources.length){ $('s2').classList.add('done'); if(buf) makeEdit(); }
}
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
}
const TR_NAME = {hard:'Hard cut', fadein:'Fade-in', flash:'Exposure flash', whip:'Whip pan (blur)', zoom:'Zoom-through', glitch:'Glitch RGB', dip:'Dip to black', dissolve:'Dissolve',
  iris:'Mask: iris', wipe:'Mask: soft wipe', bars:'Mask: bars', spin:'Spin + blur'};
const FX_NAME = {'pan-soft':'Ken Burns (soft)', snap:'Photo snap (freeze + flash)', hook:'Hook zoom + RGB', none:'—', pan:'Ken Burns + beat bounce', zoomburst:'Zoom burst + RGB', drift:'Slow drift + vignette', punch:'Zoom punch', tilt:'Tilt punch', shake:'Shake', bounce:'Beat bounce'};
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
    default: return {};
  }
}

let dupCount = 0;
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
function makeEdit(){
  if(!buf || !sources.length) return;
  stopAll(); plan = adaptPlan(); styleEdit();
  const gmax = Math.max(1e-6, ...sources.flatMap(s=>s.samples.map(x=>x.m)));
  const used = sources.map(()=>[]);
  const order = plan.map((s,i)=>i).sort((a,b)=>{ const pr={drop:0,hit:1,break:2,cut:3}; return pr[plan[a].type]-pr[plan[b].type] || a-b; });
  const res = new Array(plan.length); dupCount = 0;
  const pick = (i, allowNeighbour, allowOverlap) => {
    const s = plan[i], len = s.end - s.start;
    let best=null, bs=-Infinity;
    sources.forEach((src,si)=>{
      let need = s.sp.pos(len), scaleR = 1;
      if(need > src.dur-TAIL){ scaleR = Math.max(0.05, (src.dur-TAIL)/need*0.98); need *= scaleR; }
      if(!allowNeighbour && sources.length>1 && [res[i-1],res[i+1]].some(x=>x && x.src===si)) return;
      const stepT = Math.max(0.1, Math.min(0.5, src.dur/120));
      for(let a=0; a<=src.dur-need-TAIL+1e-6; a+=stepT){
        let ov = 0; used[si].forEach(([u0,u1])=>{ ov += Math.max(0, Math.min(u1,a+need)-Math.max(u0,a)); });
        if(!allowOverlap && ov > 0.001) continue;          // a moment of footage is used only once
        const st = windowStats(src, a, a+need), m = st.m/gmax;
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
        sc -= 5*ov/need;
        sc += rng()*0.15;
        if(sc>bs){ bs=sc; best={src:si, in:a, scaleR, cx: st.face>0.3 ? st.fx : st.cx, cy: st.face>0.3 ? st.fy : 0.45, face: st.face, fs: st.fs, mot: m, ov}; }
      }
    });
    return best;
  };
  order.forEach(i=>{
    const len = plan[i].end - plan[i].start;
    let best = pick(i,false,false) || pick(i,true,false) || pick(i,true,true) || {src:0,in:0,scaleR:1,cx:0.5,cy:0.5,face:0,ov:0};
    if(best.ov > 0.001) dupCount++;
    used[best.src].push([best.in, best.in + plan[i].sp.pos(len)*best.scaleR]);
    res[i] = best;
  });
  const useCount = sources.map(()=>0);   // (players re-assigned by assignPlayers on manual edits)
  edit = plan.map((s,i)=>({...s, ...res[i], el: sources[res[i].src].els[(useCount[res[i].src]++)%3]}));
  edit.forEach(e=>{ e.cx = 0.5 + (e.cx-0.5)*(e.face>0.3 ? 1 : 0.8); if(mode!=='smooth') suitFx(e); e.kf = keyframesFor(e); e.beatsIn = beats.filter(b=>b>e.start+0.12 && b<e.end-0.05).map(b=>b-e.start); });
  renderEDL(); setCanvas();
  $('s3').classList.remove('locked'); $('s3').classList.add('done');
  const total = sources.reduce((a,s)=>a+s.dur,0);
  $('s3st').textContent = edit.length + ' shots · ' + fmt(buf.duration) + (dupCount ? ' · ' + dupCount + ' shots reused (not enough footage)' : ' · no repeated moments');
  if(dupCount) showMsg('Your clips have ' + total.toFixed(1) + ' s of footage, the song needs more. ' + dupCount + ' shots had to be reused. Add more clips and nothing repeats.', true);
  else $('xmsg').hidden = true;
  ['play','remix','export','cover'].forEach(id=>$(id).disabled=false);
  captureLoop();
}
function captureLoop(){
  if(!edit.length) return;
  return prepare(0, 0.6).then(()=>{ loopImg=null; const sv=showSafe, h=hookText; showSafe=false; hookText=''; drawFrame(0.6);
    const c=document.createElement('canvas'); c.width=out.width; c.height=out.height; c.getContext('2d').drawImage(out,0,0); loopImg=c;
    showSafe=sv; hookText=h; pos=0.3; return prepare(0,0.3); }).then(()=>drawFrame(0.3));
}
function kfSummary(e){
  const why = e.why ? `<br><span style="font:11px var(--body);color:var(--muted)">${e.why}</span>` : '';
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
      const st = windowStats(src, a, a+need), m = st.m/gmax;
      let sc = e.type==='drop' ? 2.2*m : e.type==='hit' ? 1.5*m : e.type==='break' ? 1-Math.abs(m-0.18)*2 : 1-Math.abs(m-0.55);
      if(st.b < 0.08) sc -= 1; const sharp = st.sh/(src.shMed||1); if(sharp<0.45) sc -= 0.9; else sc += 0.25*Math.min(1.5,sharp);
      sc += st.face*0.6 + rng()*0.3;
      if(sc>bs){ bs=sc; best={src:si, in:a, scaleR, cx: st.face>0.3 ? st.fx : 0.5+(st.cx-0.5)*0.8, cy: st.face>0.3 ? st.fy : 0.45, face:st.face, fs: st.fs, mot: m}; }
    }
  });
  if(!best) return false;
  Object.assign(e, best); assignPlayers(); return true;
}
async function showShot(i){ pos = edit[i].start + Math.min(0.4, (edit[i].end-edit[i].start)*0.5);
  await Promise.all([edit[i-1]?prepare(i-1,edit[i-1].end-0.01):0, prepare(i, pos)]); drawFrame(pos); drawTimeline(); }
function changed(i, refit){
  stopAll(); const e = edit[i]; e.kf = keyframesFor(e);
  if(refit){ const need = e.sp.pos(e.end-e.start)*e.scaleR, src = sources[e.src];
    const clash = edit.some((x,k)=>k!==i && x.src===e.src && Math.min(x.in+x.sp.pos(x.end-x.start)*x.scaleR, e.in+need)-Math.max(x.in,e.in) > 0.001);
    if(e.in + need > src.dur || clash) repick(i, false); }
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
$('remix').onclick = () => { seed = (seed*7919 + 13) % 2147483647 || 7; makeEdit(); };

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
let look = 'vivid', hookText = '', showSafe = true, loopImg = null;
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
  const sw = sources[e.src].w, shh = sources[e.src].h;
  const r = Math.max(W/sw, H/shh)*scale, dw = sw*r, dh = shh*r;
  let px = W/2 - e.cx*dw; px = Math.min(0, Math.max(W-dw, px)) + x;
  let py0 = H/2 - (e.cy ?? 0.5)*dh; py0 = Math.min(0, Math.max(H-dh, py0));
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
function drawHook(t){
  if(!hookText) return;
  const W=out.width, H=out.height, T=2.2; if(t > T && !coverMode) return;
  const inP = coverMode ? 1 : Math.min(1, t/0.28), outP = coverMode ? 0 : Math.max(0, (t-(T-0.25))/0.25);
  const sc = 0.6 + 0.4*EASE.outBack(inP), a = Math.min(1, inP*1.5)*(1-outP);
  const fs = Math.round(Math.min(W,H*0.5625)*0.1);
  og.save(); og.globalAlpha=a; og.font = `800 ${fs}px "Bricolage Grotesque", "Arial Black", system-ui, sans-serif`;
  og.textAlign='center'; og.textBaseline='middle';
  const lines = wrapLines(og, hookText.toUpperCase(), W*0.8), lh = fs*1.08;
  const cy = H*(H>W ? 0.27 : 0.3);   // upper third, below Instagram's top UI
  og.translate(W/2, cy); og.scale(sc, sc);
  lines.forEach((ln,k)=>{ const y=(k-(lines.length-1)/2)*lh;
    og.lineJoin='round'; og.lineWidth=fs*0.14; og.strokeStyle='rgba(0,0,0,0.85)'; og.strokeText(ln,0,y);
    og.shadowColor='rgba(0,0,0,0.4)'; og.shadowBlur=fs*0.2; og.fillStyle='#fff'; og.fillText(ln,0,y); og.shadowBlur=0; });
  og.restore();
}
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
  drawHook(t);
  if(showSafe && !recording && !coverMode) drawSafe();
  $('prog').style.width = (t/buf.duration*100).toFixed(2)+'%';
  const rows = $('edl').children; if(rows[i] && !rows[i].classList.contains('cur')){ [...rows].forEach(r=>r.classList.remove('cur')); rows[i].classList.add('cur'); }
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
uniform float con, sat, bri, teal, mono, vig, grain, flash, loopMix;
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
  col = (col-0.5)*con + 0.5; col *= bri;
  float l = dot(col, vec3(0.299,0.587,0.114));
  col = mix(vec3(l), col, sat);
  if(teal>0.){ vec3 tint = mix(vec3(0.75,1.05,1.12), vec3(1.12,0.98,0.82), smoothstep(0.15,0.85,l)); col = mix(col, col*tint, teal); }
  col = mix(col, vec3(dot(col,vec3(0.299,0.587,0.114))), mono);
  if(leak.z>0.){ float d = distance(p, leak.xy)/(res.x*0.9); vec3 lc = vec3(1.,0.67,0.35)*leak.z*(1.-smoothstep(0.,1.,d)); col = 1.-(1.-col)*(1.-lc); }
  col += flash;
  vec2 uvn = p/res-0.5; float vd = length(uvn*vec2(res.x/res.y,1.)*vec2(1.,1.));
  col *= 1. - vig*smoothstep(0.3,0.75,vd);
  if(grain>0.) col += (hash(p*0.73 + fract(time*7.)*vec2(97.,13.))-0.5)*grain*0.6;
  if(loopMix>0.) col = mix(col, texture2D(tL, p/res).rgb, loopMix);
  gl_FragColor = vec4(clamp(col,0.,1.),1.);
}`;
const GL = (()=>{
  try{
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl', {preserveDrawingBuffer:true, premultipliedAlpha:false, antialias:false});
    if(!gl) return null;
    const sh = (type, src) => { const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER,GLSL_V)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER,GLSL_F)); gl.linkProgram(pr);
    if(!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    gl.useProgram(pr);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,b); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr,'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
    const tex = [0,1,2].map(k=>{ const t=gl.createTexture(); gl.activeTexture(gl.TEXTURE0+k); gl.bindTexture(gl.TEXTURE_2D,t);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0,255])); return t; });
    const U = {}; const n = gl.getProgramParameter(pr, gl.ACTIVE_UNIFORMS);
    for(let i=0;i<n;i++){ const info=gl.getActiveUniform(pr,i); U[info.name]=gl.getUniformLocation(pr,info.name); }
    gl.uniform1i(U.tA,0); gl.uniform1i(U.tB,1); gl.uniform1i(U.tL,2);
    let loopSrc = null;
    const upload = (k, src) => { if(!src) return; if(src.readyState!==undefined && src.readyState<2) return; gl.activeTexture(gl.TEXTURE0+k); gl.bindTexture(gl.TEXTURE_2D,tex[k]);
      try{ gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,src); }catch(e){} };
    const set = (name, v) => { const l=U[name]; if(!l) return; if(typeof v==='number') gl.uniform1f(l,v); else if(v.length===2) gl.uniform2fv(l,v); else if(v.length===3) gl.uniform3fv(l,v); else gl.uniform4fv(l,v); };
    return { canvas:c, render(S){
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
      const G = S.grade; set('con',G.con); set('sat',G.sat); set('bri',G.bri); set('teal',G.teal); set('mono',G.mono); set('vig',G.vig); set('grain',G.grain);
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
  const sw = sources[e.src].w, shh = sources[e.src].h, r = Math.max(W/sw, H/shh)*scale, dw = sw*r, dh = shh*r;
  let px = W/2 - e.cx*dw; px = Math.min(0, Math.max(W-dw, px)) + x;
  let py = H/2 - (e.cy ?? 0.5)*dh; py = Math.min(0, Math.max(H-dh, py)) + y;
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
  S.grade.vig = (kf(e.kf && e.kf.vig, local) ?? 0.22);
  const inTr = p < 1 && (pe || e.tr==='fadein');
  if(inTr && pe) S.A = layerOf(pe, pl, {noFx:true});
  S.B = layerOf(e, local);
  if(inTr){
    switch(e.tr){
      case 'whip': { const blur = 0.09*W*Math.sin(Math.PI*q); S.A = layerOf(pe, pl, {dx:-q*W, db:[blur,0], noFx:true}); S.B = layerOf(e, local, {dx:(1-q)*W, db:[blur,0]}); S.mode = 3; break; }
      case 'zoom': S.A = layerOf(pe, pl, {scale:1+0.9*p*p, zb:1.2, noFx:true}); S.B = layerOf(e, local, {scale:1.6-0.6*q, zb:1-q}); S.mode = 1; S.mix = q; break;
      case 'spin': S.A = layerOf(pe, pl, {rot:90*p*p, scale:1+0.5*p, zb:0.8, noFx:true}); S.B = layerOf(e, local, {rot:-90*(1-q), scale:1.5-0.5*q, zb:1-q}); S.mode = 1; S.mix = q; break;
      case 'glitch': S.B = layerOf(e, local, {rgb:22*(1-p)}); S.mode = 5; break;
      case 'iris': S.mode = 6; S.prog = p; S.iris = [e.cx*W, (e.cy??0.5)*H]; break;
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
  drawHook(t);
  if(showSafe && !recording && !coverMode) drawSafe();
  $('prog').style.width = (t/buf.duration*100).toFixed(2)+'%';
  const rows = $('edl').children; if(rows[i] && !rows[i].classList.contains('cur')){ [...rows].forEach(r=>r.classList.remove('cur')); rows[i].classList.add('cur'); }
}
function drawFrame(t){ if(!edit.length){ og.fillStyle='#000'; og.fillRect(0,0,out.width,out.height); return; } if(GL) drawFrameGL(t); else drawFrame2D(t); }

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
function saveFile(blob, name){
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 60000);
}
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
  saveFile(blob, name); showMsg('Video saved: '+name+' ('+(blob.size/1e6).toFixed(1)+' MB). Ready for Instagram, TikTok and Shorts.');}

// Fast export: every frame is decoded (WebCodecs, through mediabunny), drawn and encoded off-screen, faster than real
// time and frame-accurate (no dropped frames). The sound goes through the same gain + limiter as the preview.
async function fastExport(){
  if(!window.VideoEncoder || !window.AudioEncoder || !window.OfflineAudioContext) return false;
  const mb = await loadMediabunny();
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

    // one decoder per clip, frames scaled to what the output needs (not the full 4K)
    const sinks = new Map();
    const sinkFor = async (si) => {
      if(!sinks.has(si)){
        const s = sources[si], input = new mb.Input({ source: new mb.BlobSource(s.file), formats: mb.ALL_FORMATS }); inputs.push(input);
        const track = await input.getPrimaryVideoTrack();
        const r = Math.min(1, Math.max(W/s.w, H/s.h)*1.3);
        let sfps = 30; try{ const stt = await track.computePacketStats(90); if(stt && stt.averagePacketRate > 1) sfps = stt.averagePacketRate; }catch(err){}
        sinks.set(si, { sink: new mb.CanvasSink(track, { width: Math.max(16, Math.round(s.w*r/2)*2), height: Math.max(16, Math.round(s.h*r/2)*2), fit: 'fill' }), first: await track.getFirstTimestamp(), half: 0.5/sfps });
      }
      return sinks.get(si);
    };
    exporting = true;
    const total = Math.round(dur*fps);
    let f = 0, nextAudio = 0; const prof = root.__prof = { decode:0, draw:0, encode:0, frames:0 }; let tq = performance.now();
    for(let i=0; i<edit.length; i++){
      const e = edit[i], { sink, first, half } = await sinkFor(e.src), sdur = sources[e.src].dur;
      const fEnd = i+1 < edit.length ? Math.min(total, Math.ceil(edit[i+1].start*fps - 1e-6)) : total;   // same rule as drawFrame: a frame belongs to the shot showing at its time
      const ts = [];
      for(let k=f; k<fEnd; k++){ const v = first + half + Math.min(Math.max(0, srcPos(e, Math.max(0, k/fps - e.start))), sdur - 2*half - 0.01); ts.push(ts.length ? Math.max(v, ts[ts.length-1]) : v); }
      let k = f;
      for await (const wc of sink.canvasesAtTimestamps(ts)){
        const ta = performance.now(); prof.decode += ta - tq;
        if(wc) e.fc = wc.canvas;
        else if(!e.fc){   // no frame for this time (variable frame rate, an edit list gap): take the nearest real one, never the previous shot
          const g = (await sink.getCanvas(ts[k-f] + 0.05)) || (await sink.getCanvas(first + 0.02));
          if(g) e.fc = g.canvas;
        }
        drawFrame(k/fps);
        const tb = performance.now(); prof.draw += tb - ta;
        await vs.add(k/fps, 1/fps);
        tq = performance.now(); prof.encode += tq - tb; prof.frames++;
        while(nextAudio <= k/fps + 1 && nextAudio*1 < dur){ const ab = chunkOf(nextAudio); if(ab) await as.add(ab); nextAudio++; }
        k++;
        if(k % 15 === 0){ $('xmsg').textContent = 'Exporting… ' + Math.round(k/total*100) + '%'; await new Promise(r=>setTimeout(r,0)); }
      }
      if(e.fc){ const c = document.createElement('canvas'); c.width = e.fc.width; c.height = e.fc.height; c.getContext('2d').drawImage(e.fc,0,0); e.fcLast = c; }
      e.fc = null; f = fEnd;
    }
    while(nextAudio < dur){ const ab = chunkOf(nextAudio); if(ab) await as.add(ab); nextAudio++; }
    await output.finalize();
    const blob = new Blob([output.target.buffer], {type: mp4 ? 'video/mp4' : 'video/webm'});
    const name = 'reel-' + aspect.replace(':','x') + '-1080p.' + (mp4 ? 'mp4' : 'webm');
    saveFile(blob, name);
    showMsg('Video saved: ' + name + ' (' + (blob.size/1e6).toFixed(1) + ' MB, made in ' + ((performance.now()-t0)/1000).toFixed(1) + ' s). Ready for Instagram, TikTok and Shorts.');
    return true;
  } finally {
    exporting = false; edit.forEach(e=>{ e.fc = null; e.fcLast = null; });
    inputs.forEach(x=>{ try{ x.dispose(); }catch(err){} });
    recording = false; latencyOn = true; ['play','remix','export','cover'].forEach(id=>$(id).disabled=false);
    setCanvas(false); if(edit.length) captureLoop();
  }
}
$('export').onclick = async () => {
  if(recording) return;
  let ok = false;
  try{ ok = await fastExport(); }
  catch(err){ console.warn('fast export failed', err); showMsg('Fast export failed (' + (err && err.message || err) + '). Recording in real time instead…', true); }
  if(!ok) await recordExport();
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
};
$('mode').addEventListener('click', e=>{ const b=e.target.closest('button'); if(!b || recording) return; mode=b.dataset.m;
  [...$('mode').children].forEach(x=>x.setAttribute('aria-pressed', x===b)); $('modehelp').textContent = MODE_HELP[mode];
  if(buf){ plan = adaptPlan(); drawMusic(); $('mclips').textContent = plan.length; }
  if(buf && sources.length) makeEdit(); });
$('cover').onclick = async () => {
  // cover: the best drop shot (or the hook) with the hook text, full frame
  const d = edit.find(x=>x.type==='drop') || edit[0], tt = d.start + Math.min(0.6, (d.end-d.start)*0.6);
  setCanvas(true); coverMode = true; const i = segAt(tt); await prepare(i, tt); drawFrame(tt);
  const blob = await new Promise(r=>out.toBlob(r,'image/jpeg',0.92)); coverMode = false; setCanvas(false); captureLoop();
  saveFile(blob, 'reel-cover.jpg'); showMsg('Cover saved. Pick it under "Edit cover" when you post.');
};

/* =============== START =============== */
root.__studio = { get edit(){ return edit; }, get plan(){ return plan; }, sources, gl: !!GL };

  return () => {
    try{ stopAll(); }catch(err){}
    ac.abort();
    sources.forEach(s=>{ (s.els||[]).forEach(v=>{ v.pause(); v.removeAttribute('src'); v.load(); }); URL.revokeObjectURL(s.url); });
    try{ ctx && ctx.close(); }catch(err){}
  };
}
