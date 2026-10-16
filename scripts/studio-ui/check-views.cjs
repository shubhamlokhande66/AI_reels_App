/* eslint-disable @typescript-eslint/no-require-imports */
// The studio's three views on a phone: what each shows, the Simple cards' panels, the Editor's shot chips and the Pro
// inspector changing the edit itself, the Pro timeline moving the playhead, the menu's view and theme.
//   BASE=http://localhost:3100 SONG=song.mp3 CLIPS=a.webm,b.webm node check-views.cjs
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:3000';
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage(); p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto(BASE + '/studio?view=simple'); await p.waitForFunction(() => document.querySelector('.brs') && document.querySelector('.brs').__studio, null, { timeout: 60000 });
  await p.setInputFiles('#mfile', process.env.SONG); await p.waitForFunction(() => /^Ready/.test(document.getElementById('s1st').textContent), null, { timeout: 300000 });
  await p.setInputFiles('#vfile', process.env.CLIPS.split(','));
  await p.waitForFunction(() => document.querySelector('.brs').classList.contains('made') && !document.getElementById('export').disabled, null, { timeout: 300000 });
  await p.waitForTimeout(1500);
  const vis = sel => p.evaluate(sel => [...document.querySelectorAll(sel)].filter(e => e.offsetParent !== null || getComputedStyle(e).position === 'fixed').map(e => e.dataset.panel || e.dataset.tool || e.id), sel);
  const S = () => p.evaluate(() => { const s = document.querySelector('.brs').__studio, i = s.segAt(s.now); return { i, tr: s.edit[i].tr, efx: s.edit[i].efx }; });
  console.log('Simple: cards', JSON.stringify(await vis('.card')), '| steps shown', JSON.stringify(await vis('.step')), '| save bar', await p.isVisible('#export'), '| summary:', await p.textContent('#suminfo'));
  for (const c of ['style', 'text', 'look', 'music']) { await p.click(`.card[data-tool="${c}"]`); console.log('  card', c, '→ panels', JSON.stringify(await vis('.panel.on'))); }
  await p.click('.panel[data-panel="music"] [data-open-step="s2"]'); console.log('  "Add or change clips" opens step 2:', await p.isVisible('#addv'));
  await p.click('#views button[data-view="editor"]'); await p.waitForTimeout(500);
  await p.click('.tool[data-tool="shots"]'); await p.waitForTimeout(500);
  console.log('Editor: dock', JSON.stringify(await vis('.tool')), '| strip', await p.isVisible('#tl'), '| top Export', await p.isVisible('#topexport'));
  const before = await S();
  const chip = await p.evaluate(tr => { const c = [...document.querySelectorAll('#shotcard .chip')].find(x => x.dataset.v !== tr && x.dataset.v !== 'hard'); return c && c.dataset.v; }, before.tr);
  await p.click(`#shotcard .chip[data-v="${chip}"]`); await p.waitForTimeout(600);
  console.log('  shot chip "' + chip + '": shot', before.i + 1, 'transition', before.tr, '→', (await S()).tr, '| chip lit:', await p.getAttribute(`#shotcard .chip[data-v="${chip}"]`, 'aria-pressed'));
  await p.click('#shotcard .shtab[data-tab="1"]'); await p.waitForTimeout(300);
  console.log('  Effect tab chips:', await p.evaluate(() => document.querySelectorAll('#shotcard .chip').length));
  await p.click('#views button[data-view="pro"]'); await p.waitForTimeout(600);
  console.log('Pro: dock', JSON.stringify(await vis('.tool')), '| inspector', await p.isVisible('#inspector'), '| lanes', await p.isVisible('#lanes'), '| keyframes open', await p.evaluate(() => document.getElementById('kfbox').open));
  await p.selectOption('#inspector select[data-c="2"]', { index: 2 }); await p.waitForTimeout(600);
  console.log('  inspector speed →', await p.evaluate(() => { const s = document.querySelector('.brs').__studio; return s.edit[s.segAt(s.now)].sp.label; }));
  await p.evaluate(() => document.getElementById('lanes').scrollIntoView({ block: 'center' })); await p.waitForTimeout(300); const box = await p.locator('#lanes').boundingBox();
  const tx = box.x + 46 + (box.width - 46) * 0.75, ty = box.y + 20;
  if (process.env.DEBUG) console.log('  at the tap:', await p.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e && (e.id || e.className || e.tagName); }, [tx, ty]), JSON.stringify(box));
  await p.mouse.click(tx, ty); await p.waitForTimeout(800);
  console.log('  tap the timeline at 75%: playhead', (await p.evaluate(() => { const s = document.querySelector('.brs').__studio; return s.now / s.dur; })).toFixed(2));
  await p.click('#menubtn'); await p.waitForTimeout(400);
  await p.click('[role=dialog] [role=radio]:has-text("Noir")'); await p.click('[role=dialog] [role=radio]:has-text("Simple")'); await p.waitForTimeout(300);
  console.log('Menu: theme', await p.evaluate(() => document.documentElement.dataset.theme), '| view', await p.evaluate(() => document.querySelector('.brs').className.match(/v-\w+/)[0]), '| remembered', await p.evaluate(() => localStorage.getItem('studio-view') + ', ' + localStorage.getItem('reel-theme')));
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
