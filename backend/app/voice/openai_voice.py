"""Natural AI voices from OpenAI text-to-speech (needs OPENAI_API_KEY). One voice speaks every language (Hindi,
Marathi, English ...). ``gpt-4o-mini-tts`` also takes a short instruction about *how* to speak ("calm storyteller,
a little slower"), built from the app's speed / pitch / emotion. Each request returns a WAV file. The key is sent in
a header, never in the address."""

from __future__ import annotations

import time
from pathlib import Path

import httpx

from app.core.config import get_settings
from app.voice.base import VoiceInfo, VoiceProvider, VoiceUnavailable
from app.voice.gemini import MAX_WAIT, RATE_LIMIT_TRIES, VoiceQuotaExhausted, ssml_to_text

API = "https://api.openai.com/v1/audio/speech"
PREFIX = "openai:"
MAX_CHARS = 4096  # one request; longer text is read in parts and joined

# OpenAI's built-in voices (name, character, gender)
VOICES = (
    ("onyx", "deep", "male"), ("ash", "warm", "male"), ("echo", "calm", "male"), ("ballad", "storyteller", "male"),
    ("verse", "expressive", "male"), ("fable", "narrator", "male"), ("alloy", "neutral", "female"), ("coral", "bright", "female"),
    ("nova", "friendly", "female"), ("sage", "soft", "female"), ("shimmer", "clear", "female"),
)  # fmt: skip


def instructions(speed: float, pitch: float) -> str:
    """How to speak, in words (gpt-4o-mini-tts follows them; the other models ignore them)."""
    parts = ["Speak naturally, like a warm storyteller, with clear pronunciation of Indian names and words"]
    if speed >= 1.08:
        parts.append("a little faster, with energy")
    elif speed <= 0.94:
        parts.append("calmly and a little slower, with short dramatic pauses between sentences")
    if pitch <= -5:
        parts.append("in a lower, serious tone")
    elif pitch >= 5:
        parts.append("brightly")
    return ", ".join(parts) + "."


class OpenAIVoiceProvider(VoiceProvider):
    name = "openai"
    voice_prefix = PREFIX

    def _key(self) -> str:
        return get_settings().openai_api_key.get_secret_value()

    def available(self) -> bool:
        return bool(self._key())

    def list_voices(self) -> list[VoiceInfo]:
        if not self.available():
            return []
        return [VoiceInfo(id=f"{PREFIX}{n}", name=f"{n.title()} · {c} (OpenAI, any language)", language="multi", gender=g, provider=self.name)
                for n, c, g in VOICES]  # fmt: skip

    def find_voice(self, language: str, preferred: str | None = None) -> VoiceInfo:
        voices = self.list_voices()
        if not voices:
            raise VoiceUnavailable("OpenAI voices need an OpenAI API key.")
        return next((v for v in voices if preferred in (v.id, v.name)), voices[0])

    def _request(self, text: str, voice: str, how: str) -> bytes:
        s = get_settings()
        body = {"model": s.openai_tts_model, "voice": voice, "input": text, "response_format": "wav"}
        if "tts-1" not in s.openai_tts_model:
            body["instructions"] = how
        headers = {"Authorization": f"Bearer {self._key()}"}
        for attempt in range(RATE_LIMIT_TRIES):
            try:
                r = httpx.post(API, headers=headers, json=body, timeout=180)
            except httpx.HTTPError as exc:
                raise VoiceUnavailable("The OpenAI voice service could not be reached.") from exc
            if r.status_code == 429:
                err = (r.json().get("error") or {}) if r.headers.get("content-type", "").startswith("application/json") else {}
                if err.get("code") == "insufficient_quota" or err.get("type") == "insufficient_quota":
                    raise VoiceQuotaExhausted("The OpenAI account has no credit left. Add credit on platform.openai.com, then try again.")
                if attempt < RATE_LIMIT_TRIES - 1:
                    time.sleep(min(float(r.headers.get("retry-after", "5") or 5) + 1, MAX_WAIT))
                    continue
                raise VoiceUnavailable("The OpenAI voice service is busy. Try again in a minute.", code="VOICE_RATE_LIMITED")
            if r.status_code == 401:
                raise VoiceUnavailable("The OpenAI API key was refused. Check OPENAI_API_KEY.", code="VOICE_KEY_INVALID")
            if r.status_code != 200:
                raise VoiceUnavailable(f"The OpenAI voice service refused the request ({r.status_code}).", details=r.text[-300:])
            return r.content
        raise VoiceUnavailable("The OpenAI voice service is busy. Try again in a minute.", code="VOICE_RATE_LIMITED")

    def synthesize(self, ssml: str, voice_id: str, out: Path) -> None:
        name = voice_id.removeprefix(PREFIX)
        if name not in {n for n, _, _ in VOICES}:  # never pass an unvalidated name on
            raise VoiceUnavailable(f"The voice '{voice_id[:60]}' does not exist.")
        text, speed, pitch = ssml_to_text(ssml)
        if not text:
            raise VoiceUnavailable("Nothing to say on this line.")
        how = instructions(speed, pitch)
        parts, cur = [], ""
        for para in text.replace("।", "। ").split("\n"):
            if len(cur) + len(para) + 1 > MAX_CHARS and cur:
                parts.append(cur)
                cur = ""
            cur = f"{cur}\n{para}".strip()
        if cur:
            parts.append(cur)
        wavs = [self._request(p[:MAX_CHARS], name, how) for p in parts]
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(wavs[0] if len(wavs) == 1 else _join_wavs(wavs))


def _join_wavs(wavs: list[bytes]) -> bytes:
    """Several WAV files as one (soundfile copes with the streaming-style headers the service may send)."""
    import io

    import numpy as np
    import soundfile as sf

    parts, rate = [], 24000
    for w in wavs:
        data, rate = sf.read(io.BytesIO(w), dtype="float32", always_2d=True)
        parts.append(data.mean(axis=1))
    buf = io.BytesIO()
    sf.write(buf, np.concatenate(parts), rate, format="WAV")
    return buf.getvalue()
