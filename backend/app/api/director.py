"""The AI Creative Director's feedback loop and privacy controls.

* ``POST /api/projects/{id}/feedback``: the person accepts or rejects a Reel (optionally saying what was wrong).
* ``GET/PUT/DELETE /api/director/profile``: the personal director profile learned from that feedback.
* ``POST /api/projects/{id}/purge-media``: delete the project's uploaded media now (the Reels are kept).
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter
from pydantic import Field

from app.core.database import get_db
from app.core.errors import NotFoundError
from app.models.base import CamelModel
from app.models.timeline import Timeline
from app.services import feedback as fb
from app.services import project_service as ps
from app.services.privacy import purge_media
from app.services.ids import parse_id

router = APIRouter(prefix="/api", tags=["director"])


class FeedbackIn(CamelModel):
    verdict: Literal["accepted", "rejected"]
    reason: Literal["opening", "pacing", "music", "clips", "text", "effects", "other"] | None = None
    rendering_id: str | None = Field(default=None, max_length=40)


class ProfileUpdate(CamelModel):
    enabled: bool


@router.post("/projects/{project_id}/feedback", status_code=201)
async def give_feedback(project_id: str, payload: FeedbackIn):
    doc = await ps.get_project_doc(project_id)
    tl_doc = doc.get("timeline")
    if payload.rendering_id:
        r = await get_db().renderings.find_one({"_id": parse_id(payload.rendering_id, "Rendering"), "projectId": doc["_id"]})
        if not r:
            raise NotFoundError("That version is not available.", code="RENDERING_NOT_FOUND")
        tl_doc = r.get("timeline") or tl_doc
    facts = fb.edit_facts(Timeline.model_validate(tl_doc)) if tl_doc else {}
    if payload.verdict == "accepted":
        await fb.record(doc["_id"], "accepted", **facts)
    elif payload.reason == "opening":
        await fb.record(doc["_id"], "rejected_opening", how="feedback")
    else:
        await fb.record(doc["_id"], "rejected", reason=payload.reason or "other", **facts)
    return (await fb.load_profile()).to_doc()


@router.get("/director/profile")
async def get_profile():
    return (await fb.load_profile()).to_doc()


@router.put("/director/profile")
async def update_profile(payload: ProfileUpdate):
    fb.set_enabled(payload.enabled)
    return (await fb.load_profile()).to_doc()


@router.delete("/director/profile")
async def reset_profile():
    removed = await fb.reset()
    return {**(await fb.load_profile()).to_doc(), "removed": removed}


@router.post("/projects/{project_id}/purge-media")
async def purge(project_id: str):
    doc = await ps.get_project_doc(project_id)
    n = await purge_media(doc["_id"])
    return {"deleted": n}
