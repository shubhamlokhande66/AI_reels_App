// Ask Shubix: what the person says, asked and charged, planned and applied. The page and the phone's own engine share it; what is drawn is theirs.
// @ts-nocheck
export function createChatBrain(ES, EH){
async function chatApp(text){
  const before = ES.chatMsgs.length;
  await chatSend(text);
  const t0 = Date.now(), wait = ms => new Promise(r => setTimeout(r, ms));
  while((ES.chatWaiting || ES.aiBusy || ES.dirBusy || ES.paceBusy) && Date.now() - t0 < 240000) await wait(300);
  let applied = false;
  if(ES.chatPending && ES.chatPending.key === EH.dirKey()){
    const pd = ES.chatPending; ES.chatPending = null; ES.chatReported = pd.key;
    ES.director = { key: pd.key, slots: pd.slots, story: pd.story }; ES.dirCache.set(pd.key, ES.director);
    EH.makeEdit(); await EH.aiApply(pd); try{ EH.applyChatVisualIntent(pd.intent, pd.slots); }catch(e){}
    applied = !!ES.edit.length; if(applied){ ES.chatMsgs.push({ who: 'ai', text: 'Done ✓' }); EH.saveNow(); }
  }
  const said = ES.chatMsgs.slice(before).filter(m => m.who === 'ai').map(m => m.text).filter(t => t !== 'Done ✓').pop() || '';
  return { applied, answer: applied ? 'Done ✓ Your Reel is edited the way you asked' + (ES.director && ES.director.story ? ': ' + ES.director.story : '.') : said || (ES.chatWaiting ? 'Shubix is still working on it. Ask again in a moment.' : 'OK') };
}
async function chatPatch(text, n, id){
  ES.chatWaiting = true; ES.chatPending = null; EH.chatUiBusy(true); EH.chatSay('ai', 'Changing just that part', true);
  const tm = EH.timeoutSignal(45000);
  try{
    const cands = EH.directorCandidates(); ES.dirCands = cands;
    const { req } = EH.dirRequest(cands), key = EH.dirKey(), len = i => ES.edit[i].end - ES.edit[i].start;
    req.patch = { ask: text, current: ES.edit.map((e, i) => ({ i, clip: 'c' + (e.src + 1), at: +e.in.toFixed(2), transition: e.tr || 'hard', effect: e.efx || 'none', speed: EH.speedKey(e.sp) })) };
    req.chat = { n, id, text };
    const r = await EH.apiFetch('/api/studio/direct', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req), signal: tm.signal });
    const res = await r.json().catch(() => ({}));
    if(!r.ok) throw new Error((res.error && res.error.message) || ('Shubix could not change it (' + r.status + ').'));
    EH.chatSync(res); if(typeof res.balance === 'number' && ES.aiInfo){ ES.aiInfo.balance = res.balance; EH.creditsChanged(); }
    const base = ES.director && ES.director.key === key ? ES.director.slots.slice() : ES.edit.map((e, i) => ({ cand: { src: e.src, in: e.in }, tr: e.tr, fx: e.efx, sp: EH.speedKey(e.sp),
      keys: (e.acc || []).map(q => ({ at: q.at, do: q.do })), move: (e.ak || []).map(q => ({ at: q.t / Math.max(0.05, len(i)), s: q.s, x: q.x, y: q.y, r: q.r, ez: q.ez })), cs: e.cs || null, why: '' }));
    const got = EH.toSlots(res.slots, cands), changed = new Set();
    got.forEach((x, i) => { if(x && base[i] !== undefined){ base[i] = { ...x, cand: x.cand || base[i].cand }; changed.add(i); } });
    const intent = EH.parseDirectorVisualIntent(text);
    if(intent.transitionAll || intent.effectsAll) ES.edit.forEach((_, i) => changed.add(i));
    if(!changed.size && !intent.openingText && !intent.squareFrameAll && !intent.transitionAll && !intent.effectsAll){ chatAnswer('I could not tell which shot to change. Name it, e.g. "shot 3: slow-mo" or "the first clip: the dance".'); return; }
    ES.chatPending = { key, slots: base, story: res.story || '', texts: res.texts, actions: res.actions, changed, cost: ES.chatCost, intent };
    EH.chatProposal(ES.chatPending);
  }catch(e){ EH.chatFail(tm.timedOut() ? 'Shubix took too long this time. Try again in a moment.' : String(e && e.message || 'Shubix could not change it right now.')); }
  finally{ tm.done(); }
}
async function chatSend(text){
  EH.remakeOk();
  text = String(text || '').trim().slice(0, 300); if(!text || ES.chatWaiting) return;
  if(EH.aiHeldBack()){ EH.chatSay('me', text); ES.chatMsgs.push({ who: 'me', text }); chatAnswer('Your song or clips changed. Go on with Next to make a new Reel first.'); return; }
  EH.chatSay('me', text); ES.chatMsgs.push({ who: 'me', text });
  EH.chatInputClear();
  const ready = ES.buf && ES.sources.length && ES.edit.length && !ES.recording;
  // Explicit, deterministic visual edits are applied locally on every plan. They do not need
  // a model round-trip, a credit check or a server upload; verify the full scope before replying.
  const localVisualIntent = EH.parseDirectorVisualIntent(text);
  const hasLocalVisualIntent = !!(localVisualIntent.openingText || localVisualIntent.squareFrameAll
    || localVisualIntent.transitionAll || localVisualIntent.effectsAll);
  if(ready && hasLocalVisualIntent){
    try{
      const before = EH.histSnap();
      const localSlots = ES.edit.map(shot => ({ tr: shot.tr || 'hard', fx: shot.efx || 'none', effect: shot.efx || 'none' }));
      if(ES.playing) EH.stopAll();
      const applied = EH.applyChatVisualIntent(localVisualIntent, localSlots);
      if(!applied) throw new Error('No supported visual change was detected.');
      EH.hist.u.push(before); if(EH.hist.u.length > EH.HIST_MAX) EH.hist.u.shift();
      EH.hist.r = []; EH.hist.cur = EH.histSnap(); EH.hist.cand = ''; EH.histUI();
      EH.saveNow();
      chatAnswer('Done ✓ Applied ' + applied + ' to the current Reel on this device. No Shubix AI credits used.');
    }catch(error){
      chatAnswer('I could not verify that every requested change was applied. ' + String(error && error.message || error));
    }
    return;
  }
  // no Shubix AI in this plan (Free): the phone's own changes, and the way to get the AI
  if(!ES.aiOn){
    const did = EH.chatLocal(text);
    if(ready && did.length) EH.makeEdit();
    chatAnswer((did.length ? 'Done ✓ I used ' + did.join(' and ') + ' (on your phone). ' : '') + (EH.aiLocked() && EH.IN_APP ? 'Changing the Reel from your words is Shubix AI, which is not on your plan.' : EH.aiLocked() ? 'Changing the Reel from your words is Shubix AI: it is in the Editor and Pro plans.' : 'Shubix AI is off for this Reel, so I can only switch the style (say "faster" or "calmer") or make a new version.'));
    if(EH.aiLocked() && !EH.IN_APP) EH.chatLink('See Editor & Pro');
    return;
  }
  if(!ready){ ES.wish = ES.chatMsgs.filter(m => m.who === 'me').map(m => m.text).join(' · ').slice(-800); chatAnswer('Got it! I\'ll edit your Reel this way as soon as it is made.'); return; }
  if(!EH.aiReelOk() && !(await EH.aiGate(EH.aiNeedOn()))){ chatAnswer('This Reel is edited on your phone, so I can only switch its style (say "faster" or "calmer").'); return; }
  // what this change costs, asked first: a few named shots or the whole Reel
  const size = EH.chatSize(text), freeN = EH.aiFreeChats(), free = bal0 => bal0 !== null && ES.chatUsed < freeN, bal = EH.aiBal();
  const cost = free(bal) ? 0 : EH.aiCostOf(size === 'small' ? 'small' : 'big');
  if(free(bal)){
    const left = freeN - ES.chatUsed - 1;
    const ok = await EH.askCredits({ title: size === 'small' ? 'A small change · free' : 'Change the whole Reel · free', text: (size === 'small' ? 'Shubix changes only the shots you named; the rest stays as it is. ' : 'Shubix plans the whole Reel again with what you asked. ') + 'Your plan has ' + freeN + ' free changes per Reel: this one is free, ' + (left ? left + ' more free after it.' : 'after it each change uses credits.'), bal, ok: 'Make the change', no: 'Cancel' });
    if(!ok){ chatAnswer('OK, nothing changed.'); return; }
  } else if(!cost || bal === null){
    const ok = await EH.askCredits({ title: size === 'small' ? 'A small change' : 'Change the whole Reel', text: (size === 'small' ? 'Shubix changes only the shots you named; the rest stays as it is. ' : 'Shubix plans the whole Reel again with what you asked. ') + (cost ? 'It uses ' + EH.creditWord(cost) + '.' : 'Included in your plan.'), bal, ok: 'Make the change', no: 'Cancel' });
    if(!ok){ chatAnswer('OK, nothing changed.'); return; }
  } else if(cost && bal !== null){
    if(bal < cost){ chatAnswer('This change needs ' + EH.creditWord(cost) + ' and you have ' + EH.creditWord(bal) + '.'); if(!EH.IN_APP) EH.chatLink('Top up'); return; }
    const ok = await EH.askCredits({ title: size === 'small' ? 'A small change' : 'Change the whole Reel', text: (size === 'small' ? 'Shubix changes only the shots you named; the rest stays as it is. ' : 'Shubix plans the whole Reel again with what you asked. ') + (freeN ? 'The ' + freeN + ' free changes for this Reel are used, so this' : 'It') + ' uses ' + EH.creditWord(cost) + '.', bal, after: bal - cost, ok: 'Use ' + EH.creditWord(cost), no: 'Cancel' });
    if(!ok){ chatAnswer('OK, nothing changed and no credits used.'); return; }
  }
  ES.chatCost = cost; const n = ++ES.chatN, id = EH.newId();
  if(size === 'small') return chatPatch(text, n, id);
  EH.chatLocal(text);
  ES.wish = ES.chatMsgs.filter(m => m.who === 'me').map(m => m.text).join(' · ').slice(-800);
  ES.chatAsk = { n, id, text };
  ES.chatWaiting = true; ES.chatPending = null; EH.chatUiBusy(true); EH.chatSay('ai', 'Planning your Reel: checking every clip', true);
  ES.dirFailedKey = ''; ES.paceFailedKey = '';
  const asked = ES.chatMsgs.length;
  EH.makeEdit();
  // the plan comes after the AI has looked at the clips: if it has not yet (it was only agreed to just now), it looks now
  if(ES.sources.some(s => !s.ai && !s.aiFailed && !s.removed)) EH.aiRun();
  // an answer that never comes: not a spinner for ever. While the clips are still being looked at, nothing else can start: wait for them
  const noAnswer = () => { if(!ES.chatWaiting || ES.chatMsgs.length !== asked) return; if(ES.aiBusy) return void setTimeout(noAnswer, 15000);
    EH.chatFail(ES.dirBusy || ES.paceBusy ? 'Still working on it… it is taking longer than usual. I\'ll keep going; you can ask again in a moment.' : ES.director && ES.director.key === EH.dirKey() ? 'Your Reel is updated.' : 'Shubix could not change the Reel right now. Try again in a moment.'); };
  setTimeout(noAnswer, 120000);
}
function chatAnswer(text){ EH.chatClearWait(); EH.chatSay('ai', text); ES.chatMsgs.push({ who: 'ai', text }); ES.chatWaiting = false; EH.chatUiBusy(false); }
  return { chatApp, chatPatch, chatSend, chatAnswer };
}
