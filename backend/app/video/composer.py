"""Join the cut segments: transitions, colour/fades, music mix, final H.264/AAC encode."""

from __future__ import annotations

from pathlib import Path

from app.models.timeline import Segment, VoiceTrack, Watermark
from app.styles.base import EditingStyle
from app.video import transitions as tr
from app.video.audio_mix import STEREO, build_audio_graph, finish_chain, music_chain, original_audio_graph
from app.video.cutter import RenderConfig, SegmentPlan
from app.video.hardware import encoder_args

# Every input is normalised to the same timebase/fps/format so xfade and concat accept them.
_NORM = "settb=AVTB,setpts=PTS-STARTPTS,fps={fps},format=yuv420p,setsar=1"


def build_video_graph(
    segments: list[Segment], plans: list[SegmentPlan], cfg: RenderConfig
) -> tuple[str, float]:
    """Filter graph joining ``[0:v]..[n-1:v]`` into ``[vjoin]``. Returns (graph, joined_length)."""
    parts = [f"[{i}:v]{_NORM.format(fps=cfg.fps)}[s{i}]" for i in range(len(segments))]
    cur, cur_len = "[s0]", plans[0].out_length
    for i in range(1, len(segments)):
        t = segments[i].transition_in
        spec = tr.get_transition(t.type)
        label = f"[j{i}]"
        if spec.kind == "xfade" and t.duration > 0:
            offset = cur_len - t.duration  # the previous segment's tail is the overlap
            parts.append(
                f"{cur}[s{i}]xfade=transition={spec.xfade}:duration={t.duration:.3f}:offset={offset:.3f}"
                f",settb=AVTB,fps={cfg.fps}{label}"
            )
            cur_len += plans[i].out_length - t.duration
        else:
            parts.append(f"{cur}[s{i}]concat=n=2:v=1:a=0,settb=AVTB,fps={cfg.fps}{label}")
            cur_len += plans[i].out_length
        cur = label
    parts.append(f"{cur}null[vjoin]")
    return ";".join(parts), cur_len


def build_chunk_command(
    segments: list[Segment], plans: list[SegmentPlan], segment_files: list[Path], out: Path, cfg: RenderConfig, with_audio: bool
) -> tuple[list[str], float]:
    """Join a run of shots into one intermediate file (long Reels are composed in chunks, then the chunks are joined).

    Uses the same transitions as the flat join, so joining chunks with the boundary transition gives the same picture.
    The intermediate is near-lossless and quick to encode; the final encode happens once, at the end.
    """
    graph, length = build_video_graph(segments, plans, cfg)
    graph += ";[vjoin]format=yuv420p[v]"
    args: list[str] = []
    for f in segment_files:
        args += ["-i", str(f)]
    if with_audio:
        graph += f";{original_audio_graph(segments, plans)};[orig]{STEREO}[a]"
    args += ["-filter_complex", graph, "-map", "[v]"]
    args += ["-map", "[a]"] if with_audio else ["-an"]
    args += ["-t", f"{length:.3f}", "-c:v", "libx264", "-crf", "12", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-r", str(cfg.fps)]
    if with_audio:
        args += ["-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-ac", "2"]
    args += [str(out)]
    return args, length


WM_MARGIN = {"br": ("W-w-{mx}", "H-h-{my}"), "bl": ("{mx}", "H-h-{my}"), "tr": ("W-w-{mx}", "{mt}"), "tl": ("{mx}", "{mt}"),
             "center": ("(W-w)/2", "(H-h)/2")}  # fmt: skip


def watermark_filter(idx: int, wm: Watermark, cfg: RenderConfig) -> str:
    """Overlay the logo. The margins keep it out of the zones Reels' own buttons and caption cover."""
    x, y = WM_MARGIN[wm.position]
    x = x.format(mx=int(cfg.width * 0.04), my=int(cfg.height * 0.16), mt=int(cfg.height * 0.07))
    y = y.format(mx=int(cfg.width * 0.04), my=int(cfg.height * 0.16), mt=int(cfg.height * 0.07))
    w = max(int(cfg.width * wm.scale) // 2 * 2, 8)
    return (f"[{idx}:v]format=rgba,scale={w}:-2,colorchannelmixer=aa={wm.opacity:.2f}[wm];"
            f"[vp][wm]overlay=x={x}:y={y}:shortest=1[v]")  # fmt: skip


def build_audio_filter(
    duration: float, style: EditingStyle, cfg: RenderConfig, volume: float = 1.0,
    fade_in: float | None = None, fade_out: float | None = None,
) -> str:
    """Music-only chain (kept for callers/tests that want just the filter text)."""
    return f"{music_chain(duration, style, volume, fade_in, fade_out)},{finish_chain(duration, cfg)}"


def build_compose_command(
    segments: list[Segment],
    plans: list[SegmentPlan],
    segment_files: list[Path],
    audio_path: Path | None,
    audio_start: float,
    duration: float,
    style: EditingStyle,
    cfg: RenderConfig,
    out: Path,
    video_post: list[str] | None = None,
    volume: float = 1.0,
    fade_in: float | None = None,
    fade_out: float | None = None,
    voice: VoiceTrack | None = None,
    voice_path: Path | None = None,
    watermark: Watermark | None = None,
    watermark_path: Path | None = None,
) -> list[str]:
    """Arguments for the final ffmpeg run (list form; never joined into a shell string)."""
    graph, _ = build_video_graph(segments, plans, cfg)
    post = list(video_post or [])
    if style.fade_in_out > 0:
        f = min(style.fade_in_out, duration / 4)
        post += [f"fade=t=in:st=0:d={f:.3f}", f"fade=t=out:st={duration - f:.3f}:d={f:.3f}"]
    post.append("format=yuv420p")
    args: list[str] = []
    for f in segment_files:
        args += ["-i", str(f)]
    idx = len(segment_files)
    if watermark is not None and watermark_path is not None:
        args += ["-loop", "1", "-i", str(watermark_path)]  # a still logo, repeated for every frame
        graph += f";[vjoin]{','.join(post)}[vp];{watermark_filter(idx, watermark, cfg)}"
        idx += 1
    else:
        graph += f";[vjoin]{','.join(post)}[v]"
    music_idx = voice_idx = None
    mode = cfg.audio_mode
    if mode in ("music", "voice_music") and audio_path is not None:
        args += ["-ss", f"{audio_start:.3f}", "-t", f"{duration + 0.5:.3f}", "-i", str(audio_path)]
        music_idx, idx = idx, idx + 1
    if mode in ("voice", "voice_music") and voice is not None and voice_path is not None:
        args += ["-i", str(voice_path)]
        voice_idx, idx = idx, idx + 1
    agraph = build_audio_graph(
        mode, music_idx=music_idx, voice_idx=voice_idx, segments=segments, plans=plans, duration=duration, style=style,
        cfg=cfg, voice=voice, music_volume=volume, fade_in=fade_in, fade_out=fade_out,
    )  # fmt: skip
    if agraph:
        graph += ";" + agraph

    args += ["-filter_complex", graph, "-map", "[v]"]
    args += ["-map", "[a]"] if agraph else ["-an"]
    args += ["-t", f"{duration:.3f}", *encoder_args(cfg.encoder, cfg.final_crf, cfg.final_preset),
             "-pix_fmt", "yuv420p", "-r", str(cfg.fps), "-maxrate", cfg.max_bitrate, "-bufsize", "24M"]  # fmt: skip
    if agraph:
        args += ["-c:a", "aac", "-b:a", cfg.audio_bitrate, "-ar", "48000", "-ac", "2"]
    args += ["-movflags", "+faststart", str(out)]
    return args
