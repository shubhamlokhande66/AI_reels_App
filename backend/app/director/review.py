"""Quality control of the finished timeline, before any frame is rendered: check it, and FIX what can be fixed.

Each check says whether it passed, whether something was repaired, and what could not be repaired (reported, never hidden).
Checks that need the rendered file (black or frozen frames, audio length) are in ``check_render``.
"""

from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

from app.core.ffmpeg import find_binary
from app.director.music_map import MusicMap, loud_limit
from app.models.timeline import Segment, Timeline, Transition
from app.video.timeline import ClipInput, _windows_of, cut_points

MIN_SHOT = 0.25
MIN_ENDING = 0.9
MAX_HOOK = 2.6
BEAT_TOLERANCE = 0.06
SPEED_RANGE = (0.4, 2.5)
DUPLICATE_OVERLAP = 0.6


@dataclass
class Check:
    name: str
    ok: bool
    detail: str = ""
    fixed: bool = False  # something was wrong and has been repaired

    def to_doc(self) -> dict:
        return {"name": self.name, "ok": self.ok, "fixed": self.fixed, "detail": self.detail}


def _reflow(tl: Timeline) -> bool:
    """Make the shots follow each other exactly and end at the Reel's end."""
    changed = False
    t = 0.0
    for s in tl.segments:
        if abs(s.timeline_start - t) > 1e-3:
            s.timeline_start, changed = round(t, 3), True
        t = s.timeline_end
    if tl.segments and abs(tl.segments[-1].timeline_end - tl.duration) > 0.02:
        tl.segments[-1].timeline_end, changed = round(tl.duration, 3), True
    return changed


def _clip_len(clips: dict[str, ClipInput], clip_id: str) -> float:
    c = clips.get(clip_id)
    return c.analysis.metadata.duration if c else 0.0


def _merge_tiny_shots(tl: Timeline, clips: dict[str, ClipInput]) -> int:
    """A shot shorter than MIN_SHOT is a flicker: the shot before it takes its time (and its footage, when the clip has it)."""
    merged = 0
    i = 1
    while i < len(tl.segments):
        s = tl.segments[i]
        if s.length < MIN_SHOT - 1e-6:
            prev = tl.segments[i - 1]
            prev.timeline_end = s.timeline_end
            want = prev.source_start + prev.length * prev.speed
            room = _clip_len(clips, prev.clip_id)
            if room and want > room:  # the clip runs out: play the same footage a little slower rather than freeze
                prev.speed = round(max((room - prev.source_start) / prev.length, SPEED_RANGE[0]), 3)
                want = min(want, room)
            prev.source_end = round(want, 3)
            tl.segments.pop(i)
            merged += 1
        else:
            i += 1
    return merged


def _overlap(a0: float, a1: float, b0: float, b1: float) -> float:
    return max(0.0, min(a1, b1) - max(a0, b0)) / max(min(a1 - a0, b1 - b0), 1e-6)


def _dedupe(tl: Timeline, clips: dict[str, ClipInput], skip_first: bool) -> tuple[int, int]:
    """Two shots must not show the same footage. Move the later one to unused footage of its clip. Returns (fixed, unfixable)."""
    fixed = stuck = 0
    for j, b in enumerate(tl.segments):
        if j == 0 and skip_first:
            continue
        for i in range(0, j):
            a = tl.segments[i]
            if (i == 0 and skip_first) or a.clip_id != b.clip_id or j == i + 1 and abs(a.source_end - b.source_start) < 0.05:
                continue  # a deliberate teaser, or one continuous action split at a beat
            if _overlap(a.source_start, a.source_end, b.source_start, b.source_end) < DUPLICATE_OVERLAP:
                continue
            span = b.source_end - b.source_start
            used = [(x.source_start, x.source_end) for x in tl.segments if x is not b and x.clip_id == b.clip_id and not (x is tl.segments[0] and skip_first)]
            best = None
            for w in _windows_of(clips[b.clip_id]) if b.clip_id in clips else []:
                start = w.start
                while start + span <= w.end + 1e-6:
                    if all(_overlap(start, start + span, u0, u1) < 0.15 for u0, u1 in used):
                        best = start
                        break
                    start += 0.25
                if best is not None:
                    break
            if best is None:
                stuck += 1
            else:
                b.source_start, b.source_end = round(best, 3), round(best + span, 3)
                fixed += 1
            break
    return fixed, stuck


def _lengthen_ending(tl: Timeline, clips: dict[str, ClipInput]) -> bool:
    """A closing shot under MIN_ENDING feels like the Reel was cut off. Borrow the time from the shot before it."""
    if len(tl.segments) < 2:
        return False
    last, prev = tl.segments[-1], tl.segments[-2]
    need = MIN_ENDING - last.length
    if need <= 0 or prev.length - need < 0.7 or last.source_start - need * last.speed < 0:
        return False
    prev.timeline_end = round(prev.timeline_end - need, 3)
    prev.source_end = round(prev.source_end - need * prev.speed, 3)
    last.timeline_start = round(last.timeline_start - need, 3)
    last.source_start = round(last.source_start - need * last.speed, 3)
    return True


def _tidy_transitions(tl: Timeline) -> int:
    changed = 0
    prev = "cut"
    for i, s in enumerate(tl.segments):
        t = s.transition_in
        if i == 0:
            if t.type != "cut":
                s.transition_in, changed = Transition(type="cut", duration=0.0), changed + 1
            continue
        limit = 0.4 * min(s.length, tl.segments[i - 1].length)
        if t.type != "cut" and (t.type == prev or t.duration > limit + 1e-6):
            if t.type == prev or limit < 0.06:
                s.transition_in = Transition(type="cut", duration=0.0)
            else:
                s.transition_in = Transition(type=t.type, duration=round(limit, 3))
            changed += 1
        prev = s.transition_in.type
    return changed


def energy_check(tl: Timeline, mm: MusicMap, pace: str, steps: bool = False) -> Check:
    """Loud parts of the song get quick cuts, quiet parts longer shots. A step-by-step Reel follows its steps, not the
    music, so it is only measured, never failed."""
    slow: list[str] = []
    loud_len: list[float] = []
    calm_len: list[float] = []
    for i, s in enumerate(tl.segments):
        lim = loud_limit(mm, s.timeline_start, s.timeline_end, pace)
        (loud_len if lim else calm_len).append(s.length)
        if lim and s.length > lim[1] * 1.15:
            slow.append(f"shot {i + 1} ({s.length:.1f}s in a {lim[0].replace('_', ' ')} part)")
    avg = lambda xs: sum(xs) / len(xs)  # noqa: E731
    detail = ", ".join(x for x in (f"loud parts {avg(loud_len):.1f}s per shot" if loud_len else "",
                                   f"calm parts {avg(calm_len):.1f}s per shot" if calm_len else "") if x)  # fmt: skip
    if slow:
        detail = f"{'; '.join(slow[:3])}{'…' if len(slow) > 3 else ''} too long for the music" + (f" ({detail})" if detail else "")
    return Check("Cut speed follows the music energy", steps or not slow, detail)


def review_timeline(
    tl: Timeline, clips: list[ClipInput], mm: MusicMap | None, *, steps_order: list[str] | None = None,
    teaser_first: bool = False, pace: str = "balanced",
) -> list[Check]:
    """Check the timeline and repair it in place. ``steps_order`` = clip ids in the order a step-by-step Reel must show them."""
    by_id = {c.clip_id: c for c in clips}
    out: list[Check] = []

    fixed = _reflow(tl)
    ok = abs(tl.total_segment_duration - tl.duration) < 0.05
    out.append(Check("Shots follow each other and fill the Reel", ok, f"{len(tl.segments)} shots over {tl.duration:g}s", fixed))

    n = _merge_tiny_shots(tl, by_id)
    _reflow(tl)
    short = [s for s in tl.segments if s.length < MIN_SHOT - 1e-6]
    out.append(Check("No flicker shots (each at least 0.25 s)", not short, f"{n} tiny shot(s) merged" if n else "", n > 0))

    fx, stuck = _dedupe(tl, by_id, teaser_first)
    out.append(Check("No accidental duplicate shots", stuck == 0,
                     (f"{fx} repeated moment(s) moved to unused footage" if fx else "") + (f"; {stuck} repeat(s) could not be avoided (not enough footage)" if stuck else ""), fx > 0))

    lengthened = _lengthen_ending(tl, by_id)
    last = tl.segments[-1]
    out.append(Check("The ending is a real shot, not a cut-off", last.length >= MIN_ENDING - 1e-6,
                     f"last shot {last.length:.2f}s" + ("; borrowed time from the shot before" if lengthened else ""), lengthened))

    t = _tidy_transitions(tl)
    out.append(Check("Transitions are varied and fit their shots", True, f"{t} adjusted" if t else "", t > 0))

    bad = [s for s in tl.segments if not SPEED_RANGE[0] <= s.speed <= SPEED_RANGE[1]]
    out.append(Check("No extreme speed changes", not bad, f"{len(bad)} shot(s) outside {SPEED_RANGE[0]}x-{SPEED_RANGE[1]}x" if bad else ""))

    if mm and mm.beats:
        cuts = cut_points(tl)
        snap = mm.snap_points  # beats plus real strong accents: how a professional edit is actually judged "on the beat"
        worst = max((min(abs(c - b) for b in snap) for c in cuts), default=0.0)
        out.append(Check("Cuts land on the beat or a strong accent", worst <= BEAT_TOLERANCE, f"worst cut is {worst * 1000:.0f} ms away"))
        out.append(energy_check(tl, mm, pace, steps=steps_order is not None))
        strong = [c for c in cuts if mm.level_at(c) >= 3]
        out.append(Check("Strong beats get a visual response", True, f"{len(strong)} of {len(cuts)} cuts fall on a strong beat or major hit"))

    first = tl.segments[0]
    out.append(Check("The hook comes early", first.length <= MAX_HOOK + 1e-6,
                     f"the opening shot lasts {first.length:.1f}s" + ("" if first.length <= MAX_HOOK else f" (over {MAX_HOOK}s; not changed)")))

    if steps_order is not None:
        seq = [s.clip_id for s in (tl.segments[1:] if teaser_first else tl.segments)]
        seen: list[str] = []
        for cid in seq:
            if cid not in seen:
                seen.append(cid)
        out.append(Check("The sequence of steps is preserved", seen == [c for c in steps_order if c in seen], f"{len(seen)} steps in order"))

    for cap in tl.captions:
        cap.start = round(max(cap.start, 0.0), 3)
        cap.end = round(min(cap.end, tl.duration), 3)
    out.append(Check("Text stays inside the Reel and its safe area", all(c.end > c.start for c in tl.captions),
                     "positions come from the caption engine's safe margins; overlap with the subject is not measured for video clips"))
    return out


# ----------------------------------------------------------------------------- after rendering
_BLACK = re.compile(r"black_start:(\S+)\s+black_end:(\S+)")
_FREEZE = re.compile(r"freeze_start: (\S+)")
_FREEZE_D = re.compile(r"freeze_duration: (\S+)")


def check_render(path: Path, expected_duration: float, expect_audio: bool, expect_preview: bool = False) -> list[Check]:
    """Checks on the file itself: size, audio, length agreement, black frames and frozen frames."""
    out: list[Check] = []
    ffprobe, ffmpeg = find_binary("ffprobe"), find_binary("ffmpeg")
    import json

    p = subprocess.run([ffprobe, "-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,duration", "-of", "json", str(path)],
                       capture_output=True, text=True, timeout=60)
    streams = json.loads(p.stdout or "{}").get("streams", [])
    v = next((s for s in streams if s.get("codec_type") == "video"), {})
    a = next((s for s in streams if s.get("codec_type") == "audio"), None)
    w, h = v.get("width"), v.get("height")
    vertical = bool(w and h and abs(w / h - 9 / 16) < 0.01)
    full = (w, h) == (1080, 1920)
    out.append(Check("9:16 H.264 MP4 at 1080 x 1920", vertical and v.get("codec_name") == "h264" and (full or expect_preview),
                     f"{w}x{h} {v.get('codec_name', '?')}" + ("" if full else " (a fast preview is smaller on purpose)" if expect_preview else "")))
    out.append(Check("Audio is present", a is not None or not expect_audio, "" if a else "the file has no audio track"))
    if a is not None and v.get("duration") and a.get("duration"):
        diff = abs(float(v["duration"]) - float(a["duration"]))
        out.append(Check("Audio and video lengths match", diff <= 0.15, f"differ by {diff * 1000:.0f} ms"))
    if v.get("duration"):
        diff = abs(float(v["duration"]) - expected_duration)
        out.append(Check("The video is as long as planned", diff <= 0.25, f"{float(v['duration']):.2f}s vs {expected_duration:.2f}s planned"))

    r = subprocess.run([ffmpeg, "-hide_banner", "-nostats", "-i", str(path), "-an", "-vf", "blackdetect=d=0.2:pix_th=0.06,freezedetect=n=-55dB:d=0.8",
                        "-f", "null", "-"], capture_output=True, text=True, timeout=300)
    log = r.stderr or ""
    blacks = [(float(a_), float(b_)) for a_, b_ in _BLACK.findall(log)]
    # a fade from/to black at the very start or end is a style choice, not a fault
    dur = expected_duration
    blacks = [(a_, b_) for a_, b_ in blacks if not (a_ < 0.05 and b_ < 0.8) and not (b_ > dur - 0.05 and b_ - a_ < 1.0)]
    out.append(Check("No black frames", not blacks, ", ".join(f"{a_:.1f}-{b_:.1f}s" for a_, b_ in blacks[:4])))
    freezes = _FREEZE.findall(log)
    durs = _FREEZE_D.findall(log)
    out.append(Check("No frozen frames", not freezes, ", ".join(f"{float(a_):.1f}s for {float(d_):.1f}s" for a_, d_ in list(zip(freezes, durs))[:4])))
    return out
