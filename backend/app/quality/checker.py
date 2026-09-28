"""Quality checker: finds problems in the timeline (fast) and in the rendered file (real analysis).

Fixes are *edit operations* (see video/timeline_ops.py), so an auto-fix is one undoable step and the
human still reviews the result. Nothing here modifies source media.
"""

from __future__ import annotations

import re
import subprocess
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from app.core.ffmpeg import find_binary, probe
from app.models.timeline import EFFECT_TYPES, TRANSITION_TYPES, CropSpec, Timeline
from app.video.timeline_ops import (
    Delete, FitDuration, Operation, SetCaptionStyle, SetCrop, SetEffect, SetLength, SetMusic, SetOverlays, SetTransition, Split,  # noqa: F401
)  # fmt: skip

MIN_SHOT = 0.35  # shorter shots are flagged
DURATION_TOLERANCE = 0.35
BLACK_MIN_SECONDS = 0.3
BLACK_EDGE_GRACE = 0.8  # fade-in/out at the ends legitimately starts/ends dark
LONG_SHOT = 7.0  # a single shot held longer than this feels static in a Reel (unless the style is slow)
RAPID_CUT = 0.5  # shots shorter than this ...
RAPID_RUN = 4  # ... this many in a row read as flicker, not rhythm
TARGET_LUFS = -14.0  # what Reels / Shorts / TikTok normalise to
LOUDNESS_TOLERANCE = 5.0
FROZEN_MIN_SECONDS = 1.0


@dataclass
class Issue:
    code: str
    severity: str  # error | warning | info
    message: str
    fix: str | None = None  # label of the auto-fix, None = needs a human
    segment_id: str | None = None
    details: dict[str, Any] = field(default_factory=dict)

    def to_doc(self) -> dict[str, Any]:
        d = asdict(self)
        d["segmentId"] = d.pop("segment_id")
        return d


# ------------------------------------------------------------------ timeline (no render needed)
def check_timeline(tl: Timeline, target_duration: float | None = None) -> list[Issue]:
    issues: list[Issue] = []
    if not tl.segments:
        return [Issue("EMPTY_TIMELINE", "error", "The timeline has no shots.")]

    if target_duration and abs(tl.duration - target_duration) > DURATION_TOLERANCE:
        diff = tl.duration - target_duration
        issues.append(Issue(
            "DURATION_MISMATCH", "warning",
            f"The Reel is {tl.duration:.1f}s but the target is {target_duration:g}s "
            f"({abs(diff):.1f}s {'too long' if diff > 0 else 'too short'}).",
            fix=f"Adjust shots to {target_duration:g}s", details={"duration": tl.duration, "target": target_duration},
        ))

    for s in tl.segments:
        if s.length < MIN_SHOT:
            issues.append(Issue("SHORT_CLIP", "warning", f"'{s.video}' is only {s.length:.2f}s (too short to register).",
                                fix="Lengthen or remove", segment_id=s.id, details={"length": s.length}))  # fmt: skip

    seen: list = []
    for s in tl.segments:
        for prev in seen:
            if prev.clip_id != s.clip_id:
                continue
            overlap = min(prev.source_end, s.source_end) - max(prev.source_start, s.source_start)
            if overlap > 0.5 * min(prev.source_end - prev.source_start, s.source_end - s.source_start):
                issues.append(Issue("REPEATED_CLIP", "warning",
                                    f"The same moment of '{s.video}' appears twice.",
                                    fix="Remove the repeat", segment_id=s.id))  # fmt: skip
                break
        seen.append(s)

    issues += _shot_rhythm(tl)
    issues += _registry_and_crop(tl)
    issues += _overlay_issues(tl)

    bad = [c for c in tl.captions if not c.text.strip() or c.end <= c.start or c.start < 0 or c.end > tl.duration + 0.05]
    overlapping = any(a.end > b.start + 0.05 for a, b in zip(tl.captions, tl.captions[1:]))
    if bad or overlapping:
        issues.append(Issue("CAPTIONS_INVALID", "warning", "Some captions are empty, overlap, or fall outside the Reel.",
                            fix="Tidy captions"))  # fmt: skip
    return issues


def _shot_rhythm(tl: Timeline) -> list[Issue]:
    from app.styles import get_style

    out: list[Issue] = []
    try:
        limit = max(LONG_SHOT, get_style(tl.style).max_segment * 1.5)
    except Exception:  # noqa: BLE001 - an unknown style id just uses the default limit
        limit = LONG_SHOT
    for s in tl.segments:
        if s.length > limit:
            out.append(Issue("LONG_SHOT", "warning", f"'{s.video}' is held for {s.length:.1f}s; Reels feel static past ~{limit:.0f}s.",
                             fix="Split the shot", segment_id=s.id, details={"length": s.length}))  # fmt: skip
    run: list = []
    for s in [*tl.segments, None]:
        if s is not None and s.length < RAPID_CUT:
            run.append(s)
            continue
        if len(run) >= RAPID_RUN:
            out.append(Issue("RAPID_CUTS", "warning", f"{len(run)} shots under {RAPID_CUT}s in a row from {run[0].timeline_start:.1f}s read as "
                             "flicker. Ask for 'calmer' or 'longer shots' to fix it.", segment_id=run[0].id,
                             details={"start": run[0].timeline_start, "count": len(run)}))  # fmt: skip
        run = []
    return out


def _registry_and_crop(tl: Timeline) -> list[Issue]:
    out: list[Issue] = []
    for s in tl.segments:
        if s.effect not in EFFECT_TYPES:
            out.append(Issue("UNSUPPORTED_EFFECT", "warning", f"'{s.video}' uses an effect the renderer does not know ('{s.effect}').",
                             fix="Use the closest supported effect", segment_id=s.id))  # fmt: skip
        if s.transition_in.type not in TRANSITION_TYPES:
            out.append(Issue("UNSUPPORTED_TRANSITION", "warning", f"'{s.video}' uses an unknown transition ('{s.transition_in.type}').",
                             fix="Use the closest supported transition", segment_id=s.id))  # fmt: skip
        if not (0.0 <= s.focus_x <= 1.0 and 0.0 <= s.focus_y <= 1.0) or s.crop.framing not in ("auto", "fill", "fit"):
            out.append(Issue("INVALID_CROP", "warning", f"'{s.video}' has framing values outside the picture.",
                             fix="Reset the framing", segment_id=s.id))  # fmt: skip
    return out


CAPTION_BAND_TOP = 1 - 0.22 - 0.06  # captions sit just above the bottom safe margin


def _overlay_issues(tl: Timeline) -> list[Issue]:
    from app.video.overlays import SAFE_BOTTOM, SAFE_TOP, normalize, text_box, to_layers

    if not tl.overlays:
        return []
    out: list[Issue] = []
    tidy, _ = normalize(tl.overlays, tl.duration)
    if [(o.text, o.start, o.end) for o in tidy] != [(o.text, o.start, o.end) for o in tl.overlays]:
        out.append(Issue("TEXT_TIMING", "warning", "Some on-screen texts overlap, are too short to read, too long, or run past the end.",
                         fix="Tidy the texts"))  # fmt: skip
    for layer in to_layers(tidy, False, 1080, 1920):  # laid out as stored, to see whether it would collide
        left, top, right, bottom = text_box(layer, 1080, 1920)
        if left < 0.05 or right > 0.95 or top < SAFE_TOP or bottom > 1 - SAFE_BOTTOM:
            out.append(Issue("TEXT_OUTSIDE_SAFE_AREA", "warning", f'"{layer.text}" reaches under the Reels buttons or the screen edge.',
                             fix="Tidy the texts"))  # fmt: skip
        clash = any(c.start < layer.end and layer.start < c.end for c in tl.captions)
        if clash and bottom > CAPTION_BAND_TOP:
            out.append(Issue("CAPTION_OVERLAP", "info", f'"{layer.text}" shares the screen with captions near the bottom; it is '
                             "raised above them automatically.", fix="Move the text to the top"))  # fmt: skip
    return out


# ------------------------------------------------------------------ rendered file
_BLACK = re.compile(r"black_start:(?P<s>[\d.]+)\s+black_end:(?P<e>[\d.]+)")
_MAX_VOL = re.compile(r"max_volume:\s*(?P<v>-?[\d.inf]+) dB")
_MEAN_VOL = re.compile(r"mean_volume:\s*(?P<v>-?[\d.inf]+) dB")
_HIST0 = re.compile(r"histogram_0db:\s*(?P<n>\d+)")
_FREEZE = re.compile(r"freeze_start:\s*(?P<s>[\d.]+)")
_FREEZE_END = re.compile(r"freeze_end:\s*(?P<e>[\d.]+)")
_LUFS = re.compile(r"Integrated loudness:\s*I:\s*(?P<v>-?[\d.]+) LUFS", re.S)


def _run_filters(path: Path, args: list[str], timeout: float = 90, seek: list[str] | None = None) -> str:
    """Run analysis filters over the file. ``seek`` (e.g. ["-ss", "3.2"]) goes before -i; filters and -t/-vn after it
    (FFmpeg rejects -vf/-af given as input options, which silently disabled these checks before)."""
    cmd = [find_binary("ffmpeg"), "-hide_banner", "-nostdin", "-v", "info", *(seek or []), "-i", str(path), *args, "-f", "null", "-"]
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, encoding="utf-8",
                              errors="replace").stderr  # fmt: skip
    except subprocess.TimeoutExpired:
        return ""


def _num(m: re.Match | None, key: str) -> float | None:
    try:
        return float(m.group(key)) if m else None
    except ValueError:
        return None


def check_render_file(
    path: Path, expected_size: tuple[int, int] | None, expected_duration: float, has_fades: bool = False
) -> list[Issue]:
    issues: list[Issue] = []
    info = probe(path)
    video = next((s for s in info["streams"] if s["codec_type"] == "video"), None)
    audio = next((s for s in info["streams"] if s["codec_type"] == "audio"), None)
    if video is None:
        return [Issue("NO_VIDEO", "error", "The file has no video stream.")]
    duration = float(info["format"].get("duration") or 0)

    if expected_size and (int(video["width"]), int(video["height"])) != expected_size:
        issues.append(Issue("WRONG_RESOLUTION", "warning",
                            f"The video is {video['width']}×{video['height']}, expected {expected_size[0]}×{expected_size[1]}."))  # fmt: skip
    if abs(duration - expected_duration) > DURATION_TOLERANCE + 0.15:
        issues.append(Issue("INVALID_DURATION", "warning",
                            f"The file is {duration:.1f}s but the timeline is {expected_duration:.1f}s.",
                            fix="Re-render"))  # fmt: skip

    if audio is None:
        issues.append(Issue("NO_AUDIO", "error", "The Reel has no audio track."))
    else:
        a_dur = float(audio.get("duration") or duration)
        if a_dur < duration - 0.3:
            issues.append(Issue("AUDIO_ENDS_EARLY", "warning", f"The audio ends {duration - a_dur:.1f}s before the video.",
                                details={"seconds": duration - a_dur}))  # fmt: skip

    log = _run_filters(path, ["-vf", f"blackdetect=d={BLACK_MIN_SECONDS}:pix_th=0.10,freezedetect=n=-60dB:d={FROZEN_MIN_SECONDS}",
                              "-af", "volumedetect,ebur128"])
    for m in _BLACK.finditer(log):
        s, e = float(m["s"]), float(m["e"])
        at_edge = (s < BLACK_EDGE_GRACE and has_fades) or (e > duration - BLACK_EDGE_GRACE and has_fades)
        if not at_edge:
            issues.append(Issue("BLACK_FRAMES", "warning", f"Black frames from {s:.1f}s to {e:.1f}s.",
                                details={"start": s, "end": e}))  # fmt: skip
    for m in _FREEZE.finditer(log):
        start = float(m["s"])
        end_m = _FREEZE_END.search(log, m.end())
        end = float(end_m["e"]) if end_m else duration
        at_edge = has_fades and (start < BLACK_EDGE_GRACE or end > duration - BLACK_EDGE_GRACE)
        if end - start >= FROZEN_MIN_SECONDS and not at_edge:
            issues.append(Issue("DUPLICATE_FRAMES", "warning", f"The picture freezes from {start:.1f}s to {end:.1f}s (repeated frames).",
                                details={"start": start, "end": end}))  # fmt: skip
    lufs = _num(_LUFS.search(log), "v") if audio is not None else None
    if lufs is not None and abs(lufs - TARGET_LUFS) > LOUDNESS_TOLERANCE:
        loud = lufs > TARGET_LUFS
        issues.append(Issue("AUDIO_LOUDNESS", "warning", f"The Reel is {'too loud' if loud else 'too quiet'} ({lufs:.1f} LUFS; platforms "
                            f"play at about {TARGET_LUFS:.0f}).", fix="Adjust the music volume", details={"lufs": lufs}))  # fmt: skip
    peak, clipped = _num(_MAX_VOL.search(log), "v"), _num(_HIST0.search(log), "n")
    if peak is not None and peak >= -0.1 and (clipped or 0) >= 20:
        issues.append(Issue("AUDIO_CLIPPING", "warning", f"The audio clips at 0 dB ({int(clipped or 0)} samples).",
                            fix="Lower music volume", details={"peak": peak}))  # fmt: skip

    head = _run_filters(path, ["-t", "0.2", "-vn", "-af", "volumedetect"])
    head_mean = _num(_MEAN_VOL.search(head), "v")
    overall_mean = _num(_MEAN_VOL.search(log), "v")
    # abrupt = the very first 0.2 s is already about as loud as the Reel on average (no fade-in), and not near-silent
    if audio is not None and head_mean is not None and overall_mean is not None and head_mean > max(overall_mean - 6.0, -40.0):
        issues.append(Issue("AUDIO_ABRUPT_START", "info", "The music starts at full volume on the first frame.",
                            fix="Add a short fade-in", details={"headMeanDb": head_mean}))  # fmt: skip
    tail = _run_filters(path, ["-vn", "-af", "volumedetect"], seek=["-ss", f"{max(duration - 0.25, 0):.2f}"])
    tail_mean = _num(_MEAN_VOL.search(tail), "v")
    if audio is not None and tail_mean is not None and tail_mean > -30:
        issues.append(Issue("MUSIC_ABRUPT_END", "warning", "The music is cut off abruptly at the end.",
                            fix="Add a fade-out", details={"tailMeanDb": tail_mean}))  # fmt: skip
    return issues


# ------------------------------------------------------------------ auto-fix: issue -> edit operations
def fix_operations(issue_code: str, tl: Timeline, target: float | None, segment_id: str | None = None) -> list[list]:
    """Candidate operation batches for a fix, best first. The caller uses the first that is valid."""
    if issue_code == "DURATION_MISMATCH" and target:
        return [[FitDuration(target=target)]]
    if issue_code == "REPEATED_CLIP" and segment_id:
        batch: list = [Delete(segment_id=segment_id)]
        return [batch + [FitDuration(target=target)] if target else batch, batch]
    if issue_code == "SHORT_CLIP" and segment_id:
        grow: list = [SetLength(segment_id=segment_id, length=0.6)]
        drop: list = [Delete(segment_id=segment_id)]
        fit = [FitDuration(target=target)] if target else []
        return [grow + fit, drop + fit, drop]
    if issue_code == "AUDIO_CLIPPING":
        return [[SetMusic(volume=max(round(tl.music_volume * 0.85, 3), 0.2))]]
    if issue_code == "MUSIC_ABRUPT_END":
        return [[SetMusic(fade_out=1.5)]]
    if issue_code in ("UNSUPPORTED_EFFECT", "UNSUPPORTED_TRANSITION", "INVALID_CROP", "LONG_SHOT") and segment_id:
        from app.video.effects import resolve_effect, resolve_transition

        seg = next((s for s in tl.segments if s.id == segment_id), None)
        if seg is None:
            return []
        if issue_code == "UNSUPPORTED_EFFECT":
            return [[SetEffect(segment_id=segment_id, effect=resolve_effect(seg.effect)[0])]]
        if issue_code == "UNSUPPORTED_TRANSITION":
            return [[SetTransition(segment_id=segment_id, transition=resolve_transition(seg.transition_in.type)[0])]]
        if issue_code == "INVALID_CROP":
            return [[SetCrop(segment_id=segment_id, crop=CropSpec())]]
        return [[Split(segment_id=segment_id, at=round(seg.timeline_start + seg.length / 2, 3))]]
    if issue_code in ("TEXT_TIMING", "TEXT_OUTSIDE_SAFE_AREA", "CAPTION_OVERLAP"):
        moved = [o.model_copy(update={"position": "top"}) if (issue_code == "CAPTION_OVERLAP" and o.position == "bottom") else o
                 for o in tl.overlays]  # fmt: skip
        return [[SetOverlays(overlays=moved)]]
    if issue_code == "AUDIO_ABRUPT_START":
        return [[SetMusic(fade_in=0.3)]]
    if issue_code == "CAPTIONS_INVALID":
        return [[SetCaptionStyle(style=tl.caption_style)]]  # normalisation tidies captions
    return []


def fix_for_loudness(tl: Timeline, lufs: float) -> list[list]:
    """Music volume change that moves the Reel toward TARGET_LUFS (takes effect on the next render)."""
    gain = 10 ** ((TARGET_LUFS - lufs) / 20)
    return [[SetMusic(volume=round(min(max(tl.music_volume * gain, 0.2), 2.0), 3))]]
