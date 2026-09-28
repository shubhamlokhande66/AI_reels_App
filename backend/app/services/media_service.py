"""Upload handling: validation, streaming to storage, probing, thumbnails."""

from __future__ import annotations

import asyncio
import logging
import re
from pathlib import PurePath
from typing import Any

from bson import ObjectId
from fastapi import UploadFile

from app.core.config import get_settings
from app.core.database import get_db
from app.core.errors import (
    AppError,
    InsufficientStorage,
    PayloadTooLarge,
    UnsupportedMedia,
    ValidationFailed,
)
from app.core.ffmpeg import probe, run_ffmpeg
from app.models.base import utcnow
from app.storage import get_storage, project_key
from app.video.analyzer import parse_video_probe

log = logging.getLogger(__name__)

VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"}
AUDIO_EXTS = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"}
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}
MIN_IMAGE_SIDE = 400  # below this a photo cannot be zoomed into without turning soft
CHUNK = 1024 * 1024

_UNSAFE = re.compile(r"[^\w.\- ()\[\]]+", re.UNICODE)


def sanitize_filename(name: str | None, fallback: str = "upload") -> str:
    """Display-only name: no directories, no control/odd characters, bounded length.

    Files are stored under generated ids, so this never touches the filesystem path.
    """
    base = PurePath((name or "").replace("\\", "/")).name
    stem, dot, ext = base.rpartition(".")
    if not dot:
        stem, ext = base, ""
    stem = _UNSAFE.sub("_", stem).strip(" ._") or fallback
    ext = _UNSAFE.sub("", ext)[:8]
    stem = stem[:100]
    return f"{stem}.{ext.lower()}" if ext else stem


def _ext(name: str) -> str:
    return PurePath(name).suffix.lower()


async def _stream_to_disk(upload: UploadFile, dest, max_bytes: int) -> int:
    storage = get_storage()
    min_free = get_settings().min_free_disk_mb * 1024 * 1024
    written = 0
    try:
        with open(dest, "wb") as fh:
            while chunk := await upload.read(CHUNK):
                written += len(chunk)
                if written > max_bytes:
                    raise PayloadTooLarge(
                        f"File exceeds the {max_bytes // (1024 * 1024)} MB limit.",
                        details={"maxBytes": max_bytes},
                    )
                if written % (32 * CHUNK) < CHUNK and storage.free_bytes() - written < min_free:
                    raise InsufficientStorage("Not enough free disk space to store this upload.")
                fh.write(chunk)
    except BaseException:
        dest.unlink(missing_ok=True)
        raise
    return written


def _video_facts(info: dict) -> dict[str, Any]:
    m = parse_video_probe(info)
    return {"duration": m.duration, "width": m.width, "height": m.height, "fps": m.fps}


def _audio_facts(info: dict) -> dict[str, Any]:
    if not any(s.get("codec_type") == "audio" for s in info.get("streams", [])):
        raise UnsupportedMedia("This file has no audio stream.", code="NO_AUDIO_STREAM")
    duration = float(info.get("format", {}).get("duration") or 0)
    if duration < 1.0:
        raise UnsupportedMedia("The audio is too short (minimum 1 second).")
    return {"duration": round(duration, 3)}


def make_thumbnail(src, dest, at: float) -> bool:
    try:
        run_ffmpeg(
            ["-ss", f"{at:.3f}", "-i", str(src), "-frames:v", "1",
             "-vf", "scale=360:-2:force_original_aspect_ratio=decrease", "-q:v", "4", str(dest)],
            timeout=60,
        )  # fmt: skip
        return dest.exists()
    except AppError as exc:
        log.warning("thumbnail failed: %s", exc.details or exc.message)
        return False


async def save_upload(project_id: ObjectId, upload: UploadFile, kind: str) -> dict[str, Any]:
    s = get_settings()
    storage = get_storage()
    display = sanitize_filename(upload.filename, "video" if kind == "video" else "audio")
    ext = _ext(display)
    allowed = VIDEO_EXTS if kind == "video" else AUDIO_EXTS
    if ext not in allowed:
        raise UnsupportedMedia(
            f"Unsupported {kind} type '{ext or 'unknown'}'.",
            details={"allowed": sorted(allowed)},
        )
    max_bytes = (s.max_video_size_mb if kind == "video" else s.max_audio_size_mb) * 1024 * 1024
    media_id = ObjectId()
    pid = str(project_id)
    key = project_key(pid, "input", f"{media_id}{ext}")
    storage.ensure_project(pid)
    dest = storage.new_local_path(key)

    size = await _stream_to_disk(upload, dest, max_bytes)
    if size == 0:
        dest.unlink(missing_ok=True)
        raise ValidationFailed("The uploaded file is empty.", code="EMPTY_FILE")

    try:
        info = await asyncio.to_thread(probe, dest)
        facts = _video_facts(info) if kind == "video" else _audio_facts(info)
    except BaseException:
        dest.unlink(missing_ok=True)
        raise
    storage.commit(key)

    thumb_key = None
    if kind == "video":
        thumb_key = project_key(pid, "analysis", f"thumb_{media_id}.jpg")
        ok = await asyncio.to_thread(
            make_thumbnail, dest, storage.new_local_path(thumb_key), min(facts["duration"] / 2, 1.0)
        )
        thumb_key = thumb_key if ok else None

    doc = {
        "_id": media_id,
        "projectId": project_id,
        "kind": kind,
        "originalName": display,
        "storedKey": key,
        "thumbnailKey": thumb_key,
        "size": size,
        "mimeType": upload.content_type or "application/octet-stream",
        **facts,
        "createdAt": utcnow(),
    }
    await get_db().media.insert_one(doc)
    return doc


async def delete_media_files(doc: dict[str, Any]) -> None:
    storage = get_storage()
    storage.delete(doc["storedKey"])
    if doc.get("thumbnailKey"):
        storage.delete(doc["thumbnailKey"])


async def save_image(project_id: ObjectId, upload: UploadFile) -> dict[str, Any]:
    """A product photo: validated by actually decoding it, saved as it was uploaded, with a small thumbnail."""
    import cv2

    from app.product.understand import load_bgr

    s = get_settings()
    storage = get_storage()
    display = sanitize_filename(upload.filename, "photo")
    ext = _ext(display)
    if ext in (".heic", ".heif"):
        raise UnsupportedMedia(
            "HEIC photos are not supported yet. Share or export the photo as JPG (on an iPhone: Settings > Camera > Formats > Most Compatible).",
            details={"allowed": sorted(IMAGE_EXTS)},
        )
    if ext not in IMAGE_EXTS:
        raise UnsupportedMedia(f"Unsupported photo type '{ext or 'unknown'}'.", details={"allowed": sorted(IMAGE_EXTS)})
    media_id = ObjectId()
    pid = str(project_id)
    key = project_key(pid, "input", f"{media_id}{ext}")
    storage.ensure_project(pid)
    dest = storage.new_local_path(key)
    size = await _stream_to_disk(upload, dest, s.max_image_size_mb * 1024 * 1024)
    if size == 0:
        dest.unlink(missing_ok=True)
        raise ValidationFailed("The uploaded file is empty.", code="EMPTY_FILE")
    try:
        img = await asyncio.to_thread(load_bgr, dest)  # raises CorruptedMedia for anything that is not a real picture
        h, w = img.shape[:2]
        if min(h, w) < MIN_IMAGE_SIDE:
            raise ValidationFailed(
                f"The photo is only {w}x{h}. Use one with at least {MIN_IMAGE_SIDE} pixels on its shortest side so close-ups stay sharp.", code="IMAGE_TOO_SMALL",
            )
        thumb_key = project_key(pid, "analysis", f"thumb_{media_id}.jpg")
        k = 360 / max(h, w)
        thumb = cv2.resize(img, (max(int(w * k), 1), max(int(h * k), 1)), interpolation=cv2.INTER_AREA)
        cv2.imwrite(str(storage.new_local_path(thumb_key)), thumb, [cv2.IMWRITE_JPEG_QUALITY, 82])
        storage.commit(thumb_key)
    except BaseException:
        dest.unlink(missing_ok=True)
        raise
    storage.commit(key)
    doc = {
        "_id": media_id, "projectId": project_id, "kind": "image", "originalName": display, "storedKey": key, "thumbnailKey": thumb_key,
        "size": size, "mimeType": upload.content_type or "image/jpeg", "width": w, "height": h, "duration": None, "createdAt": utcnow(),
    }  # fmt: skip
    await get_db().media.insert_one(doc)
    return doc
