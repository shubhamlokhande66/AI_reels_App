import type { Metadata } from "next";

/** the browser tab / installed app title of this part of the app ("Edit Reel · Shubix") */
export const metadata: Metadata = { title: "Edit Reel" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
