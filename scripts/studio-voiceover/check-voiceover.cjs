/* eslint-disable @typescript-eslint/no-require-imports */
// Voiceover with a stand-in microphone (Chromium plays a WAV as the mic): recorded, the song steps back under the
// voice, captions made from the voice, the export has the voice, saved and opened again.
//   BASE=http://localhost:3000 SONG=song.mp3 CLIPS=a.webm node check-voiceover.cjs   (python3 make_mic.py first)
const fs = require('fs'), { execSync } = require('child_process'), { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:3000', CLIPS = (process.env.CLIPS || '').split(',').filter(Boolean), MIC = __dirname + '/out/mic_voice.wav';
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${MIC}%noloop`] });
  const ctx = await b.newContext({ viewport: { width: 1300, height: 1000 }, permissions: ['microphone'] });
  let cap = null;
  await ctx.route('**/api/studio/transcribe**', async route => { const r = route.request();
    if (r.method() === 'GET') return route.fulfill({ json: { available: true, credits: 0, languages: ['en'] } });
    cap = (r.postDataBuffer().length - 44) / 2 / 16000; return route.fulfill({ json: { words: [{ text: 'here', start: 1, end: 1.3 }], duration: cap, language: 'en', charged: 0 } }); });
  const p = await ctx.newPage(); p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto(BASE + '/studio?view=all'); await p.waitForFunction(() => document.querySelector('.brs') && document.querySelector('.brs').__studio, null, { timeout: 60000 });
  await p.setInputFiles('#mfile', process.env.SONG); await p.waitForFunction(() => /confirmed|double-checked|^Ready$/.test(document.getElementById('s1st').textContent), null, { timeout: 300000 });
  await p.click('#slen button[data-l="15"]'); await p.waitForFunction(() => Math.abs(document.querySelector('.brs').__studio.section.len - 15) < 0.6, null, { timeout: 60000 });
  await p.setInputFiles('#vfile', CLIPS); await p.waitForFunction(() => !document.getElementById('play').disabled && document.getElementById('qinfo').textContent === '', null, { timeout: 300000 });
  await p.click('#vorec');
  await p.waitForFunction(() => /Voiceover ✓|Nothing|not available|not supported/.test(document.getElementById('vostat').textContent), null, { timeout: 120000 });
  console.log('status:', await p.textContent('#vostat'));
  const m = await p.evaluate(() => { const s = document.querySelector('.brs').__studio, v = s.vo, B = s.base, A = s.audio, sr = A.sampleRate, w = Math.round(0.1 * sr);
    const vb = v.pcm, L = A.getChannelData(0), Bs = B.buf.getChannelData(0); let on = [0, 0], off = [0, 0], vs = 0, nv = 0;
    for (let k = 0; k + w <= L.length; k += w) { let ve = 0, xy = 0, yy = 0; for (let i = k; i < k + w; i++) { const j = Math.floor(i * v.sr / sr), x = vb[j] || 0; ve += x * x; const y = Bs[i] * B.norm; xy += L[i] * y; yy += y * y; }
      const a = xy / (yy + 1e-12), loud = Math.sqrt(ve / w) > 0.02; if (yy < 1e-6) continue; if (loud) { on[0] += a; on[1]++; vs += Math.sqrt(ve / w); nv++; } else { off[0] += a; off[1]++; } }
    return { secs: +(vb.length / v.sr).toFixed(2), voiced: +(nv * 0.1).toFixed(1), songWhileSpeaking: +(on[0] / Math.max(1, on[1])).toFixed(2), songInPauses: +(off[0] / Math.max(1, off[1])).toFixed(2) }; });
  console.log('voiceover:', JSON.stringify(m));
  await p.check('#caps'); await p.waitForFunction(() => /words found|No words|not available/.test(document.getElementById('capstat').textContent), null, { timeout: 60000 });
  console.log('captions: sent', cap && cap.toFixed(2), 's of the voice');
  // export: the voice is in the video's sound (correlated with the recording)
  await p.evaluate(() => { window.__dl = null; const ck = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__dl = this.href; return; } return ck.call(this); }; });
  await p.click('#export'); await p.waitForFunction(() => /saved|ready:/i.test(document.getElementById('xmsg').textContent), null, { timeout: 1500000 });
  const corr = await p.evaluate(async () => { const s = document.querySelector('.brs').__studio, ab = await new AudioContext({ sampleRate: s.audio.sampleRate }).decodeAudioData(await (await (await fetch(window.__dl)).blob()).arrayBuffer());
    // the export's sound against the Reel's own mix (song + voice), to the sample; and how much of it the voice explains
    const x = ab.getChannelData(0), m = s.audio.getChannelData(0), B = s.base, v = s.vo, sr = ab.sampleRate, a0 = Math.round(1.0 * sr), n = Math.round(6 * sr);
    let best = 0, lag = 0; for (let d = -2000; d <= 2000; d++) { let xy = 0, xx = 0, yy = 0; for (let i = a0; i < a0 + n; i += 7) { const y = m[i - d] || 0; xy += x[i] * y; xx += x[i] * x[i]; yy += y * y; } const c = xy / Math.sqrt(xx * yy + 1e-12); if (c > best) { best = c; lag = d; } }
    let e = 0, ev = 0; const g = 1; for (let i = 0; i < Math.min(m.length, x.length - lag); i += 3) { const y = x[i + lag]; e += y * y; } let mv = 0, mm = 0; for (let i = 0; i < m.length; i += 3) { mm += m[i] * m[i]; const songOnly = B.buf.getChannelData(0)[i] * B.norm; mv += (m[i] - songOnly) * (m[i] - songOnly); }
    return { corr: +best.toFixed(3), lagMs: +(lag / sr * 1000).toFixed(1), voiceShareOfMix: +(mv / mm).toFixed(2) }; });
  console.log('export vs the Reel\'s mix: correlation', corr.corr, 'at', corr.lagMs, 'ms | the voice (and the step-back) is', Math.round(corr.voiceShareOfMix * 100) + '% of the mix energy');
  // saved and opened again
  await p.waitForTimeout(4000); const h = await p.evaluate(() => { const v = document.querySelector('.brs').__studio.vo; let s = 0; for (let i = 0; i < v.pcm.length; i += 101) s += Math.abs(v.pcm[i]); return v.pcm.length + ':' + s.toFixed(3); });
  await p.goto(BASE + '/studio?view=all'); await p.waitForSelector('#plist .proj', { timeout: 30000 }); await p.click('#plist .proj .popen'); await p.waitForURL(/\?p=/);
  await p.waitForFunction(() => document.querySelector('.brs') && document.querySelector('.brs').__studio && /Opened|Could not|no longer/.test(document.getElementById('psaved').textContent), null, { timeout: 600000 });
  const h2 = await p.evaluate(() => { const v = document.querySelector('.brs').__studio.vo; if (!v) return null; let s = 0; for (let i = 0; i < v.pcm.length; i += 101) s += Math.abs(v.pcm[i]); return v.pcm.length + ':' + s.toFixed(3); });
  console.log('saved and opened again: same voiceover', h === h2, '|', await p.textContent('#vostat'));
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
