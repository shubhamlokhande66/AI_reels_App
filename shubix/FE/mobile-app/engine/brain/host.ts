// The studio's flows with no page: a song, its part, the clips, the Reel. What the phone's own engine runs in place of the hidden
// page's engine.ts. It starts from the state the page starts with (initial-state.json, written by scripts/engine-golden.mjs --update),
// and takes what the phone worked out: the song's analysis (SongAnalysis.kt) and each clip's reading (ClipScan.kt).
// @ts-nocheck
import { DEFAULT_LOCKS, needMap } from "../../shared/core/src/lib/plan-locks";
import { chatSize } from "../../shared/core/src/lib/chatSize";
import { templateTexts } from "../../shared/core/src/lib/text-templates";
import { parseDirectorVisualIntent } from "../components/studio/visualIntent";
import { toSlots } from "./pure";
import { brainFromCopy } from "./index";

/** a song's sound as the brain reads it: the part of the Web Audio AudioBuffer it uses */
export function soundOf(channels, sampleRate){
  const length = channels[0].length;
  return { length, sampleRate, numberOfChannels: channels.length, duration: length/sampleRate, getChannelData: (c) => channels[c] };
}

export function createHost(initial, io = {}){
  const brain = brainFromCopy(initial), { ES, values } = brain, analyse = io.analyse;
  if(io.getCtx) values.getCtx = io.getCtx;
  // Shubix AI: its calls, its question, its words and each clip's frames come from the app
  const aiCache = new Map();
  Object.assign(values, { IN_APP: true, aiCache, apiFetch: io.apiFetch, askCredits: io.ask, aiFrames: io.aiFrames, ...(io.stat ? { aiStat: io.stat } : {}), aiStatText: () => '',
    keepAiPick: (fp, ai) => aiCache.set(fp, ai), aiRestore: (src) => { const c = aiCache.get(brain.fpOf(src)); if(c && Array.isArray(c.frames)) src.ai = c; },
    aiSpent: () => io.spent && io.spent(), creditsChanged: () => {}, newId: () => Math.random().toString(36).slice(2, 12) + Date.now().toString(36), openPricing: () => {} });
  ES.aiStopper = new AbortController();
  // what the page keeps outside its state; the page's own drawing and buttons are not here
  Object.assign(values, { ac: new AbortController(), fxCache: new Map(), sfxCache: new Map(), isPhotoMode: () => !!ES.photoMode, clipNames: () => ES.sources.filter(s => !s.removed).map(s => s.name), curTime: () => ES.pos });
  // the chat and the tools: their rules are the brain's, and nothing is drawn here
  const hist = { u: [], r: [], cur: null, cand: '', base: '' }, ready = () => Promise.resolve();
  Object.assign(values, { hist, HIST_MAX: 60, chatSize, toSlots, parseDirectorVisualIntent, aiFreeChats: () => (ES.aiInfo && Number(ES.aiInfo.freeChats)) || 0,
    chatSync: (res) => { if(res && res.chat && typeof res.chat.used === 'number') ES.chatUsed = res.chat.used; }, aiLocked: () => !!ES.aiInfo && ES.aiInfo.planAi === false, aiNeedOn: () => false,
    tasks: { start: (id, kind, title, detail) => io.task && io.task('start', id, title, detail, kind), update: (id, p, detail, title) => io.task && io.task('progress', id, title, detail, undefined, p), done: (id, title) => io.task && io.task('done', id, title), fail: (id, title) => io.task && io.task('fail', id, title), clear: (id) => io.task && io.task('clear', id), has: () => false },
    prepare: ready, prepLayers: ready, revCache: ready, loadFont: ready, notify: (t) => io.tell && io.tell(t), notifyAct: (t) => io.tell && io.tell(t),
    addLayerMedia: async (f) => ({ kind: f.kind, path: f.path, w: f.w, h: f.h, dur: f.kind === 'video' ? f.dur : Infinity, name: f.name }),
    tts: io.speak ? { voices: io.voices || [], speak: io.speak } : null, setCaptions, addTemplate, addTtsAtPlayhead });
  if(!Array.isArray(ES.ttsClips)) ES.ttsClips = [];
  function addTemplate(key, words, at, len, ai){
    const L = ES.buf ? ES.buf.duration : 0, t = Math.max(0, Math.min(Math.max(0, L - 0.6), at ?? (ES.pos || 0))), parts = templateTexts(key, words, t, len); if(!parts.length) return 0;
    for(const q of parts) ES.overlays.push({ id: ++ES.ovSeq, text: q.text, emoji: false, style: q.style, color: q.color, anim: q.anim, out: q.out, loop: q.loop, font: q.font, t0: q.start, t1: Math.min(L, q.end), x: q.x, y: q.y, size: q.size, all: false, tpl: key, ...(ai ? { aiIntent: 'ai' } : {}) });
    ES.ovSel = ES.overlays.length - 1; return parts.length;
  }
  async function addTtsAtPlayhead(text, voice){
    if(!String(text || '').trim() || !voice) throw new Error('Enter the voice text and choose a voice.');
    const c = { id: (ES.ttsClips.reduce((q, x) => Math.max(q, x.id), 0)) + 1, text: String(text).slice(0, 1200), voice, at: ES.edit.length ? Math.max(0, Math.min(ES.pos, (ES.buf ? ES.buf.duration : 0) - 0.5)) : 0 };
    await brain.ttsMake(c, true); if(!c.pcm) throw new Error('The voice could not be generated. Please try another voice or shorter text.');
    ES.ttsClips.push(c); ES.clipMixKey = ''; brain.applyVo();
    return { id: c.id, at: c.at, duration: c.pcm.length/c.sr };
  }
  /** the words of the song: the server hears a 16 kHz copy (a straight line between samples, in place of the page's filters) */
  async function setCaptions(enabled, language, translation){
    ES.capsOn = !!enabled; if(language !== undefined) ES.capLang = String(language || ''); if(translation !== undefined) ES.trTo = String(translation || '');
    if(ES.capsOn && ES.song && io.apiFetch){
      const M = ES.song.mono, sr = ES.song.buf.sampleRate, from = ES.secStart + ES.buf.duration > 179 ? ES.secStart : 0, a = Math.round(from*sr), len = Math.min(M.length - a, Math.round(180*sr)), n = Math.max(1, Math.ceil(len*16000/sr));
      let pk = 0; const y = new Float32Array(n); for(let i=0;i<n;i++){ const p = a + i*sr/16000, k = Math.floor(p), f = p - k, v = (M[k] || 0)*(1 - f) + (M[k+1] || 0)*f; y[i] = v; if(Math.abs(v) > pk) pk = Math.abs(v); }
      const gain = pk > 0 ? 0.9/pk : 1, dv = new DataView(new ArrayBuffer(44 + n*2)), str = (o, x) => { for(let i=0;i<x.length;i++) dv.setUint8(o+i, x.charCodeAt(i)); };
      str(0,'RIFF'); dv.setUint32(4, 36 + n*2, true); str(8,'WAVE'); str(12,'fmt '); dv.setUint32(16,16,true); dv.setUint16(20,1,true); dv.setUint16(22,1,true); dv.setUint32(24,16000,true); dv.setUint32(28,32000,true); dv.setUint16(32,2,true); dv.setUint16(34,16,true); str(36,'data'); dv.setUint32(40,n*2,true);
      for(let i=0;i<n;i++) dv.setInt16(44 + i*2, Math.max(-1, Math.min(1, y[i]*gain))*32767, true);
      const r = await io.apiFetch('/api/studio/transcribe?lang=' + encodeURIComponent(ES.capLang || ''), { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: new Uint8Array(dv.buffer) }), res = await r.json().catch(() => ({}));
      if(!r.ok) throw new Error((res.error && res.error.message) || ('Captions failed (' + r.status + ').'));
      ES.capAll = { from, words: Array.isArray(res.words) ? res.words : [] }; brain.shiftCaptions();
    }
    return { enabled: ES.capsOn, language: ES.capLang || '', translation: ES.trTo || '' };
  }
  // the export's choices and the plan's rules (the page's Export sheet)
  const xq = { res: '1080', fps: 30, nowm: false }, XQ = { '720': { scale: 2/3, bitrate: 6e6 }, '1080': { scale: 1, bitrate: 12e6 }, '4k': { scale: 2, bitrate: 35e6 } };
  let EXR = DEFAULT_LOCKS.export;
  const exRule = () => values.planOpen ? { maxRes: '4k', fps60: true, noWatermark: true } : (EXR[ES.planNow] || EXR.free);
  function lockedUsed(){
    const out = [], add = (cat, key, name, fix) => { if(brain.isLocked(cat, key)) out.push({ need: brain.lockNeed(cat, key), name, fix }); };
    for(const e of ES.edit){
      if(e.tr && e.tr !== 'hard') add('tr', e.tr, e.tr, () => { e.tr = 'dissolve'; });
      if(e.efx && e.efx !== 'none') add('fx', e.efx, brain.FX_NAME[e.efx] || e.efx, () => { e.efx = 'none'; });
      const c = e.cs || {};
      if(c.beauty) add('tool', 'beauty', 'Beauty', () => { delete e.cs.beauty; });
      if(c.stab) add('tool', 'stab', 'Stabilize', () => { delete e.cs.stab; });
      if(c.curve) add('tool', 'curve', 'Speed curve', () => { delete e.cs.curve; e.sp = brain.SPEED.normal; });
    }
    for(const o of ES.overlays){ if(o.font) add('font', o.font, 'Font ' + o.font, () => { o.font = undefined; });
      if(!o.emoji) add('text', o.style, 'Text style ' + o.style, () => { o.style = 'bold'; });
      if(o.track) add('tool', 'track', 'Text follows the person', () => { o.track = false; }); }
    const R = exRule(), rk = { '720': 0, '1080': 1, '4k': 2 };
    if(rk[xq.res] > rk[R.maxRes]) out.push({ need: xq.res === '4k' ? 'pro' : 'creator', name: xq.res + ' quality', fix: () => { xq.res = R.maxRes; } });
    if(xq.fps === 60 && !R.fps60) out.push({ need: 'creator', name: '60 fps', fix: () => { xq.fps = 30; } });
    const seen = new Set(); return out.filter(x => !seen.has(x.name) && seen.add(x.name));
  }
  function exportChoose(a = {}){ if(a.res && XQ[a.res]) xq.res = a.res; if(a.fps === 30 || a.fps === 60) xq.fps = a.fps; if(a.noWatermark !== undefined) xq.nowm = !!a.noWatermark; }
  function exportPlan(){
    return { watermark: !(exRule().noWatermark && xq.nowm), res: xq.res, fps: xq.fps, bitrate: XQ[xq.res].bitrate * (xq.fps > 30 ? 1.5 : 1), scale: XQ[xq.res].scale,
      beats: ES.edit.map(e => e.beatsIn || []),
      follow: ES.layers.map(L => { if(L.follow !== 'face') return null; const path = []; for(let t = L.t0; t < L.t1; t += 0.2){ const f = brain.facePosOnScreen ? brain.facePosOnScreen(t) : null; path.push([t, f ? f.x + (L.followOffsetX || 0) : L.x, f ? f.y + (L.followOffsetY || 0) : L.y]); } return path; }),
      stabs: ES.edit.map(e => { const s = ES.sources[e.src]; if(!(e.cs && e.cs.stab > 0) || !s || !s.samples || s.samples.length < 4) return null; const t = s.samples.map(x => x.t), p = t.map(v => brain.stabAt(s, v) || [0, 0]); return { t, dx: p.map(v => v[0]), dy: p.map(v => v[1]) }; }) };
  }
  function exportOptions(a = {}){
    exportChoose(a);
    const R = exRule(), rk = { '720': 0, '1080': 1, '4k': 2 }, dur = ES.buf ? ES.buf.duration : 0, mb = (XQ[xq.res].bitrate * (xq.fps > 30 ? 1.5 : 1) + 256e3) * dur / 8 / 1e6;
    const res = Object.fromEntries(['720', '1080', '4k'].map(r => [r, { locked: rk[r] > rk[R.maxRes], off: false }]));
    return { res, fps60Locked: !R.fps60, watermarkOff: !!R.noWatermark, size: xq.fps + ' fps · up to ' + (mb < 10 ? mb.toFixed(1) : Math.round(mb)) + ' MB', fileName: (ES.song ? ES.song.name.replace(/\.[^.]+$/, '') : 'reel') + '.mp4', myReels: false, myReelsNote: '', locked: lockedUsed().map(x => ({ name: x.name, need: x.need })) };
  }
  /** what this person's plan has: Shubix AI or not, the credits */
  async function account(){
    const read = (u) => io.apiFetch(u).then(x => x.ok ? x.json() : null).catch(() => null), [locks, credits] = await Promise.all([read('/api/plan-locks'), read('/api/credits')]);
    if(locks && locks.groups){ ES.LOCKS = needMap(locks); EXR = locks.export || EXR; }
    if(credits){ values.planOpen = !credits.enabled && !credits.billing; ES.planNow = credits.enabled && credits.plan ? credits.plan : credits.billing ? 'free' : ES.planNow; }
    values.allOpen = () => !!values.planOpen; values.asFree = () => false;
    const r = await io.apiFetch('/api/studio/rank-shots'); if(!r.ok) return false;
    ES.aiInfo = await r.json(); ES.aiOn = !!(ES.aiInfo && ES.aiInfo.available && ES.aiInfo.planAi !== false);
    return ES.aiOn;
  }
  const aiBusy = () => !!(ES.aiBusy || ES.dirBusy || ES.paceBusy || (ES.aiOn && brain.aiReelOk() && ES.aiGaveUp !== brain.reelIdNow() && ES.edit.length && !(ES.director && ES.director.key === brain.dirKey() && !ES.director.interim) && ES.dirFailedKey !== brain.dirKey()));
  /** Next after the clips: Shubix AI's question, then its work. false: the person closed the question */
  async function runAi(wait = (ms) => new Promise(r => setTimeout(r, ms))){
    if(!ES.aiOn) return true;
    ES.dirFailedKey = ''; ES.paceFailedKey = '';
    if(!brain.aiReelOk()){ const go = await brain.aiGate(true); if(!go) return ES.lowAsked === brain.reelIdNow(); }
    await brain.aiRun();
    for(let i = 0; i < 2400 && aiBusy(); i++) await wait(100);
    return true;
  }
  const sec = { len: 0, auto: true, start: 0 };
  values.sec = sec; values.partBeats = values.partBeats ?? undefined;

  function applyAnalysis(r){
    Object.assign(ES, { period: r.period, hopSec: r.hopSec, rmsF: r.rmsF, onFps: r.onFps, onOff: r.onOff, hitsRaw: r.hitsRaw, hitsStr: r.hitsStr, pfArr: r.pfArr, beats: r.beats, cuts: r.cuts, cutType: r.cutType, cutFx: r.cutFx, peaks: r.peaks, peakS: r.peakS });
    Object.assign(values, { phase: r.phase, onEnv: r.onEnv, barOff: r.barOff });
    ES.songPartsRel = r.parts || [];
    brain.buildPlan();
  }
  function loudness(){
    let s = 0, n = 0; for(let i=0;i<ES.mono.length;i+=64){ const v = ES.mono[i]; if(Math.abs(v) > 0.003){ s += v*v; n++; } }
    const rms = 10*Math.log10(s/Math.max(1, n) + 1e-12); ES.normGain = Math.pow(10, Math.max(-6, Math.min(9, -14 - rms))/20);
  }
  /** the song or its part becomes what the Reel is cut to (the page's useSection) */
  async function useSection(){
    if(!ES.song || !ES.song.r) return;
    const W = ES.song.buf, D = W.duration, sr = W.sampleRate, parts = brain.partsOfSong();
    let r;
    if(!sec.len || sec.len >= D - 0.3){ ES.buf = W; ES.mono = ES.song.mono; ES.secStart = 0; r = brain.applyParts(ES.song.r, parts, 0, D); }
    else {
      const pb = brain.partBeats(sec.len), L = Math.min(pb.len, D);
      let st = sec.auto ? brain.bestPart(L) : brain.snapToBeat(sec.start);
      st = Math.max(0, Math.min(st, D - L)); sec.start = st;
      const a = Math.round(st*sr), n = Math.min(W.length - a, Math.round(L*sr)), fi = Math.round(0.006*sr), fo = Math.round(Math.min(0.35, L*0.05)*sr), channels = [];
      for(let c=0;c<W.numberOfChannels;c++){ const d = W.getChannelData(c).slice(a, a+n); for(let i=0;i<fi;i++) d[i] *= i/fi; for(let i=0;i<fo;i++) d[n-1-i] *= i/fo; channels.push(d); }
      const m = ES.song.mono.slice(a, a+n), given = (ES.song.r.beats || []).filter(t => t >= st - 0.01 && t < st + L - 0.02).map(t => Math.max(0, t - st));
      r = await analyse(m, sr, given.length >= 4 ? { forceBeats: given, forceSource: ES.song.source } : {});
      const W2 = (ES.song.r.cuts || []).map((c,k) => ({ t: c - st, ty: ES.song.r.cutType[k], fx: ES.song.r.cutFx[k] })).filter(c => c.t > -0.15 && c.t < L + 0.15);
      const near = t => { let b = null, bd = 0.12; for(const c of W2){ const d = Math.abs(c.t - t); if(d < bd){ bd = d; b = c; } } return b; };
      r = { ...r, cuts: r.cuts.slice(), cutType: r.cutType.slice(), cutFx: r.cutFx.slice() };
      r.cuts.forEach((t,k) => { const w = near(t); if(w){ r.cutType[k] = w.ty; r.cutFx[k] = w.fx; } else if(r.cutType[k] === 'drop' || r.cutType[k] === 'break'){ r.cutType[k] = 'cut'; r.cutFx[k] = 'Hard cut'; } });
      const d0 = W2.find(c => c.ty === 'drop' && Math.abs(c.t) < 0.12);
      if(d0 && !(r.cuts.length && r.cuts[0] < 0.12)){ r.cuts.unshift(0); r.cutType.unshift('drop'); r.cutFx.unshift(d0.fx); }
      r = brain.applyParts(r, parts, st, L);
      ES.buf = soundOf(channels, sr); ES.mono = m; ES.secStart = st;
    }
    ES.musicKey = ES.song.key + (ES.secStart || ES.buf !== W ? '@' + ES.secStart.toFixed(2) + '+' + ES.buf.duration.toFixed(2) : '');
    applyAnalysis(r); loudness();
    ES.pos = 0; ES.baseBuf = ES.buf; ES.baseNorm = ES.normGain;
    if(ES.sources.length) brain.makeEditNow();
  }
  /** `channels`: the song's sound, one Float32Array each; `mono`: their mix; `r`: its analysis */
  async function setSong(song){
    const { channels, mono, r, name, file, sampleRate } = song;
    const buf = soundOf(channels, sampleRate);
    ES.song = { buf, mono, r, name, file, source: r.beatSource || 'own', key: name + '|' + buf.duration.toFixed(2) };
    ES.buf = buf; ES.mono = mono; ES.secStart = 0;
    await useSection();
  }
  /** a clip read by the phone: { name, dur, w, h, samples, scenes, faces, faceHow } */
  function addClip(clip){
    const shs = clip.samples.map(s => s.sh).sort((a,b) => a - b), src = { removed: false, ...clip, shMed: shs[Math.floor(shs.length/2)] || 1, els: [{}, {}, {}] };
    ES.sources.push(src); return src;
  }
  function makeReel(){ if(ES.buf && ES.sources.length) brain.makeEditNow(); return ES.edit; }
  return { brain, ES, values, sec, setSong, useSection, addClip, makeReel, account, runAi, aiBusy, setCaptions, addTemplate, addTtsAtPlayhead, exportChoose, exportPlan, exportOptions, exportFix: () => lockedUsed().forEach(x => x.fix()), lockedUsed };
}
