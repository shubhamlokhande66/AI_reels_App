"""Free-form chat: the endpoint's validation/plumbing, attaching files, and the Ollama provider's real multi-turn call."""

from __future__ import annotations

import io
import re

import httpx
import pytest

from app.ai.ollama import OllamaProvider
from app.ai.provider import set_provider
from app.api.chat import _supports_vision
from app.core.errors import AIUnavailable
from tests.test_ai import FakeProvider


def make_pdf(text: str) -> bytes:
    """A byte-accurate minimal single-page PDF with a real text stream (no reportlab needed)."""
    objs = [
        b"<</Type/Catalog/Pages 2 0 R>>",
        b"<</Type/Pages/Kids[3 0 R]/Count 1>>",
        b"<</Type/Page/Parent 2 0 R/Resources<</Font<</F1 4 0 R>>>>/MediaBox[0 0 200 200]/Contents 5 0 R>>",
        b"<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
    ]
    stream = f"BT /F1 24 Tf 20 100 Td ({text}) Tj ET".encode()
    objs.append(b"<</Length %d>>\nstream\n" % len(stream) + stream + b"\nendstream")
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = [0]
    for i, o in enumerate(objs, start=1):
        offsets.append(out.tell())
        out.write(f"{i} 0 obj".encode() + o + b"endobj\n")
    xref_pos = out.tell()
    n = len(objs) + 1
    out.write(f"xref\n0 {n}\n".encode() + b"0000000000 65535 f \n")
    for off in offsets[1:]:
        out.write(f"{off:010d} 00000 n \n".encode())
    out.write(f"trailer<</Size {n}/Root 1 0 R>>\nstartxref\n{xref_pos}\n%%EOF".encode())
    return out.getvalue()


def make_blank_pdf() -> bytes:
    import pypdf

    w = pypdf.PdfWriter()
    w.add_blank_page(width=200, height=200)
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()


def make_jpeg(size: int = 40) -> bytes:
    import cv2
    import numpy as np

    ok, buf = cv2.imencode(".jpg", np.zeros((size, size, 3), dtype=np.uint8))
    assert ok
    return buf.tobytes()


class NoAI(FakeProvider):
    def health(self):
        return {"available": False, "model": None, "detail": "off"}


@pytest.fixture(autouse=True)
def _reset_provider():
    yield
    set_provider(None)


async def chat(client, messages, **kw):
    return await client.post("/api/chat", json={"messages": messages, **kw})


# ------------------------------------------------------------------ endpoint
async def test_happy_path_returns_a_plain_text_reply(client, db, media_dir):
    set_provider(FakeProvider(["Sure — shorter clips with quicker cuts usually read as more energetic."]))
    r = await chat(client, [{"role": "user", "content": "How do I make this feel more energetic?"}])
    assert r.status_code == 200
    assert r.json() == {"reply": "Sure — shorter clips with quicker cuts usually read as more energetic."}


async def test_a_multi_turn_conversation_is_passed_through(client, db, media_dir):
    fake = FakeProvider(["Got it, noted."])
    set_provider(fake)
    r = await chat(
        client,
        [
            {"role": "user", "content": "I want a beach vibe"},
            {"role": "assistant", "content": "Sounds fun — what mood, upbeat or relaxed?"},
            {"role": "user", "content": "Relaxed"},
        ],
    )
    assert r.status_code == 200
    # the base AIProvider.chat_turns() folds history into one transcript for the fake provider
    assert len(fake.calls) == 1
    _, user_text = fake.calls[0]
    assert "beach vibe" in user_text and "Relaxed" in user_text


async def test_empty_messages_is_rejected(client, db, media_dir):
    set_provider(FakeProvider([]))
    r = await client.post("/api/chat", json={"messages": []})
    assert r.status_code == 422


async def test_last_message_must_be_from_the_user(client, db, media_dir):
    set_provider(FakeProvider(["hi"]))
    r = await chat(client, [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}])
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "BAD_CHAT_TURN"


async def test_an_unknown_role_is_rejected(client, db, media_dir):
    set_provider(FakeProvider([]))
    r = await chat(client, [{"role": "system", "content": "be helpful"}])
    assert r.status_code == 422


async def test_a_message_over_20000_characters_is_rejected(client, db, media_dir):
    set_provider(FakeProvider([]))
    r = await chat(client, [{"role": "user", "content": "x" * 20_001}])
    assert r.status_code == 422


async def test_more_than_40_messages_is_rejected(client, db, media_dir):
    set_provider(FakeProvider([]))
    msgs = [{"role": "user" if i % 2 == 0 else "assistant", "content": "hi"} for i in range(41)]
    r = await chat(client, msgs)
    assert r.status_code == 422


async def test_unavailable_provider_gives_a_clear_503(client, db, media_dir):
    set_provider(NoAI())
    r = await chat(client, [{"role": "user", "content": "hello"}])
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "AI_UNAVAILABLE"


async def test_a_provider_whose_health_check_throws_is_treated_as_unavailable(client, db, media_dir):
    class Flaky(FakeProvider):
        def health(self):
            raise RuntimeError("boom")

    set_provider(Flaky([]))
    r = await chat(client, [{"role": "user", "content": "hello"}])
    assert r.status_code == 503


async def test_too_many_images_in_one_message_is_rejected(client, db, media_dir):
    set_provider(FakeProvider([]))
    r = await chat(client, [{"role": "user", "content": "look", "images": ["a"] * 5}])
    assert r.status_code == 422


async def test_an_image_attachment_with_a_non_vision_provider_gives_a_clear_error(client, db, media_dir):
    set_provider(FakeProvider(["irrelevant"]))
    r = await chat(client, [{"role": "user", "content": "what is this?", "images": ["aGVsbG8="]}])
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "AI_VISION_UNSUPPORTED"


def test_supports_vision_checks_the_current_models_capabilities(monkeypatch):
    vision = OllamaProvider("http://x", "llava:7b")
    monkeypatch.setattr(vision, "installed_models", lambda: [{"name": "llava:7b", "capabilities": ["vision"]}])
    assert _supports_vision(vision) is True

    text_only = OllamaProvider("http://x", "llama3:8b")
    monkeypatch.setattr(text_only, "installed_models", lambda: [{"name": "llama3:8b", "capabilities": ["completion"]}])
    assert _supports_vision(text_only) is False

    assert _supports_vision(FakeProvider([])) is False  # not Ollama at all


# ------------------------------------------------------------------ /api/chat/files
async def upload(client, name, data, content_type):
    return await client.post("/api/chat/files", files={"file": (name, data, content_type)})


async def test_an_image_attachment_is_resized_and_returned_as_a_single_frame(client, db, media_dir):
    r = await upload(client, "photo.jpg", make_jpeg(), "image/jpeg")
    assert r.status_code == 200
    j = r.json()
    assert j["kind"] == "image" and j["name"] == "photo.jpg"
    assert len(j["images"]) == 1 and j["images"][0]
    assert j["sizeBytes"] > 0


async def test_a_pdf_with_real_text_has_it_extracted(client, db, media_dir):
    r = await upload(client, "notes.pdf", make_pdf("Hello PDF World"), "application/pdf")
    assert r.status_code == 200
    j = r.json()
    assert j["kind"] == "text" and "Hello PDF World" in j["text"] and j["truncated"] is False


async def test_a_pdf_with_no_extractable_text_is_rejected(client, db, media_dir):
    r = await upload(client, "scan.pdf", make_blank_pdf(), "application/pdf")
    assert r.status_code == 415
    assert r.json()["error"]["code"] == "UNSUPPORTED_MEDIA"


async def test_a_text_file_is_read_as_is(client, db, media_dir):
    r = await upload(client, "notes.txt", b"remember: louder music, faster cuts", "text/plain")
    assert r.status_code == 200
    j = r.json()
    assert j["kind"] == "text" and j["text"] == "remember: louder music, faster cuts"


async def test_a_long_text_file_is_truncated(client, db, media_dir, monkeypatch):
    monkeypatch.setattr("app.api.chat.MAX_FILE_TEXT_CHARS", 50)
    r = await upload(client, "big.txt", b"x" * 500, "text/plain")
    assert r.status_code == 200
    j = r.json()
    assert j["truncated"] is True and len(j["text"]) == 50


async def test_an_unsupported_file_type_is_rejected_with_a_clear_message(client, db, media_dir):
    r = await upload(client, "archive.zip", b"PK\x03\x04fake", "application/zip")
    assert r.status_code == 415
    assert "aren't supported yet" in r.json()["error"]["message"]


async def test_an_empty_file_is_rejected(client, db, media_dir):
    r = await upload(client, "empty.txt", b"", "text/plain")
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "EMPTY_FILE"


async def test_a_file_over_the_size_limit_is_rejected(client, db, media_dir, monkeypatch):
    monkeypatch.setattr("app.api.chat.MAX_UPLOAD_BYTES", 10)
    r = await upload(client, "notes.txt", b"x" * 100, "text/plain")
    assert r.status_code == 413
    assert r.json()["error"]["code"] == "FILE_TOO_LARGE"


async def test_a_video_attachment_gets_sampled_frames_and_a_description(client, db, media_dir):
    data = (media_dir / "clip_a.mp4").read_bytes()
    r = await upload(client, "clip.mp4", data, "video/mp4")
    assert r.status_code == 200
    j = r.json()
    assert j["kind"] == "video"
    assert len(j["images"]) == 3  # VIDEO_FRAMES
    assert "1280x720" in j["text"] and "clip.mp4" in j["text"]


async def test_a_corrupted_video_is_rejected(client, db, media_dir):
    data = (media_dir / "notvideo.mp4").read_bytes()
    r = await upload(client, "notvideo.mp4", data, "video/mp4")
    assert r.status_code >= 400


async def test_an_audio_attachment_gets_real_beat_analysis_not_lyrics(client, db, media_dir):
    data = (media_dir / "beat120.mp3").read_bytes()
    r = await upload(client, "song.mp3", data, "audio/mpeg")
    assert r.status_code == 200
    j = r.json()
    assert j["kind"] == "audio" and j["images"] == []
    text = j["text"]
    assert "duration 30.0s" in text and "~120 BPM" in text  # the real click track, correctly detected
    assert "strong" in text or "major" in text  # real per-beat levels from the Director's music map, not a guess
    assert re.search(r"\d+\.\d\ds - (strong|major)", text)  # at least one real timestamped beat line
    assert "lyrics" in text  # honest about what wasn't analyzed
    assert "never transcribed" in text or "never read" in text


# ------------------------------------------------------------------ OllamaProvider.chat_turns
def test_ollama_chat_turns_sends_the_full_history_not_a_folded_string(monkeypatch):
    seen = {}

    def post(url, json=None, timeout=None):
        seen.update(url=url, payload=json)
        return httpx.Response(200, json={"message": {"content": "Sure, relaxed and airy works well."}})

    monkeypatch.setattr(httpx, "post", post)
    p = OllamaProvider("http://host:11434", "my-model:7b", 30)
    reply = p.chat_turns(
        "system prompt",
        [
            {"role": "user", "content": "beach vibe"},
            {"role": "assistant", "content": "upbeat or relaxed?"},
            {"role": "user", "content": "relaxed"},
        ],
    )
    assert reply == "Sure, relaxed and airy works well."
    assert seen["url"] == "http://host:11434/api/chat"
    body = seen["payload"]
    assert body["model"] == "my-model:7b" and body["stream"] is False
    assert "format" not in body  # plain text, not JSON mode
    assert [m["role"] for m in body["messages"]] == ["system", "user", "assistant", "user"]
    assert body["messages"][0]["content"] == "system prompt"
    assert [m["content"] for m in body["messages"][1:]] == ["beach vibe", "upbeat or relaxed?", "relaxed"]


def test_ollama_chat_turns_maps_errors_like_chat_does(monkeypatch):
    def boom(url, json=None, timeout=None):
        raise httpx.ConnectError("refused")

    monkeypatch.setattr(httpx, "post", boom)
    p = OllamaProvider("http://x", "m")
    with pytest.raises(AIUnavailable) as e:
        p.chat_turns("sys", [{"role": "user", "content": "hi"}])
    assert e.value.code == "OLLAMA_UNAVAILABLE"
