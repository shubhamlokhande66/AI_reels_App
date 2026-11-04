/** A public ads file from the API (it follows the ids in Admin → Settings → Ads). */
export const fetchAdsFile = (name: "ads.txt" | "app-ads.txt") =>
  fetch(`${(process.env.API_URL || "http://localhost:4000").replace(/\/$/, "")}/${name}`, { next: { revalidate: 300 }, signal: AbortSignal.timeout(2500) });

/** The file as this site's own answer, not a rewrite: Vercel cached a rewrite's compressed copy and gave it to every client, which ad crawlers may not read. */
export async function adsFileResponse(name: "ads.txt" | "app-ads.txt") {
  const r = await fetchAdsFile(name);
  return new Response(await r.text(), { status: r.status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
