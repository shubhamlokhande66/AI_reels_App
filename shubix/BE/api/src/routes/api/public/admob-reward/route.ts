import crypto from "node:crypto";
import { route } from "../../../../server/core/http";
import { getAds } from "../../../../server/ads";
import { adRewardCredits } from "../../../../server/credits";

/** AdMob server-side verification of a rewarded ad (AdMob → the rewarded ad unit → Server-side verification → this
 * URL): Google calls it, signed, when someone has watched the ad; the phone sets user_id. Only then are credits given. */
const KEYS_URL = "https://www.gstatic.com/admob/reward/verifier-keys.json";
let keys: { at: number; map: Map<string, string> } | null = null;
async function key(id: string) {
  if (!keys || Date.now() - keys.at > 6 * 3600_000 || !keys.map.has(id)) {
    const j = (await (await fetch(KEYS_URL)).json()) as { keys: { keyId: number; pem: string }[] };
    keys = { at: Date.now(), map: new Map(j.keys.map((k) => [String(k.keyId), k.pem])) };
  }
  return keys.map.get(id);
}

export const GET = route(async (req) => {
  const raw = new URL(req.url).search.slice(1), at = raw.indexOf("&signature="), q = new URLSearchParams(raw);
  const pem = at > 0 ? await key(q.get("key_id") ?? "") : undefined;
  const ok = !!pem && crypto.verify("sha256", Buffer.from(raw.slice(0, at)), { key: pem, dsaEncoding: "der" }, Buffer.from(q.get("signature") ?? "", "base64url"));
  if (!ok) return new Response("bad signature", { status: 403 });
  const a = (await getAds()).admob, user = q.get("user_id") ?? "", tx = q.get("transaction_id") ?? "";
  if (user && tx && q.get("ad_unit") === a.rewarded.split("/")[1]) await adRewardCredits(user, a.rewardCredits, a.rewardDaily, tx);
  return new Response("ok"); // 200 for every verified call (AdMob retries otherwise)
});
