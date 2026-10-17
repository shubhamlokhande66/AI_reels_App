/* eslint-disable @typescript-eslint/no-require-imports */
// ◆ Keyframes: a bright bar on a dark clip is measured in rendered frames (its centre, size, angle, brightness) with and
// without the creator's keyframes, on the GPU and on the 2D renderer, through the panel's sliders and a drag on the
// picture, on a text, after saving and opening the Reel, and in the exported video.
//   sh make_clips.sh; BASE=http://localhost:3100 SONG=../studio-length/out/structured_120.wav node check-keyframes.cjs
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const fs = require('fs'), { execSync } = require('child_process');
const BASE = process.env.BASE || 'http://localhost:3000', OUT = __dirname + '/out/';
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 1300, height: 1000 } })).newPage(); p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto(BASE + '/studio?view=all'); await p.waitForFunction(() => document.querySelector('.brs') && document.querySelector('.brs').__studio, null, { timeout: 60000 });
  await p.setInputFiles('#mfile', process.env.SONG); await p.waitForFunction(() => /^Ready/.test(document.getElementById('s1st').textContent), null, { timeout: 300000 });
  // no AI scoring (its late answer would make the edit again in the middle of the measurements)
  await p.evaluate(() => { const c = document.getElementById('aipick'); if (c.checked) { c.checked = false; c.dispatchEvent(new Event('change')); } });
  await p.setInputFiles('#vfile', [OUT + 'bar_a.webm', OUT + 'bar_b.webm']);
  await p.waitForFunction(() => { const s = document.querySelector('.brs').__studio; return s.edit.length > 3 && !document.getElementById('play').disabled; }, null, { timeout: 600000 });
  // the song's late AI beat check can make the edit once more: wait until it stays the same for 4 s
  for (let g = -1, k = 0; k < 60; k++) { const g2 = await p.evaluate(() => document.querySelector('.brs').__studio.editGen); if (g2 === g) break; g = g2; await p.waitForTimeout(4000); }
  await p.click('#look button[data-l="natural"]'); await p.uncheck('#safe');
  // plain shots: no transition, no effect (the bar is then only moved by the keyframes)
  const shot = await p.evaluate(() => { const s = document.querySelector('.brs').__studio; s.edit.forEach(e => { e.tr = 'hard'; e.efx = 'none'; e.kf = {}; });
    let i = s.edit.findIndex((e, k) => k > 0 && e.end - e.start > 1); if (i < 0) i = 1; const e = s.edit[i]; return { i, a: e.start, L: e.end - e.start, n: s.edit.length, gl: s.gl }; });
  console.log('edit', shot.n, 'shots; shot', shot.i + 1, 'is', shot.L.toFixed(2), 's; GPU', shot.gl);
  // the bar in a frame: bright pixels' centre, area, angle (second moments) and the mean brightness at a place
  const measure = (t, region) => p.evaluate(async ([t, region]) => {
    const s = document.querySelector('.brs').__studio; await s.frameAt(t); const c = document.getElementById('out'), W = c.width, H = c.height;
    const d = c.getContext('2d').getImageData(0, 0, W, H).data; let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, rs = 0, rn = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k = (y * W + x) * 4, l = 0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2];
      if (l > 150) { n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; }
      if (region && x >= region[0] * W && x < region[2] * W && y >= region[1] * H && y < region[3] * H) { rs += l; rn++; } }
    const mx = sx / n, my = sy / n, cxx = sxx / n - mx * mx, cyy = syy / n - my * my, cxy = sxy / n - mx * my;
    return { cx: mx / W, cy: my / H, area: n / (W * H), ang: 0.5 * Math.atan2(2 * cxy, cxx - cyy) * 180 / Math.PI, lum: rn ? rs / rn : 0, W, H }; }, [t, region]);
  const setUk = (i, uk) => p.evaluate(([i, uk]) => { const e = document.querySelector('.brs').__studio.edit[i]; if (uk) e.uk = uk; else delete e.uk; }, [i, uk]);
  const K = (t, v = {}, ez) => Object.assign({ x: 0, y: 0, s: 1, r: 0, o: 1, t }, v, ez ? { ez } : {});
  const f2 = v => v.toFixed(3);
  const rows = [];
  const runAll = async label => {
    const T = shot.a + shot.L * 0.5, end = shot.L - 0.01, mid = 0.5 * shot.L / end;
    await setUk(shot.i, null); const base = await measure(T);
    const reg = [base.cx - 0.04, base.cy - 0.015, base.cx + 0.04, base.cy + 0.015];
    const base2 = await measure(T, reg);
    // move: x 0 → 0.2, y 0 → -0.1, linear: half way at the middle
    await setUk(shot.i, [K(0), K(end, { x: 0.2, y: -0.1 }, 'lin')]); const mv = await measure(T);
    rows.push([label, 'move x (lin, middle)', f2(0.2 * mid), f2(mv.cx - base.cx)], [label, 'move y (lin, middle)', f2(-0.1 * mid), f2(mv.cy - base.cy)]);
    // ease: smooth (in-out) at a quarter of the way
    await setUk(shot.i, null); const q = 0.25 * end, bq = await measure(shot.a + q); await setUk(shot.i, [K(0), K(end, { x: 0.2 }, 'inOut')]); const ez = await measure(shot.a + q);
    rows.push([label, 'smooth ease at 25%', f2(0.2 * (1 - Math.cos(Math.PI * 0.25)) / 2), f2(ez.cx - bq.cx)]);
    // zoom: 1.5x fixed → the bar's area 2.25x
    await setUk(shot.i, [K(0, { s: 1.5 })]); const zm = await measure(T);
    rows.push([label, 'zoom 1.5× (area ratio)', '2.250', f2(zm.area / base.area)]);
    // smaller: 0.5x → area 0.25x, centred, black around
    await setUk(shot.i, [K(0, { s: 0.5 })]); const sm = await measure(T);
    rows.push([label, 'zoom 0.5× (area ratio)', '0.250', f2(sm.area / base.area)]);
    // rotate 30°
    await setUk(shot.i, [K(0, { r: 30 })]); const rt = await measure(T);
    rows.push([label, 'rotate 30° (bar angle)', '30.0', (rt.ang - base.ang).toFixed(1)]);
    // opacity 0.5: the bar's brightness about half (after the colour grade)
    await setUk(shot.i, [K(0, { o: 0.5 })]); const op = await measure(T, reg);
    rows.push([label, 'opacity 50% (bar brightness ratio)', '~0.50', f2(op.lum / base2.lum)]);
    // hold: no move until the keyframe
    await setUk(shot.i, [K(0), K(end, { x: 0.2 }, 'hold')]); const hd = await measure(T);
    rows.push([label, 'hold ease (middle)', '0.000', f2(hd.cx - base.cx)]);
    await setUk(shot.i, null);
  };
  await runAll(shot.gl ? 'GPU' : '2D');
  if (shot.gl) { await p.evaluate(() => { const x = document.querySelector('.brs').__studio.loseGL(); if (x) x.loseContext(); }); await p.waitForTimeout(300); await runAll('2D'); }
  console.table(rows.map(r => ({ renderer: r[0], check: r[1], expected: r[2], measured: r[3] })));

  // the panel: open, playhead on the shot, sliders write keyframes (one at the start, one later), the strip shows them
  await p.evaluate(() => { const d = document.getElementById('kfbox'); if (!d.open) d.open = true; });   // open in the all-panels view
  await p.evaluate(s => document.querySelector('.brs').__studio.kfSeek(s.a + 0.05), shot);
  const slide = (id, v) => p.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, [id, v]);
  await slide('kf_s', 1.2);
  await p.evaluate(s => document.querySelector('.brs').__studio.kfSeek(s.a + s.L * 0.8), shot);
  await slide('kf_x', 0.15); await slide('kf_r', 10);
  const ui = await p.evaluate(i => { const e = document.querySelector('.brs').__studio.edit[i]; return { target: document.getElementById('kftarget').textContent, uk: e.uk, add: document.getElementById('kfadd').textContent, info: document.getElementById('kfinfo').textContent }; }, shot.i);
  console.log('panel target:', ui.target, '|', ui.add, '|', ui.info);
  console.log('  keyframes:', JSON.stringify(ui.uk.map(k => ({ t: +k.t.toFixed(2), x: k.x, s: k.s, r: k.r, ez: k.ez }))));
  // between them: half way (smooth) values shown in the sliders
  await p.evaluate(s => document.querySelector('.brs').__studio.kfSeek(s.a + 0.05 + (s.L * 0.8 - 0.05) / 2), shot);
  console.log('  sliders half way:', await p.evaluate(() => ['x', 's', 'r'].map(n => n + ' ' + document.getElementById('kfv_' + n).textContent).join(', ')), '(expect x 7.5%, zoom 1.20×, rotate 5°)');
  // previous / next keyframe buttons, ease, delete
  await p.click('#kfprev'); await p.waitForTimeout(400); const atPrev = await p.evaluate(() => document.getElementById('kfadd').textContent);
  const ukNow = () => p.evaluate(i => JSON.stringify((document.querySelector('.brs').__studio.edit[i].uk || []).map(k => [+k.t.toFixed(2), k.ez])) + ' head ' + document.getElementById('kfadd').textContent, shot.i);
  await p.click('#kfnext'); await p.waitForTimeout(400); const atNext = await ukNow(); await p.selectOption('#kfease', 'outBack'); const eased = await ukNow(); await p.click('#kfdel'); await p.waitForTimeout(200);
  console.log('  ◀◆ lands on a keyframe:', atPrev, '| ◆▶:', atNext, '| ease:', eased, '| delete:', await ukNow());
  // drag on the picture moves the shot: 10% of the width to the right
  await p.evaluate(s => document.querySelector('.brs').__studio.kfSeek(s.a + s.L * 0.5), shot);
  const before = await measure(shot.a + shot.L * 0.5);
  await p.locator('#out').scrollIntoViewIfNeeded(); const box = await p.locator('#out').boundingBox();
  await p.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5); await p.mouse.down();
  await p.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.5, { steps: 3 }); await p.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5, { steps: 3 }); await p.mouse.up();
  console.log('  (target while dragging:', await p.evaluate(() => document.getElementById('kftarget').textContent) + ')');
  const after = await measure(shot.a + shot.L * 0.5);
  console.log('drag 10% right: the bar moved', f2(after.cx - before.cx), '(expect 0.100)');
  // a ready-made move on the shot
  await p.evaluate(s => document.querySelector('.brs').__studio.kfSeek(s.a + s.L * 0.5), shot); await p.selectOption('#kfpreset', 'zoomin'); await p.waitForTimeout(400);
  console.log('ready-made "Slow zoom in":', JSON.stringify(await p.evaluate(i => document.querySelector('.brs').__studio.edit[i].uk.map(k => [+k.t.toFixed(2), k.s, k.ez || '']), shot.i)));
  // New mix: other footage, the same times: the keyframes stay on their shot
  const ukBefore = await p.evaluate(i => JSON.stringify(document.querySelector('.brs').__studio.edit[i].uk), shot.i);
  await p.click('#remix'); await p.waitForTimeout(800);
  console.log('New mix: keyframes still on shot', shot.i + 1, await p.evaluate(([i, u]) => JSON.stringify(document.querySelector('.brs').__studio.edit[i].uk) === u, [shot.i, ukBefore]));
  await p.evaluate(() => document.querySelector('.brs').__studio.edit.forEach(e => { e.tr = 'hard'; e.efx = 'none'; e.kf = {}; }));
  // a text: selected → the target; a keyframed move
  await p.click('#ovtext'); await p.fill('.ov:last-child .ovt', 'HELLO'); await p.check('.ov:last-child .ovall');
  await p.evaluate(() => document.querySelector('.brs').__studio.kfSeek(2));
  const tTarget = await p.evaluate(() => document.getElementById('kftarget').textContent);
  const ovBox = () => p.evaluate(async () => { const s = document.querySelector('.brs').__studio; await s.frameAt(2); return s.overlays[0].box; });
  const ob0 = await ovBox(); await slide('kf_x', 0.2); await slide('kf_s', 1.5); const ob1 = await ovBox();
  console.log('text target:', tTarget, '| text box centre moved', f2(ob1[0] + ob1[2] / 2 - (ob0[0] + ob0[2] / 2)), '(expect 0.200), width ratio', f2(ob1[2] / ob0[2]), '(expect 1.500)');
  // saved with the Reel and back after opening it
  const saved = await p.evaluate(() => { const st = JSON.stringify(document.querySelector('.brs').__studio.state ? document.querySelector('.brs').__studio.state() : null); return st; });
  if (saved && saved !== 'null') { const st = JSON.parse(saved); console.log('saved: shot keyframes', (st.edit[shot.i].uk || []).length, '| text keyframes', (st.overlays[0].uk || []).length); }

  // export: one shot moved 0.2 to the right and turned 20° (fixed), measured in the video vs the preview
  await p.evaluate(() => { const s = document.querySelector('.brs').__studio; s.overlays.length = 0; s.edit.forEach(e => delete e.uk); });
  await setUk(shot.i, [K(0, { x: 0.2, r: 20 })]);
  const pv = await measure(shot.a + shot.L * 0.5);
  await p.evaluate(() => { window.__dl = null; const ck = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__dl = this.href; return; } return ck.call(this); }; });
  await p.click('#export'); await p.click('#xgo'); await p.waitForFunction(() => /saved|ready:/i.test(document.getElementById('xmsg').textContent), null, { timeout: 900000 });
  const b64 = await p.evaluate(async () => { const bl = await (await fetch(window.__dl)).blob(); const u = new Uint8Array(await bl.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192)); return btoa(s); });
  const f = OUT + 'export.' + (b64.startsWith('GkXf') ? 'webm' : 'mp4'); fs.writeFileSync(f, Buffer.from(b64, 'base64'));
  const W = 1080, H = 1920, raw = execSync(`ffmpeg -v error -ss ${(shot.a + shot.L * 0.5).toFixed(3)} -i ${f} -frames:v 1 -f rawvideo -pix_fmt rgb24 -`, { maxBuffer: 64 << 20 });
  let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k = (y * W + x) * 3; if (0.299 * raw[k] + 0.587 * raw[k + 1] + 0.114 * raw[k + 2] > 150) { n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; } }
  const mx = sx / n, my = sy / n, ang = 0.5 * Math.atan2(2 * (sxy / n - mx * my), (sxx / n - mx * mx) - (syy / n - my * my)) * 180 / Math.PI;
  console.log('export 1080x1920 vs preview: bar centre', f2(mx / W) + ',' + f2(my / H), 'vs', f2(pv.cx) + ',' + f2(pv.cy), '| angle', ang.toFixed(1), 'vs', pv.ang.toFixed(1), '| area', f2(n / (W * H) / pv.area), '× the preview\'s');
  fs.unlinkSync(f); await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
