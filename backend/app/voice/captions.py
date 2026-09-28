"""Captions that follow the voice-over: every spoken line becomes short on-screen cues, timed to the voice."""

from __future__ import annotations

from app.models.timeline import VoiceTrack
from app.video.timeline_ops import CaptionInput

WORDS_PER_CUE = 4


def captions_from_voice(voice: VoiceTrack, words_per_cue: int = WORDS_PER_CUE) -> list[CaptionInput]:
    """Split each voiced line into ≤ ``words_per_cue`` word cues, spread across the line's real duration."""
    out: list[CaptionInput] = []
    for line in voice.lines:
        words = line.text.split()
        if not words:
            continue
        groups = [words[i : i + words_per_cue] for i in range(0, len(words), words_per_cue)]
        total = sum(len(g) for g in groups)
        t = line.start
        span = max(line.end - line.start, 0.2)
        for g in groups:
            d = span * len(g) / total
            out.append(CaptionInput(start=round(t, 3), end=round(t + d, 3), text=" ".join(g)))
            t += d
    return out
