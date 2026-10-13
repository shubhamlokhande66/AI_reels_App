import "server-only";
import fs from "node:fs";
import path from "node:path";
import { draftPlan, mergeAi, type CreativePlan, type HookOption, type ProjectBrief } from "@/server/director/creative";
import { buildMusicMap } from "@/server/director/musicMap";
import { AppError } from "@/server/core/errors";
import type { ClipInput } from "@/server/models/clip";
import type { ProjectSettings } from "@/server/projects/settings";
import { projectKey } from "@/server/media/service";
import { localPath } from "@/server/storage/local";
import { AUTO_STYLE, listStyles } from "@/server/styles";
import { chooseMusicWindow, planSlots, templateSlots } from "@/server/video/timeline";
import { askDirector, buildRequest, cacheKey, DirectorPlanRejected, planToTimeline, ReelDirectorPlan, type DirectedPlan } from "./director";
import { getProvider } from "./index";
import { setPipelineAi, type DirectedReel, type PipelineAi } from "./pipelineAi";
import { askReviewer, planStory, postCopy, suggestClipOrder, suggestStyle, transcribe, understandClip } from "./tasks";

/** The real AI behind the pipeline boundary (was the AI parts of jobs/pipeline.py: direct_reel, write_copy,
 * understand_clips, choose_style_and_order, the song part and reviewer calls, captions). */

const REVISE_AT = 3;
const problemsOf = (d: DirectedPlan) => [...d.log.flatMap((row) => row.changes.map((c) => `shot ${row.shot}: ${c}`)), ...d.fixes.filter((f) => f.includes("scaled by") && !f.startsWith("Shot ")), ...d.problems];

function brandFacts(brand: Record<string, unknown> | null) {
  if (!brand) return null;
  const keep: Record<string, unknown> = { name: brand.name ?? "", tone: brand.scriptTone || brand.tone || "", visual_style: brand.visualStyle || "", cta: brand.cta || "",
    colors: Object.fromEntries(Object.entries((brand.colors as Record<string, string>) ?? {}).filter(([, v]) => v)), heading_font: brand.headingFont || "" };
  return Object.fromEntries(Object.entries(keep).filter(([, v]) => (typeof v === "object" ? Object.keys(v as object).length : v)));
}

const impl: PipelineAi = {
  understandClip: (file, clip) => understandClip(getProvider("clip_understanding"), file, clip),

  async directReel(o) {
    const ps = o.settings as ProjectSettings & { projectId?: string; template?: Record<string, unknown> | null; references?: Record<string, unknown>[]; brand?: Record<string, unknown> | null };
    const windowWarnings: string[] = [];
    const [audioStart, eff] = chooseMusicWindow(o.audio, ps.duration, windowWarnings, ps.audioStart);
    const mm = buildMusicMap(o.audio, audioStart, eff);
    const styles = Object.fromEntries(listStyles().filter((s) => !["custom", AUTO_STYLE].includes(s.id)).map((s) => [s.id, s.description]));
    const keepStyle = ps.style !== AUTO_STYLE;
    const brief = o.brief as ProjectBrief | null, hooks = (o.hooks as HookOption[] | null) ?? [];
    const draft: CreativePlan | null = brief ? draftPlan(brief, hooks, mm, { direction: o.direction, pace: ps.pace, hasFace: o.clips.some((c) => c.analysis.windows.some((w) => w.face)) }) : null;
    const tpl = ps.template as { cuts?: number[]; seconds?: number; on_beat_share?: number | null; use_audio?: boolean } | null | undefined;
    let suggested: number[] = [];
    try {
      suggested = (tpl?.cuts?.length ? templateSlots(o.audio, audioStart, eff, tpl.cuts, tpl.seconds || eff, tpl.on_beat_share ?? null, o.style, Boolean(tpl.use_audio)) : planSlots(o.audio, audioStart, eff, o.style)).slice(1).map((s) => s.start);
    } catch { /* a rhythm hint is optional */ }
    const [facts, alias] = buildRequest(o.clips, o.audio, mm, audioStart, eff, styles, { brief: ps.brief, language: ps.language, styleHint: keepStyle ? o.style.id : null, captions: ps.captions,
      cta: ps.ctaText, hook: ps.hookText, pace: ps.pace, suggestedCuts: suggested, references: ps.references ?? [], projectBrief: brief ? { ...brief, notes: undefined } : null,
      creative: draft as unknown as Record<string, unknown>, hooks, brand: brandFacts(ps.brand ?? null) });
    if (!Object.keys(alias).length) return null;
    const provider = getProvider("director"), key = cacheKey(facts, provider.model, o.seed);
    const file = ps.projectId ? localPath(projectKey(ps.projectId, "analysis", `director_${key}.json`)) : null;
    let plan: ReelDirectorPlan | null = null;
    if (file) try { plan = ReelDirectorPlan.parse(JSON.parse(fs.readFileSync(file, "utf8"))); } catch { plan = null; }
    const reused = plan !== null;
    const check = (p: ReelDirectorPlan) => planToTimeline(p, alias, o.clips, mm, audioStart, eff, o.style, { styleIds: new Set(Object.keys(styles)), keepStyle, seed: o.seed, hookText: ps.hookText, ctaText: ps.ctaText, pace: ps.pace });
    let directed: DirectedPlan, revision: { before: number; after: number; used: boolean } | null = null;
    if (!plan) {
      plan = await askDirector(provider, facts, o.seed);
      try { directed = check(plan); }
      catch (e) {
        if (!(e instanceof DirectorPlanRejected)) throw e;
        plan = await askDirector(provider, facts, o.seed, plan, [e.message]);
        directed = check(plan);
        revision = { before: 1, after: 0, used: true };
      }
      const problems = problemsOf(directed);
      if (revision) revision.after = problems.length;
      if (!revision && problems.length >= REVISE_AT) {
        revision = { before: problems.length, after: problems.length, used: false };
        try {
          const plan2 = await askDirector(provider, facts, o.seed, plan, problems), d2 = check(plan2), after = problemsOf(d2).length;
          revision.after = after;
          if (after < problems.length) { plan = plan2; directed = d2; revision.used = true; }
        } catch (e) { if (!(e instanceof AppError)) throw e; }
      }
      if (file) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(plan)); }
    } else directed = check(plan);
    const tl = directed.timeline;
    tl.warnings = [...windowWarnings, ...tl.warnings];
    const creative = draft ? mergeAi(draft, plan.concept ? { concept: plan.concept.concept, logline: plan.concept.logline, hookType: plan.concept.hook_type, story: plan.concept.story, pacing: plan.concept.pacing,
      visualEnergy: plan.concept.visual_energy, musicInterpretation: plan.concept.music_interpretation, textStrategy: plan.concept.text_strategy, effectsStrategy: plan.concept.effects_strategy,
      transitionStrategy: plan.concept.transition_strategy, ending: plan.concept.ending } : null, tl.segments.length ? { clipId: tl.segments[0].clipId, asset: tl.segments[0].video,
      start: Math.round(tl.segments[0].sourceStart * 100) / 100, duration: Math.round((tl.segments[0].timelineEnd - tl.segments[0].timelineStart) * 100) / 100 } : null) : null;
    const last = provider.lastResult, who = (last?.provider ?? provider.name).replace(/^./, (c) => c.toUpperCase());
    tl.notes = [`AI director (${who}${reused ? ", reused plan" : ""}): ${plan.reason}`.replace(/: $/, "")];
    tl.notes.push(...directed.fixes.slice(0, 8).map((f) => `Safety check: ${f}`));
    if (directed.fixes.length > 8) tl.notes.push(`Safety check: ${directed.fixes.length - 8} more small repairs.`);
    if (last?.fallbackUsed) tl.notes.push(`The main AI provider was unavailable; ${last.provider} planned this Reel.`);
    if (revision) tl.notes.push(`The AI revised its own plan: ${revision.before} problems before, ${revision.after} after` + (revision.used ? "." : " (the first plan was kept)."));
    const aiLog = { revision, provider: last?.provider ?? provider.name, model: (last?.model ?? provider.model) || "", reused, latencyMs: reused || !last ? null : last.latencyMs,
      tokens: reused || !last ? null : { input: last.inputTokens, output: last.outputTokens }, idea: plan.reason, concept: plan.concept, style: { asked: plan.style, used: tl.style },
      grade: { asked: plan.grade, used: tl.colorGrade }, texts: { asked: plan.overlays.map((x) => ({ text: x.text, start: x.start, end: x.end, role: x.role })), used: tl.overlays.map((x) => ({ text: x.text, start: x.start, end: x.end, role: x.role })) },
      shots: directed.log, fixes: directed.fixes };
    const out: DirectedReel = { timeline: tl, postCopy: directed.postCopy, creative, pace: directed.pace, aiLog, log: directed.log, fixes: directed.fixes, problems: directed.problems };
    return out;
  },

  writeCopy: (o) => postCopy(getProvider("copy"), o),

  async chooseSongPart(o) {
    const SYSTEM = "You are a music editor choosing which part of a song a short vertical video (Reel) uses. Reply with JSON only.";
    const user = { reel_seconds: o.duration, instructions: o.brief || "(none)", concept: o.concept || "auto", footage: o.footage, new_version: o.newVersion, candidates: o.candidates,
      task: "Choose the candidate that best fits the instructions, concept and footage. Calm or luxury footage suits softer, elegant parts; action and celebration suit the drop or chorus. If the instructions name a part (intro, chorus, drop, a time), follow them. For a new version pick a different candidate than 0 unless the instructions name a part. Return {\"pick\": <index>, \"reason\": \"<short, for the person>\"}." };
    const ans = await getProvider("music").chatJson(SYSTEM, JSON.stringify(user), { temperature: 0, task: "music" });
    return { pick: Number.isInteger(Number(ans.pick)) ? Number(ans.pick) : -1, reason: String(ans.reason ?? "") };
  },

  suggestStyle: (o) => suggestStyle(getProvider("style"), listStyles(), o.clips, o.audio, o.projectName),

  async suggestOrder(o) {
    const semanticReady = o.clips.some((c: ClipInput) => c.semantic !== null);
    if (o.brief && semanticReady) return planStory(getProvider("story"), o.brief, o.language, o.clips, o.duration);
    return suggestClipOrder(getProvider("order"), o.clips, o.audio, o.duration);
  },

  review: (o) => askReviewer(getProvider("reviewer"), o.card, o.timeline, o.plan as Record<string, unknown> | null),

  transcribe: (file, start, duration, progress) => transcribe(file, start, duration, progress),

  info(tasks, director) {
    try {
      const p = getProvider(director ? "director" : tasks.length === 1 && tasks[0] === "clip_understanding" ? "clip_understanding" : "copy");
      return { provider: p.name, model: p.model || "", local: p.isLocal, tasks: [...new Set(tasks)], director, fallbackUsed: Boolean(p.lastResult?.fallbackUsed) };
    } catch { return null; }
  },
};

setPipelineAi(impl);
