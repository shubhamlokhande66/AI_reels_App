/* eslint-disable @typescript-eslint/no-require-imports */
// Voice noise cleanup on a talking clip with street noise mixed in 12 dB under the voice (out/talk_0_noisy.webm): the
// noise left in the pauses, the voice against the clean recording, and pause cutting in noise, cleanup on and off.
//   BASE=http://localhost:3000 node check-denoise.cjs
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:3000', OUT = __dirname + '/out/', T = require(OUT + 'talk_truth.json').talk_0;
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 1300, height: 1000 } })).newPage(); p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto(BASE + '/studio?view=pro'); await p.waitForFunction(() => document.querySelector('.brs') && document.querySelector('.brs').__studio, null, { timeout: 60000 });
  await p.click('#kind button[data-k="talk"]'); await p.click('#tpace button[data-p="off"]');
  await p.setInputFiles('#vfile', [OUT + 'talk_0_noisy.webm']);
  const ready = () => p.waitForFunction(() => /of talk/.test(document.getElementById('s3st').textContent), null, { timeout: 300000 }).then(() => p.waitForTimeout(500));
  await ready();
  // the clean recording, for comparison
  const cleanB64 = require('fs').readFileSync(OUT + 'talk_0.webm').toString('base64');
  await p.evaluate(async (b64) => { const u = Uint8Array.from(atob(b64), c => c.charCodeAt(0)), sr = document.querySelector('.brs').__studio.sources[0].voice.sr;
    window.__clean = (await new AudioContext({ sampleRate: sr }).decodeAudioData(u.buffer)).getChannelData(0); }, cleanB64);
  const meas = () => p.evaluate((T) => { const s = document.querySelector('.brs').__studio, v = s.sources[0].voice, x = v.pcm, sr = v.sr, c = window.__clean;
    const inSp = i => T.speech.some(([a, e]) => i >= a * sr && i < e * sr), gaps = T.speech.slice(1).map(([a], k) => [T.speech[k][1] + 0.15, a - 0.15]).filter(([a, e]) => e > a);
    let ps = 0, ns = 0, np = 0, nn = 0; for (let i = 0; i < x.length; i += 3) { if (inSp(i)) { ps += x[i] * x[i]; ns++; } else if (gaps.some(([a, e]) => i >= a * sr && i < e * sr)) { np += x[i] * x[i]; nn++; } }
    // closeness to the clean recording in the speech: correlation (best lag within ±20 ms)
    let best = 0; for (let d = -960; d <= 960; d += 8) { let xy = 0, xx = 0, yy = 0; for (const [a, e] of T.speech) for (let i = Math.round(a * sr); i < e * sr; i += 5) { const y = c[i + d] || 0; xy += x[i] * y; xx += x[i] * x[i]; yy += y * y; } const r = xy / Math.sqrt(xx * yy + 1e-12); if (r > best) best = r; }
    return { voiceOverPauseNoise_dB: +(10 * Math.log10((ps / ns) / (np / nn + 1e-12))).toFixed(1), likeCleanRecording: +best.toFixed(3) }; }, T);
  const off = await (async () => { await p.uncheck('#dn1'); await ready(); return meas(); })();
  const on = await (async () => { await p.check('#dn1'); await ready(); return meas(); })();
  console.log('cleanup off:', JSON.stringify(off)); console.log('cleanup on: ', JSON.stringify(on));
  // pause cutting in the noise (Natural): speech kept, long pauses left
  await p.click('#tpace button[data-p="natural"]'); await ready();
  const r = await p.evaluate((T) => { const s = document.querySelector('.brs').__studio, sh = s.edit.map(e => [e.in, e.in + e.end - e.start]); const ov = (a, b) => sh.reduce((q, [u, v]) => q + Math.max(0, Math.min(b, v) - Math.max(a, u)), 0);
    let sp = 0, k = 0, g = 0, gk = 0; T.speech.forEach(([a, e]) => { sp += e - a; k += ov(a, e); }); T.speech.slice(1).forEach(([a], i) => { const g0 = T.speech[i][1]; if (a - g0 >= 1) { g += a - g0; gk += ov(g0, a); } });
    return { speechKept: +(k / sp * 100).toFixed(1), longPausesLeft: +(gk / g * 100).toFixed(1), talk: +s.audio.duration.toFixed(2), detector: s.sources[0].voice.how }; }, T);
  console.log('pauses cut in the noise (cleanup on):', JSON.stringify(r));
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
