"""Audio graphs for every audio mode: music, voice + music (ducking), voice only, original, none."""

from __future__ import annotations

from app.models.timeline import Segment, VoiceTrack
from app.styles.base import EditingStyle
from app.video import transitions as tr
from app.video.cutter import RenderConfig, SegmentPlan

AUDIO_MODES = ("music", "voice_music", "voice", "original", "none")
STEREO = "aresample=48000,aformat=channel_layouts=stereo"


def atempo_chain(speed: float) -> str:
    """atempo only accepts 0.5..2.0 per stage; chain stages for slower/faster speeds."""
    stages: list[float] = []
    s = speed
    while s < 0.5 - 1e-9:
        stages.append(0.5)
        s /= 0.5
    while s > 2.0 + 1e-9:
        stages.append(2.0)
        s /= 2.0
    stages.append(round(s, 4))
    return ",".join(f"atempo={x}" for x in stages)


def music_chain(duration: float, style: EditingStyle, volume: float, fade_in: float | None, fade_out: float | None) -> str:
    fi = min(style.audio_fade_in if fade_in is None else fade_in, duration / 4)
    fo = min(style.audio_fade_out if fade_out is None else fade_out, duration / 3)
    return (
        f"afade=t=in:st=0:d={fi:.3f},afade=t=out:st={max(duration - fo, 0):.3f}:d={fo:.3f},"
        f"volume={volume:.3f},{STEREO}"
    )


def voice_chain(voice: VoiceTrack, duration: float) -> str:
    """The voice, delayed to its start and padded with silence to the full Reel length.

    The padding matters: the ducker and the mixer end when their shortest input ends, so a voice that
    is shorter than the Reel would otherwise cut the music off with it.
    """
    ms = int(round(voice.start * 1000))
    return f"volume={voice.volume:.3f},{STEREO},adelay={ms}|{ms},apad=whole_dur={duration:.3f}"


def finish_chain(duration: float, cfg: RenderConfig) -> str:
    """Loudness-normalise the final mix (social platforms expect about -14 LUFS) and pad to the reel length."""
    return f"loudnorm=I={cfg.target_lufs}:TP=-1.5:LRA=11,{STEREO},apad=whole_dur={duration:.3f}"


def original_audio_graph(segments: list[Segment], plans: list[SegmentPlan]) -> str:
    """Join each shot's own audio the same way the video is joined (crossfade where the picture dissolves)."""
    parts = [f"[{i}:a]aresample=48000,aformat=channel_layouts=stereo[a{i}]" for i in range(len(segments))]
    cur = "[a0]"
    for i in range(1, len(segments)):
        t = segments[i].transition_in
        spec = tr.get_transition(t.type)
        label = f"[aj{i}]"
        if spec.kind == "xfade" and t.duration > 0:
            parts.append(f"{cur}[a{i}]acrossfade=d={t.duration:.3f}:c1=tri:c2=tri{label}")
        else:
            parts.append(f"{cur}[a{i}]concat=n=2:v=0:a=1{label}")
        cur = label
    parts.append(f"{cur}anull[orig]")
    return ";".join(parts)


def build_audio_graph(
    mode: str,
    *,
    music_idx: int | None,
    voice_idx: int | None,
    segments: list[Segment],
    plans: list[SegmentPlan],
    duration: float,
    style: EditingStyle,
    cfg: RenderConfig,
    voice: VoiceTrack | None,
    music_volume: float = 1.0,
    fade_in: float | None = None,
    fade_out: float | None = None,
) -> str | None:
    """The audio filter graph ending in ``[a]`` (None = no audio at all)."""
    fin = finish_chain(duration, cfg)
    if mode == "none":
        return None
    if mode == "original":
        return f"{original_audio_graph(segments, plans)};[orig]{fin}[a]"

    has_voice = mode in ("voice", "voice_music") and voice is not None and voice_idx is not None
    has_music = mode in ("music", "voice_music") and music_idx is not None
    if has_voice and has_music:
        assert voice is not None
        g = f"[{music_idx}:a]{music_chain(duration, style, music_volume, fade_in, fade_out)}[mus];[{voice_idx}:a]{voice_chain(voice, duration)}[vo];"
        if voice.duck_music:
            # the music dips while the voice speaks and swells back afterwards
            g += ("[vo]asplit=2[vsc][vmx];"
                  "[mus][vsc]sidechaincompress=threshold=0.04:ratio=9:attack=20:release=500:makeup=1[duck];"
                  "[duck][vmx]amix=inputs=2:duration=longest:normalize=0[mix];")  # fmt: skip
        else:
            g += "[mus][vo]amix=inputs=2:duration=longest:normalize=0[mix];"
        return g + f"[mix]{fin}[a]"
    if has_voice:
        assert voice is not None
        return f"[{voice_idx}:a]{voice_chain(voice, duration)},{fin}[a]"
    if has_music:
        return f"[{music_idx}:a]{music_chain(duration, style, music_volume, fade_in, fade_out)},{fin}[a]"
    return None
