import { adminEmails } from "./core/admin";
import crypto from "node:crypto";
import { z } from "zod";
import { getProvider } from "./ai";
import { currentUser } from "./core/auth";
import { mainDb, ObjectId } from "./core/db";
import { NotFoundError } from "./core/errors";
import { esc, frame, mailParts as P, sendMail } from "./core/mail";
import { getContent } from "./content";
import { getMarketing } from "./marketing";
import { getSite } from "./site";
import { COST_LABELS, getPricing } from "./workspace";
import { listDef } from "@shubix/core/lib/collections";

/** Support: the Contact page's messages (emailed to the support address with the person as Reply-To, a copy kept for
 * Admin → Support, and a "we got it" email back with a ticket number), and the Help chat (an AI that answers questions
 * about Shubix from the app's own plans, prices, costs, rules and questions, and sends people to Contact when a person is
 * needed). Admin → Support switches the chat on or off. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const col = async (name: string) => (await mainDb()).collection<any>(name);
const SETTINGS_ID = "support";

export type SupportSettings = { chat: boolean; autoReply: boolean };
const DEFAULTS: SupportSettings = { chat: true, autoReply: true };
export async function getSupport(): Promise<SupportSettings> {
  const d = await (await col("app_settings")).findOne({ _id: SETTINGS_ID });
  return { chat: d?.chat ?? DEFAULTS.chat, autoReply: d?.autoReply ?? DEFAULTS.autoReply };
}
export const SupportIn = z.object({ chat: z.boolean(), autoReply: z.boolean() }).partial();
export async function setSupport(p: z.infer<typeof SupportIn>) {
  await (await col("app_settings")).updateOne({ _id: SETTINGS_ID }, { $set: { ...p, updatedAt: new Date() } }, { upsert: true });
  return getSupport();
}

// ---------------------------------------------------------------- Contact: a message to the team
export const TOPICS = ["account", "payment", "reels", "rewards", "other"] as const;
const TOPIC_NAMES: Record<(typeof TOPICS)[number], string> = { account: "Account & sign-in", payment: "Payments & credits", reels: "Making Reels", rewards: "Invites & affiliates", other: "Something else" };
export const ContactIn = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
  name: z.string().trim().max(80).default(""),
  topic: z.enum(TOPICS).default("other"),
  message: z.string().trim().min(10, "Tell us a little more (10 characters at least).").max(4000),
  page: z.string().max(200).default(""),
  website: z.string().max(200).default(""), // a hidden field: people leave it empty, form-filling bots do not
});
export async function sendContact(d: z.infer<typeof ContactIn>) {
  const ticket = `T-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  if (d.website) return { ok: true, ticket }; // a bot: thanked, nothing sent
  const uid = currentUser(), site = await getSite(), s = await getSupport();
  const user = uid && ObjectId.isValid(uid) ? await (await col("users")).findOne({ _id: new ObjectId(uid) }, { projection: { email: 1, username: 1 } }) : null;
  const w = uid ? await (await col("wallets")).findOne({ _id: uid }) : null;
  await (await col("support_messages")).insertOne({ _id: ticket, userId: uid ?? null, email: d.email, name: d.name, topic: d.topic, message: d.message, page: d.page,
    status: "open", at: new Date(), account: user ? { email: user.email, username: user.username ?? null, plan: w?.plan ?? "free" } : null });

  const to = site.supportEmail || (await adminEmails()).join(", ");
  const who = `${d.name ? `${d.name} · ` : ""}${d.email}${user ? ` (account @${user.username ?? "—"}, ${w?.plan ?? "free"} plan${user.email !== d.email ? `, signed in as ${user.email}` : ""})` : " (not signed in)"}`;
  if (to) {
    const html = frame(`${TOPIC_NAMES[d.topic]} · ${d.message.slice(0, 80)}`,
      P.eyebrow(`New message · ${ticket}`) + P.heading(TOPIC_NAMES[d.topic])
      + P.row(`<p style="margin:0;font-family:${P.SANS};font-size:13px;color:${P.SOFT}">From ${esc(who)}${d.page ? `<br>Page: ${esc(d.page)}` : ""}</p>`, "0 0 16px 0")
      + P.row(`<div style="font-family:${P.SANS};font-size:15px;line-height:1.65;color:${P.INK};white-space:pre-wrap;background:#faf8fd;border:1px solid ${P.RULE};border-radius:14px;padding:16px 18px">${esc(d.message)}</div>`, "0 0 18px 0")
      + P.note("Reply to this email to answer them directly. Admin → Support keeps every message."));
    await sendMail(to, `[${ticket}] ${TOPIC_NAMES[d.topic]}: ${d.message.slice(0, 60).replace(/\s+/g, " ")}`, `${ticket} · ${TOPIC_NAMES[d.topic]}\nFrom ${who}\n\n${d.message}\n`, html, { replyTo: d.email });
  }
  if (s.autoReply) {
    const html = frame(`We got your message (${ticket})`,
      P.eyebrow(`Ticket ${ticket}`) + P.heading("We got your message") + P.para(`Thanks for writing to ${site.businessName}. Our team replies within 3 working days, usually much sooner, to ${d.email}.`)
      + P.row(`<div style="font-family:${P.SANS};font-size:14px;line-height:1.6;color:${P.BODY};white-space:pre-wrap;background:#faf8fd;border:1px solid ${P.RULE};border-radius:14px;padding:14px 16px">${esc(d.message)}</div>`, "0 0 18px 0")
      + P.note(`Keep this ticket number (${ticket}) if you write to us again about the same thing.`));
    await sendMail(d.email, `We got your message · ${ticket}`, `We got your message (${ticket}). Our team replies within 3 working days.\n\nYour message:\n${d.message}\n`, html, site.supportEmail ? { replyTo: site.supportEmail } : {});
  }
  return { ok: true, ticket };
}

// Admin → Support: the messages and the chat's recent questions
export async function supportInbox(status: "open" | "done" | "all" = "open") {
  const q = status === "all" ? {} : { status };
  const [messages, open, questions] = await Promise.all([
    (await col("support_messages")).find(q).sort({ at: -1 }).limit(200).toArray(),
    (await col("support_messages")).countDocuments({ status: "open" }),
    (await col("support_chats")).find({}).sort({ at: -1 }).limit(60).toArray(),
  ]);
  return {
    settings: await getSupport(), open,
    messages: messages.map((m) => ({ id: String(m._id), email: m.email, name: m.name, topic: m.topic, message: m.message, page: m.page, status: m.status, at: m.at, account: m.account ?? null })),
    questions: questions.map((c) => ({ q: c.q, needsHuman: !!c.needsHuman, at: c.at, signedIn: !!c.userId })),
  };
}
export async function setMessageStatus(id: string, status: "open" | "done") {
  const r = await (await col("support_messages")).updateOne({ _id: id }, { $set: { status, updatedAt: new Date() } });
  if (!r.matchedCount) throw new NotFoundError("No such message.", { code: "MESSAGE_NOT_FOUND" });
  return { ok: true };
}

// ---------------------------------------------------------------- the Help chat
export const ChatIn = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(1200) })).min(1).max(16),
  page: z.string().max(200).default(""),
});
const Answer = z.object({
  answer: z.string().min(1).max(1800),
  needsHuman: z.boolean().default(false),
  suggestions: z.array(z.string().max(80)).max(3).default([]),
});
/** The app's own facts, read fresh: plans, prices, credits, costs, the invite and affiliate rules, the questions in the
 * CMS, how to reach the team. The AI answers from these only. */
async function knowledge() {
  const [p, m, content, site] = await Promise.all([getPricing(), getMarketing(), getContent(), getSite()]);
  const plans = p.plans.filter((x) => !x.hidden).map((x) => `- ${x.name}: ${x.monthly ? `₹${x.monthly}/month` : "free"}${x.credits ? `, ${x.credits} credits a month` : ""}${x.ai ? ", Shubix AI" : ", no Shubix AI"}${x.ads ? ", shows ads" : ", no ads"}${x.freeChats ? `, ${x.freeChats} free Ask Shubix changes per Reel` : ""}. ${x.features.join("; ")}`).join("\n");
  const tops = p.topUps.map((t) => `${t.credits} credits for ₹${t.price}`).join(", ");
  const costs = Object.entries(p.costs).filter(([, c]) => c > 0).map(([k, c]) => `- ${COST_LABELS[k] ?? k}: ${c} credit${c === 1 ? "" : "s"}`).join("\n");
  const faq = (content["pricing.faq"] ?? listDef("pricing.faq").items).filter((f) => f.q && f.a).map((f) => `Q: ${f.q}\nA: ${f.a}`).join("\n");
  const r = m.referral, step = (s: string) => (s === "signup" ? "signs up" : s === "verified" ? "verifies their email" : "makes a first purchase");
  return `ABOUT: ${site.businessName} (Shubix) is an AI Reel maker for Instagram Reels, YouTube Shorts and similar, in the browser on phone and computer.
WAYS TO MAKE A REEL (Home → Create): Beat Reel (a song + your clips, cut on the beat), Talking Reel (you speaking, with captions), Photo Reel (photos to the beat), Match a Reel's Style (use a reference Reel's style; Editor plan and up), Story Maker (a story Reel from just a text idea, with pictures made for each scene; Editor and up), Templates (Editor and up), Brand kit and Voice profiles (Pro).
EDITOR: timeline with clips, text, stickers, music, filters, effects, transitions and speed; formats 9:16, 4:5, 1:1, 16:9 (the format menu above the preview); export in 1080p (Free adds a small watermark); "Without the song" option in the Export dialog for adding the music in Instagram. Drafts are kept on the device and in My Reels.
SHUBIX AI: picks the best moments, transitions and captions for you. Before it starts, a pop-up shows the credits it will use (Use to start, ✕ to stop). Ask Shubix (the chat above a Reel) changes a made Reel from your words; it always confirms first.
PLANS (prices include GST, nothing renews by itself, all purchases are final and non-refundable):
${plans}
TOP-UPS: ${tops || "none"}. Top-up and gift credits never expire; a plan's monthly credits renew each month and do not carry over. If a Reel fails, its credits come back automatically.
${m.ai.freeWithCredits ? "On Free, credits (from invites, gifts, top-ups) can pay for Shubix AI." : "Shubix AI is for paid plans only."}
CREDIT COSTS:
${costs}
COUPONS & OFFERS: a coupon code is entered at checkout ("Your order" panel on Pricing); a running sale shows on Pricing and in a bar on top.
INVITE & EARN (menu → Invite & earn): ${r.on ? `share your link; your friend gets ${r.inviteeCredits} credits when they ${step(r.inviteeOn)}, you get ${r.inviterCredits} when they ${step(r.inviterOn)} (up to ${r.monthlyCap} rewarded invites a month).` : "invites are paused."} ${m.share.on ? `Send ${m.share.min}–${m.share.max} credits to a friend by their username (top-up and gift credits only), up to ${m.share.dailyMax} a day.` : ""}
AFFILIATES: ${m.affiliate.on ? `apply on Invite & earn; once approved you earn ${m.affiliate.percent}% of what the people you bring pay, for ${m.affiliate.months} months each, only on successful payments; paid by UPI or bank transfer from ₹${m.affiliate.minPayout} (add payout details on the Affiliate dashboard).` : "the program is closed."}
ACCOUNT: sign up with email and password; confirm the email with the 6-digit code we email (also from the banner, "Enter code"); forgot password: Sign in → "Forgot your password?" → enter the 6-digit code from the email and a new password. Change password, sign out everywhere and delete the account: My account.
PAYMENTS: Razorpay (UPI, cards, net banking). A receipt is emailed after every payment. Charged twice or a plan not added: write to support with the receipt number.
PRIVACY: uploaded clips are deleted automatically after a while; download finished Reels to keep them. Phone apps: Google Play and App Store (coming soon if no link yet); the website can also be installed ("Install the app").
CONTACT: the Contact page (/contact)${site.supportEmail ? `, email ${site.supportEmail}` : ""}${site.supportPhone ? `, WhatsApp ${site.supportPhone}` : ""}. Replies within 3 working days.
QUESTIONS PEOPLE ASK:
${faq}`;
}
const PAGES = "/ (Home), /create/music, /create/talking, /create/photo, /create/copy, /create/story, /templates, /reels (My Reels), /pricing, /rewards (Invite & earn), /affiliate, /account (My account), /contact, /forgot, /terms, /privacy, /refunds";

/** One answer from the Help chat. Never throws for an AI problem: then it says so and points to Contact. */
export async function helpChat(d: z.infer<typeof ChatIn>) {
  const s = await getSupport();
  if (!s.chat) throw new NotFoundError("The help chat is off.", { code: "HELP_OFF" });
  const uid = currentUser(), w = uid ? await (await col("wallets")).findOne({ _id: uid }) : null;
  const u = uid && ObjectId.isValid(uid) ? await (await col("users")).findOne({ _id: new ObjectId(uid) }, { projection: { emailVerified: 1 } }) : null;
  const person = uid ? `The person is signed in: ${w?.plan ?? "free"} plan, ${Number(w?.monthly ?? 0) + Number(w?.extra ?? 0)} credits, email ${u?.emailVerified === false ? "NOT verified yet" : "verified"}.` : "The person is not signed in.";
  const system = `You are Shubix Help, the friendly support assistant inside the Shubix app. Answer ONLY from the facts below; they are the truth about the app right now.
Rules:
- Be brief and warm: 1-4 short sentences or a few short steps, under 110 words. Plain text; you may link app pages as [label](/path) using only these paths: ${PAGES}.
- Reply in the person's language (English, Hindi or Hinglish as they write).
- Only help with Shubix. For anything else, say politely that you can only help with Shubix.
- Never invent features, prices, limits or dates. If the facts do not cover it, say you are not sure and set needsHuman true.
- Never promise refunds (all purchases are non-refundable), never ask for passwords, OTP codes, card or bank details, and never say you did something to their account: you cannot change anything, only explain.
- Set needsHuman true for: a payment taken but nothing added, charged twice, a bug that keeps happening, account access problems the steps did not fix, or when they ask for a person.
- suggestions: up to 3 short follow-up questions they might ask next (in their language), or none.
${person}${d.page ? ` They are on the page ${d.page}.` : ""}

FACTS:
${await knowledge()}`;
  const last = d.messages[d.messages.length - 1].content;
  // the last 10 turns, starting with a question (some AI services refuse a talk that starts with their own answer) and ending with one
  let talk = d.messages.slice(-10);
  while (talk.length && talk[0].role !== "user") talk = talk.slice(1);
  if (!talk.length || talk[talk.length - 1].role !== "user") talk = [{ role: "user", content: last }];
  let out: z.infer<typeof Answer>;
  try {
    out = await getProvider("support_chat").structured(system, last, Answer, { task: "support_chat", temperature: 0.2, maxOutputTokens: 600, messages: talk }); // the whole talk, its last question included (with messages, the providers read them, not `user`)
  } catch (e) {
    console.warn(`help chat: ${(e as Error).message}`);
    out = { answer: "Sorry, I can't answer right now. Please try again in a minute, or send your question to our team from the [Contact page](/contact).", needsHuman: true, suggestions: [] };
  }
  await (await col("support_chats")).insertOne({ userId: uid ?? null, q: last.slice(0, 500), needsHuman: out.needsHuman, at: new Date() }).catch(() => {});
  return out;
}
