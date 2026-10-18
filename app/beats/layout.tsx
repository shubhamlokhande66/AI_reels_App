import type { Metadata } from "next";

/** the browser tab / installed app title of this part of the app ("Beat Sync · Shubix") */
export const metadata: Metadata = { title: "Beat Sync" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
