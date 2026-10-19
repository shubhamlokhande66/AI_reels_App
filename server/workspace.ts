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
const DEFAULT_PRICING = {
  plans: [
    { id: "free", name: "Free", monthly: 0, credits: 15, creditsNote: "once, to try everything", tagline: "Try every feature", highlight: false, features: ["Full editor: keyframes, green screen, overlays, sound effects", "Music, Talking, Photo and Story Reels", "15 AI credits to start", "1080p export with a small watermark"] },
    { id: "creator", name: "Creator", monthly: 499, credits: 80, creditsNote: "every month", tagline: "For creators posting every week", highlight: true, features: ["Everything in Free", "No watermark, 60 fps", "All 👑 effects, transitions, filters and fonts", "Beauty, stabilize, speed curve, text that follows people", "80 credits a month for AI edits"] },
    { id: "pro", name: "Pro", monthly: 1299, credits: 250, creditsNote: "every month", tagline: "For daily posting and small brands", highlight: false, features: ["Everything in Creator", "4K export", "250 credits a month", "Saved styles and brand kit", "Schedule posts"] },
    { id: "business", name: "Business", monthly: 2999, credits: 650, creditsNote: "every month", tagline: "For agencies and teams", highlight: false, features: ["Everything in Pro", "650 credits a month", "Several brands", "Priority email support"] },
  ],
  topUps: [{ id: "topup_30", credits: 30, price: 199 }, { id: "topup_100", credits: 100, price: 599 }],
  costs: { clip_reel: 1, version: 1, story_render: 2, ai_picture: 1, paid_picture: 3, preview: 0, studio_ai: 0, studio_captions: 0, studio_ref_look: 0 } as Record<string, number>,
};
const COST_LABELS: Record<string, string> = { clip_reel: "Reel from your own clips", version: "New version / re-render", story_render: "Story Reel: narrate and render", ai_picture: "Shubix picture for a story scene", paid_picture: "Premium HD Shubix picture", preview: "Quick previews", studio_ai: "Shubix edits the Reel (per Reel)", studio_captions: "Fast Studio: captions from the song (per song)", studio_ref_look: "Fast Studio: copy a Reel's texts, stickers and captions (per Reel)" };
export type Pricing = typeof DEFAULT_PRICING;

export async function getPricing(): Promise<Pricing> {
  const out = structuredClone(DEFAULT_PRICING);
  const saved = ((await (await db()).collection("app_settings").findOne({ _id: "pricing" as unknown as ObjectId })) ?? {}) as Record<string, unknown>;
  if ((saved.plans as unknown[])?.length) out.plans = saved.plans as Pricing["plans"];
  if ((saved.topUps as unknown[])?.length) out.topUps = saved.topUps as Pricing["topUps"];
  for (const [k, v] of Object.entries((saved.costs as Record<string, number>) ?? {})) if (k in out.costs) out.costs[k] = v;
  return out;
}
export const paymentsOpen = () => Boolean(settings.billingEnabled && settings.razorpayKeyId && settings.razorpayKeySecret);
export async function pricing() {
  const p = await getPricing();
  return { currency: "INR", yearlyMonthsCharged: YEARLY_MONTHS_CHARGED, plans: p.plans.map((x) => ({ ...x, yearly: x.monthly * YEARLY_MONTHS_CHARGED })), topUps: p.topUps,
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
    return { ...base, monthly: base.id === "free" ? 0 : int(p.monthly, 1, 100000, `${base.name} price`), credits: int(p.credits, 0, 100000, `${base.name} credits`),
      features: ((p.features as unknown[]) ?? base.features).map((f) => String(f).trim().slice(0, 80)).filter(Boolean).slice(0, 10) };
  });
  if (newPlans.length !== byId.size || newPlans.some((p) => !byId.has(p.id))) throw new ValidationFailed("Every plan must be included.", { code: "INVALID_PRICING" });
  if (topUps.length < cur.topUps.length) throw new ValidationFailed("Every top-up must be included.", { code: "INVALID_PRICING" });
  const newTop = cur.topUps.map((t, i) => ({ id: t.id, credits: int(topUps[i].credits, 1, 100000, "Top-up credits"), price: int(topUps[i].price, 1, 100000, "Top-up price") }));
  const newCosts = Object.fromEntries(Object.entries(cur.costs).map(([k, v]) => [k, int(costs[k] ?? v, 0, 100, COST_LABELS[k])]));
  await (await db()).collection("app_settings").updateOne({ _id: "pricing" as unknown as ObjectId }, { $set: { plans: newPlans, topUps: newTop, costs: newCosts, updatedAt: now() } }, { upsert: true });
  return pricing();
}
