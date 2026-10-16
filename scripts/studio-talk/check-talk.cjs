/* eslint-disable @typescript-eslint/no-require-imports */
// Talking videos, checked on clips with known speech (make_talk.py): every phrase kept, long pauses cut, the picture in
// sync with the voice, the music stepping back under the voice, the pause settings, captions of the voice, the export.
//   BASE=http://localhost:3000 SONG=song.wav node check-talk.cjs
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:3000', OUT = __dirname + '/out/', T = require(OUT + 'talk_truth.json');
const CLIPS = Object.keys(T).map(n => OUT + n + '.webm');
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ viewport: { width: 1300, height: 1000 } });
  let capReq = null;
  await ctx.route('**/api/studio/transcribe**', async route => { const r = route.request();
    if (r.method() === 'GET') return route.fulfill({ json: { available: true, credits: 0, languages: ['hi', 'mr', 'en'] } });
    const body = r.postDataBuffer(); capReq = { secs: (body.length - 44) / 2 / 16000 };
    return route.fulfill({ json: { words: [{ text: 'hello', start: 0.3, end: 0.8 }], duration: capReq.secs, language: 'auto', charged: 0 } }); });
  const p = await ctx.newPage(); p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto(BASE + '/studio'); await p.waitForFunction(() => document.querySelector('.brs') && document.querySelector('.brs').__studio, null, { timeout: 60000 });
  await p.click('#kind button[data-k="talk"]');
  const t0 = Date.now();
  await p.setInputFiles('#vfile', CLIPS);
  const ready = () => p.waitForFunction(() => /of talk/.test(document.getElementById('s3st').textContent) && !document.getElementById('play').disabled, null, { timeout: 300000 });
  await ready();
  console.log('clips read + talk edit in', ((Date.now() - t0) / 1000).toFixed(1), 's |', await p.evaluate(() => document.getElementById('s3st').textContent));
  const score = async (label) => {
    const r = await p.evaluate(() => { const s = document.querySelector('.brs').__studio; return { names: s.sources.map(x => x.name), how: s.sources.map(x => x.voice && x.voice.how),
      shots: s.edit.map(e => ({ si: e.src, in: e.in, len: e.end - e.start, start: e.start, efx: e.efx })), dur: s.talk ? s.talk.parts.reduce((q, x) => q + x.b - x.a, 0) : 0 }; });
    let speech = 0, kept = 0, gapsLong = 0, gapsLongKept = 0;
    r.names.forEach((n, si) => { const tr = T[n.replace('.webm', '')]; if (!tr) return; const sh = r.shots.filter(x => x.si === si).map(x => [x.in, x.in + x.len]);
      const ov = (a, b) => sh.reduce((q, [u, v]) => q + Math.max(0, Math.min(b, v) - Math.max(a, u)), 0);
      tr.speech.forEach(([a, b]) => { speech += b - a; kept += ov(a, b); });
      tr.speech.slice(1).forEach(([a], k) => { const g0 = tr.speech[k][1], g1 = a; if (g1 - g0 >= 1) { gapsLong += g1 - g0; gapsLongKept += ov(g0, g1); } }); });
    console.log(label.padEnd(9), '| talk', r.dur.toFixed(2), 's | shots', r.shots.length, '| punch-ins', r.shots.filter(x => x.efx === 'jump').length,
      '| speech kept', (kept / speech * 100).toFixed(1) + '%', '| long pauses (≥1 s) left', (gapsLongKept / gapsLong * 100).toFixed(1) + '%', '| detector', [...new Set(r.how)].join(','));
    return r;
  };
  const nat = await score('natural');
  // sync: the voice in the Reel at each shot's start is the clip's own sound at its "in" point
  const sync = await p.evaluate(async () => { const s = document.querySelector('.brs').__studio, t = s.talk, out = [];
    for (const e of s.edit.slice(0, 8)) { const v = s.sources[e.src].voice, a = Math.round((e.in + 0.15) * v.sr), b = Math.round((e.start + 0.15) * t.sr), n = Math.round(0.25 * t.sr);
      let best = -1, lag = 0; for (let d = -480; d <= 480; d += 24) { let xy = 0, xx = 0, yy = 0; for (let i = 0; i < n; i += 2) { const x = v.pcm[a + i + d] || 0, y = t.voice[b + i] || 0; xy += x * y; xx += x * x; yy += y * y; } const c = xy / Math.sqrt(xx * yy + 1e-12); if (c > best) { best = c; lag = d; } }
      out.push((best).toFixed(2) + '@' + (lag / t.sr * 1000).toFixed(0) + 'ms'); } return out; });
  console.log('sync (correlation@offset, voice vs clip, first 8 shots):', sync.join(' '));
  for (const pace of ['tight', 'relaxed', 'off', 'natural']) { await p.click(`#tpace button[data-p="${pace}"]`); await p.waitForTimeout(400); await ready(); await score(pace); }
  // captions of the voice
  await p.check('#caps'); await p.waitForFunction(() => /words found|No words|not available/.test(document.getElementById('capstat').textContent), null, { timeout: 60000 });
  console.log('captions: audio sent', capReq && capReq.secs.toFixed(2), 's (talk', nat.dur.toFixed(2), 's)');
  if (process.env.SONG) {
    await p.setInputFiles('#mfile', process.env.SONG); await p.waitForTimeout(1500); await ready(); await p.waitForTimeout(1500);
    const lv = await p.evaluate(() => { const s = document.querySelector('.brs').__studio, t = s.talk, ab = s.audio, L = ab.getChannelData(0), w = Math.round(0.05 * t.sr);
      // 50 ms windows: speech where the voice is louder than -40 dBFS; the music = the Reel's sound minus the voice
      let a = 0, na = 0, q = 0, nq = 0, vv = 0, nv = 0;
      for (let k = 0; k + w <= L.length; k += w) { let ve = 0, me = 0; for (let i = k; i < k + w; i++) { const v = t.voice[i], m = L[i] - v; ve += v * v; me += m * m; } ve /= w; me /= w;
        if (10 * Math.log10(ve + 1e-12) > -40) { a += me; na++; vv += ve; nv++; } else { q += me; nq++; } }
      const db = x => +(10 * Math.log10(x + 1e-12)).toFixed(1);
      return { voiceDb: db(vv / Math.max(1, nv)), musicUnderVoiceDb: db(a / Math.max(1, na)), musicInPausesDb: db(q / Math.max(1, nq)), pauseWindows: nq }; });
    console.log('music under the voice:', JSON.stringify(lv));
  }
  // export: as long as the talk
  await p.evaluate(() => { window.__dl = null; const ck = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__dl = this.href; return; } return ck.call(this); }; });
  await p.click('#export'); await p.waitForFunction(() => /saved|ready:/i.test(document.getElementById('xmsg').textContent), null, { timeout: 900000 });
  const v = await p.evaluate(async () => { const v = document.createElement('video'); v.src = window.__dl; await new Promise(r => { v.onloadedmetadata = r; setTimeout(r, 10000); });
    if (v.duration === Infinity) { v.currentTime = 1e9; await new Promise(r => { v.ontimeupdate = r; setTimeout(r, 5000); }); } return v.duration; });
  console.log('exported video:', v.toFixed(2), 's (talk', (await p.evaluate(() => document.querySelector('.brs').__studio.talk.parts.reduce((q, x) => q + x.b - x.a, 0))).toFixed(2), 's)');
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
