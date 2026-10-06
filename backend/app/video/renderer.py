"""Render orchestration: timeline -> real MP4 on disk."""

from __future__ import annotations

import logging
import shutil
import time
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Callable, Mapping

from app.core.errors import FFmpegError, InsufficientStorage, RenderTimeout, ValidationFailed
from app.core.ffmpeg import probe, run_ffmpeg
from app.models.timeline import Segment, Timeline
from app.styles.base import EditingStyle
from app.video.composer import build_chunk_command, build_compose_command
from app.video.grades import grade_filter
from app.video.cutter import RenderConfig, SegmentPlan, SourceClip, build_segment_command, plan_segments

log = logging.getLogger(__name__)

ProgressFn = Callable[[float], None]
SEGMENT_SHARE = 0.7  # share of the progress bar used by cutting; the rest is the final encode
CHUNK_AT = 24  # Reels with more shots than this are joined in chunks (one giant filter graph gets slow and memory hungry)
CHUNK_SIZE = 16
CHUNK_SHARE = 0.15  # progress share of the chunk joins (only for long Reels)
MIN_FREE_BYTES = 512 * 1024 * 1024


@dataclass
class RenderResult:
    path: Path
    duration: float
    width: int
    height: int
    size: int


def estimate_disk_need(timeline: Timeline, cfg: RenderConfig) -> int:
    """Rough bytes for intermediates + output (intermediates are ~ crf14 veryfast)."""
    pixels = cfg.width * cfg.height * cfg.fps
    return int(timeline.duration * pixels * 0.35 / 8 * 1.3) + 50 * 1024 * 1024


def compose_chunks(
    files: list[Path], segments: list[Segment], plans: list[SegmentPlan], cfg: RenderConfig, work_dir: Path,
    remaining: Callable[[], float], on_progress: Callable[[float], None], with_audio: bool,
) -> tuple[list[Path], list[Segment], list[SegmentPlan]]:
    """Join shots in runs of CHUNK_SIZE. Returns the chunk files plus stand-in segments/plans for the final join."""
    n = len(segments)
    bounds = [(a, min(a + CHUNK_SIZE, n)) for a in range(0, n, CHUNK_SIZE)]
    out_files: list[Path] = []
    sup_segs: list[Segment] = []
    sup_plans: list[SegmentPlan] = []
    t = 0.0
    for k, (a, b) in enumerate(bounds):
        out = work_dir / f"chunk_{k:03d}.mp4"
        cmd, length = build_chunk_command(segments[a:b], plans[a:b], files[a:b], out, cfg, with_audio)
        run_ffmpeg(cmd, timeout=remaining(), expected_duration=length)
        for f in files[a:b]:
            f.unlink(missing_ok=True)  # the shots are inside the chunk now; give the disk space back
        last = plans[b - 1]
        plan = SegmentPlan(length=round(length - last.tail, 4), tail=last.tail, ramp=last.ramp)
        sup_plans.append(plan)
        sup_segs.append(Segment(clip_id=f"chunk{k}", video=f"chunk {k + 1}", source_start=0.0, source_end=length, timeline_start=t,
                                timeline_end=t + plan.length, transition_in=segments[a].transition_in))  # fmt: skip
        t += plan.length
        out_files.append(out)
        on_progress((k + 1) / len(bounds))
    return out_files, sup_segs, sup_plans


def render_timeline(
    timeline: Timeline,
    sources: Mapping[str, SourceClip],
    audio_path: Path | None,
    out_path: Path,
    work_dir: Path,
    style: EditingStyle,
    cfg: RenderConfig,
    progress: ProgressFn | None = None,
    timeout: float = 900,
    video_post: list[str] | None = None,
    free_bytes: Callable[[], int] | None = None,
    voice_path: Path | None = None,
    watermark_path: Path | None = None,
) -> RenderResult:
    if not timeline.segments:
        raise ValidationFailed("The timeline has no segments to render.", code="EMPTY_TIMELINE")
    missing = {s.clip_id for s in timeline.segments} - set(sources)
    if missing:
        raise ValidationFailed(f"Missing source clips: {sorted(missing)}", code="MISSING_SOURCE")

    work_dir.mkdir(parents=True, exist_ok=True)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    need = estimate_disk_need(timeline, cfg) + MIN_FREE_BYTES
    free = (free_bytes or (lambda: shutil.disk_usage(work_dir).free))()
    if free < need:
        raise InsufficientStorage(
            "Not enough free disk space to render.",
            details={"neededBytes": need, "freeBytes": free},
        )

    last = 0.0

    def report(fraction: float) -> None:
        """Forward progress, never letting the bar move backwards (ffmpeg's clock can dip)."""
        nonlocal last
        last = max(last, min(max(fraction, 0.0), 1.0))
        if progress:
            progress(last)

    deadline = time.monotonic() + timeout

    def remaining() -> float:
        left = deadline - time.monotonic()
        if left <= 0:
            raise RenderTimeout(f"Rendering exceeded the {int(timeout)}s time limit.")
        return left

    hits = [h - timeline.audio_start for h in timeline.music_hits] if cfg.audio_mode in ("music", "voice_music") else []
    plans = plan_segments(timeline.segments, hits)  # beat-reactive effects follow the song part that is playing
    n = len(timeline.segments)
    grade = grade_filter(timeline.color_grade, style.grade_filter)  # a chosen preset, else the style's own grade
    chunked = n > CHUNK_AT
    cut_share = SEGMENT_SHARE - (CHUNK_SHARE if chunked else 0.0)
    files: list[Path] = []
    try:
        for i, (seg, plan) in enumerate(zip(timeline.segments, plans)):
            out = work_dir / f"seg_{i:03d}.mp4"
            cmd = build_segment_command(seg, sources[seg.clip_id], out, plan, cfg, grade)
            run_ffmpeg(cmd, timeout=remaining(), expected_duration=plan.out_length)
            files.append(out)
            report(cut_share * (i + 1) / n)

        comp_segments, comp_plans = timeline.segments, plans
        if chunked:
            files, comp_segments, comp_plans = compose_chunks(
                files, timeline.segments, plans, cfg, work_dir, remaining,
                lambda f: report(cut_share + CHUNK_SHARE * f), with_audio=cfg.audio_mode == "original",
            )  # fmt: skip
        final_from = cut_share + (CHUNK_SHARE if chunked else 0.0)

        tmp_out = work_dir / "final.mp4"
        sfx_path = None
        if timeline.sfx and cfg.audio_mode != "none":
            from app.audio.sfx import synth_track

            sfx_path = synth_track(timeline.sfx, timeline.duration, work_dir / "sfx.wav")

        def compose(c: RenderConfig) -> None:
            cmd = build_compose_command(
                comp_segments, comp_plans, files, audio_path, timeline.audio_start, timeline.duration,
                style, c, tmp_out, video_post, volume=timeline.music_volume,
                fade_in=timeline.music_fade_in, fade_out=timeline.music_fade_out,
                voice=timeline.voice, voice_path=voice_path,
                watermark=timeline.watermark, watermark_path=watermark_path, sfx_path=sfx_path,
            )  # fmt: skip
            run_ffmpeg(
                cmd, timeout=remaining(), expected_duration=timeline.duration,
                on_progress=lambda f: report(final_from + (1 - final_from) * f),
            )

        try:
            compose(cfg)
        except FFmpegError:
            if cfg.encoder == "libx264":
                raise
            log.warning("hardware encoder %s failed; retrying with the CPU encoder", cfg.encoder)
            compose(replace(cfg, encoder="libx264"))
        shutil.move(str(tmp_out), str(out_path))
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)  # never leave intermediates behind

    info = probe(out_path)
    v = next(s for s in info["streams"] if s["codec_type"] == "video")
    report(1.0)
    return RenderResult(
        path=out_path,
        duration=float(info["format"]["duration"]),
        width=int(v["width"]),
        height=int(v["height"]),
        size=out_path.stat().st_size,
    )
