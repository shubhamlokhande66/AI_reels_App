// Do the phone's AI models (Models.kt, ONNX Runtime for Android) answer as the engine page's WebAssembly copies do?
//   node scripts/models-check.mjs [voice]                  on the connected phone, with the app open
//   node scripts/models-check.mjs --page=URL --port=P [voice]  a page in a Chrome listening on debug port P (a test on a computer)
// Voice: a voice's name such as en_US-hfc_female-medium; about 60 MB is downloaded the first time.
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const args = process.argv.slice(2), flag = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
const voice = args.find((a) => !a.startsWith("--")), PORT = flag("port") ?? "9333";
if (!flag("port")) {
  const adb = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Android", "Sdk", "platform-tools", "adb.exe") : "adb";
  const run = (...a) => execFileSync(adb, a, { encoding: "utf8" }).trim();
  const pid = run("shell", "pidof app.shubix || pidof com.shubix.app || pidof -s $(pm list packages shubix | head -1 | cut -d: -f2)");
  if (!pid) throw new Error("Open the app on the phone first.");
  run("forward", `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid.split(" ")[0]}`);
}
const tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const tab = tabs.find((t) => (flag("page") ? t.url.startsWith(flag("page")) : t.url.includes("/engine")));
if (!tab) throw new Error("The engine page is not open.");
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
const calls = new Map(); let next = 1;
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id) { calls.get(m.id)?.(m); calls.delete(m.id); } };
const send = (method, params) => new Promise((ok) => { const id = next++; calls.set(id, ok); ws.send(JSON.stringify({ id, method, params })); });
const r = await send("Runtime.evaluate", { awaitPromise: true, returnByValue: true, timeout: 590000, expression: `modelCheck(${voice ? JSON.stringify(voice) : ""})` });
ws.close();
if (r.result?.exceptionDetails) { console.error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text); process.exit(1); }
const out = r.result.result.value;
for (const r of out.rows) console.log(r.model.padEnd(34), String(r.diff).padEnd(24), `native ${r.nativeMs} ms`.padEnd(18), `wasm ${r.wasmMs} ms`.padEnd(15), r.note ?? "");
console.log(out.ok ? "PASS: the phone's models answer as the page's do" : "FAIL");
process.exit(out.ok ? 0 : 1);
