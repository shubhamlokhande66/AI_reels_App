import { getAds } from "../../server/ads";

// read on every request: it follows the publisher id saved in Admin → Settings → Ads (never a copy from the build)
export const dynamic = "force-dynamic";

/** /ads.txt (Google AdSense asks for it): this site's authorised ad seller, from the AdSense publisher id the administrator
 * set. Without one (or with ads off), there is nothing to declare. */
export async function GET() {
  const a = await getAds().catch(() => null);
  const pub = a?.enabled && a.client ? a.client.replace(/^ca-/, "") : "";
  if (!pub) return new Response("# No ad sellers.\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300" } });
  // f08c47fec0942fa0: Google's certification authority id (the same for every AdSense site)
  return new Response(`google.com, ${pub}, DIRECT, f08c47fec0942fa0\n`, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
