// Builds the phone's hidden engine page (engine/) into the APK's assets (modules/shubix-video/android/src/main/assets/engine),
// where FileServer.kt serves it from. Run before every Android build: pnpm --filter @shubix/mobile-app engine:build
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "modules", "shubix-video", "android", "src", "main", "assets", "engine");

const common = {
  bundle: true, format: "esm", platform: "browser", target: "chrome100", minify: true, logLevel: "warning",
  tsconfigRaw: { compilerOptions: { baseUrl: here, paths: { "@/*": ["./*"] } } },
  define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  alias: { fs: join(here, "empty.ts"), path: join(here, "empty.ts"), crypto: join(here, "empty.ts") },
  loader: { ".woff2": "file", ".woff": "file", ".png": "file", ".webp": "file", ".svg": "file" },
  publicPath: "/e",
};

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
await build({ ...common, entryPoints: { main: join(here, "main.ts") }, outdir: join(out, "e"), splitting: true, chunkNames: "[hash]" });
await build({ ...common, publicPath: undefined, loader: undefined, outdir: join(out, "w"), entryPoints: Object.fromEntries(["beatThis", "vad", "vision", "tts"].map((n) => [`${n}.worker`, join(here, "lib", n, `${n}.worker.ts`)])) });
cpSync(join(here, "index.html"), join(out, "index.html"));
cpSync(join(here, "public"), out, { recursive: true });
// the WebAssembly runtimes the workers load from /vendor (they come from node_modules, not from git)
const dist = (pkg, file) => join(here, "..", "node_modules", pkg, file);
for (const f of ["ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.mjs"]) { mkdirSync(join(out, "vendor", "ort"), { recursive: true }); cpSync(dist("onnxruntime-web", join("dist", f)), join(out, "vendor", "ort", f)); }
for (const f of ["piper_phonemize.js", "piper_phonemize.wasm", "piper_phonemize.data"]) { mkdirSync(join(out, "vendor", "piper"), { recursive: true }); cpSync(dist("@diffusionstudio/piper-wasm", join("build", f)), join(out, "vendor", "piper", f)); }
console.log("Engine built:", out);
