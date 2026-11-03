// The API as one file (dist/main.bundle.js), so a sleeping container wakes fast: Node read 4,500 files to start (12 s on a
// fast PC, past the 90 s the Cloudflare Worker waited on its 1/4 vCPU). Bundles the compiled dist/main.js (tsc keeps
// Nest's decorator metadata, which esbuild alone would not). Native and optional packages stay in node_modules.
import { build } from "esbuild";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const api = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const external = [
  // native code
  "sharp", "onnxruntime-node",
  // Nest's optional packages (required inside try / only when used)
  "@nestjs/microservices", "@nestjs/microservices/*", "@nestjs/websockets", "@nestjs/websockets/*", "class-validator", "class-transformer",
  "@fastify/static", "cache-manager",
  // MongoDB's optional packages
  "kerberos", "snappy", "@mongodb-js/zstd", "mongodb-client-encryption", "@aws-sdk/credential-providers", "gcp-metadata", "socks", "aws4",
];
await build({
  entryPoints: [join(api, "dist", "main.js")], outfile: join(api, "dist", "main.bundle.js"),
  bundle: true, platform: "node", format: "cjs", target: "node22", conditions: ["shubix-dist"],
  external, keepNames: true, logLevel: "warning", legalComments: "none",
});
console.log("dist/main.bundle.js");
