import type { Metadata } from "next";

/** the browser tab / installed app title of this part of the app ("Pricing & plans · Shubix") */
export const metadata: Metadata = { title: "Pricing & plans" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
