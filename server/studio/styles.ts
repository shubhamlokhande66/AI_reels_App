import "server-only";
import { z } from "zod";
import { db, mainDb, parseId } from "@/server/core/db";
import { NotFoundError } from "@/server/core/errors";

/** Fast Studio's style library: every Reel a creator gives as a reference is measured on the phone ("Copy a Reel") and
 * only its style fingerprint is kept here (never the video): its pace in beats, the mix of transitions, how often shots
 * zoom, the colour look, its length. Fingerprints are grouped by kind of Reel (wedding, travel, festival...); a learned
 * style is what the Reels of one kind have in common, shifted by the corrections the creator makes to the edits. Mine are
 * private (the user's view of the database); shared ones also teach everyone's learned styles. How well a learned style
 * predicts a new Reel of its kind is measured by leaving each Reel out in turn. */

export const CATEGORIES = ["wedding", "travel", "festival", "dance", "talking", "product", "food", "fitness", "vlog", "birthday", "other"] as const;
export const KINDS = ["hard", "flash", "fade", "whip", "zoom", "dissolve"] as const;
const FIELDS = ["tr", "efx", "sp"] as const;
const num = (a: number, b: number) => z.number().finite().min(a).max(b);
export const Look = z.object({ mean: num(0, 1), std: num(0, 1), sat: num(0, 2), warm: num(-1, 1), p5: num(0, 1), p95: num(0, 1), vig: num(-1, 1), grain: num(0, 1), split: num(-1, 1) }).partial();
export const Fingerprint = z.object({
  dur: num(1, 600), bpm: num(0, 300), medianBeats: num(0, 64), medianSec: num(0, 60), hookBeats: num(0, 64), hookSec: num(0, 60),
  onBeat: num(0, 1), energy: z.enum(["steady", "rising", "falling"]), zoomShare: num(0, 1),
  trans: z.partialRecord(z.enum(KINDS), num(0, 1)), look: Look.nullable().default(null),
  shotBeats: z.array(num(0, 64)).max(300).default([]), shotSec: z.array(num(0, 60)).max(300).default([]),
});
export type Fingerprint = z.infer<typeof Fingerprint>;
export const SaveIn = z.object({ name: z.string().trim().min(1).max(120), category: z.enum(CATEGORIES), shared: z.boolean().default(false), fp: Fingerprint });
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
  const trans: Record<string, number> = {};
  for (const f of fps) for (const [k, v] of Object.entries(f.trans)) trans[k] = (trans[k] ?? 0) + v / fps.length;
  const looks = fps.map((f) => f.look).filter(Boolean) as z.infer<typeof Look>[];
  const look = looks.length ? Object.fromEntries(Object.keys(looks[0]).map((k) => [k, +mean(looks.map((l) => Number(l[k as keyof typeof l] ?? 0))).toFixed(4)])) : null;
  const pace = m("medianBeats") || m("medianSec");
  const typical = fps.reduce((best, f) => (Math.abs((f.medianBeats || f.medianSec) - pace) + Math.abs(f.zoomShare - m("zoomShare")) < Math.abs((best.medianBeats || best.medianSec) - pace) + Math.abs(best.zoomShare - m("zoomShare")) ? f : best), fps[0]);
  const energies = ["steady", "rising", "falling"] as const;
  return {
    dur: m("dur"), bpm: m("bpm"), medianBeats: m("medianBeats"), medianSec: m("medianSec"), hookBeats: m("hookBeats"), hookSec: m("hookSec"), onBeat: m("onBeat"),
    energy: energies.reduce((a, e) => (fps.filter((f) => f.energy === e).length > fps.filter((f) => f.energy === a).length ? e : a), "steady" as Fingerprint["energy"]),
    zoomShare: m("zoomShare"), trans: norm(trans) as Fingerprint["trans"], look: look as Fingerprint["look"], shotBeats: typical.shotBeats, shotSec: typical.shotSec,
  };
}

/** the creator's corrections move the transition mix: each change from one kind to another shifts a little share */
export function withCorrections(fp: Fingerprint, edits: { field: string; from: string; to: string }[]): Fingerprint {
  const tr = edits.filter((e) => e.field === "tr" && e.from !== e.to); if (!tr.length) return fp;
  const map: Record<string, string> = { hard: "hard", flash: "flash", dip: "fade", fadein: "fade", whip: "whip", zoom: "zoom", dissolve: "dissolve" };
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
  trans: { hard: 0.8, flash: 0.1, whip: 0.1 }, look: { mean: 0.45, std: 0.22, sat: 0.35, warm: 0 }, shotBeats: [], shotSec: [] };
export function accuracy(fps: Fingerprint[]): { n: number; learned: number; baseline: number } | null {
  if (fps.length < 3) return null;
  let a = 0, b = 0;
  fps.forEach((f, i) => { const rest = fps.filter((_, j) => j !== i); a += distance(learn(rest)!, f).total; b += distance(DEFAULT_STYLE, f).total; });
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
  for (const c of CATEGORIES) counts[c] = { mine: 0, shared: 0 };
  for (const d of docs) counts[d.category as string].mine++;
  for (const row of await (await everyone()).aggregate<{ _id: string; n: number }>([{ $match: { shared: true } }, { $group: { _id: "$category", n: { $sum: 1 } } }]).toArray()) if (counts[row._id]) counts[row._id].shared = row.n;
  return { mine: docs.map((d) => ({ id: String(d._id), name: d.name, category: d.category, shared: !!d.shared, createdAt: d.createdAt, ...summary(d.fp as Fingerprint) })), categories: counts };
}
export async function deleteStyle(id: string) {
  const r = await (await mine()).deleteOne({ _id: parseId(id) });
  if (!r.deletedCount) throw new NotFoundError("No such style.", { code: "STYLE_NOT_FOUND" });
  return { ok: true };
}
/** the learned style of a kind: from my Reels, or from mine and everyone's shared ones; with my corrections */
export async function learnedStyle(category: string, scope: "mine" | "all") {
  if (!(CATEGORIES as readonly string[]).includes(category)) throw new NotFoundError("No such kind of Reel.", { code: "STYLE_CATEGORY" });
  const own = (await (await mine()).find({ category }).limit(500).toArray()).map((d) => d.fp as Fingerprint);
  const shared = scope === "all" ? (await (await everyone()).find({ category, shared: true }).limit(2000).toArray()).map((d) => d.fp as Fingerprint) : [];
  const fps = [...own, ...shared.filter((s) => !own.some((o) => JSON.stringify(o) === JSON.stringify(s)))];
  const base = learn(fps); if (!base) return { category, n: 0, fp: null, accuracy: null };
  const ed = await (await editsCol()).find({ category: { $in: [category, "general"] } }).sort({ at: -1 }).limit(300).toArray();
  return { category, n: fps.length, fp: withCorrections(base, ed as unknown as { field: string; from: string; to: string }[]), accuracy: accuracy(fps), corrections: ed.length };
}
export async function recordEdits(d: z.infer<typeof EditsIn>) {
  const at = new Date();
  await (await editsCol()).insertMany(d.edits.map((e) => ({ ...e, category: d.category, at })));
  return { ok: true, n: d.edits.length };
}
