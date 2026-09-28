"""Product Reels: photo uploads, the director's shot list, and rendering."""

from __future__ import annotations

import asyncio
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Response, UploadFile
from pydantic import Field

from app.api.projects import _ensure_editable, _touch_after_media_change, upload_limit
from app.core.config import get_settings
from app.core.database import get_db
from app.core.errors import AppError, NotFoundError, ValidationFailed
from app.core.ratelimit import rate_limit
from app.jobs import manager
from app.jobs import pipeline as pl
from app.models.base import CamelModel, utcnow
from app.schemas.project import JobOut, MediaOut
from app.services import media_service, project_service
from app.services.ids import parse_id
from app.storage import get_storage

router = APIRouter(prefix="/api", tags=["product"])


@router.get("/product/styles")
async def product_styles():
    from app.product.styles import list_product_styles

    return [{"id": s.id, "name": s.name, "description": s.description} for s in list_product_styles()]


@router.post("/projects/{project_id}/images", status_code=201, dependencies=[upload_limit])
async def upload_images(project_id: str, files: Annotated[list[UploadFile], File()]):
    doc = await project_service.get_project_doc(project_id)
    _ensure_editable(doc)
    limit = get_settings().max_images_per_project
    if len(doc.get("imageOrder", [])) + len(files) > limit:
        raise ValidationFailed(f"A project can hold at most {limit} photos.", code="TOO_MANY_IMAGES")
    uploaded: list[MediaOut] = []
    failed: list[dict] = []
    new_ids = []
    for f in files:
        try:
            media = await media_service.save_image(doc["_id"], f)
            new_ids.append(media["_id"])
            uploaded.append(project_service.media_to_out(media))
        except AppError as exc:
            failed.append({"name": media_service.sanitize_filename(f.filename), "error": {"code": exc.code, "message": exc.message, "details": exc.details}})
    if new_ids:
        await get_db().projects.update_one({"_id": doc["_id"]}, {"$push": {"imageOrder": {"$each": new_ids}}})
        await _touch_after_media_change(doc, {"productPlan": None})
    if not uploaded and failed:
        first = failed[0]["error"]
        raise AppError(first["message"], code=first["code"], details=failed, status_code=413 if first["code"] == "FILE_TOO_LARGE" else 415 if first["code"] == "UNSUPPORTED_MEDIA" else 422)
    return {"uploaded": [m.model_dump(by_alias=True) for m in uploaded], "failed": failed}


@router.delete("/projects/{project_id}/images/{media_id}", status_code=204)
async def delete_image(project_id: str, media_id: str):
    doc = await project_service.get_project_doc(project_id)
    _ensure_editable(doc)
    mid = parse_id(media_id, "Media")
    db = get_db()
    media = await db.media.find_one({"_id": mid, "projectId": doc["_id"], "kind": "image"})
    if not media:
        raise NotFoundError("Photo not found.", code="MEDIA_NOT_FOUND")
    await media_service.delete_media_files(media)
    get_storage().delete(f"projects/{project_id}/analysis/product_{media_id}.json")
    await db.media.delete_one({"_id": mid})
    await db.projects.update_one({"_id": doc["_id"]}, {"$pull": {"imageOrder": mid}})
    await _touch_after_media_change(doc, {"productPlan": None})
    return Response(status_code=204)


class ImageOrder(CamelModel):
    ids: list[str] = Field(min_length=1, max_length=50)


@router.put("/projects/{project_id}/images/order")
async def reorder_images(project_id: str, payload: ImageOrder):
    doc = await project_service.get_project_doc(project_id)
    _ensure_editable(doc)
    ids = [parse_id(i, "Media") for i in payload.ids]
    if sorted(ids) != sorted(doc.get("imageOrder", [])) or len(set(ids)) != len(ids):
        raise ValidationFailed("The order must list every photo of the project exactly once.", code="INVALID_ORDER")
    await get_db().projects.update_one({"_id": doc["_id"]}, {"$set": {"imageOrder": ids, "updatedAt": utcnow()}})
    return {"ids": payload.ids}


class ProductRequest(CamelModel):
    """Changes for one direction/render. Anything left out keeps the project's own setting."""

    product_style: str | None = None
    hook_text: str | None = Field(default=None, max_length=80)
    tagline_text: str | None = Field(default=None, max_length=80)
    cta_text: str | None = Field(default=None, max_length=80)
    loop: bool | None = None
    duration: int | None = Field(default=None, ge=5, le=600)
    audio_start: float | None = Field(default=None, ge=0, le=36000)
    audio_auto: bool = False  # forget a chosen part of the song
    seed: int | None = Field(default=None, ge=0, le=10_000_000)
    quality: Literal["preview", "final"] = "final"
    label: str | None = Field(default=None, max_length=60)

    def overrides(self) -> dict:
        return {
            "productStyle": self.product_style, "hookText": self.hook_text, "taglineText": self.tagline_text, "ctaText": self.cta_text,
            "loop": self.loop, "duration": self.duration, "audioStart": self.audio_start,
        }  # fmt: skip


@router.post("/projects/{project_id}/product/plan", dependencies=[Depends(rate_limit("job", 30))])
async def plan_product(project_id: str, payload: ProductRequest | None = None):
    """The director's shot list, without rendering anything: every micro-shot, camera move, effect, transition and text."""
    req = payload or ProductRequest()
    _, inp = await manager.product_input(project_id, req.overrides(), req.quality, req.seed or 0, req.audio_auto)
    plan, _ = await asyncio.to_thread(pl.make_product_plan, inp, get_storage(), lambda *_: None)
    return plan.to_doc()


@router.post("/projects/{project_id}/product/generate", response_model=JobOut, status_code=202, dependencies=[Depends(rate_limit("job", 30))])
async def generate_product(project_id: str, payload: ProductRequest | None = None):
    req = payload or ProductRequest()
    job = await manager.submit_product(project_id, req.overrides(), req.quality, req.label or "", req.seed or 0, req.audio_auto)
    return project_service.job_to_out(job)
