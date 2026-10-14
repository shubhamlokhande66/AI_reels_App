import "server-only";
import type { ClipAnalysis, UsableWindow } from "@/server/models/clip";
import { TextOverlay, type Timeline, type Watermark } from "@/server/models/timeline";
import { withOverrides, type EditingStyle } from "@/server/styles";
import { normalize, tidyText } from "@/server/video/overlays";

/** Instagram Reels: edit, check and caption a Reel for the way Instagram ranks it (was platforms/instagram.py on the
 * Instagram branch). What Instagram itself has said (Meta's Reels ranking system card, Instagram's creator blog):
 * - a new Reel is shown to a small test audience first; the best performers reach wider groups. Reach follows the RATE of
 *   good reactions (per view), not follower count;
 * - the ranking predicts leaving within 3 s (skip rate), watch time, sends / shares, comments, follows, using the audio;
 *   the strongest are watch time, sends per reach (strongest for non-followers) and likes per reach;
 * - recommended less: muted, blurry or low-resolution video; logos or watermarks; text covering most of the picture;
 *   unoriginal content;
 * - search reads captions, on-screen text and speech; at most 5 hashtags.
 * The editor cannot see the viewers, so the report checks what can be measured before posting and says so. */

export const PLATFORM = "instagram";
const HOOK_CUT = 1.8, MAX_SHOT = 3.5, END_LOGO_SECONDS = 2, MUSIC_FADE_IN = 0.05, MUSIC_FADE_OUT = 0.5, MAX_HASHTAGS = 5, BLOCKED_SCORE = 40, MIN_BITRATE_MBPS = 3.5;
const SEND_PROMPTS: Record<string, string> = {
  en: "Send this to someone who needs to see it.",
  hinglish: "Ye us dost ko bhejo jise ye dekhna chahiye.",
  hi: "इसे उस दोस्त को भेजें जिसे यह देखना चाहिए।",
  mr: "ज्याला हे पाहायला हवं त्याला पाठवा.",
};
export const COPY_RULES = "This is for Instagram Reels. The description's first sentence is the hook: it must make sense on its own (only it shows before 'more'). Use the plain words people would type into Instagram search (what it is, where, who it is for) instead of slang. hashtags: 3 to 5 specific ones (Instagram allows at most 5), never generic ones like reels, viral, fyp, explore or trending.";
export const DIRECTOR_RULES = [
  "Instagram decides in the first 3 seconds: shot 1 is the most eye-catching moment (movement, a face, the result), never a slow or dark establishing shot, and the first cut comes by 1.8 s.",
  "Hook text (role hook) starts at 0.0 s and stays about 2 s: a question or a promise in plain words.",
  "Watch time is the strongest signal: something changes every 1-3.5 s; no shot longer than 3.5 s unless reel.instructions ask for calm.",
  "Rewatches count: the last shot should look like the first (same scene or colours) so the replay loops smoothly; no fade to black.",
  "Sends to friends are the strongest signal for reaching new people: build the edit around one moment worth sending.",
  `Post copy: ${COPY_RULES}`,
];
const POSTING_TIPS = [
  "Post when your followers are online (Insights > Total followers > Most active times).",
  "Reply to comments in the first hour: conversation is a signal, and early reactions decide the next, wider audience.",
  "With 1,000+ followers, try it as a Trial Reel first: it is shown to non-followers only, and a flop does not count against you.",
  "Stay in one topic: Instagram matches Reels to viewers by interest, and 'Your Algorithm' lets viewers pick topics.",
  "Do not delete and re-post a Reel that started slowly; make a new version with a stronger first 3 seconds instead.",
  "After 24-48 h, read Skip rate (a hook problem) and the Retention chart (a content problem) in the Reel's Insights.",
];
const SIGNALS: Record<string, string> = { hook: "Hold the first 3 seconds (skip rate)", watch_time: "Watch time", rewatch: "Rewatches (loop)", shares: "Sends and shares", eligibility: "Can be recommended", discovery: "Search and topic matching" };
const WEIGHTS: Record<string, number> = { hook: 3, watch_time: 3, shares: 2, eligibility: 3, rewatch: 1.5, discovery: 1 };
const STOP = new Set("a an and are as at be but by for from has have in into is it its my of on or our so than that the their this to was we were what when where which who will with you your reel reels video videos clip clips make made new very slow fast elegant feel lots close ups end start best shot shots text add music song cut every beat".split(" "));

export const forInstagram = (s: { platform?: string | null }) => s.platform === PLATFORM;

// ------------------------------------------------------------------ the edit
/** Open on the most eye-catching moment, change the picture by 1.8 s, keep shots short, end on a shot that loops back. */
export const tuneStyle = (style: EditingStyle): EditingStyle => withOverrides(style, {
  opening: "hook", hookCut: HOOK_CUT, loopEnd: true, maxSegment: Math.max(Math.min(style.maxSegment, MAX_SHOT), style.minSegment), fadeInOut: 0,
  audioFadeIn: Math.min(style.audioFadeIn, MUSIC_FADE_IN), audioFadeOut: Math.min(style.audioFadeOut, MUSIC_FADE_OUT),
});
/** No fade from or to black: a black first frame is a skip, a black last frame breaks the loop. */
export const renderStyle = (style: EditingStyle): EditingStyle => (style.fadeInOut ? withOverrides(style, { fadeInOut: 0 }) : style);
/** A logo on every frame makes a Reel ineligible for recommendations; on the closing seconds it is a sign-off. */
export function endOnlyWatermark(wm: Watermark | null, duration: number): Watermark | null {
  if (!wm || wm.showFrom !== null) return wm;
  return { ...wm, showFrom: Math.round(Math.max(duration - END_LOGO_SECONDS, 0) * 1000) / 1000 };
}
/** Hook text that starts in the first second is moved to 0.0 s (also text added later with "change it with words"). */
export const hookFromFirstFrame = (overlays: TextOverlay[]) => overlays.map((o) => (o.role === "hook" && o.start > 0 && o.start <= 1 ? { ...o, start: 0 } : o));
/** Instagram finishing on a built timeline (rule-based or AI-planned). Changes it in place; returns notes. */
export function polishTimeline(tl: Timeline, hookText = "", ctaText = ""): string[] {
  const notes: string[] = [], overlays = [...tl.overlays], hook = overlays.find((o) => o.role === "hook");
  if (!hook && tidyText(hookText)) {
    overlays.push(TextOverlay.parse({ text: tidyText(hookText), start: 0, end: Math.min(2.2, tl.duration), role: "hook", position: "top" }));
    notes.push("Instagram: your hook text is on screen from the first frame.");
  } else if (hook && hook.start > 0 && hook.start <= 1) {
    hook.start = 0;
    notes.push("Instagram: the hook text now starts on the first frame (the skip decision is made in the first seconds).");
  }
  if (!overlays.some((o) => o.role === "cta") && tidyText(ctaText) && tl.duration >= 6)
    overlays.push(TextOverlay.parse({ text: tidyText(ctaText), start: Math.round((tl.duration - 2) * 1000) / 1000, end: tl.duration, role: "cta", position: "center" }));
  [tl.overlays] = normalize(overlays, tl.duration);
  if (tl.musicFadeIn === null) tl.musicFadeIn = MUSIC_FADE_IN;
  if (tl.musicFadeOut === null) tl.musicFadeOut = MUSIC_FADE_OUT;
  const wm = endOnlyWatermark(tl.watermark, tl.duration);
  if (wm !== tl.watermark) { tl.watermark = wm; notes.push(`Instagram: the logo shows only in the last ${END_LOGO_SECONDS}s (Reels with a watermark on screen are recommended less).`); }
  return notes;
}

// ------------------------------------------------------------------ post copy
const keywords = (text: string, limit: number) => [...new Set((text.match(/[A-Za-z][A-Za-z0-9]{3,}/g) ?? []).map((w) => w.toLowerCase()).filter((w) => !STOP.has(w)))].slice(0, limit);
function firstSentence(text: string, limit: number) {
  let t = (text ?? "").split(/\s+/).filter(Boolean).join(" ");
  const m = /^(.+?[.!?])(\s|$)/.exec(t);
  if (m) t = m[1];
  return t.length <= limit ? t : `${t.slice(0, limit - 1).replace(/\s+\S*$/, "")}…`;
}
/** Post copy ready for Instagram: at most 5 hashtags, a line asking for the send, alt text. Without AI copy, a plain
 * template from the project name and instructions (marked as such). */
export function finalizeCopy(copy: Record<string, unknown> | null, o: { name: string; brief?: string; language?: string; subjects?: string[] }): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(copy ?? {}) }, brief = (o.brief ?? "").trim();
  if (!out.title && !out.description) Object.assign(out, { title: (o.name ?? "").trim().slice(0, 60), description: brief ? firstSentence(brief, 200) : "", hashtags: keywords(`${o.name} ${brief}`, 4), source: "template" });
  const tags: string[] = [], seen = new Set<string>();
  for (const t of (out.hashtags as unknown[]) ?? []) {
    const tag = String(t).replace(/[^0-9A-Za-z_]/g, "").slice(0, 30), k = tag.toLowerCase();
    if (tag && !seen.has(k) && !["reels", "viral", "fyp", "explore", "trending", "instagood"].includes(k)) { seen.add(k); tags.push(tag); }
  }
  out.hashtags = tags.slice(0, MAX_HASHTAGS);
  out.sendPrompt ??= SEND_PROMPTS[o.language ?? "en"] ?? SEND_PROMPTS.en;
  if (!out.altText) {
    const about = brief ? firstSentence(brief, 120) : (o.name ?? "").trim(), subj = [...new Set((o.subjects ?? []).map((s) => s?.trim()).filter(Boolean))].slice(0, 3);
    out.altText = `${`Vertical video: ${about}${subj.length ? `. Shows ${subj.join(", ")}` : ""}`.slice(0, 200).replace(/[ ,.]+$/, "")}.`;
  }
  out.platform = PLATFORM;
  return out;
}

// ------------------------------------------------------------------ the report
interface Signal { id: string; signal: string; name: string; status: "pass" | "warn" | "fail" | "info"; detail: string; tip: string }
const sig = (id: string, signal: string, name: string, status: Signal["status"], detail = "", tip = ""): Signal => ({ id, signal, name, status, detail, tip });
const level = (ok: boolean, warn = false): Signal["status"] => (ok ? "pass" : warn ? "warn" : "fail");
function windowAt(a: ClipAnalysis | undefined, t: number): UsableWindow | null {
  if (!a?.windows.length) return null;
  return a.windows.find((w) => w.start - 1e-3 <= t && t <= w.end + 1e-3) ?? a.windows.reduce((m, w) => (Math.min(Math.abs(w.start - t), Math.abs(w.end - t)) < Math.min(Math.abs(m.start - t), Math.abs(m.end - t)) ? w : m));
}
const overlapOf = (a: number[], b: number[]) => (!a.length || !b.length || a.length !== b.length ? null : a.reduce((s, x, i) => s + Math.min(x, b[i]), 0));
const f1 = (x: number) => x.toFixed(1), f2 = (x: number) => x.toFixed(2);

/** Score the Reel against Instagram's ranking signals. render = [width, height, bytes, seconds] of the output file. */
export function buildReport(tl: Timeline, clips: Map<string, ClipAnalysis>, o: { audioMode: string; brief: string; ctaText: string; postCopy: Record<string, unknown> | null; render: [number, number, number, number] | null; preview: boolean; fadeToBlack?: boolean }) {
  const out: Signal[] = [], segs = tl.segments, first = segs[0], last = segs[segs.length - 1], len = (s: (typeof segs)[number]) => s.timelineEnd - s.timelineStart;
  const fw = windowAt(clips.get(first.clipId), first.sourceStart), lw = windowAt(clips.get(last.clipId), last.sourceStart), fl = len(first);
  // the 3 second decision
  out.push(sig("first_cut", "hook", "The picture changes within 2 seconds", level(fl <= 2 + 1e-6, fl <= 3), `the opening shot lasts ${f1(fl)}s`, fl <= 2 ? "" : "Cut sooner: open on your most surprising moment and change the picture by 2 s."));
  if (fw) {
    out.push(sig("opening_motion", "hook", "The first shot moves", fw.motion >= 0.25 ? "pass" : "warn", `motion ${f2(fw.motion)} (0 = still, 1 = very busy)`, fw.motion >= 0.25 ? "" : "A still opening is easy to scroll past: start on movement, a face or the result."));
    const okb = fw.brightness >= 0.3 && fw.sharpness >= 0.3;
    out.push(sig("opening_bright", "hook", "The first frame is bright and sharp", okb ? "pass" : "warn", `brightness ${f2(fw.brightness)}, sharpness ${f2(fw.sharpness)}`, okb ? "" : "The first frame is also the preview: use a bright, sharp moment."));
  }
  const hookOn = tl.overlays.filter((x) => x.start <= 1).map((x) => x.text).concat(tl.captions.filter((c) => c.start <= 1).map((c) => c.text));
  out.push(sig("hook_text", "hook", "Words on screen in the first second", hookOn.length ? "pass" : "warn", hookOn.length ? `"${hookOn[0]}"` : "no text in the first second", hookOn.length ? "" : "Add hook text (Hook text field): a question or a promise. Most people watch with the sound off."));
  const fadeIn = tl.musicFadeIn ?? 0.3;
  if (o.audioMode === "music" || o.audioMode === "voice_music") out.push(sig("sound_start", "hook", "The music starts on the first frame", fadeIn <= 0.3 ? "pass" : "warn", `fade-in ${f2(fadeIn)}s`, fadeIn <= 0.3 ? "" : "Remove the slow music fade-in."));
  // watch time
  const d = tl.duration;
  out.push(sig("length", "watch_time", "A length people finish", d >= 7 && d <= 90 ? "pass" : d > 180 ? "fail" : "warn", `${Math.round(d)}s`,
    d >= 7 && d <= 90 ? "" : d > 180 ? "Over 3 minutes is not shown in the Reels tab to new viewers." : d < 7 ? "Under 7 s builds little watch time; aim for 7-60 s." : "Over 90 s is finished by fewer people: cut it down unless every second earns its place."));
  const avg = segs.reduce((s, x) => s + len(x), 0) / segs.length, earlyLong = segs.filter((s) => s.timelineStart < 10 && len(s) > 4);
  out.push(sig("pacing", "watch_time", "Something new every 1-3.5 seconds", level(avg <= MAX_SHOT && !earlyLong.length, avg <= 4.5), `${segs.length} shots, ${f1(avg)}s on average${earlyLong.length ? `; a ${f1(len(earlyLong[0]))}s shot in the first 10 s` : ""}`,
    avg <= MAX_SHOT && !earlyLong.length ? "" : "Choose a faster pace, or add clips so the shots can be shorter."));
  const repeat = tl.warnings.some((w) => w.includes("shown again") || w.includes("will repeat"));
  out.push(sig("fresh_footage", "watch_time", "No moment is shown twice", repeat ? "warn" : "pass", repeat ? "a moment repeats (not enough footage for this length)" : "every shot is new footage", repeat ? "Add more clips or choose a shorter Reel." : ""));
  // rewatches
  out.push(sig("no_black_end", "rewatch", "No fade to black at the end", o.fadeToBlack ? "fail" : "pass", o.fadeToBlack ? "fades to black" : "the last frame is picture, so the loop is seamless"));
  const sim = fw && lw ? overlapOf(fw.signature, lw.signature) : null;
  if (sim !== null) out.push(sig("loop", "rewatch", "The ending loops back into the opening", sim >= 0.6 ? "pass" : "warn", `the last shot looks ${Math.round(sim * 100)}% like the first`, sim >= 0.6 ? "" : "End on a shot that looks like the opening (same scene or colours) so the replay feels seamless."));
  out.push(sig("ending", "rewatch", "The ending is a real shot", len(last) >= 0.9 ? "pass" : "warn", `last shot ${f1(len(last))}s`));
  // sends
  const hasCta = Boolean(o.ctaText.trim()) || tl.overlays.some((x) => x.role === "cta"), send = o.postCopy?.sendPrompt as string | undefined;
  out.push(sig("send_prompt", "shares", "The caption asks for the send", send ? "pass" : "warn", send ?? "no send line", send ? "" : "Ask for it: 'Send this to someone who…'. Sends are the strongest signal for reaching new people."));
  out.push(sig("clear_idea", "shares", "One clear idea for a specific person", o.brief.trim() ? "pass" : "warn", o.brief.trim() ? "from your instructions" : "no instructions were given", o.brief.trim() ? "" : "Write who it is for and the one thing it shows: Reels made for someone get sent to them."));
  out.push(sig("cta", "shares", "A call to action on screen", hasCta ? "pass" : "info", hasCta ? "yes" : "none", hasCta ? "" : "Optional: a short closing line like 'Save this for later'."));
  // recommendation eligibility
  if (o.render && !o.preview) {
    const [w, h, size, secs] = o.render, mbps = (size * 8) / Math.max(secs, 0.1) / 1e6, full = w === 1080 && h === 1920;
    out.push(sig("resolution", "eligibility", "Full-quality 1080 x 1920 (9:16)", level(full, Math.abs(w / h - 9 / 16) < 0.01), `${w}x${h}`, full ? "" : "Export with the Instagram Reel preset."));
    out.push(sig("sharp", "eligibility", "Not blurry after Instagram re-encodes it", mbps >= MIN_BITRATE_MBPS ? "pass" : "warn", `${f1(mbps)} Mbps`, mbps >= MIN_BITRATE_MBPS ? "" : "Low-resolution or soft footage is recommended less: use sharper clips."));
  } else if (o.preview) out.push(sig("resolution", "eligibility", "Full-quality 1080 x 1920 (9:16)", "info", "checked on the final export, not the preview"));
  const used = new Set(segs.map((s) => s.clipId)), soft = [...clips].filter(([id, a]) => used.has(id) && (a.flags.includes("low_resolution") || a.flags.includes("too_blurry")));
  if (soft.length) out.push(sig("source_quality", "eligibility", "Clips are sharp", "warn", `${soft.length} clip(s) are soft or low-resolution`, "Replace soft clips: blurry Reels are recommended less."));
  const wm = tl.watermark, wmOk = !wm || (wm.showFrom !== null && wm.showFrom >= d - END_LOGO_SECONDS - 0.5);
  out.push(sig("watermark", "eligibility", "No logo or watermark over the video", wmOk ? "pass" : "fail", !wm ? "none" : wmOk ? "only on the last seconds" : "on every frame", wmOk ? "" : "Reels with logos or watermarks are recommended less: show the brand only at the end."));
  out.push(sig("sound", "eligibility", "The Reel has sound", o.audioMode === "none" ? "fail" : "pass", o.audioMode === "none" ? "silent" : o.audioMode.replace("_", " + "), o.audioMode === "none" ? "Muted Reels are recommended less: add music or a voice." : ""));
  out.push(sig("text_amount", "eligibility", "Text never covers most of the picture", "pass", `short lines inside the safe area (${tl.overlays.length} text layer(s))`));
  out.push(sig("original", "eligibility", "Your own, original footage", "info", "the app cannot check where clips came from", "Use footage you filmed. Clips from other accounts or with another app's logo (TikTok, CapCut) are not recommended, and accounts that mostly repost lose recommendations."));
  // discovery
  const desc = String(o.postCopy?.description ?? ""), tags = (o.postCopy?.hashtags as unknown[]) ?? [], alt = o.postCopy?.altText as string | undefined;
  out.push(sig("caption_words", "discovery", "A caption with searchable words", desc.length >= 30 ? "pass" : "warn", desc ? `${desc.length} characters` : "no caption yet", desc.length >= 30 ? "" : "Write what it is, where and who it is for: Instagram search reads the caption."));
  out.push(sig("hashtags", "discovery", "3-5 specific hashtags", tags.length >= 3 && tags.length <= MAX_HASHTAGS ? "pass" : "warn", `${tags.length} hashtag(s)`, tags.length >= 3 && tags.length <= MAX_HASHTAGS ? "" : "Use 3-5 specific hashtags (Instagram allows 5)."));
  const words = tl.overlays.length > 0 || tl.captions.length > 0;
  out.push(sig("on_screen_words", "discovery", "Words on screen or captions", words ? "pass" : "warn", tl.captions.length ? "captions on" : tl.overlays.length ? "text layers" : "none", words ? "" : "Turn on captions or add text: Instagram reads on-screen words, and muted viewers need them."));
  out.push(sig("alt_text", "discovery", "Alt text", alt ? "pass" : "warn", alt ?? "none", alt ? "" : "Add alt text in Advanced settings when you post."));
  return score(out);
}
function score(signals: Signal[]) {
  let got = 0, total = 0;
  const by = new Map<string, { got: number; total: number }>();
  for (const s of signals) {
    if (s.status === "info") continue;
    const w = WEIGHTS[s.signal], val = { pass: 1, warn: 0.5, fail: 0 }[s.status];
    got += w * val; total += w;
    const b = by.get(s.signal) ?? { got: 0, total: 0 };
    b.got += w * val; b.total += w;
    by.set(s.signal, b);
  }
  let value = total ? Math.round((100 * got) / total) : 0;
  const blocked = signals.filter((s) => s.signal === "eligibility" && s.status === "fail").map((s) => s.name);
  let verdict: string;
  if (blocked.length) { value = Math.min(value, BLOCKED_SCORE); verdict = `Not recommended to new viewers until fixed: ${blocked.join("; ").toLowerCase()}`; }
  else verdict = value >= 85 ? "Ready to post" : value >= 65 ? "Good: fix the warnings first" : "Needs work before posting";
  return {
    platform: PLATFORM, score: value, verdict, blocked,
    signals: [...by].map(([id, v]) => ({ id, label: SIGNALS[id], score: v.total ? Math.round((100 * v.got) / v.total) : null })),
    checks: signals, postingTips: POSTING_TIPS,
    note: "This score checks what can be measured before posting. Reach is decided by how real viewers react: after posting, watch skip rate, average watch time and sends per reach in the Reel's Insights.",
  };
}
