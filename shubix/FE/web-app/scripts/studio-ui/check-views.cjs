/* eslint-disable @typescript-eslint/no-require-imports */
// The studio's one editor on a computer: every tool in the rail, each opening its own panel, the shot chips changing the
// edit itself, the tracks moving the playhead, and the Pro tools on a free plan (a PRO tag; a tap opens /pricing).
//   BASE=http://localhost:3100 SONG=song.mp3 CLIPS=a.mp4,b.mp4 [STATE=signed-in.json] [CHROME=chrome.exe] node check-views.cjs
// (STATE: a Playwright storage state of a signed-in session, when sign-in is on)
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:3000';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME, args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 1366, height: 900 }, storageState: process.env.STATE })).newPage(); p.on('pageerror', e => console.log('ERR', e.message));
  // a free plan: the Pro tools are locked
  await p.route('**/api/credits', r => r.fulfill({ json: { enabled: true, balance: 10, monthly: 10, extra: 0, plan: 'free', planName: 'Free' } }));
  await p.goto(BASE + '/create/music'); await p.waitForFunction(() => document.querySelector('.brs') && document.querySelector('.brs').__studio, null, { timeout: 60000 });
  await p.setInputFiles('#mfile', process.env.SONG); await p.waitForFunction(() => /^Ready/.test(document.getElementById('s1st').textContent), null, { timeout: 300000 });
  await p.setInputFiles('#vfile', process.env.CLIPS.split(','));
  await p.waitForFunction(() => !document.getElementById('fgen').disabled, null, { timeout: 300000 });
  await p.click('#fgen'); await p.waitForTimeout(1500);
  const vis = sel => p.evaluate(sel => [...document.querySelectorAll(sel)].filter(e => e.offsetParent !== null).map(e => e.dataset.panel || e.dataset.tool || e.id), sel);
  const S = () => p.evaluate(() => { const s = document.querySelector('.brs').__studio, i = s.segAt(s.now); return { i, tr: s.edit[i].tr }; });
  console.log('Editor:', await p.evaluate(() => document.querySelector('.brs').className.match(/v-\w+/)[0]), '| tools', JSON.stringify(await vis('.tool')), '| tracks', await p.isVisible('#lanes'), '| Export', await p.isVisible('#topexport'));
  console.log('  breadcrumb:', (await p.textContent('#fcrumbs')).replace(/\s+/g, ' '));
  console.log('  PRO tags:', JSON.stringify(await vis('.tool[data-locked="true"]')));
  for (const t of ['music', 'text', 'captions', 'look', 'style', 'shots']) { await p.click(`.tool[data-tool="${t}"]`); console.log('  tool', t, '→ panels', JSON.stringify(await vis('.panel.on'))); }
  const before = await S();
  const chip = await p.evaluate(tr => { const c = [...document.querySelectorAll('#shotcard .chip')].find(x => x.dataset.v !== tr && x.dataset.v !== 'hard'); return c && c.dataset.v; }, before.tr);
  await p.click(`#shotcard .chip[data-v="${chip}"]`); await p.waitForTimeout(600);
  console.log('  shot chip "' + chip + '": shot', before.i + 1, 'transition', before.tr, '→', (await S()).tr, '| chip lit:', await p.getAttribute(`#shotcard .chip[data-v="${chip}"]`, 'aria-pressed'));
  const box = await p.locator('#lanes').boundingBox();
  await p.mouse.click(box.x + 64 + (box.width - 64) * 0.75, box.y + 30); await p.waitForTimeout(800);
  console.log('  tap the tracks at 75%: playhead', (await p.evaluate(() => { const s = document.querySelector('.brs').__studio; return s.now / s.dur; })).toFixed(2));
  await p.click('.tool[data-tool="motion"]'); await p.waitForURL('**/pricing**', { timeout: 10000 });
  console.log('  Motion on a free plan opens', new URL(p.url()).pathname + new URL(p.url()).search);
  await p.goBack(); await p.waitForTimeout(1500);
  console.log('  Back from pricing:', new URL(p.url()).pathname);
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
