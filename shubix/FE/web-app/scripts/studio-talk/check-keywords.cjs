/* eslint-disable @typescript-eslint/no-require-imports */
// Captions for talking: one key word per line (never a small word), drawn in the accent colour with its emoji, the zoom
// punch on it; off with the switch.   BASE=http://localhost:3000 node check-keywords.cjs
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:3000', OUT = __dirname + '/out/';
const TEXT = 'here are three simple tips for better reels tip number one always start with a hook tip two keep it short and save money tip three add captions to every video'.split(' ');
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1300, height: 1000 } });
  await ctx.route('**/api/studio/transcribe**', async route => { const r = route.request();
    if (r.method() === 'GET') return route.fulfill({ json: { available: true, credits: 0, languages: ['en'] } });
    const secs = (r.postDataBuffer().length - 44) / 2 / 16000, step = (secs - 1) / TEXT.length;
    return route.fulfill({ json: { words: TEXT.map((w, i) => ({ text: w, start: 0.4 + i * step, end: 0.4 + i * step + step * 0.8 })), duration: secs, language: 'en', charged: 0 } }); });
  const p = await ctx.newPage(); p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto(BASE + '/studio?view=all'); await p.waitForFunction(() => document.querySelector('.brs') && document.querySelector('.brs').__studio, null, { timeout: 60000 });
  await p.click('#kind button[data-k="talk"]');
  await p.setInputFiles('#vfile', [OUT + 'talk_0.webm']); await p.waitForFunction(() => /of talk/.test(document.getElementById('s3st').textContent), null, { timeout: 300000 });
  await p.evaluate(() => { const s = document.getElementById('safe'); if (s.checked) s.click(); });
  await p.check('#caps'); await p.waitForFunction(() => /words found/.test(document.getElementById('capstat').textContent), null, { timeout: 60000 }); await p.waitForTimeout(500);
  const lines = await p.evaluate(() => document.querySelector('.brs').__studio.capLines.map(l => l.words.map(w => w.key ? '[' + w.text + (w.emoji ? ' ' + w.emoji : '') + ']' : w.text).join(' ')));
  console.log('lines (key word in brackets):\n  ' + lines.join('\n  '));
  console.log('one key word per line:', lines.every(l => (l.match(/\[/g) || []).length === 1));
  // a key word: accent colour in the caption band and the zoom, just after it starts; a moment with no key word: neither
  const probe = await p.evaluate(async () => { const s = document.querySelector('.brs').__studio, o = document.getElementById('out'), g = o.getContext('2d');
    const kw = s.capLines.flatMap(l => l.words).filter(w => w.key), plain = s.capLines.flatMap(l => l.words).filter(w => !w.key);
    const acc = async t => { await s.seek(t); const d = g.getImageData(0, Math.round(o.height * 0.6), o.width, Math.round(o.height * 0.2)).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 230 && d[i + 1] > 190 && d[i + 2] < 120) n++; return n; };
    const k = kw[2], q = plain.find(w => !kw.some(x => Math.abs(x.start - w.start) < 0.9) && s.capLines.some(l => l.a <= w.start && l.b > w.start && !l.words.some(x => x.key && x.start <= w.start)));
    return { key: k.text, zoomAtKey: +s.emph(k.start + 0.1).toFixed(3), zoomLater: +s.emph(k.start + 0.9).toFixed(3), accentAtKey: await acc(k.start + 0.15),
      plain: q && q.text, zoomAtPlain: q ? +s.emph(q.start + 0.1).toFixed(3) : null, accentBeforeKey: q ? await acc(q.start + 0.05) : null }; });
  console.log('probe:', JSON.stringify(probe));
  await p.uncheck('#kwon'); await p.waitForTimeout(300);
  console.log('switched off:', JSON.stringify(await p.evaluate(() => { const s = document.querySelector('.brs').__studio; return { keys: s.capLines.flatMap(l => l.words).filter(w => w.key).length, zoom: Math.max(...s.capLines.flatMap(l => l.words).map(w => s.emph(w.start + 0.1))) }; })));
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
