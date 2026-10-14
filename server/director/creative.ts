import { ValidationFailed } from "@/server/core/errors";
import { fixed, round } from "@/server/core/py";
import { motionBetween, type ClipInput, type UsableWindow } from "@/server/models/clip";
import { segLength, type Timeline } from "@/server/models/timeline";
import type { ProjectSettings } from "@/server/projects/settings";
import { applyPace, getStyle, withOverrides, type EditingStyle } from "@/server/styles";
import { applyTrend, getTrend } from "@/server/trends";
import { overlapSeconds } from "@/server/video/footage";
import { briefTerms, windowsOf } from "@/server/video/timeline";
import { hookParts, hookScore } from "./intelligence";
import type { MusicMap } from "./musicMap";

/** Before any shot is placed: the project brief (was director/brief.py), the hook options (hooks.py), the creative plan
 * (creative.py) and the style for one render (styles/resolve.py). Pure rules, no AI. */

// ------------------------------------------------------------------ brief
const PLATFORMS: Record<string, string> = { instagram_reel: "instagram_reels", youtube_short: "youtube_shorts", tiktok: "tiktok", instagram_story: "instagram_stories", instagram_post: "instagram_feed" };
const OBJECTIVES: Record<string, string> = { product: "product_showcase", jewelry: "product_showcase", fashion: "product_showcase", beauty: "product_showcase",
  food: "food_showcase", travel: "travel_story", fitness: "motivation", event: "event_highlights", education: "tutorial", tutorial: "tutorial", lifestyle: "storytelling", story: "storytelling" };
const DEFAULT_CTA: Record<string, string> = { product_showcase: "Shop now", food_showcase: "Save this recipe", travel_story: "Save for your next trip", tutorial: "Follow for more",
  motivation: "Follow for more", event_highlights: "See you next time" };
export const STYLE_TONE: Record<string, string> = { luxury: "premium", cinematic: "cinematic", viral: "bold", energetic: "energetic", minimal: "calm", storytelling: "warm",
  product_focus: "clear", social_native: "casual", fast_trending: "upbeat" };
const STYLE_WORDS: Record<string, string[]> = { luxury: ["luxury", "luxurious", "premium", "elegant", "high-end", "high end"], cinematic: ["cinematic", "film", "movie"],
  viral: ["viral", "trending", "tiktok"], energetic: ["energetic", "hype", "high energy"], minimal: ["minimal", "clean", "simple"], storytelling: ["story", "journey"] };
const AUDIENCE = /\bfor\s+((?:young|new|busy|working|first[- ]time|older)?\s*(?:women|men|girls|boys|moms|mums|dads|parents|students|kids|teens|brides|couples|travell?ers|foodies|gamers|professionals|athletes|customers|shoppers|families|creators))\b/i;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface ProjectBrief {
  platform: string; duration: number; objective: string; contentType: string; audience: string; style: string; tone: string; cta: string;
  brand: string; language: string; notes: string; inferred: string[];
}
export const briefForAi = (b: ProjectBrief) => { const { notes: _n, ...rest } = b; void _n; return { ...rest, inferred: [...b.inferred] }; };

function styleFromWords(text: string): string | null {
  const low = text.toLowerCase();
  for (const [style, words] of Object.entries(STYLE_WORDS)) if (words.some((w) => new RegExp(`\\b${esc(w)}\\b`).test(low))) return style;
  return null;
}

export function inferBrief(s: ProjectSettings, brand: Record<string, string> | null = null, categories: (string | null | undefined)[] = [], styleUsed: string | null = null): ProjectBrief {
  const b = brand ?? {};
  const inferred: string[] = [];
  const text = s.brief ?? "";
  const counts = new Map<string, number>();
  for (const c of categories) if (c && c !== "other") counts.set(c, (counts.get(c) ?? 0) + 1);
  let content = counts.size ? [...counts.entries()].reduce((a, x) => (x[1] > a[1] ? x : a))[0] : "other";
  if (content === "other" && text) content = Object.keys(OBJECTIVES).find((cat) => new RegExp(`\\b${cat}\\b`).test(text.toLowerCase())) ?? content;
  const objective = s.objective || OBJECTIVES[content] || "engagement";
  if (!s.objective) inferred.push("objective");
  const m = AUDIENCE.exec(text);
  const audience = s.audience || (m ? m[1].trim().toLowerCase().replace(/\s+/g, "_") : "general");
  if (!s.audience && !m) inferred.push("audience");
  const words = styleFromWords(text);
  const style = (!["auto", "custom"].includes(s.style) ? s.style : "") || words || b.visualStyle || b.style || styleUsed || "auto";
  if (["auto", "custom"].includes(s.style) && !words && !b.visualStyle) inferred.push("style");
  const cta = s.ctaText || b.cta || DEFAULT_CTA[objective] || "";
  if (!s.ctaText && !b.cta) inferred.push("cta");
  const tone = b.scriptTone || b.tone || STYLE_TONE[style] || "neutral";
  if (!(b.scriptTone || b.tone)) inferred.push("tone");
  return { platform: PLATFORMS[s.exportPreset] ?? s.exportPreset, duration: Number(s.duration), objective, contentType: content, audience, style, tone, cta,
    brand: b.name ?? "", language: s.language, notes: text.slice(0, 300), inferred };
}

// ------------------------------------------------------------------ hooks
const MAX_HOOKS = 5, HOOK_MIN = 1.0, HOOK_MAX = 2.5;
const PRODUCT = new Set(["product", "jewelry", "fashion", "beauty"]);
const WHY: Record<string, string> = {
  visual_surprise: "something appears out of an empty frame", product_reveal: "the product comes into full view", fast_movement: "strong movement from the first frame",
  curiosity: "a person mid-moment: viewers want the next second", transformation: "opens on the finished result, then shows how it got there",
  close_up: "a sharp close-up with one clear subject", pattern_interrupt: "looks unlike anything else in the feed", text_hook: "a calm, clean shot that lets the hook text do the work",
};
export interface HookOption {
  clipId: string; name: string; start: number; end: number; type: string; hookScore: number; clarity: number; curiosity: number; visualStrength: number; reason: string; text: string;
}
export const hookOptionDoc = (h: HookOption) => ({ clipId: h.clipId, asset: h.name, start: round(h.start, 2), end: round(h.end, 2), type: h.type, hookScore: round(h.hookScore, 3),
  clarity: round(h.clarity, 3), curiosity: round(h.curiosity, 3), visualStrength: round(h.visualStrength, 3), reason: h.reason, text: h.text });

function hookType(clip: ClipInput, w: UsableWindow, moment: string | null, novelty: number): string {
  const sem = clip.semantic, cat = sem?.category ?? null;
  if (moment === "reveal") return cat && PRODUCT.has(cat) ? "product_reveal" : "visual_surprise";
  if (moment === "subject_close" && cat && PRODUCT.has(cat)) return "product_reveal";
  if (sem && (sem.endingCandidate || sem.stage === "finished") && ["food", "beauty", "fashion"].includes(cat ?? "")) return "transformation";
  if (moment === "face_appears" || (w.face && w.subjectMotion > 0.3)) return "curiosity";
  if (Math.max(w.subjectMotion, w.cameraMotion, w.motion) >= 0.55 || (moment === "action_peak" && w.motion >= 0.4)) return "fast_movement";
  if (w.shotSize === "close" || moment === "subject_close" || moment === "focus_peak") return "close_up";
  if (novelty >= 0.45) return "pattern_interrupt";
  return moment === "camera_settles" ? "visual_surprise" : w.subject >= 0.5 ? "close_up" : "curiosity";
}

function hookSpan(w: UsableWindow, t: number | null): [number, number] {
  const length = Math.min(HOOK_MAX, Math.max(HOOK_MIN, (w.end - w.start) * 0.5), w.end - w.start);
  if (t === null) t = w.start + (w.motionCurve.length ? w.motionCurve.indexOf(Math.max(...w.motionCurve)) * w.curveDt : 0);
  const a = Math.min(Math.max(t - 0.4, w.start), w.end - length);
  return [round(a, 3), round(a + length, 3)];
}

const overlapsIn = (out: HookOption[], h: HookOption) => out.some((o) => o.clipId === h.clipId && o.start < h.end && h.start < o.end);

/** Up to five typed, scored openings: the best first, then different clips and different kinds. */
export function generateHooks(clips: ClipInput[], brief = "", hookText = "", k = MAX_HOOKS): HookOption[] {
  const pool = clips.filter((c) => c.analysis.usable).length ? clips.filter((c) => c.analysis.usable) : clips;
  const terms = briefTerms(brief);
  const sigs = pool.flatMap((c) => windowsOf(c).map((w) => w.signature));
  const cands: HookOption[] = [];
  for (const c of pool) {
    const seen = new Set<string>(), events: [number, string][] = [];
    for (const m of c.analysis.moments) { const key = `${round(m.t, 2)}|${m.kind}`; if (!seen.has(key)) { seen.add(key); events.push([round(m.t, 2), m.kind]); } }
    for (const w of windowsOf(c)) {
      const inside = events.filter(([t]) => w.start <= t && t <= w.end);
      const spots: [number | null, string | null][] = inside.length ? inside : [[null, null]];
      for (const [t, kind] of spots) {
        const parts = hookParts(c, w, terms, sigs.filter((s) => s !== w.signature));
        const [a, b] = hookSpan(w, t);
        const motion = motionBetween(w, a, b);
        const curiosity = Math.min(0.55 * parts.curiosity + 0.3 * parts.novelty + (kind ? 0.15 : 0), 1);
        const visual = Math.min(0.6 * parts.impact + 0.4 * (1 - Math.abs(motion - 0.6) / 0.6), 1);
        const bonus = kind && ["reveal", "face_appears", "action_peak", "subject_close"].includes(kind) ? 0.06 : kind ? 0.03 : 0;
        const type = hookType(c, w, kind, parts.novelty);
        cands.push({ clipId: c.clipId, name: c.name, start: a, end: b, type, hookScore: Math.min(hookScore(parts) + bonus, 1), clarity: parts.clarity, curiosity, visualStrength: visual, reason: WHY[type], text: "" });
      }
    }
  }
  const ranked = cands.map((h, i) => [h, i] as const).sort((x, y) => y[0].hookScore - x[0].hookScore || x[1] - y[1]).map(([h]) => h);
  let out: HookOption[] = [];
  const perClip = new Map<string, number>(), types = new Set<string>();
  for (const h of ranked) {
    if (out.length >= k) break;
    if ((perClip.get(h.clipId) ?? 0) >= 2 || overlapsIn(out, h)) continue;
    if (types.has(h.type) && out.length >= 1 && cands.some((c) => !types.has(c.type) && c.hookScore >= h.hookScore - 0.08 && c !== h && (perClip.get(c.clipId) ?? 0) < 2)) continue;
    out.push(h);
    perClip.set(h.clipId, (perClip.get(h.clipId) ?? 0) + 1);
    types.add(h.type);
  }
  for (const h of ranked) {
    if (out.length >= k) break;
    if (!out.includes(h) && (perClip.get(h.clipId) ?? 0) < 2 && !overlapsIn(out, h)) { out.push(h); perClip.set(h.clipId, (perClip.get(h.clipId) ?? 0) + 1); }
  }
  if (hookText && out.length) {
    const calm = out.reduce((a, h) => (Math.abs(h.visualStrength - 0.6) + (h.type === "fast_movement" ? 0.3 : 0) < Math.abs(a.visualStrength - 0.6) + (a.type === "fast_movement" ? 0.3 : 0) ? h : a));
    out.push({ ...calm, type: "text_hook", hookScore: round(calm.hookScore * 0.95, 3), curiosity: Math.min(calm.curiosity + 0.2, 1), reason: WHY.text_hook, text: hookText.slice(0, 80) });
    out = [...out].sort((a, b) => b.hookScore - a.hookScore).slice(0, k);
  }
  return [...out].sort((a, b) => b.hookScore - a.hookScore);
}

// ------------------------------------------------------------------ creative plan
const STORIES: Record<string, string[]> = {
  product: ["hook", "tease", "reveal", "detail", "hero_shot", "cta"], jewelry: ["hook", "tease", "reveal", "detail", "hero_shot", "cta"],
  beauty: ["hook", "before", "application", "result", "hero_shot", "cta"], food: ["hook", "ingredients", "preparation", "transformation", "final_dish", "reaction"],
  fashion: ["look", "detail", "movement", "full_look", "hero_shot"], travel: ["location_hook", "establishing", "experience", "detail", "hero_moment"],
  fitness: ["hook", "effort", "progress", "peak", "result"], event: ["hook", "atmosphere", "people", "highlight", "finale"],
  tutorial: ["result_teaser", "step", "step", "step", "result"], education: ["question", "context", "explanation", "takeaway"],
};
const DEFAULT_STORY = ["hook", "context", "build", "reveal", "payoff"];

export interface Direction {
  id: string; label: string; concept: string; style: string; pace: string; captionStyle: string; order: string; hookTypes: string[]; pacing: string;
  visualEnergy: string; music: string; text: string; effects: string; transitions: string; description: string; shotOrder: string;
}
export const DIRECTIONS: Record<string, Direction> = {
  viral: { id: "viral", label: "Viral", concept: "Scroll-Stopper", style: "viral", pace: "fast", captionStyle: "bold", order: "quality",
    hookTypes: ["fast_movement", "visual_surprise", "pattern_interrupt", "curiosity"], pacing: "fast", visualEnergy: "high",
    music: "cut on the strong hits; the biggest moment lands exactly on the drop; no long holds in loud parts", text: "a short hook line in the first second, one benefit, CTA at the end",
    effects: "beat punches and micro zooms on hits, one flash on the drop", transitions: "hard cuts; at most one motion transition into the drop",
    description: "Strongest hook first, fast cuts on the hits, built for retention.", shotOrder: "the strongest, most energetic moments first; never let two similar shots touch" },
  cinematic: { id: "cinematic", label: "Cinematic", concept: "Cinematic Story", style: "cinematic", pace: "calm", captionStyle: "minimal", order: "chronological",
    hookTypes: ["visual_surprise", "curiosity", "close_up"], pacing: "slow", visualEnergy: "medium",
    music: "shots breathe across bars and phrases; cuts on phrase starts in calm parts; the hero moment held over the drop", text: "little or no text; a quiet title and the CTA only at the very end",
    effects: "slow push-ins, gentle slow motion on the hero moment", transitions: "mostly cuts, dissolves only between scenes",
    description: "A story in order: establishing shot, journey, reveal, a held ending.", shotOrder: "the order the clips were filmed (c1, c2, c3 ...): a journey from the widest establishing view to the hero" },
  premium: { id: "premium", label: "Premium", concept: "Brand Reveal", style: "luxury", pace: "balanced", captionStyle: "luxury", order: "quality",
    hookTypes: ["product_reveal", "close_up", "text_hook"], pacing: "medium", visualEnergy: "medium",
    music: "tease in the build, the product reveal exactly on the drop, detail shots on accents, a long hero shot at the end", text: "brand name and one benefit in the brand's look; a clear CTA",
    effects: "subtle glow on highlights, slow zooms on details; nothing busy", transitions: "clean cuts and a single dissolve before the hero shot",
    description: "Product and brand first: close-ups, a reveal on the drop, a hero ending.", shotOrder: "tease with details and close-ups first, the clearest full product view on the drop, the best product shot last" },
};

export interface CreativePlan {
  concept: string; direction: string; logline: string; hook: Record<string, unknown>; story: string[]; pacing: string; visualEnergy: string;
  musicInterpretation: string; textStrategy: string; effectsStrategy: string; transitionStrategy: string; shotOrder: string; ending: string; source: string;
}
export interface DirectorConcept {
  concept?: string; logline?: string; hookType?: string; story?: string[]; pacing?: string; visualEnergy?: string; musicInterpretation?: string;
  textStrategy?: string; effectsStrategy?: string; transitionStrategy?: string; ending?: string;
}
const PACING: Record<string, string> = { calm: "slow", balanced: "medium", fast: "fast" };

export function storyFor(brief: ProjectBrief, nShots: number, hasFace: boolean): string[] {
  const beats = [...(STORIES[brief.contentType] ?? DEFAULT_STORY)];
  const drop = (x: string) => { const i = beats.indexOf(x); if (i >= 0) beats.splice(i, 1); };
  if (!brief.cta) drop("cta");
  if (!hasFace) drop("reaction");
  if (brief.cta && !beats.includes("cta") && brief.objective === "product_showcase") beats.push("cta");
  while (beats.length > Math.max(nShots, 3)) beats.splice(Math.floor(beats.length / 2), 1);
  return beats;
}

function musicReading(mm: MusicMap | null): string {
  if (!mm || !mm.sections.length) return "cuts follow the beat; the strongest moment goes on the loudest strong beat";
  const parts = mm.sections.map((s) => `${s.label} ${fixed(s.start as number, 0)}-${fixed(s.end as number, 0)}s`);
  const inner = mm.drops.filter((d) => d > 1).length ? mm.drops.filter((d) => d > 1) : mm.sections.filter((s) => s.label === "drop" && (s.start as number) > 1).map((s) => s.start as number);
  const lead = inner.length ? `hero moment on the drop at ${fixed(inner[0], 1)}s`
    : ["drop", "chorus"].includes(mm.sections[0].label as string) ? "the Reel starts on the loudest part of the song: open hard on the strongest hook, keep the energy up, and put the hero moment on the strongest beat about two-thirds in"
    : "hero moment on the loudest strong beat";
  return `${lead}; song parts: ${parts.join(", ")}`;
}

/** The openings for one concept, its preferred kind first, never a clip another version already opens on. */
export function hooksFor(direction: string | null, hooks: HookOption[], avoidClips: Set<string> = new Set()): HookOption[] {
  const d = DIRECTIONS[direction ?? ""];
  if (!d || !hooks.length) return [...hooks];
  const fresh = hooks.filter((h) => !avoidClips.has(h.clipId));
  const pool = fresh.length ? fresh : hooks;
  const rank = (t: string) => { const i = d.hookTypes.indexOf(t); return i < 0 ? d.hookTypes.length : i; };
  const first = pool.reduce((a, h) => (rank(h.type) < rank(a.type) || (rank(h.type) === rank(a.type) && h.hookScore > a.hookScore) ? h : a));
  return [first, ...hooks.filter((h) => h !== first)];
}

export function draftPlan(brief: ProjectBrief, hooks: HookOption[], mm: MusicMap | null, o: { direction?: string | null; pace?: string; hasFace?: boolean } = {}): CreativePlan {
  const d = DIRECTIONS[o.direction ?? ""], pace = o.pace ?? "balanced";
  const hook = hooks.length ? hooksFor(o.direction ?? null, hooks)[0] : null;
  const shots = Math.max(Math.trunc(brief.duration / ((d && d.pacing === "fast") || pace === "fast" ? 1.2 : pace === "calm" ? 2.2 : 1.7)), 3);
  const story = storyFor(brief, shots, Boolean(o.hasFace));
  const subject = brief.contentType !== "other" ? brief.contentType.replace(/_/g, " ") : "footage";
  let name = d ? d.concept : ({ product_showcase: "Product Reveal", food_showcase: "From Raw to Ready", travel_story: "Journey", tutorial: "How It's Done" } as Record<string, string>)[brief.objective] ?? "Highlight Reel";
  if (brief.style === "luxury" && !d) name = "Luxury Reveal";
  const ctaShown = brief.cta && story.includes("cta");
  const logline = (`A ${d ? d.label.toLowerCase() : brief.style !== "auto" ? brief.style : ""} ${subject} Reel for ${brief.platform.replace(/_/g, " ")}` +
    `${brief.audience !== "general" ? " aimed at " + brief.audience.replace(/_/g, " ") : ""}: ${hook ? "opens on " + hook.reason : "opens on the strongest shot"}, builds to the hero moment` +
    `${ctaShown ? `, ends on '${brief.cta}'` : ""}.`).replace(/ {2}/g, " ");
  return {
    concept: name, direction: d ? d.id : "auto", logline,
    hook: hook ? { type: hook.type, clipId: hook.clipId, asset: hook.name, start: round(hook.start, 2), duration: round(hook.end - hook.start, 2), why: hook.reason } : {},
    story, pacing: d ? d.pacing : PACING[pace] ?? "medium", visualEnergy: d ? d.visualEnergy : pace === "fast" ? "high" : pace === "calm" ? "low" : "medium",
    musicInterpretation: (d ? d.music + "; " : "") + musicReading(mm),
    textStrategy: d ? d.text : brief.cta ? "hook text in the first second and the CTA at the end" : "text only where it helps",
    effectsStrategy: d ? d.effects : "effects only where the footage or a beat calls for them",
    transitionStrategy: d ? d.transitions : "hard cuts by default; other transitions only with a reason", shotOrder: d ? d.shotOrder : "",
    ending: "the strongest hero shot, held on the final strong beat" + (ctaShown ? `, with the CTA '${brief.cta}'` : ""), source: "rules",
  };
}

/** The final plan: the AI's concept where it gave one, the draft elsewhere; the hook is the shot actually used. */
export function mergeAi(draft: CreativePlan, concept: DirectorConcept | null, firstShot: Record<string, unknown> | null): CreativePlan {
  const plan: CreativePlan = structuredClone(draft);
  if (concept) {
    for (const f of ["concept", "logline", "pacing", "visualEnergy", "musicInterpretation", "textStrategy", "effectsStrategy", "transitionStrategy", "ending"] as const) {
      const v = concept[f];
      if (typeof v === "string" && v.trim()) plan[f] = v.trim().slice(0, 300);
    }
    if (concept.story?.length) { const s = concept.story.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, 40)).slice(0, 10); if (s.length) plan.story = s; }
    if (concept.hookType) plan.hook = { ...plan.hook, type: concept.hookType.slice(0, 40) };
    plan.source = "ai";
  }
  if (firstShot) plan.hook = { ...plan.hook, ...firstShot };
  return plan;
}

/** Cinematic: the shots between opening and ending play in filming order on the same cut times. */
export function storyOrder(tl: Timeline, clipOrder: string[], clips: ClipInput[]): string | null {
  const segs = tl.segments;
  if (segs.length < 4) return null;
  const mid = Array.from({ length: segs.length - 2 }, (_, i) => i + 1);
  if (mid.some((i) => segs[i].locked)) return null;
  const rank = new Map(clipOrder.map((c, i) => [c, i]));
  const F = ["clipId", "video", "sourceStart", "speed", "focusX", "focusY", "focusSource", "reason"] as const;
  const items = mid.map((i) => F.map((f) => segs[i][f]));
  const ordered = [...items].sort((a, b) => (rank.get(a[0] as string) ?? rank.size) - (rank.get(b[0] as string) ?? rank.size) || (a[2] as number) - (b[2] as number));
  if (JSON.stringify(ordered) === JSON.stringify(items)) return null;
  const backup = mid.map((i) => structuredClone(segs[i]));
  const room = new Map(clips.map((c) => [c.clipId, c.analysis.metadata.duration]));
  mid.forEach((i, k) => {
    const s = segs[i] as unknown as Record<string, unknown>;
    F.forEach((f, j) => (s[f] = ordered[k][j]));
    const seg = segs[i], span = segLength(seg) * seg.speed;
    seg.sourceEnd = round(seg.sourceStart + span, 3);
    const r = room.get(seg.clipId);
    if (r !== undefined && seg.sourceEnd > r) { seg.sourceStart = round(Math.max(r - span, 0), 3); seg.sourceEnd = round(Math.min(r, seg.sourceStart + span), 3); }
  });
  for (const [j, s] of segs.entries()) {
    const others = segs.filter((o, n) => n !== j && o.clipId === s.clipId).map((o) => [o.sourceStart, o.sourceEnd] as [number, number]);
    if (overlapSeconds(s.sourceStart, s.sourceEnd, others) > 0.1) { mid.forEach((i, k) => (segs[i] = backup[k])); return null; }
  }
  return "Cinematic: the shots between the opening and the ending now play in the order they were filmed (same cuts).";
}

// ------------------------------------------------------------------ style for one render (styles/resolve.py)
export async function resolveStyle(s: ProjectSettings, styleId: string | null = null): Promise<EditingStyle> {
  let style = getStyle(styleId ?? s.style);
  const cs = s.customStyle;
  if (style.id === "custom" && cs) {
    const over: Partial<EditingStyle> = {};
    for (const f of ["cutBeatsHigh", "cutBeatsLow", "minSegment", "maxSegment", "transitionDuration", "slowMotionChance"] as const) if (cs[f] !== null && cs[f] !== undefined) (over as Record<string, number>)[f] = cs[f] as number;
    if (cs.transitions) { const t = Object.fromEntries(Object.entries(cs.transitions).filter(([, v]) => v >= 0)); over.transitions = Object.keys(t).length ? t : style.transitions; }
    if (cs.effects) { const e = Object.fromEntries(Object.entries(cs.effects).filter(([, v]) => v >= 0)); over.effects = Object.keys(e).length ? e : style.effects; }
    style = withOverrides(style, over);
    if (style.maxSegment < style.minSegment) style = withOverrides(style, { maxSegment: style.minSegment });
  }
  if (s.trendId) {
    const trend = await getTrend(s.trendId);
    if (!trend) throw new ValidationFailed(`Unknown trend '${s.trendId}'.`, { code: "UNKNOWN_TREND" });
    style = applyTrend(style, trend);
  }
  return applyPace(style, s.pace);
}

// ------------------------------------------------------------------ versions open differently
const SWAP_FIELDS = ["clipId", "video", "sourceStart", "speed", "focusX", "focusY", "focusSource", "reason"] as const;

/** Swap the footage of shots i and k on the same cut times; undone (false) when it would repeat a moment
 * (was revise/director_patch.swap_footage). */
export function swapFootage(tl: Timeline, i: number, k: number, byId: Map<string, ClipInput>): boolean {
  const a = tl.segments[i], b = tl.segments[k], before = [structuredClone(a), structuredClone(b)];
  const fa = SWAP_FIELDS.map((f) => a[f]), fb = SWAP_FIELDS.map((f) => b[f]);
  for (const [seg, f] of [[a, fb], [b, fa]] as const) {
    SWAP_FIELDS.forEach((name, j) => ((seg as unknown as Record<string, unknown>)[name] = f[j]));
    const span = segLength(seg) * seg.speed;
    seg.sourceEnd = round(seg.sourceStart + span, 3);
    const room = byId.get(seg.clipId)?.analysis.metadata.duration;
    if (room !== undefined && seg.sourceEnd > room) { seg.sourceStart = round(Math.max(room - span, 0), 3); seg.sourceEnd = round(Math.min(room, seg.sourceStart + span), 3); }
  }
  for (const j of [i, k]) {
    const s = tl.segments[j];
    const others = tl.segments.filter((o, n) => n !== j && o.clipId === s.clipId).map((o) => [o.sourceStart, o.sourceEnd] as [number, number]);
    if (overlapSeconds(s.sourceStart, s.sourceEnd, others) > 0.1) { tl.segments[i] = before[0]; tl.segments[k] = before[1]; return false; }
  }
  return true;
}

/** When a version opens on a clip an earlier version opened on, put this concept's own opening into shot 1. */
export async function distinctOpening(tl: Timeline, hooks: HookOption[], opened: Set<string>, clips: ClipInput[]): Promise<string | null> {
  if (!tl.segments.length || !opened.has(tl.segments[0].clipId)) return null;
  const { placeFootage, usedRanges, windowAt } = await import("./creativeReview");
  const { isFresh } = await import("@/server/video/footage");
  for (const hook of hooks) {
    if (opened.has(hook.clipId) || !opened.has(tl.segments[0].clipId)) continue;
    const clip = clips.find((c) => c.clipId === hook.clipId);
    const seg = tl.segments[0], span = segLength(seg) * seg.speed, w = clip ? windowAt(clip, hook.start) : null;
    if (!clip || !w) continue;
    const start = Math.min(Math.max(hook.start, w.start), w.end - span);
    const reason = `This version's own opening (${hook.reason}), so the versions start differently.`;
    if (start >= w.start - 1e-6 && isFresh(start, start + span, usedRanges(tl, 0).get(hook.clipId) ?? [])) {
      if (placeFootage(tl, 0, clip, start, w, reason)) return `Opening set to ${clip.name} so this version does not start like an earlier one.`;
      continue;
    }
    const byId = new Map(clips.map((c) => [c.clipId, c]));
    for (let k = 1; k < tl.segments.length; k++) {
      if (tl.segments[k].clipId === hook.clipId && !tl.segments[k].locked && swapFootage(tl, 0, k, byId)) {
        tl.segments[0].reason = `${tl.segments[0].video}: ${reason}`;
        return `Opening set to ${tl.segments[0].video} (traded places with shot ${k + 1}) so this version does not start like an earlier one.`;
      }
    }
  }
  return null;
}

// ------------------------------------------------------------------ variation strategies (variations/strategies.py)
export interface Strategy { id: string; label: string; description: string; style: string; pace: string; captionStyle: string; order: string }
const st = (id: string, label: string, description: string, style: string, pace = "balanced", captionStyle = "minimal", order = "quality"): Strategy => ({ id, label, description, style, pace, captionStyle, order });
export const STRATEGIES: Record<string, Strategy> = Object.fromEntries([
  st("viral", "Viral", "The strongest hook, fast cuts on the hits, built for retention.", "viral", "fast", "bold"),
  st("cinematic", "Cinematic", "Longer shots, slow fades, slow motion.", "cinematic", "balanced", "minimal"),
  st("luxury", "Luxury", "Elegant, slow and premium.", "luxury", "balanced", "luxury"),
  st("premium", "Premium", "Product and brand first: close-ups, the reveal on the drop, a hero ending.", "luxury", "balanced", "luxury"),
  st("storytelling", "Storytelling", "Clips in the order you shot them: opening, journey, reveal.", "storytelling", "balanced", "highlight", "chronological"),
  st("minimal", "Minimal", "Plain cuts and no effects; the footage speaks.", "minimal", "balanced", "minimal"),
  st("fast_trending", "Fast + Trending", "Quick beat-synced cuts, punchy zooms.", "fast_trending", "balanced", "bold"),
  st("energetic", "Energetic", "Fast cuts on every strong beat, movement everywhere.", "energetic", "fast", "bold"),
  st("product_focus", "Product Focus", "The product is the star: close-ups first, clean cuts, a hero ending.", "product_focus", "balanced", "minimal"),
  st("social_native", "Social Native", "Creator-style: handheld energy, jump cuts, no fancy transitions.", "social_native", "balanced", "bold"),
].map((s) => [s.id, s]));
export const DEFAULT_SET = ["viral", "cinematic", "luxury", "storytelling", "minimal"], CONCEPT_SET = ["viral", "cinematic", "premium"];
export function getStrategy(id: string): Strategy {
  const s = STRATEGIES[id];
  if (!s) throw new ValidationFailed(`Unknown strategy '${id}'.`, { code: "UNKNOWN_STRATEGY", details: { available: Object.keys(STRATEGIES) } });
  return s;
}
export const versionLabel = (i: number, s: Strategy) => `Version ${"ABCDEFGH"[i % 8]}: ${s.label}`;
export const chronologicalHint = (ids: string[]) => Object.fromEntries(ids.map((id, i) => [id, i / Math.max(ids.length - 1, 1)]));
