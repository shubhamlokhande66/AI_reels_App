// Runs a command and keeps its output in logs/<name>.log (everything) and logs/<name>.err.log (errors only), each
// line timestamped, while still printing it. The previous run is kept as <name>.prev.log / <name>.prev.err.log.
//   node scripts/with-log.mjs api pnpm --filter @shubix/api dev
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const [name, ...cmd] = process.argv.slice(2);
if (!name || !cmd.length) { console.error("usage: node scripts/with-log.mjs <name> <command...>"); process.exit(2); }

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "logs");
fs.mkdirSync(dir, { recursive: true });
const open = (file) => {
  const p = path.join(dir, file);
  if (fs.existsSync(p)) fs.renameSync(p, p.replace(/\.log$/, ".prev.log").replace(".err.prev.log", ".prev.err.log"));
  return fs.createWriteStream(p, { flags: "a" });
};
const all = open(`${name}.log`), err = open(`${name}.err.log`);
// colours are for the terminal; the files get plain text
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const stamp = () => new Date().toISOString();
function pipe(stream, out, isErr) {
  let rest = "";
  stream.on("data", (chunk) => {
    out.write(chunk);
    const lines = (rest + chunk.toString()).split(/\r?\n/);
    rest = lines.pop() ?? "";
    for (const l of lines) { const line = `${stamp()} ${plain(l)}\n`; all.write(line); if (isErr) err.write(line); }
  });
}
all.write(`${stamp()} ---- start: ${cmd.join(" ")}\n`);
const line = cmd.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ");
const child = spawn(line, { shell: true, env: { ...process.env, FORCE_COLOR: "1" } });
pipe(child.stdout, process.stdout, false);
pipe(child.stderr, process.stderr, true);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => { all.write(`${stamp()} ---- exit ${code}\n`); all.end(); err.end(); process.exitCode = code ?? 1; });
