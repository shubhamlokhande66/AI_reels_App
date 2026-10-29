import { z } from "zod";
import { RefMoment } from "./direct";
import { createHash } from "node:crypto";
import { currentUser } from "../core/auth";
import { db, mainDb, parseId } from "../core/db";
import { NotFoundError } from "../core/errors";
import SEEDS from "./seed-styles.json";

/** Fast Studio's style library: every Reel a creator gives as a reference is measured on the phone ("Copy a Reel") and
 * only its style fingerprint is kept here (never the video): its pace in beats, the mix of transitions, how often shots
 * zoom, the colour look, its length. Fingerprints are grouped by kind of Reel (wedding, travel, festival...); a learned
 * style is what the Reels of one kind have in common, shifted by the corrections the creator makes to the edits. Mine are
 * private (the user's view of the database); shared ones also teach everyone's learned styles. How well a learned style
 * predicts a new Reel of its kind is measured by leaving each Reel out in turn. */

export const CATEGORIES = ["wedding", "travel", "festival", "dance", "talking", "product", "food", "fitness", "vlog", "birthday", "car", "shop", "event", "other"] as const;
export const KINDS = ["hard", "flash", "fade", "whip", "zoom", "dissolve", "glitch", "spin", "iris", "diamond", "heart", "star", "wipe", "bars", "blur"] as const;
const FIELDS = ["tr", "efx", "sp"] as const;
const num = (a: number, b: number) => z.number().finite().min(a).max(b);
export const Look = z.object({ mean: num(0, 1), std: num(0, 1), sat: num(0, 2), warm: num(-1, 1), p5: num(0, 1), p95: num(0, 1), vig: num(-1, 1), grain: num(0, 1), split: num(-1, 1) }).partial();
export const Fingerprint = z.object({
  dur: num(1, 600), bpm: num(0, 300), medianBeats: num(0, 64), medianSec: num(0, 60), hookBeats: num(0, 64), hookSec: num(0, 60),
  onBeat: num(0, 1), energy: z.enum(["steady", "rising", "falling"]), zoomShare: num(0, 1),
  trans: z.partialRecord(z.enum(KINDS), num(0, 1)), look: Look.nullable().default(null),
  shotBeats: z.array(num(0, 64)).max(300).default([]), shotSec: z.array(num(0, 60)).max(300).default([]),
  /** shot by shot: the transition into it, its zoom and the music under it, so the AI can copy what it does where */
  moments: z.array(RefMoment).max(200).default([]),
});
export type Fingerprint = z.infer<typeof Fingerprint>;
export const SaveIn = z.object({ name: z.string().trim().min(1).max(120), category: z.enum(CATEGORIES), shared: z.boolean().default(false), fp: Fingerprint });
/** a Reel a creator gave to "Copy a Reel": offered to the administrator, who decides whether it teaches the styles */
/** from: "copy" a Reel a creator gave to Copy a Reel, "made" one they made and saved (downloaded, shared, kept) */
export const SuggestIn = z.object({ name: z.string().trim().min(1).max(120), fp: Fingerprint, from: z.enum(["copy", "made"]).default("copy") });
export const ApproveIn = z.object({ id: z.string().max(40), category: z.enum(CATEGORIES) });
export const EditsIn = z.object({ category: z.enum([...CATEGORIES, "general"] as [string, ...string[]]),
  edits: z.array(z.object({ type: z.enum(["drop", "hit", "cut", "break"]), field: z.enum(FIELDS), from: z.string().max(24), to: z.string().max(24),
    /** the choice that was changed was the AI director's (how often people undo the AI is how good it is) */
    ai: z.boolean().optional() })).min(1).max(100) });

const median = (a: number[]) => { const q = a.filter(Number.isFinite).sort((x, y) => x - y); if (!q.length) return 0; const m = q.length >> 1; return q.length % 2 ? q[m] : (q[m - 1] + q[m]) / 2; };
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const norm = (t: Record<string, number>) => { const s = Object.values(t).reduce((a, b) => a + Math.max(0, b), 0) || 1; return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Math.max(0, v) / s]).filter(([, v]) => (v as number) > 1e-4)); };

/** what Reels of one kind have in common: typical numbers (medians), the average transition mix and look, and the
 * rhythm (shot-by-shot beats) of the most typical Reel among them, so the pattern is a real one */
export function learn(fps: Fingerprint[]): Fingerprint | null {
  if (!fps.length) return null;
  const m = (k: keyof Fingerprint) => median(fps.map((f) => Number(f[k])));
  // a Reel without a steady beat has 0 here (it is paced in seconds): it does not pull the others' beats down
  const mb = (k: "medianBeats" | "hookBeats" | "bpm") => { const v = fps.map((f) => Number(f[k])).filter((x) => x > 0); return v.length * 2 >= fps.length ? median(v) : 0; };
  // each transition's typical share: the median over the Reels (one Reel made of flashes does not turn the style into
  // flashes); with 1-2 Reels, their average
  const trans: Record<string, number> = {}, tk = [...new Set(fps.flatMap((f) => Object.keys(f.trans)))];
  for (const k of tk) { const v = fps.map((f) => Number(f.trans[k as keyof typeof f.trans] ?? 0)); trans[k] = fps.length >= 3 ? median(v) : mean(v); }
  if (!Object.values(trans).some((v) => v > 0)) for (const f of fps) for (const [k, v] of Object.entries(f.trans)) trans[k] = (trans[k] ?? 0) + v / fps.length;
  const looks = fps.map((f) => f.look).filter(Boolean) as z.infer<typeof Look>[];
  // each colour number averaged over the Reels that have it
  const lookKeys = [...new Set(looks.flatMap((l) => Object.keys(l)))] as (keyof z.infer<typeof Look>)[];
  const look = looks.length ? Object.fromEntries(lookKeys.map((k) => [k, +mean(looks.filter((l) => Number.isFinite(l[k])).map((l) => Number(l[k]))).toFixed(4)])) : null;
  const beatsPace = mb("medianBeats"), pace = beatsPace || m("medianSec"), paceOf = (f: Fingerprint) => (beatsPace ? f.medianBeats : f.medianSec);
  // the Reel whose rhythm is copied: the most typical one paced the same way (in beats or in seconds)
  const same = fps.filter((f) => (beatsPace ? f.medianBeats > 0 && f.shotBeats.length > 0 : f.shotSec.length > 0));
  const typical = (same.length ? same : fps).reduce((best, f) => (Math.abs(paceOf(f) - pace) + Math.abs(f.zoomShare - m("zoomShare")) < Math.abs(paceOf(best) - pace) + Math.abs(best.zoomShare - m("zoomShare")) ? f : best), (same.length ? same : fps)[0]);
  const energies = ["steady", "rising", "falling"] as const;
  return {
    dur: m("dur"), bpm: mb("bpm"), medianBeats: beatsPace, medianSec: m("medianSec"), hookBeats: beatsPace ? mb("hookBeats") : 0, hookSec: m("hookSec"), onBeat: m("onBeat"),
    energy: energies.reduce((a, e) => (fps.filter((f) => f.energy === e).length > fps.filter((f) => f.energy === a).length ? e : a), "steady" as Fingerprint["energy"]),
    zoomShare: m("zoomShare"), trans: norm(trans) as Fingerprint["trans"], look: look as Fingerprint["look"], shotBeats: typical.shotBeats, shotSec: typical.shotSec, moments: typical.moments ?? [],
  };
}
/** the style served and measured: what the Reels share (learn), pulled toward the default when they differ a lot */
export function learnStyle(fps: Fingerprint[]): Fingerprint | null { const l = learn(fps); return l && shrink(l, fps); }
/** A style learned from a few Reels that differ a lot (a 0.4 s montage and a 4 s showroom walk of the same kind) is
 * pulled toward the default style: alone they predict a new Reel of their kind worse than the default (measured on the
 * app's own seed Reels). Reels that agree are not pulled at all; the pull fades as Reels are taught (weight n / (n + k),
 * k up to 3 for Reels far apart). The rhythm (shot by shot, from the most typical Reel) always stays its own. */
function shrink(fp: Fingerprint, fps: Fingerprint[]): Fingerprint {
  const spread = median(fps.map((f) => distance(fp, f).total)), k = spread < 0.15 ? 0 : Math.min(3, (spread - 0.15) * 10);
  if (!k) return fp;
  const n = fps.length, w = n / (n + k), D = DEFAULT_STYLE, mix = (a: number, b: number) => w * a + (1 - w) * b;
  const tr: Record<string, number> = {};
  for (const k of new Set([...Object.keys(fp.trans), ...Object.keys(D.trans)])) tr[k] = mix(Number(fp.trans[k as keyof typeof fp.trans] ?? 0), Number(D.trans[k as keyof typeof D.trans] ?? 0));
  const look = fp.look ? Object.fromEntries(Object.entries(fp.look).map(([k, v]) => { const d = (D.look as Record<string, number> | null)?.[k]; return [k, Number.isFinite(d) ? +mix(Number(v), d as number).toFixed(4) : v]; })) : fp.look;
  const geo = (a: number, b: number) => (a > 0 && b > 0 ? Math.exp(mix(Math.log(a), Math.log(b))) : a);
  return { ...fp, trans: norm(tr) as Fingerprint["trans"], zoomShare: +mix(fp.zoomShare, D.zoomShare).toFixed(3), medianBeats: fp.medianBeats ? +geo(fp.medianBeats, D.medianBeats).toFixed(2) : 0,
    medianSec: +geo(fp.medianSec, D.medianSec).toFixed(2), look: look as Fingerprint["look"] };
}

/** the creator's corrections move the transition mix: each change from one kind to another shifts a little share */
export function withCorrections(fp: Fingerprint, edits: { field: string; from: string; to: string }[]): Fingerprint {
  const tr = edits.filter((e) => e.field === "tr" && e.from !== e.to); if (!tr.length) return fp;
  // the studio's names of the transitions the reference reader knows (the others, a push or a page turn, are not in a style)
  const map: Record<string, string> = { hard: "hard", flash: "flash", dip: "fade", fadein: "fade", whip: "whip", zoom: "zoom", dissolve: "dissolve", glitch: "glitch", spin: "spin",
    iris: "iris", diamond: "diamond", heart: "heart", star: "star", wipe: "wipe", bars: "bars", blur: "blur" };
  const t: Record<string, number> = { ...fp.trans }, step = Math.min(0.5, 1 / Math.max(4, tr.length));
  for (const e of tr) { const a = map[e.from], b = map[e.to]; if (a) t[a] = (t[a] ?? 0) - step * 0.5 * (t[a] ?? 0); if (b) t[b] = (t[b] ?? 0) + step * 0.5 * (1 - (t[b] ?? 0)); }
  return { ...fp, trans: norm(t) as Fingerprint["trans"] };
}

/** how far a predicted style is from a real Reel, 0 (same) .. 1: pace, transition mix, zooms, look */
export function distance(p: Fingerprint, r: Fingerprint): { pace: number; trans: number; zoom: number; look: number; total: number } {
  const pp = p.medianBeats || p.medianSec, rp = r.medianBeats || r.medianSec;
  const pace = Math.min(1, Math.abs(Math.log2(Math.max(0.1, pp) / Math.max(0.1, rp))));   // one octave off = 1
  const ks = new Set([...Object.keys(p.trans), ...Object.keys(r.trans)]); let l1 = 0; for (const k of ks) l1 += Math.abs((p.trans[k as keyof typeof p.trans] ?? 0) - (r.trans[k as keyof typeof r.trans] ?? 0));
  const trans = l1 / 2, zoom = Math.abs(p.zoomShare - r.zoomShare);
  const pl = p.look ?? {}, rl = r.look ?? {}, lk = ["mean", "std", "sat", "warm"] as const;
  const look = Math.min(1, lk.reduce((s, k) => s + Math.abs(Number(pl[k] ?? 0) - Number(rl[k] ?? 0)), 0) / lk.length * 3);
  return { pace, trans, zoom, look, total: 0.35 * pace + 0.35 * trans + 0.15 * zoom + 0.15 * look };
}
/** leave each Reel out, learn from the rest, see how close the learned style is to the one left out; against a style
 * that knows nothing (the app's default: a cut every 2 beats, mostly hard cuts, a few zooms, a neutral look) */
export const DEFAULT_STYLE: Fingerprint = { dur: 15, bpm: 120, medianBeats: 2, medianSec: 1, hookBeats: 4, hookSec: 2, onBeat: 0.8, energy: "steady", zoomShare: 0.2,
  trans: { hard: 0.8, flash: 0.1, whip: 0.1 }, look: { mean: 0.45, std: 0.22, sat: 0.35, warm: 0 }, shotBeats: [], shotSec: [], moments: [] };
export function accuracy(fps: Fingerprint[]): { n: number; learned: number; baseline: number } | null {
  if (fps.length < 3) return null;
  let a = 0, b = 0;
  fps.forEach((f, i) => { const rest = fps.filter((_, j) => j !== i); a += distance(learnStyle(rest)!, f).total; b += distance(DEFAULT_STYLE, f).total; });
  return { n: fps.length, learned: +(1 - a / fps.length).toFixed(3), baseline: +(1 - b / fps.length).toFixed(3) };
}

// ---- storage: fingerprints (mine: the user's view; shared: everyone's, read-only here), corrections
const mine = async () => (await db()).collection("studio_styles");
const everyone = async () => (await mainDb()).collection("studio_styles");
const editsCol = async () => (await db()).collection("studio_style_edits");
const summary = (f: Fingerprint) => ({ pace: f.medianBeats ? `${f.medianBeats} beats/shot` : `${f.medianSec.toFixed(1)} s/shot`, trans: Object.entries(f.trans).sort((x, y) => y[1] - x[1]).slice(0, 2).map(([k, v]) => `${Math.round(v * 100)}% ${k}`).join(", ") });

export async function saveStyle(d: z.infer<typeof SaveIn>) {
  const doc = { name: d.name, category: d.category, shared: d.shared, fp: d.fp, createdAt: new Date() };
  const r = await (await mine()).insertOne(doc);
  return { id: String(r.insertedId), name: d.name, category: d.category, shared: d.shared, ...summary(d.fp) };
}
export async function listStyles() {
  const docs = await (await mine()).find({}).sort({ createdAt: -1 }).limit(500).toArray();
  const counts: Record<string, { mine: number; shared: number }> = {};
  for (const c of CATEGORIES) counts[c] = { mine: 0, shared: seedCount(c) };   // the app's own Reels count as shared
  for (const d of docs) counts[d.category as string].mine++;
  for (const row of await (await everyone()).aggregate<{ _id: string; n: number }>([{ $match: { shared: true } }, { $group: { _id: "$category", n: { $sum: 1 } } }]).toArray()) if (counts[row._id]) counts[row._id].shared += row.n;
  return { mine: docs.map((d) => ({ id: String(d._id), name: d.name, category: d.category, shared: !!d.shared, createdAt: d.createdAt, ...summary(d.fp as Fingerprint) })), categories: counts };
}
export async function deleteStyle(id: string) {
  const r = await (await mine()).deleteOne({ _id: parseId(id) });
  if (!r.deletedCount) throw new NotFoundError("No such style.", { code: "STYLE_NOT_FOUND" });
  return { ok: true };
}
/** The styles the app ships with: Reels measured once (cuts to the frame, flickers, transitions) and kept as fingerprints,
 * so a learned style works before the administrator has taught any Reel of its kind; taught Reels join them. */
type Seed = { name: string; category: string; fp: unknown };
const seedFps = (category: string): Fingerprint[] => (SEEDS as Seed[]).filter((s) => s.category === category).flatMap((s) => { const r = Fingerprint.safeParse(s.fp); return r.success ? [r.data] : []; });
export const seedCount = (category: string) => (SEEDS as Seed[]).filter((s) => s.category === category).length;
/** the learned style of a kind: from my Reels, or from mine and everyone's shared ones (and the app's own); with my corrections */
export async function learnedStyle(category: string, scope: "mine" | "all") {
  if (!(CATEGORIES as readonly string[]).includes(category)) throw new NotFoundError("No such kind of Reel.", { code: "STYLE_CATEGORY" });
  const own = (await (await mine()).find({ category }).limit(500).toArray()).map((d) => d.fp as Fingerprint);
  const shared = scope === "all" ? (await (await everyone()).find({ category, shared: true }).limit(2000).toArray()).map((d) => d.fp as Fingerprint) : [];
  const fps = [...own, ...shared.filter((s) => !own.some((o) => JSON.stringify(o) === JSON.stringify(s))), ...(scope === "all" ? seedFps(category) : [])];
  const base = learnStyle(fps); if (!base) return { category, n: 0, fp: null, accuracy: null };
  const ed = await (await editsCol()).find({ category: { $in: [category, "general"] } }).sort({ at: -1 }).limit(300).toArray();
  return { category, n: fps.length, fp: withCorrections(base, ed as unknown as { field: string; from: string; to: string }[]), accuracy: accuracy(fps), corrections: ed.length };
}
export async function recordEdits(d: z.infer<typeof EditsIn>) {
  const at = new Date();
  await (await editsCol()).insertMany(d.edits.map((e) => ({ ...e, category: d.category, at })));
  return { ok: true, n: d.edits.length };
}

// ---- Reels from creators: only the administrator teaches the styles. A Reel a creator copies ("Copy a Reel") or makes
// and saves is kept here (its fingerprint, never the video) until the administrator uses it, under the kind they choose, or removes it.
const SUGGEST_MAX = 500;
const suggestions = async () => (await mainDb()).collection("studio_style_suggestions");
export async function suggestStyle(d: z.input<typeof SuggestIn>) {
  const col = await suggestions(), key = createHash("sha1").update(JSON.stringify(d.fp)).digest("hex");
  if (await col.countDocuments({}) >= SUGGEST_MAX) return { ok: true, kept: false };   // the administrator has plenty waiting
  await col.updateOne({ key }, { $setOnInsert: { key, name: d.name, fp: d.fp, from: d.from ?? "copy", by: currentUser() ?? null, createdAt: new Date() } }, { upsert: true });
  return { ok: true, kept: true };
}
export async function listSuggestions() {
  const docs = await (await suggestions()).find({}).sort({ createdAt: -1 }).limit(200).toArray();
  return { items: docs.map((d) => ({ id: String(d._id), name: String(d.name), from: d.from === "made" ? "made" : "copy", createdAt: d.createdAt, ...summary(d.fp as Fingerprint), bpm: Math.round((d.fp as Fingerprint).bpm), dur: Math.round((d.fp as Fingerprint).dur) })), total: await (await suggestions()).countDocuments({}) };
}
/** the administrator uses a creator's Reel: it becomes one of the administrator's shared styles of that kind */
export async function approveSuggestion(d: z.infer<typeof ApproveIn>) {
  const col = await suggestions(), doc = await col.findOne({ _id: parseId(d.id) });
  if (!doc) throw new NotFoundError("This Reel is no longer waiting.", { code: "SUGGESTION_NOT_FOUND" });
  const saved = await saveStyle({ name: String(doc.name), category: d.category, shared: true, fp: doc.fp as Fingerprint });
  await col.deleteOne({ _id: doc._id });
  return saved;
}
export async function removeSuggestion(id: string) {
  const r = await (await suggestions()).deleteOne({ _id: parseId(id) });
  if (!r.deletedCount) throw new NotFoundError("This Reel is no longer waiting.", { code: "SUGGESTION_NOT_FOUND" });
  return { ok: true };
}

// ---- what trending Reels of each kind do, for the AI (its brain and the learning combined) ----
/** One short line per kind, from the Reels this studio learned from (the app's seeds and everyone's shared styles):
 * pace, how many shots are flicker montages or quick cuts on the hits, the transition mix, camera zooms, a black end.
 * The AI reads it as a guide to place THIS song's cuts, never as a Reel to copy. Kept 10 minutes. */
let digestCache: { at: number; lines: Record<string, string> } | null = null;
export function kindLine(kind: string, fps: Fingerprint[]): string {
  const st = learnStyle(fps); if (!st) return "";
  const shots = fps.map((f) => f.moments ?? []).filter((m) => m.length > 2);
  const share = (test: (m: Fingerprint["moments"][number]) => boolean) => (shots.length ? median(shots.map((ms) => ms.filter(test).length / ms.length)) : 0);
  const flick = share((m) => !!m.flick), quick = share((m) => m.sec > 0 && m.sec < 0.25), black = fps.filter((f) => (f.moments ?? []).some((m) => m.black)).length / fps.length;
  const pace = st.medianBeats ? `a cut every ${st.medianBeats} beat${st.medianBeats === 1 ? "" : "s"}` : `a cut every ${st.medianSec.toFixed(1)} s`;
  const tr = Object.entries(st.trans).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${Math.round(v * 100)}% ${k}`).join(", ");
  const parts = [pace, `${Math.round(quick * 100)}% of shots are quick cuts under 0.25 s (on the hits)`, flick > 0 ? `${Math.round(flick * 100)}% flicker montages` : "", `transitions ${tr}`, `camera zooms in ${Math.round(st.zoomShare * 100)}% of shots`, black >= 0.5 ? "ends on black" : "", `pace ${st.energy}`];
  return `- ${kind} (${fps.length} Reels): ${parts.filter(Boolean).join("; ")}`;
}
export async function trendDigest(): Promise<Record<string, string>> {
  if (digestCache && Date.now() - digestCache.at < 600_000) return digestCache.lines;
  const by: Record<string, Fingerprint[]> = {};
  for (const c of CATEGORIES) by[c] = seedFps(c);
  try {
    for (const d of await (await everyone()).find({ shared: true }).limit(3000).toArray()) { const r = Fingerprint.safeParse(d.fp); if (r.success && by[d.category as string]) by[d.category as string].push(r.data); }
  } catch { /* no database: the app's own Reels */ }
  const lines: Record<string, string> = {};
  for (const [k, fps] of Object.entries(by)) if (fps.length >= 2) lines[k] = kindLine(k, fps);
  digestCache = { at: Date.now(), lines };
  return lines;
}
/** The text the AI gets: every kind's trend; the template's kind first when there is one, else the AI picks the kind */
export async function trendText(kind?: string): Promise<string> {
  const lines = await trendDigest(), keys = Object.keys(lines); if (!keys.length) return "";
  const known = kind && lines[kind] ? kind : "";
  const order = known ? [known, ...keys.filter((k) => k !== known)] : keys;
  return `WHAT TRENDING REELS OF EACH KIND DO (learned from the Reels this studio studied: a guide for THIS song and these clips, never a Reel to copy; the creator's own words come first):
${order.map((k) => lines[k]).join("\n")}
${known ? `This Reel is a ${known} Reel (its template): follow the ${known} trend.` : "Decide from the clips which kind this Reel is and follow that kind's trend (none fits: your own taste)."}`;
}
