"""Learned trends: the editing style of reference Reels the user uploads ("edit my video like these").

Nothing is downloaded from any platform: the user uploads Reels they saved or have the rights to watch, whenever they
want to refresh a trend. Each video is *measured* (the file itself is not kept):

* exact cut times (FFmpeg scene detection, frame accurate) -> shot lengths, the hook, cuts per 10 s;
* its own music (beats, hits, energy) -> how many cuts land on the beat, how shot length changes between loud and
  calm parts, how many beats a shot lasts;
* the look (brightness, colour) from keyframes, and, when an AI with vision is set up, a short description of the
  framing, text, effects and transitions it uses.

A trend is one or more such videos under a name; its profile is their duration-weighted average. The AI director
receives the profiles (``reel.reference``) and edits the user's footage with the same rhythm and feel.
"""

from __future__ import annotations

import logging
import re
import statistics
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from app.ai.schemas import Text, _Answer
from app.core.ffmpeg import find_binary
from app.director.music_map import build_music_map, loud_limit
from app.video.analyzer import read_metadata

log = logging.getLogger(__name__)

SCENE_THRESHOLD = 0.32  # FFmpeg scene score above which a frame starts a new shot
MIN_GAP = 0.2  # two detected cuts closer than this are one cut (flashes, fades)
ON_BEAT = 0.1  # a cut this close to a beat or strong hit counts as "on the beat" (detection is frame-accurate)
MAX_SECONDS = 180  # reference Reels are short; longer files are measured over their first 3 minutes
_PTS = re.compile(r"pts_time:([0-9.]+)")


# ---------------------------------------------------------------------- measuring one video
def detect_cuts(path: Path, duration: float) -> list[float]:
    """Frame-accurate cut times (seconds), from FFmpeg's scene-change score on a small copy of the picture."""
    cmd = [find_binary("ffmpeg"), "-hide_banner", "-nostats", "-t", str(MAX_SECONDS), "-i", str(path), "-an",
           "-vf", f"scale=320:-2,select='gt(scene,{SCENE_THRESHOLD})',showinfo", "-f", "null", "-"]  # fmt: skip
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    cuts: list[float] = []
    for t in sorted(float(m) for m in _PTS.findall(r.stderr)):
        if 0.1 < t < duration - 0.1 and (not cuts or t - cuts[-1] >= MIN_GAP):
            cuts.append(round(t, 3))
    return cuts


def extract_audio(path: Path, out: Path) -> bool:
    """The reference's own soundtrack as a WAV (False when it has none)."""
    cmd = [find_binary("ffmpeg"), "-hide_banner", "-y", "-t", str(MAX_SECONDS), "-i", str(path), "-vn", "-ac", "1", "-ar", "22050", str(out)]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    return r.returncode == 0 and out.exists() and out.stat().st_size > 10_000


def keyframes(path: Path, times: list[float], width: int = 360) -> list[bytes]:
    """JPEG frames at ``times`` (one per shot, for the look and the AI description)."""
    cap = cv2.VideoCapture(str(path))
    out: list[bytes] = []
    try:
        for t in times:
            cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
            ok, frame = cap.read()
            if not ok:
                continue
            h, w = frame.shape[:2]
            frame = cv2.resize(frame, (width, max(int(h * width / max(w, 1)), 2)))
            ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
            if ok:
                out.append(buf.tobytes())
    finally:
        cap.release()
    return out


def look_of(frames: list[bytes]) -> dict[str, float]:
    """Average brightness and colour saturation (0..1) of the frames."""
    if not frames:
        return {}
    v, s = [], []
    for f in frames:
        img = cv2.imdecode(np.frombuffer(f, np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            continue
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        s.append(float(hsv[..., 1].mean()) / 255)
        v.append(float(hsv[..., 2].mean()) / 255)
    return {"brightness": round(statistics.fmean(v), 2), "saturation": round(statistics.fmean(s), 2)} if v else {}


def _pace_of(avg_shot: float) -> str:
    return "fast" if avg_shot <= 1.2 else "balanced" if avg_shot <= 2.6 else "calm"


def measure(cuts: list[float], duration: float, audio=None) -> dict[str, Any]:
    """The rhythm numbers of one video from its cut times (and its own music analysis, when it has music)."""
    bounds = [0.0, *cuts, duration]
    shots = [b - a for a, b in zip(bounds, bounds[1:]) if b - a > 0.05]
    avg = statistics.fmean(shots) if shots else duration
    out: dict[str, Any] = {
        "seconds": round(duration, 1), "shots": len(shots), "avg_shot": round(avg, 2),
        "median_shot": round(statistics.median(shots), 2) if shots else round(duration, 2),
        "shortest_shot": round(min(shots), 2) if shots else round(duration, 2), "longest_shot": round(max(shots), 2) if shots else round(duration, 2),
        "hook_seconds": round(shots[0], 2) if shots else round(duration, 2), "cuts_per_10s": round(10 * len(cuts) / max(duration, 0.1), 1),
        "pace": _pace_of(avg), "has_music": audio is not None, "energy_curve": _energy_curve(shots),
    }  # fmt: skip
    if audio is not None and audio.beats:
        mm = build_music_map(audio, 0.0, duration)
        pts = mm.snap_points
        on = [c for c in cuts if pts and min(abs(c - p) for p in pts) <= ON_BEAT]
        loud, calm = [], []
        for a, b in zip(bounds, bounds[1:]):
            (loud if loud_limit(mm, a, b) else calm).append(b - a)
        period = 60 / audio.bpm if audio.bpm else 0.0
        out.update({
            "bpm": round(audio.bpm, 1), "on_beat_share": round(len(on) / len(cuts), 2) if cuts else 0.0,
            "beats_per_shot": round(statistics.median(shots) / period, 1) if period and shots else None,
            "loud_avg_shot": round(statistics.fmean(loud), 2) if loud else None,
            "calm_avg_shot": round(statistics.fmean(calm), 2) if calm else None,
        })  # fmt: skip
    return out


def _energy_curve(shots: list[float]) -> str:
    """How the cutting energy develops: shots getting shorter = rising, longer = falling."""
    if len(shots) < 6:
        return "steady"
    k = len(shots) // 3
    first, last = statistics.fmean(shots[:k]), statistics.fmean(shots[-k:])
    if last < first * 0.75:
        return "rising"
    if last > first * 1.33:
        return "falling"
    mid = statistics.fmean(shots[k:-k])
    return "peak_in_middle" if mid < min(first, last) * 0.75 else "steady"


TEXT_DENSITY = {"none": "none", "hook only": "low", "some shots": "medium", "every shot": "high", "captions": "high"}


def traits(p: dict[str, Any]) -> dict[str, Any]:
    """The reference's creative characteristics in the Creative Director's vocabulary (never its content: nothing is copied)."""
    described = p.get("described")
    descs = described if isinstance(described, list) else [described] if described else []
    trans = [t.lower() for d in descs for t in (d.get("transitions") or [])]
    texts = [str(d.get("text_on_screen", "")).lower() for d in descs if d.get("text_on_screen")]
    effects = [e.lower() for d in descs for e in (d.get("effects") or [])]
    soft = sum(1 for t in trans if t and not any(w in t for w in ("cut", "none")))
    look = p.get("look") or {}
    beat = p.get("on_beat_share")
    out = {
        "pacing": p.get("pace"), "average_shot_duration": p.get("avg_shot"), "shot_density_per_10s": p.get("cuts_per_10s"),
        "hook_seconds": p.get("hook_seconds"), "energy_curve": p.get("energy_curve", "steady"),
        "transition_style": ("not_measured" if not descs else "mostly_hard_cut" if soft == 0 else "mixed" if soft <= 2 else "transition_heavy"),
        "text_density": TEXT_DENSITY.get(texts[0], "medium") if texts else "not_measured",
        "camera_movement": ", ".join(sorted(set(effects))[:4]) or "not_measured",
        "music_sync": None if beat is None else "tight" if beat >= 0.7 else "loose" if beat >= 0.4 else "free",
        "color_mood": " ".join(x for x in ("bright" if look.get("brightness", 0.5) > 0.6 else "dark" if look.get("brightness", 0.5) < 0.35 else "",
                                           "vivid" if look.get("saturation", 0.4) > 0.5 else "muted" if look.get("saturation", 0.4) < 0.25 else "") if x)
                      or "neutral",
        "story_structure": "fast_hook_then_build" if (p.get("hook_seconds") or 9) <= 1.2 and p.get("energy_curve") in ("rising", "peak_in_middle")
                           else "fast_hook" if (p.get("hook_seconds") or 9) <= 1.2 else "slow_open",
    }  # fmt: skip
    return {k: v for k, v in out.items() if v is not None}


class ReferenceLook(_Answer):
    """What a vision model sees in a reference Reel's keyframes."""

    framing: str = ""  # close-ups / medium / wide / mixed
    text_on_screen: str = ""  # none / hook only / on every shot / captions ...
    effects: list[Text] = []  # zooms, shakes, flashes, speed ramps ...
    transitions: list[Text] = []
    colour: str = ""  # warm / cool / high contrast / soft pastel ...
    mood: str = ""
    summary: str = ""


def describe_look(frames: list[bytes], profile: dict[str, Any]) -> dict[str, Any] | None:
    """A short description of the reference's visual style by the vision AI (None when no AI with vision is set up)."""
    from app.ai.provider import get_provider
    from app.core.errors import AppError

    if not frames:
        return None
    try:
        provider = get_provider("clip_understanding")
        system = ("You analyse the editing style of a short vertical video (Instagram Reel / TikTok) from one frame per shot, "
                  "for an editor who wants to copy its style. Reply with one JSON object only. Describe style, never people's identity.")  # fmt: skip
        user = (f"{len(frames)} frames, one per shot, in order. Measured: {profile.get('shots')} shots in {profile.get('seconds')} s, "
                f"average shot {profile.get('avg_shot')} s. Return JSON: {{\"framing\": \"close-ups|medium|wide|mixed\", "
                "\"text_on_screen\": \"none|hook only|some shots|every shot|captions\", \"effects\": [\"visible camera effects\"], "
                "\"transitions\": [\"visible transitions\"], \"colour\": \"<colour grade in a few words>\", \"mood\": \"<one word>\", "
                "\"summary\": \"<one sentence: how this video is edited>\"}")  # fmt: skip
        ans = provider.generate_vision_structured(system, user, frames[:12], ReferenceLook, task="clip_understanding", temperature=0.1)
        return ans.model_dump()
    except (AppError, NotImplementedError) as exc:  # no vision model / provider down: the numbers still work
        log.info("reference look not described: %s", getattr(exc, "message", exc))
        return None


def profile_video(path: Path, name: str = "") -> dict[str, Any]:
    """Measure one reference video (see the module docstring)."""
    from app.audio.analyzer import analyze_audio

    meta = read_metadata(path)
    duration = min(meta.duration, MAX_SECONDS)
    cuts = detect_cuts(path, duration)
    audio = None
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "ref.wav"
        if extract_audio(path, wav):
            try:
                audio = analyze_audio(wav)
            except Exception as exc:  # noqa: BLE001 - a silent or odd soundtrack only loses the music numbers
                log.info("reference audio not analysed: %s", exc)
    prof = measure(cuts, duration, audio)
    bounds = [0.0, *cuts, duration]
    frames = keyframes(path, [(a + b) / 2 for a, b in zip(bounds, bounds[1:])][:24])
    prof["look"] = look_of(frames)
    prof["described"] = describe_look(frames, prof)
    prof["name"] = name
    return prof


# ---------------------------------------------------------------------- a trend = several videos
_AVG_KEYS = ("avg_shot", "median_shot", "hook_seconds", "cuts_per_10s", "bpm", "on_beat_share", "beats_per_shot", "loud_avg_shot", "calm_avg_shot")


def merge_profiles(videos: list[dict[str, Any]]) -> dict[str, Any]:
    """One profile for the trend: numbers averaged (weighted by length), descriptions listed."""
    if not videos:
        return {}
    out: dict[str, Any] = {"videos": len(videos), "seconds": round(sum(v["seconds"] for v in videos), 1)}
    for k in _AVG_KEYS:
        vals = [(v[k], v["seconds"]) for v in videos if v.get(k) is not None]
        if vals:
            out[k] = round(sum(x * w for x, w in vals) / sum(w for _, w in vals), 2)
    out["shortest_shot"] = min(v["shortest_shot"] for v in videos)
    out["longest_shot"] = max(v["longest_shot"] for v in videos)
    out["pace"] = _pace_of(out.get("avg_shot", 2.0))
    looks = [v["look"] for v in videos if v.get("look")]
    if looks:
        out["look"] = {k: round(statistics.fmean(lk[k] for lk in looks), 2) for k in ("brightness", "saturation")}
    out["described"] = [v["described"] for v in videos if v.get("described")][:4]
    curves = [v.get("energy_curve") for v in videos if v.get("energy_curve")]
    if curves:
        out["energy_curve"] = max(set(curves), key=curves.count)
    return out


def for_ai(trend: dict[str, Any]) -> dict[str, Any]:
    """The compact form the AI director receives."""
    p = trend.get("profile", {})
    keep = ("pace", "avg_shot", "median_shot", "hook_seconds", "cuts_per_10s", "on_beat_share", "beats_per_shot", "loud_avg_shot",
            "calm_avg_shot", "shortest_shot", "longest_shot", "look", "described")  # fmt: skip
    return {"name": trend.get("name", ""), "notes": trend.get("notes", ""), **{k: p[k] for k in keep if p.get(k) not in (None, [], {})},
            "traits": traits(p)}  # fmt: skip


# ---------------------------------------------------------------------- storage (MongoDB "references")
async def load_references(choice: str | None) -> list[dict[str, Any]]:
    """The learned trends a render may use: none, the chosen one, or (auto) all of them for the AI to pick from."""
    from bson import ObjectId

    from app.core.database import get_db

    choice = choice or "auto"
    if choice == "none":
        return []
    db = get_db()
    try:
        if choice != "auto":
            if not ObjectId.is_valid(choice):
                return []
            doc = await db.references.find_one({"_id": ObjectId(choice)})
            return [{**for_ai(doc), "chosen": True}] if doc else []
        return [for_ai(d) async for d in db.references.find({}).sort("updatedAt", -1).limit(8)]
    except Exception as exc:  # noqa: BLE001 - a missing trend never blocks a render
        log.warning("learned trends not loaded: %s", exc)
        return []
