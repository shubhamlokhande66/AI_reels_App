import type { Metadata } from "next";

/** the browser tab / installed app title of this part of the app ("Contact us · Shubix") */
export const metadata: Metadata = { title: "Contact us" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
