"""Timeline persistence: the editable EDL, its undo/redo history and version restore.

History lives on the project document (last ``HISTORY_LIMIT`` snapshots). Every edit batch is one
snapshot; undo/redo just move the cursor, so they are cheap, exact and survive a page reload.
"""

from __future__ import annotations

from typing import Any

from app.core.database import get_db
from app.core.errors import NotFoundError, ValidationFailed
from app.models.base import utcnow
from app.models.timeline import Timeline
from app.services.ids import parse_id
from app.services.project_service import get_project_doc
from app.video.timeline_ops import EditError, OpContext, Operation, apply_operations, ensure_ids  # noqa: F401

HISTORY_LIMIT = 50


async def context_for(doc: dict[str, Any]) -> OpContext:
    """Durations and names of the project's clips, so edits can be validated against real footage."""
    durations: dict[str, float] = {}
    names: dict[str, str] = {}
    audio_duration = None
    async for m in get_db().media.find({"projectId": doc["_id"]}):
        if m["kind"] == "video":
            durations[str(m["_id"])] = float(m.get("duration") or 0) or 0.0
            names[str(m["_id"])] = m["originalName"]
        elif m["_id"] == doc.get("audioId"):
            audio_duration = float(m.get("duration") or 0) or None
    durations = {k: v for k, v in durations.items() if v > 0}
    return OpContext(clip_durations=durations, clip_names=names, audio_duration=audio_duration)


def _history(doc: dict[str, Any]) -> tuple[list[dict[str, Any]], int]:
    """(history, index). Projects created before history existed get a one-entry history."""
    hist = doc.get("timelineHistory")
    if hist:
        return list(hist), min(max(int(doc.get("historyIndex", len(hist) - 1)), 0), len(hist) - 1)
    if doc.get("timeline"):
        return [{"timeline": ensure_ids(doc["timeline"]), "label": "AI generated", "at": doc["updatedAt"]}], 0
    return [], 0


def state_of(doc: dict[str, Any]) -> dict[str, Any]:
    hist, idx = _history(doc)
    # Validate through the model so timelines saved by older versions always come back complete
    # (captions, music settings, per-shot framing ... filled with defaults) and the UI can rely on the shape.
    tl = Timeline.model_validate(ensure_ids(hist[idx]["timeline"])).to_doc() if hist else None
    return {
        "timeline": tl,
        "version": doc.get("timelineVersion", 1 if tl else 0),
        "canUndo": idx > 0,
        "canRedo": bool(hist) and idx < len(hist) - 1,
        "index": idx,
        "history": [{"label": h.get("label", ""), "at": h.get("at")} for h in hist],
    }


def _needs_ids(tl: dict[str, Any] | None) -> bool:
    return bool(tl) and any(not s.get("id") for s in tl.get("segments", []))


async def _load(project_id: str) -> dict[str, Any]:
    """Project doc, with ids *persisted* for timelines saved before segments had ids.

    Without this every request would invent new random ids for an old project and edits would
    refer to shots that "no longer exist".
    """
    doc = await get_project_doc(project_id)
    hist_docs = [h.get("timeline") for h in doc.get("timelineHistory") or []]
    if _needs_ids(doc.get("timeline")) or any(_needs_ids(t) for t in hist_docs):
        update: dict[str, Any] = {}
        if doc.get("timeline"):
            update["timeline"] = ensure_ids(doc["timeline"])
        if doc.get("timelineHistory"):
            update["timelineHistory"] = [{**h, "timeline": ensure_ids(h["timeline"])} for h in doc["timelineHistory"]]
        await get_db().projects.update_one({"_id": doc["_id"]}, {"$set": update})
        doc = {**doc, **update}
    return doc


load = _load  # public name: project doc with persisted shot ids


async def get_state(project_id: str) -> dict[str, Any]:
    return state_of(await _load(project_id))


async def _save(doc: dict[str, Any], hist: list[dict[str, Any]], idx: int) -> dict[str, Any]:
    tl = hist[idx]["timeline"]
    update = {
        "timeline": tl, "timelineHistory": hist, "historyIndex": idx, "updatedAt": utcnow(),
        "timelineVersion": doc.get("timelineVersion", 1) + 1,
    }  # fmt: skip
    await get_db().projects.update_one({"_id": doc["_id"]}, {"$set": update})
    return state_of({**doc, **update})


def _require_timeline(doc: dict[str, Any]) -> None:
    if not doc.get("timeline"):
        raise NotFoundError("This project has no timeline yet. Generate a Reel first.", code="NO_TIMELINE")


async def apply(project_id: str, ops: list, label: str | None = None, manual: bool = True) -> dict[str, Any]:
    """``manual``: a hand edit in the editor. The shots it changes are locked against automatic changes."""
    doc = await _load(project_id)
    _require_timeline(doc)
    hist, idx = _history(doc)
    current = Timeline.model_validate(ensure_ids(hist[idx]["timeline"]))
    result = apply_operations(current, ops, await context_for(doc))  # raises EditError; nothing is saved then
    if manual:
        from app.video.timeline_ops import mark_manual

        mark_manual(result, ops)
    from app.services.feedback import record_ops

    await record_ops(doc["_id"], current, ops)  # what this edit says about the person's taste (anonymous)
    entry = {"timeline": result.to_doc(), "label": label or _describe(ops), "at": utcnow()}
    hist = hist[: idx + 1] + [entry]  # a new edit discards the redo branch
    if len(hist) > HISTORY_LIMIT:
        hist = hist[-HISTORY_LIMIT:]
    return await _save(doc, hist, len(hist) - 1)


async def undo(project_id: str) -> dict[str, Any]:
    doc = await _load(project_id)
    _require_timeline(doc)
    hist, idx = _history(doc)
    if idx == 0:
        raise ValidationFailed("Nothing to undo.", code="NOTHING_TO_UNDO")
    return await _save(doc, hist, idx - 1)


async def redo(project_id: str) -> dict[str, Any]:
    doc = await _load(project_id)
    _require_timeline(doc)
    hist, idx = _history(doc)
    if idx >= len(hist) - 1:
        raise ValidationFailed("Nothing to redo.", code="NOTHING_TO_REDO")
    return await _save(doc, hist, idx + 1)


async def restore_version(project_id: str, rendering_id: str) -> dict[str, Any]:
    """Make the timeline a previous render was made from the current one (as a new, undoable edit)."""
    doc = await _load(project_id)
    r = await get_db().renderings.find_one({"_id": parse_id(rendering_id, "Rendering"), "projectId": doc["_id"]})
    if not r or not r.get("timeline"):
        raise NotFoundError("That version is not available.", code="RENDERING_NOT_FOUND")
    hist, idx = _history(doc)
    label = f"Restored {r.get('label') or 'version'}"
    hist = hist[: idx + 1] + [{"timeline": ensure_ids(r["timeline"]), "label": label, "at": utcnow()}]
    hist = hist[-HISTORY_LIMIT:]
    await get_db().projects.update_one({"_id": doc["_id"]}, {"$set": {"latestRenderingId": r["_id"]}})
    concept = ((r.get("timeline") or {}).get("creativePlan") or {}).get("direction")
    if concept in ("viral", "cinematic", "premium"):  # choosing one of the concepts teaches the personal director
        from app.services.feedback import record

        await record(doc["_id"], "chose_concept", concept=concept)
    return await _save(doc, hist, len(hist) - 1)


async def replace(project_id: str, timeline: Timeline, label: str) -> dict[str, Any]:
    """Make ``timeline`` the current edit (a whole-edit change such as a new style or pace), as one undoable step."""
    doc = await _load(project_id)
    _require_timeline(doc)
    hist, idx = _history(doc)
    hist = hist[: idx + 1] + [{"timeline": timeline.to_doc(), "label": label, "at": utcnow()}]
    hist = hist[-HISTORY_LIMIT:]
    return await _save(doc, hist, len(hist) - 1)


def _describe(ops: list) -> str:
    names = {
        "trim": "Trim", "set_length": "Change length", "move": "Move shot", "split": "Split shot",
        "delete": "Delete shot", "duplicate": "Duplicate shot", "replace": "Replace clip", "set_speed": "Change speed",
        "set_transition": "Change transition", "set_effect": "Change effect", "set_crop": "Change framing",
        "set_music": "Adjust music", "add_caption": "Add caption", "update_caption": "Edit caption",
        "delete_caption": "Delete caption", "set_caption_style": "Caption style", "fit_duration": "Fit to duration",
    }  # fmt: skip
    kinds = list(dict.fromkeys(names.get(o.type, o.type) for o in ops))
    return ", ".join(kinds)
