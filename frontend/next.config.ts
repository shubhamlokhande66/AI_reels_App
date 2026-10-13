import type { NextConfig } from "next";

/** Where the Python backend runs while the migration lasts (docs/MIGRATION.md): every /api path that has no route
 * in app/api yet is passed on to it, so the app keeps working while endpoints move over one by one. */
const PYTHON = process.env.PYTHON_BACKEND_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  // Self-contained server output, used by docker/frontend.Dockerfile
  output: "standalone",
  // Phone mode: let a phone on the same Wi-Fi load the dev server through this computer's private address.
  // (Only matters when the dev server is started with -H 0.0.0.0; see scripts/start-phone-mode.ps1.)
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.*.*.*"],
  // the native/WASM packages the server uses stay plain Node requires (not bundled)
  serverExternalPackages: ["mongodb", "essentia.js"],
  // uploads and long jobs passed on to Python must not be cut off at the 30 s default
  experimental: { proxyTimeout: 15 * 60 * 1000 },
  async rewrites() {
    return { beforeFiles: [], afterFiles: [], fallback: [{ source: "/api/:path*", destination: `${PYTHON}/api/:path*` }] };
  },
};

export default nextConfig;
