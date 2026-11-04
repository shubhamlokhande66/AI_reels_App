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
import { createDirectorPlan, createAutonomousReelPlan, validateAutonomousReelPlan, assessAutonomousRenderQuality, inferAutonomousMood, evaluateKeyframes } from '@mobile/video-engine';
import { chatSize } from '@mobile/core/lib/chatSize';
import { TEXT_TEMPLATES, templateTexts } from '@mobile/core/lib/text-templates';
import { MAIN_VERT, MAIN_FRAG, PASS_VERT, GRADE_FRAG, PIC_FRAG, PIC_FX, TR_DUR } from '@mobile/core/lib/shaders';
import { needMap, planRank, PLAN_NAME, DEFAULT_LOCKS } from '@mobile/core/lib/plan-locks';
import { DEFAULT_TEMPLATES, liveTemplates, edgeAt } from '@mobile/core/lib/studio-templates';
import { songAnalysis } from '@mobile/core/engine/studio/song';
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

import { TAIL, aiBonus, beatFxOf, buildCapLines, clipBytes, crossesScene, csFilter, curveSpeed, endWell, fmt, goodSecs, isIndic, keyframesFor, lowerB, maskPath, moveWords, nearestS, panClamp, rampSpeed, revFrame, rmsOf, shotBeats, splitPoint, srcPos, srcPosF, statsIndex, suitFx, toSlots, updateClipHoverInfo, upperB, velocitySpeed, whatClip, windowStats, wrapLines } from '../../brain/pure';
import { createEditBrain } from '../../brain/edit';
import { createCoreBrain } from '../../brain/core';
import { createReelBrain } from '../../brain/reel';
export function initStudio(root, deps) {

// the edit core's state (brain/edit.ts); everything it needs from the page comes through the getters of EH
const ES = {};

// the engine's logic without browser code (brain/reel.ts)
const { makeEditNow } = createReelBrain(ES, { get life(){ return life; }, get sources(){ return sources; }, get buildTalk(){ return buildTalk; }, get storyEdit(){ return storyEdit; }, get ukKeep(){ return ukKeep; }, get stopAll(){ return stopAll; }, get adaptPlan(){ return adaptPlan; }, get paceNow(){ return paceNow; }, get beatEdit(){ return beatEdit; }, get noFlashCuts(){ return noFlashCuts; }, get withPartCuts(){ return withPartCuts; }, get styleEdit(){ return styleEdit; }, get applyDirectorStyle(){ return applyDirectorStyle; }, get finishTransitions(){ return finishTransitions; }, get tastePlan(){ return tastePlan; }, get seqSlots(){ return seqSlots; }, get clipFlaw(){ return clipFlaw; }, get aiAt(){ return aiAt; }, get aiTags(){ return aiTags; }, get ON_PHONE(){ return ON_PHONE; }, get dirShot(){ return dirShot; }, get scoreWindow(){ return scoreWindow; }, get rng(){ return rng; }, get seqPick(){ return seqPick; }, get flickBuild(){ return flickBuild; }, get dirSlotOf(){ return dirSlotOf; }, get tasteFx(){ return tasteFx; }, get FX_NAME(){ return FX_NAME; }, get ukRestore(){ return ukRestore; }, get setCanvas(){ return setCanvas; }, get camAt(){ return camAt; }, get renderEDL(){ return renderEDL; }, get autoTools(){ return autoTools; }, get speechScan(){ return speechScan; }, get editShown(){ return editShown; }, get aiStat(){ return aiStat; }, get tellReadyIfAway(){ return tellReadyIfAway; }, get captureLoop(){ return captureLoop; }, get paceMaybe(){ return paceMaybe; }, get directorMaybe(){ return directorMaybe; }, get chatReportAuto(){ return chatReportAuto; }, get copyLookSoon(){ return copyLookSoon; } });

// the engine's logic without browser code (brain/core.ts)
const { smoothLive, addMark, delMark, clearMarks, stopPart, checkBeatsWithAi, scanGet, scanPut, keptSweep, editCopyFailNote, styleEdit, aiDone, dirArrived, applyChatVisualIntent, chatDone, chatFail, chatLocal, applyDirectorStyle, dirRequest, directorMaybe, paceMaybe, account, makeEdit, showShot, changed, shotOp, shotReorder, shotCs, shotSet, shotSlip, shotTrim, shotRoll, shotRipple, histTick, histRebase, histGo, snapRestore, remixNow, lazyPlayer, layerAdd, layoutLayer, lySelect, lyDelete, lySet, drawHook, facePosOnScreen, faceYOnScreen, drawCaptions, drawText, aiApply, drawOverlays, kfNow, kfTarget, kfLocal, kfAtHead, kfSeek, kfSet, segRegion, maskNow, maskSoon, shiftCaptions, csGeom, layerOf, shotReverse, lensOf, shapeAt, exportSound, autoExport, cutFramesOf, zoomBetween, frameCuts, renderedLook, copyLook, ttsMake, clearTts, ensureMix, sfxAdd, applyVo, autoTools, speechScan, autoSound, cleanVo, placeTemplateTexts, nextUntitled, idb, putFile, restoreEdit, forgetSong } = createCoreBrain(ES, { get smoothPic(){ return smoothPic; }, get remakeOk(){ return remakeOk; }, get withMarks(){ return withMarks; }, get notify(){ return notify; }, get partNow(){ return partNow; }, get drawMusic(){ return drawMusic; }, get aiBeats(){ return aiBeats; }, get IOS(){ return IOS; }, get aiBeatsOff(){ return aiBeatsOff; }, get life(){ return life; }, get checkBeatsInner(){ return checkBeatsInner; }, get keptGet(){ return keptGet; }, get SCAN_V(){ return SCAN_V; }, get keptPut(){ return keptPut; }, get isLocked(){ return isLocked; }, get SPEED(){ return SPEED; }, get snapSpeed(){ return snapSpeed; }, get copyStyle(){ return copyStyle; }, get sources(){ return sources; }, get aiStat(){ return aiStat; }, get chatProposal(){ return chatProposal; }, get dirCache(){ return dirCache; }, get reelLen(){ return reelLen; }, get FX_OK(){ return FX_OK; }, get FX_NAME(){ return FX_NAME; }, get renderEDL(){ return renderEDL; }, get redrawFrame(){ return redrawFrame; }, get setOverlaysFromNative(){ return setOverlaysFromNative; }, get chatAnswer(){ return chatAnswer; }, get setModeQuiet(){ return setModeQuiet; }, get dirKey(){ return dirKey; }, get copyExact(){ return copyExact; }, get holdSpeed(){ return holdSpeed; }, get ACCENTS(){ return ACCENTS; }, get finishTransitions(){ return finishTransitions; }, get cutMusic(){ return cutMusic; }, get paceNow(){ return paceNow; }, get reelIdNow(){ return reelIdNow; }, get refContext(){ return refContext; }, get recentTools(){ return recentTools; }, get aiReelOk(){ return aiReelOk; }, get paceWanted(){ return paceWanted; }, get mixStore(){ return mixStore; }, get variantsRun(){ return variantsRun; }, get planSig(){ return planSig; }, get refitDirector(){ return refitDirector; }, get directorRun(){ return directorRun; }, get paceKey(){ return paceKey; }, get paceCache(){ return paceCache; }, get songPace(){ return songPace; }, get paceSongKey(){ return paceSongKey; }, get paceFromSong(){ return paceFromSong; }, get paceRun(){ return paceRun; }, get planLoad(){ return planLoad; }, get aiCheck(){ return aiCheck; }, get curTime(){ return curTime; }, get makeEditNow(){ return makeEditNow; }, get startPlayback(){ return startPlayback; }, get prepare(){ return prepare; }, get drawFrame(){ return drawFrame; }, get drawTimeline(){ return drawTimeline; }, get stopAll(){ return stopAll; }, get repick(){ return repick; }, get segAt(){ return segAt; }, get editOf(){ return editOf; }, get MIN_SHOT(){ return MIN_SHOT; }, get speedFor(){ return speedFor; }, get csOf(){ return csOf; }, get kxSet(){ return kxSet; }, get CS0(){ return CS0; }, get histBase(){ return histBase; }, get hist(){ return hist; }, get histSnap(){ return histSnap; }, get histUI(){ return histUI; }, get HIST_MAX(){ return HIST_MAX; }, get renderOvList(){ return renderOvList; }, get lyUI(){ return lyUI; }, get makeVideo(){ return makeVideo; }, get addLayerMedia(){ return addLayerMedia; }, get LY0(){ return LY0; }, get prepLayers(){ return prepLayers; }, get out(){ return out; }, get LAYOUTS(){ return LAYOUTS; }, get lyOn(){ return lyOn; }, get layoutWords(){ return layoutWords; }, get og(){ return og; }, get EASE(){ return EASE; }, get drawWord(){ return drawWord; }, get camAt(){ return camAt; }, get trOf(){ return trOf; }, get drawWatermark(){ return drawWatermark; }, get aiTexts(){ return aiTexts; }, get aiActions(){ return aiActions; }, get personMask(){ return personMask; }, get drawOverlay(){ return drawOverlay; }, get ovTiming(){ return ovTiming; }, get KF_NEAR(){ return KF_NEAR; }, get kfSync(){ return kfSync; }, get uAt(){ return uAt; }, get UK0(){ return UK0; }, get KF_SL(){ return KF_SL; }, get redraw(){ return redraw; }, get kfListSoon(){ return kfListSoon; }, get setMask(){ return setMask; }, get segInput(){ return segInput; }, get bgStat(){ return bgStat; }, get markKeyWords(){ return markKeyWords; }, get translateSoon(){ return translateSoon; }, get kf(){ return kf; }, get emphAt(){ return emphAt; }, get beatPulse(){ return beatPulse; }, get accentAt(){ return accentAt; }, get stabAt(){ return stabAt; }, get csCam(){ return csCam; }, get csFade(){ return csFade; }, get rateAt(){ return rateAt; }, get texOf(){ return texOf; }, get csMat(){ return csMat; }, get hexRgb(){ return hexRgb; }, get CANVAS_PATS(){ return CANVAS_PATS; }, get upSharp(){ return upSharp; }, get REV_MAX(){ return REV_MAX; }, get tasks(){ return tasks; }, get revCache(){ return revCache; }, get SHAPE_K(){ return SHAPE_K; }, get getCtx(){ return getCtx; }, get runExport(){ return runExport; }, get xq(){ return xq; }, get CUT_K(){ return CUT_K; }, get greyOf(){ return greyOf; }, get lookOfImage(){ return lookOfImage; }, get avgLook(){ return avgLook; }, get fpOf(){ return fpOf; }, get GRADES(){ return GRADES; }, get showCopyMatch(){ return showCopyMatch; }, get LOOKS(){ return LOOKS; }, get captureLoop(){ return captureLoop; }, get tts(){ return tts; }, get ttsList(){ return ttsList; }, get saveNow(){ return saveNow; }, get clipVoiced(){ return clipVoiced; }, get csVoiced(){ return csVoiced; }, get clipPcm(){ return clipPcm; }, get decodeAnyAudio(){ return decodeAnyAudio; }, get speedKey(){ return speedKey; }, get sfxEvents(){ return sfxEvents; }, get SFX_NAMES(){ return SFX_NAMES; }, get sfxUI(){ return sfxUI; }, get musicOut(){ return musicOut; }, get voPcm(){ return voPcm; }, get pitchShift(){ return pitchShift; }, get voiceFx(){ return voiceFx; }, get ttsPcm(){ return ttsPcm; }, get sfxSynth(){ return sfxSynth; }, get csAutoClear(){ return csAutoClear; }, get csAutoSet(){ return csAutoSet; }, get speechShare(){ return speechShare; }, get dirSlotOf(){ return dirSlotOf; }, get AI_CS(){ return AI_CS; }, get speechProbs(){ return speechProbs; }, get setKind(){ return setKind; }, get extractAudio(){ return extractAudio; }, get denoise(){ return denoise; }, get addOverlay(){ return addOverlay; }, get pdb(){ return pdb; }, get fileFp(){ return fileFp; }, get setCanvas(){ return setCanvas; }, get flickBuild(){ return flickBuild; }, get listRecent(){ return listRecent; } });
const { frameStats, flickPick, withMarks, drumness, snap, adaptPlan, beatEdit, noFlashCuts, adaptPlan0, buildPlan, partBeats, bestPart, snapToBeat, songParts, applyParts, partAt, gridOf, withPartCuts, partsOfSong, colorHist, saliency, subjectMotion, trackFaces, previewBatchClose, speechParts, rng, kf, uAt, accentAt, reelIdNow, aiTags, aiAt, aiTimes, planLine, recipeNow, tastePlan, finishTransitions, directorCandidates, mixStore, cutMusic, refitDirector, getSoundMap, cleanMoments, refContext, wholeSections, paceFromSong, camPath, camAt, clipFlaw, scoreWindow, ukKeep, ukRestore, seqSlots, seqPick, kfSummary, speedFor, assignPlayers, repick, kxSet, histSnap, histBase, segAt, strongHit, beatPulse, drawWord, speakingVoice, markKeyWords, emphAt, ovTiming, kxAt, csMat, csFwd, csCam, stabPath, stabAt, upSharp, captionOf, noSongTip, exportDims, cutKind, describeRef, copyPlanTimed, copyPlan, copyStyle, copyShots, copyMatch, fingerprintOf, voPcm, sfxSynth, sfxEvents, pitchShift, voiceFx, csAutoSet, csAutoClear, speechShare, storyVoice, remakeOk, editOf } = createEditBrain(ES, { get tts(){ return tts; }, get copyTimed(){ return copyTimed; }, get isPartStart(){ return isPartStart; }, get FEAT(){ return FEAT; }, get SW(){ return SW; }, get SH(){ return SH; }, get PACE(){ return PACE; }, get EASE(){ return EASE; }, get UK_PROPS(){ return UK_PROPS; }, get ACC_T(){ return ACC_T; }, get newId(){ return newId; }, get sources(){ return sources; }, get TR_NAME(){ return TR_NAME; }, get FX_NAME(){ return FX_NAME; }, get RECIPES(){ return RECIPES; }, get aiTrusted(){ return aiTrusted; }, get TR_STYLE(){ return TR_STYLE; }, get TR_CLASSY(){ return TR_CLASSY; }, get dirBase(){ return dirBase; }, get aiMixes(){ return aiMixes; }, get REF_KINDS(){ return REF_KINDS; }, get partOn(){ return partOn; }, get SIZES(){ return SIZES; }, get SEQ_FAST(){ return SEQ_FAST; }, get SEQ_MAX(){ return SEQ_MAX; }, get SPEED(){ return SPEED; }, get snapSpeed(){ return snapSpeed; }, get holdSpeed(){ return holdSpeed; }, get csOf(){ return csOf; }, get KX(){ return KX; }, get KX_D(){ return KX_D; }, get KX_MK(){ return KX_MK; }, get lyOf(){ return lyOf; }, get PULSE_GAP(){ return PULSE_GAP; }, get shown(){ return shown; }, get fontFor(){ return fontFor; }, get STOP(){ return STOP; }, get EMOJI(){ return EMOJI; }, get reelLen(){ return reelLen; }, get CS0(){ return CS0; }, get ROTI(){ return ROTI; }, get CAP_TPL(){ return CAP_TPL; }, get XQ(){ return XQ; }, get xq(){ return xq; }, get CUT_K(){ return CUT_K; }, get REF_TR(){ return REF_TR; }, get copyExact(){ return copyExact; }, get clip(){ return clip; }, get fxCache(){ return fxCache; }, get sfxCache(){ return sfxCache; }, get WHOOSH_TR(){ return WHOOSH_TR; }, get storySentences(){ return storySentences; }, get speedKey(){ return speedKey; } });
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
ES.lifeNote = {};
function life(p){ ES.lifeNote = { ...ES.lifeNote, ...p, at: Date.now() }; try{ sessionStorage.setItem(LIFE_KEY, JSON.stringify(ES.lifeNote)); }catch(e){} }
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
function wipNote(p){ if(WIP) life({ wip: { ...(ES.lifeNote.wip || {}), clips: [...$('clips').children].map(c => c.__src && fileFp(c.__src.file)).filter(Boolean), seq: ES.seqOn, ...p } }); }
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
let expCancel = false; ES.exporting = false;   // expCancel: Cancel export was tapped (the fast export stops at its next frame)
// the Shubix watermark on exported Reels (bottom right). Removing it ("Remove Watermark" in the export sheet) is for paid
// plans (and the administrator): wmPaid comes from the server when the sheet opens; until then the watermark stays
let wmPaid = false; ES.wmOff = false;
/* ---- plans: what this person's plan unlocks (lib/plan-locks.ts, changed by the administrator). Kept on the phone for 7
 * days, so a Reel made offline follows the plan seen last; with no plan known yet, the free plan's rules. Billing off
 * (or the administrator): everything is open, except while the administrator looks with View as Free (views.ts): then
 * the free plan's rules. Signed out with billing on: the free plan. A crowned item can be tried in the preview; the
 * export asks. ---- */
let playGen = 0; ES.starting = false;   // Preview's start / stop number (startPlayback, stopAll)
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
let flickKey = '', flickBusy = false; ES.flickPool = [];
async function flickBuild(){
  if(flickBusy || !ES.edit.some(e => e.flick) || !sources.length || !out.width) return;
  const W = out.width, H = out.height, key = sources.map(fpOf).join(';') + '|' + W + 'x' + H;
  if(key === flickKey && ES.flickPool.length) return;
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
    ES.flickPool = pool; flickKey = key; redraw();
  } finally { flickBusy = false; }
}
let blackC = null;
const blackPic = () => { if(!blackC){ blackC = document.createElement('canvas'); blackC.width = 16; blackC.height = 16; const g = blackC.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 16, 16); } return blackC; };
const texOf = (e, local) => e.black ? blackPic() : e.flick && ES.flickPool.length ? flickPick(e, local || 0) : ES.exporting ? (e.fc || e.fcLast) : e.rc && e.cs && e.cs.rev && local !== undefined ? revFrame(e, local) : smoothOn(e, local) ? smoothLive(e, local) : e.el;
/* ---- smooth slow motion (Clip tools -> Smooth slow-mo, as CapCut's): on a slowed shot every picture between two real frames
 * is the two mixed by how far between them the moment is, so a 0.25× shot glides instead of stepping. The two frames are the
 * last two the decoder gave (a, then b at ts); the mix runs a -> b over one frame's time, so it lags one frame and never jumps. ---- */
const smoothOn = (e, local) => !!(e.cs && e.cs.smooth > 0 && !e.cs.rev && local !== undefined && e.sp && rateAt(e, local) < 0.95);
function smoothPic(e, pic, ts, want, step){
  const w = pic.videoWidth || pic.width, h = pic.videoHeight || pic.height; if(!w || !h || !(step > 0)) return pic;
  const mk = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  let s = e.smo; if(!s || s.w !== w || s.h !== h) s = e.smo = { w, h, a: mk(), b: mk(), m: mk(), ts: null };
  if(s.ts !== ts){ const jump = s.ts === null || ts < s.ts || ts - s.ts > step*3;   // a seek: both frames are the new one
    [s.a, s.b] = [s.b, s.a]; s.b.getContext('2d').drawImage(pic, 0, 0); if(jump) s.a.getContext('2d').drawImage(pic, 0, 0); s.ts = ts; }
  const f = Math.max(0, Math.min(1, (want - ts)/step))*Math.min(1, e.cs.smooth), g = s.m.getContext('2d');
  g.globalAlpha = 1; g.drawImage(s.a, 0, 0); if(f > 0.01){ g.globalAlpha = f; g.drawImage(s.b, 0, 0); g.globalAlpha = 1; }
  return s.m;
}
let ctx = null; ES.buf = null; ES.mono = null;
let phase = 0, barOff = 0, beatLvl = []; ES.period = 0; ES.hopSec = 0; ES.rmsF = null; ES.hitsStr = [];
let onEnv=null; ES.onFps = 0; ES.onOff = 0; ES.hitsRaw = [];
ES.cutFx = []; ES.pfArr = null;
const DRUM_MIN = 0.7;
ES.beats = []; ES.cuts = []; ES.cutType = []; ES.peaks = []; ES.peakS = [];
ES.userMarks = [];
// On an iPhone the page's sound is muted by the ring/silent switch unless it says it is playing media (Audio Session API)
function getCtx(){ if(!ctx){ try{ if(navigator.audioSession) navigator.audioSession.type = 'playback'; }catch(e){} ctx = new (window.AudioContext||window.webkitAudioContext)(); } return ctx; }
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const TCOL = {drop:'--drop', hit:'--hit', cut:'--cut', break:'--break'};
const TNAME = {drop:'DROP', hit:'HIT', cut:'CUT', break:'BREAK'};

/* =============== MUSIC ENGINE: songAnalysis, shared with the phone (@mobile/core/engine/studio/song) =============== */
function analyseInWorker(m, sr, opts){
  return new Promise((resolve, reject) => {
    // beats the creator tapped in are the page's: with any, the song is analysed on the page (they become its beats)
    if(ES.userMarks.length) return reject(new Error('own beats: analysed on the page'));
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

/* =============== STEP 1: MUSIC =============== */
let musicToken = 0; ES.normGain = 1; ES.editGen = 0; ES.plan = []; ES.basePlan = []; ES.mode = 'auto';
let refWaiters = []; ES.refReading = false;   // a Reel to copy is being read: the AI waits for it (its pace and plan are for the copy)
// Copy a Reel: clips added while the Reel to copy is read wait for it (one heavy job at a time on a phone), and no Reel is
// made meanwhile (it would be an ordinary Reel, replaced moments later by the copy)
const refDone = () => ES.refReading ? new Promise(r => refWaiters.push(r)) : Promise.resolve();
ES.tplKind = '';
function drawMusic(){
  const cv = $('mwave'), dpr = window.devicePixelRatio||1, w = Math.max(1,Math.round(cv.clientWidth*dpr)), h = Math.round(84*dpr);
  cv.width = w; cv.height = h; const g = cv.getContext('2d'); g.clearRect(0,0,w,h);
  const M = ES.song ? ES.song.mono : ES.mono; if(!M) return;
  const D = ES.song ? ES.song.buf.duration : ES.buf.duration, part = ES.song && sec.len && ES.buf !== ES.song.buf;
  const a0 = part ? Math.round((dragStart ?? ES.secStart)/D*w) : 0, a1 = part ? Math.round(((dragStart ?? ES.secStart) + (dragStart != null ? secLenNow() : ES.buf.duration))/D*w) : w;
  const spp = M.length/w, wave = css('--wave');
  for(let x=0;x<w;x++){ let mx=0; const a=Math.floor(x*spp), b=Math.min(M.length,Math.floor((x+1)*spp)); for(let i=a;i<b;i+=4){ const v=Math.abs(M[i]); if(v>mx) mx=v; } const bh=Math.max(1,mx*h*0.9);
    g.globalAlpha = (x >= a0 && x <= a1) ? 1 : 0.28; g.fillStyle = wave; g.fillRect(x,(h-bh)/2,1,bh); }
  g.globalAlpha = 1;
  if(part){ g.strokeStyle = css('--accent') || css('--drop'); g.lineWidth = 2*dpr; g.strokeRect(a0+dpr, dpr, Math.max(2, a1-a0-2*dpr), h-2*dpr); }
  if(dragStart == null) ES.plan.forEach(s=>{ g.fillStyle = css(TCOL[s.type]); g.fillRect(Math.round((ES.secStart + s.start)/D*w),0,Math.max(2,dpr*1.5),h); });
  // where the song's part is playing (or was paused)
  const ph = ES.song && (ES.partSrc || ES.partPos != null) ? partNow() : null;
  if(ph != null && dragStart == null){ const x = Math.round(ph/D*w); g.fillStyle = css('--foreground') || '#fff'; g.fillRect(x - dpr, 0, 2*dpr, h); g.beginPath(); g.arc(x, 4*dpr, 4*dpr, 0, Math.PI*2); g.fill(); }
}
// The sound of any file: the browser's own decoder first (MP3, M4A, WAV, AAC, MP4 ...). Safari cannot decode the sound of a
// QuickTime .MOV (every iPhone video) that way, and decoding a big video whole would need it all in memory: for those,
// mediabunny copies just the sound track, unchanged, into a small .m4a that the browser's decoder accepts (fast, any
// browser); a sound that cannot be copied so is decoded with WebCodecs where the browser has an audio decoder.
async function decodeAnyAudio(file){
  // on the phone its own decoder reads it (SoundReader.kt); a file it cannot read goes on below
  const ph = window.__phone, path = ph && ph.paths[file.name + '|' + file.size];
  if(path){ try{
    const r = await fetch(ph.base + '/sound?k=' + ph.key + '&p=' + encodeURIComponent(path));
    if(r.ok){ const raw = await r.arrayBuffer(), top = new DataView(raw, 0, 8), sr = top.getInt32(0, true), ch = top.getInt32(4, true), all = new Float32Array(raw, 8), n = Math.floor(all.length/ch);
      if(n > 0){ const out = getCtx().createBuffer(ch, n, sr);
        for(let k = 0; k < ch; k++){ const d = out.getChannelData(k); for(let i = 0; i < n; i++) d[i] = all[i*ch + k]; }
        return out; } }
  }catch(e){ console.warn('the phone could not read the sound', e); } }
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
  ES.song = { buf: whole, mono: m, r: null, name, file, key: name + '|' + whole.duration.toFixed(2) };
  ES.buf = whole; ES.mono = m; ES.secStart = 0; ES.capWords = null; ES.capLines = null; ES.capAll = null;
  drawMusic();
  let r = cached && cached.r;
  tasks.update('song', null, r ? 'Using the beats found before' : 'Finding the beats, drops and breaks');
  if(!r){
    try{ r = await analyseInWorker(m, whole.sampleRate); }
    catch(err){ console.warn('song analysis worker unavailable, analysing on the page', err); await new Promise(rr=>setTimeout(rr,30)); r = songAnalysis(m, whole.sampleRate); }
  }
  if(token !== musicToken) return;   // another song was chosen meanwhile
  ES.song.r = r; ES.song.source = r.beatSource || 'own';
  await useSection(token);
  if(token !== musicToken) return;
  songBusy(false); $('s1st').textContent = 'Ready'; $('s1').classList.add('done'); $('s2').classList.remove('locked'); $('lenrow').hidden = ES.kind === 'talk';
  tasks.done('song', 'Song ready' + (sources.length ? '' : ' · now add your clips'));
  if(cached && cached.aiDone){ $('s1st').textContent = 'Ready · beats as checked before'; rememberSong(file, r, true); }
  else { rememberSong(file, r, false); checkBeatsWithAi(token); }
  if(ES.capsOn) loadCaptions();
}

/* ---- how much of the song: the whole song, or a part of 15 s / 30 s / 1 min / any length ----
 * The whole song is analysed once (its beats are judged on all of its music); a part is cut out of it on whole beats,
 * so the cut lands on the grid of the whole song. "Best part" picks the part itself: full and loud, the drop early (a
 * hook in the first seconds), no quiet start; dragging on the waveform picks it by hand (snapped to the nearest beat). */
let sec = { len: 0, auto: true, start: 0 }, dragStart = null, secBusy = 0, partFrom = 0, partT0 = 0; ES.partSrc = null; ES.partPos = null; ES.partRaf = 0; ES.song = null; ES.secStart = 0;   // part*: the song's part heard on the waveform (playPart)
const secLenNow = () => partBeats(sec.len).len;
// which part of the song a moment (in the Reel's time) is in: intro, up (build), drop, break
ES.songPartsRel = [];
const isPartStart = t => ES.songPartsRel.some(x => Math.abs(x.t - t) < 0.08);
async function useSection(token = musicToken){
  if(!ES.song || !ES.song.r) return;
  footCheckSoon();   // the Reel's length may change (another song, length, part): enough clips?
  if(ES.kind === 'talk'){ drawMusic(); if(sources.length && !ES.recording && !(ES.talk && ES.talk.songKey === ES.song.key)) buildTalk(); return; }
  const run = ++secBusy, W = ES.song.buf, D = W.duration, sr = W.sampleRate;
  let r;
  const parts = partsOfSong();
  if(!sec.len || sec.len >= D - 0.3){
    ES.buf = W; ES.mono = ES.song.mono; ES.secStart = 0; r = applyParts(ES.song.r, parts, 0, D);
  } else {
    const pb = partBeats(sec.len), L = Math.min(pb.len, D);
    let st = sec.auto ? bestPart(L) : snapToBeat(sec.start);
    st = Math.max(0, Math.min(st, D - L)); sec.start = st;
    const a = Math.round(st*sr), n = Math.min(W.length - a, Math.round(L*sr));
    const part = getCtx().createBuffer(W.numberOfChannels, n, sr), fi = Math.round(0.006*sr), fo = Math.round(Math.min(0.35, L*0.05)*sr);
    for(let c=0;c<W.numberOfChannels;c++){ const d = part.getChannelData(c); d.set(W.getChannelData(c).subarray(a, a+n));
      for(let i=0;i<fi;i++) d[i] *= i/fi; for(let i=0;i<fo;i++) d[n-1-i] *= i/fo; }   // no click in, a short fade out
    const m = ES.song.mono.slice(a, a+n);
    const given = (ES.song.r.beats || []).filter(t => t >= st - 0.01 && t < st + L - 0.02).map(t => Math.max(0, t - st));
    const opts = given.length >= 4 ? { forceBeats: given, forceSource: ES.song.source } : {};
    try{ r = await analyseInWorker(m, sr, opts); }catch(err){ r = songAnalysis(m, sr, opts); }
    if(run !== secBusy || token !== musicToken) return;
    // drops and breaks are judged on the whole song (a drop needs what came before it, which the part may not have; a
    // part's own edges look like breaks): each cut of the part takes the kind of the whole song's cut at the same
    // moment; one the whole song does not have is a plain cut; a part that starts on a drop starts with one
    { const W2 = (ES.song.r.cuts || []).map((c,k)=>({ t: c - st, ty: ES.song.r.cutType[k], fx: ES.song.r.cutFx[k] })).filter(c => c.t > -0.15 && c.t < L + 0.15);
      const near = t => { let b = null, bd = 0.12; for(const c of W2){ const d = Math.abs(c.t - t); if(d < bd){ bd = d; b = c; } } return b; };
      r = { ...r, cuts: r.cuts.slice(), cutType: r.cutType.slice(), cutFx: r.cutFx.slice() };
      r.cuts.forEach((t,k)=>{ const w = near(t);
        if(w){ r.cutType[k] = w.ty; r.cutFx[k] = w.fx; }
        else if(r.cutType[k] === 'drop' || r.cutType[k] === 'break'){ r.cutType[k] = 'cut'; r.cutFx[k] = 'Hard cut'; } });
      const d0 = W2.find(c => c.ty === 'drop' && Math.abs(c.t) < 0.12);
      if(d0 && !(r.cuts.length && r.cuts[0] < 0.12)){ r.cuts.unshift(0); r.cutType.unshift('drop'); r.cutFx.unshift(d0.fx); } }
    r = applyParts(r, parts, st, L);
    ES.buf = part; ES.mono = m; ES.secStart = st;
  }
  ES.musicKey = ES.song.key + (ES.secStart || ES.buf !== W ? '@' + ES.secStart.toFixed(2) + '+' + ES.buf.duration.toFixed(2) : '');
  applyAnalysis(r);
  { let s=0,n=0; for(let i=0;i<ES.mono.length;i+=64){ const v=ES.mono[i]; if(Math.abs(v)>0.003){ s+=v*v; n++; } }
    const rms = 10*Math.log10(s/Math.max(1,n)+1e-12); ES.normGain = Math.pow(10, Math.max(-6, Math.min(9, -14 - rms))/20); }
  $('mdur').textContent = fmt(ES.buf.duration) + (ES.buf !== W ? ' of ' + fmt(D) : '');
  $('sinfo').textContent = sec.len && ES.buf === W ? 'the song is ' + fmt(D).replace(/\.\d+$/,'') + ' long: all of it is used' : ES.buf !== W ? fmt(ES.secStart).replace(/\.\d+$/,'') + ' – ' + fmt(ES.secStart + ES.buf.duration).replace(/\.\d+$/,'') + (sec.auto ? ' · best part' : ' · your pick') : '';
  ES.pos = 0; ES.baseBuf = ES.buf; ES.baseNorm = ES.normGain; if(ES.vo) applyVo();
  if(ES.capsOn){ if(ES.capAll && (ES.secStart < ES.capAll.from || ES.secStart + ES.buf.duration > ES.capAll.from + 180)) loadCaptions(); else shiftCaptions(); }
  if(sources.length && !ES.recording) makeEdit();
}
function setLen(L){
  remakeOk();
  if(ES.recording) return;
  sec.len = L; sec.auto = true;
  [...$('slen').children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.l === (L === 0 ? '0' : [15,30,60].includes(L) ? String(L) : 'c'))));
  $('slencw').hidden = $('slen').querySelector('[data-l="c"]').getAttribute('aria-pressed') !== 'true';
  $('sauto').hidden = !L; $('lenhint').hidden = !L; $('mwave').classList.toggle('drag', !!L);
  if(ES.playing) stopAll();
  useSection();
}
$('slen').addEventListener('click', e => { const b = e.target.closest('button'); if(!b) return;
  setLen(b.dataset.l === 'c' ? Math.max(5, Math.min(180, +$('slenc').value || 45)) : +b.dataset.l); }, SIG);
$('slenc').addEventListener('change', () => setLen(Math.max(5, Math.min(180, +$('slenc').value || 45))), SIG);
$('sauto').addEventListener('click', () => { remakeOk(); sec.auto = true; if(ES.playing) stopAll(); useSection(); }, SIG);
// the song's part, heard on the waveform: let go of the part and it plays from its start; a tap pauses it and a tap
// plays it again from there; a line on the waveform shows where it is. It stops when the Reel plays.
function partNow(){ return ES.partSrc ? partFrom + (getCtx().currentTime - partT0) : ES.partPos; }
function playPart(from, base){
  if(!ES.song || !ES.song.buf) return; stopPart();
  const D = ES.song.buf.duration, a = base ?? ES.secStart, end = Math.min(D, a + (sec.len ? secLenNow() : D - a));
  let st = from ?? a; if(st < a || st >= end - 0.15) st = a;
  const len = end - st; if(len < 0.2) return;
  const c = getCtx(); if(c.state === 'suspended') c.resume();
  const s = c.createBufferSource(), g = c.createGain(), t = c.currentTime + 0.02;
  s.buffer = ES.song.buf; s.connect(g); g.connect(c.destination);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 0.06); g.gain.setValueAtTime(1, Math.max(t + 0.06, t + len - 0.3)); g.gain.linearRampToValueAtTime(0, t + len);
  s.onended = () => { if(ES.partSrc !== s) return; ES.partSrc = null; ES.partPos = null; cancelAnimationFrame(ES.partRaf); drawMusic(); };
  s.start(t, st, len); ES.partSrc = s; partFrom = st; partT0 = t; ES.partPos = null;
  const tick = () => { if(ES.partSrc !== s) return; drawMusic(); ES.partRaf = requestAnimationFrame(tick); };
  ES.partRaf = requestAnimationFrame(tick);
}
// drag on the waveform: the part follows the finger, and is cut (and heard) when let go
{ const cv = $('mwave'); let grab = 0, downX = 0, moved = false, down = false, wasPlaying = false;
  const tAt = ev => { const rc = cv.getBoundingClientRect(); return (ev.clientX - rc.left)/Math.max(1, rc.width)*ES.song.buf.duration; };
  cv.addEventListener('pointerdown', ev => { if(!ES.song || !ES.song.r || ES.recording) return;
    down = true; moved = false; downX = ev.clientX; wasPlaying = !!ES.partSrc;
    if(sec.len){ const t = tAt(ev), L = secLenNow(); grab = (t >= ES.secStart && t <= ES.secStart + L) ? t - ES.secStart : L/2; }
    cv.setPointerCapture(ev.pointerId); ev.preventDefault(); }, SIG);
  cv.addEventListener('pointermove', ev => { if(!down || !sec.len) return;
    if(!moved && Math.abs(ev.clientX - downX) < 6) return;   // a tap, not a drag (yet)
    if(!moved){ moved = true; stopPart(); if(ES.playing) stopAll(); }
    const L = secLenNow(); dragStart = Math.max(0, Math.min(ES.song.buf.duration - L, tAt(ev) - grab)); drawMusic(); }, SIG);
  const end = () => { if(!down) return; down = false;
    if(!moved){ if(wasPlaying) stopPart(true); else { const at = ES.partPos; if(ES.playing) stopAll(); playPart(at); } return; }   // a tap: pause, or play (on from where it was)
    remakeOk(); sec.start = dragStart; sec.auto = false; dragStart = null; const st = sec.start; useSection(); playPart(st, st); };
  cv.addEventListener('pointerup', end, SIG); cv.addEventListener('pointercancel', end, SIG); }
ES.beatInfo = { source: 'own', note: '' };
function applyAnalysis(r){
  ({ period: ES.period, phase, hopSec: ES.hopSec, rmsF: ES.rmsF, onEnv, onFps: ES.onFps, onOff: ES.onOff, hitsRaw: ES.hitsRaw, hitsStr: ES.hitsStr, pfArr: ES.pfArr, beats: ES.beats, cuts: ES.cuts, cutType: ES.cutType, cutFx: ES.cutFx, peaks: ES.peaks, peakS: ES.peakS, barOff } = r);
  ES.songPartsRel = r.parts || [];
  buildPlan(); drawMusic();
  $('mbpm').textContent = (60/ES.period).toFixed(0);
  $('mclips').textContent = ES.plan.length; $('mdrop').textContent = ES.plan.filter(s=>s.type==='drop').length; $('mbreak').textContent = ES.plan.filter(s=>s.type==='break').length;
}
// Second opinion on the beats: Beat This! (a neural network trained on thousands of hand-annotated songs) runs on this
// device in the background; the analysis then keeps whichever beats land on stronger hits with a steadier pulse (each
// tracker misses different songs) and the edit follows. The page stays usable; the first edit never waits for it.
ES.beatsBusy = false;
// An iPhone that reloaded while Shubix checked the beats (out of memory) does not run it again for a week: the page's own
// beats are good, and the person must be able to make the Reel at all
const AI_BEATS_OFF = 'brs-ai-beats-off';
if(IOS && lifeBefore && lifeBefore.stage === 'checking beats' && Date.now() - lifeBefore.at < 10*60e3) try{ localStorage.setItem(AI_BEATS_OFF, String(Date.now())); }catch(e){}
function aiBeatsOff(){ try{ return Date.now() - (+localStorage.getItem(AI_BEATS_OFF) || 0) < 7*864e5; }catch(e){ return false; } }
async function checkBeatsInner(token){
  const sr = ES.song.buf.sampleRate, m = ES.song.mono, base = 'Ready';
  const say = t => { if(token === musicToken) $('s1st').textContent = t; };
  say(base + ' · Shubix is checking the beats on this phone…');
  let beatStage = '';
  if(token === musicToken) tasks.start('beats', 'ai', 'Checking the beats', 'Shubix listens to your song on this phone');
  let bt;
  try{ bt = await aiBeats(m, sr, (stage, p) => { say(base + (stage === 'download' ? ' · getting the Shubix beat tracker (once) ' : ' · Shubix beat check ') + Math.round(p*100) + '%'); if(token !== musicToken) return;
      if(stage !== beatStage){ beatStage = stage; tasks.start('beats', 'ai', stage === 'download' ? 'Getting the Shubix beat tracker' : 'Checking the beats', stage === 'download' ? 'Only the first time · kept on this phone' : 'Shubix listens to your song on this phone'); }
      tasks.update('beats', p, stage === 'download' && p >= 1 ? 'Downloaded · starting Shubix' : undefined); }); }
  catch(err){ ES.beatInfo = { source: 'own', note: String(err && err.message || err) }; say(base); tasks.clear('beats'); console.info('on-device beat tracker not used:', ES.beatInfo.note); return; }
  if(token !== musicToken) return;
  let r;
  try{ r = await analyseInWorker(m, sr, { beats: bt.beats }); } catch(err){ r = songAnalysis(m, sr, { beats: bt.beats }); }
  if(token !== musicToken) return;
  ES.beatInfo = { source: r.beatSource, note: '', ms: bt.ms, judge: r.beatJudge, ai: bt };
  while(ES.exportBusy) await new Promise(rr=>setTimeout(rr, 500));   // the video being made keeps its edit; the better beats come after
  if(token !== musicToken) return;
  ES.song.r = r; ES.song.source = r.beatSource; rememberSong(ES.song.file, r, true);
  const was = ES.playing && !ES.recording;
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
// On the phone the app's hardware decoder gives the frames (FrameReader.kt); a clip it cannot read goes the web's way.
async function clipReader(src, maxSide){
  const ph = window.__phone, path = ph && src.file && (src.edFile ? src.edPath : ph.paths[src.file.name + '|' + src.file.size]);
  if(!path) return webReader(src, maxSide);
  const sc = Math.min(1, maxSide/Math.max(src.w, src.h)), W = Math.max(2, Math.round(src.w*sc/2)*2), H = Math.max(2, Math.round(src.h*sc/2)*2), size = W*H*4;
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'), pic = g.createImageData(W, H);
  let web = null; const other = async () => web ??= await webReader(src, maxSide);
  const frames = async function*(ts){
    let done = 0, reader = null;
    try{
      const r = await fetch(ph.base + '/frames?k=' + ph.key + '&p=' + encodeURIComponent(path) + '&w=' + W + '&h=' + H, { method: 'POST', body: ts.map(t => Math.max(0, t).toFixed(3)).join(',') });
      if(r.ok){
        reader = r.body.getReader(); let has = -1, got = 0;
        for(;;){ const { value, done: end } = await reader.read(); if(end) break;
          for(let i = 0; i < value.length;){
            if(has < 0){ has = value[i++]; got = 0; if(!has){ has = -1; done++; yield null; } continue; }
            const n = Math.min(size - got, value.length - i); pic.data.set(value.subarray(i, i + n), got); got += n; i += n;
            if(got === size){ has = -1; g.putImageData(pic, 0, 0); done++; yield c; }
          } }
      }
    }catch(err){ console.warn('the phone could not read the clip', err); }
    finally{ if(reader) reader.cancel().catch(() => {}); }
    if(done < ts.length) yield* (await other()).frames(ts.slice(done));
  };
  return { fast: true, frames,
    async at(t){ for await (const f of frames([t])) return f; return null; },
    close(){ if(web) web.close(); } };
}
async function webReader(src, maxSide){
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
    g.drawImage(v,0,0,SW,SH); g2.drawImage(v,0,0,128,72);
    const f = frameStats(g.getImageData(0,0,SW,SH).data, g2.getImageData(0,0,128,72).data, prev);
    hists.push(f.hist); lums.push(f.lum); out.push({ t, ...f.row });
    prev = f.lum;
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
// 0 = the same scene, 1 = nothing shared: the strongest of the three views (colours, brightness, layout)
// (brightness: the earth mover's distance between the two histograms, i.e. how far the brightness moved, so a change of
// grain or compression on a flat picture does not count, a jump to a darker or brighter scene does)
const colourD = (a, b) => { let c=0; for(let k=0;k<64;k++) c += Math.abs(a[k]-b[k]); return c/2; };
const histD = (a, b) => { let c=0, l=0, ca=0, cb=0, g=0; for(let k=0;k<64;k++) c += Math.abs(a[k]-b[k]);
  for(let k=64;k<80;k++){ ca += a[k]; cb += b[k]; l += Math.abs(ca-cb); }
  for(let k=80;k<FEAT;k++) g += Math.abs(a[k]-b[k]);
  return Math.max(c/2, Math.min(1, 2.5*l/15), Math.min(1, 2.5*g/40)); };
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
// does the stretch of footage [a,b] cross a scene change? (a small margin either side)
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
function drawSpark(src){
  const cv = src.spark; if(!cv || !src.samples) return;
  const dpr = window.devicePixelRatio||1, w = Math.max(1,Math.round(cv.clientWidth*dpr)), h = Math.round(22*dpr);
  cv.width=w; cv.height=h; const g=cv.getContext('2d'); g.clearRect(0,0,w,h);
  const mx = Math.max(1e-6, ...src.samples.map(s=>s.m));
  g.fillStyle = css('--drop'); g.globalAlpha=.8;
  src.samples.forEach(s=>{ const x=Math.round(s.t/src.dur*w), bh=Math.max(1,s.m/mx*h); g.fillRect(x,h-bh,Math.max(1,dpr),bh); });
}
// uploads go into a queue: you can add more videos any time, even while others are still being read
let addQueue = Promise.resolve(), batchN = 0, batchDone = 0; ES.pending = 0;
function addVideos(files, restored = false){
  const list = [...files].filter(f=>f.type.startsWith('video/') || /\.(mp4|mov|webm|m4v|3gp|mkv)$/i.test(f.name));
  if(!list.length){ $('s2st').textContent = 'That is not a video. Choose MP4, MOV or WEBM.'; return; }
  if(ES.playing){ ES.pos = curTime(); stopAll(); }   // free the computer so reading is fast
  const jobs = list.map(f=>makeCard(f));
  if(!ES.pending){ batchN = 0; batchDone = 0; }
  batchN += jobs.length; ES.pending += jobs.length; updateQ();
  tasks.start('clips', 'clips', 'Reading your clips', 'Finding the best moments in ' + batchN + ' clip' + (batchN > 1 ? 's' : ''));
  jobs.forEach(job=>{ addQueue = addQueue.then(()=>readVideo(job)).catch(()=>{}).then(()=>{ ES.pending--; batchDone++; updateQ(); }); });
  addQueue = addQueue.then(()=>{ if(!ES.pending) finishAdding(); });
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
  if(ES.pending) renumber(); else reorderClips();   // still reading: the clips are read in turn and keep this order (finishAdding makes the Reel)
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
  remakeOk(); if(ES.buf && sources.length && ES.kind !== 'talk') makeEdit();
}
$('crev').addEventListener('click', () => { if(ES.pending || ES.recording) return; const box = $('clips'); [...box.children].reverse().forEach(c => box.appendChild(c)); reorderClips(); });
function updateQ(){ $('qinfo').textContent = ES.pending ? ES.pending + ' clips left to read…' : ''; $('s2st').textContent = ES.pending ? 'Reading clips…' : (sources.length + ' clips ready'); }
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
  card.querySelector('.cup').addEventListener('click', ()=>{ const prev = card.previousElementSibling; if(prev && !ES.pending && !ES.recording){ prev.before(card); reorderClips(); } });
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
ES.previewBatchUi = null; ES.previewBatchCompressed = 0; ES.previewBatchDetected = 0;
function previewBatchShow(src, message, progress){
  if(!ES.previewBatchUi){
    const overlay=document.createElement('div'); overlay.className='askbg'; overlay.setAttribute('role','dialog'); overlay.setAttribute('aria-modal','true');
    overlay.innerHTML='<div class="ask" style="max-width:420px;width:calc(100% - 32px)"><p style="font-weight:700;margin-bottom:8px">Preparing your videos for smooth editing</p><p data-proxy-detail style="font-size:13px;opacity:.8;margin:0 0 14px"></p><div style="height:8px;border-radius:99px;background:rgba(128,128,128,.25);overflow:hidden"><div data-proxy-bar style="height:100%;width:0%;background:var(--accent,#d4af37);transition:width .15s"></div></div><p data-proxy-percent style="font-size:12px;text-align:right;margin:7px 0 0"></p></div>';
    root.appendChild(overlay); ES.previewBatchUi={overlay,detail:overlay.querySelector('[data-proxy-detail]'),bar:overlay.querySelector('[data-proxy-bar]'),percent:overlay.querySelector('[data-proxy-percent]')};
  }
  ES.previewBatchUi.detail.textContent=message;
  if(progress!==undefined){const n=Math.max(0,Math.min(100,Math.round(progress*100)));ES.previewBatchUi.bar.style.width=n+'%';ES.previewBatchUi.percent.textContent=n+'%';}
}
/* ---- clips from any camera: an edit copy for what plays badly or not at all here (lib/previewProxy.ts) ----
 * iPhone 4K HDR / Cinematic / slo-mo, Android 60 fps / 8K / HDR10+, GoPro, drones, mirrorless 10-bit 4:2:2, screen
 * recordings (a varying frame rate): an H.264 1080p 30 fps SDR copy, made on this device, read by the preview, the
 * clip reading and the export. What this browser cannot decode at all (ProRes, 4:2:2, old codecs) is converted by
 * Shubix (signed in, up to 95 MB). Kept with the draft on this device (v2), so a reopened Reel does not convert again. */
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
  ES.previewBatchDetected++;
  previewBatchShow(src, label[0].toUpperCase() + label.slice(1) + ' video found. Making a smooth copy so it plays without lag…', 0);
  life({ stage: 'making an edit copy', size: Math.round(src.file.size/1e6) + ' MB', res: (facts && facts.width) + 'x' + (facts && facts.height), what: label });
  src.proxyStatus = 'Making a smooth copy…'; updateClipHoverInfo(src);
  const show = (p, word) => { const n = Math.max(0, Math.min(100, Math.round(p*100))); dd.textContent = word + ' ' + n + '%'; titleProgress('copy', 'Preparing your clips', p); previewBatchShow(src, word[0].toUpperCase() + word.slice(1) + ' ' + src.name + '…', p); };
  // 0. on the phone: its own hardware (EditCopy.kt), far quicker than the page's encoder
  let r = null;
  const ph = window.__phone, phonePath = ph && ph.paths[src.file.name + '|' + src.file.size];
  if(plan && phonePath){ try{
    show(0, 'making a smooth copy…');
    // this page is hidden on the phone: its own card says what is happening
    tasks.update('clips', batchDone / Math.max(1, batchN), 'Making a smooth copy · Clip ' + Math.min(batchN, batchDone + 1) + ' of ' + batchN + ' · ' + src.name);
    const made = await fetch(ph.base + '/copy?k=' + ph.key + '&p=' + encodeURIComponent(phonePath) + '&w=' + plan.width + '&h=' + plan.height + '&fps=' + (plan.fps || 30) + '&b=' + plan.bitrate, { method: 'POST' });
    if(made.ok){ const { path } = await made.json(), got = await fetch(ph.base + '/f?k=' + ph.key + '&p=' + encodeURIComponent(path)), blob = got.ok ? await got.blob() : null;
      if(blob && blob.size && await hasPicture(blob)){ r = { blob, plan }; src.edPath = path; } }
    else console.info('the phone could not make the copy', await made.text());
  }catch(e){ console.info('the phone could not make the copy', e); } }
  // 1. on this device: WebCodecs, else the browser's own player feeding an encoder
  if(!r && plan && (playable || (facts && facts.decodes))){
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
  ES.previewBatchCompressed++;
  previewBatchShow(src, 'Smooth copy ready (' + ES.previewBatchCompressed + '/' + ES.previewBatchDetected + '). Reading your videos…', 1);
  try{ await keptPut('p:', src.file, { v: 2, edit: true, audio: !!src.edAudio, blob: src.edFile, width: src.edW, height: src.edH, mime: src.edFile.type || '', path: src.edPath || '' }); }catch(e){}
  return true;
}
async function compressHighResolutionPreview(src, dd){
  if(src.edFile){ if(src.proxyStatus === 'Checking preview…') src.proxyStatus = 'Smooth copy ready'; updateClipHoverInfo(src); return; }   // made already (a format the player could not open)
  const probe = await probeVideo(src.file).catch(() => null);
  const facts = { size: src.file.size, width: src.w, height: src.h, duration: src.dur, fps: probe ? probe.fps : 0, hdr: !!(probe && probe.hdr), tenBit: !!(probe && probe.tenBit), chroma422: !!(probe && probe.chroma422), vfr: !!(probe && probe.vfr) };
  src.facts = { ...facts, decodes: !!(probe && probe.decodes) };
  const isMov = /\.mov$/i.test(src.name || src.file.name || '') || /quicktime/i.test(src.file.type || '');
  const planned=previewProxyPlan(facts, isMov);
  const heavy = !!(planned && planned.forExport);
  // the phone's own player plays the original: only a heavy clip needs a copy there, for the export
  const plan = window.__phone && !heavy ? null : planned;
  // Reuse the copy made for this original file when a saved draft is reopened.
  const cached = await keptGet('p:', src.file);
  // (a copy kept without its picture, made before previewProxy.ts checked for one, is not used: it is made again)
  const pictured = cached && cached.blob instanceof Blob && (heavy ? cached.v === 2 && cached.edit : cached.v === 1 && cached.blob.size < src.file.size) && await hasPicture(cached.blob);
  if(pictured){
    if(cached.edit){ src.edFile = cached.blob; src.edPath = cached.path || ''; src.edW = cached.width || 0; src.edH = cached.height || 0; src.edAudio = !!cached.audio; }
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
  ES.previewBatchDetected++;
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
      ES.previewBatchCompressed++;
      dd.textContent='editing copy ready · analysing…';
      previewBatchShow(src,'Editing copy ready ('+ES.previewBatchCompressed+'/'+ES.previewBatchDetected+'). Analysing all selected videos…',1);
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
  if(ES.refReading){ dd.textContent = 'waiting for the Reel to copy…'; dd.dataset.st = 'read'; dd.dataset.p = '0'; await refDone(); if(src.removed) return; }
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
    const show = () => { const f = pm*0.6 + pf*0.4; dd.textContent = 'reading ' + Math.round(f*100) + '%'; dd.dataset.p = String(Math.round(f*100)); if(ES.previewBatchUi) previewBatchShow(src, 'Analysing selected videos… '+Math.round((batchDone+f)/Math.max(1,batchN)*100)+'%', (batchDone+f)/Math.max(1,batchN));
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
      stage = 'motion and faces'; life({ stage: 'reading clips', clips: sources.length + ES.pending, size: Math.round((src.file && src.file.size || 0) / 1e6) + ' MB', res: src.w + 'x' + src.h });
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
    if(ES.restoring && stage === 'motion and faces' && src.dur > 0 && src.w > 0 && src.h > 0){
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
  if(ES.kind === 'talk' || !sources.length){ box.hidden = true; return; }
  let any = false;
  for(let i=0;i<sources.length && !any;i++){ const P = await clipPcm(i); if(!P) continue; let q = 0, n = 0; for(let k=0;k<P.x.length;k+=64){ q += P.x[k]*P.x[k]; n++; } if(Math.sqrt(q/Math.max(1,n)) > 0.004) any = true; }
  const was = !box.hidden;
  box.hidden = !any || ES.kind === 'talk';
  // said once: what happens to it, and where to change it
  if(!box.hidden && !was && !clipSoundTold){ clipSoundTold = true; notify((ES.au.clip || 'mute') === 'mute' ? "Your clips' own sound is muted under the song. Change it in Music." : "Your clips' own sound: change it in Music."); }
  [...$('csnd').children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.c === (ES.au.clip || 'mute'))));
}
$('csnd').addEventListener('click', e => { const b = e.target.closest('button'); if(!b) return;
  ES.au = { ...ES.au, clip: b.dataset.c }; [...$('csnd').children].forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  if(ES.au.clip === 'voices') speechScan();
  autoTools(); applyVo(); ES.clipMixKey = ''; if(!ES.playing) redrawFrame();
  notify(ES.au.clip === 'mute' ? "The clips' own sound is muted." : ES.au.clip === 'voices' ? 'Only the voices in your clips are kept.' : "All of your clips' sound is kept, under the song.");
}, SIG);
function finishAdding(){
  previewBatchClose();
  remakeOk();
  { const order = [...$('clips').children].map(c => c.__src).filter(s => sources.includes(s)); if(order.length === sources.length) sources.splice(0, sources.length, ...order); }   // read in turn: the cards' order (askOrder)
  updateQ(); $('clearv').hidden = !$('clips').children.length; clipSoundCheck();
  if(sources.length) tasks.done('clips', sources.length + ' clip' + (sources.length > 1 ? 's' : '') + ' ready' + (ES.buf || ES.kind === 'talk' ? ' · making your Reel' : ' · now choose a song'));
  else tasks.fail('clips', 'These videos do not play here. Try MP4 or MOV.');
  if(sources.length){ $('s2').classList.add('done'); if(ES.buf || ES.kind === 'talk') makeEdit(); if(ES.kind !== 'talk' && !aiHeld) aiRun(); footCheckSoon(); }
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
let rnP = null; ES.denoiseOn = true;
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
let talkPace = 'natural', talkMusic = 0.09, talkToken = 0; ES.kind = 'music'; ES.talk = null;
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
  src.voice = { has: true, raw: pcm, clean, get pcm(){ return ES.denoiseOn && this.clean ? this.clean : this.raw; }, sr, probs, hop, how };
  return src.voice;
}
// where to split a long take: the quietest moment (lowest speech probability) 2.5-4.5 s in
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
  if(ES.song && talkMusic > 0){
    const W = ES.song.buf, st = W.duration > T + 0.5 ? bestPart(T) : 0, gm = talkMusic*VOICE_RMS/Math.max(0.005, rmsOf(ES.song.mono)), ws = W.sampleRate;
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
  ES.buf = mix; ES.mono = new Float32Array(N); { const L = mix.getChannelData(0), R = mix.getChannelData(1); for(let i=0;i<N;i++) ES.mono[i] = (L[i] + R[i])/2; }
  ES.normGain = 1; ES.secStart = 0; ES.beats = []; ES.period = 0.5; ES.peaks = []; ES.peakS = [];
  ES.talk = { voice, sr, parts, songKey: ES.song && talkMusic > 0 ? ES.song.key : '', sig: sources.map(s=>fpOf(s)).join(',') + '|' + talkPace + '|' + (ES.denoiseOn ? 'clean' : 'raw') + '|' + T.toFixed(2) };
  // the shots: one per part; a long one is split at its quietest moment; a jump cut inside one take is a punch-in
  const shots = [];
  for(const p of parts){
    const v = sources[p.si].voice; let a = p.a, t0 = p.t0;
    while(p.b - a > 5){ const m = splitPoint(v, a, p.b); shots.push({ si: p.si, in: a, start: t0, end: t0 + (m - a) }); t0 += m - a; a = m; }
    shots.push({ si: p.si, in: a, start: t0, end: p.t1 });
  }
  const useCount = sources.map(()=>0); let zoomed = false;
  const keptUk = ukKeep();
  ES.edit = shots.map((sh, i) => {
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
  ES.plan = ES.edit.map(e => ({ start: e.start, end: e.end, type: e.type, fx: e.fx, sp: e.sp, tr: e.tr, efx: e.efx, acc: e.acc, ak: e.ak, ref: e.ref, flick: e.flick, trd: e.trd, black: e.black }));
  setCanvas(); ES.edit.forEach(e=>camAt(e, 0)); renderEDL(); drawMusic();
  $('s3').classList.remove('locked'); $('s3').classList.add('done');
  const total = sources.reduce((q,s)=>q + s.dur, 0), how = sources.some(s => s.voice.how === 'level') ? ' (by loudness)' : '';
  $('s3st').textContent = ES.edit.length + ' shots · ' + fmt(T) + ' of talk from ' + fmt(total) + ' of clips' + (talkPace !== 'off' ? ' · ' + fmt(total - T) + ' of pauses cut' + how : '');
  $('mdur').textContent = fmt(T);
  $('tinfo').textContent = mute ? mute + ' clip' + (mute > 1 ? 's' : '') + ' without a voice left out' : '';
  $('xmsg').hidden = true;
  ['play','remix','export','cover'].forEach(id=>$(id).disabled=false);
  if(ES.capsOn) loadCaptions();
  ukRestore(keptUk);
  if(talkKfs && talkKfs.length === ES.edit.length){ ES.edit.forEach((e, k) => { if(talkKfs[k]) e.uk = talkKfs[k].map(q => ({ ...q })); }); }
  talkKfs = null;
  captureLoop(); ES.editGen++;
}
function setKind(k){
  remakeOk();
  if(ES.recording || k === ES.kind) return;
  delete root.dataset.nomake;
  ES.kind = k; if(ES.playing) stopAll();
  [...$('kind').children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === k)));
  root.classList.toggle('talkmode', k === 'talk');
  $('s1').querySelector('h2').textContent = k === 'talk' ? 'Music (optional)' : 'Music';
  $('s2').querySelector('h2').textContent = k === 'talk' ? 'Your talking clips' : 'Clips';
  $('talkrow').hidden = k !== 'talk'; $('lenrow').hidden = k === 'talk' || !ES.song;
  if(k === 'talk'){ $('s2').classList.remove('locked'); $('s1st').textContent = ES.song ? 'Plays quietly under the voice' : 'Optional: a song to play quietly under the voice'; }
  else if(!ES.song) $('s2').classList.add('locked');
  ES.capAll = null; ES.capWords = null; ES.capLines = null;
  clipSoundCheck();   // a talking Reel's sound is its clips' own: no choice to make
  if(k === 'talk'){ if(sources.length) buildTalk(); }
  else if(ES.song){ useSection(); } else { ES.edit = []; renderEDL(); drawFrame(0); }
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
  const pick = () => { const b = ES.TEMPLATES[t0] && root.querySelector('#tpl [data-t="' + CSS.escape(t0) + '"]'); if(b){ b.click(); return true; } return false; };
  if(t0 && pick()) return;
  // one the administrator added since the last visit: wait for the server's list
  if(t0){ tplReady.then(() => { if(!ac.signal.aborted && !pick()) kindFromPath(); }); return; }
  kindFromPath();
  function kindFromPath(){
  if(k0 === 'photo'){ const b = $('photokind'); if(b){ b.click(); return; } }
  if(k0 === 'talk' || k0 === 'music'){ const b = root.querySelector('#kind [data-k="' + k0 + '"]'); if(b) b.click(); else setKind(k0); } } });
function setDenoise(on){ ES.denoiseOn = on; $('dn1').checked = on; $('dn2').checked = on; ES.capAll = null; if(ES.kind === 'talk'){ if(sources.length) buildTalk(); } else if(ES.vo){ applyVo(); afterVo(); } }
$('dn1').addEventListener('change', e => setDenoise(e.target.checked), SIG); $('dn2').addEventListener('change', e => setDenoise(e.target.checked), SIG);
$('tpace').addEventListener('click', e => { const b = e.target.closest('button'); if(!b || ES.recording) return; talkPace = b.dataset.p;
  [...$('tpace').children].forEach(x => x.setAttribute('aria-pressed', String(x === b))); buildTalk(); }, SIG);
$('tmusic').addEventListener('click', e => { const b = e.target.closest('button'); if(!b || ES.recording) return; talkMusic = +b.dataset.v;
  [...$('tmusic').children].forEach(x => x.setAttribute('aria-pressed', String(x === b))); buildTalk(); }, SIG);

function removeVideo(src){
  if(ES.recording) return;
  remakeOk();
  if(ES.playing){ ES.pos = curTime(); stopAll(); }
  src.removed = true;
  const k = sources.indexOf(src); if(k>=0) sources.splice(k,1);
  (src.els||[]).forEach(v=>{ v.pause(); v.removeAttribute('src'); v.load(); });
  setTimeout(()=>URL.revokeObjectURL(src.url), 1000);
  src.card.remove(); renumber();
  $('clearv').hidden = !$('clips').children.length;
  if(sources.length){ makeEdit(); }
  else { ES.edit = []; renderEDL(); drawFrame(0); $('s2').classList.remove('done'); $('s3').classList.add('locked'); $('s3').classList.remove('done');
    $('s3st').textContent = 'The edit appears once there are clips'; ['play','remix','export','cover'].forEach(id=>$(id).disabled=true); $('xmsg').hidden = true; }
  updateQ();
}
$('clearv').onclick = () => { if(ES.recording) return; if(ES.playing) stopAll();
  [...$('clips').children].map(c=>c.__src).filter(Boolean).forEach(s=>{ s.removed = true; (s.els||[]).forEach(v=>{ v.pause(); v.removeAttribute('src'); v.load(); }); setTimeout(()=>URL.revokeObjectURL(s.url), 1000); s.card.remove(); });
  sources.length = 0; ES.pos = 0; removeVideoCleanup(); };
function removeVideoCleanup(){ $('clearv').hidden = true; ES.edit = []; renderEDL(); drawFrame(0); $('s2').classList.remove('done'); $('s3').classList.add('locked'); $('s3').classList.remove('done');
  $('s3st').textContent = 'The edit appears once there are clips'; ['play','remix','export','cover'].forEach(id=>$(id).disabled=true); updateQ(); }
$('addv').onclick = () => $('vfile').click();
$('vfile').addEventListener('change', e=>{ const fl = [...e.target.files]; e.target.value=''; addVideos(fl); });
const dz = $('dropzone');
dz.addEventListener('click', ()=>$('vfile').click());
dz.addEventListener('keydown', e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); $('vfile').click(); } });
['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev, e=>{ e.preventDefault(); dz.classList.add('over'); }));
['dragleave','drop'].forEach(ev=>dz.addEventListener(ev, e=>{ e.preventDefault(); dz.classList.remove('over'); }));
dz.addEventListener('drop', e=>addVideos(e.dataTransfer.files));

ES.aspect = '9:16';
const SIZES = {'9:16':[1080,1920], '4:5':[1080,1350], '1:1':[1080,1080], '16:9':[1920,1080], '3:4':[1080,1440], '4:3':[1440,1080], '2:1':[1920,960], '2.35:1':[1920,816]};   // + CapCut's other formats   // Instagram / YouTube full HD
$('aspect').addEventListener('click', e=>{ const b=e.target.closest('button'); if(!b) return; ES.aspect=b.dataset.a; root.dataset.asp = ES.aspect; // the preview card takes this shape too
  [...$('aspect').children].forEach(x=>x.setAttribute('aria-pressed', x===b)); setCanvas(); if(ES.edit.length && !ES.playing && !ES.recording) captureLoop(); });

/* =============== STEP 3: AUTO-EDIT =============== */
ES.edit = []; ES.seed = 1;
// Window statistics in O(log n): prefix sums over the clip's samples and faces (built once per clip). The edit scores
// thousands of windows, so a plain loop here froze the page on long videos.
/* ---- editing style: transition in, effect during, speed ---- */
const SPEED = {
  normal: {label:'1×', at:()=>1, pos:l=>l},
  slow:   {label:'Slow 0.5×', at:()=>0.5, pos:l=>0.5*l},
  fast:   {label:'Fast 1.6×', at:()=>1.6, pos:l=>1.6*l},
};
// velocity edit: slow-mo after each beat, fast whoosh into the next one
// photo snap: freeze 0.32 s like a camera shot, then play
const SNAP_T = 0.32;
const snapSpeed = {label:'Freeze → 1×', at:l=> l<SNAP_T ? 0 : 1, pos:l=> l<SNAP_T ? 0 : l-SNAP_T};
const TR_NAME = {hard:'Hard cut', fadein:'Fade-in', flash:'Exposure flash', whip:'Whip pan (blur)', zoom:'Zoom-through', glitch:'Glitch RGB', dip:'Dip to black', dissolve:'Dissolve',
  iris:'Mask: iris', wipe:'Mask: soft wipe', bars:'Mask: bars', spin:'Spin + blur', diamond:'Mask: diamond', heart:'Mask: heart', star:'Mask: star',
  slideleft:'Push left', slideright:'Push right', slideup:'Push up', slidedown:'Push down', swipeup:'Swipe up (feed scroll)', zoomout:'Zoom out', blur:'Blur through', flip:'Card flip',
  luma:'Light fade (by brightness)', pixelate:'Pixelate', clock:'Clock wipe', doors:'Doors open', ripple:'Ripple', burn:'Film burn', dropin:'Drop in (bounce)',
  stripes:'Stripes', blinds:'Blinds', checker:'Checkerboard', dots:'Dots', noise:'Noise dissolve', splith:'Split open', wave:'Wave wipe', dipwhite:'Dip to white', chroma:'Colour split', tiles:'Random tiles',
  zoomblur:'Zoom blur', shake:'Shake', squeeze:'Squeeze', rotatein:'Rotate in'};
const FX_NAME = {jump:'Punch-in (jump cut)', 'punch-soft':'Soft zoom', 'pan-soft':'Ken Burns (soft)', snap:'Photo snap (freeze + flash)', hook:'Hook zoom + RGB', none:'—', pan:'Ken Burns + beat bounce', zoomburst:'Zoom burst + RGB', drift:'Slow drift + vignette', punch:'Zoom punch', tilt:'Tilt punch', shake:'Shake', bounce:'Beat bounce',
  boxgrow:'Shape: box grows on the beat', grid:'Shape: grid opens on the beat', strips:'Shape: strips on the beat', circle:'Shape: circle pulse', heartbeat:'Shape: heart pulse', starbeat:'Shape: star pulse',
  frame:'Frame in frame', mirror:'Mirror', kaleido:'Kaleidoscope', triple:'Triple split', vhs:'VHS retro', strobe:'Strobe on the beat', rgbpulse:'RGB split on the beat', blurpulse:'Blur pulse on the beat',
  grain:'Film grain', leak:'Light leak', rainbow:'Rainbow', negative:'Negative', halftone:'Halftone', pixel8:'8-bit pixels', crt:'CRT screen', fisheye:'Fisheye', swirl:'Swirl', sketch:'Sketch', duotone:'Duotone', zoom3d:'3D zoom'};
const trDur = e => e.trd ?? (TR_DUR[e.tr] || 0);   // a shot's own (shorter) transition, else the transition's usual length


/* ---- keyframes: [time, value, ease] per property, local to the shot ---- */
const EASE = {
  lin: x=>x, outCubic: x=>1-Math.pow(1-x,3), outExpo: x=> x>=1 ? 1 : 1-Math.pow(2,-10*x),
  outBack: x=>{ const c1=1.70158, c3=c1+1; return 1 + c3*Math.pow(x-1,3) + c1*Math.pow(x-1,2); },
  inOut: x=> -(Math.cos(Math.PI*x)-1)/2, inQuad: x=>x*x,
  bezier: x=>cubicBezierProgress(x, [0.25, 0.1, 0.25, 1]),
};
/* ---- the creator's own keyframes (◆): position, zoom, rotation, opacity of a shot or a text, at times local to it.
   Each keyframe holds all five; the ease of a keyframe shapes the move INTO it. One keyframe = a fixed setting. ---- */
EASE.hold = x => x < 1 ? 0 : 1;
const UK0 = {x:0, y:0, s:1, r:0, o:1}, UK_PROPS = ['x','y','s','r','o'];
// a shot that is moved, made smaller or turned shows black around it (not stretched edge pixels)
// The AI director's keyframes on the hits inside a shot, on top of the shot's own effect: a punch (quick zoom), a shake,
// a flash of light or a small pulse, each starting exactly on its hit and gone within 0.4 s.
const ACCENTS = ['punch','shake','flash','pulse'], ACC_T = 0.4;

ES.dupCount = 0;
/* ---- optional AI: which moment goes where ----
   The phone sends a few small frames per clip; a vision model scores each moment like a pro editor (strength, what it
   suits, what is wrong, where the subject is). Timing stays with the music analysis; the AI only steers the choice of
   moment and the framing. Scores are cached per clip (also across visits), so re-edits cost nothing. */
let aiBusy = false, aiInfo = null, aiLocked = false; ES.aiOn = false;
/* ---- credits: Shubix AI is paid per Reel (once, however many clips come later) and per chat change; the person is asked
 * each time, with what it costs and what they have. Free plans (no AI) edit on the phone. ---- */
let aiReel = '', gateP = null, chatUsed = 0; ES.reelId = '';   // aiReel: the Reel the person said yes to ('no:' + id: said no); chatUsed: Ask Shubix changes on it (the plan's first few are free)
const newId = () => { try{ return crypto.randomUUID().replace(/-/g, '').slice(0, 20); }catch(e){ return Math.random().toString(36).slice(2, 12) + Date.now().toString(36); } };
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
function aiOff(msg){ ES.aiOn = false; aiStat(msg); const pr = [...$('mode').children].find(x => x.getAttribute('aria-pressed') === 'true'); modeWords(pr ? pr.dataset.m : ES.mode); if(ES.buf && sources.length && !ES.recording) makeEdit(); }
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
  if(!ES.aiOn) return Promise.resolve(false);
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
const aiReelOk = () => ES.aiOn && !!ES.reelId && aiReel === ES.reelId;
// Free (no Shubix AI in the plan): on Generate, once per Reel, what Shubix AI would do and the way to it.
// 'upgrade' (to Plans), 'basic' (the phone's own edit), 'close' (✕: nothing) or 'skip' (a plan with Shubix AI, or already asked)
let upsold = '';
async function upsell(){
  aiHeld = false;
  if(!aiLocked){
    if(!ES.aiOn) return 'skip';
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
  if(!ES.aiOn || aiBusy || !sources.length) return;
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
    if(sources.some(s=>!s.ai && !s.aiFailed && !s.removed) && !ES.pending) return aiRun();   // clips added meanwhile
    aiDone(charged, failed);
  }catch(e){
    aiBusy = false;
    if(e && e.name === 'AbortError') return;
    aiGaveUp = reelIdNow();   // nothing more comes from Shubix for this Reel: it is final as the phone made it
    console.warn('AI picks not used:', e); aiStat('Shubix could not look at your clips right now. Your Reel uses the best moments picked on your phone' + (aiCostOf('reel') && dirPlannedReel !== reelIdNow() ? ' · no credits were used.' : '.'));
  }
}
/* ---- Ask Shubix: the creator says in their own words how the Reel should be ("faster", "zoom on the drop", "start
 * with my face"), and the AI edits it that way. Everything they said (newest last) goes with the AI's pace and plan as
 * the creator's wish, which wins over the style and over the house taste (tastePlan / tasteFx step aside for the AI's
 * choices then). A few plain words also work without the AI: faster / calmer switch the style, "new version" remixes. */
ES.wish = ''; ES.chatMsgs = []; ES.chatWaiting = false; ES.chatAsk = null; ES.chatN = 0;
// asked for anything in the chat: the AI's choices stand (the house taste steps aside)
// the AI's plan is applied as it is: its transitions, keyframes and effects are not cut back by the rules' taste (that is
// for a Reel made without the AI); what the creator asks for in Ask Shubix comes first
const aiTrusted = () => ES.aiOn && !!ES.director && ES.director.key === dirKey();
function chatSay(who, text, wait){
  const p = document.createElement('p'); p.className = who + (wait ? ' wait' : ''); p.textContent = text;
  $('chatlog').appendChild(p); $('chatlog').scrollTop = $('chatlog').scrollHeight; return p;
}
function chatClearWait(){ $('chatlog').querySelectorAll('.wait').forEach(x => x.remove()); }
function chatAnswer(text){ chatClearWait(); chatSay('ai', text); ES.chatMsgs.push({ who: 'ai', text }); ES.chatWaiting = false; $('chatsend').disabled = false; }
let chatReported = ''; ES.chatPending = null;
function planReport(slots, story, changed){
  const box = document.createElement('div'); box.className = 'ai rep';
  const n = ES.plan.length, tr = slots.filter((d,i) => i && d && d.tr && d.tr !== 'hard').length, fx = slots.filter((d,i) => d && d.fx && d.fx !== 'none' && !(i === 0 && d.fx === 'hook')).length,
    keys = slots.reduce((a,d) => a + (d && d.keys ? d.keys.length : 0) + (d && d.move && d.move.length ? 1 : 0), 0);
  const head = document.createElement('b');
  head.textContent = changed && changed.size ? 'Shubix changes ' + (changed.size === 1 ? 'shot ' : 'shots ') + [...changed].sort((a, b) => a - b).map(i => i + 1).join(', ') + ' (the rest stays as it is)'
    : 'Shubix\'s plan: ' + n + ' shots · ' + tr + ' transitions · ' + fx + ' effects · ' + keys + ' keyframes';
  box.appendChild(head);
  if(story){ const p = document.createElement('span'); p.className = 'repstory'; p.textContent = story; box.appendChild(p); }
  const det = document.createElement('details'), sum = document.createElement('summary'), ol = document.createElement('ol');
  sum.textContent = changed && changed.size ? 'See the change' : 'See every shot'; det.appendChild(sum); if(changed && changed.size) det.open = true;
  ES.plan.forEach((s, i) => {
    if(changed && changed.size && !changed.has(i)) return;
    const li = document.createElement('li'); if(changed && changed.has(i)) li.className = 'chg';
    li.textContent = planLine(s, i, slots);
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
  ES.chatMsgs.push({ who: 'ai', text: 'Plan ready: ' + (pd.story || ES.plan.length + ' shots') });
  ES.chatWaiting = false; $('chatsend').disabled = false;
}
async function chatGenerate(btn){
  remakeOk();
  const pd = ES.chatPending; btn.disabled = true;
  if(!pd || pd.key !== dirKey()){ chatAnswer('The Reel changed since this plan. Tell me again what you want and I\'ll plan it anew.'); return; }
  ES.chatPending = null; chatReported = pd.key; ES.director = { key: pd.key, slots: pd.slots, story: pd.story }; dirCache.set(pd.key, ES.director);
  let applied = '';
  try {
    makeEdit(); await aiApply(pd);
    applied = applyChatVisualIntent(pd.intent, pd.slots);
    if(!ES.edit.length) throw new Error('The Reel timeline could not be verified after applying the plan.');
  } catch(error) {
    btn.textContent = 'Not applied';
    chatAnswer('I could not verify that every requested change was applied. ' + String(error && error.message || error) + ' The Reel was not marked as generated; please try the instruction again.');
    return;
  }
  if(!ES.playing && !ES.recording && ES.buf && ES.edit.length) startPlayback(0);
  btn.textContent = 'Generated ✓';
  const bal = aiBal();
  chatAnswer('Your new Reel is ready ✓' + (applied ? ' Applied: ' + applied + '.' : '') + (!pd.cost && aiFreeChats() ? ' Free change · ' + (Math.max(0, aiFreeChats() - chatUsed) ? Math.max(0, aiFreeChats() - chatUsed) + ' free left for this Reel.' : 'next changes use credits.') : '') + (pd.cost ? ' ' + creditWord(pd.cost) + ' used' + (bal != null ? ' · ' + creditWord(bal) + ' left' : '') + '.' : '') + ' Not quite right? Tell me what to change and I\'ll check it again.');
}
// a plan the AI made by itself (no chat): its report goes into the chat too, and the button shows there is one
function chatReportAuto(){
  if(ES.chatWaiting || ES.chatPending || !ES.aiOn || !ES.director || ES.director.key !== dirKey() || chatReported === ES.director.key) return;
  chatReported = ES.director.key; $('chatlog').appendChild(planReport(ES.director.slots, ES.director.story)); $('chatfab').classList.add('news'); $('tbchat').classList.add('news');
}
// the phone app's Ask Shubix: the website's own chat (the same AI, its credit questions asked on the phone); the plan it
// makes is applied at once (the phone has no Generate button of the studio's), and the answer goes back to the phone
async function chatApp(text){
  const before = ES.chatMsgs.length;
  await chatSend(text);
  const t0 = Date.now(), wait = ms => new Promise(r => setTimeout(r, ms));
  while((ES.chatWaiting || ES.dirBusy || ES.paceBusy) && Date.now() - t0 < 240000) await wait(300);
  let applied = false;
  if(ES.chatPending && ES.chatPending.key === dirKey()){
    const pd = ES.chatPending; ES.chatPending = null; chatReported = pd.key;
    ES.director = { key: pd.key, slots: pd.slots, story: pd.story }; dirCache.set(pd.key, ES.director);
    makeEdit(); await aiApply(pd); try{ applyChatVisualIntent(pd.intent, pd.slots); }catch(e){}
    applied = !!ES.edit.length; if(applied){ ES.chatMsgs.push({ who: 'ai', text: 'Done ✓' }); saveNow(); }
  }
  const said = ES.chatMsgs.slice(before).filter(m => m.who === 'ai').map(m => m.text).filter(t => t !== 'Done ✓').pop() || '';
  return { applied, answer: applied ? 'Done ✓ Your Reel is edited the way you asked' + (ES.director && ES.director.story ? ': ' + ES.director.story : '.') : said || (ES.chatWaiting ? 'Shubix is still working on it. Ask again in a moment.' : 'OK') };
}
function chatRestore(list){
  if(!Array.isArray(list)) return; ES.chatMsgs = list.filter(m => m && typeof m.text === 'string').slice(-20);
  $('chatlog').innerHTML = ''; ES.chatMsgs.forEach(m => chatSay(m.who === 'me' ? 'me' : 'ai', m.text));
  ES.wish = ES.chatMsgs.filter(m => m.who === 'me').map(m => m.text).join(' · ').slice(-800);
}
function setModeQuiet(m){ ES.mode = m; [...$('mode').children].forEach(b => b.setAttribute('aria-pressed', b.dataset.m === m)); modeWords(m); if(ES.buf) ES.plan = adaptPlan(); }
ES.chatCost = 0;
// a small change: only the shots it is about come back from the AI; every other shot stays exactly as it is
async function chatPatch(text, n, id){
  ES.chatWaiting = true; ES.chatPending = null; $('chatsend').disabled = true; chatSay('ai', 'Changing just that part', true);
  const tm = timeoutSignal(45000);
  try{
    const cands = directorCandidates(); ES.dirCands = cands;
    const { req } = dirRequest(cands), key = dirKey(), len = i => ES.edit[i].end - ES.edit[i].start;
    req.patch = { ask: text, current: ES.edit.map((e, i) => ({ i, clip: 'c' + (e.src + 1), at: +e.in.toFixed(2), transition: e.tr || 'hard', effect: e.efx || 'none', speed: speedKey(e.sp) })) };
    req.chat = { n, id, text };
    const r = await fetch('/api/studio/direct', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req), signal: tm.signal });
    const res = await r.json().catch(() => ({}));
    if(!r.ok) throw new Error((res.error && res.error.message) || ('Shubix could not change it (' + r.status + ').'));
    chatSync(res); if(typeof res.balance === 'number' && aiInfo){ aiInfo.balance = res.balance; window.dispatchEvent(new Event('brs-credits')); }
    const base = ES.director && ES.director.key === key ? ES.director.slots.slice() : ES.edit.map((e, i) => ({ cand: { src: e.src, in: e.in }, tr: e.tr, fx: e.efx, sp: speedKey(e.sp),
      keys: (e.acc || []).map(q => ({ at: q.at, do: q.do })), move: (e.ak || []).map(q => ({ at: q.t / Math.max(0.05, len(i)), s: q.s, x: q.x, y: q.y, r: q.r, ez: q.ez })), cs: e.cs || null, why: '' }));
    const got = toSlots(res.slots, cands), changed = new Set();
    got.forEach((x, i) => { if(x && base[i] !== undefined){ base[i] = { ...x, cand: x.cand || base[i].cand }; changed.add(i); } });
    const intent = parseDirectorVisualIntent(text);
    if(intent.transitionAll || intent.effectsAll) ES.edit.forEach((_, i) => changed.add(i));
    if(!changed.size && !intent.openingText && !intent.squareFrameAll && !intent.transitionAll && !intent.effectsAll){ chatAnswer('I could not tell which shot to change. Name it, e.g. "shot 3: slow-mo" or "the first clip: the dance".'); return; }
    ES.chatPending = { key, slots: base, story: res.story || '', texts: res.texts, actions: res.actions, changed, cost: ES.chatCost, intent };
    chatProposal(ES.chatPending);
  }catch(e){ chatFail(tm.timedOut() ? 'Shubix took too long this time. Try again in a moment.' : String(e && e.message || 'Shubix could not change it right now.')); }
  finally{ tm.done(); }
}
async function chatSend(text){
  remakeOk();
  text = String(text || '').trim().slice(0, 300); if(!text || ES.chatWaiting) return;
  chatSay('me', text); ES.chatMsgs.push({ who: 'me', text });
  $('chatin').value = ''; chatFit();
  const ready = ES.buf && sources.length && ES.edit.length && !ES.recording;
  // Explicit, deterministic visual edits are applied locally on every plan. They do not need
  // a model round-trip, a credit check or a server upload; verify the full scope before replying.
  const localVisualIntent = parseDirectorVisualIntent(text);
  const hasLocalVisualIntent = !!(localVisualIntent.openingText || localVisualIntent.squareFrameAll
    || localVisualIntent.transitionAll || localVisualIntent.effectsAll);
  if(ready && hasLocalVisualIntent){
    try{
      const before = histSnap();
      const localSlots = ES.edit.map(shot => ({ tr: shot.tr || 'hard', fx: shot.efx || 'none', effect: shot.efx || 'none' }));
      if(ES.playing) stopAll();
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
  if(!ES.aiOn){
    const did = chatLocal(text);
    if(ready && did.length) makeEdit();
    chatAnswer((did.length ? 'Done ✓ I used ' + did.join(' and ') + ' (on your phone). ' : '') + (aiLocked && IN_APP ? 'Changing the Reel from your words is Shubix AI, which is not on your plan.' : aiLocked ? 'Changing the Reel from your words is Shubix AI: it is in the Editor and Pro plans.' : 'Shubix AI is off for this Reel, so I can only switch the style (say "faster" or "calmer") or make a new version.'));
    if(aiLocked && !IN_APP){ const a = document.createElement('a'); a.href = '/pricing'; a.className = `${Button.primary} up`; a.textContent = 'See Editor & Pro'; $('chatlog').appendChild(a); }
    return;
  }
  if(!ready){ ES.wish = ES.chatMsgs.filter(m => m.who === 'me').map(m => m.text).join(' · ').slice(-800); chatAnswer('Got it! I\'ll edit your Reel this way as soon as it is made.'); return; }
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
  ES.chatCost = cost; const n = ++ES.chatN, id = newId();
  if(size === 'small') return chatPatch(text, n, id);
  chatLocal(text);
  ES.wish = ES.chatMsgs.filter(m => m.who === 'me').map(m => m.text).join(' · ').slice(-800);
  ES.chatAsk = { n, id, text };
  ES.chatWaiting = true; ES.chatPending = null; $('chatsend').disabled = true; chatSay('ai', 'Planning your Reel: checking every clip', true);
  ES.dirFailedKey = ''; paceFailedKey = '';
  const asked = ES.chatMsgs.length;
  makeEdit();
  // an answer that never comes (the AI waits for the clips' check, or nothing was asked): not a spinner for ever
  setTimeout(() => { if(ES.chatWaiting && ES.chatMsgs.length === asked) chatFail(ES.dirBusy || ES.paceBusy ? 'Still working on it… it is taking longer than usual. I\'ll keep going; you can ask again in a moment.' : 'Your Reel is updated.'); }, 120000);
}
// the chat's messages live where it is used: in the Ask Shubix bar under the title (the Create steps), or in the chat panel
function chatInline(on){
  const log = $('chatlog'), home = on ? $('askbody') : $('chatbox');
  if(log.parentElement === home) return;
  if(on) home.insertBefore(log, home.firstChild); else home.insertBefore(log, $('chatbox').querySelector('.chatideas'));
  $('askbar').classList.toggle('talking', on && !!log.children.length);
}
function chatOpen(on){ if(on) chatInline(false); $('chatfab').classList.remove('news'); $('tbchat').classList.remove('news'); $('chatbox').hidden = !on; $('chatfab').setAttribute('aria-expanded', String(on)); $('chatfab').hidden = on;
  if(on){ if(!ES.chatMsgs.length && !$('chatlog').children.length) chatSay('ai', 'Hi! Tell me how you want this Reel: the mood, the pace, which moments, zooms, transitions, slow-mo… I\'ll edit it that way.'); $('chatin').focus(); } }
// the Ask Shubix bar under the page title (the Create steps): opens on a tap, ready to type; the talk stays in it (no panel)
const inSteps = () => root.classList.contains('fopen') && getComputedStyle($('askbar')).display !== 'none';
function askBar(on, focus = true){
  $('askbar').classList.toggle('open', on); $('asktoggle').setAttribute('aria-expanded', String(on));
  if(on){ chatOpen(false); chatInline(true); if(focus) setTimeout(() => { $('askbar').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); $('askin').focus(); }, 60); }
}
const askFromBar = (text) => { text = String(text || '').trim(); if(!text){ $('askin').focus(); return; } if(ES.chatWaiting) return; $('askin').value = ''; askBar(true, false); chatSend(text); $('askbar').classList.add('talking'); };
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
let dirPlannedReel = '', aiGaveUp = ''; ES.director = null; ES.dirBusy = false; ES.dirFailedKey = ''; ES.dirCands = null;   // dirPlannedReel: this Reel got a plan (its credits are spent)
const dirKey = () => [ES.wish, ES.tplKind, ES.mode, ES.mode === 'copy' && ES.refProfile ? ES.refProfile.name + '|' + ES.refProfile.dur : '', ES.mixNo, ES.plan.length, ES.plan.map(s=>s.start.toFixed(2)).join(','), sources.map(fpOf).join(';')].join('#');
ES.mixNo = 0;   // which mix: 0 = the AI's plan, 1-4 = its other mixes (one call), then the phone's own mixes in its style
const dirSlotOf = i => { const d = (ES.aiOn && ES.director && ES.director.key===dirKey() && ES.director.slots[i]) || null; return d && !d.auto ? d : null; };   // an auto cut: the phone picks its moment too
const dirShot = i => { const d = dirSlotOf(i); return d && d.cand ? d.cand : null; };
// the beat shapes and beat effects (drawn in drawFrameGL; see shapeAt)
const BEAT_FX = ['boxgrow','grid','strips','circle','heartbeat','starbeat','frame','mirror','kaleido','triple','vhs','strobe','rgbpulse','blurpulse'];
const FX_OK = { smooth: ['none','pan-soft','drift'], auto: ['none','zoomburst','punch','punch-soft','tilt','shake','bounce','pan','pan-soft','drift','snap'], fast: ['none','zoomburst','punch','punch-soft','tilt','shake','bounce','pan','pan-soft','drift','snap'] };
FX_OK.auto.push(...BEAT_FX); FX_OK.fast.push(...BEAT_FX); FX_OK.smooth.push('frame', 'circle');
FX_OK.copy = FX_OK.auto;
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
// per shot, once its footage is chosen (before its keyframes are made): zooms on drops only and never two in a row, gentle
// moves on long shots, at most a third of the shots moving; photos always move gently (a still photo looks stopped)
function tasteFx(e, i, t){
  if(ES.mode === 'copy' || aiTrusted()) return;
  const len = e.end - e.start, photo = root.classList.contains('photomode');
  if(BEAT_FX.includes(e.efx)){ if(ES.mode === 'fast' && e.type === 'drop' && !t.shape) t.shape = true; else e.efx = 'none'; }
  if(e.efx === 'hook' && i > 0) e.efx = 'none';
  if(e.type === 'drop' && i > 0 && len >= 0.4 && e.efx !== 'snap' && !BEAT_FX.includes(e.efx)) e.efx = ES.mode === 'smooth' ? 'zoomburst' : recipeNow().zoom;
  if(ZOOM_FX.has(e.efx)){
    const ok = e.type === 'drop' || (ES.mode === 'fast' && e.type === 'hit' && !t.prevZoom && e.start - t.lastZoom >= 3 && !(t.drops || []).some(d => d > e.start && d - e.start < 3));
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
// The AI's plans, kept per song, clips and style (not per part of the song): moving the song's part fits them to the
// new cuts on this phone (by what the music does under each cut), and New mix uses the AI's other mixes, asked once.
// The AI is asked again only for a new song, other clips or another style.
const VARIANTS = 4;
const aiMixes = new Map();   // dirBase -> { plans: [{ slots, ctx, sig, story }] by mix, asked, busy }
const dirBase = () => [ES.wish, ES.mode, ES.mode === 'copy' && ES.refProfile ? ES.refProfile.name + '|' + ES.refProfile.dur : '', sources.map(fpOf).join(';'), ES.song ? ES.song.key : ''].join('#');
const planSig = () => ES.plan.length + ':' + ES.plan.map(s=>s.start.toFixed(2)).join(',');
/* ---- every Reel feels new: the tools each finished Reel used are kept on the phone (last 6 Reels) and the AI is told
 * which ones this creator used lately, most used first, so it makes other choices ---- */
const RECENT_KEY = 'brs-recent-tools';
function recentTools(){ let L = []; try{ L = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); }catch(e){}
  const n = new Map(); for(const r of Array.isArray(L) ? L : []) for(const k of r) n.set(k, (n.get(k) || 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k]) => k); }
function rememberTools(){ if(!ES.edit.length) return; const used = new Set();
  for(const e of ES.edit){ if(e.tr && e.tr !== 'hard') used.add(e.tr); if(e.efx && e.efx !== 'none') used.add(e.efx); if(e.sp && e.sp.label && e.sp.label !== '1×') used.add('speed ' + e.sp.label); }
  try{ const L = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); L.push([...used].slice(0, 30)); localStorage.setItem(RECENT_KEY, JSON.stringify(L.slice(-6))); }catch(e){} }
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
  if(ES.mixNo > 0 && ES.buf && sources.length && !ES.recording) makeEdit();
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
ES.smapKey = ''; ES.smapVal = null;
/* ---- the AI's first decision: how fast to cut in each section of the song ----
   The phone splits the song into sections (at drops, breaks and big changes) and describes each; the AI chooses a cut
   every 1, 2, 4 or 8 beats per section; the cuts then land on the real beats (repace). The edit on screen does not wait:
   the phone's own pace shows first and the AI's replaces it when it arrives. */
let paceFailedKey = ''; ES.pacing = null; ES.paceBusy = false;
const paceCache = new Map();
const paceKey = () => [ES.wish, ES.tplKind, ES.musicKey, ES.mode, ES.mode === 'copy' && ES.refProfile ? ES.refProfile.name + '|' + ES.refProfile.dur : '', root.classList.contains('photomode') ? 'p' : 'v', sources.length, Math.round(sources.reduce((a,s)=>a+(s.removed?0:s.dur||0),0))].join('#');
const paceUsable = () => ES.aiOn && ES.kind !== 'talk' && ES.buf && ES.beats.length >= 8 && sources.length && !ES.recording && !(ES.mode === 'copy' && ES.refProfile);   // a copied Reel keeps its own rhythm
const paceNow = () => (paceUsable() && ES.pacing && ES.pacing.key === paceKey()) ? ES.pacing : null;
const paceWanted = () => paceUsable() && !paceNow() && paceFailedKey !== paceKey();
// The pace is asked for every section of the whole song (when a part of it is used), so moving the part needs no new
// question: each of the part's sections takes the pace of the song's section it lies in.
const songPace = new Map();   // paceSongKey -> { secs: [{ t, len, every }] in the song's time, story }
const paceSongKey = () => ES.song ? [ES.song.key, ES.mode, ES.mode === 'copy' && ES.refProfile ? ES.refProfile.name + '|' + ES.refProfile.dur : '', root.classList.contains('photomode') ? 'p' : 'v', sources.length, Math.round(sources.reduce((a,s)=>a+(s.removed?0:s.dur||0),0))].join('#') : '';
const partOn = () => !!ES.song && ES.buf !== ES.song.buf;
ES.wholeMapKey = ''; ES.wholeMap = null;
async function paceRun(key){
  const sm = getSoundMap(); if(!sm){ paceFailedKey = key; return; }
  const whole = wholeSections(), songKey = paceSongKey();
  const secs = whole || sectionsOf(sm, ES.basePlan, ES.beats, ES.period, ES.buf.duration).slice(0, 24);
  if(!secs.length){ paceFailedKey = key; return; }
  ES.paceBusy = true; aiStat('Shubix is listening to the song and choosing the pace…');
  const tm = timeoutSignal(25000);
  try{
    const req = { mode: ES.mode, reelId: reelIdNow(), ...(ES.tplKind ? { reelKind: ES.tplKind } : {}), wish: ES.wish.slice(-800), duration: +(whole ? ES.song.buf.duration : ES.buf.duration).toFixed(2), bpm: +(60/(whole ? ES.song.r.period : ES.period)).toFixed(1), clips: sources.filter(s=>!s.removed).length,
      footage: +sources.reduce((a,s)=>a+(s.removed?0:s.dur||0),0).toFixed(1), kind: root.classList.contains('photomode') ? 'photo' : 'music', sections: secs, reference: refContext(),
      ...(whole ? { reel: +ES.buf.duration.toFixed(2) } : {}) };
    const r = await fetch('/api/studio/pace', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(req), signal: tm.signal });
    const res = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error((res.error && res.error.message) || ('Shubix could not choose the pace (' + r.status + ').'));
    const every = new Map((res.sections || []).map(x=>[x.i, x.every]));
    const answer = secs.map(s=>({ t: s.t, len: s.len, every: every.get(s.i) || s.now }));
    if(whole) songPace.set(songKey, { secs: answer, story: res.story || '' });   // kept even if the part moved meanwhile
    if(paceKey() !== key){ ES.paceBusy = false; if(ES.buf && sources.length && !ES.recording) paceMaybe(); return; }
    if(whole){ const p = paceFromSong(songPace.get(songKey)); ES.pacing = p ? { key, ...p, why: res.sections || [] } : null; }
    else ES.pacing = { key, story: res.story || '', secs: answer, why: res.sections || [] };
    if(!ES.pacing){ paceFailedKey = key; ES.paceBusy = false; return; }
    paceCache.set(key, ES.pacing);
    aiStat('Shubix chose the pace' + (ES.pacing.story ? ': ' + ES.pacing.story : '') + '. Now planning the shots…');
    ES.paceBusy = false; makeEdit();
  }catch(e){
    paceFailedKey = key;
    if(!(e && e.name==='AbortError') || tm.timedOut()) console.warn('AI pace not used:', e);
    ES.paceBusy = false; if(ES.buf && sources.length && !ES.recording) directorMaybe();
    // the director did not start (already planned, or no edit yet): the line must not stay on "choosing the pace…"
    if(!ES.dirBusy && /…$/.test($('aistat').textContent || '')) aiStat('Your Reel keeps the song\'s own pace.');
  }finally{ ES.paceBusy = false; tm.done(); }
}
async function directorRun(key){
  ES.dirBusy = true; aiStat('Shubix is choosing every shot, transition and effect…');
  // 45 s: the phone's own edit is shown and the person can go on; the request is NOT dropped (the plan is paid for): when it
  // comes later it is offered ("Use it"). 4 min: given up (the server's AI gives up before that and the credits come back).
  const tm = timeoutSignal(240000);
  let late = false;
  const soft = setTimeout(() => { late = true; ES.dirBusy = false; ES.dirFailedKey = key;
    aiStat('Shubix is taking longer than usual. Your Reel uses the phone\'s own smart edit for now; Shubix\'s plan comes as soon as it is ready.'); }, 45000);
  try{
    const cands = directorCandidates(); ES.dirCands = cands;
    const { req, ctx } = dirRequest(cands), sig = planSig(), mix = ES.mixNo, st = mixStore();
    const r = await fetch('/api/studio/direct', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(req), signal: tm.signal });
    const res = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error((res.error && res.error.message) || ('Shubix could not plan the Reel (' + r.status + ').'));
    const slots = toSlots(res.slots, cands);
    if(!slots.some(x => x && !x.auto)) throw new Error('Shubix returned no usable plan.');
    chatSync(res); if(typeof res.balance === 'number' && aiInfo){ aiInfo.balance = res.balance; window.dispatchEvent(new Event('brs-credits')); }
    if(ES.chatAsk && req.chat) ES.chatAsk = null;   // that chat message is answered (and charged once)
    if(!st.plans[mix]) st.plans[mix] = { slots, ctx, sig, story: res.story || '' };   // kept for the song's other parts
    if(late){
      // it came after the phone's edit was shown: offered, never swapped in under the person (or during an export)
      clearTimeout(soft);
      dirPlannedReel = reelIdNow();
      const use = () => { if(ES.recording || ES.exportBusy) return; ES.dirFailedKey = ''; if(dirKey() === key){ if(dirArrived(key, { slots, story: res.story || '', texts: res.texts, actions: res.actions })) makeEdit(); } else if(ES.buf && sources.length) directorMaybe(); };
      aiStat('Shubix\'s plan for your Reel is ready.');
      notifyAct('Shubix\'s plan for your Reel is ready.', 'Use it', use, 60000);
      return;
    }
    // the edit changed meanwhile (the song's part moved): the plan is fitted to it, or a new one asked (other clips)
    if(dirKey() !== key){ ES.dirBusy = false; if(ES.buf && sources.length && !ES.recording) directorMaybe(); return; }
    ES.dirBusy = false; dirPlannedReel = reelIdNow();
    if(dirArrived(key, { slots, story: res.story || '', texts: res.texts, actions: res.actions })) makeEdit();
  }catch(e){
    ES.dirFailedKey = key;
    const back = aiCostOf('reel') && dirPlannedReel !== reelIdNow() ? ', and the credits for it come back.' : '.';
    if(late){ aiStat('Shubix could not plan this Reel. It keeps the phone\'s own smart edit' + back); }
    else {
      chatFail(tm.timedOut() ? 'Shubix took too long this time. Try again in a moment.' : 'Shubix could not change the Reel right now. Try again in a moment.');
      if(tm.timedOut()) aiStat('Shubix took too long this time. Your Reel uses the phone\'s own smart edit' + back);
      else if(!(e && e.name==='AbortError')){ console.warn('AI director not used:', e); aiStat('Shubix is busy right now. Your Reel uses the phone\'s own smart edit' + back); }
    }
  }finally{ clearTimeout(soft); if(!late) ES.dirBusy = false; tm.done(); }
}
// is the studio's AI on? The administrator decides (Administration -> Features -> AI director) and the server has an AI
// provider; people never choose: when it is on, every Reel is edited by the AI. Asked at the start, and again when the
// person's account becomes known (the phone app signs the hidden studio in after it has started: account())
async function aiCheck(){
  try{
    const r = await fetch('/api/studio/rank-shots', ac ? { signal: ac.signal } : undefined); if(!r.ok) return;
    aiInfo = await r.json(); aiLocked = false; if(!aiInfo || !aiInfo.available){ ES.aiOn = false; return; }
    // a plan without Shubix AI (Free): the phone edits; the chat and the plans say how to get it
    if(aiInfo.planAi === false){ ES.aiOn = false; aiLocked = true; aiStat(IN_APP ? 'Edited on your phone' : 'Edited on your phone · Shubix AI is in the Editor and Pro plans'); return; }
    if(ES.aiOn) return;
    ES.aiOn = true;
    // a template's learned style was put on before the AI was known: the AI combines it now (its trend, this song)
    if(ES.refProfile && ES.refProfile.learned && ES.refProfile.byTpl){ const sh = ES.refProfile.shown || 'auto'; ES.refProfile = null; learnedKind = ''; if(ES.mode === 'copy') setMode(sh); }
    const pressed = [...$('mode').children].find(x => x.getAttribute('aria-pressed') === 'true');
    modeWords(pressed ? pressed.dataset.m : ES.mode);
    if(sources.length && !aiHeld) aiRun();
  }catch(e){}
}
aiCheck();
// Should this shot get a zoom effect at all? A punch on a big face or on footage that already moves a lot looks messy,
// and a punch in the middle of a long calm shot is out of place: those get a softer move instead.
// how good footage [a, a+need] of src is for cut i (the rules, plus the AI's opinion of the moment when it is on)
// a clip that is bad all through (shaky handheld, out of focus) looks fine next to itself: judged against the other
// clips. Shaky = the camera's own movement jumps around from frame to frame; soft = far fewer fine edges than the rest.
/* ---- Enough clips for the Reel? (Create) Once the clips are read, and again when the Reel's length or part changes:
 * the good footage (sharp, lit moments: the clip's own reading) against the Reel's length. Enough: said once, OK. Not
 * enough: said plainly, with the way out (a shorter Reel on the music page, or more clips), so the Reel is never filled
 * by repeating moments or slowing clips down. ---- */
const fmtS = s => s >= 60 ? Math.floor(s/60) + ':' + String(Math.round(s % 60)).padStart(2, '0') + ' min' : Math.round(s) + ' s';
let footTimer = 0, footSaid = '';
function footCheckSoon(){ if(!location.pathname.startsWith('/create') || ES.kind === 'talk') return; clearTimeout(footTimer); footTimer = setTimeout(footCheck, 900); }
async function footCheck(){
  if(ordering || ES.pending || !ES.buf || !sources.length || !$('cconf').hidden) { if(ordering || ES.pending) footCheckSoon(); return; }
  const need = ES.buf.duration, have = Math.floor(sources.reduce((t, s) => t + goodSecs(s), 0)), n = sources.length;   // whole seconds, said the same way everywhere
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
ES.remakeAfterExport = false;
/* ---- Clip order: "Mix all clips" (the best moments of every clip, anywhere in the Reel) or "In my order" (the clips one
 * after another, as they were added: each gets a share of the shots by its length, and its moments go in time order) ---- */
ES.seqOn = false;
// In my order, the moments: each clip is walked forward only (a shot starts where the one before it in that clip ended, so
// no moment is ever used twice, and a clip once left is never come back to); a normal shot takes its clip's best moment
// within its share of what is left. In a fast part of the song (4 or more cuts in a row, each 0.5 s or less) the shots
// run on through the clip sped up (up to 40x, like a video app; the export takes the exact frame for every moment, the
// preview steps through the frames above 16x: rawRate), back to normal after it.
// A clip too short for its shots plays a little slower instead of repeating.
const SEQ_FAST = 0.5, SEQ_MAX = 40;
function setSeq(on, remake = true){
  ES.seqOn = on; root.classList.toggle('seqon', on);
  [...$('seq').children].forEach(x => x.setAttribute('aria-pressed', String((x.dataset.q === 'order') === on)));
  $('seqhelp').textContent = on ? 'Your clips play one after another, in the order you added them' : 'Shubix picks the best moments from all your clips';
  wipNote();
  if(remake && ES.buf && sources.length && ES.kind !== 'talk' && !ES.restoring) makeEdit();
}
$('seq').addEventListener('click', e => { const b = e.target.closest('button'); if(b && !ES.recording) remakeOk(); if(b && !ES.recording) setSeq(b.dataset.q === 'order'); }, SIG);
// the page's side of making a Reel (brain/reel.ts asks for these)
const ON_PHONE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
function editShown(dupCount){
  $('s3').classList.remove('locked'); $('s3').classList.add('done');
  const total = sources.reduce((a,s)=>a+s.dur,0);
  $('s3st').textContent = ES.edit.length + ' shots · ' + fmt(ES.buf.duration) + (dupCount ? ' · ' + dupCount + ' shots reused (not enough footage)' : ' · no repeated moments');
  showCopyMatch();
  if(dupCount) showMsg(dupCount + ' shot' + (dupCount>1?'s repeat':' repeats') + ': your clips are short for this song · add more clips to avoid it', false, 'addclips');
  else $('xmsg').hidden = true;
  ['play','remix','export','cover'].forEach(id=>$(id).disabled=false);
}
function tellReadyIfAway(){
  if(isHidden() && !aiBusy && !ES.dirBusy && !ES.paceBusy && readyToldGen !== reelIdNow()){ readyToldGen = reelIdNow(); void notifyDone('Your Reel is ready', 'Tap to preview it in Shubix', 'shubix-reel'); }
}
function copyLookSoon(){ if(ES.look === 'copy' && ES.refProfile) setTimeout(()=>{ copyLook(); }, 0); }
function captureLoop(){
  if(!ES.edit.length) return;
  // the edit made again (a late AI answer, New mix): the playhead stays where the creator left it
  const at = () => ES.pos > 0.31 && ES.buf && ES.pos < ES.buf.duration - 0.05 ? ES.pos : 0.3;
  return prepare(0, 0.6).then(()=>{ loopImg=null; const sv=ES.showSafe, h=ES.hookText; ES.showSafe=false; ES.hookText=''; drawFrame(0.6);
    const c=document.createElement('canvas'); c.width=out.width; c.height=out.height; c.getContext('2d').drawImage(out,0,0); loopImg=c;
    ES.showSafe=sv; ES.hookText=h; ES.pos = at(); return prepare(segAt(ES.pos), ES.pos); }).then(()=>{ drawFrame(ES.pos); if(kfOpen()) kfSync(); });
}
/* ---- manual control: change any shot, the rest stays ---- */
const SPEED_KEYS = {normal:'1×', slow:'Slow 0.5×', fast:'Fast 1.6×', velocity:'Velocity (beat)', ramp:'Ramp 1.8×→0.6×', freeze:'Freeze → 1×', hold:'Freeze frame'};
const holdSpeed = {label:'Freeze frame', at:()=>0, pos:()=>0};   // the picture stands still for the whole shot
SPEED_KEYS.curve = 'Custom curve';
const speedKey = sp => (Object.keys(SPEED_KEYS).find(k=>SPEED_KEYS[k]===sp.label) || (sp.label.startsWith('Ramp') ? 'ramp' : 'normal'));
/* ---- shot tools (as in every editor): split, duplicate, delete, replace. The song's timing stays: a shot's time goes to
 * its neighbours, so the Reel keeps its length and every cut stays on the beat. ---- */
const MIN_SHOT = 0.3;
// Undo / Redo: a step is kept each time the edit or the texts change (any control, a new mix, a split…). The list starts
// again when the song or the clips change, because an older edit would not fit them.
const hist = { u: [], r: [], cur: null, cand: '', base: '' };
const HIST_MAX = 60;
const lyOf = () => ES.layers.map(L => { const c = JSON.parse(JSON.stringify({ ...L, fc: undefined })); return c; });
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
  ES.edit.forEach((e,i)=>{
    const tr=document.createElement('tr');
    tr.innerHTML = `<td class="t">${fmt(e.start)}<br><span style="color:var(--muted)">${(e.end-e.start).toFixed(2)}s</span></td><td><span class="pill" style="background:var(${TCOL[e.type]})">${TNAME[e.type]}</span>${e.face>0.3?'<br><span title="face in shot">🙂</span>':''}</td><td class="clipc"></td><td></td><td></td><td></td>`;
    const cc = tr.children[2]; const nm = document.createElement('span'); nm.textContent = sources[e.src].name.replace(/\.[^.]+$/,'') + ' @ ' + e.in.toFixed(1) + 's'; cc.appendChild(nm);
    const rb = document.createElement('button'); rb.className='mini'; rb.textContent='↻ other moment'; rb.title='Use a different moment here (never a repeat)';
    rb.addEventListener('click', ev=>{ ev.stopPropagation(); stopAll(); if(repick(i, true)){ renderEDL(true); showShot(i); } else showMsg('No unused footage left for this shot. Add more clips.', true); });
    cc.appendChild(document.createElement('br')); cc.appendChild(rb);
    tr.children[3].appendChild(sel(crownMap('tr', TR_NAME), e.tr, v=>{ noteEdit(e.type, 'tr', e.tr, v, e.trByDir); e.tr=v; e.trByDir=false; changed(i,false); }));
    const fxc = tr.children[4]; fxc.appendChild(sel(crownMap('fx', FX_NAME), e.efx, v=>{ noteEdit(e.type, 'efx', e.efx, v, e.fxByDir); e.efx=v; e.fxByDir=false; if(v==='snap'){ e.sp=snapSpeed; changed(i,true); } else { if(e.sp===snapSpeed) e.sp=SPEED.normal; changed(i,true); } }));
    fxc.insertAdjacentHTML('beforeend', kfSummary(e));
    tr.children[5].appendChild(sel(SPEED_KEYS, speedKey(e.sp), v=>{ noteEdit(e.type, 'sp', speedKey(e.sp), v, e.dirWhy && ES.aiOn); e.sp = speedFor(v, e); changed(i,true); }));
    tr.addEventListener('click', ()=>{ if(ES.playing) startPlayback(e.start); else showShot(i); });
    tb.appendChild(tr);
  });
  if(keepScroll) box.scrollTop = sc;
  drawTimeline();
}
// the clips' colours on the timelines (muted, as in the studio's design)
const CLIP_COL = ['#6b5540','#46596a','#5a4766','#476452','#6e4a44','#5f5a3c','#3f5d63','#6a5a2e'];
// timeline strip: one block per shot, coloured by clip, marker colour = shot type
function drawTimeline(){
  const cv = $('tl'); if(!cv || !ES.buf) return;
  const dpr = window.devicePixelRatio||1, w = Math.max(1,Math.round(cv.clientWidth*dpr)), h = Math.round(46*dpr);
  cv.width=w; cv.height=h; const g=cv.getContext('2d'); g.clearRect(0,0,w,h);
  const D = ES.buf.duration;
  ES.edit.forEach((e,i)=>{ const x0 = e.start/D*w, x1 = e.end/D*w;
    g.fillStyle = CLIP_COL[e.src % CLIP_COL.length]; g.fillRect(x0+dpr*0.5, 10*dpr, Math.max(1,x1-x0-dpr), h-12*dpr);
    g.fillStyle = css(TCOL[e.type]); g.fillRect(x0, 0, Math.max(2*dpr, 3*dpr), 8*dpr);
    if(e.sp.label!=='1×'){ g.fillStyle='rgba(0,0,0,0.35)'; g.fillRect(x0+dpr, h-7*dpr, Math.max(1,x1-x0-2*dpr), 5*dpr); }
    if(e.uk && e.uk.length){ const cx = (x0+x1)/2, cy = h/2 + 5*dpr, r = 5*dpr; g.beginPath(); g.moveTo(cx, cy-r); g.lineTo(cx+r, cy); g.lineTo(cx, cy+r); g.lineTo(cx-r, cy); g.closePath(); g.fillStyle = '#FFD54A'; g.fill(); g.strokeStyle = '#000'; g.lineWidth = dpr; g.stroke(); } });
  for(const m of ES.userMarks){ const x = (m - ES.secStart)/D*w; if(x >= 0 && x <= w){ g.fillStyle = '#FFD54A'; g.beginPath(); g.moveTo(x - 4*dpr, 0); g.lineTo(x + 4*dpr, 0); g.lineTo(x, 7*dpr); g.closePath(); g.fill(); } }
  const t = ES.playing ? curTime() : ES.pos; g.fillStyle = css('--ink'); g.fillRect(Math.round(t/D*w)-dpr, 0, 2*dpr, h);
  if(tlZoom > 1){ const sc = cv.parentElement, px = t/D*cv.clientWidth; if(sc && (px < sc.scrollLeft + 20 || px > sc.scrollLeft + sc.clientWidth - 20)) sc.scrollLeft = px - sc.clientWidth/2; }
}
/* timeline zoom: 1x shows the whole Reel; 2x-8x widen the shot strip and the lanes, which then scroll and follow the playhead */
let tlZoom = 1;
// (the tracks under the preview zoom inside their own canvas, with a pinch or − / +: components/studio/views.ts)
function setTlZoom(z){ tlZoom = Math.max(1, Math.min(8, z)); const c = $('tl'); if(c) c.style.width = (tlZoom*100) + '%';
  root.classList.toggle('tlzoomed', tlZoom > 1); drawTimeline(); }
$('addbeat').addEventListener('click', () => addMark(ES.playing ? curTime() : ES.pos), SIG);
$('delbeat').addEventListener('click', () => delMark(ES.playing ? curTime() : ES.pos), SIG);
$('clrbeat').addEventListener('click', () => clearMarks(), SIG);
$('tl').addEventListener('click', ev=>{ if(!ES.edit.length) return; const r=$('tl').getBoundingClientRect(), tt=(ev.clientX-r.left)/r.width*ES.buf.duration;
  const i = segAt(tt); if(ES.playing) startPlayback(tt); else { const rows=$('edl').children; rows[i] && rows[i].scrollIntoView({block:'nearest'}); showShot(i); } });
$('remix').onclick = remixNow;

/* =============== RENDERER =============== */
const out = $('out'), og = out.getContext('2d');
// The live preview draws at half size (540×960 for a Reel): a quarter of the pixels, so it stays smooth on phones.
// Export and the cover switch to the full 1080p size.
const PREVIEW_SCALE = 0.5;
function setCanvas(full, scale = 1){ const [W0,H0]=SIZES[ES.aspect], s = full ? scale : PREVIEW_SCALE, w = Math.round(W0*s/2)*2, h = Math.round(H0*s/2)*2;
  if(out.width!==w||out.height!==h){ out.width=w; out.height=h; loopImg=null; } }
const playerLoaded = v => !!v.getAttribute('src');
function playersAround(i){
  const c = ES.playing || ES.starting ? curIdx : i, keep = new Set();
  for(let k = Math.min(c, i) - 1; k <= Math.max(c, i) + 2; k++) if(ES.edit[k]) keep.add(ES.edit[k].el);
  for(const s of sources) for(const v of s.els || []) if(!keep.has(v) && playerLoaded(v)){ v.pause(); v.removeAttribute('src'); v.load(); }
  const v = ES.edit[i].el; if(!playerLoaded(v) && v._url) v.src = v._url;
}
// quick: Play is waiting. Then the picture gets at most a moment: while clips are being read the phone's video decoder is
// busy (an iPhone may not answer at all), and the song must start anyway; the shot catches up while it plays.
async function prepare(i, t, quick){
  const e = ES.edit[i]; if(!e) return;
  if(ES.layers.length && !ES.playing) await prepLayers(t);
  if(e !== ES.edit[i]) return;
  playersAround(i);
  const local = Math.max(0, t - e.start), target = srcPos(e, local);
  // A cold decoder often needs longer than 600 ms (especially the first 4K/HEVC preview). Wait for a real frame before starting audio, rather than letting the picture catch up with a visible hitch.
  if(e.el.readyState < 2){ try{ await videoData(e.el, quick ? 700 : 6000); }catch(err){} }
  e.el.pause(); const r0 = rateAt(e, local); if(r0>0) e.el.playbackRate = r0;
  if(Math.abs(e.el.currentTime - target) > 0.04){ e.el.currentTime = target; try{ await waitEv(e.el,'seeked', quick ? 650 : 4000); }catch(err){} }
}
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
let loopImg = null, holdText = false; ES.look = 'vivid'; ES.showSafe = true; ES.hookText = '';
const bufA = document.createElement('canvas'), gA = bufA.getContext('2d');
const bufB = document.createElement('canvas'), gB = bufB.getContext('2d');
function fitBufs(){ [bufA,bufB].forEach(b=>{ if(b.width!==out.width||b.height!==out.height){ b.width=out.width; b.height=out.height; } }); }

// The beat pulse of a shot (bounce, Ken Burns): a small zoom and a soft light on its beats, never closer than 0.4 s (a fast
// song pulses on every other beat). Before, every beat gave a 4.5% zoom and a bright flash, 2-3 times a second on nearly
// every shot: the Reel looked like it was vibrating.
const PULSE_GAP = 0.4;
// the song's strong hits (its top third by strength): the beat bounce follows these, not every small beat underneath
// (a song with a busy background otherwise pulses the picture all the time, which reads as the video vibrating)
ES.strongFor = null; ES.strongList = [];
// draw one shot with its keyframed properties into context g
function drawShot(g, e, local, o={}){
  const W=out.width, H=out.height, v=texOf(e, local), L=e.end-e.start;
  if(e.black){ g.save(); g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.restore(); return; }   // the copied Reel's black end
  if(e.flick && ES.flickPool.length){ g.save(); g.globalAlpha = o.alpha ?? 1; g.filter = LOOKS[ES.look].filter; g.drawImage(v, 0, 0, W, H); g.restore(); return; }   // a flicker's still fills the frame
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
  const cs0 = csOf(e, local); let stab = null;
  if(cs0.stab > 0 && !o.noStab){ stab = stabAt(sources[e.src], srcPos(e, local)); scale *= 1 + 0.12*cs0.stab; }
  const G = csGeom(e, scale, local), c = G.c, dw = G.dw, dh = G.dh, [ccx, ccy] = csCam(e, local, c);
  if(stab){ x += stab[0]*dw*cs0.stab; y += stab[1]*dh*cs0.stab; }
  let px = W/2 - ccx*dw; px = panClamp(px, W, dw) + x;
  let py0 = H/2 - ccy*dh; py0 = panClamp(py0, H, dh);
  const py = py0 + y;
  const alpha = (o.alpha ?? 1) * (u ? Math.max(0, Math.min(1, u.o)) : 1);
  const paint = (gg, a, extra=1, ox=0, oy=0) => {
    gg.save(); gg.globalAlpha = a;
    if(ux || uy) gg.translate(ux, uy);   // the creator's move: after the turn, so a moved shot turns about its own middle
    if(rot || extra!==1){ gg.translate(W/2,H/2); gg.rotate(rot*Math.PI/180); gg.scale(extra,extra); gg.translate(-W/2,-H/2); }
    gg.filter = LOOKS[ES.look].filter + csFilter(c); csDraw(gg, v, c, px+ox, py+oy, dw, dh); gg.restore(); };
  // a fitted picture: its canvas (blurred copy or a colour) and border, under the picture
  const canvasBg = (g, alpha) => { if(!c.fit) return;
    g.save(); g.globalAlpha = alpha;
    if(ux || uy) g.translate(ux, uy);
    if(c.bg === 'blur'){ const rb = Math.max(W/G.sw, H/G.sh)*1.12; g.filter = 'blur(' + Math.round(W*0.03) + 'px) brightness(0.62)'; csDraw(g, v, c, W/2 - G.sw*rb/2, H/2 - G.sh*rb/2, G.sw*rb, G.sh*rb); g.filter = 'none'; }
    else if(CANVAS_PATS.includes(c.bg)) canvasPat(g, W, H, c.bg, c.bgc);
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
// the canvas patterns (the same as the GPU's pat()): the colour and a lighter one, sized to a 1080-wide frame
const CANVAS_PATS = ['grad','stripes','dots','grid','checker'];
function canvasPat(g, W, H, k, col){
  const [r, gg, b] = hexRgb(col), L = `rgb(${[r, gg, b].map(v => Math.round((v + (1 - v)*0.35)*255)).join(',')})`, z = W/1080;
  if(k === 'grad'){ const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, L); gr.addColorStop(1, `rgb(${[r, gg, b].map(v => Math.round(v*0.55*255)).join(',')})`); g.fillStyle = gr; g.fillRect(-W, -H, 3*W, 3*H); return; }
  g.fillStyle = L; g.fillRect(-W, -H, 3*W, 3*H); g.fillStyle = col;
  if(k === 'stripes'){ g.save(); g.beginPath(); for(let d = -H; d < W + H; d += 80*z){ g.moveTo(d + 40*z, 0); g.lineTo(d + 80*z, 0); g.lineTo(d + 80*z - H, H); g.lineTo(d + 40*z - H, H); } g.fill(); g.restore(); }
  else if(k === 'dots'){ g.fillRect(-W, -H, 3*W, 3*H); g.fillStyle = L; for(let y = 30*z; y < H + 60*z; y += 60*z) for(let x = 30*z; x < W + 60*z; x += 60*z){ g.beginPath(); g.arc(x, y, 14*z, 0, 7); g.fill(); } }
  else if(k === 'grid'){ g.fillRect(-W, -H, 3*W, 3*H); g.fillStyle = L; for(let x = 0; x < W; x += 64*z) g.fillRect(x, 0, 4*z, H); for(let y = 0; y < H; y += 64*z) g.fillRect(0, y, W, 4*z); }
  else for(let y = 0, j = 0; y < H; y += 72*z, j++) for(let x = 0, i = 0; x < W; x += 72*z, i++) if((i + j) % 2) g.fillRect(x, y, 72*z, 72*z);
}
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
ES.lmedia = []; ES.layers = []; ES.lySeq = 0; ES.lySel = -1;
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
const lyOn = (L, t) => t >= L.t0 && t < L.t1;
const lyTime = (L, t) => L.in + (t - L.t0);
// the layer's picture, cropped, masked and faded, in its own canvas; then placed on the frame
const gifFrame = (M, t) => { const T = ((t % M.gdur) + M.gdur) % M.gdur; let k = 0; while(k + 1 < M.times.length && M.times[k + 1] <= T) k++; return M.frames[k]; };
function drawLayers(g, t){
  for(const L of ES.layers){ if(!lyOn(L, t)) continue; const M = ES.lmedia[L.m]; if(!M) continue;
    const src = M.kind === 'photo' ? M.img : M.kind === 'gif' ? gifFrame(M, t - L.t0) : ES.exporting ? L.fc : M.el;
    if(!src || (M.kind === 'video' && !ES.exporting && M.el.readyState < 2)) continue;
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
    if(L === ES.layers[ES.lySel] && !ES.exporting && !ES.recording && !ES.playing){   // the chosen layer: a thin frame (preview only)
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
  for(const L of ES.layers){ const M = ES.lmedia[L.m]; if(!M || M.kind !== 'video') continue;
    if(!lyOn(L, t)){ M.el.pause(); continue; }
    M.el.pause(); const want = Math.min(M.dur - 0.05, lyTime(L, t));
    if(Math.abs(M.el.currentTime - want) > 0.04){ M.el.currentTime = want; waits.push(waitEv(M.el, 'seeked', 3000).catch(()=>{})); } }
  await Promise.all(waits);
}
function syncLayers(t){
  for(const L of ES.layers){ const M = ES.lmedia[L.m]; if(!M || M.kind !== 'video') continue;
    if(!lyOn(L, t)){ if(!M.el.paused) M.el.pause(); continue; }
    const want = lyTime(L, t); if(want >= M.dur - 0.05){ if(!M.el.paused) M.el.pause(); continue; }
    if(Math.abs(M.el.currentTime - want) > 0.25) M.el.currentTime = want;
    if(M.el.paused) M.el.play().catch(()=>{}); }
}
const stopLayers = () => ES.lmedia.forEach(M => M.el && M.el.pause());
// layouts: one tap places the chosen layer
const LAYOUTS = { tl:{x:0.27,y:0.2,s:0.42}, tr:{x:0.73,y:0.2,s:0.42}, bl:{x:0.27,y:0.78,s:0.42}, br:{x:0.73,y:0.78,s:0.42}, top:'top', bottom:'bottom', left:'left', right:'right', full:'full' };
function lyUI(){
  const box = $('lylist'); if(!box) return; box.innerHTML = '';
  ES.layers.forEach((L, i) => { const M = ES.lmedia[L.m], b = document.createElement('button'); b.type = 'button'; b.className = 'lyitem'; b.setAttribute('aria-pressed', String(i === ES.lySel));
    b.innerHTML = '<span class="ln"></span><span class="lt"></span>'; b.querySelector('.ln').textContent = (M ? (M.kind === 'photo' ? '🖼 ' : '🎬 ') + M.name.replace(/\.[^.]+$/, '') : 'Missing file');
    b.querySelector('.lt').textContent = fmt(L.t0).replace(/\.\d+$/, '') + '–' + fmt(L.t1).replace(/\.\d+$/, '');
    b.addEventListener('click', () => { ES.lySel = i; lyUI(); ES.pos = Math.max(ES.pos, L.t0); if(!lyOn(L, ES.pos)) ES.pos = L.t0 + 0.05; prepare(segAt(ES.pos), ES.pos).then(() => prepLayers(ES.pos)).then(redrawFrame); });
    box.appendChild(b); });
  const L = ES.layers[ES.lySel], ed = $('lyedit'); ed.hidden = !L; if(!L) return;
  if(!L.key) L.key = { on: false, c: '#00FF00', tol: 0.35 }; if(!L.blend) L.blend = 'source-over';
  const M = ES.lmedia[L.m];
  for(const el of ed.querySelectorAll('[data-ly]')){ const k = el.dataset.ly, v = k.includes('.') ? L[k.split('.')[0]][k.split('.')[1]] : L[k];
    if(el.type === 'checkbox') el.checked = !!v; else el.value = v; const o = el.parentElement.querySelector('output'); if(o) o.textContent = lyFmt(k, +v); }
  [...$('lymask').children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.m === L.mask)));
  $('lymaskopts').hidden = L.mask === 'none'; $('lylumarow').hidden = L.mask !== 'luma'; $('lyvolrow').hidden = !M || M.kind !== 'video';
  $('lytime').textContent = fmt(L.t0) + ' – ' + fmt(L.t1);
}
const lyFmt = (k, v) => /^(x|y|s|op|crop|mk\.(w|h|f|th)|vol)/.test(k) ? Math.round(v*100) + '%' : /^(r|mk\.a)$/.test(k) ? Math.round(v) + '°' : /^(fin|fout|rad)$/.test(k) ? (k === 'rad' ? Math.round(v*100) + '%' : v.toFixed(1) + ' s') : String(v);
$('lyadd').addEventListener('click', () => $('lyfile').click(), SIG);
$('lyfile').addEventListener('change', e => { const f = [...e.target.files]; e.target.value = ''; if(f.length) layerAdd(f); }, SIG);
$('lyedit').addEventListener('input', e => { const el = e.target, k = el.dataset && el.dataset.ly; if(!k) return; const v = el.type === 'checkbox' ? el.checked : el.tagName === 'SELECT' ? el.value : +el.value; lySet(k, v); const o = el.parentElement.querySelector('output'); if(o && el.type !== 'checkbox') o.textContent = lyFmt(k, v); }, SIG);
$('lyedit').addEventListener('click', e => { const t = e.target.closest('button'); if(!t) return; const L = ES.layers[ES.lySel]; if(!L) return;
  if(t.dataset.m){ L.mask = t.dataset.m; lyUI(); redrawFrame(); }
  else if(t.dataset.lay){ layoutLayer(L, t.dataset.lay); lyUI(); redrawFrame(); }
  else if(t.dataset.lyt === 'start'){ L.t0 = Math.min(ES.pos, L.t1 - 0.3); lyUI(); redrawFrame(); }
  else if(t.dataset.lyt === 'end'){ L.t1 = Math.max(ES.pos, L.t0 + 0.3); lyUI(); redrawFrame(); }
  else if(t.dataset.lyt === 'all'){ L.t0 = 0; L.t1 = ES.buf.duration; lyUI(); redrawFrame(); }
  else if(t.dataset.lyf){ L[t.dataset.lyf] = !L[t.dataset.lyf]; redrawFrame(); }
  else if(t.dataset.lykey){ L.key = { ...(L.key || { tol: 0.35 }), on: true, c: t.dataset.lykey }; lyUI(); redrawFrame(); }
  else if(t.dataset.lydel){ ES.layers.splice(ES.lySel, 1); ES.lySel = Math.min(ES.lySel, ES.layers.length - 1); ES.clipMixKey = ''; lyUI(); redrawFrame(); }
}, SIG);
/* ---- text: the hook word by word on the beats, captions of the song word by word ----
   Styles: pop (each word pops in on its beat / when it is sung), karaoke (the line is shown, the sung word lights up),
   box (words on coloured boxes), clean (calm, small). Everything stays inside Instagram's safe area (the top 220 px and
   the bottom 450 px of 1920 are its UI), captions move up when a face is in their way, and Hindi / Marathi (Devanagari)
   are drawn with a font that shapes them. Drawn into the frame itself, so the export has it too. */
ES.textStyle = 'pop'; ES.capWords = null; ES.capsOn = false; ES.capLines = null;
ES.ACCENT = '#FFD54A';   // the captions' highlight (a copied Reel can change it)
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
}   // both ways of exporting (WebCodecs, or in real time)
function drawWatermark(){
  if(!wmImg || !wmImg.complete || !wmImg.naturalWidth) return;
  const W = out.width, H = out.height, w = Math.round(Math.min(W, H*0.5625)*0.24), h = Math.round(w*wmImg.naturalHeight/wmImg.naturalWidth), m = Math.round(Math.min(W, H)*0.035);
  og.save(); og.globalAlpha = 0.85; og.drawImage(wmImg, W - w - m, H - h - m*1.6, w, h); og.restore();
}
/* ---- captions for talking: the key word of each line, highlighted, and a zoom punch on it ----
 * In talking videos and voiceovers one word per caption line is the key word: the one said hardest (its loudness against
 * the line's) that is not a small word, numbers and long words counting a little more. It is drawn in the accent colour,
 * bigger, with an emoji when one fits, and the picture punches in on it (8% over 0.12 s, eased back over 0.6 s). */
ES.keyOn = true;
const STOP = new Set('a an the and or but so to of in on at for with from by is are was were be been am i you he she it we they me my your our this that these those do does did not no yes just very really then than if as up out about into over also can will would there here what when how why who all any some more most much many one'.split(' ')
  .concat('है हैं था थी थे और या के की का को में से पर यह वह ये वो तो भी ही ना न हाँ आणि हे ते ती तो आहे आहेत होता होती चा ची चे ला ने मध्ये पण तर ही'.split(' ')));
const EMOJI = [[/money|paisa|rupee|₹|पैसा|पैसे|रुपये/i, '💰'], [/love|pyaar|प्यार|प्रेम/i, '❤️'], [/tip|idea|trick|hack|secret/i, '💡'], [/fire|hot|viral/i, '🔥'],
  [/fast|quick|speed|जल्दी|लवकर/i, '⚡'], [/food|eat|recipe|खाना|जेवण/i, '🍲'], [/win|best|top|great|amazing|बेस्ट/i, '🏆'], [/wrong|mistake|never|गलत|चूक/i, '❌'], [/right|correct|always|सही|बरोबर/i, '✅'],
  [/time|minute|second|समय|वेळ/i, '⏰'], [/hook|start|first/i, '👀'], [/short|small/i, '✂️'], [/caption|text|write/i, '✍️'], [/ganpati|bappa|गणपती|बाप्पा/i, '🌺'], [/diwali|दिवाळी|दीवाली|दिवाली/i, '🪔']];
$('kwon').addEventListener('change', e => { ES.keyOn = e.target.checked; markKeyWords(ES.capLines); redraw(); }, SIG);
/* ---- translated captions: each caption line also in another language (or only in it) ----
 * The lines the phone already has go to the server once (one text call); each translated line is shown for the same
 * seconds as its original, under it and a little smaller, or alone. Lines already translated are kept (by their text), so
 * a new part of the song or a style change asks for nothing again. */
let trBusy = false; ES.trTo = ''; ES.trOnly = false; const trCache = new Map();
const trOf = line => ES.trTo ? trCache.get(ES.trTo + '|' + line.words.map(w => w.text).join(' ')) : null;
async function translateSoon(){
  if(!ES.trTo || !ES.capLines || !ES.capLines.length || trBusy) return;
  const need = ES.capLines.map(l => l.words.map(w => w.text).join(' ')).filter((t, i, a) => t && a.indexOf(t) === i && !trCache.has(ES.trTo + '|' + t)).slice(0, 120);
  if(!need.length){ redraw(); return; }
  trBusy = true; const to = ES.trTo; capStat('Translating the captions…');
  try{
    const r = await fetch('/api/studio/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to, lines: need.map((text, i) => ({ i, text: text.slice(0, 160) })) }), signal: ac.signal });
    const res = await r.json().catch(() => ({}));
    if(!r.ok) throw new Error((res.error && res.error.message) || ('Translation failed (' + r.status + ').'));
    for(const l of res.lines || []) if(need[l.i] !== undefined) trCache.set(to + '|' + need[l.i], l.text);
    capStat((ES.capWords ? ES.capWords.length + ' words · ' : '') + 'translated');
  }catch(err){ if(!(err && err.name === 'AbortError')) { console.warn('translation failed:', err); capStat('Translation did not work this time. Please try again.', true); } }
  finally{ trBusy = false; if(ES.trTo !== to) translateSoon(); redraw(); }
}
$('captr').addEventListener('change', e => { ES.trTo = e.target.value; $('trwrap').hidden = !ES.trTo; translateSoon(); redraw(); }, SIG);
$('tronly').addEventListener('change', e => { ES.trOnly = e.target.checked; redraw(); }, SIG);

/* ---- text & stickers: anything the creator writes on the Reel ----
 * Each item: text or an emoji, a style (bold outline / box / neon / clean / tag), a colour, an entrance (pop / fade /
 * slide up / typewriter / none, with a short fade out), a time (from / to, or the whole Reel), a place (dragged on the
 * preview, kept inside Instagram's safe area) and a size. Drawn into the frame, so the export has them; Hindi and Marathi
 * are shaped by the Devanagari font stack. Ready-made: a price tag, a follow / save prompt, steps, before / after,
 * festival greetings. */
ES.ovSeq = 0; ES.ovSel = -1; ES.overlays = [];
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
function redrawSoon(){ clearTimeout(redrawSoon.h); redrawSoon.h = setTimeout(() => { if(!ES.playing && ES.edit.length) redraw(); }, 50); }
const ovFont = (ov, fs, weight) => { const f = OV_FONTS[ov.font]; if(!f || !f[1]) return fontFor(ov.text, fs, weight); loadFont(ov.font);
  return `${weight} ${fs}px "${f[0]}", ${isIndic(ov.text) ? '"Noto Sans Devanagari", ' : ''}"Arial Black", sans-serif`; };
const OV_ANIMS = { pop: 'Pop', fade: 'Fade', slide: 'Slide up', type: 'Typewriter', zoom: 'Zoom in', drop: 'Drop in', blur: 'Blur in', spin: 'Spin in', flicker: 'Flicker', glitch: 'Glitch', none: 'None' };
const OV_OUTS = { none: 'None', fade: 'Fade out', pop: 'Pop out', slide: 'Slide down', zoom: 'Zoom out', blur: 'Blur out', spin: 'Spin out' };   // how it leaves (its last 0.3 s)
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
const reelLen = () => (ES.buf ? ES.buf.duration : 0);
function setOverlaysFromNative(list){
  const D = reelLen(), incoming = Array.isArray(list) ? list : [];
  ES.overlays = incoming.map(o => {
    const id = Number.isFinite(Number(o.id)) ? Number(o.id) : ++ES.ovSeq;
    ES.ovSeq = Math.max(ES.ovSeq, id);
    const t0 = Math.max(0, Math.min(D, Number(o.start ?? o.t0) || 0));
    const t1 = Math.max(t0 + 0.05, Math.min(D, Number(o.end ?? o.t1) || D));
    if(o.kind === 'squareFrame') return { ...o, id, kind: 'squareFrame', t0, t1, frameColor: String(o.frameColor || '#FFFFFF'), frameWidth: Math.max(0.003, Math.min(0.03, Number(o.frameWidth) || 0.008)), all: false };
    return { ...o, id, text: String(o.text || '').slice(0, 300), emoji: !!o.emoji, style: String(o.style || 'pop'), color: String(o.color || '#FFFFFF'),
      anim: String(o.anim || 'pop'), t0, t1, x: Number.isFinite(Number(o.x)) ? Number(o.x) : 0.5, y: Number.isFinite(Number(o.y)) ? Number(o.y) : 0.4,
      size: Math.max(0.35, Math.min(2.5, (Number(o.size) || 36) / 36)), all: !!o.all || (t0 === 0 && t1 >= D) };
  });
  ES.ovSel = -1; renderOvList(); redraw(); saveNow(); return ES.overlays.length;
}
function addOverlay(o){
  const L = reelLen(), now = Math.max(0, Math.min(L - 0.5, (ES.playing ? curTime() : ES.pos) || 0));
  const t0 = o.all ? 0 : o.end ? Math.max(0, L - 3) : now, t1 = o.all ? L : o.end ? L : Math.min(L, t0 + 3);
  const ov = { id: ++ES.ovSeq, text: o.text || '', emoji: !!o.emoji, style: o.style || 'bold', color: o.color || '#FFFFFF', anim: o.anim || (o.emoji ? 'pop' : 'pop'),
    t0, t1, x: o.x ?? 0.5, y: o.y ?? 0.4, size: o.size || 1, all: !!o.all };
  ES.overlays.push(ov); ES.ovSel = ES.overlays.length - 1; renderOvList(); redraw();
  return ov;
}
// a text template (a ready-made animated title): its texts, each with its own start, all ending together
function addTemplate(key, words, at, len, ai){
  const L = reelLen(), t = Math.max(0, Math.min(Math.max(0, L - 0.6), at ?? ((ES.playing ? curTime() : ES.pos) || 0)));
  const parts = templateTexts(key, words, t, len); if(!parts.length) return 0;
  for(const q of parts){ const ov = { id: ++ES.ovSeq, text: q.text, emoji: false, style: q.style, color: q.color, anim: q.anim, out: q.out, loop: q.loop, font: q.font,
    t0: q.start, t1: Math.min(L, q.end), x: q.x, y: q.y, size: q.size, all: false, tpl: key, ...(ai ? { aiIntent: 'ai' } : {}) };
    ES.overlays.push(ov); if(ov.font) loadFont(ov.font).then(redraw); }
  ES.ovSel = ES.overlays.length - 1; renderOvList(); redraw(); return parts.length;
}
/* ---- Shubix AI as the editor: what a person does with the tools (texts and their keyframes, video boxes, the look, captions,
 * the song's sound, the voice), the AI does with the same tools; its steps are used as it gave them ---- */
function aiTexts(list){
  if(!Array.isArray(list) || !list.length) return 0;
  const D = reelLen();
  ES.overlays = ES.overlays.filter(o => o.aiIntent !== 'ai').concat(list.map(x => ({ id: ++ES.ovSeq, aiIntent: 'ai', text: x.text, emoji: !!x.emoji, style: x.style, color: x.color, anim: x.anim,
    loop: x.loop === 'none' ? undefined : x.loop, out: x.out === 'none' ? undefined : x.out, font: x.font || undefined, behind: !!x.behind, track: !!x.track, x: x.x, y: x.y, size: x.size, all: false, ...(Number.isFinite(x.focus) ? { focus: x.focus } : {}),
    t0: Math.max(0, Math.min(D - 0.1, x.start)), t1: Math.max(0.1, Math.min(D, x.end)), uk: (x.keys || []).map(k => ({ t: k.at, x: k.x, y: k.y, s: k.s, r: k.r, o: k.o, ez: k.ez })) })));
  ES.overlays.filter(o => o.font).forEach(o => loadFont(o.font).then(redraw));
  ES.ovSel = -1; renderOvList(); redraw(); return list.length;
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
        if(Number.isFinite(+a.fadeOut)){ p.mfout = Math.max(0, +a.fadeOut); p.mfoutManual = true; } auSet(p); ES.clipMixKey = ''; await ensureMix(); done++; }
      else if(a.do === 'voicefx'){ const b = $('vfx').querySelector('[data-f="' + CSS.escape(String(a.fx)) + '"]'); if(b){ b.click(); done++; } }
      else if(a.do === 'voiceover' && tts && tts.voices.length && a.text){ ES.pos = Math.max(0, Math.min(reelLen() - 0.5, +a.at || 0)); await addTtsAtPlayhead(a.text, a.voice || tts.voices[0].key); done++; }
      else if(a.do === 'sound' && SFX_NAMES[a.kind] && ES.buf){ ES.sfxList.push({ id: ++ES.sfxSeq, at: +Math.max(0, Math.min(reelLen(), +a.at || 0)).toFixed(2), kind: a.kind }); sfxUI(); ES.clipMixKey = ''; await ensureMix(); done++; }
      else if(a.do === 'shot' && SHOT_OPS.includes(a.op) && ES.edit[+a.i]){ const e = ES.edit[+a.i], len = e.end - e.start;
        ES.pos = e.start + Math.max(0.05, Math.min(len - 0.05, Number.isFinite(+a.at) ? +a.at : len/2));
        if(a.op === 'reverse'){ shotSet({ rev: a.on !== false }); done++; } else if(shotOp(a.op)) done++; }
      else if(a.do === 'beatmark'){ const ts = (Array.isArray(a.at) ? a.at : [a.at]).map(Number).filter(Number.isFinite); if(a.clear) clearMarks(); for(const t of ts.slice(0, 32)) if(addMark(Math.max(0, t))) done++; }
      else if(a.do === 'template' && TEXT_TEMPLATES[a.name]){ if(addTemplate(a.name, Array.isArray(a.words) ? a.words : [], +a.at || 0, Number.isFinite(+a.len) && +a.len > 0 ? +a.len : undefined, true)) done++; }
      else if(a.do === 'background' && ['none','blur','color'].includes(a.mode)){ if(/^#[0-9a-f]{6}$/i.test(a.color || '')) bgColor = a.color; bgmode.querySelector('[data-b="' + a.mode + '"]').click(); done++; }
      else if(a.do === 'layer'){
        const s = sources[parseInt(String(a.clip).replace(/\D/g, ''), 10) - 1]; if(!s || !s.file || !ES.edit.length) continue;
        const M = await addLayerMedia(s.file), D = reelLen(), t0 = Math.max(0, Math.min(D - 0.1, +a.start || 0)), mask = ['circle', 'rect'].includes(a.mask) ? a.mask : 'none';
        ES.lmedia.push(M);
        ES.layers.push({ id: ++ES.lySeq, m: ES.lmedia.length - 1, t0, t1: Math.max(t0 + 0.1, Math.min(D, Number.isFinite(+a.end) ? +a.end : D)), in: Math.max(0, Math.min((M.dur || 1) - 0.1, +a.from || 0)),
          ...JSON.parse(JSON.stringify(LY0)), x: Number.isFinite(+a.x) ? +a.x : 0.5, y: Number.isFinite(+a.y) ? +a.y : 0.5, s: Math.max(0.05, Math.min(1, +a.size || 0.5)),
          rad: Math.max(0, Math.min(1, +a.radius || 0)), mask, fin: Math.max(0, +a.fadeIn || 0), fout: Math.max(0, +a.fadeOut || 0), aiIntent: 'ai',
          op: Number.isFinite(+a.opacity) ? Math.max(0, Math.min(1, +a.opacity)) : 1, r: +a.rotate || 0, blend: BLENDS.includes(a.blend) ? a.blend : 'source-over',
          ...(a.key ? { key: { on: true, c: /^#[0-9a-f]{6}$/i.test(a.key) ? a.key : '#00FF00', tol: Number.isFinite(+a.tolerance) ? Math.max(0.05, Math.min(0.9, +a.tolerance)) : 0.35 } } : {}) });
        done++;
      }
    }catch(e){ console.warn('Shubix AI step not done:', a && a.do, e); }
  }
  if(ES.layers.length){ lyUI(); await prepLayers(ES.pos); }
  redrawFrame(); saveNow(); return done;
}
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
  let blurPx = 0, turn = 0, glitchPx = 0, alpha = (ov.out && ov.out !== 'none') ? 1 : Math.min(1, left/0.15), sc = 1, dy = 0, txt = ov.emoji ? ov.text : (isIndic(ov.text) ? ov.text : ov.text);
  // paused in the editor: a text shows as it will look once in (its entrance played), so a text just added, or one being
  // keyframed at its first moment, is there to see and to drag (at its first frame it would still be invisible)
  const still = !ES.playing && !ES.recording && !ES.exporting;
  if(!ES.coverMode && !still){
    if(ov.anim === 'pop'){ const q = Math.min(1, since/0.22); sc = 0.6 + 0.4*EASE.outBack(q); alpha *= Math.min(1, since/0.08); }
    else if(ov.anim === 'fade') alpha *= Math.min(1, since/0.35);
    else if(ov.anim === 'slide'){ const q = Math.min(1, since/0.3); dy = (1 - EASE.outCubic(q))*fs*1.2; alpha *= q; }
    else if(ov.anim === 'type'){ const chars = [...txt]; txt = chars.slice(0, Math.max(1, Math.ceil(since/0.05))).join(''); }
    else if(ov.anim === 'zoom'){ const q = Math.min(1, since/0.3); sc = 2.4 - 1.4*EASE.outCubic(q); alpha *= q; }
    else if(ov.anim === 'drop'){ const q = Math.min(1, since/0.45); dy = -(1 - EASE.outBack(q))*fs*3; alpha *= Math.min(1, since/0.1); }
    else if(ov.anim === 'blur'){ const q = Math.min(1, since/0.4); blurPx = (1 - q)*fs*0.4; alpha *= q; }
    else if(ov.anim === 'spin'){ const q = Math.min(1, since/0.4); turn = (1 - EASE.outCubic(q))*-180; sc = 0.3 + 0.7*EASE.outCubic(q); alpha *= q; }
    else if(ov.anim === 'flicker'){ if(since < 0.5) alpha *= [1, 0, 1, 0.2, 1, 0, 1][Math.floor(since/0.07)] ?? 1; }
    else if(ov.anim === 'glitch'){ if(since < 0.45){ const j = Math.floor(since*40); dy = ((j*37) % 7 - 3)*fs*0.04; glitchPx = ((j*53) % 9 - 4)*fs*0.05; } }
    // the exit, in the text's last 0.3 s
    const q2 = Math.max(0, 1 - left/0.3);
    if(ov.out && q2 > 0){ if(ov.out === 'fade') alpha *= 1 - q2; else if(ov.out === 'pop'){ sc *= 1 - 0.7*EASE.inOut(q2); alpha *= 1 - q2; } else if(ov.out === 'slide'){ dy += q2*q2*fs*1.5; alpha *= 1 - q2; }
      else if(ov.out === 'zoom'){ sc *= 1 + 1.6*q2*q2; alpha *= 1 - q2; } else if(ov.out === 'blur'){ blurPx += q2*fs*0.4; alpha *= 1 - q2; } else if(ov.out === 'spin'){ turn += q2*q2*180; sc *= 1 - 0.7*q2; alpha *= 1 - q2; } }
    if(ov.emoji) sc *= 1 + 0.05*Math.sin(t*6);   // stickers breathe a little
  }
  let lx = 0, ly = 0, lr = 0;   // a sticker / text that keeps moving (its loop)
  if(ov.loop && ov.loop !== 'none' && !ES.coverMode){ const w = since*Math.PI*2;
    if(ov.loop === 'bounce') ly = -Math.abs(Math.sin(w*0.9))*fs*0.35; else if(ov.loop === 'spin') lr = since*240; else if(ov.loop === 'wiggle') lr = Math.sin(w*2.2)*12;
    else if(ov.loop === 'pulse') sc *= 1 + 0.12*Math.abs(Math.sin(w*1.1)); else if(ov.loop === 'float'){ ly = Math.sin(w*0.5)*fs*0.18; lx = Math.cos(w*0.35)*fs*0.12; }
    else if(ov.loop === 'swing') lr = Math.sin(w*0.8)*18; else if(ov.loop === 'shake'){ lx = Math.sin(since*97)*fs*0.06; ly = Math.cos(since*71)*fs*0.05; } }
  const u = uAt(ov.uk, since);   // the creator's keyframes: moved, sized, turned, faded over its time
  if(u){ sc *= Math.max(0.01, u.s); alpha *= Math.max(0, Math.min(1, u.o)); }
  g.save(); g.globalAlpha = Math.max(0, alpha); if(blurPx > 0.5) g.filter = 'blur(' + Math.round(blurPx) + 'px)';
  g.font = ov.emoji ? `${fs}px "Apple Color Emoji","Noto Color Emoji","Segoe UI Emoji",sans-serif` : ovFont(ov, fs, ov.style === 'clean' ? 600 : 800);
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  const lines = ov.emoji ? [txt] : wrapLines(g, txt, W*0.82), lh = fs*1.18;
  const tw = Math.max(...lines.map(l => g.measureText(l).width), fs*0.6), th = lh*lines.length;
  // the place: inside the safe area (top 220 and bottom 450 of 1920 are Instagram's)
  const top = H*(220/1920) + th/2 + fs*0.3, bot = H*(1 - 450/1920) - th/2 - fs*0.3;
  let cx = Math.max(tw/2 + W*0.05, Math.min(W - tw/2 - W*0.05, ov.x*W)), cy = Math.max(top, Math.min(bot, ov.y*H)) + dy;
  if(u){ cx += u.x*W; cy += u.y*H; }
  if(ov.track && ES.edit.length && !ov.emoji || ov.track && ov.emoji){   // follows the person / subject of the shot playing
    const e = ES.edit[segAt(t)], lo = t - e.start, B = layerOf(e, lo, {noFx:true}), [ax, ay] = camAt(e, lo), [px, py, dw, dh] = B.rect;
    cx = Math.max(tw/2, Math.min(W - tw/2, px + ax*dw + (ov.x - 0.5)*W)); cy = Math.max(th/2, Math.min(H - th/2, py + ay*dh + (ov.y - 0.5)*H)) + dy; }
  const bs = u ? Math.max(0.2, u.s) : 1;
  ov.box = [(cx - (tw/2 + fs*0.4)*bs)/W, (cy - (th/2 + fs*0.3)*bs)/H, (tw + fs*0.8)*bs/W, (th + fs*0.6)*bs/H];
  // focus: where along the text it is sized and turned around (0.64: the O of WELCOME), so the frame can fly through one letter
  const fx = Number.isFinite(ov.focus) ? (ov.focus - 0.5)*tw : 0;
  g.translate(cx + lx + fx, cy + ly); if((u && u.r) || lr || turn) g.rotate(((u && u.r) || 0)*Math.PI/180 + (lr + turn)*Math.PI/180); g.scale(sc, sc); if(fx) g.translate(-fx, 0);
  if(glitchPx){ g.save(); g.globalAlpha *= 0.6; g.fillStyle = '#ff2a6d'; lines.forEach((l, k) => g.fillText(l, glitchPx, (k - (lines.length-1)/2)*lh)); g.fillStyle = '#05d9e8'; lines.forEach((l, k) => g.fillText(l, -glitchPx, (k - (lines.length-1)/2)*lh)); g.restore(); }
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
  if(ES.ovSel >= 0 && ES.overlays[ES.ovSel] === ov && !ES.recording && !ES.exporting && !ES.coverMode){   // the one being edited: a dashed frame
    const [bx, by, bw, bh] = ov.box; g.save(); g.setLineDash([10, 8]); g.lineWidth = 3; g.strokeStyle = 'rgba(255,213,74,0.95)'; g.strokeRect(bx*W, by*H, bw*W, bh*H);
    const hr = Math.max(16, W*0.022); g.setLineDash([]); g.beginPath(); g.arc((bx + bw)*W, (by + bh)*H, hr, 0, Math.PI*2); g.fillStyle = '#ffd54a'; g.fill(); g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.55)'; g.stroke();
    g.beginPath(); g.moveTo((bx + bw)*W - hr*0.45, (by + bh)*H + hr*0.45); g.lineTo((bx + bw)*W + hr*0.45, (by + bh)*H - hr*0.45); g.strokeStyle = '#000'; g.lineWidth = 3; g.stroke(); g.restore(); }
}
// the list under "Text & stickers": edit the words, style, colour, entrance, size, when it shows
let ovTab = 'font';   // the text editor's open tab (Font, Style, Animation or Loop), the same for every text
function renderOvList(){
  const box = $('ovlist'); box.innerHTML = '';
  ES.overlays.forEach((ov, i) => {
    if(ov.kind === 'squareFrame') return;
    const row = document.createElement('div'); row.className = 'ov' + (i === ES.ovSel ? ' sel' : '');
    const [a, b] = ovTiming(ov);
    // the text / sticker editor (the design's frame 5): the words; Font · Style · Animation · Loop; the colour; follow the
    // person; start and end; delete. Each choice is a chip (its select stays, hidden, as the one place the value lives)
    row.innerHTML = `<div class="ovtop"><input class="ovt" maxlength="80" aria-label="Text"><button class="ovdel" title="Delete" aria-label="Delete">×</button></div>
      <div class="ovtabs" role="tablist"><button type="button" data-ovt="font">Font</button><button type="button" data-ovt="style">Style</button><button type="button" data-ovt="anim">Animation</button><button type="button" data-ovt="loop">Loop</button></div>
      <div class="ovpane" data-p="font"><div class="ovfrow"><select class="ovf" aria-label="Font"></select><label class="ovsz">Size <input type="range" min="0.3" max="4" step="0.05" aria-label="Size"></label></div>
        <div class="ovcrow"><span class="ovclab">Color</span><span class="ovc"></span><label class="ovpick" title="Any colour"><input type="color" class="ovcol" aria-label="Any colour"></label></div></div>
      <div class="ovpane" data-p="style"><select class="ovs" aria-label="Style" hidden></select><div class="ovchips" data-for="ovs"></div></div>
      <div class="ovpane" data-p="anim"><select class="ova" aria-label="Entrance" hidden></select><div class="ovchips" data-for="ova"></div><select class="ovo" aria-label="Exit" hidden></select><div class="ovchips" data-for="ovo"></div></div>
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
    const so = row.querySelector('.ovo'); Object.entries(OV_OUTS).forEach(([k, v]) => so.add(new Option(v, k, false, k === (ov.out || 'none')))); so.addEventListener('change', () => { ov.out = so.value === 'none' ? undefined : so.value; redraw(); });
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
    const now = () => Math.max(0, Math.min(reelLen(), ES.playing ? curTime() : ES.pos || 0));
    row.querySelector('.ovfrom').addEventListener('click', () => { ov.all = false; ov.t0 = now(); if(ov.t1 <= ov.t0 + 0.3) ov.t1 = Math.min(reelLen(), ov.t0 + 3); row.querySelector('.ovall').checked = false; showT(); redraw(); });
    row.querySelector('.ovto').addEventListener('click', () => { ov.all = false; ov.t1 = Math.max(now(), ov.t0 + 0.3); row.querySelector('.ovall').checked = false; showT(); redraw(); });
    const bh = row.querySelector('.ovbeh'); bh.checked = !!ov.behind; bh.addEventListener('change', () => { ov.behind = bh.checked; if(bh.checked && !personMask) $('bgstat').textContent = 'Text behind the person needs the background tools'; ES.bgMask = null; ES.bgFrame = -1; redrawFrame(); });
    const al = row.querySelector('.ovall'); al.checked = ov.all; al.addEventListener('change', () => { ov.all = al.checked; showT(); redraw(); });
    row.querySelector('.ovdel').addEventListener('click', () => { ES.overlays.splice(i, 1); ES.ovSel = -1; renderOvList(); redraw(); });
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
    row.addEventListener('focusin', () => { if(ES.ovSel !== i){ ES.ovSel = i; [...box.children].forEach((r, k) => r.classList.toggle('sel', k === i)); redraw(); } });
    box.appendChild(row);
  });
  $('ovhint').hidden = !ES.overlays.length; out.classList.toggle('ovdrag', ES.overlays.length > 0 || kfOpen());
  if(typeof kfSync === 'function') kfSync();   // drag texts; otherwise the page scrolls over the preview
}
$('ovtext').addEventListener('click', () => { const ov = addOverlay({ text: 'Your text', style: 'bold', color: '#FFFFFF', y: 0.4 }); const inp = $('ovlist').lastElementChild.querySelector('.ovt'); inp.focus(); inp.select(); }, SIG);
$('ovsticker').addEventListener('click', () => { $('emojis').hidden = !$('emojis').hidden; }, SIG);
// a shape: a text of one sign, in the text's colour (so every text tool works on it); ︎ keeps it a plain sign, not an emoji
$('ovshapes').addEventListener('click', e => { const b = e.target.closest('[data-shape]'); if(b) addOverlay({ text: b.dataset.shape + '︎', style: 'clean', size: 2.2 }); }, SIG);
OV_EMOJI.forEach(em => { const b = document.createElement('button'); b.textContent = em; b.className = 'em'; b.setAttribute('aria-label', 'Sticker ' + em);
  b.addEventListener('click', () => { addOverlay({ text: em, emoji: true, y: 0.5, x: 0.72, size: 1 }); $('emojis').hidden = true; }); $('emojis').appendChild(b); });
$('ovtpl').addEventListener('change', e => { const k = e.target.value; e.target.value = ''; if(k) addTemplate(k); }, SIG);
$('ovpreset').addEventListener('change', e => { const p = OV_PRESETS[e.target.value]; e.target.value = ''; if(p) addOverlay(p); }, SIG);
// drag on the preview: the item under the finger moves with it (a tap selects it)
{ let drag = null; const fingers = new Map();
  const at = ev => { const r = out.getBoundingClientRect(); return [(ev.clientX - r.left)/r.width, (ev.clientY - r.top)/r.height]; };
  // a text's size: two fingers on it (pinch), or its corner handle dragged away from / toward its middle
  const OV_MIN = 0.3, OV_MAX = 4;
  const midOf = ov => { const [bx, by, bw, bh] = ov.box, r = out.getBoundingClientRect(); return [r.left + (bx + bw/2)*r.width, r.top + (by + bh/2)*r.height]; };
  const spread = () => { const p = [...fingers.values()]; return Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]) || 1; };
  out.addEventListener('pointerdown', ev => {
    if(ES.recording) return;
    fingers.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if(fingers.size === 2 && drag && drag.i != null && ES.overlays[drag.i]){ const ov = ES.overlays[drag.i]; drag = { i: drag.i, pinch: true, d0: spread(), s0: ov.size || 1 }; try{ out.setPointerCapture(ev.pointerId); }catch(e){} ev.preventDefault(); return; }
    const [x, y] = at(ev), t = ES.playing ? curTime() : ES.pos || 0;
    if(ES.ovSel >= 0 && ES.overlays[ES.ovSel] && ES.overlays[ES.ovSel].box){ const ov = ES.overlays[ES.ovSel], [bx, by, bw, bh] = ov.box, r = out.getBoundingClientRect(), [a0, b0] = ovTiming(ov);
      const hx = r.left + (bx + bw)*r.width, hy = r.top + (by + bh)*r.height;
      if(t >= a0 && t < b0 && Math.hypot(ev.clientX - hx, ev.clientY - hy) < 28){ const [mx, my] = midOf(ov);
        drag = { i: ES.ovSel, handle: true, d0: Math.hypot(ev.clientX - mx, ev.clientY - my) || 1, s0: ov.size || 1, mx, my }; out.setPointerCapture(ev.pointerId); ev.preventDefault(); return; } }
    for(let i = ES.overlays.length - 1; i >= 0; i--){ const ov = ES.overlays[i], [a, b] = ovTiming(ov); if(!ov.box || !(t >= a && t < b)) continue;
      const [bx, by, bw, bh] = ov.box; if(x >= bx && x <= bx + bw && y >= by && y <= by + bh){
        drag = { i, dx: x - ov.x, dy: y - ov.y }; ES.ovSel = i; out.setPointerCapture(ev.pointerId); renderOvList(); ev.preventDefault(); redraw(); return; } }
    if(ES.ovSel >= 0){ ES.ovSel = -1; renderOvList(); redraw(); }
    if(kfOpen() && ES.edit.length){   // the keyframe panel is open: dragging the picture moves the shot (a keyframe at the playhead)
      if(ES.playing){ ES.pos = curTime(); stopAll(); }
      const T = kfTarget(), u = T && (uAt(T.obj.uk, kfLocal(T)) || UK0);
      if(T){ drag = { shot: true, x0: x, y0: y, ux: u.x, uy: u.y }; out.setPointerCapture(ev.pointerId); ev.preventDefault(); kfSync(); }
    }
  }, SIG);
  out.addEventListener('pointermove', ev => { if(fingers.has(ev.pointerId)) fingers.set(ev.pointerId, [ev.clientX, ev.clientY]); if(!drag) return; const [x, y] = at(ev);
    if(drag.pinch || drag.handle){ const ov = ES.overlays[drag.i]; if(!ov) return;
      const f = drag.pinch ? (fingers.size === 2 ? spread()/drag.d0 : 1) : Math.hypot(ev.clientX - drag.mx, ev.clientY - drag.my)/drag.d0;
      ov.size = Math.round(Math.max(OV_MIN, Math.min(OV_MAX, drag.s0*f))*100)/100; redraw(); return; }
    if(drag.shot){ kfSet({ x: drag.ux + x - drag.x0, y: drag.uy + y - drag.y0 }); return; }
    const ov = ES.overlays[drag.i]; if(!ov) return;
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
let kfListT = 0; function kfListSoon(){ clearTimeout(kfListT); kfListT = setTimeout(() => { if(!ES.playing) renderEDL(true); }, 400); }
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
$('kfbox').addEventListener('toggle', () => { out.classList.toggle('ovdrag', ES.overlays.length > 0 || kfOpen()); kfSync(); }, SIG);
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
let bgMode = 'none', bgColor = '#1DB954', bgImg = null, bgFile = null; ES.bgMask = null; ES.bgBusy = false; ES.bgErr = ''; ES.bgFrame = -1;
const segC = Object.assign(document.createElement('canvas'), {width:256, height:256}), segG = segC.getContext('2d', {willReadFrequently:true});
const mC = Object.assign(document.createElement('canvas'), {width:256, height:256}), mG = mC.getContext('2d');
let rawC = null, rawG = null, perC = null, perG = null;
const bgNeeded = () => bgMode !== 'none' || ES.overlays.some(o => o.behind);
// the finished frame (before text) into the 256x256 letterbox, as RGBA
function segInput(){ const [w, h, ox, oy] = segRegion(); segG.fillStyle = '#000'; segG.fillRect(0,0,256,256); segG.drawImage(out, ox, oy, w, h); return segG.getImageData(0,0,256,256).data; }
function setMask(m){ const id = mG.createImageData(256, 256); for(let i=0;i<65536;i++){ const a = Math.max(0, Math.min(1, (m[i] - 0.25)/0.5)); id.data[i*4+3] = Math.round(a*255); } mG.putImageData(id, 0, 0); ES.bgMask = true; }
const redrawFrame = () => { if(!ES.playing && ES.edit.length) drawFrame(ES.pos || 0.3); };
function bgStat(){ $('bgstat').textContent = ES.bgErr ? 'Background effects do not work on this phone.' : (bgMode === 'photo' && !bgImg ? 'Choose a photo' : ''); }
function bgPass(t){
  if(!bgNeeded() || !personMask) return;
  if(!ES.exporting) maskSoon(t);
  if(!ES.bgMask) return;
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
  for(const ov of ES.overlays) if(ov.behind) drawOverlay(og, ov, t);   // text behind the person
  og.drawImage(perC, 0, 0);
}
$('bgmode').addEventListener('click', e => { const b = e.target.closest('button'); if(!b || ES.recording) return; bgMode = b.dataset.b;
  [...$('bgmode').children].forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  $('bgrow').hidden = bgMode !== 'color' && bgMode !== 'photo'; $('bgcolors').hidden = bgMode !== 'color'; $('bgpick').hidden = bgMode !== 'photo';
  if(!personMask && bgMode !== 'none') ES.bgErr = 'not built in'; bgStat(); ES.bgMask = null; ES.bgFrame = -1; redrawFrame(); }, SIG);
['#1DB954','#FFFFFF','#111111','#FFD54A','#FF6FD8','#4DA3FF'].forEach(c => { const b = document.createElement('button'); b.className = 'sw' + (c === bgColor ? ' on' : ''); b.style.background = c; b.setAttribute('aria-label', 'Background ' + c);
  b.addEventListener('click', () => { bgColor = c; [...$('bgcolors').children].forEach(x => x.classList.toggle('on', x === b)); redrawFrame(); }); $('bgcolors').appendChild(b); });
$('bgpick').addEventListener('click', () => $('bgfile').click(), SIG);
$('bgfile').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if(!f) return;
  bgFile = f; const im = new Image(); im.onload = () => { bgImg = im; bgStat(); redrawFrame(); }; im.onerror = () => { $('bgstat').textContent = 'This photo cannot be read here.'; }; im.src = URL.createObjectURL(f); }, SIG);
// the song as speech recognition wants it: 16 kHz mono, the vocal band (drums and bass mostly out), normalised, as WAV
async function songWav(src = ES.mono, sr = ES.buf.sampleRate, from = 0){
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
const capCache = new Map(); ES.capAll = null; ES.musicKey = '';
function capStat(t, err){ const el = $('capstat'); el.textContent = t || '';
  if(!t) tasks.clear('caps'); else if(/…$/.test(t)) tasks.start('caps', 'voice', 'Captions', t.replace(/…$/, '')); else if(err) tasks.fail('caps', t); else if(tasks.has('caps')) tasks.done('caps', t); el.style.color = err ? 'var(--drop)' : ''; }
async function loadCaptions(){
  if(!ES.capsOn || !ES.buf) return;
  const tk = ES.kind === 'talk' && ES.talk, vk = !tk && ES.vo, W = tk || vk ? null : ES.song ? ES.song.buf : ES.buf, M = tk ? ES.talk.voice : vk ? ES.vo.pcm : ES.song ? ES.song.mono : ES.mono, sr = tk ? ES.talk.sr : vk ? ES.vo.sr : W.sampleRate;
  const from = !tk && !vk && ES.secStart + ES.buf.duration > 179 ? ES.secStart : 0;   // a part past 3 minutes: from where it starts
  const lang = $('caplang').value, key = (tk ? 'talk|' + ES.talk.sig : vk ? 'vo|' + ES.vo.key : ES.song ? ES.song.key : ES.musicKey) + '|' + from.toFixed(2) + '|' + lang, token = musicToken;
  if(capCache.has(key)){ ES.capAll = capCache.get(key); capKeyNow = key; shiftCaptions(); capStat(ES.capWords.length + ' words'); return; }
  capStat('Listening to the words of the song…');
  try{
    const wav = await songWav(M, sr, from);
    const r = await fetch('/api/studio/transcribe?lang=' + encodeURIComponent(lang), { method:'POST', headers:{'Content-Type':'audio/wav'}, body: wav, signal: ac.signal });
    const res = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error((res.error && res.error.message) || ('Captions failed (' + r.status + ').'));
    if(token !== musicToken) return;
    ES.capAll = { from, words: Array.isArray(res.words) ? res.words : [] }; capCache.set(key, ES.capAll); capKeyNow = key; shiftCaptions();
    capStat(ES.capWords.length ? ES.capWords.length + ' words found' + (res.language && res.language !== 'auto' ? ' (' + res.language + ')' : '') + (res.charged ? ' · ' + res.charged + ' credit' + (res.charged > 1 ? 's' : '') : '') : 'No words in this song (instrumental?)');
    redraw();
  }catch(err){ if(!(err && err.name === 'AbortError')) { console.warn('captions failed:', err); capStat('Captions could not be made this time. Please try again.', true); } }
}
(async () => {   // is speech recognition set up on this server?
  try{ const r = await fetch('/api/studio/transcribe', { signal: ac.signal }); if(!r.ok) return; const j = await r.json(); if(!j || !j.available) return;
    if(j.planAi === false){ $('capwrap').hidden = false; $('caps').disabled = true; $('capwrap').title = 'Captions from the song are part of the Editor and Pro plans'; $('capwrap').lastChild.textContent = ' Captions from the song · Editor and Pro plans'; return; }
    $('capwrap').hidden = false; if(j.credits) $('capwrap').title = 'Uses ' + j.credits + ' credit' + (j.credits > 1 ? 's' : '') + ' per song'; }catch(e){}
})();
$('caps').addEventListener('change', e=>{ ES.capsOn = e.target.checked; $('caprow').hidden = !ES.capsOn; if(ES.capsOn) loadCaptions(); else { capStat(''); redraw(); } });
$('caplang').addEventListener('change', ()=>{ if(ES.capsOn) loadCaptions(); });
$('tstyle').addEventListener('click', e=>{ const b = e.target.closest('button'); if(!b) return; ES.textStyle = b.dataset.t; [...$('tstyle').children].forEach(x=>x.setAttribute('aria-pressed', x===b)); redraw(); });
function drawSafe(){
  const W=out.width, H=out.height; if(ES.aspect!=='9:16') return;
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
  if(!ES.edit.length) return;
  const i = segAt(t), e = ES.edit[i], local = t - e.start, pe = ES.edit[i-1], pl = pe ? pe.end-pe.start : 0;
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
      case 'slideleft': case 'slideright': case 'slideup': case 'slidedown': case 'swipeup': case 'zoomout': case 'blur': case 'flip': case 'luma': case 'pixelate': case 'clock': case 'doors': case 'ripple': case 'burn': case 'dropin': case 'stripes': case 'blinds': case 'checker': case 'dots': case 'noise': case 'splith': case 'wave': case 'dipwhite': case 'chroma': case 'tiles': case 'zoomblur': case 'shake': case 'squeeze': case 'rotatein':   // the 2D renderer: a dissolve
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
  grain(og, LOOKS[ES.look].grain);
  if(LOOKS[ES.look].tint){ // teal shadows, warm highlights
    og.save(); og.globalCompositeOperation='soft-light'; og.fillStyle='rgba(0,110,130,0.36)'; og.fillRect(0,0,W,H);
    og.globalCompositeOperation='overlay'; og.fillStyle='rgba(255,150,70,0.12)'; og.fillRect(0,0,W,H); og.restore(); }
  const vg = kf(e.kf && e.kf.vig, local); vignette(og, vg !== undefined ? vg : 0.22);
  // seamless loop: the last 0.4 s melts into the opening frame
  const dur = ES.buf.duration;
  if(loopImg && t > dur-0.4){ og.globalAlpha = EASE.inOut((t-(dur-0.4))/0.4); og.drawImage(loopImg,0,0,W,H); og.globalAlpha=1; }
  shotGrade(t); shotFx(t); shotKey(t); shotMask(t); if(ES.layers.length) drawLayers(og, t);
  if(holdText) return;
  bgPass(t); drawText(t);
  if(ES.showSafe && !ES.recording && !ES.coverMode) drawSafe();
  if(!ES.exporting){ $('prog').style.width = (t/ES.buf.duration*100).toFixed(2)+'%';
    const rows = $('edl').children; if(rows[i] && !rows[i].classList.contains('cur')){ [...rows].forEach(r=>r.classList.remove('cur')); rows[i].classList.add('cur'); } }
}

/* =============== GPU RENDERER (WebGL) =============== */
const GLSL_V = MAIN_VERT;
const GLSL_F = MAIN_FRAG;
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
const CS0 = { rev:false, zoom:1, cx:null, cy:null, vol:0, pitch:0, mus:1, rot:0, fh:false, fv:false, fit:false, bg:'blur', bgc:'#000000', bd:0, bdc:'#ffffff', bri:0, con:0, sat:0, warm:0, hi:0, sh:0, hue:0, sharp:0, vig:0, beauty:0, stab:0, smooth:0, enh:false, curve:null, fin:0, fout:0, mz:null, mg:null, mk:null, ck:null, cv:null, hsl:null };
/* ---- a shot's mask (Clip tools -> Mask, CapCut's Mask): the shot shows only inside a shape (or outside it, inverted);
 * the rest is a colour. Drawn over the finished shot, before the boxes and texts, by both renderers and in the export. ---- */
/* ---- a shot's green screen (Clip tools -> Chroma key, CapCut's Chroma key): its key colour goes, the colour behind shows ---- */
/* ---- a shot's Curves and HSL (Clip tools -> Curves / HSL, as CapCut's): one small GPU pass over the finished shot, the same
 * for both renderers and the export. cv: {m, r, g, b}: each 5 outputs (0-1) at the inputs 0, ¼, ½, ¾, 1 (m = all three);
 * hsl: per colour band (red orange yellow green aqua blue purple magenta) [hue, saturation, lightness], each -1..1 ---- */
const HSL_BANDS = ['red','orange','yellow','green','aqua','blue','purple','magenta'];
let gradeGL = null;
function gradeProgram(){
  if(gradeGL !== null) return gradeGL;
  try{
    const cv = document.createElement('canvas'), gl = cv.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true });
    if(!gl){ gradeGL = false; return false; }
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, PASS_VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, GRADE_FRAG));
    gl.linkProgram(p); gl.useProgram(p);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(p, 'a'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(k => gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE)); [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach(k => gl.texParameteri(gl.TEXTURE_2D, k, gl.LINEAR));
    const u = n => gl.getUniformLocation(p, n);
    gradeGL = { cv, gl, M: u('M'), R: u('R'), G: u('G'), B: u('B'), H: u('H'), useH: u('useH') };
  }catch(e){ console.warn('Curves / HSL are not available here:', e); gradeGL = false; }
  return gradeGL;
}
const CV_ID = [0, 0.25, 0.5, 0.75, 1];
function shotGrade(t){
  const e = ES.edit[segAt(t)], cs = e && e.cs; if(!cs || (!cs.cv && !cs.hsl)) return;
  const P = gradeProgram(); if(!P) return;
  const W = out.width, H = out.height, { gl, cv } = P;
  if(cv.width !== W || cv.height !== H){ cv.width = W; cv.height = H; }
  gl.viewport(0, 0, W, H);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, out);
  const curve = k => { const a = cs.cv && Array.isArray(cs.cv[k]) && cs.cv[k].length === 5 ? cs.cv[k] : CV_ID; return new Float32Array(a.map(x => Math.max(0, Math.min(1, +x || 0)))); };
  gl.uniform1fv(P.M, curve('m')); gl.uniform1fv(P.R, curve('r')); gl.uniform1fv(P.G, curve('g')); gl.uniform1fv(P.B, curve('b'));
  gl.uniform3fv(P.H, new Float32Array(HSL_BANDS.flatMap(k => { const x = cs.hsl && cs.hsl[k]; return Array.isArray(x) ? x.slice(0, 3).map(n => Math.max(-1, Math.min(1, +n || 0))) : [0, 0, 0]; })));
  gl.uniform1f(P.useH, cs.hsl ? 1 : 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  og.save(); og.setTransform(1, 0, 0, 1, 0, 0); og.globalAlpha = 1; og.globalCompositeOperation = 'copy'; og.drawImage(cv, 0, 0); og.restore();
}/* ---- the picture effects (Effect: film grain, light leak, rainbow, negative, halftone, 8-bit, CRT, fisheye, swirl, sketch,
 * duotone): one small GPU pass over the finished shot, the same for both renderers and the export ---- */
let picGL = null;
function picProgram(){
  if(picGL !== null) return picGL;
  try{
    const cv = document.createElement('canvas'), gl = cv.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true });
    if(!gl){ picGL = false; return false; }
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, PASS_VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, PIC_FRAG));
    gl.linkProgram(p); gl.useProgram(p);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(p, 'a'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(k => gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE)); [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach(k => gl.texParameteri(gl.TEXTURE_2D, k, gl.LINEAR));
    const u = n => gl.getUniformLocation(p, n);
    picGL = { cv, gl, res: u('res'), time: u('time'), kind: u('kind'), amt: u('amt') };
  }catch(e){ console.warn('Picture effects are not available here:', e); picGL = false; }
  return picGL;
}
function shotFx(t){
  const i = segAt(t), e = ES.edit[i], k = e && PIC_FX[e.efx]; if(!k) return;
  const P = picProgram(); if(!P) return;
  const W = out.width, H = out.height, { gl, cv } = P;
  if(cv.width !== W || cv.height !== H){ cv.width = W; cv.height = H; }
  gl.viewport(0, 0, W, H); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, out);
  const local = t - e.start, ramp = k === 12 ? 1 : Math.min(1, local/0.25, Math.max(0, e.end - t)/0.15);   // in over 0.25 s, out over the last 0.15 s (3D zoom: the whole shot)
  gl.uniform2f(P.res, W, H); gl.uniform1f(P.time, k === 12 ? local/Math.max(0.1, e.end - e.start) : local); gl.uniform1f(P.kind, k); gl.uniform1f(P.amt, Math.max(0, ramp)*(e.fxAmt ?? 1));
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  og.save(); og.setTransform(1, 0, 0, 1, 0, 0); og.globalAlpha = 1; og.globalCompositeOperation = 'copy'; og.drawImage(cv, 0, 0); og.restore();
}let ckBuf = null;
function shotKey(t){
  const e = ES.edit[segAt(t)], k = e && e.cs && e.cs.ck; if(!k) return;
  const W = out.width, H = out.height;
  if(!ckBuf) ckBuf = document.createElement('canvas');
  if(ckBuf.width !== W || ckBuf.height !== H){ ckBuf.width = W; ckBuf.height = H; }
  const q = ckBuf.getContext('2d', { willReadFrequently: true }); q.globalCompositeOperation = 'copy'; q.drawImage(out, 0, 0); q.globalCompositeOperation = 'source-over';
  chromaKey(q, W, H, k);
  og.save(); og.setTransform(1, 0, 0, 1, 0, 0); og.globalAlpha = 1; og.globalCompositeOperation = 'source-over'; og.fillStyle = k.bg || '#000000'; og.fillRect(0, 0, W, H); og.drawImage(ckBuf, 0, 0); og.restore();
}let mkBuf = null;
function shotMask(t){
  const e = ES.edit[segAt(t)], m = e && e.cs && e.cs.mk && csOf(e, t - e.start).mk; if(!m) return;
  const W = out.width, H = out.height;
  if(!mkBuf) mkBuf = document.createElement('canvas');
  if(mkBuf.width !== W || mkBuf.height !== H){ mkBuf.width = W; mkBuf.height = H; }
  const q = mkBuf.getContext('2d'); q.setTransform(1, 0, 0, 1, 0, 0); q.filter = 'none'; q.globalCompositeOperation = 'source-over'; q.clearRect(0, 0, W, H);
  const soft = m.f > 0.005 ? 'blur(' + Math.round(m.f*W*0.4) + 'px)' : 'none';
  if(!m.inv){ q.fillStyle = m.c || '#000000'; q.fillRect(0, 0, W, H); q.globalCompositeOperation = 'destination-out'; }
  q.save(); q.filter = soft; maskPath(q, m, W, H); q.fillStyle = m.inv ? (m.c || '#000000') : '#000'; q.fill(); q.restore();
  og.drawImage(mkBuf, 0, 0);
}/* ---- keyframes on a shot's settings (as CapCut's keyframes on colour, volume, zoom, framing, mask): cs.kx is a list of
 * { t: seconds into the shot, ez, and any of the KX fields / mk: {x,y,w,h,a,f} }; between two the values glide with the
 * ease, a field a key leaves out is the shot's own value. Once a shot has keys, changing one of these at the playhead
 * changes (or adds) the key there, as in CapCut. ---- */
const KX = ['bri','con','sat','warm','hi','sh','hue','vig','sharp','zoom','cx','cy','vol'], KX_MK = ['x','y','w','h','a','f'], KX_D = { cx: 0.5, cy: 0.5 };
// a shot's settings (at `l` seconds into it, when it has keyframes)
const csOf = (e, l) => e && e.cs ? kxAt({ ...CS0, ...e.cs }, l) : CS0;
const ROTI = [[1,0,0,1],[0,1,-1,0],[-1,0,0,-1],[0,-1,1,0]];
const hexRgb = h => { const n = parseInt(String(h).replace('#',''), 16) || 0; return [(n>>16&255)/255, (n>>8&255)/255, (n&255)/255]; };
const csFade = (c, local, L) => Math.min(c.fin > 0 ? Math.min(1, local/c.fin) : 1, c.fout > 0 ? Math.min(1, Math.max(0, (L-local)/c.fout)) : 1);
/* ---- Reverse: a shot played backwards ----
 * The preview plays it from its frames, decoded once at a small size (rc); the export decodes it forwards in windows of
 * a dozen frames (a ring of canvases, so a long or 4K shot never fills the memory) and hands them out backwards. ---- */
const REV_MAX = 8;   // seconds of clip a shot may play backwards
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
// reversed shots get their frames again when they change (Slip, Trim, a new mix) or a saved Reel opens
setInterval(() => { if(ES.playing || ES.exporting || ES.recording) return; for(const e of ES.edit) if(e.cs && e.cs.rev && !e._revBusy){
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
/* ---- Beat shapes and beat effects: the shot shown through a shape that steps on its beats ----
 * boxgrow: a small box, bigger on the next beat, then the whole frame · grid: 2x2 (3x3 on long shots) windows open one a
 * beat · strips: 3 strips one a beat · circle / heartbeat / starbeat: the shape pulses on each beat · frame: the shot in
 * a white-edged frame on its own blurred copy, bumping on the beats · mirror, kaleido · triple: the shot three times,
 * one band a beat · vhs: retro tape. Shot without beats (talking): a step every 0.6 s. Drawn by the WebGL renderer. */
const SHAPE_K = { boxgrow:1, grid:2, strips:3, circle:4, heartbeat:5, starbeat:6, frame:7, mirror:8, kaleido:9, triple:10, vhs:11 };
// beat effects that ride on the picture's own settings: an RGB split or a blur on each beat
function drawFrameGL(t){
  const W=out.width, H=out.height, i = segAt(t), e = ES.edit[i], local = t - e.start, pe = ES.edit[i-1], pl = pe ? pe.end-pe.start : 0;
  const d = trDur(e), p = d ? Math.min(1, local/d) : 1, q = EASE.outCubic(p);
  const S = { mode:0, prog:p, mix:1, time:t, grade:{...GRADES[ES.look]}, A:null, B:null, lens: lensOf(e) };
  S.grade.vig = (kf(e.kf && e.kf.vig, local) ?? (ES.look === 'copy' ? (GRADES.copy.vig || 0) : (GRADES[ES.look].vig ?? 0.22))) + (csOf(e, local).vig || 0)*0.9;
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
      case 'stripes': case 'blinds': case 'checker': case 'dots': case 'noise': case 'splith': case 'wave': case 'dipwhite': case 'chroma': case 'tiles':
        S.mode = {stripes:17, blinds:18, checker:19, dots:20, noise:21, splith:22, wave:23, dipwhite:24, chroma:25, tiles:26}[e.tr]; S.prog = EASE.inOut(p); break;
      case 'zoomblur': S.A = layerOf(pe, pl, {scale:1+1.2*p*p, zb:2.5*p, noFx:true}); S.B = layerOf(e, local, {scale:1+0.8*(1-q)*(1-q), zb:2.5*(1-q)}); S.mode = 1; S.mix = EASE.inOut(p); break;
      case 'shake': { const j = Math.sin(Math.PI*p)*0.05*W, sx = Math.sin(p*90)*j, sy = Math.cos(p*70)*j; S.A = layerOf(pe, pl, {dx:sx, dy:sy, noFx:true}); S.B = layerOf(e, local, {dx:-sx, dy:-sy}); S.mode = 1; S.mix = EASE.inOut(p); break; }
      case 'squeeze': { const k = EASE.inOut(p), a = layerOf(pe, pl, {noFx:true}), [ax, ay, aw, ah] = a.rect, [bx, by, bw, bh] = S.B.rect;
        a.rect = [ax*(1-k), ay, Math.max(1, aw*(1-k)), ah]; a.clip = 1; S.A = a; S.B.rect = [W*(1-k) + bx*k, by, Math.max(1, bw*k), bh]; S.B.clip = 1; S.mode = 3; break; }
      case 'rotatein': S.A = layerOf(pe, pl, {scale:1-0.3*p, zb:0.6*p, noFx:true}); S.B = layerOf(e, local, {rot:-180*(1-q)*(1-q), scale:0.4+0.6*q}); S.mode = 1; S.mix = EASE.inOut(p); break;
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
  const dur = ES.buf.duration; if(loopImg && t > dur-0.4){ S.loopMix = EASE.inOut((t-(dur-0.4))/0.4); S.loopImg = loopImg; }
  GL.render(S); if(ES.playing && (Math.floor(t*10)%3===0)) drawTimeline();
  og.globalCompositeOperation='source-over'; og.globalAlpha=1; og.drawImage(GL.canvas, 0, 0);
  shotGrade(t); shotFx(t); shotKey(t); shotMask(t); if(ES.layers.length) drawLayers(og, t);
  if(holdText) return;
  bgPass(t); drawText(t);
  if(ES.showSafe && !ES.recording && !ES.coverMode) drawSafe();
  if(!ES.exporting){ $('prog').style.width = (t/ES.buf.duration*100).toFixed(2)+'%';
    const rows = $('edl').children; if(rows[i] && !rows[i].classList.contains('cur')){ [...rows].forEach(r=>r.classList.remove('cur')); rows[i].classList.add('cur'); } }
}
function drawFrame(t){ if(!ES.edit.length){ og.fillStyle='#000'; og.fillRect(0,0,out.width,out.height); return; } if(GL && !GL.lost) drawFrameGL(t); else drawFrame2D(t);
  if(!ES.exporting && !ES.recording && kfOpen()) kfSoon(); }

ES.coverMode = false;
let src=null, startedAt=0, startOff=0, curIdx=-1, timer=0, latencyOn=true; ES.playing = false; ES.recording = false; ES.pos = 0;
function curTime(){ if(!ES.playing) return ES.pos; const lat = latencyOn ? (ctx.outputLatency||ctx.baseLatency||0) : 0; return startOff + ctx.currentTime - startedAt - lat; }
// button labels: the text beside the button's icon (the icon stays)
function setLabel(id, t){ const el = $(id); if(!el) return; const sp = el.querySelector('span'); if(sp) sp.textContent = t;
  else { const tn = [...el.childNodes].reverse().find(n => n.nodeType === 3 && n.textContent.trim()); if(tn) tn.textContent = t; else el.append(t); } }
const PLAY_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';
const PAUSE_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>';
function setPlayLabel(on){ $('play').innerHTML = (on ? PAUSE_SVG : PLAY_SVG) + '<span>' + (on ? 'Pause' : 'Preview') + '</span>'; }
// every start or stop gets a new number: a start that is still loading (the mix, the clips) gives up when the number
// moved on, so two quick taps never leave two songs playing (and Pause always stops the one that plays)
function stopAll(){ playGen++; ES.starting = false; stopPart(); stopLayers(); ES.playing=false; if(src){ const s=src; src=null; try{s.stop();}catch(e){} } clearInterval(timer); cancelAnimationFrame(rafId); ES.edit.forEach(e=>e.el.pause()); setPlayLabel(false); }
let rafId=0;
async function startPlayback(from, destNode){
  if(!destNode && root.classList.contains('aineed')) return;   // waiting for Shubix AI: nothing to play yet
  stopAll();
  const g0 = playGen; ES.starting = true; setPlayLabel(true);
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
  ES.edit.forEach(x=>{ x._cued = false; });
  curIdx = segAt(from); const quick = !destNode;
  if(ES.edit[curIdx-1]){ if(quick) prepare(curIdx-1, ES.edit[curIdx-1].end-0.01, true); else await prepare(curIdx-1, ES.edit[curIdx-1].end-0.01); }
  if(gone()) return; await prepare(curIdx, from, quick); if(gone()) return; if(ES.edit[curIdx+1]) prepare(curIdx+1, ES.edit[curIdx+1].start);
  ES.starting = false;
  const s = c.createBufferSource(); s.buffer = ES.buf;
  // loudness: bring the song to about -14 LUFS (social media level), limiter stops clipping, tiny fades stop clicks
  const g = c.createGain(), lim = c.createDynamicsCompressor();
  lim.threshold.value = -1.5; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.08;
  const now = c.currentTime, endAt = now + (ES.buf.duration - from);
  g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(ES.normGain, now+0.02);
  g.gain.setValueAtTime(ES.normGain, Math.max(now+0.03, endAt-0.25)); g.gain.linearRampToValueAtTime(0.0001, endAt);
  s.connect(g); g.connect(lim);
  if(destNode){ lim.connect(destNode); } lim.connect(c.destination);
  s.start(0, from); src = s; startedAt = c.currentTime; startOff = from; ES.playing = true;
  if(rawRate(ES.edit[curIdx], Math.max(0, from - ES.edit[curIdx].start)) <= PLAY_MAX) ES.edit[curIdx].el.play().catch(()=>{});
  setPlayLabel(true);
  s.onended = () => { if(src===s){ src=null; ES.playing=false; ES.pos=0; ES.edit.forEach(e=>e.el.pause()); setPlayLabel(false); onEnd && onEnd();
    // back at the start: the picture, the progress bar and the playhead too (the time already says 0:00)
    if(!ES.recording){ try{ if(ES.edit.length){ prepare(0, 0).then(() => { if(!ES.playing){ drawFrame(0); drawTimeline(); } }); } drawTimeline(); }catch(e){} } } };
  const loop = () => {
    if(!ES.playing) return;
    const t = Math.max(0, curTime()), i = segAt(t);
    if(i !== curIdx){
      const prevEl = ES.edit[curIdx]?.el; curIdx = i; const e = ES.edit[i], l = t-e.start;
      const r1 = rateAt(e, l), want = srcPos(e, l);
      if(Math.abs(e.el.currentTime-want) > 0.12) e.el.currentTime = want;
      if(r1>0 && rawRate(e, l) <= PLAY_MAX){ e.el.playbackRate = r1; e.el.play().catch(()=>{}); } else e.el.pause();
      if(prevEl && prevEl!==e.el) prevEl.pause();     // stays on its last frame for the transition
      if(ES.edit[i+1]) prepare(i+1, ES.edit[i+1].start);
    } else {
      const e = ES.edit[i], l = t-e.start, r = rateAt(e, l), want = srcPos(e, l);
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
      const n2 = ES.edit[i+2];
      if(n2 && !n2._cued && l > trDur(e) + 0.05){ n2._cued = true; prepare(i+2, n2.start); }
    }
    if(ES.layers.length) syncLayers(t);
    drawFrame(t);
  };
  const raf = () => { loop(); if(ES.playing) rafId = requestAnimationFrame(raf); };
  rafId = requestAnimationFrame(raf);
  timer = setInterval(()=>{ if(document.hidden) loop(); }, 33);
}
let onEnd = null;
$('play').onclick = () => { if(ES.recording) return; if(ES.playing){ ES.pos = curTime(); stopAll(); } else if(ES.starting) stopAll(); else startPlayback(ES.pos >= ES.buf.duration-0.05 ? 0 : ES.pos); };

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
let capEdited = false; ES.tplName = '';
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
ES.lastVideo = null;
let lastName = ''; ES.exportKeep = false; ES.exportP = 0;
function saveFile(blob, name){
  if(/^video\//.test(blob.type)){ ES.lastVideo = blob; fillCaption(); rememberTools(); offerMade(); }
  if(ES.exportKeep){ lastName = name; return false; }
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
  const keepBuf = ES.buf, keepNorm = ES.normGain;
  let stream = null, dest = null, rec = null, tick = null;
  const chunks = [];
  ES.recording = true; latencyOn = false; ['play','remix','export','cover'].forEach(id=>$(id).disabled=true);
  try{
    setCanvas(true, XQ[xq.res].scale); await captureLoop();
    showMsg('Saving your Reel in real time on this browser (' + fmt(ES.buf.duration) + '). Please keep this screen open.');
    tasks.start('export', 'export', 'Exporting your Reel', 'In real time on this browser · keep this screen open');
    { const t0 = performance.now(), D = Math.max(1, ES.buf.duration*1000); tick = setInterval(() => { if(!ES.recording){ clearInterval(tick); return; } tasks.update('export', Math.min(0.99, (performance.now()-t0)/D)); }, 500); }
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
    if(ES.noSong){ const sd = exportSound(); ES.buf = sd ? sd.buf : c.createBuffer(2, Math.ceil(keepBuf.duration*c.sampleRate), c.sampleRate); ES.normGain = sd ? sd.gain : 1; }
    ES.pos = 0;
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
    ES.buf = keepBuf; ES.normGain = keepNorm;
    ES.recording = false; latencyOn = true; ['play','remix','export','cover'].forEach(id=>$(id).disabled=false);
    setCanvas(false);
    if(ES.edit.length) captureLoop();
  }
}

// Fast export: every frame is decoded (WebCodecs, through mediabunny), drawn and encoded off-screen, faster than real
// time and frame-accurate (no dropped frames). The sound goes through the same gain + limiter as the preview.
// "Export without the song": for adding the same song as Instagram's own sound (trending audio, which this app may not
// include). The voice stays (talking videos, voiceovers); with nothing else there is no sound track at all. The message
// says which song and from where, so the beat cuts line up when the sound is added in Instagram.
ES.noSong = false;
$('nosong').addEventListener('change', e => { ES.noSong = e.target.checked; }, SIG);
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
  const [W, H] = exportDims(), fps = xq.fps, dur = ES.buf.duration;
  // H.264 + AAC in MP4 (what Instagram wants); browsers without an H.264 encoder get VP9 + Opus in WebM
  const vcodec = await inTime(mb.getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'], {width:W, height:H}), 10000, null);
  if(!vcodec) return false;
  const mp4 = vcodec === 'avc';
  const acodec = await inTime(mb.getFirstEncodableAudioCodec(mp4 ? ['aac', 'opus'] : ['opus'], AUD), 10000, null);
  if(!acodec){ console.warn('fast export: no audio encoder for', vcodec); return false; }
  console.info('fast export:', vcodec, acodec, W + 'x' + H, fps + ' fps');
  stopAll();
  ES.recording = true; latencyOn = false; ['play','remix','export','cover'].forEach(id=>$(id).disabled=true);
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
    for(const L of ES.layers){ const M = ES.lmedia[L.m]; if(!M || M.kind !== 'video') continue;
      const input = new mb.Input({ source: new mb.BlobSource(M.file), formats: mb.ALL_FORMATS }); inputs.push(input);
      const track = await input.getPrimaryVideoTrack(); if(!track) continue;
      const r = Math.min(1, (L.s*W)/M.w*1.4), first = await track.getFirstTimestamp();
      const sink = new mb.CanvasSink(track, { width: Math.max(16, Math.round(M.w*r/2)*2), height: Math.max(16, Math.round(M.h*r/2)*2), fit: 'fill', poolSize: LOW_MEMORY_DEVICE ? 2 : 3 });
      const k0 = Math.ceil(L.t0*fps - 1e-6), k1 = Math.min(Math.round(dur*fps), Math.ceil(L.t1*fps - 1e-6)), ts = [];
      for(let k=k0;k<k1;k++){ const v = first + Math.min(M.dur - 0.05, Math.max(0, lyTime(L, k/fps))); ts.push(ts.length ? Math.max(v, ts[ts.length-1]) : v); }
      lyIts.push({ L, k0, k1, it: sink.canvasesAtTimestamps(ts)[Symbol.asyncIterator]() }); }
    const layerFrames = async (k) => { for(const q of lyIts){ if(k < q.k0 || k >= q.k1) continue; const r = await q.it.next(); if(!r.done && r.value) q.L.fc = r.value.canvas; } };
    ES.exporting = true;
    const total = Math.round(dur*fps);
    // the frames of every shot: a frame belongs to the shot showing at its time (the same rule as drawFrame)
    const shots = []; { let f0 = 0; ES.edit.forEach((e,i)=>{ const fEnd = i+1 < ES.edit.length ? Math.min(total, Math.ceil(ES.edit[i+1].start*fps - 1e-6)) : total; shots.push({ f0, fEnd }); f0 = fEnd; }); }
    const open = async (i) => {
      const e = ES.edit[i], sh = shots[i]; if(!e || sh.fEnd <= sh.f0) return null;
      const { sink, first, half } = await sinkFor(e.src, i % 2), sdur = sources[e.src].dur, ts = [];
      for(let k=sh.f0; k<sh.fEnd; k++){ const v = first + half + Math.min(Math.max(0, srcPos(e, Math.max(0, k/fps - e.start))), sdur - 2*half - 0.01); ts.push(!ts.length ? v : e.cs && e.cs.rev ? Math.min(v, ts[ts.length-1]) : Math.max(v, ts[ts.length-1])); }
      const it = (e.cs && e.cs.rev ? revFramesExport(sink, ts) : sink.canvasesAtTimestamps(ts))[Symbol.asyncIterator]();
      const firstP = it.next(); firstP.catch(()=>{});
      return { it, firstP, ts, sink, first, half };
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
    for(let i=0; i<ES.edit.length; i++){
      const e = ES.edit[i], sh = shots[i], cur = await pre; pre = null;
      if(!cur){ pre = open(i+1); continue; }
      let k = sh.f0, r = await cur.firstP, consecutiveMissing = 0;
      pre = open(i+1);   // the next shot starts seeking now, while this one is drawn
      // Encode the complete timeline range, not merely however many frames the decoder happens to yield.
      // A short/variable-frame-rate source can end its timestamp iterator early; skipping those output timestamps
      // makes the muxer hold the last picture, which looks exactly like a still photo at the next transition.
      while(k < sh.fEnd){
        const wc = r.done ? null : r.value;
        const ta = performance.now(); prof.decode += ta - tq;
        if(wc){ const l = k/fps - e.start; e.fc = smoothOn(e, l) ? smoothPic(e, wc.canvas, wc.timestamp, cur.ts[k-sh.f0], wc.duration > 0 ? wc.duration : 2*cur.half) : wc.canvas; consecutiveMissing = 0; }
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
          tasks.update('export', done, done < 0.95 ? 'Putting your Reel together · keep this screen on' : 'Finishing the video file'); ES.exportP = done; titleProgress('export', 'Exporting your Reel', done);
          await yieldNow();
        }
        if(k < sh.fEnd && !r.done) r = await cur.it.next();
      }
      if(e.fc){ const c = document.createElement('canvas'); c.width = e.fc.width; c.height = e.fc.height; c.getContext('2d').drawImage(e.fc,0,0); e.fcLast = c; }
      e.fc = null; f = sh.fEnd;
      { const o = ES.edit[i-2]; if(o && o.fcLast){ o.fcLast.width = o.fcLast.height = 0; o.fcLast = null; } }   // older last frames are not drawn again
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
    if(ES.noSong){ notify('Your Reel is ready', 'ok'); showMsg(savedMsg(sh, 'Video') + ' without the song: ' + noSongTip()); return true; }
    notify('Your Reel is ready', 'ok'); showMsg(savedMsg(sh, 'Video') + ': ' + name + ' (' + (blob.size/1e6).toFixed(1) + ' MB). Ready for Instagram, TikTok and Shorts.');
    return true;
  } finally {
    ES.exporting = false; ES.edit.forEach(e=>{ e.fc = null; e.fcLast = null; }); ES.layers.forEach(L => { L.fc = null; });
    // a read-ahead still running (the export stopped early) ends first: letting its decoder go under it fails
    if(pre){ try{ const p2 = await pre; if(p2 && p2.it.return) await p2.it.return(); }catch(err){} pre = null; }
    inputs.forEach(x=>{ try{ x.dispose(); }catch(err){} });
    ES.recording = false; latencyOn = true; ['play','remix','export','cover'].forEach(id=>$(id).disabled=false);
    setCanvas(false); if(ES.edit.length) captureLoop();
  }
}
// While exporting, the screen is kept on (Screen Wake Lock): a phone that dims and locks halfway stops the page and with
// it the export. The lock is taken again if the page comes back from the background; it is let go at the end.
let wakeLock = null; ES.exportBusy = false;
async function holdScreen(){ try{ if(navigator.wakeLock && !document.hidden){ wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', ()=>{ wakeLock = null; }); } }catch(err){ wakeLock = null; } }
$('fexpcancel')?.addEventListener('click', () => { if(!ES.exportBusy) return; expCancel = true; $('fexpcancel').textContent = 'Cancelling…'; }, SIG);
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
document.addEventListener('visibilitychange', ()=>{ if(ES.exportBusy && !document.hidden && !wakeLock) holdScreen(); }, SIG);
// the preview stops when the person goes to another tab or app (the song is WebAudio: pausing the page's videos alone keeps it playing)
document.addEventListener('visibilitychange', ()=>{ if(isHidden() && ES.playing && !ES.recording) stopAll(); }, SIG);
async function runExport(toCloud){
  if(ES.recording || ES.exportBusy) return;
  if(root.classList.contains('aineed')){ $('aiaskgo').click(); return; }   // no Reel without its Shubix AI (the creator closed the question)
  ES.exportBusy = true; $('saverow').hidden = true; ES.lastVideo = null;
  tasks.start('export', 'export', 'Exporting your Reel', 'Getting ready');   // in view at once, whatever comes next
  askToNotify();   // once: a notification when the Reel is ready while the person is in another app
  const awake = holdAwake();
  await holdScreen();
  expCancel = false;
  // work interrupted by the background (the browser took the decoder back, or stopped drawing) is not lost: it waits
  // for the page to come back and goes on (twice at most), instead of falling to the slower way or failing
  const paused = async () => { tasks.update('export', null, 'Paused while you were away · it goes on when you come back'); showMsg('Your export paused while Shubix was in the background. It goes on now that you are back.'); await whenVisible(); tasks.update('export', ES.exportP || 0, 'Going on with your export'); };
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
    if(toCloud && ES.lastVideo) await saveToMyReels(ES.lastVideo);
    if(ES.lastVideo) void notifyDone('Your Reel is ready', fileTitle() + ' is saved · tap to open Shubix', 'shubix-export');
    else void notifyDone('Your export stopped', 'Open Shubix to try again', 'shubix-export');
  } finally {
    titleDone('export'); awake();
    ES.exportBusy = false; if(wakeLock){ try{ await wakeLock.release(); }catch(err){} wakeLock = null; }
    if(ES.remakeAfterExport){ ES.remakeAfterExport = false; if(ES.buf && sources.length && !ES.recording) makeEdit(); }
  }
}

/* ---- the export sheet: quality, frame rate, the file size, "Export to phone" or "Export & save to My Reels" ---- */
// bitrates for 30 fps (60 fps gets half as much again); 4K is offered only where this browser can encode it
const XQ = { '720': { scale: 2/3, bitrate: 6e6, label: '720p' }, '1080': { scale: 1, bitrate: 12e6, label: '1080p' }, '4k': { scale: 2, bitrate: 35e6, label: '4K' } };
const xq = { res: '1080', fps: 30, nowm: false, my: true };
try{ const v = JSON.parse(localStorage.getItem('studio-export') || 'null'); if(v && XQ[v.res]) xq.res = v.res; if(v && (v.fps === 30 || v.fps === 60)) xq.fps = v.fps; if(v && typeof v.nowm === 'boolean') xq.nowm = v.nowm; if(v && typeof v.my === 'boolean') xq.my = v.my; }catch(e){}
ES.wmOff = false;   // set from the person's plan when the sheet opens (sheetOpen)
let can4k = null, cloudAt = 0; ES.cloudInfo = null;
function planPaint(){
  const lb = $('look'); if(lb) for(const b of lb.querySelectorAll('[data-l]')){ const k = b.dataset.l, on = isLocked('look', k); b.classList.toggle('crowned', on); b.title = on ? PLAN_NAME[lockNeed('look', k)] + ' filter: try it, export asks' : ''; }
  if(ES.edit.length){ renderEDL(true); renderOvList(); }
}
// what in this Reel needs a higher plan, each with how to take it out
function lockedUsed(){
  const out = [], add = (cat, key, name, fix) => { if(isLocked(cat, key)) out.push({ need: lockNeed(cat, key), name, fix }); };
  for(const e of ES.edit){
    if(e.tr && e.tr !== 'hard') add('tr', e.tr, TR_NAME[e.tr] || e.tr, () => { e.tr = 'dissolve'; });
    if(e.efx && e.efx !== 'none') add('fx', e.efx, FX_NAME[e.efx] || e.efx, () => { e.efx = 'none'; e.kf = keyframesFor(e); });
    const c = e.cs || {};
    if(c.beauty) add('tool', 'beauty', 'Beauty', () => { delete e.cs.beauty; });
    if(c.stab) add('tool', 'stab', 'Stabilize', () => { delete e.cs.stab; });
    if(c.curve) add('tool', 'curve', 'Speed curve', () => { delete e.cs.curve; e.sp = SPEED.normal; });
  }
  add('look', ES.look, (LOOKS[ES.look] || {}).name || ES.look, () => { const b = $('look').querySelector('[data-l="vivid"]'); if(b) b.click(); });
  for(const o of ES.overlays){ if(o.font) add('font', o.font, 'Font ' + ((OV_FONTS[o.font] || [])[0] || o.font), () => { o.font = undefined; });
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
  const [W, H] = exportDims(), dur = ES.buf ? ES.buf.duration : 0, mb = (XQ[xq.res].bitrate * (xq.fps > 30 ? 1.5 : 1) + 256e3) * dur / 8 / 1e6;
  $('xsize').textContent = W + ' × ' + H + ' · ' + xq.fps + ' fps · up to ' + (mb < 10 ? mb.toFixed(1) : Math.round(mb)) + ' MB';
  { const fn = $('xfname'); if(fn) fn.textContent = fileTitle() + '.mp4'; }
  // Remove Watermark, and Save to My Reels (when the account has My Reels); "Export to phone" does what they say
  wmPaid = exRule().noWatermark; const R = exRule();
  for(const b of $('xres').children) b.classList.toggle('crowned', { '720': 0, '1080': 1, '4k': 2 }[b.dataset.r] > { '720': 0, '1080': 1, '4k': 2 }[R.maxRes]);
  for(const b of $('xfps').children) b.classList.toggle('crowned', b.dataset.f === '60' && !R.fps60);
  $('xwm').disabled = !wmPaid; $('xwm').checked = wmPaid && xq.nowm; $('xwmpro').hidden = wmPaid;
  ES.wmOff = wmPaid && xq.nowm;
  const cb = $('xgocloud'), note = $('xcloudnote'), my = $('xmy');
  cb.hidden = true;
  $('xmyrow').hidden = note.hidden = !ES.cloudInfo;
  if(ES.cloudInfo){
    const full = ES.cloudInfo.used >= ES.cloudInfo.limit;
    my.disabled = full; my.checked = xq.my && !full;
    note.textContent = full ? 'My Reels is full (' + ES.cloudInfo.used + ' of ' + ES.cloudInfo.limit + '). Delete a Reel there to make room.' : 'Also kept in your account, to watch, download or share anywhere · ' + ES.cloudInfo.used + ' of ' + ES.cloudInfo.limit + ' used';
  }
}
// the export sheet's picture: the preview's own picture, copied while the sheet is open (it plays the Reel as the
// editor does, with its song); closing the sheet stops it
function xprevLoop(){
  if($('xsheet').hidden) return;
  const c = $('xprevc'); if(c.width !== out.width || c.height !== out.height){ c.width = out.width; c.height = out.height; }
  try{ c.getContext('2d').drawImage(out, 0, 0); }catch(e){}
  $('xprevplay').hidden = ES.playing || ES.starting;
  requestAnimationFrame(xprevLoop);
}
$('xprev').addEventListener('click', () => { if(!ES.exporting) $('play').click(); }, SIG);
function sheetOpen(open){
  $('xsheet').hidden = !open;
  if(!open){ if(ES.playing && !ES.recording){ ES.pos = curTime(); stopAll(); } return; }
  // the Reel beside the settings (the design's frame 8)
  if(ES.edit.length){ $('xprev').setAttribute('src', 'live'); requestAnimationFrame(xprevLoop); }
  sheetPaint();
  $('xgo').focus();
  if(can4k === null) loadMediabunny().then(mb => { const [W0,H0] = SIZES[ES.aspect]; return mb.getFirstEncodableVideoCodec(['avc','vp9','av1'], {width: W0*2, height: H0*2}); })
    .then(c => { can4k = !!c; if(!can4k && xq.res === '4k') xq.res = '1080'; sheetPaint(); }, () => { can4k = false; sheetPaint(); });
  // My Reels' room, asked once a minute at most (the sheet opens often; each request wakes the API's container)
  if(cloud && Date.now() - cloudAt > 60_000){ cloudAt = Date.now(); cloud.usage().then(u => { ES.cloudInfo = u; sheetPaint(); }, () => { cloudAt = 0; }); }
  // a paid plan (or the administrator) may remove the watermark
  planLoad();   // the plan's rules (watermark, quality) are read again; sheetPaint follows
}
const sheetPick = () => { try{ localStorage.setItem('studio-export', JSON.stringify(xq)); }catch(e){} sheetPaint(); };
$('xres').addEventListener('click', e => { const b = e.target.closest('button'); if(!b || b.disabled) return; xq.res = b.dataset.r; sheetPick(); }, SIG);
$('xfps').addEventListener('click', e => { const b = e.target.closest('button'); if(!b) return; xq.fps = +b.dataset.f; sheetPick(); }, SIG);
$('xshclose').addEventListener('click', () => sheetOpen(false), SIG);
$('xsheet').addEventListener('click', e => { if(e.target === $('xsheet')) sheetOpen(false); }, SIG);
addEventListener('keydown', e => { if(e.key === 'Escape' && !$('xsheet').hidden) sheetOpen(false); }, SIG);
$('xwm').addEventListener('change', e => { if(!wmPaid){ e.target.checked = false; return; } xq.nowm = e.target.checked; ES.wmOff = xq.nowm; sheetPick(); }, SIG);
$('xmy').addEventListener('change', e => { xq.my = e.target.checked; sheetPick(); }, SIG);
$('xgo').addEventListener('click', async () => { const L = lockedUsed(); if(L.length){ if(!(await planGate(L))) return; renderEDL(true); renderOvList(); sheetPaint(); }
  ES.wmOff = wmPaid && xq.nowm; sheetOpen(false); runExport(!!ES.cloudInfo && ES.cloudInfo.used < ES.cloudInfo.limit && xq.my); }, SIG);
$('xgocloud').addEventListener('click', async () => { const L = lockedUsed(); if(L.length){ if(!(await planGate(L))) return; renderEDL(true); renderOvList(); }
  sheetOpen(false); runExport(true); }, SIG);
$('export').onclick = () => { if(ES.recording || ES.exportBusy) return; if(root.classList.contains('aineed')){ $('aiaskgo').click(); return; } sheetOpen(true); };

async function saveToMyReels(blob){
  if(!cloud) return;
  const [W, H] = exportDims(), name = reelTitle || 'Reel';
  const msg = $('xmsg').textContent;
  try{
    showMsg('Saving to My Reels… 0%');
    tasks.start('cloud', 'cloud', 'Saving to My Reels', (blob.size/1e6).toFixed(1) + ' MB · you can keep editing');
    await cloud.save(blob, { name, dur: ES.buf ? Math.round(ES.buf.duration*10)/10 : 0, width: W, height: H, fps: xq.fps, thumb: thumbOf() || undefined },
      p => { $('xmsg').textContent = 'Saving to My Reels… ' + Math.round(p*100) + '%'; $('prog').style.width = (p*100).toFixed(1) + '%'; tasks.update('cloud', p); });
    tasks.done('cloud', 'Saved to My Reels');
    if(ES.cloudInfo) ES.cloudInfo.used++;
    showMsg(msg + ' Also saved to My Reels.');
  }catch(err){
    console.warn('My Reels:', err);
    showMsg(msg); tasks.fail('cloud', err && err.code ? err.message : 'Your Reel is saved on your phone, but not in My Reels. Please try again.');
  }
}

/* ---- options ---- */
const redraw = () => { if(!ES.playing && ES.edit.length) drawFrame(ES.pos || 0.3); };
$('hook').addEventListener('input', e=>{ ES.hookText = e.target.value.trim(); if(!ES.playing && ES.edit.length){ ES.pos = Math.min(ES.pos, 1.0) || 0.6; prepare(segAt(ES.pos), ES.pos).then(redraw); } });
$('look').addEventListener('click', e=>{ const b=e.target.closest('button'); if(!b) return; ES.look=b.dataset.l; [...$('look').children].forEach(x=>x.setAttribute('aria-pressed', x===b)); if(ES.edit.length && !ES.playing && !ES.recording) captureLoop(); });
$('safe').addEventListener('change', e=>{ ES.showSafe = e.target.checked; redraw(); });
const MODE_HELP = {
  auto: 'Auto: the music decides. Calm parts get longer shots, drops and hits get effects.',
  ai: 'Shubix AI: Shubix watches your clips and listens to the song, then decides every cut, transition, effect, speed and camera move.',
  smooth: 'Smooth: fewer, longer shots on the strong beats, soft camera moves, no flashy effects.',
  fast: 'Fast: a cut on every beat, a transition on every cut, punches and speed changes on the hits.',
  copy: 'Copy a Reel: its pace, transitions and shapes, camera moves, speed and colours, on this song and your clips. With Shubix on, it copies what the Reel does on each kind of music moment.',
};
// a learned style used for a creator (by their template's kind, styleForTemplate) changes only the edit: the creator never
// sees it, the mode they had stays pressed. The administrator sees it as Copy a Reel.
const silentStyle = () => !!(ES.refProfile && ES.refProfile.silent);
// with the AI on (aiOn), "Auto" is the AI deciding freely: named so (Smooth and Fast are styles the AI is asked for)
function modeWords(shown){ const b = $('mode').querySelector('[data-m="auto"]'); if(b) b.textContent = ES.aiOn ? 'Shubix AI' : 'Auto';
  $('modehelp').textContent = MODE_HELP[shown === 'auto' && ES.aiOn ? 'ai' : shown]; }
function setMode(m){ ES.mode = m; const shown = m === 'copy' && silentStyle() ? ES.refProfile.shown || 'auto' : m;
  [...$('mode').children].forEach(x=>x.setAttribute('aria-pressed', x.dataset.m===shown)); modeWords(shown);
  $('refbox').hidden = !ES.refProfile || silentStyle();
  if(ES.buf){ ES.plan = adaptPlan(); drawMusic(); $('mclips').textContent = ES.plan.length; }
  if(ES.buf && sources.length) makeEdit(); }
$('mode').addEventListener('click', e=>{ const b=e.target.closest('button'); if(!b || ES.recording) return; remakeOk();
  if(b.dataset.m === 'copy' && (!ES.refProfile || silentStyle())){ $('reffile').click(); return; }
  if(silentStyle() && ES.mode === 'copy' && b.dataset.m === (ES.refProfile.shown || 'auto')) return;   // already what they see
  setMode(b.dataset.m); });
$('cover').onclick = async () => {
  // cover: the best drop shot (or the hook) with the hook text, full frame
  const d = ES.edit.find(x=>x.type==='drop') || ES.edit[0], tt = d.start + Math.min(0.6, (d.end-d.start)*0.6);
  setCanvas(true); ES.coverMode = true; const i = segAt(tt); await prepare(i, tt); drawFrame(tt);
  const blob = await new Promise(r=>out.toBlob(r,'image/jpeg',0.92)); ES.coverMode = false; setCanvas(false); captureLoop();
  const sh = saveFile(blob, fileTitle() + ' cover.jpg'); showMsg(savedMsg(sh, 'Cover') + '. Pick it under "Edit cover" when you post.');
};


/* =============== COPY A REEL ===============
   The person uploads a Reel they like. Measured on this device: every cut (the scene-change reader of the clips,
   frame-accurate), the transition at each cut (flash, fade, whip pan, zoom-through, dissolve or a hard cut, from the
   frames around it), zooms inside shots, the shot lengths in beats of its own song (so the pace carries over to a song
   at another tempo), whether it cuts on the beat, its hook, and its colour look (brightness, contrast, saturation,
   warmth, teal-orange split, black and white, faded blacks, vignette, grain). "Copy a Reel" then cuts the new edit at
   that pace on this song's beats, uses that mix of transitions and effects, and grades the clips toward that look. */
ES.refProfile = null;
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
// Copy a Reel with the Reel's own song (the usual case: its song comes with it): every shot at its own time, to the frame,
// not fitted again to beats found in the song: a cut on each eighth note, a stutter of a tenth of a second and a flicker
// land exactly where they were. Another song: copyPlan (the shots' lengths in beats, on that song's beats).
const copyTimed = () => ES.mode === 'copy' && !!ES.refProfile && !ES.refProfile.learned && !!ES.refProfile.key && !!ES.song && !!ES.song.file && refKeyOf(ES.song.file) === ES.refProfile.key && (ES.refProfile.moments || []).some(m => m.at !== undefined);
// the reference's mix of transitions and effects, placed where they suit (energetic ones on drops and hits, soft ones
// on calm, long shots), counted so the shares match
const REF_TR = { hard:'hard', dissolve:'dissolve', fade:'dip', flash:'flash', whip:'whip', zoom:'zoom', glitch:'glitch', spin:'spin', iris:'iris', diamond:'diamond', heart:'heart', star:'star', wipe:'wipe', bars:'bars', blur:'blur' };
ES.copyBudget = null;
// The exact copy: each shot does what the reference's shot at the same place did (copyPlan's s.ref), measured shot by
// shot: the transition into it, its camera move (zoom, position, turn and its ease, as keyframes), a shake, a zoom.
// The shares above stay for shots the reference has no reading of (past its 40th shot, or a style without shots).
// A learned style keeps the transition shares (what Reels of its kind have in common, moved by the creator's
// corrections) and takes the rhythm and camera moves of its most typical Reel.
const copyExact = () => ES.mode === 'copy' && !!ES.refProfile && (ES.refProfile.moments || []).length >= 2;
// How close the new Reel is to the one copied, shot by shot (shown under it, and read by the checks): each shot's
// length (half or double the reference's = 0), the transition into it, whether its camera moves, and the colour look
// measured on the rendered edit. The last shot is not counted (the song's end cuts it).
ES.copyLookScore = null;
function showCopyMatch(){
  const m = copyMatch(), el = $('refmatch'); if(!el) return;
  el.hidden = !m || silentStyle(); if(!m || silentStyle()) return;
  el.textContent = 'Matches the original ' + m.total + '% · rhythm ' + m.rhythm + '% · transitions ' + m.transitions + '% · camera moves ' + m.moves + '%' + (m.look !== null ? ' · look ' + m.look + '%' : '');
}
// The copied look, matched on the edit itself (like a colourist with scopes): render a few frames of the edit, measure
// them exactly as the reference was measured, correct the grade, measure again. The edit's crops, zooms and effects are
// part of what is measured, so the result lands on the reference's numbers, not just near them.
ES.copyLookKey = ''; ES.copyLookBusy = false;
$('reffile').addEventListener('change', async e=>{
  const f = e.target.files && e.target.files[0]; e.target.value = ''; if(!f) return;
  $('refbox').hidden = false; $('refinfo').textContent = 'Reading the Reel…';
  ES.refReading = true; root.classList.add('refread');   // the AI and the Reel wait for it: they are the copy's, not an ordinary Reel's
  const mirror = new MutationObserver(() => { $('refwaitp').textContent = $('refinfo').textContent.replace(/^Reading the Reel:?\s*/, ''); });
  mirror.observe($('refinfo'), { childList: true, characterData: true, subtree: true });
  try{
    ES.refProfile = await analyzeReference(f, (p, what)=>{ $('refinfo').textContent = 'Reading the Reel: ' + what + ' ' + Math.round(p*100) + '%'; });
    $('refinfo').textContent = '“' + f.name + '”: ' + describeRef(ES.refProfile); $('stsaverow').hidden = false; $('ststat').textContent = ''; learnedKind = '';
    suggestRef(f.name);
    // the copied look is on while it is matched (makeEdit then matches it on the new edit)
    GRADES.copy = { con:1, sat:1, bri:1, warm:0, teal:0, mono: ES.refProfile.look && ES.refProfile.look.sat < 0.05 ? 1 : 0, lift:0, vig:0, grain:0 }; ES.copyLookKey = ''; ES.copyLookScore = null;
    const lb = $('look').querySelector('[data-l="copy"]'); lb.hidden = false; ES.look = 'copy'; [...$('look').children].forEach(x=>x.setAttribute('aria-pressed', x===lb));
    setMode('copy');
    refLookRun(f, ES.refProfile);   // its texts, stickers, captions, background: the AI reads them (when it is on)
  }catch(err){ console.warn('reference not read:', err); $('refinfo').textContent = 'We could not read that Reel. Please try another video.'; notify('We could not read that Reel. Please try another video.', 'err'); }
  finally{ ES.refReading = false; root.classList.remove('refread'); mirror.disconnect(); refWaiters.splice(0).forEach(r => r()); if(ES.buf && sources.length && !ES.recording) makeEdit(); }   // now the AI may plan (the copy, or the Reel as it is)
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
  if(!ES.aiOn || !R || refLookBusy) return;
  if(!aiReelOk() && !(await aiGate())) return;   // Shubix AI only after the Reel's gate (Use), as everything else
  refLookBusy = true; const url = URL.createObjectURL(file), note = t => { if(ES.refProfile === R) $('refinfo').textContent = '“' + R.name + '”: ' + describeRef(R) + (t ? ' · ' + t : ''); };
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
    if(ES.refProfile !== R) return;   // another Reel was picked meanwhile
    R.design = res; R.designDone = false; refLookApplySoon(R);
  }catch(err){
    if(err && err.name === 'AbortError') return;
    console.warn('reference texts not read:', err); note('its texts could not be read this time');
  }finally{ refLookBusy = false; setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
// once the new Reel has its edit (song part and clips in)
function refLookApplySoon(R){
  clearTimeout(refLookApplySoon.h);
  refLookApplySoon.h = setTimeout(() => { if(ES.refProfile !== R || R.designDone || ES.mode !== 'copy') return;
    if(!ES.edit.length || ES.pending || !reelLen()){ refLookApplySoon(R); return; }
    refLookApply(R); }, 600);
}
function refLookApply(R){
  const D = R.design, L = reelLen(); if(!D || !L) return;
  R.designDone = true;
  const k = L / Math.max(0.5, R.dur), base = Math.min(R.w, R.h*0.5625);
  // its sizes: letters (about 3/4 of the font size) and emoji, measured on the reference, in the studio's own units
  const sizeOf = (hf, emoji) => clip(emoji ? hf*R.h/(base*0.16) : hf*R.h/0.75/(base*0.075), 0.4, 2.6);
  const timing = (ov, x) => { const whole = x.t0 <= 0.05 && x.t1 >= R.dur - 0.05; ov.all = whole; ov.t0 = whole ? 0 : Math.max(0, Math.min(L - 0.5, x.t0*k)); ov.t1 = whole ? L : Math.min(L, Math.max(ov.t0 + 0.5, x.t1*k)); ov.ref = true; };
  ES.overlays = ES.overlays.filter(o => !o.ref);   // an earlier reference's texts go
  for(const x of D.texts || []){ const ov = addOverlay({ text: x.text, style: x.style, color: x.color, anim: x.anim, x: x.x, y: x.y, size: sizeOf(x.h, false) }); timing(ov, x); }
  for(const x of D.stickers || []){ const ov = addOverlay({ text: x.emoji, emoji: true, x: x.x, y: x.y, size: sizeOf(x.h, true) }); timing(ov, x); }
  const said = [];
  if(D.texts && D.texts.length) said.push(D.texts.length + ' text' + (D.texts.length > 1 ? 's' : ''));
  if(D.stickers && D.stickers.length) said.push(D.stickers.length + ' sticker' + (D.stickers.length > 1 ? 's' : ''));
  if(D.captions){ press('tstyle', 't', D.captions.style); ES.ACCENT = D.captions.color || ES.ACCENT;
    if(!ES.capsOn && !$('capwrap').hidden){ $('caps').checked = true; ES.capsOn = true; $('caprow').hidden = false; loadCaptions(); }
    said.push($('tstyle').querySelector('[data-t="' + D.captions.style + '"]').textContent.toLowerCase() + ' captions'); }
  if(D.background && D.background.mode !== 'none' && sources.some(s => s.faces && s.faces.some(f => f.n > 0))){
    if(D.background.mode === 'color' && D.background.color) bgColor = D.background.color;
    press('bgmode', 'b', D.background.mode); said.push(D.background.mode === 'blur' ? 'blurred background' : 'colour background'); }
  ES.ovSel = -1; renderOvList(); redraw();
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
async function api(path, opts){ const r = await fetch(path, { signal: ac.signal, ...opts, headers: { ...(opts && opts.headers) } }); const j = await r.json().catch(() => ({}));
  if(r.status === 401) throw new Error('sign in to keep a style library'); if(!r.ok) throw new Error((j.error && j.error.message) || ('error ' + r.status)); return j; }
// only the administrator teaches the styles (FastStudio.tsx sets the 'admin' class): a creator's copied Reel is offered
// to the administrator (its fingerprint, never the video), who uses it under a kind or removes it (Admin → My trends)
function suggestRef(name){
  if(root.classList.contains('admin') || !ES.refProfile || ES.refProfile.learned) return;
  api('/api/studio/styles/suggest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: (name || 'Reel').replace(/\.[^.]+$/, '').slice(0, 120) || 'Reel', fp: fingerprintOf(ES.refProfile) }) })
    .catch(err => console.info('copied Reel not offered for the styles:', err && err.message));
}
$('stsave').addEventListener('click', async () => {
  if(!ES.refProfile || ES.refProfile.learned) return;
  $('ststat').textContent = 'Saving…';
  try{ const r = await api('/api/studio/styles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: (ES.refProfile.name || 'Reel').slice(0, 120), category: $('stcat').value, shared: $('stshare').checked, fp: fingerprintOf(ES.refProfile) }) });
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
    ES.refProfile = { ...r.fp, name: 'Learned ' + STYLE_KINDS[k] + ' style', cuts: [], learned: true };
    GRADES.copy = { con:1, sat:1, bri:1, warm:0, teal:0, mono: ES.refProfile.look && ES.refProfile.look.sat < 0.05 ? 1 : 0, lift:0, vig:0, grain:0 }; ES.copyLookKey = ''; ES.copyLookScore = null;
    const lb = $('look').querySelector('[data-l="copy"]'); lb.hidden = false; ES.look = ES.refProfile.look ? 'copy' : ES.look; [...$('look').children].forEach(x=>x.setAttribute('aria-pressed', x.dataset.l === ES.look));
    $('linfo').textContent = 'Learned from ' + r.n + ' Reel' + (r.n > 1 ? 's' : '') + (r.accuracy ? ' · predicts a new ' + STYLE_KINDS[k].toLowerCase() + ' Reel ' + Math.round(r.accuracy.learned*100) + '% (default style ' + Math.round(r.accuracy.baseline*100) + '%)' : '') + (r.corrections ? ' · ' + r.corrections + ' of your changes' : '');
    setMode('copy'); $('refinfo').textContent = ES.refProfile.name + ': ' + describeRef(ES.refProfile); $('stsaverow').hidden = true;
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
  if(ES.refProfile && !ES.refProfile.learned) return;   // a Reel the creator is copying comes first
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
  const k = TPL_STYLE[name], g = ++styleGen, shown = ES.mode === 'copy' ? (ES.refProfile && ES.refProfile.shown) || 'auto' : ES.mode;
  ES.tplKind = k || '';
  const drop = () => { if(ES.refProfile && ES.refProfile.learned && !ES.refProfile.cuts.length && learnedKind && ES.refProfile.byTpl){ ES.refProfile = null; learnedKind = ''; if(ES.mode === 'copy') setMode(shown); } };
  if(ES.refProfile && !ES.refProfile.learned) return;
  if(!k || ES.kind === 'talk'){ drop(); return; }
  // Shubix AI on: its brain and the learning combined (the AI reads every kind's trend, this template's first, and fits
  // it to this song); the learned Reel copied as it is only for a Reel made without the AI
  if(ES.aiOn){ drop(); return; }
  try{ const r = await api('/api/studio/styles/learned?category=' + encodeURIComponent(k) + '&scope=all');
    if(g !== styleGen || (ES.refProfile && !ES.refProfile.learned)) return;
    if(!r.fp){ drop(); return; }
    const admin = root.classList.contains('admin');
    learnedKind = k; ES.refProfile = { ...r.fp, name: 'Learned ' + STYLE_KINDS[k] + ' style', cuts: [], learned: true, byTpl: true, silent: !admin, shown };
    if(admin) $('refinfo').textContent = ES.refProfile.name + ': ' + describeRef(ES.refProfile);
    setMode('copy');
  }catch(err){ /* no learned style here (signed out, offline): the template as it is */ }
}
// A Reel the creator made and saved (downloaded, shared, kept in My Reels) is offered to the administrator like a copied
// one: its numbers only (pace, cuts, transitions, camera moves), never the video. The administrator uses it under a
// kind or removes it (Admin -> My trends -> Reels from users). Not for a copy of someone else's Reel (that one was offered).
function offerMade(){
  if(root.classList.contains('admin') || ES.kind === 'talk' || (ES.refProfile && !ES.refProfile.learned) || ES.edit.length < 4 || !(ES.period > 0)) return;
  const P = ES.period, secs = ES.edit.map(e => e.end - e.start), med = a => [...a].sort((x, y) => x - y)[Math.floor(a.length/2)] || 0;
  const inv = {}; for(const [k, t] of Object.entries(REF_TR)) inv[t] = k;
  const trans = {}; ES.edit.slice(1).forEach(e => { const k = inv[e.tr]; if(k) trans[k] = (trans[k] || 0) + 1/(ES.edit.length - 1); });
  const zoomOf = e => { const sc = e.kf && e.kf.scale; if(!sc || sc.length < 2) return 'none'; const d = sc[sc.length-1][1] - sc[0][1]; return d > 0.02 ? 'in' : d < -0.02 ? 'out' : 'none'; };
  const onBeat = ES.edit.slice(1).filter(e => ES.beats.some(b => Math.abs(b - e.start) < 0.07)).length / (ES.edit.length - 1);
  const R = { dur: ES.edit[ES.edit.length-1].end - ES.edit[0].start, bpm: 60/P, medianBeats: med(secs)/P, medianSec: med(secs), hookBeats: secs[0]/P, hookSec: secs[0], onBeat, energy: 'steady',
    zoomShare: ES.edit.filter(e => zoomOf(e) !== 'none').length / ES.edit.length, trans, look: null, shotBeats: secs.map(x => x/P), shotSec: secs,
    moments: ES.edit.map((e, i) => ({ beats: secs[i]/P, sec: secs[i], tr: i ? inv[e.tr] || 'hard' : 'start', zoom: zoomOf(e) })) };
  const name = ES.song && ES.song.name ? ES.song.name.replace(/\.[^.]+$/, '') : sources[0] ? sources[0].name.replace(/\.[^.]+$/, '') : 'Reel';
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
let voRec = null; ES.baseBuf = null; ES.baseNorm = 1; ES.vo = null;
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
const musicOut = () => ES.au.mfoutManual ? ES.au.mfout : (ES.au.ai ? 0.8 : 0);
ES.clipMixKey = ''; ES.au = { ...AU0 };
const fxCache = new Map();
// a shot's own sound, decoded once per clip (null: the clip has no sound)
async function clipPcm(si){
  const s = sources[si]; if(!s) return null; if(s.pcm !== undefined) return s.pcm;
  try{ const b = await decodeAnyAudio(s.file).catch(e => { if(s.edFile && s.edAudio) return decodeAnyAudio(new File([s.edFile], 'copy.' + (/webm/.test(s.edFile.type) ? 'webm' : 'mp4'), { type: s.edFile.type })); throw e; }), m = new Float32Array(b.length), ch = b.numberOfChannels;
    for(let c=0;c<ch;c++){ const d = b.getChannelData(c); for(let i=0;i<m.length;i++) m[i] += d[i]/ch; }
    s.pcm = { x: m, sr: b.sampleRate }; }catch(e){ s.pcm = null; }
  return s.pcm;
}
const csVoiced = e => !!(e.cs && (e.cs.vol > 0 || (e.cs.kx || []).some(k => k.vol > 0)));   // the shot's own sound plays (its volume, or a volume keyframe)
const clipVoiced = () => ES.kind !== 'talk' && ES.edit.some(e => csVoiced(e));
/* ---- text to speech (on the phone, Piper voices): each piece of speech starts at its time and is mixed like the
 * voiceover (the voice changer works on it too; the song steps back while it speaks) ---- */
let ttsSeq = 0; ES.ttsClips = [];
const ttsPcm = (c) => { if(!c.pcm) return null; if(ES.au.vfx === 'none') return c.pcm; const k = 'tts' + c.id + '|' + ES.au.vfx; if(!fxCache.has(k)) fxCache.set(k, voiceFx(c.pcm, c.sr, ES.au.vfx)); return fxCache.get(k); };
async function ttsAdd(){
  const text = $('ttstext').value.trim(), voice = $('ttsvoice').value; if(!text || !voice) return;
  if(!tts){ notify('Text to speech is not available here.', 'err'); return; }
  const c = { id: ++ttsSeq, text, voice, at: ES.edit.length ? Math.max(0, Math.min(ES.pos, (ES.buf ? ES.buf.duration : 0) - 0.5)) : 0 };
  $('ttsadd').disabled = true;
  try{ await ttsMake(c); ES.ttsClips.push(c); $('ttstext').value = ''; ttsList(); applyVo(); ES.clipMixKey = ''; if(!ES.playing) redrawFrame(); notify('Speech added at ' + fmt(c.at).replace(/\.\d+$/, '') + '.'); }
  catch(e){} finally{ $('ttsadd').disabled = false; }
}
async function addTtsAtPlayhead(text, voice){
  if(!String(text || '').trim() || !voice) throw new Error('Enter the voice text and choose a voice.');
  const before = ES.ttsClips.length;
  $('ttstext').value = String(text).slice(0, 1200);
  $('ttsvoice').value = String(voice);
  await ttsAdd();
  if(ES.ttsClips.length <= before) throw new Error('The voice could not be generated. Please try another voice or shorter text.');
  saveNow();
  return { id: ES.ttsClips[ES.ttsClips.length - 1].id, at: ES.ttsClips[ES.ttsClips.length - 1].at, duration: ES.ttsClips[ES.ttsClips.length - 1].pcm ? ES.ttsClips[ES.ttsClips.length - 1].pcm.length / ES.ttsClips[ES.ttsClips.length - 1].sr : 0 };
}
async function setCaptions(enabled, language, translation){
  ES.capsOn = !!enabled;
  $('caps').checked = ES.capsOn;
  $('caprow').hidden = !ES.capsOn;
  if(language !== undefined) $('caplang').value = String(language || '');
  if(translation !== undefined) $('captr').value = String(translation || '');
  if(ES.capsOn) await loadCaptions(); else { capStat(''); redraw(); }
  saveNow();
  return { enabled: ES.capsOn, language: $('caplang').value, translation: $('captr').value };
}
function setCaptionStyle(style){
  ES.textStyle = String(style || 'pop');
  [...$('tstyle').children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.t === ES.textStyle)));
  redraw(); saveNow(); return ES.textStyle;
}
function ttsList(){
  const box = $('ttslist'); box.innerHTML = '';
  for(const c of ES.ttsClips){ const d = document.createElement('div'); d.className = 'ttsitem';
    d.innerHTML = `<span class="tt"></span><span class="tm"></span><button type="button" class="${Button.small}" aria-label="Remove this speech">×</button>`;
    d.querySelector('.tt').textContent = '"' + c.text + '"'; d.querySelector('.tm').textContent = fmt(c.at).replace(/\.\d+$/, '') + ' · ' + ((tts && tts.voices.find(v => v.key === c.voice) || {}).label || c.voice) + (c.pcm ? ' · ' + (c.pcm.length/c.sr).toFixed(1) + ' s' : ' · not made yet');
    d.querySelector('button').addEventListener('click', () => { ES.ttsClips = ES.ttsClips.filter(x => x !== c); ttsList(); applyVo(); ES.clipMixKey = ''; });
    box.appendChild(d); }
}
if(tts){ $('ttsvoice').innerHTML = tts.voices.map(v => `<option value="${v.key}">${v.label}</option>`).join(''); }
else $('ttsbox').hidden = true;
$('ttsadd').addEventListener('click', ttsAdd, SIG);
/* ---- sound effects, made on the phone (no files): whoosh, pop, boom, camera click, riser, ding.
 * Automatic ones follow the edit (a whoosh into a push / swipe / whip / zoom / spin, a boom on a flash into a drop, a
 * click on a photo snap or a freeze, a pop when a text or sticker pops in); the creator adds more at the playhead. ---- */
ES.sfxSeq = 0; ES.sfxList = [];
const SFX_NAMES = { whoosh: 'Whoosh', pop: 'Pop', boom: 'Boom', click: 'Camera click', riser: 'Riser', ding: 'Ding', swish: 'Swish', impact: 'Impact', glitch: 'Glitch', laser: 'Laser', heartbeat: 'Heartbeat', tick: 'Tick', chime: 'Chime', drop: 'Bass drop', rewind: 'Rewind', notify: 'Notification' };
const sfxCache = new Map();
const WHOOSH_TR = ['whip','swipeup','slideleft','slideright','slideup','slidedown','zoom','spin','zoomout','dropin'];
function sfxUI(){ const box = $('sfxlist'); if(!box) return; box.innerHTML = '';
  for(const x of ES.sfxList){ const b = document.createElement('button'); b.type = 'button'; b.className = `${Chip}`; b.textContent = SFX_NAMES[x.kind] + ' · ' + x.at.toFixed(1) + ' s ×'; b.title = 'Remove';
    b.addEventListener('click', () => { ES.sfxList = ES.sfxList.filter(y => y !== x); sfxUI(); ES.clipMixKey = ''; ensureMix(); }); box.appendChild(b); } }
// the Add buttons: one for every sound the studio makes (the list above)
{ const box = $('sfxadd'); if(box){ box.querySelectorAll('[data-sfx]').forEach(b => b.remove()); for(const [k, v] of Object.entries(SFX_NAMES)){ const b = document.createElement('button'); b.type = 'button'; b.className = Button.small; b.dataset.sfx = k; b.textContent = v; box.appendChild(b); } } }
$('sfxadd').addEventListener('click', e => { const b = e.target.closest('[data-sfx]'); if(b) sfxAdd(b.dataset.sfx); }, SIG);
$('sfxon').addEventListener('change', e => { ES.au = { ...ES.au, sfx: e.target.checked }; ES.clipMixKey = ''; ensureMix(); }, SIG);
$('sfxv').addEventListener('input', e => { ES.au = { ...ES.au, sfxv: +e.target.value }; const o = e.target.parentElement.querySelector('output'); if(o) o.textContent = Math.round(ES.au.sfxv*100) + '%'; ES.clipMixKey = ''; }, SIG);
$('sfxv').addEventListener('change', () => ensureMix(), SIG);

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
  if([90,180,270].includes(c.rot)) o.rot = c.rot; for(const k of ['fh','fv','fit','enh']) if(c[k] === true) o[k] = true;
  if(o.fit){ if(c.bg === 'blur' || c.bg === 'color' || CANVAS_PATS.includes(c.bg)) o.bg = c.bg; if(/^#[0-9a-f]{6}$/i.test(c.bgc || '')) o.bgc = c.bgc; n('bd', 0, 1); if(/^#[0-9a-f]{6}$/i.test(c.bdc || '')) o.bdc = c.bdc; }
  n('stab', 0, 1); n('smooth', 0, 1); n('bri', -1, 1); n('con', -1, 1); n('sat', -1, 1); n('warm', -1, 1); n('hi', -1, 1); n('sh', -1, 1); n('hue', -1, 1); n('sharp', 0, 1); n('vig', 0, 1); n('beauty', 0, 1); n('fin', 0, 1.5); n('fout', 0, 1.5);
  // reverse, zoom, the clip's sound, and the mask / green screen / curves / HSL objects (the server checked their fields)
  if(c.rev === true) o.rev = true; n('zoom', 1, 3); n('pitch', -12, 12); for(const k of ['vol','mus']) if(Number.isFinite(Number(c[k])) && c[k] !== undefined) o[k] = Math.min(2, Math.max(0, Number(c[k])));
  for(const k of ['mk','ck','cv','hsl','kx']) if(c[k] && typeof c[k] === 'object') o[k] = JSON.parse(JSON.stringify(c[k]));
  return o; };
// where people speak in each clip (Silero VAD on the phone): only for "Keep voices only" (the one place it is used,
// autoTools). With the clips' sound muted (the default) or all kept, neither the speech model (1.3 MB) is downloaded nor
// every clip's sound decoded (slow and heavy on an iPhone); choosing "Keep voices only" reads it then.
ES.speechBusy = false;

/* =============== STORY -> REEL (on the phone) ===============
 * A written story becomes a narrated Reel: each sentence is spoken by a text-to-speech voice (Piper, on the phone), the
 * narration is the Reel's voiceover (the song, if any, plays quietly under it), each sentence is a scene cut from the
 * creator's clips or photos (a soft zoom or drift on each shot, a dissolve between scenes), and the captions are the
 * story's own words timed to the speech. Nothing is uploaded and nothing is charged. ---- */
ES.story = null;   // { scenes: [{ a, b, text }], dur }
const storySentences = (t) => (t.replace(/\s+/g, ' ').match(/[^.!?।]+[.!?।]*/g) || []).map(s => s.trim()).filter(s => s.length > 1);
// a quiet track the length of the story, for a Reel without a song (the edit needs a sound to follow)
function silentWav(sec){
  const sr = 22050, n = Math.ceil(sec*sr), b = new ArrayBuffer(44 + n*2), v = new DataView(b), s = (o, t) => { for(let i=0;i<t.length;i++) v.setUint8(o + i, t.charCodeAt(i)); };
  s(0, 'RIFF'); v.setUint32(4, 36 + n*2, true); s(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr*2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, n*2, true);
  return new File([b], 'Story.wav', { type: 'audio/wav', lastModified: Date.now() });
}
// the edit of a story: the scenes cover the whole Reel, each in shots of about 3 s, clips taken in turn
function storyEdit(){
  if(!ES.story || !sources.length || !ES.buf || ES.kind === 'talk') return false;
  const D = ES.buf.duration, n = sources.length, list = [], sc = ES.story.scenes;
  sc.forEach((s, j) => { const a = j ? (sc[j-1].b + s.a)/2 : 0, b = j < sc.length - 1 ? (s.b + sc[j+1].a)/2 : D, parts = Math.max(1, Math.round((b - a)/3.2));
    for(let k=0;k<parts;k++) list.push({ start: a + (b - a)*k/parts, end: a + (b - a)*(k + 1)/parts, type: k ? 'cut' : 'hit', fx: 'Story', tr: k ? 'hard' : j ? 'dissolve' : 'fadein',
      efx: (j + k) % 2 ? 'pan-soft' : 'punch-soft', sp: 'normal', src: ES.story.per ? Math.min(n - 1, Math.floor(j / ES.story.per)) : (j + k) % n, in: 0, scaleR: 1, cx: 0.5, cy: 0.45, face: 0, fs: 0 }); });
  if(!restoreEdit(list)) return false;
  ES.edit.forEach((e, i) => { if(!repick(i, false, e.src)) repick(i, false); });
  assignPlayers(); ES.edit.forEach(e => { e.cam = null; e.kf = keyframesFor(e); camAt(e, 0); }); renderEDL(); autoTools();
  $('s3').classList.remove('locked'); $('s3').classList.add('done'); ['play','remix','export','cover'].forEach(id => $(id).disabled = false);
  captureLoop(); ES.editGen++; return true;
}
// the whole story: voice, sound, clips, captions (Story -> Reel drives it and shows the progress)
async function storyRun(text, voice, songFile, clipFiles, onStage, per){
  onStage && onStage('voice', 0);
  const S = await storyVoice(text, voice, (p, stage) => onStage && onStage('voice', p, stage));
  ES.story = { scenes: S.scenes, dur: S.dur, per: per || 0 }; // per: Shubix's pictures in order, each covering that many sentences
  ES.vo = { raw: S.pcm, sr: S.sr, key: 'story' + Date.now().toString(36), clean: null };
  Object.defineProperty(ES.vo, 'pcm', { configurable: true, get(){ return this.raw; } });
  capCache.set('vo|' + ES.vo.key + '|0.00|' + $('caplang').value, { from: 0, words: S.words });
  setKind('music'); onStage && onStage('song', 0);
  if(songFile){ await loadMusic(songFile); setLen(Math.max(5, Math.min(180, Math.ceil(S.dur)))); ES.au = { ...ES.au, mvol: Math.min(ES.au.mvol, 0.6) }; }
  else await loadMusic(silentWav(S.dur));
  onStage && onStage('clips', 0); addVideos(clipFiles); await addQueue;
  if(!ES.edit.length || !ES.story) makeEdit();
  $('caps').checked = true; ES.capsOn = true; $('caprow').hidden = false; await loadCaptions();
  afterVo();
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
  set('mvol', ES.au.mvol, Math.round(ES.au.mvol*100) + '%'); set('mfin', ES.au.mfin, ES.au.mfin.toFixed(1) + ' s'); set('mfout', ES.au.mfout, ES.au.mfout.toFixed(1) + ' s');
  [...$('vfx').children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.f === ES.au.vfx))); $('aitouch').checked = ES.au.ai !== false;
  const ex = $('xclip'); if(ex){ const k = ex.value; ex.innerHTML = '<option value="">Use a clip\'s sound as the song…</option>' + sources.map((s, i) => `<option value="${i}">${s.name.replace(/[<&"]/g, '')}</option>`).join(''); ex.value = k && sources[+k] ? '' : ''; }
}
const auSet = (patch) => { ES.au = { ...ES.au, ...patch, ...(Object.prototype.hasOwnProperty.call(patch, 'mfout') ? { mfoutManual: true } : {}) }; auUI(); applyVo(); if(!ES.playing) redrawFrame(); };
for(const [id, k] of [['mvol','mvol'], ['mfin','mfin'], ['mfout','mfout']]) $(id).addEventListener('input', e => auSet({ [k]: +e.target.value }), SIG);
$('aitouch').addEventListener('change', e => { ES.au = { ...ES.au, ai: e.target.checked }; autoTools(); if(ES.au.ai) speechScan(); applyVo(); ES.clipMixKey = ''; }, SIG);
$('vfx').addEventListener('click', e => { const b = e.target.closest('button'); if(!b) return; if(!ES.vo) notify('Record a voiceover first; the voice changer works on it.'); auSet({ vfx: b.dataset.f }); }, SIG);
$('xclip').addEventListener('focus', auUI, SIG);
$('xclip').addEventListener('change', e => { const v = e.target.value; e.target.value = ''; if(v !== '') extractAudio(+v); }, SIG);
async function recordVoiceover(){
  if(voRec){ voRec.stop(); return; }
  if(!ES.edit.length || ES.kind === 'talk') return;
  const c = getCtx(); await c.resume();
  let stream;
  try{ stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
  catch(err){ voStat('The microphone is not available (' + (err && err.name || err) + '). Allow it for this site and try again.'); return; }
  try{ voWorkletReady ??= c.audioWorklet.addModule(URL.createObjectURL(new Blob([VO_WORKLET], { type: 'text/javascript' }))); await voWorkletReady; }
  catch(err){ voWorkletReady = null; stream.getTracks().forEach(t => t.stop()); voStat('Recording is not supported in this browser.'); return; }
  // record over the song alone (no older voice), softer
  const hadVo = ES.vo; ES.vo = null; applyVo(); const keepNorm = ES.normGain; ES.normGain = keepNorm*0.45;
  const mic = c.createMediaStreamSource(stream), node = new AudioWorkletNode(c, 'vo-rec'), sink = c.createGain(); sink.gain.value = 0;
  mic.connect(node); node.connect(sink); sink.connect(c.destination);
  const blocks = []; node.port.onmessage = e => blocks.push(e.data);
  let done; const finished = new Promise(r => done = r);
  voRec = { stop: () => { if(ES.playing){ ES.pos = curTime(); stopAll(); } done(); } };
  setLabel('vorec', 'Stop recording'); voStat('Recording… speak now (headphones keep the song out of your voice)');
  ES.pos = 0; await startPlayback(0);
  const t0 = startedAt, lat = (c.outputLatency || c.baseLatency || 0) + 0.015;
  node.port.postMessage({ on: true });
  onEnd = () => { onEnd = null; done(); };
  await finished;
  node.port.postMessage({ on: false }); await new Promise(r => setTimeout(r, 120));
  mic.disconnect(); node.disconnect(); sink.disconnect(); stream.getTracks().forEach(t => t.stop());
  ES.normGain = keepNorm; voRec = null; setLabel('vorec', 'Record voiceover');
  const sr = c.sampleRate, L = Math.round(ES.buf.duration*sr), pcm = new Float32Array(L); let got = 0;
  for(const b of blocks){ const at = Math.round((b.t - t0 - lat)*sr); for(let i=0;i<b.d.length;i++){ const k = at + i; if(k >= 0 && k < L){ pcm[k] = b.d[i]; got++; } } }
  if(got < sr*0.5){ ES.vo = hadVo; applyVo(); voStat('Nothing was recorded.'); return; }
  ES.vo = { raw: pcm, sr, key: Date.now().toString(36) }; await cleanVo();
  applyVo(); afterVo();
}
function afterVo(){
  voStat(ES.vo ? 'Voiceover ✓ ' + fmt(ES.vo.pcm.length/ES.vo.sr).replace(/\.\d+$/, '') + ' · the song steps back while you speak' : '');
  $('vodel').hidden = !ES.vo; ES.capAll = null; ES.capWords = null; ES.capLines = null; if(ES.capsOn) loadCaptions(); redraw();
}
$('vorec').addEventListener('click', () => { if(!ES.recording) recordVoiceover(); }, SIG);
$('vodel').addEventListener('click', () => { if(voRec) return; ES.vo = null; applyVo(); afterVo(); }, SIG);

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
ES.TEMPLATES = {};
function tplSet(list){
  ES.TEMPLATES = Object.fromEntries(list.map(t => [t.id, tplOf(t)]));
  const box = $('tpl'); if(!box) return;
  box.replaceChildren(...list.map(t => { const b = document.createElement('button'); b.type = 'button'; b.dataset.t = t.id; b.dataset.kind = t.kind; b.textContent = t.name; b.setAttribute('aria-pressed', String(t.id === ES.tplName)); return b; }));
}
(() => { let c = null; try{ c = JSON.parse(localStorage.getItem(TPL_KEY) || 'null'); }catch(e){} tplSet(liveTemplates(c && Array.isArray(c.templates) ? c.templates : DEFAULT_TEMPLATES)); })();
const tplReady = fetch('/api/templates').then(r => r.ok ? r.json() : null).then(r => {
  if(!r || !Array.isArray(r.templates)) return; tplSet(r.templates);
  try{ localStorage.setItem(TPL_KEY, JSON.stringify({ at: Date.now(), templates: r.templates })); }catch(e){}
}).catch(() => {});
let tplWaiting = null, tplGen = 0, tplNeed = false;
function useTemplate(name){
  const t = ES.TEMPLATES[name]; if(!t || ES.recording) return;
  ES.tplName = name;
  [...$('tpl').children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.t === name)));
  setKind(t.kind);
  if(t.look) press('look', 'l', t.look);
  if(t.style) press('tstyle', 't', t.style);
  if(t.mode) press('mode', 'm', t.mode);
  if(t.kind === 'talk'){ press('tpace', 'p', t.pace); press('tmusic', 'v', String(t.music)); }
  if(t.bg) press('bgmode', 'b', t.bg);
  if(t.hook !== undefined){ ES.hookText = t.hook; $('hook').value = t.hook; }
  if(t.caps && !ES.capsOn && !$('capwrap').hidden){ $('caps').checked = true; ES.capsOn = true; $('caprow').hidden = false; loadCaptions(); }
  const gen0 = ES.editGen, kind0 = ES.kind;
  if(t.kind === 'music' && t.len !== undefined && ES.song) setLen(t.len); else if(t.kind === 'music' && t.len !== undefined){ sec.len = t.len; sec.auto = true; }
  tplWaiting = t; tplGen = gen0; tplNeed = sources.length > 0 && (ES.editGen === gen0 ? (t.len !== undefined && !!ES.song) || kind0 !== ES.kind || ES.kind === 'talk' : false);
  $('tplhelp').textContent = ES.edit.length ? '' : 'Now add ' + (t.kind === 'talk' ? 'your talking clips' : t.photo ? 'a song and your photos' : 'a song and your clips') + ': the template is applied to the edit.';
  tplApplySoon();
  styleForTemplate(name);   // its kind's learned style, unseen (above)
}
// the texts go on once the edit has its final length (after the song part and the clips are in)
function tplApplySoon(){
  clearTimeout(tplApplySoon.h);
  tplApplySoon.h = setTimeout(() => { if(!tplWaiting) return; if(!ES.edit.length || ES.pending || (tplNeed && ES.editGen === tplGen) || (ES.kind === 'talk' && /Finding/.test($('s3st').textContent))){ tplApplySoon(); return; }
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
function setReelTitle(t){
  const v = String(t || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if(!v || v === reelTitle) return false;
  reelTitle = v; const el = $('tbname'); if(el) el.textContent = v; return true;
}
let proj = null, lastSig = '', capKeyNow = ''; ES.restoring = false;
// a new Reel in Create has its own id from the start: it is a draft in My Reels from its first song or clip, kept as it
// changes (the address stays the Create steps' until Generate opens the editor)
const projNewId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
if(location.pathname.startsWith('/create') && location.pathname !== '/create/edit' && !new URLSearchParams(location.search).get('p')) proj = { id: projNewId(), created: Date.now() };
// a saved Reel, opened: its edit is kept as it was saved (no new plan, no rebuild when the clips' check or the beats
// finish) until the creator asks for a change that needs one (Change Reel, a style, the chat, clips, the song or its part)
ES.keepSaved = false;
const fileFp = f => f ? [f.name, f.size, f.lastModified].join('|') : '';
let voF = null; const voFile = () => (voF && voF.name === 'voiceover-' + ES.vo.key + '.f32') ? voF : (voF = new File([ES.vo.raw], 'voiceover-' + ES.vo.key + '.f32', { type: 'application/octet-stream', lastModified: parseInt(ES.vo.key, 36) || 1 }));
function pdb(){ return new Promise((res, rej) => { const r = indexedDB.open(PDB, 2);
  r.onupgradeneeded = () => { const d = r.result; if(!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'id' }); if(!d.objectStoreNames.contains('files')) d.createObjectStore('files');
    if(!d.objectStoreNames.contains('songs')) d.createObjectStore('songs', { keyPath: 'fp' }); };
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
function stateOf(){
  return { kind: ES.kind, song: ES.song && ES.song.file ? { fp: fileFp(ES.song.file), name: ES.song.name } : null, sec: { len: sec.len, auto: sec.auto, start: sec.start },
    clips: sources.map(s => ({ fp: fileFp(s.file), name: s.name })),
    settings: { au: ES.au, tts: ES.ttsClips.map(c => ({ id: c.id, text: c.text, voice: c.voice, at: c.at })), trTo: ES.trTo, trOnly: ES.trOnly, tr: ES.trTo ? [...trCache].filter(([k]) => k.startsWith(ES.trTo + '|')).slice(0, 200) : [], denoise: ES.denoiseOn, mode: ES.mode === 'copy' ? 'auto' : ES.mode, look: ES.look === 'copy' ? 'vivid' : ES.look, aspect: ES.aspect, textStyle: ES.textStyle, hookText: ES.hookText, capsOn: ES.capsOn, caplang: $('caplang').value, talkPace, talkMusic, bgMode, bgColor, marks: ES.userMarks.slice(0, 200), sfx: ES.sfxList.map(x => ({ at: x.at, kind: x.kind })), capColor: ES.ACCENT, seed: ES.seed, bg: bgFile ? fileFp(bgFile) : '', seq: ES.seqOn, title: reelTitle, chat: ES.chatMsgs.slice(-20), reelId: ES.reelId, aiOk: !!ES.reelId && aiReel === ES.reelId, chatUsed },
    overlays: ES.overlays.map(o => { const c = { ...o }; delete c.box; return c; }),
    lmedia: ES.lmedia.map(M => ({ fp: fileFp(M.file), name: M.name })), layers: lyOf(),
    edit: editOf(),
    kfs: ES.kind === 'talk' && ES.edit.some(e => e.uk && e.uk.length) ? ES.edit.map(e => e.uk && e.uk.length ? e.uk : null) : undefined,
    caps: ES.capAll && capKeyNow ? { key: capKeyNow, all: ES.capAll } : null, vo: ES.vo ? { key: ES.vo.key, sr: ES.vo.sr, fp: fileFp(voFile()) } : null };
}
function thumbOf(){ if(!ES.edit.length) return ''; const c = document.createElement('canvas'), H = 240, W = Math.round(H*out.width/out.height); c.width = W; c.height = H; c.getContext('2d').drawImage(out, 0, 0, W, H); try{ return c.toDataURL('image/jpeg', 0.7); }catch(e){ return ''; } }
let saving = false;
async function saveProject(st, sig){
  if(saving) return; saving = true;
  try{
    life({ saving: 1 });   // the stage stays what the studio is doing (a save every few seconds would hide it)
    if(!proj){ proj = { id: projNewId(), created: Date.now() }; try{ navigator.storage && navigator.storage.persist && navigator.storage.persist(); }catch(e){} }
    if(ES.song && ES.song.file) await putFile(ES.song.file);
    for(const s of sources) if(s.file) await putFile(s.file);
    if(bgFile) await putFile(bgFile);
    for(const M of ES.lmedia) await putFile(M.file);
    if(ES.vo) await putFile(voFile());
    if(!reelTitle){ reelTitle = await nextUntitled(); st = { ...st, settings: { ...st.settings, title: reelTitle } }; sig = JSON.stringify(st); }
    const name = reelTitle;
    await idb('meta', 'readwrite', s => s.put({ id: proj.id, created: proj.created, updated: Date.now(), name, kind: ES.kind, dur: ES.buf ? ES.buf.duration : 0, shots: ES.edit.length, thumb: thumbOf(), state: st }));
    life({ saving: 0, proj: proj.id });
    // a made Reel has its own address (/editor?p=…): a reload, a shared link or Back to it opens this Reel, not a new one
    // (only once the editor is open: still in the Create steps the address stays /create/music?step=…; flow.ts sets it on Generate)
    if(!IN_APP && ES.edit.length && root.classList.contains('made') && !root.classList.contains('fopen') && new URLSearchParams(location.search).get('p') !== proj.id) history.replaceState(history.state, '', '/editor?p=' + proj.id);
    // still in the Create steps: a reload of this tab offers this Reel back (resumeOffer)
    if(location.pathname.startsWith('/create')){ try{ sessionStorage.setItem('brs-resume:' + location.pathname, proj.id); }catch(e){} }
    lastSig = sig; $('psaved').textContent = 'Saved on this phone ✓ ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }catch(err){ console.warn('project not saved:', err); $('psaved').textContent = 'Not saved'; notify('Could not save this Reel on your phone. It may be low on space.', 'err'); }
  finally{ saving = false; if(ES.lifeNote.saving) life({ saving: 0 }); }
}
async function saveNow(){
  while(saving) await new Promise(resolve => setTimeout(resolve, 40));
  const st = stateOf(), sig = JSON.stringify(st);
  if(sig !== lastSig) await saveProject(st, sig);
  while(saving) await new Promise(resolve => setTimeout(resolve, 40));
  return proj ? proj.id : '';
}
setInterval(() => {
  if(ES.restoring || ES.recording || ES.exporting || ES.pending || (!ES.song && !sources.length) || typeof indexedDB === 'undefined') return;
  // an iPhone: copying big clip files into the phone's storage is not done while the preview plays (memory)
  if(IOS && (ES.playing || ES.starting)) return;
  const st = stateOf(), sig = JSON.stringify(st); if(sig !== lastSig) saveProject(st, sig);
}, 3000);
// leaving or reloading while Shubix is still working, or before the last change is kept: the browser asks first
window.addEventListener('beforeunload', e => {
  if(ES.pending || ES.exporting || ES.recording){ e.preventDefault(); e.returnValue = ''; return; }
  if((ES.song || sources.length) && !ES.restoring){ try{ const sig = JSON.stringify(stateOf()); if(sig !== lastSig){ e.preventDefault(); e.returnValue = ''; } }catch(err){} }
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
  ES.restoring = true; root.classList.add('opening'); const say = t => { $('psaved').textContent = t; $('openstep').textContent = t.replace(/…$/, ''); };
  let expectedClips = 0;
  try{
    const p = await idb('meta', 'readonly', s => s.get(id)); if(!p){ say('That Reel is no longer on this phone.'); return; }
    const st = p.state; expectedClips = (st.clips || []).length; const getF = async (fp, name) => { const b = fp ? await idb('files', 'readonly', s => s.get('f:' + fp)) : null; return b ? new File([b], name || b.name || 'file', { type: b.type, lastModified: +fp.split('|').pop() || Date.now() }) : null; };
    say('Opening "' + p.name + '"…'); proj = { id: p.id, created: p.created };
    reelTitle = (st.settings && st.settings.title) || p.name || '';
    const S = st.settings || {};
    ES.keepSaved = st.kind !== 'talk' && !!(st.edit && st.edit.length);   // no plan / rebuild while it opens: its own edit comes back
    talkKfs = st.kind === 'talk' && st.kfs ? st.kfs : null;
    if(st.kind === 'talk') setKind('talk');
    press('aspect', 'a', S.aspect); press('look', 'l', S.look); press('tstyle', 't', S.textStyle); if(S.mode && S.mode !== 'auto') press('mode', 'm', S.mode);
    press('tpace', 'p', S.talkPace); press('tmusic', 'v', String(S.talkMusic));
    if(S.au) ES.au = { ...AU0, ...S.au }; auUI();
    if(S.tts && S.tts.length){ ES.ttsClips = S.tts.map(c => ({ ...c })); ttsSeq = ES.ttsClips.reduce((q, c) => Math.max(q, c.id), 0); ttsList(); }
    ES.hookText = S.hookText || ''; $('hook').value = ES.hookText; ES.seed = S.seed || 1; chatRestore(S.chat); if(typeof S.reelId === 'string' && S.reelId){ ES.reelId = S.reelId; if(S.aiOk) aiReel = ES.reelId; chatUsed = Number(S.chatUsed) || 0; } if(S.denoise === false){ ES.denoiseOn = false; $('dn1').checked = false; $('dn2').checked = false; }
    if(S.caplang !== undefined) $('caplang').value = S.caplang;
    if(S.trTo){ for(const [k, v] of S.tr || []) trCache.set(k, v); ES.trTo = S.trTo; ES.trOnly = !!S.trOnly; $('captr').value = ES.trTo; $('tronly').checked = ES.trOnly; $('trwrap').hidden = false; }
    if(st.caps && st.caps.key) capCache.set(st.caps.key, st.caps.all);
    if(st.vo && st.vo.fp){ const vf = await getF(st.vo.fp, 'voiceover-' + st.vo.key + '.f32'); if(vf){ ES.vo = { raw: new Float32Array(await vf.arrayBuffer()), sr: st.vo.sr, key: st.vo.key }; await cleanVo(); } }
    if(S.bg){ const bf = await getF(S.bg, 'background'); if(bf){ bgFile = bf; const im = new Image(); im.onload = () => { bgImg = im; redrawFrame(); }; im.src = URL.createObjectURL(bf); } }
    if(S.capColor) ES.ACCENT = S.capColor;
    if(S.seq) setSeq(true, false);
    if(Array.isArray(S.marks)) ES.userMarks = S.marks.filter(Number.isFinite);
    if(Array.isArray(S.sfx)){ ES.sfxList = S.sfx.filter(x => SFX_NAMES[x.kind] && Number.isFinite(x.at)).map(x => ({ ...x, id: ++ES.sfxSeq })); sfxUI(); }
    bgColor = S.bgColor || bgColor; if(S.bgMode && S.bgMode !== 'none') press('bgmode', 'b', S.bgMode);
    ES.overlays = (st.overlays || []).map(o => ({ ...o })); ES.ovSeq = ES.overlays.reduce((q, o) => Math.max(q, o.id || 0), 0); renderOvList();
    if(st.sec){ sec.len = st.sec.len; sec.auto = st.sec.auto; sec.start = st.sec.start;
      [...$('slen').children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.l === (!sec.len ? '0' : [15,30,60].includes(sec.len) ? String(sec.len) : 'c'))));
      if(sec.len && ![15,30,60].includes(sec.len)){ $('slenc').value = sec.len; $('slencw').hidden = false; } $('sauto').hidden = !sec.len; $('lenhint').hidden = !sec.len; $('mwave').classList.toggle('drag', !!sec.len); }
    const clips = []; for(const c of st.clips || []){ const f = await getF(c.fp, c.name); if(f) clips.push(f); }
    const sf = st.song ? await getF(st.song.fp, st.song.name) : null;
    if(sf){ let cs = null; try{ cs = await idb('songs', 'readonly', s => s.get(st.song.fp)); }catch(e){} await loadMusic(sf, cs && cs.r ? { r: cs.r, aiDone: cs.aiDone } : null); }
    if(clips.length){ addVideos(clips, true); await addQueue; }
    if(st.kind !== 'talk' && st.edit && st.edit.length && clips.length === (st.clips || []).length && restoreEdit(st.edit)){ ES.keepSaved = true;
      // the editor opens on it, as after making a Reel (the step, Play / Change Reel / Export)
      $('s3').classList.remove('locked'); $('s3').classList.add('done'); $('s3st').textContent = ES.edit.length + ' shots · ' + fmt(ES.buf ? ES.buf.duration : 0);
      ['play','remix','export','cover'].forEach(id => $(id).disabled = false); }
    else if(ES.keepSaved){ ES.keepSaved = false; if(ES.buf && sources.length) makeEdit(); }   // the saved edit does not fit (a clip is missing): a new one
    if(st.layers && st.layers.length){ const ms = []; for(const c of st.lmedia || []){ const f = await getF(c.fp, c.name); try{ ms.push(f ? await addLayerMedia(f) : null); }catch(e){ ms.push(null); } }
      ES.lmedia = ms.filter(Boolean); const idx = ms.map((m, i) => m ? ms.slice(0, i).filter(Boolean).length : -1);
      ES.layers = st.layers.filter(L => idx[L.m] >= 0).map(L => ({ ...L, m: idx[L.m] })); ES.lySeq = ES.layers.reduce((q, L) => Math.max(q, L.id), 0); lyUI(); }
    if(S.capsOn && !ES.capsOn){ $('caps').checked = true; ES.capsOn = true; $('caprow').hidden = false; loadCaptions(); }
    if(ES.vo) afterVo();
    redrawFrame();
    const missing = (st.clips || []).length - clips.length + (st.song && !sf ? 1 : 0);
    const unreadable = (st.clips || []).length - sources.length;
    say(missing ? missing + ' file(s) of this Reel are no longer on this phone' : unreadable ? unreadable + ' clip(s) could not be read on this device' : 'Opened "' + p.name + '" · saved on this phone');
  }catch(err){ console.warn('project not opened:', err); say('This Reel could not be opened.'); notify('This Reel could not be opened.', 'err'); }
  finally{ lastSig = JSON.stringify(stateOf()); ES.restoring = false; root.classList.remove('opening');
    // nothing to show (gone, or its files are not on this phone): say so, not a blank page
    if(!ES.edit.length && !sources.length && expectedClips){ root.classList.add('openfail'); $('openh').textContent = 'This Reel could not be opened'; }
    // a Reel left in the Create steps (a song, no clips yet): not an empty editor, but its steps again, where it was left
    else if(!ES.edit.length && !sources.length && proj && /^\/(editor|create\/edit)$/.test(location.pathname)){
      const slug = { talk: 'talking', photo: 'photo', copy: 'copy' }[ES.kind] || 'music';
      location.replace('/create/' + slug + '?p=' + encodeURIComponent(proj.id) + '&step=' + (ES.song ? 'clips' : 'choose'));
    } }
}
{ const q = new URLSearchParams(location.search).get('p'); if(q && typeof indexedDB !== 'undefined') openProject(q); else { keptSweep(); resumeOffer(); } }

/* ---- My music: the songs used lately, on this phone, picked again in one tap ----
 * Each song is kept once (with the saved Reels' files) together with its finished analysis (beats, drops, AI check), so
 * picking it again is instant. Up to 12; the oldest go (their file too, unless a saved Reel uses it). */
const RECENT_MAX = 12;
async function rememberSong(file, r, aiDone){
  if(typeof indexedDB === 'undefined' || !file) return;
  try{ await putFile(file); const fp = fileFp(file);
    await idb('songs', 'readwrite', s => s.put({ fp, name: file.name, type: file.type, dur: ES.song ? ES.song.buf.duration : 0, usedAt: Date.now(), r, aiDone: !!aiDone }));
    const all = (await idb('songs', 'readonly', s => s.getAll()) || []).sort((a, b) => b.usedAt - a.usedAt);
    for(const old of all.slice(RECENT_MAX)) await forgetSong(old.fp, true);
    listRecent();
  }catch(e){ console.info('recent song not kept:', e && e.message); }
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
    const d = document.createElement('div'); d.className = 'rsong' + (ES.song && ES.song.file && fileFp(ES.song.file) === sg.fp ? ' cur' : '');
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
  if(ES.recording) return;
  const sg = await idb('songs', 'readonly', s => s.get(fp)), b = sg && await idb('files', 'readonly', s => s.get('f:' + fp));
  if(!sg || !b){ await forgetSong(fp); return; }
  const f = new File([b], sg.name, { type: sg.type || b.type, lastModified: +fp.split('|').pop() || Date.now() });
  loadMusic(f, sg.r ? { r: sg.r, aiDone: sg.aiDone } : null);
}
listRecent();

root.__studio = { get layerMedia(){ return ES.lmedia; }, get aiPlan(){ return ES.director && ES.director.slots && !ES.director.interim ? { story: ES.director.story || '', lines: ES.plan.map((p, i) => planLine(p, i, ES.director.slots)) } : null; }, get songR(){ return ES.song && ES.song.r; }, get now(){ return ES.playing ? Math.max(0, curTime()) : (ES.pos || 0); }, get playing(){ return ES.playing; }, get dur(){ return ES.buf ? ES.buf.duration : 0; }, get songName(){ return ES.song && ES.song.name ? ES.song.name.replace(/\.[^.]+$/, '') : ''; }, get title(){ return reelTitle; }, get hook(){ return ES.hookText; }, get capsOn(){ return ES.capsOn; }, segAt, drawTimeline, state: () => stateOf(), get pos(){ return ES.pos; }, get playing(){ return ES.playing; }, kfSet, kfTarget: () => kfTarget(), kfSeek, uAt, emph: emphAt, get capLines(){ return ES.capLines; }, get editGen(){ return ES.editGen; }, get vo(){ return ES.vo; }, get base(){ return { buf: ES.baseBuf, norm: ES.baseNorm }; }, get overlays(){ return ES.overlays; }, setOverlays: setOverlaysFromNative, get bg(){ return { mode: bgMode, mask: !!ES.bgMask, err: ES.bgErr }; }, get faceHow(){ return sources.map(s => s.faceHow); }, seek: t => { ES.pos = t; const i = segAt(t); return prepare(i, t).then(()=>drawFrame(t)); }, get talk(){ return ES.talk; }, get audio(){ return ES.buf; }, get kind(){ return ES.kind; }, get section(){ return { start: ES.secStart, len: ES.buf ? ES.buf.duration : 0, auto: sec.auto, whole: ES.song ? ES.song.buf.duration : 0, words: ES.capWords }; }, get wakeLockHeld(){ return !!wakeLock; }, loseGL: () => GL && GL.gl.getExtension('WEBGL_lose_context'), renderedLook, get capLines(){ return ES.capLines; }, faceYOnScreen, get edit(){ return ES.edit; }, setEdit: list => restoreEdit(list), get plan(){ return ES.plan; }, sources, gl: !!GL, get beats(){ return ES.beats; }, get parts(){ return ES.songPartsRel; }, get mode(){ return ES.mode; }, get recipe(){ return recipeNow().name; }, planNow: () => adaptPlan().map(x => +x.start.toFixed(2)), get beatInfo(){ return ES.beatInfo; }, get ref(){ return ES.refProfile; }, fingerprint: () => ES.refProfile ? fingerprintOf(ES.refProfile) : null, copyMatch, get grade(){ return GRADES[ES.look]; },
  snap: histSnap, unsnap: snapRestore, upsell, projId: () => proj ? proj.id : '', saveNow, shotOp, shotMove: shotReorder, shotRoll, ovSelect: i => { ES.ovSel = ES.overlays[i] ? i : -1; renderOvList(); redraw(); }, ovRefresh: () => { renderOvList(); redraw(); }, get ovSel(){ return ES.ovSel; }, shotCs, shotSet, shotSlip, shotTrim, shotRipple, shotReverse, addMark, clearMarks, setTlZoom, sfxAdd, sfxEvents, ensureMix, setLook: k => { const b = $('look').querySelector('[data-l="' + k + '"]'); if(b) b.click(); return ES.look; }, get marks(){ return ES.userMarks; }, autoExport, extractAudio, autoSound, storyRun, setPart: t => { remakeOk(); sec.start = Math.max(0, +t || 0); sec.auto = false; return useSection(); }, saveLast: () => ES.lastVideo && saveFile(ES.lastVideo, lastName || 'reel.mp4'),
  get work(){ return { song: !!ES.song || ES.kind === 'talk', songReady: ES.kind === 'talk' || !!(ES.song && ES.buf && ES.song.r), beats: ES.beatsBusy, pending: ES.pending, clips: sources.length, shots: ES.edit.length, ai: aiBusy, dir: ES.dirBusy, pace: ES.paceBusy,
    // Shubix AI is on for this Reel and its plan has not come yet (nor failed): the Reel is not final (the phone app waits)
    aiWait: !!(ES.aiOn && aiReelOk() && aiGaveUp !== reelIdNow() && ES.edit.length && !(ES.director && ES.director.key === dirKey() && !ES.director.interim) && ES.dirFailedKey !== dirKey()), speech: ES.speechBusy, exporting: ES.exportBusy, exportP: ES.exportP }; }, shotExtract: () => ES.edit.length && extractAudio(ES.edit[segAt(ES.pos)].src), get au(){ return ES.au; }, setAudioMix: async patch => { auSet(patch); ES.clipMixKey = ''; await ensureMix(); return ES.au; }, remix: remixNow, ensureMix, get canUndo(){ return hist.u.length > 0; }, get layers(){ return ES.layers; }, get lmedia(){ return ES.lmedia; }, layerAdd, layerSelect: lySelect, layerSet: lySet, layerDelete: lyDelete, get ttsVoices(){ return tts ? tts.voices : []; }, addTts: addTtsAtPlayhead, clearTts, setCaptions, setCaptionStyle, get canRedo(){ return hist.r.length > 0; },
  frameAt: async t => { const i = segAt(t); await prepare(i, t); drawFrame(t); return i; }, camAt,
  // the phone app (bridge.ts): the account known after the start, Ask Shubix, the clips' smooth copies
  account, chatApp, get aiOn(){ return ES.aiOn; },
  // the export's plan check (what the plan does not include, as the website's Export button asks) and the post's caption
  exportLocked: () => lockedUsed().map(x => ({ name: x.name, need: PLAN_NAME[x.need] })),
  exportFix: () => { lockedUsed().forEach(x => x.fix()); renderEDL(true); renderOvList(); sheetPaint(); }, caption: () => captionOf(),
  copies: () => sources.map((s, i) => ({ i, name: s.name, blob: s.edFile || null, path: s.edPath || '', w: s.edW || 0, h: s.edH || 0 })) };   // read by tests

  return () => {
    try{ stopAll(); }catch(err){}
    ac.abort(); tasks.dispose();
    sources.forEach(s=>{ (s.els||[]).forEach(v=>{ v.pause(); v.removeAttribute('src'); v.load(); }); URL.revokeObjectURL(s.url); });
    try{ ctx && ctx.close(); }catch(err){}
  };
}
