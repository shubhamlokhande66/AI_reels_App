import type { MetadataRoute } from "next";

/** The public pages for search engines (the same ones robots.ts allows). */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.PUBLIC_BASE_URL || "https://shubix.in";
  return ["", "/about", "/pricing", "/templates", "/terms", "/privacy", "/refunds", "/delete-account", "/contact"].map((p) => ({ url: `${base}${p}` }));
}
