import type { MetadataRoute } from "next";

/** Search engines: the public pages (home, pricing, the legal pages) may be listed; the app itself, the admin and the
 * API are not for them. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/", "/about", "/pricing", "/terms", "/privacy", "/refunds", "/contact"], disallow: ["/api/", "/admin", "/account", "/rewards", "/affiliate", "/create/", "/projects", "/editor", "/reels", "/library", "/songs", "/settings"] }],
    sitemap: `${process.env.PUBLIC_BASE_URL || "https://shubix.in"}/sitemap.xml`,
  };
}
