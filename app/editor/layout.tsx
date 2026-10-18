import type { Metadata } from "next";

/** the browser tab / installed app title of this part of the app ("Editor · Shubix") */
export const metadata: Metadata = { title: "Editor" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
