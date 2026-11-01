import type { Metadata } from "next";

/** the browser tab / installed app title of this part of the app ("New password · Shubix") */
export const metadata: Metadata = { title: "New password" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
