import type { Metadata } from "next";

/** the browser tab / installed app title of this part of the app ("My Projects · Shubix") */
export const metadata: Metadata = { title: { default: "My Projects", template: "%s · Shubix" } };   // its pages too: "Create Reel · Shubix"

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
