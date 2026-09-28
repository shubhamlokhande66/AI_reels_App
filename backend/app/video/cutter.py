"""Cut one timeline segment out of a source clip and normalise it to the output format.

Each segment becomes an intermediate MP4 (no audio): cropped to 9:16, speed-adjusted, scaled
to the output size with its zoom effect, constant frame-rate. The composer then joins them.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from app.core.ffmpeg import run_ffmpeg
from app.models.timeline import Segment
from app.video import transitions as tr
from app.video.cropper import Focus, get_crop_strategy

ZOOM_AMOUNT = 0.08  # 8% push-in / pull-out over a shot
PUNCH_AMOUNT = 0.10
PUNCH_SECONDS = 0.25
PULSE_AMOUNT = 0.035  # subtle, rhythmic throughout the shot — not a hit, a heartbeat
PULSE_PERIOD = 0.6  # seconds per pulse
PAN_SCALE = 1.14  # a pan travels across a 14% larger frame: visible movement, little resolution lost
MOTION_SCALE = 1.12  # shake / roll work inside a 12% larger frame so no edge ever shows
SHAKE_AMOUNT = 0.7  # share of the spare margin the shake uses
ROLL_RADIANS = 0.035  # about 2 degrees
ROLL_PERIOD = 2.4
CRASH_AMOUNT = 0.3
CRASH_SECONDS = 0.25
KEN_BURNS_AMOUNT = 0.12
FLASH_STRENGTH = 0.55
FLASH_SECONDS = 0.2
HIT_PULSE_AMOUNT = 0.045  # zoom_pulse: a small push on every strong hit of the song
HIT_PULSE_DECAY = 0.2
HIT_PUNCH_AMOUNT = 0.09  # beat_punch: a clear punch on every hit
HIT_PUNCH_DECAY = 0.16
HIT_FLASH_STRENGTH = 0.28  # beat_flash: a light pop on every hit
HIT_FLASH_DECAY = 0.12
MAX_HITS = 40  # per shot (FFmpeg expression length)
SOURCE_MARGIN = 0.15  # read a little extra so frame rounding never leaves a short segment


@dataclass(frozen=True)
class RenderConfig:
    width: int = 1080
    height: int = 1920
    fps: int = 30
    crop_strategy: str = "smart"
    # "auto": fill 9:16 when little of the picture is lost, otherwise show it whole over a blurred backdrop.
    framing: str = "auto"  # auto | fill | fit
    fit_loss_threshold: float = 0.35  # share of the picture width a 9:16 crop may discard before we fit instead
    segment_crf: int = 14  # intermediate quality (re-encoded once more at the end)
    segment_preset: str = "veryfast"
    final_crf: int = 18
    final_preset: str = "medium"
    max_bitrate: str = "12M"
    audio_bitrate: str = "192k"
    target_lufs: int = -14
    encoder: str = "libx264"  # final encode; hardware encoders fall back to x264 on failure
    audio_mode: str = "music"  # music | voice_music | voice | original | none

    @property
    def aspect(self) -> float:
        return self.width / self.height


@dataclass(frozen=True)
class SourceClip:
    path: Path
    width: int  # display size (rotation applied)
    height: int
    name: str = ""
    # Real picture inside the frame (x, y, w, h) when the file has solid padding around it.
    content: tuple[int, int, int, int] | None = None
    has_audio: bool = False  # the source has its own sound (used by the 'original audio' mode)


@dataclass(frozen=True)
class SegmentPlan:
    """What the cutter must produce for a segment, derived from the timeline."""

    length: float  # nominal (beat-aligned) length
    tail: float  # extra length that overlaps into the next segment (xfade)
    ramp: bool  # speed-ramp the end of this shot
    hits: tuple[float, ...] = ()  # strong musical hits inside the shot (seconds into it): beat-reactive effects follow them

    @property
    def out_length(self) -> float:
        return self.length + self.tail


def plan_segments(segments: list[Segment], hits: list[float] | None = None) -> list[SegmentPlan]:
    """Derive tails/ramps: a segment must extend past its end by the *next* transition. ``hits`` are the Reel times of
    the song's strong hits; each plan gets the ones inside its shot (the first moment of a shot is the cut itself)."""
    plans: list[SegmentPlan] = []
    for i, seg in enumerate(segments):
        nxt = segments[i + 1].transition_in if i + 1 < len(segments) else None
        length = seg.timeline_end - seg.timeline_start
        tail = nxt.duration if nxt and tr.is_overlapping(nxt.type) else 0.0
        ramp = bool(nxt and tr.get_transition(nxt.type).kind == "ramp")
        inside = tuple(round(h - seg.timeline_start, 3) for h in (hits or []) if seg.timeline_start + 0.05 < h < seg.timeline_end - 0.05)
        plans.append(SegmentPlan(length=round(length, 4), tail=round(tail, 4), ramp=ramp, hits=inside[:MAX_HITS]))
    return plans


def _hit_envelope(hits: tuple[float, ...], decay: float) -> str:
    """0..1 that jumps to 1 on every hit and fades over ``decay`` seconds (``t`` = seconds into the shot)."""
    return "min(1," + "+".join(f"gte(t,{h:.3f})*max(0,1-(t-{h:.3f})/{decay})" for h in hits) + ")"


def zoom_expression(effect: str, length: float, hits: tuple[float, ...] = ()) -> str | None:
    """Scale factor as a function of the segment time ``t`` (None = no zoom). With ``hits`` the pulse effects follow the
    song's strong hits; without (no music map) they fall back to a steady rhythm / a single punch."""
    d = max(length, 0.1)
    if effect == "zoom_pulse" and hits:
        return f"(1+{HIT_PULSE_AMOUNT}*{_hit_envelope(hits, HIT_PULSE_DECAY)})"
    if effect == "beat_punch":
        if hits:
            return f"(1+{HIT_PUNCH_AMOUNT}*{_hit_envelope(hits, HIT_PUNCH_DECAY)})"
        effect = "punch"
    if effect == "zoom_in":
        return f"(1+{ZOOM_AMOUNT}*min(t/{d:.3f},1))"
    if effect == "zoom_out":
        return f"(1+{ZOOM_AMOUNT}*(1-min(t/{d:.3f},1)))"
    if effect == "punch":
        return f"(1+{PUNCH_AMOUNT}*max(0,1-t/{PUNCH_SECONDS}))"
    if effect == "punch_out":  # the mirror of punch: builds to a peak right at the cut, instead of easing off the start
        return f"(1+{PUNCH_AMOUNT}*max(0,1-({d:.3f}-t)/{PUNCH_SECONDS}))"
    if effect == "zoom_pulse":  # a small rhythmic pulse for the whole shot, not a one-off hit
        return f"(1+{PULSE_AMOUNT}*(0.5+0.5*sin(2*PI*t/{PULSE_PERIOD})))"
    if effect == "crash_zoom":  # a fast zoom in over the first moment, then holds (a "snap" onto the subject)
        return f"(1+{CRASH_AMOUNT}*min(t/{CRASH_SECONDS},1))"
    if effect == "ken_burns":  # slow push in (with a diagonal drift, see motion_chain)
        return f"(1+{KEN_BURNS_AMOUNT}*min(t/{d:.3f},1))"
    return None


def motion_chain(effect: str, w: int, h: int, length: float, hits: tuple[float, ...] = ()) -> str:
    """The scale + camera-motion filters that produce a ``w`` x ``h`` picture for ``effect`` (constant output size)."""
    d = max(length, 0.1)
    z = zoom_expression(effect, length, hits)
    if effect == "ken_burns":
        p = f"min(t/{d:.3f},1)"
        return (f"scale=w='trunc({w}*{z}/2)*2':h='trunc({h}*{z}/2)*2':eval=frame:flags=bicubic,"
                f"crop=w={w}:h={h}:x='(in_w-out_w)*{p}':y='(in_h-out_h)*(1-{p})'")
    if z:
        return f"scale=w='trunc({w}*{z}/2)*2':h='trunc({h}*{z}/2)*2':eval=frame:flags=bicubic,crop={w}:{h}"
    pan = pan_expression(effect, length)
    if pan:
        return _pan_chain(w, h, pan)
    big = f"scale=w='trunc({w}*{MOTION_SCALE}/2)*2':h='trunc({h}*{MOTION_SCALE}/2)*2':flags=bicubic"
    if effect == "shake":  # handheld energy: two unrelated frequencies so it never looks like a loop
        return (f"{big},crop=w={w}:h={h}:x='(in_w-out_w)/2*(1+{SHAKE_AMOUNT}*sin(2*PI*t*6.3))'"
                f":y='(in_h-out_h)/2*(1+{SHAKE_AMOUNT}*cos(2*PI*t*8.7))'")
    if effect == "roll":  # a gentle rotation sway (the enlarged frame keeps the corners covered)
        return f"{big},rotate=a='{ROLL_RADIANS}*sin(2*PI*t/{ROLL_PERIOD})':fillcolor=black,crop={w}:{h}"
    return f"scale={w}:{h}:flags=lanczos"


def look_filters(effect: str, hits: tuple[float, ...] = ()) -> list[str]:
    """Per-shot picture looks applied to the whole frame (time ``t`` = seconds into the shot)."""
    if effect == "beat_flash" and hits:
        return [f"eq=brightness='{HIT_FLASH_STRENGTH}*{_hit_envelope(hits, HIT_FLASH_DECAY)}':eval=frame"]
    if effect in ("flash", "beat_flash"):
        return [f"eq=brightness='{FLASH_STRENGTH}*max(0,1-t/{FLASH_SECONDS})':eval=frame"]
    if effect == "black_white":
        return ["hue=s=0"]
    return []


UPSCALE_ENHANCE_AT = 1.6  # above this upscale factor, denoise before and sharpen after scaling
BG_DOWNSCALE = 4  # the blurred backdrop is built at 1/4 size (cheap, and blurrier)


def pan_expression(effect: str, length: float) -> tuple[str, str] | None:
    """(x, y) crop expressions for a pan across an enlarged frame, eased over the shot (None = not a pan)."""
    d = max(length, 0.1)
    p = f"min(t/{d:.3f},1)"
    ease = f"(0.5-0.5*cos(PI*{p}))"  # smooth start and stop, like a slider shot
    centre_x, centre_y = "(in_w-out_w)/2", "(in_h-out_h)/2"
    return {
        "pan_right": (f"(in_w-out_w)*{ease}", centre_y),
        "pan_left": (f"(in_w-out_w)*(1-{ease})", centre_y),
        "pan_down": (centre_x, f"(in_h-out_h)*{ease}"),
        "pan_up": (centre_x, f"(in_h-out_h)*(1-{ease})"),
    }.get(effect)


def _pan_chain(w: int, h: int, xy: tuple[str, str]) -> str:
    return (f"scale=w='trunc({w}*{PAN_SCALE}/2)*2':h='trunc({h}*{PAN_SCALE}/2)*2':flags=bicubic,"
            f"crop=w={w}:h={h}:x='{xy[0]}':y='{xy[1]}'")


def choose_framing(content_w: int, content_h: int, cfg: RenderConfig) -> str:
    """'fill' (cover-crop to 9:16) or 'fit' (whole picture over a blurred backdrop)."""
    if cfg.framing in ("fill", "fit"):
        return cfg.framing
    ratio = content_w / max(content_h, 1)
    loss = 1 - min(ratio, cfg.aspect) / max(ratio, cfg.aspect)  # share of the picture a cover-crop would discard
    return "fit" if loss > cfg.fit_loss_threshold else "fill"


def _enhance(upscale: float) -> tuple[str, str]:
    """(pre-scale, post-scale) filters. Compressed low-res sources look blocky once stretched."""
    if upscale <= UPSCALE_ENHANCE_AT:
        return "", ""
    strength = min(1.0 + (upscale - UPSCALE_ENHANCE_AT) * 0.6, 3.0)
    return (
        f"hqdn3d={strength:.1f}:{strength * 0.75:.1f}:{strength * 2:.1f}:{strength * 2:.1f}",
        "unsharp=5:5:0.55:5:5:0.0",
    )


def build_filter_graph(
    seg: Segment, src: SourceClip, plan: SegmentPlan, cfg: RenderConfig, grade: str | None = None
) -> str:
    """The -filter_complex string that turns the trimmed source into the segment video."""
    W, H = cfg.width, cfg.height
    cx, cy, cw, ch = src.content or (0, 0, src.width, src.height)
    mode = seg.crop.framing if seg.crop.framing in ("fill", "fit") else choose_framing(cw, ch, cfg)
    time_chain = [f"setpts=(PTS-STARTPTS)/{seg.speed:.4f}", f"fps={cfg.fps}"]
    if mode == "fill":
        fx, fy, fsrc = seg.focus_x, seg.focus_y, seg.focus_source
        if seg.crop.focus_x is not None:  # a manual subject position beats detection
            fx, fy, fsrc = seg.crop.focus_x, seg.crop.focus_y if seg.crop.focus_y is not None else fy, "subject"
        region = get_crop_strategy(cfg.crop_strategy).compute(cw, ch, cfg.aspect, Focus(fx, fy, fsrc))
        pre, post = _enhance(max(W / max(region.w, 1), H / max(region.h, 1)))
        chain = [f"crop={region.w}:{region.h}:{cx + region.x}:{cy + region.y}", *time_chain]
        if pre:
            chain.append(pre)
        chain.append(motion_chain(seg.effect, W, H, plan.length, plan.hits))
        if post:
            chain.append(post)
        core = f"[0:v]{','.join(chain)}"
    else:
        # Whole picture, fitted inside the canvas, centred over a dimmed + blurred copy of itself.
        if cw / max(ch, 1) >= W / H:
            fw, fh = W, max(int(W * ch / cw) // 2 * 2, 2)
        else:
            fw, fh = max(int(H * cw / ch) // 2 * 2, 2), H
        pre, post = _enhance(max(fw / max(cw, 1), fh / max(ch, 1)))
        base = [f"crop={cw}:{ch}:{cx}:{cy}", *time_chain]
        if pre:
            base.append(pre)
        bw, bh = W // BG_DOWNSCALE, H // BG_DOWNSCALE
        # A zoomed picture changes size every frame; motion_chain crops it back to a constant size so later filters
        # (unsharp, overlay) never see a size change (which crashes FFmpeg).
        fg = motion_chain(seg.effect, fw, fh, plan.length, plan.hits)
        fg_chain = [fg] + ([post] if post else [])
        core = (
            f"[0:v]{','.join(base)},split[bgs][fgs];"
            f"[bgs]scale={bw}:{bh}:force_original_aspect_ratio=increase,crop={bw}:{bh},gblur=sigma=6,"
            f"eq=brightness=-0.10:saturation=1.15,scale={W}:{H}:flags=bicubic[bg];"
            f"[fgs]{','.join(fg_chain)}[fg];"
            f"[bg][fg]overlay=x=(W-w)/2:y=(H-h)/2:shortest=1"
        )
    core += ",tpad=stop_mode=clone:stop_duration=3"  # freeze the last frame if the source runs out

    if plan.ramp:
        r, f = tr.RAMP_SECONDS, tr.RAMP_FACTOR
        r = min(r, plan.length * 0.5)
        cut_at = plan.length - r
        graph = (
            f"{core}[m];[m]split[a][b];"
            f"[a]trim=start=0:end={cut_at:.3f},setpts=PTS-STARTPTS[a1];"
            f"[b]trim=start={cut_at:.3f}:end={cut_at + r * f:.3f},setpts=(PTS-STARTPTS)/{f}[b1];"
            f"[a1][b1]concat=n=2:v=1:a=0,"
        )
    else:
        graph = f"{core},"
    tail = [f"trim=duration={plan.out_length:.3f}", "setpts=PTS-STARTPTS", *look_filters(seg.effect, plan.hits)]
    if grade:
        tail.append(grade)
    tail += ["setsar=1", "format=yuv420p"]
    return graph + ",".join(tail) + "[v]"


def source_read_seconds(seg: Segment, plan: SegmentPlan) -> float:
    """How much *source* time to read: nominal + tail (+ the extra consumed by a ramp)."""
    extra = plan.tail
    if plan.ramp:
        r = min(tr.RAMP_SECONDS, plan.length * 0.5)
        extra += r * (tr.RAMP_FACTOR - 1)
    return (plan.length + extra) * seg.speed + SOURCE_MARGIN


def build_segment_command(
    seg: Segment, src: SourceClip, out: Path, plan: SegmentPlan, cfg: RenderConfig, grade: str | None = None
) -> list[str]:
    """Arguments for ffmpeg (excluding the binary and global flags). A list - never a shell string."""
    graph = build_filter_graph(seg, src, plan, cfg, grade)
    args = [
        "-ss", f"{max(seg.source_start, 0):.3f}",
        "-t", f"{source_read_seconds(seg, plan):.3f}",
        "-i", str(src.path),
    ]  # fmt: skip
    if cfg.audio_mode == "original":
        # This shot's own sound, time-stretched like the picture, padded/trimmed to the exact shot length.
        if src.has_audio:
            a_in = "[0:a]"
        else:
            args += ["-f", "lavfi", "-t", f"{plan.out_length:.3f}", "-i", "anullsrc=r=48000:cl=stereo"]
            a_in = "[1:a]"
        from app.video.audio_mix import atempo_chain

        graph += (
            f";{a_in}{atempo_chain(seg.speed)},aresample=48000,aformat=channel_layouts=stereo,apad,"
            f"atrim=duration={plan.out_length:.3f},asetpts=PTS-STARTPTS,volume={seg.volume:.3f}[a]"
        )
        audio = ["-map", "[a]", "-c:a", "aac", "-b:a", "192k", "-ar", "48000"]
    else:
        audio = ["-an"]
    return [
        *args, "-filter_complex", graph, "-map", "[v]", *audio,
        "-c:v", "libx264", "-preset", cfg.segment_preset, "-crf", str(cfg.segment_crf),
        "-pix_fmt", "yuv420p", "-r", str(cfg.fps),
        "-t", f"{plan.out_length:.3f}",
        str(out),
    ]  # fmt: skip


def cut_segment(
    seg: Segment, src: SourceClip, out: Path, plan: SegmentPlan, cfg: RenderConfig,
    grade: str | None = None, timeout: float | None = None,
) -> Path:
    run_ffmpeg(build_segment_command(seg, src, out, plan, cfg, grade), timeout=timeout)
    return out
