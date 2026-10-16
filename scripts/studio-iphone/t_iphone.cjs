/* eslint-disable @typescript-eslint/no-require-imports */
// The studio the way an iPhone uses it: Safari's engine with iPhone's media rules (videos load only their metadata until
// played, sound needs a tap, inline playback needs playsinline), iPhone files (HEVC 10-bit .MOV rotated, H.264 .MOV,
// AAC/ALAC .m4a, a video as the music), then a preview and an export, checked by reading the exported file back.
const { start } = require(process.env.ENGINE === 'chromium' ? './pw.cjs' : './wd.cjs');
const M = process.env.MEDIA || (__dirname + '/media/');
const MUSIC = (process.env.MUSIC || 'music_video.MOV').split(',');
const VIDS = (process.env.VIDS || 'clipA_hevc10_rot.MOV,clipB_h264_rot.MOV,clipC_hevc8.mp4').split(',');
(async () => {
  const b = await start();
  try {
    await b.go('http://localhost:3100/studio');
    await b.waitFor(() => document.querySelector('.brs') && document.querySelector('.brs').__studio, 90000);
    if (process.env.EMU_IOS_AUDIO) await b.js(() => { window.__emuIosAudio = true; });
    await b.js(() => { window.__errs = []; window.addEventListener('error', e => __errs.push(String(e.message))); window.addEventListener('unhandledrejection', e => __errs.push('rej ' + String(e.reason && e.reason.message || e.reason)));
      const w = console.warn.bind(console); console.warn = (...a) => { __errs.push('warn ' + a.map(String).join(' ').slice(0, 200)); w(...a); };
      if (window.__emuIosAudio) { const d0 = AudioContext.prototype.decodeAudioData; AudioContext.prototype.decodeAudioData = function (ab, ...r) {   // like iPhone Safari: no QuickTime .MOV sound
          const u = new Uint8Array(ab, 4, 8), brand = String.fromCharCode(...u); if (/^ftypqt/.test(brand)) { window.__movRejected = (window.__movRejected || 0) + 1; return Promise.reject(new DOMException('Decoding failed', 'EncodingError')); } return d0.call(this, ab, ...r); }; }
      window.__dl = null; const ck = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__dl = { href: this.href, name: this.download }; return; } return ck.call(this); }; });
    console.log('APIs:', JSON.stringify(await b.js(() => ({ AudioEncoder: !!window.AudioEncoder, AudioDecoder: !!window.AudioDecoder, share: !!(navigator.canShare) }))));
    for (const f of MUSIC) {
      await b.js(() => { document.getElementById('s1st').textContent = '…'; document.getElementById('mdur').textContent = '—'; });
      const t0 = Date.now(); await b.upload('#mfile', M + f);
      const st = await b.waitFor((f) => { const t = document.getElementById('s1st').textContent; return document.getElementById('mname').textContent === f && (/Could not|cannot/i.test(t) || (/^Ready/.test(t) && document.getElementById('mdur').textContent !== '—')) && t; }, 120000, f).catch(e => 'TIMEOUT');
      console.log('music', f.padEnd(16), '→', st.slice(0, 90), '|', ((Date.now() - t0) / 1000).toFixed(1) + ' s | bpm', await b.js(() => document.getElementById('mbpm').textContent), '| dur', await b.js(() => document.getElementById('mdur').textContent));
    }
    if (process.env.EMU_IOS_AUDIO) console.log('MOV sound refused by decodeAudioData (as on iPhone):', await b.js(() => window.__movRejected || 0), 'times');
    const t1 = Date.now();
    await b.upload('#vfile', VIDS.map(v => M + v));
    await b.waitFor(() => document.getElementById('qinfo').textContent === '' && document.getElementById('clips').children.length > 0, 400000).catch(() => console.log('videos: TIMEOUT'));
    const cards = await b.js(() => [...document.querySelectorAll('#clips .clip')].map(c => c.querySelector('.nm').textContent + ': ' + c.querySelector('.dd').textContent));
    console.log('videos (' + ((Date.now() - t1) / 1000).toFixed(0) + ' s):\n  ' + cards.join('\n  '));
    const S = await b.js(() => { const s = document.querySelector('.brs').__studio; return s.sources.map(x => ({ n: x.name, w: x.w, h: x.h, dur: +x.dur.toFixed(2), samples: x.samples.length, lastT: +x.samples[x.samples.length - 1].t.toFixed(2), scenes: (x.scenes || []).length, faces: (x.faces || []).length })); });
    console.log('read:', JSON.stringify(S));
    if (process.env.SCENES) { const T = require(__dirname + '/../studio-style/out/truth.json');
      const sc = await b.js(() => document.querySelector('.brs').__studio.sources.map(x => (x.scenes || []).map(c => +((c.t0 + c.t1) / 2).toFixed(3))));
      const pairs = { 'clipA_hevc10_rot.MOV': ['fast_flash', 12], 'clipC_hevc8.mp4': ['whip_zoom', 10], 'clipB_h264_rot.MOV': ['calm_dissolve', 12] };
      S.forEach((x, i) => { const p = pairs[x.n]; if (!p) return; const truth = T[p[0]].cuts.filter(c => c < p[1] - 0.1);
        const hit = truth.filter(c => sc[i].some(d => Math.abs(d - c) <= 0.07)).length, extra = sc[i].filter(d => !truth.some(c => Math.abs(d - c) <= 0.07)).length;
        console.log('scenes', x.n, ': found', hit + '/' + truth.length, 'cuts of the footage within 2 frames, extra', extra); }); }
    if (!S.length) return;
    await b.waitFor(() => !document.getElementById('play').disabled, 60000);
    console.log('edit shots:', await b.js(() => document.querySelector('.brs').__studio.edit.length));
    // a frame of the edit: not black
    const lum = await b.ajs(async () => { const s = document.querySelector('.brs').__studio; await s.frameAt(3); const o = document.getElementById('out'); const g = o.getContext('2d'); let d; try { d = g ? g.getImageData(0, 0, o.width, o.height).data : null; } catch (e) { d = null; }
      if (!d) { const c = document.createElement('canvas'); c.width = 90; c.height = 160; c.getContext('2d').drawImage(o, 0, 0, 90, 160); d = c.getContext('2d').getImageData(0, 0, 90, 160).data; }
      let m = 0; for (let i = 0; i < d.length; i += 4) m += d[i] + d[i + 1] + d[i + 2]; return +(m / (d.length / 4) / 765).toFixed(3); });
    console.log('preview frame at 3 s: mean brightness', lum);
    if (process.env.NOEXPORT) return;
    const t2 = Date.now();
    await b.js(() => document.getElementById('export').click());
    const msg = await b.waitFor(() => { const m = document.getElementById('xmsg'); return /saved|ready:|cannot|failed/i.test(m.textContent) && !/Recording in real time/.test(m.textContent) && m.textContent; }, 600000).catch(() => 'TIMEOUT');
    console.log('export (' + ((Date.now() - t2) / 1000).toFixed(0) + ' s):', msg);
    const chk = await b.ajs(async () => { const d = window.__dl; if (!d) return null; const blob = await (await fetch(d.href)).blob(); const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.src = d.href;
      await new Promise((r, j) => { v.onloadedmetadata = r; v.onerror = () => j(new Error('cannot play the export')); setTimeout(() => j(new Error('timeout')), 15000); }).catch(e => null);
      const dec = new TextDecoder('latin1'), txt = dec.decode(await blob.slice(0, 400000).arrayBuffer()) + dec.decode(await blob.slice(Math.max(0, blob.size - 400000)).arrayBuffer());
      const codecs = ['avc1', 'hvc1', 'mp4a', 'Opus', 'vp09'].filter(c => txt.includes(c));
      let rms = null; try { const ab = await new AudioContext().decodeAudioData(await blob.arrayBuffer()); const x = ab.getChannelData(0); let q = 0; for (let i = 0; i < x.length; i += 7) q += x[i] * x[i]; rms = +Math.sqrt(q / (x.length / 7)).toFixed(3); } catch (e) { rms = 'not decodable: ' + e.message; }
      const lum = []; const c = document.createElement('canvas'); c.width = 54; c.height = 96; const g = c.getContext('2d');
      for (const t of [1, 5, 9, 13, 16]) { if (t > v.duration) break; v.currentTime = t; await new Promise(r => { v.onseeked = r; setTimeout(r, 3000); }); g.drawImage(v, 0, 0, 54, 96); const px = g.getImageData(0, 0, 54, 96).data; let m = 0; for (let i = 0; i < px.length; i += 4) m += px[i] + px[i + 1] + px[i + 2]; lum.push(+(m / (px.length / 4) / 765).toFixed(2)); }
      return { name: d.name, type: blob.type, mb: +(blob.size / 1e6).toFixed(1), dur: v.duration, w: v.videoWidth, h: v.videoHeight, codecs, soundRms: rms, frameBrightness: lum }; });
    console.log('exported file:', JSON.stringify(chk));
    if (chk) { const parts = []; for (let k = 0; ; k++) { const b64 = await b.ajs(async (k) => { const blob = await (await fetch(window.__dl.href)).blob(); const sl = blob.slice(k * 2e6, (k + 1) * 2e6); if (!sl.size) return '';
        const u = new Uint8Array(await sl.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192)); return btoa(s); }, k); if (!b64) break; parts.push(Buffer.from(b64, 'base64')); }
      require('fs').writeFileSync(__dirname + '/export_' + (process.env.ENGINE || 'webkit') + '.' + chk.name.split('.').pop(), Buffer.concat(parts)); }
  } finally {
    console.log('page errors:', JSON.stringify(await b.js(() => window.__errs).catch(() => 'n/a')));
    await b.quit();
  }
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
