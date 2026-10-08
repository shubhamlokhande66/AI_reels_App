import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Geist_Mono, Manrope } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { Providers } from "@/components/Providers";
import { THEME_SCRIPT } from "@/lib/theme";

// Display serif for headings, a clean geometric sans for everything else.
const display = Cormorant_Garamond({ variable: "--font-display", subsets: ["latin"], weight: ["500", "600", "700"] });
const body = Manrope({ variable: "--font-body", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

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
