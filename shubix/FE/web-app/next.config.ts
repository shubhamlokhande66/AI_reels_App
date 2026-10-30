import path from "node:path";
import type { NextConfig } from "next";

const API_URL = (process.env.API_URL || "http://localhost:4000").replace(/\/$/, "");

const nextConfig: NextConfig = {
  // Self-contained server output, used by docker/Dockerfile (Vercel builds its own: VERCEL is set there)
  output: process.env.VERCEL ? undefined : "standalone",
  // a pnpm monorepo: trace the shared packages (Shared/*) into the standalone server too
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  // Phone mode: let a phone on the same Wi-Fi load the dev server through this computer's private address.
  // (Only matters when the dev server is started with -H 0.0.0.0.)
  // and the phone app while testing (docs/capacitor.md): a cloudflared tunnel to this computer
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.*.*.*", "*.trycloudflare.com"],
  // the code shared with BE/api (Shared/core) is TypeScript: compile it with the app
  transpilePackages: ["@shubix/core", "@shubix/validations", "@shubix/utils"],
  // the API is BE/api (NestJS): the browser keeps calling /api on this origin, so the session cookie stays first-party.
  // Rewrites stream the request body (large uploads are not buffered).
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API_URL}/api/:path*` },
      { source: "/ads.txt", destination: `${API_URL}/ads.txt` },
      { source: "/app-ads.txt", destination: `${API_URL}/app-ads.txt` },
    ];
  },
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
      // a Content-Security-Policy that blocks what is never needed here (plugins, a changed <base>, framing by other
      // sites); scripts are left as they are (Razorpay, ads, the studio's workers), so nothing of the app breaks
      { key: "Content-Security-Policy", value: "object-src 'none'; base-uri 'self'; frame-ancestors 'self'" },
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
