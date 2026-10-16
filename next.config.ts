import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server output, used by docker/Dockerfile
  output: "standalone",
  // Phone mode: let a phone on the same Wi-Fi load the dev server through this computer's private address.
  // (Only matters when the dev server is started with -H 0.0.0.0.)
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.*.*.*"],
  // the native/WASM packages the server uses stay plain Node requires (not bundled)
  serverExternalPackages: ["mongodb", "essentia.js", "onnxruntime-node", "@techstark/opencv-js", "sharp", "nodemailer", "unpdf"],
  // the clip analysis runs OpenCV in the browser too (lib/clipAnalysis): its Node-only branch requires these, never used there
  // Fast Studio runs its AI beat tracker (WebAssembly) on several CPU cores, which browsers allow only on a
  // cross-origin-isolated page; the studio loads nothing from other sites, so it can be isolated. Its worker scripts need
  // the same policy. Other pages are untouched.
  async headers() {
    const isolate = [
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
    ];
    return [
      { source: "/studio", headers: isolate },
      { source: "/_next/static/:path*", headers: [{ key: "Cross-Origin-Embedder-Policy", value: "require-corp" }, { key: "Cross-Origin-Resource-Policy", value: "same-origin" }] },
      { source: "/vendor/ort/:path*", headers: [{ key: "Cross-Origin-Embedder-Policy", value: "require-corp" }, { key: "Cross-Origin-Resource-Policy", value: "same-origin" }] },
    ];
  },
  turbopack: {
    resolveAlias: {
      fs: { browser: "./lib/empty.ts" },
      path: { browser: "./lib/empty.ts" },
      crypto: { browser: "./lib/empty.ts" },
    },
  },
};

export default nextConfig;
