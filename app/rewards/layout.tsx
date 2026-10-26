import type { Metadata } from "next";

/** the browser tab / installed app title of this part of the app ("Invite & earn · Shubix") */
export const metadata: Metadata = { title: "Invite & earn" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
