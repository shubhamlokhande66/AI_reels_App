"""Audio modes: music, voice + music (ducking), voice only, original clip audio, no audio."""

from __future__ import annotations

import subprocess
from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest

from app.core.ffmpeg import find_binary, probe
from app.models.timeline import Segment, Timeline, Transition, VoiceLine, VoiceTrack
from app.styles import get_style
from app.video.audio_mix import atempo_chain, build_audio_graph
from app.video.composer import build_compose_command
from app.video.cutter import RenderConfig, SourceClip, build_segment_command, plan_segments
from app.video.renderer import render_timeline

FAST = RenderConfig(width=270, height=480, segment_preset="ultrafast", final_preset="ultrafast")


def ff(*args):
    subprocess.run([find_binary("ffmpeg"), "-hide_banner", "-loglevel", "error", "-y", *args], check=True, capture_output=True)


def seg(i, clip="a", start=0.0, length=1.5, **kw):
    return Segment(clip_id=clip, video=f"{clip}.mp4", source_start=1.0, source_end=1.0 + length * kw.get("speed", 1.0),
                   timeline_start=start, timeline_end=start + length, **kw)  # fmt: skip


VOICE = VoiceTrack(file_key="v.wav", duration=2.0, start=0.3, lines=[VoiceLine(text="hi", start=0.3, end=2.3)])


@pytest.fixture(scope="module")
def assets(tmp_path_factory):
    d = tmp_path_factory.mktemp("audio")
    # a clip with its own 440 Hz tone, a clip without sound, a "voice" (880 Hz), and quiet music (220 Hz)
    ff("-f", "lavfi", "-i", "testsrc2=size=480x270:rate=30:duration=6", "-f", "lavfi", "-i", "sine=f=440:d=6",
       "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(d / "with_audio.mp4"))
    ff("-f", "lavfi", "-i", "testsrc2=size=480x270:rate=30:duration=6", "-c:v", "libx264", "-preset", "ultrafast",
       "-pix_fmt", "yuv420p", str(d / "silent.mp4"))
    ff("-f", "lavfi", "-i", "sine=f=880:d=2", "-ac", "1", "-ar", "24000", str(d / "voice.wav"))
    ff("-f", "lavfi", "-i", "sine=f=220:d=20", "-ac", "2", "-ar", "44100", str(d / "music.wav"))
    return d


def sources(d):
    return {"a": SourceClip(d / "with_audio.mp4", 480, 270, "a", has_audio=True),
            "b": SourceClip(d / "silent.mp4", 480, 270, "b", has_audio=False)}  # fmt: skip


def tl(voice=None):
    return Timeline(duration=4.5, segments=[seg(0, "a", 0, 1.5), seg(1, "b", 1.5, 1.5, transition_in=Transition(type="cut")),
                                            seg(2, "a", 3.0, 1.5)], voice=voice)  # fmt: skip


def energy_at(path: Path, t0: float, t1: float, freq_hz: float) -> float:
    """Energy of the audio between t0 and t1 at (or near) ``freq_hz``: which source is actually audible."""
    raw = subprocess.run([find_binary("ffmpeg"), "-v", "error", "-ss", str(t0), "-t", str(t1 - t0), "-i", str(path), "-vn",
                          "-ac", "1", "-ar", "16000", "-f", "f32le", "-"], capture_output=True, check=True).stdout  # fmt: skip
    y = np.frombuffer(raw, np.float32)
    if len(y) < 800:
        return 0.0
    spec = np.abs(np.fft.rfft(y * np.hanning(len(y))))
    freqs = np.fft.rfftfreq(len(y), 1 / 16000)
    band = (freqs > freq_hz * 0.93) & (freqs < freq_hz * 1.07)
    return float(spec[band].sum() / max(spec.sum(), 1e-9))


# ------------------------------------------------------------------ graph construction (no rendering)
def test_atempo_chain_covers_the_full_speed_range():
    assert atempo_chain(1.0) == "atempo=1.0" and atempo_chain(0.5) == "atempo=0.5" and atempo_chain(2.0) == "atempo=2.0"
    assert atempo_chain(0.25) == "atempo=0.5,atempo=0.5"
    assert atempo_chain(4.0) == "atempo=2.0,atempo=2.0"
    import re

    for s in (0.25, 0.3, 0.75, 1.5, 3.0, 4.0):
        prod = np.prod([float(x) for x in re.findall(r"atempo=([\d.]+)", atempo_chain(s))])
        assert prod == pytest.approx(s, rel=1e-3)
        assert all(0.5 <= float(x) <= 2.0 for x in re.findall(r"atempo=([\d.]+)", atempo_chain(s)))


def graph(mode, **kw):
    t = tl(kw.pop("voice", None))
    return build_audio_graph(mode, music_idx=kw.get("music_idx"), voice_idx=kw.get("voice_idx"), segments=t.segments,
                             plans=plan_segments(t.segments), duration=t.duration, style=get_style("custom"),
                             cfg=RenderConfig(), voice=t.voice)  # fmt: skip


def test_graph_per_mode():
    assert graph("none") is None
    music = graph("music", music_idx=3)
    assert "[3:a]" in music and "loudnorm" in music and "sidechaincompress" not in music and music.endswith("[a]")
    both = graph("voice_music", music_idx=3, voice_idx=4, voice=VOICE)
    assert "sidechaincompress" in both and "adelay=300|300" in both and "amix=inputs=2" in both and "[4:a]" in both
    solo_duck_off = graph("voice_music", music_idx=3, voice_idx=4, voice=VOICE.model_copy(update={"duck_music": False}))
    assert "sidechaincompress" not in solo_duck_off and "amix" in solo_duck_off
    only = graph("voice", voice_idx=4, voice=VOICE)
    assert "[3:a]" not in only and "adelay" in only and "amix" not in only
    orig = graph("original")
    assert "concat=n=2:v=0:a=1" in orig and "[orig]" in orig and orig.endswith("[a]")
    # asking for voice without a voice track falls back to whatever audio is available
    assert graph("voice_music", music_idx=3, voice=None).count("sidechaincompress") == 0
    assert graph("voice", voice=None) is None


def test_original_audio_crossfades_where_the_picture_dissolves():
    segs = [seg(0, "a", 0, 2), seg(1, "b", 2, 2, transition_in=Transition(type="dissolve", duration=0.4))]
    from app.video.audio_mix import original_audio_graph

    assert "acrossfade=d=0.400" in original_audio_graph(segs, plan_segments(segs))


def test_segment_command_only_carries_audio_in_original_mode():
    s = seg(0, "a", 0, 1.5, speed=0.5, volume=0.8)
    plan = plan_segments([s])[0]
    plain = build_segment_command(s, SourceClip(Path("x.mp4"), 480, 270, has_audio=True), Path("o.mp4"), plan, RenderConfig())
    assert "-an" in plain and "[a]" not in " ".join(plain)
    orig = build_segment_command(s, SourceClip(Path("x.mp4"), 480, 270, has_audio=True), Path("o.mp4"), plan,
                                 RenderConfig(audio_mode="original"))  # fmt: skip
    j = " ".join(orig)
    assert "-an" not in orig and "atempo=0.5" in j and "volume=0.800" in j and "-c:a" in orig
    silent = build_segment_command(s, SourceClip(Path("x.mp4"), 480, 270, has_audio=False), Path("o.mp4"), plan,
                                   RenderConfig(audio_mode="original"))  # fmt: skip
    assert "anullsrc" in " ".join(silent)  # a silent source still yields a valid audio stream


def test_compose_command_mode_wiring():
    t = tl(VOICE)
    plans = plan_segments(t.segments)
    files = [Path(f"s{i}.mp4") for i in range(3)]
    none = build_compose_command(t.segments, plans, files, Path("m.wav"), 0, 4.5, get_style("custom"),
                                 RenderConfig(audio_mode="none"), Path("o.mp4"))  # fmt: skip
    assert "-an" in none and "-map" in none and "[a]" not in none
    vm = build_compose_command(t.segments, plans, files, Path("m.wav"), 2.0, 4.5, get_style("custom"),
                               RenderConfig(audio_mode="voice_music"), Path("o.mp4"), voice=VOICE, voice_path=Path("v.wav"))  # fmt: skip
    assert vm.count("-i") == 5 and "m.wav" in vm and "v.wav" in vm and "[a]" in vm and "-c:a" in vm


# ------------------------------------------------------------------ real renders
def render(assets, mode, t=None, music=True, voice=True):
    t = t or tl(VOICE if voice else None)
    out = assets / f"out_{mode}_{len(list(assets.glob('out_*')))}.mp4"
    render_timeline(t, sources(assets), assets / "music.wav" if music else None, out, assets / "w", get_style("custom"),
                    replace(FAST, audio_mode=mode), voice_path=assets / "voice.wav" if voice else None)  # fmt: skip
    return out


@pytest.mark.slow
def test_music_only_and_no_audio_modes(assets):
    m = render(assets, "music", voice=False)
    assert any(s["codec_type"] == "audio" for s in probe(m)["streams"])
    assert energy_at(m, 0.5, 4.0, 220) > 0.3
    n = render(assets, "none", voice=False, music=False)
    assert {s["codec_type"] for s in probe(n)["streams"]} == {"video"}  # truly silent: no audio stream at all


@pytest.mark.slow
def test_voice_over_music_is_audible_and_ducks_the_music(assets):
    out = render(assets, "voice_music")
    info = probe(out)
    assert {s["codec_type"] for s in info["streams"]} == {"video", "audio"}
    assert float(info["format"]["duration"]) == pytest.approx(4.5, abs=0.3)
    assert energy_at(out, 0.5, 2.2, 880) > 0.15, "the voice is heard while it speaks"
    assert energy_at(out, 2.8, 3.4, 880) < 0.05, "and stops when the script ends"
    # (the default fade-out starts at 3.5 s, so compare while the music is at full level)
    with_duck = energy_at(out, 0.6, 2.2, 220)
    after_voice = energy_at(out, 2.9, 3.4, 220)
    assert after_voice > with_duck, "the music recovers after the voice"  # ducked while speaking, full afterwards


@pytest.mark.slow
def test_voice_only_has_no_music(assets):
    out = render(assets, "voice", music=False)
    assert energy_at(out, 0.5, 2.2, 880) > 0.3
    assert energy_at(out, 0.5, 2.2, 220) < 0.05


@pytest.mark.slow
def test_original_audio_uses_each_shots_own_sound(assets):
    out = render(assets, "original", voice=False, music=False)
    assert float(probe(out)["format"]["duration"]) == pytest.approx(4.5, abs=0.3)
    assert energy_at(out, 0.2, 1.3, 440) > 0.3, "shot 1 has its own tone"
    assert energy_at(out, 1.7, 2.9, 440) < 0.05, "shot 2 came from a silent file"
    assert energy_at(out, 3.2, 4.3, 440) > 0.3, "shot 3 has its own tone again"
