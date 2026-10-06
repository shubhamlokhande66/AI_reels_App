"""Change a finished Reel with words: "make it calmer, remove the first clip, add captions" -> a new version."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import Field

from app.ai.provider import AIProvider, get_provider
from app.core.errors import AppError, ConflictError, NotFoundError
from app.core.ratelimit import rate_limit
from app.jobs import manager
from app.models.base import CamelModel
from app.models.timeline import Timeline
from app.revise import actions as rv
from app.schemas.project import GenerateRequest
from app.services import project_service as ps
from app.services import timeline_service as ts
from app.storage import get_storage, project_key

router = APIRouter(prefix="/api", tags=["revise"])


class ReviseRequest(CamelModel):
    instruction: str = Field(min_length=2, max_length=3000)
    use_ai: bool = True  # let the local model interpret phrases the built-in rules do not know
    dry_run: bool = False  # only say what would happen
    confirmed_actions: list[dict] | None = Field(default=None, max_length=30)  # a plan the user saw and approved (skips the AI)


def _provider() -> AIProvider | None:
    try:
        p = get_provider("revision")
        return p if p.health().get("available") else None
    except AppError:
        return None
    except Exception:  # noqa: BLE001 - an unreachable model must never block the rules-based path
        return None


def _clip_descriptions(project_id: str, clip_ids: set[str]) -> dict[str, str]:
    """What the vision model saw in each clip (from the cached understanding), so a request like "show the product
    earlier" can be mapped to the right shot. Nothing is analysed here."""
    import json

    from app.storage import get_storage, project_key

    out: dict[str, str] = {}
    st = get_storage()
    for cid in clip_ids:
        key = project_key(project_id, "analysis", f"semantic_{cid}.json")
        try:
            if st.exists(key):
                d = json.loads(st.read_bytes(key))
                text = " ".join(x for x in (d.get("summary", ""), ", ".join(d.get("objects", [])[:4])) if x)
                if text:
                    out[cid] = text
        except (ValueError, OSError):
            continue
    return out


def _understood(actions: list[rv.Action]) -> list[dict[str, Any]]:
    return [{"text": a.text, "does": rv.describe(a), "source": a.source, "rebuild": a.rebuild} for a in actions]


INPLACE_KINDS = {"style", "pace"}  # whole-edit changes the Director makes on the current blueprint (no rebuild)


def _music_map(project_id: str, doc: dict, tl: Timeline):
    """The music map of the Reel's song part, from the cached analysis (None when the song was never analysed)."""
    from app.director.music_map import build_music_map
    from app.models.analysis import AudioAnalysis

    aid = doc.get("audioId")
    key = project_key(project_id, "analysis", f"audio_{aid}.json") if aid else None
    st = get_storage()
    if not key or not st.exists(key):
        return None
    try:
        audio = AudioAnalysis.model_validate_json(st.read_bytes(key))
    except ValueError:
        return None
    return build_music_map(audio, tl.audio_start, tl.duration)


async def _revise_in_place(project_id: str, doc: dict, tl: Timeline, plan, base: dict, label: str, dry: bool):
    """Style / pace on the current edit: same shots, manual edits, voice-over and text kept; one undoable step."""
    from app.revise.inplace import apply_style_pace
    from app.schemas.project import ProjectUpdate
    from app.video.timeline_ops import apply_operations

    overrides = rv.rebuild_overrides(plan.actions)
    ctx = await ts.context_for(doc)
    mm = await asyncio.to_thread(_music_map, project_id, doc, tl)
    new_tl, notes = apply_style_pace(tl, style=overrides.get("style"), pace=overrides.get("pace"), mm=mm, clip_lengths=ctx.clip_durations)
    others = [a for a in plan.actions if not a.rebuild]
    more: list[str] = []
    edit_ops: list = []
    if others:
        edit_ops, more, _ = rv.actions_to_ops(others, new_tl, audio_duration=ctx.audio_duration)
    if dry:
        return {**base, "mode": "edit", "notes": notes + more}
    if edit_ops:
        new_tl = apply_operations(new_tl, edit_ops, ctx)
    await ts.replace(project_id, new_tl, label)
    patch = {k: overrides[k] for k in ("style", "pace") if k in overrides}
    if patch:  # the next fresh edit starts from the new style / pace too
        await ps.update_project(project_id, ProjectUpdate(**patch))
    job = await manager.submit_render(project_id, "final", label=label)
    return {**base, "mode": "edit", "notes": notes + more, "job": ps.job_to_out(job)}


@router.post("/projects/{project_id}/revise", dependencies=[Depends(rate_limit("job", 30))])
async def revise(project_id: str, payload: ReviseRequest):
    """Understand the request, apply it to the Reel and start rendering the new version.

    Two ways, chosen automatically:
    * *edit*: shot-level and mix changes are applied to the current timeline (your manual edits are kept) and rendered;
    * *rebuild*: changes to style, pace, shot selection or captions need a fresh edit from your clips. The earlier
      version is kept in Versions.
    """
    doc = await ts.load(project_id)
    if doc["status"] == "processing":
        raise ConflictError("This project is already being processed. Try again when it finishes.", code="PROJECT_BUSY")
    if not doc.get("timeline"):
        raise NotFoundError("Generate a Reel first, then describe what to change.", code="NO_TIMELINE")

    tl = Timeline.model_validate(ts.state_of(doc)["timeline"])
    provider = _provider() if payload.use_ai else None
    if payload.confirmed_actions is not None:
        plan = rv.Plan(actions=rv.actions_from_dicts(payload.confirmed_actions, len(tl.segments)))
    else:
        shows = await asyncio.to_thread(_clip_descriptions, project_id, {s.clip_id for s in tl.segments}) if provider else {}
        plan = await asyncio.to_thread(rv.plan_revision, payload.instruction, tl, doc["settings"], provider, shows)
    # Whatever the AI interpreted is shown first; it is only applied after the user confirms it.
    # ... and so is anything destructive (removing shots, text, captions, voice or music), even when the rules understood it.
    needs_confirmation = payload.confirmed_actions is None and any(a.source == "ai" or a.kind in rv.DESTRUCTIVE_KINDS for a in plan.actions)
    dry = payload.dry_run or needs_confirmation
    base = {"understood": _understood(plan.actions), "notUnderstood": plan.not_understood, "usedAi": plan.used_ai,
            "aiNote": plan.ai_note, "examples": list(rv.EXAMPLES), "warnings": [], "notes": [], "job": None,
            "needsConfirmation": needs_confirmation, "actions": [a.to_dict() for a in plan.actions]}  # fmt: skip

    if not plan.actions:
        return {**base, "mode": "none"}

    label = rv.short_label(payload.instruction)
    rebuild = [a for a in plan.actions if a.rebuild]
    hist = doc.get("timelineHistory") or []
    warnings: list[str] = []

    if rebuild and {a.kind for a in rebuild} <= INPLACE_KINDS and not any(a.kind == "duration" for a in plan.actions):
        return await _revise_in_place(project_id, doc, tl, plan, base, label, dry)

    if rebuild:
        overrides = rv.rebuild_overrides(plan.actions)
        follow = [a for a in plan.actions if not a.rebuild and a.kind in rv.GLOBAL_KINDS]
        dropped = [a for a in plan.actions if not a.rebuild and a.kind not in rv.GLOBAL_KINDS and a.kind != "duration"]
        if dropped:
            warnings.append("Shot-level changes (" + ", ".join(rv.describe(a) for a in dropped) + ") were not applied because the "
                            "Reel is being rebuilt from your clips. Ask for them again once the new version is ready.")
        if len(hist) > 1 or tl.voice is not None:
            warnings.append("Rebuilding starts a new edit: your manual timeline edits and the voice-over are not carried over. "
                            "The previous version stays in Versions.")
        if dry:
            return {**base, "mode": "rebuild", "warnings": warnings, "overrides": overrides}
        req = GenerateRequest(**{**overrides, "label": label})
        job = await manager.submit(project_id, "generate", req, revision=[a.to_dict() for a in follow])
        return {**base, "mode": "rebuild", "warnings": warnings, "job": ps.job_to_out(job)}

    audio_dur = None
    ctx = await ts.context_for(doc)
    audio_dur = ctx.audio_duration
    edit_ops, notes, applied = rv.actions_to_ops(plan.actions, tl, audio_duration=audio_dur)
    if not edit_ops:
        return {**base, "mode": "none", "understood": _understood(applied), "notes": notes,
                "notUnderstood": plan.not_understood + ([] if notes else ["Nothing to change for that request."])}  # fmt: skip
    if dry:
        return {**base, "mode": "edit", "understood": _understood(applied), "notes": notes}
    await ts.apply(project_id, edit_ops, label)  # atomic; raises a clear error and changes nothing if any op is invalid
    job = await manager.submit_render(project_id, "final", label=label)
    return {**base, "mode": "edit", "understood": _understood(applied), "notes": notes, "job": ps.job_to_out(job)}
