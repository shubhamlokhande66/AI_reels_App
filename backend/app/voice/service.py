"""Script -> voice-over: synthesise each line, join with natural pauses, and report exact timings.

Timings come from the *measured* length of every synthesised line, not an estimate, so captions and
the Reel's duration can follow the real voice (Requirement 13).
"""

from __future__ import annotations

import tempfile
from dataclasses import dataclass
from pathlib import Path

from app.core.errors import ValidationFailed
from app.core.ffmpeg import probe, run_ffmpeg
from app.models.timeline import VoiceLine
from app.voice.base import SpeechSettings, VoiceProvider, build_ssml

MAX_LINES = 40
MAX_LINE_CHARS = 400
WORDS_PER_MINUTE = 150  # estimation only, before the real voice is generated


@dataclass
class ScriptLine:
    text: str
    pause_after: float | None = None  # None = the profile's pause style


@dataclass
class VoiceResult:
    path: Path
    duration: float
    lines: list[VoiceLine]  # times relative to the start of the voice file


def estimate_seconds(lines: list[ScriptLine], settings: SpeechSettings | None = None) -> float:
    """Rough duration before synthesis (used by the script editor's live counter)."""
    s = settings or SpeechSettings()
    speed = s.prosody()[0]
    words = sum(len(ln.text.split()) for ln in lines)
    pauses = sum(ln.pause_after if ln.pause_after is not None else s.pause_seconds for ln in lines[:-1])
    return round(words / (WORDS_PER_MINUTE * speed) * 60 + pauses, 2)


def validate_lines(lines: list[ScriptLine]) -> list[ScriptLine]:
    clean = [ScriptLine(ln.text.strip(), ln.pause_after) for ln in lines if ln.text and ln.text.strip()]
    if not clean:
        raise ValidationFailed("The script is empty.", code="EMPTY_SCRIPT")
    if len(clean) > MAX_LINES or any(len(ln.text) > MAX_LINE_CHARS for ln in clean):
        raise ValidationFailed(f"A script can have at most {MAX_LINES} lines of {MAX_LINE_CHARS} characters.",
                               code="SCRIPT_TOO_LONG")  # fmt: skip
    return clean


def synthesize_script(
    provider: VoiceProvider, lines: list[ScriptLine], voice_id: str, settings: SpeechSettings, language_tag: str,
    out: Path,
) -> VoiceResult:
    """One WAV for the whole script. Every line is spoken separately so pauses and timings are exact."""
    lines = validate_lines(lines)
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="reel_voice_") as tmp:
        tmpd = Path(tmp)
        wavs: list[Path] = []
        durations: list[float] = []
        for i, ln in enumerate(lines):
            wav = tmpd / f"l{i:02d}.wav"
            provider.synthesize(build_ssml(ln.text, settings, language_tag), voice_id, wav)
            durations.append(float(probe(wav)["format"]["duration"]))
            wavs.append(wav)

        pauses = [
            (ln.pause_after if ln.pause_after is not None else settings.pause_seconds) if i < len(lines) - 1 else 0.0
            for i, ln in enumerate(lines)
        ]  # fmt: skip
        args: list[str] = []
        parts: list[str] = []
        n = 0
        for wav, pause in zip(wavs, pauses):
            args += ["-i", str(wav)]
            parts.append(f"[{n}:a]aformat=sample_rates=24000:channel_layouts=mono[p{n}]")
            n += 1
            if pause > 0:
                args += ["-f", "lavfi", "-t", f"{pause:.3f}", "-i", "anullsrc=r=24000:cl=mono"]
                parts.append(f"[{n}:a]aformat=sample_rates=24000:channel_layouts=mono[p{n}]")
                n += 1
        graph = ";".join(parts) + ";" + "".join(f"[p{i}]" for i in range(n)) + f"concat=n={n}:v=0:a=1[out]"
        run_ffmpeg([*args, "-filter_complex", graph, "-map", "[out]", "-c:a", "pcm_s16le", str(out)], timeout=120,
                   error_code="VOICE_ASSEMBLY_FAILED")  # fmt: skip

    timeline: list[VoiceLine] = []
    t = 0.0
    for ln, dur, pause in zip(lines, durations, pauses):
        timeline.append(VoiceLine(text=ln.text, start=round(t, 3), end=round(t + dur, 3)))
        t += dur + pause
    total = float(probe(out)["format"]["duration"])
    return VoiceResult(path=out, duration=round(total, 3), lines=timeline)
