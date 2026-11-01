import { getAds } from "../../server/ads";

// read on every request: it follows the AdMob ad units saved in Admin → Settings → Ads (never a copy from the build)
export const dynamic = "force-dynamic";

/** /app-ads.txt (Google AdMob asks for it on the app's website, like /ads.txt for AdSense): this app's authorised ad seller,
 * the publisher id of the AdMob ad units the administrator set. Without one (or with ads off), there is nothing to declare. */
export async function GET() {
  const a = await getAds().catch(() => null);
  const unit = a?.enabled ? a.admob.android || a.admob.ios : "";
  const pub = /^ca-app-(pub-\d+)\//.exec(unit)?.[1] ?? "";
  if (!pub) return new Response("# No ad sellers.\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300" } });
  // f08c47fec0942fa0: Google's certification authority id (the same for every AdMob app)
  return new Response(`google.com, ${pub}, DIRECT, f08c47fec0942fa0\n`, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
