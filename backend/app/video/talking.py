"""Talking-head mode: a person speaking to the camera, cut like a creator would.

From each clip's own speech (word timings from faster-whisper):

* the pauses longer than ``MAX_PAUSE`` and the filler words ("um", "uh", "erm" ...) are cut out (jump cuts);
* the clips stay in the order given; the Reel keeps their own sound (no music needed);
* captions come from the same words, word by word, in the "highlight" style;
* the Reel is as long as the speech, never longer than the length asked for (later sentences are left out, whole).

Deterministic: no AI decides anything here; the transcript does.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.captions.cues import cues_to_captions, group_words
from app.captions.transcriber import Word
from app.models.timeline import Segment, Timeline
from app.video.timeline import ClipInput

MAX_PAUSE = 0.35  # seconds of silence kept between words; longer pauses are cut
PAD = 0.08  # breath kept before the first and after the last word of a stretch, so words are not clipped
MIN_SPAN = 0.4  # shorter stretches (a lone word) are dropped
FILLERS = {"um", "umm", "uh", "uhh", "uhm", "erm", "er", "ah", "ahh", "hmm", "hm", "mm", "mmm", "mhm"}


def _clean(w: str) -> str:
    return re.sub(r"[^\w']", "", w.lower())


@dataclass
class Span:
    clip_id: str
    start: float
    end: float
    words: list[Word]  # times inside the clip

    @property
    def length(self) -> float:
        return self.end - self.start


def speech_spans(clip_id: str, words: list[Word], clip_seconds: float) -> list[Span]:
    """The stretches of real speech in one clip: fillers dropped, split wherever the speaker pauses too long."""
    kept = [w for w in words if _clean(w.text) not in FILLERS and _clean(w.text)]
    spans: list[Span] = []
    cur: list[Word] = []
    for w in kept:
        if cur and w.start - cur[-1].end > MAX_PAUSE:
            spans.append(Span(clip_id, cur[0].start, cur[-1].end, cur))
            cur = []
        cur.append(w)
    if cur:
        spans.append(Span(clip_id, cur[0].start, cur[-1].end, cur))
    out: list[Span] = []
    for sp in spans:
        a, b = max(sp.start - PAD, 0.0), min(sp.end + PAD, clip_seconds)
        if out and a < out[-1].end:  # the padding of two stretches overlaps: one stretch
            out[-1].end, out[-1].words = b, out[-1].words + sp.words
        elif b - a >= MIN_SPAN:
            out.append(Span(clip_id, round(a, 3), round(b, 3), sp.words))
    return out


def build_talking_timeline(clips: list[ClipInput], transcripts: dict[str, list[Word]], max_seconds: float,
                           style: str = "social_native") -> tuple[Timeline, dict]:  # fmt: skip
    """(timeline, stats) from the clips in their order. Stats say how much was cut, for the notes."""
    segments: list[Segment] = []
    words_tl: list[Word] = []
    t = 0.0
    spoken = cut = 0.0
    left_out = 0
    for c in clips:
        words = transcripts.get(c.clip_id, [])
        dur = c.analysis.metadata.duration
        spans = speech_spans(c.clip_id, words, dur)
        cut += max(dur - sum(s.length for s in spans), 0.0)
        for sp in spans:
            if t + sp.length > max_seconds + 1e-6:
                left_out += 1  # whole sentences only: the next stretch would run past the length asked for
                continue
            segments.append(Segment(
                clip_id=c.clip_id, video=c.name, source_start=sp.start, source_end=sp.end, timeline_start=round(t, 3),
                timeline_end=round(t + sp.length, 3), effect="none", volume=1.0,
                reason=f"{c.name}: speech {sp.start:.1f}-{sp.end:.1f}s (pauses and filler words cut)",
            ))  # fmt: skip
            words_tl += [Word(w.text, round(t + (w.start - sp.start), 3), round(t + (w.end - sp.start), 3)) for w in sp.words]
            t += sp.length
            spoken += sp.length
    tl = Timeline(duration=round(t, 3), style=style, segments=segments, caption_style="highlight", music_volume=0.0)
    cues = group_words(words_tl, tl.duration) if words_tl else []
    if cues:
        tl.captions = cues_to_captions(cues)
    return tl, {"spoken": round(spoken, 1), "cut": round(cut, 1), "left_out": left_out, "shots": len(segments)}
