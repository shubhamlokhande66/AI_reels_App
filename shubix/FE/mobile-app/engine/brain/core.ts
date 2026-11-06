// The engine's logic with no browser code of its own (making the Reel, the AI's plans and steps, undo, the song's parts...). Moved from
// the website's studio: its state is the object ES, and what is the app's own comes through EH.
// The golden test (scripts/engine-golden.mjs) says it still makes the same Reel.
// @ts-nocheck
import { srcPos, whatClip, velocitySpeed, rampSpeed, keyframesFor, crossesScene, srcPosF, TAIL, buildCapLines, panClamp, shotBeats, windowStats } from './pure';
import { parseDirectorVisualIntent } from '../components/studio/visualIntent';
import { TR_DUR } from '@mobile/core/lib/shaders';

export function createCoreBrain(ES, EH){
// the preview: the video's own frame times (requestVideoFrameCallback), the picture mixed toward the next one
function smoothLive(e, local){ const v = e.el; if(!v || v.readyState < 2 || !v.requestVideoFrameCallback) return v;
  if(!v.__rvf){ v.__rvf = 1; const cb = (now, m) => { if(v.__mt !== undefined && m.mediaTime > v.__mt && m.mediaTime - v.__mt < 0.2) v.__dt = m.mediaTime - v.__mt; v.__mt = m.mediaTime; v.requestVideoFrameCallback(cb); }; v.requestVideoFrameCallback(cb); }
  if(v.__mt === undefined) return v;
  return EH.smoothPic(e, v, v.__mt, srcPos(e, local), v.__dt || 1/30); }
function addMark(t){ if(!ES.buf || !ES.edit.length) return false; EH.remakeOk(); ES.userMarks.push(+(ES.secStart + t).toFixed(3)); ES.beats = EH.withMarks(ES.beats, ES.buf.duration); makeEdit(); EH.notify('Beat added at ' + t.toFixed(1) + ' s: a cut can land there now'); return true; }
function delMark(t){ const T = ES.secStart + t, i = ES.userMarks.findIndex(m => Math.abs(m - T) < 0.15); if(i < 0){ EH.notify('No marker of yours here: move the playhead onto a yellow marker.'); return false; }
  EH.remakeOk(); const m = ES.userMarks.splice(i, 1)[0] - ES.secStart; ES.beats = ES.beats.filter(b => Math.abs(b - m) > 0.005); makeEdit(); EH.notify('Marker removed'); return true; }
function clearMarks(){ if(!ES.userMarks.length) return false; EH.remakeOk(); const ts = ES.userMarks.map(m => m - ES.secStart); ES.userMarks = []; ES.beats = ES.beats.filter(b => !ts.some(t => Math.abs(t - b) < 0.005)); makeEdit(); EH.notify('Your beats are cleared'); return true; }
function stopPart(keep){
  if(ES.partSrc){ const s = ES.partSrc, at = EH.partNow(); ES.partSrc = null; try{ s.stop(); }catch(e){} ES.partPos = keep ? at : null; }
  else if(!keep) ES.partPos = null;
  cancelAnimationFrame(ES.partRaf); if(ES.song) EH.drawMusic();
}
async function checkBeatsWithAi(token){
  if(!EH.aiBeats || !ES.song) return;
  if(EH.IOS && EH.aiBeatsOff()){ ES.beatInfo = { source: 'own', note: 'off on this phone (it ran short of memory before)' }; return; }
  ES.beatsBusy = true; EH.life({ stage: 'checking beats' });
  try{ await EH.checkBeatsInner(token); } finally { ES.beatsBusy = false; if(ES.lifeNote.stage === 'checking beats') EH.life({ stage: 'song ready' }); }
}
async function scanGet(src){
  const k = await EH.keptGet('a:', src.file);
  return k && k.v === EH.SCAN_V && Math.abs((k.dur || 0) - src.dur) < 0.05 && k.w === src.w && Array.isArray(k.samples) && k.samples.length ? k : null;
}
function scanPut(src){ EH.keptPut('a:', src.file, { v: EH.SCAN_V, dur: src.dur, w: src.w, scenes: src.scenes || [], samples: src.samples, faces: src.faces || [], faceHow: src.faceHow }); }
// results whose file is gone (its Reels deleted from Fast Studio or from My Reels): removed now and then
async function keptSweep(){
  try{ const keys = await idb('files', 'readonly', s => s.getAllKeys()) || [], have = new Set(keys.filter(k => String(k).startsWith('f:')).map(k => String(k).slice(2)));
    const old = keys.filter(k => /^[avp]:/.test(String(k)) && !have.has(String(k).slice(2)));
    if(old.length) await idb('files', 'readwrite', s => { old.forEach(k => s.delete(k)); });
  }catch(e){}
}
// what the person sees when a heavy clip could not get its copy (it is kept, but may lag)
function editCopyFailNote(src, facts){
  const why = whatClip(facts);
  const tip = src.edFail === 'limit' && src.edErr ? ' ' + src.edErr : src.edFail === 'broken' ? ' The file looks damaged or incomplete: copy it again from your phone and add it.' : src.edFail === 'signin' ? ' Sign in and add it again: Shubix converts it for you.'
    : src.edFail === 'offline' ? ' Connect to the internet and add it again: Shubix converts it for you.'
    : src.edFail === 'big' ? ' It is too big to convert online: save it as MP4 (H.264, 1080p, 30 fps) from your camera or phone and add it again.'
    : ' Save it as MP4 (H.264, 1080p, 30 fps) and add it again. On an iPhone: Settings → Camera → Formats → Most Compatible.';
  EH.notify(src.name + ' (' + why + ') could not be made smooth on this device, so it may lag.' + tip, 'err');
}
function styleEdit(){
  // pros mostly hard-cut; special transitions go on hits, drops and section changes, never twice in a row
  // every Reel (and New mix) its own order of transitions and effects; the same Reel edited again keeps its order
  let h = ES.mixNo + 1; for(const c of EH.reelIdNow()) h = (h*31 + c.charCodeAt(0)) >>> 0;
  const pick = () => { h = (h*16807 + 1) % 2147483647; return h / 2147483647; };
  const mixed = a => { const o = [...a]; for(let i = o.length-1; i > 0; i--){ const j = Math.floor(pick()*(i+1)); [o[i], o[j]] = [o[j], o[i]]; } return o; };
  const HIT_TR = mixed(['whip','iris','zoom','glitch','swipeup','spin','dropin','bars','pixelate'].filter(k => !EH.isLocked('tr', k)));   // only what the plan opens
  const CUT_TR = mixed(['hard','wipe','hard','iris','slideleft','hard','bars','blur','hard','luma','doors'].filter(k => k === 'hard' || !EH.isLocked('tr', k)));
  const HIT_FX = mixed(['punch','tilt','punch','shake']);
  let lastTr = '', lastFx = '', hk = 0, ck = 0, fk = 0, dk = 0;
  const beatsRel = (s) => ES.beats.filter(b=>b>s.start+0.15 && b<s.end-0.1).map(b=>b-s.start);
  // restraint: fancy transitions are rationed (whip pans 1-2 per reel), the rest are clean hard cuts
  const per = Math.max(1, ES.buf.duration/30), budget = {snap:Math.round(2*per), whip:Math.round(2*per), spin:Math.round(1*per), glitch:Math.round(2*per), bars:Math.round(2*per), iris:Math.round(3*per), zoom:Math.round(3*per), wipe:Math.round(2*per), dissolve:Math.round(2*per)};
  const take = k => { if(budget[k]===undefined) return k; if(budget[k]>0){ budget[k]--; return k; } return 'hard'; };
  // beat shapes on a few longer shots and some drops: a different set and order with each seed / mix, never one twice in a row
  const SH_ROT = ['boxgrow','frame','grid','circle','strips','triple','heartbeat','starbeat'].filter(k => !EH.isLocked('fx', k)), SH_DROP = ['kaleido','strobe','triple','rgbpulse','mirror','vhs'].filter(k => !EH.isLocked('fx', k));
  const shOff = Math.floor(pick()*SH_ROT.length); let shLeft = Math.max(1, Math.round(2*per)), shK = 0, lastSh = '';
  ES.plan.forEach((s,i)=>{
    const len = s.end - s.start, next = ES.plan[i+1], prev = ES.plan[i-1];
    let tr='hard', fx='none', sp=EH.SPEED.normal;
    if(i===0){ tr='hard'; fx='hook'; }   // hook: no soft fade, start mid-action with a sharp zoom
    else if(s.type==='drop'){
      tr='flash';
      if((dk++ % 2)===1 && len>0.7 && take('snap')==='snap'){ fx='snap'; sp=EH.snapSpeed; }   // photographer signature, rationed
      else { fx='zoomburst'; const bl=beatsRel(s); if(len>0.9) sp = bl.length ? velocitySpeed(len, bl) : rampSpeed(len); }
    }
    else if(s.type==='break'){ tr='dip'; fx='drift'; sp=EH.SPEED.slow; }
    else if(s.type==='hit'){
      let k = HIT_TR[hk++ % HIT_TR.length]; if(k===lastTr) k = HIT_TR[hk++ % HIT_TR.length]; tr = take(k);
      fx = len<0.3 ? 'shake' : HIT_FX[fk++ % HIT_FX.length];
      if(len<0.5) sp = EH.SPEED.fast;
    } else {
      if(len<0.3){ tr='hard'; fx='shake'; sp=EH.SPEED.fast; }
      else if(len>1.6 && (!prev || prev.type!=='drop')){ tr = take((i%2) ? 'dissolve' : 'wipe'); fx='pan'; }
      else if(len>1.0 && next && (next.type==='drop'||next.type==='hit')){ tr='hard'; fx='pan'; const bl=beatsRel(s); sp = bl.length ? velocitySpeed(len, bl) : rampSpeed(len); }
      else { let k = CUT_TR[ck++ % CUT_TR.length]; if(k===lastTr && k!=='hard') k='hard'; tr=take(k); fx = ['bounce','pan','shake'].includes(lastFx) ? 'none' : 'bounce'; }   // a pulse every other cut, not on all
    }
    if(prev && prev.type==='break' && s.type!=='break') tr = 'flash';
    if(ES.mode==='smooth'){   // soft camera moves only: no punches, flashes or speed tricks
      tr = i===0 ? 'fadein' : s.type==='break' ? 'dip' : (s.type==='drop' || (prev && prev.type==='break')) ? 'dissolve' : 'hard';
      fx = len>1.2 ? 'pan-soft' : 'none'; sp = s.type==='break' ? EH.SPEED.slow : EH.SPEED.normal;
    } else if(ES.mode==='fast'){   // every cut moves: a transition on each, punches on the hits, speed on the long ones
      if(i>0 && tr==='hard'){ let k = HIT_TR[hk++ % HIT_TR.length]; if(k===lastTr) k = HIT_TR[hk++ % HIT_TR.length]; tr = k; }
      if(fx==='none' || fx==='bounce' || fx==='punch-soft') fx = len<0.3 ? 'shake' : HIT_FX[fk++ % HIT_FX.length];
      if(sp===EH.SPEED.normal){ const bl = beatsRel(s); if(len>0.9) sp = bl.length ? velocitySpeed(len, bl) : rampSpeed(len); else if(len<0.45) sp = EH.SPEED.fast; }
    }
    if(i > 0 && shLeft > 0 && SH_ROT.length && len >= (ES.mode==='smooth' ? 1.8 : 1.2) && beatsRel(s).length >= 2 && s.type !== 'drop' && ['pan','bounce','none','pan-soft'].includes(fx)){
      let k = ES.mode==='smooth' ? ['frame','circle'][shK++ % 2] : SH_ROT[(shOff + shK++) % SH_ROT.length]; if(k === lastSh) k = SH_ROT[(shOff + shK++) % SH_ROT.length];
      fx = k; shLeft--; lastSh = k; }
    else if(s.type === 'drop' && SH_DROP.length && ES.mode !== 'smooth' && dk % 3 === 0 && fx === 'zoomburst' && len >= 0.8){ fx = SH_DROP[(shOff + dk) % SH_DROP.length]; lastSh = fx; }
    // a shake is an accent: never two shots in a row (a run of fast cuts is clean hard cuts; the cuts are the energy)
    if(fx === 'shake' && lastFx === 'shake') fx = 'none';
    s.tr = tr; s.efx = fx; s.sp = sp; lastTr = tr; lastFx = fx;
  });
  if(ES.mode==='copy' && ES.refProfile) EH.copyStyle();
}
function aiDone(charged, failed){
  const withAi = ES.sources.filter(s=>s.ai), n = withAi.reduce((q,s)=>q+s.ai.frames.length, 0);
  EH.aiStat('Shubix scored ' + n + ' moments in ' + withAi.length + ' clip' + (withAi.length>1?'s':'') + (failed ? ' (' + failed + ' skipped)' : '') + (charged ? ' · ' + charged + ' credit' + (charged>1?'s':'') : ''));
  if(ES.buf && ES.sources.length && !ES.recording) makeEdit();
}
// the AI's plan arrived: asked for in the chat, it is shown as a report and waits for Generate; otherwise it is used
function dirArrived(key, d){
  if(ES.chatWaiting){ const ask = ES.chatMsgs.filter(m => m.who === 'me').slice(-1)[0]?.text || ''; ES.chatPending = { key, slots: d.slots, story: d.story || '', texts: d.texts, actions: d.actions, cost: ES.chatCost, intent: parseDirectorVisualIntent(ask) }; EH.chatProposal(ES.chatPending); return false; }
  ES.aiDoneSig = EH.inputSig(); ES.regenOk = false;
  ES.director = { key, slots: d.slots, story: d.story || '', texts: d.texts, actions: d.actions }; ES.dirCache.set(key, ES.director); if(d.texts || d.actions) queueMicrotask(() => void aiApply(d)); return true;   // (after the shots are made: makeEdit)
}
function applyChatVisualIntent(intent, slots = []){
  if(!intent || (!intent.openingText && !intent.squareFrameAll && !intent.transitionAll && !intent.effectsAll)) return '';
  if(!ES.buf || !ES.edit.length) throw new Error('The Reel is not ready for visual edits.');
  const D = EH.reelLen();
  const next = ES.overlays
    .filter(ov => !(intent.squareFrameAll && ov.kind === 'squareFrame') && !(intent.openingText && ov.aiIntent === 'openingText'))
    .map(ov => ({ ...ov, start: ov.t0, end: ov.t1, size: ov.size * 36 }));
  if(intent.openingText){
    next.push({ id: ++ES.ovSeq, aiIntent: 'openingText', start: 0, end: Math.min(D, 2.8), text: intent.openingText,
      style: 'bold', color: '#FFFFFF', anim: 'pop', x: 0.5, y: 0.3, size: 48,
      uk: [
        { t: 0, x: 0, y: 0, s: 0.55, r: 0, o: 0, ez: 'outBack' },
        { t: 0.18, x: 0, y: 0, s: 1.12, r: 0, o: 1, ez: 'outBack' },
        { t: 0.42, x: 0, y: 0, s: 1, r: 0, o: 1, ez: 'inOut' }
      ] });
  }
  let frameCount = 0;
  if(intent.squareFrameAll){
    ES.edit.forEach(shot => {
      const start = Math.max(0, Number(shot.start) || 0), end = Math.min(D, Number(shot.end) || D);
      if(end <= start) return;
      next.push({ id: ++ES.ovSeq, kind: 'squareFrame', start, end, frameColor: '#FFFFFF', frameWidth: 0.008 });
      frameCount++;
    });
  }
  let transitionCount = 0, effectCount = 0;
  let plannedTransitions = null, plannedEffects = null;
  if(intent.transitionAll){
    const valid = key => Object.prototype.hasOwnProperty.call(TR_DUR, key) && !EH.isLocked('tr', key);
    const available = Object.keys(TR_DUR).filter(key => key !== 'hard' && valid(key));
    if(!available.length) throw new Error('No unlocked transition is available for every clip.');
    const counts = new Map();
    slots.forEach((slot, i) => {
      const key = slot && slot.tr;
      if(i > 0 && key && key !== 'hard' && valid(key)) counts.set(key, (counts.get(key) || 0) + 1);
    });
    const preferred = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
      || (valid('dissolve') ? 'dissolve' : available[0]);
    plannedTransitions = ES.edit.map((shot, i) => {
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
    const allowed = EH.FX_OK[ES.mode] || EH.FX_OK.auto;
    const canUse = (fx, i) => !!fx && fx !== 'none' && Object.prototype.hasOwnProperty.call(EH.FX_NAME, fx)
      && (fx === 'hook' ? i === 0 : allowed.includes(fx))
      && !EH.isLocked('fx', fx);
    let previousEffect = '';
    plannedEffects = ES.edit.map((shot, i) => {
      const proposed = slots[i] && (slots[i].fx || slots[i].effect);
      const roleChoices = shot.type === 'drop' ? ['zoomburst', 'punch', 'shake', 'punch-soft']
        : shot.type === 'hit' ? ['punch', 'tilt', 'bounce', 'shake', 'punch-soft']
        : shot.type === 'break' ? ['drift', 'pan-soft', 'punch-soft']
        : ['punch-soft', 'pan-soft', 'drift', 'bounce', 'tilt'];
      const choices = ES.mode === 'smooth' ? ['pan-soft', 'drift'] : roleChoices;
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
    ES.edit.forEach((shot, i) => {
      shot.tr = plannedTransitions[i];
      shot.trd = undefined;
      shot.trByDir = true;
    });
  }
  if(plannedEffects){
    ES.edit.forEach((shot, i) => {
      shot.efx = plannedEffects[i];
      shot.fxByDir = true;
      shot.kf = keyframesFor(shot);
    });
  }
  if(plannedTransitions || plannedEffects){
    EH.renderEDL(true);
    EH.redrawFrame();
  }
  EH.setOverlaysFromNative(next);
  const textApplied = !intent.openingText || ES.overlays.some(ov => ov.text === intent.openingText && ov.aiIntent === 'openingText');
  const framesApplied = !intent.squareFrameAll || ES.overlays.filter(ov => ov.kind === 'squareFrame').length >= frameCount;
  const transitionsApplied = !intent.transitionAll || (transitionCount === ES.edit.length
    && ES.edit.every(shot => shot.tr && Object.prototype.hasOwnProperty.call(TR_DUR, shot.tr)));
  const effectsApplied = !intent.effectsAll || (effectCount === ES.edit.length && ES.edit.every(shot => shot.efx && shot.efx !== 'none' && Object.prototype.hasOwnProperty.call(EH.FX_NAME, shot.efx)));
  if(!textApplied || !framesApplied || !transitionsApplied || !effectsApplied || (intent.squareFrameAll && frameCount !== ES.edit.length)){
    throw new Error('The requested visual edit could not be verified in the Reel.');
  }
  EH.redrawFrame();
  const applied = [];
  if(intent.openingText) applied.push('opening text “' + intent.openingText + '”');
  if(intent.squareFrameAll) applied.push('square frame on all ' + frameCount + ' clips');
  if(intent.transitionAll) applied.push('transitions on all ' + transitionCount + ' clips');
  if(intent.effectsAll) applied.push('effects on all ' + effectCount + ' clips');
  return applied.join(' and ');
}
function chatDone(story){ if(!ES.chatWaiting) return; EH.chatAnswer('Done ✓ Your Reel is edited the way you asked' + (story ? ': ' + story : '.') + ' Tell me if you want anything else.'); }
function chatFail(msg){ if(ES.chatWaiting) EH.chatAnswer(msg); }
// plain words the phone understands by itself (with or without the AI)
function chatLocal(t){
  const x = t.toLowerCase(), did = [];
  const has = (...w) => w.some(k => x.includes(k));
  if(!ES.aiOn && has('new version', 'different version', 'another version', 'dusra', 'navin', 'नवीन')){ ES.seed = (ES.seed*7919 + 13) % 2147483647 || 7; ES.mixNo++; did.push('a new version'); }
  if(has('faster', 'fast', 'energetic', 'energy', 'jalad', 'जलद', 'speed up', 'quick')){ if(ES.mode !== 'fast'){ EH.setModeQuiet('fast'); did.push('the Fast style'); } }
  else if(has('calm', 'slow', 'smooth', 'cinematic', 'halu', 'हळू', 'shant', 'शांत')){ if(ES.mode !== 'smooth'){ EH.setModeQuiet('smooth'); did.push('the Smooth style'); } }
  return did;
}
// the director's transitions / effects / speeds, each checked; returns how many were used and how many were corrected
function applyDirectorStyle(){
  if(!ES.aiOn || !ES.director || ES.director.key !== EH.dirKey()) return null;
  let used = 0, fixed = 0, asked = 0;
  const exact = EH.copyExact();
  ES.plan.forEach((s,i)=>{
    const d = ES.director.slots[i], len = s.end - s.start;
    if(exact && !ES.wish && !ES.chatN) return;   // copying a Reel exactly: its own transitions, effects and moves (copyShots), the AI picks the moments; what the creator asks in the chat changes them
    // The AI decides the whole Reel: the rules' own choices (styleEdit: a bounce, a shake, a hook, a speed) go, and what
    // the AI leaves out of a shot stays plain (its answer's own defaults: a hard cut, no effect, normal speed)
    // a cut the AI gave no usable answer for (or left out) keeps the phone's own choices, never a bare hard cut
    if(!d || d.auto) return;
    s.tr = 'hard'; s.efx = 'none'; s.sp = EH.SPEED.normal; s.trByDir = false; s.fxByDir = false; s.ak = []; s.acc = [];
    // The AI's transition and effect are used as it chose them, every one (no style filter, no count limit): only a tool
    // the plan does not include, or one the studio does not know, is left out (finishTransitions only shortens one to fit)
    if(d.tr){ asked++; const tr = d.tr;
      const ok = i===0 ? (tr==='hard' || tr==='fadein') : tr in TR_DUR && !EH.isLocked('tr', tr);
      if(ok){ s.tr = tr; s.trByDir = true; used++; } else fixed++;
    }
    if(d.fx){ asked++; const fx = d.fx;
      if(fx in EH.FX_NAME && !EH.isLocked('fx', fx)){ s.efx = fx; s.fxByDir = true; used++; } else fixed++;
    }
    // speed: the AI's, in any style (a velocity on a shot without a beat inside rides a ramp instead)
    if(d.sp){ asked++; const bl = ES.beats.filter(b=>b>s.start+0.15 && b<s.end-0.1).map(b=>b-s.start);
      const sp = d.sp==='velocity' ? (bl.length ? velocitySpeed(len, bl) : rampSpeed(len)) : d.sp==='ramp' ? rampSpeed(len) : d.sp==='freeze' ? EH.snapSpeed : d.sp==='hold' ? EH.holdSpeed : EH.SPEED[d.sp];
      if(sp){ s.sp = sp; used++; } else fixed++;
    }
    if(s.efx==='snap' && s.sp!==EH.snapSpeed) s.sp = EH.snapSpeed;   // the photo snap is a freeze by definition
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
      for(const k of d.keys){ if(EH.ACCENTS.includes(k.do)){ s.acc.push({at: Math.min(Math.max(0.04, k.at), Math.max(0.04, len-0.05)), do:k.do}); used++; } else fixed++; } }
  });
  EH.finishTransitions();
  return {used, fixed, asked};
}
function dirRequest(cands){
  const per = Math.max(1, ES.buf.duration/30), music = EH.cutMusic(), pc = EH.paceNow();
  const req = { mode: ES.mode, reelId: EH.reelIdNow(), ...(ES.tplKind ? { reelKind: ES.tplKind } : {}), ...(ES.chatAsk ? { chat: { n: ES.chatAsk.n, id: ES.chatAsk.id, text: ES.chatAsk.text } } : {}), wish: ES.wish.slice(-800), duration: +ES.buf.duration.toFixed(2), bpm: +(60/ES.period).toFixed(1), hook: ES.hookText.slice(0,60), story: (pc && pc.story || '').slice(0,160), reference: EH.refContext(),
    clips: ES.sources.map((s,k)=>({ alias:'c'+(k+1), summary: (s.ai && s.ai.summary) || '', mood: (s.ai && s.ai.mood) || '' })),
    recent: EH.recentTools(),
    allowed: { fx: Object.keys(EH.FX_NAME).filter(k => !EH.isLocked('fx', k)), tr: Object.keys(TR_DUR).filter(k => !EH.isLocked('tr', k)) },
    budget: ES.mode === 'copy' && ES.copyBudget ? ES.copyBudget : {whip:Math.round(2*per), spin:Math.round(per), glitch:Math.round(2*per), zoom:Math.round(3*per), iris:Math.round(3*per), dissolve:Math.round(2*per), snap:Math.round(2*per)},
    slots: ES.plan.map((s,i)=>({ i, t:+s.start.toFixed(2), len:+(s.end-s.start).toFixed(2), type:s.type, beats: ES.beats.filter(b=>b>s.start+0.1 && b<s.end-0.05).length,
      ...(music[i] ? { music: music[i] } : {}),
      candidates: cands[i].map(({si,a,...c})=>c) })).filter(x=>x.candidates.length) };
  const ctx = ES.plan.map((s,i)=>({ i, len: s.end - s.start, type: s.type, music: music[i] }));
  return { req, ctx };
}
function directorMaybe(){
  if(ES.keepSaved || EH.aiHeldBack()) return;
  if(!ES.aiOn || ES.dirBusy || !ES.edit.length || ES.recording || !EH.aiReelOk() || ES.refReading) return;
  if(!ES.sources.length || ES.sources.some(s=>!s.ai && !s.aiFailed && !s.removed)) return;   // after the AI has looked at the clips (or could not)
  if(ES.paceBusy || EH.paceWanted()) return;   // the pace first: it decides where the cuts are
  const key = EH.dirKey(); if((ES.director && ES.director.key===key && !ES.director.interim) || ES.dirFailedKey===key) return;
  if(ES.chatPending && ES.chatPending.key === key) return;   // the creator's asked-for plan waits for Generate
  if(ES.dirCache.has(key)){ if(dirArrived(key, ES.dirCache.get(key))) makeEdit(); return; }
  const st = EH.mixStore();
  if(ES.mixNo > 0 && !st.asked && st.plans[0]) EH.variantsRun(st);   // the first New mix: the AI's other mixes, in one call
  const own = st.plans[ES.mixNo];
  if(own){   // the AI's plan for this mix: as it is on the same cuts, else fitted to these (the song's part moved)
    const slots = own.sig === EH.planSig() ? own.slots : EH.refitDirector(own, true);
    if(slots){ ES.director = { key, slots, story: own.story }; ES.dirCache.set(key, ES.director); makeEdit(); return; }
  }
  if(ES.mixNo > 0 && st.plans.length){   // past the AI's mixes, or while they come: the phone's own mix in the AI's style
    if(ES.director && ES.director.key===key && ES.director.interim) return;   // waiting for the AI's mixes
    const from = st.plans.filter(Boolean), src = from[ES.mixNo % from.length], slots = EH.refitDirector(src, false);
    if(slots){ ES.director = { key, slots, story: src.story, interim: st.busy }; if(!st.busy) ES.dirCache.set(key, ES.director); makeEdit(); return; }
  }
  if(EH.planIsFinal()) return;
  EH.directorRun(key);
}
function paceMaybe(){
  if(ES.keepSaved || EH.aiHeldBack()) return;
  if(ES.paceBusy || !EH.paceWanted() || !EH.aiReelOk() || ES.refReading) return;
  const key = EH.paceKey();
  if(ES.paceCache.has(key)){ ES.pacing = ES.paceCache.get(key); makeEdit(); return; }
  const sp = ES.songPace.get(EH.paceSongKey()), p = sp && EH.paceFromSong(sp);
  if(p){ ES.pacing = { key, ...p }; ES.paceCache.set(key, ES.pacing); makeEdit(); return; }
  EH.paceRun(key);
}
// the person is known now (the phone app's sign-in reached the hidden studio): their plan, credits and Shubix AI
async function account(){ EH.planLoad(); await EH.aiCheck(); }
// The Reel is made again (a clip finished reading, the AI's plan came, a setting changed). If it was playing, it goes on
// playing from the same moment instead of stopping: Play pressed while clips are read keeps playing when they are done.
function makeEdit(){
  const was = (ES.playing || ES.starting) && !ES.recording && !ES.exportBusy && ES.kind !== 'talk', at = ES.playing ? EH.curTime() : ES.pos, gen = ES.editGen;
  EH.makeEditNow();
  if(ES.editGen !== gen) histRebase();   // Shubix's plan / a new edit is the start of Undo, not a step in it
  if(was && ES.buf && ES.edit.length && !ES.playing && !ES.starting && !ES.recording) EH.startPlayback(Math.min(Math.max(0, at), Math.max(0, ES.buf.duration - 0.2)));
}
async function showShot(i){ ES.pos = ES.edit[i].start + Math.min(0.4, (ES.edit[i].end-ES.edit[i].start)*0.5);
  await Promise.all([ES.edit[i-1]?EH.prepare(i-1,ES.edit[i-1].end-0.01):0, EH.prepare(i, ES.pos)]); EH.drawFrame(ES.pos); EH.drawTimeline(); }
function changed(i, refit){
  EH.stopAll(); const e = ES.edit[i]; e.kf = keyframesFor(e);
  if(refit){ const need = e.sp.pos(e.end-e.start)*e.scaleR, src = ES.sources[e.src];
    const clash = ES.edit.some((x,k)=>k!==i && x.src===e.src && Math.min(x.in+x.sp.pos(x.end-x.start)*x.scaleR, e.in+need)-Math.max(x.in,e.in) > 0.001);
    if(e.in + need > src.dur || clash || crossesScene(src, e.in, e.in+need)) EH.repick(i, false); }
  EH.renderEDL(true); showShot(i);
}
function shotOp(op, arg){
  if(ES.kind === 'talk' || !ES.edit.length || ES.exporting || ES.recording) return false;
  EH.stopAll();
  const i = EH.segAt(ES.pos), e = ES.edit[i], L = EH.editOf(), x = L[i];
  const done = (list, j, msg) => { if(!restoreEdit(list)) return false; j = Math.min(j, ES.edit.length - 1); ES.pos = ES.edit[j].start + 0.05; showShot(j); if(msg) EH.notify(msg); return true; };
  if(op === 'split' || op === 'dup'){
    // split: where the playhead is (on a beat when one is close); duplicate: in the middle, and the moment plays twice
    let t = op === 'dup' ? (e.start + e.end) / 2 : ES.pos;
    const nb = ES.beats.filter(b => b > e.start + EH.MIN_SHOT && b < e.end - EH.MIN_SHOT).sort((a, b) => Math.abs(a - t) - Math.abs(b - t))[0];
    if(nb != null && Math.abs(nb - t) < (op === 'dup' ? (e.end - e.start) / 4 : 0.15)) t = nb;
    if(t - e.start < EH.MIN_SHOT || e.end - t < EH.MIN_SHOT){ EH.notify(op === 'dup' ? 'This shot is too short to play twice.' : 'Move the playhead inside the shot to split it there.'); return false; }
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
    const t = Math.max(e.start, Math.min(e.end - EH.MIN_SHOT, ES.pos)), at = t - e.start, src = x.cs && x.cs.rev ? srcPos(e, at) : srcPosF(e, at);
    const nb = ES.beats.find(b => b > t + 0.45 && b < t + 1.6), hold = Math.min(e.end - t, nb ? nb - t : 1);
    if(hold < 0.25){ EH.notify('Move the playhead earlier in the shot to freeze it there.'); return false; }
    const parts = [];
    if(at >= EH.MIN_SHOT) parts.push({ ...x, end: t, uk: undefined });
    parts.push({ ...x, start: t, end: t + hold, in: src, sp: 'hold', tr: at >= EH.MIN_SHOT ? 'flash' : x.tr, efx: 'none', uk: undefined });
    if(e.end - (t + hold) >= EH.MIN_SHOT) parts.push({ ...x, start: t + hold, in: src, tr: 'hard', uk: undefined });
    else parts[parts.length - 1].end = e.end;
    L.splice(i, 1, ...parts);
    return done(L, i + (at >= EH.MIN_SHOT ? 1 : 0), 'Freeze frame added to shot ' + (i + 1) + '.');
  }
  if(op === 'delete'){
    if(L.length < 2){ EH.notify('A Reel needs at least one shot.'); return false; }
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
    const si = +arg; if(!ES.sources[si]) return false;
    if(!EH.repick(i, si === e.src, si)){ EH.notify('Every moment of that clip is already in the Reel. Pick another clip.'); return false; }
    e.kf = keyframesFor(e); EH.renderEDL(true); showShot(i); ES.editGen++;
    EH.notify('Shot ' + (i + 1) + ' now uses ' + ES.sources[si].name.replace(/\.[^.]+$/, '') + '.'); return true;
  }
  return false;
}
// move a shot's footage to another place in the Reel (drag on the timeline): the cuts stay on the beat, so each place keeps
// its time, kind and transition; the moments move along, each fitted to its new length (the clip's end is not passed)
function shotReorder(from, to){   // (not shotMove: that name is refread's camera-move reader)
  if(ES.kind === 'talk' || !ES.edit.length || ES.exporting || ES.recording) return false;
  from = Math.trunc(from); to = Math.max(0, Math.min(ES.edit.length - 1, Math.trunc(to)));
  if(from === to || !ES.edit[from]) return false;
  EH.stopAll();
  const L = EH.editOf(), KEEP = ['start', 'end', 'type', 'fx', 'tr', 'sp', 'acc', 'ak'];
  const look = L.map(x => { const c = { ...x }; KEEP.forEach(k => delete c[k]); return c; });
  const [m] = look.splice(from, 1); look.splice(to, 0, m);
  const lo = Math.min(from, to), hi = Math.max(from, to);
  for(let k = lo; k <= hi; k++){
    const slot = L[k], c = look[k], src = ES.sources[c.src]; if(!src) return false;
    const x = { ...slot, ...c, start: slot.start, end: slot.end };
    const sp = EH.speedFor(x.sp, x), need = sp.pos(x.end - x.start), room = Math.max(0.05, src.dur - TAIL);
    x.scaleR = need > room ? Math.max(0.05, room/need*0.98) : 1;
    x.in = Math.max(0, Math.min(x.in, room - need*x.scaleR));
    if(x.uk) x.uk = x.uk.filter(q => q.t < x.end - x.start);
    L[k] = x;
  }
  if(!restoreEdit(L)) return false;
  ES.pos = ES.edit[to].start + 0.05; showShot(to); EH.notify('Shot ' + (from + 1) + ' moved to place ' + (to + 1) + '.');
  return true;
}
// the current shot's clip settings: read, change (a patch; null resets them all)
function shotCs(){ const e = ES.edit.length ? ES.edit[EH.segAt(ES.pos)] : null, l = e ? ES.pos - e.start : 0, K = (e && e.cs && e.cs.kx) || [];
  return e && ES.kind !== 'talk' ? { ...EH.csOf(e, l), kx: K.length, kxHere: K.some(k => Math.abs(k.t - l) < 0.05), i: EH.segAt(ES.pos), crown: ['beauty','curve','stab'].filter(k => EH.isLocked('tool', k)) } : null; }
function shotSet(patch){
  if(!ES.edit.length || ES.kind === 'talk' || ES.exporting || ES.recording) return;
  if(patch && patch.all === true){ const { all, ...rest } = patch, at = ES.pos; for(const x of ES.edit){ ES.pos = x.start + 0.01; shotSet(rest); } ES.pos = at; if(!ES.playing) EH.redrawFrame(); return; }   // the same on every shot (e.g. a fade on each)
  const e = ES.edit[EH.segAt(ES.pos)];
  if(patch && ('kxOp' in patch || (e.cs && e.cs.kx && e.cs.kx.length))) patch = EH.kxSet(e, patch);
  e.cs = patch === null ? undefined : { ...(e.cs || {}), ...patch };
  if(e.cs && e.cs.auto){ e.cs.auto = e.cs.auto.filter(k => !(k in patch)); if(!e.cs.auto.length) delete e.cs.auto; }
  if(e.cs) for(const k of Object.keys(e.cs)) if(JSON.stringify(e.cs[k]) === JSON.stringify(EH.CS0[k])) delete e.cs[k];
  if(e.cs && e.cs.kx === null) delete e.cs.kx;
  if(e.cs && !Object.keys(e.cs).length) e.cs = undefined;
  if(patch && 'curve' in patch){ e.sp = EH.speedFor('curve', e); changed(EH.segAt(ES.pos), true); }
  if(!ES.playing) EH.redrawFrame();
}
// slip: the same shot, an earlier or later moment of its clip (the shot's place in the song stays)
function shotSlip(d){
  if(!ES.edit.length || ES.kind === 'talk') return false; EH.stopAll();
  const i = EH.segAt(ES.pos), e = ES.edit[i], need = e.sp.pos(e.end - e.start)*e.scaleR, max = Math.max(0, ES.sources[e.src].dur - need - TAIL);
  const v = Math.max(0, Math.min(max, e.in + d)); if(Math.abs(v - e.in) < 1e-3){ EH.notify(d < 0 ? 'This is the start of the clip.' : 'This is the end of the clip.'); return false; }
  e.in = v; e.cam = null; e.kf = keyframesFor(e); EH.renderEDL(true); showShot(i); ES.editGen++; return true;
}
// trim: the shot's end moves one beat (the next shot starts there), so the cuts stay on the beat
function shotTrim(dir){
  if(!ES.edit.length || ES.kind === 'talk') return false; EH.stopAll();
  const i = EH.segAt(ES.pos), e = ES.edit[i], nx = ES.edit[i+1];
  if(!nx){ EH.notify('The last shot ends with the song.'); return false; }
  const grid = ES.beats.length ? ES.beats : [];
  const to = dir > 0 ? grid.find(b => b > e.end + 0.05 && b < nx.end - EH.MIN_SHOT) : [...grid].reverse().find(b => b < e.end - 0.05 && b > e.start + EH.MIN_SHOT);
  if(to == null){ EH.notify(dir > 0 ? 'The next shot is too short to give a beat.' : 'This shot is already as short as it can be.'); return false; }
  const L = EH.editOf(), d = to - L[i+1].start; L[i].end = to; L[i+1].start = to;
  if(L[i+1].uk) L[i+1].uk = L[i+1].uk.map(k => ({ ...k, t: k.t - d })).filter(k => k.t >= 0);
  if(!restoreEdit(L)) return false; changed(i, true); changed(i+1, true); ES.pos = ES.edit[i].start + 0.05; showShot(i); return true;
}
// ripple (dragging a shot's end on the timeline): shot i ends at `to` (on the nearest beat when one is close), every
// later shot moves with it, and the last shot still ends with the song (it gives or takes the difference)
// a shot's left edge dragged (VN's trim from the start): the cut between it and the shot before moves to `to`; the shot
// before gets longer or shorter, this one starts later or earlier in its clip and still ends where it did (the rest stays)
function shotRoll(i, to){
  if(!ES.edit.length || ES.kind === 'talk' || ES.exporting || ES.recording || !ES.edit[i] || i < 1) return false;
  const a = ES.edit[i-1], e = ES.edit[i];
  const nb = ES.beats.reduce((b, x) => Math.abs(x - to) < Math.abs(b - to) ? x : b, Infinity);
  if(Math.abs(nb - to) < 0.12) to = nb;
  to = Math.max(a.start + EH.MIN_SHOT, Math.min(e.end - EH.MIN_SHOT, to));
  const d = to - e.start; if(Math.abs(d) < 0.01) return false;
  EH.stopAll();
  const L = EH.editOf(), x = L[i], rate = (e.sp && e.sp.at ? e.sp.at(0) : 1)*(e.scaleR || 1);
  let inn = d > 0 ? srcPosF(e, d) : e.in + d*rate;
  if(inn < 0){ to -= inn/rate; inn = 0; if(to - e.start > -0.01){ EH.notify('This is the start of the clip.'); return false; } }
  const dd = to - e.start;
  L[i-1].end = to; x.start = to; x.in = inn;
  if(x.uk) x.uk = x.uk.map(q => ({ ...q, t: q.t - dd })).filter(q => q.t >= 0);
  if(!restoreEdit(L)) return false;
  changed(i - 1, true); changed(i, true);
  ES.pos = ES.edit[i].start + 0.05; showShot(i); return true;
}
function shotRipple(i, to){
  if(!ES.edit.length || ES.kind === 'talk' || ES.exporting || ES.recording || !ES.edit[i]) return false;
  const D = ES.buf.duration, e = ES.edit[i];
  if(i === ES.edit.length - 1){ EH.notify('The last shot ends with the song.'); return false; }
  const nb = ES.beats.reduce((b, x) => Math.abs(x - to) < Math.abs(b - to) ? x : b, Infinity);
  if(Math.abs(nb - to) < 0.12) to = nb;
  to = Math.max(e.start + EH.MIN_SHOT, Math.min(D - EH.MIN_SHOT, to));
  const d = to - e.end; if(Math.abs(d) < 0.01) return false;
  EH.stopAll();
  const L = EH.editOf(); L[i].end = to;
  for(let k = i + 1; k < L.length; k++){ L[k].start += d; L[k].end += d; }
  const out = L.filter(x => x.start < D - EH.MIN_SHOT); out[out.length - 1].end = D;   // shots pushed past the song's end go
  if(!restoreEdit(out)) return false;
  changed(i, true); if(ES.edit.length - 1 !== i) changed(ES.edit.length - 1, true);
  ES.pos = ES.edit[i].start + 0.05; showShot(i);
  EH.notify('Shot ' + (i + 1) + ' is ' + (to - ES.edit[i].start).toFixed(1) + ' s · the shots after it moved' + (d > 0 ? ' later.' : ' earlier.'));
  return true;
}
function histTick(){
  if(ES.restoring || ES.exporting || ES.recording || ES.pending || ES.playing) return;
  const base = EH.histBase();
  if(base !== EH.hist.base){ EH.hist.base = base; EH.hist.u = []; EH.hist.r = []; EH.hist.cur = ES.edit.length || ES.overlays.length ? EH.histSnap() : null; EH.hist.cand = ''; EH.histUI(); return; }
  if(!ES.edit.length && !ES.overlays.length && !ES.layers.length) return;
  const now = EH.histSnap(); if(!EH.hist.cur){ EH.hist.cur = now; return; }
  if(now.sig === EH.hist.cur.sig){ EH.hist.cand = ''; return; }
  if(now.sig !== EH.hist.cand){ EH.hist.cand = now.sig; return; }   // kept once it stops changing (a drag is one step)
  EH.hist.u.push(EH.hist.cur); if(EH.hist.u.length > EH.HIST_MAX) EH.hist.u.shift(); EH.hist.r = []; EH.hist.cur = now; EH.hist.cand = ''; EH.histUI();
}
// a made (or re-made) edit: Undo / Redo hold only what the creator changes from here (the timeline, the tools, the texts)
function histRebase(){ EH.hist.u = []; EH.hist.r = []; EH.hist.cur = ES.edit.length || ES.overlays.length ? EH.histSnap() : null; EH.hist.cand = ''; EH.histUI(); }
function histGo(back){
  if(ES.exporting || ES.recording || ES.restoring) return;
  const now = EH.histSnap(); if(EH.hist.cur && now.sig !== EH.hist.cur.sig){ EH.hist.u.push(EH.hist.cur); EH.hist.r = []; EH.hist.cur = now; }
  const from = back ? EH.hist.u : EH.hist.r, to = back ? EH.hist.r : EH.hist.u; if(!from.length || !EH.hist.cur) return;
  to.push(EH.hist.cur); const s = from.pop(); EH.hist.cand = '';
  if(ES.kind !== 'talk' && s.ed.length) restoreEdit(s.ed);
  ES.overlays = s.ov.map(o => ({ ...o })); ES.ovSel = -1; EH.renderOvList();
  if(s.ly){ ES.layers = s.ly.map(L => ({ ...L })); ES.lySel = Math.min(ES.lySel, ES.layers.length - 1); EH.lyUI(); ES.clipMixKey = ''; }
  if(ES.edit.length) showShot(Math.min(EH.segAt(ES.pos), ES.edit.length - 1)); else EH.redrawFrame();
  EH.hist.cur = EH.histSnap(); EH.histUI(); EH.notify(back ? 'Undone' : 'Redone');
}
// a pop-up's changes are tried live; its ✕ puts the Reel back as it was when it opened (views.ts)
function snapRestore(s){
  if(!s || ES.exporting || ES.recording || ES.restoring) return false;
  if(ES.kind !== 'talk' && s.ed.length) restoreEdit(s.ed);
  ES.overlays = s.ov.map(o => ({ ...o })); ES.ovSel = -1; EH.renderOvList();
  if(s.ly){ ES.layers = s.ly.map(L => ({ ...L })); ES.lySel = Math.min(ES.lySel, ES.layers.length - 1); EH.lyUI(); ES.clipMixKey = ''; }
  if(ES.edit.length) showShot(Math.min(EH.segAt(ES.pos), ES.edit.length - 1)); else EH.redrawFrame();
  return true;
}
function remixNow(){
  if(!ES.buf || !ES.sources.length || !ES.edit.length || ES.exporting || ES.recording) return false;
  EH.remakeOk(); ES.seed = (ES.seed*7919 + 13) % 2147483647 || 7; ES.mixNo++; makeEdit();
  return true;
}
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
function lazyPlayer(url){ const v = EH.makeVideo(''); v._url = url; return v; }
async function layerAdd(files){
  if(!ES.edit.length){ EH.notify('Make the Reel first, then add videos or photos on top.'); return; }
  for(const f of files){
    let M; try{ M = await EH.addLayerMedia(f); }catch(err){ EH.notify(String(err.message || err), 'err'); continue; }
    ES.lmedia.push(M); const D = ES.buf.duration, t0 = Math.min(ES.pos, Math.max(0, D - 1)), len = M.kind === 'video' ? Math.min(M.dur, D - t0) : Math.min(3, D - t0);
    ES.layers.push({ id: ++ES.lySeq, m: ES.lmedia.length - 1, t0, t1: t0 + Math.max(0.5, len), in: 0, ...JSON.parse(JSON.stringify(EH.LY0)), x: 0.68, y: 0.3, s: 0.45 });
    ES.lySel = ES.layers.length - 1;
  }
  EH.lyUI(); await EH.prepLayers(ES.pos); EH.redrawFrame();
}
function layoutLayer(L, k){
  const M = ES.lmedia[L.m], W = EH.out.width, H = EH.out.height, ar = M ? M.w/M.h : 1; L.r = 0;
  const P = EH.LAYOUTS[k]; if(typeof P === 'object'){ Object.assign(L, P); L.crop = {l:0,t:0,r:0,b:0}; return; }
  // a half or the whole frame: cropped to fill it exactly
  const box = k === 'full' ? [0.5, 0.5, 1, 1] : k === 'top' ? [0.5, 0.25, 1, 0.5] : k === 'bottom' ? [0.5, 0.75, 1, 0.5] : k === 'left' ? [0.25, 0.5, 0.5, 1] : [0.75, 0.5, 0.5, 1];
  const want = box[2]*W/(box[3]*H);   // the box's own shape
  L.crop = {l:0,t:0,r:0,b:0}; if(ar > want){ const cut = (1 - want/ar)/2; L.crop.l = L.crop.r = cut; } else { const cut = (1 - ar/want)/2; L.crop.t = L.crop.b = cut; }
  L.x = box[0]; L.y = box[1]; L.s = box[2];
}
function lySelect(i){
  if(!Number.isInteger(i) || !ES.layers[i]) return false;
  ES.lySel = i; EH.lyUI(); ES.pos = Math.max(ES.pos, ES.layers[i].t0);
  if(!EH.lyOn(ES.layers[i], ES.pos)) ES.pos = ES.layers[i].t0 + 0.05;
  return EH.prepare(EH.segAt(ES.pos), ES.pos).then(() => EH.prepLayers(ES.pos)).then(EH.redrawFrame).then(() => true);
}
function lyDelete(){
  if(!ES.layers[ES.lySel]) return false;
  ES.layers.splice(ES.lySel, 1); ES.lySel = Math.min(ES.lySel, ES.layers.length - 1); ES.clipMixKey = ''; EH.lyUI(); EH.redrawFrame(); return true;
}
function lySet(k, v){ const L = ES.layers[ES.lySel]; if(!L) return;
  if(k.includes('.')){ const [a, b] = k.split('.'); L[a] = { ...L[a], [b]: v }; } else L[k] = v;
  if(k === 'vol') ES.clipMixKey = '';
  if(!ES.playing) EH.redrawFrame(); }
// the hook: one word per beat from the start (first word at once), each pops in; the hook stays until a little after its
// last word and pulses on the beats while it is up
function drawHook(t){
  if(!ES.hookText) return;
  const W=EH.out.width, H=EH.out.height, words = ES.hookText.split(/\s+/).filter(Boolean).slice(0, 8);
  const bt = ES.beats.filter(b=>b > 0.15).slice(0, words.length);
  const at = words.map((w,k)=> k === 0 ? 0.05 : (bt[k-1] ?? (0.05 + 0.35*k)));
  const T = Math.max(2.2, at[at.length-1] + 1.1); if(t > T && !ES.coverMode) return;
  const outP = ES.coverMode ? 0 : Math.max(0, (t-(T-0.25))/0.25);
  const fs = Math.round(Math.min(W,H*0.5625)*(ES.textStyle === 'clean' ? 0.075 : 0.1)), cy = H*(H>W ? 0.27 : 0.3);
  const L = EH.layoutWords(EH.og, words.map((w,k)=>({t:w, at:at[k]})), fs, W*0.8, cy, fs*1.12);
  const pulse = ES.beats.reduce((q,b)=> t >= b && t-b < 0.2 ? Math.max(q, 1 - (t-b)/0.2) : q, 0);
  L.forEach(w=>{ const since = ES.coverMode ? 9 : t - w.at; if(since < 0) return;
    const pin = Math.min(1, since/0.18), sc = (ES.textStyle === 'clean' ? 1 : 0.65 + 0.35*EH.EASE.outBack(pin)) * (1 + 0.04*pulse), a = Math.min(1, since/0.08)*(1-outP);
    const cur = !ES.coverMode && since < 0.45; EH.drawWord(EH.og, w, fs, ES.textStyle, ES.textStyle === 'karaoke' ? 2 : (cur ? 1 : 2), a, sc); });
}
// lines of the song's words: a new line at a pause, after 4 words, or when it gets long
// where a face is on the screen at t (fraction of the height), if the shot follows one
function facePosOnScreen(t){
  if(!ES.edit.length) return null;
  const e = ES.edit[EH.segAt(t)], src = ES.sources[e.src]; if(!src || !src.faces?.length) return null;
  const local = Math.max(0, t - e.start), st = srcPos(e, local), near = src.faces.filter(f=>f.n && Math.abs(f.t - st) < 0.6);
  if(!near.length) return null;
  const f = near.reduce((q,x)=>Math.abs(x.t-st) < Math.abs(q.t-st) ? x : q, near[0]);
  const W=EH.out.width, H=EH.out.height, r = Math.max(W/src.w, H/src.h), dw=src.w*r, dh=src.h*r, [ccx, ccy] = EH.camAt(e, local);
  return { x: Math.max(0, Math.min(1, 0.5 + (f.fx-ccx)*dw/W)), y: Math.max(0, Math.min(1, 0.5 + (f.fy-ccy)*dh/H)) };
}
function faceYOnScreen(t){ const face = facePosOnScreen(t); return face ? face.y : null; }
function drawCaptions(t){
  if(!ES.capsOn || !ES.capLines) return;
  const line = ES.capLines.find(l => t >= l.a && t < l.b); if(!line) return;
  const W=EH.out.width, H=EH.out.height, fs = Math.round(Math.min(W,H*0.5625)*(ES.textStyle === 'clean' ? 0.06 : 0.072));
  const hookUp = ES.hookText && t < 2.6, fy = faceYOnScreen(t);
  let cy = H*(H>W ? 0.70 : 0.78);                                                  // above Instagram's caption / username
  if(fy !== null && fy > 0.52 && fy < 0.86 && !hookUp) cy = H*(H>W ? 0.36 : 0.3);  // a face is there: move up
  const lineIn = Math.min(1, (t - line.a)/0.12), lineOut = Math.max(0, (t - (line.b - 0.15))/0.15), la = lineIn*(1-lineOut);
  const tr = EH.trOf(line);
  if(tr && ES.trOnly){   // only the translation: the whole line, as one block
    const TL = EH.layoutWords(EH.og, tr.split(/\s+/).filter(Boolean).map(x => ({t: x})), fs, W*0.8, cy, fs*1.25);
    TL.forEach(w => EH.drawWord(EH.og, w, fs, ES.textStyle === 'karaoke' ? 'pop' : ES.textStyle, 2, la, 1)); return;
  }
  const L = EH.layoutWords(EH.og, line.words.map(w=>({t: w.key && w.emoji ? w.text + ' ' + w.emoji : w.text, s:w.start, e:w.end, key: w.key})), fs, W*0.78, cy, fs*1.25);
  if(tr){   // both: the translation under the line, smaller and calm
    const fs2 = Math.round(fs*0.74), y0 = Math.max(...L.map(w => w.y)) + fs*0.62 + fs2*0.62, TL = EH.layoutWords(EH.og, tr.split(/\s+/).filter(Boolean).map(x => ({t: x})), fs2, W*0.84, 0, fs2*1.2);
    const top = Math.min(...TL.map(w => w.y)); TL.forEach(w => EH.drawWord(EH.og, { ...w, y: w.y - top + y0 }, fs2, 'clean', 2, la, 1));
  }
  L.forEach(w=>{
    const sung = t >= w.s, cur = sung && t < Math.max(w.e, w.s + 0.12), state = w.key && sung ? 1 : cur ? 1 : sung ? 2 : 0;
    let a = la, sc = w.key && sung ? 1.16 : 1;
    if(ES.textStyle === 'pop'){ if(!sung) return; const since = t - w.s; a *= Math.min(1, since/0.06); sc = 0.7 + 0.3*EH.EASE.outBack(Math.min(1, since/0.16)); }
    else if(ES.textStyle === 'karaoke' && cur) sc = 1.08;
    EH.drawWord(EH.og, w, fs, ES.textStyle, state, a, sc);
  });
}
function drawText(t){ drawHook(t); drawCaptions(t); drawOverlays(t); if((ES.exporting || ES.recording) && !ES.wmOff) EH.drawWatermark(); }
// the AI's whole answer for this Reel: the cuts are in `director`; its texts and other steps are put on here
async function aiApply(d){ if(!d) return; ES.layers = ES.layers.filter(L => L.aiIntent !== 'ai' || !(d.actions || []).some(a => a.do === 'layer')); EH.aiTexts(d.texts);
  // the AI's own shot steps (split, freeze, delete...) change the plan, so its key: the plan stays the AI's (else the
  // Reel counted as waiting for Shubix for ever: the phone stopped at 70%, and the house taste cut the AI's choices back)
  const k0 = EH.dirKey(), mine = !!ES.director && ES.director.key === k0;
  await EH.aiActions(d.actions);
  const k1 = EH.dirKey(); if(mine && k1 !== k0){ ES.director = { ...ES.director, key: k1 }; ES.dirCache.set(k1, ES.director); } }
function drawOverlays(t){ for(const ov of ES.overlays) if(!ov.behind || !EH.personMask || !ES.bgMask) EH.drawOverlay(EH.og, ov, t); }
function kfNow(){ return Math.max(0, ES.playing ? EH.curTime() : ES.pos || 0); }
function kfTarget(){
  if(!ES.edit.length) return null;
  if(ES.ovSel >= 0 && ES.overlays[ES.ovSel]){ const ov = ES.overlays[ES.ovSel], [a, b] = EH.ovTiming(ov);
    return { what: 'text', obj: ov, a, b: Math.max(a + 0.05, b), name: ov.emoji ? 'Sticker ' + ov.text : 'Text “' + (ov.text.length > 22 ? ov.text.slice(0, 21) + '…' : ov.text) + '”' }; }
  const i = EH.segAt(kfNow()), e = ES.edit[i];
  return { what: 'shot', obj: e, i, a: e.start, b: e.end, name: 'Shot ' + (i + 1) + ' · ' + ES.sources[e.src].name.replace(/\.[^.]+$/, '') };
}
function kfLocal(T){ return Math.max(0, Math.min(T.b - T.a - 0.01, kfNow() - T.a)); }
function kfAtHead(T){ const l = kfLocal(T); return (T.obj.uk || []).find(q => Math.abs(q.t - l) < EH.KF_NEAR) || null; }
function kfSeek(t){
  if(ES.playing){ EH.stopAll(); }
  ES.pos = Math.max(0, Math.min(ES.buf.duration - 0.01, t)); const i = EH.segAt(ES.pos); EH.kfSync();   // the panel follows at once, the picture once decoded
  return Promise.all([ES.edit[i-1] ? EH.prepare(i-1, ES.edit[i-1].end - 0.01) : 0, EH.prepare(i, ES.pos)]).then(() => { EH.drawFrame(ES.pos); EH.drawTimeline(); EH.kfSync(); });
}
// write values at the playhead: change the keyframe there, or add one holding the in-between values
function kfSet(vals){
  const T = kfTarget(); if(!T) return;
  if(ES.playing){ ES.pos = EH.curTime(); EH.stopAll(); }
  const L = T.obj.uk || (T.obj.uk = []), l = kfLocal(T);
  let k = kfAtHead(T);
  if(!k){ const u = EH.uAt(L, l) || EH.UK0; k = { x: u.x, y: u.y, s: u.s, r: u.r, o: u.o, t: l, ez: 'inOut' }; L.push(k); L.sort((p, q) => p.t - q.t); }
  for(const [n, v] of Object.entries(vals)){ const c = EH.KF_SL[n]; k[n] = Math.max(c.min, Math.min(c.max, v)); }
  EH.redraw(); EH.kfSync(); EH.kfListSoon();
}
function segRegion(){ const W = EH.out.width, H = EH.out.height, k = 256/Math.max(W, H); return [W*k, H*k, (256 - W*k)/2, (256 - H*k)/2]; }
async function maskNow(){   // export: this frame's own mask
  if(!EH.personMask || ES.bgErr) return;
  try{ EH.setMask(await EH.personMask(EH.segInput())); }catch(err){ ES.bgErr = String(err && err.message || err); EH.bgStat(); }
}
function maskSoon(t){   // preview: ask for the next one, use it when it comes (paused: once per frame, then drawn again)
  const key = ES.playing ? -1 : Math.round(t*1000);
  if(!EH.personMask || ES.bgBusy || ES.bgErr || (key >= 0 && key === ES.bgFrame)) return;
  ES.bgBusy = true; const data = EH.segInput();
  EH.personMask(data).then(m => { EH.setMask(m); ES.bgBusy = false; ES.bgFrame = key; if(!ES.playing && key >= 0) EH.redrawFrame(); }, err => { ES.bgBusy = false; ES.bgErr = String(err && err.message || err); EH.bgStat(); });
}
// The words are transcribed once for the whole song (up to 3 minutes, from where the part starts if it starts later)
// and the part's words are taken from them: changing the part costs nothing and the words keep their sung timing.
function shiftCaptions(){
  if(!ES.capAll) return;
  const a = (ES.vo && ES.kind !== 'talk') ? 0 : ES.secStart - ES.capAll.from, L = ES.buf.duration;
  ES.capWords = ES.capAll.words.filter(w => w.end > a + 0.05 && w.start < a + L - 0.05).map(w => ({ ...w, start: Math.max(0, w.start - a), end: Math.min(L, w.end - a) }));
  ES.capLines = buildCapLines(ES.capWords); EH.markKeyWords(ES.capLines); EH.redraw(); if(ES.trTo) EH.translateSoon();
}
// the picture's size on the display (turned a quarter: width and height swap) and its scale (fill or fit)
function csGeom(e, scale, l){
  const W=EH.out.width, H=EH.out.height, c = EH.csOf(e, l), odd = (c.rot/90)&1, s0 = ES.sources[e.src];
  const sw = odd ? s0.h : s0.w, sh = odd ? s0.w : s0.h, r = (c.fit ? Math.min(W/sw, H/sh) : Math.max(W/sw, H/sh))*scale*(c.zoom || 1);
  return { c, odd, sw, sh, dw: sw*r, dh: sh*r };
}
function layerOf(e, local, o={}){
  const W=EH.out.width, H=EH.out.height, K=e.kf||{};
  let scale = (EH.kf(K.scale,local) ?? 1)*(o.scale||1)*(o.noFx ? 1 : EH.emphAt(e.start + local));
  let x = (EH.kf(K.x,local) ?? 0)*W + (o.dx||0), y = o.dy||0, rot = (EH.kf(K.rot,local) ?? 0) + (o.rot||0);
  const sh = EH.kf(K.shake,local) || 0;
  if(sh){ x += Math.sin(local*38)*0.007*W*sh; y += Math.cos(local*29)*0.005*H*sh; rot += Math.sin(local*23)*0.45*sh; }   // a light shake (stronger read as the video vibrating)
  let expo = o.noFx ? 0 : (EH.kf(K.expo,local) || 0);
  if(K.bounce && e.beatsIn){ const bp = EH.beatPulse(e, local); scale *= bp.s; if(!o.noFx) expo += bp.ex; }
  const ac = o.noFx ? null : EH.accentAt(e, local);
  if(ac){ scale *= ac.s; expo += ac.ex; if(ac.sh){ x += Math.sin(local*38)*0.01*W*ac.sh; y += Math.cos(local*29)*0.008*H*ac.sh; rot += Math.sin(local*23)*0.7*ac.sh; } }
  const am = EH.uAt(e.ak, local);   // the AI director's camera keyframes
  if(am){ scale *= am.s; rot += am.r; x += am.x*W; y += am.y*H; }
  const u = EH.uAt(e.uk, local);
  if(u){ scale *= u.s; rot += u.r; }
  const cs0 = EH.csOf(e, local); let stab = null;
  if(cs0.stab > 0 && !o.noStab){ stab = EH.stabAt(ES.sources[e.src], srcPos(e, local)); scale *= 1 + 0.12*cs0.stab; }
  const G = csGeom(e, scale, local), c = G.c, dw = G.dw, dh = G.dh, [ccx, ccy] = EH.csCam(e, local, c);
  if(stab){ x += stab[0]*dw*cs0.stab; y += stab[1]*dh*cs0.stab; }
  let px = W/2 - ccx*dw; px = panClamp(px, W, dw) + x;
  let py = H/2 - ccy*dh; py = panClamp(py, H, dh) + y;
  const rb = Math.max(W/G.sw, H/G.sh)*1.12, fade = EH.csFade(c, local, e.end - e.start);
  let zb = o.noFx ? 0 : (EH.kf(K.zblur,local) || 0);
  if(!o.noFx && EH.rateAt(e, local) >= 1.8) zb += 0.35;   // motion blur when the shot runs fast
  const br = EH.kf(K.bright,local);
  const still = (e.flick && ES.flickPool.length) || e.black;   // a flicker's still / the black end: filling the frame
  return { el:EH.texOf(e, local), rect: still ? [0,0,W,H] : [px,py,dw,dh], rot: still ? 0 : rot*Math.PI/180, zb: zb + (o.zb||0), db: o.db || [0,0], rgb: (o.noFx ? 0 : (EH.kf(K.rgb,local)||0)) + (o.rgb||0) + (ac ? ac.rgb : 0),
    expo, bright: (br===undefined ? 1 : br) * (e.type==='break' ? 0.88 : 1) * fade, alpha: (o.alpha ?? 1) * (u ? Math.max(0, Math.min(1, u.o)) : 1),
    off: u ? [u.x*W, u.y*H] : [0,0], clip: u ? 1 : 0, uo: u ? Math.max(0, Math.min(1, u.o)) : 1,
    tf: EH.csMat(c), bg: !c.fit ? [0,0,0,-1] : c.bg === 'blur' ? [0,0,0,1] : [...EH.hexRgb(c.bgc), EH.CANVAS_PATS.includes(c.bg) ? 2 + EH.CANVAS_PATS.indexOf(c.bg) : 0], bgr: [W/2 - G.sw*rb/2, H/2 - G.sh*rb/2, G.sw*rb, G.sh*rb],
    bd: c.fit && c.bd > 0 ? [...EH.hexRgb(c.bdc), c.bd*0.04*W] : [0,0,0,0], ad: [c.bri, c.con, c.sat, c.warm], ad2: [c.hi || 0, c.sh || 0, c.hue || 0, (c.sharp || 0) + EH.upSharp(e, dh)], be: c.beauty || 0 };
}
async function shotReverse(){
  if(!ES.edit.length || ES.kind === 'talk') return false; EH.stopAll();
  const i = EH.segAt(ES.pos), e = ES.edit[i];
  if(e.cs && e.cs.rev){ shotSet({ rev: false }); if(e.rc){ e.rc.frames.forEach(f => f && f.close && f.close()); e.rc = null; } EH.prepare(i, ES.pos).then(EH.redrawFrame); return true; }
  if(e.sp.pos(e.end - e.start)*e.scaleR > EH.REV_MAX){ EH.notify('This shot is too long to reverse (up to ' + EH.REV_MAX + ' s of clip).'); return false; }
  shotSet({ rev: true }); EH.tasks.start('rev', 'clips', 'Reversing the shot', 'Shot ' + (i + 1));
  try{ await EH.revCache(e); EH.tasks.done('rev', 'Shot ' + (i + 1) + ' plays backwards'); }
  catch(err){ console.warn('reverse', err); EH.tasks.fail('rev', 'Could not read this clip backwards. The paused frame still shows it.'); }
  await EH.prepare(i, ES.pos); EH.redrawFrame(); return true;
}
// mosaic and magnifier of the shot on screen: pixels (shared by both renderers)
function lensOf(e){ const c = EH.csOf(e), W = EH.out.width, H = EH.out.height;
  return { mz: c.mz ? [c.mz.x*W, c.mz.y*H, c.mz.w*W, c.mz.h*H] : [0,0,0,0], mzc: c.mz ? Math.max(3, (c.mz.s || 0.035)*W) : 1,
    mg: c.mg ? [c.mg.x*W, c.mg.y*H, c.mg.r*W, Math.max(1.1, c.mg.z || 2)] : [0,0,0,1] }; }
function shapeAt(e, local, B){
  const k = EH.SHAPE_K[e.efx]; if(!k) return null;
  const W = EH.out.width, H = EH.out.height, bts = shotBeats(e), past = bts.filter(b => local >= b), n = past.length, since = n ? local - past[n-1] : local;
  const step = (levels) => { const a = levels[Math.min(n, levels.length - 1)], b0 = n ? levels[Math.min(n - 1, levels.length - 1)] : a*0.7, q = Math.min(1, since/0.16); return b0 + (a - b0)*EH.EASE.outBack(q); };
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
  if(k === 1 || (k >= 4 && k <= 6)){ const [px,py,dw,dh] = B.rect, [ax, ay] = EH.camAt(e, local), off = B.off || [0,0];
    const sx = px + ax*dw + off[0], sy = py + ay*dh + off[1], m = k === 1 ? lv*0.5 : 0.25;
    cx = Math.min(W*(1 - m), Math.max(W*m, sx)); cy = Math.min(H*(1 - m), Math.max(H*m, sy)); }
  return { a: [k, lv, cx, cy], b: [cells, 0, 0, 0] };
}
function exportSound(){
  if(!ES.noSong) return { buf: ES.buf, gain: ES.normGain };
  const c = EH.getCtx();
  const one = (x, sr, g) => { const b = c.createBuffer(2, x.length, sr); for(let k=0;k<2;k++){ const d = b.getChannelData(k); for(let i=0;i<x.length;i++) d[i] = x[i]*g; } return { buf: b, gain: 1 }; };
  if(ES.kind === 'talk' && ES.talk) return one(ES.talk.voice, ES.talk.sr, 1);
  if(ES.vo){ let s2 = 0, n = 0; for(let i=0;i<ES.vo.pcm.length;i+=4){ const x = ES.vo.pcm[i]; if(Math.abs(x) > 0.01){ s2 += x*x; n++; } } return one(ES.vo.pcm, ES.vo.sr, 0.2/Math.max(0.003, Math.sqrt(s2/Math.max(1, n)))); }
  return null;
}
async function autoExport(cloud = false){
  if(ES.exportBusy) return null; ES.exportKeep = true; ES.exportP = 0; ES.lastVideo = null;
  // cloud: also kept in My Reels, as the website's Export sheet does (when the account has room and the switch is on)
  try{ await EH.runExport(!!cloud && !!ES.cloudInfo && ES.cloudInfo.used < ES.cloudInfo.limit && EH.xq.my); } finally { ES.exportKeep = false; }
  return ES.lastVideo;
}
// around one cut: brightness, blur direction, the sideways jump and the scale change from one frame to the next
function cutFramesOf(canvases){
  const out = canvases.map((c,i)=>c ? {k: i-EH.CUT_K, ...EH.greyOf(c)} : null).filter(Boolean);
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
  const a = EH.greyOf(ca), b = EH.greyOf(cb), A = a.Y, B = b.Y, FW = a.FW, FH = a.FH; let best = Infinity, zoom = 1;
  if(Math.abs(a.mean - b.mean) > 0.08) return 1;   // the light changed (a fade, a flash): not a zoom to judge
  for(let sc=0.85; sc<=1.25; sc+=0.02) for(let dx=-6; dx<=6; dx+=2) for(let dy=-6; dy<=6; dy+=2){ let s2=0, n=0;
    for(let y=FH*0.25;y<FH*0.75;y+=2) for(let x=FW*0.25;x<FW*0.75;x+=2){ const sx=Math.round(FW/2+(x-FW/2)/sc)+dx, sy=Math.round(FH/2+(y-FH/2)/sc)+dy; if(sx<0||sy<0||sx>=FW||sy>=FH) continue; s2+=Math.abs(B[Math.round(y)*FW+Math.round(x)]-A[sy*FW+sx]); n++; }
    if(n && s2/n < best){ best = s2/n; zoom = sc; } }
  return zoom;
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
      const g = EH.greyOf(c), H = new Float32Array(16); for(let q=0;q<g.Y.length;q++) H[Math.min(15, (g.Y[q]*16)|0)] += 1/g.Y.length;
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
async function renderedLook(){
  if(!ES.edit.length) return null;
  const sv = ES.showSafe, h = ES.hookText, res = []; ES.showSafe = false; ES.hookText = '';
  try{
    for(const f of [0.06, 0.15, 0.24, 0.33, 0.42, 0.51, 0.6, 0.69, 0.78, 0.87, 0.95]){
      const e = ES.edit[Math.min(ES.edit.length-1, Math.floor(f*ES.edit.length))], L = e.end - e.start, t = e.start + Math.min(L - 0.03, Math.max(0.75, 0.9*L));   // after the shot's own flash / leak
      await EH.prepare(EH.segAt(t), t); EH.drawFrame(t); res.push(EH.lookOfImage(EH.out, EH.out.width, EH.out.height));
    }
  } finally { ES.showSafe = sv; ES.hookText = h; }
  return EH.avgLook(res);
}
async function copyLook(){
  const R = ES.refProfile; if(!R || !R.look || ES.copyLookBusy || ES.look !== 'copy') return;
  const T = R.look, cl = (x,a,b)=>Math.min(b, Math.max(a, x)), mono = T.sat < 0.05 ? 1 : 0;
  const key = R.name + '|' + R.dur + '|' + ES.sources.map(EH.fpOf).join(';') + '|' + ES.aspect;
  if(key === ES.copyLookKey && EH.GRADES.copy) return;
  const G = { con:1, sat:1, bri:1, warm:0, teal:0, mono, lift:0, vig:0, grain:0 };
  EH.GRADES.copy = { ...G };
  if(!ES.edit.length || !ES.buf || ES.playing || ES.recording) return;
  ES.copyLookBusy = true;
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
      EH.GRADES.copy = { ...G };
    }
    ES.copyLookKey = key;
    // how close the look came: brightness, contrast, colour and warmth, each within 0.15 of the reference = 100%
    { const O = await renderedLook(); if(O) ES.copyLookScore = ['mean','std','sat','warm'].reduce((q,k)=>q + Math.max(0, 1 - Math.abs((O[k]||0) - (T[k]||0))/0.15), 0)/4; EH.showCopyMatch(); }
  } finally { ES.copyLookBusy = false; }
  EH.LOOKS.copy = { name: 'Copied', filter: 'contrast(' + G.con.toFixed(2) + ') saturate(' + (mono ? 0 : G.sat).toFixed(2) + ') brightness(' + G.bri.toFixed(2) + ')', grain: G.grain };
  if(!ES.playing && !ES.recording) EH.captureLoop();
}
async function ttsMake(c, quiet){
  if(c.pcm || !EH.tts) return; const id = 'tts' + c.id;
  if(!quiet) EH.tasks.start(id, 'voice', 'Making the voice', '"' + c.text.slice(0, 40) + (c.text.length > 40 ? '…' : '') + '"');
  try{ const r = await EH.tts.speak(c.text, c.voice, (pr) => { if(!quiet) EH.tasks.update(id, pr.p, 'Speaking'); });
    c.pcm = r.pcm; c.sr = r.sr; if(!quiet) EH.tasks.done(id, 'Voice ready'); }
  catch(err){ console.warn('tts', err); if(!quiet) EH.tasks.fail(id, 'Could not make the voice. Add this language in the phone\'s Settings, under Text-to-speech, and try again.'); throw err; }
}
function clearTts(){
  if(!ES.ttsClips.length) return false;
  ES.ttsClips = []; EH.ttsList(); applyVo(); ES.clipMixKey = ''; if(!ES.playing) EH.redrawFrame(); EH.saveNow(); return true;
}
// the mix is made again only when something in it changed (called before playing and exporting)
async function ensureMix(){
  if(ES.kind === 'talk' || !ES.baseBuf) return;
  const shots = EH.clipVoiced() ? ES.edit.filter(e => EH.csVoiced(e)) : [];
  for(const e of shots) await EH.clipPcm(e.src);
  for(const c of ES.ttsClips) if(!c.pcm) try{ await ttsMake(c, false); }catch(e){}
  for(const L of ES.layers){ const M = ES.lmedia[L.m]; if(L.vol > 0 && M && M.kind === 'video' && M.pcm === undefined){ try{ const b = await EH.decodeAnyAudio(M.file || M), x = new Float32Array(b.length); for(let c=0;c<b.numberOfChannels;c++){ const d = b.getChannelData(c); for(let i=0;i<x.length;i++) x[i] += d[i]/b.numberOfChannels; } M.pcm = { x, sr: b.sampleRate }; }catch(e){ M.pcm = null; } } }
  const key = JSON.stringify([ES.au, ES.vo && ES.vo.key, ES.ttsClips.map(c => [c.id, c.at, !!c.pcm]), ES.layers.map(L => [L.id, L.t0, L.t1, L.in, L.vol]), ES.denoiseOn, ES.baseBuf.length, shots.map(e => [e.start, e.end, e.src, e.in, e.scaleR, EH.speedKey(e.sp), e.cs.vol, e.cs.fin, e.cs.fout, !!e.cs.enh, e.cs.kx ? JSON.stringify(e.cs.kx.filter(k => 'vol' in k)) : 0])]);
  const key2 = key + JSON.stringify([EH.sfxEvents(), ES.au.sfx, ES.au.sfxv, ES.edit.map(e => e.cs ? [e.cs.mus, e.cs.pitch] : 0)]);
  if(key2 !== ES.clipMixKey){ ES.clipMixKey = key2; applyVo(); }
}
function sfxAdd(k){ if(!EH.SFX_NAMES[k] || !ES.buf) return; ES.sfxList.push({ id: ++ES.sfxSeq, at: +(ES.playing ? EH.curTime() : ES.pos).toFixed(2), kind: k }); EH.sfxUI(); ES.clipMixKey = ''; ensureMix(); EH.notify(EH.SFX_NAMES[k] + ' added at ' + (ES.playing ? EH.curTime() : ES.pos).toFixed(1) + ' s'); }
function applyVo(){   // (the name stays: everything that changes the sound calls it)
  if(ES.kind === 'talk' || !ES.baseBuf) return;
  const shots = ES.edit.filter(e => EH.csVoiced(e) && ES.sources[e.src] && ES.sources[e.src].pcm);
  const lyVoiced = ES.layers.filter(L => L.vol > 0 && ES.lmedia[L.m] && ES.lmedia[L.m].pcm);
  const speech = ES.ttsClips.filter(c => c.pcm);
  const fxEv = EH.sfxEvents(), musShots = ES.edit.some(e => e.cs && e.cs.mus !== undefined && e.cs.mus !== 1);
  const plain = !ES.vo && !shots.length && !speech.length && !lyVoiced.length && ES.au.mvol === 1 && !ES.au.mfin && !EH.musicOut() && !fxEv.length && !musShots;
  if(plain){ ES.buf = ES.baseBuf; ES.normGain = ES.baseNorm; return; }
  const B = ES.baseBuf, sr = B.sampleRate, N = B.length, v = EH.voPcm() || new Float32Array(0), vr = ES.vo ? ES.vo.sr : sr;
  // voice loudness: its speaking parts at about -14 dBFS
  let s2 = 0, n = 0; for(let i=0;i<v.length;i+=4){ const x = v[i]; if(Math.abs(x) > 0.01){ s2 += x*x; n++; } }
  const gv = 0.2/Math.max(0.003, Math.sqrt(s2/Math.max(1, n)));
  const mix = EH.getCtx().createBuffer(2, N, sr), dn = Math.exp(-1/(0.08*sr)), up = Math.exp(-1/(0.4*sr));
  // the music's volume with its fade in / out
  const fi = Math.round(ES.au.mfin*sr), fo = Math.round(EH.musicOut()*sr), mv = (i) => ES.au.mvol * (fi && i < fi ? i/fi : 1) * (fo && i > N - fo ? Math.max(0, (N - i)/fo) : 1);
  // the shots' own sound (mono), placed where each shot plays, at its speed; silent while a shot is frozen
  const cs = new Float32Array(N);
  for(const e of shots){ const P = ES.sources[e.src].pcm, c = EH.csOf(e), a = Math.round(e.start*sr), b = Math.min(N, Math.round(e.end*sr)), L = e.end - e.start;
    // the shot's loudness: about -16 dBFS at volume 100%, short fades at its cuts
    let q2 = 0, qn = 0; const i0 = Math.round(e.in*P.sr), i1 = Math.min(P.x.length, i0 + Math.round(L*P.sr*2)); for(let k=i0;k<i1;k+=8){ q2 += P.x[k]*P.x[k]; qn++; }
    const norm = Math.min(6, 0.16/Math.max(0.002, Math.sqrt(q2/Math.max(1, qn)))), ramp = Math.round(0.012*sr);
    const vk = !!(c.kx && c.kx.some(k => 'vol' in k)); let gain = (vk ? EH.csOf(e, 0).vol : c.vol)*norm;   // volume keyframes: read every 256 samples
    const seg = new Float32Array(Math.max(0, b - a));
    for(let i=a;i<b;i++){ const l = (i - a)/sr; if(vk && !((i - a) & 255)) gain = EH.csOf(e, l).vol*norm; if(EH.rateAt(e, l) <= 0) continue;
      const k = Math.floor(srcPos(e, l)*P.sr); if(k < 0 || k >= P.x.length) continue;
      const edge = Math.min(1, (i - a)/ramp, (b - i)/ramp) * EH.csFade(c, l, L);
      seg[i - a] = P.x[k]*gain*edge; }
    const ps0 = c.pitch ? EH.pitchShift(seg, sr, Math.pow(2, c.pitch/12)) : seg, ps = c.enh ? EH.voiceFx(ps0, sr, 'enhance') : ps0;   // the shot's own pitch (semitones), its voice enhanced
    for(let i=0;i<ps.length;i++) cs[a + i] += ps[i]; }
  for(const L of lyVoiced){ const P = ES.lmedia[L.m].pcm, a = Math.round(L.t0*sr), b = Math.min(N, Math.round(L.t1*sr)), ramp = Math.round(0.02*sr);
    let q2 = 0, qn = 0; for(let k=0;k<P.x.length;k+=16){ q2 += P.x[k]*P.x[k]; qn++; } const g = L.vol*Math.min(6, 0.16/Math.max(0.002, Math.sqrt(q2/Math.max(1, qn))));
    for(let i=a;i<b;i++){ const k = Math.floor((L.in + (i - a)/sr)*P.sr); if(k >= P.x.length) break; cs[i] += P.x[k]*g*Math.min(1, (i - a)/ramp, (b - i)/ramp); } }
  // text to speech: each at its time, at the voiceover's loudness (resampled with a straight line between samples)
  for(const c of speech){ const P = EH.ttsPcm(c), a = Math.round(c.at*sr), r = c.sr/sr; let q2 = 0, qn = 0;
    for(let k=0;k<P.length;k+=4){ if(Math.abs(P[k]) > 0.01){ q2 += P[k]*P[k]; qn++; } } const g = 0.2/Math.max(0.003, Math.sqrt(q2/Math.max(1, qn)));
    for(let i=a;i<N;i++){ const t = (i - a)*r, k = Math.floor(t); if(k + 1 >= P.length) break; cs[i] += (P[k] + (P[k+1] - P[k])*(t - k))*g; } }
  // sound effects: on top of everything (not ducked); the music under a shot: each shot's own music volume, eased
  const fxa = new Float32Array(N);
  for(const ev of fxEv){ const y = EH.sfxSynth(ev.kind, sr), a = Math.round((ev.kind === 'riser' ? ev.at - y.length/sr : ev.at)*sr); for(let i=0;i<y.length;i++){ const j = a + i; if(j >= 0 && j < N) fxa[j] += y[i]*ES.au.sfxv; } }
  let mg = null;
  if(musShots){ mg = new Float32Array(N); const k = Math.exp(-1/(0.12*sr)); let g = 1;
    for(let i=0;i<N;i++){ const e = ES.edit[EH.segAt(i/sr)], tg = e && e.cs && e.cs.mus !== undefined ? e.cs.mus : 1; g = tg + (g - tg)*k; mg[i] = g; } }
  let env = 1, lv = 0;
  for(let c=0;c<2;c++){ const src = B.getChannelData(Math.min(c, B.numberOfChannels-1)), d = mix.getChannelData(c); env = 1; lv = 0;
    for(let i=0;i<N;i++){
      const j = Math.floor(i*vr/sr), x = (v[j] || 0)*gv;
      lv = Math.max(Math.abs(x) + Math.abs(cs[i])*0.6, lv*0.9995);           // a follower of the voice (and the shots' sound)
      const target = lv > 0.04 ? 0.22 : 0.75; env = target < env ? target + (env - target)*dn : target + (env - target)*up;
      d[i] = src[i]*ES.baseNorm*mv(i)*(mg ? mg[i] : 1)*env + x + cs[i] + fxa[i];
    } }
  ES.buf = mix; ES.normGain = 1;
}
function autoTools(){
  if(ES.kind === 'talk' || !ES.edit.length) return;
  ES.edit.forEach(EH.csAutoClear);
  if(!ES.au.ai){ if(ES.au.clip === 'all') ES.edit.forEach(e => EH.csAutoSet(e, { vol: 0.7 })); ES.clipMixKey = ''; return; }
  const W = EH.out.width, H = EH.out.height;
  ES.edit.forEach((e) => {
    const s = ES.sources[e.src]; if(!s || !s.w) return;
    const keep = Math.min(W/s.w, H/s.h)/Math.max(W/s.w, H/s.h);   // the share of the picture a filled frame keeps
    if(keep < 0.5 && !(e.face > 0.3)) EH.csAutoSet(e, { fit: true, bg: 'blur' });
    const need = e.sp.pos(e.end - e.start)*e.scaleR, st = s.samples && s.samples.length ? windowStats(s, e.in, e.in + need) : null;
    if(st && st.b < 0.3) EH.csAutoSet(e, { bri: +Math.min(0.4, (0.42 - st.b)*1.4).toFixed(2), con: 0.08 });
    else if(st && st.b > 0.82) EH.csAutoSet(e, { bri: -0.12 });
    // the clips' own sound, as chosen (a shot's own volume set by hand always stays)
    if(ES.au.clip === 'all') EH.csAutoSet(e, { vol: 0.7 });
    else if(ES.au.clip === 'voices' && EH.speechShare(s, e.in, e.in + need) > 0.4) EH.csAutoSet(e, { vol: 0.9 });
  });
  // the AI director's own look for a shot (mirror, black and white, a framed photo, a fade...), like a person's clip tools
  ES.edit.forEach((e, i) => { const d = EH.dirSlotOf(i); if(d && d.cs) EH.csAutoSet(e, EH.AI_CS(d.cs)); });
  const cand = ES.edit.map((e, i) => ({ e, i })).filter(({ e, i }) => i > 2 && e.start > 3 && (e.type === 'drop' || e.type === 'hit') && e.end - e.start >= 0.5 && e.end - e.start <= 1.6
    && (e.mot || 0) > 0.45 && e.sp.label === '1×' && e.efx !== 'snap' && !(e.cs && 'rev' in e.cs));
  if(cand.length) EH.csAutoSet(cand[Math.floor(cand.length/2)].e, { rev: true });
  const last = ES.edit[ES.edit.length - 1]; EH.csAutoSet(last, { fout: +Math.min(0.6, (last.end - last.start)*0.5).toFixed(2) });
  ES.clipMixKey = ''; EH.renderEDL(true); if(!ES.playing) EH.redrawFrame();
}
async function speechScan(){
  if(ES.speechBusy || !EH.speechProbs || ES.kind === 'talk' || !ES.au.ai || ES.au.clip !== 'voices') return; ES.speechBusy = true; let found = false;
  try{ for(const s of ES.sources){ if(s.speech !== undefined || s.removed) continue;
      const P = await EH.clipPcm(ES.sources.indexOf(s)); if(!P){ s.speech = null; continue; }
      try{ const p = await EH.speechProbs(P.x, P.sr); s.speech = { p, hop: 512/16000 }; found = found || p.some(x => x > 0.5); }catch(e){ s.speech = null; } }
  } finally { ES.speechBusy = false; }
  if(found && ES.edit.length) autoTools();
}
// No song (Music Reel: "No song? Use my clips' own sound"): clips where people talk make a talking Reel (their voice leads, pauses cut); otherwise the
// loudest clip's own sound becomes the song. 'none': no clip has any sound.
async function autoSound(){
  let talkShare = 0, loud = -1, loudV = 0;
  for(let i=0;i<ES.sources.length;i++){ const P = await EH.clipPcm(i); if(!P) continue;
    let q = 0, n = 0; for(let k=0;k<P.x.length;k+=32){ q += P.x[k]*P.x[k]; n++; } const r = Math.sqrt(q/Math.max(1, n)); if(r > loudV){ loudV = r; loud = i; }
    if(EH.speechProbs){ try{ const p = await EH.speechProbs(P.x, P.sr); ES.sources[i].speech = { p, hop: 512/16000 }; talkShare = Math.max(talkShare, p.filter(x => x > 0.5).length/Math.max(1, p.length)); }catch(e){} } }
  if(talkShare >= 0.3){ EH.setKind('talk'); return 'talk'; }
  if(loud >= 0 && loudV > 0.003){ await EH.extractAudio(loud); return 'extract'; }
  return 'none';
}
async function cleanVo(){
  if(!ES.vo) return; try{ ES.vo.clean = await EH.denoise(ES.vo.raw, ES.vo.sr); }catch(e){ ES.vo.clean = null; }
  Object.defineProperty(ES.vo, 'pcm', { configurable: true, get(){ return ES.denoiseOn && this.clean ? this.clean : this.raw; } });
}
function placeTemplateTexts(t){
  const L = EH.reelLen(); if(!t.texts || !L) return;
  ES.overlays = ES.overlays.filter(o => !o.tpl);   // texts of an earlier template go
  for(const x of t.texts(L)){ const ov = EH.addOverlay({ ...x, all: !!x.all }); ov.tpl = true; if(x.at){ ov.t0 = Math.max(0, x.at[0]); ov.t1 = Math.min(L, x.at[1]); ov.all = false; } }
  ES.ovSel = -1; EH.renderOvList(); EH.redraw();
}
async function nextUntitled(){
  let n = 0;
  try{ const all = await idb('meta', 'readonly', st => st.getAll()); for(const m of all || []){ const x = /^Untitled (\d+)$/.exec(m && m.name || ''); if(x) n = Math.max(n, +x[1]); } }catch(e){}
  return 'Untitled ' + (n + 1);
}
function idb(store, mode, fn){ return EH.pdb().then(d => new Promise((res, rej) => { const t = d.transaction(store, mode), req = fn(t.objectStore(store));
  t.oncomplete = () => { d.close(); res(req && 'result' in req ? req.result : undefined); }; t.onerror = () => { d.close(); rej(t.error); }; t.onabort = () => { d.close(); rej(t.error || new Error('storage full')); }; })); }
async function putFile(f){ const k = 'f:' + EH.fileFp(f); if(await idb('files', 'readonly', s => s.getKey(k)) === undefined) await idb('files', 'readwrite', s => s.put(f, k)); }
function restoreEdit(list){
  if(!list.every(x => ES.sources[x.src])) return false;
  // the AI's plan stays this Reel's plan through an edit: its key has the shots' times in it, and without this the
  // studio would say it is still waiting for the AI, and every next step on the phone would wait for it too
  const keyBefore = EH.dirKey(), planned = !!ES.director && ES.director.key === keyBefore;
  EH.stopAll(); const uc = ES.sources.map(() => 0);
  ES.edit = list.map(x => { const e = { ...x, el: ES.sources[x.src].els[(uc[x.src]++) % 3], dirWhy: '', why: '' }; e.sp = EH.speedFor(x.sp, e); e.kf = keyframesFor(e); e.beatsIn = ES.beats.filter(b => b > e.start + 0.12 && b < e.end - 0.05).map(b => b - e.start); return e; });
  ES.plan = ES.edit.map(e => ({ start: e.start, end: e.end, type: e.type, fx: e.fx, sp: e.sp, tr: e.tr, efx: e.efx, acc: e.acc, ak: e.ak, ref: e.ref, flick: e.flick, trd: e.trd, black: e.black }));
  if(planned){ const keyNow = EH.dirKey(); if(keyNow !== keyBefore){ ES.director = { ...ES.director, key: keyNow }; ES.dirCache.set(keyNow, ES.director); } }
  EH.setCanvas(); ES.edit.forEach(e => EH.camAt(e, 0)); EH.renderEDL(); EH.drawMusic(); EH.captureLoop(); ES.editGen++;
  EH.flickBuild();   // a saved flicker montage: its stills again
  return true;
}
async function forgetSong(fp, quiet){
  await idb('songs', 'readwrite', s => s.delete(fp));
  const metas = await idb('meta', 'readonly', s => s.getAll()) || [];
  const used = metas.some(p => p.state && ((p.state.song && p.state.song.fp === fp) || (p.state.clips || []).some(c => c.fp === fp)));
  if(!used) await idb('files', 'readwrite', s => s.delete('f:' + fp));
  if(!quiet) EH.listRecent();
}
  return { smoothLive, addMark, delMark, clearMarks, stopPart, checkBeatsWithAi, scanGet, scanPut, keptSweep, editCopyFailNote, styleEdit, aiDone, dirArrived, applyChatVisualIntent, chatDone, chatFail, chatLocal, applyDirectorStyle, dirRequest, directorMaybe, paceMaybe, account, makeEdit, showShot, changed, shotOp, shotReorder, shotCs, shotSet, shotSlip, shotTrim, shotRoll, shotRipple, histTick, histRebase, histGo, snapRestore, remixNow, lazyPlayer, layerAdd, layoutLayer, lySelect, lyDelete, lySet, drawHook, facePosOnScreen, faceYOnScreen, drawCaptions, drawText, aiApply, drawOverlays, kfNow, kfTarget, kfLocal, kfAtHead, kfSeek, kfSet, segRegion, maskNow, maskSoon, shiftCaptions, csGeom, layerOf, shotReverse, lensOf, shapeAt, exportSound, autoExport, cutFramesOf, zoomBetween, frameCuts, renderedLook, copyLook, ttsMake, clearTts, ensureMix, sfxAdd, applyVo, autoTools, speechScan, autoSound, cleanVo, placeTemplateTexts, nextUntitled, idb, putFile, restoreEdit, forgetSong };
}
