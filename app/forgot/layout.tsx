import type { Metadata } from "next";

/** the browser tab / installed app title of this part of the app ("Forgot password · Shubix") */
export const metadata: Metadata = { title: "Forgot password" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
