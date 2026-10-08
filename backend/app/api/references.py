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
MAX_VIDEOS = 200  # per trend (newest kept)


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
    return {"id": str(d["_id"]), "name": d["name"], "notes": d.get("notes", ""), "auto": bool(d.get("auto")), "profile": _camel(d.get("profile", {})),
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


# ---------------------------------------------------------------------- learning from many Reels (bulk) + auto styles
LIBRARY_MAX = 500  # learned Reels kept (the oldest go first); each is a few KB of numbers


@router.post("/api/trend-library/learn")
async def learn(files: list[UploadFile] = File(...)):
    """Measure a few more trending Reels into the learning library (send them a few at a time: each takes ~10-20 s).
    A file that cannot be read is reported by name; the others are still learned."""
    from app.models.base import utcnow as now_

    if not files:
        raise ValidationFailed("Add at least one video.", code="NO_VIDEOS")
    if len(files) > MAX_FILES:
        raise ValidationFailed(f"Send at most {MAX_FILES} videos at a time.", code="TOO_MANY_FILES")
    db = get_db()
    learned, failed = [], []
    for f in files:
        try:
            prof = (await _measure([f]))[0]
        except (ValidationFailed, UnsupportedMedia) as exc:
            failed.append({"name": f.filename or "video", "error": exc.message})
            continue
        prof["added_at"] = now_().isoformat()
        await db.trend_videos.insert_one({"_id": ObjectId(), "name": prof.get("name", ""), "profile": prof, "addedAt": now_()})
        learned.append(prof.get("name", ""))
    total = await db.trend_videos.count_documents({})
    if total > LIBRARY_MAX:  # the oldest go first
        old = [d["_id"] async for d in db.trend_videos.find({}, {"_id": 1}).sort("addedAt", 1).limit(total - LIBRARY_MAX)]
        await db.trend_videos.delete_many({"_id": {"$in": old}})
        total = LIBRARY_MAX
    return {"learned": learned, "failed": failed, "total": total}


@router.get("/api/trend-library")
async def library():
    db = get_db()
    last = await db.trend_videos.find_one({}, sort=[("addedAt", -1)])
    return {"count": await db.trend_videos.count_documents({}), "lastAdded": last["addedAt"] if last else None,
            "styles": await db.references.count_documents({"auto": True})}  # fmt: skip


@router.post("/api/trend-library/group")
async def group():
    """Sort every learned Reel into editing styles (replaces the previous automatic styles; your own trends stay)."""
    from app.models.base import utcnow as now_
    from app.trends.learn import group_videos, name_for

    db = get_db()
    videos = [d["profile"] async for d in db.trend_videos.find({}).sort("addedAt", 1)]
    if not videos:
        raise ValidationFailed("Add a trending Reel first.", code="NO_REELS")  # one Reel already gives a style; more make it steadier
    groups = await asyncio.to_thread(group_videos, videos)
    await db.references.delete_many({"auto": True})
    names: set[str] = set()
    out = []
    for idx in groups:
        vids = [videos[i] for i in idx]
        prof = merge_profiles(vids)
        name = base = name_for(prof)
        k = 2
        while name in names:
            name, k = f"{base} ({k})", k + 1
        names.add(name)
        doc = {"_id": ObjectId(), "name": name, "notes": f"Learned from {len(vids)} trending Reels", "videos": vids, "profile": prof,
               "auto": True, "createdAt": now_(), "updatedAt": now_()}  # fmt: skip
        await db.references.insert_one(doc)
        out.append(_out(doc))
    return out


@router.delete("/api/trend-library", status_code=204)
async def clear_library():
    db = get_db()
    await db.trend_videos.delete_many({})
    auto_ids = [str(d["_id"]) async for d in db.references.find({"auto": True}, {"_id": 1})]
    await db.references.delete_many({"auto": True})
    await db.projects.update_many({"settings.reference": {"$in": auto_ids}}, {"$set": {"settings.reference": "auto"}})
    return Response(status_code=204)


# ---------------------------------------------------------------------- "make it like this Reel" (one project)
@router.post("/api/projects/{project_id}/reference-reel")
async def set_reference_reel(project_id: str, file: UploadFile = File(...)):
    """Measure one Reel the user wants theirs to be like (shot by shot). Only the measurements are kept on the project."""
    from app.services.project_service import get_project_doc
    from app.trends.reference import for_ai

    doc = await get_project_doc(project_id)
    name = sanitize_filename(file.filename, "reference")
    if Path(name).suffix.lower() not in VIDEO_EXTS:
        raise UnsupportedMedia(f"{name} is not a supported video file.", code="UNSUPPORTED_MEDIA")
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / f"ref{Path(name).suffix.lower()}"
        with path.open("wb") as fh:
            shutil.copyfileobj(file.file, fh, length=1024 * 1024)
        if path.stat().st_size > MAX_BYTES:
            raise ValidationFailed(f"{name} is larger than 300 MB.", code="FILE_TOO_LARGE")
        try:
            prof = await asyncio.to_thread(profile_video, path, name, True)
        except Exception as exc:  # noqa: BLE001
            raise ValidationFailed(f"{name} could not be read as a video ({exc}).", code="UNREADABLE_VIDEO") from exc
    if prof.get("shots", 0) < 2:
        raise ValidationFailed("This video has no cuts to copy (it is one continuous shot). Choose an edited Reel.", code="NO_CUTS")
    ref = {"name": name, "seconds": prof["seconds"], "cuts": prof.pop("cuts", []), "on_beat_share": prof.get("on_beat_share"),
           "profile": for_ai({"name": name, "profile": prof})}  # fmt: skip
    await get_db().projects.update_one({"_id": doc["_id"]}, {"$set": {"referenceReel": ref, "updatedAt": utcnow()}})
    return _reference_out(ref)


def _reference_out(ref: dict | None) -> dict | None:
    if not ref:
        return None
    p = ref.get("profile") or {}
    return {"name": ref["name"], "seconds": ref["seconds"], "shots": len(ref.get("cuts", [])) + 1, "avgShot": p.get("avg_shot"),
            "hookSeconds": p.get("hook_seconds"), "onBeatShare": ref.get("on_beat_share"), "bpm": p.get("bpm"),
            "summary": ((p.get("described") or [{}])[0] or {}).get("summary", "") if isinstance(p.get("described"), list) else ""}  # fmt: skip


@router.get("/api/projects/{project_id}/reference-reel")
async def get_reference_reel(project_id: str):
    from app.services.project_service import get_project_doc

    return _reference_out((await get_project_doc(project_id)).get("referenceReel"))


@router.delete("/api/projects/{project_id}/reference-reel", status_code=204)
async def remove_reference_reel(project_id: str):
    from app.services.project_service import get_project_doc

    doc = await get_project_doc(project_id)
    await get_db().projects.update_one({"_id": doc["_id"]}, {"$unset": {"referenceReel": ""}})
    return Response(status_code=204)
