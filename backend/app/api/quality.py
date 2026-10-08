"""AI Quality Check + Auto Fix endpoints."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter
from pydantic import Field

from app.core.database import get_db
from app.core.errors import NotFoundError, ValidationFailed
from app.models.base import CamelModel
from app.models.timeline import Timeline
from app.quality.checker import Issue, check_render_file, check_timeline, fix_for_loudness, fix_operations
from app.schemas.project import ProjectSettings
from app.services import project_service as ps
from app.services import timeline_service as ts
from app.storage import get_storage
from app.styles import get_style
from app.video.presets import get_preset
from app.video.timeline_ops import EditError, ensure_ids

router = APIRouter(prefix="/api/projects/{project_id}", tags=["quality"])


class FixRequest(CamelModel):
    code: str = Field(min_length=1, max_length=40)
    segment_id: str | None = None


async def _issues(doc: dict) -> tuple[list[Issue], dict]:
    tl_doc = doc.get("timeline")
    if not tl_doc:
        raise NotFoundError("This project has no timeline yet.", code="NO_TIMELINE")
    state = ts.state_of(doc)
    tl = Timeline.model_validate(ensure_ids(state["timeline"]))
    settings = ProjectSettings.model_validate(doc["settings"])
    issues = check_timeline(tl, float(settings.duration))
    checked: dict = {"timelineVersion": state["version"], "renderingId": None, "kind": None}

    rid = doc.get("previewRenderingId") or doc.get("latestRenderingId")
    r = await get_db().renderings.find_one({"_id": rid}) if rid else None
    if r and r.get("timelineVersion", 1) == state["version"]:  # only judge a file that matches the timeline
        path = get_storage().local_path(r["storedKey"])
        if path.exists():
            preset = get_preset(settings.export_preset)
            size = (preset.width, preset.height) if r.get("kind", "final") == "final" else None
            fades = get_style(tl.style).fade_in_out > 0
            issues += await asyncio.to_thread(check_render_file, path, size, tl.duration, fades)
            checked.update(renderingId=str(r["_id"]), kind=r.get("kind", "final"))
    order = {"error": 0, "warning": 1, "info": 2}
    return sorted(issues, key=lambda i: order.get(i.severity, 3)), checked


@router.post("/quality-check")
async def quality_check(project_id: str):
    issues, checked = await _issues(await ts.load(project_id))
    return {"ok": not any(i.severity == "error" for i in issues), "issues": [i.to_doc() for i in issues],
            "checked": checked}  # fmt: skip


@router.post("/quality-fix")
async def quality_fix(project_id: str, payload: FixRequest):
    """Apply the fix for one issue as a single undoable edit, then report what is left."""
    doc = await ts.load(project_id)
    state = ts.state_of(doc)
    if not state["timeline"]:
        raise NotFoundError("This project has no timeline yet.", code="NO_TIMELINE")
    tl = Timeline.model_validate(state["timeline"])
    settings = ProjectSettings.model_validate(doc["settings"])
    candidates = fix_operations(payload.code, tl, float(settings.duration), payload.segment_id)
    if payload.code == "AUDIO_LOUDNESS":  # the fix needs the measured loudness of the current render
        found, _ = await _issues(doc)
        lufs = next((i.details.get("lufs") for i in found if i.code == "AUDIO_LOUDNESS"), None)
        candidates = fix_for_loudness(tl, float(lufs)) if lufs is not None else []
    if not candidates:
        raise ValidationFailed("This issue cannot be fixed automatically.", code="NO_AUTO_FIX")
    last_error: Exception | None = None
    for ops in candidates:
        try:
            new_state = await ts.apply(project_id, ops, f"Auto-fix: {payload.code.replace('_', ' ').lower()}", manual=False)
            break
        except EditError as exc:
            last_error = exc
    else:
        raise ValidationFailed(f"The automatic fix did not work: {last_error}", code="AUTO_FIX_FAILED")
    issues, checked = await _issues(await ts.load(project_id))
    return {"state": new_state, "issues": [i.to_doc() for i in issues], "checked": checked}
