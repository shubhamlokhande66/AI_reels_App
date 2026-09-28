"""Group word timings into readable caption cues."""

from __future__ import annotations

from dataclasses import dataclass

from app.captions.transcriber import Word

MAX_WORDS = 4
MAX_CUE_SECONDS = 2.6
PAUSE_BREAK = 0.6  # a silence longer than this always starts a new cue
MIN_WORD_SECONDS = 0.08


@dataclass(frozen=True)
class Cue:
    start: float
    end: float
    words: tuple[Word, ...]

    @property
    def text(self) -> str:
        return " ".join(w.text for w in self.words)


def group_words(words: list[Word], duration: float, max_words: int = MAX_WORDS) -> list[Cue]:
    """Cues of a few words each, clamped to ``[0, duration]`` and never overlapping."""
    clean: list[Word] = []
    for w in sorted(words, key=lambda w: w.start):
        start, end = max(w.start, 0.0), min(w.end, duration)
        if start >= duration or end <= 0:
            continue
        clean.append(Word(w.text, start, max(end, start + MIN_WORD_SECONDS)))

    cues: list[Cue] = []
    cur: list[Word] = []
    for w in clean:
        if cur:
            gap = w.start - cur[-1].end
            too_long = w.end - cur[0].start > MAX_CUE_SECONDS
            ends_sentence = cur[-1].text.endswith((".", "!", "?"))
            if len(cur) >= max_words or gap > PAUSE_BREAK or too_long or ends_sentence:
                cues.append(Cue(cur[0].start, cur[-1].end, tuple(cur)))
                cur = []
        cur.append(w)
    if cur:
        cues.append(Cue(cur[0].start, cur[-1].end, tuple(cur)))

    # Keep a cue on screen briefly after its last word, without running into the next cue.
    out: list[Cue] = []
    for i, c in enumerate(cues):
        limit = cues[i + 1].start if i + 1 < len(cues) else duration
        out.append(Cue(c.start, min(max(c.end + 0.25, c.start + 0.4), limit, duration), c.words))
    return out


def cues_to_captions(cues: list[Cue]):
    """Cues from transcription -> editable caption cues on the timeline."""
    from app.models.timeline import Caption, CaptionWord

    return [
        Caption(start=round(c.start, 3), end=round(c.end, 3), text=c.text,
                words=[CaptionWord(text=w.text, start=round(w.start, 3), end=round(w.end, 3)) for w in c.words])
        for c in cues
    ]  # fmt: skip


def captions_to_cues(captions) -> list[Cue]:
    """Editable caption cues -> cues the ASS renderer understands (word timing kept when present)."""
    out: list[Cue] = []
    for c in captions:
        words = tuple(Word(w.text, w.start, w.end) for w in c.words) or (Word(c.text, c.start, c.end),)
        out.append(Cue(c.start, c.end, words))
    return out
