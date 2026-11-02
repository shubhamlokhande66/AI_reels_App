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
import { createDirectorPlan, createAutonomousReelPlan, validateAutonomousReelPlan, assessAutonomousRenderQuality, inferAutonomousMood, evaluateKeyframes } from '@shubix/video-engine';
import { chatSize } from '@shubix/core/lib/chatSize';
import { needMap, planRank, PLAN_NAME, DEFAULT_LOCKS } from '@shubix/core/lib/plan-locks';
import { DEFAULT_TEMPLATES, liveTemplates, edgeAt } from '@shubix/core/lib/studio-templates';
import { songAnalysis } from '@shubix/core/engine/studio/song';
import { soundMap, describeCut, sectionsOf, repace } from './soundmap';
import { revealShape, motionBetween, shotMove, shapeInside, SHAPE_REACH } from './refread';
import { Button, Chip } from "./ui";
import { createPreviewProxy, previewProxyPlan, probeVideo, editCopyPlan, convertOnServer, SERVER_CONVERT_MAX_BYTES, hasPicture } from '../../lib/previewProxy';
import { isHidden, whenVisible, isReclaimed, titleProgress, titleDone, askToNotify, notifyDone, holdAwake } from '../../lib/background';
// was the page in the background at any time since `mark` (work that failed then is tried again when the page is back)
let readyToldGen = '', bgSeq = 0; if(typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if(isHidden()) bgSeq++; });
// the file the decoders read: an iPhone 4K HDR 60 fps clip's edit copy (H.264, 1080p, 30 fps) when it has one
const decFile = s => s.edFile || s.file;
import { parseDirectorVisualIntent } from './visualIntent';
import { bootPart } from '../../lib/boot';

export function initStudio(root, deps) {
  const { loadMediabunny, loadAacEncoder = null, beatThis: aiBeats = null, speechProbs = null, personMask = null, findFaces = null, loadRnnoise = null, cloud = null, tts = null } = deps;

const $ = id => root.querySelector('#'+id);
const tasks = createTasks(root);   // what is happening now, always in view (components/studio/tasks.ts)
const ac = new AbortController(), SIG = { signal: ac.signal };
// iPhone / iPad (iPadOS says it is a Mac): Safari there gives a page much less memory, and reloads it when it runs out
const IOS = typeof navigator !== 'undefined' && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
// Browser hints are advisory (Safari/iOS often hides deviceMemory). Prefer a smaller decoder working set
// on iOS and low-memory Android devices; this trades a little parallel decode for fewer export OOMs.
const DEVICE_MEMORY_GB = typeof navigator !== 'undefined' ? Number(navigator.deviceMemory) || 0 : 0;
const CPU_CORES = typeof navigator !== 'undefined' ? Number(navigator.hardwareConcurrency) || 0 : 0;
const LOW_MEMORY_DEVICE = IOS || (DEVICE_MEMORY_GB > 0 && DEVICE_MEMORY_GB <= 4) || (CPU_CORES > 0 && CPU_CORES <= 4);
const EXPORT_DECODER_LIMIT = LOW_MEMORY_DEVICE ? 2 : 4;
const EXPORT_FRAME_POOL = LOW_MEMORY_DEVICE ? 2 : 4;
/* ---- a page the phone reloaded (out of memory) ----
 * iPhone Safari reloads a page that uses too much memory, without a word: the person lands on the first screen, as if the
 * app went back. So the studio keeps a note in this tab (sessionStorage) while it works, removed when the page is left
 * normally. Found at the next start, it means the page died: it is reported (Admin → Errors), and the Reel is reopened
 * from this phone when it was saved (the clips' reading is kept, so the second time is fast). */
const LIFE_KEY = 'brs-life';
let lifeNote = {};
function life(p){ lifeNote = { ...lifeNote, ...p, at: Date.now() }; try{ sessionStorage.setItem(LIFE_KEY, JSON.stringify(lifeNote)); }catch(e){} }
const lifeEnd = () => { try{ sessionStorage.removeItem(LIFE_KEY); }catch(e){} };
let lifeBefore = null;
try{ lifeBefore = JSON.parse(sessionStorage.getItem(LIFE_KEY) || 'null'); }catch(e){}
life({ path: location.pathname + location.search, stage: 'open' });
window.addEventListener('pagehide', lifeEnd, SIG);
ac.signal.addEventListener('abort', lifeEnd);
// (not on the phone app's hidden engine page, app/engine: the phone itself starts it again and says so)
if(lifeBefore && Date.now() - lifeBefore.at < 10*60e3 && location.pathname !== '/engine'){
  try{ window.__shubixReport && window.__shubixReport('crash', 'The phone reloaded the studio at "' + (lifeBefore.stage || '?') + '"' + (lifeBefore.saving ? ' while saving' : '') + (IOS ? ' (iPhone)' : ''), JSON.stringify(lifeBefore)); }catch(e){}
  queueMicrotask(() => {
    if(ac.signal.aborted) return;
    const q = new URLSearchParams(location.search);
    if(WIP && lifeBefore.wip && lifeBefore.path === location.pathname + location.search){ if(lifeBefore.proj) proj = { id: lifeBefore.proj, created: Date.now() }; void wipRestore(lifeBefore.wip); return; }   // still in the Create steps: back there
    if(lifeBefore.proj && !q.get('p')){ location.replace('/editor?p=' + encodeURIComponent(lifeBefore.proj)); return; }
    setTimeout(() => { try{ notify('Your phone ran short of memory and reloaded. Add your clips again: what was read is kept, so it is quick now.', 'err'); }catch(e){} }, 800);
  });
}
/* ---- Create's work so far (the song, the clips in their order, In my order), kept on this phone while the Reel is set up
 * ('w:' in the file store, the note in `life`): a phone that reloads the page (short of memory while its picker was
 * open) puts them back on the clips screen instead of starting over. Cleared at the next normal start. */
const WIP = location.pathname.startsWith('/create');
const wipGet = fp => idb('files', 'readonly', s => s.get('w:' + fp)).catch(() => null);
function wipKeep(f){ if(WIP && f && typeof indexedDB !== 'undefined') idb('files', 'readwrite', s => s.put(f, 'w:' + fileFp(f))).catch(() => {}); }
function wipNote(p){ if(WIP) life({ wip: { ...(lifeNote.wip || {}), clips: [...$('clips').children].map(c => c.__src && fileFp(c.__src.file)).filter(Boolean), seq: seqOn, ...p } }); }
async function wipRestore(w){
  const sf = w.song ? await wipGet(w.song) : null, cf = (await Promise.all((w.clips || []).map(wipGet))).filter(Boolean);
  if(!sf && !cf.length) return;
  if(w.seq) setSeq(true, false);
  if(sf) loadMusic(sf);
  if(cf.length) addVideos(cf, true);
  root.dispatchEvent(new CustomEvent('studio-restored'));
  setTimeout(() => { try{ notify('Your phone reloaded the page: your song and clips are back.'); }catch(e){} }, 800);
}
if(WIP && !(lifeBefore && Date.now() - lifeBefore.at < 10*60e3)) queueMicrotask(() => idb('files', 'readwrite', s => s.getAllKeys()).then(keys => (keys || []).filter(k => String(k).startsWith('w:')).length && idb('files', 'readwrite', s => { keys.filter(k => String(k).startsWith('w:')).forEach(k => s.delete(k)); })).catch(() => {}));
let exporting = false, expCancel = false;   // expCancel: Cancel export was tapped (the fast export stops at its next frame)
// the Shubix watermark on exported Reels (bottom right). Removing it ("Remove Watermark" in the export sheet) is for paid
// plans (and the administrator): wmPaid comes from the server when the sheet opens; until then the watermark stays
let wmOff = false, wmPaid = false;
/* ---- plans: what this person's plan unlocks (lib/plan-locks.ts, changed by the administrator). Kept on the phone for 7
 * days, so a Reel made offline follows the plan seen last; with no plan known yet, the free plan's rules. Billing off
 * (or the administrator): everything is open, except while the administrator looks with View as Free (views.ts): then
 * the free plan's rules. Signed out with billing on: the free plan. A crowned item can be tried in the preview; the
 * export asks. ---- */
let playGen = 0, starting = false;   // Preview's start / stop number (startPlayback, stopAll)
const PLAN_KEY = 'brs-plan';
let planNow = 'free', planOpen = false, LOCKS = needMap(DEFAULT_LOCKS), EXR = DEFAULT_LOCKS.export;
try{ const c = JSON.parse(localStorage.getItem(PLAN_KEY) || 'null'); if(c && Date.now() - c.at < 7*864e5){ planNow = c.plan; planOpen = !!c.open; if(c.need) LOCKS = c.need; if(c.ex) EXR = c.ex; } }catch(e){}
const lockNeed = (cat, key) => LOCKS[cat + ':' + key] || 'free';
const asFree = () => root.classList.contains('admin') && root.classList.contains('asfree');
const allOpen = () => !asFree() && (planOpen || root.classList.contains('planadmin'));
const isLocked = (cat, key) => !allOpen() && planRank(lockNeed(cat, key)) > planRank(asFree() ? 'free' : planNow);
const crown = (cat, key, name) => (isLocked(cat, key) ? '👑 ' : '') + name;
const exRule = () => allOpen() ? { maxRes: '4k', fps60: true, noWatermark: true } : asFree() ? EXR.free : (EXR[planNow] || EXR.free);
function planLoad(first = false){
  // the first read comes from the page's /api/boot answer (no extra requests: Cloudflare); later ones (export) ask again
  const get = (key, url, opts) => (first ? bootPart(key) : Promise.resolve(undefined)).then(v => v !== undefined ? v : fetch(url, opts).then(r => r.ok ? r.json() : null)).catch(() => null);
  Promise.all([get('planLocks', '/api/plan-locks'), get('credits', '/api/credits', { credentials: 'same-origin' })]).then(([L, c]) => {
    if(L && L.groups){ LOCKS = needMap(L); EXR = L.export || EXR; }
    // signed out with billing on (billing: true): the free plan, not everything open
    if(c){ planOpen = !c.enabled && !c.billing; planNow = c.enabled && c.plan ? c.plan : c.billing ? 'free' : planNow; }
    try{ localStorage.setItem(PLAN_KEY, JSON.stringify({ at: Date.now(), plan: planNow, open: planOpen, need: LOCKS, ex: EXR })); }catch(e){}
    root.dispatchEvent(new CustomEvent('brs-plan', { detail: { plan: planNow, open: planOpen, need: LOCKS } }));   // the tool bar's plan tools (views.ts)
    queueMicrotask(() => { try{ planPaint(); if(!$('xsheet').hidden) sheetPaint(); }catch(e){} });
  });
}
planLoad(true);
root.addEventListener('brs-asfree', () => { try{ planPaint(); if(!$('xsheet').hidden) sheetPaint(); }catch(e){} }, SIG);   // View as Free switched (views.ts)
const crownMap = (cat, M) => Object.fromEntries(Object.entries(M).map(([k, v]) => [k, crown(cat, k, v)]));
const wmImg = typeof Image !== 'undefined' ? Object.assign(new Image(), { src: '/brand/shubix-gold-sm.webp' }) : null;
/* ---- a flicker montage (Copy a Reel): a different picture on every frame, from sharp stills of the clips taken once at
 * the Reel's size (preview and export draw the same stills) ---- */
let flickPool = [], flickKey = '', flickBusy = false;
function flickPick(e, local){ const n = flickPool.length, f = Math.floor((e.start + local)*30 + 1e-6), st = n % 5 ? 5 : n % 3 ? 3 : 1; return flickPool[((f*st) % n + n) % n]; }
async function flickBuild(){
  if(flickBusy || !edit.some(e => e.flick) || !sources.length || !out.width) return;
  const W = out.width, H = out.height, key = sources.map(fpOf).join(';') + '|' + W + 'x' + H;
  if(key === flickKey && flickPool.length) return;
  flickBusy = true;
  try{
    const per = Math.max(2, Math.ceil(16/sources.length)), lists = [];
    for(const s of sources){
      // its sharpest moments, at least half a second apart (the clip's own reading: sharpness per sample)
      const smp = (s.samples || []).filter(x => x.t > 0.2 && x.t < s.dur - 0.3).slice().sort((a,b) => (b.sh||0) - (a.sh||0)), ts = [];
      for(const x of smp){ if(ts.length >= per) break; if(ts.every(t => Math.abs(t - x.t) >= 0.5)) ts.push(x.t); }
      while(ts.length < per) ts.push(s.dur*(0.15 + 0.7*ts.length/Math.max(1, per-1)));
      const v = makeVideo(s.url), got = [];
      try{ await waitEv(v, 'loadeddata', 8000);
        for(const t of ts.sort((a,b)=>a-b)){ v.currentTime = Math.min(Math.max(0.05, t), s.dur - 0.1); try{ await waitEv(v, 'seeked', 3000); }catch(err){ continue; }
          const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'), vw = v.videoWidth || W, vh = v.videoHeight || H, r = Math.max(W/vw, H/vh);
          g.drawImage(v, (W - vw*r)/2, (H - vh*r)/2, vw*r, vh*r); got.push(c); } }
      catch(err){ /* this clip gives none */ }
      v.removeAttribute('src'); v.load(); lists.push(got);
    }
    const pool = []; for(let k=0; lists.some(l => k < l.length); k++) lists.forEach(l => { if(l[k]) pool.push(l[k]); });   // the clips in turn
    flickPool = pool; flickKey = key; redraw();
  } finally { flickBusy = false; }
}
let blackC = null;
const blackPic = () => { if(!blackC){ blackC = document.createElement('canvas'); blackC.width = 16; blackC.height = 16; const g = blackC.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 16, 16); } return blackC; };
const texOf = (e, local) => e.black ? blackPic() : e.flick && flickPool.length ? flickPick(e, local || 0) : exporting ? (e.fc || e.fcLast) : e.rc && e.cs && e.cs.rev && local !== undefined ? revFrame(e, local) : e.el;
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
function addMark(t){ if(!buf || !edit.length) return false; remakeOk(); userMarks.push(+(secStart + t).toFixed(3)); beats = withMarks(beats, buf.duration); makeEdit(); notify('Beat added at ' + t.toFixed(1) + ' s: a cut can land there now'); return true; }
function clearMarks(){ if(!userMarks.length) return false; remakeOk(); const ts = userMarks.map(m => m - secStart); userMarks = []; beats = beats.filter(b => !ts.some(t => Math.abs(t - b) < 0.005)); makeEdit(); notify('Your beats are cleared'); return true; }
// On an iPhone the page's sound is muted by the ring/silent switch unless it says it is playing media (Audio Session API)
function getCtx(){ if(!ctx){ try{ if(navigator.audioSession) navigator.audioSession.type = 'playback'; }catch(e){} ctx = new (window.AudioContext||window.webkitAudioContext)(); } return ctx; }
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const TCOL = {drop:'--drop', hit:'--hit', cut:'--cut', break:'--break'};
const TNAME = {drop:'DROP', hit:'HIT', cut:'CUT', break:'BREAK'};

/* =============== MUSIC ENGINE: songAnalysis, shared with the phone (@shubix/core/engine/studio/song) =============== */
function analyseInWorker(m, sr, opts){
  return new Promise((resolve, reject) => {
    // beats the creator tapped in are the page's: with any, the song is analysed on the page (they become its beats)
    if(userMarks.length) return reject(new Error('own beats: analysed on the page'));
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
let refReading = false, refWaiters = [];   // a Reel to copy is being read: the AI waits for it (its pace and plan are for the copy)
// Copy a Reel: clips added while the Reel to copy is read wait for it (one heavy job at a time on a phone), and no Reel is
// made meanwhile (it would be an ordinary Reel, replaced moments later by the copy)
const refDone = () => refReading ? new Promise(r => refWaiters.push(r)) : Promise.resolve();
let tplKind = '';   // the template's kind of Reel (car, wedding...): with Shubix AI its trend leads the AI's guide
// Style: Auto follows the music as analysed; Smooth keeps fewer, longer shots on the strong beats; Fast cuts on every beat.
// (a copied Reel keeps its short shots: no flash-cut merging; another song puts them on its beats, copyPlan)
function adaptPlan(){ return copyTimed() ? copyPlanTimed() : mode === 'copy' && refProfile ? endWell(adaptPlan0()) : beatEdit(endWell(noFlashCuts(adaptPlan0()))); }
/* ---- the beat edit of car, bike and sports Reels (measured on such Reels: cuts land on the drum hits, 88% of them) ----
 * Where the song's strong drum hits are dense (5 a second or more, for 2 s or longer: a fast verse, a dhol or snare roll,
 * a build-up) a cut on every hit, never closer than a third of a beat; where it stays loud with no strong hits for 1.5 s
 * or more and the drums come back right after (a riser, a held note before the drop) a flicker montage (a different still
 * of the clips on every frame, at most 3 s); elsewhere the plan as it is. "Strong": at least the song's median hit (all of
 * a busy mix's onsets are dense everywhere). Smooth keeps its calm; a copied Reel keeps its own edit. */
// ai: the AI's pace (its sections with "hits" and "flicker" are used as they are, in any style; nothing else is added)
function beatEdit(p, ai){
  if(!(mode === 'auto' || mode === 'fast' || ai) || mode === 'copy' || !buf || !rmsF || !hopSec || !hitsRaw || hitsRaw.length < 8 || p.length < 2 || !(period > 0)) return p;
  const dur = buf.duration, H = hitsRaw.filter(t => t > 0.1 && t < dur - 0.15), W = 1, step = 0.25;
  const ss = (hitsStr || []).slice().sort((a,b)=>a-b), sMed = ss.length ? ss[ss.length>>1] : 0;
  const HS = hitsRaw.filter((t, i) => (hitsStr[i] || 0) >= sMed && t > 0.1 && t < dur - 0.15);   // the strong hits
  const dbAt = (a, b) => { const fa = Math.max(0, Math.floor(a/hopSec)), fb = Math.min(rmsF.length, Math.ceil(b/hopSec)); let s2 = 0; for(let f=fa; f<fb; f++) s2 += rmsF[f]*rmsF[f]; return 10*Math.log10(s2/Math.max(1, fb-fa) + 1e-10); };
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
  const gap = Math.max(0.13, period/3);
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
    const keepStart = s.type === 'drop' || s.type === 'break' || isPartStart(s.start + 1/30);
    if(keepStart && p[i+1] && !(p[i+1].type === 'drop' || p[i+1].type === 'break' || isPartStart(p[i+1].start + 1/30))){ s.end = p[i+1].end; p.splice(i+1, 1); i--; }
    else if(!keepStart){ p[i-1].end = s.end; p.splice(i, 1); i--; } }
  return p;
}
function adaptPlan0(){
  if(mode==='copy' && refProfile) return copyPlan();
  if(mode==='smooth'){
    const bar = Math.min(3, Math.max(1.4, period*4)), outP = [];
    basePlan.forEach(s=>{ const last = outP[outP.length-1], minLen = outP.length === 1 ? Math.min(bar, 2.6) : partAt(s.start) === 'drop' ? (bar > 2.2 ? bar/2 : bar) : Math.min(4, 2*bar);
      const keep = !last || s.type==='drop' || s.type==='break' || isPartStart(s.start) || (s.start-last.start) >= minLen - 0.1 || (s.end-last.start) > (partAt(s.start) === 'drop' ? 4.5 : 5.2);
      if(keep) outP.push({...s}); else last.end = s.end; });
    return outP;
  }
  if(mode==='fast'){
    const outP = [];
    basePlan.forEach(s=>{
      const G = gridOf(buf.duration), one = period < 0.4 ? 2*period - 0.02 : 0.3, bs = G.map(b=>b-1/30).filter(b=>b>s.start+0.3 && b<s.end-0.3);
      let a = s.start, first = true;
      for(const b of bs){ const pt = partAt(b), step = pt === 'drop' || pt === 'up' ? one : Math.max(one, 1.9*period);
        if(b-a >= step && s.end-b >= Math.min(step, 0.6)){ outP.push({...s, start:a, end:b, type:first?s.type:'cut', fx:first?s.fx:'Hard cut'}); a=b; first=false; } }
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
// Choose song shows a spinner while the song is read and its beats found (a long song or a video takes seconds; the
// Create flow hides the status line on phones, so the button itself says it is working)
function songBusy(on){ const b = $('mpick'); b.classList.toggle('busy', on); b.setAttribute('aria-busy', String(on)); b.disabled = on;
  b.querySelector('span').textContent = on ? 'Reading the song…' : 'Choose song'; $('rlist').classList.toggle('busy', on); }
async function loadMusic(file, cached = null){
  remakeOk(); wipKeep(file); wipNote({ song: fileFp(file) });
  const name = file.name, token = ++musicToken;   // a newer song wins over anything still running for an older one
  stopAll(); songBusy(true);
  $('s1st').textContent = 'Analysing the song… (you can keep using the page)'; $('mname').textContent = name; $('s1').classList.remove('done');
  tasks.start('song', 'music', 'Adding your song', 'Reading the sound of ' + name.replace(/\.[^.]+$/, ''));
  let whole;
  try{ whole = await decodeAnyAudio(file); }
  catch(e){ if(token !== musicToken) return; songBusy(false); console.warn('song not readable', e); tasks.fail('song', 'This file has no sound we can read. Try an MP3, M4A or WAV.'); $('s1st').textContent = 'Could not read the sound of this file. Use MP3, M4A, WAV or a video with sound. (Songs in the Apple Music app are protected and cannot be opened by websites.)'; return; }
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
  songBusy(false); $('s1st').textContent = 'Ready'; $('s1').classList.add('done'); $('s2').classList.remove('locked'); $('lenrow').hidden = kind === 'talk';
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
function snapToBeat(t){ const bt = song.r.beats || []; if(bt.length < 8) return Math.max(0, t); let b = bt[0]; for(const x of bt) if(Math.abs(x - t) < Math.abs(b - t)) b = x; return b; }
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
// which part of the song a moment (in the Reel's time) is in: intro, up (build), drop, break
let songPartsRel = [];
function partAt(t){ let ty = 'intro'; for(const x of songPartsRel){ if(x.t <= t + 0.02) ty = x.ty; else break; } return ty; }
const isPartStart = t => songPartsRel.some(x => Math.abs(x.t - t) < 0.08);
function gridOf(dur){ const g = []; if(beats.length < 8 || !period) return beats.slice();
  for(let t=beats[0]-period; t>0.05; t-=period) g.unshift(t); g.push(...beats); for(let t=beats[beats.length-1]+period; t<dur-0.05; t+=period) g.push(t); return g; }
// the last shot is a whole one (a cut just before the end looks like a mistake)
// a cut wherever a part of the song starts (the AI's pace keeps drops and breaks; a build-up's start too)
function withPartCuts(p){
  songPartsRel.forEach(x => { const t = x.t - 1/30; if(t < 0.3) return;
    if(p.some(s => Math.abs(s.start - t) < 0.1)) return;
    const k = p.findIndex(s => s.start < t && s.end > t); if(k < 0) return;
    const s = p[k], T = x.ty === 'drop' || x.ty === 'break' ? x.ty : 'cut';
    p.splice(k + 1, 0, { ...s, start: t, type: T, fx: T === 'drop' ? 'Best shot · flash + zoom-in' : T === 'break' ? 'Slow-mo / freeze / text' : 'Hard cut' }); s.end = t; });
  return p;
}
function endWell(p){ while(p.length > 1 && p[p.length-1].end - p[p.length-1].start < 1){ const l = p.pop(); p[p.length-1].end = l.end; } return p; }
function partsOfSong(){
  if(song && song.r && song.partsOf !== song.r){ try{ song.parts = songParts(song.mono, song.buf.sampleRate, song.r.beats); }catch(e){ console.warn('song parts', e); song.parts = []; }
    song.partsOf = song.r; }
  return song ? song.parts : [];
}
async function useSection(token = musicToken){
  if(!song || !song.r) return;
  footCheckSoon();   // the Reel's length may change (another song, length, part): enough clips?
  if(kind === 'talk'){ drawMusic(); if(sources.length && !recording && !(talk && talk.songKey === song.key)) buildTalk(); return; }
  const run = ++secBusy, W = song.buf, D = W.duration, sr = W.sampleRate;
  let r;
  const parts = partsOfSong();
  if(!sec.len || sec.len >= D - 0.3){
    buf = W; mono = song.mono; secStart = 0; r = applyParts(song.r, parts, 0, D);
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
    r = applyParts(r, parts, st, L);
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
  remakeOk();
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
$('sauto').addEventListener('click', () => { remakeOk(); sec.auto = true; if(playing) stopAll(); useSection(); }, SIG);
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
    remakeOk(); sec.start = dragStart; sec.auto = false; dragStart = null; const st = sec.start; useSection(); playPart(st, st); };
  cv.addEventListener('pointerup', end, SIG); cv.addEventListener('pointercancel', end, SIG); }
let beatInfo = { source: 'own', note: '' };
function applyAnalysis(r){
  ({ period, phase, hopSec, rmsF, onEnv, onFps, onOff, hitsRaw, hitsStr, pfArr, beats, cuts, cutType, cutFx, peaks, peakS, barOff } = r);
  songPartsRel = r.parts || [];
  buildPlan(); drawMusic();
  $('mbpm').textContent = (60/period).toFixed(0);
  $('mclips').textContent = plan.length; $('mdrop').textContent = plan.filter(s=>s.type==='drop').length; $('mbreak').textContent = plan.filter(s=>s.type==='break').length;
}
// Second opinion on the beats: Beat This! (a neural network trained on thousands of hand-annotated songs) runs on this
// device in the background; the analysis then keeps whichever beats land on stronger hits with a steadier pulse (each
// tracker misses different songs) and the edit follows. The page stays usable; the first edit never waits for it.
let beatsBusy = false;
// An iPhone that reloaded while Shubix checked the beats (out of memory) does not run it again for a week: the page's own
// beats are good, and the person must be able to make the Reel at all
const AI_BEATS_OFF = 'brs-ai-beats-off';
if(IOS && lifeBefore && lifeBefore.stage === 'checking beats' && Date.now() - lifeBefore.at < 10*60e3) try{ localStorage.setItem(AI_BEATS_OFF, String(Date.now())); }catch(e){}
function aiBeatsOff(){ try{ return Date.now() - (+localStorage.getItem(AI_BEATS_OFF) || 0) < 7*864e5; }catch(e){ return false; } }
async function checkBeatsWithAi(token){
  if(!aiBeats || !song) return;
  if(IOS && aiBeatsOff()){ beatInfo = { source: 'own', note: 'off on this phone (it ran short of memory before)' }; return; }
  beatsBusy = true; life({ stage: 'checking beats' });
  try{ await checkBeatsInner(token); } finally { beatsBusy = false; if(lifeNote.stage === 'checking beats') life({ stage: 'song ready' }); }
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
function makeVideo(url){ const v=document.createElement('video'); v.muted=true; v.defaultMuted=true; v.playsInline=true; v.setAttribute('playsinline',''); v.setAttribute('webkit-playsinline',''); v.setAttribute('muted',''); v.preload='auto'; v.crossOrigin='anonymous'; if(url) v.src=url; return v; }
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
    const input = new mb.Input({ source: new mb.BlobSource(decFile(src)), formats: mb.ALL_FORMATS });
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

async function scanMotion(src, onProgress, faces){
  // read the clip's frames (see clipReader) and compare small frames: how much moves, where it moves, how bright.
  // faces (a faceScanner): its frames come from this same pass, so the clip is decoded once (an iPhone)
  const rd = await clipReader(src, faces ? 480 : 256); if(src.readMs) src.readMs.how = rd.fast ? 'webcodecs' : 'seek';
  const c = document.createElement('canvas'); c.width=SW; c.height=SH; const g = c.getContext('2d', {willReadFrequently:true});
  const c2 = document.createElement('canvas'); c2.width=128; c2.height=72; const g2 = c2.getContext('2d', {willReadFrequently:true});
  let prev = null; const out = [], hists = [], lums = [];
  const strip = [], STRIP_H = 72; let stripLast = -9;
  const grab = (v, t) => {
    if(t - stripLast >= Math.max(0.5, src.dur/60)){ stripLast = t;
      try{ const vw = v.videoWidth || v.displayWidth || v.width || 9, vh = v.videoHeight || v.displayHeight || v.height || 16, sc = document.createElement('canvas');
        sc.height = STRIP_H; sc.width = Math.max(24, Math.round(STRIP_H*vw/vh)); sc.getContext('2d').drawImage(v, 0, 0, sc.width, sc.height); strip.push({ t, c: sc }); }catch(e){} }
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
  const step = Math.max(1/30, Math.min(12, Math.max(2, src.dur/6))/60);
  const ts = [];
  for(let t=0; t<src.dur-0.02; t+=step) ts.push(+t.toFixed(4));
  try{
    let k = 0;
    let fi = 0; const half = step/2;
    for await (const img of rd.frames(ts)){ const t = ts[k++]; if(img) grab(img, t); if(k % 8 === 0){ onProgress(t/src.dur); await new Promise(r=>setTimeout(r,0)); }
      // the faces' times this frame stands for (within half a step: at most 0.1 s off)
      if(faces && img) while(fi < faces.ts.length && faces.ts[fi] <= t + half){ if(faces.ts[fi] >= t - half && !(await faces.each(img, faces.ts[fi]))){ faces = null; break; } fi++; }
    }
    if(faces) faces.done();
  }catch(err){ console.warn('reading frames failed', err); }
  if(!out.length) { rd.close(); throw new Error('no frames could be read'); }
  strip.sort((a, b) => a.t - b.t); src.strip = strip;
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
// faces: up to 2.5 looks a second (at most about 60 per clip), then cleaned up over time (see trackFaces). faceScanner
// gives the times it wants and takes their frames from any reader: its own (scanFaces), or the motion pass on an
// iPhone (one decode of the clip for both)
function faceScanner(src){
  src.faces = [];
  const vj = window.tracking && tracking.ViolaJones && tracking.ViolaJones.classifiers && tracking.ViolaJones.classifiers.face;
  let blaze = !!findFaces; src.faceHow = blaze ? 'blazeface' : 'viola-jones';
  if(!blaze && !vj) return null;
  const w = 240, h = Math.round(240*src.h/src.w), c = document.createElement('canvas'); c.width=w; c.height=h;
  const g = c.getContext('2d', {willReadFrequently:true});
  const step = Math.min(1.5, Math.max(0.4, src.dur/60)), raw = [], ts = [];
  for(let tt=0.1; tt<src.dur; tt+=step) ts.push(tt);
  let off = false;
  return { ts,
    // false: faces cannot be found here any more
    async each(v, tt){
      if(off) return false;
      if(blaze){
        try{ raw.push({t:tt, rects: await blazeFaces(v, src.w, src.h)}); return true; }
        catch(err){ console.info('BlazeFace not used:', err && err.message); blaze = false; src.faceHow = 'viola-jones'; if(!vj){ off = true; return false; } }
      }
      g.drawImage(v,0,0,w,h); const px = g.getImageData(0,0,w,h).data;
      let rects = [];
      try{ rects = tracking.ViolaJones.detect(px, w, h, 1.0, 1.25, 1.5, 0.2, tracking.ViolaJones.classifiers.face) || []; }catch(e){}
      raw.push({t:tt, rects: rects.filter(r=>r.width > w*0.06).map(r=>({x:(r.x+r.width/2)/w, y:(r.y+r.height/2)/h, s:r.width/w}))});
      return true;
    },
    done(){ src.faces = trackFaces(raw); } };
}
async function scanFaces(src, onProgress){
  const fs = faceScanner(src); if(!fs) return;
  const rd = await clipReader(src, 480), ts = fs.ts;
  let k = 0;
  try{ for await (const v of rd.frames(ts)){ const tt = ts[k++]; if(!v) continue;
    if(!(await fs.each(v, tt))) break;
    onProgress(tt/src.dur);
    await new Promise(r=>setTimeout(r,0));
  } }catch(err){ console.warn('reading frames for faces failed', err); } finally { rd.close(); }
  fs.done();
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
function addVideos(files, restored = false){
  const list = [...files].filter(f=>f.type.startsWith('video/') || /\.(mp4|mov|webm|m4v|3gp|mkv)$/i.test(f.name));
  if(!list.length){ $('s2st').textContent = 'That is not a video. Choose MP4, MOV or WEBM.'; return; }
  if(playing){ pos = curTime(); stopAll(); }   // free the computer so reading is fast
  const jobs = list.map(f=>makeCard(f));
  if(!pending){ batchN = 0; batchDone = 0; }
  batchN += jobs.length; pending += jobs.length; updateQ();
  tasks.start('clips', 'clips', 'Reading your clips', 'Finding the best moments in ' + batchN + ' clip' + (batchN > 1 ? 's' : ''));
  jobs.forEach(job=>{ addQueue = addQueue.then(()=>readVideo(job)).catch(()=>{}).then(()=>{ pending--; batchDone++; updateQ(); }); });
  addQueue = addQueue.then(()=>{ if(!pending) finishAdding(); });
  list.forEach(wipKeep);
  if(jobs.length > 1 && !restored && location.pathname !== '/engine') askOrder(jobs.map(j => j.card));   // (the phone app sends its clips in the order tapped)
}
/* ---- the clips' order: browsers give the chosen files in their own order (phones often newest first, a computer often
 * the last clicked first), so each card shows its number, ↑ plays it earlier and Reverse order turns the list round.
 * "In my order" plays them in this order (sources); the Reel is made again. */
function renumber(){
  const cards = [...$('clips').children];
  wipNote();
  if(ordering) return;   // the numbers are the taps meanwhile
  cards.forEach((c, i) => { const n = c.querySelector('.cnum'), u = c.querySelector('.cup'); if(n){ n.textContent = String(i + 1); n.classList.remove('bg-neutral-900', 'ring-2', 'ring-white'); n.classList.add('bg-accent'); } if(u) u.hidden = i === 0; });
  $('crev').hidden = cards.length < 2;
}
// The clips just added, each with an empty circle: a tap numbers it (1, 2, 3…, a second tap takes the number back);
// when every one has its number they go in that order (after the clips already there). Skip keeps the browser's order.
let ordering = null;
function askOrder(cards){
  ordering = { cards, taps: [] }; $('corder').hidden = false; $('crev').hidden = true;
  cards.forEach(c => { c.classList.add('cursor-pointer'); const n = c.querySelector('.cnum'); n.textContent = ''; n.classList.remove('bg-accent'); n.classList.add('bg-neutral-900', 'ring-2', 'ring-white'); c.querySelector('.cup').hidden = true; });
}
function endOrder(apply){
  const o = ordering; if(!o) return; ordering = null; $('corder').hidden = true;
  o.cards.forEach(c => c.classList.remove('cursor-pointer'));
  if(apply){ const box = $('clips'), rest = o.cards.filter(c => !o.taps.includes(c)); [...o.taps, ...rest].forEach(c => c.isConnected && box.appendChild(c)); }
  footCheckSoon();
  if(pending) renumber(); else reorderClips();   // still reading: the clips are read in turn and keep this order (finishAdding makes the Reel)
}
$('clips').addEventListener('click', ev => {
  const o = ordering, card = ev.target.closest('.clip'); if(!o || !card || !o.cards.includes(card) || ev.target.closest('.del')) return;
  ev.preventDefault(); ev.stopPropagation();
  const k = o.taps.indexOf(card); if(k >= 0) o.taps.splice(k, 1); else o.taps.push(card);
  o.cards.forEach(c => { const n = c.querySelector('.cnum'), i = o.taps.indexOf(c); n.textContent = i >= 0 ? String(i + 1) : ''; n.classList.toggle('bg-accent', i >= 0); n.classList.toggle('bg-neutral-900', i < 0); });
  const live = o.cards.filter(c => c.isConnected); if(live.every(c => o.taps.includes(c))) endOrder(true);
}, true);
$('corderskip').addEventListener('click', () => endOrder(false));
function reorderClips(){
  if(ordering) return;
  const order = [...$('clips').children].map(c => c.__src).filter(s => sources.includes(s));
  sources.splice(0, sources.length, ...order); renumber();
  remakeOk(); if(buf && sources.length && kind !== 'talk') makeEdit();
}
$('crev').addEventListener('click', () => { if(pending || recording) return; const box = $('clips'); [...box.children].reverse().forEach(c => box.appendChild(c)); reorderClips(); });
function updateQ(){ $('qinfo').textContent = pending ? pending + ' clips left to read…' : ''; $('s2st').textContent = pending ? 'Reading clips…' : (sources.length + ' clips ready'); }
function setClipStatus(src, status, detail){
  if(!src || !src.card) return;
  src.status=status;
  const el=src.card.querySelector('.clip-status');
  if(!el) return;
  const ready=status==='ready', failed=status==='failed';
  el.classList.toggle('is-ready',ready);
  el.classList.toggle('is-failed',failed);
  el.classList.toggle('is-reading',!ready&&!failed);
  el.querySelector('.clip-status-mark').textContent=ready?'✓':failed?'!':'…';
  el.title=detail || (ready?'Video analysed and ready':failed?'Could not read this video':'Analysing video');
  el.setAttribute('aria-label',el.title);
}
function makeCard(f){
  const url = URL.createObjectURL(f);
  const card = document.createElement('div'); card.className='clip';
  card.innerHTML = `<canvas class="th"></canvas><span class="cnum absolute left-2 top-2 z-3 grid h-7 min-w-7 place-items-center rounded-full bg-accent px-2 text-[11px] font-bold text-black"></span><button type="button" class="cup absolute left-11 top-2 z-3 grid size-7 place-items-center rounded-full bg-black/65 text-[13px] leading-none text-white" title="Play this clip earlier" aria-label="Play this clip earlier">↑</button><span class="clip-status is-reading" role="status" aria-label="Video is being analysed" title="Analysing video"><span class="clip-status-mark">…</span></span><button class="del" title="Remove video" aria-label="Remove video">×</button><div class="meta"><div class="nm"></div><div class="dd">Waiting to analyse…</div><canvas></canvas></div>`;
  card.querySelector('.nm').textContent = f.name; $('clips').appendChild(card); renumber();
  const src = {name:f.name, file:f, url, card, spark: card.querySelector('.meta canvas'), removed:false};
  card.__src = src; setClipStatus(src,'reading'); card.querySelector('.del').addEventListener('click', ()=>removeVideo(src));
  card.querySelector('.cup').addEventListener('click', ()=>{ const prev = card.previousElementSibling; if(prev && !pending && !recording){ prev.before(card); reorderClips(); } });
  return src;
}
/* ---- what was found in a clip, kept on this phone next to the clip's file ----
 * Reading a clip (action, scene changes, faces; where people speak) takes the longest part of making a Reel, and gives the
 * same answer for the same file every time. So it is kept in the saved Reels' file store ("a:"/"v:" + the file's
 * fingerprint): opening a draft again, or adding the same clip again, uses it at once. SCAN_V: raise it when the reading
 * changes so old results are read again. They go with their clip's file (lib/drafts.ts deleteDraft; keptSweep for leftovers). */
const SCAN_V = 1;
async function keptGet(pre, f){ if(typeof indexedDB === 'undefined' || !f) return null; try{ return await idb('files', 'readonly', s => s.get(pre + fileFp(f))) || null; }catch(e){ return null; } }
function keptPut(pre, f, val){ if(typeof indexedDB === 'undefined' || !f) return Promise.resolve(); return idb('files', 'readwrite', s => s.put(val, pre + fileFp(f))).catch(e => { console.info('clip reading not kept:', e && e.message); }); }
async function scanGet(src){
  const k = await keptGet('a:', src.file);
  return k && k.v === SCAN_V && Math.abs((k.dur || 0) - src.dur) < 0.05 && k.w === src.w && Array.isArray(k.samples) && k.samples.length ? k : null;
}
function scanPut(src){ keptPut('a:', src.file, { v: SCAN_V, dur: src.dur, w: src.w, scenes: src.scenes || [], samples: src.samples, faces: src.faces || [], faceHow: src.faceHow }); }
// results whose file is gone (its Reels deleted from Fast Studio or from My Reels): removed now and then
async function keptSweep(){
  try{ const keys = await idb('files', 'readonly', s => s.getAllKeys()) || [], have = new Set(keys.filter(k => String(k).startsWith('f:')).map(k => String(k).slice(2)));
    const old = keys.filter(k => /^[avp]:/.test(String(k)) && !have.has(String(k).slice(2)));
    if(old.length) await idb('files', 'readwrite', s => { old.forEach(k => s.delete(k)); });
  }catch(e){}
}
let previewBatchUi = null, previewBatchCompressed = 0, previewBatchDetected = 0;
function previewBatchShow(src, message, progress){
  if(!previewBatchUi){
    const overlay=document.createElement('div'); overlay.className='askbg'; overlay.setAttribute('role','dialog'); overlay.setAttribute('aria-modal','true');
    overlay.innerHTML='<div class="ask" style="max-width:420px;width:calc(100% - 32px)"><p style="font-weight:700;margin-bottom:8px">Preparing your videos for smooth editing</p><p data-proxy-detail style="font-size:13px;opacity:.8;margin:0 0 14px"></p><div style="height:8px;border-radius:99px;background:rgba(128,128,128,.25);overflow:hidden"><div data-proxy-bar style="height:100%;width:0%;background:var(--accent,#d4af37);transition:width .15s"></div></div><p data-proxy-percent style="font-size:12px;text-align:right;margin:7px 0 0"></p></div>';
    root.appendChild(overlay); previewBatchUi={overlay,detail:overlay.querySelector('[data-proxy-detail]'),bar:overlay.querySelector('[data-proxy-bar]'),percent:overlay.querySelector('[data-proxy-percent]')};
  }
  previewBatchUi.detail.textContent=message;
  if(progress!==undefined){const n=Math.max(0,Math.min(100,Math.round(progress*100)));previewBatchUi.bar.style.width=n+'%';previewBatchUi.percent.textContent=n+'%';}
}
function previewBatchClose(){
  if(previewBatchUi){previewBatchUi.overlay.remove();previewBatchUi=null;}
  previewBatchCompressed=0; previewBatchDetected=0;
}
function clipBytes(bytes){
  if(!Number.isFinite(bytes)) return '—';
  if(bytes < 1024*1024) return (bytes/1024).toFixed(0)+' KB';
  return (bytes/1024/1024).toFixed(2)+' MB';
}
function updateClipHoverInfo(src){
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
/* ---- clips from any camera: an edit copy for what plays badly or not at all here (lib/previewProxy.ts) ----
 * iPhone 4K HDR / Cinematic / slo-mo, Android 60 fps / 8K / HDR10+, GoPro, drones, mirrorless 10-bit 4:2:2, screen
 * recordings (a varying frame rate): an H.264 1080p 30 fps SDR copy, made on this device, read by the preview, the
 * clip reading and the export. What this browser cannot decode at all (ProRes, 4:2:2, old codecs) is converted by
 * Shubix (signed in, up to 95 MB). Kept with the draft on this device (v2), so a reopened Reel does not convert again. */
function whatClip(f){
  const k = [];
  if(f){ const ls = Math.max(f.width||0, f.height||0); if(ls >= 7000) k.push('8K'); else if(ls >= 3800) k.push('4K'); else if(ls > 2600) k.push(Math.round(ls/1000*10)/10 + 'K');
    if(f.hdr) k.push('HDR'); if(f.tenBit && !f.hdr) k.push('10-bit'); if(f.chroma422) k.push('camera 4:2:2');
    if(f.fps > 31) k.push(Math.round(f.fps) + ' fps'); if(f.vfr) k.push('changing frame rate'); }
  return k.length ? k.join(' · ') : 'this format';
}
function setEditCopy(src, blob, w, h, how){
  src.edFile = blob; src.edW = w; src.edH = h; src.edAudio = how === 'server' || !/webm/.test(blob.type) || how === 'decoder';
  const old = src.url; src.url = URL.createObjectURL(blob); try{ if(old && old !== src.url && src.previewProxy) URL.revokeObjectURL(old); }catch(e){}
  src.previewProxy = true; src.proxySize = blob.size; src.proxyW = w; src.proxyH = h; src.proxyMime = blob.type;
  src.proxyStatus = how === 'server' ? 'Converted by Shubix' : 'Success';
  src.proxyReason = 'Smooth copy for the preview and the export (' + w + ' × ' + h + ', 30 fps, normal colours).';
  updateClipHoverInfo(src);
}
async function makeEditCopy(src, dd, facts, plan, playable){
  const label = whatClip(facts);
  previewBatchDetected++;
  previewBatchShow(src, label[0].toUpperCase() + label.slice(1) + ' video found. Making a smooth copy so it plays without lag…', 0);
  life({ stage: 'making an edit copy', size: Math.round(src.file.size/1e6) + ' MB', res: (facts && facts.width) + 'x' + (facts && facts.height), what: label });
  src.proxyStatus = 'Making a smooth copy…'; updateClipHoverInfo(src);
  const show = (p, word) => { const n = Math.max(0, Math.min(100, Math.round(p*100))); dd.textContent = word + ' ' + n + '%'; titleProgress('copy', 'Preparing your clips', p); previewBatchShow(src, word[0].toUpperCase() + word.slice(1) + ' ' + src.name + '…', p); };
  // 1. on this device: WebCodecs, else the browser's own player feeding an encoder
  let r = null;
  if(plan && (playable || (facts && facts.decodes))){
    // tried twice when the page went to the background meanwhile (the browser may take the decoder back there)
    for(let k = 0; k < 2 && !r && !src.removed; k++){
      const seq = bgSeq;
      try{ r = await createPreviewProxy(src.file, p => show(p, 'making a smooth copy…'), plan); }catch(e){ r = null; console.info('edit copy on this device failed', e); }
      if(r || (bgSeq === seq && !isHidden())) break;
      dd.textContent = 'waiting for you to come back…'; await whenVisible();
    }
  }
  if(src.removed) return false;
  if(r && r.blob && r.blob.size){
    setEditCopy(src, r.blob, r.plan.width, r.plan.height, facts && facts.decodes ? 'decoder' : 'player');
  } else {
    // 2. Shubix converts it (what this browser cannot decode)
    if(src.file.size > SERVER_CONVERT_MAX_BYTES){ src.proxyStatus = 'Could not convert here'; src.edFail = 'big'; updateClipHoverInfo(src); titleDone('copy'); return false; }
    try{
      let blob = null;
      for(let k = 0; ; k++){   // the phone cut the network in the background: sent again when the page is back
        const seq = bgSeq;
        try{ blob = await convertOnServer(src.file, p => show(p, p < 0.5 ? 'sending to Shubix to convert…' : 'converting…')); break; }
        catch(e){ if(k || !(e && e.code === 'OFFLINE') || (bgSeq === seq && !isHidden())) throw e; dd.textContent = 'waiting for you to come back…'; await whenVisible(); }
      }
      if(src.removed) return false;
      if(!(await hasPicture(blob))){ const err = new Error('The converted copy has no picture'); err.code = 'CONVERT_NO_VIDEO'; throw err; }   // the original is kept
      const sc = Math.min(1, 1920/Math.max(src.w || (facts && facts.width) || 1920, src.h || (facts && facts.height) || 1080));
      const w = Math.round(((src.w || (facts && facts.width) || 1080)*sc)/2)*2, h = Math.round(((src.h || (facts && facts.height) || 1920)*sc)/2)*2;
      setEditCopy(src, blob, w, h, 'server');
    }catch(e){
      src.proxyStatus = 'Could not convert'; src.edFail = e && e.code === 'UNAUTHORIZED' || (e && e.status === 401) ? 'signin' : e && e.code === 'OFFLINE' ? 'offline' : e && (e.code === 'CORRUPTED_MEDIA' || e.code === 'CONVERT_NO_VIDEO') ? 'broken' : e && (e.code === 'CONVERT_TOO_BIG' || e.code === 'CONVERT_TOO_LONG') ? 'big' : e && (e.code === 'RATE_LIMITED' || e.code === 'CONVERT_BUSY') ? 'limit' : 'server'; src.edErr = e && e.message;
      updateClipHoverInfo(src); console.info('edit copy by Shubix failed', e); titleDone('copy');
      return false;
    }
  }
  titleDone('copy');
  previewBatchCompressed++;
  previewBatchShow(src, 'Smooth copy ready (' + previewBatchCompressed + '/' + previewBatchDetected + '). Reading your videos…', 1);
  try{ await keptPut('p:', src.file, { v: 2, edit: true, audio: !!src.edAudio, blob: src.edFile, width: src.edW, height: src.edH, mime: src.edFile.type || '' }); }catch(e){}
  return true;
}
// what the person sees when a heavy clip could not get its copy (it is kept, but may lag)
function editCopyFailNote(src, facts){
  const why = whatClip(facts);
  const tip = src.edFail === 'limit' && src.edErr ? ' ' + src.edErr : src.edFail === 'broken' ? ' The file looks damaged or incomplete: copy it again from your phone and add it.' : src.edFail === 'signin' ? ' Sign in and add it again: Shubix converts it for you.'
    : src.edFail === 'offline' ? ' Connect to the internet and add it again: Shubix converts it for you.'
    : src.edFail === 'big' ? ' It is too big to convert online: save it as MP4 (H.264, 1080p, 30 fps) from your camera or phone and add it again.'
    : ' Save it as MP4 (H.264, 1080p, 30 fps) and add it again. On an iPhone: Settings → Camera → Formats → Most Compatible.';
  notify(src.name + ' (' + why + ') could not be made smooth on this device, so it may lag.' + tip, 'err');
}
async function compressHighResolutionPreview(src, dd){
  if(src.edFile){ if(src.proxyStatus === 'Checking preview…') src.proxyStatus = 'Smooth copy ready'; updateClipHoverInfo(src); return; }   // made already (a format the player could not open)
  const probe = await probeVideo(src.file).catch(() => null);
  const facts = { size: src.file.size, width: src.w, height: src.h, duration: src.dur, fps: probe ? probe.fps : 0, hdr: !!(probe && probe.hdr), tenBit: !!(probe && probe.tenBit), chroma422: !!(probe && probe.chroma422), vfr: !!(probe && probe.vfr) };
  src.facts = { ...facts, decodes: !!(probe && probe.decodes) };
  const isMov = /\.mov$/i.test(src.name || src.file.name || '') || /quicktime/i.test(src.file.type || '');
  const plan=previewProxyPlan(facts, isMov);
  const heavy = !!(plan && plan.forExport);
  // Reuse the copy made for this original file when a saved draft is reopened.
  const cached = await keptGet('p:', src.file);
  // (a copy kept without its picture, made before previewProxy.ts checked for one, is not used: it is made again)
  const pictured = cached && cached.blob instanceof Blob && (heavy ? cached.v === 2 && cached.edit : cached.v === 1 && cached.blob.size < src.file.size) && await hasPicture(cached.blob);
  if(pictured){
    if(cached.edit){ src.edFile = cached.blob; src.edW = cached.width || 0; src.edH = cached.height || 0; src.edAudio = !!cached.audio; }
    src.url = URL.createObjectURL(cached.blob);
    src.previewProxy = true; src.proxySize = cached.blob.size;
    src.proxyW = cached.width || 0; src.proxyH = cached.height || 0;
    src.proxyMime = cached.blob.type || cached.mime || '';
    src.proxyStatus = 'Reused saved preview'; src.proxyReason = 'Restored from this device draft cache.';
    updateClipHoverInfo(src);
    return;
  }
  if(heavy){
    if(!(await makeEditCopy(src, dd, src.facts, plan, true)) && !src.removed) editCopyFailNote(src, src.facts);
    return;
  }
  if(!plan){
    const longSide=Math.max(src.w||0,src.h||0), avg=src.dur>0 ? src.file.size*8/src.dur : 0;
    src.proxyStatus='Not compressed';
    src.proxyReason=longSide>960 || avg>2500000 || isMov ? 'Skipped: below minimum size, proxy estimate not smaller, or metadata outside supported limits.' : 'Not needed: resolution and bitrate are already within preview limits.';
    updateClipHoverInfo(src); return;
  }
  src.proxyStatus='Compressing…'; src.proxyReason='Target preview: '+plan.width+' × '+plan.height+' · '+(plan.bitrate/1e6).toFixed(2)+' Mbps';
  updateClipHoverInfo(src);
  previewBatchDetected++;
  previewBatchShow(src,'High-resolution video detected. Creating a lightweight editing copy…',0);
  try{
    life({stage:'compressing preview',size:Math.round(src.file.size/1e6)+' MB',res:src.w+'x'+src.h});
    const result=await createPreviewProxy(src.file,p=>{
      previewBatchShow(src,'Compressing '+src.name+' for smooth editing…',p);
      const n=Math.max(0,Math.min(100,Math.round(p*100))); dd.textContent='compressing for editing… '+n+'%';
    }, plan);
    if(src.removed) return;
    if(result && result.blob && result.blob.size<src.file.size){
      const oldUrl=src.url; src.url=URL.createObjectURL(result.blob); src.previewProxy=true; src.proxySize=result.blob.size; src.proxyW=result.plan.width; src.proxyH=result.plan.height; src.proxyMime=result.blob.type; src.proxyStatus='Success'; src.proxyReason='Downscaled preview generated successfully.';
      // Persist the compressed preview separately; export always keeps using the original File.
      await keptPut('p:', src.file, { v: 1, blob: result.blob, width: result.plan.width, height: result.plan.height, mime: result.blob.type || '' });
      try{URL.revokeObjectURL(oldUrl);}catch(e){}
      updateClipHoverInfo(src);
      previewBatchCompressed++;
      dd.textContent='editing copy ready · analysing…';
      previewBatchShow(src,'Editing copy ready ('+previewBatchCompressed+'/'+previewBatchDetected+'). Analysing all selected videos…',1);
    }else{
      src.proxyStatus='Failed — original kept'; src.proxyReason='Browser could not create a preview smaller than 90% of the original.'; updateClipHoverInfo(src);
      previewBatchShow(src,'Could not make a smaller copy for '+src.name+'. Keeping the original and continuing analysis…',1);
    }
  }catch(error){
    src.proxyStatus='Failed — original kept'; src.proxyReason=error instanceof Error ? error.message : String(error); updateClipHoverInfo(src);
    console.info('Preview compression skipped:',error);
    previewBatchShow(src,'Compression unavailable for '+src.name+'. Keeping the original and continuing analysis…',1);
  }
}
// The browser's player cannot open this clip (ProRes, 4:2:2, HEVC on a browser without it, an unusual container):
// an edit copy from WebCodecs or from Shubix, then the clip is read from the copy. false: nothing could open it.
async function rescueClip(src, dd){
  if(src.edFile || src.rescueTried) return false;
  src.rescueTried = true;
  const cached = await keptGet('p:', src.file).catch(() => null);
  if(cached && cached.v === 2 && cached.edit && cached.blob instanceof Blob && await hasPicture(cached.blob)){ setEditCopy(src, cached.blob, cached.width || 0, cached.height || 0, cached.audio ? 'server' : 'player'); return true; }
  const probe = await probeVideo(src.file).catch(() => null);
  const facts = probe ? { size: src.file.size, width: probe.width, height: probe.height, duration: probe.duration, fps: probe.fps, hdr: probe.hdr, tenBit: probe.tenBit, chroma422: probe.chroma422, vfr: probe.vfr, decodes: probe.decodes } : null;
  src.facts = facts;
  const plan = facts ? editCopyPlan(facts) : null;
  if(facts && facts.width){ src.w = src.w || facts.width; src.h = src.h || facts.height; }
  return makeEditCopy(src, dd, facts, plan, false);
}

async function readVideo(src){
  if(src.removed) return;
  const card = src.card, dd = card.querySelector('.dd');
  if(refReading){ dd.textContent = 'waiting for the Reel to copy…'; dd.dataset.st = 'read'; dd.dataset.p = '0'; await refDone(); if(src.removed) return; }
  let stage = 'metadata', v = null;   // where reading stopped, for the report below
  // still reading after 2 minutes: reported too (a phone where it hangs instead of failing)
  const slow = setTimeout(() => { try{ window.__shubixReport && window.__shubixReport('clip', 'Clip still reading after 2 min at "' + stage + '" · ' + ((src.file && src.file.type) || 'no type') + ' · ' + dd.textContent, JSON.stringify({ size: src.file && src.file.size, dur: src.dur, w: src.w, h: src.h, webcodecs: typeof VideoDecoder !== 'undefined' })); }catch(x){} }, 120000);
  try{
    dd.textContent = 'Reading video…'; dd.dataset.st = 'read'; dd.dataset.p = '0'; setClipStatus(src,'reading');
    // a format the browser's player cannot open: an edit copy (this device or Shubix), then the clip is read from it
    const reopen = async () => { stage = 'converting the format'; if(!(await rescueClip(src, dd))) return false; if(v){ v.removeAttribute('src'); v.load(); } v = makeVideo(src.url); stage = 'metadata'; await waitEv(v,'loadedmetadata', 15000); if(src.edFile && v.videoWidth){ src.edW = v.videoWidth; src.edH = v.videoHeight; } return true; };
    v = makeVideo(src.url);
    try{ await waitEv(v,'loadedmetadata', 15000); if(!isFinite(v.duration) || v.duration<=0 || !v.videoWidth) throw new Error('bad'); }
    catch(err){ if(src.removed) return; if(!(await reopen())) throw err; }
    src.dur = v.duration; src.w = v.videoWidth; src.h = v.videoHeight;
    if(!isFinite(src.dur) || src.dur<=0 || !src.w) throw new Error('bad');
    src.proxyStatus='Checking preview…'; updateClipHoverInfo(src);
    stage = 'preview compression'; await compressHighResolutionPreview(src, dd);
    if(src.removed) return;
    if(src.previewProxy){ v.removeAttribute('src'); v.load(); v=makeVideo(src.url); await waitEv(v,'loadedmetadata',15000); }
    stage = 'first picture';
    try{ await videoData(v); }
    catch(err){ if(src.removed) return; if(!(await reopen())) throw err; src.dur = v.duration; src.w = v.videoWidth; src.h = v.videoHeight; stage = 'first picture'; await videoData(v); }
    // The first decoded frame is enough for the clip's small queue thumbnail. Avoid a second iPhone seek here;
    // thumbnail choice has no effect on the Reel analysis or export. Keep the existing Android thumbnail unchanged.
    if(!IOS){ stage = 'seek'; v.currentTime = Math.min(src.dur*0.3, 2); await waitEv(v,'seeked'); }
    stage = 'thumbnail';
    const th = card.querySelector('.th'); th.width=320; th.height=180; const tg=th.getContext('2d');
    const r = Math.max(320/src.w, 180/src.h); tg.drawImage(v,(320-src.w*r)/2,(180-src.h*r)/2,src.w*r,src.h*r);
    v.removeAttribute('src'); v.load();
    if(src.removed) return;
    // action + scene changes and faces are read at the same time (two decoders): about 40% faster per clip
    const tq = performance.now(); let pm = 0, pf = 0;
    const show = () => { const f = pm*0.6 + pf*0.4; dd.textContent = 'reading ' + Math.round(f*100) + '%'; dd.dataset.p = String(Math.round(f*100)); if(previewBatchUi) previewBatchShow(src, 'Analysing selected videos… '+Math.round((batchDone+f)/Math.max(1,batchN)*100)+'%', (batchDone+f)/Math.max(1,batchN));
      tasks.update('clips', (batchDone + f) / Math.max(1, batchN), 'Clip ' + Math.min(batchN, batchDone + 1) + ' of ' + batchN + ' · ' + src.name); };
    src.readMs = {};
    const kept = await scanGet(src);   // read before (a saved Reel opened again, or the same clip added again): used as it is
    if(kept){
      src.scenes = Array.isArray(kept.scenes) ? kept.scenes : [];
      // Older saved scan records can lack face or per-sample fields. Keep the clip usable and let its saved edit restore.
      src.samples = kept.samples.map((s, i) => ({ ...s, t: Number.isFinite(s.t) ? s.t : i * src.dur / kept.samples.length, m: Number.isFinite(s.m) ? s.m : 0, sh: Number.isFinite(s.sh) ? s.sh : 1 }));
      src.faces = Array.isArray(kept.faces) ? kept.faces : []; src.faceHow = kept.faceHow; src.readMs.kept = true; pm = pf = 1; show();
    }
    else {
      stage = 'motion and faces'; life({ stage: 'reading clips', clips: sources.length + pending, size: Math.round((src.file && src.file.size || 0) / 1e6) + ' MB', res: src.w + 'x' + src.h });
      const doMotion = () => scanMotion(src, p=>{ pm = p; show(); }).then(()=>{ src.readMs.motion = Math.round(performance.now()-tq); });
      const doFaces = () => scanFaces(src, p=>{ pf = p; show(); }).then(()=>{ src.readMs.faces = Math.round(performance.now()-tq); });
      // two decoders at once is ~40% faster, but on an iPhone it doubles the memory of a 4K video: one after the other there
      if(IOS){   // one decode of the clip for motion and faces: half the work and the memory of two decoders
        const fsc = faceScanner(src);
        await scanMotion(src, p=>{ pm = pf = p; show(); }, fsc); src.readMs.motion = src.readMs.faces = Math.round(performance.now()-tq);
        if(!fsc) src.faces = src.faces || [];
      } else await Promise.all([doMotion(), doFaces()]);
      if(!src.removed) scanPut(src);
      // how long reading took against the clip's length, by phone and way of decoding (Admin → Errors, "Clip reading
      // speed"): iPhones always (to compare with Android), others only when slower than the clip itself
      try{ const ms = Math.round(performance.now() - tq), x = ms / 1000 / Math.max(1, src.dur), b = x < 0.5 ? '<0.5' : x < 1 ? '0.5-1' : x < 2 ? '1-2' : x < 4 ? '2-4' : '4+';
        if(IOS || x >= 1) window.__shubixReport && window.__shubixReport('perf', 'Clip reading ' + b + '× its length · ' + (IOS ? 'iPhone' : 'other') + ' · ' + (src.readMs.how || '?') + (src.h > 1920 || src.w > 1920 ? ' · 4K' : ''),
          JSON.stringify({ ms, dur: +src.dur.toFixed(1), w: src.w, h: src.h, type: src.file && src.file.type, mb: Math.round((src.file && src.file.size || 0) / 1e6), parts: src.readMs })); }catch(e){}
    }
    if(src.removed) return;
    const nf = src.faces.filter(f=>f.n>0).length, shs = src.samples.map(s=>s.sh).sort((a,b)=>a-b);
    src.shMed = shs[Math.floor(shs.length/2)] || 1;
    dd.textContent = fmt(src.dur).replace(/\.\d+$/, '') + ' · ' + (src.w >= src.h ? 'Landscape' : 'Portrait') + ' · Ready';
    dd.dataset.st = 'ok'; dd.dataset.len = fmt(src.dur).replace(/\.\d+$/, ''); setClipStatus(src,'ready','Video analysed · '+src.w+' × '+src.h+' · '+fmt(src.dur));
    src.els = [lazyPlayer(src.url), lazyPlayer(src.url), lazyPlayer(src.url)];
    sources.push(src); drawSpark(src);
  }catch(e){
    if(src.removed) return;
    setClipStatus(src,'failed',e && e.message ? 'Could not read video: '+e.message : 'Could not read video');
    console.warn('clip not readable:', src.name, e && e.message || e);
    // Reopening a saved edit should not fail just because optional motion/face analysis could not run again.
    // The saved edit already contains its shot choices; keep the decoded source and use neutral scan data.
    if(restoring && stage === 'motion and faces' && src.dur > 0 && src.w > 0 && src.h > 0){
      if(!Array.isArray(src.scenes)) src.scenes = [];
      if(!Array.isArray(src.samples) || !src.samples.length){
        const count = Math.max(2, Math.ceil(src.dur * 2));
        src.samples = Array.from({ length: count }, (_, i) => ({ t: Math.min(src.dur - 0.01, i * src.dur / count), m: 0, sh: 1 }));
      } else src.samples = src.samples.map((s, i) => ({ ...s, t: Number.isFinite(s.t) ? s.t : i * src.dur / src.samples.length, m: Number.isFinite(s.m) ? s.m : 0, sh: Number.isFinite(s.sh) ? s.sh : 1 }));
      if(!Array.isArray(src.faces)) src.faces = [];
      src.shMed = 1; src.els = [lazyPlayer(src.url), lazyPlayer(src.url), lazyPlayer(src.url)]; sources.push(src); drawSpark(src);
      dd.textContent = src.dur.toFixed(1) + ' s · ' + src.w + '×' + src.h; dd.dataset.st = 'ok'; dd.dataset.len = fmt(src.dur).replace(/\.\d+$/, '');
      return;
    }
    // to Admin → Errors: what the phone could not do with which kind of file, so it can be fixed for that phone
    try{ const f = src.file || {}, me = v && v.error;
      window.__shubixReport && window.__shubixReport('clip', 'Clip not readable at "' + stage + '": ' + String(e && e.message || e).slice(0, 160) + ' · ' + (f.type || 'no type') + ' · .' + String(src.name || '').split('.').pop().toLowerCase(),
        JSON.stringify({ size: f.size, dur: src.dur, w: src.w, h: src.h, ready: v && v.readyState, net: v && v.networkState, mediaError: me ? me.code + ' ' + (me.message || '') : null, webcodecs: typeof VideoDecoder !== 'undefined' })); }catch(x){}
    dd.textContent = src.edFail === 'limit' && src.edErr ? src.edErr : src.edFail === 'broken' ? 'This file looks damaged or incomplete (a copy that did not finish?). Copy it again from your phone and add it.' : src.edFail === 'signin' ? 'This camera format needs converting: sign in and add it again.' : src.edFail === 'offline' ? 'This format needs converting: connect to the internet and add it again.' : src.edFail === 'big' ? 'This camera format is too big to convert online: save it as MP4 (H.264) and add it again.' : 'This video\'s format cannot be opened here. Save it as MP4 (H.264) and add it again, or remove it with ×.'; dd.dataset.st = 'bad';
    card.style.borderColor = 'var(--drop)';
  }finally{ clearTimeout(slow); }
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
  previewBatchClose();
  remakeOk();
  { const order = [...$('clips').children].map(c => c.__src).filter(s => sources.includes(s)); if(order.length === sources.length) sources.splice(0, sources.length, ...order); }   // read in turn: the cards' order (askOrder)
  updateQ(); $('clearv').hidden = !$('clips').children.length; clipSoundCheck();
  if(sources.length) tasks.done('clips', sources.length + ' clip' + (sources.length > 1 ? 's' : '') + ' ready' + (buf || kind === 'talk' ? ' · making your Reel' : ' · now choose a song'));
  else tasks.fail('clips', 'These videos do not play here. Try MP4 or MOV.');
  if(sources.length){ $('s2').classList.add('done'); if(buf || kind === 'talk') makeEdit(); if(kind !== 'talk' && !aiHeld) aiRun(); footCheckSoon(); }
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
  try{ ab = await decodeAnyAudio(src.file); }catch(e){ ab = null; if(src.edFile && src.edAudio){ try{ ab = await decodeAnyAudio(new File([src.edFile], 'copy.' + (/webm/.test(src.edFile.type) ? 'webm' : 'mp4'), { type: src.edFile.type })); }catch(e2){ ab = null; } } }
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
  delete root.dataset.nomake;   // set again below when these clips have no voice (flow.ts shows it on Next)
  const token = ++talkToken;
  if(!sources.length) return;
  stopAll();
  $('s3st').textContent = 'Finding where you speak…';
  for(const src of sources){ await voiceOf(src); if(token !== talkToken) return; }
  const parts = [];
  sources.forEach((src, si) => { if(!src.voice.has) return; for(const [a,b] of speechParts(src.voice, src.dur, talkPace)) parts.push({ si, a, b }); });
  const mute = sources.filter(s => !s.voice.has).length;
  if(!parts.length){ root.dataset.nomake = 'No voice found: add a clip where you talk'; $('s3st').textContent = 'No voice found in these clips'; showMsg('We could not hear anyone talking in these clips. For a music Reel, choose "Music Reel" at the top.', true); return; }
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
  plan = edit.map(e => ({ start: e.start, end: e.end, type: e.type, fx: e.fx, sp: e.sp, tr: e.tr, efx: e.efx, acc: e.acc, ak: e.ak, ref: e.ref, flick: e.flick, trd: e.trd, black: e.black }));
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
  remakeOk();
  if(recording || k === kind) return;
  delete root.dataset.nomake;
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
/* ---- "Try it with our sample clips": someone with no clips at hand sees what the app does in a minute. The sample
 * (a song and a few clips, public/samples/manifest.json: { song, songName?, clips: [...], credit? }) is loaded like the
 * person's own files. No manifest: the button stays hidden. /create/music?sample=1 starts it straight away. ---- */
let sampleInfo = null;
async function sampleRun(){
  const b = $('fsample'); if(!sampleInfo || (b && b.disabled)) return;
  if(b){ b.disabled = true; b.textContent = 'Loading the sample…'; }
  try{
    const get = async (name, type) => { const r = await fetch('/samples/' + encodeURIComponent(name)); if(!r.ok) throw new Error(name); const bl = await r.blob(); return new File([bl], name, { type: bl.type || type, lastModified: 1 }); };
    const [songF, ...clipsF] = await Promise.all([get(sampleInfo.song, 'audio/mpeg'), ...sampleInfo.clips.map(c => get(c, 'video/mp4'))]);
    const go = root.querySelector('[data-fnext]'); if(go && root.dataset.fstep === 'intro') go.click();
    loadMusic(songF); addVideos(clipsF);
    if(sampleInfo.credit) notify(sampleInfo.credit);
  }catch(err){ console.warn('sample not loaded:', err); notify('The sample could not be loaded. Please try your own clips.', 'err'); }
  finally{ if(b){ b.disabled = false; b.textContent = 'No clips with you? Try it with our sample clips'; } }
}
$('fsample').addEventListener('click', sampleRun, SIG);
fetch('/samples/manifest.json').then(r => r.ok ? r.json() : null).then(m => {
  if(!m || !m.song || !Array.isArray(m.clips) || !m.clips.length) return; sampleInfo = m;
  const b = $('fsample'); if(b && (root.dataset.fkind || 'music') === 'music') b.hidden = false;
  if(new URLSearchParams(location.search).get('sample') === '1') sampleRun();
}).catch(() => {});
queueMicrotask(() => { if(ac.signal.aborted) return; const q = new URLSearchParams(location.search), t0 = q.get('tpl');
  // the kind: /create/music|talking|photo (the Create flow's addresses)
  const k0 = ({ music: 'music', talking: 'talk', photo: 'photo' })[location.pathname.split('/')[2]];
  // a template from Home or Templates: /create/edit?tpl=<template> (picked as if tapped)
  const pick = () => { const b = TEMPLATES[t0] && root.querySelector('#tpl [data-t="' + CSS.escape(t0) + '"]'); if(b){ b.click(); return true; } return false; };
  if(t0 && pick()) return;
  // one the administrator added since the last visit: wait for the server's list
  if(t0){ tplReady.then(() => { if(!ac.signal.aborted && !pick()) kindFromPath(); }); return; }
  kindFromPath();
  function kindFromPath(){
  if(k0 === 'photo'){ const b = $('photokind'); if(b){ b.click(); return; } }
  if(k0 === 'talk' || k0 === 'music'){ const b = root.querySelector('#kind [data-k="' + k0 + '"]'); if(b) b.click(); else setKind(k0); } } });
function setDenoise(on){ denoiseOn = on; $('dn1').checked = on; $('dn2').checked = on; capAll = null; if(kind === 'talk'){ if(sources.length) buildTalk(); } else if(vo){ applyVo(); afterVo(); } }
$('dn1').addEventListener('change', e => setDenoise(e.target.checked), SIG); $('dn2').addEventListener('change', e => setDenoise(e.target.checked), SIG);
$('tpace').addEventListener('click', e => { const b = e.target.closest('button'); if(!b || recording) return; talkPace = b.dataset.p;
  [...$('tpace').children].forEach(x => x.setAttribute('aria-pressed', String(x === b))); buildTalk(); }, SIG);
$('tmusic').addEventListener('click', e => { const b = e.target.closest('button'); if(!b || recording) return; talkMusic = +b.dataset.v;
  [...$('tmusic').children].forEach(x => x.setAttribute('aria-pressed', String(x === b))); buildTalk(); }, SIG);

function removeVideo(src){
  if(recording) return;
  remakeOk();
  if(playing){ pos = curTime(); stopAll(); }
  src.removed = true;
  const k = sources.indexOf(src); if(k>=0) sources.splice(k,1);
  (src.els||[]).forEach(v=>{ v.pause(); v.removeAttribute('src'); v.load(); });
  setTimeout(()=>URL.revokeObjectURL(src.url), 1000);
  src.card.remove(); renumber();
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
$('aspect').addEventListener('click', e=>{ const b=e.target.closest('button'); if(!b) return; aspect=b.dataset.a; root.dataset.asp = aspect; // the preview card takes this shape too
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
  const HIT_TR = ['whip','iris','zoom','glitch','swipeup','spin','dropin','bars','pixelate'].filter(k => !isLocked('tr', k));   // only what the plan opens
  const CUT_TR = ['hard','wipe','hard','iris','slideleft','hard','bars','blur','hard','luma','doors'].filter(k => k === 'hard' || !isLocked('tr', k));
  const HIT_FX = ['punch','tilt','punch','shake'];
  let lastTr = '', lastFx = '', hk = 0, ck = 0, fk = 0, dk = 0;
  const beatsRel = (s) => beats.filter(b=>b>s.start+0.15 && b<s.end-0.1).map(b=>b-s.start);
  // restraint: fancy transitions are rationed (whip pans 1-2 per reel), the rest are clean hard cuts
  const per = Math.max(1, buf.duration/30), budget = {snap:Math.round(2*per), whip:Math.round(2*per), spin:Math.round(1*per), glitch:Math.round(2*per), bars:Math.round(2*per), iris:Math.round(3*per), zoom:Math.round(3*per), wipe:Math.round(2*per), dissolve:Math.round(2*per)};
  const take = k => { if(budget[k]===undefined) return k; if(budget[k]>0){ budget[k]--; return k; } return 'hard'; };
  // beat shapes on a few longer shots and some drops: a different set and order with each seed / mix, never one twice in a row
  const SH_ROT = ['boxgrow','frame','grid','circle','strips','triple','heartbeat','starbeat'].filter(k => !isLocked('fx', k)), SH_DROP = ['kaleido','strobe','triple','rgbpulse','mirror','vhs'].filter(k => !isLocked('fx', k));
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
      else { let k = CUT_TR[ck++ % CUT_TR.length]; if(k===lastTr && k!=='hard') k='hard'; tr=take(k); fx = ['bounce','pan','shake'].includes(lastFx) ? 'none' : 'bounce'; }   // a pulse every other cut, not on all
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
    if(i > 0 && shLeft > 0 && SH_ROT.length && len >= (mode==='smooth' ? 1.8 : 1.2) && beatsRel(s).length >= 2 && s.type !== 'drop' && ['pan','bounce','none','pan-soft'].includes(fx)){
      let k = mode==='smooth' ? ['frame','circle'][shK++ % 2] : SH_ROT[(shOff + shK++) % SH_ROT.length]; if(k === lastSh) k = SH_ROT[(shOff + shK++) % SH_ROT.length];
      fx = k; shLeft--; lastSh = k; }
    else if(s.type === 'drop' && SH_DROP.length && mode !== 'smooth' && dk % 3 === 0 && fx === 'zoomburst' && len >= 0.8){ fx = SH_DROP[(shOff + dk) % SH_DROP.length]; lastSh = fx; }
    // a shake is an accent: never two shots in a row (a run of fast cuts is clean hard cuts; the cuts are the energy)
    if(fx === 'shake' && lastFx === 'shake') fx = 'none';
    s.tr = tr; s.efx = fx; s.sp = sp; lastTr = tr; lastFx = fx;
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
const trDur = e => e.trd ?? (TR_DUR[e.tr] || 0);   // a shot's own (shorter) transition, else the transition's usual length
const TR_DUR = {hard:0, fadein:0.35, flash:0.22, whip:0.16, zoom:0.18, glitch:0.14, dip:0.26, dissolve:0.35, iris:0.24, wipe:0.22, bars:0.26, spin:0.2, diamond:0.36, heart:0.42, star:0.4,
  slideleft:0.24, slideright:0.24, slideup:0.24, slidedown:0.24, swipeup:0.2, zoomout:0.3, blur:0.35, flip:0.3, luma:0.45, pixelate:0.4, clock:0.4, doors:0.35, ripple:0.45, burn:0.4, dropin:0.32};

/* ---- keyframes: [time, value, ease] per property, local to the shot ---- */
const EASE = {
  lin: x=>x, outCubic: x=>1-Math.pow(1-x,3), outExpo: x=> x>=1 ? 1 : 1-Math.pow(2,-10*x),
  outBack: x=>{ const c1=1.70158, c3=c1+1; return 1 + c3*Math.pow(x-1,3) + c1*Math.pow(x-1,2); },
  inOut: x=> -(Math.cos(Math.PI*x)-1)/2, inQuad: x=>x*x,
  bezier: x=>cubicBezierProgress(x, [0.25, 0.1, 0.25, 1]),
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
let aiOn = false, aiBusy = false, aiInfo = null, aiLocked = false;
/* ---- credits: Shubix AI is paid per Reel (once, however many clips come later) and per chat change; the person is asked
 * each time, with what it costs and what they have. Free plans (no AI) edit on the phone. ---- */
let reelId = '', aiReel = '', gateP = null, chatUsed = 0;   // aiReel: the Reel the person said yes to ('no:' + id: said no); chatUsed: Ask Shubix changes on it (the plan's first few are free)
const newId = () => { try{ return crypto.randomUUID().replace(/-/g, '').slice(0, 20); }catch(e){ return Math.random().toString(36).slice(2, 12) + Date.now().toString(36); } };
function reelIdNow(){ if(!reelId) reelId = newId(); return reelId; }
const aiCostOf = k => (aiInfo && aiInfo.costs && Number(aiInfo.costs[k])) || 0;
const aiBal = () => aiInfo && typeof aiInfo.balance === 'number' ? aiInfo.balance : null;
const creditWord = n => n + ' credit' + (n === 1 ? '' : 's');
const aiFreeChats = () => (aiInfo && Number(aiInfo.freeChats)) || 0;
const chatSync = res => { if(res && res.chat && typeof res.chat.used === 'number') chatUsed = res.chat.used; };
function askCredits(o){
  return new Promise(res => {
    $('cconft').textContent = o.title; $('cconfp').textContent = o.text;
    const L = $('cconfl'); L.hidden = !(o.list && o.list.length); L.textContent = ''; (o.list || []).forEach(t => { const li = document.createElement('li'); li.textContent = t; L.appendChild(li); });
    $('cconf').classList.toggle('upsell', !!o.upsell);
    $('cconfbal').textContent = o.bal == null ? '' : 'You have ' + creditWord(o.bal) + (o.after != null ? ' · ' + creditWord(Math.max(0, o.after)) + ' left after this' : '');
    // no second choice (o.no empty): just the button and ✕
    $('cconfok').textContent = o.ok; $('cconfno').textContent = o.no || ''; $('cconfno').hidden = !o.no;
    $('cconf').dataset.q = String((+($('cconf').dataset.q || 0)) + 1);   // each question its number (the phone app is asked each one)
    $('cconf').hidden = false; $('cconfok').focus();
    const esc = e => { if(e.key === 'Escape') done(null); };
    const done = v => { $('cconf').hidden = true; $('cconfok').onclick = $('cconfno').onclick = $('cconfx').onclick = $('cconf').onclick = null; removeEventListener('keydown', esc); res(v); };
    $('cconfok').onclick = () => done(true); $('cconfno').onclick = () => done(false);
    $('cconfx').onclick = () => done(null); addEventListener('keydown', esc);   // ✕ / Escape: closed, nothing chosen
    $('cconf').onclick = e => { if(e.target === $('cconf')) done(null); };
  });
}
function aiOff(msg){ aiOn = false; aiStat(msg); const pr = [...$('mode').children].find(x => x.getAttribute('aria-pressed') === 'true'); modeWords(pr ? pr.dataset.m : mode); if(buf && sources.length && !recording) makeEdit(); }
// asked once per Reel: Shubix AI for this Reel (its credits), or the phone's own edit (free)
// The Reel's gate: asked before ANY Shubix AI work on a Reel (reading the clips, the pace, the shots), for every plan and every
// Reel: Use = its credits and the AI starts; ✕ = nothing runs and nothing is taken (asked again on Generate, `again`).
// the phone app's hidden studio (/engine): no prices, plans or top-ups there (the app sells nothing: Google Play rules)
const IN_APP = location.pathname === '/engine';
let gateNo = '', lowAsked = '';   // lowAsked: the Reel whose too-few-credits question was shown
// A plan with Shubix AI makes every Reel with it: when the creator closes the credits question (or has too few credits)
// the Reel is not shown, played or exported; the preview says so and its button asks again (or opens the top-ups)
function aiNeed(on, low){
  root.classList.toggle('aineed', !!on); if(!on) return;
  const cost = aiCostOf('reel');
  $('aiaskt').textContent = low ? 'Top up to make this Reel' : 'Your Reel is waiting for Shubix AI';
  $('aiaskp').textContent = low ? 'Shubix AI uses ' + creditWord(cost) + ' for this Reel.' : 'It picks the best moments and edits them on the beat' + (cost ? ' · ' + creditWord(cost) + ' for this Reel' : '') + '.';
  $('aiaskgo').textContent = low ? 'Top up' : 'Make it with Shubix AI'; $('aiaskgo').dataset.low = low ? '1' : '';
}
$('aiaskgo').addEventListener('click', async () => {
  if($('aiaskgo').dataset.low){ if(!IN_APP) location.assign('/pricing'); return; }
  if(await aiGate(true)) aiRun();
}, SIG);
function aiGate(again = false){
  if(!aiOn) return Promise.resolve(false);
  const id = reelIdNow(); if(aiReel === id) return Promise.resolve(true);
  if(!again && (aiReel === 'no:' + id || gateNo === id)) return Promise.resolve(false);
  if(gateP) return gateP;
  gateP = (async () => {
    const cost = aiCostOf('reel'), bal = aiBal();
    if(cost && bal !== null && bal < cost){
      // too few credits: the Reel is still made, by the phone's own smart edit (like the Free plan), never held back;
      // the top-up is offered once per Reel (not again on every Next)
      aiNeed(false); gateNo = id;
      aiStat('Edited on your phone · Shubix AI needs ' + creditWord(cost) + ' (you have ' + creditWord(bal) + ')');
      if(lowAsked !== id){ lowAsked = id;
        if(IN_APP) await askCredits({ title: 'Not enough credits for Shubix AI', text: 'Shubix AI uses ' + creditWord(cost) + ' for this Reel and you have ' + creditWord(bal) + '. Your Reel is made with the phone\'s own smart edit.', bal, ok: 'OK' });
        else { const go = await askCredits({ title: 'Top up for Shubix AI', text: 'Shubix AI uses ' + creditWord(cost) + ' for this Reel and you have ' + creditWord(bal) + '. Your Reel is made with the phone\'s own smart edit now; top up to let Shubix edit it.', bal, ok: 'Top up', no: 'Use the phone\'s edit' });
          if(go) location.assign('/pricing'); } }
      return false; }
    // what Shubix AI does and what it costs, then Use (✕: nothing runs, nothing is taken; no "free" choice)
    const ok = await askCredits({ title: 'Shubix AI will edit this Reel',
      text: cost ? 'It uses ' + creditWord(cost) + ' once for this Reel. Adding clips or changing them later costs nothing more.' : 'Included in your plan for this Reel.',
      list: ['The best moments of every clip', 'Trendy transitions and effects on the beat', 'Pro colour and framing'],
      bal, after: bal !== null && cost ? bal - cost : null, ok: cost ? 'Use ' + creditWord(cost) : 'Use Shubix AI' });
    if(ok){ aiReel = id; gateNo = ''; aiNeed(false); return true; }
    gateNo = id; aiNeed(true); aiStat('Your Reel waits for Shubix AI · tap "Make it with Shubix AI"');
    return false;
  })().finally(() => { gateP = null; });
  return gateP;
}
const aiReelOk = () => aiOn && !!reelId && aiReel === reelId;
// Free (no Shubix AI in the plan): on Generate, once per Reel, what Shubix AI would do and the way to it.
// 'upgrade' (to Plans), 'basic' (the phone's own edit), 'close' (✕: nothing) or 'skip' (a plan with Shubix AI, or already asked)
let upsold = '';
async function upsell(){
  aiHeld = false;
  if(!aiLocked){
    if(!aiOn) return 'skip';
    if(aiReelOk()){ aiRun(); return 'skip'; }   // already agreed for this Reel: the AI starts (it was held)
    const go = await aiGate(true);
    if(go){ aiRun(); return 'skip'; }   // Use: the AI starts on this Reel
    return 'close';                      // ✕: back, nothing generated
  }
  const id = reelIdNow(); if(upsold === id || IN_APP) return 'skip';   // never an upgrade offer in the app
  const cost = aiCostOf('reel');
  const v = await askCredits({ upsell: true, title: 'Make it perfect with Shubix AI', text: 'Your Reel is ready. With the Editor or Pro plan, Shubix AI edits it like a pro' + (cost ? ' (' + creditWord(cost) + ' per Reel)' : '') + ':' + (aiInfo && aiInfo.creditsOpen ? ' Or invite friends on Invite & earn: your credits pay for AI Reels on Free too.' : ''),
    list: ['The best moments of every clip, picked for you', 'Trendy transitions and effects, right on the beat', 'Ask Shubix: change anything in your own words', 'Captions and pro colour, automatically'],
    bal: null, ok: 'Upgrade to Shubix AI', no: 'Create basic Reel' });
  if(v !== null) upsold = id;
  if(v === true){ location.assign('/pricing?feature=ai'); return 'upgrade'; }
  return v === false ? 'basic' : 'close';
}
const aiCache = new Map();
const fpOf = src => [src.name, src.file ? src.file.size : 0, src.file ? src.file.lastModified : 0].join('|');
function aiStat(t, err){ const el = $('aistat'); el.hidden = !t; el.textContent = t || '';
  if(!t) tasks.clear('ai'); else if(/…$/.test(t)) tasks.start('ai', 'ai', 'Shubix at work', t.replace(/…$/, '')); else if(err) tasks.fail('ai', t); else if(tasks.has('ai')) tasks.done('ai', t); el.style.color = err ? 'var(--drop)' : ''; }
// The AI's view of footage [a,b]: frames nearby (same scene only), weighted by distance
// what a clip is about: the vision AI's subjects seen in at least a third of its frames (one stray frame says little)
function aiTags(src){
  const F = aiOn && src.ai ? src.ai.frames : [], n = {};
  F.forEach(f=>(f.tags||[]).forEach(t=>{ n[t] = (n[t]||0) + 1; }));
  return Object.keys(n).filter(t=>n[t]*3 >= F.length);
}
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
// Create (/create/*): Shubix AI waits for Generate Reel (computers) or Next on the clips (phones), so the clips can be
// put in order first and nothing is asked while they are chosen; upsell() lets it go. (The phone app's /engine page and
// an opened Reel: as before.)
let aiHeld = location.pathname.startsWith('/create');
// …and the API (asleep after a quiet while: 20-30 s to wake) is woken now, so Generate does not wait for it
if(aiHeld) fetch('/api/health').catch(() => {});
async function aiRun(){
  if(!aiOn || aiBusy || !sources.length) return;
  if(!aiReelOk()){ aiBusy = true; const go = await aiGate(); aiBusy = false; if(!go) return; }
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
        body: JSON.stringify({ reelId: reelIdNow(), clips: part.map(j=>({ id:j.id, name:j.src.name, frames:j.frames })) }) });
      const res = await r.json().catch(()=>({}));
      if(!r.ok) throw new Error((res.error && res.error.message) || ('Shubix could not do this step (' + r.status + ').'));
      charged += res.charged || 0; if(typeof res.balance === 'number' && aiInfo){ aiInfo.balance = res.balance; window.dispatchEvent(new Event('brs-credits')); }
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
    aiGaveUp = reelIdNow();   // nothing more comes from Shubix for this Reel: it is final as the phone made it
    console.warn('AI picks not used:', e); aiStat('Shubix could not look at your clips right now. Your Reel uses the best moments picked on your phone' + (aiCostOf('reel') && dirPlannedReel !== reelIdNow() ? ' · no credits were used.' : '.'));
  }
}
function aiDone(charged, failed){
  const withAi = sources.filter(s=>s.ai), n = withAi.reduce((q,s)=>q+s.ai.frames.length, 0);
  aiStat('Shubix scored ' + n + ' moments in ' + withAi.length + ' clip' + (withAi.length>1?'s':'') + (failed ? ' (' + failed + ' skipped)' : '') + (charged ? ' · ' + charged + ' credit' + (charged>1?'s':'') : ''));
  if(buf && sources.length && !recording) makeEdit();
}
/* ---- Ask Shubix: the creator says in their own words how the Reel should be ("faster", "zoom on the drop", "start
 * with my face"), and the AI edits it that way. Everything they said (newest last) goes with the AI's pace and plan as
 * the creator's wish, which wins over the style and over the house taste (tastePlan / tasteFx step aside for the AI's
 * choices then). A few plain words also work without the AI: faster / calmer switch the style, "new version" remixes. */
let wish = '', chatMsgs = [], chatWaiting = false, chatAsk = null, chatN = 0;
// asked for anything in the chat: the AI's choices stand (the house taste steps aside)
// the AI's plan is applied as it is: its transitions, keyframes and effects are not cut back by the rules' taste (that is
// for a Reel made without the AI); what the creator asks for in Ask Shubix comes first
const aiTrusted = () => aiOn && !!director && director.key === dirKey();
function chatSay(who, text, wait){
  const p = document.createElement('p'); p.className = who + (wait ? ' wait' : ''); p.textContent = text;
  $('chatlog').appendChild(p); $('chatlog').scrollTop = $('chatlog').scrollHeight; return p;
}
function chatClearWait(){ $('chatlog').querySelectorAll('.wait').forEach(x => x.remove()); }
function chatAnswer(text){ chatClearWait(); chatSay('ai', text); chatMsgs.push({ who: 'ai', text }); chatWaiting = false; $('chatsend').disabled = false; }
let chatPending = null, chatReported = '';
// the AI's plan arrived: asked for in the chat, it is shown as a report and waits for Generate; otherwise it is used
function dirArrived(key, d){
  if(chatWaiting){ const ask = chatMsgs.filter(m => m.who === 'me').slice(-1)[0]?.text || ''; chatPending = { key, slots: d.slots, story: d.story || '', texts: d.texts, actions: d.actions, cost: chatCost, intent: parseDirectorVisualIntent(ask) }; chatProposal(chatPending); return false; }
  director = { key, slots: d.slots, story: d.story || '', texts: d.texts, actions: d.actions }; dirCache.set(key, director); if(d.texts || d.actions) queueMicrotask(() => void aiApply(d)); return true;   // (after the shots are made: makeEdit)
}
// the plan, shot by shot, in words: which clip and what is in it, the transition into it, its effect, speed and keyframes
function planReport(slots, story, changed){
  const box = document.createElement('div'); box.className = 'ai rep';
  const n = plan.length, tr = slots.filter((d,i) => i && d && d.tr && d.tr !== 'hard').length, fx = slots.filter((d,i) => d && d.fx && d.fx !== 'none' && !(i === 0 && d.fx === 'hook')).length,
    keys = slots.reduce((a,d) => a + (d && d.keys ? d.keys.length : 0) + (d && d.move && d.move.length ? 1 : 0), 0);
  const head = document.createElement('b');
  head.textContent = changed && changed.size ? 'Shubix changes ' + (changed.size === 1 ? 'shot ' : 'shots ') + [...changed].sort((a, b) => a - b).map(i => i + 1).join(', ') + ' (the rest stays as it is)'
    : 'Shubix\'s plan: ' + n + ' shots · ' + tr + ' transitions · ' + fx + ' effects · ' + keys + ' keyframes';
  box.appendChild(head);
  if(story){ const p = document.createElement('span'); p.className = 'repstory'; p.textContent = story; box.appendChild(p); }
  const det = document.createElement('details'), sum = document.createElement('summary'), ol = document.createElement('ol');
  sum.textContent = changed && changed.size ? 'See the change' : 'See every shot'; det.appendChild(sum); if(changed && changed.size) det.open = true;
  plan.forEach((s, i) => {
    if(changed && changed.size && !changed.has(i)) return;
    const d = slots[i] || {}, li = document.createElement('li'), c = d.cand, src = c ? sources[c.src] : null;
    if(changed && changed.has(i)) li.className = 'chg';
    const cand = c && dirCands && (dirCands[i] || []).find(x => x.si === c.src && Math.abs(x.a - c.in) < 0.05);
    const what = (cand && cand.note) || (src && src.ai && src.ai.summary) || '';
    const bits = [];
    if(i && d.tr && d.tr !== 'hard') bits.push('↪ ' + (TR_NAME[d.tr] || d.tr));
    if(d.fx && d.fx !== 'none') bits.push('✦ ' + (d.fx === 'hook' ? 'Hook' : FX_NAME[d.fx] || d.fx));
    if(d.sp && d.sp !== 'normal') bits.push('⏱ ' + d.sp);
    if(d.keys && d.keys.length) bits.push('◆ ' + d.keys.map(k => k.do).join(', '));
    if(d.move && d.move.length) bits.push('◆ camera move');
    li.textContent = fmt(s.start).replace(/\.\d+$/, '') + ' · ' + (src ? src.name.replace(/\.[^.]+$/, '') + (c ? ' @' + c.in.toFixed(1) + 's' : '') : 'best moment') + (what ? ' — ' + what : '') + (s.type === 'drop' ? ' · DROP' : s.type === 'break' ? ' · break' : '') + '\n' + (bits.length ? bits.join('  ') : 'clean cut, no effect') + (d.why ? ' · ' + d.why : '');
    ol.appendChild(li);
  });
  det.appendChild(ol); box.appendChild(det);
  return box;
}
function chatProposal(pd){
  chatClearWait();
  const box = planReport(pd.slots, pd.story, pd.changed), go = document.createElement('button');
  go.type = 'button'; go.className = `${Button.primary} repgo`; go.textContent = 'Generate Reel';
  go.addEventListener('click', () => chatGenerate(go), SIG);
  box.appendChild(go); $('chatlog').appendChild(box); $('chatlog').scrollTop = $('chatlog').scrollHeight;
  chatMsgs.push({ who: 'ai', text: 'Plan ready: ' + (pd.story || plan.length + ' shots') });
  chatWaiting = false; $('chatsend').disabled = false;
}
function applyChatVisualIntent(intent, slots = []){
  if(!intent || (!intent.openingText && !intent.squareFrameAll && !intent.transitionAll && !intent.effectsAll)) return '';
  if(!buf || !edit.length) throw new Error('The Reel is not ready for visual edits.');
  const D = reelLen();
  const next = overlays
    .filter(ov => !(intent.squareFrameAll && ov.kind === 'squareFrame') && !(intent.openingText && ov.aiIntent === 'openingText'))
    .map(ov => ({ ...ov, start: ov.t0, end: ov.t1, size: ov.size * 36 }));
  if(intent.openingText){
    next.push({ id: ++ovSeq, aiIntent: 'openingText', start: 0, end: Math.min(D, 2.8), text: intent.openingText,
      style: 'bold', color: '#FFFFFF', anim: 'pop', x: 0.5, y: 0.3, size: 48,
      uk: [
        { t: 0, x: 0, y: 0, s: 0.55, r: 0, o: 0, ez: 'outBack' },
        { t: 0.18, x: 0, y: 0, s: 1.12, r: 0, o: 1, ez: 'outBack' },
        { t: 0.42, x: 0, y: 0, s: 1, r: 0, o: 1, ez: 'inOut' }
      ] });
  }
  let frameCount = 0;
  if(intent.squareFrameAll){
    edit.forEach(shot => {
      const start = Math.max(0, Number(shot.start) || 0), end = Math.min(D, Number(shot.end) || D);
      if(end <= start) return;
      next.push({ id: ++ovSeq, kind: 'squareFrame', start, end, frameColor: '#FFFFFF', frameWidth: 0.008 });
      frameCount++;
    });
  }
  let transitionCount = 0, effectCount = 0;
  let plannedTransitions = null, plannedEffects = null;
  if(intent.transitionAll){
    const valid = key => Object.prototype.hasOwnProperty.call(TR_DUR, key) && !isLocked('tr', key);
    const available = Object.keys(TR_DUR).filter(key => key !== 'hard' && valid(key));
    if(!available.length) throw new Error('No unlocked transition is available for every clip.');
    const counts = new Map();
    slots.forEach((slot, i) => {
      const key = slot && slot.tr;
      if(i > 0 && key && key !== 'hard' && valid(key)) counts.set(key, (counts.get(key) || 0) + 1);
    });
    const preferred = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
      || (valid('dissolve') ? 'dissolve' : available[0]);
    plannedTransitions = edit.map((shot, i) => {
      const modelChoice = slots[i] && slots[i].tr;
      const requested = intent.transitionType;
      if(requested && !valid(requested)) throw new Error('That transition is locked or unavailable on your plan.');
      let transition = requested || (modelChoice && valid(modelChoice) && modelChoice !== 'hard' ? modelChoice : (i === 0 ? 'fadein' : preferred));
      if(!valid(transition)) transition = i === 0 && valid('fadein') ? 'fadein' : preferred;
      if(!valid(transition)) transition = available[0];
      return transition;
    });
    transitionCount = plannedTransitions.length;
  }
  if(intent.effectsAll){
    const allowed = FX_OK[mode] || FX_OK.auto;
    const canUse = (fx, i) => !!fx && fx !== 'none' && Object.prototype.hasOwnProperty.call(FX_NAME, fx)
      && (fx === 'hook' ? i === 0 : allowed.includes(fx))
      && !isLocked('fx', fx);
    let previousEffect = '';
    plannedEffects = edit.map((shot, i) => {
      const proposed = slots[i] && (slots[i].fx || slots[i].effect);
      const roleChoices = shot.type === 'drop' ? ['zoomburst', 'punch', 'shake', 'punch-soft']
        : shot.type === 'hit' ? ['punch', 'tilt', 'bounce', 'shake', 'punch-soft']
        : shot.type === 'break' ? ['drift', 'pan-soft', 'punch-soft']
        : ['punch-soft', 'pan-soft', 'drift', 'bounce', 'tilt'];
      const choices = mode === 'smooth' ? ['pan-soft', 'drift'] : roleChoices;
      if(i === 0) choices.unshift('hook');
      let chosen = canUse(proposed, i) && (proposed !== previousEffect || i === 0) ? proposed : null;
      if(!chosen) chosen = choices.find(fx => fx !== previousEffect && canUse(fx, i)) || choices.find(fx => canUse(fx, i));
      if(!chosen) throw new Error('A suitable unlocked effect was not available for every clip. No partial visual edits were applied.');
      previousEffect = chosen;
      return chosen;
    });
    effectCount = plannedEffects.length;
  }
  // Commit only after every requested change has a valid choice for every clip.
  if(plannedTransitions){
    edit.forEach((shot, i) => {
      shot.tr = plannedTransitions[i];
      shot.trd = undefined;
      shot.trByDir = true;
    });
  }
  if(plannedEffects){
    edit.forEach((shot, i) => {
      shot.efx = plannedEffects[i];
      shot.fxByDir = true;
      shot.kf = keyframesFor(shot);
    });
  }
  if(plannedTransitions || plannedEffects){
    renderEDL(true);
    redrawFrame();
  }
  setOverlaysFromNative(next);
  const textApplied = !intent.openingText || overlays.some(ov => ov.text === intent.openingText && ov.aiIntent === 'openingText');
  const framesApplied = !intent.squareFrameAll || overlays.filter(ov => ov.kind === 'squareFrame').length >= frameCount;
  const transitionsApplied = !intent.transitionAll || (transitionCount === edit.length
    && edit.every(shot => shot.tr && Object.prototype.hasOwnProperty.call(TR_DUR, shot.tr)));
  const effectsApplied = !intent.effectsAll || (effectCount === edit.length && edit.every(shot => shot.efx && shot.efx !== 'none' && Object.prototype.hasOwnProperty.call(FX_NAME, shot.efx)));
  if(!textApplied || !framesApplied || !transitionsApplied || !effectsApplied || (intent.squareFrameAll && frameCount !== edit.length)){
    throw new Error('The requested visual edit could not be verified in the Reel.');
  }
  redrawFrame();
  const applied = [];
  if(intent.openingText) applied.push('opening text “' + intent.openingText + '”');
  if(intent.squareFrameAll) applied.push('square frame on all ' + frameCount + ' clips');
  if(intent.transitionAll) applied.push('transitions on all ' + transitionCount + ' clips');
  if(intent.effectsAll) applied.push('effects on all ' + effectCount + ' clips');
  return applied.join(' and ');
}
async function chatGenerate(btn){
  remakeOk();
  const pd = chatPending; btn.disabled = true;
  if(!pd || pd.key !== dirKey()){ chatAnswer('The Reel changed since this plan. Tell me again what you want and I\'ll plan it anew.'); return; }
  chatPending = null; chatReported = pd.key; director = { key: pd.key, slots: pd.slots, story: pd.story }; dirCache.set(pd.key, director);
  let applied = '';
  try {
    makeEdit(); await aiApply(pd);
    applied = applyChatVisualIntent(pd.intent, pd.slots);
    if(!edit.length) throw new Error('The Reel timeline could not be verified after applying the plan.');
  } catch(error) {
    btn.textContent = 'Not applied';
    chatAnswer('I could not verify that every requested change was applied. ' + String(error && error.message || error) + ' The Reel was not marked as generated; please try the instruction again.');
    return;
  }
  if(!playing && !recording && buf && edit.length) startPlayback(0);
  btn.textContent = 'Generated ✓';
  const bal = aiBal();
  chatAnswer('Your new Reel is ready ✓' + (applied ? ' Applied: ' + applied + '.' : '') + (!pd.cost && aiFreeChats() ? ' Free change · ' + (Math.max(0, aiFreeChats() - chatUsed) ? Math.max(0, aiFreeChats() - chatUsed) + ' free left for this Reel.' : 'next changes use credits.') : '') + (pd.cost ? ' ' + creditWord(pd.cost) + ' used' + (bal != null ? ' · ' + creditWord(bal) + ' left' : '') + '.' : '') + ' Not quite right? Tell me what to change and I\'ll check it again.');
}
// a plan the AI made by itself (no chat): its report goes into the chat too, and the button shows there is one
function chatReportAuto(){
  if(chatWaiting || chatPending || !aiOn || !director || director.key !== dirKey() || chatReported === director.key) return;
  chatReported = director.key; $('chatlog').appendChild(planReport(director.slots, director.story)); $('chatfab').classList.add('news'); $('tbchat').classList.add('news');
}
// the phone app's Ask Shubix: the website's own chat (the same AI, its credit questions asked on the phone); the plan it
// makes is applied at once (the phone has no Generate button of the studio's), and the answer goes back to the phone
async function chatApp(text){
  const before = chatMsgs.length;
  await chatSend(text);
  const t0 = Date.now(), wait = ms => new Promise(r => setTimeout(r, ms));
  while((chatWaiting || dirBusy || paceBusy) && Date.now() - t0 < 240000) await wait(300);
  let applied = false;
  if(chatPending && chatPending.key === dirKey()){
    const pd = chatPending; chatPending = null; chatReported = pd.key;
    director = { key: pd.key, slots: pd.slots, story: pd.story }; dirCache.set(pd.key, director);
    makeEdit(); await aiApply(pd); try{ applyChatVisualIntent(pd.intent, pd.slots); }catch(e){}
    applied = !!edit.length; if(applied){ chatMsgs.push({ who: 'ai', text: 'Done ✓' }); saveNow(); }
  }
  const said = chatMsgs.slice(before).filter(m => m.who === 'ai').map(m => m.text).filter(t => t !== 'Done ✓').pop() || '';
  return { applied, answer: applied ? 'Done ✓ Your Reel is edited the way you asked' + (director && director.story ? ': ' + director.story : '.') : said || (chatWaiting ? 'Shubix is still working on it. Ask again in a moment.' : 'OK') };
}
function chatDone(story){ if(!chatWaiting) return; chatAnswer('Done ✓ Your Reel is edited the way you asked' + (story ? ': ' + story : '.') + ' Tell me if you want anything else.'); }
function chatFail(msg){ if(chatWaiting) chatAnswer(msg); }
function chatRestore(list){
  if(!Array.isArray(list)) return; chatMsgs = list.filter(m => m && typeof m.text === 'string').slice(-20);
  $('chatlog').innerHTML = ''; chatMsgs.forEach(m => chatSay(m.who === 'me' ? 'me' : 'ai', m.text));
  wish = chatMsgs.filter(m => m.who === 'me').map(m => m.text).join(' · ').slice(-800);
}
// plain words the phone understands by itself (with or without the AI)
function chatLocal(t){
  const x = t.toLowerCase(), did = [];
  const has = (...w) => w.some(k => x.includes(k));
  if(!aiOn && has('new version', 'different version', 'another version', 'dusra', 'navin', 'नवीन')){ seed = (seed*7919 + 13) % 2147483647 || 7; mixNo++; did.push('a new version'); }
  if(has('faster', 'fast', 'energetic', 'energy', 'jalad', 'जलद', 'speed up', 'quick')){ if(mode !== 'fast'){ setModeQuiet('fast'); did.push('the Fast style'); } }
  else if(has('calm', 'slow', 'smooth', 'cinematic', 'halu', 'हळू', 'shant', 'शांत')){ if(mode !== 'smooth'){ setModeQuiet('smooth'); did.push('the Smooth style'); } }
  return did;
}
function setModeQuiet(m){ mode = m; [...$('mode').children].forEach(b => b.setAttribute('aria-pressed', b.dataset.m === m)); modeWords(m); if(buf) plan = adaptPlan(); }
let chatCost = 0;
// a small change: only the shots it is about come back from the AI; every other shot stays exactly as it is
async function chatPatch(text, n, id){
  chatWaiting = true; chatPending = null; $('chatsend').disabled = true; chatSay('ai', 'Changing just that part', true);
  const tm = timeoutSignal(45000);
  try{
    const cands = directorCandidates(); dirCands = cands;
    const { req } = dirRequest(cands), key = dirKey(), len = i => edit[i].end - edit[i].start;
    req.patch = { ask: text, current: edit.map((e, i) => ({ i, clip: 'c' + (e.src + 1), at: +e.in.toFixed(2), transition: e.tr || 'hard', effect: e.efx || 'none', speed: speedKey(e.sp) })) };
    req.chat = { n, id, text };
    const r = await fetch('/api/studio/direct', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req), signal: tm.signal });
    const res = await r.json().catch(() => ({}));
    if(!r.ok) throw new Error((res.error && res.error.message) || ('Shubix could not change it (' + r.status + ').'));
    chatSync(res); if(typeof res.balance === 'number' && aiInfo){ aiInfo.balance = res.balance; window.dispatchEvent(new Event('brs-credits')); }
    const base = director && director.key === key ? director.slots.slice() : edit.map((e, i) => ({ cand: { src: e.src, in: e.in }, tr: e.tr, fx: e.efx, sp: speedKey(e.sp),
      keys: (e.acc || []).map(q => ({ at: q.at, do: q.do })), move: (e.ak || []).map(q => ({ at: q.t / Math.max(0.05, len(i)), s: q.s, x: q.x, y: q.y, r: q.r, ez: q.ez })), cs: e.cs || null, why: '' }));
    const got = toSlots(res.slots, cands), changed = new Set();
    got.forEach((x, i) => { if(x && base[i] !== undefined){ base[i] = { ...x, cand: x.cand || base[i].cand }; changed.add(i); } });
    const intent = parseDirectorVisualIntent(text);
    if(intent.transitionAll || intent.effectsAll) edit.forEach((_, i) => changed.add(i));
    if(!changed.size && !intent.openingText && !intent.squareFrameAll && !intent.transitionAll && !intent.effectsAll){ chatAnswer('I could not tell which shot to change. Name it, e.g. "shot 3: slow-mo" or "the first clip: the dance".'); return; }
    chatPending = { key, slots: base, story: res.story || '', texts: res.texts, actions: res.actions, changed, cost: chatCost, intent };
    chatProposal(chatPending);
  }catch(e){ chatFail(tm.timedOut() ? 'Shubix took too long this time. Try again in a moment.' : String(e && e.message || 'Shubix could not change it right now.')); }
  finally{ tm.done(); }
}
async function chatSend(text){
  remakeOk();
  text = String(text || '').trim().slice(0, 300); if(!text || chatWaiting) return;
  chatSay('me', text); chatMsgs.push({ who: 'me', text });
  $('chatin').value = ''; chatFit();
  const ready = buf && sources.length && edit.length && !recording;
  // Explicit, deterministic visual edits are applied locally on every plan. They do not need
  // a model round-trip, a credit check or a server upload; verify the full scope before replying.
  const localVisualIntent = parseDirectorVisualIntent(text);
  const hasLocalVisualIntent = !!(localVisualIntent.openingText || localVisualIntent.squareFrameAll
    || localVisualIntent.transitionAll || localVisualIntent.effectsAll);
  if(ready && hasLocalVisualIntent){
    try{
      const before = histSnap();
      const localSlots = edit.map(shot => ({ tr: shot.tr || 'hard', fx: shot.efx || 'none', effect: shot.efx || 'none' }));
      if(playing) stopAll();
      const applied = applyChatVisualIntent(localVisualIntent, localSlots);
      if(!applied) throw new Error('No supported visual change was detected.');
      hist.u.push(before); if(hist.u.length > HIST_MAX) hist.u.shift();
      hist.r = []; hist.cur = histSnap(); hist.cand = ''; histUI();
      saveNow();
      chatAnswer('Done ✓ Applied ' + applied + ' to the current Reel on this device. No Shubix AI credits used.');
    }catch(error){
      chatAnswer('I could not verify that every requested change was applied. ' + String(error && error.message || error));
    }
    return;
  }
  // no Shubix AI in this plan (Free): the phone's own changes, and the way to get the AI
  if(!aiOn){
    const did = chatLocal(text);
    if(ready && did.length) makeEdit();
    chatAnswer((did.length ? 'Done ✓ I used ' + did.join(' and ') + ' (on your phone). ' : '') + (aiLocked && IN_APP ? 'Changing the Reel from your words is Shubix AI, which is not on your plan.' : aiLocked ? 'Changing the Reel from your words is Shubix AI: it is in the Editor and Pro plans.' : 'Shubix AI is off for this Reel, so I can only switch the style (say "faster" or "calmer") or make a new version.'));
    if(aiLocked && !IN_APP){ const a = document.createElement('a'); a.href = '/pricing'; a.className = `${Button.primary} up`; a.textContent = 'See Editor & Pro'; $('chatlog').appendChild(a); }
    return;
  }
  if(!ready){ wish = chatMsgs.filter(m => m.who === 'me').map(m => m.text).join(' · ').slice(-800); chatAnswer('Got it! I\'ll edit your Reel this way as soon as it is made.'); return; }
  if(!aiReelOk() && !(await aiGate(root.classList.contains('aineed')))){ chatAnswer('This Reel is edited on your phone, so I can only switch its style (say "faster" or "calmer").'); return; }
  // what this change costs, asked first: a few named shots or the whole Reel
  const size = chatSize(text), freeN = aiFreeChats(), free = bal0 => bal0 !== null && chatUsed < freeN, bal = aiBal();
  const cost = free(bal) ? 0 : aiCostOf(size === 'small' ? 'small' : 'big');
  if(free(bal)){
    const left = freeN - chatUsed - 1;
    const ok = await askCredits({ title: size === 'small' ? 'A small change · free' : 'Change the whole Reel · free', text: (size === 'small' ? 'Shubix changes only the shots you named; the rest stays as it is. ' : 'Shubix plans the whole Reel again with what you asked. ') + 'Your plan has ' + freeN + ' free changes per Reel: this one is free, ' + (left ? left + ' more free after it.' : 'after it each change uses credits.'), bal, ok: 'Make the change', no: 'Cancel' });
    if(!ok){ chatAnswer('OK, nothing changed.'); return; }
  } else if(!cost || bal === null){
    const ok = await askCredits({ title: size === 'small' ? 'A small change' : 'Change the whole Reel', text: (size === 'small' ? 'Shubix changes only the shots you named; the rest stays as it is. ' : 'Shubix plans the whole Reel again with what you asked. ') + (cost ? 'It uses ' + creditWord(cost) + '.' : 'Included in your plan.'), bal, ok: 'Make the change', no: 'Cancel' });
    if(!ok){ chatAnswer('OK, nothing changed.'); return; }
  } else if(cost && bal !== null){
    if(bal < cost){ chatAnswer('This change needs ' + creditWord(cost) + ' and you have ' + creditWord(bal) + '.'); if(!IN_APP){ const a = document.createElement('a'); a.href = '/pricing'; a.className = `${Button.primary} up`; a.textContent = 'Top up'; $('chatlog').appendChild(a); } return; }
    const ok = await askCredits({ title: size === 'small' ? 'A small change' : 'Change the whole Reel', text: (size === 'small' ? 'Shubix changes only the shots you named; the rest stays as it is. ' : 'Shubix plans the whole Reel again with what you asked. ') + (freeN ? 'The ' + freeN + ' free changes for this Reel are used, so this' : 'It') + ' uses ' + creditWord(cost) + '.', bal, after: bal - cost, ok: 'Use ' + creditWord(cost), no: 'Cancel' });
    if(!ok){ chatAnswer('OK, nothing changed and no credits used.'); return; }
  }
  chatCost = cost; const n = ++chatN, id = newId();
  if(size === 'small') return chatPatch(text, n, id);
  chatLocal(text);
  wish = chatMsgs.filter(m => m.who === 'me').map(m => m.text).join(' · ').slice(-800);
  chatAsk = { n, id, text };
  chatWaiting = true; chatPending = null; $('chatsend').disabled = true; chatSay('ai', 'Planning your Reel: checking every clip', true);
  dirFailedKey = ''; paceFailedKey = '';
  const asked = chatMsgs.length;
  makeEdit();
  // an answer that never comes (the AI waits for the clips' check, or nothing was asked): not a spinner for ever
  setTimeout(() => { if(chatWaiting && chatMsgs.length === asked) chatFail(dirBusy || paceBusy ? 'Still working on it… it is taking longer than usual. I\'ll keep going; you can ask again in a moment.' : 'Your Reel is updated.'); }, 120000);
}
// the chat's messages live where it is used: in the Ask Shubix bar under the title (the Create steps), or in the chat panel
function chatInline(on){
  const log = $('chatlog'), home = on ? $('askbody') : $('chatbox');
  if(log.parentElement === home) return;
  if(on) home.insertBefore(log, home.firstChild); else home.insertBefore(log, $('chatbox').querySelector('.chatideas'));
  $('askbar').classList.toggle('talking', on && !!log.children.length);
}
function chatOpen(on){ if(on) chatInline(false); $('chatfab').classList.remove('news'); $('tbchat').classList.remove('news'); $('chatbox').hidden = !on; $('chatfab').setAttribute('aria-expanded', String(on)); $('chatfab').hidden = on;
  if(on){ if(!chatMsgs.length && !$('chatlog').children.length) chatSay('ai', 'Hi! Tell me how you want this Reel: the mood, the pace, which moments, zooms, transitions, slow-mo… I\'ll edit it that way.'); $('chatin').focus(); } }
// the Ask Shubix bar under the page title (the Create steps): opens on a tap, ready to type; the talk stays in it (no panel)
const inSteps = () => root.classList.contains('fopen') && getComputedStyle($('askbar')).display !== 'none';
function askBar(on, focus = true){
  $('askbar').classList.toggle('open', on); $('asktoggle').setAttribute('aria-expanded', String(on));
  if(on){ chatOpen(false); chatInline(true); if(focus) setTimeout(() => { $('askbar').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); $('askin').focus(); }, 60); }
}
const askFromBar = (text) => { text = String(text || '').trim(); if(!text){ $('askin').focus(); return; } if(chatWaiting) return; $('askin').value = ''; askBar(true, false); chatSend(text); $('askbar').classList.add('talking'); };
$('asktoggle').addEventListener('click', () => askBar(!$('askbar').classList.contains('open')), SIG);
// the button and the card take people to the bar while it is on screen; the chat panel otherwise (the editor)
$('chatfab').addEventListener('click', () => inSteps() ? askBar(true) : chatOpen(true), SIG);
$('chatcard').addEventListener('click', () => inSteps() ? askBar(true) : chatOpen(true), SIG); // computers: the card under the Reel Preview
$('askbar').addEventListener('submit', e => { e.preventDefault(); askFromBar($('askin').value); }, SIG);
$('askchips').addEventListener('click', e => { const b = e.target.closest('button'); if(b) askFromBar(b.dataset.say); }, SIG);
$('chatclose').addEventListener('click', () => chatOpen(false), SIG);
$('chatform').addEventListener('submit', e => { e.preventDefault(); chatSend($('chatin').value); }, SIG);
$('chatin').addEventListener('keydown', e => { if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); chatSend($('chatin').value); } }, SIG);
// the message box grows with what is written (up to a few lines)
const chatFit = () => { const t = $('chatin'); t.style.height = 'auto'; t.style.height = Math.min(120, t.scrollHeight) + 'px'; };
$('chatin').addEventListener('input', chatFit, SIG);
$('chatchips').addEventListener('click', e => { const b = e.target.closest('button'); if(b) chatSend(b.dataset.say); }, SIG);
/* ---- AI director: one text call plans the Reel as a story ----
   The cut times are fixed by the music. For every cut the phone offers its 3 best different moments (rules + AI scores);
   the director picks one per cut plus its transition, effect and speed. Every choice is then checked here: the moment
   must still be free (no footage twice, no scene crossing, not the same clip as a neighbour), the transition must fit
   the shot and the style and stay within its ration, effects and speeds must suit the cut. Whatever fails keeps the
   rule choice. One plan per edit (style, mix and clips); a new mix or style asks again. */
let director = null, dirBusy = false, dirFailedKey = '', dirCands = null, dirPlannedReel = '', aiGaveUp = '';   // dirPlannedReel: this Reel got a plan (its credits are spent)
const dirKey = () => [wish, tplKind, mode, mode === 'copy' && refProfile ? refProfile.name + '|' + refProfile.dur : '', mixNo, plan.length, plan.map(s=>s.start.toFixed(2)).join(','), sources.map(fpOf).join(';')].join('#');
let mixNo = 0;   // which mix: 0 = the AI's plan, 1-4 = its other mixes (one call), then the phone's own mixes in its style
const dirSlotOf = i => { const d = (aiOn && director && director.key===dirKey() && director.slots[i]) || null; return d && !d.auto ? d : null; };   // an auto cut: the phone picks its moment too
const dirShot = i => { const d = dirSlotOf(i); return d && d.cand ? d.cand : null; };
// the beat shapes and beat effects (drawn in drawFrameGL; see shapeAt)
const BEAT_FX = ['boxgrow','grid','strips','circle','heartbeat','starbeat','frame','mirror','kaleido','triple','vhs','strobe','rgbpulse','blurpulse'];
const FX_OK = { smooth: ['none','pan-soft','drift'], auto: ['none','zoomburst','punch','punch-soft','tilt','shake','bounce','pan','pan-soft','drift','snap'], fast: ['none','zoomburst','punch','punch-soft','tilt','shake','bounce','pan','pan-soft','drift','snap'] };
FX_OK.auto.push(...BEAT_FX); FX_OK.fast.push(...BEAT_FX); FX_OK.smooth.push('frame', 'circle');
FX_OK.copy = FX_OK.auto;
// the director's transitions / effects / speeds, each checked; returns how many were used and how many were corrected
function applyDirectorStyle(){
  if(!aiOn || !director || director.key !== dirKey()) return null;
  let used = 0, fixed = 0, asked = 0;
  const exact = copyExact();
  plan.forEach((s,i)=>{
    const d = director.slots[i], len = s.end - s.start;
    if(exact && !wish && !chatN) return;   // copying a Reel exactly: its own transitions, effects and moves (copyShots), the AI picks the moments; what the creator asks in the chat changes them
    // The AI decides the whole Reel: the rules' own choices (styleEdit: a bounce, a shake, a hook, a speed) go, and what
    // the AI leaves out of a shot stays plain (its answer's own defaults: a hard cut, no effect, normal speed)
    // a cut the AI gave no usable answer for (or left out) keeps the phone's own choices, never a bare hard cut
    if(!d || d.auto) return;
    s.tr = 'hard'; s.efx = 'none'; s.sp = SPEED.normal; s.trByDir = false; s.fxByDir = false; s.ak = []; s.acc = [];
    // The AI's transition and effect are used as it chose them, every one (no style filter, no count limit): only a tool
    // the plan does not include, or one the studio does not know, is left out (finishTransitions only shortens one to fit)
    if(d.tr){ asked++; const tr = d.tr;
      const ok = i===0 ? (tr==='hard' || tr==='fadein') : tr in TR_DUR && !isLocked('tr', tr);
      if(ok){ s.tr = tr; s.trByDir = true; used++; } else fixed++;
    }
    if(d.fx){ asked++; const fx = d.fx;
      if(fx in FX_NAME && !isLocked('fx', fx)){ s.efx = fx; s.fxByDir = true; used++; } else fixed++;
    }
    // speed: the AI's, in any style (a velocity on a shot without a beat inside rides a ramp instead)
    if(d.sp){ asked++; const bl = beats.filter(b=>b>s.start+0.15 && b<s.end-0.1).map(b=>b-s.start);
      const sp = d.sp==='velocity' ? (bl.length ? velocitySpeed(len, bl) : rampSpeed(len)) : d.sp==='ramp' ? rampSpeed(len) : d.sp==='freeze' ? snapSpeed : d.sp==='hold' ? holdSpeed : SPEED[d.sp];
      if(sp){ s.sp = sp; used++; } else fixed++;
    }
    if(s.efx==='snap' && s.sp!==snapSpeed) s.sp = snapSpeed;   // the photo snap is a freeze by definition
    // the camera moves inside the shot: the AI's keyframes (at = fraction of the shot), on top of the shot's framing;
    // its effect steps aside (a zoom effect and a zoom keyframe would fight)
    s.ak = [];
    if(d.move && d.move.length >= 2){ asked++;
      s.ak = d.move.map(k=>({ t: +(k.at*len).toFixed(3), s: k.s, x: k.x, y: k.y, r: k.r, o: 1, ez: k.ez || 'inOut' }));
      if(!['snap','hook'].includes(s.efx) && !(d.fx && d.fx !== 'none')) s.efx = 'none';
      used++; }
    // keyframes on the hits: every one the AI placed (a time outside the shot is brought just inside it)
    s.acc = [];
    if(d.keys && d.keys.length){ asked += d.keys.length;
      for(const k of d.keys){ if(ACCENTS.includes(k.do)){ s.acc.push({at: Math.min(Math.max(0.04, k.at), Math.max(0.04, len-0.05)), do:k.do}); used++; } else fixed++; } }
  });
  finishTransitions();
  return {used, fixed, asked};
}
// One last pass over every cut: the AI's transitions all stay (shortened to fit a short shot); the rules' own special
// transitions stay within their ration, finish well inside both shots, and the same one never runs twice in a row.
/* ---- a human editor's taste: what makes a Reel look made by a good editor, not by a random generator ----
 * Trending Reels are mostly plain cuts on the beat; a special transition only where the song changes (a drop, a break),
 * in one style for the whole Reel; a zoom only on a drop, never on shot after shot; most shots clean; shape effects
 * (heart, star, split, kaleidoscope) at most once, on a fast Reel's drop. Applied to the rules' and the AI's choices
 * alike; a copied Reel keeps its reference's own edit, and the person can still pick anything by hand afterwards. */
const TR_CLASSY = new Set(['dissolve','fadein','dip','flash','whip','zoom','glitch','slideleft','slideright','swipeup','burn','luma','blur','zoomout']);
const TR_STYLE = { smooth: ['dissolve', 'dip'], fast: ['whip', 'flash'], auto: ['flash', 'dissolve'] };
const ZOOM_FX = new Set(['bounce','zoomburst','punch','tilt','shake','jump']);
const MOVE_FX = new Set(['pan','pan-soft','drift','punch-soft']);
// an editor's recipes: each Reel gets one (by its song, and the next one with each Remix), all of them clean. What
// changes is how the drop lands (its transition and its zoom) and how a break opens; the rules around them stay.
const RECIPES = [
  { name: 'Clean cut', drop: 'flash', zoom: 'punch', brk: 'dip' },
  { name: 'Drop punch', drop: 'whip', zoom: 'zoomburst', brk: 'dissolve' },
  { name: 'Zoom in', drop: 'zoom', zoom: 'punch', brk: 'blur' },
  { name: 'Cinematic', drop: 'dissolve', zoom: 'zoomburst', brk: 'dip' },
  { name: 'Flash beat', drop: 'flash', zoom: 'zoomburst', brk: 'luma' },
];
function recipeNow(){
  let h = 0; for(const c of String(musicKey || '')) h = (h*31 + c.charCodeAt(0)) >>> 0;
  const r = RECIPES[(h + mixNo) % RECIPES.length];
  // Smooth keeps soft transitions; Fast keeps quick ones
  if(mode === 'smooth') return { ...r, drop: r.drop === 'dissolve' || r.drop === 'flash' ? r.drop : 'dissolve', brk: r.brk === 'blur' ? 'blur' : 'dip' };
  if(mode === 'fast') return { ...r, drop: r.drop === 'dissolve' ? 'whip' : r.drop };
  return r;
}
function tastePlan(){
  if(mode === 'copy' || !plan.length || !buf || aiTrusted()) return;
  const L = buf.duration, style = TR_STYLE[mode] || TR_STYLE.auto;
  const most = Math.max(1, Math.round(L / 7)), apart = Math.max(4, L / 6);
  let used = 0, last = -99, lastAcc = -99;
  // a song without a drop or a break (found): its hits, or else its long shots, are where it changes
  const marked = plan.some(s => s.type === 'drop' || s.type === 'break'), hits = plan.some(s => s.type === 'hit');
  plan.forEach((s, i) => {
    const len = s.end - s.start, prev = plan[i - 1];
    // transitions: only where the song changes, room on both sides, spaced, one style
    if(i > 0 && s.tr !== 'hard'){
      const at = s.type === 'drop' || s.type === 'break' || (songPartsRel.length ? isPartStart(s.start) : s.type === 'hit' && (!marked || s.start - last >= 2 * apart))
        || (!marked && !hits && len >= 1.5);
      const room = len >= 1 && prev && prev.end - prev.start >= 1;
      if(!at || !room || used >= most || s.start - last < apart) s.tr = 'hard';
      else {
        const rc = recipeNow();
        if(s.type === 'drop') s.tr = rc.drop; else if(s.type === 'break') s.tr = rc.brk; else if(!TR_CLASSY.has(s.tr)) s.tr = style[1];
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
// per shot, once its footage is chosen (before its keyframes are made): zooms on drops only and never two in a row, gentle
// moves on long shots, at most a third of the shots moving; photos always move gently (a still photo looks stopped)
function tasteFx(e, i, t){
  if(mode === 'copy' || aiTrusted()) return;
  const len = e.end - e.start, photo = root.classList.contains('photomode');
  if(BEAT_FX.includes(e.efx)){ if(mode === 'fast' && e.type === 'drop' && !t.shape) t.shape = true; else e.efx = 'none'; }
  if(e.efx === 'hook' && i > 0) e.efx = 'none';
  if(e.type === 'drop' && i > 0 && len >= 0.4 && e.efx !== 'snap' && !BEAT_FX.includes(e.efx)) e.efx = mode === 'smooth' ? 'zoomburst' : recipeNow().zoom;
  if(ZOOM_FX.has(e.efx)){
    const ok = e.type === 'drop' || (mode === 'fast' && e.type === 'hit' && !t.prevZoom && e.start - t.lastZoom >= 3 && !(t.drops || []).some(d => d > e.start && d - e.start < 3));
    if(!ok) e.efx = photo || len >= 2.5 ? 'pan-soft' : 'none';
  }
  if(e.efx === 'pan') e.efx = photo || len >= 2.5 ? 'pan-soft' : 'none';   // Ken Burns, without the bounce on every beat
  if(MOVE_FX.has(e.efx) && !photo){
    if(len < 2.5 || t.moves >= Math.ceil(t.n / 3)) e.efx = 'none'; else t.moves++;
  }
  if(photo && e.efx === 'none') e.efx = 'pan-soft';   // a photo always moves a little (Ken Burns); a still one looks stuck
  t.prevZoom = ZOOM_FX.has(e.efx) || e.efx === 'hook';
  if(t.prevZoom) t.lastZoom = e.start;
}
function finishTransitions(){
  const per = Math.max(1, buf.duration/30), left = {snap:Math.round(2*per), whip:Math.round(2*per), spin:Math.round(1*per), glitch:Math.round(2*per), bars:Math.round(2*per), iris:Math.round(3*per), zoom:Math.round(3*per), wipe:Math.round(2*per), dissolve:Math.round(2*per) + (mode==='smooth' ? 99 : 0), flash:Math.round(6*per) + (mode==='fast' ? 99 : 0)};
  if(mode==='copy' && copyBudget){ Object.keys(left).forEach(k=>{ left[k] = copyBudget[k] || 0; }); }   // copying a Reel: its own counts are the ration
  plan.forEach((s,i)=>{
    if(i===0 || s.tr==='hard') return;
    const len = s.end - s.start, prev = plan[i-1];
    const fit = (s.tr==='flash' || s.tr==='glitch') ? 0.9 : 0.6;   // a flash / glitch is an overlay: it needs less room than a dissolve
    let ok = TR_DUR[s.tr] <= fit*len && TR_DUR[s.tr] <= 0.8*(prev.end-prev.start);
    // a copied Reel's transition on a short shot is as quick as the Reel's own (a whip of 3 frames between shots of 0.2 s)
    s.trd = undefined;
    // the AI's own transition is never taken out: on a short shot it is just quicker (as short as the two shots allow)
    if(s.trByDir){ if(!ok) s.trd = +Math.max(1/30, Math.min(TR_DUR[s.tr] || 0, fit*len, 0.8*(prev.end-prev.start))).toFixed(3); return; }
    if(!ok && s.trByRef && copyTimed()){ const d = Math.min(TR_DUR[s.tr] || 0, 0.6*len, 0.8*(prev.end-prev.start)); if(d >= 2/30){ s.trd = +d.toFixed(3); ok = true; } }
    // the rules' choices are rationed and never repeat
    if(ok && s.tr===prev.tr && !(s.type==='break' && prev.type==='break') && mode !== 'copy') ok = false;   // (a copied Reel may repeat its transition)
    if(ok && left[s.tr]!==undefined && s.trByRef) left[s.tr]--;
    else if(ok && left[s.tr]!==undefined){ ok = left[s.tr] > 0; if(ok) left[s.tr]--; }
    if(!ok) s.tr = 'hard';
  });
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
const dirBase = () => [wish, mode, mode === 'copy' && refProfile ? refProfile.name + '|' + refProfile.dur : '', sources.map(fpOf).join(';'), song ? song.key : ''].join('#');
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
  const req = { mode, reelId: reelIdNow(), ...(tplKind ? { reelKind: tplKind } : {}), ...(chatAsk ? { chat: { n: chatAsk.n, id: chatAsk.id, text: chatAsk.text } } : {}), wish: wish.slice(-800), duration: +buf.duration.toFixed(2), bpm: +(60/period).toFixed(1), hook: hookText.slice(0,60), story: (pc && pc.story || '').slice(0,160), reference: refContext(),
    clips: sources.map((s,k)=>({ alias:'c'+(k+1), summary: (s.ai && s.ai.summary) || '', mood: (s.ai && s.ai.mood) || '' })),
    recent: recentTools(),
    allowed: { fx: Object.keys(FX_NAME).filter(k => !isLocked('fx', k)), tr: Object.keys(TR_DUR).filter(k => !isLocked('tr', k)) },
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
  // an answer that is not a list of cuts (a broken reply) gives no slots: the phone's own edit stays
  for(const d of Array.isArray(list) ? list : []){ if(!d || typeof d !== 'object' || !Number.isInteger(d.i) || d.i < 0 || d.i > 999) continue; const c = (cands[d.i]||[]).find(x=>x.id===d.shot);
    slots[d.i] = { cand: c ? {src:c.si, in:c.a} : null, tr: d.transition, fx: d.effect, sp: d.speed, keys: Array.isArray(d.keys) ? d.keys : [], move: Array.isArray(d.move) ? d.move : [], cs: d.clip && typeof d.clip === 'object' ? d.clip : null, why: d.why || '', ...(d.auto ? { auto: true } : {}) }; }
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
  if(keepSaved) return;
  if(!aiOn || dirBusy || !edit.length || recording || !aiReelOk() || refReading) return;
  if(!sources.length || sources.some(s=>!s.ai && !s.aiFailed)) return;   // after the AI has looked at the clips (or could not)
  if(paceBusy || paceWanted()) return;   // the pace first: it decides where the cuts are
  const key = dirKey(); if((director && director.key===key && !director.interim) || dirFailedKey===key) return;
  if(chatPending && chatPending.key === key) return;   // the creator's asked-for plan waits for Generate
  if(dirCache.has(key)){ if(dirArrived(key, dirCache.get(key))) makeEdit(); return; }
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
  aiStat('Shubix is making ' + VARIANTS + ' more versions for Change Reel…');
  const tm = timeoutSignal(90000);
  let n = 0;
  try{
    const cands = directorCandidates(), { req, ctx } = dirRequest(cands), sig = planSig();
    const r = await fetch('/api/studio/direct', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ ...req, variants: VARIANTS }), signal: tm.signal });
    const res = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error((res.error && res.error.message) || ('Shubix could not make the mixes (' + r.status + ').'));
    let k = 1;
    for(const pl of res.plans || []){ while(st.plans[k]) k++; st.plans[k] = { slots: toSlots(pl.slots, cands), ctx, sig, story: pl.story || '' }; n++; }
    aiStat('Shubix made ' + n + ' more version' + (n === 1 ? '' : 's') + ' · press Change Reel to see each.');
  }catch(e){
    if(!(e && e.name==='AbortError') || tm.timedOut()) console.warn('AI mixes not used:', e);
    aiStat('Change Reel uses the phone\'s own versions in Shubix\'s style.');
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
const paceKey = () => [wish, tplKind, musicKey, mode, mode === 'copy' && refProfile ? refProfile.name + '|' + refProfile.dur : '', root.classList.contains('photomode') ? 'p' : 'v', sources.length, Math.round(sources.reduce((a,s)=>a+(s.removed?0:s.dur||0),0))].join('#');
const paceUsable = () => aiOn && kind !== 'talk' && buf && beats.length >= 8 && sources.length && !recording && !(mode === 'copy' && refProfile);   // a copied Reel keeps its own rhythm
const paceNow = () => (paceUsable() && pacing && pacing.key === paceKey()) ? pacing : null;
const paceWanted = () => paceUsable() && !paceNow() && paceFailedKey !== paceKey();
// a reference's shots, kept inside what the server accepts (numbers in range, known words only)
function cleanMoments(list, max = 40){   // max: 40 for the AI's request, 200 in a fingerprint (the style library)
  const c = (v, a, b) => Math.min(b, Math.max(a, Number.isFinite(+v) ? +v : 0)), KINDS = ['start', ...Object.keys(REF_KINDS)];
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
  if(keepSaved) return;
  if(paceBusy || !paceWanted() || !aiReelOk() || refReading) return;
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
    const req = { mode, reelId: reelIdNow(), ...(tplKind ? { reelKind: tplKind } : {}), wish: wish.slice(-800), duration: +(whole ? song.buf.duration : buf.duration).toFixed(2), bpm: +(60/(whole ? song.r.period : period)).toFixed(1), clips: sources.filter(s=>!s.removed).length,
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
  // 45 s: the phone's own edit is shown and the person can go on; the request is NOT dropped (the plan is paid for): when it
  // comes later it is offered ("Use it"). 4 min: given up (the server's AI gives up before that and the credits come back).
  const tm = timeoutSignal(240000);
  let late = false;
  const soft = setTimeout(() => { late = true; dirBusy = false; dirFailedKey = key;
    aiStat('Shubix is taking longer than usual. Your Reel uses the phone\'s own smart edit for now; Shubix\'s plan comes as soon as it is ready.'); }, 45000);
  try{
    const cands = directorCandidates(); dirCands = cands;
    const { req, ctx } = dirRequest(cands), sig = planSig(), mix = mixNo, st = mixStore();
    const r = await fetch('/api/studio/direct', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(req), signal: tm.signal });
    const res = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error((res.error && res.error.message) || ('Shubix could not plan the Reel (' + r.status + ').'));
    const slots = toSlots(res.slots, cands);
    if(!slots.some(x => x && !x.auto)) throw new Error('Shubix returned no usable plan.');
    chatSync(res); if(typeof res.balance === 'number' && aiInfo){ aiInfo.balance = res.balance; window.dispatchEvent(new Event('brs-credits')); }
    if(chatAsk && req.chat) chatAsk = null;   // that chat message is answered (and charged once)
    if(!st.plans[mix]) st.plans[mix] = { slots, ctx, sig, story: res.story || '' };   // kept for the song's other parts
    if(late){
      // it came after the phone's edit was shown: offered, never swapped in under the person (or during an export)
      clearTimeout(soft);
      dirPlannedReel = reelIdNow();
      const use = () => { if(recording || exportBusy) return; dirFailedKey = ''; if(dirKey() === key){ if(dirArrived(key, { slots, story: res.story || '', texts: res.texts, actions: res.actions })) makeEdit(); } else if(buf && sources.length) directorMaybe(); };
      aiStat('Shubix\'s plan for your Reel is ready.');
      notifyAct('Shubix\'s plan for your Reel is ready.', 'Use it', use, 60000);
      return;
    }
    // the edit changed meanwhile (the song's part moved): the plan is fitted to it, or a new one asked (other clips)
    if(dirKey() !== key){ dirBusy = false; if(buf && sources.length && !recording) directorMaybe(); return; }
    dirBusy = false; dirPlannedReel = reelIdNow();
    if(dirArrived(key, { slots, story: res.story || '', texts: res.texts, actions: res.actions })) makeEdit();
  }catch(e){
    dirFailedKey = key;
    const back = aiCostOf('reel') && dirPlannedReel !== reelIdNow() ? ', and the credits for it come back.' : '.';
    if(late){ aiStat('Shubix could not plan this Reel. It keeps the phone\'s own smart edit' + back); }
    else {
      chatFail(tm.timedOut() ? 'Shubix took too long this time. Try again in a moment.' : 'Shubix could not change the Reel right now. Try again in a moment.');
      if(tm.timedOut()) aiStat('Shubix took too long this time. Your Reel uses the phone\'s own smart edit' + back);
      else if(!(e && e.name==='AbortError')){ console.warn('AI director not used:', e); aiStat('Shubix is busy right now. Your Reel uses the phone\'s own smart edit' + back); }
    }
  }finally{ clearTimeout(soft); if(!late) dirBusy = false; tm.done(); }
}
// is the studio's AI on? The administrator decides (Administration -> Features -> AI director) and the server has an AI
// provider; people never choose: when it is on, every Reel is edited by the AI. Asked at the start, and again when the
// person's account becomes known (the phone app signs the hidden studio in after it has started: account())
async function aiCheck(){
  try{
    const r = await fetch('/api/studio/rank-shots', ac ? { signal: ac.signal } : undefined); if(!r.ok) return;
    aiInfo = await r.json(); aiLocked = false; if(!aiInfo || !aiInfo.available){ aiOn = false; return; }
    // a plan without Shubix AI (Free): the phone edits; the chat and the plans say how to get it
    if(aiInfo.planAi === false){ aiOn = false; aiLocked = true; aiStat(IN_APP ? 'Edited on your phone' : 'Edited on your phone · Shubix AI is in the Editor and Pro plans'); return; }
    if(aiOn) return;
    aiOn = true;
    // a template's learned style was put on before the AI was known: the AI combines it now (its trend, this song)
    if(refProfile && refProfile.learned && refProfile.byTpl){ const sh = refProfile.shown || 'auto'; refProfile = null; learnedKind = ''; if(mode === 'copy') setMode(sh); }
    const pressed = [...$('mode').children].find(x => x.getAttribute('aria-pressed') === 'true');
    modeWords(pressed ? pressed.dataset.m : mode);
    if(sources.length && !aiHeld) aiRun();
  }catch(e){}
}
aiCheck();
// the person is known now (the phone app's sign-in reached the hidden studio): their plan, credits and Shubix AI
async function account(){ planLoad(); await aiCheck(); }
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
// a clip that is bad all through (shaky handheld, out of focus) looks fine next to itself: judged against the other
// clips. Shaky = the camera's own movement jumps around from frame to frame; soft = far fewer fine edges than the rest.
/* ---- Enough clips for the Reel? (Create) Once the clips are read, and again when the Reel's length or part changes:
 * the good footage (sharp, lit moments: the clip's own reading) against the Reel's length. Enough: said once, OK. Not
 * enough: said plainly, with the way out (a shorter Reel on the music page, or more clips), so the Reel is never filled
 * by repeating moments or slowing clips down. ---- */
const fmtS = s => s >= 60 ? Math.floor(s/60) + ':' + String(Math.round(s % 60)).padStart(2, '0') + ' min' : Math.round(s) + ' s';
function goodSecs(src){
  const S = src.samples || [], med = src.shMed || 1, usable = Math.max(0, (src.dur || 0) - TAIL);
  if(!S.length) return usable;
  return usable * S.filter(x => (x.sh || 0) / med >= 0.45 && (x.b ?? 1) >= 0.08).length / S.length;
}
let footTimer = 0, footSaid = '';
function footCheckSoon(){ if(!location.pathname.startsWith('/create') || kind === 'talk') return; clearTimeout(footTimer); footTimer = setTimeout(footCheck, 900); }
async function footCheck(){
  if(ordering || pending || !buf || !sources.length || !$('cconf').hidden) { if(ordering || pending) footCheckSoon(); return; }
  const need = buf.duration, have = Math.floor(sources.reduce((t, s) => t + goodSecs(s), 0)), n = sources.length;   // whole seconds, said the same way everywhere
  const key = (have >= need * 0.95 ? 'ok:' : 'low:') + Math.round(need) + ':' + n;
  if(key === footSaid) return; footSaid = key;
  if(have >= need * 0.95){
    await askCredits({ title: 'Your clips are good to go', text: n + ' clip' + (n > 1 ? 's' : '') + ' with ' + fmtS(have) + ' of good footage for a ' + fmtS(need) + ' Reel: every moment can be a different one.', ok: 'OK' });
    return;
  }
  const v = await askCredits({ title: 'Not enough clips for ' + fmtS(need), text: 'Your clips have ' + fmtS(have) + ' of good footage, the Reel is ' + fmtS(need) + '. Shorten the music to about ' + fmtS(Math.max(5, have)) + ', or add more clips, so no moment is repeated or slowed down.', ok: 'Shorten the music', no: 'Add more clips' });
  if(v === true) root.dispatchEvent(new CustomEvent('studio-goto', { detail: 'music' }));
  else if(v === false) $('vfile').click();
}
function clipFlaw(src){
  const key = sources.length; if(src._flaw && src._flaw.key === key) return src._flaw.v;
  const med = a => { const x = a.filter(v => isFinite(v)).sort((p,q)=>p-q); return x.length ? x[x.length>>1] : 0; };
  const S = src.samples || [];
  const jit = med(S.slice(1).map((x,i) => Math.abs((x.gx||0) - (S[i].gx||0)) + Math.abs((x.gy||0) - (S[i].gy||0))));
  const shAll = med(sources.filter(o => !o.removed && o.samples && o.samples.length).map(o => med(o.samples.map(x => x.sh))));
  const soft = shAll > 0 && sources.length > 1 ? med(S.map(x => x.sh))/shAll : 1;
  const v = (jit >= 1.5 ? 3 : 0) + (soft < 0.15 ? 3 : 0);
  src._flaw = { key, v }; return v;
}
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
  if(sharp < 0.45) sc -= 0.9; else sc += 0.25*Math.min(1.5, sharp); sc -= clipFlaw(src);   // blurry / shaky footage is avoided
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
/* ---- Clip order: "Mix all clips" (the best moments of every clip, anywhere in the Reel) or "In my order" (the clips one
 * after another, as they were added: each gets a share of the shots by its length, and its moments go in time order) ---- */
let seqOn = false;
function seqSlots(n){
  const S = sources, avg = S.reduce((a,s)=>a+s.dur,0)/S.length, w = S.map(s=>Math.min(2*avg, Math.max(0.5*avg, s.dur))), tot = w.reduce((a,b)=>a+b,0);
  const sum = c => c.reduce((a,b)=>a+b,0);
  const cnt = w.map(x => Math.max(n >= S.length ? 1 : 0, Math.round(n*x/tot)));   // every clip once while there are shots enough
  while(sum(cnt) > n){ const k = cnt.lastIndexOf(Math.max(...cnt)); cnt[k]--; }   // (fewer shots than clips: the last clips wait)
  while(sum(cnt) < n){ let k = 0, b = -Infinity; cnt.forEach((c,j)=>{ const r = n*w[j]/tot - c; if(r > b){ b = r; k = j; } }); cnt[k]++; }
  return cnt.flatMap((c, si) => Array(c).fill(si));   // shot i -> its clip
}
// In my order, the moments: each clip is walked forward only (a shot starts where the one before it in that clip ended, so
// no moment is ever used twice, and a clip once left is never come back to); a normal shot takes its clip's best moment
// within its share of what is left. In a fast part of the song (4 or more cuts in a row, each 0.5 s or less) the shots
// run on through the clip sped up (up to 40x, like a video app; the export takes the exact frame for every moment, the
// preview steps through the frames above 16x: rawRate), back to normal after it.
// A clip too short for its shots plays a little slower instead of repeating.
const SEQ_FAST = 0.5, SEQ_MAX = 40;
function seqPick(seq, res, gmax){
  const n = plan.length, lenOf = i => plan[i].end - plan[i].start, fast = new Array(n).fill(false);
  for(let i = 0; i < n;){ let j = i; while(j < n && lenOf(j) <= SEQ_FAST) j++; if(j - i >= 4) for(let k = i; k < j; k++) fast[k] = true; i = Math.max(j, i + 1); }
  for(const si of [...new Set(seq)]){
    const src = sources[si], ids = seq.map((x, i) => x === si ? i : -1).filter(i => i >= 0), foot = Math.max(0.05, src.dur - TAIL);
    const need = ids.map(i => plan[i].sp.pos(lenOf(i))), sum = a => a.reduce((x, y) => x + y, 0);
    const fastNeed = sum(need.filter((x, k) => fast[ids[k]])), spare = foot - sum(need);
    const scale = ids.map(i => spare < 0 ? Math.max(0.005, foot / sum(need)*0.98) : fast[i] && fastNeed > 0 ? Math.min(SEQ_MAX, 1 + spare*0.6/fastNeed) : 1);
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
function setSeq(on, remake = true){
  seqOn = on; root.classList.toggle('seqon', on);
  [...$('seq').children].forEach(x => x.setAttribute('aria-pressed', String((x.dataset.q === 'order') === on)));
  $('seqhelp').textContent = on ? 'Your clips play one after another, in the order you added them' : 'Shubix picks the best moments from all your clips';
  wipNote();
  if(remake && buf && sources.length && kind !== 'talk' && !restoring) makeEdit();
}
$('seq').addEventListener('click', e => { const b = e.target.closest('button'); if(b && !recording) remakeOk(); if(b && !recording) setSeq(b.dataset.q === 'order'); }, SIG);
// The Reel is made again (a clip finished reading, the AI's plan came, a setting changed). If it was playing, it goes on
// playing from the same moment instead of stopping: Play pressed while clips are read keeps playing when they are done.
function makeEdit(){
  const was = (playing || starting) && !recording && !exportBusy && kind !== 'talk', at = playing ? curTime() : pos, gen = editGen;
  makeEditNow();
  if(editGen !== gen) histRebase();   // Shubix's plan / a new edit is the start of Undo, not a step in it
  if(was && buf && edit.length && !playing && !starting && !recording) startPlayback(Math.min(Math.max(0, at), Math.max(0, buf.duration - 0.2)));
}
function makeEditNow(){
  if(refReading) return;   // the Reel to copy is being read: its copy is made right after (no ordinary Reel meanwhile)
  life({ stage: 'making the Reel', clips: sources.length });
  if(exportBusy){ remakeAfterExport = true; return; }   // a late AI answer: the video being made keeps its edit
  if(keepSaved) return;   // an opened Reel: as it was saved
  if(kind === 'talk'){ if(sources.length) buildTalk(); return; }
  if(story && storyEdit()) return;
  if(!buf || !sources.length) return;
  const keptUk = ukKeep();
  stopAll(); plan = adaptPlan(); { const pc = paceNow(); if(pc) plan = beatEdit(endWell(noFlashCuts(withPartCuts(repace(basePlan, pc.secs.map(x => ({ ...x, every: x.every === 'hits' ? 1 : x.every === 'flicker' ? 8 : x.every })), beats, buf.duration, mode)))), pc.secs); } styleEdit(); const dirInfo = applyDirectorStyle(); if(!dirInfo) finishTransitions(); tastePlan();
  const gmax = Math.max(1e-6, ...sources.flatMap(s=>s.samples.map(x=>x.m)));
  const used = sources.map(()=>[]);
  // the opening shot picks first (the first 2 seconds decide if people keep watching), then drops, hits, breaks, the rest
  // "In my order": each shot has its clip and its part of that clip (seqSlots), so the clips play one after another
  const seq = seqOn && sources.length > 1 ? seqSlots(plan.length) : null;
  const order = plan.map((s,i)=>i).sort((a,b)=>{ const pr={drop:0,hit:1,break:2,cut:3}; return (a===0?-1:pr[plan[a].type]) - (b===0?-1:pr[plan[b].type]) || a-b; });
  const res = new Array(plan.length); dupCount = 0;
  // Shared Director pass: rank the source clips once, then use its explainable quality ranking
  // as a gentle prior in the existing per-shot visual scorer. The music edit still owns timing;
  // the existing AI's explicit shot choices remain authoritative.
  const directorShots = sources.map((src, sourceIndex) => {
    const samples = src.samples || [];
    const avg = (key, fallback = 0) => samples.length ? samples.reduce((n, x) => n + (Number(x[key]) || 0), 0) / samples.length : fallback;
    const sharp = avg('sh') / Math.max(1e-6, src.shMed || 1);
    const faceScore = Math.max(0, Math.min(1, (src.faces || []).filter(x => x.n).length / Math.max(1, (src.faces || []).length)));
    const quality = Math.max(0, Math.min(1, 0.55 + (sharp - 1) * 0.18 + (avg('b') - 0.45) * 0.2 - clipFlaw(src) * 0.08));
    const aiSummary = aiAt(src, 0, src.dur);
    const motion = Math.max(0, Math.min(1, avg('m')));
    const roles = aiSummary ? aiSummary.roles : {}, tags = aiTags(src);
    return { id: String(sourceIndex), sourceIndex, duration: src.dur, sourceStart: 0, sourceEnd: src.dur,
      quality, motion, aestheticScore: aiSummary ? Math.max(0, Math.min(1, aiSummary.score || 0)) : quality,
      faceScore, subjectScore: Math.max(faceScore, Math.max(0, Math.min(1, avg('b')))),
      isHighlight: !!(aiSummary && aiSummary.score > 0.82),
      tags, isProduct: tags.includes('product'), isFood: tags.includes('food'), isLandscape: tags.includes('travel'),
      isOpening: roles.hook > 0.55, isEnding: roles.ending > 0.55, isDetail: roles.detail > 0.55,
      isAction: motion > 0.68 || roles.action > 0.55,
      isUsable: src.dur > 0.35 && quality > 0.08,
      speech: !!(src.voice && src.voice.has) };
  });
  const directorMusic = { duration: buf.duration, beats, downbeats: beats.filter((_, i) => i % 2 === 0),
    drops: plan.filter(x => x.type === 'drop').map(x => x.start),
    quietRanges: plan.filter(x => x.type === 'break').map(x => [x.start, x.end] as [number, number]) };
  const inferredMood = mode === 'fast' ? 'energetic' : mode === 'smooth' ? 'minimal' : inferAutonomousMood(directorShots, directorMusic).mood;
  const autonomousDirector = createAutonomousReelPlan({
    shots: directorShots, music: directorMusic,
    targetDuration: Math.min(180, buf.duration), aspect,
    mood: inferredMood,
    platform: /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'android' : 'web',
    intensity: mode === 'fast' ? 'bold' : mode === 'smooth' ? 'subtle' : 'balanced',
  });
  const autonomousErrors = validateAutonomousReelPlan(autonomousDirector);
  // Keep the established scorer as a safety fallback until the autonomous plan passes validation.
  const sharedDirector = autonomousErrors.length ? createDirectorPlan({
    shots: directorShots, beats, drops: plan.filter(x => x.type === 'drop').map(x => x.start),
    targetDuration: Math.min(180, buf.duration), aspect,
    mood: mode === 'fast' ? 'energetic' : mode === 'smooth' ? 'minimal' : 'cinematic',
    mobile: /Android|iPhone|iPad|iPod/i.test(navigator.userAgent),
    intensity: mode === 'fast' ? 'bold' : mode === 'smooth' ? 'subtle' : 'balanced',
  }) : autonomousDirector;
  const sharedRank = new Map(sharedDirector.shots.map((shot, rank) => [shot.sourceIndex, rank]));
  const sharedRankMax = Math.max(1, sharedDirector.shots.length - 1);
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
        const directorRank = sharedRank.get(si);
        if(directorRank != null) sc += 0.18 * (1 - directorRank / sharedRankMax); // soft preference, never overrides explicit AI picks
        const isDir = dir && dir.src===si && Math.abs(a-dir.in) < 0.26;
        if(isDir) sc += 4;   // the director's choice wins whenever the rules allow it
        if(sc>bs){ const st=w.st; bs=sc; best={src:si, in:a, scaleR, cx: st.face>0.3 ? st.fx : st.cx, cy: st.face>0.3 ? st.fy : 0.45, face: st.face, fs: st.fs, mot: w.m, ov, aiNote: w.ai ? w.ai.note : '', byDir: isDir}; }
      };
      for(let a=0; a<=src.dur-need-TAIL+1e-6; a+=stepT) tryAt(a);
      if(dir && dir.src===si && dir.in <= src.dur-need-TAIL+1e-6) tryAt(dir.in);   // its exact moment too (off the scan grid)
    });
    return best;
  };
  if(seq) seqPick(seq, res, gmax);
  else order.forEach(i=>{
    const len = plan[i].end - plan[i].start;
    let best = pick(i,false,false) || pick(i,true,false) || pick(i,true,true) || pick(i,true,true,true) || {src:0,in:0,scaleR:1,cx:0.5,cy:0.5,face:0,ov:0};
    if(best.ov > 0.001) dupCount++;
    used[best.src].push([best.in, best.in + plan[i].sp.pos(len)*best.scaleR]);
    res[i] = best;
  });
  const useCount = sources.map(()=>0);   // (players re-assigned by assignPlayers on manual edits)
  edit = plan.map((s,i)=>({...s, ...res[i], el: sources[res[i].src].els[(useCount[res[i].src]++)%3]}));
  flickBuild();   // a copied flicker montage: its stills (once per set of clips)
  const taste = { n: edit.length, moves: 0, prevZoom: false, lastZoom: -99, shape: false, drops: edit.filter(x => x.type === 'drop').map(x => x.start) };
  edit.forEach((e,i)=>{
    const d = dirSlotOf(i), shared = sharedDirector.shots.find(x => x.sourceIndex === e.src);
    e.dirWhy = d ? d.why : '';
    e.cx = 0.5 + (e.cx-0.5)*(e.face>0.3 ? 1 : 0.8);
    if(mode!=='smooth' && !e.fxByDir) suitFx(e);
    tasteFx(e, i, taste);
    // When the optional cloud AI director is unavailable, apply the shared on-device director's
    // renderable treatment as a conservative fallback. Never overwrite an explicit AI choice.
    if(!dirInfo && shared){
      if(!e.fxByDir && e.efx === 'none'){
        const fx = shared.effects.find(id => !!FX_NAME[id]);
        if(fx && (e.end - e.start) >= 0.65) e.efx = fx;
      }
      // The shared plan's transition IDs are renderer-native; keep explicit rules/AI choices intact.
      if(i > 0 && !e.trByDir && e.tr === 'hard' && shared.transition !== 'hard' && shared.transition in TR_DUR) e.tr = shared.transition;
      // Apply the shared camera keyframes to the same WebGL/2D draw path used by preview and MP4 export.
      if(!e.ak || !e.ak.length){
        const len = e.end - e.start, scaleTrack = shared.keyframes.find(track => track.property === 'scale');
        const xTrack = shared.keyframes.find(track => track.property === 'x');
        if(len >= 0.3 && scaleTrack && xTrack){
          const sourceDuration = Math.max(0.001, shared.duration);
          e.ak = [0, len].map(t => {
            const sourceTime = t / len * sourceDuration;
            return { t, s: evaluateKeyframes(scaleTrack.keyframes, sourceTime), x: evaluateKeyframes(xTrack.keyframes, sourceTime), y: 0, r: 0, o: 1, ez: 'inOut' };
          });
        }
      }
      if(e.type === 'drop' && shared.speed > 1.05 && (e.end - e.start) >= 0.4) e.sp = rampSpeed(e.end - e.start);
    }
    if(shared && !e.why) e.why = shared.reason;
    e.kf = keyframesFor(e);
    e.beatsIn = beats.filter(b=>b>e.start+0.12 && b<e.end-0.05).map(b=>b-e.start);
  });
  ukRestore(keptUk);
  setCanvas(); edit.forEach(e=>camAt(e, 0)); renderEDL();
  autoTools(); speechScan();
  $('s3').classList.remove('locked'); $('s3').classList.add('done');
  const total = sources.reduce((a,s)=>a+s.dur,0);
  $('s3st').textContent = edit.length + ' shots · ' + fmt(buf.duration) + (dupCount ? ' · ' + dupCount + ' shots reused (not enough footage)' : ' · no repeated moments');
  showCopyMatch();
  if(dupCount) showMsg(dupCount + ' shot' + (dupCount>1?'s repeat':' repeats') + ': your clips are short for this song · add more clips to avoid it', false, 'addclips');
  else $('xmsg').hidden = true;
  ['play','remix','export','cover'].forEach(id=>$(id).disabled=false);
  if(dirInfo && !director.interim){ const shots = edit.filter((e,i)=>dirShot(i)).length, kept = edit.filter(e=>e.byDir).length;
    const keys = edit.reduce((n,e)=>n+((e.acc&&e.acc.length)||0), 0);
    // what the AI really decided: the cuts it answered; the rest are the phone's (said, never hidden)
    const answered = plan.filter((_, i) => { const d = director.slots[i]; return d && !d.auto; }).length;
    if(!answered) aiStat('Shubix could not plan this Reel. Your Reel uses the phone\'s own smart edit.');
    else aiStat('Shubix planned your Reel' + (director.story ? ': ' + director.story : '') + (answered < plan.length ? ' (' + answered + ' of ' + plan.length + ' shots; the rest from your phone\'s edit)' : '') + (keys ? ' · ' + keys + ' keyframe' + (keys>1?'s':'') + ' on the hits' : '') + (answered < plan.length || director.story ? '' : '.')); }
  // made while the person was in another app (the clips read, the AI's plan arrived): they are told
  if(isHidden() && !aiBusy && !dirBusy && !paceBusy && readyToldGen !== reelIdNow()){ readyToldGen = reelIdNow(); void notifyDone('Your Reel is ready', 'Tap to preview it in Shubix', 'shubix-reel'); }
  captureLoop(); editGen++;
  paceMaybe(); directorMaybe();
  chatReportAuto();
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
      if(st.b < 0.08) sc -= 1; const sharp = st.sh/(src.shMed||1); if(sharp<0.45) sc -= 0.9; else sc += 0.25*Math.min(1.5,sharp); sc -= clipFlaw(src);
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
// move a shot's footage to another place in the Reel (drag on the timeline): the cuts stay on the beat, so each place keeps
// its time, kind and transition; the moments move along, each fitted to its new length (the clip's end is not passed)
function shotReorder(from, to){   // (not shotMove: that name is refread's camera-move reader)
  if(kind === 'talk' || !edit.length || exporting || recording) return false;
  from = Math.trunc(from); to = Math.max(0, Math.min(edit.length - 1, Math.trunc(to)));
  if(from === to || !edit[from]) return false;
  stopAll();
  const L = editOf(), KEEP = ['start', 'end', 'type', 'fx', 'tr', 'sp', 'acc', 'ak'];
  const look = L.map(x => { const c = { ...x }; KEEP.forEach(k => delete c[k]); return c; });
  const [m] = look.splice(from, 1); look.splice(to, 0, m);
  const lo = Math.min(from, to), hi = Math.max(from, to);
  for(let k = lo; k <= hi; k++){
    const slot = L[k], c = look[k], src = sources[c.src]; if(!src) return false;
    const x = { ...slot, ...c, start: slot.start, end: slot.end };
    const sp = speedFor(x.sp, x), need = sp.pos(x.end - x.start), room = Math.max(0.05, src.dur - TAIL);
    x.scaleR = need > room ? Math.max(0.05, room/need*0.98) : 1;
    x.in = Math.max(0, Math.min(x.in, room - need*x.scaleR));
    if(x.uk) x.uk = x.uk.filter(q => q.t < x.end - x.start);
    L[k] = x;
  }
  if(!restoreEdit(L)) return false;
  pos = edit[to].start + 0.05; showShot(to); notify('Shot ' + (from + 1) + ' moved to place ' + (to + 1) + '.');
  return true;
}
// the current shot's clip settings: read, change (a patch; null resets them all)
function shotCs(){ return edit.length && kind !== 'talk' ? { ...csOf(edit[segAt(pos)]), i: segAt(pos), crown: ['beauty','curve','stab'].filter(k => isLocked('tool', k)) } : null; }
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
// ripple (dragging a shot's end on the timeline): shot i ends at `to` (on the nearest beat when one is close), every
// later shot moves with it, and the last shot still ends with the song (it gives or takes the difference)
// a shot's left edge dragged (VN's trim from the start): the cut between it and the shot before moves to `to`; the shot
// before gets longer or shorter, this one starts later or earlier in its clip and still ends where it did (the rest stays)
function shotRoll(i, to){
  if(!edit.length || kind === 'talk' || exporting || recording || !edit[i] || i < 1) return false;
  const a = edit[i-1], e = edit[i];
  const nb = beats.reduce((b, x) => Math.abs(x - to) < Math.abs(b - to) ? x : b, Infinity);
  if(Math.abs(nb - to) < 0.12) to = nb;
  to = Math.max(a.start + MIN_SHOT, Math.min(e.end - MIN_SHOT, to));
  const d = to - e.start; if(Math.abs(d) < 0.01) return false;
  stopAll();
  const L = editOf(), x = L[i], rate = (e.sp && e.sp.at ? e.sp.at(0) : 1)*(e.scaleR || 1);
  let inn = d > 0 ? srcPosF(e, d) : e.in + d*rate;
  if(inn < 0){ to -= inn/rate; inn = 0; if(to - e.start > -0.01){ notify('This is the start of the clip.'); return false; } }
  const dd = to - e.start;
  L[i-1].end = to; x.start = to; x.in = inn;
  if(x.uk) x.uk = x.uk.map(q => ({ ...q, t: q.t - dd })).filter(q => q.t >= 0);
  if(!restoreEdit(L)) return false;
  changed(i - 1, true); changed(i, true);
  pos = edit[i].start + 0.05; showShot(i); return true;
}
function shotRipple(i, to){
  if(!edit.length || kind === 'talk' || exporting || recording || !edit[i]) return false;
  const D = buf.duration, e = edit[i];
  if(i === edit.length - 1){ notify('The last shot ends with the song.'); return false; }
  const nb = beats.reduce((b, x) => Math.abs(x - to) < Math.abs(b - to) ? x : b, Infinity);
  if(Math.abs(nb - to) < 0.12) to = nb;
  to = Math.max(e.start + MIN_SHOT, Math.min(D - MIN_SHOT, to));
  const d = to - e.end; if(Math.abs(d) < 0.01) return false;
  stopAll();
  const L = editOf(); L[i].end = to;
  for(let k = i + 1; k < L.length; k++){ L[k].start += d; L[k].end += d; }
  const out = L.filter(x => x.start < D - MIN_SHOT); out[out.length - 1].end = D;   // shots pushed past the song's end go
  if(!restoreEdit(out)) return false;
  changed(i, true); if(edit.length - 1 !== i) changed(edit.length - 1, true);
  pos = edit[i].start + 0.05; showShot(i);
  notify('Shot ' + (i + 1) + ' is ' + (to - edit[i].start).toFixed(1) + ' s · the shots after it moved' + (d > 0 ? ' later.' : ' earlier.'));
  return true;
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
// a made (or re-made) edit: Undo / Redo hold only what the creator changes from here (the timeline, the tools, the texts)
function histRebase(){ hist.u = []; hist.r = []; hist.cur = edit.length || overlays.length ? histSnap() : null; hist.cand = ''; histUI(); }
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
// a pop-up's changes are tried live; its ✕ puts the Reel back as it was when it opened (views.ts)
function snapRestore(s){
  if(!s || exporting || recording || restoring) return false;
  if(kind !== 'talk' && s.ed.length) restoreEdit(s.ed);
  overlays = s.ov.map(o => ({ ...o })); ovSel = -1; renderOvList();
  if(s.ly){ layers = s.ly.map(L => ({ ...L })); lySel = Math.min(lySel, layers.length - 1); lyUI(); clipMixKey = ''; }
  if(edit.length) showShot(Math.min(segAt(pos), edit.length - 1)); else redrawFrame();
  return true;
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
    tr.children[3].appendChild(sel(crownMap('tr', TR_NAME), e.tr, v=>{ noteEdit(e.type, 'tr', e.tr, v, e.trByDir); e.tr=v; e.trByDir=false; changed(i,false); }));
    const fxc = tr.children[4]; fxc.appendChild(sel(crownMap('fx', FX_NAME), e.efx, v=>{ noteEdit(e.type, 'efx', e.efx, v, e.fxByDir); e.efx=v; e.fxByDir=false; if(v==='snap'){ e.sp=snapSpeed; changed(i,true); } else { if(e.sp===snapSpeed) e.sp=SPEED.normal; changed(i,true); } }));
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
// (the tracks under the preview zoom inside their own canvas, with a pinch or − / +: components/studio/views.ts)
function setTlZoom(z){ tlZoom = Math.max(1, Math.min(8, z)); const c = $('tl'); if(c) c.style.width = (tlZoom*100) + '%';
  root.classList.toggle('tlzoomed', tlZoom > 1); drawTimeline(); }
$('addbeat').addEventListener('click', () => addMark(playing ? curTime() : pos), SIG);
$('clrbeat').addEventListener('click', () => clearMarks(), SIG);
$('tl').addEventListener('click', ev=>{ if(!edit.length) return; const r=$('tl').getBoundingClientRect(), tt=(ev.clientX-r.left)/r.width*buf.duration;
  const i = segAt(tt); if(playing) startPlayback(tt); else { const rows=$('edl').children; rows[i] && rows[i].scrollIntoView({block:'nearest'}); showShot(i); } });
function remixNow(){
  if(!buf || !sources.length || !edit.length || exporting || recording) return false;
  remakeOk(); seed = (seed*7919 + 13) % 2147483647 || 7; mixNo++; makeEdit();
  return true;
}
$('remix').onclick = remixNow;

/* =============== RENDERER =============== */
const out = $('out'), og = out.getContext('2d');
// The live preview draws at half size (540×960 for a Reel): a quarter of the pixels, so it stays smooth on phones.
// Export and the cover switch to the full 1080p size.
const PREVIEW_SCALE = 0.5;
function setCanvas(full, scale = 1){ const [W0,H0]=SIZES[aspect], s = full ? scale : PREVIEW_SCALE, w = Math.round(W0*s/2)*2, h = Math.round(H0*s/2)*2;
  if(out.width!==w||out.height!==h){ out.width=w; out.height=h; loopImg=null; } }
function segAt(t){ let lo=0,hi=edit.length-1,r=0; while(lo<=hi){ const m=(lo+hi)>>1; if(edit[m].start<=t+1e-4){ r=m; lo=m+1; } else hi=m-1; } return r; }
/* ---- iPhone: only the players near the playhead hold their video ----
 * Each clip has 3 players (a shot and the next shots of the same clip, for transitions). On an iPhone each player that has
 * shown a picture keeps its own decoder and decoded frames: for a 4K HEVC clip about 100-200 MB, never given back while
 * its src is set. 3 clips are 9 such players, 6 clips 18: right after the clips were read and the Reel was made, the first
 * preview loaded them and Safari reloaded the page (Admin -> Errors: "reloaded at saved / making the Reel", 4K clips).
 * So on an iPhone a player gets its video only when its shot is prepared, and the players of shots far from the playhead
 * (more than one before, two after) let theirs go: at most 4 loaded at once, whatever the number of clips. */
/* Keep the decoder working set small on every platform, not only iPhone.
 * Desktop browsers also stutter when every clip eagerly opens three full-resolution decoders.
 * A player gets its source only when its shot is prepared; distant shots release their decoder.
 * The nearby window preserves transition look-ahead while avoiding N-clips × 3 active decoders. */
function lazyPlayer(url){ const v = makeVideo(''); v._url = url; return v; }
const playerLoaded = v => !!v.getAttribute('src');
function playersAround(i){
  const c = playing || starting ? curIdx : i, keep = new Set();
  for(let k = Math.min(c, i) - 1; k <= Math.max(c, i) + 2; k++) if(edit[k]) keep.add(edit[k].el);
  for(const s of sources) for(const v of s.els || []) if(!keep.has(v) && playerLoaded(v)){ v.pause(); v.removeAttribute('src'); v.load(); }
  const v = edit[i].el; if(!playerLoaded(v) && v._url) v.src = v._url;
}
// quick: Play is waiting. Then the picture gets at most a moment: while clips are being read the phone's video decoder is
// busy (an iPhone may not answer at all), and the song must start anyway; the shot catches up while it plays.
async function prepare(i, t, quick){
  const e = edit[i]; if(!e) return;
  if(layers.length && !playing) await prepLayers(t);
  if(e !== edit[i]) return;
  playersAround(i);
  const local = Math.max(0, t - e.start), target = srcPos(e, local);
  // A cold decoder often needs longer than 600 ms (especially the first 4K/HEVC preview). Wait for a real frame before starting audio, rather than letting the picture catch up with a visible hitch.
  if(e.el.readyState < 2){ try{ await videoData(e.el, quick ? 700 : 6000); }catch(err){} }
  e.el.pause(); const r0 = rateAt(e, local); if(r0>0) e.el.playbackRate = r0;
  if(Math.abs(e.el.currentTime - target) > 0.04){ e.el.currentTime = target; try{ await waitEv(e.el,'seeked', quick ? 650 : 4000); }catch(err){} }
}
const srcPosF = (e, l) => e.in + e.sp.pos(l)*e.scaleR;
const srcPos = (e, l) => e.cs && e.cs.rev ? e.in + (e.sp.pos(e.end - e.start) - e.sp.pos(l))*e.scaleR : srcPosF(e, l);
const rateAt = (e, l) => { const r = e.sp.at(l)*e.scaleR; return r<=0 ? 0 : Math.max(0.0625, Math.min(16, r)); };
// faster than a video can play (16x, a very fast shot "In my order"): the preview shows it frame by frame, by seeking
const PLAY_MAX = 16, rawRate = (e, l) => e.sp.at(l)*e.scaleR;
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

// The beat pulse of a shot (bounce, Ken Burns): a small zoom and a soft light on its beats, never closer than 0.4 s (a fast
// song pulses on every other beat). Before, every beat gave a 4.5% zoom and a bright flash, 2-3 times a second on nearly
// every shot: the Reel looked like it was vibrating.
const PULSE_GAP = 0.4;
// the song's strong hits (its top third by strength): the beat bounce follows these, not every small beat underneath
// (a song with a busy background otherwise pulses the picture all the time, which reads as the video vibrating)
let strongFor = null, strongList = [];
function strongHit(t){
  if(strongFor !== hitsRaw){ strongFor = hitsRaw; const v = (hitsStr || []).slice().sort((a,b)=>a-b), cut = v[Math.floor(v.length*0.67)] ?? 0;
    strongList = (hitsRaw || []).filter((h, i) => (hitsStr[i] || 0) >= cut).sort((a,b)=>a-b); }
  if(!strongList.length) return true;
  let lo = 0, hi = strongList.length - 1; while(lo < hi){ const m = (lo + hi) >> 1; if(strongList[m] < t) lo = m + 1; else hi = m; }
  return Math.abs(strongList[lo] - t) < 0.08 || (lo > 0 && Math.abs(strongList[lo-1] - t) < 0.08);
}
function beatPulse(e, local){
  let s = 1, ex = 0, last = -Infinity;
  for(const bt of e.beatsIn){ if(bt > local) break; if(bt - last < PULSE_GAP || !strongHit(e.start + bt)) continue; last = bt;
    s *= 1 + 0.018*Math.exp(-(local-bt)/0.12); ex += 0.05*Math.exp(-(local-bt)/0.08); }
  return { s, ex };
}
// draw one shot with its keyframed properties into context g
function drawShot(g, e, local, o={}){
  const W=out.width, H=out.height, v=texOf(e, local), L=e.end-e.start;
  if(e.black){ g.save(); g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.restore(); return; }   // the copied Reel's black end
  if(e.flick && flickPool.length){ g.save(); g.globalAlpha = o.alpha ?? 1; g.filter = LOOKS[look].filter; g.drawImage(v, 0, 0, W, H); g.restore(); return; }   // a flicker's still fills the frame
  if(!v || v.readyState<2) return;
  const K = e.kf || {};
  let scale = (kf(K.scale,local) ?? 1) * (o.scale||1) * (o.noFx ? 1 : emphAt(e.start + local));
  let x = (kf(K.x,local) ?? 0)*W + (o.dx||0), y = (o.dy||0), rot = (kf(K.rot,local) ?? 0) + (o.rot||0);
  const sh = kf(K.shake,local) || 0;
  if(sh){ x += Math.sin(local*38)*0.007*W*sh; y += Math.cos(local*29)*0.005*H*sh; rot += Math.sin(local*23)*0.45*sh; }   // a light shake (stronger read as the video vibrating)
  if(K.bounce && e.beatsIn) scale *= beatPulse(e, local).s;
  const ac = o.noFx ? null : accentAt(e, local);
  if(ac){ scale *= ac.s; if(ac.sh){ x += Math.sin(local*38)*0.01*W*ac.sh; y += Math.cos(local*29)*0.008*H*ac.sh; rot += Math.sin(local*23)*0.7*ac.sh; } }
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
  if(K.bounce && e.beatsIn && !o.noFx) expo += beatPulse(e, local).ex;   // a light pulse on the beats
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
const LY0 = { x:0.5, y:0.5, s:0.5, r:0, op:1, fh:false, fv:false, crop:{l:0,t:0,r:0,b:0}, mask:'none', mk:{w:0.8,h:0.8,a:0,f:0.12,th:0.5,inv:false,points:[[0.5,0.02],[0.92,0.25],[0.92,0.75],[0.5,0.98],[0.08,0.75],[0.08,0.25]]}, fin:0, fout:0, vol:0, rad:0 };
let lyBuf = null, lyG = null;
async function addLayerMedia(file){
  const url = URL.createObjectURL(file), photo = /^image\//.test(file.type) || /\.(jpe?g|png|webp|heic|gif)$/i.test(file.name);
  if(photo && (file.type === 'image/gif' || /\.gif$/i.test(file.name)) && typeof ImageDecoder !== 'undefined'){   // an animated GIF: its frames, played in a loop
    try{ const dec = new ImageDecoder({ data: await file.arrayBuffer(), type: 'image/gif' }); await dec.tracks.ready; const n = Math.min(240, dec.tracks.selectedTrack.frameCount || 1), frames = [], times = []; let t = 0;
      for(let k = 0; k < n; k++){ const r = await dec.decode({ frameIndex: k }); frames.push(await createImageBitmap(r.image)); times.push(t); t += Math.max(0.02, (r.image.duration || 100000)/1e6); r.image.close(); }
      dec.close(); if(frames.length > 1) return { kind:'gif', file, url, frames, times, gdur: t, img: frames[0], w: frames[0].width, h: frames[0].height, dur: Infinity, name: file.name }; }catch(e){ console.info('GIF read as a picture:', e && e.message); } }
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
const gifFrame = (M, t) => { const T = ((t % M.gdur) + M.gdur) % M.gdur; let k = 0; while(k + 1 < M.times.length && M.times[k + 1] <= T) k++; return M.frames[k]; };
function drawLayers(g, t){
  for(const L of layers){ if(!lyOn(L, t)) continue; const M = lmedia[L.m]; if(!M) continue;
    const src = M.kind === 'photo' ? M.img : M.kind === 'gif' ? gifFrame(M, t - L.t0) : exporting ? L.fc : M.el;
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
    const face = L.follow === 'face' ? facePosOnScreen(t) : null;
    const lx = face ? face.x + (L.followOffsetX || 0) : L.x, ly = face ? face.y + (L.followOffsetY || 0) : L.y;
    g.save(); g.globalAlpha = Math.max(0, Math.min(1, a)); g.globalCompositeOperation = L.blend || 'source-over'; g.translate(lx*W, ly*H); if(L.r) g.rotate(L.r*Math.PI/180); g.scale(L.fh ? -1 : 1, L.fv ? -1 : 1);
    g.drawImage(lyBuf, -dw/2, -dh/2); g.restore();
    if(L === layers[lySel] && !exporting && !recording && !playing){   // the chosen layer: a thin frame (preview only)
      g.save(); g.translate(lx*W, ly*H); if(L.r) g.rotate(L.r*Math.PI/180); g.strokeStyle = 'rgba(176,92,255,0.95)'; g.lineWidth = Math.max(2, W*0.004); g.setLineDash([W*0.012, W*0.008]); g.strokeRect(-dw/2, -dh/2, dw, dh); g.restore(); }
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
  if(L.mask === 'luma'){
    const image = q.getImageData(0, 0, w, h), pixels = image.data;
    const threshold = Math.max(0, Math.min(1, k.th ?? 0.5)), softness = Math.max(0.015, Math.min(0.5, k.f ?? 0.12));
    const lo = Math.max(0, threshold - softness), hi = Math.min(1, threshold + softness);
    for(let i=0;i<pixels.length;i+=4){
      const lum = (0.2126*pixels[i] + 0.7152*pixels[i+1] + 0.0722*pixels[i+2])/255;
      const x = Math.max(0, Math.min(1, (lum - lo)/Math.max(0.0001, hi - lo)));
      let mask = x*x*(3 - 2*x);
      if(k.inv) mask = 1 - mask;
      pixels[i+3] = Math.round(pixels[i+3]*mask);
    }
    q.putImageData(image, 0, 0); return;
  }
  q.globalCompositeOperation = k.inv && L.mask !== 'none' ? 'destination-out' : 'destination-in';
  q.filter = f > 0.5 ? 'blur(' + f.toFixed(1) + 'px)' : 'none'; q.fillStyle = '#000'; q.beginPath();
  const cx = w/2, cy = h/2;
  if(L.mask === 'circle') q.ellipse(cx, cy, Math.max(1, k.w*w/2 - f), Math.max(1, k.h*h/2 - f), k.a*Math.PI/180, 0, 2*Math.PI);
  else if(L.mask === 'radial'){
    const gradient = q.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, Math.min(k.w*w, k.h*h)/2));
    if(k.inv){ gradient.addColorStop(0, 'rgba(0,0,0,0)'); gradient.addColorStop(1, '#000'); }
    else { gradient.addColorStop(0, '#000'); gradient.addColorStop(1, 'rgba(0,0,0,0)'); }
    q.fillStyle = gradient; q.ellipse(cx, cy, Math.max(1,k.w*w/2), Math.max(1,k.h*h/2), k.a*Math.PI/180, 0, 2*Math.PI);
  }
  else if(L.mask === 'rect'){ q.translate(cx, cy); q.rotate(k.a*Math.PI/180); const rw = k.w*w - 2*f, rh = k.h*h - 2*f; if(q.roundRect) q.roundRect(-rw/2, -rh/2, rw, rh, L.rad*Math.min(rw, rh)/2); else q.rect(-rw/2, -rh/2, rw, rh); }
  else if(L.mask === 'polygon'){ q.translate(cx, cy); q.rotate(k.a*Math.PI/180); const pts = Array.isArray(k.points) && k.points.length >= 3 ? k.points : [[0.5,0.02],[0.92,0.25],[0.92,0.75],[0.5,0.98],[0.08,0.75],[0.08,0.25]]; pts.forEach((p,i)=>{ const px=(p[0]-0.5)*k.w*w, py=(p[1]-0.5)*k.h*h; if(i===0) q.moveTo(px,py); else q.lineTo(px,py); }); q.closePath(); }
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
  $('lymaskopts').hidden = L.mask === 'none'; $('lylumarow').hidden = L.mask !== 'luma'; $('lyvolrow').hidden = !M || M.kind !== 'video';
  $('lytime').textContent = fmt(L.t0) + ' – ' + fmt(L.t1);
}
const lyFmt = (k, v) => /^(x|y|s|op|crop|mk\.(w|h|f|th)|vol)/.test(k) ? Math.round(v*100) + '%' : /^(r|mk\.a)$/.test(k) ? Math.round(v) + '°' : /^(fin|fout|rad)$/.test(k) ? (k === 'rad' ? Math.round(v*100) + '%' : v.toFixed(1) + ' s') : String(v);
function lySelect(i){
  if(!Number.isInteger(i) || !layers[i]) return false;
  lySel = i; lyUI(); pos = Math.max(pos, layers[i].t0);
  if(!lyOn(layers[i], pos)) pos = layers[i].t0 + 0.05;
  return prepare(segAt(pos), pos).then(() => prepLayers(pos)).then(redrawFrame).then(() => true);
}
function lyDelete(){
  if(!layers[lySel]) return false;
  layers.splice(lySel, 1); lySel = Math.min(lySel, layers.length - 1); clipMixKey = ''; lyUI(); redrawFrame(); return true;
}
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
function facePosOnScreen(t){
  if(!edit.length) return null;
  const e = edit[segAt(t)], src = sources[e.src]; if(!src || !src.faces?.length) return null;
  const local = Math.max(0, t - e.start), st = srcPos(e, local), near = src.faces.filter(f=>f.n && Math.abs(f.t - st) < 0.6);
  if(!near.length) return null;
  const f = near.reduce((q,x)=>Math.abs(x.t-st) < Math.abs(q.t-st) ? x : q, near[0]);
  const W=out.width, H=out.height, r = Math.max(W/src.w, H/src.h), dw=src.w*r, dh=src.h*r, [ccx, ccy] = camAt(e, local);
  return { x: Math.max(0, Math.min(1, 0.5 + (f.fx-ccx)*dw/W)), y: Math.max(0, Math.min(1, 0.5 + (f.fy-ccy)*dh/H)) };
}
function faceYOnScreen(t){ const face = facePosOnScreen(t); return face ? face.y : null; }
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
const OV_STYLES = { bold: 'Bold', box: 'Box', neon: 'Neon', clean: 'Clean', tag: 'Tag', outline: 'Outline only', shadow: 'Hard shadow', bubble: 'Speech bubble', glow: 'Soft glow', stack: 'Double outline', cutout: 'Video in letters' };
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
const OV_LOOPS = { none: 'Still', bounce: 'Bounce', spin: 'Spin', wiggle: 'Wiggle', pulse: 'Pulse', float: 'Float', swing: 'Swing', shake: 'Shake' };   // keeps moving while it shows
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
function setOverlaysFromNative(list){
  const D = reelLen(), incoming = Array.isArray(list) ? list : [];
  overlays = incoming.map(o => {
    const id = Number.isFinite(Number(o.id)) ? Number(o.id) : ++ovSeq;
    ovSeq = Math.max(ovSeq, id);
    const t0 = Math.max(0, Math.min(D, Number(o.start ?? o.t0) || 0));
    const t1 = Math.max(t0 + 0.05, Math.min(D, Number(o.end ?? o.t1) || D));
    if(o.kind === 'squareFrame') return { ...o, id, kind: 'squareFrame', t0, t1, frameColor: String(o.frameColor || '#FFFFFF'), frameWidth: Math.max(0.003, Math.min(0.03, Number(o.frameWidth) || 0.008)), all: false };
    return { ...o, id, text: String(o.text || '').slice(0, 300), emoji: !!o.emoji, style: String(o.style || 'pop'), color: String(o.color || '#FFFFFF'),
      anim: String(o.anim || 'pop'), t0, t1, x: Number.isFinite(Number(o.x)) ? Number(o.x) : 0.5, y: Number.isFinite(Number(o.y)) ? Number(o.y) : 0.4,
      size: Math.max(0.35, Math.min(2.5, (Number(o.size) || 36) / 36)), all: !!o.all || (t0 === 0 && t1 >= D) };
  });
  ovSel = -1; renderOvList(); redraw(); saveNow(); return overlays.length;
}
function addOverlay(o){
  const L = reelLen(), now = Math.max(0, Math.min(L - 0.5, (playing ? curTime() : pos) || 0));
  const t0 = o.all ? 0 : o.end ? Math.max(0, L - 3) : now, t1 = o.all ? L : o.end ? L : Math.min(L, t0 + 3);
  const ov = { id: ++ovSeq, text: o.text || '', emoji: !!o.emoji, style: o.style || 'bold', color: o.color || '#FFFFFF', anim: o.anim || (o.emoji ? 'pop' : 'pop'),
    t0, t1, x: o.x ?? 0.5, y: o.y ?? 0.4, size: o.size || 1, all: !!o.all };
  overlays.push(ov); ovSel = overlays.length - 1; renderOvList(); redraw();
  return ov;
}
/* ---- Shubix AI as the editor: what a person does with the tools (texts and their keyframes, video boxes, the look, captions,
 * the song's sound, the voice), the AI does with the same tools; its steps are used as it gave them ---- */
function aiTexts(list){
  if(!Array.isArray(list) || !list.length) return 0;
  const D = reelLen();
  overlays = overlays.filter(o => o.aiIntent !== 'ai').concat(list.map(x => ({ id: ++ovSeq, aiIntent: 'ai', text: x.text, emoji: !!x.emoji, style: x.style, color: x.color, anim: x.anim,
    loop: x.loop === 'none' ? undefined : x.loop, font: x.font || undefined, behind: !!x.behind, track: !!x.track, x: x.x, y: x.y, size: x.size, all: false, ...(Number.isFinite(x.focus) ? { focus: x.focus } : {}),
    t0: Math.max(0, Math.min(D - 0.1, x.start)), t1: Math.max(0.1, Math.min(D, x.end)), uk: (x.keys || []).map(k => ({ t: k.at, x: k.x, y: k.y, s: k.s, r: k.r, o: k.o, ez: k.ez })) })));
  overlays.filter(o => o.font).forEach(o => loadFont(o.font).then(redraw));
  ovSel = -1; renderOvList(); redraw(); return list.length;
}
const BLENDS = ['source-over','multiply','screen','overlay','darken','lighten','color-dodge','color-burn','hard-light','soft-light','difference','exclusion','hue','saturation','color','luminosity'];
// shot steps change the shots' numbers: the last shot's first, so each step's number is the shot the AI meant
const SHOT_OPS = ['split','dup','freeze','delete','reverse'];
async function aiActions(list){
  let done = 0;
  const steps = (Array.isArray(list) ? list : []).slice().sort((a, b) => a.do === 'shot' && b.do === 'shot' ? (+b.i || 0) - (+a.i || 0) : 0);
  for(const a of steps){
    try{
      if(a.do === 'look'){ const b = $('look').querySelector('[data-l="' + CSS.escape(String(a.name)) + '"]'); if(b){ b.click(); done++; } }
      else if(a.do === 'captions'){ await setCaptions(a.on !== false, a.language, a.translation); if(a.style) setCaptionStyle(a.style); done++; }
      else if(a.do === 'music'){ const p = {}; if(Number.isFinite(+a.volume)) p.mvol = Math.max(0, Math.min(1, +a.volume)); if(Number.isFinite(+a.fadeIn)) p.mfin = Math.max(0, +a.fadeIn);
        if(Number.isFinite(+a.fadeOut)){ p.mfout = Math.max(0, +a.fadeOut); p.mfoutManual = true; } auSet(p); clipMixKey = ''; await ensureMix(); done++; }
      else if(a.do === 'voicefx'){ const b = $('vfx').querySelector('[data-f="' + CSS.escape(String(a.fx)) + '"]'); if(b){ b.click(); done++; } }
      else if(a.do === 'voiceover' && tts && tts.voices.length && a.text){ pos = Math.max(0, Math.min(reelLen() - 0.5, +a.at || 0)); await addTtsAtPlayhead(a.text, a.voice || tts.voices[0].key); done++; }
      else if(a.do === 'sound' && SFX_NAMES[a.kind] && buf){ sfxList.push({ id: ++sfxSeq, at: +Math.max(0, Math.min(reelLen(), +a.at || 0)).toFixed(2), kind: a.kind }); sfxUI(); clipMixKey = ''; await ensureMix(); done++; }
      else if(a.do === 'shot' && SHOT_OPS.includes(a.op) && edit[+a.i]){ const e = edit[+a.i], len = e.end - e.start;
        pos = e.start + Math.max(0.05, Math.min(len - 0.05, Number.isFinite(+a.at) ? +a.at : len/2));
        if(a.op === 'reverse'){ shotSet({ rev: a.on !== false }); done++; } else if(shotOp(a.op)) done++; }
      else if(a.do === 'background' && ['none','blur','color'].includes(a.mode)){ if(/^#[0-9a-f]{6}$/i.test(a.color || '')) bgColor = a.color; bgmode.querySelector('[data-b="' + a.mode + '"]').click(); done++; }
      else if(a.do === 'layer'){
        const s = sources[parseInt(String(a.clip).replace(/\D/g, ''), 10) - 1]; if(!s || !s.file || !edit.length) continue;
        const M = await addLayerMedia(s.file), D = reelLen(), t0 = Math.max(0, Math.min(D - 0.1, +a.start || 0)), mask = ['circle', 'rect'].includes(a.mask) ? a.mask : 'none';
        lmedia.push(M);
        layers.push({ id: ++lySeq, m: lmedia.length - 1, t0, t1: Math.max(t0 + 0.1, Math.min(D, Number.isFinite(+a.end) ? +a.end : D)), in: Math.max(0, Math.min((M.dur || 1) - 0.1, +a.from || 0)),
          ...JSON.parse(JSON.stringify(LY0)), x: Number.isFinite(+a.x) ? +a.x : 0.5, y: Number.isFinite(+a.y) ? +a.y : 0.5, s: Math.max(0.05, Math.min(1, +a.size || 0.5)),
          rad: Math.max(0, Math.min(1, +a.radius || 0)), mask, fin: Math.max(0, +a.fadeIn || 0), fout: Math.max(0, +a.fadeOut || 0), aiIntent: 'ai',
          op: Number.isFinite(+a.opacity) ? Math.max(0, Math.min(1, +a.opacity)) : 1, r: +a.rotate || 0, blend: BLENDS.includes(a.blend) ? a.blend : 'source-over',
          ...(a.key ? { key: { on: true, c: /^#[0-9a-f]{6}$/i.test(a.key) ? a.key : '#00FF00', tol: Number.isFinite(+a.tolerance) ? Math.max(0.05, Math.min(0.9, +a.tolerance)) : 0.35 } } : {}) });
        done++;
      }
    }catch(e){ console.warn('Shubix AI step not done:', a && a.do, e); }
  }
  if(layers.length){ lyUI(); await prepLayers(pos); }
  redrawFrame(); saveNow(); return done;
}
// the AI's whole answer for this Reel: the cuts are in `director`; its texts and other steps are put on here
async function aiApply(d){ if(!d) return; layers = layers.filter(L => L.aiIntent !== 'ai' || !(d.actions || []).some(a => a.do === 'layer')); aiTexts(d.texts); await aiActions(d.actions); }
function ovTiming(ov){ const L = reelLen(); return ov.all ? [0, L] : [Math.max(0, Math.min(ov.t0, L)), Math.max(0, Math.min(ov.t1, L))]; }
// one item at time t; its box is kept (fractions of the frame) for picking it on the preview
let cutBuf = null;   // the cutout text's frame (the colour with the letters cut out)
function drawOverlay(g, ov, t){
  const [a, b] = ovTiming(ov); if(!(t >= a && t < b)) return;
  const W = out.width, H = out.height;
  if(ov.kind === 'squareFrame'){
    const side = Math.min(W, H), inset = side * 0.035;
    g.save(); g.lineJoin = 'round'; g.lineWidth = Math.max(3, side * (ov.frameWidth || 0.008));
    g.strokeStyle = ov.frameColor || '#FFFFFF'; g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = side * 0.012;
    g.strokeRect((W - side) / 2 + inset, (H - side) / 2 + inset, side - inset * 2, side - inset * 2); g.restore(); return;
  }
  const base = Math.min(W, H*0.5625), since = t - a, left = b - t;
  const fs = Math.round(base*(ov.emoji ? 0.16 : 0.075)*ov.size);
  let alpha = Math.min(1, left/0.15), sc = 1, dy = 0, txt = ov.emoji ? ov.text : (isIndic(ov.text) ? ov.text : ov.text);
  // paused in the editor: a text shows as it will look once in (its entrance played), so a text just added, or one being
  // keyframed at its first moment, is there to see and to drag (at its first frame it would still be invisible)
  const still = !playing && !recording && !exporting;
  if(!coverMode && !still){
    if(ov.anim === 'pop'){ const q = Math.min(1, since/0.22); sc = 0.6 + 0.4*EASE.outBack(q); alpha *= Math.min(1, since/0.08); }
    else if(ov.anim === 'fade') alpha *= Math.min(1, since/0.35);
    else if(ov.anim === 'slide'){ const q = Math.min(1, since/0.3); dy = (1 - EASE.outCubic(q))*fs*1.2; alpha *= q; }
    else if(ov.anim === 'type'){ const chars = [...txt]; txt = chars.slice(0, Math.max(1, Math.ceil(since/0.05))).join(''); }
    if(ov.emoji) sc *= 1 + 0.05*Math.sin(t*6);   // stickers breathe a little
  }
  let lx = 0, ly = 0, lr = 0;   // a sticker / text that keeps moving (its loop)
  if(ov.loop && ov.loop !== 'none' && !coverMode){ const w = since*Math.PI*2;
    if(ov.loop === 'bounce') ly = -Math.abs(Math.sin(w*0.9))*fs*0.35; else if(ov.loop === 'spin') lr = since*240; else if(ov.loop === 'wiggle') lr = Math.sin(w*2.2)*12;
    else if(ov.loop === 'pulse') sc *= 1 + 0.12*Math.abs(Math.sin(w*1.1)); else if(ov.loop === 'float'){ ly = Math.sin(w*0.5)*fs*0.18; lx = Math.cos(w*0.35)*fs*0.12; }
    else if(ov.loop === 'swing') lr = Math.sin(w*0.8)*18; else if(ov.loop === 'shake'){ lx = Math.sin(since*97)*fs*0.06; ly = Math.cos(since*71)*fs*0.05; } }
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
  // focus: where along the text it is sized and turned around (0.64: the O of WELCOME), so the frame can fly through one letter
  const fx = Number.isFinite(ov.focus) ? (ov.focus - 0.5)*tw : 0;
  g.translate(cx + lx + fx, cy + ly); if((u && u.r) || lr) g.rotate(((u && u.r) || 0)*Math.PI/180 + lr*Math.PI/180); g.scale(sc, sc); if(fx) g.translate(-fx, 0);
  const dark = c => { const n = parseInt(c.slice(1), 16); return ((n>>16)*0.299 + ((n>>8)&255)*0.587 + (n&255)*0.114) < 140; };
  if(!ov.emoji && (ov.style === 'box' || ov.style === 'tag')){
    const tag = ov.style === 'tag', pw = tw + fs*(tag ? 1.05 : 0.6), ph = th + fs*0.36, r = tag ? fs*0.5 : fs*0.2;
    g.fillStyle = ov.color; g.beginPath(); g.roundRect ? g.roundRect(-pw/2, -ph/2, pw, ph, r) : g.rect(-pw/2, -ph/2, pw, ph); g.fill();
    if(tag){ g.fillStyle = dark(ov.color) ? '#fff' : '#111'; g.beginPath(); g.arc(-pw/2 + fs*0.36, 0, fs*0.1, 0, Math.PI*2); g.fill(); g.translate(fs*0.24, 0); }   // the tag's hole, left of the text
    g.fillStyle = dark(ov.color) ? '#fff' : '#111';
    lines.forEach((l, k) => g.fillText(l, 0, (k - (lines.length-1)/2)*lh + fs*0.03));
  } else if(!ov.emoji && ov.style === 'cutout'){   // the colour fills the frame, the video shows only inside the letters (scale it up: the frame flies through them)
    if(!cutBuf) cutBuf = document.createElement('canvas');
    if(cutBuf.width !== W || cutBuf.height !== H){ cutBuf.width = W; cutBuf.height = H; }
    const q = cutBuf.getContext('2d'); q.setTransform(1, 0, 0, 1, 0, 0); q.globalCompositeOperation = 'source-over'; q.clearRect(0, 0, W, H); q.fillStyle = ov.color; q.fillRect(0, 0, W, H);
    q.setTransform(g.getTransform()); q.font = g.font; q.textAlign = 'center'; q.textBaseline = 'middle'; q.globalCompositeOperation = 'destination-out';
    lines.forEach((l, k) => q.fillText(l, 0, (k - (lines.length-1)/2)*lh));
    g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(cutBuf, 0, 0);
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
    const [bx, by, bw, bh] = ov.box; g.save(); g.setLineDash([10, 8]); g.lineWidth = 3; g.strokeStyle = 'rgba(255,213,74,0.95)'; g.strokeRect(bx*W, by*H, bw*W, bh*H);
    const hr = Math.max(16, W*0.022); g.setLineDash([]); g.beginPath(); g.arc((bx + bw)*W, (by + bh)*H, hr, 0, Math.PI*2); g.fillStyle = '#ffd54a'; g.fill(); g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.55)'; g.stroke();
    g.beginPath(); g.moveTo((bx + bw)*W - hr*0.45, (by + bh)*H + hr*0.45); g.lineTo((bx + bw)*W + hr*0.45, (by + bh)*H - hr*0.45); g.strokeStyle = '#000'; g.lineWidth = 3; g.stroke(); g.restore(); }
}
function drawOverlays(t){ for(const ov of overlays) if(!ov.behind || !personMask || !bgMask) drawOverlay(og, ov, t); }
// the list under "Text & stickers": edit the words, style, colour, entrance, size, when it shows
let ovTab = 'font';   // the text editor's open tab (Font, Style, Animation or Loop), the same for every text
function renderOvList(){
  const box = $('ovlist'); box.innerHTML = '';
  overlays.forEach((ov, i) => {
    if(ov.kind === 'squareFrame') return;
    const row = document.createElement('div'); row.className = 'ov' + (i === ovSel ? ' sel' : '');
    const [a, b] = ovTiming(ov);
    // the text / sticker editor (the design's frame 5): the words; Font · Style · Animation · Loop; the colour; follow the
    // person; start and end; delete. Each choice is a chip (its select stays, hidden, as the one place the value lives)
    row.innerHTML = `<div class="ovtop"><input class="ovt" maxlength="80" aria-label="Text"><button class="ovdel" title="Delete" aria-label="Delete">×</button></div>
      <div class="ovtabs" role="tablist"><button type="button" data-ovt="font">Font</button><button type="button" data-ovt="style">Style</button><button type="button" data-ovt="anim">Animation</button><button type="button" data-ovt="loop">Loop</button></div>
      <div class="ovpane" data-p="font"><div class="ovfrow"><select class="ovf" aria-label="Font"></select><label class="ovsz">Size <input type="range" min="0.3" max="4" step="0.05" aria-label="Size"></label></div>
        <div class="ovcrow"><span class="ovclab">Color</span><span class="ovc"></span><label class="ovpick" title="Any colour"><input type="color" class="ovcol" aria-label="Any colour"></label></div></div>
      <div class="ovpane" data-p="style"><select class="ovs" aria-label="Style" hidden></select><div class="ovchips" data-for="ovs"></div></div>
      <div class="ovpane" data-p="anim"><select class="ova" aria-label="Entrance" hidden></select><div class="ovchips" data-for="ova"></div></div>
      <div class="ovpane" data-p="loop"><select class="ovl" aria-label="Keeps moving" hidden></select><div class="ovchips" data-for="ovl"></div></div>
      <div class="ovctl ovflags"><label class="tog switch"><input type="checkbox" class="ovtrk"> Follow the person</label><label class="tog switch"><input type="checkbox" class="ovbeh"> Behind the person</label><label class="tog switch"><input type="checkbox" class="ovall"> Whole Reel</label></div>
      <div class="ovctl ovtime"><span class="ovtl">Start</span><button class="${Button.small} ovfrom" title="Start where the playhead is">Here</button><span class="fname ovtm"></span><span class="ovtl">End</span><button class="${Button.small} ovto" title="End where the playhead is">Here</button><button class="${Button.small} ovdel2" type="button">Delete</button></div>`;
    const tk = row.querySelector('.ovtrk'); tk.checked = !!ov.track; if(isLocked('tool', 'track')) tk.parentElement.lastChild.textContent = ' 👑 Follow the person'; tk.addEventListener('change', () => { ov.track = tk.checked; if(tk.checked){ ov.x = 0.5; ov.y = ov.emoji ? 0.38 : 0.32; } redraw(); });
    const ti = row.querySelector('.ovt'); ti.value = ov.text; if(ov.emoji){ ti.readOnly = true; ti.classList.add('emoji'); }
    ti.addEventListener('input', () => { ov.text = ti.value; redraw(); });
    const ss = row.querySelector('.ovs'), sa = row.querySelector('.ova');
    if(ov.emoji) ss.hidden = true;
    Object.entries(OV_STYLES).forEach(([k, v]) => ss.add(new Option(crown('text', k, v), k, false, k === ov.style)));
    Object.entries(OV_ANIMS).forEach(([k, v]) => sa.add(new Option(v, k, false, k === ov.anim)));
    ss.addEventListener('change', () => { ov.style = ss.value; redraw(); }); sa.addEventListener('change', () => { ov.anim = sa.value; redraw(); });
    const sl = row.querySelector('.ovl'); Object.entries(OV_LOOPS).forEach(([k, v]) => sl.add(new Option(v, k, false, k === (ov.loop || 'none')))); sl.addEventListener('change', () => { ov.loop = sl.value === 'none' ? undefined : sl.value; redraw(); });
    const sf = row.querySelector('.ovf'); if(ov.emoji) sf.hidden = true;
    Object.entries(OV_FONTS).forEach(([k, v]) => sf.add(new Option(crown('font', k, v[0]), k, false, k === (ov.font || 'auto'))));
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
    row.querySelector('.ovdel2').addEventListener('click', () => row.querySelector('.ovdel').click());
    // Font · Style · Animation · Loop (the last one chosen stays open); each select's choices as chips
    const tabTo = k => { ovTab = k; row.querySelectorAll('[data-ovt]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ovt === k))); row.querySelectorAll('.ovpane').forEach(p => { p.hidden = p.dataset.p !== k; }); };
    row.querySelectorAll('[data-ovt]').forEach(b => b.addEventListener('click', () => tabTo(b.dataset.ovt)));
    tabTo(ov.emoji && ovTab !== 'anim' && ovTab !== 'loop' ? 'anim' : ovTab);
    if(ov.emoji) row.querySelectorAll('[data-ovt="font"],[data-ovt="style"]').forEach(b => { b.hidden = true; });
    row.querySelectorAll('.ovchips').forEach(box2 => { const sel = row.querySelector('.' + box2.dataset.for);
      const paint = () => [...box2.children].forEach(c => c.setAttribute('aria-pressed', String(c.dataset.v === sel.value)));
      [...sel.options].forEach(o => { const c = document.createElement('button'); c.type = 'button'; c.className = `${Chip}`; c.dataset.v = o.value; c.textContent = o.text;
        c.addEventListener('click', () => { sel.value = o.value; sel.dispatchEvent(new Event('change')); paint(); }); box2.appendChild(c); });
      paint(); });
    const pick = row.querySelector('.ovcol'); pick.value = /^#[0-9a-f]{6}$/i.test(ov.color || '') ? ov.color : '#ffffff'; if(ov.emoji) pick.parentElement.hidden = true;
    pick.addEventListener('input', () => { ov.color = pick.value; [...cs.children].forEach(x => x.classList.remove('on')); redraw(); });
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
{ let drag = null; const fingers = new Map();
  const at = ev => { const r = out.getBoundingClientRect(); return [(ev.clientX - r.left)/r.width, (ev.clientY - r.top)/r.height]; };
  // a text's size: two fingers on it (pinch), or its corner handle dragged away from / toward its middle
  const OV_MIN = 0.3, OV_MAX = 4;
  const midOf = ov => { const [bx, by, bw, bh] = ov.box, r = out.getBoundingClientRect(); return [r.left + (bx + bw/2)*r.width, r.top + (by + bh/2)*r.height]; };
  const spread = () => { const p = [...fingers.values()]; return Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]) || 1; };
  out.addEventListener('pointerdown', ev => {
    if(recording) return;
    fingers.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if(fingers.size === 2 && drag && drag.i != null && overlays[drag.i]){ const ov = overlays[drag.i]; drag = { i: drag.i, pinch: true, d0: spread(), s0: ov.size || 1 }; try{ out.setPointerCapture(ev.pointerId); }catch(e){} ev.preventDefault(); return; }
    const [x, y] = at(ev), t = playing ? curTime() : pos || 0;
    if(ovSel >= 0 && overlays[ovSel] && overlays[ovSel].box){ const ov = overlays[ovSel], [bx, by, bw, bh] = ov.box, r = out.getBoundingClientRect(), [a0, b0] = ovTiming(ov);
      const hx = r.left + (bx + bw)*r.width, hy = r.top + (by + bh)*r.height;
      if(t >= a0 && t < b0 && Math.hypot(ev.clientX - hx, ev.clientY - hy) < 28){ const [mx, my] = midOf(ov);
        drag = { i: ovSel, handle: true, d0: Math.hypot(ev.clientX - mx, ev.clientY - my) || 1, s0: ov.size || 1, mx, my }; out.setPointerCapture(ev.pointerId); ev.preventDefault(); return; } }
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
  out.addEventListener('pointermove', ev => { if(fingers.has(ev.pointerId)) fingers.set(ev.pointerId, [ev.clientX, ev.clientY]); if(!drag) return; const [x, y] = at(ev);
    if(drag.pinch || drag.handle){ const ov = overlays[drag.i]; if(!ov) return;
      const f = drag.pinch ? (fingers.size === 2 ? spread()/drag.d0 : 1) : Math.hypot(ev.clientX - drag.mx, ev.clientY - drag.my)/drag.d0;
      ov.size = Math.round(Math.max(OV_MIN, Math.min(OV_MAX, drag.s0*f))*100)/100; redraw(); return; }
    if(drag.shot){ kfSet({ x: drag.ux + x - drag.x0, y: drag.uy + y - drag.y0 }); return; }
    const ov = overlays[drag.i]; if(!ov) return;
    ov.x = Math.max(0.05, Math.min(0.95, x - drag.dx)); ov.y = Math.max(0.05, Math.min(0.95, y - drag.dy)); redraw(); }, SIG);
  const end = ev => { fingers.delete(ev.pointerId); if(drag && (drag.pinch || drag.handle)){ if(drag.pinch && fingers.size) return; renderOvList(); } drag = null; };
  out.addEventListener('pointerup', end, SIG); out.addEventListener('pointercancel', end, SIG); }

/* ---- ◆ Keyframes: the creator animates a shot or a text: position, zoom, rotation, opacity, with an ease ----
 * The target is the selected text / sticker, else the shot under the playhead. Moving a slider (or dragging the picture)
 * writes a keyframe at the playhead, as in the big editors: on a keyframe it changes it, between keyframes it adds one
 * holding the in-between values. The shot or text moves from keyframe to keyframe; each keyframe's ease shapes the move
 * into it. Ready-made moves fill the keyframes in one tap. Saved with the Reel. */
let talkKfs = null, kfTimer = 0, kfLast = 0;
const KF_NEAR = 0.04;
let kfClipboard = [];
const KF_SL = { x: { min: -1, max: 1, step: 0.005, show: v => Math.round(v*100) + '%' }, y: { min: -1, max: 1, step: 0.005, show: v => Math.round(v*100) + '%' },
  s: { min: 0.1, max: 4, step: 0.01, show: v => v.toFixed(2) + '×' }, r: { min: -360, max: 360, step: 1, show: v => Math.round(v) + '°' }, o: { min: 0, max: 1, step: 0.01, show: v => Math.round(v*100) + '%' } };
const KF_NAME = { x: 'Move ↔', y: 'Move ↕', s: 'Zoom', r: 'Rotate', o: 'Opacity' };
const KF_EASE = { inOut: 'Smooth', lin: 'Linear', outCubic: 'Ease out', inQuad: 'Ease in', outBack: 'Overshoot', outExpo: 'Fast stop', bezier: 'Bezier', hold: 'Hold (jump)' };
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
  $('kfcopy').disabled = !L.length; $('kfpaste').disabled = !kfClipboard.length;
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
$('kfcopy').addEventListener('click', () => { const T = kfTarget(); kfClipboard = T && T.obj.uk ? T.obj.uk.map(q => ({ ...q })) : []; kfSync(); });
$('kfpaste').addEventListener('click', () => { const T = kfTarget(); if(!T || !kfClipboard.length) return; const max = Math.max(0, T.b - T.a - 0.01); T.obj.uk = kfClipboard.map(q => ({ ...q, t: Math.min(max, Math.max(0, q.t)) })).sort((a,b) => a.t - b.t); redraw(); kfSync(); kfListSoon(); });
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
    if(j.planAi === false){ $('capwrap').hidden = false; $('caps').disabled = true; $('capwrap').title = 'Captions from the song are part of the Editor and Pro plans'; $('capwrap').lastChild.textContent = ' Captions from the song · Editor and Pro plans'; return; }
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
  const d = trDur(e), p = d ? Math.min(1, local/d) : 1;
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
    // iPhone: a 4K video is not made a 4K texture each frame (33 MB, two during a transition); it is drawn into a copy of
    // at most 1920 px first. The shader reads the texture in 0-1 coordinates, so the picture is the same.
    const small = [], fitIOS = (k, v) => {
      const W = v.videoWidth, H = v.videoHeight, sc = 1920/Math.max(W, H); if(!IOS || !(sc < 1)) return v;
      const c2 = small[k] || (small[k] = document.createElement('canvas')), w = Math.round(W*sc), h = Math.round(H*sc);
      if(c2.width !== w || c2.height !== h){ c2.width = w; c2.height = h; }
      c2.getContext('2d').drawImage(v, 0, 0, w, h); return c2; };
    const upload = (k, src) => { if(!src) return; if(src.readyState!==undefined && src.readyState<2) return; if(src.readyState!==undefined) src = fitIOS(k, src); gl.activeTexture(gl.TEXTURE0+k); gl.bindTexture(gl.TEXTURE_2D,tex[k]);
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
  }catch(err){ console.warn('WebGL off:', err && err.message); try{ window.__shubixReport && window.__shubixReport('webgl', 'WebGL off: ' + String(err && err.message || err).slice(0, 300)); }catch(e){} return null; }
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
const CS0 = { rev:false, zoom:1, cx:null, cy:null, vol:0, pitch:0, mus:1, rot:0, fh:false, fv:false, fit:false, bg:'blur', bgc:'#000000', bd:0, bdc:'#ffffff', bri:0, con:0, sat:0, warm:0, hi:0, sh:0, hue:0, sharp:0, vig:0, beauty:0, stab:0, curve:null, fin:0, fout:0, mz:null, mg:null };
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
  if(sh){ x += Math.sin(local*38)*0.007*W*sh; y += Math.cos(local*29)*0.005*H*sh; rot += Math.sin(local*23)*0.45*sh; }   // a light shake (stronger read as the video vibrating)
  let expo = o.noFx ? 0 : (kf(K.expo,local) || 0);
  if(K.bounce && e.beatsIn){ const bp = beatPulse(e, local); scale *= bp.s; if(!o.noFx) expo += bp.ex; }
  const ac = o.noFx ? null : accentAt(e, local);
  if(ac){ scale *= ac.s; expo += ac.ex; if(ac.sh){ x += Math.sin(local*38)*0.01*W*ac.sh; y += Math.cos(local*29)*0.008*H*ac.sh; rot += Math.sin(local*23)*0.7*ac.sh; } }
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
  const still = (e.flick && flickPool.length) || e.black;   // a flicker's still / the black end: filling the frame
  return { el:texOf(e, local), rect: still ? [0,0,W,H] : [px,py,dw,dh], rot: still ? 0 : rot*Math.PI/180, zb: zb + (o.zb||0), db: o.db || [0,0], rgb: (o.noFx ? 0 : (kf(K.rgb,local)||0)) + (o.rgb||0) + (ac ? ac.rgb : 0),
    expo, bright: (br===undefined ? 1 : br) * (e.type==='break' ? 0.88 : 1) * fade, alpha: (o.alpha ?? 1) * (u ? Math.max(0, Math.min(1, u.o)) : 1),
    off: u ? [u.x*W, u.y*H] : [0,0], clip: u ? 1 : 0, uo: u ? Math.max(0, Math.min(1, u.o)) : 1,
    tf: csMat(c), bg: !c.fit ? [0,0,0,-1] : c.bg === 'blur' ? [0,0,0,1] : [...hexRgb(c.bgc), 0], bgr: [W/2 - G.sw*rb/2, H/2 - G.sh*rb/2, G.sw*rb, G.sh*rb],
    bd: c.fit && c.bd > 0 ? [...hexRgb(c.bdc), c.bd*0.04*W] : [0,0,0,0], ad: [c.bri, c.con, c.sat, c.warm], ad2: [c.hi || 0, c.sh || 0, c.hue || 0, (c.sharp || 0) + upSharp(e, dh)], be: c.beauty || 0 };
}
// a clip smaller than it is shown (a 480p or 720p video in a 1080p or 4K Reel): sharpened in step with how much it is
// enlarged, so the chosen quality looks like that quality (a clip at its own size or larger: untouched)
function upSharp(e, dh){ const src = sources[e.src], h = src && (src.h || src.w); if(!h || !(dh > 0)) return 0; const up = dh / h; return up > 1.15 ? Math.min(0.55, (up - 1) * 0.3) : 0; }
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
  const s = sources[e.src], mb = await loadMediabunny(), input = new mb.Input({ source: new mb.BlobSource(decFile(s)), formats: mb.ALL_FORMATS });
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
  const d = trDur(e), p = d ? Math.min(1, local/d) : 1, q = EASE.outCubic(p);
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
// every start or stop gets a new number: a start that is still loading (the mix, the clips) gives up when the number
// moved on, so two quick taps never leave two songs playing (and Pause always stops the one that plays)
function stopAll(){ playGen++; starting = false; stopPart(); stopLayers(); playing=false; if(src){ const s=src; src=null; try{s.stop();}catch(e){} } clearInterval(timer); cancelAnimationFrame(rafId); edit.forEach(e=>e.el.pause()); setPlayLabel(false); }
let rafId=0;
async function startPlayback(from, destNode){
  if(!destNode && root.classList.contains('aineed')) return;   // waiting for Shubix AI: nothing to play yet
  stopAll();
  const g0 = playGen; starting = true; setPlayLabel(true);
  life({ stage: destNode ? 'exporting' : 'playing the preview', players: sources.reduce((n, s) => n + (s.els || []).filter(v => v.getAttribute('src')).length, 0) });
  const gone = () => g0 !== playGen;
  // the phone's sound wakes up first. An iPhone leaves it "interrupted" after a call, Siri, a locked screen or another
  // app's sound, and then waking it may never answer: Play would hang. So it gets 1.5 s; if the sound still sleeps, Play
  // stops and says so, and the next tap (a new touch, which an iPhone needs) wakes it.
  const c = getCtx(); await Promise.race([c.resume().catch(()=>{}), new Promise(r => setTimeout(r, 1500))]); if(gone()) return;
  if(c.state !== 'running' && !destNode){
    stopAll(); showMsg('The sound did not start (the phone paused it). Tap Play again.', true);
    try{ window.__shubixReport && window.__shubixReport('audio', 'Sound did not start: AudioContext ' + c.state); }catch(e){}
    return;
  }
  // the clips' sound mix: made before playing, except while clips are being read (decoding an iPhone video's sound then
  // would hold Play for many seconds); the next Play has it. Exporting always waits for it (destNode).
  // Preview must not wait for decoding every source clip's audio before it can start.
  // Play immediately with the current music/mix buffer; the completed mix is used by the next
  // preview start. Export still waits for the complete mix so the rendered file is lossless.
  const mixReady = ensureMix();
  if(destNode) await mixReady;
  else mixReady.catch(()=>{});
  if(gone()) return;
  edit.forEach(x=>{ x._cued = false; });
  curIdx = segAt(from); const quick = !destNode;
  if(edit[curIdx-1]){ if(quick) prepare(curIdx-1, edit[curIdx-1].end-0.01, true); else await prepare(curIdx-1, edit[curIdx-1].end-0.01); }
  if(gone()) return; await prepare(curIdx, from, quick); if(gone()) return; if(edit[curIdx+1]) prepare(curIdx+1, edit[curIdx+1].start);
  starting = false;
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
  if(rawRate(edit[curIdx], Math.max(0, from - edit[curIdx].start)) <= PLAY_MAX) edit[curIdx].el.play().catch(()=>{});
  setPlayLabel(true);
  s.onended = () => { if(src===s){ src=null; playing=false; pos=0; edit.forEach(e=>e.el.pause()); setPlayLabel(false); onEnd && onEnd();
    // back at the start: the picture, the progress bar and the playhead too (the time already says 0:00)
    if(!recording){ try{ if(edit.length){ prepare(0, 0).then(() => { if(!playing){ drawFrame(0); drawTimeline(); } }); } drawTimeline(); }catch(e){} } } };
  const loop = () => {
    if(!playing) return;
    const t = Math.max(0, curTime()), i = segAt(t);
    if(i !== curIdx){
      const prevEl = edit[curIdx]?.el; curIdx = i; const e = edit[i], l = t-e.start;
      const r1 = rateAt(e, l), want = srcPos(e, l);
      if(Math.abs(e.el.currentTime-want) > 0.12) e.el.currentTime = want;
      if(r1>0 && rawRate(e, l) <= PLAY_MAX){ e.el.playbackRate = r1; e.el.play().catch(()=>{}); } else e.el.pause();
      if(prevEl && prevEl!==e.el) prevEl.pause();     // stays on its last frame for the transition
      if(edit[i+1]) prepare(i+1, edit[i+1].start);
    } else {
      const e = edit[i], l = t-e.start, r = rateAt(e, l), want = srcPos(e, l);
      if(e.cs && e.cs.rev){ if(!e.el.paused) e.el.pause(); if(!e.rc && Math.abs(e.el.currentTime-want) > 0.12) e.el.currentTime = want; }
      else if(r===0){ if(!e.el.paused) e.el.pause(); if(Math.abs(e.el.currentTime-want) > 0.05) e.el.currentTime = want; }   // freeze frame
      else if(rawRate(e, l) > PLAY_MAX){ if(!e.el.paused) e.el.pause(); if(!e.el.seeking && Math.abs(e.el.currentTime-want) > 0.03) e.el.currentTime = want; }   // too fast to play: frame by frame
      else {   // speed ramps + gentle catch-up: nudge the speed a little instead of jumping (a jump shows as a hitch)
        const diff = want - e.el.currentTime;
        if(Math.abs(diff) > 0.45) e.el.currentTime = want;
        const nr = Math.max(0.0625, Math.min(16, r * (1 + Math.max(-0.2, Math.min(0.2, diff*1.2)))));
        if(Math.abs(e.el.playbackRate - nr) > 0.01) e.el.playbackRate = nr;
        if(e.el.paused) e.el.play().catch(()=>{}); }
      // the shot after next is cued once this one's transition is over (its player may be the one that transition used)
      const n2 = edit[i+2];
      if(n2 && !n2._cued && l > trDur(e) + 0.05){ n2._cued = true; prepare(i+2, n2.start); }
    }
    if(layers.length) syncLayers(t);
    drawFrame(t);
  };
  const raf = () => { loop(); if(playing) rafId = requestAnimationFrame(raf); };
  rafId = requestAnimationFrame(raf);
  timer = setInterval(()=>{ if(document.hidden) loop(); }, 33);
}
let onEnd = null;
$('play').onclick = () => { if(recording) return; if(playing){ pos = curTime(); stopAll(); } else if(starting) stopAll(); else startPlayback(pos >= buf.duration-0.05 ? 0 : pos); };

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
  if(/^video\//.test(blob.type)){ lastVideo = blob; fillCaption(); rememberTools(); offerMade(); }
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
function showMsg(t, err, cls){ const m=$('xmsg'); m.hidden=false; m.textContent=t; m.title=t; m.classList.toggle('err', !!err); m.classList.toggle('addclips', cls === 'addclips'); if(err) notify(t, 'err'); }
// a short note that pops up at the bottom and goes away by itself (errors stay a little longer)
function notify(t, kind){
  const box = $('toasts'); if(!box || !t) return;
  const n = document.createElement('div'); n.className = 'toast' + (kind ? ' ' + kind : ''); n.textContent = t;
  box.appendChild(n); while(box.children.length > 3) box.firstChild.remove();
  requestAnimationFrame(() => n.classList.add('in'));
  setTimeout(() => { n.classList.remove('in'); setTimeout(() => n.remove(), 300); }, kind === 'err' ? 6000 : 3500);
}
// a message with one action button (a late AI plan: "Use it"); it stays a while, the action runs once
function notifyAct(t, label, fn, ms = 20000){
  const box = $('toasts'); if(!box || !t) return;
  const n = document.createElement('div'); n.className = 'toast resume'; n.setAttribute('role', 'status');
  const x = document.createElement('span'); x.textContent = t;
  const go = document.createElement('button'); go.type = 'button'; go.textContent = label;
  const no = document.createElement('button'); no.type = 'button'; no.textContent = 'Not now';
  const close = () => { n.classList.remove('in'); setTimeout(() => n.remove(), 300); };
  go.addEventListener('click', () => { close(); try{ fn(); }catch(e){ console.warn(e); } });
  no.addEventListener('click', close);
  n.append(x, go, no); box.appendChild(n); requestAnimationFrame(() => n.classList.add('in'));
  setTimeout(close, ms);
}
// a yes / no question inside the studio (instead of the browser's own box)
function askConfirm(text, okLabel){
  return new Promise(res => {
    const d = document.createElement('div'); d.className = 'askbg';
    d.innerHTML = `<div class="ask" role="alertdialog" aria-modal="true"><p></p><div class="askrow"><button type="button" class="${Button.secondary}">Cancel</button><button type="button" class="${Button.danger}"></button></div></div>`;
    d.querySelector('p').textContent = text;
    const [no, yes] = d.querySelectorAll('button'); yes.textContent = okLabel;
    const key = e => { if(e.key === 'Escape') done(false); };
    const done = v => { d.remove(); removeEventListener('keydown', key); res(v); };
    no.onclick = () => done(false); yes.onclick = () => done(true); d.onclick = e => { if(e.target === d) done(false); };
    addEventListener('keydown', key); root.appendChild(d); yes.focus();
  });
}
// Real-time recording: only when this browser has no WebCodecs encoder (older Firefox / Safari)
let bgStopped = false, recCleanup = null;
async function recordExport(){
  bgStopped = false;
  const mime = pickMime();
  if(!mime || !out.captureStream){ showMsg('This browser cannot save videos. Please open the studio in Chrome or Safari.', true); return; }
  const keepBuf = buf, keepNorm = normGain;
  let stream = null, dest = null, rec = null, tick = null;
  const chunks = [];
  recording = true; latencyOn = false; ['play','remix','export','cover'].forEach(id=>$(id).disabled=true);
  try{
    setCanvas(true, XQ[xq.res].scale); await captureLoop();
    showMsg('Saving your Reel in real time on this browser (' + fmt(buf.duration) + '). Please keep this screen open.');
    tasks.start('export', 'export', 'Exporting your Reel', 'In real time on this browser · keep this screen open');
    { const t0 = performance.now(), D = Math.max(1, buf.duration*1000); tick = setInterval(() => { if(!recording){ clearInterval(tick); return; } tasks.update('export', Math.min(0.99, (performance.now()-t0)/D)); }, 500); }
    const c = getCtx(); await c.resume();
    dest = c.createMediaStreamDestination();
    stream = new MediaStream([...out.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    rec = new MediaRecorder(stream, {mimeType:mime, videoBitsPerSecond: 12_000_000, audioBitsPerSecond: 256_000});
    rec.ondataavailable = e=>{ if(e.data.size) chunks.push(e.data); };
    const done = new Promise((resolve, reject)=>{
      rec.onstop = resolve;
      rec.onerror = e => reject(e.error || new Error('The browser recorder failed while saving the video.'));
    });
    rec.start(500);
    // this way records the screen as it plays: in the background the browser stops drawing it (a frozen video), so the
    // recording stops there and starts again when the page is back (runExport)
    const onHide = () => { if(isHidden() && rec && rec.state !== 'inactive'){ bgStopped = true; try{ rec.stop(); }catch(err){} } };
    document.addEventListener('visibilitychange', onHide); recCleanup = () => document.removeEventListener('visibilitychange', onHide);
    onEnd = () => { onEnd=null; setTimeout(()=>{ try{ if(rec && rec.state !== 'inactive') rec.stop(); }catch(err){} }, 150); };
    if(noSong){ const sd = exportSound(); buf = sd ? sd.buf : c.createBuffer(2, Math.ceil(keepBuf.duration*c.sampleRate), c.sampleRate); normGain = sd ? sd.gain : 1; }
    pos = 0;
    await startPlayback(0, dest);
    await done;
    if(bgStopped){ const err = new Error('Paused in the background'); err.code = 'BG_PAUSED'; throw err; }
    if(!chunks.length) throw new Error('The browser produced an empty video. Please retry the export.');
    const ext = mime.includes('mp4') ? 'mp4' : 'webm';
    const blob = new Blob(chunks, {type: mime.split(';')[0]});
    if(!blob.size) throw new Error('The exported video is empty. Please retry.');
    const name = fileTitle() + '.' + ext;
    const sh = saveFile(blob, name);
    tasks.done('export', 'Your Reel is ready · ' + (blob.size/1e6).toFixed(1) + ' MB');
    notify('Your Reel is ready', 'ok');
    showMsg(savedMsg(sh, 'Video') + ': '+name+' ('+(blob.size/1e6).toFixed(1)+' MB). Ready for Instagram, TikTok and Shorts.');
  } finally {
    onEnd = null; if(recCleanup){ recCleanup(); recCleanup = null; }
    if(tick) clearInterval(tick);
    try{ if(rec && rec.state !== 'inactive') rec.stop(); }catch(err){}
    try{ stopAll(); }catch(err){}
    if(stream) stream.getTracks().forEach(track=>{ try{ track.stop(); }catch(err){} });
    if(dest) dest.stream.getTracks().forEach(track=>{ try{ track.stop(); }catch(err){} });
    buf = keepBuf; normGain = keepNorm;
    recording = false; latencyOn = true; ['play','remix','export','cover'].forEach(id=>$(id).disabled=false);
    setCanvas(false);
    if(edit.length) captureLoop();
  }
}

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
    // the limiter above is a fast compressor, not a wall: a loud, dense song still overshoots past 0 dB here and there
    // (a crackle on phones, and the quality check below). The whole mix is brought down so its peak sits at -0.5 dBFS
    // (a fraction of a decibel: no audible change).
    if(audio){ let pk = 0; for(let c=0;c<audio.numberOfChannels;c++){ const d = audio.getChannelData(c); for(let i=0;i<d.length;i++){ const v = d[i] < 0 ? -d[i] : d[i]; if(v > pk) pk = v; } }
      if(pk > 0.944){ const k = 0.944/pk; for(let c=0;c<audio.numberOfChannels;c++){ const d = audio.getChannelData(c); for(let i=0;i<d.length;i++) d[i] *= k; } } }
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
    const sinks = new Map(), LIVE = EXPORT_DECODER_LIMIT;
    const sinkFor = async (si, slot) => {
      const key = si + ':' + slot;
      if(sinks.has(key)){ const v = sinks.get(key); sinks.delete(key); sinks.set(key, v); }   // most recently used last
      else {
        while(sinks.size >= LIVE){ const [k0, old] = sinks.entries().next().value; sinks.delete(k0); try{ old.input.dispose(); }catch(err){} const ii = inputs.indexOf(old.input); if(ii >= 0) inputs.splice(ii, 1); }
        // a heavy iPhone clip is read from its edit copy (1080p 30 fps H.264); a 4K export reads the original when it decodes
        const s0 = sources[si];
        let input = null, track = null, sw = s0.w, sh0 = s0.h;
        if(s0.edFile && xq.res === '4k'){ const i0 = new mb.Input({ source: new mb.BlobSource(s0.file), formats: mb.ALL_FORMATS }); const t0 = await i0.getPrimaryVideoTrack().catch(() => null); if(t0 && await t0.canDecode().catch(() => false)){ input = i0; track = t0; } else { try{ i0.dispose(); }catch(err){} } }
        if(!input){ input = new mb.Input({ source: new mb.BlobSource(decFile(s0)), formats: mb.ALL_FORMATS }); track = await input.getPrimaryVideoTrack(); if(s0.edFile && s0.edW){ sw = s0.edW; sh0 = s0.edH; } }
        inputs.push(input);
        const r = Math.min(1, Math.max(W/sw, H/sh0)*1.3);
        let sfps = 30; try{ const stt = await track.computePacketStats(90); if(stt && stt.averagePacketRate > 1) sfps = stt.averagePacketRate; }catch(err){}
        sinks.set(key, { input, sink: new mb.CanvasSink(track, { width: Math.max(16, Math.round(sw*r/2)*2), height: Math.max(16, Math.round(sh0*r/2)*2), fit: 'fill', poolSize: EXPORT_FRAME_POOL }), first: await track.getFirstTimestamp(), half: 0.5/sfps });
      }
      return sinks.get(key);
    };
    // video layers: one decoder each, its frames asked for in time order (one per output frame while it shows)
    const lyIts = [];
    for(const L of layers){ const M = lmedia[L.m]; if(!M || M.kind !== 'video') continue;
      const input = new mb.Input({ source: new mb.BlobSource(M.file), formats: mb.ALL_FORMATS }); inputs.push(input);
      const track = await input.getPrimaryVideoTrack(); if(!track) continue;
      const r = Math.min(1, (L.s*W)/M.w*1.4), first = await track.getFirstTimestamp();
      const sink = new mb.CanvasSink(track, { width: Math.max(16, Math.round(M.w*r/2)*2), height: Math.max(16, Math.round(M.h*r/2)*2), fit: 'fill', poolSize: LOW_MEMORY_DEVICE ? 2 : 3 });
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
    let f = 0, nextAudio = 0; const prof = root.__prof = { decode:0, draw:0, encode:0, frames:0, glLostFrames:0, missing:0, recovered:0, unresolved:0 }; let tq = performance.now();
    // Sample the actual composited output (not source footage) for the autonomous quality gate.
    const qualityFrames = []; let previousQualityPixels = null, lastQualityShot = -1;
    const qualityCanvas = document.createElement('canvas'); qualityCanvas.width = qualityCanvas.height = 32;
    const qualityCtx = qualityCanvas.getContext('2d', { willReadFrequently: true });
    const sampleQualityFrame = (time) => {
      if(!qualityCtx) return { time, hasFrame: true };
      try {
        qualityCtx.drawImage(out, 0, 0, 32, 32);
        const pixels = qualityCtx.getImageData(0, 0, 32, 32).data;
        let black = 0, distance = 0, count = 0;
        for(let i=0;i<pixels.length;i+=4){
          const luma = 0.2126*pixels[i] + 0.7152*pixels[i+1] + 0.0722*pixels[i+2];
          if(luma < 8) black++;
          if(previousQualityPixels){ distance += (Math.abs(pixels[i]-previousQualityPixels[i]) + Math.abs(pixels[i+1]-previousQualityPixels[i+1]) + Math.abs(pixels[i+2]-previousQualityPixels[i+2]))/3; count++; }
        }
        previousQualityPixels = new Uint8ClampedArray(pixels);
        return { time, hasFrame: true, blackRatio: black/1024, ...(count ? { duplicateDistance: distance/(count*255) } : {}) };
      } catch(err) { return { time, hasFrame: true }; }
    };
    const tStart = performance.now();
    pre = open(0);
    for(let i=0; i<edit.length; i++){
      const e = edit[i], sh = shots[i], cur = await pre; pre = null;
      if(!cur){ pre = open(i+1); continue; }
      let k = sh.f0, r = await cur.firstP, consecutiveMissing = 0;
      pre = open(i+1);   // the next shot starts seeking now, while this one is drawn
      // Encode the complete timeline range, not merely however many frames the decoder happens to yield.
      // A short/variable-frame-rate source can end its timestamp iterator early; skipping those output timestamps
      // makes the muxer hold the last picture, which looks exactly like a still photo at the next transition.
      while(k < sh.fEnd){
        const wc = r.done ? null : r.value;
        const ta = performance.now(); prof.decode += ta - tq;
        if(wc){ e.fc = wc.canvas; consecutiveMissing = 0; }
        else {
          prof.missing++;
          const requested = cur.ts[k-sh.f0];
          // Ask the same source decoder for the nearest real frame around this output timestamp. Never substitute
          // a frame from the previous shot: each clip owns its own fallback image.
          let nearest = null;
          for(const offset of [0, 0.05, -0.05, 0.1, -0.1]){
            nearest = await cur.sink.getCanvas(requested + offset);
            if(nearest) break;
          }
          if(!nearest) nearest = await cur.sink.getCanvas(cur.first + 0.02);
          if(nearest){ e.fc = nearest.canvas; consecutiveMissing = 0; prof.recovered = (prof.recovered || 0) + 1; }
          else {
            consecutiveMissing++; prof.unresolved = (prof.unresolved || 0) + 1;
            if(!e.fc || consecutiveMissing >= 2) throw new Error('The video decoder could not supply consecutive frames for this clip; retrying with real-time export.');
          }
        }
        if(GL && GL.lost) prof.glLostFrames++;
        if(lyIts.length) await layerFrames(k);
        if(bgNeeded() && personMask){ holdText = true; try{ drawFrame(k/fps); } finally { holdText = false; } await maskNow(); bgPass(k/fps); drawText(k/fps); }
        else drawFrame(k/fps);
        {
          const shotStart = sh.f0/fps, shotDuration = (sh.fEnd-sh.f0)/fps, local = k/fps-shotStart, inset = Math.min(0.18, shotDuration*0.2);
          const firstUsefulFrame = lastQualityShot !== i && local >= inset;
          const periodicFrame = k % Math.max(1, Math.round(fps*0.5)) === 0 && local >= inset && local <= shotDuration-inset;
          if(firstUsefulFrame || periodicFrame){ qualityFrames.push(sampleQualityFrame(k/fps)); lastQualityShot = i; }
        }
        const tb = performance.now(); prof.draw += tb - ta;
        await vs.add(k/fps, 1/fps);
        if(expCancel){ const err = new Error('Export cancelled'); err.code = 'CANCELLED'; throw err; }
        tq = performance.now(); prof.encode += tq - tb; prof.frames++;
        while(as && nextAudio <= k/fps + 1 && nextAudio*1 < dur){ const ab = chunkOf(nextAudio); if(ab) await as.add(ab); nextAudio++; }
        k++;
        if(k % 15 === 0){
          const done = k/total, el = (performance.now()-tStart)/1000, left = done > 0.03 ? el/done - el : null;
          $('xmsg').textContent = 'Exporting… ' + Math.round(done*100) + '%' + (left !== null ? ' · about ' + (left < 60 ? Math.ceil(left) + ' s' : Math.ceil(left/60) + ' min') + ' left' : '') + (document.hidden ? '' : ' · keep this screen on');
          $('prog').style.width = (done*100).toFixed(1) + '%';
          tasks.update('export', done, done < 0.95 ? 'Putting your Reel together · keep this screen on' : 'Finishing the video file'); exportP = done; titleProgress('export', 'Exporting your Reel', done);
          await yieldNow();
        }
        if(k < sh.fEnd && !r.done) r = await cur.it.next();
      }
      if(e.fc){ const c = document.createElement('canvas'); c.width = e.fc.width; c.height = e.fc.height; c.getContext('2d').drawImage(e.fc,0,0); e.fcLast = c; }
      e.fc = null; f = sh.fEnd;
      { const o = edit[i-2]; if(o && o.fcLast){ o.fcLast.width = o.fcLast.height = 0; o.fcLast = null; } }   // older last frames are not drawn again
    }
    { const p2 = await pre; pre = null; if(p2 && p2.it.return) try{ await p2.it.return(); }catch(err){} }
    while(as && nextAudio < dur){ const ab = chunkOf(nextAudio); if(ab) await as.add(ab); nextAudio++; }
    if(prof.frames !== total) throw new Error('Export frame count mismatch: expected ' + total + ', encoded ' + prof.frames + '. Retrying with real-time export.');
    const audioQuality = audio ? (() => {
      let peak = 0, clipped = 0, silent = 0, count = 0;
      for(let ch=0;ch<audio.numberOfChannels;ch++){
        const data = audio.getChannelData(ch);
        for(let i=0;i<data.length;i+=8){ const v=Math.abs(data[i]||0); peak=Math.max(peak,v); if(v>=0.999) clipped++; if(v<0.001) silent++; count++; }
      }
      return { peakDbfs: 20*Math.log10(Math.max(peak,1e-10)), clippedRatio: clipped/Math.max(1,count), silenceRatio: silent/Math.max(1,count) };
    })() : undefined;
    const quality = assessAutonomousRenderQuality({
      expectedDuration: dur, actualDuration: prof.frames/fps, width: W, height: H, fps,
      frames: qualityFrames, ...(audioQuality ? { audio: audioQuality } : {}),
    });
    root.__lastQualityReport = quality;
    // a finished Reel is never thrown away by the check (a night clip is mostly black; the picture was already checked
    // frame by frame above): what it found is reported (Admin → Errors) and kept for tests
    if(quality.status === 'fail'){
      console.warn('Shubix export quality check:', quality.errors);
      try{ window.__shubixReport && window.__shubixReport('export', 'Quality check: ' + quality.errors.join(' '), JSON.stringify({ score: quality.score, repairs: quality.repairs })); }catch(err){}
    }
    if(quality.warnings.length) console.warn('Shubix export quality warnings:', quality.warnings);
    await output.finalize();
    const blob = new Blob([output.target.buffer], {type: mp4 ? 'video/mp4' : 'video/webm'});
    const name = fileTitle() + '.' + (mp4 ? 'mp4' : 'webm');   // the Reel's own name (Untitled 1, or what it was renamed to)
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
$('fexpcancel')?.addEventListener('click', () => { if(!exportBusy) return; expCancel = true; $('fexpcancel').textContent = 'Cancelling…'; }, SIG);
// the editor's head: tap the name to rename the Reel (Enter or tap away keeps it, Esc does not)
{ const btn = $('tbrename'), inp = $('tbnamein');
  if(btn && inp){
    let open = false;
    const close = (keep) => { if(!open) return; open = false; const v = inp.value; inp.hidden = true; btn.hidden = false;
      if(keep && setReelTitle(v)){ notify('Renamed to "' + reelTitle + '"', 'ok'); try{ const st = stateOf(); saveProject(st, JSON.stringify(st)); }catch(e){} } };
    btn.addEventListener('click', () => { open = true; inp.value = reelTitle || ''; btn.hidden = true; inp.hidden = false; inp.focus(); inp.select(); }, SIG);
    inp.addEventListener('keydown', ev => { if(ev.key === 'Enter'){ ev.preventDefault(); close(true); } else if(ev.key === 'Escape'){ ev.preventDefault(); close(false); } }, SIG);
    inp.addEventListener('blur', () => close(true), SIG);
  } }
document.addEventListener('visibilitychange', ()=>{ if(exportBusy && !document.hidden && !wakeLock) holdScreen(); }, SIG);
// the preview stops when the person goes to another tab or app (the song is WebAudio: pausing the page's videos alone keeps it playing)
document.addEventListener('visibilitychange', ()=>{ if(isHidden() && playing && !recording) stopAll(); }, SIG);
async function autoExport(cloud = false){
  if(exportBusy) return null; exportKeep = true; exportP = 0; lastVideo = null;
  // cloud: also kept in My Reels, as the website's Export sheet does (when the account has room and the switch is on)
  try{ await runExport(!!cloud && !!cloudInfo && cloudInfo.used < cloudInfo.limit && xq.my); } finally { exportKeep = false; }
  return lastVideo;
}
async function runExport(toCloud){
  if(recording || exportBusy) return;
  if(root.classList.contains('aineed')){ $('aiaskgo').click(); return; }   // no Reel without its Shubix AI (the creator closed the question)
  exportBusy = true; $('saverow').hidden = true; lastVideo = null;
  tasks.start('export', 'export', 'Exporting your Reel', 'Getting ready');   // in view at once, whatever comes next
  askToNotify();   // once: a notification when the Reel is ready while the person is in another app
  const awake = holdAwake();
  await holdScreen();
  expCancel = false;
  // work interrupted by the background (the browser took the decoder back, or stopped drawing) is not lost: it waits
  // for the page to come back and goes on (twice at most), instead of falling to the slower way or failing
  const paused = async () => { tasks.update('export', null, 'Paused while you were away · it goes on when you come back'); showMsg('Your export paused while Shubix was in the background. It goes on now that you are back.'); await whenVisible(); tasks.update('export', exportP || 0, 'Going on with your export'); };
  const fastBg = async () => { for(let k = 0; ; k++){ const seq = bgSeq; try{ return await fastExport(); } catch(err){ if(err && (err.code === 'CANCELLED' || err.code === 'QUALITY_GATE_FAILED')) throw err; if(k >= 2 || !(isReclaimed(err) || isHidden() || bgSeq !== seq)) throw err; console.info('export paused by the background', err); await paused(); } } };
  const recordBg = async () => { for(let k = 0; ; k++){ try{ return await recordExport(); } catch(err){ if(k >= 3 || !(err && err.code === 'BG_PAUSED')) throw err; await paused(); } } };
  try{
    let ok = false;
    try{ ok = await fastBg(); }
    catch(err){ if(err && err.code === 'CANCELLED'){ tasks.clear('export'); notify('Export cancelled. Your Reel is still here.'); return; }
      if(err && err.code === 'QUALITY_GATE_FAILED'){ tasks.fail('export', err.message); showMsg(err.message, true); throw err; } console.warn('fast export failed', err); tasks.update('export', null, 'Switching to a slower way to save on this phone…'); showMsg('Switching to a slower way to save on this phone. Please keep this screen open…'); }
    if(!ok){
      try{
        ok = await recordBg();
        if(!ok){ tasks.fail('export', 'This browser cannot export video. Open Fast Studio in Chrome or Safari.'); showMsg('This browser cannot export video. Please open Fast Studio in Chrome or Safari.', true); }
      } catch(err){ console.error('real-time export failed', err); tasks.fail('export', 'Export failed. Please retry with the screen open.'); showMsg('Export failed: ' + (err && err.message ? err.message : 'Please retry in Chrome or Safari.'), true); }
    }
    if(toCloud && lastVideo) await saveToMyReels(lastVideo);
    if(lastVideo) void notifyDone('Your Reel is ready', fileTitle() + ' is saved · tap to open Shubix', 'shubix-export');
    else void notifyDone('Your export stopped', 'Open Shubix to try again', 'shubix-export');
  } finally {
    titleDone('export'); awake();
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
let can4k = null, cloudInfo = null, cloudAt = 0;
function exportDims(){ const [W0,H0] = SIZES[aspect], k = XQ[xq.res].scale; return [Math.round(W0*k/2)*2, Math.round(H0*k/2)*2]; }
function planPaint(){
  const lb = $('look'); if(lb) for(const b of lb.querySelectorAll('[data-l]')){ const k = b.dataset.l, on = isLocked('look', k); b.classList.toggle('crowned', on); b.title = on ? PLAN_NAME[lockNeed('look', k)] + ' filter: try it, export asks' : ''; }
  if(edit.length){ renderEDL(true); renderOvList(); }
}
// what in this Reel needs a higher plan, each with how to take it out
function lockedUsed(){
  const out = [], add = (cat, key, name, fix) => { if(isLocked(cat, key)) out.push({ need: lockNeed(cat, key), name, fix }); };
  for(const e of edit){
    if(e.tr && e.tr !== 'hard') add('tr', e.tr, TR_NAME[e.tr] || e.tr, () => { e.tr = 'dissolve'; });
    if(e.efx && e.efx !== 'none') add('fx', e.efx, FX_NAME[e.efx] || e.efx, () => { e.efx = 'none'; e.kf = keyframesFor(e); });
    const c = e.cs || {};
    if(c.beauty) add('tool', 'beauty', 'Beauty', () => { delete e.cs.beauty; });
    if(c.stab) add('tool', 'stab', 'Stabilize', () => { delete e.cs.stab; });
    if(c.curve) add('tool', 'curve', 'Speed curve', () => { delete e.cs.curve; e.sp = SPEED.normal; });
  }
  add('look', look, (LOOKS[look] || {}).name || look, () => { const b = $('look').querySelector('[data-l="vivid"]'); if(b) b.click(); });
  for(const o of overlays){ if(o.font) add('font', o.font, 'Font ' + ((OV_FONTS[o.font] || [])[0] || o.font), () => { o.font = undefined; });
    if(!o.emoji) add('text', o.style, 'Text style ' + (OV_STYLES[o.style] || o.style), () => { o.style = 'bold'; });
    if(o.track) add('tool', 'track', 'Text follows the person', () => { o.track = false; }); }
  const R = exRule(), rk = { '720': 0, '1080': 1, '4k': 2 };
  if(rk[xq.res] > rk[R.maxRes]) out.push({ need: xq.res === '4k' ? 'pro' : 'creator', name: XQ[xq.res].label + ' quality', fix: () => { xq.res = R.maxRes; } });
  if(xq.fps === 60 && !R.fps60) out.push({ need: 'creator', name: '60 fps', fix: () => { xq.fps = 30; } });
  const seen = new Set(); return out.filter(x => !seen.has(x.name) && seen.add(x.name));
}
// the export's question when the Reel uses crowned items: upgrade, or take them out and export
function planGate(list){
  return new Promise(res => {
    const top = list.reduce((a, x) => planRank(x.need) > planRank(a) ? x.need : a, 'creator');
    const d = document.createElement('div'); d.className = 'askbg';
    // as the design (frame 9): ✕, a crown, what it is, what is in it, Upgrade Now · Take them out
    d.innerHTML = `<div class="ask lockpop" role="alertdialog" aria-modal="true" aria-labelledby="lkt"><button type="button" class="${Button.close} absolute top-3 right-3" aria-label="Close">✕</button><div class="lkcrown" aria-hidden="true">👑</div><h3 class="lkt" id="lkt"></h3><p class="gt"></p><ul class="gl"></ul><div class="askrow"><a class="${Button.primary}" href="/pricing">Upgrade Now</a><button type="button" class="${Button.secondary}">Take them out</button></div></div>`;
    d.querySelector('.lkt').textContent = 'This is a ' + PLAN_NAME[top] + ' Feature';
    d.querySelector('.gt').textContent = 'Your Reel uses ' + PLAN_NAME[top] + ' features. Upgrade to export it as it is, or take them out and export now.';
    const ul = d.querySelector('.gl'); for(const x of list.slice(0, 8)){ const li = document.createElement('li'); li.textContent = x.name + ' · ' + PLAN_NAME[x.need]; ul.appendChild(li); }
    const [no, fix] = d.querySelectorAll('button'), done = v => { d.remove(); res(v); };
    no.onclick = () => done(false); fix.onclick = () => { list.forEach(x => x.fix()); done(true); }; d.onclick = e => { if(e.target === d) done(false); };
    root.appendChild(d); fix.focus();
  });
}
function sheetPaint(){
  [...$('xres').children].forEach(b => { b.setAttribute('aria-pressed', b.dataset.r === xq.res); if(b.dataset.r === '4k'){ b.disabled = can4k === false; b.title = can4k === false ? 'This phone cannot make 4K videos' : ''; } });
  [...$('xfps').children].forEach(b => b.setAttribute('aria-pressed', +b.dataset.f === xq.fps));
  const [W, H] = exportDims(), dur = buf ? buf.duration : 0, mb = (XQ[xq.res].bitrate * (xq.fps > 30 ? 1.5 : 1) + 256e3) * dur / 8 / 1e6;
  $('xsize').textContent = W + ' × ' + H + ' · ' + xq.fps + ' fps · up to ' + (mb < 10 ? mb.toFixed(1) : Math.round(mb)) + ' MB';
  { const fn = $('xfname'); if(fn) fn.textContent = fileTitle() + '.mp4'; }
  // Remove Watermark, and Save to My Reels (when the account has My Reels); "Export to phone" does what they say
  wmPaid = exRule().noWatermark; const R = exRule();
  for(const b of $('xres').children) b.classList.toggle('crowned', { '720': 0, '1080': 1, '4k': 2 }[b.dataset.r] > { '720': 0, '1080': 1, '4k': 2 }[R.maxRes]);
  for(const b of $('xfps').children) b.classList.toggle('crowned', b.dataset.f === '60' && !R.fps60);
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
// the export sheet's picture: the preview's own picture, copied while the sheet is open (it plays the Reel as the
// editor does, with its song); closing the sheet stops it
function xprevLoop(){
  if($('xsheet').hidden) return;
  const c = $('xprevc'); if(c.width !== out.width || c.height !== out.height){ c.width = out.width; c.height = out.height; }
  try{ c.getContext('2d').drawImage(out, 0, 0); }catch(e){}
  $('xprevplay').hidden = playing || starting;
  requestAnimationFrame(xprevLoop);
}
$('xprev').addEventListener('click', () => { if(!exporting) $('play').click(); }, SIG);
function sheetOpen(open){
  $('xsheet').hidden = !open;
  if(!open){ if(playing && !recording){ pos = curTime(); stopAll(); } return; }
  // the Reel beside the settings (the design's frame 8)
  if(edit.length){ $('xprev').setAttribute('src', 'live'); requestAnimationFrame(xprevLoop); }
  sheetPaint();
  $('xgo').focus();
  if(can4k === null) loadMediabunny().then(mb => { const [W0,H0] = SIZES[aspect]; return mb.getFirstEncodableVideoCodec(['avc','vp9','av1'], {width: W0*2, height: H0*2}); })
    .then(c => { can4k = !!c; if(!can4k && xq.res === '4k') xq.res = '1080'; sheetPaint(); }, () => { can4k = false; sheetPaint(); });
  // My Reels' room, asked once a minute at most (the sheet opens often; each request wakes the API's container)
  if(cloud && Date.now() - cloudAt > 60_000){ cloudAt = Date.now(); cloud.usage().then(u => { cloudInfo = u; sheetPaint(); }, () => { cloudAt = 0; }); }
  // a paid plan (or the administrator) may remove the watermark
  planLoad();   // the plan's rules (watermark, quality) are read again; sheetPaint follows
}
const sheetPick = () => { try{ localStorage.setItem('studio-export', JSON.stringify(xq)); }catch(e){} sheetPaint(); };
$('xres').addEventListener('click', e => { const b = e.target.closest('button'); if(!b || b.disabled) return; xq.res = b.dataset.r; sheetPick(); }, SIG);
$('xfps').addEventListener('click', e => { const b = e.target.closest('button'); if(!b) return; xq.fps = +b.dataset.f; sheetPick(); }, SIG);
$('xshclose').addEventListener('click', () => sheetOpen(false), SIG);
$('xsheet').addEventListener('click', e => { if(e.target === $('xsheet')) sheetOpen(false); }, SIG);
addEventListener('keydown', e => { if(e.key === 'Escape' && !$('xsheet').hidden) sheetOpen(false); }, SIG);
$('xwm').addEventListener('change', e => { if(!wmPaid){ e.target.checked = false; return; } xq.nowm = e.target.checked; wmOff = xq.nowm; sheetPick(); }, SIG);
$('xmy').addEventListener('change', e => { xq.my = e.target.checked; sheetPick(); }, SIG);
$('xgo').addEventListener('click', async () => { const L = lockedUsed(); if(L.length){ if(!(await planGate(L))) return; renderEDL(true); renderOvList(); sheetPaint(); }
  wmOff = wmPaid && xq.nowm; sheetOpen(false); runExport(!!cloudInfo && cloudInfo.used < cloudInfo.limit && xq.my); }, SIG);
$('xgocloud').addEventListener('click', async () => { const L = lockedUsed(); if(L.length){ if(!(await planGate(L))) return; renderEDL(true); renderOvList(); }
  sheetOpen(false); runExport(true); }, SIG);
$('export').onclick = () => { if(recording || exportBusy) return; if(root.classList.contains('aineed')){ $('aiaskgo').click(); return; } sheetOpen(true); };

async function saveToMyReels(blob){
  if(!cloud) return;
  const [W, H] = exportDims(), name = reelTitle || 'Reel';
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
  ai: 'Shubix AI: Shubix watches your clips and listens to the song, then decides every cut, transition, effect, speed and camera move.',
  smooth: 'Smooth: fewer, longer shots on the strong beats, soft camera moves, no flashy effects.',
  fast: 'Fast: a cut on every beat, a transition on every cut, punches and speed changes on the hits.',
  copy: 'Copy a Reel: its pace, transitions and shapes, camera moves, speed and colours, on this song and your clips. With Shubix on, it copies what the Reel does on each kind of music moment.',
};
// a learned style used for a creator (by their template's kind, styleForTemplate) changes only the edit: the creator never
// sees it, the mode they had stays pressed. The administrator sees it as Copy a Reel.
const silentStyle = () => !!(refProfile && refProfile.silent);
// with the AI on (aiOn), "Auto" is the AI deciding freely: named so (Smooth and Fast are styles the AI is asked for)
function modeWords(shown){ const b = $('mode').querySelector('[data-m="auto"]'); if(b) b.textContent = aiOn ? 'Shubix AI' : 'Auto';
  $('modehelp').textContent = MODE_HELP[shown === 'auto' && aiOn ? 'ai' : shown]; }
function setMode(m){ mode = m; const shown = m === 'copy' && silentStyle() ? refProfile.shown || 'auto' : m;
  [...$('mode').children].forEach(x=>x.setAttribute('aria-pressed', x.dataset.m===shown)); modeWords(shown);
  $('refbox').hidden = !refProfile || silentStyle();
  if(buf){ plan = adaptPlan(); drawMusic(); $('mclips').textContent = plan.length; }
  if(buf && sources.length) makeEdit(); }
$('mode').addEventListener('click', e=>{ const b=e.target.closest('button'); if(!b || recording) return; remakeOk();
  if(b.dataset.m === 'copy' && (!refProfile || silentStyle())){ $('reffile').click(); return; }
  if(silentStyle() && mode === 'copy' && b.dataset.m === (refProfile.shown || 'auto')) return;   // already what they see
  setMode(b.dataset.m); });
$('cover').onclick = async () => {
  // cover: the best drop shot (or the hook) with the hook text, full frame
  const d = edit.find(x=>x.type==='drop') || edit[0], tt = d.start + Math.min(0.6, (d.end-d.start)*0.6);
  setCanvas(true); coverMode = true; const i = segAt(tt); await prepare(i, tt); drawFrame(tt);
  const blob = await new Promise(r=>out.toBlob(r,'image/jpeg',0.92)); coverMode = false; setCanvas(false); captureLoop();
  const sh = saveFile(blob, fileTitle() + ' cover.jpg'); showMsg(savedMsg(sh, 'Cover') + '. Pick it under "Edit cover" when you post.');
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
  iris:'circle reveals', diamond:'diamond reveals', heart:'heart reveals', star:'star reveals', wipe:'wipes', bars:'bar reveals', blur:'blur transitions' };
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
// the Reel being read is letterboxed (wide footage between black bars): its frames are measured without the bars, or every
// cut looks small and every shot looks dark (a night party read as fades to black)
let refBars = null;   // { y0, y1 }: the picture's rows, as fractions of the height
function greyOf(canvas){
  const W0 = canvas.width, H0 = canvas.height, y0 = refBars ? Math.round(refBars.y0*H0) : 0, FH = refBars ? Math.max(4, Math.round(refBars.y1*H0) - y0) : H0, FW = W0;
  const d = canvas.getContext('2d', {willReadFrequently:true}).getImageData(0,y0,FW,FH).data, Y = new Float32Array(FW*FH); let m = 0, gx = 0, gy = 0;
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
  const early = fr.filter(f=>f.k < -2 && f.k >= -CUT_K), eMax = early.length ? early.reduce((q,f)=>f.mean > q.mean ? f : q, early[0]) : null;
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
// Every frame of the Reel to copy, small: its hard cuts to the frame and its flicker montages (a new picture on nearly
// every frame). The clip reading (scanMotion) samples a clip and wants a cut to stand out from the change around it: an
// edit cut on every eighth note, stutters of a tenth of a second or the same shot coming back a moment later slipped
// through it (a 29 s car Reel with 61 cuts and a 3 s flicker read as 21 cuts, none in its first 10 s).
async function frameCuts(fs, dur, onP){
  const FPS = 30, ts = []; for(let t=0.5/FPS; t<dur-0.02; t+=1/FPS) ts.push(+t.toFixed(4));
  const n = ts.length, d = new Float32Array(n), hd = new Float32Array(n); let pY = null, pH = null;
  for(let k=0;k<n;k+=150){
    const cv = await fs.small(ts.slice(k, k+150));
    cv.forEach((c,j)=>{ const i = k+j; if(!c){ pY = null; return; }
      const g = greyOf(c), H = new Float32Array(16); for(let q=0;q<g.Y.length;q++) H[Math.min(15, (g.Y[q]*16)|0)] += 1/g.Y.length;
      if(pY && pY.length === g.Y.length){ let s2=0; for(let q=0;q<g.Y.length;q++) s2 += Math.abs(g.Y[q]-pY[q]); d[i] = s2/g.Y.length; let h2=0; for(let q=0;q<16;q++) h2 += Math.abs(H[q]-pH[q]); hd[i] = h2/2; }
      pY = g.Y; pH = H; });
    if(onP) onP(Math.min(1, (k+150)/n));
  }
  // a flicker: 9 of 15 frames (half a second) jump to another picture; it runs from its first to its last double jump
  const big = i => d[i] > 0.12, W = 15, fl = new Uint8Array(n), flicker = [];
  for(let i=0;i+W<=n;i++){ let c2=0; for(let j=i;j<i+W;j++) if(big(j)) c2++; if(c2 >= 9) fl.fill(1, i, i+W); }
  for(let i=0;i<n;i++){ if(!fl[i]) continue; let j=i; while(j+1<n && fl[j+1]) j++;
    let a=i; while(a<j && !(big(a) && big(a+1))) a++; let b=j; while(b>a && !(big(b) && big(b-1))) b--;
    if(b - a >= 8) flicker.push({ t0: a/FPS, t1: (b+1)/FPS }); i = j; }
  // a hard cut: a jump far above the motion of the 8 frames around it (its neighbours may be cuts too: the median), the
  // brightness histogram moving with it (a fast pan moves the pixels, not the histogram)
  const inF = t => flicker.some(f => t >= f.t0 - 0.02 && t <= f.t1 + 0.02), cuts = [];
  for(let i=3;i<n-1;i++){ const t = i/FPS; if(inF(t)) continue;
    const nb = []; for(let j=Math.max(1,i-4); j<=Math.min(n-1,i+4); j++) if(j !== i) nb.push(d[j]); nb.sort((x,y)=>x-y);
    const loc = nb.length ? (nb[(nb.length-1)>>1] + nb[nb.length>>1])/2 : 0;
    if(d[i] > 0.07 && d[i] > 2.2*loc && d[i] >= d[i-1] && d[i] >= d[i+1] && (hd[i] > 0.08 || d[i] > 0.15)) cuts.push(t); }
  return { cuts, flicker };
}
const refKeyOf = f => f ? f.name + '|' + f.size + '|' + (f.lastModified || 0) : '';
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
    const ps = { url, dur, w, h, file }; let refCutsOut = [];   // file: the scene reading decodes it with WebCodecs (without it, one seek a frame: minutes)
    await scanMotion(ps, p => onP(0.05 + 0.35*p, 'finding its cuts'));
    const shots = [], looks = [];
    const fs = await frameSource(file, v, w, h);
    try{
      // black bars (letterbox): the rows that stay dark in every one of 12 frames
      refBars = null;
      { const smp = await fs.small(Array.from({ length: 12 }, (_, i) => Math.min(dur - 0.05, (i + 0.5)*dur/12)));
        const ok = smp.filter(Boolean); if(ok.length >= 6){ const H0 = ok[0].height, W0 = ok[0].width, rowMax = new Float32Array(H0);
          for(const c of ok){ const d = c.getContext('2d', {willReadFrequently:true}).getImageData(0,0,W0,H0).data; for(let y=0;y<H0;y++){ let s2 = 0; for(let x=0;x<W0;x++){ const i=(y*W0+x)*4; s2 += 0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]; } rowMax[y] = Math.max(rowMax[y], s2/W0/255); } }
          let t = 0; while(t < H0 && rowMax[t] < 0.07) t++; let b = H0 - 1; while(b > t && rowMax[b] < 0.07) b--;
          if((t > 0.06*H0 || H0 - 1 - b > 0.06*H0) && b - t > 0.25*H0) refBars = { y0: t/H0, y1: (b + 1)/H0 }; } }
      // every frame: the hard cuts to the frame and the flickers; the scene reading adds its fades, dissolves and the
      // cuts hidden in a moving transition (a whip's blur)
      const fc = await frameCuts(fs, dur, p => onP(0.4 + 0.1*p, 'finding every cut'));
      const inFl = t => fc.flicker.some(f => t > f.t0 - 0.05 && t < f.t1 + 0.05);
      const found = fc.cuts.filter(t => t > 0.08 && t < dur - 0.1).map(t => ({ t, hint: 'cut', exact: true }));
      // a cut: its first new frame; a fade / flash: its darkest / brightest moment; a dissolve: its middle
      for(const sc of ps.scenes || []){ const t = sc.kind === 'cut' ? sc.t1 : sc.tc !== undefined ? sc.tc : (sc.t0 + sc.t1)/2;
        if(t <= 0.15 || t >= dur - 0.15 || inFl(t)) continue;
        const near = found.findIndex(c => Math.abs(c.t - t) < (sc.kind === 'cut' ? 0.1 : 0.2));
        if(near < 0) found.push({ t, hint: sc.kind }); else if(sc.kind !== 'cut') found[near] = { t, hint: sc.kind, exact: found[near].exact }; }
      // a flicker is one shot of its own (from its first to its last jump): cuts at both of its ends
      fc.flicker.forEach(f => { if(f.t0 > 0.08) found.push({ t: f.t0, hint: 'cut', flick: true }); if(f.t1 < dur - 0.1) found.push({ t: f.t1, hint: 'cut', flickEnd: true }); });
      found.sort((a,b)=>a.t-b.t);
      const cuts = found.filter((c,i) => !i || c.t - found[i-1].t > 0.05);
      const flicks = fc.flicker;
      // what happens at each cut: the frames around it, decoded in one pass
      onP(0.5, 'reading its transitions');
      const ts = []; cuts.forEach(c=>{ for(let k=-CUT_K;k<=CUT_K;k++) ts.push(Math.min(Math.max(0.005, c.t + k/30 + 0.005), dur-0.02)); });
      const frames = ts.length ? await fs.small(ts) : [];
      cuts.forEach((c,i)=>{ const cv = frames.slice(i*(2*CUT_K+1), (i+1)*(2*CUT_K+1)), fr = cutFramesOf(cv);
        const at = k => fr.find(f=>f.k===k);
        // a spin: the picture turns over the frames before the cut
        { let cw = 0, ccw = 0; for(let k=-4;k<0;k++){ const a = at(k), b = at(k+1); if(!a || !b) continue; const r = motionBetween(a.Y, b.Y, a.FW, a.FH).r; if(r >= 6) cw++; else if(r <= -6) ccw++; }
          fr.spin = Math.max(cw, ccw) >= 2; }   // turned the same way on two frames or more
        // a glitch: red and blue pulled apart on two frames or more around the cut
        fr.glitch = cv.slice(CUT_K-3, CUT_K+4).filter(x=>rgbShiftOf(x) >= 2).length >= 2;
        if(!c.exact && c.hint === 'fade'){ const mid = fr.filter(f => Math.abs(f.k) <= 3).map(f => f.mean); if(mid.length && Math.min(...mid) > 0.08 && Math.max(...mid) < 0.9) c.hint = 'cut'; }   // not dark (nor white) in its middle: not a fade
        c.kind = cutKind(fr, c.hint); if(fr.shiftTo) c.t += fr.shiftTo/30;
        { const af = fr.filter(f => f.k >= 3); c.after = af.length ? af.reduce((q,f)=>q+f.mean,0)/af.length : 1; }   // how bright the next shot is
        // a reveal through a shape (circle, diamond, heart, star, wipe, bars): the frames in the middle of the transition
        const stepOf = k => { const a = at(k-1), b = at(k); if(!a || !b) return null; let s = 0; for(let q=0;q<a.Y.length;q++) s += Math.abs(a.Y[q]-b.Y[q]); return s/a.Y.length; };
        const steps = []; for(let k=-3;k<=4;k++){ const s = stepOf(k); if(s !== null) steps.push(s); } steps.sort((x,y)=>y-x);
        const oneStep = steps.length >= 4 && steps[0] > 3*Math.max(0.006, steps[1]); c.one = oneStep;
        // a clean one-frame jump is a hard cut: in a fast edit the frames around it hold other cuts (read as whips, wipes),
        // so a cut found on its frame is judged on its own step against the frames right next to it
        const s0 = stepOf(0), s1 = Math.max(stepOf(-1) ?? 0, stepOf(1) ?? 0);
        if(c.exact && s0 !== null && s0 > 1.5*Math.max(0.006, s1)) c.one = true;   // the next shot may start moving (blur): the cut is still the biggest step
        if(c.one && c.kind !== 'flash' && c.kind !== 'fade') c.kind = 'hard';
        if(c.flick || c.flickEnd) c.kind = 'hard';
        // how sharp the picture stays through the cut: a moving transition (a blur, a zoom or whip through) goes soft in
        // its middle frames; smoke drifting in, a car rolling past posts or a slide inside one shot stays sharp
        const sharpOf = f => { const Y = f.Y, W2 = f.FW; let s2 = 0, n2 = 0; for(let q=0; q+W2+1<Y.length; q+=2){ s2 += Math.abs(Y[q+1]-Y[q]) + Math.abs(Y[q+W2]-Y[q]); n2++; } return n2 ? s2/n2 : 0; };
        const shA = fr.filter(f => f.k <= -5).map(sharpOf), shB = fr.filter(f => f.k >= 5).map(sharpOf), shM = fr.filter(f => Math.abs(f.k) <= 3).map(sharpOf);
        const avg = a => a.length ? a.reduce((q,x)=>q+x,0)/a.length : 0, ends = Math.min(avg(shA), avg(shB));
        c.blurDip = ends > 0.004 && shM.length ? Math.min(...shM)/ends : 1;
        // a cut only the scene reading found (no jump on one frame): kept when it goes soft (a moving transition), dropped
        // when it stays sharp (something moved inside the shot); fades and dissolves keep their own reading
        if(!c.exact && !c.flick && !c.flickEnd && c.hint === 'cut'){ if(c.blurDip >= 0.65) c.drop = true; else if(!['whip','zoom','spin','flash','glitch'].includes(c.kind)) c.kind = 'blur'; }
        if(['hard','dissolve'].includes(c.kind) && !c.one){ const A = at(-CUT_K), B = at(CUT_K);
          if(A && B) for(const k of [0,-1,1,-2,2,-3,3]){ const F = at(k); if(!F) continue; const sh = revealShape(A.Y, B.Y, F.Y, A.FW, A.FH); if(sh){ c.kind = sh; break; } } } });
      for(let i=cuts.length-1;i>=0;i--) if(cuts[i].drop) cuts.splice(i, 1);
      // a flash moves its cut onto its brightest frame: in time order again, never two on the same frame
      cuts.sort((x, y) => x.t - y.t);
      for(let i=cuts.length-1;i>0;i--) if(cuts[i].t - cuts[i-1].t < 1.5/30){ if(cuts[i].kind !== 'hard' && cuts[i-1].kind === 'hard') cuts[i-1].kind = cuts[i].kind; cuts.splice(i, 1); }
      // a cut to a plain white (or black) screen and the next picture fading in from it within 0.8 s: one transition (a
      // fade through white / black), not two cuts around a white shot
      for(let i=cuts.length-1;i>0;i--){ const a = cuts[i-1], b = cuts[i], white = a.after > 0.88, black = a.after < 0.05;
        if(b.t - a.t <= 0.8 && (white || black) && !(b.exact && b.kind === 'hard')){ a.kind = white ? 'flash' : 'fade'; cuts.splice(i, 1); } }
      // two cuts under 0.2 s apart are one moving transition (a whip's first blurred frames read as a cut of their own),
      // unless both are clean one-frame jumps (a strobe of hard cuts)
      for(let i=cuts.length-1;i>0;i--){ const a = cuts[i-1], b = cuts[i];
        if(b.t - a.t < 0.2 && !a.one && !b.one && !(a.exact && b.exact) && !a.flick && !b.flick && !a.flickEnd && !b.flickEnd){ if(b.kind === 'hard' && a.kind !== 'hard') b.kind = a.kind; else if(b.kind === 'hard' && !a.one) b.kind = 'whip'; cuts.splice(i-1, 1); } }
      cuts.forEach(c=>{ delete c.one; delete c.flick; delete c.flickEnd; delete c.exact; delete c.blurDip; });   // (c.after stays: the black end)
      // shots: a zoom inside them (two frames) and the colour look (the middle frame)
      onP(0.85, 'reading its look');
      const bounds = [0, ...cuts.map(c=>c.t), dur], sh = [];
      for(let i=0;i<bounds.length-1 && i<200;i++) sh.push({ a: bounds[i], b: bounds[i+1], flick: flicks.some(f => Math.abs(f.t0 - bounds[i]) < 0.06 && Math.abs(f.t1 - bounds[i+1]) < 0.06) });
      const zt = [], zi = [], lt = [];
      // the camera move: frames every ~0.12 s inside the shot (clear of its transitions), at most 9; short shots are not judged
      const lookEvery = Math.max(1, Math.ceil(sh.length/24));   // the colour look: 24 shots are plenty
      sh.forEach((x,i)=>{ const L = x.b - x.a, m = Math.min(0.25, Math.max(0.18, 0.15*L)), n = !x.flick && L - 2*m >= 0.24 ? Math.max(3, Math.min(9, Math.round((L-2*m)/0.12)+1)) : 0;
        for(let k=0;k<n;k++){ const t = x.a + m + (L-2*m)*k/(n-1); zt.push(t); zi.push([i, (t - x.a)/L]); } lt.push(!x.flick && i % lookEvery === 0 ? x.a + 0.5*L : null); });
      const zf = await fs.small(zt), lq = lt.filter(t => t !== null), lr = lq.length ? await fs.full(lq) : [], lf = []; { let q = 0; lt.forEach((t,i)=>{ lf[i] = t === null ? null : lr[q++]; }); }
      sh.forEach((x,i)=>{ const L = x.b - x.a, mine = zi.map((z,k)=>[z,k]).filter(([z])=>z[0]===i), gr = mine.map(([,k])=>zf[k] ? greyOf(zf[k]) : null);
        let move = null;
        if(gr.length >= 3 && gr.every(Boolean)) move = shotMove(gr.map(g=>g.Y), mine.map(([z])=>z[1]), gr[0].FW, gr[0].FH);
        shots.push({ a: x.a, b: x.b, zoom: move ? (move.zoom === 'in' ? 1.06 : move.zoom === 'out' ? 0.94 : 1) : 1, move, flick: x.flick });
        const lk = lf[i] ? lookOfImage(lf[i], lf[i].width, lf[i].height) : null; if(lk) looks.push(lk); });
      refCutsOut = cuts;
    } finally { fs.close(); refBars = null; }
    const cuts = refCutsOut;
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
    const moments = shots.slice(0, 200).map((s,i)=>{
      const mm = { beats: shotBeats[i] || 0, sec: +shotSec[i].toFixed(3), at: +s.a.toFixed(3), tr: i ? (cuts[i-1] ? cuts[i-1].kind : 'hard') : 'start', zoom: s.zoom > 1.03 ? 'in' : s.zoom < 0.97 ? 'out' : 'none' };
      if(s.flick) mm.flick = true;
      // the Reel ends on black (an end card: a logo on black): the copy ends on black too
      if(i === shots.length - 1 && i > 0 && cuts[i-1] && cuts[i-1].after < 0.06 && s.b - s.a >= 0.8) mm.black = true;
      if(s.move){ if(s.move.keys.length >= 2 && (s.move.zoom !== 'none' || s.move.keys.some(k=>Math.abs(k.x) > 0.02 || Math.abs(k.y) > 0.02 || Math.abs(k.r) >= 2))){ mm.move = s.move.keys; mm.ease = s.move.ease; }
        if(s.move.shake) mm.shake = true; if(s.move.freeze !== null) mm.freeze = +s.move.freeze.toFixed(2); }
      if(rmap && rr){ const dm = describeCut(rmap, s.a, s.b, { hits: rr.hitsRaw || [], hitStr: rr.hitsStr || [], drops, beats: rr.beats || [] });
        Object.assign(mm, { loud: dm.loud, trend: dm.trend, drums: dm.drums, bass: dm.bass, voice: dm.voice });
        if(dm.hits && dm.hits.length) mm.hit = dm.hits.slice().sort((x,y)=>y.p-x.p)[0].k;
        if(drops.some(d=>Math.abs(d - s.a) < 0.15)) mm.drop = true; }
      return mm; });
    return { name: file.name, key: refKeyOf(file), dur, w, h, moments, cuts: cuts.map(c=>({t:+c.t.toFixed(3), kind:c.kind})), shotSec, shotBeats, medianBeats: med(shotBeats), medianSec: med(shotSec),
      hookBeats: shotBeats[0] || 0, hookSec: shotSec[0] || 0, onBeat, energy, trans,
      zoomShare: shots.filter(s=>s.b-s.a >= 0.9 && (s.zoom >= 1.05 || s.zoom <= 0.95)).length/Math.max(1, shots.filter(s=>s.b-s.a >= 0.9).length),   // of the shots long enough to judge
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
// Copy a Reel with the Reel's own song (the usual case: its song comes with it): every shot at its own time, to the frame,
// not fitted again to beats found in the song: a cut on each eighth note, a stutter of a tenth of a second and a flicker
// land exactly where they were. Another song: copyPlan (the shots' lengths in beats, on that song's beats).
const copyTimed = () => mode === 'copy' && !!refProfile && !refProfile.learned && !!refProfile.key && !!song && !!song.file && refKeyOf(song.file) === refProfile.key && (refProfile.moments || []).some(m => m.at !== undefined);
function copyPlanTimed(){
  const R = refProfile, M = R.moments, dur = buf.duration, off = secStart || 0, out = [];
  const typeAt = t => { const b = basePlan.find(s=>Math.abs(s.start - t) < 0.06); return b ? b.type : 'cut'; };
  M.forEach((m, i) => {
    const a = Math.max(0, m.at - off), b = Math.min(dur, m.at + m.sec - off);
    if(b - a < 1/30 - 1e-3 || a >= dur - 1/30) return;
    out.push({ start: out.length ? a : 0, end: b, type: out.length ? typeAt(a) : (basePlan[0] ? basePlan[0].type : 'cut'), fx: 'Hard cut', ref: i, flick: !!m.flick, black: !!m.black });
  });
  if(!out.length) return copyPlan();
  for(let i=1;i<out.length;i++) out[i].start = out[i-1].end;   // no gaps
  out[out.length-1].end = dur;   // the song goes on past the last shot read: the last shot holds
  return out;
}
// the edit's cut points: the reference's sequence of shot lengths (in beats), on this song's beats; its drops and breaks stay
function copyPlan(){
  const R = refProfile, dur = buf.duration, P0 = period || 0.5;
  const bt = beats.map(b=>b-1/30).filter(b=>b>0.2 && b<dur-0.3);
  const keep = basePlan.filter(s=>s.type==='drop' || s.type==='break').map(s=>s.start);
  const seq = R.shotBeats.length ? R.shotBeats.slice(1) : [], wantAt = k => R.medianBeats ? (seq.length ? seq[(k) % seq.length] : R.medianBeats) : 0;
  const typeAt = t => { const b = basePlan.find(s=>Math.abs(s.start - t) < 0.06); return b ? b.type : 'cut'; };
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
    out.push({ start, end, type: k === 0 ? (basePlan[0] ? basePlan[0].type : 'cut') : typeAt(start), fx: 'Hard cut', ref: refIdx(k) });
    start = end; k++;
  }
  return out;
}
// the reference's mix of transitions and effects, placed where they suit (energetic ones on drops and hits, soft ones
// on calm, long shots), counted so the shares match
const REF_TR = { hard:'hard', dissolve:'dissolve', fade:'dip', flash:'flash', whip:'whip', zoom:'zoom', glitch:'glitch', spin:'spin', iris:'iris', diamond:'diamond', heart:'heart', star:'star', wipe:'wipe', bars:'bars', blur:'blur' };
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
  ['flash','zoom','whip','glitch','spin','blur'].forEach(k=>place(k, hot)); ['dissolve','fade','iris','diamond','heart','star','wipe','bars'].forEach(k=>place(k, calm));
  // zooms inside shots: on that share of shots, the longest first
  const longI = [...plan.keys()].filter(i=>plan[i].end-plan[i].start >= 0.9), zn = Math.round(Math.min(1, R.zoomShare)*longI.length);
  longI.sort((a,b)=>(plan[b].end-plan[b].start)-(plan[a].end-plan[a].start)).slice(0, zn).forEach(i=>{ plan[i].efx = (plan[i].end-plan[i].start) > 1.2 ? 'pan' : 'punch-soft'; });
  copyBudget = {}; Object.entries(want).forEach(([k,v])=>{ if(k!=='hard') copyBudget[REF_TR[k]] = v; });
  copyShots();
}
// The exact copy: each shot does what the reference's shot at the same place did (copyPlan's s.ref), measured shot by
// shot: the transition into it, its camera move (zoom, position, turn and its ease, as keyframes), a shake, a zoom.
// The shares above stay for shots the reference has no reading of (past its 40th shot, or a style without shots).
// A learned style keeps the transition shares (what Reels of its kind have in common, moved by the creator's
// corrections) and takes the rhythm and camera moves of its most typical Reel.
const copyExact = () => mode === 'copy' && !!refProfile && (refProfile.moments || []).length >= 2;
function copyShots(){
  if(!copyExact()) return;
  const M = refProfile.moments, clip = (x, a, b) => Math.min(b, Math.max(a, Number.isFinite(+x) ? +x : a));
  plan.forEach((s,i)=>{
    const m = M[s.ref ?? i]; if(!m) return;
    const len = s.end - s.start;
    if(i > 0 && !refProfile.learned){ const tr = m.tr === 'start' ? 'hard' : REF_TR[m.tr] || 'hard'; s.tr = tr; s.trByRef = tr !== 'hard'; }
    s.efx = 'none'; s.ak = []; s.flick = !!m.flick; s.black = !!m.black && copyTimed();   // the black end only where the Reel had it
    if(s.flick || s.black) return;   // a flicker: a new still of the clips on every frame (flickPick), no move of its own
    if(Array.isArray(m.move) && m.move.length >= 2 && len >= 0.3){
      const ez = m.move.length === 2 ? (m.ease || 'inOut') : 'lin';   // more keys: the path's own shape is in them
      s.ak = m.move.map(k=>({ t: +(clip(k.f, 0, 1)*len).toFixed(3), s: clip(k.s, 0.4, 2.5), x: clip(k.x, -0.6, 0.6), y: clip(k.y, -0.6, 0.6), r: clip(k.r, -60, 60), o: 1, ez }));
    } else if(m.zoom === 'in' || m.zoom === 'out') s.efx = len > 1.2 ? 'pan' : 'punch-soft';
    if(m.shake && !s.ak.length) s.efx = 'shake';
  });
}
// How close the new Reel is to the one copied, shot by shot (shown under it, and read by the checks): each shot's
// length (half or double the reference's = 0), the transition into it, whether its camera moves, and the colour look
// measured on the rendered edit. The last shot is not counted (the song's end cuts it).
let copyLookScore = null;
function copyMatch(){
  const R = refProfile; if(mode !== 'copy' || !R || !edit.length) return null;
  const M = R.moments || [], P0 = period || 0.5, r = x => Math.round(x*100), timed = copyTimed();
  let pace = 0, pn = 0, tr = 0, tn = 0, mv = 0, mn = 0;
  edit.forEach((e,i)=>{
    const m = M[e.ref ?? i]; if(!m || i === edit.length - 1) return;
    const want = timed ? m.sec : R.medianBeats && m.beats ? m.beats*P0 : m.sec, got = e.end - e.start;
    if(want > 0){ pace += Math.max(0, 1 - Math.abs(Math.log2(got/want))); pn++; }
    if(i > 0 && !R.learned){ tr += e.tr === (m.tr === 'start' ? 'hard' : REF_TR[m.tr] || 'hard') ? 1 : 0; tn++; }
    const wantMove = !!(m.move && m.move.length >= 2) || m.zoom === 'in' || m.zoom === 'out', gotMove = !!(e.ak && e.ak.length >= 2) || ['pan','punch-soft','pan-soft'].includes(e.efx);
    mv += wantMove === gotMove ? 1 : 0; mn++;
  });
  if(!pn) return null;
  // a learned style: the edit's transition shares against the style's (half the summed difference = 0)
  if(R.learned && edit.length > 2){ const got = {}, n = edit.length - 1; edit.slice(1).forEach(e=>{ got[e.tr] = (got[e.tr]||0) + 1/n; });
    const want = {}; Object.entries(R.trans || {}).forEach(([k,v])=>{ const t = REF_TR[k] || 'hard'; want[t] = (want[t]||0) + v; });
    let l1 = 0; new Set([...Object.keys(got), ...Object.keys(want)]).forEach(k=>{ l1 += Math.abs((got[k]||0) - (want[k]||0)); }); tr = 1 - l1/2; tn = 1; }
  // shots the edit does not have count as misses (an edit with a third of the Reel's cuts is not 90% alike)
  const inSong = timed ? M.filter(m => m.at - (secStart || 0) < buf.duration - 0.05 && m.at + m.sec - (secStart || 0) > 0).length : 0;
  const cover = inSong ? Math.min(1, edit.length/inSong) : 1;
  const parts = { rhythm: cover*pace/pn, transitions: tn ? tr/tn : 1, moves: mn ? mv/mn : 1, look: copyLookScore };
  const w = { rhythm: 0.35, transitions: 0.3, moves: 0.15, look: 0.2 }; let s = 0, ws = 0;
  for(const k of Object.keys(w)) if(parts[k] !== null && parts[k] !== undefined){ s += w[k]*parts[k]; ws += w[k]; }
  return { total: r(s/ws), rhythm: r(parts.rhythm), transitions: r(parts.transitions), moves: r(parts.moves), look: parts.look === null ? null : r(parts.look), shots: pn };
}
function showCopyMatch(){
  const m = copyMatch(), el = $('refmatch'); if(!el) return;
  el.hidden = !m || silentStyle(); if(!m || silentStyle()) return;
  el.textContent = 'Matches the original ' + m.total + '% · rhythm ' + m.rhythm + '% · transitions ' + m.transitions + '% · camera moves ' + m.moves + '%' + (m.look !== null ? ' · look ' + m.look + '%' : '');
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
      if(!mono) G.sat = cl(G.sat * Math.pow(T.sat/Math.max(0.02, O.sat), k), 0.35, 3);
      G.bri = cl(G.bri * Math.pow(T.mean/Math.max(0.03, O.mean), k), 0.6, 1.4);
      if(!mono) G.warm = cl(G.warm + k*(T.warm - O.warm)/0.11, -1.6, 1.6);
      G.vig = cl(G.vig + k*(T.vig - O.vig)*1.4, 0, 0.9);
      G.lift = cl(G.lift + k*(T.p5 - O.p5), 0, 0.15);
      G.grain = cl(G.grain + k*(T.grain - O.grain)*3, 0, 0.15);
      if(pass === 0 && !mono) G.teal = cl((T.split - O.split - 0.1)/0.3, 0, 0.8);   // only a clear split beyond what the clips have
      GRADES.copy = { ...G };
    }
    copyLookKey = key;
    // how close the look came: brightness, contrast, colour and warmth, each within 0.15 of the reference = 100%
    { const O = await renderedLook(); if(O) copyLookScore = ['mean','std','sat','warm'].reduce((q,k)=>q + Math.max(0, 1 - Math.abs((O[k]||0) - (T[k]||0))/0.15), 0)/4; showCopyMatch(); }
  } finally { copyLookBusy = false; }
  LOOKS.copy = { name: 'Copied', filter: 'contrast(' + G.con.toFixed(2) + ') saturate(' + (mono ? 0 : G.sat).toFixed(2) + ') brightness(' + G.bri.toFixed(2) + ')', grain: G.grain };
  if(!playing && !recording) captureLoop();
}
$('reffile').addEventListener('change', async e=>{
  const f = e.target.files && e.target.files[0]; e.target.value = ''; if(!f) return;
  $('refbox').hidden = false; $('refinfo').textContent = 'Reading the Reel…';
  refReading = true; root.classList.add('refread');   // the AI and the Reel wait for it: they are the copy's, not an ordinary Reel's
  const mirror = new MutationObserver(() => { $('refwaitp').textContent = $('refinfo').textContent.replace(/^Reading the Reel:?\s*/, ''); });
  mirror.observe($('refinfo'), { childList: true, characterData: true, subtree: true });
  try{
    refProfile = await analyzeReference(f, (p, what)=>{ $('refinfo').textContent = 'Reading the Reel: ' + what + ' ' + Math.round(p*100) + '%'; });
    $('refinfo').textContent = '“' + f.name + '”: ' + describeRef(refProfile); $('stsaverow').hidden = false; $('ststat').textContent = ''; learnedKind = '';
    suggestRef(f.name);
    // the copied look is on while it is matched (makeEdit then matches it on the new edit)
    GRADES.copy = { con:1, sat:1, bri:1, warm:0, teal:0, mono: refProfile.look && refProfile.look.sat < 0.05 ? 1 : 0, lift:0, vig:0, grain:0 }; copyLookKey = ''; copyLookScore = null;
    const lb = $('look').querySelector('[data-l="copy"]'); lb.hidden = false; look = 'copy'; [...$('look').children].forEach(x=>x.setAttribute('aria-pressed', x===lb));
    setMode('copy');
    refLookRun(f, refProfile);   // its texts, stickers, captions, background: the AI reads them (when it is on)
  }catch(err){ console.warn('reference not read:', err); $('refinfo').textContent = 'We could not read that Reel. Please try another video.'; notify('We could not read that Reel. Please try another video.', 'err'); }
  finally{ refReading = false; root.classList.remove('refread'); mirror.disconnect(); refWaiters.splice(0).forEach(r => r()); if(buf && sources.length && !recording) makeEdit(); }   // now the AI may plan (the copy, or the Reel as it is)
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
  if(!aiReelOk() && !(await aiGate())) return;   // Shubix AI only after the Reel's gate (Use), as everything else
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
const STYLE_KINDS = { wedding: 'Wedding', travel: 'Travel', festival: 'Festival', dance: 'Dance', talking: 'Talking', product: 'Product', food: 'Food', fitness: 'Fitness', vlog: 'Vlog', birthday: 'Birthday', car: 'Car & bike', shop: 'Shop & opening', event: 'Event & party', other: 'Other' };
let learnedKind = '', editsQ = [], editsT = 0;
const clip = (x, a, b) => Math.min(b, Math.max(a, Number.isFinite(x) ? x : a));
function fingerprintOf(R){
  const tr = {}; for(const [k, v] of Object.entries(R.trans || {})) if(Object.keys(REF_KINDS).includes(k)) tr[k] = clip(v, 0, 1);
  const L = R.look || null, look = L ? Object.fromEntries(['mean','std','sat','warm','p5','p95','vig','grain','split'].filter(k => Number.isFinite(L[k])).map(k => [k, clip(L[k], k === 'warm' || k === 'vig' || k === 'split' ? -1 : 0, k === 'sat' ? 2 : 1)])) : null;
  return { dur: clip(R.dur, 1, 600), bpm: clip(R.bpm || 0, 0, 300), medianBeats: clip(R.medianBeats || 0, 0, 64), medianSec: clip(R.medianSec || 0, 0, 60), hookBeats: clip(R.hookBeats || 0, 0, 64), hookSec: clip(R.hookSec || 0, 0, 60),
    onBeat: clip(R.onBeat || 0, 0, 1), energy: ['steady','rising','falling'].includes(R.energy) ? R.energy : 'steady', zoomShare: clip(R.zoomShare || 0, 0, 1), trans: tr, look,
    shotBeats: (R.shotBeats || []).slice(0, 300).map(x => clip(x, 0, 64)), shotSec: (R.shotSec || []).slice(0, 300).map(x => clip(x, 0, 60)),
    moments: cleanMoments(R.moments, 200) };
}
async function api(path, opts){ const r = await fetch(path, { signal: ac.signal, ...opts, headers: { ...(opts && opts.headers) } }); const j = await r.json().catch(() => ({}));
  if(r.status === 401) throw new Error('sign in to keep a style library'); if(!r.ok) throw new Error((j.error && j.error.message) || ('error ' + r.status)); return j; }
// only the administrator teaches the styles (FastStudio.tsx sets the 'admin' class): a creator's copied Reel is offered
// to the administrator (its fingerprint, never the video), who uses it under a kind or removes it (Admin → My trends)
function suggestRef(name){
  if(root.classList.contains('admin') || !refProfile || refProfile.learned) return;
  api('/api/studio/styles/suggest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: (name || 'Reel').replace(/\.[^.]+$/, '').slice(0, 120) || 'Reel', fp: fingerprintOf(refProfile) }) })
    .catch(err => console.info('copied Reel not offered for the styles:', err && err.message));
}
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
    const tc = $('tcat'); if(!tc.options.length) for(const [k, name] of Object.entries(STYLE_KINDS)) tc.add(new Option(name, k));
    autoUse();
    $('stlist').innerHTML = ''; for(const s of r.mine.slice(0, 40)){ const li = document.createElement('li'); li.textContent = STYLE_KINDS[s.category] + ': ' + s.name + ' · ' + s.pace + (s.trans ? ' · ' + s.trans : '') + (s.shared ? ' · shared' : '') + ' ';
      const del = document.createElement('button'); del.className = Button.small; del.textContent = 'Delete'; del.addEventListener('click', async () => { try{ await api('/api/studio/styles/' + s.id, { method: 'DELETE' }); loadKinds(); }catch(e){} }); li.appendChild(del); $('stlist').appendChild(li); }
  }catch(err){ $('learnrow').hidden = true; }
}
$('luse').addEventListener('click', async () => {
  const k = $('lcat').value; if(!k) return; $('linfo').textContent = 'Learning…';
  try{ const scope = $('lscope').querySelector('[aria-pressed="true"]').dataset.s, r = await api('/api/studio/styles/learned?category=' + encodeURIComponent(k) + '&scope=' + scope);
    if(!r.fp){ $('linfo').textContent = 'No Reels of this kind yet.'; return; }
    learnedKind = k;
    refProfile = { ...r.fp, name: 'Learned ' + STYLE_KINDS[k] + ' style', cuts: [], learned: true };
    GRADES.copy = { con:1, sat:1, bri:1, warm:0, teal:0, mono: refProfile.look && refProfile.look.sat < 0.05 ? 1 : 0, lift:0, vig:0, grain:0 }; copyLookKey = ''; copyLookScore = null;
    const lb = $('look').querySelector('[data-l="copy"]'); lb.hidden = false; look = refProfile.look ? 'copy' : look; [...$('look').children].forEach(x=>x.setAttribute('aria-pressed', x.dataset.l === look));
    $('linfo').textContent = 'Learned from ' + r.n + ' Reel' + (r.n > 1 ? 's' : '') + (r.accuracy ? ' · predicts a new ' + STYLE_KINDS[k].toLowerCase() + ' Reel ' + Math.round(r.accuracy.learned*100) + '% (default style ' + Math.round(r.accuracy.baseline*100) + '%)' : '') + (r.corrections ? ' · ' + r.corrections + ' of your changes' : '');
    setMode('copy'); $('refinfo').textContent = refProfile.name + ': ' + describeRef(refProfile); $('stsaverow').hidden = true;
  }catch(err){ console.warn('learned style:', err); $('linfo').textContent = 'Your learned style is not ready yet.'; }
}, SIG);
$('lscope').addEventListener('click', e => { const b = e.target.closest('button'); if(!b) return; [...$('lscope').children].forEach(x => x.setAttribute('aria-pressed', String(x === b))); if($('lauto').checked) autoSave(); }, SIG);
// "Use for my next Reels": the kind and scope are remembered on this device, and the learned style is put on when the studio opens
const AUTO_KEY = 'brs-auto-style';
function autoSave(){ try{ if($('lauto').checked) localStorage.setItem(AUTO_KEY, JSON.stringify({ kind: $('lcat').value, scope: $('lscope').querySelector('[aria-pressed="true"]').dataset.s })); else localStorage.removeItem(AUTO_KEY); }catch(e){} }
function autoRead(){ try{ const a = JSON.parse(localStorage.getItem(AUTO_KEY) || 'null'); return a && STYLE_KINDS[a.kind] ? a : null; }catch(e){ return null; } }
$('lauto').addEventListener('change', autoSave, SIG);
$('lcat').addEventListener('change', () => { if($('lauto').checked) autoSave(); }, SIG);
let autoTried = false;
function autoUse(){
  if(autoTried || !root.classList.contains('admin')) return; autoTried = true;   // the learned-style controls are the administrator's
  const a = autoRead(); if(!a) return;
  const o = [...$('lcat').options].find(x => x.value === a.kind); if(!o || o.disabled) return;
  $('lauto').checked = true; $('lcat').value = a.kind;
  [...$('lscope').children].forEach(x => x.setAttribute('aria-pressed', String(x.dataset.s === a.scope)));
  if(refProfile && !refProfile.learned) return;   // a Reel the creator is copying comes first
  $('luse').click();
}
// teaching from many Reels: each one read like "Copy a Reel" and saved to the kind, one after another
$('tpick').addEventListener('click', () => $('tfiles').click(), SIG);
$('tfiles').addEventListener('change', async e => {
  const files = [...(e.target.files || [])]; e.target.value = ''; if(!files.length) return;
  const cat = $('tcat').value, shared = $('tshare').checked; let ok = 0, bad = 0;
  $('tpick').disabled = true;
  try{
    for(const [i, f] of files.entries()){
      const head = 'Reel ' + (i+1) + ' of ' + files.length + ': ';
      try{
        const R = await analyzeReference(f, (p, what) => { $('tstat').textContent = head + what + ' ' + Math.round(p*100) + '%'; });
        if(!R.cuts || R.cuts.length < 2) throw new Error('too few cuts to learn from');
        $('tstat').textContent = head + 'saving';
        await api('/api/studio/styles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: (f.name || 'Reel').replace(/\.[^.]+$/, '').slice(0, 120), category: cat, shared, fp: fingerprintOf(R) }) });
        ok++;
      }catch(err){ console.warn('not learned from', f.name, err); bad++; }
    }
  } finally { $('tpick').disabled = false; }
  $('tstat').textContent = 'Learned from ' + ok + ' Reel' + (ok === 1 ? '' : 's') + ' (' + STYLE_KINDS[cat] + ')' + (bad ? ' · ' + bad + ' could not be read (too short or no cuts)' : '') + (ok ? ' ✓' : '');
  if(ok){ await loadKinds(); $('lcat').value = cat; if(learnedKind === cat) $('luse').click(); }
}, SIG);
/* ---- learning without the creator seeing it ----
 * A template of a kind (Wedding, Travel, a festival, Product, Food, Gym, Birthday, Day in my life) puts on the learned
 * style of that kind (the Reels the administrator taught, with everyone's corrections), when there is one: the edit
 * follows its pace and transitions, nothing about it is shown (silentStyle). A Reel being copied comes first. */
const TPL_STYLE = { wedding: 'wedding', travel: 'travel', tripphotos: 'travel', ganpati: 'festival', diwali: 'festival', navratri: 'festival', holi: 'festival', padwa: 'festival', eid: 'festival',
  christmas: 'festival', newyear: 'festival', product: 'product', sale: 'product', recipe: 'food', gym: 'fitness', birthday: 'birthday', bdayphotos: 'birthday', dayinlife: 'vlog', cardelivery: 'car', opening: 'shop', party: 'event' };
let styleGen = 0;
async function styleForTemplate(name){
  const k = TPL_STYLE[name], g = ++styleGen, shown = mode === 'copy' ? (refProfile && refProfile.shown) || 'auto' : mode;
  tplKind = k || '';
  const drop = () => { if(refProfile && refProfile.learned && !refProfile.cuts.length && learnedKind && refProfile.byTpl){ refProfile = null; learnedKind = ''; if(mode === 'copy') setMode(shown); } };
  if(refProfile && !refProfile.learned) return;
  if(!k || kind === 'talk'){ drop(); return; }
  // Shubix AI on: its brain and the learning combined (the AI reads every kind's trend, this template's first, and fits
  // it to this song); the learned Reel copied as it is only for a Reel made without the AI
  if(aiOn){ drop(); return; }
  try{ const r = await api('/api/studio/styles/learned?category=' + encodeURIComponent(k) + '&scope=all');
    if(g !== styleGen || (refProfile && !refProfile.learned)) return;
    if(!r.fp){ drop(); return; }
    const admin = root.classList.contains('admin');
    learnedKind = k; refProfile = { ...r.fp, name: 'Learned ' + STYLE_KINDS[k] + ' style', cuts: [], learned: true, byTpl: true, silent: !admin, shown };
    if(admin) $('refinfo').textContent = refProfile.name + ': ' + describeRef(refProfile);
    setMode('copy');
  }catch(err){ /* no learned style here (signed out, offline): the template as it is */ }
}
// A Reel the creator made and saved (downloaded, shared, kept in My Reels) is offered to the administrator like a copied
// one: its numbers only (pace, cuts, transitions, camera moves), never the video. The administrator uses it under a
// kind or removes it (Admin -> My trends -> Reels from users). Not for a copy of someone else's Reel (that one was offered).
function offerMade(){
  if(root.classList.contains('admin') || kind === 'talk' || (refProfile && !refProfile.learned) || edit.length < 4 || !(period > 0)) return;
  const P = period, secs = edit.map(e => e.end - e.start), med = a => [...a].sort((x, y) => x - y)[Math.floor(a.length/2)] || 0;
  const inv = {}; for(const [k, t] of Object.entries(REF_TR)) inv[t] = k;
  const trans = {}; edit.slice(1).forEach(e => { const k = inv[e.tr]; if(k) trans[k] = (trans[k] || 0) + 1/(edit.length - 1); });
  const zoomOf = e => { const sc = e.kf && e.kf.scale; if(!sc || sc.length < 2) return 'none'; const d = sc[sc.length-1][1] - sc[0][1]; return d > 0.02 ? 'in' : d < -0.02 ? 'out' : 'none'; };
  const onBeat = edit.slice(1).filter(e => beats.some(b => Math.abs(b - e.start) < 0.07)).length / (edit.length - 1);
  const R = { dur: edit[edit.length-1].end - edit[0].start, bpm: 60/P, medianBeats: med(secs)/P, medianSec: med(secs), hookBeats: secs[0]/P, hookSec: secs[0], onBeat, energy: 'steady',
    zoomShare: edit.filter(e => zoomOf(e) !== 'none').length / edit.length, trans, look: null, shotBeats: secs.map(x => x/P), shotSec: secs,
    moments: edit.map((e, i) => ({ beats: secs[i]/P, sec: secs[i], tr: i ? inv[e.tr] || 'hard' : 'start', zoom: zoomOf(e) })) };
  const name = song && song.name ? song.name.replace(/\.[^.]+$/, '') : sources[0] ? sources[0].name.replace(/\.[^.]+$/, '') : 'Reel';
  api('/api/studio/styles/suggest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.slice(0, 120) || 'Reel', fp: fingerprintOf(R), from: 'made' }) })
    .catch(err => console.info('made Reel not offered for the styles:', err && err.message));
}
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
// sfx: the automatic sound effects (a whoosh into a swipe, a boom on a drop...) are off by default: a whoosh on every
// swipe is what makes an edit sound home-made; they are one tap away (Music → Sound effects) and can be added by hand
const AU0 = { mvol: 1, mfin: 0, mfout: 0, mfoutManual: false, vfx: 'none', ai: true, clip: 'mute', sfx: false, sfxv: 0.6 };
const musicOut = () => au.mfoutManual ? au.mfout : (au.ai ? 0.8 : 0);
let au = { ...AU0 }, clipMixKey = '';
const fxCache = new Map();
function voPcm(){ if(!vo) return null; if(au.vfx === 'none') return vo.pcm;
  const k = vo.key + '|' + au.vfx + '|' + denoiseOn; if(!fxCache.has(k)){ fxCache.clear(); fxCache.set(k, voiceFx(vo.pcm, vo.sr, au.vfx)); } return fxCache.get(k); }
// a shot's own sound, decoded once per clip (null: the clip has no sound)
async function clipPcm(si){
  const s = sources[si]; if(!s) return null; if(s.pcm !== undefined) return s.pcm;
  try{ const b = await decodeAnyAudio(s.file).catch(e => { if(s.edFile && s.edAudio) return decodeAnyAudio(new File([s.edFile], 'copy.' + (/webm/.test(s.edFile.type) ? 'webm' : 'mp4'), { type: s.edFile.type })); throw e; }), m = new Float32Array(b.length), ch = b.numberOfChannels;
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
async function addTtsAtPlayhead(text, voice){
  if(!String(text || '').trim() || !voice) throw new Error('Enter the voice text and choose a voice.');
  const before = ttsClips.length;
  $('ttstext').value = String(text).slice(0, 1200);
  $('ttsvoice').value = String(voice);
  await ttsAdd();
  if(ttsClips.length <= before) throw new Error('The voice could not be generated. Please try another voice or shorter text.');
  saveNow();
  return { id: ttsClips[ttsClips.length - 1].id, at: ttsClips[ttsClips.length - 1].at, duration: ttsClips[ttsClips.length - 1].pcm ? ttsClips[ttsClips.length - 1].pcm.length / ttsClips[ttsClips.length - 1].sr : 0 };
}
function clearTts(){
  if(!ttsClips.length) return false;
  ttsClips = []; ttsList(); applyVo(); clipMixKey = ''; if(!playing) redrawFrame(); saveNow(); return true;
}
async function setCaptions(enabled, language, translation){
  capsOn = !!enabled;
  $('caps').checked = capsOn;
  $('caprow').hidden = !capsOn;
  if(language !== undefined) $('caplang').value = String(language || '');
  if(translation !== undefined) $('captr').value = String(translation || '');
  if(capsOn) await loadCaptions(); else { capStat(''); redraw(); }
  saveNow();
  return { enabled: capsOn, language: $('caplang').value, translation: $('captr').value };
}
function setCaptionStyle(style){
  textStyle = String(style || 'pop');
  [...$('tstyle').children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.t === textStyle)));
  redraw(); saveNow(); return textStyle;
}
function ttsList(){
  const box = $('ttslist'); box.innerHTML = '';
  for(const c of ttsClips){ const d = document.createElement('div'); d.className = 'ttsitem';
    d.innerHTML = `<span class="tt"></span><span class="tm"></span><button type="button" class="${Button.small}" aria-label="Remove this speech">×</button>`;
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
  const key2 = key + JSON.stringify([sfxEvents(), au.sfx, au.sfxv, edit.map(e => e.cs ? [e.cs.mus, e.cs.pitch] : 0)]);
  if(key2 !== clipMixKey){ clipMixKey = key2; applyVo(); }
}
/* ---- sound effects, made on the phone (no files): whoosh, pop, boom, camera click, riser, ding.
 * Automatic ones follow the edit (a whoosh into a push / swipe / whip / zoom / spin, a boom on a flash into a drop, a
 * click on a photo snap or a freeze, a pop when a text or sticker pops in); the creator adds more at the playhead. ---- */
let sfxList = [], sfxSeq = 0;
const SFX_NAMES = { whoosh: 'Whoosh', pop: 'Pop', boom: 'Boom', click: 'Camera click', riser: 'Riser', ding: 'Ding' };
const sfxCache = new Map();
function sfxSynth(kind, sr){
  const key = kind + sr; if(sfxCache.has(key)) return sfxCache.get(key);
  const len = { whoosh: 0.42, pop: 0.09, boom: 0.9, click: 0.09, riser: 1.2, ding: 0.7 }[kind] || 0.3, n = Math.round(len*sr), y = new Float32Array(n);
  let seed = 7; const rnd = () => { seed = (seed*16807) % 2147483647; return seed/2147483647*2 - 1; };
  let lp = 0, ph = 0;
  for(let i = 0; i < n; i++){ const t = i/sr, f = t/len;
    if(kind === 'whoosh'){ const cut = 400 + 5000*Math.sin(Math.PI*f), a = Math.exp(-2*Math.PI*cut/sr); lp = (1 - a)*rnd() + a*lp; y[i] = lp*Math.sin(Math.PI*f)**1.5*1.6; }
    else if(kind === 'pop'){ ph += 2*Math.PI*(700 - 450*f)/sr; y[i] = Math.sin(ph)*Math.exp(-t/0.025); }
    else if(kind === 'boom'){ ph += 2*Math.PI*(70 - 30*f)/sr; y[i] = Math.sin(ph)*Math.exp(-t/0.28) + rnd()*0.3*Math.exp(-t/0.03); }
    else if(kind === 'click'){ y[i] = rnd()*(Math.exp(-t/0.004) + (t > 0.045 ? 0.7*Math.exp(-(t - 0.045)/0.006) : 0)); }
    else if(kind === 'riser'){ const a = Math.exp(-2*Math.PI*(300 + 6000*f*f)/sr); lp = (1 - a)*rnd() + a*lp; ph += 2*Math.PI*(200 + 900*f*f)/sr; y[i] = (lp*1.4 + Math.sin(ph)*0.25)*f*f; }
    else if(kind === 'ding'){ y[i] = (Math.sin(2*Math.PI*1320*t) + 0.5*Math.sin(2*Math.PI*1980*t))*Math.exp(-t/0.18)*0.7; } }
  let pk = 0; for(const v of y) pk = Math.max(pk, Math.abs(v)); for(let i = 0; i < n; i++) y[i] *= 0.5/Math.max(1e-6, pk);
  sfxCache.set(key, y); return y;
}
const WHOOSH_TR = ['whip','swipeup','slideleft','slideright','slideup','slidedown','zoom','spin','zoomout','dropin'];
function sfxEvents(){
  const out = sfxList.map(x => ({ at: x.at, kind: x.kind }));
  if(au.sfx && kind !== 'talk'){ let lastW = -9;
    edit.forEach((e, i) => { if(!i) return;
      if(WHOOSH_TR.includes(e.tr) && e.start - lastW > 0.8){ out.push({ at: Math.max(0, e.start - 0.2), kind: 'whoosh' }); lastW = e.start; }
      else if((e.tr === 'flash' || e.tr === 'burn') && e.type === 'drop') out.push({ at: e.start, kind: 'boom' });
      if(e.efx === 'snap' || (e.sp && e.sp.label === 'Freeze frame')) out.push({ at: e.start, kind: 'click' }); });
    for(const o of overlays) if(o.anim === 'pop' && !o.all && o.t0 > 0.05) out.push({ at: o.t0, kind: 'pop' }); }
  return out;
}
function sfxAdd(k){ if(!SFX_NAMES[k] || !buf) return; sfxList.push({ id: ++sfxSeq, at: +(playing ? curTime() : pos).toFixed(2), kind: k }); sfxUI(); clipMixKey = ''; ensureMix(); notify(SFX_NAMES[k] + ' added at ' + (playing ? curTime() : pos).toFixed(1) + ' s'); }
function sfxUI(){ const box = $('sfxlist'); if(!box) return; box.innerHTML = '';
  for(const x of sfxList){ const b = document.createElement('button'); b.type = 'button'; b.className = `${Chip}`; b.textContent = SFX_NAMES[x.kind] + ' · ' + x.at.toFixed(1) + ' s ×'; b.title = 'Remove';
    b.addEventListener('click', () => { sfxList = sfxList.filter(y => y !== x); sfxUI(); clipMixKey = ''; ensureMix(); }); box.appendChild(b); } }
$('sfxadd').addEventListener('click', e => { const b = e.target.closest('[data-sfx]'); if(b) sfxAdd(b.dataset.sfx); }, SIG);
$('sfxon').addEventListener('change', e => { au = { ...au, sfx: e.target.checked }; clipMixKey = ''; ensureMix(); }, SIG);
$('sfxv').addEventListener('input', e => { au = { ...au, sfxv: +e.target.value }; const o = e.target.parentElement.querySelector('output'); if(o) o.textContent = Math.round(au.sfxv*100) + '%'; clipMixKey = ''; }, SIG);
$('sfxv').addEventListener('change', () => ensureMix(), SIG);
function applyVo(){   // (the name stays: everything that changes the sound calls it)
  if(kind === 'talk' || !baseBuf) return;
  const shots = edit.filter(e => e.cs && e.cs.vol > 0 && sources[e.src] && sources[e.src].pcm);
  const lyVoiced = layers.filter(L => L.vol > 0 && lmedia[L.m] && lmedia[L.m].pcm);
  const speech = ttsClips.filter(c => c.pcm);
  const fxEv = sfxEvents(), musShots = edit.some(e => e.cs && e.cs.mus !== undefined && e.cs.mus !== 1);
  const plain = !vo && !shots.length && !speech.length && !lyVoiced.length && au.mvol === 1 && !au.mfin && !musicOut() && !fxEv.length && !musShots;
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
    const seg = new Float32Array(Math.max(0, b - a));
    for(let i=a;i<b;i++){ const l = (i - a)/sr; if(rateAt(e, l) <= 0) continue;
      const k = Math.floor(srcPos(e, l)*P.sr); if(k < 0 || k >= P.x.length) continue;
      const edge = Math.min(1, (i - a)/ramp, (b - i)/ramp) * csFade(c, l, L);
      seg[i - a] = P.x[k]*gain*edge; }
    const ps = c.pitch ? pitchShift(seg, sr, Math.pow(2, c.pitch/12)) : seg;   // the shot's own pitch (semitones)
    for(let i=0;i<ps.length;i++) cs[a + i] += ps[i]; }
  for(const L of lyVoiced){ const P = lmedia[L.m].pcm, a = Math.round(L.t0*sr), b = Math.min(N, Math.round(L.t1*sr)), ramp = Math.round(0.02*sr);
    let q2 = 0, qn = 0; for(let k=0;k<P.x.length;k+=16){ q2 += P.x[k]*P.x[k]; qn++; } const g = L.vol*Math.min(6, 0.16/Math.max(0.002, Math.sqrt(q2/Math.max(1, qn))));
    for(let i=a;i<b;i++){ const k = Math.floor((L.in + (i - a)/sr)*P.sr); if(k >= P.x.length) break; cs[i] += P.x[k]*g*Math.min(1, (i - a)/ramp, (b - i)/ramp); } }
  // text to speech: each at its time, at the voiceover's loudness (resampled with a straight line between samples)
  for(const c of speech){ const P = ttsPcm(c), a = Math.round(c.at*sr), r = c.sr/sr; let q2 = 0, qn = 0;
    for(let k=0;k<P.length;k+=4){ if(Math.abs(P[k]) > 0.01){ q2 += P[k]*P[k]; qn++; } } const g = 0.2/Math.max(0.003, Math.sqrt(q2/Math.max(1, qn)));
    for(let i=a;i<N;i++){ const t = (i - a)*r, k = Math.floor(t); if(k + 1 >= P.length) break; cs[i] += (P[k] + (P[k+1] - P[k])*(t - k))*g; } }
  // sound effects: on top of everything (not ducked); the music under a shot: each shot's own music volume, eased
  const fxa = new Float32Array(N);
  for(const ev of fxEv){ const y = sfxSynth(ev.kind, sr), a = Math.round((ev.kind === 'riser' ? ev.at - y.length/sr : ev.at)*sr); for(let i=0;i<y.length;i++){ const j = a + i; if(j >= 0 && j < N) fxa[j] += y[i]*au.sfxv; } }
  let mg = null;
  if(musShots){ mg = new Float32Array(N); const k = Math.exp(-1/(0.12*sr)); let g = 1;
    for(let i=0;i<N;i++){ const e = edit[segAt(i/sr)], tg = e && e.cs && e.cs.mus !== undefined ? e.cs.mus : 1; g = tg + (g - tg)*k; mg[i] = g; } }
  let env = 1, lv = 0;
  for(let c=0;c<2;c++){ const src = B.getChannelData(Math.min(c, B.numberOfChannels-1)), d = mix.getChannelData(c); env = 1; lv = 0;
    for(let i=0;i<N;i++){
      const j = Math.floor(i*vr/sr), x = (v[j] || 0)*gv;
      lv = Math.max(Math.abs(x) + Math.abs(cs[i])*0.6, lv*0.9995);           // a follower of the voice (and the shots' sound)
      const target = lv > 0.04 ? 0.22 : 0.75; env = target < env ? target + (env - target)*dn : target + (env - target)*up;
      d[i] = src[i]*baseNorm*mv(i)*(mg ? mg[i] : 1)*env + x + cs[i] + fxa[i];
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
// where people speak in each clip (Silero VAD on the phone): only for "Keep voices only" (the one place it is used,
// autoTools). With the clips' sound muted (the default) or all kept, neither the speech model (1.3 MB) is downloaded nor
// every clip's sound decoded (slow and heavy on an iPhone); choosing "Keep voices only" reads it then.
let speechBusy = false;
async function speechScan(){
  if(speechBusy || !speechProbs || kind === 'talk' || !au.ai || au.clip !== 'voices') return; speechBusy = true; let found = false;
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
      efx: (j + k) % 2 ? 'pan-soft' : 'punch-soft', sp: 'normal', src: story.per ? Math.min(n - 1, Math.floor(j / story.per)) : (j + k) % n, in: 0, scaleR: 1, cx: 0.5, cy: 0.45, face: 0, fs: 0 }); });
  if(!restoreEdit(list)) return false;
  edit.forEach((e, i) => { if(!repick(i, false, e.src)) repick(i, false); });
  assignPlayers(); edit.forEach(e => { e.cam = null; e.kf = keyframesFor(e); camAt(e, 0); }); renderEDL(); autoTools();
  $('s3').classList.remove('locked'); $('s3').classList.add('done'); ['play','remix','export','cover'].forEach(id => $(id).disabled = false);
  captureLoop(); editGen++; return true;
}
// the whole story: voice, sound, clips, captions (Story -> Reel drives it and shows the progress)
async function storyRun(text, voice, songFile, clipFiles, onStage, per){
  onStage && onStage('voice', 0);
  const S = await storyVoice(text, voice, (p, stage) => onStage && onStage('voice', p, stage));
  story = { scenes: S.scenes, dur: S.dur, per: per || 0 }; // per: Shubix's pictures in order, each covering that many sentences
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
const auSet = (patch) => { au = { ...au, ...patch, ...(Object.prototype.hasOwnProperty.call(patch, 'mfout') ? { mfoutManual: true } : {}) }; auUI(); applyVo(); if(!playing) redrawFrame(); };
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
// the templates are data (lib/studio-templates.ts; the administrator's list from /api/templates, today's ones)
const TPL_KEY = 'brs-templates';
function tplOf(t){
  const e = t.edit || {}, xs = Array.isArray(e.texts) && e.texts.length ? e.texts : null;
  return { kind: t.kind === 'photo' ? 'music' : t.kind, photo: t.kind === 'photo', name: t.name, look: e.look || 'natural', mode: e.mode, style: e.style, bg: e.bg, hook: e.hook, caps: !!e.caps, len: t.len,
    pace: e.pace || 'natural', music: e.music ?? 0.05,
    texts: xs ? L => xs.map(x => ({ text: x.text, style: x.style, color: x.color, anim: x.anim, y: x.y, size: x.size, all: !!x.all, ...(x.all ? {} : { at: [edgeAt(x.from, L, 0), edgeAt(x.to, L, L)] }) })) : undefined };
}
let TEMPLATES = {};
function tplSet(list){
  TEMPLATES = Object.fromEntries(list.map(t => [t.id, tplOf(t)]));
  const box = $('tpl'); if(!box) return;
  box.replaceChildren(...list.map(t => { const b = document.createElement('button'); b.type = 'button'; b.dataset.t = t.id; b.dataset.kind = t.kind; b.textContent = t.name; b.setAttribute('aria-pressed', String(t.id === tplName)); return b; }));
}
(() => { let c = null; try{ c = JSON.parse(localStorage.getItem(TPL_KEY) || 'null'); }catch(e){} tplSet(liveTemplates(c && Array.isArray(c.templates) ? c.templates : DEFAULT_TEMPLATES)); })();
const tplReady = fetch('/api/templates').then(r => r.ok ? r.json() : null).then(r => {
  if(!r || !Array.isArray(r.templates)) return; tplSet(r.templates);
  try{ localStorage.setItem(TPL_KEY, JSON.stringify({ at: Date.now(), templates: r.templates })); }catch(e){}
}).catch(() => {});
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
  $('tplhelp').textContent = edit.length ? '' : 'Now add ' + (t.kind === 'talk' ? 'your talking clips' : t.photo ? 'a song and your photos' : 'a song and your clips') + ': the template is applied to the edit.';
  tplApplySoon();
  styleForTemplate(name);   // its kind's learned style, unseen (above)
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
// the Reel's name: "Untitled 1", "Untitled 2"… for a new one (the next number among this phone's drafts), changed by
// tapping it in the editor's head; it names the draft, the Reel in My Reels and the exported video file
let reelTitle = '';
const fileTitle = () => (reelTitle || 'Reel').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Reel';
async function nextUntitled(){
  let n = 0;
  try{ const all = await idb('meta', 'readonly', st => st.getAll()); for(const m of all || []){ const x = /^Untitled (\d+)$/.exec(m && m.name || ''); if(x) n = Math.max(n, +x[1]); } }catch(e){}
  return 'Untitled ' + (n + 1);
}
function setReelTitle(t){
  const v = String(t || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if(!v || v === reelTitle) return false;
  reelTitle = v; const el = $('tbname'); if(el) el.textContent = v; return true;
}
let proj = null, lastSig = '', restoring = false, capKeyNow = '';
// a new Reel in Create has its own id from the start: it is a draft in My Reels from its first song or clip, kept as it
// changes (the address stays the Create steps' until Generate opens the editor)
const projNewId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
if(location.pathname.startsWith('/create') && location.pathname !== '/create/edit' && !new URLSearchParams(location.search).get('p')) proj = { id: projNewId(), created: Date.now() };
// a saved Reel, opened: its edit is kept as it was saved (no new plan, no rebuild when the clips' check or the beats
// finish) until the creator asks for a change that needs one (Change Reel, a style, the chat, clips, the song or its part)
let keepSaved = false;
function remakeOk(){ if(!restoring) keepSaved = false; }
const fileFp = f => f ? [f.name, f.size, f.lastModified].join('|') : '';
let voF = null; const voFile = () => (voF && voF.name === 'voiceover-' + vo.key + '.f32') ? voF : (voF = new File([vo.raw], 'voiceover-' + vo.key + '.f32', { type: 'application/octet-stream', lastModified: parseInt(vo.key, 36) || 1 }));
function pdb(){ return new Promise((res, rej) => { const r = indexedDB.open(PDB, 2);
  r.onupgradeneeded = () => { const d = r.result; if(!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'id' }); if(!d.objectStoreNames.contains('files')) d.createObjectStore('files');
    if(!d.objectStoreNames.contains('songs')) d.createObjectStore('songs', { keyPath: 'fp' }); };
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
function idb(store, mode, fn){ return pdb().then(d => new Promise((res, rej) => { const t = d.transaction(store, mode), req = fn(t.objectStore(store));
  t.oncomplete = () => { d.close(); res(req && 'result' in req ? req.result : undefined); }; t.onerror = () => { d.close(); rej(t.error); }; t.onabort = () => { d.close(); rej(t.error || new Error('storage full')); }; })); }
function editOf(){
  return kind === 'talk' ? [] : edit.map(e => ({ start: e.start, end: e.end, type: e.type, fx: e.fx, tr: e.tr, efx: e.efx, sp: speedKey(e.sp), src: e.src, in: e.in, scaleR: e.scaleR, cx: e.cx, cy: e.cy, face: e.face, fs: e.fs, uk: e.uk && e.uk.length ? e.uk : undefined, acc: e.acc && e.acc.length ? e.acc : undefined, ak: e.ak && e.ak.length ? e.ak : undefined, cs: e.cs ? JSON.parse(JSON.stringify(e.cs)) : undefined, flick: e.flick || undefined, trd: e.trd ?? undefined, black: e.black || undefined }));
}
function stateOf(){
  return { kind, song: song && song.file ? { fp: fileFp(song.file), name: song.name } : null, sec: { len: sec.len, auto: sec.auto, start: sec.start },
    clips: sources.map(s => ({ fp: fileFp(s.file), name: s.name })),
    settings: { au, tts: ttsClips.map(c => ({ id: c.id, text: c.text, voice: c.voice, at: c.at })), trTo, trOnly, tr: trTo ? [...trCache].filter(([k]) => k.startsWith(trTo + '|')).slice(0, 200) : [], denoise: denoiseOn, mode: mode === 'copy' ? 'auto' : mode, look: look === 'copy' ? 'vivid' : look, aspect, textStyle, hookText, capsOn, caplang: $('caplang').value, talkPace, talkMusic, bgMode, bgColor, marks: userMarks.slice(0, 200), sfx: sfxList.map(x => ({ at: x.at, kind: x.kind })), capColor: ACCENT, seed, bg: bgFile ? fileFp(bgFile) : '', seq: seqOn, title: reelTitle, chat: chatMsgs.slice(-20), reelId, aiOk: !!reelId && aiReel === reelId, chatUsed },
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
    life({ saving: 1 });   // the stage stays what the studio is doing (a save every few seconds would hide it)
    if(!proj){ proj = { id: projNewId(), created: Date.now() }; try{ navigator.storage && navigator.storage.persist && navigator.storage.persist(); }catch(e){} }
    if(song && song.file) await putFile(song.file);
    for(const s of sources) if(s.file) await putFile(s.file);
    if(bgFile) await putFile(bgFile);
    for(const M of lmedia) await putFile(M.file);
    if(vo) await putFile(voFile());
    if(!reelTitle){ reelTitle = await nextUntitled(); st = { ...st, settings: { ...st.settings, title: reelTitle } }; sig = JSON.stringify(st); }
    const name = reelTitle;
    await idb('meta', 'readwrite', s => s.put({ id: proj.id, created: proj.created, updated: Date.now(), name, kind, dur: buf ? buf.duration : 0, shots: edit.length, thumb: thumbOf(), state: st }));
    life({ saving: 0, proj: proj.id });
    // a made Reel has its own address (/editor?p=…): a reload, a shared link or Back to it opens this Reel, not a new one
    // (only once the editor is open: still in the Create steps the address stays /create/music?step=…; flow.ts sets it on Generate)
    if(!IN_APP && edit.length && root.classList.contains('made') && !root.classList.contains('fopen') && new URLSearchParams(location.search).get('p') !== proj.id) history.replaceState(history.state, '', '/editor?p=' + proj.id);
    // still in the Create steps: a reload of this tab offers this Reel back (resumeOffer)
    if(location.pathname.startsWith('/create')){ try{ sessionStorage.setItem('brs-resume:' + location.pathname, proj.id); }catch(e){} }
    lastSig = sig; $('psaved').textContent = 'Saved on this phone ✓ ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }catch(err){ console.warn('project not saved:', err); $('psaved').textContent = 'Not saved'; notify('Could not save this Reel on your phone. It may be low on space.', 'err'); }
  finally{ saving = false; if(lifeNote.saving) life({ saving: 0 }); }
}
async function saveNow(){
  while(saving) await new Promise(resolve => setTimeout(resolve, 40));
  const st = stateOf(), sig = JSON.stringify(st);
  if(sig !== lastSig) await saveProject(st, sig);
  while(saving) await new Promise(resolve => setTimeout(resolve, 40));
  return proj ? proj.id : '';
}
setInterval(() => {
  if(restoring || recording || exporting || pending || (!song && !sources.length) || typeof indexedDB === 'undefined') return;
  // an iPhone: copying big clip files into the phone's storage is not done while the preview plays (memory)
  if(IOS && (playing || starting)) return;
  const st = stateOf(), sig = JSON.stringify(st); if(sig !== lastSig) saveProject(st, sig);
}, 3000);
// leaving or reloading while Shubix is still working, or before the last change is kept: the browser asks first
window.addEventListener('beforeunload', e => {
  if(pending || exporting || recording){ e.preventDefault(); e.returnValue = ''; return; }
  if((song || sources.length) && !restoring){ try{ const sig = JSON.stringify(stateOf()); if(sig !== lastSig){ e.preventDefault(); e.returnValue = ''; } }catch(err){} }
});
// the page was reloaded in the middle of the Create steps: the Reel so far is a draft on this phone; offer it back
async function resumeOffer(){
  let id = ''; try{ id = sessionStorage.getItem('brs-resume:' + location.pathname) || ''; }catch(e){}
  if(!id || new URLSearchParams(location.search).get('p')) return;
  const p = await idb('meta', 'readonly', st => st.get(id)).catch(() => null); if(!p) return;
  const box = $('toasts'); if(!box) return;
  const n = document.createElement('div'); n.className = 'toast resume';
  const t = document.createElement('span'); t.textContent = 'Your Reel "' + p.name + '" was saved on this phone.';
  const go = document.createElement('a'); go.href = '/editor?p=' + encodeURIComponent(id); go.textContent = 'Continue';
  const no = document.createElement('button'); no.type = 'button'; no.textContent = 'Start new';
  no.addEventListener('click', () => { try{ sessionStorage.removeItem('brs-resume:' + location.pathname); }catch(e){} n.remove(); });
  n.append(t, go, no); box.appendChild(n); requestAnimationFrame(() => n.classList.add('in'));
  setTimeout(() => { n.classList.remove('in'); setTimeout(() => n.remove(), 300); }, 15000);
}
const press = (seg, attr, val) => { const b = $(seg).querySelector(`[data-${attr}="${val}"]`); if(b && b.getAttribute('aria-pressed') !== 'true') b.click(); };
async function openProject(id){
  // "Opening your Reel…" over the page until the edit is back (flow.ts shows it from the first paint); its line follows say()
  restoring = true; root.classList.add('opening'); const say = t => { $('psaved').textContent = t; $('openstep').textContent = t.replace(/…$/, ''); };
  let expectedClips = 0;
  try{
    const p = await idb('meta', 'readonly', s => s.get(id)); if(!p){ say('That Reel is no longer on this phone.'); return; }
    const st = p.state; expectedClips = (st.clips || []).length; const getF = async (fp, name) => { const b = fp ? await idb('files', 'readonly', s => s.get('f:' + fp)) : null; return b ? new File([b], name || b.name || 'file', { type: b.type, lastModified: +fp.split('|').pop() || Date.now() }) : null; };
    say('Opening "' + p.name + '"…'); proj = { id: p.id, created: p.created };
    reelTitle = (st.settings && st.settings.title) || p.name || '';
    const S = st.settings || {};
    keepSaved = st.kind !== 'talk' && !!(st.edit && st.edit.length);   // no plan / rebuild while it opens: its own edit comes back
    talkKfs = st.kind === 'talk' && st.kfs ? st.kfs : null;
    if(st.kind === 'talk') setKind('talk');
    press('aspect', 'a', S.aspect); press('look', 'l', S.look); press('tstyle', 't', S.textStyle); if(S.mode && S.mode !== 'auto') press('mode', 'm', S.mode);
    press('tpace', 'p', S.talkPace); press('tmusic', 'v', String(S.talkMusic));
    if(S.au) au = { ...AU0, ...S.au }; auUI();
    if(S.tts && S.tts.length){ ttsClips = S.tts.map(c => ({ ...c })); ttsSeq = ttsClips.reduce((q, c) => Math.max(q, c.id), 0); ttsList(); }
    hookText = S.hookText || ''; $('hook').value = hookText; seed = S.seed || 1; chatRestore(S.chat); if(typeof S.reelId === 'string' && S.reelId){ reelId = S.reelId; if(S.aiOk) aiReel = reelId; chatUsed = Number(S.chatUsed) || 0; } if(S.denoise === false){ denoiseOn = false; $('dn1').checked = false; $('dn2').checked = false; }
    if(S.caplang !== undefined) $('caplang').value = S.caplang;
    if(S.trTo){ for(const [k, v] of S.tr || []) trCache.set(k, v); trTo = S.trTo; trOnly = !!S.trOnly; $('captr').value = trTo; $('tronly').checked = trOnly; $('trwrap').hidden = false; }
    if(st.caps && st.caps.key) capCache.set(st.caps.key, st.caps.all);
    if(st.vo && st.vo.fp){ const vf = await getF(st.vo.fp, 'voiceover-' + st.vo.key + '.f32'); if(vf){ vo = { raw: new Float32Array(await vf.arrayBuffer()), sr: st.vo.sr, key: st.vo.key }; await cleanVo(); } }
    if(S.bg){ const bf = await getF(S.bg, 'background'); if(bf){ bgFile = bf; const im = new Image(); im.onload = () => { bgImg = im; redrawFrame(); }; im.src = URL.createObjectURL(bf); } }
    if(S.capColor) ACCENT = S.capColor;
    if(S.seq) setSeq(true, false);
    if(Array.isArray(S.marks)) userMarks = S.marks.filter(Number.isFinite);
    if(Array.isArray(S.sfx)){ sfxList = S.sfx.filter(x => SFX_NAMES[x.kind] && Number.isFinite(x.at)).map(x => ({ ...x, id: ++sfxSeq })); sfxUI(); }
    bgColor = S.bgColor || bgColor; if(S.bgMode && S.bgMode !== 'none') press('bgmode', 'b', S.bgMode);
    overlays = (st.overlays || []).map(o => ({ ...o })); ovSeq = overlays.reduce((q, o) => Math.max(q, o.id || 0), 0); renderOvList();
    if(st.sec){ sec.len = st.sec.len; sec.auto = st.sec.auto; sec.start = st.sec.start;
      [...$('slen').children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.l === (!sec.len ? '0' : [15,30,60].includes(sec.len) ? String(sec.len) : 'c'))));
      if(sec.len && ![15,30,60].includes(sec.len)){ $('slenc').value = sec.len; $('slencw').hidden = false; } $('sauto').hidden = !sec.len; $('lenhint').hidden = !sec.len; $('mwave').classList.toggle('drag', !!sec.len); }
    const clips = []; for(const c of st.clips || []){ const f = await getF(c.fp, c.name); if(f) clips.push(f); }
    const sf = st.song ? await getF(st.song.fp, st.song.name) : null;
    if(sf){ let cs = null; try{ cs = await idb('songs', 'readonly', s => s.get(st.song.fp)); }catch(e){} await loadMusic(sf, cs && cs.r ? { r: cs.r, aiDone: cs.aiDone } : null); }
    if(clips.length){ addVideos(clips, true); await addQueue; }
    if(st.kind !== 'talk' && st.edit && st.edit.length && clips.length === (st.clips || []).length && restoreEdit(st.edit)){ keepSaved = true;
      // the editor opens on it, as after making a Reel (the step, Play / Change Reel / Export)
      $('s3').classList.remove('locked'); $('s3').classList.add('done'); $('s3st').textContent = edit.length + ' shots · ' + fmt(buf ? buf.duration : 0);
      ['play','remix','export','cover'].forEach(id => $(id).disabled = false); }
    else if(keepSaved){ keepSaved = false; if(buf && sources.length) makeEdit(); }   // the saved edit does not fit (a clip is missing): a new one
    if(st.layers && st.layers.length){ const ms = []; for(const c of st.lmedia || []){ const f = await getF(c.fp, c.name); try{ ms.push(f ? await addLayerMedia(f) : null); }catch(e){ ms.push(null); } }
      lmedia = ms.filter(Boolean); const idx = ms.map((m, i) => m ? ms.slice(0, i).filter(Boolean).length : -1);
      layers = st.layers.filter(L => idx[L.m] >= 0).map(L => ({ ...L, m: idx[L.m] })); lySeq = layers.reduce((q, L) => Math.max(q, L.id), 0); lyUI(); }
    if(S.capsOn && !capsOn){ $('caps').checked = true; capsOn = true; $('caprow').hidden = false; loadCaptions(); }
    if(vo) afterVo();
    redrawFrame();
    const missing = (st.clips || []).length - clips.length + (st.song && !sf ? 1 : 0);
    const unreadable = (st.clips || []).length - sources.length;
    say(missing ? missing + ' file(s) of this Reel are no longer on this phone' : unreadable ? unreadable + ' clip(s) could not be read on this device' : 'Opened "' + p.name + '" · saved on this phone');
  }catch(err){ console.warn('project not opened:', err); say('This Reel could not be opened.'); notify('This Reel could not be opened.', 'err'); }
  finally{ lastSig = JSON.stringify(stateOf()); restoring = false; root.classList.remove('opening');
    // nothing to show (gone, or its files are not on this phone): say so, not a blank page
    if(!edit.length && !sources.length && expectedClips){ root.classList.add('openfail'); $('openh').textContent = 'This Reel could not be opened'; }
    // a Reel left in the Create steps (a song, no clips yet): not an empty editor, but its steps again, where it was left
    else if(!edit.length && !sources.length && proj && /^\/(editor|create\/edit)$/.test(location.pathname)){
      const slug = { talk: 'talking', photo: 'photo', copy: 'copy' }[kind] || 'music';
      location.replace('/create/' + slug + '?p=' + encodeURIComponent(proj.id) + '&step=' + (song ? 'clips' : 'choose'));
    } }
}
function restoreEdit(list){
  if(!list.every(x => sources[x.src])) return false;
  stopAll(); const uc = sources.map(() => 0);
  edit = list.map(x => { const e = { ...x, el: sources[x.src].els[(uc[x.src]++) % 3], dirWhy: '', why: '' }; e.sp = speedFor(x.sp, e); e.kf = keyframesFor(e); e.beatsIn = beats.filter(b => b > e.start + 0.12 && b < e.end - 0.05).map(b => b - e.start); return e; });
  plan = edit.map(e => ({ start: e.start, end: e.end, type: e.type, fx: e.fx, sp: e.sp, tr: e.tr, efx: e.efx, acc: e.acc, ak: e.ak, ref: e.ref, flick: e.flick, trd: e.trd, black: e.black }));
  setCanvas(); edit.forEach(e => camAt(e, 0)); renderEDL(); drawMusic(); captureLoop(); editGen++;
  flickBuild();   // a saved flicker montage: its stills again
  return true;
}
{ const q = new URLSearchParams(location.search).get('p'); if(q && typeof indexedDB !== 'undefined') openProject(q); else { keptSweep(); resumeOffer(); } }

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
// a recent song heard before it is chosen: its play button (one at a time; choosing a song, leaving or the list
// drawn again stops it)
let preview = null, previewFp = '', previewUrl = '';
function stopPreview(){
  if(preview){ preview.pause(); preview.removeAttribute('src'); }
  if(previewUrl) URL.revokeObjectURL(previewUrl);
  preview = null; previewFp = ''; previewUrl = '';
  document.querySelectorAll('#rlist .rplay.on').forEach(b => { b.classList.remove('on'); b.innerHTML = PLAY_SVG; b.setAttribute('aria-label', 'Play ' + (b.dataset.name || 'song')); });
}
async function togglePreview(fp, btn){
  const again = previewFp === fp; stopPreview(); if(again) return;   // its own button again: pause
  const b = await idb('files', 'readonly', s => s.get('f:' + fp)).catch(() => null);
  if(!b){ await forgetSong(fp); return; }
  previewUrl = URL.createObjectURL(b); preview = new Audio(previewUrl); previewFp = fp;
  preview.onended = stopPreview;
  btn.classList.add('on'); btn.innerHTML = PAUSE_SVG; btn.setAttribute('aria-label', 'Pause ' + (btn.dataset.name || 'song'));
  try{ await preview.play(); }catch(e){ stopPreview(); }
}
ac.signal.addEventListener('abort', stopPreview);
async function listRecent(){
  let all = []; try{ all = (await idb('songs', 'readonly', s => s.getAll()) || []).sort((a, b) => b.usedAt - a.usedAt); }catch(e){ return; }
  stopPreview();
  const box = $('rlist'); box.innerHTML = '';
  for(const sg of all){
    const d = document.createElement('div'); d.className = 'rsong' + (song && song.file && fileFp(song.file) === sg.fp ? ' cur' : '');
    d.innerHTML = '<button class="rplay" type="button">' + PLAY_SVG + '</button><button class="rpick" type="button"><span class="rn"></span><span class="rd"></span></button><button class="rdel" type="button" aria-label="Remove from recent songs" title="Remove"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>';
    d.querySelector('.rn').textContent = sg.name.replace(/\.[^.]+$/, ''); // the note is the card's picture (::before)
    d.querySelector('.rd').textContent = fmt(sg.dur || 0).replace(/\.\d+$/, '');
    const name = sg.name.replace(/\.[^.]+$/, ''), play = d.querySelector('.rplay');
    play.dataset.name = name; play.setAttribute('aria-label', 'Play ' + name); play.title = 'Listen';
    play.addEventListener('click', () => togglePreview(sg.fp, play));
    d.querySelector('.rpick').addEventListener('click', () => { stopPreview(); pickRecent(sg.fp); });
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

root.__studio = { get songR(){ return song && song.r; }, get now(){ return playing ? Math.max(0, curTime()) : (pos || 0); }, get playing(){ return playing; }, get dur(){ return buf ? buf.duration : 0; }, get songName(){ return song && song.name ? song.name.replace(/\.[^.]+$/, '') : ''; }, get title(){ return reelTitle; }, get hook(){ return hookText; }, get capsOn(){ return capsOn; }, segAt, drawTimeline, state: () => stateOf(), get pos(){ return pos; }, get playing(){ return playing; }, kfSet, kfTarget: () => kfTarget(), kfSeek, uAt, emph: emphAt, get capLines(){ return capLines; }, get editGen(){ return editGen; }, get vo(){ return vo; }, get base(){ return { buf: baseBuf, norm: baseNorm }; }, get overlays(){ return overlays; }, setOverlays: setOverlaysFromNative, get bg(){ return { mode: bgMode, mask: !!bgMask, err: bgErr }; }, get faceHow(){ return sources.map(s => s.faceHow); }, seek: t => { pos = t; const i = segAt(t); return prepare(i, t).then(()=>drawFrame(t)); }, get talk(){ return talk; }, get audio(){ return buf; }, get kind(){ return kind; }, get section(){ return { start: secStart, len: buf ? buf.duration : 0, auto: sec.auto, whole: song ? song.buf.duration : 0, words: capWords }; }, get wakeLockHeld(){ return !!wakeLock; }, loseGL: () => GL && GL.gl.getExtension('WEBGL_lose_context'), renderedLook, get capLines(){ return capLines; }, faceYOnScreen, get edit(){ return edit; }, setEdit: list => restoreEdit(list), get plan(){ return plan; }, sources, gl: !!GL, get beats(){ return beats; }, get parts(){ return songPartsRel; }, get mode(){ return mode; }, get recipe(){ return recipeNow().name; }, planNow: () => adaptPlan().map(x => +x.start.toFixed(2)), get beatInfo(){ return beatInfo; }, get ref(){ return refProfile; }, fingerprint: () => refProfile ? fingerprintOf(refProfile) : null, copyMatch, get grade(){ return GRADES[look]; },
  snap: histSnap, unsnap: snapRestore, upsell, projId: () => proj ? proj.id : '', saveNow, shotOp, shotMove: shotReorder, shotRoll, ovSelect: i => { ovSel = overlays[i] ? i : -1; renderOvList(); redraw(); }, ovRefresh: () => { renderOvList(); redraw(); }, get ovSel(){ return ovSel; }, shotCs, shotSet, shotSlip, shotTrim, shotRipple, shotReverse, addMark, clearMarks, setTlZoom, sfxAdd, sfxEvents, ensureMix, setLook: k => { const b = $('look').querySelector('[data-l="' + k + '"]'); if(b) b.click(); return look; }, get marks(){ return userMarks; }, autoExport, extractAudio, autoSound, storyRun, setPart: t => { remakeOk(); sec.start = Math.max(0, +t || 0); sec.auto = false; return useSection(); }, saveLast: () => lastVideo && saveFile(lastVideo, lastName || 'reel.mp4'),
  get work(){ return { song: !!song || kind === 'talk', songReady: kind === 'talk' || !!(song && buf && song.r), beats: beatsBusy, pending, clips: sources.length, shots: edit.length, ai: aiBusy, dir: dirBusy, pace: paceBusy,
    // Shubix AI is on for this Reel and its plan has not come yet (nor failed): the Reel is not final (the phone app waits)
    aiWait: !!(aiOn && aiReelOk() && aiGaveUp !== reelIdNow() && edit.length && !(director && director.key === dirKey() && !director.interim) && dirFailedKey !== dirKey()), speech: speechBusy, exporting: exportBusy, exportP }; }, shotExtract: () => edit.length && extractAudio(edit[segAt(pos)].src), get au(){ return au; }, setAudioMix: async patch => { auSet(patch); clipMixKey = ''; await ensureMix(); return au; }, remix: remixNow, ensureMix, get canUndo(){ return hist.u.length > 0; }, get layers(){ return layers; }, get lmedia(){ return lmedia; }, layerAdd, layerSelect: lySelect, layerSet: lySet, layerDelete: lyDelete, get ttsVoices(){ return tts ? tts.voices : []; }, addTts: addTtsAtPlayhead, clearTts, setCaptions, setCaptionStyle, get canRedo(){ return hist.r.length > 0; },
  frameAt: async t => { const i = segAt(t); await prepare(i, t); drawFrame(t); return i; }, camAt,
  // the phone app (bridge.ts): the account known after the start, Ask Shubix, the clips' smooth copies
  account, chatApp, get aiOn(){ return aiOn; },
  // the export's plan check (what the plan does not include, as the website's Export button asks) and the post's caption
  exportLocked: () => lockedUsed().map(x => ({ name: x.name, need: PLAN_NAME[x.need] })),
  exportFix: () => { lockedUsed().forEach(x => x.fix()); renderEDL(true); renderOvList(); sheetPaint(); }, caption: () => captionOf(),
  copies: () => sources.map((s, i) => ({ i, name: s.name, blob: s.edFile || null, w: s.edW || 0, h: s.edH || 0 })) };   // read by tests

  return () => {
    try{ stopAll(); }catch(err){}
    ac.abort(); tasks.dispose();
    sources.forEach(s=>{ (s.els||[]).forEach(v=>{ v.pause(); v.removeAttribute('src'); v.load(); }); URL.revokeObjectURL(s.url); });
    try{ ctx && ctx.close(); }catch(err){}
  };
}
