"""Natural AI voices (Gemini TTS) next to this computer's voices: text and style from SSML, routing, languages."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.voice.base import SpeechSettings, VoiceInfo, VoiceProvider, build_ssml
from app.voice.gemini import PREFIX, CombinedVoiceProvider, GeminiVoiceProvider, direction, ssml_to_text, to_wav


def test_ssml_becomes_text_with_pronunciations_and_a_style_direction():
    s = SpeechSettings(emotion="energetic", pronunciations={"NAMORA": "na-MO-ra"})
    text, speed, pitch = ssml_to_text(build_ssml("Shop NAMORA & save", s, "en-US"))
    assert text == "Shop na-MO-ra & save" and speed > 1.05 and pitch > 0
    assert direction(speed, pitch).startswith("Say a little faster")
    assert direction(1.0, 0.0) == ""  # neutral: no direction, the voice speaks naturally


def test_raw_pcm_is_wrapped_as_wav():
    wav = to_wav(b"\x00\x00" * 2400, "audio/L16;codec=pcm;rate=24000")
    assert wav[:4] == b"RIFF" and to_wav(wav, "audio/wav") == wav


class _Local(VoiceProvider):
    name = "local"

    def available(self):
        return True

    def list_voices(self):
        return [VoiceInfo(id="Zira", name="Zira", language="en-US", provider="local")]

    def synthesize(self, ssml, voice_id, out: Path):
        out.write_bytes(b"local")


def test_combined_voices_route_by_engine_and_cover_every_language(monkeypatch, tmp_path):
    ai = GeminiVoiceProvider()
    monkeypatch.setattr(ai, "_key", lambda: "k")
    called = {}
    monkeypatch.setattr(ai, "synthesize", lambda ssml, vid, out: called.setdefault("ai", vid))
    both = CombinedVoiceProvider(_Local(), ai)
    ids = [v.id for v in both.list_voices()]
    assert ids[0].startswith(PREFIX) and "Zira" in ids  # natural voices first, this computer's voices too
    assert both.find_voice("en").id == "Zira"  # an installed voice for the language is used
    assert both.find_voice("hi").id.startswith(PREFIX)  # no Hindi voice installed: an AI voice speaks it
    both.synthesize("<speak>hi</speak>", f"{PREFIX}Kore", tmp_path / "a.wav")
    both.synthesize("<speak>hi</speak>", "Zira", tmp_path / "b.wav")
    assert called["ai"] == f"{PREFIX}Kore" and (tmp_path / "b.wav").read_bytes() == b"local"


def test_unknown_ai_voice_is_refused(monkeypatch, tmp_path):
    from app.voice.base import VoiceUnavailable

    ai = GeminiVoiceProvider()
    monkeypatch.setattr(ai, "_key", lambda: "k")
    with pytest.raises(VoiceUnavailable):
        ai.synthesize("<speak>hi</speak>", f"{PREFIX}NotAVoice", tmp_path / "x.wav")


def test_rate_limited_voice_waits_and_retries_with_the_key_in_a_header(monkeypatch, tmp_path):
    import base64
    import io
    import wave

    import httpx
    from pydantic import SecretStr

    from app.core.config import get_settings
    from app.voice import gemini

    monkeypatch.setattr(get_settings(), "gemini_api_key", SecretStr("AIza-test-key"))
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(b"\x00\x00" * 2400)
    calls, waits = [], []

    def post(url, headers=None, json=None, timeout=None, **kw):  # noqa: A002
        calls.append((url, headers))
        if len(calls) < 3:
            return httpx.Response(429, json={"error": {"details": [{"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "7s"}]}})
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"inlineData": {"data": base64.b64encode(buf.getvalue()).decode(),
                                                                                              "mimeType": "audio/wav"}}]}}]})  # fmt: skip

    monkeypatch.setattr(gemini.httpx, "post", post)
    monkeypatch.setattr(gemini.time, "sleep", waits.append)
    out = tmp_path / "line.wav"
    gemini.GeminiVoiceProvider().synthesize("<speak>नमस्ते</speak>", "gemini:Orus", out)
    assert out.exists() and len(calls) == 3 and waits == [8.0, 8.0]  # waited as asked (+1 s), then got the line
    assert all("key=" not in u and h == {"x-goog-api-key": "AIza-test-key"} for u, h in calls)


def test_a_daily_limit_is_reported_at_once_without_waiting(monkeypatch, tmp_path):
    import httpx
    import pytest
    from pydantic import SecretStr

    from app.core.config import get_settings
    from app.voice import gemini

    monkeypatch.setattr(get_settings(), "gemini_api_key", SecretStr("AIza-test-key"))
    calls, waits = [], []
    daily = {"error": {"details": [
        {"@type": "type.googleapis.com/google.rpc.QuotaFailure", "violations": [{"quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]},
        {"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "64090s"}]}}  # fmt: skip
    monkeypatch.setattr(gemini.httpx, "post", lambda *a, **k: calls.append(1) or httpx.Response(429, json=daily))
    monkeypatch.setattr(gemini.time, "sleep", waits.append)
    with pytest.raises(gemini.VoiceQuotaExhausted, match="free AI voice limit"):
        gemini.GeminiVoiceProvider().synthesize("<speak>नमस्ते</speak>", "gemini:Orus", tmp_path / "x.wav")
    assert len(calls) == 1 and waits == []  # no pointless waiting


def _wav_bytes(seconds=0.2, sr=24000) -> bytes:
    import io
    import wave

    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(b"\x00\x00" * int(sr * seconds))
    return buf.getvalue()


def test_openai_voice_speaks_with_style_and_the_key_in_a_header(monkeypatch, tmp_path):
    import httpx
    from pydantic import SecretStr

    from app.core.config import get_settings
    from app.voice import openai_voice

    monkeypatch.setattr(get_settings(), "openai_api_key", SecretStr("sk-test-openai"))
    seen = []

    def post(url, headers=None, json=None, timeout=None, **kw):  # noqa: A002
        seen.append((url, headers, json))
        return httpx.Response(200, content=_wav_bytes(), headers={"content-type": "audio/wav"})

    monkeypatch.setattr(openai_voice.httpx, "post", post)
    p = openai_voice.OpenAIVoiceProvider()
    assert [v.id for v in p.list_voices()][:2] == ["openai:onyx", "openai:ash"]
    out = tmp_path / "line.wav"
    p.synthesize('<speak><prosody rate="-8%" pitch="-6%">कुरुक्षेत्र के मैदान में</prosody></speak>', "openai:onyx", out)
    url, headers, body = seen[0]
    assert out.read_bytes()[:4] == b"RIFF" and "key=" not in url and headers == {"Authorization": "Bearer sk-test-openai"}
    assert body["voice"] == "onyx" and body["response_format"] == "wav" and "कुरुक्षेत्र" in body["input"]
    assert "slower" in body["instructions"] and "serious" in body["instructions"]


def test_openai_without_credit_says_so_at_once(monkeypatch, tmp_path):
    import httpx
    import pytest
    from pydantic import SecretStr

    from app.core.config import get_settings
    from app.voice import gemini, openai_voice

    monkeypatch.setattr(get_settings(), "openai_api_key", SecretStr("sk-test-openai"))
    calls = []
    monkeypatch.setattr(openai_voice.httpx, "post", lambda *a, **k: calls.append(1) or httpx.Response(
        429, json={"error": {"code": "insufficient_quota", "type": "insufficient_quota"}}))  # fmt: skip
    with pytest.raises(gemini.VoiceQuotaExhausted, match="no credit"):
        openai_voice.OpenAIVoiceProvider().synthesize("<speak>hello</speak>", "openai:nova", tmp_path / "x.wav")
    assert len(calls) == 1


def test_each_voice_goes_to_its_own_service(monkeypatch, tmp_path):
    from pydantic import SecretStr

    from app.core.config import get_settings
    from app.voice.base import VoiceInfo
    from app.voice.gemini import CombinedVoiceProvider, GeminiVoiceProvider
    from app.voice.openai_voice import OpenAIVoiceProvider

    s = get_settings()
    monkeypatch.setattr(s, "openai_api_key", SecretStr("sk-test-openai"))
    monkeypatch.setattr(s, "gemini_api_key", SecretStr("gem-key"))
    used = []

    class Local:
        def available(self):
            return True

        def list_voices(self):
            return [VoiceInfo(id="Microsoft Zira", name="Zira", language="en-US")]

        def find_voice(self, language, preferred=None):
            return self.list_voices()[0]

        def synthesize(self, ssml, voice_id, out):
            used.append(("local", voice_id))

    g, o = GeminiVoiceProvider(), OpenAIVoiceProvider()
    monkeypatch.setattr(g, "synthesize", lambda ssml, vid, out: used.append(("gemini", vid)))
    monkeypatch.setattr(o, "synthesize", lambda ssml, vid, out: used.append(("openai", vid)))
    c = CombinedVoiceProvider(Local(), g, o)
    ids = [v.id for v in c.list_voices()]
    assert any(i.startswith("gemini:") for i in ids) and any(i.startswith("openai:") for i in ids) and ids[-1] == "Microsoft Zira"
    for vid in ("gemini:Orus", "openai:onyx", "Microsoft Zira"):
        c.synthesize("<speak>x</speak>", vid, tmp_path / "x.wav")
    assert used == [("gemini", "gemini:Orus"), ("openai", "openai:onyx"), ("local", "Microsoft Zira")]
    assert c.find_voice("hi-IN", "openai:ballad").id == "openai:ballad"


async def test_story_narrators_follow_the_keys(client, monkeypatch):
    from pydantic import SecretStr

    from app.core.config import get_settings

    s = get_settings()
    monkeypatch.setattr(s, "gemini_api_key", SecretStr(""))
    monkeypatch.setattr(s, "openai_api_key", SecretStr(""))
    assert [n["id"] for n in (await client.get("/api/story/options")).json()["narrators"]] == ["none"]
    monkeypatch.setattr(s, "openai_api_key", SecretStr("sk-test-openai"))
    ids = [n["id"] for n in (await client.get("/api/story/options")).json()["narrators"]]
    assert ids[0] == "openai:onyx" and ids[-1] == "none" and not any(i.startswith("gemini:") for i in ids)
