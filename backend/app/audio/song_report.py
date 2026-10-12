"""The song report: everything measured in a song, and separately, how to edit a Reel to it.

``analyze_song(path)`` returns the report as validated JSON-ready data:

- **audio**: the original duration (all of it is analysed, up to MAX_SECONDS), the analysis sample rate
- **tempo**: the global BPM and the tempo section by section (it may change), with confidence
- **events**: what was *detected* in the audio, in the editor's vocabulary (audio/events.py): ``MAIN_BEAT``,
  ``STRONG_BEAT``, ``WEAK_BEAT``, ``SUB_BEAT``, ``ONSET``, ``PERCUSSION_HIT``, ``BASS_HIT``, ``IMPACT``, ``SILENCE``,
  ``ENERGY_RISE``, ``ENERGY_DROP``, ``MUSIC_DROP``, ``BUILD_UP``, ``FILL``, ``SECTION_CHANGE``, ``TEMPO_CHANGE``,
  ``PHRASE_END``, ``REVERB_TAIL``, ``VOCAL_ENTRY``, ``VOCAL_PAUSE`` - each with its time (ms), ``onset_strength``,
  ``rms_energy``, ``subdivision``, ``confidence`` and ``tags`` (one event per moment: no duplicate timestamps)
- **rhythm**: fast sequences (hits 0.10-0.25 s apart) and gaps (long stretches between beats with nothing hitting)
- **sections**: the song's parts with their measurements (energy, flux, brightness, contrast, zero-crossing rate,
  bandwidth, rhythmic density)
- **patterns**: bars whose rhythm repeats
- **editing_segments** and **recommendations**: the *advice* (``editing_segments(report_or_analysis, min_clip)``), kept
  apart from what was detected: cut points, clip durations, fast cuts in busy parts, long clips in calm ones,
  transitions, speed ramps, slow-motion stretches, hook and text moments - never a cut shorter than ``min_clip``
- **analysis**: counts and warnings (truncated, weak or irregular rhythm, silence, a tempo change...)

Speed vs accuracy: the analysis runs on mono 22.05 kHz audio with a 512-sample hop (23 ms per frame): beat times are
accurate to about one frame. Tempo changes cost two extra tracking passes, only when the song really changes tempo.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

import librosa
import numpy as np
from pydantic import BaseModel, Field, model_validator

from app.audio.analyzer import SR, analyze_audio, load_audio
from app.audio.beat_detector import HOP, onset_envelope
from app.audio.events import Event, song_events, summary
from app.models.analysis import AudioAnalysis

MAX_SECONDS = 3600  # a song report reads up to an hour (the Reel editor itself reads the first 10 minutes)
DEDUP = 0.05  # an onset this close to a beat is that beat
FAST = (0.10, 0.25)  # hits this far apart form a fast sequence ...
FAST_MIN_HITS = 3  # ... of at least this many hits
GAP_FACTOR = 1.75  # a stretch between beats this many beat lengths long, with no hit inside, is a pause
SILENCE_DB = -50.0
SILENCE_MIN = 1.0
PATTERN_SIMILAR = 0.9  # bars whose 16-step rhythm correlates this well are the same pattern
CALM_SECONDS = 3.0  # a calm stretch this long suits slow motion

SegmentStyle = Literal["normal_cut", "fast_cut", "long_clip"]  # the clip's pace; its way in is the transition


# ---------------------------------------------------------------------- the validated report
class AudioInfo(BaseModel):
    duration_seconds: float = Field(ge=0)
    analysed_seconds: float = Field(ge=0)
    sample_rate: int


class TempoSectionOut(BaseModel):
    start: float
    end: float
    estimated_bpm: float = Field(gt=0)
    confidence: float = Field(ge=0, le=1)


class Tempo(BaseModel):
    global_bpm: float = Field(gt=0)
    changes: bool
    sections: list[TempoSectionOut]


class RhythmRun(BaseModel):
    start: float
    end: float
    kind: Literal["fast_sequence", "gap"]
    details: dict[str, float] = {}


class SectionOut(BaseModel):
    start: float
    end: float
    label: str
    measurements: dict[str, float]


class Pattern(BaseModel):
    id: int
    bars: list[float]  # the start of each bar with this rhythm
    bar_seconds: float


class Segment(BaseModel):
    start: float
    end: float
    duration: float = Field(gt=0)
    style: SegmentStyle
    transition: str = "cut"
    effect: str = "none"
    reason: str


class Recommendation(BaseModel):
    start: float
    end: float
    type: Literal["slow_motion", "speed_ramp", "hook", "text_overlay", "fast_cuts"]
    reason: str


class Summary(BaseModel):
    beat_count: int
    strong_beat_count: int
    onset_count: int
    possible_drop_count: int
    fast_sequence_count: int
    event_counts: dict[str, int]
    pattern_count: int
    min_clip_seconds: float
    warnings: list[str]


class SongReport(BaseModel):
    audio: AudioInfo
    tempo: Tempo
    events: list[Event]
    rhythm: list[RhythmRun]
    sections: list[SectionOut]
    patterns: list[Pattern]
    editing_segments: list[Segment]
    recommendations: list[Recommendation]
    analysis: Summary

    @model_validator(mode="after")
    def _times(self) -> SongReport:
        end = self.audio.analysed_seconds + 0.05
        times = [e.time for e in self.events]
        if times != sorted(times):
            raise ValueError("events are not in time order")
        if any(t > end for t in times):
            raise ValueError("an event lies after the end of the song")
        for a, b in zip(self.editing_segments, self.editing_segments[1:]):
            if b.start < a.end - 1e-3:
                raise ValueError("editing segments overlap")
        return self


def _ms(t: float) -> float:
    return round(float(t), 3)


# ---------------------------------------------------------------------- measurements per stretch of the song
def _features(y: np.ndarray, sr: int) -> dict[str, tuple[np.ndarray, float]]:
    """Per-frame feature curves and their frame duration."""
    hop = HOP * 2
    S = np.abs(librosa.stft(y, n_fft=2048, hop_length=hop))
    dt = hop / sr
    return {
        "rms": (librosa.feature.rms(S=S, frame_length=2048)[0], dt),
        "spectral_centroid_hz": (librosa.feature.spectral_centroid(S=S, sr=sr)[0], dt),
        "spectral_bandwidth_hz": (librosa.feature.spectral_bandwidth(S=S, sr=sr)[0], dt),
        "spectral_contrast_db": (librosa.feature.spectral_contrast(S=S, sr=sr).mean(axis=0), dt),
        "zero_crossing_rate": (librosa.feature.zero_crossing_rate(y, frame_length=2048, hop_length=hop)[0], dt),
    }


def _mean(curve: np.ndarray, dt: float, a: float, b: float) -> float:
    i, j = int(a / dt), max(int(b / dt), int(a / dt) + 1)
    seg = curve[i:j]
    return float(seg.mean()) if len(seg) else 0.0


def _silences(y: np.ndarray, sr: int) -> list[tuple[float, float]]:
    hop = int(sr * 0.05)
    db = librosa.amplitude_to_db(librosa.feature.rms(y=y, frame_length=hop * 2, hop_length=hop)[0], ref=1.0)
    quiet = db < SILENCE_DB
    out, start = [], None
    for i, q in enumerate(np.r_[quiet, False]):
        if q and start is None:
            start = i
        elif not q and start is not None:
            if (i - start) * 0.05 >= SILENCE_MIN:
                out.append((start * 0.05, i * 0.05))
            start = None
    return out


def _fast_sequences(onsets: list[float]) -> list[tuple[float, float, int]]:
    """Runs of hits FAST[0]..FAST[1] s apart: (start, end, hits)."""
    out, run = [], []
    for t in onsets + [float("inf")]:
        if run and FAST[0] <= t - run[-1] <= FAST[1]:
            run.append(t)
            continue
        if len(run) >= FAST_MIN_HITS:
            out.append((run[0], run[-1], len(run)))
        run = [t] if t != float("inf") else []
    return out


def _patterns(a: AudioAnalysis, env: np.ndarray, sr: int) -> list[Pattern]:
    """Bars (from the estimated downbeats) whose 16-step onset pattern repeats at least 3 times."""
    starts = [d for d in a.downbeats if d < a.duration]
    if len(starts) < 4:
        return []
    vecs, bars = [], []
    for s, e in zip(starts, starts[1:]):
        steps = np.linspace(s, e, 17)[:-1]
        f = np.clip(librosa.time_to_frames(steps, sr=sr, hop_length=HOP), 0, len(env) - 1)
        v = np.array([env[max(i - 1, 0): i + 2].max() for i in f])
        if v.max() > 0:
            vecs.append((v - v.mean()) / (np.linalg.norm(v - v.mean()) + 1e-9))
            bars.append(s)
    groups: list[list[int]] = []
    for i, v in enumerate(vecs):
        for g in groups:
            if float(np.dot(vecs[g[0]], v)) >= PATTERN_SIMILAR:
                g.append(i)
                break
        else:
            groups.append([i])
    bar_len = float(np.median(np.diff(starts))) if len(starts) > 1 else 0.0
    keep = [g for g in groups if len(g) >= 3]
    return [Pattern(id=k + 1, bars=[_ms(bars[i]) for i in g], bar_seconds=round(bar_len, 3)) for k, g in enumerate(keep)]


# ---------------------------------------------------------------------- rhythm runs
def rhythm_runs(a: AudioAnalysis) -> list[RhythmRun]:
    """Fast sequences of hits, and gaps: stretches between beats much longer than the beat with nothing hitting."""
    out = [RhythmRun(start=_ms(s), end=_ms(e), kind="fast_sequence", details={"hits": n, "hits_per_second": round(n / max(e - s, 0.1), 1)})
           for s, e, n in _fast_sequences(a.onsets)]  # fmt: skip
    beats, hits = np.asarray(a.beats), np.asarray(a.onsets)
    for sec in a.tempo_sections:
        period = 60.0 / sec.bpm
        inside = beats[(beats >= sec.start) & (beats < sec.end)]
        for x, z in zip(inside, inside[1:]):
            between = hits[(hits > x + DEDUP) & (hits < z - DEDUP)] if len(hits) else hits
            if z - x >= GAP_FACTOR * period and len(between) == 0:
                out.append(RhythmRun(start=_ms(x), end=_ms(z), kind="gap", details={"seconds": round(float(z - x), 3), "beats_long": round(float((z - x) / period), 2)}))
    return sorted(out, key=lambda r: r.start)


# ---------------------------------------------------------------------- editing advice (kept apart from detection)
def editing_segments(a: AudioAnalysis, min_clip: float = 0.4, start: float = 0.0, end: float | None = None,
                     every_beat: bool = False) -> tuple[list[Segment], list[Recommendation]]:  # fmt: skip
    """Practical cut points for a Reel from ``start`` to ``end``: no clip shorter than ``min_clip`` (fast beats are
    grouped into one clip that pulses on them), quick cuts in busy parts, longer clips in calm ones. Built on the
    same plan the Reel editor follows (audio/beatmap.cut_plan)."""
    from app.audio.beatmap import cut_plan

    end = a.duration if end is None else min(end, a.duration)
    rows = cut_plan(a, start=start, end=end, every_beat=every_beat, min_shot=min_clip)
    shots = [r for r in rows if r["kind"] == "cut"]
    segs: list[Segment] = []
    for r in shots:
        dur = round(r["end"] - r["t"], 3)
        if dur <= 0:
            continue
        tr = r.get("transition") or "cut"
        busy = a.curve_at("density", r["t"]) >= 0.6 or "build" in r.get("why", "") or "faster" in r.get("shot", "").lower()
        style: SegmentStyle = "fast_cut" if dur < 0.6 and busy else "long_clip" if dur >= 1.5 else "normal_cut"
        reason = r.get("why", "")
        segs.append(Segment(start=_ms(r["t"]), end=_ms(r["end"]), duration=dur, style=style, transition=tr, effect=r.get("effect", "none"),
                            reason=reason[:1].upper() + reason[1:] if reason else "Suitable rhythmic interval"))  # fmt: skip
    recs: list[Recommendation] = []
    for r in rows:
        if r["kind"] == "ramp":
            recs.append(Recommendation(start=_ms(r["t"]), end=_ms(next((s["t"] for s in shots if s["t"] > r["t"]), r["t"])), type="speed_ramp",
                                       reason=r.get("why", "a hard hit just before the cut")))  # fmt: skip
    # calm stretches (low energy and few hits) suit slow motion; busy ones fast cuts
    hop, t = a.curve_hop, start
    calm_from = None
    while t <= end:
        calm = a.energy_at(t) < 0.45 and a.curve_at("density", t) < 0.35
        if calm and calm_from is None:
            calm_from = t
        if (not calm or t + hop > end) and calm_from is not None:
            if t - calm_from >= CALM_SECONDS:
                recs.append(Recommendation(start=_ms(calm_from), end=_ms(t), type="slow_motion", reason="calm music: low energy and few hits"))
            calm_from = None
        t += hop
    for ev in a.events:
        if ev.type == "build_up" and ev.end and start <= ev.time < end:
            recs.append(Recommendation(start=_ms(ev.time), end=_ms(min(ev.end, end)), type="fast_cuts", reason="the music builds up into a drop"))
    first_hit = next((d for d in sorted(a.drops) if start <= d <= start + 3.0), None) or next((b for b in a.strong_beats if b >= start), start)
    recs.append(Recommendation(start=_ms(start), end=_ms(min(first_hit + 0.5, end)), type="hook", reason="the opening: show the hook before the first big hit"))
    for s in a.song_sections:  # text reads best where the music is calmer and has room (not on a drop)
        if s.end > start and s.start < end and s.label in ("intro", "verse", "bridge", "outro") and s.end - s.start >= 2.0:
            recs.append(Recommendation(start=_ms(max(s.start, start)), end=_ms(min(s.end, end)), type="text_overlay", reason=f"a calmer part ({s.label})"))
    return segs, sorted(recs, key=lambda r: r.start)


# ---------------------------------------------------------------------- the report
def analyze_song(file_path: str | Path, min_clip: float = 0.4, every_beat: bool = False,
                 analysis: AudioAnalysis | None = None) -> dict[str, Any]:  # fmt: skip
    """Analyse a song file and return the validated report (a dict ready for JSON). Raises ``CorruptedMedia`` for a
    file that is not audio, silent or under one second. ``analysis``: the song's saved analysis, when there is one
    (the app's: its first 10 minutes), so the beats are not tracked twice."""
    from app.core.ffmpeg import probe

    path = Path(file_path)
    info = probe(path)
    original = float(info.get("format", {}).get("duration") or 0.0)
    if not any(s.get("codec_type") == "audio" for s in info.get("streams", [])):
        from app.core.errors import CorruptedMedia

        raise CorruptedMedia("The file has no audio track.", code="NO_AUDIO_STREAM")
    a = analysis or analyze_audio(path, max_seconds=MAX_SECONDS)
    y, sr = load_audio(path, int(np.ceil(a.duration)) if analysis else MAX_SECONDS)
    env = onset_envelope(y, sr)
    feats = _features(y, sr)

    warnings: list[str] = []
    if original and original > a.duration + 1.0:
        warnings.append(f"Only the first {a.duration:.0f} s of {original:.0f} s were analysed.")
    if a.beat_confidence < 0.5:
        warnings.append("The beat is irregular or weak: beat times are less reliable.")
    if len(a.onsets) < a.duration * 0.5:
        warnings.append("Little percussion: few attacks were found, so cuts follow the beat estimate.")
    if a.downbeat_confidence < 0.3:
        warnings.append("Bar starts (downbeats) are uncertain: treat downbeats as estimates.")
    changes = len({round(s.bpm) for s in a.tempo_sections}) > 1
    if changes:
        warnings.append("The tempo changes: " + ", ".join(f"{s.bpm:g} BPM from {s.start:.1f} s" for s in a.tempo_sections) + ".")
    silences = _silences(y, sr)
    if silences:
        warnings.append(f"{len(silences)} silent stretch(es) of a second or more.")

    sections = []
    for s in a.song_sections or []:
        m = {k: round(_mean(c, dt, s.start, s.end), 4) for k, (c, dt) in feats.items()}
        m["onset_strength"] = round(_mean(env, HOP / sr, s.start, s.end), 4)
        m["onsets_per_second"] = round(sum(1 for t in a.onsets if s.start <= t < s.end) / max(s.end - s.start, 1e-6), 2)
        m["energy"] = round(s.energy, 3)
        sections.append(SectionOut(start=_ms(s.start), end=_ms(s.end), label=s.label, measurements=m))

    events = song_events(a, y, sr, env)
    runs = rhythm_runs(a)
    counts = summary(events)
    segs, recs = editing_segments(a, min_clip=min_clip, every_beat=every_beat)
    patterns = _patterns(a, env, sr)
    report = SongReport(
        audio=AudioInfo(duration_seconds=round(original or a.duration, 3), analysed_seconds=round(a.duration, 3), sample_rate=SR),
        tempo=Tempo(global_bpm=round(a.bpm, 2), changes=changes,
                    sections=[TempoSectionOut(start=_ms(s.start), end=_ms(s.end), estimated_bpm=s.bpm, confidence=s.confidence) for s in a.tempo_sections]),
        events=events, rhythm=runs, sections=sections, patterns=patterns, editing_segments=segs, recommendations=recs,
        analysis=Summary(beat_count=len(a.beats), strong_beat_count=counts.get("STRONG_BEAT", 0), onset_count=len(a.onsets),
                         possible_drop_count=counts.get("MUSIC_DROP", 0), event_counts=counts,
                         fast_sequence_count=sum(1 for r in runs if r.kind == "fast_sequence"), pattern_count=len(patterns),
                         min_clip_seconds=min_clip, warnings=warnings),
    )  # fmt: skip
    return report.model_dump(exclude_none=True)
