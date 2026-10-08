"""Publish / schedule a finished Reel (publish/), and the signed public link the platforms download it from."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Literal

from bson import ObjectId
from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from pydantic import Field

from app.core.auth import current_user
from app.core.database import get_db
from app.core.errors import NotFoundError, ValidationFailed
from app.core.ratelimit import rate_limit
from app.models.base import CamelModel, utcnow
from app.publish import platforms as pf
from app.publish import service
from app.services import project_service as ps
from app.services.ids import parse_id
from app.storage import get_storage

router = APIRouter(prefix="/api", tags=["publish"])
Platform = Literal["instagram", "tiktok", "youtube"]
_tasks: set[asyncio.Task] = set()


class PublishRequest(CamelModel):
    platforms: list[Platform] = Field(min_length=1, max_length=3)
    caption: str = Field(default="", max_length=2200)
    at: datetime | None = None  # None = now


def _out(p: dict) -> dict:
    return {
        "id": str(p["_id"]), "renderingId": str(p["renderingId"]), "platforms": p["platforms"], "caption": p.get("caption", ""),
        "at": p.get("at"), "status": p["status"], "results": p.get("results", {}), "error": p.get("error"), "createdAt": p["createdAt"],
    }  # fmt: skip


@router.get("/publish/connections")
async def connections():
    """Which platforms this server can post to, and the .env settings still missing for the others."""
    return pf.connections()


@router.post("/projects/{project_id}/renderings/{rendering_id}/publish", status_code=202, dependencies=[Depends(rate_limit("publish", 20))])
async def publish(project_id: str, rendering_id: str, payload: PublishRequest):
    doc = await ps.get_project_doc(project_id)
    db = get_db()
    r = await db.renderings.find_one({"_id": parse_id(rendering_id, "Rendering"), "projectId": doc["_id"]})
    if not r:
        raise NotFoundError("Rendering not found.", code="RENDERING_NOT_FOUND")
    chosen = list(dict.fromkeys(payload.platforms))
    conn = pf.connections()
    off = [p for p in chosen if not conn[p]["connected"]]
    if off:
        raise ValidationFailed(
            f"Not connected yet: {', '.join(p.title() for p in off)}. Download the Reel and post it yourself, or ask the admin to connect it.",
            code="PLATFORM_NOT_CONNECTED", details={"missing": {p: conn[p]["missing"] for p in off}},
        )  # fmt: skip
    now = utcnow()
    at = payload.at
    if at is not None and at.tzinfo is None:
        at = at.replace(tzinfo=timezone.utc)
    if at and at < now - timedelta(minutes=1):
        raise ValidationFailed("Choose a time in the future.", code="TIME_IN_PAST")
    if at and at > now + timedelta(days=60):
        raise ValidationFailed("Schedule at most 60 days ahead.", code="TIME_TOO_FAR")
    scheduled = bool(at and at > now + timedelta(minutes=1))
    post = {
        "_id": ObjectId(), "projectId": doc["_id"], "renderingId": r["_id"], "platforms": chosen, "caption": payload.caption.strip(),
        "at": at or now, "status": "scheduled" if scheduled else "publishing", "results": {}, "createdAt": now, "updatedAt": now,
    }  # fmt: skip
    await db.posts.insert_one(post)
    if not scheduled:
        task = asyncio.create_task(service.run_post(post["_id"]))
        _tasks.add(task)
        task.add_done_callback(_tasks.discard)
    return _out(post)


@router.get("/projects/{project_id}/posts")
async def posts(project_id: str):
    doc = await ps.get_project_doc(project_id)
    return [_out(p) async for p in get_db().posts.find({"projectId": doc["_id"]}).sort("createdAt", -1).limit(50)]


@router.delete("/posts/{post_id}")
async def cancel(post_id: str):
    res = await get_db().posts.update_one(
        {"_id": parse_id(post_id, "Post"), "status": "scheduled"}, {"$set": {"status": "cancelled", "updatedAt": utcnow()}}
    )
    if not res.modified_count:
        raise NotFoundError("No scheduled post to cancel (it may already be published).", code="POST_NOT_SCHEDULED")
    return {"ok": True}


@router.get("/public/reels/{token}")
async def public_reel(token: str):
    """The Reel file for a platform to download: only with a signed, unexpired link (no sign-in)."""
    data = service.read_link(token)
    if not data or not ObjectId.is_valid(data.get("r", "")) or not ObjectId.is_valid(data.get("p", "")):
        raise NotFoundError("This link has expired.", code="LINK_EXPIRED")
    tok = current_user.set(data.get("u"))
    try:
        r = await get_db().renderings.find_one({"_id": ObjectId(data["r"]), "projectId": ObjectId(data["p"])})
    finally:
        current_user.reset(tok)
    path = get_storage().local_path(r["storedKey"]) if r else None
    if not path or not path.exists():
        raise NotFoundError("Rendering not found.", code="RENDERING_NOT_FOUND")
    return FileResponse(path, media_type="video/mp4")
