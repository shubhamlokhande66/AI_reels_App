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
    // every page and API answer: no MIME guessing, no framing by other sites (clickjacking), a short referrer, the camera
    // and microphone for this site only (the studio's voiceover), no location; HTTPS only, once deployed
    const security = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), interest-cohort=()" },
      ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
    ];
    return [
      { source: "/:path*", headers: security },
      { source: "/create/:kind", headers: isolate }, // the Create flow is Fast Studio too
      // the service worker (installable app): always the newest copy, allowed to look after the whole site
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }, { key: "Service-Worker-Allowed", value: "/" }, { key: "Content-Type", value: "application/javascript; charset=utf-8" }] },
      { source: "/brand/:path*", headers: [{ key: "Cross-Origin-Resource-Policy", value: "same-origin" }] },
      { source: "/:icon(icon-192.png|icon-512.png|icon-maskable-512.png)", headers: [{ key: "Cross-Origin-Resource-Policy", value: "same-origin" }] },
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
