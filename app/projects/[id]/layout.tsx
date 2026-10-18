import type { Metadata } from "next";

/** the browser tab / installed app title of this part of the app ("Project · Shubix") */
export const metadata: Metadata = { title: { default: "Project", template: "%s · Shubix" } };   // its pages too: "Edit Reel · Shubix"

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
