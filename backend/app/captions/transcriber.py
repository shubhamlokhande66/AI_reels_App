"""Speech/lyrics transcription with faster-whisper (optional dependency, loaded lazily)."""

from __future__ import annotations

import logging
import tempfile
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from app.core.config import get_settings
from app.core.errors import AppError
from app.core.ffmpeg import run_ffmpeg

log = logging.getLogger(__name__)


class CaptionsUnavailable(AppError):
    status_code = 503
    code = "CAPTIONS_UNAVAILABLE"


@dataclass(frozen=True)
class Word:
    text: str
    start: float  # seconds relative to the start of the transcribed window
    end: float


_model = None
_model_key: tuple | None = None
_lock = threading.Lock()


def _load_model():
    global _model, _model_key
    s = get_settings()
    key = (s.whisper_model, s.whisper_device, s.whisper_compute_type)
    with _lock:
        if _model is not None and _model_key == key:
            return _model
        try:
            from faster_whisper import WhisperModel
        except ImportError as exc:
            raise CaptionsUnavailable(
                "Captions need the optional faster-whisper package (pip install -r requirements-captions.txt)."
            ) from exc
        try:
            _model = WhisperModel(s.whisper_model, device=s.whisper_device, compute_type=s.whisper_compute_type)
        except Exception as exc:  # noqa: BLE001 - download/offline/device errors all mean "unavailable"
            raise CaptionsUnavailable(
                f"The Whisper model '{s.whisper_model}' could not be loaded.", details=str(exc)[:300]
            ) from exc
        _model_key = key
        return _model


def transcribe_window(
    audio_path: Path,
    start: float,
    duration: float,
    on_progress: Callable[[float], None] | None = None,
) -> list[Word]:
    """Word-level transcript of ``audio_path[start:start+duration]`` (times relative to ``start``)."""
    model = _load_model()
    s = get_settings()
    with tempfile.TemporaryDirectory(prefix="reel_asr_") as tmp:
        wav = Path(tmp) / "window.wav"
        run_ffmpeg(
            ["-ss", f"{start:.3f}", "-t", f"{duration:.3f}", "-i", str(Path(audio_path).resolve()),
             "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(wav)],
            timeout=120, error_code="AUDIO_DECODE_FAILED",
        )  # fmt: skip
        # the samples are read here (16 kHz mono float), so the model never decodes files itself: no dependency on the
        # audio-decoding library version faster-whisper was built against
        import soundfile as sf

        samples, _sr = sf.read(str(wav), dtype="float32")
        segments, _info = model.transcribe(
            samples, word_timestamps=True, vad_filter=True, language=s.whisper_language or None
        )
        words: list[Word] = []
        for seg in segments:  # generator: transcription happens as we iterate
            for w in seg.words or []:
                text = w.word.strip()
                if text:
                    words.append(Word(text, float(w.start), float(w.end)))
            if on_progress and duration > 0:
                on_progress(min(seg.end / duration, 1.0))
    return words
