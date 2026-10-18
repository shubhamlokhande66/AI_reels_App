import type { Metadata } from "next";

/** the browser tab / installed app title of this part of the app ("AI Edit · Shubix") */
export const metadata: Metadata = { title: "AI Edit" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
