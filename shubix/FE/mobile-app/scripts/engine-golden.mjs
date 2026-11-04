// Does the engine still make the same Reel? Runs the built engine page (engine/build.mjs) in headless Chrome with a fixed
// song and clips, and compares its edit with tests/golden/edit.json. Run after every move of the engine's code.
//   node scripts/engine-golden.mjs            compare
//   node scripts/engine-golden.mjs --update   write the file (only when the edit was changed on purpose)
// Needs ffmpeg and Chrome. Nothing reaches the internet: /api answers 404, so the phone's own edit is what is compared.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)), app = join(here, "..");
const site = join(app, "modules", "shubix-video", "android", "src", "main", "assets", "engine"), golden = join(app, "tests", "golden", "edit.json");
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
const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".webp": "image/webp", ".html": "text/html" };
const server = createServer((q, r) => {
  const path = new URL(q.url, "http://x").pathname;
  if (path.startsWith("/api/")) { r.writeHead(404, { "Content-Type": "application/json" }); return r.end("{}"); }
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
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id) { open.get(d.id)?.(d); open.delete(d.id); } else if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text); };
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
  const quiet = `(()=>{const w=document.querySelector("#studio").__studio.work;return w.songReady&&!w.pending&&w.shots>0&&!w.ai&&!w.dir&&!w.pace&&!w.beats?w.shots:0})()`;
  let still = 0, last = 0;
  for (let i = 0; i < 960 && still < 12; i++) { await wait(250); const n = await run(quiet); still = n && n === last ? still + 1 : 0; last = n; }
  const read = await run(`JSON.stringify(document.querySelector("#studio").__studio.state().edit)`);
  if (!read) throw new Error("The engine gave no edit.");
  if (errors.length) throw new Error("The engine threw:\n" + [...new Set(errors)].join("\n"));
  const round = (k, v) => (typeof v === "number" ? +v.toFixed(3) : v);
  const edit = JSON.stringify(JSON.parse(read), round, 1);
  if (process.argv.includes("--update")) { mkdirSync(dirname(golden), { recursive: true }); writeFileSync(golden, edit + "\n"); console.log(`Written: ${JSON.parse(edit).length} shots`); code = 0; }
  else {
    const want = readFileSync(golden, "utf8").trim();
    if (want === edit) { console.log(`SAME Reel: ${JSON.parse(edit).length} shots`); code = 0; }
    else { const a = want.split("\n"), b = edit.split("\n"), at = a.findIndex((l, i) => l !== b[i]); console.log(`DIFFERENT at line ${at + 1}:\n  was ${a[at]}\n  now ${b[at]}`); }
  }
  ws.close();
} catch (e) { console.error(e.message); }
finally { browser.kill(); server.close(); await wait(300); try { rmSync(work, { recursive: true, force: true }); } catch {} }
process.exit(code);
