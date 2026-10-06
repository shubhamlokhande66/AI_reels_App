"""Sound effects: synthesised locally, placed on the edit's own events, and mixed under the music in every audio mode."""

from __future__ import annotations

import subprocess

import numpy as np
import pytest
import soundfile as sf

from app.audio.sfx import LENGTH, SR, synth_track
from app.core.ffmpeg import find_binary
from app.director.music_map import build_music_map
from app.director.sfx import MAX_EFFECTS, MIN_GAP, plan_sfx
from app.models.timeline import SoundEffect, TextOverlay, Transition, VoiceTrack
from app.styles import get_style
from app.video.audio_mix import build_audio_graph
from app.video.cutter import RenderConfig
from app.video.timeline import build_timeline
from tests.test_timeline import make_audio, make_clip


def test_effects_are_placed_on_transitions_the_drop_and_text():
    audio = make_audio(duration=30, loud_from=8.0, drops=(8.0,))
    clips = [make_clip(f"c{i}", sig_bin=i * 4) for i in range(5)]
    tl = build_timeline(audio, clips, 15, get_style("fast_trending"), seed=0, audio_start=0.0)
    for s in tl.segments:
        s.transition_in = Transition()
    tl.segments[2].transition_in = Transition(type="zoom", duration=0.15)
    tl.segments[3].transition_in = Transition(type="dissolve", duration=0.3)  # calm: no whoosh
    tl.overlays = [TextOverlay(text="New drop", start=0.5, end=2.0, role="hook")]
    fx = plan_sfx(tl, build_music_map(audio, tl.audio_start, tl.duration))
    kinds = [e.type for e in fx]
    assert "impact" in kinds and "riser" in kinds and "pop" in kinds
    assert kinds.count("whoosh") == 1  # the zoom, not the dissolve
    impact = next(e for e in fx if e.type == "impact")
    assert abs(impact.at - 8.0) < 1e-6
    whoosh = next(e for e in fx if e.type == "whoosh")
    assert whoosh.at < tl.segments[2].timeline_start  # it lands on the cut
    assert len(fx) <= MAX_EFFECTS
    singles = [e.at for e in fx if e.type != "riser"]
    assert all(b - a >= MIN_GAP - 1e-6 for a, b in zip(singles, singles[1:]))


def test_synth_track_is_deterministic_and_never_clips(tmp_path):
    events = [SoundEffect(type=t, at=i * 0.5, volume=1.0) for i, t in enumerate(("whoosh", "impact", "riser", "pop", "impact"))]
    a = synth_track(events, 4.0, tmp_path / "a.wav")
    b = synth_track(events, 4.0, tmp_path / "b.wav")
    x, sr = sf.read(a)
    y, _ = sf.read(b)
    assert sr == SR and x.shape == (int(4.0 * SR) + 1, 2)
    assert np.array_equal(x, y) and np.max(np.abs(x)) <= 0.99
    assert np.max(np.abs(x[: int(0.4 * SR)])) > 0.05  # the whoosh is audible
    assert LENGTH["riser"] > LENGTH["pop"]


@pytest.mark.parametrize("mode", ["music", "voice_music", "voice", "original"])
def test_sfx_mix_is_a_valid_ffmpeg_graph_in_every_audio_mode(mode, tmp_path):
    """The graph is checked by FFmpeg itself (a real, short run over generated inputs)."""
    from app.models.timeline import Segment

    cfg = RenderConfig(audio_mode=mode)
    dur = 2.0
    segs = [Segment(clip_id="c", video="c.mp4", source_start=0, source_end=1, timeline_start=0, timeline_end=1),
            Segment(clip_id="c", video="c.mp4", source_start=1, source_end=2, timeline_start=1, timeline_end=2)]  # fmt: skip
    voice = VoiceTrack(file_key="v.wav", duration=1.0)
    ins: list[str] = []
    idx = 0
    music_idx = voice_idx = None
    if mode == "original":
        ins += ["-f", "lavfi", "-t", "1", "-i", "sine=f=300", "-f", "lavfi", "-t", "1", "-i", "sine=f=500"]
        idx = 2
    if mode in ("music", "voice_music"):
        ins += ["-f", "lavfi", "-t", "3", "-i", "sine=f=440"]
        music_idx, idx = idx, idx + 1
    if mode in ("voice", "voice_music"):
        ins += ["-f", "lavfi", "-t", "1", "-i", "sine=f=220"]
        voice_idx, idx = idx, idx + 1
    sfx = synth_track([SoundEffect(type="impact", at=0.5)], dur, tmp_path / "fx.wav")
    ins += ["-i", str(sfx)]
    graph = build_audio_graph(mode, music_idx=music_idx, voice_idx=voice_idx, segments=segs, plans=[None, None], duration=dur,
                              style=get_style("minimal"), cfg=cfg, voice=voice, sfx_idx=idx)  # fmt: skip
    assert graph and graph.endswith("[a]") and f"[{idx}:a]" in graph
    out = tmp_path / "mix.wav"
    r = subprocess.run([find_binary("ffmpeg"), "-hide_banner", "-loglevel", "error", "-y", *ins, "-filter_complex", graph,
                        "-map", "[a]", "-t", str(dur), str(out)], capture_output=True, text=True, timeout=120)  # fmt: skip
    assert r.returncode == 0, r.stderr
    assert out.stat().st_size > 1000
