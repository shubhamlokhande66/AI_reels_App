import type { Metadata } from "next";

/** the browser tab / installed app title of this part of the app ("Media Library · Shubix") */
export const metadata: Metadata = { title: "Media Library" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
