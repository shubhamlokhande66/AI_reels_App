"""Media library: search, filters, tags, favourites, AI search."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query
from pydantic import Field

from app.ai.provider import get_provider
from app.core.database import get_db
from app.core.errors import AppError, NotFoundError
from app.models.base import CamelModel
from app.services import library as lib
from app.services.ids import parse_id

router = APIRouter(prefix="/api/library", tags=["library"])


class MediaPatch(CamelModel):
    favorite: bool | None = None
    tags: list[str] | None = Field(default=None, max_length=30)


class SearchRequest(CamelModel):
    query: str = Field(min_length=1, max_length=200)
    ai: bool = False
    limit: int = Field(default=50, ge=1, le=200)


@router.get("")
async def list_library(
    q: Annotated[str | None, Query(max_length=200)] = None,
    tag: str | None = None,
    category: str | None = None,
    favorite: bool | None = None,
    used: bool | None = None,
    analyzed: bool | None = None,
    project: str | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
):
    items = await lib.all_items(parse_id(project, "Project") if project else None)
    tags = lib.top_tags(items)
    items = lib.apply_filters(items, tag=tag, category=category, favorite=favorite, used=used, analyzed=analyzed)
    if q:
        items = lib.search(items, lib.tokenize(q))
    return {"items": items[:limit], "total": len(items), "tags": tags}


@router.post("/search")
async def ai_search(payload: SearchRequest):
    """Natural-language search ("close-up jewellery shots"). AI adds synonyms; without AI it is keyword search."""
    provider = None
    if payload.ai:
        try:
            provider = get_provider("library_search")
        except AppError:
            provider = None
    terms, note = await lib.ai_terms(provider, payload.query)
    items = lib.search(await lib.all_items(), terms)
    return {"items": items[: payload.limit], "total": len(items), "terms": terms, "note": note, "ai": provider is not None and note is None}


@router.patch("/{media_id}")
async def update_media(media_id: str, payload: MediaPatch):
    db = get_db()
    mid = parse_id(media_id, "Media")
    m = await db.media.find_one({"_id": mid, "kind": "video"})
    if not m:
        raise NotFoundError("Media not found.", code="MEDIA_NOT_FOUND")
    update = {}
    if payload.favorite is not None:
        update["favorite"] = payload.favorite
    if payload.tags is not None:
        update["userTags"] = lib.clean_tags(payload.tags)
    if update:
        await db.media.update_one({"_id": mid}, {"$set": update})
    items = await lib.all_items(m["projectId"])
    return next(i for i in items if i["id"] == media_id)
