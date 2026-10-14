import type { MetadataRoute } from "next";

/** Install on a phone's home screen: opens full screen like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Reel Maison · AI Reel Studio",
    short_name: "Reel Maison",
    description: "Give it your clips and a song; the AI creative director makes the Reel.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0908",
    theme_color: "#0a0908",
    orientation: "portrait",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
