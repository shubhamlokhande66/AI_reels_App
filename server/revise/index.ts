import "server-only";
import fs from "node:fs";
import { getProvider, type ManagedProvider } from "@/server/ai";
import { analyzeMusic } from "@/server/audio/analyzer";
import { db } from "@/server/core/db";
import { ConflictError, NotFoundError } from "@/server/core/errors";
import { PyRandom } from "@/server/core/random";
import { peakIndex, reviseOnce, windowAt } from "@/server/director/creativeReview";
import { buildMusicMap, energyAtMap, levelAt, type MusicMap } from "@/server/director/musicMap";
import { GenerateRequest, submit, submitRender } from "@/server/jobs/manager";
import { projectKey } from "@/server/media/service";
import type { ClipInput } from "@/server/models/clip";
import { parseTimeline, type Segment, type Timeline } from "@/server/models/timeline";
import { jobOut, updateProject } from "@/server/projects/service";
import { ProjectUpdate } from "@/server/projects/settings";
import { localPath } from "@/server/storage/local";
import { getStyle } from "@/server/styles";
import { applyOperations } from "@/server/timeline/ops";
import * as ts from "@/server/timeline/service";
import { clipInputs, projectVideos, savedSemantics } from "@/server/video/clips";
import { overlapSeconds } from "@/server/video/footage";
import { assignEffects, assignTransitions, type Slot } from "@/server/video/timeline";
import * as rv from "./actions";

/** Change a finished Reel with words (was api/revise.py, revise/inplace.py, revise/director_patch.py). */

type Doc = Record<string, unknown>;
const segLen = (s: Segment) => s.timelineEnd - s.timelineStart;
const clone = (tl: Timeline): Timeline => parseTimeline(JSON.parse(JSON.stringify(tl)));

// ------------------------------------------------------------------ in place: style / pace on the current blueprint
const ENERGY_VALUE: Record<string, number> = { low: 0.25, medium: 0.5, high: 0.75, very_high: 0.95 };
const FAST_SHOT = 1.6, CALM_SHOT = 4.5;
const slotsOf = (tl: Timeline, mm: MusicMap | null): Slot[] => tl.segments.map((s, i) => ({ index: i, start: s.timelineStart, end: s.timelineEnd, energy: mm ? ENERGY_VALUE[energyAtMap(mm, s.timelineStart)] ?? 0.5 : 0.5, onStrong: Boolean(mm && levelAt(mm, s.timelineStart) >= 3) }));
function restyle(tl: Timeline, styleId: string, mm: MusicMap | null, seed = 0): string[] {
  const style = getStyle(styleId), rng = new PyRandom(seed), slots = slotsOf(tl, mm);
  const kept = new Map(tl.segments.filter((s) => s.locked).map((s) => [s.id, [s.effect, { ...s.transitionIn }] as const]));
  assignEffects(tl.segments, slots, style, rng);
  assignTransitions(tl.segments, slots, style, rng);
  tl.style = style.id;
  tl.colorGrade = null;
  for (const s of tl.segments) {
    const k = kept.get(s.id);
    if (k) { s.effect = k[0]; s.transitionIn = k[1]; continue; }
    s.reason = `${(s.reason || `${s.video}:`).split(" Restyled")[0]} Restyled as ${style.name}: same shot, new effect and transition.`;
  }
  return [`Restyled as ${style.name}: the same ${tl.segments.length} shots and cuts, with its effects, transitions and colour grade.`];
}
const r3 = (x: number) => Math.round(x * 1000) / 1000;
function splitLong(tl: Timeline, mm: MusicMap | null, longest: number): number {
  let n = 0, i = 0;
  while (i < tl.segments.length) {
    const s = tl.segments[i];
    if (segLen(s) > longest && !s.locked) {
      const inner = (mm?.beats ?? []).map((b) => b.t).filter((t) => s.timelineStart + 0.5 < t && t < s.timelineEnd - 0.5), mid = (s.timelineStart + s.timelineEnd) / 2;
      const cut = inner.length ? inner.reduce((best, b) => { const kb = [levelAt(mm!, b), -Math.abs(b - mid)], kx = [levelAt(mm!, best), -Math.abs(best - mid)]; return kb[0] > kx[0] || (kb[0] === kx[0] && kb[1] > kx[1]) ? b : best; }) : r3(mid);
      const second: Segment = JSON.parse(JSON.stringify(s));
      second.id = `${s.id.slice(0, 9)}s${String(n).padStart(2, "0")}`;
      second.timelineStart = r3(cut);
      second.sourceStart = r3(s.sourceStart + (cut - s.timelineStart) * s.speed);
      second.transitionIn = { type: "cut", duration: 0 };
      second.effect = ["none", "zoom_in", "zoom_out"].includes(s.effect) ? "punch" : s.effect;
      second.reason = `${s.video}: Split on the beat for a faster pace; the footage carries on, nothing repeats.`;
      s.timelineEnd = second.timelineStart;
      s.sourceEnd = second.sourceStart;
      tl.segments.splice(i + 1, 0, second);
      n++;
      continue; // the first half may still be long
    }
    i++;
  }
  return n;
}
function mergeShort(tl: Timeline, clipLengths: Record<string, number>, longest: number): number {
  let n = 0, i = 1;
  while (i < tl.segments.length) {
    const a = tl.segments[i - 1], b = tl.segments[i], total = segLen(a) + segLen(b), needEnd = a.sourceStart + total * a.speed;
    if (total <= longest && needEnd <= (clipLengths[a.clipId] ?? 0) + 1e-6 && tl.segments.length > 2 && !(a.locked || b.locked)) {
      a.timelineEnd = b.timelineEnd;
      a.sourceEnd = r3(needEnd);
      a.reason = `${a.video}: Plays on for a calmer pace (fewer cuts).`;
      tl.segments.splice(i, 1);
      n++;
    }
    i++; // after a merge, leave the next pair alone so the rhythm does not collapse into one long shot
  }
  return n;
}
function repace(tl: Timeline, pace: string, mm: MusicMap | null, clipLengths: Record<string, number>): string[] {
  const before = tl.segments.length;
  if (pace === "fast") { const k = splitLong(tl, mm, FAST_SHOT); return [k ? `Faster: ${k} long shot(s) split on the beat (${before} -> ${tl.segments.length} shots), same footage, nothing repeated.` : "Already fast: no shot was long enough to split."]; }
  if (pace === "calm") { const k = mergeShort(tl, clipLengths, CALM_SHOT); return [k ? `Calmer: ${k} cut(s) removed (${before} -> ${tl.segments.length} shots); those shots play on instead.` : "Could not calm it further without repeating footage; try a calmer style instead."]; }
  return [];
}
export function applyStylePace(tl: Timeline, style: string | null, pace: string | null, mm: MusicMap | null, clipLengths: Record<string, number>): [Timeline, string[]] {
  const out = clone(tl), notes: string[] = [];
  if (style) notes.push(...restyle(out, style, mm));
  if (pace === "fast" || pace === "calm") notes.push(...repace(out, pace, mm, clipLengths));
  return [out, notes];
}

// ------------------------------------------------------------------ director patches on the current edit
const PRODUCT_CATEGORIES = new Set(["product", "jewelry", "fashion", "beauty"]);
function productValue(clip: ClipInput | undefined, w: { subject: number; quality: number; shotSize?: string | null }) {
  const isProduct = Boolean(clip?.semantic && PRODUCT_CATEGORIES.has(clip.semantic.category as string)), vis = clip?.analysis.productVisibility ?? null;
  return (vis !== null && vis !== undefined ? vis : 0.5 * w.subject + 0.3 * w.quality + (w.shotSize === "close" ? 0.2 : 0)) + (isProduct ? 0.5 : 0);
}
/** Swap the footage of shots i and k keeping every cut time; undone (false) when it would show a moment twice. */
function swapFootage(tl: Timeline, i: number, k: number, byId: Map<string, ClipInput>): boolean {
  const a = tl.segments[i], b = tl.segments[k], before = [{ ...a }, { ...b }] as const;
  const pick = (s: Segment) => ({ clipId: s.clipId, video: s.video, sourceStart: s.sourceStart, speed: s.speed, focusX: s.focusX, focusY: s.focusY, focusSource: s.focusSource, reason: s.reason });
  const fa = pick(a), fb = pick(b);
  for (const [seg, f] of [[a, fb], [b, fa]] as const) {
    Object.assign(seg, f);
    seg.sourceEnd = r3(seg.sourceStart + segLen(seg) * seg.speed);
    const room = byId.get(seg.clipId)?.analysis.metadata.duration;
    if (room !== undefined && seg.sourceEnd > room) { seg.sourceStart = r3(Math.max(room - segLen(seg) * seg.speed, 0)); seg.sourceEnd = r3(Math.min(room, seg.sourceStart + segLen(seg) * seg.speed)); }
  }
  for (const j of [i, k]) {
    const s = tl.segments[j], others = tl.segments.filter((o, n) => n !== j && o.clipId === s.clipId).map((o) => [o.sourceStart, o.sourceEnd] as [number, number]);
    if (overlapSeconds(s.sourceStart, s.sourceEnd, others) > 0.1) { Object.assign(a, before[0]); Object.assign(b, before[1]); return false; }
  }
  return true;
}
export function applyPatches(tl: Timeline, kinds: string[], clips: ClipInput[], mm: MusicMap | null, brief = ""): [Timeline, string[]] {
  const out = clone(tl), notes: string[] = [], byId = new Map(clips.map((c) => [c.clipId, c]));
  const run = (fix: string, index: number, problem: string) => {
    const seg = out.segments[index], was = seg.locked;
    seg.locked = false; // the person's request names this shot
    const changed = reviseOnce(out, { overallScore: 0, categories: {}, issues: [{ timestamp: seg.timelineStart, problem, severity: "high", category: "request", fix }], iterations: [] }, clips, mm, { brief });
    out.segments[index].locked = was || changed.length > 0; // changed on request: the person's choice now
    return changed;
  };
  for (const kind of kinds) {
    if (kind === "replace_hook" && out.segments.length) { const d = run("replace_opening", 0, "the person asked for a stronger opening"); notes.push(...(d.length ? d : ["The opening is already the strongest unused moment in your footage."])); }
    else if (kind === "drop_reveal") {
      const peak = peakIndex(out, mm);
      if (peak === null) { notes.push("This part of the song has no clear drop or peak inside the Reel to put the reveal on."); continue; }
      const d = run("hero_on_drop", peak, "the person asked for the reveal on the drop");
      notes.push(...(d.length ? d : [`The strongest moment is already on the music's peak (shot ${peak + 1}).`]));
    } else if (kind === "product_earlier") {
      if (out.segments.length < 3) { notes.push("The Reel is too short to move the product earlier."); continue; }
      const vals = out.segments.map((s, i) => { const c = byId.get(s.clipId), w = windowAt(c, s.sourceStart); return w ? [i, productValue(c, w as never)] as const : null; }).filter((v) => v !== null);
      if (!vals.length) { notes.push("The footage of this Reel was not analysed, so the product shot could not be found."); continue; }
      const bestI = vals.reduce((m, v) => (v[1] > m[1] ? v : m))[0];
      if (bestI <= 1) { notes.push("The clearest product shot is already at the start."); continue; }
      const a = out.segments[1];
      if (a.locked && bestI !== 1) { notes.push("Shot 2 was set by hand, so the product shot was not moved there."); continue; }
      if (!swapFootage(out, 1, bestI, byId)) { notes.push("The clearest product shot could not move to shot 2 without showing a moment twice."); continue; }
      a.locked = true;
      notes.push(`Moved the clearest product shot (${a.video}) to shot 2; the cuts and the music sync are unchanged.`);
    }
  }
  return [out, notes];
}

// ------------------------------------------------------------------ the request
async function provider(): Promise<ManagedProvider | null> {
  try { const p = getProvider("revision"); return (await p.health()).available ? p : null; } catch { return null; } // an unreachable model never blocks the rules
}
function clipDescriptions(projectId: string, ids: Set<string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [cid, s] of savedSemantics(projectId, [...ids].map((id) => ({ id, name: "", key: "", width: 0, height: 0 })))) {
    const text = [s.summary, ((s.objects as string[]) ?? []).slice(0, 4).join(", ")].filter(Boolean).join(" ");
    if (text) out[cid] = text;
  }
  return out;
}
async function musicMap(projectId: string, doc: Doc, tl: Timeline): Promise<MusicMap | null> {
  const aid = doc.audioId ? String(doc.audioId) : null;
  if (!aid || !fs.existsSync(localPath(projectKey(projectId, "analysis", `audio_${aid}.json`)))) return null;
  const media = await (await db()).collection("media").findOne({ _id: doc.audioId as never });
  if (!media) return null;
  try { return buildMusicMap(await analyzeMusic(projectId, { id: aid, key: media.storedKey as string }), tl.audioStart, tl.duration); } catch { return null; }
}
async function clipsOf(projectId: string): Promise<ClipInput[]> {
  try { return await clipInputs(projectId, (await projectVideos(projectId)).videos); } catch { return []; }
}
const understood = (actions: rv.Action[]) => actions.map((a) => ({ text: a.text, does: rv.describe(a), source: a.source, rebuild: rv.isRebuild(a) }));
const INPLACE_KINDS = new Set(["style", "pace"]);

export interface ReviseRequest { instruction: string; useAi: boolean; dryRun: boolean; confirmedActions: Record<string, unknown>[] | null }
/** Understand the request, apply it and start rendering the new version: shot-level and mix changes edit the current
 * timeline; style / pace restyle it in place; creative patches run on it; other whole-edit changes rebuild from the clips. */
export async function revise(projectId: string, p: ReviseRequest) {
  const doc = await ts.load(projectId);
  if (doc.status === "processing") throw new ConflictError("This project is already being processed. Try again when it finishes.", { code: "PROJECT_BUSY" });
  if (!doc.timeline) throw new NotFoundError("Generate a Reel first, then describe what to change.", { code: "NO_TIMELINE" });
  const tl = parseTimeline(ts.stateOf(doc).timeline), settings = (doc.settings as Record<string, unknown>) ?? {};
  const prov = p.useAi ? await provider() : null;
  const plan: rv.Plan = p.confirmedActions !== null
    ? { actions: rv.actionsFromDicts(p.confirmedActions, tl.segments.length), notUnderstood: [], usedAi: false, aiNote: null }
    : await rv.planRevision(p.instruction, tl, settings, prov, prov ? clipDescriptions(projectId, new Set(tl.segments.map((s) => s.clipId))) : {});
  const needsConfirmation = p.confirmedActions === null && plan.actions.some((a) => a.source === "ai" || rv.DESTRUCTIVE_KINDS.has(a.kind)), dry = p.dryRun || needsConfirmation;
  const base: Record<string, unknown> = { understood: understood(plan.actions), notUnderstood: plan.notUnderstood, usedAi: plan.usedAi, aiNote: plan.aiNote, examples: rv.EXAMPLES, warnings: [], notes: [], job: null,
    needsConfirmation, actions: plan.actions, patches: plan.actions.map((a) => rv.toPatch(a, tl)) };
  if (!plan.actions.length) return { ...base, mode: "none" };
  const label = rv.shortLabel(p.instruction), rebuild = plan.actions.filter(rv.isRebuild), hist = (doc.timelineHistory as unknown[]) ?? [];
  const finish = async (newTl: Timeline, notes: string[]) => { await ts.replace(projectId, newTl, label); return { ...base, mode: "edit", notes, job: jobOut(await submitRender(projectId, "final", label)) }; };

  if (!rebuild.length && plan.actions.some((a) => rv.DIRECTOR_KINDS.has(a.kind))) {
    const kinds = plan.actions.filter((a) => rv.DIRECTOR_KINDS.has(a.kind));
    if (dry) return { ...base, mode: "edit", notes: kinds.map(rv.describe) };
    const [newTl0, notes] = applyPatches(tl, kinds.map((a) => a.kind), await clipsOf(projectId), await musicMap(projectId, doc, tl), String(settings.brief ?? ""));
    let newTl = newTl0;
    const others = plan.actions.filter((a) => !rv.DIRECTOR_KINDS.has(a.kind));
    if (others.length) {
      const ctx = await ts.contextFor(doc), [ops, more] = rv.actionsToOps(others, newTl, ctx.audioDuration);
      if (ops.length) newTl = applyOperations(newTl, ops, ctx);
      notes.push(...more);
    }
    return finish(newTl, notes);
  }
  if (rebuild.length && rebuild.every((a) => INPLACE_KINDS.has(a.kind)) && !plan.actions.some((a) => a.kind === "duration")) {
    const ov = rv.rebuildOverrides(plan.actions), ctx = await ts.contextFor(doc);
    let [newTl, notes] = applyStylePace(tl, (ov.style as string) ?? null, (ov.pace as string) ?? null, await musicMap(projectId, doc, tl), ctx.clipDurations);
    const others = plan.actions.filter((a) => !rv.isRebuild(a));
    let ops: ReturnType<typeof rv.actionsToOps>[0] = [], more: string[] = [];
    if (others.length) [ops, more] = rv.actionsToOps(others, newTl, ctx.audioDuration);
    notes = [...notes, ...more];
    if (dry) return { ...base, mode: "edit", notes };
    if (ops.length) newTl = applyOperations(newTl, ops, ctx);
    await ts.replace(projectId, newTl, label);
    const patch = Object.fromEntries(["style", "pace"].filter((k) => k in ov).map((k) => [k, ov[k]]));
    if (Object.keys(patch).length) await updateProject(projectId, ProjectUpdate.parse(patch)); // the next fresh edit starts from them too
    return { ...base, mode: "edit", notes, job: jobOut(await submitRender(projectId, "final", label)) };
  }
  if (rebuild.length) {
    const ov = rv.rebuildOverrides(plan.actions), warnings: string[] = [];
    const follow = plan.actions.filter((a) => !rv.isRebuild(a) && rv.GLOBAL_KINDS.has(a.kind));
    const dropped = plan.actions.filter((a) => !rv.isRebuild(a) && !rv.GLOBAL_KINDS.has(a.kind) && a.kind !== "duration");
    if (dropped.length) warnings.push(`Shot-level changes (${dropped.map(rv.describe).join(", ")}) were not applied because the Reel is being rebuilt from your clips. Ask for them again once the new version is ready.`);
    if (hist.length > 1 || tl.voice !== null) warnings.push("Rebuilding starts a new edit: your manual timeline edits and the voice-over are not carried over. The previous version stays in Versions.");
    if (dry) return { ...base, mode: "rebuild", warnings, overrides: ov };
    const job = await submit(projectId, "generate", GenerateRequest.parse({ ...ov, label }), follow.map((a) => ({ ...a })));
    return { ...base, mode: "rebuild", warnings, job: jobOut(job) };
  }
  const ctx = await ts.contextFor(doc), [ops, notes, applied] = rv.actionsToOps(plan.actions, tl, ctx.audioDuration);
  if (!ops.length) return { ...base, mode: "none", understood: understood(applied), notes, notUnderstood: [...plan.notUnderstood, ...(notes.length ? [] : ["Nothing to change for that request."])] };
  if (dry) return { ...base, mode: "edit", understood: understood(applied), notes };
  await ts.apply(projectId, ops, label, false); // atomic: an invalid op changes nothing
  return { ...base, mode: "edit", understood: understood(applied), notes, job: jobOut(await submitRender(projectId, "final", label)) };
}
