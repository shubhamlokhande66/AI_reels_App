import type { Metadata } from "next";

/** the browser tab / installed app title of this part of the app ("My songs · Shubix") */
export const metadata: Metadata = { title: "My songs" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
