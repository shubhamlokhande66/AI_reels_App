"""Phase 2.1 music intelligence: labelled sections, curves (loudness, brightness, density, vocal estimate), the normalized
beat timeline, and section-aware cutting."""

from __future__ import annotations

import numpy as np
import soundfile as sf

from app.audio.analyzer import ANALYSIS_VERSION, analyze_audio
from app.audio.structure import CUT_STRATEGY, Curves, label_sections
from app.director.music_map import build_music_map
from app.models.analysis import Section, SongSection
from app.styles import get_style
from app.video.timeline import plan_slots
from tests.test_timeline import make_audio

SR = 22050


def _kick(n, sr=SR):
    t = np.arange(n) / sr
    return np.sin(2 * np.pi * (50 + 80 * np.exp(-t * 30)) * t) * np.exp(-t * 12)


def _song(path, sr=SR):
    """intro (soft pad) 0-10 s, build (kicks speeding up, rising) 10-20 s, drop (loud kicks + bass) 20-34 s, outro (pad) 34-42 s,
    with a sung-like harmonic line (vibrato, formants) over the drop."""
    dur = 42.0
    t = np.arange(int(dur * sr)) / sr
    y = 0.05 * np.sin(2 * np.pi * 220 * t) * ((t < 10) | (t >= 34))
    for start, end, step, amp in ((10, 20, 0.5, 0.35), (20, 34, 0.5, 0.9)):
        k = start
        while k < end:
            a = int(k * sr)
            hit = _kick(int(0.4 * sr)) * amp * (0.5 + 0.5 * (k - start) / (end - start) if start == 10 else 1.0)
            y[a:a + len(hit)] += hit[: len(y) - a]
            k += step if start == 20 else max(step - 0.03 * (k - start), 0.25)
    drop = (t >= 20) & (t < 34)
    y += drop * 0.25 * np.sin(2 * np.pi * 55 * t)
    f0 = 330 * (1 + 0.01 * np.sin(2 * np.pi * 5.5 * t))
    phase = 2 * np.pi * np.cumsum(f0) / sr
    voice = sum(np.sin(h * phase) / h for h in range(1, 8))
    y += drop * 0.12 * voice
    sf.write(str(path), (y / np.max(np.abs(y)) * 0.9).astype(np.float32), sr)
    return path


def test_sections_curves_and_vocals_from_a_real_signal(tmp_path):
    a = analyze_audio(_song(tmp_path / "song.wav"))
    assert a.analysis_version == ANALYSIS_VERSION >= 4
    labels = [s.label for s in a.song_sections]
    assert labels[0] == "intro" and labels[-1] == "outro"
    assert "drop" in labels or "chorus" in labels
    loud = a.section_at(27.0)
    assert loud is not None and loud.label in ("drop", "chorus") and loud.cut_on == CUT_STRATEGY[loud.label]
    n = len(a.loudness_db)
    assert n == len(a.brightness) == len(a.density) == len(a.vocal) >= 80  # every 0.5 s
    assert a.curve_at("loudness_db", 27.0) > a.curve_at("loudness_db", 5.0) + 6  # the drop is clearly louder
    assert a.curve_at("density", 27.0) > a.curve_at("density", 5.0)
    assert np.mean(a.vocal[int(22 / 0.5):int(32 / 0.5)]) > np.mean(a.vocal[int(12 / 0.5):int(18 / 0.5)])  # singing over the drop


def test_labels_follow_energy_slope_drops_and_position():
    energy = [0.2] * 100 + [x / 100 for x in range(20, 120)] + [0.95] * 150 + [0.3] * 80  # 0.1 s hop
    curves = Curves([0.0] * 86, [0.5] * 86, [0.5] * 86, [0.0] * 86)
    secs = [Section(start=0, end=10), Section(start=10, end=20), Section(start=20, end=35), Section(start=35, end=43)]
    rows = label_sections(secs, energy, 0.1, [20.0], curves)
    assert [r["label"] for r in rows] == ["intro", "build", "drop", "outro"]
    assert [r["cut_on"] for r in rows] == ["phrase", "beat", "accent", "phrase"]


def test_normalized_timeline_points():
    audio = make_audio(duration=30, loud_from=15, drops=(15.0,))
    audio.song_sections = [SongSection(start=0, end=15, label="build", cut_on="beat"), SongSection(start=15, end=30, label="drop", cut_on="accent")]
    mm = build_music_map(audio, 0.0, 30.0)
    assert mm.points and {"time", "section", "energy", "beatStrength", "phrasePosition"} <= set(mm.points[0])
    assert mm.section_at(20.0)["label"] == "drop" and mm.to_doc()["sections"][1]["cutOn"] == "accent"
    assert all(0.0 <= p["phrasePosition"] < 1.0 + 1e-9 and 0.0 <= p["beatStrength"] <= 1.0 for p in mm.points)
    assert any(p["section"] == "build" for p in mm.points) and any(p["section"] == "drop" for p in mm.points)


def test_rule_editor_cuts_by_section():
    plain = make_audio(duration=40, loud_from=40, drops=())  # all calm
    labelled = plain.model_copy(deep=True)
    labelled.song_sections = [SongSection(start=0, end=20, label="intro", cut_on="phrase"), SongSection(start=20, end=40, label="verse", cut_on="bar")]
    style = get_style("fast_trending")
    a = plan_slots(plain, 0.0, 20.0, style)
    b = plan_slots(labelled, 0.0, 20.0, style)
    assert len(b) < len(a)  # the intro breathes: fewer, longer shots
