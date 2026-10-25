import type { Metadata } from "next";

/** the browser tab / installed app title of the CMS ("CMS · Shubix") */
export const metadata: Metadata = { title: "CMS", robots: { index: false } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
