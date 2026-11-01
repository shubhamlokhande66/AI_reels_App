import type { Metadata } from "next";

/** the browser tab / installed app title of this part of the app ("Delete your account · Shubix") */
export const metadata: Metadata = { title: "Delete your account" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
