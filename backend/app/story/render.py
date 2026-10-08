"""A story plan -> a narrated Reel. The narration sets the timing (each scene lasts as long as its line is spoken);
each picture gets a slow camera move (a pan across a wide painting, a push-in on a portrait); captions follow the voice;
music plays quietly underneath. Rendering itself is the photo-Reel renderer (product/render.py)."""

from __future__ import annotations

import dataclasses
import logging
import os
import re
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import cv2
import numpy as np
import soundfile as sf

from app.core.ffmpeg import run_ffmpeg
from app.product.models import CameraMove, ProductReelPlan, Shot, ShotTransition, TextLayer, View
from app.product.render import FINAL, PREVIEW, render_reel
from app.product.styles import ProductStyle
from app.story.models import StoryPlan, StoryScene

log = logging.getLogger(__name__)
SR = 48000
LEAD = 0.5  # silence before the first line
GAP = 0.45  # breath between lines
MIN_SCENE = 3.0
WORDS_PER_SECOND = 2.4  # when no voice can be made, scenes are timed for reading
LANG_TAGS = {"en": "en-US", "hi": "hi-IN", "mr": "mr-IN", "hinglish": "en-IN"}
DEVANAGARI = {"hi", "mr"}

STORY_STYLE = ProductStyle(
    id="story", name="Story", description="Slow, painterly camera; soft light; captions under the picture.",
    pace=0.8, push=0.12, sway_deg=0.4, sparkle_max=0, light_sweeps=0, glow=0.12, light_leaks=0, dust=False, flash_on_drops=False,
    whip=False, vignette=0.34, contrast=1.04, saturation=1.03, alt_transitions=("dissolve",), font="Georgia", text_color="#FFF4DC",
)  # fmt: skip
MOOD_VOICE = {"calm": "calm", "devotional": "calm", "sad": "calm", "joyful": "friendly", "tense": "serious", "epic": "serious",
              "mysterious": "serious"}  # fmt: skip


@dataclass
class Line:
    scene: StoryScene
    start: float
    length: float
    voice: np.ndarray | None  # mono samples at SR


def _read(path: Path) -> np.ndarray:
    data, sr = sf.read(str(path), dtype="float32", always_2d=True)
    mono = data.mean(axis=1)
    if sr != SR:
        import librosa

        mono = librosa.resample(mono, orig_sr=sr, target_sr=SR)
    return mono.astype(np.float32)


def _ends(text: str) -> str:
    """A scene's line ends with a full stop, so the narrator pauses between scenes."""
    t = text.strip()
    return t if t[-1:] in ".!?।|…" else t + "।" if any("\u0900" <= ch <= "\u097f" for ch in t) else t + "."


def split_narration(audio: np.ndarray, texts: list[str]) -> list[np.ndarray]:
    """One recording of the whole story -> one piece per scene, cut in the pauses nearest to where each scene should end
    (by its share of the text). Falls back to cutting at those points when the pauses are unclear."""
    n = len(texts)
    if n <= 1 or len(audio) < SR:
        return [audio]
    hop = int(0.02 * SR)
    frames = len(audio) // hop
    rms = np.sqrt(np.mean(audio[: frames * hop].reshape(frames, hop) ** 2, axis=1) + 1e-12)
    thr = max(float(np.percentile(rms, 95)) * 0.06, 1e-4)
    silent = rms < thr
    gaps: list[tuple[float, float]] = []  # (middle, length) in seconds, inside the speech
    i = 0
    while i < frames:
        if silent[i]:
            j = i
            while j < frames and silent[j]:
                j += 1
            if i > 0 and j < frames and (j - i) * 0.02 >= 0.16:
                gaps.append(((i + j) / 2 * 0.02, (j - i) * 0.02))
            i = j
        else:
            i += 1
    total = len(audio) / SR
    weights = [max(len(t), 1) for t in texts]
    cuts: list[float] = []
    prev = 0.0
    for k in range(1, n):
        expected = total * sum(weights[:k]) / sum(weights)
        options = [g for g in gaps if g[0] > prev + 0.5]
        if options:
            mid, _ = min(options, key=lambda g: abs(g[0] - expected) - 0.6 * g[1])  # near where it should be; longer pauses win ties
            if abs(mid - expected) > max(2.5, 0.35 * total / n):
                mid = expected  # no pause anywhere near: cut where the scene should end
        else:
            mid = expected
        mid = max(mid, prev + 0.5)
        cuts.append(mid)
        prev = mid
    bounds = [0, *[int(c * SR) for c in cuts], len(audio)]
    pieces = []
    for a, b in zip(bounds, bounds[1:]):
        seg = audio[a:b]
        loud = np.flatnonzero(np.abs(seg) > thr)
        if len(loud):  # trim the pause at both ends (the timeline adds its own breath between scenes)
            pad = int(0.05 * SR)
            seg = seg[max(loud[0] - pad, 0) : min(loud[-1] + pad, len(seg))]
        pieces.append(seg.astype(np.float32))
    return pieces


def speak(plan: StoryPlan, voice_id: str | None, work: Path, progress: Callable[[float], None]) -> tuple[list[np.ndarray | None], list[str]]:
    """The narration, one piece per scene.

    AI voices (Gemini) record the whole story in ONE request and it is cut into scenes at the pauses: one request per
    Reel instead of one per scene (the free tier allows only a few a day), and one continuous, natural reading.
    This computer's voices read line by line. A daily limit stops the Reel with a clear message (its credits come back);
    other voice problems leave that scene with captions only, with a warning."""
    from app.voice.base import SpeechSettings, build_ssml
    from app.voice.gemini import PREFIX, VoiceQuotaExhausted
    from app.voice.sapi import get_voice_provider

    if voice_id == "none":  # the person chose no narrator: captions and music only
        progress(1.0)
        return [None] * len(plan.scenes), []
    provider = get_voice_provider()
    tag = LANG_TAGS.get(plan.language, "hi-IN")
    warnings: list[str] = []
    try:
        voice = provider.find_voice(tag, voice_id)
    except Exception as exc:  # noqa: BLE001 - no voice at all: a silent story with captions still works
        return [None] * len(plan.scenes), [f"No voice for this language ({exc}); the Reel has captions only."]
    texts = [_ends(s.narration) for s in plan.scenes]
    if voice.id.startswith(PREFIX):
        wav = work / "narration_full.wav"
        mood = max(set(s.mood for s in plan.scenes), key=[s.mood for s in plan.scenes].count)
        ssml = build_ssml("\n\n".join(texts), SpeechSettings(emotion=MOOD_VOICE.get(mood, "calm"), pause_style="dramatic"), tag)
        progress(0.1)
        provider.synthesize(ssml, voice.id, wav)  # VoiceQuotaExhausted / VoiceUnavailable stop the Reel with their message
        progress(0.8)
        pieces = split_narration(_read(wav), texts)
        progress(1.0)
        return [*pieces, *[None] * (len(texts) - len(pieces))], warnings
    out: list[np.ndarray | None] = []
    for i, (s, text) in enumerate(zip(plan.scenes, texts)):
        wav = work / f"line_{i:02d}.wav"
        try:
            provider.synthesize(build_ssml(text, SpeechSettings(emotion=MOOD_VOICE.get(s.mood, "calm"), pause_style="natural"), tag), voice.id, wav)
            out.append(_read(wav))
        except VoiceQuotaExhausted:
            raise
        except Exception as exc:  # noqa: BLE001
            log.warning("story voice for scene %d: %s", i + 1, exc)
            warnings.append(f"Scene {i + 1}: the voice could not be made ({str(exc)[:80]}); it is shown with captions only.")
            out.append(None)
        progress((i + 1) / len(plan.scenes))
    return out, warnings


def time_lines(plan: StoryPlan, voices: list[np.ndarray | None]) -> list[Line]:
    lines, t = [], LEAD
    for s, v in zip(plan.scenes, voices):
        spoken = len(v) / SR if v is not None else len(s.narration.split()) / WORDS_PER_SECOND
        length = max(spoken + GAP, MIN_SCENE)
        lines.append(Line(s, t, length, v))
        t += length
    lines[0].start, lines[0].length = 0.0, lines[0].length + LEAD  # the first picture is already there during the lead-in
    return lines


def _span(iw: int, ih: int, hh: float) -> float:
    """Half the view's width as a fraction of the picture's width (the view is always 9:16)."""
    return (hh * ih * 9 / 16) / (2 * iw)


def camera(i: int, scene: StoryScene, iw: int, ih: int, push: float) -> CameraMove:
    """A slow move that suits the picture: across a wide painting, into a tall one; never past its edges."""
    wide = iw / ih > 0.9
    hh = 1.0
    half = _span(iw, ih, hh)
    if half >= 0.5:  # the picture is narrower than the frame: fill the width instead
        hh = (iw * 16 / 9) / ih
        half = 0.5
    cy = 0.5 if hh >= 1 else min(max(0.42, hh / 2), 1 - hh / 2)
    if wide and half < 0.42:
        left, right = View(cx=half + 0.02, cy=cy, hh=hh), View(cx=1 - half - 0.02, cy=cy, hh=hh)
        start, end = (left, right) if i % 2 == 0 else (right, left)
        return CameraMove(type="pan_right" if i % 2 == 0 else "pan_left", start=start, end=end, ease="in_out")
    tight = hh * (1 - push * (1.6 if scene.shot == "close" else 1.0))
    ty = min(max(0.42, tight / 2), 1 - tight / 2)  # faces sit in the upper half of most paintings
    a, b = View(cx=0.5, cy=cy, hh=hh), View(cx=0.5, cy=ty, hh=tight)
    return CameraMove(type="push_in", start=a, end=b, ease="out") if i % 2 == 0 else CameraMove(type="pull_out", start=b, end=a, ease="in_out")


def _chunks(text: str, width: int = 20) -> list[str]:
    """Caption lines that fit across a phone screen: whole words, about ``width`` characters each."""
    out, cur = [], ""
    for w in text.split():
        if cur and len(cur) + 1 + len(w) > width:
            out.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}".strip()
    if cur:
        out.append(cur)
    return out or [text]


def build_plan(plan: StoryPlan, lines: list[Line], sizes: list[tuple[int, int]], style: ProductStyle) -> ProductReelPlan:
    shots, texts = [], []
    for i, ln in enumerate(lines):
        iw, ih = sizes[i]
        tr = ShotTransition(type="fade_from_black", duration=0.7) if i == 0 else ShotTransition(type="dissolve", duration=0.6)
        shots.append(Shot(index=i, start=ln.start, end=ln.start + ln.length, purpose="hook" if i == 0 else "hero", framing="hero",
                          image_index=i, camera=camera(i, ln.scene, iw, ih, style.push), transition_in=tr, note=ln.scene.narration[:80]))  # fmt: skip
        # captions follow the voice: each chunk gets a share of the spoken time by its length
        spoken0 = ln.start + (LEAD if i == 0 else 0.0)
        spoken = (len(ln.voice) / SR) if ln.voice is not None else len(ln.scene.narration.split()) / WORDS_PER_SECOND
        chunks = _chunks(re.sub(r"\s+", " ", ln.scene.narration).strip())
        total = sum(len(c) for c in chunks) or 1
        t = spoken0
        for k, c in enumerate(chunks):
            d = spoken * len(c) / total
            texts.append(TextLayer(id=f"c{i}_{k}", text=c, start=t, end=t + d, x=0.5, y=0.82, size=0.042, animation_in="fade",
                                   animation_out="none", role="tagline"))  # fmt: skip
            t += d
    duration = lines[-1].start + lines[-1].length + 0.6
    shots[-1] = shots[-1].model_copy(update={"end": duration})
    texts.insert(0, TextLayer(id="title", text=plan.title[:60], start=0.25, end=min(2.8, lines[0].length), x=0.5, y=0.15, size=0.055,
                              animation_in="blur_sharp", role="hook"))  # fmt: skip
    return ProductReelPlan(style=style.id, duration=round(duration, 3), images=[ln.scene.id for ln in lines], shots=shots, texts=texts,
                           concept={"hook": plan.scenes[0].narration[:120], "story": plan.title}, post_copy=plan.post_copy)  # fmt: skip


def mix_narration(lines: list[Line], duration: float, out: Path) -> bool:
    """All lines on one track at their times. False when there is no voice at all."""
    if not any(ln.voice is not None for ln in lines):
        return False
    track = np.zeros(int((duration + 1) * SR), np.float32)
    for i, ln in enumerate(lines):
        if ln.voice is None:
            continue
        a = int((ln.start + (LEAD if i == 0 else 0.0)) * SR)
        seg = ln.voice[: max(len(track) - a, 0)]
        track[a : a + len(seg)] += seg
    peak = float(np.abs(track).max()) or 1.0
    sf.write(str(out), track * min(0.95 / peak, 4.0), SR)
    return True


def render_story(plan: StoryPlan, pictures: list[Path], out: Path, work: Path, voice_id: str | None, music: Path | None,
                 quality: str, progress: Callable[[str, float], None]) -> tuple[ProductReelPlan, list[str]]:  # fmt: skip
    """Make the MP4. ``pictures`` follow ``plan.scenes``."""
    work.mkdir(parents=True, exist_ok=True)
    voices, warnings = speak(plan, voice_id, work, lambda f: progress("voicing", f))
    lines = time_lines(plan, voices)
    sizes = []
    for p in pictures:
        img = cv2.imread(str(p), cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError(f"A scene picture could not be read: {p.name}")
        sizes.append((img.shape[1], img.shape[0]))
    style = STORY_STYLE
    if plan.language in DEVANAGARI:
        style = dataclasses.replace(style, font="Nirmala UI" if os.name == "nt" else "Noto Sans Devanagari")  # fonts with Devanagari
    reel = build_plan(plan, lines, sizes, style)
    base = dataclasses.replace(FINAL, fps=25) if quality == "final" else PREVIEW  # slow painterly moves: 25 fps looks the same, renders faster
    rs = dataclasses.replace(base, music_volume=0.22 if any(v is not None for v in voices) else 0.8)
    silent = work / "pictures.mp4"
    render_reel(reel, pictures, style, silent, work / "frames", music=music, settings=rs, progress=lambda f: progress("rendering", f * 0.95))
    narration = work / "narration.wav"
    if mix_narration(lines, reel.duration, narration):
        out.parent.mkdir(parents=True, exist_ok=True)
        if music is not None:
            graph = "[1:a]aresample=48000[v];[0:a][v]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]"
        else:
            graph = "[1:a]aresample=48000,apad[a]"
        run_ffmpeg(["-i", str(silent), "-i", str(narration), "-filter_complex", graph, "-map", "0:v", "-map", "[a]", "-c:v", "copy",
                    "-c:a", "aac", "-b:a", "192k", "-t", f"{reel.duration:.3f}", "-movflags", "+faststart", str(out)], timeout=300)  # fmt: skip
    else:
        shutil.copyfile(silent, out)
    progress("rendering", 1.0)
    return reel, warnings
