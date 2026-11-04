// Does the engine still make the same Reel? Runs the built engine page (engine/build.mjs) in headless Chrome with a fixed
// song and clips, and compares its edit with tests/golden/edit.json. Run after every move of the engine's code.
//   node scripts/engine-golden.mjs            compare
//   node scripts/engine-golden.mjs --update   write the file (only when the edit was changed on purpose)
//   node scripts/engine-golden.mjs --ai       the same with a fake Shubix AI server: its plan, texts and steps must come out the same (tests/golden/edit-ai.json)
// Needs ffmpeg and Chrome. Nothing reaches the internet: /api answers 404, so the phone's own edit is what is compared.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)), app = join(here, "..");
const site = join(app, "modules", "shubix-video", "android", "src", "main", "assets", "engine"), AI = process.argv.includes("--ai"), golden = join(app, "tests", "golden", AI ? "edit-ai.json" : "edit.json");
if (!existsSync(join(site, "index.html"))) throw new Error("Build the engine first: node engine/build.mjs");
const work = mkdtempSync(join(tmpdir(), "golden-"));
const ff = (...a) => execFileSync("ffmpeg", ["-v", "error", "-y", ...a], { stdio: ["ignore", "ignore", "inherit"] });
// a song with a steady beat, and four clips that move differently
const song = join(work, "song.wav");
ff("-f", "lavfi", "-i", "aevalsrc='0.8*sin(2*PI*60*t)*exp(-12*mod(t,0.5))+0.15*sin(2*PI*440*t)':d=20:s=44100", song);
const clips = [["testsrc=s=360x640:r=30", 5], ["testsrc2=s=360x640:r=30", 4], ["smptebars=s=360x640:r=30", 3], ["life=s=360x640:r=30:seed=7:mold=10:ratio=0.2:death_color=#102030:life_color=#e0a040", 6]].map(([src, d], i) => {
  const f = join(work, `clip${i + 1}.mp4`);
  ff("-f", "lavfi", "-t", String(d), "-i", src, "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "ultrafast", f);
  return f;
});
const aiCalls = [];
const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".webp": "image/webp", ".html": "text/html" };
const server = createServer((q, r) => {
  const path = new URL(q.url, "http://x").pathname;
  if (path.startsWith("/api/")) {
    const json = (o, status = 200) => { r.writeHead(status, { "Content-Type": "application/json" }); r.end(JSON.stringify(o)); };
    if (!AI) return json({}, 404);
    if (q.method === "GET") return path === "/api/studio/rank-shots" ? json({ available: true, planAi: true, balance: 100, costs: { reel: 0, small: 0, big: 0, mix: 0 } }) : json({}, 404);
    let body = ""; q.on("data", (c) => (body += c)); q.on("end", () => {
      const d = JSON.parse(body || "{}");
      aiCalls.push(path);
      if (path === "/api/studio/rank-shots") return json({ charged: 0, balance: 100, clips: d.clips.map((c, i) => ({ id: c.id, summary: "clip " + (i + 1), mood: "calm", frames: c.frames.map((f, k) => ({ t: f.t, score: 0.5 + ((k % 5) / 10), roles: ["action"], tags: ["street"], issues: [], person: false, subject: null, note: "moment" })) })) });
      if (path === "/api/studio/pace") return json({ story: "steady", sections: d.sections.map((s) => ({ i: s.i, every: 2, why: "even" })) });
      if (path === "/api/studio/direct") return json({ balance: 100, story: "the fake plan", texts: [{ text: "Hello from the plan", at: 1, dur: 2, style: "pop", place: "middle" }], actions: [{ do: "captions", on: false }],
        slots: d.slots.map((s, n) => ({ i: s.i, shot: s.candidates[0].id, transition: n % 2 ? "dissolve" : "hard", effect: n % 3 ? "punch" : "none", speed: "normal", keys: n % 2 ? [] : [{ at: 0.3, do: "punch" }], move: [], clip: {}, why: "fake" })) });
      json({}, 404);
    });
    return;
  }
  const f = path === "/engine" ? "index.html" : path.slice(1);
  try { const b = readFileSync(join(site, f)); r.writeHead(200, { "Content-Type": TYPES[extname(f)] || "application/octet-stream" }); r.end(b); } catch { r.writeHead(404); r.end(); }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const port = server.address().port, debug = port + 1;
const chrome = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome"].find((p) => p && existsSync(p));
const browser = spawn(chrome, ["--headless=new", "--enable-unsafe-swiftshader", "--no-first-run", "--autoplay-policy=no-user-gesture-required", `--remote-debugging-port=${debug}`, `--user-data-dir=${join(work, "profile")}`, "about:blank"], { stdio: "ignore" });
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
let code = 1;
try {
  let tabs = null;
  for (let i = 0; i < 40 && !tabs; i++) { await wait(250); tabs = await fetch(`http://127.0.0.1:${debug}/json`).then((r) => r.json()).catch(() => null); }
  const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((ok) => (ws.onopen = ok));
  let id = 0; const open = new Map(), errors = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id) { open.get(d.id)?.(d); open.delete(d.id); } else if (d.method === "Runtime.consoleAPICalled" && AI && ["warning", "error"].includes(d.params.type)) console.log("page:", d.params.args.map((x) => x.description || x.value).join(" ").slice(0, 300)); else if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text); };
  const send = (method, params = {}) => new Promise((ok) => { const n = ++id; open.set(n, ok); ws.send(JSON.stringify({ id: n, method, params })); });
  const run = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
  await send("Runtime.enable"); await send("DOM.enable"); await send("Page.enable");
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/engine` });
  for (let i = 0; i < 80 && !(await run(`!!document.querySelector("#studio")?.__studio`)); i++) await wait(250);
  const put = async (selector, files) => {
    const { result: { root } } = await send("DOM.getDocument");
    const { result: { nodeId } } = await send("DOM.querySelector", { nodeId: root.nodeId, selector });
    await send("DOM.setFileInputFiles", { nodeId, files });
  };
  await put("#mfile", [song]);
  for (let i = 0; i < 240 && !(await run(`document.querySelector("#studio").__studio.work.songReady`)); i++) await wait(250);
  await put("#vfile", clips);
  // the studio's question (Shubix AI will edit this Reel) is answered Use, as the phone's person does
  const quiet = `(()=>{const r=document.querySelector("#studio"),c=r.querySelector("#cconf");if(c&&!c.hidden)r.querySelector("#cconfok").click();const w=r.__studio.work;return w.songReady&&!w.pending&&w.shots>0&&!w.ai&&!w.dir&&!w.pace&&!w.beats&&!w.aiWait?w.shots:0})()`;
  let still = 0, last = 0;
  for (let i = 0; i < 960 && still < (AI ? 24 : 12); i++) { await wait(250); const n = await run(quiet); still = n && n === last ? still + 1 : 0; last = n; }
  const read = await run(AI ? `(()=>{const r=document.querySelector("#studio"),s=r.__studio,st=s.state();return JSON.stringify({edit:st.edit,overlays:(st.overlays||[]).map(o=>[o.text,o.start,o.end,o.style]),status:r.querySelector("#aistat").textContent,clips:s.sources.map(c=>c.ai&&c.ai.summary)})})()` : `JSON.stringify(document.querySelector("#studio").__studio.state().edit)`);
  if (!read) throw new Error("The engine gave no edit.");
  if (errors.length) throw new Error("The engine threw:\n" + [...new Set(errors)].join("\n"));
  const round = (k, v) => (typeof v === "number" ? +v.toFixed(3) : v);
  if (AI) console.log("calls to the fake AI:", [...new Set(aiCalls)].join(" ") || "none");
  // the same Reel made again with no browser: the engine's state taken just before it makes it, then the brain alone in Node
  if (!AI) {
  const snapshot = await run(`(()=>{const seen=new WeakSet(),{ES,HOOKS,makeEditNow}=document.querySelector("#studio").__studio.brainDebug,speedKey=HOOKS.core.speedKey;
    const dump=(k,v)=>{if(k==="sp"&&v&&typeof v.pos==="function")return{__sp:speedKey(v)};if(typeof v==="function"||(typeof Node!=="undefined"&&v instanceof Node)||v instanceof HTMLElement||v instanceof CanvasRenderingContext2D)return undefined;
      if(ArrayBuffer.isView(v))return{__t:v.constructor.name,v:Array.from(v)};
      if(v instanceof AudioBuffer)return{__t:"AudioBuffer",duration:v.duration,length:v.length,sampleRate:v.sampleRate,numberOfChannels:v.numberOfChannels};
      if(v instanceof Map)return{__t:"Map",v:[...v]};if(v instanceof Set)return{__t:"Set",v:[...v]};
      if(v&&typeof v==="object"){if(seen.has(v))return undefined;seen.add(v);}return v;};
    const consts={};for(const g of Object.values(HOOKS))for(const k of Object.keys(g)){try{const v=g[k];if(typeof v!=="function"&&v!==undefined)consts[k]=v;}catch(e){}}
    const before=JSON.stringify({ES,consts},dump);makeEditNow();return JSON.stringify({before,after:ES.edit.map(e=>[e.start,e.end,e.src,e.in,e.tr,e.efx])});})()`);
  const { before, after } = JSON.parse(snapshot);
  const { build } = await import("esbuild");
  const entry = join(work, "brain-entry.ts"), bundle = join(work, "brain.mjs");
  writeFileSync(entry, ["edit", "core", "reel", "shared"].map((n) => `export * from ${JSON.stringify(join(app, "engine", "brain", n + ".ts").replace(/\\/g, "/"))};`).join("\n"));
  await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "node", outfile: bundle, logLevel: "error", absWorkingDir: app, nodePaths: [join(app, "node_modules")], tsconfigRaw: { compilerOptions: { baseUrl: join(app, "engine"), paths: { "@/*": ["./*"] } } } });
  const brainModule = await import("file:///" + bundle.replace(/\\/g, "/"));
  const revive = (k, v) => { if (v && v.__t === "Map") return new Map(v.v); if (v && v.__t === "Set") return new Set(v.v); if (v && v.__t === "AudioBuffer") return v; if (v && v.__t) return new globalThis[v.__t](v.v); return v; };
  const { ES: ES2, consts } = JSON.parse(before, revive), called = new Map(), parts = {};
  const EH2 = new Proxy({}, { get: (_, n) => { for (const p of Object.values(parts)) if (p[n] !== undefined) return p[n]; if (n in consts) return consts[n]; return (...a) => { called.set(n, (called.get(n) || 0) + 1); return undefined; }; } });
  Object.assign(parts, { shared: brainModule.createSharedBrain(ES2, EH2), edit: brainModule.createEditBrain(ES2, EH2), core: brainModule.createCoreBrain(ES2, EH2), reel: brainModule.createReelBrain(ES2, EH2) });
  // a shot's speed is a function, and JSON keeps only its name: the brain's own speedFor makes it again
  const speeds = (o, seenAgain = new Set()) => { if (!o || typeof o !== "object" || seenAgain.has(o)) return; seenAgain.add(o); if (o.sp && o.sp.__sp !== undefined) o.sp = parts.edit.speedFor(o.sp.__sp, o); for (const v of Array.isArray(o) ? o : Object.values(o)) speeds(v, seenAgain); };
  speeds(ES2);
  let headless = "";
  try { parts.reel.makeEditNow(); headless = JSON.stringify(ES2.edit.map((e) => [e.start, e.end, e.src, e.in, e.tr, e.efx]), round); } catch (e) { console.log("NO BROWSER: threw:", e.stack?.split("\n").slice(0, 3).join(" | ")); }
  console.log("page hooks it called:", [...called].map(([n, c]) => n + "×" + c).join(" ") || "none");
  const browserMade = JSON.stringify(after, round);
  if (headless === browserMade) console.log(`NO BROWSER: same Reel, ${after.length} shots`);
  else { console.log("NO BROWSER: different"); console.log("  browser", browserMade.slice(0, 260)); console.log("  node   ", headless.slice(0, 260)); errors.push("The brain alone made a different Reel."); }
  }
  const edit = JSON.stringify(JSON.parse(read), round, 1);
  if (process.argv.includes("--update")) { mkdirSync(dirname(golden), { recursive: true }); writeFileSync(golden, edit + "\n"); console.log(`Written: ${(AI ? JSON.parse(edit).edit : JSON.parse(edit)).length} shots`); code = 0; }
  else {
    const want = readFileSync(golden, "utf8").trim();
    if (want === edit) { console.log(`SAME Reel: ${(AI ? JSON.parse(edit).edit : JSON.parse(edit)).length} shots`); code = 0; }
    else { const a = want.split("\n"), b = edit.split("\n"), at = a.findIndex((l, i) => l !== b[i]); console.log(`DIFFERENT at line ${at + 1}:\n  was ${a[at]}\n  now ${b[at]}`); }
  }
  ws.close();
} catch (e) { console.error(e.message); }
finally { browser.kill(); server.close(); await wait(300); try { rmSync(work, { recursive: true, force: true }); } catch {} }
process.exit(code);
