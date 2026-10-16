/* eslint-disable @typescript-eslint/no-require-imports */
// Faces (BlazeFace vs the old Viola-Jones) against the known face position, and the background tools: a colour behind the
// person, blur, a text behind the person, the export.   BASE=http://localhost:3000 SONG=song.mp3 node check-vision.cjs
const fs = require('fs'), { execSync } = require('child_process'), { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:3000', OUT = __dirname + '/out/', T = require(OUT + 'person_truth.json');
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const run = async (noBlaze) => {
    const ctx = await b.newContext({ viewport: { width: 1300, height: 1000 } });
    if (noBlaze) await ctx.route('**/api/studio/model/face_detection_short_range.onnx', r => r.fulfill({ status: 404, body: '' }));
    const p = await ctx.newPage(); p.on('pageerror', e => console.log('ERR', e.message));
    await p.goto(BASE + '/studio'); await p.waitForFunction(() => document.querySelector('.brs') && document.querySelector('.brs').__studio, null, { timeout: 60000 });
    await p.setInputFiles('#mfile', process.env.SONG); await p.waitForFunction(() => /^Ready/.test(document.getElementById('s1st').textContent), null, { timeout: 300000 });
    await p.setInputFiles('#vfile', Object.keys(T).map(n => OUT + n + '.webm'));
    await p.waitForFunction(() => !document.getElementById('play').disabled && document.getElementById('qinfo').textContent === '', null, { timeout: 300000 });
    const r = await p.evaluate(() => { const s = document.querySelector('.brs').__studio; return { how: s.faceHow, faces: s.sources.map(x => ({ n: x.name, f: x.faces })) }; });
    const rows = r.faces.map(({ n, f }) => { const tr = T[n.replace('.webm', '')]; let hit = 0, err = 0, tot = 0;
      for (const d of f) { const k = Math.min(tr.face.length - 1, Math.round(d.t / tr.every)), [fx, fy] = tr.face[k]; tot++; if (d.n > 0) { hit++; err += Math.hypot(d.fx - fx, (d.fy - fy) * 960 / 540); } }
      return `${n}: face found in ${hit}/${tot} looks, mean error ${(err / Math.max(1, hit) * 100).toFixed(1)}% of the width`; });
    console.log((noBlaze ? 'Viola-Jones (old)' : 'BlazeFace (new)  ') + ' [' + [...new Set(r.how)].join(',') + ']  ' + rows.join(' | '));
    return { p, ctx };
  };
  await (await run(true)).ctx.close();
  const { p } = await run(false);
  if (process.env.FACES_ONLY) { await b.close(); return; }
  await p.evaluate(() => { const s = document.getElementById('safe'); if (s.checked) s.click(); });
  // a moment of the first clip (the push-in): the shot list tells where
  const t = await p.evaluate(() => { const s = document.querySelector('.brs').__studio, e = s.edit.find(x => x.src === 0 && x.end - x.start > 0.8) || s.edit[0]; return +(e.start + Math.min(0.6, (e.end - e.start) / 2)).toFixed(3); });
  // regions: around the face (the person) and the top corners above the shoulders (background: wall, flag)
  const meas = (label) => p.evaluate(async ({ t, label }) => { const s = document.querySelector('.brs').__studio, o = document.getElementById('out'), g = o.getContext('2d');
    await s.seek(t); for (let k = 0; k < 40 && !s.bg.mask && s.bg.mode !== 'none'; k++) await new Promise(r => setTimeout(r, 100)); await new Promise(r => setTimeout(r, 300)); await s.seek(t); await new Promise(r => setTimeout(r, 300));
    const W = o.width, H = o.height, reg = (x0, y0, x1, y1) => g.getImageData(Math.round(x0 * W), Math.round(y0 * H), Math.round((x1 - x0) * W), Math.round((y1 - y0) * H)).data;
    const green = d => { let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 80 && d[i + 1] > 150 && d[i + 2] < 120) n++; return +(n / (d.length / 4)).toFixed(3); };
    const mean = d => { let m = 0; for (let i = 0; i < d.length; i += 4) m += d[i] + d[i + 1] + d[i + 2]; return m / (d.length / 4); };
    const sharp = d => { let v = 0, n = 0, w = Math.round(0.12 * W) * 4; for (let i = 4; i < d.length; i += 4) { if ((i / 4) % (w / 4)) { const a = d[i] - d[i - 4]; v += a * a; n++; } } return +(v / n).toFixed(1); };
    const face = reg(0.44, 0.22, 0.56, 0.32), cornerL = reg(0.02, 0.12, 0.14, 0.2), cornerR = reg(0.86, 0.12, 0.98, 0.2);
    return { label, mask: s.bg.mask, err: s.bg.err, faceGreen: green(face), cornersGreen: +((green(cornerL) + green(cornerR)) / 2).toFixed(3), faceMean: Math.round(mean(face)), cornerSharp: +((sharp(cornerL) + sharp(cornerR)) / 2).toFixed(1) }; }, { t, label });
  console.log('at', t, 's:');
  console.log(' ', JSON.stringify(await meas('original')));
  await p.click('#bgmode button[data-b="color"]'); console.log(' ', JSON.stringify(await meas('green background')));
  await p.click('#bgmode button[data-b="blur"]'); console.log(' ', JSON.stringify(await meas('blurred background')));
  // a text behind the person, right across the face: hidden where the person is, seen beside
  await p.click('#bgmode button[data-b="color"]');
  await p.evaluate((t) => document.querySelector('.brs').__studio.seek(t), t);
  await p.click('#ovtext'); await p.fill('.ov:last-child .ovt', 'BEHIND'); await p.check('.ov:last-child .ovall'); await p.selectOption('.ov:last-child .ovs', 'box');
  await p.evaluate(() => { const o = document.querySelector('.brs').__studio.overlays[0]; o.y = 0.27; o.size = 2.2; });
  const beh = async (on) => { await p.evaluate((on) => { const o = document.querySelector('.brs').__studio.overlays[0]; o.behind = on; }, on);
    return p.evaluate(async (t) => { const s = document.querySelector('.brs').__studio, o = document.getElementById('out'), g = o.getContext('2d'); await s.seek(t); await new Promise(r => setTimeout(r, 400)); await s.seek(t);
      const W = o.width, H = o.height, yel = (x0, x1) => { const d = g.getImageData(Math.round(x0 * W), Math.round(0.25 * H), Math.round((x1 - x0) * W), Math.round(0.04 * H)).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 230 && d[i + 1] > 230 && d[i + 2] > 230) n++; return +(n / (d.length / 4)).toFixed(3); };
      return { overFace: yel(0.46, 0.54), besideFace: yel(0.15, 0.3) }; }, t); };
  console.log('  text in front:', JSON.stringify(await beh(false)), '| behind the person:', JSON.stringify(await beh(true)));
  // export with the green background
  await p.evaluate(() => { document.querySelector('.brs').__studio.overlays.length = 0; window.__dl = null; const ck = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__dl = this.href; return; } return ck.call(this); }; });
  await p.click('#export'); await p.waitForFunction(() => /saved|ready:|failed/i.test(document.getElementById('xmsg').textContent), null, { timeout: 1500000 });
  const b64 = await p.evaluate(async () => { const bl = await (await fetch(window.__dl)).blob(); const u = new Uint8Array(await bl.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192)); return btoa(s); });
  const f = __dirname + '/out/export_bg.webm'; fs.writeFileSync(f, Buffer.from(b64, 'base64'));
  const raw = execSync(`ffmpeg -v error -ss ${t} -i ${f} -frames:v 1 -vf scale=108:192 -f rawvideo -pix_fmt rgb24 -`);
  const px = (x, y) => { const i = (Math.round(y * 192) * 108 + Math.round(x * 108)) * 3; return [raw[i], raw[i + 1], raw[i + 2]]; };
  const isG = c => c[0] < 80 && c[1] > 150 && c[2] < 120;
  let cg = 0, fg = 0, n = 0; for (let y = 0.13; y < 0.2; y += 0.01) for (const x of [0.04, 0.08, 0.92, 0.96]) { n++; if (isG(px(x, y))) cg++; }
  let nf = 0; for (let y = 0.23; y < 0.31; y += 0.01) for (let x = 0.46; x < 0.55; x += 0.02) { nf++; if (isG(px(x, y))) fg++; }
  console.log('export at', t, 's: green in the corners', (cg / n).toFixed(2), '| green on the face', (fg / nf).toFixed(2), '|', await p.textContent('#xmsg'));
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
