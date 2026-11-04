// Making a Reel: the shots from the song, the clips and the AI's plan (makeEditNow). Moved from
// components/studio/engine.ts: its state is the object ES, and what must stay in the page (drawing, the page's boxes) comes through EH.
// The golden test (scripts/engine-golden.mjs) says it still makes the same Reel.
// @ts-nocheck
import { endWell, TAIL, crossesScene, suitFx, rampSpeed, keyframesFor } from './pure';
import { repace } from '../components/studio/soundmap';
import { inferAutonomousMood, createAutonomousReelPlan, validateAutonomousReelPlan, createDirectorPlan, evaluateKeyframes } from '@mobile/video-engine';
import { TR_DUR } from '@mobile/core/lib/shaders';

export function createReelBrain(ES, EH){
function makeEditNow(){
  if(ES.refReading) return;   // the Reel to copy is being read: its copy is made right after (no ordinary Reel meanwhile)
  EH.life({ stage: 'making the Reel', clips: EH.sources.length });
  if(ES.exportBusy){ ES.remakeAfterExport = true; return; }   // a late AI answer: the video being made keeps its edit
  if(ES.keepSaved) return;   // an opened Reel: as it was saved
  if(ES.kind === 'talk'){ if(EH.sources.length) EH.buildTalk(); return; }
  if(ES.story && EH.storyEdit()) return;
  if(!ES.buf || !EH.sources.length) return;
  const keptUk = EH.ukKeep();
  EH.stopAll(); ES.plan = EH.adaptPlan(); { const pc = EH.paceNow(); if(pc) ES.plan = EH.beatEdit(endWell(EH.noFlashCuts(EH.withPartCuts(repace(ES.basePlan, pc.secs.map(x => ({ ...x, every: x.every === 'hits' ? 1 : x.every === 'flicker' ? 8 : x.every })), ES.beats, ES.buf.duration, ES.mode)))), pc.secs); } EH.styleEdit(); const dirInfo = EH.applyDirectorStyle(); if(!dirInfo) EH.finishTransitions(); EH.tastePlan();
  const gmax = Math.max(1e-6, ...EH.sources.flatMap(s=>s.samples.map(x=>x.m)));
  const used = EH.sources.map(()=>[]);
  // the opening shot picks first (the first 2 seconds decide if people keep watching), then drops, hits, breaks, the rest
  // "In my order": each shot has its clip and its part of that clip (seqSlots), so the clips play one after another
  const seq = ES.seqOn && EH.sources.length > 1 ? EH.seqSlots(ES.plan.length) : null;
  const order = ES.plan.map((s,i)=>i).sort((a,b)=>{ const pr={drop:0,hit:1,break:2,cut:3}; return (a===0?-1:pr[ES.plan[a].type]) - (b===0?-1:pr[ES.plan[b].type]) || a-b; });
  const res = new Array(ES.plan.length); ES.dupCount = 0;
  // Shared Director pass: rank the source clips once, then use its explainable quality ranking
  // as a gentle prior in the existing per-shot visual scorer. The music edit still owns timing;
  // the existing AI's explicit shot choices remain authoritative.
  const directorShots = EH.sources.map((src, sourceIndex) => {
    const samples = src.samples || [];
    const avg = (key, fallback = 0) => samples.length ? samples.reduce((n, x) => n + (Number(x[key]) || 0), 0) / samples.length : fallback;
    const sharp = avg('sh') / Math.max(1e-6, src.shMed || 1);
    const faceScore = Math.max(0, Math.min(1, (src.faces || []).filter(x => x.n).length / Math.max(1, (src.faces || []).length)));
    const quality = Math.max(0, Math.min(1, 0.55 + (sharp - 1) * 0.18 + (avg('b') - 0.45) * 0.2 - EH.clipFlaw(src) * 0.08));
    const aiSummary = EH.aiAt(src, 0, src.dur);
    const motion = Math.max(0, Math.min(1, avg('m')));
    const roles = aiSummary ? aiSummary.roles : {}, tags = EH.aiTags(src);
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
  const directorMusic = { duration: ES.buf.duration, beats: ES.beats, downbeats: ES.beats.filter((_, i) => i % 2 === 0),
    drops: ES.plan.filter(x => x.type === 'drop').map(x => x.start),
    quietRanges: ES.plan.filter(x => x.type === 'break').map(x => [x.start, x.end] as [number, number]) };
  const inferredMood = ES.mode === 'fast' ? 'energetic' : ES.mode === 'smooth' ? 'minimal' : inferAutonomousMood(directorShots, directorMusic).mood;
  const autonomousDirector = createAutonomousReelPlan({
    shots: directorShots, music: directorMusic,
    targetDuration: Math.min(180, ES.buf.duration), aspect: ES.aspect,
    mood: inferredMood,
    platform: EH.ON_PHONE ? 'android' : 'web',
    intensity: ES.mode === 'fast' ? 'bold' : ES.mode === 'smooth' ? 'subtle' : 'balanced',
  });
  const autonomousErrors = validateAutonomousReelPlan(autonomousDirector);
  // Keep the established scorer as a safety fallback until the autonomous plan passes validation.
  const sharedDirector = autonomousErrors.length ? createDirectorPlan({
    shots: directorShots, beats: ES.beats, drops: ES.plan.filter(x => x.type === 'drop').map(x => x.start),
    targetDuration: Math.min(180, ES.buf.duration), aspect: ES.aspect,
    mood: ES.mode === 'fast' ? 'energetic' : ES.mode === 'smooth' ? 'minimal' : 'cinematic',
    mobile: EH.ON_PHONE,
    intensity: ES.mode === 'fast' ? 'bold' : ES.mode === 'smooth' ? 'subtle' : 'balanced',
  }) : autonomousDirector;
  const sharedRank = new Map(sharedDirector.shots.map((shot, rank) => [shot.sourceIndex, rank]));
  const sharedRankMax = Math.max(1, sharedDirector.shots.length - 1);
  // the director's chosen moments are held for their own cuts
  const held = ES.plan.map((s,i)=>{ const d = EH.dirShot(i); return d ? {i, si:d.src, a:d.in, b:d.in + s.sp.pos(s.end-s.start)} : null; }).filter(Boolean);
  const pick = (i, allowNeighbour, allowOverlap, anyScene) => {
    const s = ES.plan[i], len = s.end - s.start, dir = EH.dirShot(i);
    let best=null, bs=-Infinity;
    EH.sources.forEach((src,si)=>{
      let need = s.sp.pos(len), scaleR = 1;
      if(need > src.dur-TAIL){ scaleR = Math.max(0.05, (src.dur-TAIL)/need*0.98); need *= scaleR; }
      if(!allowNeighbour && EH.sources.length>1 && [res[i-1],res[i+1]].some(x=>x && x.src===si)) return;
      const stepT = Math.max(0.1, Math.min(0.5, src.dur/120));
      const tryAt = (a) => {
        let ov = 0; used[si].forEach(([u0,u1])=>{ ov += Math.max(0, Math.min(u1,a+need)-Math.max(u0,a)); });
        if(!allowOverlap && ov > 0.001) return;          // a moment of footage is used only once
        if(!allowOverlap && held.some(h=>h.i!==i && h.si===si && !res[h.i] && Math.min(h.b,a+need)-Math.max(h.a,a) > 0.001)) return;
        if(!anyScene && crossesScene(src, a, a+need)) return;   // a shot never runs across a cut inside the clip
        const w = EH.scoreWindow(i, src, a, need, gmax);
        let sc = w.sc - 5*ov/need + EH.rng()*0.15;
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
  if(seq) EH.seqPick(seq, res, gmax);
  else order.forEach(i=>{
    const len = ES.plan[i].end - ES.plan[i].start;
    let best = pick(i,false,false) || pick(i,true,false) || pick(i,true,true) || pick(i,true,true,true) || {src:0,in:0,scaleR:1,cx:0.5,cy:0.5,face:0,ov:0};
    if(best.ov > 0.001) ES.dupCount++;
    used[best.src].push([best.in, best.in + ES.plan[i].sp.pos(len)*best.scaleR]);
    res[i] = best;
  });
  const useCount = EH.sources.map(()=>0);   // (players re-assigned by assignPlayers on manual edits)
  ES.edit = ES.plan.map((s,i)=>({...s, ...res[i], el: EH.sources[res[i].src].els[(useCount[res[i].src]++)%3]}));
  EH.flickBuild();   // a copied flicker montage: its stills (once per set of clips)
  const taste = { n: ES.edit.length, moves: 0, prevZoom: false, lastZoom: -99, shape: false, drops: ES.edit.filter(x => x.type === 'drop').map(x => x.start) };
  ES.edit.forEach((e,i)=>{
    const d = EH.dirSlotOf(i), shared = sharedDirector.shots.find(x => x.sourceIndex === e.src);
    e.dirWhy = d ? d.why : '';
    e.cx = 0.5 + (e.cx-0.5)*(e.face>0.3 ? 1 : 0.8);
    if(ES.mode!=='smooth' && !e.fxByDir) suitFx(e);
    EH.tasteFx(e, i, taste);
    // When the optional cloud AI director is unavailable, apply the shared on-device director's
    // renderable treatment as a conservative fallback. Never overwrite an explicit AI choice.
    if(!dirInfo && shared){
      if(!e.fxByDir && e.efx === 'none'){
        const fx = shared.effects.find(id => !!EH.FX_NAME[id]);
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
    e.beatsIn = ES.beats.filter(b=>b>e.start+0.12 && b<e.end-0.05).map(b=>b-e.start);
  });
  EH.ukRestore(keptUk);
  EH.setCanvas(); ES.edit.forEach(e=>EH.camAt(e, 0)); EH.renderEDL();
  EH.autoTools(); EH.speechScan();
  EH.editShown(ES.dupCount);
  if(dirInfo && !ES.director.interim){ const shots = ES.edit.filter((e,i)=>EH.dirShot(i)).length, kept = ES.edit.filter(e=>e.byDir).length;
    const keys = ES.edit.reduce((n,e)=>n+((e.acc&&e.acc.length)||0), 0);
    // what the AI really decided: the cuts it answered; the rest are the phone's (said, never hidden)
    const answered = ES.plan.filter((_, i) => { const d = ES.director.slots[i]; return d && !d.auto; }).length;
    if(!answered) EH.aiStat('Shubix could not plan this Reel. Your Reel uses the phone\'s own smart edit.');
    else EH.aiStat('Shubix planned your Reel' + (ES.director.story ? ': ' + ES.director.story : '') + (answered < ES.plan.length ? ' (' + answered + ' of ' + ES.plan.length + ' shots; the rest from your phone\'s edit)' : '') + (keys ? ' · ' + keys + ' keyframe' + (keys>1?'s':'') + ' on the hits' : '') + (answered < ES.plan.length || ES.director.story ? '' : '.')); }
  // made while the person was in another app (the clips read, the AI's plan arrived): they are told
  EH.tellReadyIfAway();
  EH.captureLoop(); ES.editGen++;
  EH.paceMaybe(); EH.directorMaybe();
  EH.chatReportAuto();
  EH.copyLookSoon();
}
  return { makeEditNow };
}
