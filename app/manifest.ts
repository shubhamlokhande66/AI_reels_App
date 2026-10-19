import type { MetadataRoute } from "next";

/** Shubix as an app: installed on the home screen (phones) or the desktop, it opens full screen with its own icon. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Shubix · Reels video studio",
    short_name: "Shubix",
    description: "Turn your clips, photos and a song into a beat-synced Reel.",
    start_url: "/?source=app",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    background_color: "#0a0a1f",
    theme_color: "#0a0a1f",
    orientation: "portrait",
    categories: ["photo", "video", "entertainment", "productivity"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Music Reel", short_name: "Music Reel", description: "Your clips, cut to the beat of a song", url: "/create/music", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Create a Reel", short_name: "Create", url: "/projects/new", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "My Projects", short_name: "Projects", url: "/projects", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
