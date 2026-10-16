/* eslint-disable @typescript-eslint/no-require-imports */
// Templates: chosen before the media or on a finished edit, the settings they set and their texts placed on the final
// length of the Reel; switching templates replaces the texts; a talking template.
//   BASE=http://localhost:3000 SONG=song.mp3 CLIPS=a.webm TALK=t1.webm,t2.webm node check-templates.cjs
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:3000';
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = async () => { const p = await (await b.newContext({ viewport: { width: 1300, height: 1000 } })).newPage(); p.on('pageerror', e => console.log('ERR', e.message));
    await p.goto(BASE + '/studio?view=all'); await p.waitForFunction(() => document.querySelector('.brs') && document.querySelector('.brs').__studio, null, { timeout: 60000 }); return p; };
  const state = p => p.evaluate(() => { const s = document.querySelector('.brs').__studio, L = s.audio ? s.audio.duration : 0, pr = id => { const x = document.querySelector('#' + id + ' [aria-pressed="true"]'); return x ? Object.values(x.dataset)[0] : '-'; };
    return { kind: s.kind, mode: pr('mode'), look: pr('look'), style: pr('tstyle'), len: +L.toFixed(2), texts: s.overlays.map(o => o.text + ' ' + (o.all ? '[whole]' : '[' + o.t0.toFixed(2) + '-' + o.t1.toFixed(2) + ']')) }; });
  const settle = (p, first) => p.waitForFunction((first) => !document.querySelector('#tplhelp').textContent && document.querySelector('.brs').__studio.overlays.some(o => o.text === first), first, { timeout: 600000 }).then(() => p.waitForTimeout(800));
  // 1. product, chosen before anything
  let p = await page();
  await p.click('#tpl button[data-t="product"]');
  console.log('product, before media, hint:', await p.textContent('#tplhelp'));
  await p.setInputFiles('#mfile', process.env.SONG); await p.waitForFunction(() => /^Ready/.test(document.getElementById('s1st').textContent), null, { timeout: 300000 });
  await p.setInputFiles('#vfile', process.env.CLIPS.split(',')); await settle(p, 'New arrival ✨');
  console.log('  →', JSON.stringify(await state(p)));
  // 2. before / after on the finished edit, then recipe (30 s): the texts follow the new length, the old ones go
  await p.click('#tpl button[data-t="beforeafter"]'); await settle(p, 'BEFORE'); console.log('before/after →', JSON.stringify(await state(p)));
  await p.click('#tpl button[data-t="recipe"]'); await settle(p, 'Easy recipe in 30 seconds'); console.log('recipe →', JSON.stringify(await state(p)));
  await p.context().close();
  // 3. tutorial with talking clips
  p = await page();
  await p.click('#tpl button[data-t="tutorial"]');
  await p.setInputFiles('#vfile', process.env.TALK.split(',')); await settle(p, 'Step 1');
  const st = await state(p); console.log('tutorial →', JSON.stringify(st), '| pauses', await p.evaluate(() => document.querySelector('#tpace [aria-pressed="true"]').dataset.p));
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
