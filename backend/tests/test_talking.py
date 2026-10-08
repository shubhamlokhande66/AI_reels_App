"""Talking-head mode: speech kept, long pauses and filler words cut, whole sentences within the length, word captions."""

from __future__ import annotations

from app.captions.transcriber import Word
from app.video.talking import MAX_PAUSE, build_talking_timeline, speech_spans
from tests.test_timeline import make_clip


def _words(spec):
    return [Word(t, a, b) for t, a, b in spec]


SPEECH = _words([
    ("Hi", 0.5, 0.8), ("everyone,", 0.85, 1.3), ("um", 1.5, 1.8), ("today", 1.9, 2.3), ("I", 2.35, 2.45), ("show", 2.5, 2.9),
    ("you", 2.95, 3.1), ("our", 3.15, 3.3), ("rings.", 3.35, 3.9),
    ("They", 6.0, 6.3), ("shine.", 6.35, 6.9),
])  # fmt: skip


def test_pauses_and_fillers_are_cut():
    spans = speech_spans("c1", SPEECH, 8.0)
    # cut where the speaker paused (2.1 s before "They") and where the filler "um" was (a jump cut over it)
    assert [(round(s.start, 2), round(s.end, 2)) for s in spans] == [(0.42, 1.38), (1.82, 3.98), (5.92, 6.98)]
    assert all(w.text != "um" for s in spans for w in s.words)  # the filler is gone from the captions too
    for s in spans:
        gaps = [b.start - a.end for a, b in zip(s.words, s.words[1:])]
        assert all(g <= MAX_PAUSE for g in gaps)


def test_timeline_keeps_speech_in_order_with_captions_and_respects_the_length():
    a, b = make_clip("c1", dur=8.0), make_clip("c2", dur=8.0)
    tl, st = build_talking_timeline([a, b], {"c1": SPEECH, "c2": SPEECH}, max_seconds=60)
    assert [s.clip_id for s in tl.segments] == ["c1"] * 3 + ["c2"] * 3
    assert tl.duration == round(sum(s.length for s in tl.segments), 3) and st["cut"] > 4
    for x, y in zip(tl.segments, tl.segments[1:]):
        assert abs(x.timeline_end - y.timeline_start) < 1e-6  # back to back: jump cuts
    assert tl.captions and tl.caption_style == "highlight" and tl.captions[0].text.lower().startswith("hi")
    assert all(0 <= c.start < c.end <= tl.duration + 1e-6 for c in tl.captions)
    short, st2 = build_talking_timeline([a, b], {"c1": SPEECH, "c2": SPEECH}, max_seconds=5)
    assert short.duration <= 5 and st2["left_out"] >= 1  # whole sentences only, never cut mid-sentence
    empty, _ = build_talking_timeline([a], {"c1": []}, max_seconds=30)
    assert not empty.segments
