import type { Metadata } from "next";

/** the browser tab / installed app title of this part of the app ("My Brands · Shubix") */
export const metadata: Metadata = { title: "My Brands" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
