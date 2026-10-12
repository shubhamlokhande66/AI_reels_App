"""Phase 4: BPM + beat detection."""

from __future__ import annotations

import wave

import numpy as np
import pytest

from app.audio.analyzer import analyze_audio, compute_energy, find_drops, high_energy_sections
from app.audio.bpm import bpm_from_beats, fold_bpm
from app.core.errors import CorruptedMedia
from tests.conftest import make_click_track


@pytest.fixture(scope="module")
def analysis(media_dir):
    return analyze_audio(media_dir / "beat120.mp3")


def test_bpm_detected(analysis):
    assert analysis.bpm == pytest.approx(120, abs=2)
    assert analysis.duration == pytest.approx(30, abs=0.5)
    assert analysis.beat_confidence > 0.7


def test_beats_are_on_the_grid(analysis):
    beats = np.array(analysis.beats)
    assert len(beats) >= 50
    period = 0.5
    # mp3 encoder delay shifts everything slightly, so check consistency, not absolute phase
    off = np.median(beats % period)
    err = np.abs(((beats - off + period / 2) % period) - period / 2)
    assert np.percentile(err, 90) < 0.05
    assert list(beats) == sorted(beats)


def test_strong_beats_subset_of_beats(analysis):
    assert set(analysis.strong_beats) <= set(analysis.beats)
    assert 0 < len(analysis.strong_beats) < len(analysis.beats)


def test_high_energy_section_is_second_half(analysis):
    # the click track is louder from 15 s onward
    assert analysis.high_energy_sections
    assert any(s.start >= 12 and s.end > 25 for s in analysis.high_energy_sections)
    assert analysis.mean_energy(20, 28) > analysis.mean_energy(2, 10)


def test_energy_is_normalised(analysis):
    assert all(0 <= e <= 1 for e in analysis.energy)
    assert len(analysis.energy) == pytest.approx(analysis.duration / analysis.energy_hop, abs=3)


def test_stage_callbacks_in_order(media_dir):
    seen: list[tuple[str, float]] = []
    analyze_audio(media_dir / "beat120.wav", lambda s, f: seen.append((s, f)))
    stages = [s for s, _ in seen]
    assert stages.index("analyzing_music") < stages.index("detecting_beats")
    assert seen[-1] == ("detecting_beats", 1.0)


def test_other_tempo(tmp_path):
    p = tmp_path / "b100.wav"
    make_click_track(p, bpm=100, seconds=20)
    assert analyze_audio(p).bpm == pytest.approx(100, abs=2)


def test_silent_audio_rejected(tmp_path):
    p = tmp_path / "silent.wav"
    with wave.open(str(p), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(22050)
        w.writeframes(b"\x00\x00" * 22050 * 5)
    with pytest.raises(CorruptedMedia) as e:
        analyze_audio(p)
    assert e.value.code == "SILENT_AUDIO"


def test_fold_bpm_and_regularity():
    assert fold_bpm(60) == 120 and fold_bpm(240) == 120 and fold_bpm(128) == 128
    bpm, conf = bpm_from_beats([0, 0.5, 1.0, 1.5, 2.0])
    assert bpm == pytest.approx(120) and conf > 0.9
    assert bpm_from_beats([0, 1]) == (0.0, 0.0)


def test_drops_and_sections_helpers():
    e = np.concatenate([np.full(200, 0.1), np.full(200, 0.95)])
    assert any(abs(d - 20.0) < 1.5 for d in find_drops(e, [i * 0.5 for i in range(80)]))
    secs = high_energy_sections(e)
    assert secs and secs[0].start >= 19
    noise = np.random.default_rng(1).standard_normal(22050 * 3).astype("float32") * 0.1
    assert len(compute_energy(noise, 22050)) > 20


# ------------------------------------------------------------------ strong individual hits ("accents")
def test_accents_are_the_songs_strong_hits_with_their_strength(analysis):
    from app.audio.analyzer import ANALYSIS_VERSION

    assert analysis.analysis_version == ANALYSIS_VERSION
    assert len(analysis.accents) == len(analysis.accent_strengths) > 10
    assert all(0.35 <= s <= 1.0 for s in analysis.accent_strengths) and max(analysis.accent_strengths) >= 0.9
    assert analysis.accents == sorted(analysis.accents)
    assert all(b - a >= 0.2 for a, b in zip(analysis.accents, analysis.accents[1:]))  # hits, not a smear of onsets
    # a 120 BPM click track: the hits sit on the beat grid (0.5 s)
    off = [min(abs(t - b) for b in analysis.beats) for t in analysis.accents]
    assert np.median(off) < 0.06


def test_flat_or_tiny_signals_have_no_accents():
    from app.audio.analyzer import find_accents

    assert find_accents(np.zeros(800), 22050) == ([], [])  # nothing happens
    assert find_accents(np.full(800, 0.7), 22050) == ([], [])  # a steady drone has no hits
    assert find_accents(np.array([0.0, 1.0, 0.0]), 22050) == ([], [])  # too short to mean anything


def test_analyses_saved_before_accents_existed_are_redone_once(storage, media_dir, monkeypatch):
    import json

    from app.jobs.pipeline import MediaRef, _audio_key, analyze_music, PipelineInput
    from app.schemas.project import ProjectSettings

    key = "projects/p1/input/beat.mp3"
    storage.write_bytes(key, (media_dir / "beat120.mp3").read_bytes())
    old = {"bpm": 120.0, "duration": 30.0, "beats": [0.5, 1.0], "onsets": [], "energy": [0.5] * 10}  # an old cache: no accents, no version
    storage.write_bytes(_audio_key("p1", "a1"), json.dumps(old).encode())
    inp = PipelineInput(project_id="p1", job_type="generate", videos=[], audio=MediaRef("a1", "beat.mp3", key), settings=ProjectSettings())
    a = analyze_music(inp, storage, lambda *_: None)
    from app.audio.analyzer import ANALYSIS_VERSION

    assert a.analysis_version == ANALYSIS_VERSION and len(a.accents) > 10  # redone, not served from the old cache
    saved = json.loads(storage.read_bytes(_audio_key("p1", "a1")))
    assert saved["analysisVersion"] == ANALYSIS_VERSION and saved["accents"]
    import app.jobs.pipeline as pl

    monkeypatch.setattr(pl, "analyze_audio", lambda *a, **k: (_ for _ in ()).throw(AssertionError("must come from the cache now")))
    again = analyze_music(inp, storage, lambda *_: None)
    assert again.accents == a.accents  # and it is cached again


def test_one_huge_hit_does_not_make_every_other_hit_look_weak():
    """Regression: strength was measured against the loudest single hit, so on a real song only 9 accents survived."""
    from app.audio.analyzer import find_accents

    rng = np.random.default_rng(0)
    env = (0.5 + 0.15 * rng.random(4000)).astype(np.float32)  # the music's own texture
    env[::40] += 3.0  # ordinary drum hits (a steady pulse), 8% of the crash's strength
    env[2000] = 40.0  # ...and one enormous crash
    times, strengths = find_accents(env, 22050)
    assert len(times) > 60  # the pulse is still found
    assert sum(1 for x in strengths if x >= 0.55) > 60  # and counts as strong (relative to a typical strong hit)
    assert max(strengths) == 1.0


# ------------------------------------------------------------------ half time: the tracker kept every second beat
def test_half_time_beats_are_added_only_where_the_music_hits_between_them():
    """The tracker kept every second beat. A quiet intro has nothing in between (keep its beats as they are); later the
    music hits between them, and those skipped beats are added at the hit itself, not at the computed middle."""
    import librosa
    import numpy as np

    from app.audio.beat_detector import HOP, _fill_half_time

    sr = 22050
    beats = np.arange(1.0, 20.0, 0.86)  # what the tracker kept: ~70 BPM
    frame = lambda t: int(librosa.time_to_frames(t, sr=sr, hop_length=HOP))  # noqa: E731
    env = np.full(frame(22.0), 0.7)
    for b in beats:
        env[frame(b)] = 8.7
        if b >= 10.0:  # from 10 s: a snare between the beats, a little after the middle
            env[frame(b + 0.45)] = 3.4
    filled = _fill_half_time(beats, env, sr)
    added = sorted(set(np.round(filled, 3)) - set(np.round(beats, 3)))
    assert added and all(t > 10.0 for t in added)  # nothing invented in the quiet part
    assert all(any(abs(t - (b + 0.45)) < 0.03 for b in beats) for t in added)  # on the real hit
    assert len(added) == sum(1 for b in beats[:-1] if b >= 10.0)
    quiet = np.full(frame(22.0), 0.7)
    quiet[[frame(b) for b in beats]] = 8.7
    assert len(_fill_half_time(beats, quiet, sr)) == len(beats)  # a slow song with nothing between: unchanged


def test_bpm_and_beat_grid_agree():
    """The BPM reported is the spacing of the beats listed (a half-time grid used to say 139 BPM with 70 BPM beats)."""
    import numpy as np

    from tests.conftest import make_click_track

    def check(path, bpm):
        make_click_track(path, bpm=bpm, seconds=20)
        a = analyze_audio(path)
        grid = 60 / float(np.median(np.diff(a.beats)))
        assert abs(grid - a.bpm) / a.bpm < 0.05, (bpm, a.bpm, grid)

    import tempfile
    from pathlib import Path

    with tempfile.TemporaryDirectory() as d:
        check(Path(d) / "a.wav", 140)
        check(Path(d) / "b.wav", 75)


def test_bar_starts_and_strong_beats_come_from_the_kick_chords_and_bass():
    """audio/accents.py on a 4/4 song with a pickup (it starts on beat 3): the bar starts are found, sure; strong beats
    are about 1 in 4 and include the bar starts; levels follow the bar (bar start, backbeat, other)."""
    from app.audio import accents
    from tests.bar_song import SR, bar_song

    y, downs, beats = bar_song(pickup=2)
    r = accents.analyze(y, SR, beats)
    found = sum(any(abs(d - x) < 0.03 for x in r.downbeats) for d in downs)
    assert found == len(downs) and r.downbeat_confidence >= 0.6
    assert 0.18 <= len(r.strong_beats) / len(beats) <= 0.35
    assert sum(any(abs(s - d) < 0.03 for d in downs) for s in r.strong_beats) >= len(downs) // 2
    assert r.levels[2] in (3, 4) and r.levels[3] == 2 and r.levels[0] == 1  # beat 3 of the pickup, then bar 1, beat 2
    assert len(r.levels) == len(r.kick) == len(beats)


def test_beats_are_moved_onto_the_real_hits_and_weak_beats_are_not_medium():
    import numpy as np

    from app.audio.accents import analyze, snap_to_hits
    from tests.bar_song import SR, bar_song

    y, downs, beats = bar_song(120, 16, 0)
    off = np.asarray(beats) + 0.025  # a tracker's grid, 25 ms late
    exact, clear = snap_to_hits(y, SR, off)
    err = np.abs(exact - np.asarray(beats))
    assert clear.mean() > 0.9 and float(np.median(err[1:])) < 0.003 and float(err[1:].max()) < 0.012  # well inside one video frame (33 ms)
    acc = analyze(y, SR, list(off))
    assert acc.beats and abs(acc.beats[4] - beats[4]) < 0.006
    strong, medium = set(acc.strong_beats), set(acc.medium_beats or [])
    assert not strong & medium and len(strong) + len(medium) < len(beats)  # weak beats are neither
