import type { Metadata } from "next";

/** the browser tab / installed app title of this part of the app ("My account · Shubix") */
export const metadata: Metadata = { title: "My account" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
