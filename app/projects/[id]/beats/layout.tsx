import type { Metadata } from "next";

/** the browser tab / installed app title of this part of the app ("Beat check · Shubix") */
export const metadata: Metadata = { title: "Beat check" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
