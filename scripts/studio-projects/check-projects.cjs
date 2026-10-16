/* eslint-disable @typescript-eslint/no-require-imports */
// Saved Reels: made, left, opened again from "Your Reels" exactly as it was (edit, texts, part of the song, look,
// captions without a new transcription, the same picture), then deleted with its files.
//   BASE=http://localhost:3000 SONG=song.mp3 CLIPS=a.webm,b.webm node check-projects.cjs
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:3000', CLIPS = (process.env.CLIPS || '').split(',').filter(Boolean);
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ viewport: { width: 1300, height: 1000 } });
  let posts = 0;
  await ctx.route('**/api/studio/transcribe**', async route => { const r = route.request();
    if (r.method() === 'GET') return route.fulfill({ json: { available: true, credits: 0, languages: ['hi', 'mr', 'en'] } });
    posts++; return route.fulfill({ json: { words: [{ text: 'hello', start: 0.4, end: 0.9 }, { text: 'world', start: 1.0, end: 1.5 }], duration: 20, language: 'auto', charged: 0 } }); });
  const p = await ctx.newPage(); p.on('pageerror', e => console.log('ERR', e.message));
  const ready = async () => { await p.waitForFunction(() => document.querySelector('.brs') && document.querySelector('.brs').__studio, null, { timeout: 60000 }); };
  await p.goto(BASE + '/studio'); await ready();
  await p.setInputFiles('#mfile', process.env.SONG); await p.waitForFunction(() => /confirmed|double-checked|^Ready$/.test(document.getElementById('s1st').textContent), null, { timeout: 300000 });
  await p.setInputFiles('#vfile', CLIPS); await p.waitForFunction(() => !document.getElementById('play').disabled && document.getElementById('qinfo').textContent === '', null, { timeout: 300000 });
  // a 15 s part picked by hand, the cinematic look, a text, a transition changed by hand, captions
  await p.click('#slen button[data-l="15"]'); await p.waitForFunction(() => Math.abs(document.querySelector('.brs').__studio.section.len - 15) < 0.6, null, { timeout: 60000 });
  await p.evaluate(() => { const s = document.querySelector('.brs').__studio; });
  await p.click('#look button[data-l="cine"]');
  await p.click('#ovtext'); await p.fill('.ov:last-child .ovt', 'Saved text ✓'); await p.selectOption('.ov:last-child .ovs', 'box');
  await p.selectOption('#edl tr:nth-child(3) td:nth-child(4) select', 'flash');
  await p.check('#caps'); await p.waitForFunction(() => /words/.test(document.getElementById('capstat').textContent) && !/Listening/.test(document.getElementById('capstat').textContent), null, { timeout: 60000 });
  await p.waitForFunction(() => /Saved on this phone/.test(document.getElementById('psaved').textContent), null, { timeout: 30000 }); await p.waitForTimeout(3500);
  const snap = () => p.evaluate(async () => { const s = document.querySelector('.brs').__studio, o = document.getElementById('out');
    await s.seek(3.3); await new Promise(r => setTimeout(r, 400)); await s.seek(3.3);
    const d = o.getContext('2d').getImageData(0, 0, o.width, o.height).data; let h = 0; for (let i = 0; i < d.length; i += 97) h = (h * 31 + (d[i] >> 3)) >>> 0;
    return { edit: s.edit.map(e => [e.src, +e.in.toFixed(3), +e.start.toFixed(3), +e.end.toFixed(3), e.tr, e.efx]).map(x => x.join(':')).join(' '), shots: s.edit.length,
      tr3: s.edit[2] && s.edit[2].tr, overlays: s.overlays.map(o => o.text + '/' + o.style).join(','), section: [+s.section.start.toFixed(3), +s.section.len.toFixed(3), s.section.auto].join(' '),
      look: document.querySelector('#look [aria-pressed="true"]').dataset.l, caps: (s.section.words || []).length, pic: h }; });
  const A = await snap();
  console.log('made:   ', A.shots, 'shots | shot 3 transition', A.tr3, '| texts', A.overlays, '| part', A.section, '| look', A.look, '| caption words', A.caps, '| transcriptions', posts);
  // leave, come back to a new page, open it from the list
  await p.goto(BASE + '/studio'); await ready(); await p.waitForSelector('#plist .proj', { timeout: 30000 });
  console.log('list:   ', await p.$$eval('#plist .proj', ds => ds.map(d => d.querySelector('.pname').textContent + ' (' + d.querySelector('.pmeta').textContent + ')' + (d.querySelector('img') ? ' + thumbnail' : '')).join(', ')));
  await p.click('#plist .proj .popen'); await p.waitForURL(/\?p=/); await ready();
  await p.waitForFunction(() => /Opened|no longer|Could not/.test(document.getElementById('psaved').textContent), null, { timeout: 600000 }); await p.waitForTimeout(1500);
  console.log('status: ', await p.textContent('#psaved'));
  const B = await snap();
  console.log('opened: ', B.shots, 'shots | shot 3 transition', B.tr3, '| texts', B.overlays, '| part', B.section, '| look', B.look, '| caption words', B.caps, '| transcriptions', posts);
  console.log('same edit:', A.edit === B.edit, '| same picture at 3.3 s:', A.pic === B.pic, '| same texts:', A.overlays === B.overlays, '| same part:', A.section === B.section);
  // delete it: the list is empty and its files are gone
  const files = () => p.evaluate(() => new Promise(r => { const q = indexedDB.open('brs-projects'); q.onsuccess = () => { const d = q.result, t = d.transaction('files'), c = t.objectStore('files').count(); c.onsuccess = () => { d.close(); r(c.result); }; }; }));
  console.log('files stored:', await files());
  p.on('dialog', d => d.accept()); await p.goto(BASE + '/studio'); await ready(); await p.waitForSelector('#plist .proj');
  await p.click('#plist .proj .pdel'); await p.waitForTimeout(1500);
  console.log('after delete: Reels', await p.$$eval('#plist .proj', x => x.length), '| files stored', await files(), '| list shown', !(await p.$eval('#projects', e => e.hidden)));
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
