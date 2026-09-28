"""The song library: every song used once is kept, so a new Reel can pick it instead of uploading it again.

Songs come from:
* uploads: any song uploaded to a Reel is added automatically (an identical file is stored once, by content hash);
* watched folders: audio files in ``SONG_IMPORT_FOLDERS`` (e.g. your Downloads) are imported automatically.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import shutil
import time
from pathlib import Path
from typing import Any

from bson import ObjectId

from app.core.config import get_settings
from app.core.database import get_db
from app.core.errors import NotFoundError, UnsupportedMedia
from app.core.ffmpeg import probe
from app.models.base import utcnow
from app.services.media_service import AUDIO_EXTS, _audio_facts, sanitize_filename
from app.storage import get_storage

log = logging.getLogger(__name__)
FOLDER_SCAN_EVERY = 30.0  # seconds
_last_scan = 0.0


def _sha1(path: Path) -> str:
    h = hashlib.sha1()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def song_to_out(doc: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(doc["_id"]), "name": doc["name"], "artist": doc.get("artist") or None, "duration": doc.get("duration"),
        "size": doc.get("size"), "source": doc.get("source", "upload"), "license": doc.get("license") or None,
        "licenseUrl": doc.get("licenseUrl") or None, "shareUrl": doc.get("shareUrl") or None, "image": doc.get("image") or None,
        "url": f"/api/songs/{doc['_id']}/file", "createdAt": doc.get("createdAt"), "lastUsedAt": doc.get("lastUsedAt"),
        "useCount": doc.get("useCount", 0),
    }  # fmt: skip


async def add_file(src: Path, name: str, source: str, **meta: Any) -> dict[str, Any]:
    """Add ``src`` to the library (copied; the original is not touched). An identical song already there is returned."""
    ext = src.suffix.lower()
    if ext not in AUDIO_EXTS:
        raise UnsupportedMedia(f"Unsupported audio type '{ext or 'unknown'}'.", details={"allowed": sorted(AUDIO_EXTS)})
    digest = await asyncio.to_thread(_sha1, src)
    db = get_db()
    existing = await db.songs.find_one({"sha1": digest})
    if existing:
        if meta.get("folderPath") and not existing.get("folderPath"):
            await db.songs.update_one({"_id": existing["_id"]}, {"$set": {"folderPath": meta["folderPath"]}})
        return existing
    facts = _audio_facts(await asyncio.to_thread(probe, src))
    song_id = ObjectId()
    key = f"songs/{song_id}{ext}"
    storage = get_storage()
    await asyncio.to_thread(shutil.copyfile, src, storage.new_local_path(key))
    storage.commit(key)
    doc = {
        "_id": song_id, "name": sanitize_filename(name, "song").rsplit(".", 1)[0][:120], "source": source, "fileKey": key,
        "size": src.stat().st_size, "sha1": digest, "createdAt": utcnow(), "lastUsedAt": None, "useCount": 0, **facts,
        **{k: v for k, v in meta.items() if v not in (None, "")},
    }  # fmt: skip
    await db.songs.insert_one(doc)
    return doc


async def add_from_project_upload(media: dict[str, Any]) -> None:
    """A song uploaded to a Reel joins the library (never fails the upload)."""
    try:
        doc = await add_file(get_storage().local_path(media["storedKey"]), media.get("originalName") or "song", "upload")
        await get_db().songs.update_one({"_id": doc["_id"]}, {"$set": {"lastUsedAt": utcnow()}, "$inc": {"useCount": 1}})
    except Exception as exc:  # noqa: BLE001 - the library is a convenience
        log.warning("could not add the uploaded song to the library: %s", exc)


def watched_folders() -> list[Path]:
    raw = get_settings().song_import_folders
    return [Path(os.path.expandvars(os.path.expanduser(p.strip()))) for p in raw.split(";") if p.strip()]


async def import_folders(force: bool = False) -> dict[str, Any]:
    """Add new audio files from the watched folders (at most every FOLDER_SCAN_EVERY seconds unless forced)."""
    global _last_scan
    folders = watched_folders()
    if not folders or (not force and time.monotonic() - _last_scan < FOLDER_SCAN_EVERY):
        return {"folders": [str(f) for f in folders], "added": 0, "scanned": False}
    _last_scan = time.monotonic()
    db = get_db()
    known = {d["folderPath"] async for d in db.songs.find({"folderPath": {"$exists": True}}, {"folderPath": 1})}
    known |= {d["_id"] async for d in db.song_ignored.find({}, {"_id": 1})}
    added, errors = 0, []
    for folder in folders:
        if not folder.is_dir():
            errors.append(f"{folder} does not exist")
            continue
        for f in sorted(folder.rglob("*")):
            if f.suffix.lower() not in AUDIO_EXTS or not f.is_file() or str(f) in known or f.stat().st_size < 50_000:
                continue
            try:
                before = await db.songs.count_documents({})
                await add_file(f, f.name, "folder", folderPath=str(f))
                added += (await db.songs.count_documents({})) > before
            except Exception as exc:  # noqa: BLE001 - one bad file never stops the import
                errors.append(f"{f.name}: {getattr(exc, 'message', str(exc))[:80]}")
    return {"folders": [str(f) for f in folders], "added": added, "scanned": True, "errors": errors[:10]}


async def list_songs(q: str = "") -> list[dict[str, Any]]:
    query: dict[str, Any] = {}
    if q.strip():
        import re

        pat = re.escape(q.strip())
        query = {"$or": [{"name": {"$regex": pat, "$options": "i"}}, {"artist": {"$regex": pat, "$options": "i"}}]}
    docs = [d async for d in get_db().songs.find(query)]
    docs.sort(key=lambda d: (d.get("lastUsedAt") or d["createdAt"]), reverse=True)
    return docs


async def get_song(song_id: str) -> dict[str, Any]:
    try:
        oid = ObjectId(song_id)
    except Exception as exc:  # noqa: BLE001
        raise NotFoundError("Song not found.", code="SONG_NOT_FOUND") from exc
    doc = await get_db().songs.find_one({"_id": oid})
    if not doc:
        raise NotFoundError("Song not found.", code="SONG_NOT_FOUND")
    return doc


async def delete_song(song_id: str) -> None:
    doc = await get_song(song_id)
    try:
        get_storage().delete(doc["fileKey"])
    except Exception:  # noqa: BLE001 - a missing file is already gone
        pass
    if doc.get("folderPath"):  # a deleted folder song stays deleted: the next scan skips its path
        await get_db().song_ignored.update_one({"_id": doc["folderPath"]}, {"$set": {"at": utcnow()}}, upsert=True)
    await get_db().songs.delete_one({"_id": doc["_id"]})


async def mark_used(song_id: str) -> None:
    doc = await get_song(song_id)
    await get_db().songs.update_one({"_id": doc["_id"]}, {"$set": {"lastUsedAt": utcnow()}, "$inc": {"useCount": 1}})
