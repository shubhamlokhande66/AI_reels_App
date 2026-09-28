"""Safe FFmpeg / FFprobe execution.

Rules enforced here:
  * commands are always argument *lists* (never a shell string),
  * user-provided values are only ever passed as arguments to fixed flags,
  * every run has a hard timeout and captures stderr for useful error messages.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import threading
from collections import deque
from pathlib import Path
from typing import Callable, Sequence

from app.core.config import get_settings
from app.core.errors import AppError, CorruptedMedia, FFmpegError, RenderTimeout

log = logging.getLogger(__name__)

_resolved: dict[str, str] = {}


class FFmpegNotFound(AppError):
    status_code = 503
    code = "FFMPEG_NOT_FOUND"


def _search_winget(name: str) -> str | None:
    base = os.environ.get("LOCALAPPDATA")
    if not base:
        return None
    root = Path(base) / "Microsoft" / "WinGet" / "Packages"
    if not root.is_dir():
        return None
    for hit in root.glob(f"Gyan.FFmpeg*/**/bin/{name}.exe"):
        return str(hit)
    return None


def find_binary(name: str) -> str:
    """Resolve ``ffmpeg`` / ``ffprobe``: env override -> PATH -> winget install location."""
    if name in _resolved:
        return _resolved[name]
    configured = getattr(get_settings(), f"{name}_bin", "")
    candidate = configured or shutil.which(name) or _search_winget(name)
    if not candidate or not Path(candidate).exists() and not shutil.which(candidate):
        raise FFmpegNotFound(
            f"{name} was not found. Install FFmpeg and add it to PATH, or set {name.upper()}_BIN.",
        )
    _resolved[name] = candidate
    return candidate


def reset_cache() -> None:
    _resolved.clear()


def ffmpeg_available() -> bool:
    try:
        find_binary("ffmpeg")
        find_binary("ffprobe")
        return True
    except FFmpegNotFound:
        return False


def probe(path: Path) -> dict:
    """Run ffprobe and return its JSON. Raises CorruptedMedia if the file is unreadable."""
    cmd = [
        find_binary("ffprobe"),
        "-v", "error",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        "-i", str(Path(path).resolve()),
    ]  # fmt: skip
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=60, check=False)
    except subprocess.TimeoutExpired as exc:
        raise CorruptedMedia("Timed out reading media metadata.", code="PROBE_TIMEOUT") from exc
    if proc.returncode != 0:
        raise CorruptedMedia(
            "The file could not be read as media. It may be corrupted or unsupported.",
            details=proc.stderr.decode("utf-8", "replace")[-500:],
        )
    try:
        return json.loads(proc.stdout or b"{}")
    except json.JSONDecodeError as exc:
        raise CorruptedMedia("ffprobe returned unreadable output.") from exc


ProgressCallback = Callable[[float], None]


def run_ffmpeg(
    args: Sequence[str],
    *,
    timeout: float | None = None,
    expected_duration: float | None = None,
    on_progress: ProgressCallback | None = None,
    error_code: str = "FFMPEG_RENDER_FAILED",
) -> None:
    """Run ffmpeg with ``args`` (everything after the binary name).

    ``on_progress`` receives 0..1 when ``expected_duration`` is known.
    """
    s = get_settings()
    cmd = [find_binary("ffmpeg"), "-hide_banner", "-nostdin", "-y", "-loglevel", "error"]
    if s.ffmpeg_threads:
        cmd += ["-threads", str(s.ffmpeg_threads)]
    cmd += ["-progress", "pipe:1", "-nostats", *map(str, args)]
    timeout = timeout or s.render_timeout_seconds
    log.debug("ffmpeg %s", " ".join(cmd[1:]))

    proc = subprocess.Popen(  # noqa: S603 - argument list, no shell
        cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.DEVNULL, text=True,
        encoding="utf-8", errors="replace",
    )  # fmt: skip
    tail: deque[str] = deque(maxlen=40)
    timed_out = threading.Event()

    def drain_stderr() -> None:
        assert proc.stderr is not None
        for line in proc.stderr:
            tail.append(line.rstrip())

    t = threading.Thread(target=drain_stderr, daemon=True)
    t.start()
    timer = threading.Timer(timeout, lambda: (timed_out.set(), proc.kill()))
    timer.start()
    try:
        assert proc.stdout is not None
        for line in proc.stdout:
            if on_progress and expected_duration and line.startswith("out_time_us="):
                try:
                    secs = int(line.split("=", 1)[1]) / 1_000_000
                except ValueError:
                    continue
                on_progress(max(0.0, min(secs / expected_duration, 1.0)))
        proc.wait()
    finally:
        timer.cancel()
        t.join(timeout=2)
        if proc.poll() is None:
            proc.kill()
        if proc.stdout:
            proc.stdout.close()
        if proc.stderr:
            proc.stderr.close()

    if timed_out.is_set():
        raise RenderTimeout(
            f"Rendering exceeded the {int(timeout)}s time limit.", details="\n".join(tail)
        )
    if proc.returncode != 0:
        details = "\n".join(tail) or f"ffmpeg exited with code {proc.returncode} without any message (crash)"
        message = "Video rendering failed."
        code = error_code
        low = details.lower()
        if "no space left" in low:
            code, message = "INSUFFICIENT_DISK_SPACE", "Not enough disk space to render."
        elif "unknown encoder" in low or "unsupported codec" in low or "decoder" in low and "not found" in low:
            code, message = "UNSUPPORTED_CODEC", "A video or audio codec is not supported."
        elif "invalid data found" in low or "moov atom not found" in low:
            code, message = "CORRUPTED_MEDIA", "A source file appears to be corrupted."
        raise FFmpegError(message, code=code, details=details[-1500:])
