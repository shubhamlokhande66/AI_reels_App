import "server-only";
import fs from "node:fs";
import { db } from "@/server/core/db";
import { NotFoundError, ValidationFailed } from "@/server/core/errors";
import { round } from "@/server/core/py";
import { getPreset } from "@/server/jobs/pipeline";
import { ensureIds, Timeline } from "@/server/models/timeline";
import { ProjectSettings } from "@/server/projects/settings";
import { localPath } from "@/server/storage/local";
import { getStyle } from "@/server/styles";
import { EditError } from "@/server/timeline/ops";
import * as ts from "@/server/timeline/service";
import { analyzeVideos, projectVideos } from "@/server/video/clips";
import { framing, renderConfig } from "@/server/video/render/cutter";
import { checkRenderFile, checkTimeline, fixForLoudness, fixOperations, type QcIssue } from "./checker";

/** The editor's quality check and one-click fixes (was api/quality.py), and the renderer's own framing / brightness /
 * grade per shot for the live preview (services/preview_hints.py). */

const ORDER: Record<string, number> = { error: 0, warning: 1, info: 2 };

async function issuesOf(doc: Awaited<ReturnType<typeof ts.load>>): Promise<[QcIssue[], Record<string, unknown>]> {
  if (!doc.timeline) throw new NotFoundError("This project has no timeline yet.", { code: "NO_TIMELINE" });
  const state = ts.stateOf(doc), tl = Timeline.parse(ensureIds(state.timeline as Record<string, unknown>)), s = ProjectSettings.parse(doc.settings ?? {});
  const issues = checkTimeline(tl, s.duration);
  const checked: Record<string, unknown> = { timelineVersion: state.version, renderingId: null, kind: null };
  const rid = doc.previewRenderingId ?? doc.latestRenderingId;
  const r = rid ? await (await db()).collection("renderings").findOne({ _id: rid }) : null;
  if (r && (r.timelineVersion ?? 1) === state.version && fs.existsSync(localPath(r.storedKey as string))) {
    const preset = getPreset(s.exportPreset), size: [number, number] | null = (r.kind ?? "final") === "final" ? [preset.width, preset.height] : null;
    let fades = false;
    try { fades = getStyle(tl.style).fadeInOut > 0; } catch { /* unknown style */ }
    issues.push(...(await checkRenderFile(localPath(r.storedKey as string), size, tl.duration, fades)));
    Object.assign(checked, { renderingId: String(r._id), kind: r.kind ?? "final" });
  }
  return [issues.sort((a, b) => (ORDER[a.severity] ?? 3) - (ORDER[b.severity] ?? 3)), checked];
}

export async function qualityCheck(projectId: string) {
  const [issues, checked] = await issuesOf(await ts.load(projectId));
  return { ok: !issues.some((i) => i.severity === "error"), issues, checked };
}

/** The fix for one issue as a single undoable edit, then what is left. */
export async function qualityFix(projectId: string, code: string, segmentId: string | null) {
  const doc = await ts.load(projectId), state = ts.stateOf(doc);
  if (!state.timeline) throw new NotFoundError("This project has no timeline yet.", { code: "NO_TIMELINE" });
  const tl = Timeline.parse(state.timeline), s = ProjectSettings.parse(doc.settings ?? {});
  let candidates = fixOperations(code, tl, s.duration, segmentId);
  if (code === "AUDIO_LOUDNESS") {
    const [found] = await issuesOf(doc), lufs = found.find((i) => i.code === "AUDIO_LOUDNESS")?.details.lufs as number | undefined;
    candidates = lufs !== undefined && lufs !== null ? fixForLoudness(tl, Number(lufs)) : [];
  }
  if (!candidates.length) throw new ValidationFailed("This issue cannot be fixed automatically.", { code: "NO_AUTO_FIX" });
  let newState = null, lastError: unknown = null;
  for (const ops of candidates) {
    try { newState = await ts.apply(projectId, ops, `Auto-fix: ${code.replace(/_/g, " ").toLowerCase()}`, false); break; }
    catch (e) { if (!(e instanceof EditError)) throw e; lastError = e; }
  }
  if (!newState) throw new ValidationFailed(`The automatic fix did not work: ${(lastError as Error)?.message}`, { code: "AUTO_FIX_FAILED" });
  const [issues, checked] = await issuesOf(await ts.load(projectId));
  return { state: newState, issues, checked };
}

function eqOf(filter: string | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of (filter ?? "").matchAll(/eq=([^,[]+)/g)) for (const kv of m[1].split(":")) { const [k, v] = kv.split("="); if (v !== undefined && Number.isFinite(Number(v))) out[k.trim()] = Number(v); }
  return out;
}

/** What the renderer will do to each shot, so the live preview shows the same picture. */
export async function previewHints(projectId: string) {
  const doc = await ts.load(projectId);
  if (!doc.timeline) throw new NotFoundError("This project has no timeline yet.", { code: "NO_TIMELINE" });
  const tl = Timeline.parse(ensureIds(ts.stateOf(doc).timeline as Record<string, unknown>));
  const { videos } = await projectVideos(projectId), clips = await analyzeVideos(projectId, videos), cfg = renderConfig();
  const out: Record<string, unknown> = {};
  for (const seg of tl.segments) {
    const a = clips.get(seg.clipId);
    if (!a) continue;
    const wl = a.windows.reduce((s, w) => s + (w.end - w.start), 0);
    const brightness = a.windows.length ? a.windows.reduce((s, w) => s + w.brightness * (w.end - w.start), 0) / Math.max(wl, 1e-6) : 0.5;
    const src = { path: "", width: a.metadata.width, height: a.metadata.height, content: a.contentRect as [number, number, number, number] | null, shaky: a.shakeScore > 0.35, brightness };
    const [mode, crop] = framing(seg, src, cfg);
    const [w, h, x, y] = crop.split("=")[1].split(":").map(Number), sw = Math.max(src.width, 1), sh = Math.max(src.height, 1);
    let lift = 0, gamma = 0;
    if (brightness < 0.32) { lift = Math.min((0.32 - brightness) * 0.9, 0.18); gamma = 1 + lift * 1.5; }
    else if (brightness > 0.8) gamma = Math.max(1 - (brightness - 0.8) * 1.2, 0.8);
    out[seg.id] = { mode, crop: { x: round(x / sw, 4), y: round(y / sh, 4), w: round(w / sw, 4), h: round(h / sh, 4) }, lift: round(lift, 3), gamma: round(gamma, 3), stabilized: Boolean(cfg.stabilize && src.shaky) };
  }
  let grade: Record<string, number> = {};
  try { grade = tl.colorGrade ? {} : eqOf(getStyle(tl.style).gradeFilter); } catch { /* no grade of its own */ }
  return { segments: out, grade };
}
