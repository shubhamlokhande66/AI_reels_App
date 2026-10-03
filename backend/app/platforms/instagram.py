"""Instagram Reels: edit, check and caption a Reel for the way Instagram ranks it.

What Instagram itself has said (Meta's Reels ranking system card, Instagram's creator blog, Adam Mosseri), and what each
rule here is for:

* A new Reel is shown to a small test audience first; the best performers are shown to a wider group, then a wider one.
  Reach follows the *rate* of good reactions (per view), not follower count.
* The ranking predicts, per viewer: leaving within 3 s (skip rate), watching longer than almost everyone (watch time),
  resharing / sending in DMs, sharing outside Instagram, commenting, following, "interested", using the audio.
* The three strongest signals: watch time, sends per reach (strongest for non-followers), likes per reach.
* Not recommended (or recommended less): muted, blurry or low-resolution video; borders, logos or watermarks; text
  covering most of the picture; unoriginal content (accounts that mostly repost are removed from recommendations).
* Search reads captions, on-screen text and speech; at most 5 hashtags, a few specific ones work better than many.

The editor cannot see the viewers, so the report checks what can be measured before posting and says so.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.models.analysis import ClipAnalysis, UsableWindow
from app.models.timeline import Segment, TextOverlay, Timeline, Watermark
from app.styles.base import EditingStyle

PLATFORM = "instagram"

HOOK_CUT = 1.8  # the first cut comes by this second: the picture changes before the 3 s skip decision
MAX_SHOT = 3.5  # something new at least this often keeps people watching (longer only when the style is slower than this)
END_LOGO_SECONDS = 2.0  # a brand logo appears only on the closing seconds
MUSIC_FADE_IN = 0.05  # sound from the first frame (a fade-in starts the Reel silent)
MUSIC_FADE_OUT = 0.5  # short, so the loop back to the start does not land in silence
MAX_HASHTAGS = 5  # Instagram's limit per post
BLOCKED_SCORE = 40  # the highest score while a recommendation rule is broken (watermark on every frame, no sound)
MIN_BITRATE_MBPS = 3.5  # below this a 1080x1920 Reel starts to look soft after Instagram re-encodes it

SEND_PROMPTS = {
    "en": "Send this to someone who needs to see it.",
    "hinglish": "Ye us dost ko bhejo jise ye dekhna chahiye.",
    "hi": "इसे उस दोस्त को भेजें जिसे यह देखना चाहिए।",
    "mr": "ज्याला हे पाहायला हवं त्याला पाठवा.",
}

# Rules for the AI (copywriter and director): the same research, in instructions.
COPY_RULES = (
    "This is for Instagram Reels. The description's first sentence is the hook: it must make sense on its own (only it "
    "shows before 'more'). Use the plain words people would type into Instagram search (what it is, where, who it is for) "
    "instead of slang. hashtags: 3 to 5 specific ones (Instagram allows at most 5), never generic ones like reels, viral, "
    "fyp, explore or trending."
)
DIRECTOR_RULES = [
    "Instagram decides in the first 3 seconds: shot 1 is the most eye-catching moment (movement, a face, the result), "
    "never a slow or dark establishing shot, and the first cut comes by 1.8 s.",
    "Hook text (role hook) starts at 0.0 s and stays about 2 s: a question or a promise in plain words.",
    "Watch time is the strongest signal: something changes every 1-3.5 s; no shot longer than 3.5 s unless reel.instructions ask for calm.",
    "Rewatches count: the last shot should look like the first (same scene or colours) so the replay loops smoothly; no fade to black.",
    "Sends to friends are the strongest signal for reaching new people: build the edit around one moment worth sending.",
    "Post copy: " + COPY_RULES,
]

POSTING_TIPS = [
    "Post when your followers are online (Insights > Total followers > Most active times).",
    "Reply to comments in the first hour: conversation is a signal, and early reactions decide the next, wider audience.",
    "With 1,000+ followers, try it as a Trial Reel first: it is shown to non-followers only, and a flop does not count against you.",
    "Stay in one topic: Instagram matches Reels to viewers by interest, and 'Your Algorithm' lets viewers pick topics.",
    "Do not delete and re-post a Reel that started slowly; make a new version with a stronger first 3 seconds instead.",
    "After 24-48 h, read Skip rate (a hook problem) and the Retention chart (a content problem) in the Reel's Insights.",
]

SIGNALS = {
    "hook": "Hold the first 3 seconds (skip rate)",
    "watch_time": "Watch time",
    "rewatch": "Rewatches (loop)",
    "shares": "Sends and shares",
    "eligibility": "Can be recommended",
    "discovery": "Search and topic matching",
}
WEIGHTS = {"hook": 3.0, "watch_time": 3.0, "shares": 2.0, "eligibility": 3.0, "rewatch": 1.5, "discovery": 1.0}

_STOP = set(
    "a an and are as at be but by for from has have in into is it its my of on or our so than that the their this to "
    "was we were what when where which who will with you your reel reels video videos clip clips make made new very "
    "slow fast elegant feel lots close ups end start best shot shots text add music song cut every beat".split()
)


# ----------------------------------------------------------------------------- the edit
def tune_style(style: EditingStyle) -> EditingStyle:
    """The style, cut for Instagram: open on the most eye-catching moment, change the picture by 1.8 s, keep shots short
    enough to hold attention, and end on a shot that loops back into the opening."""
    max_seg = max(min(style.max_segment, MAX_SHOT), style.min_segment)
    return style.with_overrides(
        opening="hook", hook_cut=HOOK_CUT, loop_end=True, max_segment=max_seg, fade_in_out=0.0,
        audio_fade_in=min(style.audio_fade_in, MUSIC_FADE_IN), audio_fade_out=min(style.audio_fade_out, MUSIC_FADE_OUT),
    )  # fmt: skip


def render_style(style: EditingStyle) -> EditingStyle:
    """What the renderer must change: no fade from/to black (a black first frame is a skip; a black last frame breaks the loop)."""
    return style.with_overrides(fade_in_out=0.0) if style.fade_in_out else style


def end_only_watermark(wm: Watermark | None, duration: float) -> Watermark | None:
    """A logo on every frame makes a Reel ineligible for recommendations; on the closing seconds it is a sign-off."""
    if wm is None or wm.show_from is not None:
        return wm
    return wm.model_copy(update={"show_from": round(max(duration - END_LOGO_SECONDS, 0.0), 3)})


def hook_from_first_frame(overlays: list[TextOverlay]) -> list[TextOverlay]:
    """Hook text that starts in the first second is moved to 0.0 s (also text added later with "change it with words")."""
    return [o.model_copy(update={"start": 0.0}) if o.role == "hook" and 0 < o.start <= 1.0 else o for o in overlays]


def polish_timeline(tl: Timeline, *, hook_text: str = "", cta_text: str = "") -> list[str]:
    """Instagram finishing on a built timeline (rule-based or AI-planned). Changes it in place; returns notes."""
    from app.video.overlays import normalize, tidy_text

    notes: list[str] = []
    overlays = list(tl.overlays)
    hook = next((o for o in overlays if o.role == "hook"), None)
    if hook is None and tidy_text(hook_text):
        overlays.append(TextOverlay(text=tidy_text(hook_text), start=0.0, end=min(2.2, tl.duration), role="hook", position="top"))
        notes.append("Instagram: your hook text is on screen from the first frame.")
    elif hook is not None and 0 < hook.start <= 1.0:
        hook.start = 0.0
        notes.append("Instagram: the hook text now starts on the first frame (the skip decision is made in the first seconds).")
    if not any(o.role == "cta" for o in overlays) and tidy_text(cta_text) and tl.duration >= 6:
        overlays.append(TextOverlay(text=tidy_text(cta_text), start=round(tl.duration - 2.0, 3), end=tl.duration, role="cta",
                                    position="center"))  # fmt: skip
    tl.overlays, _ = normalize(overlays, tl.duration)
    if tl.music_fade_in is None:
        tl.music_fade_in = MUSIC_FADE_IN
    if tl.music_fade_out is None:
        tl.music_fade_out = MUSIC_FADE_OUT
    wm = end_only_watermark(tl.watermark, tl.duration)
    if wm is not tl.watermark:
        tl.watermark = wm
        notes.append(f"Instagram: the logo shows only in the last {END_LOGO_SECONDS:g}s (Reels with a watermark on screen are recommended less).")
    return notes


# ----------------------------------------------------------------------------- post copy
def copy_rules() -> str:
    return COPY_RULES


def _keywords(text: str, limit: int) -> list[str]:
    out: list[str] = []
    for w in re.findall(r"[A-Za-z][A-Za-z0-9]{3,}", text or ""):
        k = w.lower()
        if k not in _STOP and k not in out:
            out.append(k)
    return out[:limit]


def _first_sentence(text: str, limit: int) -> str:
    t = " ".join((text or "").split())
    m = re.match(r"(.+?[.!?])(\s|$)", t)
    t = m.group(1) if m else t
    return t if len(t) <= limit else t[: limit - 1].rsplit(" ", 1)[0] + "…"


def finalize_copy(copy: dict | None, *, name: str, brief: str = "", language: str = "en", subjects: list[str] | None = None) -> dict:
    """Post copy ready for Instagram: at most 5 hashtags, a line asking for the send, and alt text (read by search and by
    screen readers). Without AI copy, a plain template from the project name and instructions (marked as such)."""
    out = dict(copy or {})
    if not out.get("title") and not out.get("description"):
        out["title"] = (name or "").strip()[:60]
        out["description"] = _first_sentence(brief, 200) if brief.strip() else ""
        out["hashtags"] = _keywords(f"{name} {brief}", 4)
        out["source"] = "template"
    seen: set[str] = set()
    tags: list[str] = []
    for t in out.get("hashtags") or []:
        tag = re.sub(r"[^0-9A-Za-z_]", "", str(t))[:30]
        if tag and tag.lower() not in seen and tag.lower() not in {"reels", "viral", "fyp", "explore", "trending", "instagood"}:
            seen.add(tag.lower())
            tags.append(tag)
    out["hashtags"] = tags[:MAX_HASHTAGS]
    out.setdefault("sendPrompt", SEND_PROMPTS.get(language, SEND_PROMPTS["en"]))
    if not out.get("altText"):
        about = _first_sentence(brief, 120) if brief.strip() else (name or "").strip()
        seen_subj = [s for s in dict.fromkeys(s.strip() for s in subjects or [] if s and s.strip())][:3]
        alt = f"Vertical video: {about}" + (f". Shows {', '.join(seen_subj)}" if seen_subj else "")
        out["altText"] = alt[:200].rstrip(" ,.") + "."
    out["platform"] = PLATFORM
    return out


# ----------------------------------------------------------------------------- the report
@dataclass
class Signal:
    id: str
    signal: str
    name: str
    status: str  # pass | warn | fail | info (info = advice the app cannot measure; not scored)
    detail: str = ""
    tip: str = ""

    def to_doc(self) -> dict:
        return {"id": self.id, "signal": self.signal, "name": self.name, "status": self.status, "detail": self.detail, "tip": self.tip}


def _window_at(a: ClipAnalysis | None, t: float) -> UsableWindow | None:
    if a is None or not a.windows:
        return None
    inside = [w for w in a.windows if w.start - 1e-3 <= t <= w.end + 1e-3]
    return inside[0] if inside else min(a.windows, key=lambda w: min(abs(w.start - t), abs(w.end - t)))


def _overlap(a: list[float], b: list[float]) -> float | None:
    if not a or not b or len(a) != len(b):
        return None
    return float(sum(min(x, y) for x, y in zip(a, b)))


def _level(ok: bool, warn: bool = False) -> str:
    return "pass" if ok else ("warn" if warn else "fail")


def build_report(
    tl: Timeline, clips: dict[str, ClipAnalysis], *, audio_mode: str, brief: str, cta_text: str,
    post_copy: dict | None, render: tuple[int, int, int, float] | None, preview: bool, fade_to_black: bool = False,
) -> dict:
    """Score the Reel against Instagram's ranking signals. ``render`` = (width, height, bytes, seconds) of the output file."""
    out: list[Signal] = []
    segs: list[Segment] = tl.segments
    first, last = segs[0], segs[-1]
    fw = _window_at(clips.get(first.clip_id), first.source_start)
    lw = _window_at(clips.get(last.clip_id), last.source_start)

    # --- hook: the 3 second decision
    out.append(Signal("first_cut", "hook", "The picture changes within 2 seconds", _level(first.length <= 2.0 + 1e-6, first.length <= 3.0),
                      f"the opening shot lasts {first.length:.1f}s",
                      "" if first.length <= 2.0 else "Cut sooner: open on your most surprising moment and change the picture by 2 s."))
    if fw is not None:
        motion = fw.motion_between(first.source_start, first.source_end)
        out.append(Signal("opening_motion", "hook", "The first shot moves", "pass" if motion >= 0.25 else "warn",
                          f"motion {motion:.2f} (0 = still, 1 = very busy)",
                          "" if motion >= 0.25 else "A still opening is easy to scroll past: start on movement, a face or the result."))
        out.append(Signal("opening_bright", "hook", "The first frame is bright and sharp",
                          "pass" if fw.brightness >= 0.3 and fw.sharpness >= 0.3 else "warn",
                          f"brightness {fw.brightness:.2f}, sharpness {fw.sharpness:.2f}",
                          "" if fw.brightness >= 0.3 and fw.sharpness >= 0.3 else "The first frame is also the preview: use a bright, sharp moment."))
    hook_on = [o for o in tl.overlays if o.start <= 1.0] or [c for c in tl.captions if c.start <= 1.0]
    out.append(Signal("hook_text", "hook", "Words on screen in the first second", "pass" if hook_on else "warn",
                      f'"{hook_on[0].text}"' if hook_on else "no text in the first second",
                      "" if hook_on else "Add hook text (Hook text field): a question or a promise. Most people watch with the sound off."))
    fade_in = tl.music_fade_in if tl.music_fade_in is not None else 0.3
    if audio_mode in ("music", "voice_music"):
        out.append(Signal("sound_start", "hook", "The music starts on the first frame", "pass" if fade_in <= 0.3 else "warn",
                          f"fade-in {fade_in:.2f}s", "" if fade_in <= 0.3 else "Remove the slow music fade-in."))

    # --- watch time
    d = tl.duration
    out.append(Signal("length", "watch_time", "A length people finish",
                      "pass" if 7 <= d <= 90 else ("fail" if d > 180 else "warn"), f"{d:.0f}s",
                      "" if 7 <= d <= 90 else ("Over 3 minutes is not shown in the Reels tab to new viewers." if d > 180 else
                                              "Under 7 s builds little watch time; aim for 7-60 s." if d < 7 else
                                              "Over 90 s is finished by fewer people: cut it down unless every second earns its place.")))
    avg = sum(s.length for s in segs) / len(segs)
    early_long = [s for s in segs if s.timeline_start < 10 and s.length > 4.0]
    out.append(Signal("pacing", "watch_time", "Something new every 1-3.5 seconds", _level(avg <= MAX_SHOT and not early_long, avg <= 4.5),
                      f"{len(segs)} shots, {avg:.1f}s on average" + (f"; a {early_long[0].length:.1f}s shot in the first 10 s" if early_long else ""),
                      "" if avg <= MAX_SHOT and not early_long else "Choose a faster pace, or add clips so the shots can be shorter."))
    repeat = any("shown again" in w or "will repeat" in w for w in tl.warnings)
    out.append(Signal("fresh_footage", "watch_time", "No moment is shown twice", "warn" if repeat else "pass",
                      "a moment repeats (not enough footage for this length)" if repeat else "every shot is new footage",
                      "Add more clips or choose a shorter Reel." if repeat else ""))

    # --- rewatches
    out.append(Signal("no_black_end", "rewatch", "No fade to black at the end", "fail" if fade_to_black else "pass",
                      "fades to black" if fade_to_black else "the last frame is picture, so the loop is seamless"))
    sim = _overlap(fw.signature, lw.signature) if fw and lw else None
    if sim is not None:
        out.append(Signal("loop", "rewatch", "The ending loops back into the opening", "pass" if sim >= 0.6 else "warn",
                          f"the last shot looks {round(sim * 100)}% like the first",
                          "" if sim >= 0.6 else "End on a shot that looks like the opening (same scene or colours) so the replay feels seamless."))
    out.append(Signal("ending", "rewatch", "The ending is a real shot", "pass" if last.length >= 0.9 else "warn", f"last shot {last.length:.1f}s"))

    # --- sends
    has_cta = bool(cta_text.strip()) or any(o.role == "cta" for o in tl.overlays)
    send = (post_copy or {}).get("sendPrompt")
    out.append(Signal("send_prompt", "shares", "The caption asks for the send", "pass" if send else "warn", send or "no send line",
                      "" if send else "Ask for it: 'Send this to someone who…'. Sends are the strongest signal for reaching new people."))
    out.append(Signal("clear_idea", "shares", "One clear idea for a specific person", "pass" if brief.strip() else "warn",
                      "from your instructions" if brief.strip() else "no instructions were given",
                      "" if brief.strip() else "Write who it is for and the one thing it shows: Reels made for someone get sent to them."))
    out.append(Signal("cta", "shares", "A call to action on screen", "pass" if has_cta else "info",
                      "yes" if has_cta else "none", "" if has_cta else "Optional: a short closing line like 'Save this for later'."))

    # --- recommendation eligibility
    if render is not None and not preview:
        w, h, size, secs = render
        mbps = size * 8 / max(secs, 0.1) / 1e6
        out.append(Signal("resolution", "eligibility", "Full-quality 1080 x 1920 (9:16)", _level((w, h) == (1080, 1920), abs(w / h - 9 / 16) < 0.01),
                          f"{w}x{h}", "" if (w, h) == (1080, 1920) else "Export with the Instagram Reel preset."))
        out.append(Signal("sharp", "eligibility", "Not blurry after Instagram re-encodes it", "pass" if mbps >= MIN_BITRATE_MBPS else "warn",
                          f"{mbps:.1f} Mbps", "" if mbps >= MIN_BITRATE_MBPS else "Low-resolution or soft footage is recommended less: use sharper clips."))
    elif preview:
        out.append(Signal("resolution", "eligibility", "Full-quality 1080 x 1920 (9:16)", "info", "checked on the final export, not the preview"))
    soft = [c for c, a in clips.items() if "low_resolution" in a.flags or "too_blurry" in a.flags]
    used = {s.clip_id for s in segs}
    if soft and used & set(soft):
        out.append(Signal("source_quality", "eligibility", "Clips are sharp", "warn", f"{len(used & set(soft))} clip(s) are soft or low-resolution",
                          "Replace soft clips: blurry Reels are recommended less."))
    wm = tl.watermark
    wm_ok = wm is None or (wm.show_from is not None and wm.show_from >= d - END_LOGO_SECONDS - 0.5)
    out.append(Signal("watermark", "eligibility", "No logo or watermark over the video", "pass" if wm_ok else "fail",
                      "none" if wm is None else ("only on the last seconds" if wm_ok else "on every frame"),
                      "" if wm_ok else "Reels with logos or watermarks are recommended less: show the brand only at the end."))
    out.append(Signal("sound", "eligibility", "The Reel has sound", "fail" if audio_mode == "none" else "pass",
                      "silent" if audio_mode == "none" else audio_mode.replace("_", " + "),
                      "Muted Reels are recommended less: add music or a voice." if audio_mode == "none" else ""))
    out.append(Signal("text_amount", "eligibility", "Text never covers most of the picture", "pass",
                      f"at most 7 words at a time, inside the safe area ({len(tl.overlays)} text layer(s))"))
    out.append(Signal("original", "eligibility", "Your own, original footage", "info", "the app cannot check where clips came from",
                      "Use footage you filmed. Clips from other accounts or with another app's logo (TikTok, CapCut) are not "
                      "recommended, and accounts that mostly repost lose recommendations."))

    # --- discovery
    desc = (post_copy or {}).get("description") or ""
    out.append(Signal("caption_words", "discovery", "A caption with searchable words", "pass" if len(desc) >= 30 else "warn",
                      f"{len(desc)} characters" if desc else "no caption yet",
                      "" if len(desc) >= 30 else "Write what it is, where and who it is for: Instagram search reads the caption."))
    tags = (post_copy or {}).get("hashtags") or []
    out.append(Signal("hashtags", "discovery", "3-5 specific hashtags", "pass" if 3 <= len(tags) <= MAX_HASHTAGS else "warn",
                      f"{len(tags)} hashtag(s)", "" if 3 <= len(tags) <= MAX_HASHTAGS else "Use 3-5 specific hashtags (Instagram allows 5)."))
    words_on_screen = bool(tl.overlays or tl.captions)
    out.append(Signal("on_screen_words", "discovery", "Words on screen or captions", "pass" if words_on_screen else "warn",
                      "captions on" if tl.captions else ("text layers" if tl.overlays else "none"),
                      "" if words_on_screen else "Turn on captions or add text: Instagram reads on-screen words, and muted viewers need them."))
    alt = (post_copy or {}).get("altText")
    out.append(Signal("alt_text", "discovery", "Alt text", "pass" if alt else "warn", alt or "none",
                      "" if alt else "Add alt text in Advanced settings when you post."))

    return _score(out)


def _score(signals: list[Signal]) -> dict:
    got = total = 0.0
    by: dict[str, dict] = {}
    for s in signals:
        if s.status == "info":
            continue
        w = WEIGHTS[s.signal]
        val = {"pass": 1.0, "warn": 0.5, "fail": 0.0}[s.status]
        got, total = got + w * val, total + w
        b = by.setdefault(s.signal, {"got": 0.0, "total": 0.0})
        b["got"], b["total"] = b["got"] + w * val, b["total"] + w
    score = round(100 * got / total) if total else 0
    blocked = [s.name for s in signals if s.signal == "eligibility" and s.status == "fail"]
    if blocked:  # Instagram does not recommend the Reel at all until this is fixed: no other strength makes up for it
        score = min(score, BLOCKED_SCORE)
        verdict = "Not recommended to new viewers until fixed: " + "; ".join(blocked).lower()
    else:
        verdict = "Ready to post" if score >= 85 else ("Good: fix the warnings first" if score >= 65 else "Needs work before posting")
    return {
        "platform": PLATFORM,
        "score": score,
        "verdict": verdict,
        "blocked": blocked,
        "signals": [{"id": k, "label": SIGNALS[k], "score": round(100 * v["got"] / v["total"]) if v["total"] else None} for k, v in by.items()],
        "checks": [s.to_doc() for s in signals],
        "postingTips": POSTING_TIPS,
        "note": "This score checks what can be measured before posting. Reach is decided by how real viewers react: after posting, "
                "watch skip rate, average watch time and sends per reach in the Reel's Insights.",
    }  # fmt: skip
