import type { Metadata } from "next";

/** the browser tab / installed app title of this part of the app ("Privacy Policy · Shubix") */
export const metadata: Metadata = { title: "Privacy Policy" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
