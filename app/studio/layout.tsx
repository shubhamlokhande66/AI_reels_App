import type { Metadata } from "next";

/** the browser tab / installed app title of this part of the app ("Fast Studio · Shubix") */
export const metadata: Metadata = { title: "Fast Studio" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
