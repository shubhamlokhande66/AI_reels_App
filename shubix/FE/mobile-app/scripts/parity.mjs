// Are the phone's two exports the same Reel? Compares the engine page's MP4 with the native engine's, frame by frame.
//   node scripts/parity.mjs                 the newest pair the test APK saved on the connected phone (parity-*.mp4)
//   node scripts/parity.mjs a.mp4 b.mp4     two files on this computer
//   --min=0.80                              the lowest average likeness that passes (SSIM, 1 = the same picture)
// Needs ffmpeg and, for the phone, adb. The test APK saves the pair after each export of a Studio Reel.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2), files = args.filter((a) => !a.startsWith("--"));
const min = Number(args.find((a) => a.startsWith("--min="))?.slice(6) ?? 0.8);
const run = (cmd, list) => execFileSync(cmd, list, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "pipe"] });
const adb = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Android", "Sdk", "platform-tools", "adb.exe") : "adb";
const dir = mkdtempSync(join(tmpdir(), "parity-"));

function fromPhone() {
  const found = run(adb, ["shell", "find /sdcard/DCIM /sdcard/Movies /sdcard/Pictures -name 'parity-*.mp4' -printf '%T@ %p\\n' 2>/dev/null"]).trim().split(/\r?\n/).filter(Boolean)
    .map((l) => { const i = l.indexOf(" "); return { at: Number(l.slice(0, i)), path: l.slice(i + 1) }; }).sort((a, b) => b.at - a.at);
  const newest = (kind) => found.find((f) => f.path.includes(`parity-${kind}-`));
  const a = newest("engine"), b = newest("native");
  if (!a || !b) throw new Error("No parity-engine / parity-native pair on the phone: export a Studio Reel from the test APK first.");
  return [a, b].map((f, i) => { const to = join(dir, `${i}.mp4`); run(adb, ["pull", f.path, to]); console.log("from the phone:", f.path); return to; });
}
const length = (f) => Number(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).trim());

const [a, b] = files.length === 2 ? files : fromPhone();
const la = length(a), lb = length(b), stats = join(dir, "ssim.txt").replace(/\\/g, "/").replace(/^([A-Za-z]):/, "$1\\:");
// the same size and the same 5 frames a second from both: only the pictures are compared
const size = "scale=360:640:force_original_aspect_ratio=decrease,pad=360:640:(ow-iw)/2:(oh-ih)/2,fps=5,format=yuv420p";
execFileSync("ffmpeg", ["-v", "error", "-i", a, "-i", b, "-lavfi", `[0:v]${size}[x];[1:v]${size}[y];[x][y]ssim=stats_file='${stats}'`, "-f", "null", "-"], { stdio: ["ignore", "ignore", "inherit"] });
const frames = readFileSync(join(dir, "ssim.txt"), "utf8").trim().split(/\r?\n/).map((l, i) => ({ t: i / 5, v: Number(/All:([\d.]+)/.exec(l)?.[1] ?? 0) }));
if (!frames.length) throw new Error("No frames were compared.");
const mean = frames.reduce((s, f) => s + f.v, 0) / frames.length, worst = [...frames].sort((x, y) => x.v - y.v).slice(0, 5);
console.log(`length: ${la.toFixed(2)} s and ${lb.toFixed(2)} s`);
console.log(`likeness: ${mean.toFixed(3)} on average (${frames.length} frames)`);
console.log("least alike:", worst.map((f) => `${f.t.toFixed(1)} s ${f.v.toFixed(3)}`).join(", "));
const ok = mean >= min && Math.abs(la - lb) <= 0.25;
console.log(ok ? "PASS" : `FAIL (needs ${min} on average and lengths within 0.25 s)`);
process.exit(ok ? 0 : 1);
