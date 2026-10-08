"""Natural AI voices from Gemini text-to-speech (needs GEMINI_API_KEY). Multilingual: one voice speaks English, Hindi,
Marathi and more, so a language never needs a voice pack.

The app builds SSML for every line (pauses, pronunciations, prosody). Gemini takes plain text with a spoken style
direction, so the SSML is turned back into text (pronunciation aliases applied) and its speed / pitch / volume become a
short direction ("Say it a little faster, brightly"). Each line is one request; the result is a WAV file.
"""

from __future__ import annotations

import base64
import io
import re
import time
import wave
from pathlib import Path
from xml.sax.saxutils import unescape

import httpx

from app.core.config import get_settings
from app.voice.base import VoiceInfo, VoiceProvider, VoiceUnavailable

API = "https://generativelanguage.googleapis.com/v1beta/models"
PREFIX = "gemini:"
RATE_LIMIT_TRIES = 4  # the free tier allows only a few voice lines a minute: wait and retry instead of losing the line
MAX_WAIT = 60.0


class VoiceQuotaExhausted(VoiceUnavailable):
    """The voice service's limit for today (or a long wait) is reached: retrying now cannot help."""

    code = "VOICE_DAILY_LIMIT"


def rate_limit(r: httpx.Response) -> tuple[float, bool]:
    """(seconds the service asks to wait, whether it is a daily quota) from a 429 reply."""
    wait, daily = 20.0, False
    try:
        for d in r.json().get("error", {}).get("details", []):
            if str(d.get("@type", "")).endswith("RetryInfo") and d.get("retryDelay"):
                wait = float(str(d["retryDelay"]).rstrip("s"))
            for v in d.get("violations", []) or []:
                if "PerDay" in str(v.get("quotaId", "")):
                    daily = True
    except (ValueError, AttributeError):
        pass
    return wait, daily


def retry_delay(r: httpx.Response) -> float:
    """How long to wait before trying again (the service's RetryInfo + 1 s, at most MAX_WAIT)."""
    return min(rate_limit(r)[0] + 1.0, MAX_WAIT)


# Gemini's prebuilt voices (name, character, gender)
VOICES = (
    ("Kore", "firm", "female"), ("Aoede", "breezy", "female"), ("Leda", "youthful", "female"), ("Zephyr", "bright", "female"),
    ("Autonoe", "bright", "female"), ("Callirrhoe", "easy-going", "female"), ("Despina", "smooth", "female"),
    ("Puck", "upbeat", "male"), ("Charon", "informative", "male"), ("Fenrir", "excitable", "male"), ("Orus", "firm", "male"),
    ("Enceladus", "breathy", "male"), ("Iapetus", "clear", "male"), ("Algenib", "gravelly", "male"),
)  # fmt: skip


def ssml_to_text(ssml: str) -> tuple[str, float, float]:
    """(spoken text, speed multiplier, pitch percent) from the app's SSML."""
    text = re.sub(r'<sub alias="([^"]*)">[^<]*</sub>', lambda m: unescape(m.group(1), {"&quot;": '"'}), ssml)
    rate = re.search(r'rate="([+-]?\d+(?:\.\d+)?)%"', ssml)
    pitch = re.search(r'pitch="([+-]?\d+(?:\.\d+)?)%"', ssml)
    text = unescape(re.sub(r"<[^>]+>", " ", text))
    text = re.sub(r"\s+", " ", text).strip()
    speed = 1 + float(rate.group(1)) / 100 if rate else 1.0
    return text, speed, float(pitch.group(1)) if pitch else 0.0


def direction(speed: float, pitch: float) -> str:
    parts = []
    if speed >= 1.08:
        parts.append("a little faster, with energy")
    elif speed <= 0.94:
        parts.append("calmly and a little slower")
    if pitch >= 5:
        parts.append("brightly")
    elif pitch <= -5:
        parts.append("in a lower, serious tone")
    return f"Say {', '.join(parts)}: " if parts else ""


def to_wav(data: bytes, mime: str) -> bytes:
    if data[:4] == b"RIFF":
        return data
    rate = int(m.group(1)) if (m := re.search(r"rate=(\d+)", mime)) else 24000
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:  # raw 16-bit little-endian mono PCM
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(data)
    return buf.getvalue()


class GeminiVoiceProvider(VoiceProvider):
    name = "gemini"

    def _key(self) -> str:
        return get_settings().gemini_api_key.get_secret_value()

    def available(self) -> bool:
        return bool(self._key())

    def list_voices(self) -> list[VoiceInfo]:
        if not self.available():
            return []
        return [VoiceInfo(id=f"{PREFIX}{n}", name=f"{n} · {c} (AI, any language)", language="multi", gender=g, provider=self.name)
                for n, c, g in VOICES]  # fmt: skip

    def find_voice(self, language: str, preferred: str | None = None) -> VoiceInfo:
        voices = self.list_voices()
        if not voices:
            raise VoiceUnavailable("Natural AI voices need a Gemini API key.")
        return next((v for v in voices if preferred in (v.id, v.name)), voices[0])  # every voice speaks every language

    def synthesize(self, ssml: str, voice_id: str, out: Path) -> None:
        name = voice_id.removeprefix(PREFIX)
        if name not in {n for n, _, _ in VOICES}:  # never pass an unvalidated name on
            raise VoiceUnavailable(f"The voice '{voice_id[:60]}' does not exist.")
        text, speed, pitch = ssml_to_text(ssml)
        if not text:
            raise VoiceUnavailable("Nothing to say on this line.")
        s = get_settings()
        body = {
            "contents": [{"parts": [{"text": direction(speed, pitch) + text}]}],
            "generationConfig": {"responseModalities": ["AUDIO"],
                                 "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": name}}}},
        }  # fmt: skip
        # the key goes in a header, never in the address (addresses end up in logs)
        headers = {"x-goog-api-key": self._key()}
        for attempt in range(RATE_LIMIT_TRIES):
            try:
                r = httpx.post(f"{API}/{s.gemini_tts_model}:generateContent", headers=headers, json=body, timeout=120)
            except httpx.HTTPError as exc:
                raise VoiceUnavailable("The AI voice service could not be reached.") from exc
            if r.status_code != 429 or attempt == RATE_LIMIT_TRIES - 1:
                break
            wait, daily = rate_limit(r)
            if daily or wait > MAX_WAIT:  # today's quota is used up: waiting a minute cannot help, say so at once
                raise VoiceQuotaExhausted(
                    "Today's free AI voice limit is used up (the free Gemini tier allows only a few voice requests a day). "
                    "It resets tomorrow; with billing on the Gemini key there is no daily limit."
                )
            time.sleep(retry_delay(r))  # a per-minute limit: wait as long as the service asks, then try again
        if r.status_code == 429:
            raise VoiceUnavailable("The AI voice service is busy (too many requests). Try again in a minute.", code="VOICE_RATE_LIMITED")
        if r.status_code != 200:
            raise VoiceUnavailable(f"The AI voice service refused the request ({r.status_code}).", details=r.text[-300:])
        try:
            part = r.json()["candidates"][0]["content"]["parts"][0]["inlineData"]
            audio = to_wav(base64.b64decode(part["data"]), part.get("mimeType", ""))
        except (KeyError, IndexError, ValueError) as exc:
            raise VoiceUnavailable("The AI voice service returned no audio.") from exc
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(audio)


class CombinedVoiceProvider(VoiceProvider):
    """The voices of this computer (Windows) and the natural AI voices, as one list; each line goes to its engine."""

    name = "combined"

    def __init__(self, local: VoiceProvider, ai: GeminiVoiceProvider) -> None:
        self.local, self.ai = local, ai

    def available(self) -> bool:
        return self.ai.available() or self.local.available()

    def list_voices(self) -> list[VoiceInfo]:
        return [*self.ai.list_voices(), *self.local.list_voices()]  # the natural voices first

    def find_voice(self, language: str, preferred: str | None = None) -> VoiceInfo:
        if preferred and preferred.startswith(PREFIX):
            return self.ai.find_voice(language, preferred)
        try:
            return self.local.find_voice(language, preferred)
        except Exception:  # noqa: BLE001 - no local voice for this language: a natural AI voice speaks it
            if self.ai.available():
                return self.ai.find_voice(language, preferred)
            raise

    def synthesize(self, ssml: str, voice_id: str, out: Path) -> None:
        (self.ai if voice_id.startswith(PREFIX) else self.local).synthesize(ssml, voice_id, out)
