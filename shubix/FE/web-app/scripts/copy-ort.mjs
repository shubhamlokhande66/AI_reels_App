// Copies ONNX Runtime's WebAssembly runtime into public/vendor/ort/ (Fast Studio's on-device beat tracker loads it from
// there). Runs before `next dev`
// and `next build`; the copies are not committed (they come from node_modules).
import fs from "node:fs";
import path from "node:path";
const from = path.join("node_modules", "onnxruntime-web", "dist"), to = path.join("public", "vendor", "ort");
fs.mkdirSync(to, { recursive: true });
for (const f of ["ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.mjs"]) {
  const a = path.join(from, f), b = path.join(to, f);
  if (!fs.existsSync(a)) { console.warn(`copy-ort: ${a} is missing (npm install onnxruntime-web)`); continue; }
  if (!fs.existsSync(b) || fs.statSync(b).size !== fs.statSync(a).size) fs.copyFileSync(a, b);
}
