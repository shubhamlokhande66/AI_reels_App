/* eslint-disable */
// @ts-nocheck
/* =============== MUSIC ENGINE (the website's and the phone's: FE/web-app studio/engine.ts, FE/mobile-app lib/engine.ts) ===============
 * The song as the editor hears it: own FFT, drum / voice split by median filtering, beat tracking (tempo, metrical level,
 * local tempo, Ellis' dynamic programming), each beat on its attack, hits, sudden rises and falls in loudness (drops,
 * breaks), the cuts and their kind. Self-contained on purpose: its source is also run in a Web Worker (no imports, no
 * outside names), so the page never freezes while a song is analysed. `monoIn`: the song in one channel (Float32Array),
 * `sampleRate` its rate. */
export function songAnalysis(monoIn, sampleRate, opts){
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
  // the creator's own beats live on the page; in the worker there are none (analyseInWorker leaves songs with them here)
  beats = (typeof withMarks === 'function' ? withMarks : b => b)(beatsDP.filter(t => t >= 0 && t < dur-0.02), dur);
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
