"""Voice provider interface + prosody (speed / pitch / energy / emotion) and SSML building."""

from __future__ import annotations

import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from xml.sax.saxutils import escape

from app.core.errors import AppError


class VoiceUnavailable(AppError):
    status_code = 503
    code = "VOICE_UNAVAILABLE"


class VoiceLanguageUnavailable(AppError):
    status_code = 422
    code = "VOICE_LANGUAGE_UNAVAILABLE"


@dataclass(frozen=True)
class VoiceInfo:
    id: str  # what the provider calls it (e.g. "Microsoft Zira Desktop")
    name: str
    language: str  # BCP-47, e.g. "en-US", "hi-IN"
    gender: str = ""
    provider: str = ""


# emotion -> (speed multiplier, pitch percent, volume 0..100)
EMOTIONS: dict[str, tuple[float, float, int]] = {
    "neutral": (1.00, 0.0, 90),
    "friendly": (1.03, 4.0, 92),
    "energetic": (1.12, 8.0, 100),
    "calm": (0.92, -3.0, 82),
    "serious": (0.95, -6.0, 90),
}
ENERGY = {"low": (0.95, -3), "medium": (1.0, 0), "high": (1.06, 6)}  # (speed multiplier, volume delta)
PAUSES = {"tight": 0.18, "natural": 0.42, "dramatic": 0.85}  # seconds between lines


@dataclass
class SpeechSettings:
    """Everything that shapes how a line sounds. Independent of the engine."""

    speed: float = 1.0  # 0.5..2.0 speaking speed
    pitch: float = 0.0  # extra pitch in percent, -30..30
    energy: str = "medium"
    emotion: str = "neutral"
    pause_style: str = "natural"
    pronunciations: dict[str, str] = field(default_factory=dict)  # written word -> how to say it

    def prosody(self) -> tuple[float, float, int]:
        em_speed, em_pitch, em_vol = EMOTIONS.get(self.emotion, EMOTIONS["neutral"])
        en_speed, en_vol = ENERGY.get(self.energy, ENERGY["medium"])
        speed = min(max(self.speed * em_speed * en_speed, 0.5), 2.0)
        return speed, min(max(self.pitch + em_pitch, -30), 30), min(max(em_vol + en_vol, 0), 100)

    @property
    def pause_seconds(self) -> float:
        return PAUSES.get(self.pause_style, PAUSES["natural"])


def apply_pronunciations(text: str, table: dict[str, str]) -> str:
    """XML-escape ``text`` and swap listed words for ``<sub alias=...>`` (whole words, case-insensitive)."""
    out = escape(text)
    for word, alias in table.items():
        if not word.strip() or not alias.strip():
            continue
        out = re.sub(
            rf"(?<!\w){re.escape(escape(word))}(?!\w)",
            lambda m, a=alias: f'<sub alias="{escape(a, {chr(34): "&quot;"})}">{m.group(0)}</sub>',
            out, flags=re.IGNORECASE,
        )  # fmt: skip
    return out


def build_ssml(text: str, settings: SpeechSettings, language: str = "en-US") -> str:
    """One line of speech as SSML. Rate/pitch/volume are relative so every engine can honour them."""
    speed, pitch, volume = settings.prosody()
    rate = f"{(speed - 1) * 100:+.0f}%"
    return (
        f'<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="{escape(language)}">'
        f'<prosody rate="{rate}" pitch="{pitch:+.0f}%" volume="{volume}">'
        f"{apply_pronunciations(text, settings.pronunciations)}</prosody></speak>"
    )


class VoiceProvider(ABC):
    name: str

    @abstractmethod
    def available(self) -> bool: ...

    @abstractmethod
    def list_voices(self) -> list[VoiceInfo]: ...

    @abstractmethod
    def synthesize(self, ssml: str, voice_id: str, out: Path) -> None:
        """Write a WAV for ``ssml`` using ``voice_id``. Raises ``VoiceUnavailable`` on failure."""

    def find_voice(self, language: str, preferred: str | None = None) -> VoiceInfo:
        """A voice that can speak ``language`` ('en', 'hi', 'mr', 'hinglish' ...)."""
        voices = self.list_voices()
        lang = {"hinglish": "en"}.get(language.lower(), language.lower()).split("-")[0]
        if preferred:
            for v in voices:
                if v.id == preferred or v.name == preferred:
                    if v.language.lower().startswith(lang):
                        return v
                    break
        for v in voices:
            if v.language.lower().startswith(lang):
                return v
        installed = ", ".join(f"{v.name} ({v.language})" for v in voices) or "none"
        raise VoiceLanguageUnavailable(
            f"No installed voice can speak '{language}'. Installed voices: {installed}. "
            "Install a voice pack for that language (or add another voice engine).",
            details={"language": language, "installed": [v.id for v in voices]},
        )
