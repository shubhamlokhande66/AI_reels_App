import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import "./globals.css";
import { AppShell } from "@/components/templates/AppShell";
import { Providers } from "@/components/templates/Providers";
import { THEME_SCRIPT } from "@/lib/theme";

// One clean geometric sans (UI/ design): bold for headings, regular for everything else.
// Self-hosted (latin variable fonts from Google Fonts in app/fonts): the build never fetches fonts over the network.
// One file for both: headings use it through --font-display (globals.css), so it is declared and preloaded once. The mono
// face (times, sizes) is small and rare: not preloaded, it comes when a page uses it.
const body = localFont({ src: "./fonts/manrope.woff2", variable: "--font-body", weight: "200 800", display: "swap" });
const geistMono = localFont({ src: "./fonts/geist-mono.woff2", variable: "--font-geist-mono", weight: "100 900", display: "swap", preload: false });

// phones: use the whole screen (the bottom bar keeps clear of the home indicator with safe-area padding)
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#10100f",
};

export const metadata: Metadata = {
  title: { default: "Shubix · Reels video studio", template: "%s · Shubix" },
  description: "Turn your clips, photos and a song into a beat-synced Reel.",
  applicationName: "Shubix",
  appleWebApp: { capable: true, title: "Shubix", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
  // a shared link shows the name, the line and the logo (WhatsApp, Instagram, X…)
  metadataBase: process.env.PUBLIC_BASE_URL ? new URL(process.env.PUBLIC_BASE_URL) : undefined,
  openGraph: { type: "website", siteName: "Shubix", title: "Shubix · Reels video studio", description: "Turn your clips, photos and a song into a beat-synced Reel.", images: [{ url: "/icon-512.png", width: 512, height: 512, alt: "Shubix" }] },
  twitter: { card: "summary", title: "Shubix · Reels video studio", description: "Turn your clips, photos and a song into a beat-synced Reel.", images: ["/icon-512.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning className={`${body.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        {/* the saved (or system) theme is applied before the first paint: no flash of the other theme */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
