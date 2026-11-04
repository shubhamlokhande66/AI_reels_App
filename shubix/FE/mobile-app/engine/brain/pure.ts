// The engine's helpers that need no browser and no engine state: moved out of components/studio/engine.ts as the first
// step of running the phone's brain without the hidden page. They must stay free of the DOM (tests/brain.test.ts).
// @ts-nocheck
export const srcPosF = (e, l) => e.in + e.sp.pos(l)*e.scaleR;
export const fmt = t => { t = Math.max(0,t); const m = Math.floor(t/60), s = t - m*60; return m + ':' + (s<10?'0':'') + s.toFixed(2); };
export function endWell(p){ while(p.length > 1 && p[p.length-1].end - p[p.length-1].start < 1){ const l = p.pop(); p[p.length-1].end = l.end; } return p; }
export function nearestS(S, t){ let lo=0, hi=S.length-1; while(lo<hi){ const m=(lo+hi)>>1; if(S[m].t < t) lo=m+1; else hi=m; } return (lo>0 && Math.abs(S[lo-1].t-t) < Math.abs(S[lo].t-t)) ? lo-1 : lo; }
export function crossesScene(src, a, b){
  const sc = src.scenes; if(!sc || !sc.length) return false;
  for(const s of sc){ if(s.t0 > b + 0.06) break; if(s.t1 >= a - 0.03 && s.t0 <= b + 0.06) return true; }
  return false;
}
export function clipBytes(bytes){
  if(!Number.isFinite(bytes)) return '—';
  if(bytes < 1024*1024) return (bytes/1024).toFixed(0)+' KB';
  return (bytes/1024/1024).toFixed(2)+' MB';
}
export function updateClipHoverInfo(src){
  if(!src || !src.card || !src.file) return;
  const lines=[
    src.name,
    'Original: '+clipBytes(src.file.size)+' · '+(src.w&&src.h ? src.w+' × '+src.h : 'resolution pending'),
    'Format: '+(src.file.type || (src.name.split('.').pop() || 'unknown').toUpperCase()),
    'Duration: '+(Number.isFinite(src.dur)&&src.dur>0 ? fmt(src.dur) : '—'),
    'Average bitrate: '+(src.dur>0 ? ((src.file.size*8/src.dur)/1e6).toFixed(2)+' Mbps (estimated)' : '—'),
    'Preview: '+(src.proxyStatus || 'Checking…'),
  ];
  if(src.previewProxy && src.proxySize){
    const saved=Math.max(0,src.file.size-src.proxySize);
    const pct=src.file.size ? saved/src.file.size*100 : 0;
    lines.push('Preview copy: '+clipBytes(src.proxySize)+' · '+(src.proxyW&&src.proxyH ? src.proxyW+' × '+src.proxyH : '—'));
    lines.push('Saved: '+clipBytes(saved)+' ('+pct.toFixed(1)+'%)');
    lines.push('Format: '+(src.proxyMime || 'browser preview'));
  }else if(src.proxyReason){
    lines.push('Details: '+src.proxyReason);
  }
  lines.push(src.edFile ? 'Export: the smooth edit copy (' + (src.edW||'?') + ' × ' + (src.edH||'?') + ', 30 fps)' : 'Export: original file · unchanged');
  src.card.title=lines.join('\n');
  src.card.setAttribute('aria-label',lines.join('. '));
}
export function whatClip(f){
  const k = [];
  if(f){ const ls = Math.max(f.width||0, f.height||0); if(ls >= 7000) k.push('8K'); else if(ls >= 3800) k.push('4K'); else if(ls > 2600) k.push(Math.round(ls/1000*10)/10 + 'K');
    if(f.hdr) k.push('HDR'); if(f.tenBit && !f.hdr) k.push('10-bit'); if(f.chroma422) k.push('camera 4:2:2');
    if(f.fps > 31) k.push(Math.round(f.fps) + ' fps'); if(f.vfr) k.push('changing frame rate'); }
  return k.length ? k.join(' · ') : 'this format';
}
export function splitPoint(v, a, b){
  const h = v.hop; let best = Math.min(b, a + 3.2), bp = Infinity;
  for(let t = a + 2.5; t <= Math.min(b - 1, a + 4.5); t += h){ const p = v.probs[Math.round(t/h)] ?? 1; if(p < bp){ bp = p; best = t; } }
  return best;
}
export function rmsOf(x, gate = 0.01){ let s2 = 0, n = 0; for(let i=0;i<x.length;i+=4){ const v = x[i]; if(Math.abs(v) > gate){ s2 += v*v; n++; } } return Math.sqrt(s2/Math.max(1, n)); }
export function statsIndex(src){
  if(src._st) return src._st;
  const S = src.samples, n = S.length, T = new Float64Array(n), cm = new Float64Array(n+1), cb = new Float64Array(n+1), cc = new Float64Array(n+1), cs = new Float64Array(n+1);
  for(let i=0;i<n;i++){ T[i]=S[i].t; cm[i+1]=cm[i]+S[i].m; cb[i+1]=cb[i]+S[i].b; cc[i+1]=cc[i]+S[i].cx*S[i].m; cs[i+1]=cs[i]+S[i].sh; }
  const F = src.faces || [], k = F.length, FT = new Float64Array(k), cn = new Float64Array(k+1), cfx = new Float64Array(k+1), cfy = new Float64Array(k+1), cfs = new Float64Array(k+1);
  for(let i=0;i<k;i++){ const f=F[i], on=f.n?1:0; FT[i]=f.t; cn[i+1]=cn[i]+on; cfx[i+1]=cfx[i]+(on?f.fx:0); cfy[i+1]=cfy[i]+(on?f.fy:0); cfs[i+1]=cfs[i]+(on?f.fs:0); }
  return (src._st = {T, cm, cb, cc, cs, FT, cn, cfx, cfy, cfs});
}
export const lowerB = (A, x) => { let lo=0, hi=A.length; while(lo<hi){ const m=(lo+hi)>>1; if(A[m]<x) lo=m+1; else hi=m; } return lo; };
export const upperB = (A, x) => { let lo=0, hi=A.length; while(lo<hi){ const m=(lo+hi)>>1; if(A[m]<=x) lo=m+1; else hi=m; } return lo; };
export const TAIL = 0.15;   // seconds of clip kept free after a shot's window
export function windowStats(src, a, b){
  const X = statsIndex(src);
  let i0 = lowerB(X.T, a), i1 = upperB(X.T, b), n = i1 - i0, m, br, cx, sh;
  if(n > 0){ m = X.cm[i1]-X.cm[i0]; br = X.cb[i1]-X.cb[i0]; cx = X.cc[i1]-X.cc[i0]; sh = X.cs[i1]-X.cs[i0]; }
  else { const k = Math.min(Math.max(i0,0), src.samples.length-1), k2 = Math.max(0, k-1), s = Math.abs(src.samples[k2].t-a) < Math.abs(src.samples[k].t-a) ? src.samples[k2] : src.samples[k];
    m = s.m; br = s.b; cx = s.cx*s.m; sh = s.sh; n = 1; }
  const f0 = lowerB(X.FT, a-0.5), f1 = upperB(X.FT, b+0.5), fT = f1-f0, fN = X.cn[f1]-X.cn[f0];
  return { m: m/n, b: br/n, cx: m>1e-6 ? cx/m : 0.5, sh: sh/n, face: fT ? fN/fT : 0,
    fx: fN ? (X.cfx[f1]-X.cfx[f0])/fN : 0.5, fy: fN ? (X.cfy[f1]-X.cfy[f0])/fN : 0.5, fs: fN ? (X.cfs[f1]-X.cfs[f0])/fN : 0 };
}
export function velocitySpeed(len, bl){
  const pts = [0, ...bl.filter(b=>b>0.15 && b<len-0.1), len], segs = [];
  let acc = 0;
  for(let k=0;k<pts.length-1;k++){ const a=pts[k], b=pts[k+1], T=b-a, m=a+0.6*T;
    segs.push([a,m,0.45,acc]); acc += 0.45*(m-a); segs.push([m,b,2.2,acc]); acc += 2.2*(b-m); }
  const find = l => segs.find(s=>l<=s[1]) || segs[segs.length-1];
  return {label:'Velocity (beat)', at:l=>find(l)[2], pos:l=>{ const s=find(l); return s[3] + s[2]*(Math.min(l,s[1])-s[0]); }};
}
export function rampSpeed(len){ const sp = 0.45*len;   // fast, then slow into the next beat
  return {label:'Ramp 1.8×→0.6×', at:l=> l<sp ? 1.8 : 0.6, pos:l=> l<sp ? 1.8*l : 1.8*sp + 0.6*(l-sp)}; }
export function panClamp(p, W, dw){ return dw <= W + 0.5 ? (W - dw)/2 : Math.min(0, Math.max(W - dw, p)); }
export function keyframesFor(e){
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
export function aiBonus(ai, slot, last){
  const role = slot==='hook' ? 'hook' : (slot==='drop' || slot==='hit') ? 'action' : slot==='break' ? 'calm' : last ? 'ending' : null;
  let fit = 0;
  if(role) fit = 0.6*(ai.roles[role] || 0) + (role==='hook' ? 0.3*(ai.roles.action || 0) : 0);
  if(last && role!=='ending') fit += 0.3*(ai.roles.ending || 0);
  return ai.conf * (2.2*(ai.score - 0.5) + fit);
}
export function toSlots(list, cands){
  const slots = [];
  // an answer that is not a list of cuts (a broken reply) gives no slots: the phone's own edit stays
  for(const d of Array.isArray(list) ? list : []){ if(!d || typeof d !== 'object' || !Number.isInteger(d.i) || d.i < 0 || d.i > 999) continue; const c = (cands[d.i]||[]).find(x=>x.id===d.shot);
    slots[d.i] = { cand: c ? {src:c.si, in:c.a} : null, tr: d.transition, fx: d.effect, sp: d.speed, keys: Array.isArray(d.keys) ? d.keys : [], move: Array.isArray(d.move) ? d.move : [], cs: d.clip && typeof d.clip === 'object' ? d.clip : null, why: d.why || '', ...(d.auto ? { auto: true } : {}) }; }
  return slots;
}
export function suitFx(e){
  e.why = '';
  if(!['punch','tilt','zoomburst','hook','bounce'].includes(e.efx)) return;
  const len = e.end - e.start;
  if((e.face||0) > 0.3 && (e.fs||0) > 0.28){ e.efx = (e.efx==='zoomburst' || e.efx==='hook') ? 'punch-soft' : 'none'; e.why = 'close-up: kept gentle'; }
  else if((e.mot||0) > 0.75 && e.efx!=='hook'){ e.efx = 'punch-soft'; e.why = 'busy shot: softer zoom'; }
  else if(len > 2.2 && (e.efx==='punch' || e.efx==='tilt')){ e.efx = 'pan'; e.why = 'long shot: slow move instead'; }
}
export function goodSecs(src){
  const S = src.samples || [], med = src.shMed || 1, usable = Math.max(0, (src.dur || 0) - TAIL);
  if(!S.length) return usable;
  return usable * S.filter(x => (x.sh || 0) / med >= 0.45 && (x.b ?? 1) >= 0.08).length / S.length;
}
export function moveWords(K){
  const a = K[0], b = K[K.length-1], w = [];
  if(Math.abs(b.s - a.s) > 0.02) w.push('zoom ' + a.s.toFixed(2) + '→' + b.s.toFixed(2));
  if(Math.abs(b.x - a.x) > 0.01) w.push(b.x > a.x ? 'slides right' : 'slides left');
  if(Math.abs(b.y - a.y) > 0.01) w.push(b.y > a.y ? 'slides down' : 'slides up');
  if(Math.abs(b.r - a.r) >= 1) w.push('turns ' + Math.round(b.r - a.r) + '°');
  const ez = { outExpo: 'fast then settles', outCubic: 'quick then eases', outBack: 'overshoots', inOut: 'smooth', lin: 'steady' }[b.ez];
  return (w.join(', ') || 'moves') + (ez ? ' · ' + ez : '') + ' · ' + K.length + ' keyframes';
}
export function curveSpeed(len, cv){
  const v = ['a','b','c','d','e'].map(k => Math.min(4, Math.max(0.2, +(cv && cv[k]) || 1)));
  const at = l => { const x = Math.min(1, Math.max(0, l/Math.max(1e-6, len)))*4, i = Math.min(3, Math.floor(x)), f = x - i, s2 = f*f*(3 - 2*f); return v[i] + (v[i+1] - v[i])*s2; };
  const N = 96, cum = new Float64Array(N + 1); for(let k = 0; k < N; k++){ const a = k*len/N, b = (k + 1)*len/N; cum[k+1] = cum[k] + (at(a) + at(b))/2*(b - a); }
  const pos = l => { const x = Math.min(N, Math.max(0, l/Math.max(1e-6, len)*N)), i = Math.min(N - 1, Math.floor(x)); return cum[i] + (cum[i+1] - cum[i])*(x - i); };
  return { label:'Custom curve', at, pos };
}
export const srcPos = (e, l) => e.cs && e.cs.rev ? e.in + (e.sp.pos(e.end - e.start) - e.sp.pos(l))*e.scaleR : srcPosF(e, l);
export function csFilter(c){ if(!c.bri && !c.con && !c.sat && !c.warm) return '';
  return ` brightness(${(1+c.bri*0.5).toFixed(3)}) contrast(${(1+c.con).toFixed(3)}) saturate(${(1+c.sat).toFixed(3)})` + (c.warm ? (c.warm > 0 ? ` sepia(${(c.warm*0.25).toFixed(3)})` : ` hue-rotate(${(c.warm*-12).toFixed(1)}deg)`) : ''); }
export function wrapLines(g, text, maxW){ const words=text.split(/\s+/), lines=[]; let cur='';
  words.forEach(w=>{ const tryL = cur ? cur+' '+w : w; if(g.measureText(tryL).width > maxW && cur){ lines.push(cur); cur=w; } else cur=tryL; }); if(cur) lines.push(cur); return lines; }
export const isIndic = s2 => /[ऀ-෿]/.test(s2);
export function buildCapLines(words){
  const lines = []; let cur = [];
  const flush = () => { if(cur.length) lines.push(cur); cur = []; };
  words.forEach((w,i)=>{ const prev = cur[cur.length-1], chars = cur.reduce((q,x)=>q+x.text.length+1,0) + w.text.length;
    if(prev && (w.start - prev.end > 0.45 || cur.length >= 4 || chars > (isIndic(w.text) ? 20 : 24) || /[.,!?।]$/.test(prev.text))) flush();
    cur.push(w); });
  flush();
  return lines.map((ws,k)=>({ words: ws, a: ws[0].start - 0.12, b: ws[ws.length-1].end + 0.3 })).map((l,k,arr)=>({ ...l, b: arr[k+1] ? Math.min(l.b, arr[k+1].a - 0.02) : l.b }));
}
export function maskPath(q, m, W, H){
  const w = m.w*W, h = m.h*W, R = Math.hypot(W, H)*2;   // sized on the width, so a circle stays round
  q.translate(m.x*W, m.y*H); q.rotate((m.a || 0)*Math.PI/180); q.beginPath();
  if(m.s === 'rect') q.rect(-w/2, -h/2, w, h);
  else if(m.s === 'heart'){ const s = w/2; q.moveTo(0, s*0.9); q.bezierCurveTo(-s*1.7, -s*0.15, -s*0.65, -s*1.35, 0, -s*0.45); q.bezierCurveTo(s*0.65, -s*1.35, s*1.7, -s*0.15, 0, s*0.9); }
  else if(m.s === 'star'){ for(let k = 0; k < 10; k++){ const r = k % 2 ? w*0.21 : w/2, a = -Math.PI/2 + k*Math.PI/5; q.lineTo(Math.cos(a)*r, Math.sin(a)*r); } q.closePath(); }
  else if(m.s === 'split') q.rect(-R, 0, 2*R, R);      // one side of a line through the centre
  else if(m.s === 'film') q.rect(-R, -h/2, 2*R, h);    // a band across the frame
  else q.ellipse(0, 0, w/2, h/2, 0, 0, 2*Math.PI);
}
export function revFrame(e, local){
  const rc = e.rc, st = srcPos(e, local), k = Math.max(0, Math.min(rc.frames.length - 1, Math.round((st - rc.a)/rc.dt)));
  return rc.frames[k] || e.el;
}
export const shotBeats = e => { const L = e.end - e.start, b = (e.beatsIn || []).filter(x => x > 0.08 && x < L - 0.05); if(b.length) return b; const o = []; for(let x = 0.6; x < L - 0.1; x += 0.6) o.push(x); return o; };
export function beatFxOf(e, local){
  if(e.efx !== 'rgbpulse' && e.efx !== 'blurpulse' && e.efx !== 'vhs') return null;
  if(e.efx === 'vhs') return { rgb: 5 + 3*Math.abs(Math.sin(local*7)), zb: 0 };
  let r = 0; for(const b of shotBeats(e)){ const d = local - b; if(d >= 0 && d < 0.4) r = Math.max(r, Math.exp(-d/0.09)); }
  return e.efx === 'rgbpulse' ? { rgb: 18*r, zb: 0 } : { rgb: 0, zb: 1.4*r };
}
