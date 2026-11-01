import { db, mainDb } from "../core/db";

/** What the AI director learns and how well it does.
 *  - taste(): the creator's own corrections (the transitions, effects and speeds they change in Fast Studio) as one short
 *    sentence, which goes into every AI plan for them, so the AI edits more like they do
 *  - recordRun(): one small document per AI plan (how many cuts and which choices; no media, no text of the person)
 *  - report(): for the administrator, how many plans the AI made and how often people changed what it chose */

const NAMES: Record<string, string> = { tr: "transition", efx: "effect", sp: "speed" };
const within = <T,>(p: Promise<T>, ms: number, fallback: T) => Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

interface Edit { type: string; field: string; from: string; to: string }
/** The pattern in a creator's corrections: what they pick (2 times or more) and what they keep removing. */
export function tasteOf(edits: Edit[]): string {
  if (!edits.length) return "";
  const picked = new Map<string, number>(), removed = new Map<string, number>();
  for (const e of edits) {
    if (!NAMES[e.field] || e.from === e.to) continue;
    const k1 = `${e.type}|${e.field}|${e.to}`, k2 = `${e.field}|${e.from}`;
    picked.set(k1, (picked.get(k1) ?? 0) + 1); removed.set(k2, (removed.get(k2) ?? 0) + 1);
  }
  const likes = [...picked].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([k, n]) => { const [type, f, to] = k.split("|"); return `on ${type}s they choose ${NAMES[f]} "${to}" (${n}x)`; });
  const dislikes = [...removed].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 4)
    .filter(([k]) => !k.endsWith("|hard") && !k.endsWith("|none") && !k.endsWith("|normal") && !k.endsWith("|1×"))
    .map(([k, n]) => { const [f, from] = k.split("|"); return `they often remove ${NAMES[f]} "${from}" (${n}x)`; });
  return [...likes, ...dislikes].join("; ");
}

/** This creator's taste, from their latest corrections (empty when there are none, or the database is slow). */
export async function taste(): Promise<string> {
  return within((async () => {
    const ed = await (await db()).collection("studio_style_edits").find({}, { projection: { type: 1, field: 1, from: 1, to: 1 } }).sort({ at: -1 }).limit(300).toArray();
    return tasteOf(ed as unknown as Edit[]);
  })(), 1500, "");
}

export interface Run { kind: "pace" | "plan" | "mix"; cuts: number; mode: string; provider: string; model: string; transitions?: number; effects?: number; keys?: number; ms: number; ok: boolean }
/** One line per AI call (never blocks the answer). */
export function recordRun(r: Run) {
  void within((async () => { await (await db()).collection("studio_director_runs").insertOne({ ...r, at: new Date() }); })(), 3000, undefined);
}

/** The administrator's view: the last 30 days, everyone. */
export async function report(days = 30) {
  const since = new Date(Date.now() - days * 864e5), m = await mainDb();
  const [runs] = await m.collection("studio_director_runs").aggregate<{ plans: number; paces: number; mixes: number; failed: number; cuts: number; transitions: number; effects: number; keys: number; ms: number; users: string[] }>([
    { $match: { at: { $gte: since } } },
    { $group: { _id: null, plans: { $sum: { $cond: [{ $and: [{ $eq: ["$kind", "plan"] }, "$ok"] }, 1, 0] } }, paces: { $sum: { $cond: [{ $and: [{ $eq: ["$kind", "pace"] }, "$ok"] }, 1, 0] } }, mixes: { $sum: { $cond: [{ $and: [{ $eq: ["$kind", "mix"] }, "$ok"] }, 1, 0] } },
      failed: { $sum: { $cond: ["$ok", 0, 1] } }, cuts: { $sum: { $cond: [{ $eq: ["$kind", "plan"] }, "$cuts", 0] } },
      transitions: { $sum: { $ifNull: ["$transitions", 0] } }, effects: { $sum: { $ifNull: ["$effects", 0] } }, keys: { $sum: { $ifNull: ["$keys", 0] } },
      ms: { $avg: { $cond: [{ $eq: ["$kind", "plan"] }, "$ms", null] } }, users: { $addToSet: "$ownerId" } } },
  ]).toArray();
  const changes = await m.collection("studio_style_edits").aggregate<{ _id: string; ai: number; all: number }>([
    { $match: { at: { $gte: since } } },
    { $group: { _id: "$field", ai: { $sum: { $cond: ["$ai", 1, 0] } }, all: { $sum: 1 } } },
  ]).toArray();
  const by = (f: string) => changes.find((c) => c._id === f) ?? { ai: 0, all: 0 };
  const r = runs ?? { plans: 0, paces: 0, mixes: 0, failed: 0, cuts: 0, transitions: 0, effects: 0, keys: 0, ms: 0, users: [] };
  const rate = (changed: number, made: number) => (made ? Math.min(1, changed / made) : null);
  return {
    days, plans: r.plans, paces: r.paces, mixes: r.mixes ?? 0, failed: r.failed, cuts: r.cuts, creators: (r.users ?? []).filter(Boolean).length,
    avgSeconds: r.ms ? Math.round(r.ms / 100) / 10 : null,
    choices: { transitions: r.transitions, effects: r.effects, keys: r.keys },
    changed: { transitions: by("tr").ai, effects: by("efx").ai, speeds: by("sp").ai },
    /** how often a creator changed an AI choice: lower is better */
    changeRate: { transitions: rate(by("tr").ai, r.transitions), effects: rate(by("efx").ai, r.effects) },
  };
}
