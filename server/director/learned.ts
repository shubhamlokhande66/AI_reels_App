import "server-only";
import fs from "node:fs";
import { ObjectId } from "mongodb";
import { db } from "@/server/core/db";
import { fixed, round } from "@/server/core/py";
import { EVENTS } from "@/server/services/feedback";
import { localPath } from "@/server/storage/local";
import { applyPace, withOverrides, type EditingStyle } from "@/server/styles";

/** What the app learned: trends learned from reference Reels (trends/reference.py load_references / for_ai / traits,
 * trends/learn.py apply_trend / best_match) and the person's director profile (services/feedback.py). */

type Doc = Record<string, unknown>;
const TEXT_DENSITY: Record<string, string> = { none: "none", "hook only": "low", "some shots": "medium", "every shot": "high", captions: "high" };

export function traits(p: Doc): Doc {
  const described = p.described as Doc | Doc[] | undefined;
  const descs = Array.isArray(described) ? described : described ? [described] : [];
  const trans = descs.flatMap((d) => ((d.transitions as string[]) ?? []).map((t) => t.toLowerCase()));
  const texts = descs.filter((d) => d.text_on_screen).map((d) => String(d.text_on_screen).toLowerCase());
  const effects = descs.flatMap((d) => ((d.effects as string[]) ?? []).map((e) => e.toLowerCase()));
  const soft = trans.filter((t) => t && !["cut", "none"].some((w) => t.includes(w))).length;
  const look = (p.look as Doc) ?? {}, beat = p.on_beat_share as number | undefined, hook = (p.hook_seconds as number) || 9;
  const bri = (look.brightness as number) ?? 0.5, sat = (look.saturation as number) ?? 0.4;
  const out: Doc = {
    pacing: p.pace, average_shot_duration: p.avg_shot, shot_density_per_10s: p.cuts_per_10s, hook_seconds: p.hook_seconds, energy_curve: p.energy_curve ?? "steady",
    transition_style: !descs.length ? "not_measured" : soft === 0 ? "mostly_hard_cut" : soft <= 2 ? "mixed" : "transition_heavy",
    text_density: texts.length ? TEXT_DENSITY[texts[0]] ?? "medium" : "not_measured", camera_movement: [...new Set(effects)].sort().slice(0, 4).join(", ") || "not_measured",
    music_sync: beat === undefined || beat === null ? null : beat >= 0.7 ? "tight" : beat >= 0.4 ? "loose" : "free",
    color_mood: [bri > 0.6 ? "bright" : bri < 0.35 ? "dark" : "", sat > 0.5 ? "vivid" : sat < 0.25 ? "muted" : ""].filter(Boolean).join(" ") || "neutral",
    story_structure: hook <= 1.2 && ["rising", "peak_in_middle"].includes(p.energy_curve as string) ? "fast_hook_then_build" : hook <= 1.2 ? "fast_hook" : "slow_open",
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== null && v !== undefined));
}

const KEEP = ["pace", "avg_shot", "median_shot", "hook_seconds", "cuts_per_10s", "on_beat_share", "beats_per_shot", "loud_avg_shot", "calm_avg_shot", "shortest_shot", "longest_shot",
  "look", "described", "bpm", "videos", "seconds_per_video"];
const empty = (v: unknown) => v === null || v === undefined || (Array.isArray(v) && !v.length) || (typeof v === "object" && !Array.isArray(v) && !Object.keys(v as object).length);

/** The compact form the AI director receives. */
export function forAi(trend: Doc): Doc {
  const p = (trend.profile as Doc) ?? {};
  return { id: String(trend._id ?? ""), name: trend.name ?? "", notes: trend.notes ?? "", ...Object.fromEntries(KEEP.filter((k) => !empty(p[k])).map((k) => [k, p[k]])), traits: traits(p) };
}

/** none, the chosen one, or (auto) the latest twelve. */
export async function loadReferences(choice: string | null | undefined): Promise<Doc[]> {
  const c = choice || "auto";
  if (c === "none") return [];
  try {
    const col = (await db()).collection("references");
    if (c !== "auto") {
      if (!ObjectId.isValid(c)) return [];
      const doc = await col.findOne({ _id: new ObjectId(c) });
      return doc ? [{ ...forAi(doc), chosen: true }] : [];
    }
    return (await col.find({}).sort({ updatedAt: -1 }).limit(12).toArray()).map(forAi);
  } catch (e) {
    console.warn("learned trends not loaded:", e);
    return [];
  }
}

const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The editing rules for this song, shaped like the learned trend. */
export function applyLearnedTrend(style: EditingStyle, trend: Doc, bpm: number | null): [EditingStyle, string] {
  const base = (trend.median_shot as number) || (trend.avg_shot as number);
  if (!base) return [style, ""];
  const loud = (trend.loud_avg_shot as number) || base * 0.85, calm = (trend.calm_avg_shot as number) || base * 1.3;
  const period = bpm && bpm >= 50 && bpm <= 220 ? 60 / bpm : 0.5;
  const high = Math.trunc(clampN(round(loud / period), 1, 8)), low = Math.trunc(clampN(round(calm / period), high, 12));
  const minSeg = round(clampN(base * 0.45, 0.25, 2), 2), maxSeg = round(clampN(Math.max(calm * 1.8, base * 2.2), minSeg + 0.6, 8), 2);
  const over: Partial<EditingStyle> = { cutBeatsHigh: high, cutBeatsLow: low, minSegment: minSeg, maxSegment: maxSeg, sectionPacing: false };
  const beat = trend.on_beat_share as number | undefined;
  if (beat !== undefined && beat !== null) over.accentHits = beat >= 0.6;
  const tr = ((trend.traits as Doc) ?? {}).transition_style;
  if (tr === "mostly_hard_cut") over.maxTransitionRatio = Math.min(style.maxTransitionRatio, 0.12);
  else if (tr === "transition_heavy") over.maxTransitionRatio = Math.max(style.maxTransitionRatio, 0.5);
  if (((trend.hook_seconds as number) || 9) <= 1.2) over.hookPriority = Math.max(style.hookPriority, 0.6);
  const look = (trend.look as Doc) ?? {};
  if (Object.keys(look).length) {
    const sat = round(1 + clampN((Number(look.saturation ?? 0.4) - 0.4) * 0.8, -0.15, 0.25), 2), bri = round(clampN((Number(look.brightness ?? 0.5) - 0.5) * 0.15, -0.05, 0.05), 3);
    if (Math.abs(sat - 1) >= 0.03 || Math.abs(bri) >= 0.01) { const eq = `eq=saturation=${sat}:brightness=${bri}`; over.gradeFilter = style.gradeFilter ? `${style.gradeFilter},${eq}` : eq; }
  }
  const note = `Edited like your learned style '${trend.name ?? "trend"}': about ${fixed(loud, 1)} s per shot in loud parts (${high} beat${high > 1 ? "s" : ""}) and ${fixed(calm, 1)} s in calm parts (${low} beats) at this song's ${round(bpm || 120)} BPM`
    + (beat !== undefined && beat !== null ? `, ${round(beat * 100)}% of cuts on the beat` : "") + ".";
  return [withOverrides(style, over), note];
}

const WORD = /[a-zऀ-ॿ]{3,}/g;
/** For "auto": the learned style that fits this Reel best (words, tempo, length), or null below MIN_MATCH. */
export function bestMatch(trends: Doc[], text: string, bpm: number | null, duration: number): Doc | null {
  if (!trends.length) return null;
  const words = new Set((text || "").toLowerCase().match(WORD) ?? []);
  const score = (t: Doc) => {
    const own = new Set(`${t.name ?? ""} ${t.notes ?? ""}`.toLowerCase().match(WORD) ?? []);
    let s = 2 * [...words].filter((w) => own.has(w)).length;
    const tb = t.bpm as number | undefined;
    if (bpm && tb) { let r = Math.max(bpm, tb) / Math.min(bpm, tb); r = Math.min(r, Math.abs(r - 2) + 1); s += Math.max(0, 1.5 - (r - 1) * 4); }
    const spv = t.seconds_per_video as number | undefined;
    if (spv) s += Math.max(0, 0.5 - Math.abs(Math.log(Math.max(duration, 1) / spv)) * 0.4);
    return s + Math.min(Math.log1p((t.videos as number) || 1) * 0.15, 0.5);
  };
  const best = trends.reduce((a, t) => (score(t) > score(a) ? t : a));
  return score(best) >= 1 ? best : null;
}

// ------------------------------------------------------------------ director profile
const MIN_EVIDENCE = 3, PROFILE_KEY = "settings/director_profile.json";
export interface DirectorProfile { ready: boolean; enabled: boolean; evidence: number; minEvidence: number; preferences: Doc; counts: Record<string, number>; summary: Doc }
const meanOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const medianOf = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const mostCommon = (xs: string[]) => { const c = new Map<string, number>(); for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1); let best: [string, number] | null = null; for (const e of c) if (!best || e[1] > best[1]) best = e; return best; };

export function buildProfile(events: { event: string; facts?: Doc }[], enabled = true): DirectorProfile {
  const counts: Record<string, number> = {};
  for (const e of events) counts[e.event] = (counts[e.event] ?? 0) + 1;
  const n = (k: string) => counts[k] ?? 0;
  const accepted = events.filter((e) => e.event === "accepted").map((e) => e.facts ?? {});
  const prefs: Doc = {};
  if (accepted.length) {
    const shots = accepted.map((a) => a.avgShot as number).filter(Boolean);
    prefs.avgShotSeconds = shots.length ? round(meanOf(shots), 2) : null;
    const durs = accepted.map((a) => a.duration as number).filter(Boolean);
    if (durs.length) prefs.duration = round(medianOf(durs));
    const styles = [...accepted.map((a) => a.style as string).filter(Boolean), ...events.filter((e) => e.event === "changed_style" && e.facts?.to).map((e) => e.facts!.to as string)];
    const top = mostCommon(styles);
    if (top) prefs.style = top[0];
  }
  const avg = prefs.avgShotSeconds as number | undefined;
  if (avg) prefs.pace = avg < 1.4 ? "fast" : avg > 2.8 ? "calm" : "balanced";
  const trRatio = accepted.length ? meanOf(accepted.map((a) => (a.transitionRatio as number) ?? 0)) : null;
  prefs.transitions = (n("removed_transition") >= 2 && n("removed_transition") > n("added_transition")) || (trRatio !== null && trRatio < 0.12) ? "minimal"
    : n("added_transition") >= 2 && n("added_transition") > n("removed_transition") ? "more" : "as styled";
  prefs.effects = n("removed_effect") >= 2 && n("removed_effect") > n("added_effect") ? "minimal" : "as styled";
  prefs.hook = n("rejected_opening") >= 2 ? "aggressive" : "balanced";
  const texts = accepted.map((a) => (a.texts as number) ?? 0);
  prefs.text = (texts.length && meanOf(texts) <= 1) || n("edited_text") >= 3 ? "minimal" : "as styled";
  const shotList = accepted.map((a) => a.avgShot as number).filter(Boolean).sort((a, b) => a - b);
  if (shotList.length) prefs.shotRange = [round(shotList[Math.floor(shotList.length / 4)], 2), round(shotList[Math.floor((3 * shotList.length) / 4)], 2)];
  const concept = mostCommon([...accepted.map((a) => a.concept as string).filter(Boolean), ...events.filter((e) => e.event === "chose_concept" && e.facts?.concept).map((e) => e.facts!.concept as string)]);
  if (concept && concept[1] >= 2) prefs.concept = concept[0];
  const evidence = EVENTS.filter((k) => k !== "regenerated").reduce((s, k) => s + n(k), 0);
  const summary = Object.fromEntries(Object.entries({ preferred_pacing: prefs.pace, transition_preference: prefs.transitions, style: prefs.style, concept: prefs.concept, shot_range: prefs.shotRange }).filter(([, v]) => v));
  return { ready: evidence >= MIN_EVIDENCE, enabled, evidence, minEvidence: MIN_EVIDENCE, preferences: prefs, counts, summary };
}

export async function loadProfile(): Promise<DirectorProfile> {
  let enabled = true;
  try { enabled = Boolean(JSON.parse(fs.readFileSync(localPath(PROFILE_KEY), "utf8")).enabled ?? true); } catch { /* default on */ }
  const events = await (await db()).collection("feedback").find({}, { projection: { event: 1, facts: 1 } }).sort({ at: -1 }).limit(2000).toArray();
  return buildProfile(events as unknown as { event: string; facts?: Doc }[], enabled);
}

export function setProfileEnabled(enabled: boolean) {
  const f = localPath(PROFILE_KEY);
  fs.mkdirSync(f.replace(/[\\/][^\\/]+$/, ""), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ enabled }));
}

/** The person's taste on the parts they left automatic. */
export function applyProfile(style: EditingStyle, pace: string, profile: DirectorProfile | null): [EditingStyle, string[]] {
  if (!profile || !profile.ready || !profile.enabled) return [style, []];
  const p = profile.preferences, notes: string[] = [];
  if (pace === "auto" && ["calm", "balanced", "fast"].includes(p.pace as string)) { style = applyPace(style, p.pace as string); notes.push(`${p.pace} pace (your Reels average ${p.avgShotSeconds}s per shot)`); }
  if (p.transitions === "minimal" && style.maxTransitionRatio > 0.15) { style = withOverrides(style, { maxTransitionRatio: 0.15 }); notes.push("fewer transitions (you usually remove them)"); }
  if (p.effects === "minimal") {
    const w = { ...style.effects };
    w.none = (w.none ?? 0) + Math.max(Object.values(w).reduce((a, b) => a + b, 0), 1);
    style = withOverrides(style, { effects: w });
    notes.push("fewer effects (you usually remove them)");
  }
  if (p.hook === "aggressive" && style.hookPriority < 0.6) { style = withOverrides(style, { hookPriority: 0.6 }); notes.push("a stronger opening (you often replaced the first shot)"); }
  return [style, notes.length ? [`Your director profile: ${notes.join("; ")}.`] : []];
}
