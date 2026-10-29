/** Marketing in the browser: the invite code from a friend's link (?ref=username, kept 30 days for the sign-up), and
 * the shapes of what the server sends (Invite & earn, the price check, Admin → Marketing). */

const REF_KEY = "shubix-ref", REF_DAYS = 30;

/** A friend's link (?ref=username): remembered, so the sign-up later still knows who invited (the first link wins). */
export function captureRef() {
  try {
    const ref = new URLSearchParams(window.location.search).get("ref")?.trim().replace(/^@/, "");
    if (!ref || !/^[A-Za-z0-9._]{3,20}$/.test(ref)) return;
    // the link's click, once per browser (its owner sees it on their dashboard), whoever's invite is kept
    clickOnce(ref.toLowerCase(), (r) => fetch("/api/marketing/click", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ref: r }) }));
    const old = JSON.parse(localStorage.getItem(REF_KEY) || "null") as { ref: string; at: number } | null;
    if (old && Date.now() - old.at < REF_DAYS * 864e5) return;
    localStorage.setItem(REF_KEY, JSON.stringify({ ref: ref.toLowerCase(), at: Date.now() }));
  } catch { /* private mode: no invite remembered */ }
}
export function savedRef(): string | undefined {
  try {
    const v = JSON.parse(localStorage.getItem(REF_KEY) || "null") as { ref: string; at: number } | null;
    return v && Date.now() - v.at < REF_DAYS * 864e5 ? v.ref : undefined;
  } catch { return undefined; }
}
/** count the link's click once per browser (not every page of the visit) */
export function clickOnce(ref: string, send: (ref: string) => Promise<unknown>) {
  try { const k = `shubix-ref-click-${ref}`; if (localStorage.getItem(k)) return; localStorage.setItem(k, "1"); } catch { return; }
  void send(ref).catch(() => {});
}
export type AffiliateDetail = {
  id: string; username: string; email?: string; status: "pending" | "active" | "paused"; percent: number; months: number; monthsOwn: number | null; validUntil: string | null; since: string | null;
  link: string; minPayout: number;
  stats: { clicks: number; clicks30: number; customers: number; buyers: number; sales: number; revenue: number; due: number; paid: number };
  customers: { username: string; email?: string; joined: string; paid: number; commission: number; countsUntil: string | null }[];
  sales: { id: string; at: string; customer: string; paid: number; percent: number; commission: number; status: string; paidAt: string | null }[];
  payouts: { id: string; at: string; total: number; count: number; note?: string }[];
  payout: PayoutDetails | null;
};
/** where an affiliate is paid (the partner sees their account number's last 4 only) */
export type PayoutDetails = { method: "upi"; upi: string; updatedAt: string | null } | { method: "bank"; name: string; account: string; ifsc: string; updatedAt: string | null };
export type PayoutInput = { method: "upi"; upi: string } | { method: "bank"; name: string; account: string; ifsc: string };
export function clearRef() { try { localStorage.removeItem(REF_KEY); } catch { /* nothing kept */ } }

export type RewardStep = "signup" | "verified" | "purchase";
export type MyMarketing = {
  username: string; link: string;
  referral: { on: boolean; inviterCredits: number; inviteeCredits: number; inviteeOn: RewardStep; inviterOn: RewardStep; invited: number; rewarded: number; earned: number };
  share: { on: boolean; min: number; max: number; dailyMax: number; source: "extra" | "all"; sentToday: number };
  ai: { planAi: boolean; freeWithCredits: boolean; reelCost: number };
  affiliate: { on: boolean; applyOpen: boolean; percent: number; months: number; minPayout: number;
    me: { status: "pending" | "active" | "paused"; percent: number; months: number; validUntil: string | null; due: number; paid: number; sales: number; recent: { at: string; paid: number; commission: number; status: string }[] } | null };
};
import type { Offer } from "@shubix/types";
export type { Offer, Quote } from "@shubix/types";
export type MarketingSettings = {
  referral: { on: boolean; inviterCredits: number; inviteeCredits: number; inviteeOn: RewardStep; inviterOn: RewardStep; monthlyCap: number };
  share: { on: boolean; min: number; max: number; dailyMax: number; source: "extra" | "all" };
  affiliate: { on: boolean; percent: number; months: number; minPayout: number; applyOpen: boolean };
  ai: { freeWithCredits: boolean };
  emails: { notes: boolean; cartReminder: boolean; cartHours: number };
};
export type MarketingReport = {
  referrals: { total: number; last30: number; rewarded: number }; coupons: { total: number; uses30: number; discount30: number };
  transfers: { count30: number; credits30: number }; affiliates: { due: number; paid: number }; topInviters: { username: string; email: string; invited: number }[];
};
export type Coupon = { code: string; kind: "percent" | "flat"; value: number; appliesTo: "all" | "plans" | "topups"; audience: "all" | "new"; minAmount: number; maxUses: number;
  perUserOnce: boolean; starts: string | null; ends: string | null; active: boolean; note: string; uses: number; live: boolean };
export type AdminOffer = Offer & { starts: string | null; active: boolean; live: boolean };
export type Affiliate = { id: string; email: string; username: string; status: "pending" | "active" | "paused"; percent: number; months: number | null; validUntil: string | null; payout: boolean; createdAt: string; note: string; partnerOnly: boolean; brought: number; due: number; paid: number; sales: number };
/** the partner dashboard: who is here (via: their Shubix session, or a partner-only one; null: signed out), the terms */
export type PartnerMe = {
  via: "shubix" | "partner" | null; email: string | null; affiliate: AffiliateDetail | null;
  program: { on: boolean; applyOpen: boolean; percent: number; months: number; minPayout: number };
};
