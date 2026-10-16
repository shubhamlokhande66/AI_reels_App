/* eslint-disable @typescript-eslint/no-require-imports */
// Translated captions: one request, the translation drawn under each line (or alone), nothing asked again for lines
// already translated (a shorter part of the song).   BASE=http://localhost:3000 SONG=song.mp3 CLIPS=a.webm node check-translate.cjs
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:3000';
const WORDS = 'we light up the night together tonight feel the beat in your heart dance with me now'.split(' ');
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1300, height: 1000 } });
  let tr = 0, asked = [];
  await ctx.route('**/api/studio/transcribe**', async route => { const r = route.request();
    if (r.method() === 'GET') return route.fulfill({ json: { available: true, credits: 0 } });
    return route.fulfill({ json: { words: WORDS.map((w, i) => ({ text: w, start: 1 + i * 1.6, end: 1 + i * 1.6 + 0.5 })), duration: 40, charged: 0 } }); });
  await ctx.route('**/api/studio/translate', async route => { const d = JSON.parse(route.request().postData()); tr++; asked.push(d.lines.length);
    return route.fulfill({ json: { to: d.to, lines: d.lines.map(l => ({ i: l.i, text: 'मराठी ओळ ' + (l.i + 1) })) } }); });
  const p = await ctx.newPage(); p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto(BASE + '/studio'); await p.waitForFunction(() => document.querySelector('.brs') && document.querySelector('.brs').__studio, null, { timeout: 60000 });
  await p.setInputFiles('#mfile', process.env.SONG); await p.waitForFunction(() => /^Ready/.test(document.getElementById('s1st').textContent), null, { timeout: 300000 });
  await p.setInputFiles('#vfile', process.env.CLIPS.split(',')); await p.waitForFunction(() => !document.getElementById('play').disabled && document.getElementById('qinfo').textContent === '', null, { timeout: 300000 });
  await p.evaluate(() => { const s = document.getElementById('safe'); if (s.checked) s.click(); });
  await p.check('#caps'); await p.waitForFunction(() => /words found/.test(document.getElementById('capstat').textContent), null, { timeout: 60000 });
  const band = (t) => p.evaluate(async (t) => { const s = document.querySelector('.brs').__studio, o = document.getElementById('out'), g = o.getContext('2d'); await s.seek(t);
    const row = (y0, y1) => { const d = g.getImageData(0, Math.round(y0 * o.height), o.width, Math.round((y1 - y0) * o.height)).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235) n++; return n; };
    return { line: row(0.66, 0.735), under: row(0.735, 0.8) }; }, t);
  const t = await p.evaluate(() => { const l = document.querySelector('.brs').__studio.capLines[1]; return l.words[l.words.length - 1].end + 0.1; });
  const before = await band(t);
  await p.selectOption('#captr', 'mr'); await p.waitForFunction(() => /translated/.test(document.getElementById('capstat').textContent), null, { timeout: 30000 }); await p.waitForTimeout(300);
  const both = await band(t); await p.check('#tronly'); await p.waitForTimeout(200); const only = await band(t);
  console.log('caption band at', t.toFixed(2), 's (white pixels): no translation', JSON.stringify(before), '| with Marathi under it', JSON.stringify(both), '| only the translation', JSON.stringify(only));
  console.log('requests', tr, '(lines asked', asked.join(',') + ')');
  await p.uncheck('#tronly'); await p.click('#slen button[data-l="15"]'); await p.waitForFunction(() => Math.abs(document.querySelector('.brs').__studio.section.len - 15) < 0.6, null, { timeout: 60000 }); await p.waitForTimeout(1500);
  console.log('after choosing a 15 s part: requests', tr, '| lines in the part', await p.evaluate(() => document.querySelector('.brs').__studio.capLines.length));
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
