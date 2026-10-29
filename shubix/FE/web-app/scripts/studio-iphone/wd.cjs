/* eslint-disable @typescript-eslint/no-require-imports */
// Minimal W3C WebDriver client for WebKitGTK's MiniBrowser (Safari's engine), used to test the studio like an iPhone would.
const PORT = 4444, BASE = `http://127.0.0.1:${PORT}`;
async function call(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json(); if (j.value && j.value.error) throw new Error(j.value.error + ': ' + j.value.message); return j.value;
}
async function start() {
  const drv = { kill() {} };   // the driver runs under xvfb-run, started outside
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/status'); break; } catch { await new Promise(r => setTimeout(r, 200)); } }
  const s = await call('POST', '/session', { capabilities: { alwaysMatch: { 'webkitgtk:browserOptions': {
    binary: '/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser', args: ['--automation'].concat(process.env.WK_FEATURES ? ['--features=' + process.env.WK_FEATURES] : []) } } } });
  const id = s.sessionId, P = `/session/${id}`;
  await call('POST', P + '/timeouts', { script: 600000, pageLoad: 120000 });
  const api = {
    id, drv,
    go: (url) => call('POST', P + '/url', { url }),
    js: (fn, ...args) => call('POST', P + '/execute/sync', { script: `return (${fn}).apply(null, arguments)`, args }),
    ajs: (fn, ...args) => call('POST', P + '/execute/async', { script: `const done = arguments[arguments.length-1]; Promise.resolve((${fn}).apply(null, Array.prototype.slice.call(arguments, 0, -1))).then(done, e => done({__err: String(e && e.stack || e)}))`, args }),
    upload: async (sel, files) => { const el = await call('POST', P + '/element', { using: 'css selector', value: sel });
      const eid = Object.values(el)[0]; await call('POST', P + `/element/${eid}/value`, { text: [].concat(files).join('\n') }); },
    waitFor: async (fn, ms = 120000, ...args) => { const t0 = Date.now(); for (;;) { const v = await api.js(fn, ...args); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout waiting: ' + fn); await new Promise(r => setTimeout(r, 400)); } },
    shot: async (file) => { const b64 = await call('GET', P + '/screenshot'); require('fs').writeFileSync(file, Buffer.from(b64, 'base64')); },
    quit: async () => { try { await call('DELETE', P); } catch {} drv.kill(); },
  };
  return api;
}
module.exports = { start };
