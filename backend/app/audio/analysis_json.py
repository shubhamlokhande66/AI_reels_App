"""The song analysis as one JSON document: what librosa measured, nothing decided yet.

    {"status", "audio", "analysis_config", "tempo", "beats", "onsets", "frame_features", "events",
     "silence_regions", "candidate_changes", "errors"}

- ``beats``: every tracked beat (``beat_index`` from 1) with its strength (onset strength, 0..1)
- ``onsets``: every attack librosa detected, with its strength
- ``frame_features``: per analysis frame (``hop_length`` samples): RMS, spectral centroid / bandwidth / rolloff (Hz),
  zero-crossing rate, onset strength
- ``events``: the editor's vocabulary (audio/events.py: STRONG_BEAT, SUB_BEAT, IMPACT, MUSIC_DROP, BUILD_UP ...) plus
  ``ROLL`` (a fast run of hits, 0.10-0.25 s apart). A moment has ``time_sec``; a stretch has ``start_sec`` / ``end_sec``.
  ``source`` names the method behind it
- ``silence_regions``, ``candidate_changes`` (section and tempo changes: estimates, with confidence)
- ``status`` / ``errors``: "completed", or "failed" with the reason (unreadable file, no audio, silence...)

This is the input for the next step (an AI choosing transitions and effects); it contains no editing decisions.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

import librosa
import numpy as np
from pydantic import BaseModel

from app.audio.analyzer import SR, analyze_audio, load_audio
from app.audio.beat_detector import HOP, onset_envelope

FRAME_LENGTH = 2048
MAX_SECONDS = 3600
ROLL_GAP = (0.10, 0.25)  # hits this far apart, at least ROLL_HITS of them, are a roll
ROLL_HITS = 3
CHANGE_TYPES = ("SECTION_CHANGE", "TEMPO_CHANGE")

# which method found each kind of event
SOURCE = {
    "MAIN_BEAT": "librosa_beat_track", "STRONG_BEAT": "librosa_beat_track", "WEAK_BEAT": "librosa_beat_track",
    "SUB_BEAT": "librosa_onset_detect", "ONSET": "librosa_onset_detect", "IMPACT": "librosa_onset_detect",
    "PERCUSSION_HIT": "librosa_hpss", "BASS_HIT": "low_band_onset", "SILENCE": "rms_threshold",
    "REVERB_TAIL": "rms_decay", "MUSIC_DROP": "multi_feature_change", "BUILD_UP": "multi_feature_change",
    "ENERGY_RISE": "energy_trend", "ENERGY_DROP": "energy_trend", "FILL": "onset_run", "ROLL": "onset_run",
    "PHRASE_END": "downbeat_estimate", "VOCAL_ENTRY": "vocal_heuristic", "VOCAL_PAUSE": "vocal_heuristic",
    "SECTION_CHANGE": "mfcc_segmentation", "TEMPO_CHANGE": "local_tempogram",
}  # fmt: skip


class Out(BaseModel):
    """The document's shape (validated before it is returned)."""

    status: Literal["completed", "failed"]
    audio: dict[str, Any]
    analysis_config: dict[str, Any]
    tempo: dict[str, Any]
    beats: list[dict[str, Any]]
    onsets: list[dict[str, Any]]
    frame_features: list[dict[str, Any]]
    events: list[dict[str, Any]]
    silence_regions: list[dict[str, Any]]
    candidate_changes: list[dict[str, Any]]
    errors: list[str]
    energy: dict[str, Any] = {}  # {"hop_sec", "values"}: RMS energy 0..1 (for the video schema's energy_curve)
    song_sections: list[dict[str, Any]] = []  # the labelled parts: intro, build, drop, chorus, verse, bridge, outro


def _r(x: float | None, nd: int = 3) -> float | None:
    return None if x is None else round(float(x), nd)


def _failed(message: str, duration: float = 0.0) -> dict[str, Any]:
    return Out(status="failed", audio={"duration_sec": _r(duration, 2), "sample_rate": SR, "channels_analyzed": 1},
               analysis_config={"hop_length": HOP, "frame_length": FRAME_LENGTH}, tempo={"bpm": None, "beat_interval_sec": None},
               beats=[], onsets=[], frame_features=[], events=[], silence_regions=[], candidate_changes=[], errors=[message]).model_dump()  # fmt: skip


def frame_features(y: np.ndarray, sr: int, env: np.ndarray, step: int = 1) -> list[dict[str, Any]]:
    """One row per analysis frame (every ``step`` frames)."""
    S = np.abs(librosa.stft(y, n_fft=FRAME_LENGTH, hop_length=HOP)).astype(np.float32)
    n = min(S.shape[1], len(env))
    rms = librosa.feature.rms(S=S, frame_length=FRAME_LENGTH)[0]
    centroid = librosa.feature.spectral_centroid(S=S, sr=sr)[0]
    bandwidth = librosa.feature.spectral_bandwidth(S=S, sr=sr)[0]
    rolloff = librosa.feature.spectral_rolloff(S=S, sr=sr, roll_percent=0.85)[0]
    zcr = librosa.feature.zero_crossing_rate(y, frame_length=FRAME_LENGTH, hop_length=HOP)[0]
    scale = float(np.percentile(env, 99)) or 1.0
    times = librosa.frames_to_time(np.arange(n), sr=sr, hop_length=HOP)
    return [{"time_sec": _r(times[i]), "rms": _r(rms[i], 4), "spectral_centroid_hz": _r(centroid[i], 1), "spectral_bandwidth_hz": _r(bandwidth[i], 1),
             "spectral_rolloff_hz": _r(rolloff[i], 1), "zero_crossing_rate": _r(zcr[min(i, len(zcr) - 1)], 4),
             "onset_strength": _r(min(env[i] / scale, 1.0), 3)} for i in range(0, n, step)]  # fmt: skip


def _rolls(onsets: list[float], strength) -> list[dict[str, Any]]:
    out, run = [], []
    for t in sorted(onsets) + [float("inf")]:
        if run and ROLL_GAP[0] <= t - run[-1] <= ROLL_GAP[1]:
            run.append(t)
            continue
        if len(run) >= ROLL_HITS:
            out.append({"type": "ROLL", "time_sec": None, "start_sec": _r(run[0]), "end_sec": _r(run[-1]),
                        "strength": _r(float(np.mean([strength(x) for x in run])), 2), "confidence": 0.8, "source": SOURCE["ROLL"],
                        "rms_energy": None, "subdivision": False, "tags": [],
                        "details": {"hits": len(run), "hits_per_second": round(len(run) / max(run[-1] - run[0], 0.1), 1)}})  # fmt: skip
        run = [t] if t != float("inf") else []
    return out


def analyze_to_json(file_path: str | Path, frame_step: int = 1) -> dict[str, Any]:
    """The analysis document for a song file. Never raises for a bad file: ``status`` is "failed" with the reason.
    ``frame_step``: keep every n-th frame in ``frame_features`` (1 = every frame, ~43 rows per second)."""
    from app.audio.events import song_events
    from app.core.errors import AppError
    from app.core.ffmpeg import probe

    path = Path(file_path)
    try:
        info = probe(path)
        if not any(s.get("codec_type") == "audio" for s in info.get("streams", [])):
            return _failed("The file has no audio track.")
        a = analyze_audio(path, max_seconds=MAX_SECONDS)
        y, sr = load_audio(path, MAX_SECONDS)
    except AppError as exc:
        return _failed(exc.message)
    errors: list[str] = []
    original = float(info.get("format", {}).get("duration") or a.duration)
    if original > a.duration + 1.0:
        errors.append(f"Only the first {a.duration:.0f} s of {original:.0f} s were analysed.")

    env = onset_envelope(y, sr)
    scale = float(np.percentile(env, 99)) or 1.0

    def strength(t: float) -> float:
        f = int(np.clip(librosa.time_to_frames(t, sr=sr, hop_length=HOP), 0, len(env) - 1))
        return float(min(env[max(f - 2, 0): f + 3].max() / scale, 1.0))

    confs = a.beat_confidences if len(a.beat_confidences) == len(a.beats) else [a.beat_confidence] * len(a.beats)
    beats = [{"time_sec": _r(t), "beat_index": i + 1, "strength": _r(strength(t), 2), "confidence": _r(c, 2)}
             for i, (t, c) in enumerate(zip(a.beats, confs))]  # fmt: skip
    onsets = [{"time_sec": _r(t), "strength": _r(strength(t), 2)} for t in a.onsets]

    events, changes, silences = [], [], []
    for e in song_events(a, y, sr, env):
        span = e.end is not None
        row = {"type": e.event_type, "time_sec": None if span else _r(e.time), "start_sec": _r(e.time) if span else None,
               "end_sec": _r(e.end) if span else None, "strength": _r(e.onset_strength, 2), "confidence": _r(e.confidence, 2),
               "source": SOURCE.get(e.event_type, "custom_classifier"), "rms_energy": _r(e.rms_energy, 2),
               "subdivision": e.subdivision, "tags": e.tags, "details": e.details}  # fmt: skip
        if e.event_type == "SILENCE":
            silences.append({"start_sec": _r(e.time), "end_sec": _r(e.end), "duration_sec": _r((e.end or e.time) - e.time)})
        if e.event_type in CHANGE_TYPES:
            changes.append(row)
        else:
            events.append(row)
    events += _rolls(a.onsets, strength)
    events.sort(key=lambda r: (r["time_sec"] if r["time_sec"] is not None else r["start_sec"]))

    sections = a.tempo_sections
    return Out(
        status="completed",
        audio={"duration_sec": _r(original, 2), "analysed_sec": _r(a.duration, 2), "sample_rate": sr, "channels_analyzed": 1},
        analysis_config={"hop_length": HOP, "frame_length": FRAME_LENGTH, "frame_step": frame_step, "frame_sec": _r(HOP / sr, 5)},
        tempo={"bpm": _r(a.bpm, 1), "beat_interval_sec": _r(60.0 / a.bpm, 5) if a.bpm else None, "confidence": _r(a.beat_confidence, 2),
               "sections": [{"start_sec": _r(s.start), "end_sec": _r(s.end), "bpm": s.bpm, "confidence": s.confidence} for s in sections],
               "downbeat_confidence": _r(a.downbeat_confidence, 2)},
        beats=beats, onsets=onsets, frame_features=frame_features(y, sr, env, frame_step), events=events,
        silence_regions=silences, candidate_changes=changes, errors=errors,
        energy={"hop_sec": a.energy_hop, "values": [round(float(v), 3) for v in a.energy]},
        song_sections=[{"label": x.label, "start_sec": _r(x.start), "end_sec": _r(x.end), "energy": _r(x.energy, 3),
                        "confidence": _r(getattr(x, "confidence", 0.5), 2)} for x in a.song_sections],
    ).model_dump()  # fmt: skip


# ---------------------------------------------------------------------- the agreed shape, exactly
EVENT_KEYS = ("type", "time_sec", "start_sec", "end_sec", "strength", "confidence", "source")


def agreed_shape(doc: dict[str, Any], frames: bool = False, onsets: bool = False) -> dict[str, Any]:
    """The document with exactly the agreed keys (and in their order). The full document keeps more (tempo sections,
    tags, rms per event...): the editing step reads those; the API answers in the agreed shape. ``frame_features``
    (~90% of the size, raw measurements no editing step uses) and ``onsets`` (the useful ones are already events)
    are empty lists unless asked for."""
    a, cfg, tempo = doc["audio"], doc["analysis_config"], doc["tempo"]

    def event(e: dict[str, Any]) -> dict[str, Any]:
        return {k: e.get(k) for k in EVENT_KEYS}

    return {
        "status": doc["status"],
        "audio": {"duration_sec": a.get("duration_sec"), "sample_rate": a.get("sample_rate"), "channels_analyzed": a.get("channels_analyzed")},
        "analysis_config": {"hop_length": cfg.get("hop_length"), "frame_length": cfg.get("frame_length")},
        "tempo": {"bpm": tempo.get("bpm"), "beat_interval_sec": tempo.get("beat_interval_sec")},
        "beats": [{"time_sec": b["time_sec"], "beat_index": b["beat_index"], "strength": b["strength"]} for b in doc["beats"]],
        "onsets": [{"time_sec": o["time_sec"], "strength": o["strength"]} for o in doc["onsets"]] if onsets else [],
        "frame_features": [{k: f.get(k) for k in ("time_sec", "rms", "spectral_centroid_hz", "spectral_bandwidth_hz", "spectral_rolloff_hz",
                                                   "zero_crossing_rate", "onset_strength")} for f in doc["frame_features"]] if frames else [],
        "events": [event(e) for e in doc["events"]],
        "silence_regions": [{"start_sec": r["start_sec"], "end_sec": r["end_sec"], "duration_sec": r["duration_sec"]} for r in doc["silence_regions"]],
        "candidate_changes": [event(c) for c in doc["candidate_changes"]],
        "errors": list(doc["errors"]),
    }  # fmt: skip


# ---------------------------------------------------------------------- schema 1.0: what video editing needs
SCHEMA_VERSION = "1.0"
ENERGY_STEP = 0.25  # seconds per energy_curve value
VIDEO_EVENTS = ("MUSIC_DROP", "BUILD_UP", "ROLL", "FILL", "IMPACT", "STRONG_BEAT", "ENERGY_RISE", "ENERGY_DROP", "VOCAL_ENTRY",
                "VOCAL_PAUSE", "SILENCE", "TEMPO_CHANGE", "PHRASE_END", "REVERB_TAIL")  # fmt: skip
HIGH, LOW = 0.65, 0.35  # section energy above / below: HIGH_ENERGY / LOW_ENERGY


def _energy_curve(energy: dict[str, Any], duration: float) -> list[float]:
    hop, values = float(energy.get("hop_sec") or 0.1), energy.get("values") or []
    if not values:
        return []
    per = max(int(round(ENERGY_STEP / hop)), 1)
    n = int(np.ceil(min(duration, len(values) * hop) / ENERGY_STEP))
    return [round(float(np.mean(values[k * per: (k + 1) * per] or [values[-1]])), 3) for k in range(n)]


def video_shape(doc: dict[str, Any], onsets: bool = False) -> dict[str, Any]:
    """Schema 1.0: the song as video editing needs it, small. Beats (with the bar start marked), an energy curve
    every 0.25 s, labelled sections with their energy level, and the candidate events that call for an effect or a
    change of pace (moments have ``time_sec``, stretches ``start_sec`` / ``end_sec``), each with its confidence."""
    tempo = doc["tempo"]
    bpm = tempo.get("bpm")
    downs = {e["time_sec"] for e in doc["events"] if "DOWNBEAT" in (e.get("tags") or []) and e["time_sec"] is not None}
    beats, pos = [], None
    for b in doc["beats"]:
        down = b["time_sec"] in downs
        pos = 1 if down else (pos + 1 if pos is not None else None)
        beats.append({"time_sec": b["time_sec"], "strength": b["strength"], "confidence": b.get("confidence"), "downbeat": down, "beat_in_bar": pos})
    events = []
    for e in [*doc["events"], *doc["candidate_changes"]]:
        if e["type"] in VIDEO_EVENTS:
            events.append({"type": e["type"], "time_sec": e["time_sec"], "start_sec": e["start_sec"], "end_sec": e["end_sec"],
                           "strength": e["strength"], "confidence": e["confidence"]})  # fmt: skip
    fills = {(e["start_sec"], e["end_sec"]) for e in events if e["type"] == "FILL"}
    events = [e for e in events if not (e["type"] == "ROLL" and (e["start_sec"], e["end_sec"]) in fills)]  # a fill is that roll
    events.sort(key=lambda e: e["time_sec"] if e["time_sec"] is not None else e["start_sec"])
    sections = [{"type": x["label"].upper(), "start_sec": x["start_sec"], "end_sec": x["end_sec"],
                 "energy_level": "HIGH_ENERGY" if x["energy"] >= HIGH else "LOW_ENERGY" if x["energy"] <= LOW else "MEDIUM_ENERGY",
                 "energy": x["energy"], "confidence": x["confidence"]} for x in doc.get("song_sections", [])]  # fmt: skip
    duration = doc["audio"].get("analysed_sec") or doc["audio"].get("duration_sec") or 0.0
    return {
        "schema_version": SCHEMA_VERSION,
        "status": doc["status"],
        "audio": {"duration_sec": doc["audio"].get("duration_sec"), "sample_rate": doc["audio"].get("sample_rate"),
                  "channels_analyzed": doc["audio"].get("channels_analyzed")},
        "tempo": {"bpm": bpm, "alternative_bpm": (round(bpm / 2, 1) if bpm >= 100 else round(bpm * 2, 1)) if bpm else None,
                  "beat_interval_sec": tempo.get("beat_interval_sec"), "confidence": tempo.get("confidence"),
                  "sections": [{"start_sec": x["start_sec"], "end_sec": x["end_sec"], "bpm": x["bpm"], "confidence": x["confidence"]}
                               for x in tempo.get("sections", [])]},
        "beats": beats,
        "onsets": [{"time_sec": o["time_sec"], "strength": o["strength"]} for o in doc["onsets"]] if onsets else [],
        "energy_curve": {"sample_interval_sec": ENERGY_STEP, "values": _energy_curve(doc.get("energy") or {}, duration)},
        "sections": sections,
        "candidate_events": events,
        "errors": list(doc["errors"]),
    }  # fmt: skip
