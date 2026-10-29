import type { Metadata } from "next";

/** the browser tab / installed app title of this part of the app ("Refund & Cancellation · Shubix") */
export const metadata: Metadata = { title: "Refund & Cancellation" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
