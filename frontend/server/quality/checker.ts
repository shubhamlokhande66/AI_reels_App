import "server-only";
import { findBinary, probe, run } from "@/server/core/ffmpeg";
import { fixed, g, round } from "@/server/core/py";
import { EFFECT_TYPES, segLength, TRANSITION_TYPES, type Timeline } from "@/server/models/timeline";
import { getStyle } from "@/server/styles";
import type { Operation } from "@/server/timeline/ops";
import { normalize } from "@/server/video/overlays";
import { resolveEffect, resolveTransition, SAFE_BOTTOM, SAFE_TOP, textBox, toLayers } from "@/server/video/render/text";

/** Problems in the timeline (fast) and in the rendered file (real analysis), with fixes as edit operations (was
 * quality/checker.py). Nothing here changes source media. */

const MIN_SHOT = 0.35, DURATION_TOLERANCE = 0.35, BLACK_MIN_SECONDS = 0.3, BLACK_EDGE_GRACE = 0.8, LONG_SHOT = 7, RAPID_CUT = 0.5, RAPID_RUN = 4;
export const TARGET_LUFS = -14;
const LOUDNESS_TOLERANCE = 5, FROZEN_MIN_SECONDS = 1, CAPTION_BAND_TOP = 1 - 0.22 - 0.06, SYNC_SEARCH = 0.25, SYNC_OFF = 0.07, SCENE_THRESHOLD = 0.3;

export interface QcIssue { code: string; severity: "error" | "warning" | "info"; message: string; fix: string | null; segmentId: string | null; details: Record<string, unknown> }
const qi = (code: string, severity: QcIssue["severity"], message: string, o: { fix?: string; segmentId?: string; details?: Record<string, unknown> } = {}): QcIssue =>
  ({ code, severity, message, fix: o.fix ?? null, segmentId: o.segmentId ?? null, details: o.details ?? {} });

export function checkTimeline(tl: Timeline, target: number | null = null): QcIssue[] {
  if (!tl.segments.length) return [qi("EMPTY_TIMELINE", "error", "The timeline has no shots.")];
  const out: QcIssue[] = [];
  if (target && Math.abs(tl.duration - target) > DURATION_TOLERANCE) {
    const diff = tl.duration - target;
    out.push(qi("DURATION_MISMATCH", "warning", `The Reel is ${fixed(tl.duration, 1)}s but the target is ${g(target)}s (${fixed(Math.abs(diff), 1)}s ${diff > 0 ? "too long" : "too short"}).`,
      { fix: `Adjust shots to ${g(target)}s`, details: { duration: tl.duration, target } }));
  }
  for (const s of tl.segments) if (segLength(s) < MIN_SHOT) out.push(qi("SHORT_CLIP", "warning", `'${s.video}' is only ${fixed(segLength(s), 2)}s (too short to register).`, { fix: "Lengthen or remove", segmentId: s.id, details: { length: segLength(s) } }));
  tl.segments.forEach((s, i) => {
    for (const prev of tl.segments.slice(0, i)) {
      if (prev.clipId !== s.clipId) continue;
      if (Math.min(prev.sourceEnd, s.sourceEnd) - Math.max(prev.sourceStart, s.sourceStart) > 0.5 * Math.min(prev.sourceEnd - prev.sourceStart, s.sourceEnd - s.sourceStart)) {
        out.push(qi("REPEATED_CLIP", "warning", `The same moment of '${s.video}' appears twice.`, { fix: "Remove the repeat", segmentId: s.id }));
        break;
      }
    }
  });
  let limit = LONG_SHOT;
  try { limit = Math.max(LONG_SHOT, getStyle(tl.style).maxSegment * 1.5); } catch { /* unknown style: the default */ }
  for (const s of tl.segments) if (segLength(s) > limit) out.push(qi("LONG_SHOT", "warning", `'${s.video}' is held for ${fixed(segLength(s), 1)}s; Reels feel static past ~${fixed(limit, 0)}s.`, { fix: "Split the shot", segmentId: s.id, details: { length: segLength(s) } }));
  let runLen: typeof tl.segments = [];
  for (const s of [...tl.segments, null]) {
    if (s && segLength(s) < RAPID_CUT) { runLen.push(s); continue; }
    if (runLen.length >= RAPID_RUN) out.push(qi("RAPID_CUTS", "warning", `${runLen.length} shots under ${RAPID_CUT}s in a row from ${fixed(runLen[0].timelineStart, 1)}s read as flicker. Ask for 'calmer' or 'longer shots' to fix it.`,
      { segmentId: runLen[0].id, details: { start: runLen[0].timelineStart, count: runLen.length } }));
    runLen = [];
  }
  for (const s of tl.segments) {
    if (!EFFECT_TYPES.includes(s.effect)) out.push(qi("UNSUPPORTED_EFFECT", "warning", `'${s.video}' uses an effect the renderer does not know ('${s.effect}').`, { fix: "Use the closest supported effect", segmentId: s.id }));
    if (!TRANSITION_TYPES.includes(s.transitionIn.type)) out.push(qi("UNSUPPORTED_TRANSITION", "warning", `'${s.video}' uses an unknown transition ('${s.transitionIn.type}').`, { fix: "Use the closest supported transition", segmentId: s.id }));
    if (!(s.focusX >= 0 && s.focusX <= 1 && s.focusY >= 0 && s.focusY <= 1) || !["auto", "fill", "fit"].includes(s.crop.framing)) out.push(qi("INVALID_CROP", "warning", `'${s.video}' has framing values outside the picture.`, { fix: "Reset the framing", segmentId: s.id }));
  }
  if (tl.overlays.length) {
    const [tidy] = normalize(tl.overlays, tl.duration);
    if (JSON.stringify(tidy.map((o) => [o.text, o.start, o.end])) !== JSON.stringify(tl.overlays.map((o) => [o.text, o.start, o.end])))
      out.push(qi("TEXT_TIMING", "warning", "Some on-screen texts overlap, are too short to read, too long, or run past the end.", { fix: "Tidy the texts" }));
    for (const layer of toLayers(tidy, false, 1080, 1920)) {
      const [left, top, right, bottom] = textBox(layer, 1080, 1920);
      if (left < 0.05 || right > 0.95 || top < SAFE_TOP || bottom > 1 - SAFE_BOTTOM) out.push(qi("TEXT_OUTSIDE_SAFE_AREA", "warning", `"${layer.text}" reaches under the Reels buttons or the screen edge.`, { fix: "Tidy the texts" }));
      if (tl.captions.some((c) => c.start < layer.end && layer.start < c.end) && bottom > CAPTION_BAND_TOP)
        out.push(qi("CAPTION_OVERLAP", "info", `"${layer.text}" shares the screen with captions near the bottom; it is raised above them automatically.`, { fix: "Move the text to the top" }));
    }
  }
  const bad = tl.captions.some((c) => !c.text.trim() || c.end <= c.start || c.start < 0 || c.end > tl.duration + 0.05);
  const overlapping = tl.captions.slice(1).some((b, i) => tl.captions[i].end > b.start + 0.05);
  if (bad || overlapping) out.push(qi("CAPTIONS_INVALID", "warning", "Some captions are empty, overlap, or fall outside the Reel.", { fix: "Tidy captions" }));
  return out;
}

async function runFilters(file: string, args: string[], timeout = 90, seek: string[] = []): Promise<string> {
  try {
    return (await run(findBinary("ffmpeg"), ["-hide_banner", "-nostdin", "-v", "info", ...seek, "-i", file, ...args, "-f", "null", "-"], timeout * 1000)).stderr;
  } catch (e) {
    return String((e as { details?: string }).details ?? "");
  }
}
const num = (re: RegExp, s: string) => { const m = re.exec(s); const v = m ? Number(m[1]) : NaN; return Number.isFinite(v) ? v : null; };

export async function checkRenderFile(file: string, expectedSize: [number, number] | null, expectedDuration: number, hasFades = false): Promise<QcIssue[]> {
  const out: QcIssue[] = [];
  const info = await probe(file);
  const streams = info.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video"), audio = streams.find((s) => s.codec_type === "audio");
  if (!video) return [qi("NO_VIDEO", "error", "The file has no video stream.")];
  const duration = Number(info.format?.duration ?? 0);
  if (expectedSize && (Number(video.width) !== expectedSize[0] || Number(video.height) !== expectedSize[1])) out.push(qi("WRONG_RESOLUTION", "warning", `The video is ${video.width}×${video.height}, expected ${expectedSize[0]}×${expectedSize[1]}.`));
  if (Math.abs(duration - expectedDuration) > DURATION_TOLERANCE + 0.15) out.push(qi("INVALID_DURATION", "warning", `The file is ${fixed(duration, 1)}s but the timeline is ${fixed(expectedDuration, 1)}s.`, { fix: "Re-render" }));
  if (!audio) out.push(qi("NO_AUDIO", "error", "The Reel has no audio track."));
  else {
    const aDur = Number(audio.duration ?? duration);
    if (aDur < duration - 0.3) out.push(qi("AUDIO_ENDS_EARLY", "warning", `The audio ends ${fixed(duration - aDur, 1)}s before the video.`, { details: { seconds: duration - aDur } }));
  }
  const log = await runFilters(file, ["-vf", `blackdetect=d=${BLACK_MIN_SECONDS}:pix_th=0.10,freezedetect=n=-60dB:d=${g(FROZEN_MIN_SECONDS)}`, "-af", "volumedetect,ebur128"]);
  for (const m of log.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)/g)) {
    const s = Number(m[1]), e = Number(m[2]);
    if (!((s < BLACK_EDGE_GRACE && hasFades) || (e > duration - BLACK_EDGE_GRACE && hasFades))) out.push(qi("BLACK_FRAMES", "warning", `Black frames from ${fixed(s, 1)}s to ${fixed(e, 1)}s.`, { details: { start: s, end: e } }));
  }
  for (const m of log.matchAll(/freeze_start:\s*([\d.]+)/g)) {
    const start = Number(m[1]);
    const em = /freeze_end:\s*([\d.]+)/.exec(log.slice((m.index ?? 0) + m[0].length));
    const end = em ? Number(em[1]) : duration;
    if (end - start >= FROZEN_MIN_SECONDS && !(hasFades && (start < BLACK_EDGE_GRACE || end > duration - BLACK_EDGE_GRACE)))
      out.push(qi("DUPLICATE_FRAMES", "warning", `The picture freezes from ${fixed(start, 1)}s to ${fixed(end, 1)}s (repeated frames).`, { details: { start, end } }));
  }
  const lufsAll = [...log.matchAll(/Integrated loudness:\s*I:\s*(-?[\d.]+) LUFS/g)];
  const lufs = audio && lufsAll.length ? Number(lufsAll[0][1]) : null;
  if (lufs !== null && Number.isFinite(lufs) && Math.abs(lufs - TARGET_LUFS) > LOUDNESS_TOLERANCE) {
    const loud = lufs > TARGET_LUFS;
    out.push(qi("AUDIO_LOUDNESS", "warning", `The Reel is ${loud ? "too loud" : "too quiet"} (${fixed(lufs, 1)} LUFS; platforms play at about ${fixed(TARGET_LUFS, 0)}).`, { fix: "Adjust the music volume", details: { lufs } }));
  }
  const peak = num(/max_volume:\s*(-?[\d.inf]+) dB/, log), clipped = num(/histogram_0db:\s*(\d+)/, log);
  if (peak !== null && peak >= -0.1 && (clipped ?? 0) >= 20) out.push(qi("AUDIO_CLIPPING", "warning", `The audio clips at 0 dB (${Math.trunc(clipped ?? 0)} samples).`, { fix: "Lower music volume", details: { peak } }));
  const headMean = num(/mean_volume:\s*(-?[\d.inf]+) dB/, await runFilters(file, ["-t", "0.2", "-vn", "-af", "volumedetect"])), overallMean = num(/mean_volume:\s*(-?[\d.inf]+) dB/, log);
  if (audio && headMean !== null && overallMean !== null && headMean > Math.max(overallMean - 6, -40)) out.push(qi("AUDIO_ABRUPT_START", "info", "The music starts at full volume on the first frame.", { fix: "Add a short fade-in", details: { headMeanDb: headMean } }));
  const tailMean = num(/mean_volume:\s*(-?[\d.inf]+) dB/, await runFilters(file, ["-vn", "-af", "volumedetect"], 90, ["-ss", fixed(Math.max(duration - 0.25, 0), 2)]));
  if (audio && tailMean !== null && tailMean > -30) out.push(qi("MUSIC_ABRUPT_END", "warning", "The music is cut off abruptly at the end.", { fix: "Add a fade-out", details: { tailMeanDb: tailMean } }));
  return out;
}

export function checkFootage(tl: Timeline, clipSeconds: Record<string, number>): QcIssue[] {
  return tl.segments.flatMap((seg, k) => {
    const dur = clipSeconds[seg.clipId];
    if (dur === undefined) return [qi("MISSING_CLIP", "error", `Shot ${k + 1} uses a clip that is not in the project.`, { segmentId: seg.id })];
    if (seg.sourceEnd > dur + 0.1) return [qi("MISSING_FOOTAGE", "warning", `Shot ${k + 1} runs ${fixed(seg.sourceEnd - dur, 2)}s past the end of its clip (the last frame is held).`, { segmentId: seg.id, details: { over: round(seg.sourceEnd - dur, 3) } })];
    return [];
  });
}

/** Reel times where the picture changes on a hard cut. */
export const plannedCuts = (tl: Timeline) => tl.segments.slice(1).filter((seg, i) => {
  const prev = tl.segments[i];
  return !(seg.clipId === prev.clipId && Math.abs(seg.sourceStart - prev.sourceEnd) < 0.05) && ["cut", "speed_ramp"].includes(seg.transitionIn.type);
}).map((s) => round(s.timelineStart, 3));

export async function checkSync(file: string, tl: Timeline): Promise<QcIssue[]> {
  const cuts = plannedCuts(tl);
  if (!cuts.length) return [];
  const log = await runFilters(file, ["-an", "-vf", `scale=160:-2,select='gt(scene,${SCENE_THRESHOLD})',showinfo`]);
  const seen = [...log.matchAll(/pts_time:([0-9.]+)/g)].map((m) => Number(m[1]));
  const offsets: number[] = [];
  for (const c of cuts) {
    if (!seen.length) continue;
    const near = seen.reduce((a, t) => (Math.abs(t - c) < Math.abs(a - c) ? t : a));
    if (Math.abs(near - c) <= SYNC_SEARCH) offsets.push(near - c);
  }
  const matched = offsets.length, details: Record<string, unknown> = { planned_cuts: cuts.length, matched };
  if (matched < Math.max(2, Math.floor(cuts.length / 3))) return [qi("SYNC_UNCHECKED", "info", `Only ${matched} of ${cuts.length} cuts could be found in the file, so their timing was not judged.`, { details })];
  const avg = offsets.reduce((s, o) => s + Math.abs(o), 0) / matched;
  Object.assign(details, { mean_offset_sec: round(avg, 3), worst_offset_sec: round(Math.max(...offsets.map(Math.abs)), 3) });
  return avg > SYNC_OFF ? [qi("CUTS_OUT_OF_SYNC", "warning", `The cuts land ${fixed(avg * 1000, 0)} ms away from their beats on average.`, { details })]
    : [qi("CUTS_IN_SYNC", "info", `${matched} of ${cuts.length} cuts checked: within ${fixed(avg * 1000, 0)} ms of their beats.`, { details })];
}

/** Everything checked on a finished Reel; `passed` is false when any issue is an error or a warning. */
export async function finalCheck(file: string, tl: Timeline, clipSeconds: Record<string, number>, expectedSize: [number, number] | null = null) {
  const issues = checkFootage(tl, clipSeconds);
  try {
    issues.push(...(await checkRenderFile(file, expectedSize, tl.duration, true)), ...(await checkSync(file, tl)));
  } catch (e) {
    issues.push(qi("CHECK_FAILED", "info", `Part of the final check could not run: ${String((e as Error).message ?? e).slice(0, 120)}`));
  }
  const bad = issues.filter((i) => i.severity === "error" || i.severity === "warning");
  return { passed: !bad.length, errors: issues.filter((i) => i.severity === "error").length, warnings: issues.filter((i) => i.severity === "warning").length, issues };
}

/** Candidate operation batches for a fix, best first; the caller uses the first that is valid. */
export function fixOperations(code: string, tl: Timeline, target: number | null, segmentId: string | null = null): Operation[][] {
  const fit = target ? [{ type: "fit_duration", target } as Operation] : [];
  if (code === "DURATION_MISMATCH" && target) return [fit];
  if (code === "REPEATED_CLIP" && segmentId) { const del = [{ type: "delete", segmentId } as Operation]; return [target ? [...del, ...fit] : del, del]; }
  if (code === "SHORT_CLIP" && segmentId) {
    const grow = [{ type: "set_length", segmentId, length: 0.6 } as Operation], drop = [{ type: "delete", segmentId } as Operation];
    return [[...grow, ...fit], [...drop, ...fit], drop];
  }
  if (code === "AUDIO_CLIPPING") return [[{ type: "set_music", volume: Math.max(round(tl.musicVolume * 0.85, 3), 0.2) } as unknown as Operation]];
  if (code === "MUSIC_ABRUPT_END") return [[{ type: "set_music", fadeOut: 1.5 } as unknown as Operation]];
  if (["UNSUPPORTED_EFFECT", "UNSUPPORTED_TRANSITION", "INVALID_CROP", "LONG_SHOT"].includes(code) && segmentId) {
    const seg = tl.segments.find((s) => s.id === segmentId);
    if (!seg) return [];
    if (code === "UNSUPPORTED_EFFECT") return [[{ type: "set_effect", segmentId, effect: resolveEffect(seg.effect)[0] } as Operation]];
    if (code === "UNSUPPORTED_TRANSITION") return [[{ type: "set_transition", segmentId, transition: resolveTransition(seg.transitionIn.type)[0], duration: null } as Operation]];
    if (code === "INVALID_CROP") return [[{ type: "set_crop", segmentId, crop: { framing: "auto", focusX: null, focusY: null } } as unknown as Operation]];
    return [[{ type: "split", segmentId, at: round(seg.timelineStart + segLength(seg) / 2, 3) } as Operation]];
  }
  if (["TEXT_TIMING", "TEXT_OUTSIDE_SAFE_AREA", "CAPTION_OVERLAP"].includes(code))
    return [[{ type: "set_overlays", overlays: tl.overlays.map((o) => (code === "CAPTION_OVERLAP" && o.position === "bottom" ? { ...o, position: "top" } : o)) } as unknown as Operation]];
  if (code === "AUDIO_ABRUPT_START") return [[{ type: "set_music", fadeIn: 0.3 } as unknown as Operation]];
  if (code === "CAPTIONS_INVALID") return [[{ type: "set_caption_style", style: tl.captionStyle } as unknown as Operation]];
  return [];
}

export const fixForLoudness = (tl: Timeline, lufs: number): Operation[][] => [[{ type: "set_music", volume: round(Math.min(Math.max(tl.musicVolume * 10 ** ((TARGET_LUFS - lufs) / 20), 0.2), 2), 3) } as unknown as Operation]];
