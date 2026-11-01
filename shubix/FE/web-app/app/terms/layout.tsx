import type { Metadata } from "next";

/** the browser tab / installed app title of this part of the app ("Terms of Service · Shubix") */
export const metadata: Metadata = { title: "Terms of Service" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
