/* eslint-disable @typescript-eslint/no-require-imports */
// My music: songs used lately listed and picked again instantly with the same beats; export without the song (no sound
// track, the tip names the song and where it starts); removing a recent song.
//   BASE=http://localhost:3000 SONG=a.mp3 SONG2=b.wav CLIPS=a.webm node check-mymusic.cjs
const fs = require('fs'), { execSync } = require('child_process'), { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:3000';
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 1300, height: 1000 } })).newPage(); p.on('pageerror', e => console.log('ERR', e.message));
  const open = async () => { await p.goto(BASE + '/studio?view=all'); await p.waitForFunction(() => document.querySelector('.brs') && document.querySelector('.brs').__studio, null, { timeout: 60000 }); };
  const ready = () => p.waitForFunction(() => /confirmed|double-checked|as checked before|^Ready$/.test(document.getElementById('s1st').textContent), null, { timeout: 300000 });
  const beatsSig = () => p.evaluate(() => { const r = document.querySelector('.brs').__studio.songR; return r.beats.length + ':' + r.beats.slice(0, 50).map(x => x.toFixed(3)).join(','); });
  await open();
  let t0 = Date.now(); await p.setInputFiles('#mfile', process.env.SONG); await ready(); const firstMs = Date.now() - t0, sigA = await beatsSig();
  await p.setInputFiles('#mfile', process.env.SONG2); await ready(); await p.waitForTimeout(800);
  console.log('recent after two songs:', await p.$$eval('#rlist .rn', x => x.map(e => e.textContent).join(' | ')));
  await open(); await p.waitForSelector('#rlist .rsong', { timeout: 20000 });
  console.log('after reopening the page:', await p.$$eval('#rlist .rn', x => x.map(e => e.textContent).join(' | ')));
  t0 = Date.now(); await p.click('#rlist .rsong:nth-child(2) .rpick'); await ready(); const againMs = Date.now() - t0, sigA2 = await beatsSig();
  console.log('song A: first time', firstMs, 'ms (analysis + AI beat check) | picked again from Recent', againMs, 'ms | same beats:', sigA === sigA2, '| status:', await p.textContent('#s1st'));
  // export without the song
  await p.setInputFiles('#vfile', process.env.CLIPS.split(',')); await p.waitForFunction(() => !document.getElementById('play').disabled && document.getElementById('qinfo').textContent === '', null, { timeout: 300000 });
  await p.click('#slen button[data-l="15"]'); await p.waitForFunction(() => Math.abs(document.querySelector('.brs').__studio.section.len - 15) < 0.6, null, { timeout: 60000 }); await p.waitForTimeout(1500);
  await p.check('#nosong');
  await p.evaluate(() => { window.__dl = null; const ck = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__dl = this.href; return; } return ck.call(this); }; });
  await p.click('#export'); await p.waitForFunction(() => /saved|ready:/i.test(document.getElementById('xmsg').textContent), null, { timeout: 1500000 });
  console.log('export message:', await p.textContent('#xmsg'));
  const b64 = await p.evaluate(async () => { const u = new Uint8Array(await (await (await fetch(window.__dl)).blob()).arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192)); return btoa(s); });
  const f = __dirname + '/nosong_export.webm'; fs.writeFileSync(f, Buffer.from(b64, 'base64'));
  console.log('exported streams:', execSync(`ffprobe -v error -show_entries stream=codec_type,codec_name -of compact ${f}`).toString().trim().replace(/\n/g, ' | ')); fs.unlinkSync(f);
  // remove a recent song
  await p.click('#rlist .rsong:last-child .rdel'); await p.waitForTimeout(800);
  console.log('after removing one:', await p.$$eval('#rlist .rn', x => x.map(e => e.textContent).join(' | ')));
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
