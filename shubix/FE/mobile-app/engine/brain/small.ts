// The small rules of the phone's engine.
// @ts-nocheck
export function createSmallBrain(ES, EH){
  const aiBal = () => ES.aiInfo && typeof ES.aiInfo.balance === 'number' ? ES.aiInfo.balance : null;
  const aiCostOf = k => (ES.aiInfo && ES.aiInfo.costs && Number(ES.aiInfo.costs[k])) || 0;
  const creditWord = n => n + ' credit' + (n === 1 ? '' : 's');
  const aiHeldBack = () => !!ES.aiDoneSig && !ES.regenOk && inputSig() !== ES.aiDoneSig;
  const planIsFinal = () => !!ES.aiDoneSig && !ES.regenOk && !ES.chatWaiting;
  const csFade = (c, local, L) => Math.min(c.fin > 0 ? Math.min(1, local/c.fin) : 1, c.fout > 0 ? Math.min(1, Math.max(0, (L-local)/c.fout)) : 1);
  const csOf = (e, l) => e && e.cs ? EH.kxAt({ ...EH.CS0, ...e.cs }, l) : EH.CS0;
  const csVoiced = e => !!(e.cs && (e.cs.vol > 0 || (e.cs.kx || []).some(k => k.vol > 0)));   // the shot's own sound plays (its volume, or a volume keyframe)
  const clipVoiced = () => ES.kind !== 'talk' && ES.edit.some(e => csVoiced(e));
  const musicOut = () => ES.au.mfoutManual ? ES.au.mfout : (ES.au.ai ? 0.8 : 0);
  const hexRgb = h => { const n = parseInt(String(h).replace('#',''), 16) || 0; return [(n>>16&255)/255, (n>>8&255)/255, (n&255)/255]; };
  const lyOn = (L, t) => t >= L.t0 && t < L.t1;
  const rateAt = (e, l) => { const r = e.sp.at(l)*e.scaleR; return r<=0 ? 0 : Math.max(0.0625, Math.min(16, r)); };
  const reelLen = () => (ES.buf ? ES.buf.duration : 0);
  const partOn = () => !!ES.song && ES.buf !== ES.song.buf;
  const storySentences = (t) => (t.replace(/\s+/g, ' ').match(/[^.!?।]+[.!?।]*/g) || []).map(s => s.trim()).filter(s => s.length > 1);
  const avgLook = arr => { const o = {}; if(!arr.length) return null; for(const k of Object.keys(arr[0])) o[k] = arr.reduce((q,x)=>q+x[k],0)/arr.length; return o; };
  const clip = (x, a, b) => Math.min(b, Math.max(a, Number.isFinite(x) ? x : a));
  const fileFp = f => f ? [f.name, f.size, f.lastModified].join('|') : '';
  const ttsPcm = (c) => { if(!c.pcm) return null; if(ES.au.vfx === 'none') return c.pcm; const k = 'tts' + c.id + '|' + ES.au.vfx; if(!EH.fxCache.has(k)) EH.fxCache.set(k, EH.voiceFx(c.pcm, c.sr, ES.au.vfx)); return EH.fxCache.get(k); };
  const paceKey = () => [ES.wish, ES.tplKind, ES.musicKey, ES.mode, ES.mode === 'copy' && ES.refProfile ? ES.refProfile.name + '|' + ES.refProfile.dur : '', EH.isPhotoMode() ? 'p' : 'v', ES.sources.length, Math.round(ES.sources.reduce((a,s)=>a+(s.removed?0:s.dur||0),0))].join('#');
  const paceSongKey = () => ES.song ? [ES.song.key, ES.mode, ES.mode === 'copy' && ES.refProfile ? ES.refProfile.name + '|' + ES.refProfile.dur : '', EH.isPhotoMode() ? 'p' : 'v', ES.sources.length, Math.round(ES.sources.reduce((a,s)=>a+(s.removed?0:s.dur||0),0))].join('#') : '';
  const inputSig = () => [ES.song && ES.song.file ? fileFp(ES.song.file) : '', (+ES.secStart || 0).toFixed(2), ES.buf ? ES.buf.duration.toFixed(2) : '', ...EH.clipNames()].join(';');
  return { aiBal, aiCostOf, creditWord, aiHeldBack, planIsFinal, csFade, csOf, csVoiced, clipVoiced, musicOut, hexRgb, lyOn, rateAt, reelLen, partOn, storySentences, avgLook, clip, fileFp, ttsPcm, paceKey, paceSongKey, inputSig };
}
