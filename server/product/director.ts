import "server-only";
import { ValidationFailed } from "@/server/core/errors";
import { PyRandom } from "@/server/core/random";
import type { AudioAnalysis } from "@/server/models/analysis";

/** Product Reels from photos (were product/models.py, styles.py, director.py): the looks, what is in a photo, and the
 * director that turns understood photos + music into a micro-timeline of purposeful shots. Nothing here touches pixels;
 * deterministic for the same photos, music and seed. */

// ------------------------------------------------------------------ data
export type Purpose = "hook" | "curiosity" | "reveal" | "hero" | "detail" | "macro" | "payoff" | "cta";
export type Framing = "extreme_close_up" | "close_up" | "medium" | "hero" | "detail" | "macro";
export type CameraType = "push_in" | "pull_out" | "pan_left" | "pan_right" | "tilt_up" | "tilt_down" | "drift" | "hold";
export interface Rect { x: number; y: number; w: number; h: number }
export const cxOf = (r: Rect) => r.x + r.w / 2, cyOf = (r: Rect) => r.y + r.h / 2;
const contains = (r: Rect, px: number, py: number) => r.x <= px && px <= r.x + r.w && r.y <= py && py <= r.y + r.h;
export interface Highlight { x: number; y: number; strength: number }
export interface Region { rect: Rect; score: number; kind: "detail" | "macro" }
export interface ImageUnderstanding {
  mediaId: string; name: string; width: number; height: number; subject: Rect; subjectConfidence: number; background: "plain" | "busy"; backgroundColor: string;
  darkBackground: boolean; palette: string[]; regions: Region[]; highlights: Highlight[]; sharpness: number; notes: string[];
}
export interface View { cx: number; cy: number; hh: number; roll: number }
export interface CameraMove { type: CameraType; start: View; end: View; ease: "in_out" | "out" | "in" | "linear" }
export interface ShotEffect { type: string; at: number; duration: number; strength: number; x: number | null; y: number | null; onBeat: boolean }
export interface ShotTransition { type: string; duration: number }
export interface Shot { index: number; start: number; end: number; purpose: Purpose; framing: Framing; imageIndex: number; camera: CameraMove; effects: ShotEffect[]; transitionIn: ShotTransition; beatTime: number | null; note: string }
export const shotLength = (s: Shot) => s.end - s.start;
export interface TextLayer { id: string; text: string; start: number; end: number; x: number; y: number; size: number; animationIn: string; animationOut: "fade" | "none"; role: "hook" | "tagline" | "cta" }
export interface QualityCheck { name: string; ok: boolean; detail: string }
export interface ProductReelPlan {
  postCopy: Record<string, unknown> | null; style: string; duration: number; fps: number; bpm: number; audioStart: number; concept: Record<string, string>; images: string[];
  shots: Shot[]; texts: TextLayer[]; loop: boolean; warnings: string[]; notes: string[]; quality: QualityCheck[];
}

export interface ProductStyle {
  id: string; name: string; description: string; pace: number; push: number; swayDeg: number; sparkleMax: number; lightSweeps: number; glow: number; lightLeaks: number;
  dust: boolean; flashOnDrops: boolean; whip: boolean; vignette: number; contrast: number; saturation: number; altTransitions: string[]; font: string; textColor: string; textOutline: string; bold: boolean;
}
const base = { pace: 1, push: 0.16, swayDeg: 0.9, sparkleMax: 6, lightSweeps: 2, glow: 0.3, lightLeaks: 1, dust: false, flashOnDrops: false, whip: false, vignette: 0.28, contrast: 1.06, saturation: 1.04,
  altTransitions: ["blur", "match", "cut"], font: "Georgia", textColor: "#F6E7C8", textOutline: "#000000", bold: true };
const STYLES: ProductStyle[] = [
  { ...base, id: "luxury_jewelry", name: "Luxury jewellery", description: "Slow, elegant camera; light sweeps across the metal; sparkles only on real reflections; gold text.",
    pace: 0.9, push: 0.14, swayDeg: 1.0, sparkleMax: 7, lightSweeps: 2, glow: 0.35, lightLeaks: 1, vignette: 0.32, contrast: 1.08, saturation: 1.05, altTransitions: ["blur", "match", "cut"], font: "Georgia", textColor: "#F6E7C8" },
  { ...base, id: "clean_product", name: "Clean product", description: "Crisp and modern: precise pushes, match cuts and zooms, one light sweep, no glitter.",
    pace: 1.0, push: 0.18, swayDeg: 0.6, sparkleMax: 0, lightSweeps: 1, glow: 0.12, lightLeaks: 0, vignette: 0.18, contrast: 1.05, saturation: 1.02, altTransitions: ["match", "cut", "blur"], font: "Segoe UI", textColor: "#FFFFFF" },
  { ...base, id: "energetic", name: "Energetic", description: "Fast and punchy: whips, flashes on the drops, light leaks and dust, bold text.",
    pace: 1.35, push: 0.22, swayDeg: 1.2, sparkleMax: 5, lightSweeps: 2, glow: 0.25, lightLeaks: 2, dust: true, flashOnDrops: true, whip: true, vignette: 0.22, contrast: 1.1, saturation: 1.1,
    altTransitions: ["whip_left", "zoom", "match"], font: "Arial", textColor: "#FFFFFF" },
];
export const listProductStyles = () => STYLES;
export function getProductStyle(id: string): ProductStyle {
  const s = STYLES.find((x) => x.id === id);
  if (!s) throw new ValidationFailed(`Unknown product style '${id}'.`, { code: "UNKNOWN_PRODUCT_STYLE", details: { available: STYLES.map((x) => x.id).sort() } });
  return s;
}

// ------------------------------------------------------------------ the director
const CANVAS_ASPECT = 9 / 16, MAX_UPSCALE = 2.6, REF_HEIGHT = 1920, MIN_SHOT = 0.2, MAX_SHOT = 1.5, MAX_ENDING = 2.2, SAFE_TOP = 0.08, SAFE_BOTTOM = 0.8;
export type Phase = [Purpose, number, [number, number]];
export const PHASES: Phase[] = [["hook", 0.08, [0.35, 0.6]], ["curiosity", 0.14, [0.5, 1.0]], ["reveal", 0.12, [1.0, 1.5]], ["hero", 0.14, [1.2, 1.5]], ["detail", 0.16, [0.5, 1.0]], ["macro", 0.14, [0.3, 0.7]], ["payoff", 0.12, [1.0, 1.5]], ["cta", 0.1, [1.5, 2.2]]];
const INTENT: Record<Purpose, string> = {
  hook: "Stop the scroll: start on a striking detail, revealed out of the dark by light.", curiosity: "Show only part of the product so the viewer wants to see the rest.",
  reveal: "Let the product come into view.", hero: "The full product, clean and confident, with a light passing across it.", detail: "Move in on what makes it special.",
  macro: "The finest detail, up close, with a sparkle where it truly reflects light.", payoff: "The satisfying pull-back: the whole piece again, with everything seen.", cta: "A calm final frame with room for the call to action.",
};
const TRANSITION_TABLE: Record<string, string> = { "hook>curiosity": "blur", "curiosity>reveal": "light", "reveal>hero": "match", "hero>detail": "zoom", "detail>macro": "zoom", "macro>payoff": "flash", "payoff>cta": "blur" };
const TRANSITION_SECONDS: Record<string, number> = { fade_from_black: 0.35, blur: 0.28, light: 0.16, zoom: 0.22, whip_left: 0.18, whip_right: 0.18, flash: 0.14, dissolve: 0.4, dip_to_black: 0.36 };
export const PRODUCT_TRANSITIONS = ["cut", "match", "blur", "light", "zoom", "flash", "whip_left", "whip_right", "dissolve", "dip_to_black"];
const r = (x: number, n = 3) => { const k = 10 ** n; return Math.round(x * k) / k; };

interface Beats { times: number[]; strong: Set<number>; drops: number[]; accents: [number, number][]; bpm: number; synthetic: boolean }
function beatsOf(audio: AudioAnalysis | null, start: number, duration: number): Beats {
  if (!audio || !audio.beats.length) {
    const period = 60 / 110, times = Array.from({ length: Math.trunc(duration / period) + 2 }, (_, i) => r(i * period));
    return { times, strong: new Set(times.filter((_, i) => i % 4 === 0)), drops: [], accents: [], bpm: 110, synthetic: true };
  }
  const rel = audio.beats.filter((b) => b - start >= -0.03 && b - start <= duration + 0.05).map((b) => Math.max(r(b - start), 0));
  if (!rel.length || rel[0] > 0.05) rel.unshift(0); else rel[0] = 0;
  const times = [...new Set(rel)].sort((a, b) => a - b);
  const strong = new Set(audio.strongBeats.filter((b) => b - start >= 0 && b - start <= duration).map((b) => r(b - start)));
  const drops = audio.drops.filter((d) => d - start >= 0 && d - start <= duration).map((d) => r(d - start));
  const accents = audio.accents.map((t, i) => [t, audio.accentStrengths[i]] as [number, number]).filter(([t, s]) => t - start >= 0 && t - start <= duration && s >= 0.55).map(([t, s]) => [r(t - start), s] as [number, number]);
  return { times, strong, drops, accents, bpm: audio.bpm, synthetic: false };
}
function heroHh(u: ImageUnderstanding) {
  const hh = Math.max(u.subject.h, (u.subject.w * u.width) / (CANVAS_ASPECT * u.height)) * 1.3;
  return u.subjectConfidence < 0.5 && u.width / u.height <= 0.7 ? Math.min(hh, 1) : hh;
}
const minHh = (u: ImageUnderstanding) => REF_HEIGHT / (MAX_UPSCALE * u.height);
const viewHalf = (u: ImageUnderstanding, hh: number): [number, number] => [(hh * u.height * CANVAS_ASPECT) / u.width / 2, hh / 2];
function mkView(u: ImageUnderstanding, cx: number, cy: number, hh: number, roll = 0): View {
  const s = u.subject;
  cx = Math.min(Math.max(cx, s.x), s.x + s.w);
  cy = Math.min(Math.max(cy, s.y), s.y + s.h);
  return { cx: r(cx, 4), cy: r(cy, 4), hh: r(Math.max(hh, hh < heroHh(u) ? minHh(u) : hh), 4), roll: r(roll) };
}
function visible(u: ImageUnderstanding, v: View, h: Highlight, margin = 0.82) {
  const [hw, hh] = viewHalf(u, v.hh);
  return Math.abs(h.x - v.cx) <= hw * margin && Math.abs(h.y - v.cy) <= hh * margin;
}
interface Slot { start: number; end: number; purpose: Purpose; beat: number | null }
function nearestBeat(b: Beats, t: number, tol: number): number | null {
  const x = b.times.reduce((best, y) => (Math.abs(y - t) < Math.abs(best - t) ? y : best));
  return Math.abs(x - t) <= tol ? x : null;
}
function phaseCuts(t: number, limit: number, lo: number, hi: number, cap: number, b: Beats): number[] {
  const remaining = limit - t;
  let n = Math.max(1, Math.round(remaining / ((lo + hi) / 2)));
  while (remaining / n > cap + 1e-6) n++;
  while (n > 1 && remaining / n < 0.3) n--;
  const out: number[] = [];
  let prev = t;
  for (let k = 1; k < n; k++) {
    const ideal = t + (remaining * k) / n, cands = b.times.filter((x) => prev + 0.25 <= x && x <= Math.min(prev + cap, limit - 0.25 * (n - k)));
    const best = cands.length ? cands.reduce((m, x) => (Math.abs(x - ideal) - (b.strong.has(x) ? 0.04 : 0) < Math.abs(m - ideal) - (b.strong.has(m) ? 0.04 : 0) ? x : m)) : null;
    const cut = best !== null && Math.abs(best - ideal) <= 0.3 * (remaining / n) + 0.12 ? best : Math.min(Math.max(ideal, prev + 0.25), prev + cap);
    out.push(r(cut));
    prev = cut;
  }
  out.push(r(limit));
  return out;
}
function slotsOf(duration: number, b: Beats, pace: number, phases: Phase[]): Slot[] {
  const out: Slot[] = [];
  let t = 0, acc = 0;
  phases.forEach(([purpose, share, [lo0, hi0]], pi) => {
    acc += share;
    const last = pi === phases.length - 1;
    let limit = last ? r(duration) : acc * duration;
    if (!last) {
      const snapped = nearestBeat(b, limit, 0.35);
      limit = snapped !== null && snapped > t + 0.3 ? snapped : limit;
      limit = r(Math.min(limit, duration - 0.3));
    }
    const cap = purpose === "cta" ? MAX_ENDING : MAX_SHOT, lo = Math.min(Math.max(lo0 / pace, 0.25), cap), hi = Math.min(Math.max(hi0 / pace, 0.3), cap);
    for (const nxt of phaseCuts(t, limit, lo, hi, cap, b)) {
      const bt = nearestBeat(b, t, 0.06);
      out.push({ start: r(t), end: nxt, purpose, beat: bt !== null ? r(bt) : null });
      t = nxt;
    }
  });
  return out;
}
const quality = (u: ImageUnderstanding) => u.subjectConfidence * 0.5 + Math.min(u.sharpness / 8, 1) * 0.3 + Math.min(u.highlights.length / 4, 1) * 0.2 + Math.min(Math.max(u.width, u.height) / 3000, 1) * 0.2;
const byScore = (a: Region, b: Region) => b.score - a.score;
function withHighlightRegions(u: ImageUnderstanding): Region[] {
  const regs = [...u.regions].sort(byScore), side = 0.3 * Math.max(u.subject.w * u.width, u.subject.h * u.height);
  for (const h of [...u.highlights].sort((a, b) => b.strength - a.strength).slice(0, 4)) {
    const rw = side / u.width, rh = side / u.height;
    const rect = { x: Math.min(Math.max(h.x - rw / 2, 0), 1 - rw), y: Math.min(Math.max(h.y - rh / 2, 0), 1 - rh), w: Math.min(rw, 1), h: Math.min(rh, 1) };
    if (regs.every((g) => Math.abs(cxOf(rect) - cxOf(g.rect)) > 0.6 * rw || Math.abs(cyOf(rect) - cyOf(g.rect)) > 0.6 * rh)) regs.push({ rect, score: r(0.6 + 0.4 * h.strength), kind: "macro" });
  }
  return regs.sort(byScore);
}
function pickRegions(images: ImageUnderstanding[], order: number[]): [number, Region][] {
  const per = order.map((i) => withHighlightRegions(images[i]).map((g) => [i, g] as [number, Region])), out: [number, Region][] = [];
  while (per.some((l) => l.length)) for (const l of per) if (l.length) out.push(l.shift()!);
  return out;
}
function cam(kind: CameraType, b: View, u: ImageUnderstanding, style: ProductStyle, direction: number, sway: number): CameraMove {
  const [hw] = viewHalf(u, b.hh), push = style.push, floor = minHh(u);
  let wide = b.hh * (1 + 0.5 * push), close = b.hh * (1 - 0.5 * push);
  if (close < floor) { wide += floor - close; close = floor; }
  let a: View, e: View;
  if (kind === "push_in") { a = mkView(u, b.cx, b.cy, wide); e = mkView(u, b.cx, b.cy, close, sway); }
  else if (kind === "pull_out") { a = mkView(u, b.cx, b.cy, close, -sway); e = mkView(u, b.cx, b.cy, wide); }
  else if (kind === "pan_left" || kind === "pan_right") { const d = (kind === "pan_left" ? -1 : 1) * hw * 0.32; a = mkView(u, b.cx - d, b.cy, b.hh); e = mkView(u, b.cx + d, b.cy, b.hh * (1 - push * 0.3)); }
  else if (kind === "tilt_up" || kind === "tilt_down") { const d = (kind === "tilt_up" ? -1 : 1) * b.hh * 0.1; a = mkView(u, b.cx, b.cy - d, b.hh); e = mkView(u, b.cx, b.cy + d, b.hh * (1 - push * 0.3)); }
  else if (kind === "drift") { a = mkView(u, b.cx, b.cy, b.hh, -sway); e = mkView(u, b.cx + direction * hw * 0.08, b.cy, b.hh * 0.97, sway); }
  else { a = mkView(u, b.cx, b.cy, b.hh); e = { ...a }; }
  return { type: kind, start: a, end: e, ease: kind === "hold" ? "linear" : "in_out" };
}
function textBoxOverlap(u: ImageUnderstanding, v: View, y: number, text: string, size: number) {
  const [hw, hh] = viewHalf(u, v.hh), s = u.subject;
  const fx0 = 0.5 + (s.x - v.cx) / (2 * hw), fx1 = 0.5 + (s.x + s.w - v.cx) / (2 * hw), fy0 = 0.5 + (s.y - v.cy) / (2 * hh), fy1 = 0.5 + (s.y + s.h - v.cy) / (2 * hh);
  const tw = Math.min(0.9, Math.max(text.length, 3) * size * 0.5 * (16 / 9) * CANVAS_ASPECT + 0.05);
  const ix = Math.max(0, Math.min(fx1, 0.5 + tw / 2) - Math.max(fx0, 0.5 - tw / 2)), iy = Math.max(0, Math.min(fy1, y + size * 0.7) - Math.max(fy0, y - size * 0.7));
  return Math.min((ix * iy) / Math.max((fx1 - fx0) * (fy1 - fy0), 1e-6), 1);
}
const textY = (u: ImageUnderstanding, v: View, text: string, size: number) =>
  [0.14, 0.22, 0.3, 0.66, 0.74, SAFE_BOTTOM - 0.02].map((y) => [textBoxOverlap(u, v, y, text, size), Math.abs(y - 0.16), y]).reduce((m, x) => (x[0] < m[0] || (x[0] === m[0] && x[1] < m[1]) ? x : m))[2];

export interface PlanOptions { style: ProductStyle; duration: number; audioStart?: number; hook?: string; tagline?: string; cta?: string; loop?: boolean; seed?: number; fps?: number;
  phases?: Phase[] | null; cameras?: Record<string, string> | null; textAnimations?: Record<string, string> | null; transitions?: Record<string, string> | null }
export function planReel(images: ImageUnderstanding[], audio: AudioAnalysis | null, o: PlanOptions): ProductReelPlan {
  if (!images.length) throw new Error("At least one photo is required.");
  const { style, duration } = o, audioStart = o.audioStart ?? 0, loop = o.loop ?? false, rng = new PyRandom(o.seed ?? 0), notes: string[] = [];
  const beats = beatsOf(audio, audioStart, duration);
  if (beats.synthetic) notes.push("No music: the shots follow a steady 110 BPM rhythm.");
  const slots = slotsOf(duration, beats, style.pace, o.phases ?? PHASES);
  const order = images.map((_, i) => i).sort((a, b) => quality(images[b]) - quality(images[a]) || a - b), primary = order[0], up = images[primary];
  let regions = pickRegions(images, order);
  if (!regions.length) regions = [[primary, { rect: up.subject, score: 0.5, kind: "detail" }]];
  const nDetail = slots.filter((s) => s.purpose === "detail" || s.purpose === "macro").length, pool = Array.from({ length: 1 + Math.trunc(nDetail / Math.max(regions.length, 1)) }, () => regions).flat();
  let regionAt = 0;
  const heroView = mkView(up, cxOf(up.subject), cyOf(up.subject), heroHh(up)), shots: Shot[] = [], lastSparkle = new Map<string, number>();
  let sparkles = 0, sweeps = 0, leaks = 0, prevFraming: Framing | null = null, prevImage = -1, run = 0, prevKind: CameraType | null = null, swayDir = 1;
  let direction = rng.random() < 0.5 ? 1 : -1;
  slots.forEach((slot, idx) => {
    const length = r(slot.end - slot.start), p = slot.purpose;
    let imgI = primary, region: Region | null = null;
    if (p === "detail" || p === "macro") [imgI, region] = pool[regionAt++];
    else if (p === "payoff" && images.length > 1 && rng.random() < 0.5) imgI = order[1 % order.length];
    const u = images[imgI], hero = heroHh(u), hmin = minHh(u);
    let framing: Framing, b: View;
    if (p === "hook") { framing = "extreme_close_up"; const reg = [...u.regions].sort(byScore)[0]; b = mkView(u, reg ? cxOf(reg.rect) : cxOf(u.subject), reg ? cyOf(reg.rect) : cyOf(u.subject), Math.max(0.3 * hero, hmin)); }
    else if (p === "curiosity") { framing = "close_up"; b = mkView(u, u.subject.x + u.subject.w * (direction > 0 ? 0.32 : 0.68), u.subject.y + u.subject.h * 0.4, Math.max(0.5 * hero, hmin)); }
    else if (p === "reveal") { framing = "medium"; b = mkView(u, cxOf(u.subject), cyOf(u.subject), 0.78 * hero); }
    else if (p === "hero" || p === "cta" || p === "payoff") { framing = "hero"; b = mkView(u, cxOf(u.subject), cyOf(u.subject), hero); }
    else if (p === "detail") { framing = "detail"; b = mkView(u, cxOf(region!.rect), cyOf(region!.rect), Math.max(0.42 * hero, hmin * 1.15)); }
    else { framing = "macro"; b = mkView(u, cxOf(region!.rect), cyOf(region!.rect), Math.max(0.22 * hero, hmin)); }
    if (framing === prevFraming && prevImage === imgI) {
      run++;
      const factor = [0.84, 1.16, 0.7, 1.3][(run - 1) % 4], dx = [0.1, -0.1, 0.06, -0.06][(run - 1) % 4] * u.subject.w;
      b = mkView(u, b.cx + dx, b.cy, Math.max(b.hh * factor, ["macro", "detail", "extreme_close_up", "close_up"].includes(framing) ? hmin : b.hh * factor));
    } else run = 0;
    prevFraming = framing; prevImage = imgI;
    const allowed: Record<Purpose, CameraType[]> = { hook: ["pull_out"], curiosity: ["push_in", direction > 0 ? "pan_right" : "pan_left"], reveal: ["push_in", "drift"], hero: ["drift", "push_in"],
      detail: ["push_in", "pan_left", "pan_right", "tilt_up", "tilt_down"], macro: ["push_in", "drift", "tilt_up"], payoff: ["pull_out"], cta: ["hold", "drift"] };
    const kinds = allowed[p].filter((k) => k !== prevKind), wanted = o.cameras?.[p] as CameraType | undefined;
    let kind = wanted && allowed[p].includes(wanted) && wanted !== prevKind ? wanted : rng.choice(kinds.length ? kinds : allowed[p]);
    if (kind === "pan_left" || kind === "pan_right") { direction = -direction; kind = direction > 0 ? "pan_right" : "pan_left"; }
    const sway = ["hero", "reveal", "payoff"].includes(p) ? style.swayDeg * swayDir : 0;
    if (sway) swayDir = -swayDir;
    const camera = cam(kind, b, u, style, direction, Math.abs(sway));
    prevKind = kind;
    const shot: Shot = { index: idx, start: slot.start, end: slot.end, purpose: p, framing, imageIndex: imgI, camera, effects: [], transitionIn: { type: "cut", duration: 0 }, beatTime: slot.beat, note: INTENT[p] };
    const mid = mkView(u, (camera.start.cx + camera.end.cx) / 2, (camera.start.cy + camera.end.cy) / 2, (camera.start.hh + camera.end.hh) / 2);
    const fx: ShotEffect[] = [], eff = (type: string, at: number, dur: number, strength: number, extra: Partial<ShotEffect> = {}): ShotEffect => ({ type, at, duration: dur, strength, x: null, y: null, onBeat: false, ...extra });
    if (p === "hook") { fx.push(eff("light_sweep", 0, Math.max(length, 0.4), 0.55)); sweeps++; }
    if (p === "hero" && sweeps < style.lightSweeps) { fx.push(eff("light_sweep", Math.min(0.15, length * 0.2), Math.min(length, 1), 0.5)); sweeps++; }
    if ((p === "hero" || p === "payoff") && style.glow > 0) fx.push(eff("glow", 0, length, style.glow));
    if ((p === "hook" || p === "payoff") && leaks < style.lightLeaks) { fx.push(eff("light_leak", Math.max(length - 0.45, 0), Math.min(0.5, length), 0.4)); leaks++; }
    if (style.dust && (p === "detail" || p === "macro")) fx.push(eff("dust", 0, length, 0.35));
    if (["hero", "detail", "macro", "payoff"].includes(p) && sparkles < style.sparkleMax && u.highlights.length) {
      const times = [Math.min(0.08, length * 0.2)], hit = beats.accents.filter(([t]) => slot.start + 0.25 <= t && t <= slot.end - 0.15);
      if (hit.length && length >= 0.7) { const strength = new Map(beats.accents); times.push(r(hit.map(([t]) => t).reduce((m, t) => ((strength.get(t) ?? 0) > (strength.get(m) ?? 0) ? t : m)) - slot.start)); }
      for (const at of times) {
        if (sparkles >= style.sparkleMax) break;
        for (const h of [...u.highlights].sort((a, c) => c.strength - a.strength)) {
          const key = `${imgI}:${Math.trunc(h.x * 100) * 1000 + Math.trunc(h.y * 100)}`;
          if (idx - (lastSparkle.get(key) ?? -99) < 3 || !visible(u, mid, h) || !contains(u.subject, h.x, h.y)) continue;
          lastSparkle.set(key, idx);
          fx.push(eff("sparkle", at, 0.32, Math.min(0.55 + h.strength * 0.45, 1), { x: h.x, y: h.y, onBeat: true }));
          sparkles++;
          break;
        }
      }
    }
    if (style.flashOnDrops && beats.drops.some((d) => Math.abs(d - slot.start) <= 0.12)) fx.push(eff("flash", 0, 0.12, 0.7, { onBeat: true }));
    shot.effects = fx;
    shots.push(shot);
  });
  limitEffects(shots, duration);
  assignTransitions(shots, style, rng, loop, o.transitions ?? null);
  if (loop && shots.length) {
    const first = shots[0], last = shots[shots.length - 1];
    if (first.imageIndex !== last.imageIndex) last.imageIndex = first.imageIndex;
    first.camera = { ...first.camera, start: first.imageIndex === primary ? heroView : first.camera.start };
    last.camera = { ...last.camera, end: first.camera.start };
    shots[0].transitionIn = { type: "cut", duration: 0 };
    notes.push("Loop: the last frame returns to the first, so the Reel plays round seamlessly.");
  }
  const texts = planTexts(shots, images, o.hook ?? "", o.tagline ?? "", o.cta ?? "", loop, duration, o.textAnimations ?? {});
  const nMacro = shots.filter((s) => s.purpose === "detail" || s.purpose === "macro").length, cta = (o.cta ?? "").trim();
  const ending = (cta ? "A calm final frame with the call to action" : "A calm final frame") + (loop ? ", returning to the first frame so it loops." : ".");
  const plan: ProductReelPlan = { postCopy: null, style: style.id, duration: r(duration), fps: o.fps ?? 30, bpm: r(beats.bpm, 1), audioStart, images: images.map((i) => i.mediaId), shots, texts, loop, warnings: [], notes, quality: [],
    concept: { hook: loop ? "Opens on the whole piece and moves straight in to its finest detail." : "Opens on the finest detail, revealed out of darkness by a sweep of light.",
      story: `${shots.length} micro-shots: curiosity (part of the product), reveal, hero, ${nMacro} detail/macro shots, then a pull-back payoff. Style: ${style.name}.`, ending } };
  plan.quality = checkPlan(plan, images, beats, o.phases ?? null);
  return plan;
}
function limitEffects(shots: Shot[], duration: number) {
  const allowed = Math.max(Math.trunc(1.2 * duration), 3), rank: Record<string, number> = { dust: 0, light_leak: 1, flash: 2, sparkle: 3, light_sweep: 4 };
  const counted = () => shots.flatMap((s) => s.effects.filter((e) => e.type !== "glow").map((e) => [s, e] as const));
  for (let c = counted(); c.length > allowed; c = counted()) {
    const [s, e] = c.reduce((m, x) => { const km = [rank[m[1].type] ?? 9, m[1].strength, -m[0].index], kx = [rank[x[1].type] ?? 9, x[1].strength, -x[0].index]; return kx[0] < km[0] || (kx[0] === km[0] && (kx[1] < km[1] || (kx[1] === km[1] && kx[2] < km[2]))) ? x : m; });
    s.effects.splice(s.effects.indexOf(e), 1);
  }
}
function assignTransitions(shots: Shot[], style: ProductStyle, rng: PyRandom, loop: boolean, wanted: Record<string, string> | null) {
  let prev = "";
  shots.forEach((s, i) => {
    if (i === 0) { s.transitionIn = { type: loop ? "cut" : "fade_from_black", duration: loop ? 0 : TRANSITION_SECONDS.fade_from_black }; prev = s.transitionIn.type; return; }
    const before = shots[i - 1];
    let kind = TRANSITION_TABLE[`${before.purpose}>${s.purpose}`] ?? "";
    const aiKind = before.purpose !== s.purpose ? wanted?.[s.purpose] ?? null : null;
    if (aiKind && PRODUCT_TRANSITIONS.includes(aiKind)) kind = aiKind;
    if (!kind) {
      const alt0 = style.altTransitions.filter((a) => a !== prev), alt = alt0.length ? alt0 : style.altTransitions;
      kind = alt[(i + rng.randrange(alt.length)) % alt.length];
      if (kind === "whip_left" || kind === "whip_right") kind = i % 2 === 0 ? "whip_left" : "whip_right";
    }
    if ((kind === "whip_left" || kind === "whip_right") && !style.whip && kind !== aiKind) kind = "match";
    if (kind === "flash" && !style.flashOnDrops && style.id === "clean_product" && kind !== aiKind) kind = "zoom";
    if (kind === prev && kind !== "cut" && kind !== "match") { const alt = style.altTransitions.filter((a) => a !== prev); kind = alt.length ? alt[0] : "cut"; }
    if (kind === "match" && before.imageIndex === s.imageIndex) { const c = before.camera.end; s.camera = { ...s.camera, start: { cx: c.cx, cy: c.cy, hh: r(s.camera.start.hh, 4), roll: 0 } }; }
    else if (kind === "match") kind = "cut";
    let dur = r(Math.min(TRANSITION_SECONDS[kind] ?? 0, 0.45 * shotLength(before), 0.45 * shotLength(s)));
    if (dur < 0.06 && kind !== "cut" && kind !== "match") { kind = "cut"; dur = 0; }
    s.transitionIn = { type: kind, duration: dur };
    prev = kind;
  });
}
function planTexts(shots: Shot[], images: ImageUnderstanding[], hook: string, tagline: string, cta: string, loop: boolean, duration: number, anim: Record<string, string>): TextLayer[] {
  const out: TextLayer[] = [], shotOf = (p: Purpose) => shots.find((s) => s.purpose === p);
  const place = (s: Shot, text: string, size: number) => textY(images[s.imageIndex], { cx: s.camera.end.cx, cy: s.camera.end.cy, hh: s.camera.end.hh, roll: 0 }, text, size);
  const layer = (id: string, text: string, start: number, end: number, y: number, size: number, a: string, role: TextLayer["role"]): TextLayer => ({ id, text, start, end, x: 0.5, y, size, animationIn: a, animationOut: "fade", role });
  [hook, tagline, cta] = [hook.trim(), tagline.trim(), cta.trim()];
  if (hook) { const s = shotOf("reveal") ?? shots[0]; out.push(layer("t1", hook, s.start, Math.min(s.end + 0.5, duration), place(s, hook, 0.07), 0.07, anim.hook ?? "mask_reveal", "hook")); }
  if (tagline) { const s = shotOf("payoff") ?? shots[shots.length - 1]; out.push(layer("t2", tagline, s.start, Math.min(s.end, duration), place(s, tagline, 0.055), 0.055, anim.tagline ?? "slide_up", "tagline")); }
  if (cta) { const s = shotOf("cta") ?? shots[shots.length - 1]; out.push(layer("t3", cta, s.start + 0.1, duration - (loop ? 0.4 : 0.05), place(s, cta, 0.06), 0.06, anim.cta ?? "blur_sharp", "cta")); }
  return out.filter((t) => t.end - t.start >= 0.3);
}
const gfmt = (x: number) => String(Number(x.toPrecision(6)));
/** The plan judged against the brief's own rules before anything is rendered. */
export function checkPlan(plan: ProductReelPlan, images: ImageUnderstanding[], beats: Beats | null = null, phases: Phase[] | null = null): QualityCheck[] {
  const shots = plan.shots, out: QualityCheck[] = [], add = (name: string, ok: boolean, detail = "") => out.push({ name, ok, detail });
  const gaps = shots.slice(1).map((b, i) => r(b.start - shots[i].end));
  add("Timeline is continuous", Math.abs(shots[0].start) < 1e-6 && Math.abs(shots[shots.length - 1].end - plan.duration) < 0.01 && gaps.every((g) => Math.abs(g) < 0.005), `${shots.length} shots covering ${gfmt(plan.duration)}s`);
  const longShots = shots.filter((s) => shotLength(s) > (s.purpose === "cta" ? MAX_ENDING : MAX_SHOT) + 0.01 || shotLength(s) < MIN_SHOT - 0.01).map((s) => s.index + 1);
  add("Every shot is a micro-moment (0.2-1.5 s; the ending up to 2.2 s)", !longShots.length, longShots.length ? `shots out of range: [${longShots.join(", ")}]` : "");
  const story = (phases ?? PHASES).map(([p]) => p), have = new Set(shots.map((s) => s.purpose));
  add("Every part of the story is present", story.every((p) => have.has(p)), story.join(" > "));
  const near = (x: View, y: View) => Math.abs(x.hh - y.hh) / Math.max(x.hh, 1e-6) < 0.06 && Math.abs(x.cx - y.cx) < 0.03 && Math.abs(x.cy - y.cy) < 0.03;
  const repeats = shots.slice(1).filter((s, i) => { const a = shots[i]; return a.framing === s.framing && a.imageIndex === s.imageIndex && s.transitionIn.type !== "match" && near(a.camera.start, s.camera.start) && near(a.camera.end, s.camera.end); }).map((s) => s.index + 1);
  add("No framing repeated back to back", !repeats.length, repeats.length ? `repeated at shots [${repeats.join(", ")}]` : "");
  const kinds = [...new Set(shots.slice(1).map((s) => s.transitionIn.type))].sort();
  add("Transitions are varied", kinds.length >= Math.min(3, Math.max(Math.trunc(shots.length / 3), 1)), `${kinds.length} kinds: ${kinds.join(", ")}`);
  const same = shots.slice(2).filter((s, i) => { const a = shots[i + 1]; return a.transitionIn.type === s.transitionIn.type && !["cut", "match"].includes(a.transitionIn.type); }).map((s) => s.index + 1);
  add("No transition twice in a row", !same.length, same.length ? `repeated before shots [${same.join(", ")}]` : "");
  const nFx = shots.reduce((n, s) => n + s.effects.filter((e) => e.type !== "glow").length, 0);
  add("Effects are restrained (never overloaded)", nFx / Math.max(plan.duration, 1) <= 1.4, `${nFx} effects in ${gfmt(plan.duration)}s`);
  let bad = 0;
  for (const s of shots) { const u = images[s.imageIndex]; for (const e of s.effects) if (e.type === "sparkle" && !(e.x !== null && e.y !== null && contains(u.subject, e.x, e.y) && u.highlights.some((h) => Math.abs(e.x! - h.x) < 1e-3 && Math.abs(e.y! - h.y) < 1e-3))) bad++; }
  add("Sparkles sit only on real reflective highlights of the product", bad === 0, bad ? `${bad} misplaced` : "");
  add("Product protected (only crop, scale and light: nothing is regenerated or stretched)", true, "views are 9:16 windows over the original photo");
  const soft = new Set<number>();
  for (const s of shots) for (const v of [s.camera.start, s.camera.end]) if (REF_HEIGHT / (v.hh * images[s.imageIndex].height) > MAX_UPSCALE + 0.05) soft.add(s.index + 1);
  add("Close-ups stay sharp (no more than 2.6x enlargement)", !soft.size, soft.size ? `soft at shots [${[...soft].sort((a, b) => a - b).join(", ")}]` : "");
  if (beats && !beats.synthetic) { const on = shots.filter((s) => s.beatTime !== null).length; add("Shots start on the beat", on / shots.length >= 0.7, `${on} of ${shots.length}`); }
  const over = plan.texts.filter((t) => { const s = shots.find((x) => x.start <= t.start + 0.01 && t.start + 0.01 < x.end) ?? shots[shots.length - 1]; return textBoxOverlap(images[s.imageIndex], { ...s.camera.end, roll: 0 }, t.y, t.text, t.size) > 0.25; }).map((t) => t.id);
  add("Text stays off the product and in the safe area", !over.length && plan.texts.every((t) => SAFE_TOP <= t.y && t.y <= SAFE_BOTTOM), over.length ? `covers the product: [${over.map((x) => `'${x}'`).join(", ")}]` : "");
  add("Text is minimal", plan.texts.length <= 3);
  if (plan.loop) { const f = shots[0].camera.start, l = shots[shots.length - 1].camera.end; add("Loop closes (last frame matches the first)", Math.abs(f.cx - l.cx) < 1e-3 && Math.abs(f.cy - l.cy) < 1e-3 && Math.abs(f.hh - l.hh) < 1e-3, ""); }
  return out;
}

// ------------------------------------------------------------------ an AI direction, validated
export interface AiDirection { product: string; reason: string; phases: { purpose: string; share: number; camera: string; transition: string }[]; sparkle: string; light: string; hook: string; tagline: string; cta: string;
  hook_animation: string; tagline_animation: string; cta_animation: string; title: string; description: string; hashtags: string[] }
export interface Direction { phases: Phase[]; cameras: Record<string, string>; transitions: Record<string, string>; style: ProductStyle; hook: string; tagline: string; cta: string; animations: Record<string, string>; notes: string[] }
const CAMERAS = ["push_in", "pull_out", "pan_left", "pan_right", "tilt_up", "tilt_down", "drift", "hold"], ANIMS = ["fade", "slide_up", "scale", "mask_reveal", "type_on", "blur_sharp"];
export const cleanText = (text: string, limit = 80) => text.replace(/[\x00-\x1f\x7f{}\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
/** Known purposes only, starts with a hook, ends on the CTA, shares 4-35% (re-normalised), allowed cameras/animations, the
 * person's own texts always win; anything invalid falls back to the built-in choice. */
export function applyDirection(d: AiDirection, style: ProductStyle, images: ImageUnderstanding[], given: { hook: string; tagline: string; cta: string }): Direction {
  const notes: string[] = [], table = new Map(PHASES.map(([p, , lh]) => [p as string, lh]));
  let seen: [Purpose, number][] = [];
  for (const ph of d.phases.slice(0, 12)) {
    if (table.has(ph.purpose) && !Number.isNaN(Number(ph.share))) seen.push([ph.purpose as Purpose, Math.min(Math.max(Number(ph.share), 0.04), 0.35)]);
    else notes.push(`Unknown story phase '${String(ph.purpose).slice(0, 20)}' was ignored.`);
  }
  if (!seen.length || seen[0][0] !== "hook") seen.unshift(["hook", 0.08]);
  const finalCta = (given.cta || d.cta).trim();
  if (finalCta && seen[seen.length - 1][0] !== "cta") seen = [...seen.filter(([p]) => p !== "cta"), ["cta", 0.1]];
  const purposes = new Set(seen.map(([p]) => p));
  if (!["reveal", "hero", "payoff"].some((p) => purposes.has(p as Purpose))) { seen.splice(1, 0, ["hero", 0.2]); notes.push("A hero shot of the whole product was added."); }
  if (!purposes.has("detail") && !purposes.has("macro") && images.some((u) => u.regions.length)) { seen.splice(seen.length - (seen[seen.length - 1][0] === "cta" ? 1 : 0), 0, ["detail", 0.15]); notes.push("A detail close-up was added."); }
  if (seen.length < 3) { notes.push("The AI story was too short; the built-in structure was used."); seen = PHASES.map(([p, s]) => [p, s]); }
  const total = seen.reduce((s, [, x]) => s + x, 0), phases: Phase[] = seen.map(([p, s]) => [p, r(s / total, 4), table.get(p)!]);
  const cams = Object.fromEntries(d.phases.filter((ph) => table.has(ph.purpose) && CAMERAS.includes(ph.camera)).map((ph) => [ph.purpose, ph.camera]));
  const kS = ({ more: 1.5, less: 0.5, none: 0 } as Record<string, number>)[d.sparkle] ?? 1, kL = ({ more: 1, less: -1 } as Record<string, number>)[d.light] ?? 0;
  const newStyle = { ...style, sparkleMax: Math.trunc(Math.min(Math.round(style.sparkleMax * kS), 8)), lightSweeps: Math.trunc(Math.min(Math.max(style.lightSweeps + kL, 0), 3)) };
  const short = (text: string, words: number) => cleanText(text ?? "", 60).split(" ").filter(Boolean).slice(0, words).join(" ");
  const animations = Object.fromEntries(Object.entries({ hook: d.hook_animation, tagline: d.tagline_animation, cta: d.cta_animation }).filter(([, v]) => ANIMS.includes(v)));
  const transitions = Object.fromEntries(d.phases.filter((ph) => table.has(ph.purpose) && PRODUCT_TRANSITIONS.includes(ph.transition)).map((ph) => [ph.purpose, ph.transition]));
  const bad = [...new Set(d.phases.map((ph) => ph.transition).filter((t) => t && !PRODUCT_TRANSITIONS.includes(t)))].sort();
  if (bad.length) notes.push(`Unsupported transition(s) ${bad.slice(0, 4).join(", ")} replaced by the built-in choice.`);
  return { phases, cameras: cams, transitions, style: newStyle, hook: given.hook.trim() || short(d.hook, 6), tagline: given.tagline.trim() || short(d.tagline, 6), cta: given.cta.trim() || short(d.cta, 5), animations, notes };
}
