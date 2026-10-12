"""Project CRUD, uploads and media serving."""

from __future__ import annotations

import mimetypes
from typing import Annotated

from fastapi import APIRouter, Depends, File, Query, Response, UploadFile
from fastapi.responses import FileResponse

from app.core.config import get_settings
from app.core.database import get_db
from app.core.errors import AppError, ConflictError, NotFoundError, ValidationFailed
from app.core.ratelimit import rate_limit
from app.models.base import utcnow
from app.schemas.project import (
    MediaOut,
    ProjectCreate,
    ProjectOut,
    ProjectSummary,
    ProjectUpdate,
    VideoOrder,
)
from app.services import media_service, project_service
from app.services.ids import parse_id
from app.storage import get_storage

router = APIRouter(prefix="/api/projects", tags=["projects"])
upload_limit = Depends(rate_limit("upload", 120))


@router.post("", response_model=ProjectOut, status_code=201)
async def create_project(payload: ProjectCreate):
    doc = await project_service.create_project(payload)
    return await project_service.build_project_out(doc)


@router.get("", response_model=list[ProjectSummary])
async def list_projects(
    status: Annotated[str | None, Query(pattern="^(draft|processing|completed|failed)$")] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
):
    return await project_service.list_projects(status, limit)


@router.get("/{project_id}", response_model=ProjectOut)
async def get_project(project_id: str):
    doc = await project_service.get_project_doc(project_id)
    return await project_service.build_project_out(doc)


@router.patch("/{project_id}", response_model=ProjectOut)
async def update_project(project_id: str, payload: ProjectUpdate):
    doc = await project_service.update_project(project_id, payload)
    return await project_service.build_project_out(doc)


@router.delete("/{project_id}", status_code=204)
async def delete_project(project_id: str):
    await project_service.delete_project(project_id)
    return Response(status_code=204)


async def _touch_after_media_change(project_doc: dict, extra: dict | None = None) -> None:
    """Media changed: the project-level analysis is stale. The edit is kept (the editor adds new clips to it, a new
    song plays under it; a deleted clip leaves it in _drop_clip_from_edit)."""
    update = {"analysis": None, "updatedAt": utcnow(), **(extra or {})}
    await get_db().projects.update_one({"_id": project_doc["_id"]}, {"$set": update})


async def _new_song_under_edit(project_id: str) -> None:
    """A new song: the edit plays it from its start (its beats are found by services/markers.py), and the hand-made
    beat markers of the old song are gone - one undoable step."""
    from app.models.timeline import Timeline
    from app.services import timeline_service as ts

    doc = await ts.load(project_id)
    await get_db().projects.update_one({"_id": doc["_id"]}, {"$unset": {"beatMarkers": ""}})
    tl = ts.state_of(doc)["timeline"]
    if tl:
        cur = Timeline.model_validate(tl)
        await ts.replace(project_id, cur.model_copy(update={"audio_start": 0.0, "bpm": 0.0}), "New song")


async def _drop_clip_from_edit(project_id: str, clip_id: str) -> None:
    """A deleted clip's shots leave the edit (the others close up), one undoable step; no shots left = no edit."""
    from app.models.timeline import Timeline
    from app.services import timeline_service as ts

    doc = await ts.load(project_id)
    tl = ts.state_of(doc)["timeline"]
    if not tl:
        return
    cur = Timeline.model_validate(tl)
    keep = [sg for sg in cur.segments if sg.clip_id != clip_id]
    if len(keep) == len(cur.segments):
        return
    if not keep:
        await get_db().projects.update_one({"_id": doc["_id"]}, {"$set": {"timeline": None, "timelineHistory": [], "historyIndex": 0}})
        return
    t, segs = 0.0, []
    for sg in keep:
        length = sg.timeline_end - sg.timeline_start
        segs.append(sg.model_copy(update={"timeline_start": round(t, 3), "timeline_end": round(t + length, 3)}))
        t += length
    await ts.replace(project_id, cur.model_copy(update={"segments": segs, "duration": round(t, 3)}), "Clip deleted")


def _ensure_editable(doc: dict) -> None:
    if doc["status"] == "processing":
        raise ConflictError("The project is being processed; try again when it finishes.",
                            code="PROJECT_BUSY")


@router.post("/{project_id}/videos", status_code=201, dependencies=[upload_limit])
async def upload_videos(project_id: str, files: Annotated[list[UploadFile], File()]):
    doc = await project_service.get_project_doc(project_id)
    _ensure_editable(doc)
    limit = get_settings().max_videos_per_project  # 0 = unlimited
    if limit and len(doc.get("videoOrder", [])) + len(files) > limit:
        raise ValidationFailed(
            f"A project can hold at most {limit} videos.", code="TOO_MANY_VIDEOS"
        )
    uploaded: list[MediaOut] = []
    failed: list[dict] = []
    new_ids = []
    for f in files:
        try:
            media = await media_service.save_upload(doc["_id"], f, "video")
            new_ids.append(media["_id"])
            uploaded.append(project_service.media_to_out(media))
        except AppError as exc:
            failed.append({"name": media_service.sanitize_filename(f.filename),
                           "error": {"code": exc.code, "message": exc.message, "details": exc.details}})
    if new_ids:
        await get_db().projects.update_one(
            {"_id": doc["_id"]}, {"$push": {"videoOrder": {"$each": new_ids}}}
        )
        await _touch_after_media_change(doc)
    if not uploaded and failed:
        first = failed[0]["error"]
        raise AppError(first["message"], code=first["code"], details=failed,
                       status_code=415 if first["code"] != "FILE_TOO_LARGE" else 413)
    return {"uploaded": [m.model_dump(by_alias=True) for m in uploaded], "failed": failed}


@router.post("/{project_id}/audio", response_model=MediaOut, status_code=201, dependencies=[upload_limit])
async def upload_audio(project_id: str, file: Annotated[UploadFile, File()]):
    doc = await project_service.get_project_doc(project_id)
    _ensure_editable(doc)
    media = await replace_project_audio(doc, file)
    if (doc.get("referenceReel") or {}).get("use_audio"):  # their own song now: the reference keeps only its timing
        await get_db().projects.update_one({"_id": doc["_id"]}, {"$set": {"referenceReel.use_audio": False}})
    return project_service.media_to_out(media)


async def replace_project_audio(doc: dict, file, to_library: bool = True) -> dict:
    """Save ``file`` as the project's song (the previous one is deleted). Shared by the upload and "use the reference's music"."""
    media = await media_service.save_upload(doc["_id"], file, "audio")
    if to_library:
        from app.services.songs import add_from_project_upload

        await add_from_project_upload(media)  # every song used once is kept in the song library
    db = get_db()
    old = doc.get("audioId")
    if old:
        old_doc = await db.media.find_one({"_id": old})
        if old_doc:
            await media_service.delete_media_files(old_doc)
            await db.media.delete_one({"_id": old})
    await _touch_after_media_change(doc, {"audioId": media["_id"]})
    await _new_song_under_edit(str(doc["_id"]))
    return media


@router.delete("/{project_id}/videos/{media_id}", status_code=204)
async def delete_video(project_id: str, media_id: str):
    doc = await project_service.get_project_doc(project_id)
    _ensure_editable(doc)
    mid = parse_id(media_id, "Media")
    db = get_db()
    media = await db.media.find_one({"_id": mid, "projectId": doc["_id"], "kind": "video"})
    if not media:
        raise NotFoundError("Video not found.", code="MEDIA_NOT_FOUND")
    await media_service.delete_media_files(media)
    await db.media.delete_one({"_id": mid})
    await db.projects.update_one({"_id": doc["_id"]}, {"$pull": {"videoOrder": mid}})
    await _touch_after_media_change(doc)
    await _drop_clip_from_edit(project_id, str(mid))
    return Response(status_code=204)


@router.put("/{project_id}/videos/order", response_model=ProjectOut)
async def reorder_videos(project_id: str, payload: VideoOrder):
    doc = await project_service.get_project_doc(project_id)
    _ensure_editable(doc)
    ids = [parse_id(i, "Media") for i in payload.ids]
    if sorted(ids) != sorted(doc.get("videoOrder", [])) or len(set(ids)) != len(ids):
        raise ValidationFailed(
            "The order must list every video of the project exactly once.", code="INVALID_ORDER"
        )
    await get_db().projects.update_one(
        {"_id": doc["_id"]}, {"$set": {"videoOrder": ids, "updatedAt": utcnow()}}
    )
    return await project_service.build_project_out(await project_service.get_project_doc(project_id))


@router.get("/{project_id}/media/{media_id}/file")
async def get_media_file(project_id: str, media_id: str):
    doc = await project_service.get_project_doc(project_id)
    media = await get_db().media.find_one({"_id": parse_id(media_id, "Media"), "projectId": doc["_id"]})
    if not media:
        raise NotFoundError("Media not found.", code="MEDIA_NOT_FOUND")
    path = get_storage().local_path(media["storedKey"])
    if not path.exists():
        raise NotFoundError("Media file is missing from storage.", code="MEDIA_FILE_MISSING")
    if media.get("kind") == "audio":  # songs: the type the browser can play, from the file's content, not its name
        import asyncio

        path, ctype = await asyncio.to_thread(playable_audio, path)
        return FileResponse(path, media_type=ctype)
    ctype = mimetypes.guess_type(media["originalName"])[0] or "application/octet-stream"
    return FileResponse(path, media_type=ctype)


def sniff_audio(path) -> str | None:
    """The audio type of a file from its first bytes (a WhatsApp ".mpeg" voice / song is an MP3: served as
    video/mpeg by its name, a browser refuses it). None = not a format browsers play."""
    with open(path, "rb") as f:
        head = f.read(12)
    if head[:3] == b"ID3" or (len(head) > 1 and head[0] == 0xFF and head[1] & 0xE0 == 0xE0 and head[1] & 0x06):
        return "audio/mpeg"  # MP3 (also MP2 frames, which browsers play as audio/mpeg)
    if head[4:8] == b"ftyp":
        return "audio/mp4"
    if head[:4] == b"RIFF" and head[8:12] == b"WAVE":
        return "audio/wav"
    if head[:4] == b"OggS":
        return "audio/ogg"
    if head[:4] == b"fLaC":
        return "audio/flac"
    if len(head) > 1 and head[0] == 0xFF and head[1] & 0xF6 == 0xF0:
        return "audio/aac"  # ADTS AAC
    if head[:4] == bytes([0x1A, 0x45, 0xDF, 0xA3]):  # Matroska / WebM
        return "audio/webm"
    return None


def playable_audio(path):
    """(file, type) a browser can play: the song itself when its format is one browsers play, otherwise an MP3 copy
    made once next to it (AMR voice notes, WMA, AC3...)."""
    from pathlib import Path as _P

    from app.core.ffmpeg import run_ffmpeg

    path = _P(path)
    ctype = sniff_audio(path)
    if ctype is not None:
        return path, ctype
    copy = path.with_suffix(path.suffix + ".play.mp3")
    if not copy.exists() or copy.stat().st_mtime < path.stat().st_mtime:
        tmp = copy.with_suffix(".tmp.mp3")
        run_ffmpeg(["-i", str(path), "-vn", "-c:a", "libmp3lame", "-b:a", "160k", str(tmp)], timeout=300)
        tmp.replace(copy)
    return copy, "audio/mpeg"


@router.get("/{project_id}/media/{media_id}/thumbnail")
async def get_media_thumbnail(project_id: str, media_id: str):
    doc = await project_service.get_project_doc(project_id)
    media = await get_db().media.find_one({"_id": parse_id(media_id, "Media"), "projectId": doc["_id"]})
    if not media or not media.get("thumbnailKey"):
        raise NotFoundError("Thumbnail not found.", code="THUMBNAIL_NOT_FOUND")
    path = get_storage().local_path(media["thumbnailKey"])
    if not path.exists():
        raise NotFoundError("Thumbnail not found.", code="THUMBNAIL_NOT_FOUND")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=3600"})
