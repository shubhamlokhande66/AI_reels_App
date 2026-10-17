/* eslint-disable @typescript-eslint/no-require-imports */
// Reel length: the part of the song for 15 s / 30 s / 1 min / custom, picked automatically ("Best part") or by dragging on
// the waveform, checked on a song with a known structure (make_song.py: the drop at 24 s), with captions taken from one
// transcription of the whole song and an export as long as the part.
//   BASE=http://localhost:3000 CLIPS=a.webm,b.webm node check-length.cjs
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:3000';
const SONG = process.env.SONG || __dirname + '/out/structured_120.wav';
const CLIPS = (process.env.CLIPS || '').split(',').filter(Boolean);
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ viewport: { width: 1300, height: 1000 } });
  let posts = 0;
  const WORDS = []; for (let t = 1; t < 70; t += 2) WORDS.push({ text: 'w' + t, start: t, end: t + 0.6 });   // a word every 2 s, named by its time
  await ctx.route('**/api/studio/transcribe**', async route => { const r = route.request();
    if (r.method() === 'GET') return route.fulfill({ json: { available: true, credits: 0, languages: ['hi', 'mr', 'en'] } });
    posts++; const body = r.postDataBuffer(); const secs = (body.length - 44) / 2 / 16000;
    return route.fulfill({ json: { words: WORDS.filter(w => w.start < secs), duration: secs, language: 'auto', charged: 0 } }); });
  const p = await ctx.newPage(); p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto(BASE + '/studio?view=all'); await p.waitForFunction(() => document.querySelector('.brs') && document.querySelector('.brs').__studio, null, { timeout: 60000 });
  await p.setInputFiles('#mfile', SONG);
  await p.waitForFunction(() => /confirmed|double-checked|^Ready$/.test(document.getElementById('s1st').textContent), null, { timeout: 300000 });
  const S = () => p.evaluate(() => { const s = document.querySelector('.brs').__studio, x = s.section; return { start: +x.start.toFixed(3), len: +x.len.toFixed(3), whole: +x.whole.toFixed(2), auto: x.auto, beats: s.beats.slice(0, 4).map(v => +v.toFixed(3)), nb: s.beats.length, info: document.getElementById('sinfo').textContent, dur: document.getElementById('mdur').textContent }; });
  const waitLen = (L) => p.waitForFunction((L) => { const x = document.querySelector('.brs').__studio.section; return Math.abs(x.len - Math.min(L, x.whole)) < 0.6; }, L, { timeout: 60000 });
  console.log('whole song:', JSON.stringify(await S()));
  await p.check('#caps'); await p.waitForFunction(() => /words/.test(document.getElementById('capstat').textContent), null, { timeout: 60000 });
  for (const L of [15, 30, 60]) {
    await p.click(`#slen button[data-l="${L}"]`); await waitLen(L); await p.waitForTimeout(600);
    const x = await S(), w = await p.evaluate(() => document.querySelector('.brs').__studio.section.words.map(v => v.text + '@' + v.start.toFixed(1)));
    console.log(`${L} s →`, JSON.stringify(x), '| words', w.length, w.slice(0, 3).join(' '));
  }
  // custom 20 s
  await p.click('#slen button[data-l="c"]'); await p.fill('#slenc', '20'); await p.dispatchEvent('#slenc', 'change'); await waitLen(20);
  console.log('custom 20 s →', JSON.stringify(await S()));
  // by hand: drag the part so it starts near 50 s
  await p.click('#slen button[data-l="15"]'); await waitLen(15); await p.waitForTimeout(300);
  const box = await p.locator('#mwave').boundingBox(), x0 = await S();
  const xAt = t => box.x + t / x0.whole * box.width, TGT = Math.round(x0.whole*0.62*2)/2 + 0.2;   // somewhere else in the song
  await p.mouse.move(xAt(x0.start + 7), box.y + box.height / 2); await p.mouse.down();
  await p.mouse.move(xAt(30), box.y + 40, { steps: 6 }); await p.mouse.move(xAt(TGT + 7), box.y + 40, { steps: 6 }); await p.mouse.up();
  await p.waitForFunction((TGT) => !document.querySelector('.brs').__studio.section.auto && Math.abs(document.querySelector(".brs").__studio.section.start - TGT) < 1.5, TGT, { timeout: 30000 });
  await p.waitForTimeout(500);
  const xm = await S(), wm = await p.evaluate(() => document.querySelector('.brs').__studio.section.words.map(v => v.text + '@' + v.start.toFixed(1)));
  console.log('dragged to ~' + TGT + ' s →', JSON.stringify(xm), '| words', wm.slice(0, 3).join(' '));
  await p.click('#sauto'); await p.waitForFunction(() => /best part/.test(document.getElementById('sinfo').textContent), null, { timeout: 30000 }); await p.waitForTimeout(300);
  console.log('Best part again →', JSON.stringify(await S()));
  console.log('transcriptions sent to the server:', posts);
  if (CLIPS.length) {
    await p.setInputFiles('#vfile', CLIPS);
    await p.waitForFunction(() => !document.getElementById('play').disabled && document.getElementById('qinfo').textContent === '', null, { timeout: 300000 });
    const ed = await p.evaluate(() => { const e = document.querySelector('.brs').__studio.edit; return { shots: e.length, end: +e[e.length - 1].end.toFixed(3) }; });
    console.log('edit:', JSON.stringify(ed));
    await p.evaluate(() => { window.__dl = null; const ck = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__dl = this.href; return; } return ck.call(this); }; });
    await p.click('#export'); await p.click('#xgo');
    await p.waitForFunction(() => /saved|ready:/i.test(document.getElementById('xmsg').textContent), null, { timeout: 900000 });
    const v = await p.evaluate(async () => { const v = document.createElement('video'); v.src = window.__dl; await new Promise(r => { v.onloadedmetadata = r; setTimeout(r, 10000); });
      if (v.duration === Infinity) { v.currentTime = 1e9; await new Promise(r => { v.ontimeupdate = r; setTimeout(r, 5000); }); } return v.duration; });
    console.log('exported video length:', v.toFixed(2), 's (part', (await S()).len, 's)');
  }
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
