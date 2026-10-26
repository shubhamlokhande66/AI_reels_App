import type { Metadata } from "next";

/** the browser tab / installed app title of this part of the app ("Affiliate dashboard · Shubix") */
export const metadata: Metadata = { title: "Affiliate dashboard" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
