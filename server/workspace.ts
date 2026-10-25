import "server-only";
import os from "node:os";
import { ObjectId } from "mongodb";
import { getProvider } from "@/server/ai";
import { effective } from "@/server/ai/config";
import { settings } from "@/server/core/config";
import { db } from "@/server/core/db";
import { AppError, ValidationFailed } from "@/server/core/errors";

/** Workspace-level endpoints: health, the business details, phone mode, plans and prices. (Reels are made on the
 * phone: the server keeps accounts, credits, payments, My Reels and the AI the phone asks for.) */

const now = () => new Date();

// ------------------------------------------------------------------ health and site
export async function health() {
  let mongo = true;
  try { await (await db()).command({ ping: 1 }); } catch { mongo = false; }
  const cfg = effective();
  let ai: Record<string, unknown>, local = true, fallback: string | null = null;
  try { const p = getProvider(); local = p.isLocal; fallback = p.modelInfo().fallback; ai = { ...(await p.health()) }; }
  catch (e) { ai = { available: false, model: null, detail: (e as AppError).message }; }
  return { status: mongo ? "ok" : "degraded", mongodb: mongo, ai: { provider: cfg.textProvider || settings.aiProvider, local, fallback, ...ai } };
}
export const site = () => ({ businessName: settings.businessName, supportEmail: settings.supportEmail, supportPhone: settings.supportPhone, businessAddress: settings.businessAddress, legalUpdated: settings.legalUpdated });

const PRIVATE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
export const phone = () => ({ enabled: ["1", "true", "yes", "on"].includes((process.env.CORS_ALLOW_LAN ?? "").toLowerCase()),
  addresses: Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal && PRIVATE.test(i.address)).map((i) => i!.address) });

// ------------------------------------------------------------------ plans and pricing (services/plans.py)
const YEARLY_MONTHS_CHARGED = 10;
/** The plans (October 2026): Free makes Reels on the phone (no AI, with ads and a watermark); Editor and Pro have Shubix
 * AI on credits: an AI Reel uses 10 credits, a chat change 1 (a few shots) or 2 (the whole Reel). The administrator
 * changes all of it in Admin → Settings → Plans & pricing (`ai`: the plan has Shubix AI; `hidden`: not offered). */
export const PRICING_VERSION = 2;
type PlanDef = { id: string; name: string; monthly: number; credits: number; creditsNote: string; tagline: string; highlight: boolean; ai: boolean; ads: boolean; hidden: boolean; freeChats: number; features: string[] };
const DEFAULT_PRICING = {
  plans: [
    { id: "free", name: "Free", monthly: 0, credits: 0, creditsNote: "Reels made on your phone", tagline: "Edit Reels on your phone, free", highlight: false, ai: false, ads: true, hidden: false, freeChats: 0,
      features: ["Unlimited Reels, edited on your phone (on the beat)", "Full editor: timeline, text, music, effects", "1080p export with a small watermark", "Ads", "No Shubix AI · Copy a Reel, Templates and Story Maker in Editor & Pro"] },
    { id: "creator", name: "Editor", monthly: 199, credits: 250, creditsNote: "every month · about 20 AI Reels", tagline: "Shubix AI edits your Reels", highlight: true, ai: true, ads: false, hidden: false, freeChats: 2,
      features: ["Everything in Free, no ads, no watermark", "Shubix AI: about 20 AI Reels a month", "Ask Shubix: 2 free chat changes per Reel", "Copy a Reel, Templates, Story Maker", "All 👑 effects, Beauty, Stabilize, 60 fps"] },
    { id: "pro", name: "Pro", monthly: 499, credits: 720, creditsNote: "every month · about 60 AI Reels", tagline: "For daily posting and brands", highlight: false, ai: true, ads: false, hidden: false, freeChats: 5,
      features: ["Everything in Editor", "About 60 AI Reels a month", "Ask Shubix: 5 free chat changes per Reel", "Brand kit (logo, colours, fonts)", "4K export · Background, Layers, Voice, Motion"] },
    { id: "business", name: "Business", monthly: 2999, credits: 650, creditsNote: "every month", tagline: "For agencies and teams", highlight: false, ai: true, ads: false, hidden: true, freeChats: 5,
      features: ["Everything in Pro", "Several brands", "Priority email support"] },
  ] as PlanDef[],
  topUps: [{ id: "topup_100", credits: 100, price: 99 }, { id: "topup_300", credits: 300, price: 249 }],
  costs: { studio_ai: 10, studio_chat_small: 1, studio_chat_big: 2, studio_mix: 0, studio_captions: 0, studio_ref_look: 0, clip_reel: 1, version: 1, story_render: 2, ai_picture: 1, paid_picture: 3, preview: 0 } as Record<string, number>,
};
const COST_LABELS: Record<string, string> = { studio_ai: "Shubix AI edits a Reel (once per Reel)", studio_chat_small: "Ask Shubix: a small change (a few shots)", studio_chat_big: "Ask Shubix: a change to the whole Reel",
  studio_mix: "Change Reel: Shubix's other versions", studio_captions: "Captions from the song (per song)", studio_ref_look: "Copy a Reel's texts, stickers and captions (per Reel)",
  clip_reel: "Reel from your own clips (server)", version: "New version / re-render (server)", story_render: "Story Reel: narrate and render", ai_picture: "Shubix picture for a story scene", paid_picture: "Premium HD Shubix picture", preview: "Quick previews" };
export type Pricing = typeof DEFAULT_PRICING;

/** the plans' feature lists before the plan locks (October 2026): replaced by the new defaults when read */
const OLD_FEATURES = new Set([
  JSON.stringify(["15 credits to start", "Reels from your clips", "Your first Story Reel", "Natural Shubix voices"]),
  JSON.stringify(["80 credits a month", "~8 Story Reels or 80 clip Reels", "Full-HD export", "Natural Shubix voices", "Post to Instagram, TikTok, YouTube"]),
  JSON.stringify(["250 credits a month", "~25 Story Reels", "Everything in Creator", "Schedule posts", "Brand kit (logo, colours, fonts)"]),
  JSON.stringify(["650 credits a month", "~65 Story Reels", "Everything in Pro", "Several brands", "Email support"]),
]);
export async function getPricing(): Promise<Pricing> {
  const out = structuredClone(DEFAULT_PRICING);
  const saved = ((await (await db()).collection("app_settings").findOne({ _id: "pricing" as unknown as ObjectId })) ?? {}) as Record<string, unknown>;
  if (Number(saved.ver ?? 0) < PRICING_VERSION) return out; // prices saved before the AI plans: the new plans and costs
  if ((saved.plans as unknown[])?.length) out.plans = (saved.plans as Pricing["plans"]).map((sp) => {
    // plans saved before the feature lists were rewritten keep their prices; the old default lists give way to the new ones
    const def = DEFAULT_PRICING.plans.find((d) => d.id === sp.id);
    const p = { ...(def ?? {}), ...sp } as PlanDef;
    return def && OLD_FEATURES.has(JSON.stringify(sp.features)) ? { ...p, features: def.features } : p;
  });
  if ((saved.topUps as unknown[])?.length) out.topUps = saved.topUps as Pricing["topUps"];
  for (const [k, v] of Object.entries((saved.costs as Record<string, number>) ?? {})) if (k in out.costs) out.costs[k] = v;
  return out;
}
export const paymentsOpen = () => Boolean(settings.billingEnabled && settings.razorpayKeyId && settings.razorpayKeySecret);
export async function pricing() {
  const p = await getPricing();
  return { currency: "INR", yearlyMonthsCharged: YEARLY_MONTHS_CHARGED, plans: p.plans.map((x) => ({ ...x, yearly: x.monthly * YEARLY_MONTHS_CHARGED })), topUps: p.topUps, costLabels: COST_LABELS,
    creditCosts: [...Object.entries(p.costs).map(([id, credits]) => ({ id, action: COST_LABELS[id], credits })), { id: "free_picture", action: "Classical paintings and pictures from the library: free", credits: 0 }],
    costs: p.costs, paymentsOpen: paymentsOpen(), billingEnabled: settings.billingEnabled };
}
function int(v: unknown, lo: number, hi: number, what: string) {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new ValidationFailed(`${what} must be a whole number.`, { code: "INVALID_PRICING" });
  if (n < lo || n > hi) throw new ValidationFailed(`${what} must be between ${lo} and ${hi}.`, { code: "INVALID_PRICING" });
  return n;
}
/** Admin: prices, credits and costs (plan ids stay: payments and wallets refer to them). */
export async function setPricing(plans: Record<string, unknown>[], topUps: Record<string, unknown>[], costs: Record<string, unknown>) {
  const cur = await getPricing(), byId = new Map(cur.plans.map((p) => [p.id, p]));
  const newPlans = plans.map((p) => {
    const base = byId.get(p.id as string);
    if (!base) throw new ValidationFailed(`Unknown plan '${p.id}'.`, { code: "INVALID_PRICING" });
    const name = typeof p.name === "string" && p.name.trim() ? p.name.trim().slice(0, 30) : base.name;
    return { ...base, name, monthly: base.id === "free" ? 0 : int(p.monthly, 1, 100000, `${name} price`), credits: int(p.credits, 0, 100000, `${name} credits`),
      highlight: typeof p.highlight === "boolean" ? p.highlight : base.highlight,
      ai: typeof p.ai === "boolean" ? p.ai : base.ai, ads: typeof p.ads === "boolean" ? p.ads : base.ads, hidden: base.id === "free" ? false : typeof p.hidden === "boolean" ? p.hidden : base.hidden,
      freeChats: int(p.freeChats ?? base.freeChats ?? 0, 0, 50, `${name} free chat changes`),
      creditsNote: typeof p.creditsNote === "string" ? p.creditsNote.trim().slice(0, 60) : base.creditsNote, tagline: typeof p.tagline === "string" ? p.tagline.trim().slice(0, 60) : base.tagline,
      features: ((p.features as unknown[]) ?? base.features).map((f) => String(f).trim().slice(0, 80)).filter(Boolean).slice(0, 10) };
  });
  if (newPlans.length !== byId.size || newPlans.some((p) => !byId.has(p.id))) throw new ValidationFailed("Every plan must be included.", { code: "INVALID_PRICING" });
  if (topUps.length < cur.topUps.length) throw new ValidationFailed("Every top-up must be included.", { code: "INVALID_PRICING" });
  const newTop = cur.topUps.map((t, i) => ({ id: t.id, credits: int(topUps[i].credits, 1, 100000, "Top-up credits"), price: int(topUps[i].price, 1, 100000, "Top-up price") }));
  if (!newPlans.some((p) => p.id !== "free" && !p.hidden)) throw new ValidationFailed("Keep at least one paid plan on offer.", { code: "INVALID_PRICING" });
  const newCosts = Object.fromEntries(Object.entries(cur.costs).map(([k, v]) => [k, int(costs[k] ?? v, 0, 100, COST_LABELS[k])]));
  await (await db()).collection("app_settings").updateOne({ _id: "pricing" as unknown as ObjectId }, { $set: { ver: PRICING_VERSION, plans: newPlans, topUps: newTop, costs: newCosts, updatedAt: now() } }, { upsert: true });
  return pricing();
}
