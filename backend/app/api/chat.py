"""A free-form chat with the local AI model: brainstorm a direction, ask questions, get plain answers.

Separate from /revise: this never touches a project or a timeline. It is stateless on the server (the client sends
the whole conversation each time) and answers in plain text, not the fixed action list /revise understands. Once
you like where a conversation went, describe it in a project's "Change this Reel" (or AI Edit) box to actually apply it.

You can also attach a file to a message (/chat/files):
- images are sent straight to the model if it can see images (Ollama's native per-message "images" field)
- a video has a few frames sampled from it (ffprobe + OpenCV, the same approach used for clip understanding
  elsewhere) and those frames are sent the same way as an image attachment — the model is never given the whole file
- an audio file gets real beat/accent/energy analysis — the same pipeline (app/audio/analyzer.py + the Director's
  app/director/music_map.py) that Beat Sync uses to actually cut video on the beat — described in words: tempo,
  strong/major beats with real timestamps, drops, quiet stretches, energy over time. There is no speech-to-text
  model wired up, so spoken words or lyrics are never read, and the description says so
- text/code/PDF files have their text extracted and folded into the message so the model can read them

Nothing you attach here is saved: video/audio are streamed to a temp file only for the moment it takes to analyse
them, then deleted.
"""

from __future__ import annotations

import asyncio
import base64
import io
import tempfile
from pathlib import Path, PurePath
from typing import Any

from fastapi import APIRouter, Depends, File, UploadFile
from pydantic import Field, field_validator, model_validator

from app.ai.ollama import OllamaProvider
from app.ai.provider import AIProvider, get_provider
from app.ai.understanding import sample_keyframes
from app.audio.analyzer import analyze_audio
from app.core.errors import AIUnavailable, CorruptedMedia, PayloadTooLarge, UnsupportedMedia, ValidationFailed
from app.core.ffmpeg import probe
from app.core.ratelimit import rate_limit
from app.director.music_map import LEVEL_ACTION, LEVEL_NAMES, build_music_map
from app.models.base import CamelModel
from app.services.media_service import AUDIO_EXTS, VIDEO_EXTS, sanitize_filename
from app.video.analyzer import parse_video_probe

router = APIRouter(prefix="/api", tags=["chat"])

MAX_TURNS = 40  # user+assistant messages kept in one conversation
MAX_MESSAGE_LEN = 20_000  # generous: a message may carry one or two attached files' extracted text
MAX_IMAGES_PER_MESSAGE = 4  # a video attaches VIDEO_FRAMES of these; an image attaches 1
MAX_IMAGES_PER_REQUEST = 12  # across the whole conversation sent back each turn
MAX_IMAGE_B64_CHARS = 8_000_000  # ~6MB raw; real attachments are far smaller once resized below

MAX_UPLOAD_BYTES = 15 * 1024 * 1024  # images, PDFs, text/code
MAX_VIDEO_BYTES = 200 * 1024 * 1024
MAX_AUDIO_BYTES = 50 * 1024 * 1024
MAX_FILE_TEXT_CHARS = 12_000  # per attached file, before it even reaches MAX_MESSAGE_LEN
MAX_IMAGE_DIM = 1280  # plenty for a vision model to read text/detail; bigger is wasted bandwidth
VIDEO_FRAMES = 3  # evenly spread through the clip
MAX_BEAT_LINES = 15  # a spread sample small enough for a small local model to relay without drifting or truncating
_STREAM_CHUNK = 1024 * 1024

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tif", ".tiff"}
TEXT_EXTS = {
    ".txt", ".md", ".markdown", ".rst", ".csv", ".tsv", ".json", ".jsonl", ".log", ".py", ".js", ".jsx", ".ts",
    ".tsx", ".html", ".htm", ".css", ".scss", ".yml", ".yaml", ".xml", ".sql", ".sh", ".bat", ".ps1", ".ini",
    ".toml", ".cfg", ".env", ".java", ".c", ".h", ".cpp", ".hpp", ".go", ".rb", ".php", ".rs", ".kt", ".swift",
}

SYSTEM = (
    "You are a helpful assistant inside a Reel-editing app, for brainstorming ideas and answering questions in plain "
    "language: pacing, styles, captions, music choices, shot order, general editing advice. Answer directly and "
    "concisely (a few sentences, more only if truly needed). "
    "The person may attach an image, video, audio file, PDF, or text/code file to a message — when they do, its "
    "content (or, for a video, a few sampled frames; for audio, real beat/tempo/energy analysis with actual "
    "timestamps) is included for you to actually use in your answer — never invent numbers beyond what was given. "
    "Audio is not transcribed — you are never given spoken words or lyrics, or things like exact time signature or "
    "instrument type, so say so plainly if asked about audio content you were not given, rather than guessing. "
    "You cannot generate, animate or synthesize any video, image or audio yourself, and you cannot see their actual "
    "project footage unless they attach it here. If asked to generate or animate something, say so plainly and, if "
    "it fits, suggest describing the change in the app's 'Change this Reel' box instead, which can apply real edits "
    "(trim, speed, order, transitions, captions, music, style) to their own uploaded clips."
)


class ChatMessage(CamelModel):
    role: str
    content: str = Field(min_length=1, max_length=MAX_MESSAGE_LEN)
    images: list[str] = Field(default_factory=list)  # base64 JPEGs, from POST /chat/files

    @field_validator("role")
    @classmethod
    def _role(cls, v: str) -> str:
        if v not in ("user", "assistant"):
            raise ValueError("role must be 'user' or 'assistant'")
        return v

    @field_validator("images")
    @classmethod
    def _images(cls, v: list[str]) -> list[str]:
        if len(v) > MAX_IMAGES_PER_MESSAGE:
            raise ValueError(f"At most {MAX_IMAGES_PER_MESSAGE} images per message.")
        for b64 in v:
            if len(b64) > MAX_IMAGE_B64_CHARS:
                raise ValueError("An attached image is too large.")
        return v


class ChatRequest(CamelModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=MAX_TURNS)

    @model_validator(mode="after")
    def _total_images(self) -> "ChatRequest":
        total = sum(len(m.images) for m in self.messages)
        if total > MAX_IMAGES_PER_REQUEST:
            raise ValueError(f"At most {MAX_IMAGES_PER_REQUEST} images in one conversation turn.")
        return self


def _supports_vision(provider: AIProvider) -> bool:
    """Whether the model currently in use can actually look at an image. Cloud providers use their configured vision
    model; a local Ollama model is checked for the vision capability."""
    provider = getattr(provider, "primary", provider)  # the managed wrapper -> the real provider
    if not provider.is_local and provider.name in ("openai", "gemini", "claude"):
        return bool(provider.vision_model or provider.model)
    if not isinstance(provider, OllamaProvider):
        return False
    try:
        models = provider.installed_models()
    except AIUnavailable:
        return False
    model = provider.vision_model or provider.model
    for m in models:
        if m["name"] == model or m["name"].split(":")[0] == model:
            return "vision" in m.get("capabilities", [])
    return False


@router.post("/chat", dependencies=[Depends(rate_limit("chat", 30))])
async def chat(payload: ChatRequest):
    if payload.messages[-1].role != "user":
        raise ValidationFailed("The last message must be from you.", code="BAD_CHAT_TURN")
    provider = get_provider("chat")
    try:
        health = await asyncio.to_thread(provider.health)
    except Exception:  # noqa: BLE001 - reported below, not raised
        health = {"available": False}
    if not health.get("available"):
        if getattr(provider, "is_local", True):
            raise AIUnavailable("The local AI model is not reachable. Check Settings → AI, or that Ollama is running.")
        raise AIUnavailable(f"The AI provider ({provider.name}) is not available: {health.get('detail') or 'check Settings → AI'}.")
    if any(m.images for m in payload.messages) and not await asyncio.to_thread(_supports_vision, provider):
        raise AIUnavailable(
            "The current AI model can't see images. Pick a vision-capable model in Settings → AI.",
            code="AI_VISION_UNSUPPORTED",
        )
    messages: list[dict[str, Any]] = [
        {"role": m.role, "content": m.content, **({"images": m.images} if m.images else {})} for m in payload.messages
    ]
    reply = provider.chat_turns(SYSTEM, messages)
    return {"reply": reply}


# ------------------------------------------------------------------ file attachments


class ChatFile(CamelModel):
    name: str
    kind: str  # "image" | "video" | "audio" | "text"
    mime: str
    size_bytes: int
    text: str | None = None
    images: list[str] = Field(default_factory=list)  # base64 JPEGs: 1 for an image, a few sampled frames for a video
    truncated: bool = False  # the content was cut short to stay within MAX_FILE_TEXT_CHARS


def _read_text(raw: bytes) -> tuple[str, bool]:
    text = raw.decode("utf-8", errors="replace")
    if len(text) > MAX_FILE_TEXT_CHARS:
        return text[:MAX_FILE_TEXT_CHARS], True
    return text, False


def _read_pdf(raw: bytes) -> tuple[str, bool]:
    import pypdf

    try:
        reader = pypdf.PdfReader(io.BytesIO(raw))
        if reader.is_encrypted:
            raise UnsupportedMedia("That PDF is password-protected. Remove the password and try again.")
        parts = []
        for i, page in enumerate(reader.pages):
            t = (page.extract_text() or "").strip()
            if t:
                parts.append(f"--- page {i + 1} ---\n{t}")
    except UnsupportedMedia:
        raise
    except Exception as exc:  # noqa: BLE001 - a real read failure, reported plainly
        raise UnsupportedMedia("That PDF could not be read (it may be corrupted).") from exc
    text = "\n\n".join(parts).strip()
    if not text:
        raise UnsupportedMedia("No text was found in that PDF — it may be scanned pages/images rather than real text, which isn't read yet.")
    if len(text) > MAX_FILE_TEXT_CHARS:
        return text[:MAX_FILE_TEXT_CHARS], True
    return text, False


def _read_image(raw: bytes) -> str:
    import cv2
    import numpy as np

    img = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise UnsupportedMedia("That file is not a readable image.")
    h, w = img.shape[:2]
    if max(h, w) > MAX_IMAGE_DIM:
        k = MAX_IMAGE_DIM / max(h, w)
        img = cv2.resize(img, (max(int(w * k), 1), max(int(h * k), 1)), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 85])
    if not ok:
        raise UnsupportedMedia("That image could not be processed.")
    return base64.b64encode(buf.tobytes()).decode()


def _read_video(path: Path, display: str) -> tuple[str, list[str]]:
    info = probe(path)  # raises CorruptedMedia if unreadable
    meta = parse_video_probe(info)  # raises UnsupportedMedia/CorruptedMedia for a bad/videoless file
    frames = sample_keyframes(path, meta.duration, n=VIDEO_FRAMES, width=640)
    if not frames:
        raise UnsupportedMedia(f"No frames could be read from '{display}'.")
    text = (
        f"Attached video '{display}': {meta.duration:.1f}s, {meta.width}x{meta.height}, {meta.fps:.0f}fps. "
        f"{len(frames)} frames sampled evenly through it are attached as images below (not the whole video)."
    )
    return text, [base64.b64encode(f).decode() for f in frames]


def _spread_sample(items: list, n: int) -> list:
    """Up to n items evenly spread across the whole list (not just the first n) — a short list a small model can
    relay faithfully, that still represents the entire track instead of only its early part."""
    if len(items) <= n or n <= 1:
        return items
    idx = sorted({round(i * (len(items) - 1) / (n - 1)) for i in range(n)})
    return [items[i] for i in idx]


def _energy_buckets(energy_curve: list[tuple[float, float, str]], duration: float, n: int = 12) -> list[tuple[float, float, str]]:
    """The energy curve's many fine-grained runs, reduced to exactly n buckets spanning the FULL track — a fixed,
    small size regardless of song length or how choppy the energy is, so coverage never silently runs out partway."""
    if not energy_curve or duration <= 0:
        return []
    step = duration / n
    buckets = []
    for i in range(n):
        a, b = i * step, duration if i == n - 1 else (i + 1) * step
        weights: dict[str, float] = {}
        for rs, re, label in energy_curve:
            overlap = min(re, b) - max(rs, a)
            if overlap > 0:
                weights[label] = weights.get(label, 0.0) + overlap
        buckets.append((a, b, max(weights, key=weights.get) if weights else "medium"))
    return buckets


def _read_audio(path: Path, display: str) -> str:
    """Real beat/accent/energy analysis — the same pipeline Beat Sync uses to cut video on the beat — described in
    words for the model. Not a guess: every number below came from actually analysing the waveform.

    Kept deliberately short and bounded (a spread sample, not a raw dump of every beat): a small local model cannot
    reliably relay dozens of numeric lines without drifting, truncating, or inventing its own — a fixed-size,
    full-track summary is something it can actually reproduce faithfully. For the complete, unsummarized
    beat-by-beat breakdown, the app's Beat Sync feature shows it directly with no model in the loop."""
    info = probe(path)  # raises CorruptedMedia if unreadable
    if not any(s.get("codec_type") == "audio" for s in info.get("streams", [])):
        raise UnsupportedMedia(f"'{display}' has no audio stream.")
    duration = float(info.get("format", {}).get("duration") or 0)

    try:
        audio = analyze_audio(path)
    except CorruptedMedia:
        return (
            f"Attached audio '{display}': duration {duration:.1f}s. Beat analysis could not run on this file (it may "
            "be silent or too short); only its container metadata was read. Spoken words or lyrics are never transcribed."
        )

    music = build_music_map(audio, 0.0, audio.duration)
    notable = [b for b in music.beats if b.level >= 3]  # "strong"/"major" only: what an editor would actually cut on
    sample = _spread_sample(notable, MAX_BEAT_LINES)
    lines = [
        f"  {b.t:6.2f}s - {LEVEL_NAMES[b.level]} ({LEVEL_ACTION[b.level]}){' [downbeat]' if b.downbeat else ''}"
        for b in sample
    ]
    pct = round(100 * len(notable) / len(music.beats)) if music.beats else 0

    parts = [
        f"Attached audio '{display}': duration {audio.duration:.1f}s, tempo ~{audio.bpm:.0f} BPM "
        f"(beat-grid confidence {audio.beat_confidence:.2f}). This is real signal analysis (the same beat/accent "
        "detection the app's Beat Sync feature uses to cut video on the beat), not a guess.",
        f"{len(notable)} of {len(music.beats)} detected beats ({pct}%) are strong/major (edit-worthy)"
        + (f". {len(sample)} examples spread across the whole track" if len(notable) > len(sample) else "")
        + (":\n" + "\n".join(lines) if lines else ". None stood out from the regular beat grid."),
    ]
    if music.drops:
        shown = _spread_sample(music.drops, 15)
        note = f" ({len(shown)} of {len(music.drops)}, spread across the track)" if len(shown) < len(music.drops) else ""
        parts.append(f"Drops (sudden energy jumps){note}: " + ", ".join(f"{d:.2f}s" for d in shown))
    if music.pauses:
        shown = _spread_sample(music.pauses, 10)
        note = f" ({len(shown)} of {len(music.pauses)}, spread across the track)" if len(shown) < len(music.pauses) else ""
        parts.append(f"Quiet/low-energy stretches{note}: " + ", ".join(f"{a:.1f}-{b:.1f}s" for a, b in shown))
    buckets = _energy_buckets(music.energy_curve, audio.duration)
    if buckets:
        shown = ", ".join(f"{a:.1f}-{b:.1f}s {n}" for a, b, n in buckets)
        parts.append(f"Energy across the full track, in {len(buckets)} equal parts: {shown}")
    parts.append(
        "Not detected here (would need more than beat/energy analysis, so do not invent these if asked): time "
        "signature, instrument/drum type (kick/snare/clap/bass), vocals, lyrics. Spoken words or lyrics are never "
        "transcribed — there is no speech-to-text step in this analysis."
    )
    parts.append(
        "Every number above came from analysing the real waveform and already covers the whole track — report only "
        "these, in your own words if useful, but do not derive, recompute or approximate additional figures from "
        "them (e.g. a 'beat interval' from the BPM, or a beat count from BPM × duration): the beat grid is not "
        "perfectly regular, so simple arithmetic on BPM will not match the real numbers above."
    )
    return "\n".join(parts)


async def _stream_to_temp(file: UploadFile, suffix: str, max_bytes: int, display: str) -> tuple[Path, int]:
    """Video/audio are too big to safely buffer in memory: write to a temp file, bounded, deleted by the caller."""
    fd, name = tempfile.mkstemp(suffix=suffix, prefix="chat_upload_")
    path = Path(name)
    written = 0
    try:
        with open(fd, "wb") as fh:
            while chunk := await file.read(_STREAM_CHUNK):
                written += len(chunk)
                if written > max_bytes:
                    raise PayloadTooLarge(f"'{display}' is too large (max {max_bytes // (1024 * 1024)}MB).")
                fh.write(chunk)
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    if written == 0:
        path.unlink(missing_ok=True)
        raise ValidationFailed("The uploaded file is empty.", code="EMPTY_FILE")
    return path, written


@router.post("/chat/files", dependencies=[Depends(rate_limit("chat-files", 20))])
async def upload_chat_file(file: UploadFile = File(...)):
    display = sanitize_filename(file.filename, "attachment")
    ext = PurePath(display).suffix.lower()

    if ext in VIDEO_EXTS:
        path, size = await _stream_to_temp(file, ext, MAX_VIDEO_BYTES, display)
        try:
            text, images = await asyncio.to_thread(_read_video, path, display)
        finally:
            path.unlink(missing_ok=True)
        return ChatFile(name=display, kind="video", mime=file.content_type or "video/mp4", size_bytes=size, text=text, images=images)

    if ext in AUDIO_EXTS:
        path, size = await _stream_to_temp(file, ext, MAX_AUDIO_BYTES, display)
        try:
            text = await asyncio.to_thread(_read_audio, path, display)
        finally:
            path.unlink(missing_ok=True)
        return ChatFile(name=display, kind="audio", mime=file.content_type or "audio/mpeg", size_bytes=size, text=text)

    raw = await file.read()
    if not raw:
        raise ValidationFailed("The uploaded file is empty.", code="EMPTY_FILE")
    if len(raw) > MAX_UPLOAD_BYTES:
        raise PayloadTooLarge(f"'{display}' is too large (max {MAX_UPLOAD_BYTES // (1024 * 1024)}MB).")

    if ext in IMAGE_EXTS:
        b64 = await asyncio.to_thread(_read_image, raw)
        return ChatFile(name=display, kind="image", mime=file.content_type or "image/jpeg", size_bytes=len(raw), images=[b64])
    if ext == ".pdf":
        text, truncated = await asyncio.to_thread(_read_pdf, raw)
        return ChatFile(name=display, kind="text", mime="application/pdf", size_bytes=len(raw), text=text, truncated=truncated)
    if ext in TEXT_EXTS or ext == "":
        text, truncated = _read_text(raw)
        return ChatFile(name=display, kind="text", mime=file.content_type or "text/plain", size_bytes=len(raw), text=text, truncated=truncated)

    raise UnsupportedMedia(
        f"'{ext}' files aren't supported yet. You can attach images, videos, audio, PDFs, and text/code files.",
        details={"allowed": sorted(IMAGE_EXTS | TEXT_EXTS | VIDEO_EXTS | AUDIO_EXTS | {".pdf"})},
    )
