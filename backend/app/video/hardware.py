"""Hardware video encoders. Never assumed: an encoder is used only if a real test encode succeeds."""

from __future__ import annotations

import logging
import subprocess
import threading

from app.core.config import get_settings
from app.core.ffmpeg import find_binary

log = logging.getLogger(__name__)

CPU = "libx264"
# In order of preference
CANDIDATES = ("h264_nvenc", "h264_videotoolbox", "h264_qsv", "h264_amf")
LABELS = {
    "libx264": "CPU (x264)", "h264_nvenc": "NVIDIA NVENC", "h264_videotoolbox": "Apple VideoToolbox",
    "h264_qsv": "Intel Quick Sync", "h264_amf": "AMD AMF",
}  # fmt: skip

_cache: dict[str, bool] = {}
_lock = threading.Lock()


def _listed(name: str) -> bool:
    try:
        out = subprocess.run([find_binary("ffmpeg"), "-hide_banner", "-encoders"], capture_output=True, text=True,
                             timeout=15).stdout  # fmt: skip
    except (subprocess.SubprocessError, OSError):
        return False
    return f" {name} " in out


def works(encoder: str) -> bool:
    """True only if FFmpeg lists the encoder *and* it can encode a frame on this machine."""
    if encoder == CPU:
        return True
    with _lock:
        if encoder in _cache:
            return _cache[encoder]
    ok = False
    if _listed(encoder):
        try:
            r = subprocess.run(
                [find_binary("ffmpeg"), "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
                 "color=c=black:size=256x256:rate=30:duration=0.2", "-c:v", encoder, "-f", "null", "-"],
                capture_output=True, timeout=20,
            )  # fmt: skip
            ok = r.returncode == 0
        except (subprocess.SubprocessError, OSError):
            ok = False
    with _lock:
        _cache[encoder] = ok
    return ok


def available_encoders() -> list[str]:
    return [CPU] + [e for e in CANDIDATES if works(e)]


def pick_encoder(setting: str | None = None) -> str:
    """``HW_ACCEL``: off | auto | <encoder name>. Anything unusable falls back to the CPU."""
    choice = (setting if setting is not None else get_settings().hw_accel).strip().lower()
    if choice in ("", "off", "cpu", CPU):
        return CPU
    if choice == "auto":
        return next((e for e in CANDIDATES if works(e)), CPU)
    if choice in CANDIDATES and works(choice):
        return choice
    log.warning("HW_ACCEL=%s is not usable on this machine; using the CPU encoder", choice)
    return CPU


def encoder_args(encoder: str, crf: int, preset: str) -> list[str]:
    """Video-encoder arguments for the final encode."""
    if encoder == "h264_nvenc":
        return ["-c:v", encoder, "-preset", "p5", "-rc", "vbr", "-cq", str(crf + 2), "-b:v", "0", "-profile:v", "high"]
    if encoder == "h264_qsv":
        return ["-c:v", encoder, "-global_quality", str(crf + 2), "-preset", "medium", "-profile:v", "high"]
    if encoder == "h264_amf":
        return ["-c:v", encoder, "-quality", "quality", "-rc", "cqp", "-qp_i", str(crf + 2), "-qp_p", str(crf + 2)]
    if encoder == "h264_videotoolbox":
        return ["-c:v", encoder, "-q:v", str(max(30, 90 - crf * 2)), "-profile:v", "high"]
    return ["-c:v", CPU, "-preset", preset, "-crf", str(crf), "-profile:v", "high", "-level", "4.2"]
