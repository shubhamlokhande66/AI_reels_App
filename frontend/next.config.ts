import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server output, used by docker/frontend.Dockerfile
  output: "standalone",
  // Phone mode: let a phone on the same Wi-Fi load the dev server through this computer's private address.
  // (Only matters when the dev server is started with -H 0.0.0.0; see scripts/start-phone-mode.ps1.)
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.*.*.*"],
};

export default nextConfig;
