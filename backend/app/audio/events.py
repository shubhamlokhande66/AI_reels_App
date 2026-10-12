"""Every audio event of a song, in the editor's vocabulary.

**Hits** (one event per moment: a hit found by two methods is one event; what else it is goes in ``tags``):

- ``STRONG_BEAT`` / ``MAIN_BEAT`` / ``WEAK_BEAT``: the tracked beats, by how hard they hit compared with the beats
  around them (``tags``: ``DOWNBEAT`` on an estimated bar start)
- ``SUB_BEAT``: a hit between beats on the half / quarter grid (``subdivision: true``)
- ``IMPACT``: a sudden, very hard transient (the hardest few percent of the song, with the energy jumping)
- ``BASS_HIT``: a hit whose energy is in the low end (below 150 Hz: kick, 808, bass drop)
- ``PERCUSSION_HIT``: a hit that is mostly percussive sound (tabla, dhol, drums), from harmonic / percussive separation
- ``ONSET``: any other attack (a note, a chord, a sound starting)

**Stretches and moments**:

- ``SILENCE`` (near-silent, 1 s or more), ``REVERB_TAIL`` (the sound dying away with nothing new: no hit, falling level)
- ``ENERGY_RISE`` / ``ENERGY_DROP`` (energy and rhythm climbing / falling away), ``BUILD_UP`` (a rise into a drop),
  ``MUSIC_DROP`` (the arrangement kicks in: audio/drops.py, five measurements against their context)
- ``FILL`` (a quick run of hits leading into a bar start or a new section)
- ``SECTION_CHANGE``, ``TEMPO_CHANGE``, ``PHRASE_END`` (every 4 bars, from the estimated downbeats)
- ``VOCAL_ENTRY`` / ``VOCAL_PAUSE`` (from the vocal-presence estimate: a heuristic, no source separation)

Every event has ``onset_strength`` and ``rms_energy`` at its time (0..1, against the song's strong hits / loud level),
``subdivision``, a ``confidence`` (0..1) and, for stretches, ``end``. Downbeats, phrases and vocals are estimates:
librosa has no model of bars or voices, and the confidence says how sure each one is.
"""

from __future__ import annotations

from typing import Any, Literal

import librosa
import numpy as np
from pydantic import BaseModel, Field

from app.audio.beat_detector import HOP
from app.models.analysis import AudioAnalysis

EventType = Literal[
    "MAIN_BEAT", "STRONG_BEAT", "WEAK_BEAT", "SUB_BEAT", "ONSET", "PERCUSSION_HIT", "BASS_HIT", "SILENCE", "ENERGY_RISE",
    "ENERGY_DROP", "MUSIC_DROP", "BUILD_UP", "FILL", "SECTION_CHANGE", "TEMPO_CHANGE", "PHRASE_END", "REVERB_TAIL",
    "VOCAL_ENTRY", "VOCAL_PAUSE", "IMPACT",
]  # fmt: skip
HIT_TYPES = ("STRONG_BEAT", "MAIN_BEAT", "WEAK_BEAT", "SUB_BEAT", "IMPACT", "BASS_HIT", "PERCUSSION_HIT", "ONSET")

DEDUP = 0.05  # two hits closer than this are one
SUB_TOL = 0.045  # a hit this close to the half / quarter point between beats is a sub-beat
STRONG, WEAK = 1.25, 0.6  # a beat this many times harder / softer than the beats around it
STRENGTH_PCT = 99  # onset strength 1.0 = the song's hardest hits (its 99th percentile)
IMPACT_PCT = 97  # an impact is among the hardest 3% of the onset strength ...
IMPACT_RISE = 0.25  # ... with the energy jumping at least this much (0..1)
BASS_HZ = 150.0
BASS_SHARE = 0.75  # a bass hit: its low-end attack is at least this strong (0..1, against the song's hardest bass hits)
PERC_SHARE = 0.5  # a percussion hit: the drum layer makes at least half of the attack
PERC_HOP = 1024  # samples per frame of the drums / melody separation (46 ms)
FILL_GAP = 0.25  # hits closer than this form a run; a run of FILL_HITS+ ending at a bar start / section is a fill
FILL_HITS = 4
SILENCE_DB, SILENCE_MIN = -50.0, 1.0
TAIL_MIN, TAIL_DB = 0.6, 6.0  # a reverb tail: at least this long, the level falling by at least this many dB
VOCAL_ON, VOCAL_OFF, VOCAL_HOLD = 0.55, 0.3, 1.0  # vocal presence above / below, held this long
PHRASE_BARS = 4


class Event(BaseModel):
    time: float = Field(ge=0)
    event_type: EventType
    confidence: float = Field(ge=0, le=1)
    onset_strength: float = Field(ge=0, le=1)
    rms_energy: float = Field(ge=0, le=1)
    subdivision: bool = False
    end: float | None = None
    tags: list[str] = []
    details: dict[str, float] = {}


class _Signal:
    """The curves every event reads, computed once."""

    def __init__(self, y: np.ndarray, sr: int, env: np.ndarray) -> None:
        self.sr, self.env = sr, env
        S = np.abs(librosa.stft(y, n_fft=2048, hop_length=HOP)).astype(np.float32)
        freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
        # drums vs melody: the sound is split into its percussive and harmonic layers (HPSS) on a lighter spectrogram
        # (PERC_HOP), and at each hit we ask which layer attacks. Tuned, ringing drums (tabla, dhol) partly land in the
        # harmonic layer: their percussion tags are less sure, and the report says so.
        Sc = np.abs(librosa.stft(y, n_fft=1024, hop_length=PERC_HOP)).astype(np.float32)
        harm, perc = librosa.decompose.hpss(Sc, kernel_size=(17, 17))
        p_on = librosa.onset.onset_strength(S=librosa.amplitude_to_db(perc, ref=np.max), sr=sr, hop_length=PERC_HOP)
        h_on = librosa.onset.onset_strength(S=librosa.amplitude_to_db(harm, ref=np.max), sr=sr, hop_length=PERC_HOP)
        p_on, h_on = p_on / (np.percentile(p_on, 99) or 1.0), h_on / (np.percentile(h_on, 99) or 1.0)
        self.p_on, self.h_on = p_on, h_on
        del Sc, harm, perc
        low = S[freqs <= BASS_HZ]
        self.bass_env = librosa.onset.onset_strength(S=librosa.amplitude_to_db(low, ref=np.max), sr=sr, hop_length=HOP)
        self.rms = librosa.feature.rms(S=S, frame_length=2048)[0]
        self.db = librosa.amplitude_to_db(self.rms, ref=1.0)
        del S, low
        self.env_scale = float(np.percentile(env, STRENGTH_PCT)) or 1.0
        self.bass_scale = float(np.percentile(self.bass_env, STRENGTH_PCT)) or 1.0
        self.rms_scale = float(np.percentile(self.rms, 95)) or 1.0
        self.impact_level = float(np.percentile(env, IMPACT_PCT))

    def frame(self, t: float) -> int:
        return int(np.clip(librosa.time_to_frames(t, sr=self.sr, hop_length=HOP), 0, len(self.env) - 1))

    def _peak(self, curve: np.ndarray, t: float, r: int = 2) -> float:
        f = min(self.frame(t), len(curve) - 1)
        return float(curve[max(f - r, 0): f + r + 1].max())

    def onset(self, t: float) -> float:
        return float(np.clip(self._peak(self.env, t) / self.env_scale, 0.0, 1.0))

    def energy(self, t: float) -> float:
        return float(np.clip(self._peak(self.rms, t, 1) / self.rms_scale, 0.0, 1.0))

    def energy_jump(self, t: float) -> float:
        f = min(self.frame(t), len(self.rms) - 1)
        before = self.rms[max(f - 8, 0): max(f - 1, 1)].mean() if f > 1 else 0.0
        after = self.rms[f: f + 6].mean()
        return float((after - before) / self.rms_scale)

    def bass(self, t: float) -> float:
        return float(np.clip(self._peak(self.bass_env, t) / self.bass_scale, 0.0, 1.0))

    def percussive(self, t: float) -> float:
        """The drum layer's share of the attack at ``t`` (0..1)."""
        f = int(np.clip(librosa.time_to_frames(t, sr=self.sr, hop_length=PERC_HOP), 0, len(self.p_on) - 1))
        p, h = float(self.p_on[max(f - 1, 0): f + 2].max()), float(self.h_on[max(f - 1, 0): f + 2].max())
        return p / (p + h) if p + h > 0 else 0.0


def _r(x: float) -> float:
    return round(float(x), 3)


def _hit(sig: _Signal, t: float, kind: str, conf: float, tags: list[str], subdivision: bool = False, **details: float) -> Event:
    return Event(time=_r(t), event_type=kind, confidence=round(float(np.clip(conf, 0, 1)), 2), onset_strength=round(sig.onset(t), 2),  # type: ignore[arg-type]
                 rms_energy=round(sig.energy(t), 2), subdivision=subdivision, tags=tags, details={k: round(v, 3) for k, v in details.items()})


def _span(sig: _Signal, t: float, end: float | None, kind: str, conf: float, **details: float) -> Event:
    return Event(time=_r(t), end=_r(end) if end is not None else None, event_type=kind, confidence=round(float(np.clip(conf, 0, 1)), 2),  # type: ignore[arg-type]
                 onset_strength=round(sig.onset(t), 2), rms_energy=round(sig.energy(t), 2), details={k: round(v, 3) for k, v in details.items()})


def _extra_tags(sig: _Signal, t: float) -> list[str]:
    tags = []
    if sig._peak(sig.env, t) >= sig.impact_level and sig.energy_jump(t) >= IMPACT_RISE:
        tags.append("IMPACT")
    if sig.bass(t) >= BASS_SHARE:
        tags.append("BASS_HIT")
    if sig.percussive(t) >= PERC_SHARE and sig.onset(t) >= 0.25:
        tags.append("PERCUSSION_HIT")
    return tags


def hit_events(a: AudioAnalysis, sig: _Signal) -> list[Event]:
    beats = np.asarray(a.beats, dtype=float)
    down = {round(t, 3) for t in a.downbeats}
    conf = a.beat_confidences if len(a.beat_confidences) == len(beats) else [a.beat_confidence] * len(beats)
    strength = np.array([sig.onset(t) for t in beats])
    strong_hits = np.asarray(a.strong_beats)
    out: list[Event] = []
    for k, (t, c) in enumerate(zip(beats, conf)):
        around = strength[max(k - 4, 0): k + 5]
        typical = float(np.median(around)) if len(around) else 0.0
        rel = strength[k] / typical if typical > 0 else 1.0
        marked = len(strong_hits) and np.min(np.abs(strong_hits - t)) <= DEDUP and strength[k] >= 0.5  # a bar start or a loud hit
        kind = ("STRONG_BEAT" if rel >= STRONG or marked else "WEAK_BEAT" if rel <= WEAK or strength[k] < 0.15 else "MAIN_BEAT")
        tags = (["DOWNBEAT"] if round(t, 3) in down else []) + _extra_tags(sig, t)
        out.append(_hit(sig, t, kind, float(c) * (0.5 + 0.5 * a.downbeat_confidence) if "DOWNBEAT" in tags and kind != "WEAK_BEAT" else float(c),
                        tags, strength_vs_neighbours=rel))  # fmt: skip
    for t in a.onsets:  # attacks that are not a beat: a sub-beat on the grid between beats, or another kind of hit
        if len(beats) and np.min(np.abs(beats - t)) <= DEDUP:
            continue
        k = int(np.searchsorted(beats, t))
        sub = False
        if 0 < k < len(beats):
            frac = (t - beats[k - 1]) / (beats[k] - beats[k - 1])
            sub = any(abs(frac - q) * (beats[k] - beats[k - 1]) <= SUB_TOL for q in (0.25, 0.5, 0.75))
        tags = _extra_tags(sig, t)
        kind = "IMPACT" if "IMPACT" in tags else "SUB_BEAT" if sub else "BASS_HIT" if "BASS_HIT" in tags else (
            "PERCUSSION_HIT" if "PERCUSSION_HIT" in tags else "ONSET")  # fmt: skip
        tags = [x for x in tags if x != kind]
        out.append(_hit(sig, t, kind, 0.4 + 0.6 * sig.onset(t), tags, subdivision=sub, percussive_share=sig.percussive(t), bass=sig.bass(t)))
    return out


def _runs(mask: np.ndarray) -> list[tuple[int, int]]:
    runs, start = [], None
    for i, m in enumerate(np.r_[mask, False]):
        if m and start is None:
            start = i
        elif not m and start is not None:
            runs.append((start, i))
            start = None
    return runs


def stretch_events(a: AudioAnalysis, sig: _Signal) -> list[Event]:
    from app.audio.beatmap import song_trends

    fps = sig.sr / HOP
    out: list[Event] = []
    for i, j in _runs(sig.db < SILENCE_DB):
        if (j - i) / fps >= SILENCE_MIN:
            out.append(_span(sig, i / fps, j / fps, "SILENCE", 0.95, seconds=(j - i) / fps))
    # reverb tails: no new hit for a while, the level falling steadily, not yet silent
    hits = np.array(sorted(a.onsets + a.beats))
    for x, z in zip(hits, hits[1:]):
        if z - x < TAIL_MIN + 0.2:
            continue
        f0, f1 = sig.frame(x + 0.1), sig.frame(z - 0.05)
        seg = sig.db[f0:f1]
        if len(seg) < 8 or seg.min() < SILENCE_DB:
            continue
        fall = float(seg[: max(len(seg) // 5, 1)].mean() - seg[-max(len(seg) // 5, 1):].mean())
        steady = float(np.mean(np.diff(seg) <= 0.5))  # mostly decaying, few bumps
        if fall >= TAIL_DB and steady >= 0.8:
            out.append(_span(sig, x + 0.1, z - 0.05, "REVERB_TAIL", min(1.0, 0.4 + fall / 30 + 0.2 * steady), level_fall_db=fall))
    for tr in song_trends(a):
        kind = "ENERGY_RISE" if tr["kind"] == "rise" else "ENERGY_DROP"
        out.append(_span(sig, tr["start"], tr["end"], kind, min(1.0, 0.4 + abs(tr["change"])), change=tr["change"]))
    for ev in a.events:
        if ev.type in ("possible_drop", "entry"):
            out.append(_span(sig, ev.time, None, "MUSIC_DROP", ev.confidence, **ev.measurements, from_silence=float(ev.type == "entry")))
        elif ev.type == "build_up":
            out.append(_span(sig, ev.time, ev.end, "BUILD_UP", ev.confidence, **ev.measurements))
        elif ev.type == "breakdown":
            out.append(_span(sig, ev.time, ev.end, "ENERGY_DROP", ev.confidence, **ev.measurements, breakdown=1.0))
    # fills: a quick run of hits leading into a bar start or a new section
    marks = sorted(set(a.downbeats) | {s.start for s in a.song_sections if s.start > 0})
    run: list[float] = []
    for t in sorted(a.onsets) + [float("inf")]:
        if run and t - run[-1] <= FILL_GAP:
            run.append(t)
            continue
        if len(run) >= FILL_HITS and run[-1] - run[0] <= 2.5:
            nxt = next((m for m in marks if m > run[-1] - 0.05), None)
            if nxt is not None and nxt - run[-1] <= 0.35:
                out.append(_span(sig, run[0], run[-1], "FILL", 0.5 + 0.1 * min(len(run) - FILL_HITS, 4), hits=len(run), leads_into=nxt))
        run = [t] if t != float("inf") else []
    for s in a.song_sections[1:]:
        out.append(_span(sig, s.start, None, "SECTION_CHANGE", getattr(s, "confidence", 0.6) or 0.6, energy=s.energy))
    for prev, s in zip(a.tempo_sections, a.tempo_sections[1:]):
        out.append(_span(sig, s.start, None, "TEMPO_CHANGE", min(prev.confidence, s.confidence), bpm_before=prev.bpm, bpm_after=s.bpm))
    # phrase ends: the last beat before every 4th bar start (estimated from the downbeats)
    downs, beats = sorted(a.downbeats), np.asarray(a.beats)
    for k in range(PHRASE_BARS, len(downs), PHRASE_BARS):
        before = beats[beats < downs[k] - 0.01]
        if len(before):
            out.append(_span(sig, float(before[-1]), downs[k], "PHRASE_END", 0.3 + 0.6 * a.downbeat_confidence, bars=PHRASE_BARS))
    # vocals (an estimate): presence rising above VOCAL_ON for a while, or falling away inside a sung part
    if a.vocal:
        v, hop = np.asarray(a.vocal), a.curve_hop
        hold = max(int(VOCAL_HOLD / hop), 1)
        singing = False
        for i in range(len(v)):
            ahead = v[i: i + hold]
            if not singing and len(ahead) == hold and ahead.min() >= VOCAL_ON:
                out.append(_span(sig, i * hop, None, "VOCAL_ENTRY", 0.35 + 0.4 * float(ahead.mean()), presence=float(ahead.mean())))
                singing = True
            elif singing and len(ahead) == hold and ahead.max() <= VOCAL_OFF:
                back = next((k for k in range(i + hold, len(v)) if v[k] >= VOCAL_ON), None)
                out.append(_span(sig, i * hop, back * hop if back is not None else None, "VOCAL_PAUSE", 0.35 + 0.4 * (1 - float(ahead.mean())),
                                 presence=float(ahead.mean())))  # fmt: skip
                singing = False
    return out


def song_events(a: AudioAnalysis, y: np.ndarray, sr: int, env: np.ndarray) -> list[Event]:
    """All the events, in time order (at the same moment: beats first, then the hits, then the stretches)."""
    sig = _Signal(y, sr, env)
    events = [e for e in hit_events(a, sig) + stretch_events(a, sig) if e.time <= a.duration + 0.05]
    order = {k: i for i, k in enumerate(HIT_TYPES)}
    return sorted(events, key=lambda e: (e.time, order.get(e.event_type, 99)))


def summary(events: list[Event]) -> dict[str, Any]:
    counts: dict[str, int] = {}
    for e in events:
        counts[e.event_type] = counts.get(e.event_type, 0) + 1
    return counts
