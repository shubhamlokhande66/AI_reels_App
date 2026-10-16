/* eslint-disable @typescript-eslint/no-require-imports */
// Style library on the phone (the server answers stood in): a reference Reel read and saved as a fingerprint (what is
// sent), a learned style used (the edit follows it), a transition changed by hand (sent as a correction).
//   BASE=http://localhost:3000 SONG=song.mp3 CLIPS=a.webm REF=out/whip_zoom.webm node check-library.cjs
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:3000';
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1300, height: 1000 } });
  const sent = { save: null, edits: [] };
  const LEARNED = { category: 'dance', n: 14, corrections: 3, accuracy: { n: 14, learned: 0.91, baseline: 0.42 },
    fp: { dur: 15, bpm: 128, medianBeats: 1, medianSec: 0.47, hookBeats: 2, hookSec: 0.94, onBeat: 0.92, energy: 'rising', zoomShare: 0.55, trans: { flash: 0.45, whip: 0.35, hard: 0.2 },
      look: { mean: 0.42, std: 0.26, sat: 0.55, warm: 0 }, shotBeats: [2, 1, 1, 1, 2, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1], shotSec: [] } };
  await ctx.route('**/api/studio/styles**', async route => { const r = route.request(), u = new URL(r.url());
    if (u.pathname.endsWith('/learned')) return route.fulfill({ json: LEARNED });
    if (u.pathname.endsWith('/edits')) { sent.edits.push(JSON.parse(r.postData())); return route.fulfill({ json: { ok: true } }); }
    if (r.method() === 'POST') { sent.save = JSON.parse(r.postData()); return route.fulfill({ json: { id: 'x1', name: sent.save.name, category: sent.save.category, shared: sent.save.shared, pace: '', trans: '' } }); }
    return route.fulfill({ json: { mine: [], categories: { wedding: { mine: 3, shared: 10 }, dance: { mine: 2, shared: 12 } } } }); });
  const p = await ctx.newPage(); p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto(BASE + '/studio'); await p.waitForFunction(() => document.querySelector('.brs') && document.querySelector('.brs').__studio, null, { timeout: 60000 });
  await p.setInputFiles('#mfile', process.env.SONG); await p.waitForFunction(() => /^Ready/.test(document.getElementById('s1st').textContent), null, { timeout: 300000 });
  await p.setInputFiles('#vfile', process.env.CLIPS.split(',')); await p.waitForFunction(() => !document.getElementById('play').disabled && document.getElementById('qinfo').textContent === '', null, { timeout: 300000 });
  console.log('learned-style row shown:', await p.isVisible('#learnrow'), '| kinds:', await p.$$eval('#lcat option:not([disabled])', o => o.map(x => x.textContent).join(', ')));
  // 1. read a reference Reel, save it
  await p.setInputFiles('#reffile', process.env.REF); await p.waitForFunction(() => /cuts in/.test(document.getElementById('refinfo').textContent), null, { timeout: 600000 });
  await p.selectOption('#stcat', 'dance'); await p.check('#stshare'); await p.click('#stsave'); await p.waitForFunction(() => /Saved/.test(document.getElementById('ststat').textContent), null, { timeout: 30000 });
  const s = sent.save; console.log('saved:', JSON.stringify({ name: s.name, category: s.category, shared: s.shared, keys: Object.keys(s.fp).sort().join(','), pace: s.fp.medianBeats, trans: s.fp.trans, zoomShare: +s.fp.zoomShare.toFixed(2), bytes: JSON.stringify(s).length }));
  // 2. use the learned dance style
  await p.selectOption('#lcat', 'dance'); await p.click('#luse'); await p.waitForFunction(() => /Learned from/.test(document.getElementById('linfo').textContent), null, { timeout: 30000 }); await p.waitForTimeout(1500);
  const ed = await p.evaluate(() => { const s = document.querySelector('.brs').__studio, e = s.edit, tr = {}; e.slice(1).forEach(x => { tr[x.tr] = (tr[x.tr] || 0) + 1; });
    const lens = e.map(x => x.end - x.start).sort((a, b) => a - b); return { mode: document.querySelector('#mode [aria-pressed="true"]').dataset.m, look: document.querySelector('#look [aria-pressed="true"]').dataset.l, shots: e.length, medianShot: +lens[lens.length >> 1].toFixed(2), beat: +(60 / Number(document.getElementById('mbpm').textContent)).toFixed(2), transitions: tr }; });
  console.log('info:', await p.textContent('#linfo')); console.log('edit with the learned style:', JSON.stringify(ed));
  // 3. a correction
  await p.selectOption('#edl tr:nth-child(4) td:nth-child(4) select', 'dissolve'); await p.waitForTimeout(3800);
  console.log('corrections sent:', JSON.stringify(sent.edits));
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
