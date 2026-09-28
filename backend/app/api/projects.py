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
    """Media changed: the project-level analysis/timeline are stale."""
    update = {"analysis": None, "timeline": None, "updatedAt": utcnow(), **(extra or {})}
    await get_db().projects.update_one({"_id": project_doc["_id"]}, {"$set": update})


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
    media = await media_service.save_upload(doc["_id"], file, "audio")
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
    return project_service.media_to_out(media)


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
    ctype = mimetypes.guess_type(media["originalName"])[0] or "application/octet-stream"
    return FileResponse(path, media_type=ctype)


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
