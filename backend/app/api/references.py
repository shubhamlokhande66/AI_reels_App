"""My trends: learn an editing style from reference Reels the user uploads (see ``app/trends/reference.py``).

The uploaded files are measured and deleted; only the numbers and descriptions are stored.
"""

from __future__ import annotations

import asyncio
import re
import shutil
import tempfile
from pathlib import Path

from bson import ObjectId
from fastapi import APIRouter, File, Form, Response, UploadFile
from pydantic import Field

from app.core.database import get_db
from app.core.errors import NotFoundError, UnsupportedMedia, ValidationFailed
from app.models.base import CamelModel, utcnow
from app.services.ids import parse_id
from app.services.media_service import VIDEO_EXTS, sanitize_filename
from app.trends.reference import merge_profiles, profile_video

router = APIRouter(tags=["references"])
MAX_FILES = 6  # per upload
MAX_BYTES = 300 * 1024 * 1024
MAX_VIDEOS = 20  # per trend


class ReferenceUpdate(CamelModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    notes: str | None = Field(default=None, max_length=300)  # what the user likes about it ("the fast zooms on the drop")


def _camel(v):
    """snake_case keys of the stored measurements -> camelCase, like the rest of the API."""
    if isinstance(v, dict):
        return {re.sub(r"_([a-z0-9])", lambda m: m.group(1).upper(), k): _camel(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_camel(x) for x in v]
    return v


def _out(d: dict) -> dict:
    return {"id": str(d["_id"]), "name": d["name"], "notes": d.get("notes", ""), "profile": _camel(d.get("profile", {})),
            "videos": _camel(d.get("videos", [])), "createdAt": d.get("createdAt"), "updatedAt": d.get("updatedAt")}  # fmt: skip


async def _measure(files: list[UploadFile]) -> list[dict]:
    if not files:
        raise ValidationFailed("Add at least one reference video.", code="NO_VIDEOS")
    if len(files) > MAX_FILES:
        raise ValidationFailed(f"Add at most {MAX_FILES} videos at a time.", code="TOO_MANY_FILES")
    out: list[dict] = []
    with tempfile.TemporaryDirectory() as tmp:
        for f in files:
            name = sanitize_filename(f.filename, "reference")
            if Path(name).suffix.lower() not in VIDEO_EXTS:
                raise UnsupportedMedia(f"{name} is not a supported video file.", code="UNSUPPORTED_MEDIA")
            path = Path(tmp) / f"{len(out)}{Path(name).suffix.lower()}"
            with path.open("wb") as fh:
                shutil.copyfileobj(f.file, fh, length=1024 * 1024)
            if path.stat().st_size > MAX_BYTES:
                raise ValidationFailed(f"{name} is larger than 300 MB.", code="FILE_TOO_LARGE")
            try:
                out.append(await asyncio.to_thread(profile_video, path, name))
            except Exception as exc:  # noqa: BLE001 - one unreadable file is reported by name
                raise ValidationFailed(f"{name} could not be read as a video ({exc}).", code="UNREADABLE_VIDEO") from exc
    return out


@router.get("/api/references")
async def list_references():
    return [_out(d) async for d in get_db().references.find({}).sort("updatedAt", -1)]


@router.post("/api/references", status_code=201)
async def create_reference(name: str = Form(..., min_length=1, max_length=80), notes: str = Form("", max_length=300),
                           files: list[UploadFile] = File(...)):  # fmt: skip
    videos = await _measure(files)
    now = utcnow()
    doc = {"_id": ObjectId(), "name": name.strip(), "notes": notes.strip(), "videos": videos, "profile": merge_profiles(videos),
           "createdAt": now, "updatedAt": now}  # fmt: skip
    await get_db().references.insert_one(doc)
    return _out(doc)


@router.post("/api/references/{ref_id}/videos")
async def add_videos(ref_id: str, files: list[UploadFile] = File(...)):
    oid = parse_id(ref_id, "Trend")
    doc = await get_db().references.find_one({"_id": oid})
    if not doc:
        raise NotFoundError("Trend not found.", code="TREND_NOT_FOUND")
    videos = (doc.get("videos", []) + await _measure(files))[-MAX_VIDEOS:]
    await get_db().references.update_one({"_id": oid}, {"$set": {"videos": videos, "profile": merge_profiles(videos), "updatedAt": utcnow()}})
    return _out(await get_db().references.find_one({"_id": oid}))


@router.patch("/api/references/{ref_id}")
async def update_reference(ref_id: str, payload: ReferenceUpdate):
    oid = parse_id(ref_id, "Trend")
    changes = {k: v.strip() for k, v in payload.model_dump(exclude_none=True).items()}
    res = await get_db().references.update_one({"_id": oid}, {"$set": {**changes, "updatedAt": utcnow()}})
    if not res.matched_count:
        raise NotFoundError("Trend not found.", code="TREND_NOT_FOUND")
    return _out(await get_db().references.find_one({"_id": oid}))


@router.delete("/api/references/{ref_id}/videos/{index}")
async def remove_video(ref_id: str, index: int):
    oid = parse_id(ref_id, "Trend")
    doc = await get_db().references.find_one({"_id": oid})
    if not doc:
        raise NotFoundError("Trend not found.", code="TREND_NOT_FOUND")
    videos = doc.get("videos", [])
    if not 0 <= index < len(videos) or len(videos) == 1:
        raise ValidationFailed("A trend keeps at least one video; delete the trend instead.", code="LAST_VIDEO")
    videos.pop(index)
    await get_db().references.update_one({"_id": oid}, {"$set": {"videos": videos, "profile": merge_profiles(videos), "updatedAt": utcnow()}})
    return _out(await get_db().references.find_one({"_id": oid}))


@router.delete("/api/references/{ref_id}", status_code=204)
async def delete_reference(ref_id: str):
    oid = parse_id(ref_id, "Trend")
    await get_db().references.delete_one({"_id": oid})
    await get_db().projects.update_many({"settings.reference": str(oid)}, {"$set": {"settings.reference": "auto"}})
    return Response(status_code=204)
