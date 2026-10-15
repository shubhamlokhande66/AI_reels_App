import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { AppShell } from "@/components/templates/AppShell";
import { Providers } from "@/components/templates/Providers";
import { THEME_SCRIPT } from "@/lib/theme";

// Display serif for headings, a clean geometric sans for everything else.
// Self-hosted (latin variable fonts from Google Fonts in app/fonts): the build never fetches fonts over the network.
const display = localFont({ src: "./fonts/cormorant-garamond.woff2", variable: "--font-display", weight: "500 700", display: "swap" });
const body = localFont({ src: "./fonts/manrope.woff2", variable: "--font-body", weight: "200 800", display: "swap" });
const geistMono = localFont({ src: "./fonts/geist-mono.woff2", variable: "--font-geist-mono", weight: "100 900", display: "swap" });

// phones: use the whole screen (the bottom bar keeps clear of the home indicator with safe-area padding)
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0d0b09" },
    { media: "(prefers-color-scheme: light)", color: "#f7f1e8" },
  ],
};

export const metadata: Metadata = {
  title: "AI Reel Maker",
  description: "Turn raw clips and a song into a beat-synced 9:16 Reel.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning className={`${display.variable} ${body.variable} ${geistMono.variable} h-full antialiased`}>
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
