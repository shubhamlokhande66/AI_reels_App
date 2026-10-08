"""Timeline editing, previews/renders, version restore, export presets and the render queue."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import Field

from app.core.database import get_db
from app.core.errors import NotFoundError
from app.core.ratelimit import rate_limit
from app.jobs import manager
from app.models.base import CamelModel
from app.schemas.project import JobOut, RenderingOut
from app.services import project_service as ps
from app.services import timeline_service as ts
from app.video.hardware import LABELS, available_encoders, pick_encoder
from app.video.presets import PRESETS
from app.video.timeline_ops import Operation

router = APIRouter(prefix="/api", tags=["timeline"])


class OpsRequest(CamelModel):
    ops: list[Operation] = Field(min_length=1, max_length=50)
    label: str | None = Field(default=None, max_length=80)


class RenderRequest(CamelModel):
    quality: str = "final"  # preview | final
    label: str | None = Field(default=None, max_length=60)


@router.get("/projects/{project_id}/timeline")
async def get_timeline(project_id: str):
    return await ts.get_state(project_id)


@router.get("/editor/catalog")
async def editor_catalog():
    """Everything the manual editor can apply: transitions, per-shot effects and colour looks (all rendered for real)."""
    from app.models.timeline import EFFECT_TYPES, TRANSITION_TYPES
    from app.video.grades import _PRESETS

    return {"transitions": list(TRANSITION_TYPES), "effects": list(EFFECT_TYPES),
            "looks": [{"id": g.id, "label": g.label, "hint": g.hint} for g in _PRESETS.values()]}  # fmt: skip


@router.post("/projects/{project_id}/timeline/start")
async def start_editing(project_id: str, fresh: bool = False):
    """The manual editor: open the edit, or (no edit yet / ``fresh``) start one from the uploaded clips, by hand."""
    return await ts.start_manual(project_id, fresh=fresh)


@router.post("/projects/{project_id}/timeline/ops")
async def edit_timeline(project_id: str, payload: OpsRequest):
    return await ts.apply(project_id, payload.ops, payload.label)


@router.post("/projects/{project_id}/timeline/undo")
async def undo(project_id: str):
    return await ts.undo(project_id)


@router.post("/projects/{project_id}/timeline/redo")
async def redo(project_id: str):
    return await ts.redo(project_id)


@router.post("/projects/{project_id}/render", response_model=JobOut, status_code=202,
             dependencies=[Depends(rate_limit("job", 60))])
async def render(project_id: str, payload: RenderRequest | None = None):
    p = payload or RenderRequest()
    return ps.job_to_out(await manager.submit_render(project_id, p.quality, p.label or ""))


@router.get("/projects/{project_id}/preview", response_model=RenderingOut)
async def get_preview(project_id: str):
    doc = await ps.get_project_doc(project_id)
    rid = doc.get("previewRenderingId")
    r = await get_db().renderings.find_one({"_id": rid}) if rid else None
    if not r:
        raise NotFoundError("No preview has been rendered yet.", code="NO_PREVIEW")
    return ps.rendering_to_out(r)


@router.post("/projects/{project_id}/renderings/{rendering_id}/restore")
async def restore(project_id: str, rendering_id: str):
    return await ts.restore_version(project_id, rendering_id)


@router.get("/export-presets")
async def export_presets():
    return [
        {"id": p.id, "name": p.name, "width": p.width, "height": p.height, "fps": p.fps, "aspect": p.aspect_label,
         "maxSeconds": p.max_seconds}
        for p in PRESETS.values()
    ]  # fmt: skip


@router.get("/hardware")
async def hardware():
    import asyncio

    encoders = await asyncio.to_thread(available_encoders)
    chosen = await asyncio.to_thread(pick_encoder)
    return {"encoders": [{"id": e, "name": LABELS.get(e, e)} for e in encoders], "selected": chosen,
            "selectedName": LABELS.get(chosen, chosen)}  # fmt: skip


@router.get("/queue")
async def queue():
    """Every queued/running/recent job across projects, with its project name (the render queue)."""
    db = get_db()
    jobs = [j async for j in db.jobs.find({}).sort("createdAt", -1).limit(30)]
    names = {p["_id"]: p["name"] async for p in db.projects.find({"_id": {"$in": [j["projectId"] for j in jobs]}})}
    active = sorted((j for j in jobs if j["status"] in ("queued", "processing")), key=lambda j: j["createdAt"])
    position = {j["_id"]: i for i, j in enumerate(active)}
    out = []
    for j in jobs:
        item = ps.job_to_out(j).model_dump(by_alias=True, mode="json")
        item["projectName"] = names.get(j["projectId"], "(deleted project)")
        item["position"] = position.get(j["_id"])  # 0 = running now, 1.. = waiting; None once finished
        out.append(item)
    return out
