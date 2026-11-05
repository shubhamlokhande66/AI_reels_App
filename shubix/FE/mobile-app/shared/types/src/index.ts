/** Types shared by FE/web-app, FE/mobile-app and BE/api. */
export type SessionUser = { id: string; email: string; emailVerified: boolean; username: string | null; codeWait?: number };
export type MeResponse = { authEnabled: boolean; user: SessionUser | null };
/** `token` is only sent to the phone app (X-Client: mobile); the website gets an httpOnly cookie. */
export type AuthResponse = { user: SessionUser; token?: string };
export type OkResponse = { ok: true; wait?: number; email?: string; sent?: boolean; verified?: boolean };
/** Every API error, the same shape as the current server: { error: { code, message, details } } */
export type ApiErrorBody = { error: { code: string; message: string; details: unknown } };
export type PlanId = "free" | "creator" | "pro" | "business";

/** A finished Reel kept in the account (My Reels → Saved), and the account's room for them. */
export type CloudReel = {
  id: string; name: string; size: number; type: string; dur: number; width: number; height: number; fps: number;
  thumb: string | null; createdAt: string; shared: boolean; shareUrl: string | null;
};
export type CloudUsage = { used: number; limit: number; plan: string; cloud: boolean; keepDays?: number };

/** Plans and credits (pricing page). */
export interface Pricing {
  currency: string;
  yearlyMonthsCharged: number;
  plans: {
    id: string;
    name: string;
    monthly: number;
    yearly: number;
    credits: number;
    creditsNote: string;
    tagline: string;
    highlight: boolean;
    /** Shubix AI in this plan (Free: the phone edits); ads shown; not offered on the pricing page */
    ai?: boolean;
    ads?: boolean;
    hidden?: boolean;
    /** Ask Shubix changes per Reel that use no credits */
    freeChats?: number;
    features: string[];
  }[];
  topUps: { id: string; credits: number; price: number }[];
  costLabels?: Record<string, string>;
  creditCosts: { id: string; action: string; credits: number }[];
  costs: Record<string, number>;
  paymentsOpen: boolean;
  billingEnabled: boolean;
}

/** The signed-in user's credits (billing on). */
export type Credits =
  | { enabled: false; billing?: boolean } // billing: on, but nobody signed in
  | {
      enabled: true;
      balance: number;
      monthly: number;
      extra: number;
      plan: string;
      planName: string;
      period: "monthly" | "yearly" | null;
      planEnds: string | null;
      renews: string | null;
      history: { delta: number; reason: string; at: string; balance: number | null }[];
    };
/** A price worked out by the server before paying (the offer, a coupon), and a sale running. */
export type Quote = {
  item: string; label: string; base: number; final: number; couponError: string;
  offer: { id: string; title: string; percent: number; off: number } | null; coupon: { code: string; off: number; label: string } | null;
};
export type Offer = { id: string; title: string; banner: string; percent: number; appliesTo: "all" | "plans" | "topups"; audience: "all" | "new"; ends: string | null };

/** Invite & earn: when a reward is given, and what the server says about this person (Admin → Marketing). */
export type RewardStep = "signup" | "verified" | "purchase";
export type MyMarketing = {
  username: string; link: string;
  referral: { on: boolean; inviterCredits: number; inviteeCredits: number; inviteeOn: RewardStep; inviterOn: RewardStep; invited: number; rewarded: number; earned: number };
  share: { on: boolean; min: number; max: number; dailyMax: number; source: "extra" | "all"; sentToday: number };
  ai: { planAi: boolean; freeWithCredits: boolean; reelCost: number };
  affiliate: { on: boolean; applyOpen: boolean; percent: number; months: number; minPayout: number;
    me: { status: "pending" | "active" | "paused"; percent: number; months: number; validUntil: string | null; due: number; paid: number; sales: number; recent: { at: string; paid: number; commission: number; status: string }[] } | null };
};
