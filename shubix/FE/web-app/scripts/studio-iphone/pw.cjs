/* eslint-disable @typescript-eslint/no-require-imports */
// Same interface as wd.cjs, in Chromium (Playwright), so one test runs in both engines.
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
async function start() {
  const br = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await br.newContext({ viewport: { width: 1300, height: 1000 } })).newPage();
  const wrap = (fn) => `(${fn})`;
  const api = {
    go: (u) => p.goto(u),
    js: (fn, ...args) => p.evaluate(([src, a]) => eval(src).apply(null, a), [wrap(fn), args]),
    ajs: (fn, ...args) => p.evaluate(([src, a]) => Promise.resolve(eval(src).apply(null, a)), [wrap(fn), args]),
    upload: async (sel, files) => p.setInputFiles(sel, [].concat(files)),
    waitFor: async (fn, ms = 120000, ...args) => { const t0 = Date.now(); for (;;) { const v = await api.js(fn, ...args); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 400)); } },
    quit: () => br.close(),
  };
  return api;
}
module.exports = { start };
