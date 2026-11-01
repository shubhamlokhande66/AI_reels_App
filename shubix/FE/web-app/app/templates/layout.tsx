import type { Metadata } from "next";

/** the browser tab / installed app title of this part of the app ("Templates · Shubix") */
export const metadata: Metadata = { title: "Templates" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
