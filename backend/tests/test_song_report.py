"""The song report (audio/song_report.py) on synthetic songs whose true beats, tempo and drops are known."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from app.audio.song_report import SongReport, analyze_song

SR = 22050


def _click(freq: float = 90.0, length: float = 0.06) -> np.ndarray:
    t = np.arange(int(length * SR)) / SR
    return np.sin(2 * np.pi * freq * t) * np.exp(-t * 45)


def _song(path: Path, parts: list[dict]) -> Path:
    """Parts in order: {"seconds", "bpm" (None = silence), "gain", "bass" (a low drone), "sub" (hits per beat)}."""
    out = []
    for p in parts:
        seg = np.zeros(int(p["seconds"] * SR))
        if p.get("bpm"):
            step = 60.0 / p["bpm"] / p.get("sub", 1)
            k = 0
            while (i := int(k * step * SR)) + 1400 < len(seg):
                accent = 1.0 if k % (4 * p.get("sub", 1)) == 0 else 0.7 if k % p.get("sub", 1) == 0 else 0.35
                seg[i: i + 1323] += p.get("gain", 1.0) * accent * _click()
                k += 1
        if p.get("bass"):
            t = np.arange(len(seg)) / SR
            seg += p["bass"] * np.sin(2 * np.pi * 55 * t)
        out.append(seg)
    y = np.concatenate(out)
    y += 0.003 * np.random.default_rng(1).standard_normal(len(y))
    sf.write(path, (y / max(1.0, np.abs(y).max())).astype(np.float32), SR)
    return path


def test_timestamps_are_ordered_millisecond_and_on_the_beat(tmp_path):
    r = analyze_song(_song(tmp_path / "s.wav", [{"seconds": 20, "bpm": 120}]))
    SongReport.model_validate(r)  # the JSON is the validated shape
    times = [e["time"] for e in r["events"]]
    assert times == sorted(times) and all(round(t, 3) == t for t in times) and max(times) <= r["audio"]["analysed_seconds"]
    beats = np.array([e["time"] for e in r["events"] if e["event_type"] in ("MAIN_BEAT", "STRONG_BEAT", "WEAK_BEAT")])
    true = np.arange(0, 20, 0.5)
    err = np.array([np.min(np.abs(true - b)) for b in beats])
    assert abs(r["tempo"]["global_bpm"] - 120) < 2 and np.median(err) < 0.035  # about one analysis frame
    assert all(0 <= e["confidence"] <= 1 and 0 <= e["onset_strength"] <= 1 and 0 <= e["rms_energy"] <= 1 for e in r["events"])
    assert not r["tempo"]["changes"] and len(r["tempo"]["sections"]) == 1
    hits = [e["time"] for e in r["events"] if e["event_type"] in ("SUB_BEAT", "ONSET", "PERCUSSION_HIT", "BASS_HIT", "IMPACT")]
    assert all(np.min(np.abs(beats - t)) > 0.05 for t in hits)  # an attack on a beat is that beat, not a duplicate
    hit_times = [e["time"] for e in r["events"] if e["event_type"] in ("MAIN_BEAT", "STRONG_BEAT", "WEAK_BEAT", "SUB_BEAT", "ONSET", "PERCUSSION_HIT", "BASS_HIT", "IMPACT")]
    assert len(hit_times) == len(set(hit_times))  # one event per moment


def test_silence_is_reported_and_a_silent_file_is_refused(tmp_path):
    from app.core.errors import CorruptedMedia

    r = analyze_song(_song(tmp_path / "gap.wav", [{"seconds": 8, "bpm": 120}, {"seconds": 4, "bpm": None}, {"seconds": 8, "bpm": 120}]))
    silent = [e for e in r["events"] if e["event_type"] == "SILENCE"]
    assert silent and 7.5 <= silent[0]["time"] <= 8.6 and silent[0]["end"] >= 11.4
    assert any("silent" in w for w in r["analysis"]["warnings"])
    sf.write(tmp_path / "quiet.wav", np.zeros(SR * 5, dtype=np.float32), SR)
    with pytest.raises(CorruptedMedia):
        analyze_song(tmp_path / "quiet.wav")


@pytest.mark.parametrize("min_clip", [0.25, 0.4, 0.6])
def test_rapid_beats_are_grouped_and_no_clip_is_shorter_than_the_minimum(tmp_path, min_clip):
    r = analyze_song(_song(tmp_path / "fast.wav", [{"seconds": 16, "bpm": 120, "sub": 4}]), min_clip=min_clip, every_beat=True)
    fast = [x for x in r["rhythm"] if x["kind"] == "fast_sequence"]
    assert fast and all(0.10 <= (x["end"] - x["start"]) / max(x["details"]["hits"] - 1, 1) <= 0.25 for x in fast)
    subs = [e for e in r["events"] if e["event_type"] == "SUB_BEAT"]
    assert len(subs) >= 30 and all(e["subdivision"] for e in subs)  # the hits between beats are sub-beats on the grid
    assert min(s["duration"] for s in r["editing_segments"][:-1]) >= min_clip - 1e-3
    assert r["analysis"]["min_clip_seconds"] == min_clip


def test_a_tempo_change_is_followed(tmp_path):
    r = analyze_song(_song(tmp_path / "vt.wav", [{"seconds": 30, "bpm": 100}, {"seconds": 30, "bpm": 140}]))
    secs = r["tempo"]["sections"]
    assert r["tempo"]["changes"] and len(secs) == 2
    assert abs(secs[0]["estimated_bpm"] - 100) < 3 and abs(secs[1]["estimated_bpm"] - 140) < 3
    assert abs(secs[1]["start"] - 30) < 1.0
    beats = np.array([e["time"] for e in r["events"] if e["event_type"] in ("MAIN_BEAT", "STRONG_BEAT", "WEAK_BEAT")])
    true = np.r_[np.arange(0, 30, 0.6), 30 + np.arange(0, 30, 60 / 140)]
    assert np.percentile([np.min(np.abs(true - b)) for b in beats], 95) < 0.07  # one tempo would be ~0.3 s off
    assert any("tempo changes" in w for w in r["analysis"]["warnings"])
    change = [e for e in r["events"] if e["event_type"] == "TEMPO_CHANGE"]
    assert len(change) == 1 and abs(change[0]["time"] - 30) < 1.0 and change[0]["details"]["bpm_after"] > change[0]["details"]["bpm_before"]


def test_a_drop_is_found_where_the_music_kicks_in_and_not_in_a_steady_song(tmp_path):
    r = analyze_song(_song(tmp_path / "drop.wav", [{"seconds": 12, "bpm": 120, "gain": 0.15}, {"seconds": 12, "bpm": 120, "gain": 1.0, "bass": 0.5, "sub": 2}]))
    drops = [e for e in r["events"] if e["event_type"] == "MUSIC_DROP" and e["confidence"] >= 0.5]
    assert drops and abs(drops[0]["time"] - 12) < 0.6
    assert {"energy_change", "bass_change", "energy_before", "energy_after"} <= set(drops[0]["details"])
    steady = analyze_song(_song(tmp_path / "steady.wav", [{"seconds": 24, "bpm": 120, "bass": 0.3}]))
    assert not [e for e in steady["events"] if e["event_type"] == "MUSIC_DROP" and e["confidence"] >= 0.5]  # loud beats are not drops


def test_the_report_refuses_events_out_of_order(tmp_path):
    r = analyze_song(_song(tmp_path / "s.wav", [{"seconds": 10, "bpm": 120}]))
    r["events"] = list(reversed(r["events"]))
    with pytest.raises(ValueError):
        SongReport.model_validate(r)


def test_the_command_line_writes_the_report_and_a_plot(tmp_path):
    pytest.importorskip("matplotlib")
    from app.audio.song_cli import main

    song = _song(tmp_path / "s.wav", [{"seconds": 10, "bpm": 120}])
    assert main([str(song), "--out", str(tmp_path / "r.json"), "--plot", str(tmp_path / "p.png"), "--min-clip", "0.6"]) == 0
    report = json.loads((tmp_path / "r.json").read_text(encoding="utf-8"))
    assert report["analysis"]["beat_count"] > 10 and (tmp_path / "p.png").stat().st_size > 10_000
    assert main([str(tmp_path / "missing.mp3")]) == 2


def test_every_event_uses_the_editors_vocabulary_and_fields(tmp_path):
    from app.audio.events import EventType
    from typing import get_args

    r = analyze_song(_song(tmp_path / "s.wav", [{"seconds": 10, "bpm": 120, "gain": 0.2}, {"seconds": 10, "bpm": 120, "sub": 2, "bass": 0.4}]))
    allowed = set(get_args(EventType))
    assert {e["event_type"] for e in r["events"]} <= allowed
    for e in r["events"]:
        assert {"time", "event_type", "confidence", "onset_strength", "rms_energy", "subdivision", "tags"} <= set(e)
    kinds = {e["event_type"] for e in r["events"]}
    assert {"STRONG_BEAT", "SUB_BEAT", "MUSIC_DROP"} <= kinds
    assert r["analysis"]["event_counts"] and sum(r["analysis"]["event_counts"].values()) == len(r["events"])


def test_a_hit_left_ringing_is_a_reverb_tail(tmp_path):
    """One hard hit, then the sound dying away slowly with nothing new: a reverb tail (not silence, not a gap)."""
    t = np.arange(int(3.0 * SR)) / SR
    ring = (0.8 * np.sin(2 * np.pi * 220 * t) * np.exp(-t * 1.2)).astype(np.float32)
    lead = np.zeros(int(4.0 * SR), dtype=np.float32)
    for k in range(8):  # a few beats first, so the song has a rhythm
        i = int(k * 0.5 * SR)
        lead[i: i + 1323] += _click().astype(np.float32)
    y = np.concatenate([lead, ring, np.zeros(int(1.5 * SR), dtype=np.float32)]) + 0.002 * np.random.default_rng(2).standard_normal(int(8.5 * SR)).astype(np.float32)
    sf.write(tmp_path / "ring.wav", y, SR)
    r = analyze_song(tmp_path / "ring.wav")
    tails = [e for e in r["events"] if e["event_type"] == "REVERB_TAIL"]
    assert tails and 4.0 <= tails[0]["time"] <= 4.6 and tails[0]["end"] >= 5.5 and tails[0]["details"]["level_fall_db"] >= 6


def test_the_analysis_document_has_the_agreed_shape(tmp_path):
    from app.audio.analysis_json import analyze_to_json

    d = analyze_to_json(_song(tmp_path / "s.wav", [{"seconds": 6, "bpm": 120, "gain": 0.15}, {"seconds": 8, "bpm": 120, "sub": 4, "bass": 0.4}]))
    assert d["status"] == "completed" and d["errors"] == []
    assert set(d) == {"status", "audio", "analysis_config", "tempo", "beats", "onsets", "frame_features", "events",
                      "silence_regions", "candidate_changes", "errors", "energy", "song_sections"}
    assert d["audio"]["channels_analyzed"] == 1 and d["analysis_config"]["hop_length"] == 512
    assert abs(d["tempo"]["bpm"] - 120) < 2 and abs(d["tempo"]["beat_interval_sec"] - 0.5) < 0.01
    assert [b["beat_index"] for b in d["beats"]] == list(range(1, len(d["beats"]) + 1))
    assert {"time_sec", "rms", "spectral_centroid_hz", "spectral_bandwidth_hz", "spectral_rolloff_hz", "zero_crossing_rate",
            "onset_strength"} == set(d["frame_features"][0])
    assert len(d["frame_features"]) == pytest.approx(14 * 22050 / 512, abs=3)
    keys = {"type", "time_sec", "start_sec", "end_sec", "strength", "confidence", "source"}
    for e in d["events"]:
        assert keys <= set(e)
        assert (e["time_sec"] is None) == (e["start_sec"] is not None)  # a moment, or a stretch
    kinds = {e["type"] for e in d["events"]}
    assert {"ROLL", "MUSIC_DROP", "STRONG_BEAT"} <= kinds
    assert all(c["type"] in ("SECTION_CHANGE", "TEMPO_CHANGE") for c in d["candidate_changes"])


def test_a_bad_file_gives_a_failed_document_not_an_error(tmp_path):
    from app.audio.analysis_json import analyze_to_json

    (tmp_path / "bad.mp3").write_bytes(b"not audio at all" * 200)
    d = analyze_to_json(tmp_path / "bad.mp3")
    assert d["status"] == "failed" and d["errors"] and d["beats"] == [] and d["events"] == []
    sf.write(tmp_path / "quiet.wav", np.zeros(SR * 4, dtype=np.float32), SR)
    q = analyze_to_json(tmp_path / "quiet.wav")
    assert q["status"] == "failed" and "silent" in q["errors"][0].lower()


def test_the_api_answers_in_exactly_the_agreed_keys(tmp_path):
    from app.audio.analysis_json import agreed_shape, analyze_to_json

    full = analyze_to_json(_song(tmp_path / "s.wav", [{"seconds": 8, "bpm": 120, "sub": 2}]))
    small = agreed_shape(full)
    assert small["frame_features"] == [] and small["onsets"] == [] and small["beats"] and small["events"]  # small by default
    assert len(json.dumps(small)) < len(json.dumps(full)) / 3
    d = agreed_shape(full, frames=True, onsets=True)
    assert list(d) == ["status", "audio", "analysis_config", "tempo", "beats", "onsets", "frame_features", "events",
                       "silence_regions", "candidate_changes", "errors"]
    assert list(d["audio"]) == ["duration_sec", "sample_rate", "channels_analyzed"]
    assert list(d["analysis_config"]) == ["hop_length", "frame_length"]
    assert list(d["tempo"]) == ["bpm", "beat_interval_sec"]
    assert list(d["beats"][0]) == ["time_sec", "beat_index", "strength"] and list(d["onsets"][0]) == ["time_sec", "strength"]
    assert list(d["frame_features"][0]) == ["time_sec", "rms", "spectral_centroid_hz", "spectral_bandwidth_hz", "spectral_rolloff_hz",
                                            "zero_crossing_rate", "onset_strength"]
    assert all(list(e) == ["type", "time_sec", "start_sec", "end_sec", "strength", "confidence", "source"] for e in d["events"])


def test_schema_1_0_has_what_video_editing_needs_and_stays_small(tmp_path):
    from app.audio.analysis_json import analyze_to_json, video_shape

    full = analyze_to_json(_song(tmp_path / "s.wav", [{"seconds": 8, "bpm": 120, "gain": 0.15}, {"seconds": 10, "bpm": 120, "sub": 4, "bass": 0.4}]), 10)
    d = video_shape(full)
    assert list(d) == ["schema_version", "status", "audio", "tempo", "beats", "onsets", "energy_curve", "sections", "candidate_events", "errors"]
    assert d["schema_version"] == "1.0" and d["onsets"] == []
    assert d["tempo"]["alternative_bpm"] in (round(d["tempo"]["bpm"] / 2, 1), round(d["tempo"]["bpm"] * 2, 1)) and d["tempo"]["sections"]
    assert all(set(b) == {"time_sec", "strength", "confidence", "downbeat", "beat_in_bar"} for b in d["beats"]) and any(b["downbeat"] for b in d["beats"])
    assert all(0 <= b["confidence"] <= 1 for b in d["beats"])
    assert d["energy_curve"]["sample_interval_sec"] == 0.25 and len(d["energy_curve"]["values"]) == pytest.approx(18 / 0.25, abs=2)
    assert d["sections"] and all(s["energy_level"] in ("HIGH_ENERGY", "MEDIUM_ENERGY", "LOW_ENERGY") for s in d["sections"])
    for e in d["candidate_events"]:
        assert set(e) == {"type", "time_sec", "start_sec", "end_sec", "strength", "confidence"} and e["confidence"] is not None
        assert (e["time_sec"] is None) == (e["start_sec"] is not None)
    assert "MUSIC_DROP" in {e["type"] for e in d["candidate_events"]}
    assert not {"SUB_BEAT", "ONSET", "MAIN_BEAT"} & {e["type"] for e in d["candidate_events"]}  # only what calls for an edit
    assert len(json.dumps(d)) < len(json.dumps(full)) / 4
