/* eslint-disable @typescript-eslint/no-require-imports */
// Text & stickers: shown only in their time, Devanagari drawn, dragged on the preview, kept in the safe area, in the export.
//   BASE=http://localhost:3000 SONG=song.mp3 CLIPS=a.webm,b.webm node check-overlays.cjs
const fs = require('fs'), { execSync } = require('child_process'), { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:3000', CLIPS = (process.env.CLIPS || '').split(',').filter(Boolean);
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 1300, height: 1000 } })).newPage(); p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto(BASE + '/studio?view=all'); await p.waitForFunction(() => document.querySelector('.brs') && document.querySelector('.brs').__studio, null, { timeout: 60000 });
  await p.setInputFiles('#mfile', process.env.SONG); await p.waitForFunction(() => /^Ready/.test(document.getElementById('s1st').textContent), null, { timeout: 300000 });
  await p.setInputFiles('#vfile', CLIPS); await p.waitForFunction(() => !document.getElementById('play').disabled && document.getElementById('qinfo').textContent === '', null, { timeout: 300000 });
  await p.evaluate(() => { const s = document.getElementById('safe'); if (s.checked) s.click(); });
  const S = '.brs';
  // ink of the item's box at time t: pixels that differ from the same frame without the item
  const inkAt = (i, t) => p.evaluate(async ({ i, t }) => { const st = document.querySelector('.brs').__studio, o = document.getElementById('out'), g = o.getContext('2d');
    await st.frameAt(t); const ov = st.overlays[i]; const bx = ov.box || [0, 0, 1, 1];
    const x = Math.max(0, Math.floor(bx[0] * o.width)), y = Math.max(0, Math.floor(bx[1] * o.height)), w = Math.max(1, Math.floor(bx[2] * o.width)), h = Math.max(1, Math.floor(bx[3] * o.height));
    const A = g.getImageData(x, y, w, h).data; const keep = st.overlays.splice(i, 1)[0]; await st.frameAt(t); const B = g.getImageData(x, y, w, h).data; st.overlays.splice(i, 0, keep); await st.frameAt(t);
    let d = 0; for (let k = 0; k < A.length; k += 4) if (Math.abs(A[k] - B[k]) + Math.abs(A[k + 1] - B[k + 1]) + Math.abs(A[k + 2] - B[k + 2]) > 60) d++;
    return { ink: +(d / (A.length / 4)).toFixed(3), box: ov.box.map(v => +v.toFixed(3)) }; }, { i, t });
  // 1. a text in Marathi, box style, 1.0 → 4.0 s
  await p.evaluate(() => { document.querySelector('.brs').__studio.seek(1.0); });
  await p.click('#ovtext'); await p.fill('.ov:last-child .ovt', 'आज खास दिवस'); await p.selectOption('.ov:last-child .ovs', 'box');
  await p.evaluate(() => document.querySelector('.brs').__studio.seek(4.0)); await p.click('.ov:last-child .ovto');
  console.log('text times:', await p.textContent('.ov:last-child .ovtm'));
  for (const t of [0.5, 1.2, 2.5, 3.9, 4.3]) console.log('  t', t, 'ink', JSON.stringify(await inkAt(0, t)));
  // 2. drag it on the preview
  const before = await p.evaluate(() => ({ x: document.querySelector('.brs').__studio.overlays[0].x, y: document.querySelector('.brs').__studio.overlays[0].y }));
  await p.evaluate(() => document.querySelector('.brs').__studio.seek(2.0)); await p.waitForTimeout(300);
  await p.locator('#out').scrollIntoViewIfNeeded(); const ob = (await inkAt(0, 2.0)).box, box = await p.locator('#out').boundingBox();
  const cx = box.x + (ob[0] + ob[2] / 2) * box.width, cy = box.y + (ob[1] + ob[3] / 2) * box.height;
  console.log('under the finger:', await p.evaluate(({ cx, cy }) => { const e = document.elementFromPoint(cx, cy); return e ? e.tagName + '#' + e.id + '.' + e.className : null; }, { cx, cy }));
  await p.mouse.move(cx, cy); await p.mouse.down(); await p.mouse.move(cx, cy + box.height * 0.25, { steps: 8 }); await p.mouse.up();
  const after = await p.evaluate(() => ({ x: document.querySelector('.brs').__studio.overlays[0].x, y: document.querySelector('.brs').__studio.overlays[0].y }));
  console.log('drag: y', before.y.toFixed(3), '→', after.y.toFixed(3), '| ink at new place', JSON.stringify(await inkAt(0, 2.0)));
  // 3. pushed to the bottom: stays above Instagram's bottom bar (450 of 1920)
  await p.evaluate(() => { document.querySelector('.brs').__studio.overlays[0].y = 0.99; });
  const low = await inkAt(0, 2.0); console.log('pushed down: box bottom', (low.box[1] + low.box[3]).toFixed(3), '(limit', (1 - 450 / 1920).toFixed(3) + ')');
  // 4. a sticker and a price tag (whole Reel)
  await p.click('#ovsticker'); await p.click('#emojis .em >> nth=0');
  await p.selectOption('#ovpreset', 'price'); await p.check('.ov:last-child .ovall');
  console.log('sticker ink at 3 s', JSON.stringify(await inkAt(1, 3)), '| price tag ink at 8 s', JSON.stringify(await inkAt(2, 8)));
  // 5. export: the price tag's yellow is in the video's frames at its place
  await p.evaluate(() => { window.__dl = null; const ck = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__dl = this.href; return; } return ck.call(this); }; });
  const pbox = (await inkAt(2, 8)).box;
  await p.click('#export'); await p.click('#xgo'); await p.waitForFunction(() => /saved|ready:/i.test(document.getElementById('xmsg').textContent), null, { timeout: 900000 });
  const b64 = await p.evaluate(async () => { const bl = await (await fetch(window.__dl)).blob(); const u = new Uint8Array(await bl.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192)); return btoa(s); });
  const f = __dirname + '/out_export.' + (b64.startsWith('GkXf') ? 'webm' : 'mp4'); fs.writeFileSync(f, Buffer.from(b64, 'base64'));
  const W = 1080, H = 1920, x = Math.round((pbox[0] + pbox[2] * 0.5) * W), y = Math.round((pbox[1] + pbox[3] * 0.5) * H);
  for (const t of [3, 8]) { const raw = execSync(`ffmpeg -v error -ss ${t} -i ${f} -frames:v 1 -vf "crop=${Math.round(pbox[2] * W * 0.8)}:${Math.round(pbox[3] * H * 0.5)}:${Math.round((pbox[0] + pbox[2] * 0.1) * W)}:${Math.round((pbox[1] + pbox[3] * 0.25) * H)}" -f rawvideo -pix_fmt rgb24 -`);
    let yel = 0; for (let k = 0; k < raw.length; k += 3) if (raw[k] > 200 && raw[k + 1] > 160 && raw[k + 2] < 120) yel++;
    console.log('export frame at', t, 's: yellow share inside the price tag box', (yel / (raw.length / 3)).toFixed(2)); }
  fs.unlinkSync(f); await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
