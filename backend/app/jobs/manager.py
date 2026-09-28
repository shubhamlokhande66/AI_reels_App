"""Background job execution: queue -> worker thread -> persisted progress/results."""

from __future__ import annotations

import asyncio
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from bson import ObjectId

from app.core.config import get_settings
from app.core.database import get_db
from app.core.errors import AppError, ConflictError, JobCancelled, ValidationFailed
from app.jobs import pipeline as pl
from app.models.base import utcnow
from app.schemas.project import GenerateRequest, ProjectSettings
from app.services.project_service import get_project_doc, validate_trend_id
from app.video.presets import validate_preset_id
from app.storage import get_storage
from app.styles import validate_style_id
from app.video.analyzer import clip_summary

log = logging.getLogger(__name__)

_executor: ThreadPoolExecutor | None = None
_tasks: set[asyncio.Task] = set()
_cancel_events: dict[str, threading.Event] = {}  # job id (str) -> "please stop", checked from the worker thread


def request_cancel(job_id: str) -> bool:
    """Ask a queued/running job to stop as soon as it next reports progress (which happens frequently, including
    mid-render). Returns False if this process isn't tracking that job — already finished, or a stale id."""
    event = _cancel_events.get(job_id)
    if event is None:
        return False
    event.set()
    return True


def _spawn(job_id: ObjectId, coro) -> None:
    """Schedule a job's coroutine, registering its cancel event first — not inside the coroutine itself, since
    asyncio.create_task does not start it synchronously; registering it late would race a client that cancels the
    job right after the submit response, before the task has had a chance to run its first line."""
    _cancel_events[str(job_id)] = threading.Event()
    task = asyncio.create_task(coro)
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


def _get_executor() -> ThreadPoolExecutor:
    global _executor
    if _executor is None:
        _executor = ThreadPoolExecutor(max_workers=get_settings().max_concurrent_jobs, thread_name_prefix="reel")
    return _executor


def shutdown() -> None:
    global _executor
    if _executor is not None:
        _executor.shutdown(wait=False, cancel_futures=True)
        _executor = None


async def wait_for_all() -> None:
    """Await running jobs (used by tests and graceful shutdown)."""
    while _tasks:
        await asyncio.gather(*list(_tasks), return_exceptions=True)


async def recover_stale_jobs() -> None:
    """Jobs left 'processing' by a previous server run can never finish; fail them cleanly."""
    db = get_db()
    err = {"code": "JOB_INTERRUPTED", "message": "The server restarted while this job was running.", "details": None}
    now = utcnow()
    async for j in db.jobs.find({"status": {"$in": ["queued", "processing"]}}):
        await db.jobs.update_one({"_id": j["_id"]}, {"$set": {"status": "failed", "error": err, "updatedAt": now}})
        await db.projects.update_one(
            {"_id": j["projectId"], "status": "processing"}, {"$set": {"status": "failed", "error": err, "updatedAt": now}}
        )


def _initial_stages(job_type: str, captions: bool = False, ai: bool = False) -> list[dict[str, Any]]:
    labels = {n: label for n, label, _ in pl.STAGES}
    return [
        {"name": n, "label": labels[n], "status": "pending", "progress": 0}
        for n in pl.stage_names(job_type, captions, ai)
    ]


def _error_doc(exc: BaseException) -> dict[str, Any]:
    if isinstance(exc, AppError):
        return {"code": exc.code, "message": exc.message, "details": exc.details}
    log.exception("job crashed", exc_info=exc)
    return {"code": "INTERNAL_ERROR", "message": "An unexpected error occurred.", "details": None}


async def submit(project_id: str, job_type: str, req: GenerateRequest | None = None, revision: list[dict] | None = None) -> dict[str, Any]:
    db = get_db()
    doc = await get_project_doc(project_id)
    if doc["status"] == "processing":
        raise ConflictError("This project is already being processed.", code="PROJECT_BUSY")

    media = {m["_id"]: m async for m in db.media.find({"projectId": doc["_id"]})}
    videos = [media[i] for i in doc.get("videoOrder", []) if i in media]
    audio = media.get(doc.get("audioId"))
    if not videos:
        raise ValidationFailed("Upload at least one video first.", code="NO_VIDEOS")
    settings = dict(doc["settings"])
    seed = 0
    if req is not None:
        for field, key in (("style", "style"), ("pace", "pace"), ("sequence", "sequence"), ("teaser", "teaser"), ("step_labels", "stepLabels"), ("order_mode", "orderMode"), ("export_preset", "exportPreset"), ("brief", "brief"), ("audio_mode", "audioMode"), ("language", "language"), ("duration", "duration"), ("audio_start", "audioStart"), ("captions", "captions"),
                           ("caption_style", "captionStyle"), ("ai", "ai"), ("ai_director", "aiDirector"), ("trend_id", "trendId"), ("reference", "reference")):  # fmt: skip
            v = getattr(req, field)
            if v is not None:
                settings[key] = v
        if req.style:
            validate_style_id(req.style)
        validate_trend_id(req.trend_id)
        if req.export_preset:
            validate_preset_id(req.export_preset)
        if req.audio_auto:
            settings["audioStart"] = None
        seed = req.seed if req.seed is not None else 0
    ps = ProjectSettings.model_validate(settings)
    if job_type == "generate" and audio is None and ps.audio_mode in ("music", "voice_music"):
        raise ValidationFailed("Upload a music file first (or choose an audio mode that does not need music).", code="NO_AUDIO")

    now = utcnow()
    job_id, rendering_id = ObjectId(), ObjectId()
    job = {
        "_id": job_id, "projectId": doc["_id"], "type": job_type, "status": "queued", "progress": 0,
        "stage": pl.stage_names(job_type)[0], "stages": _initial_stages(job_type, ps.captions, ps.ai), "error": None,
        "renderingId": None, "createdAt": now, "updatedAt": now,
    }  # fmt: skip
    await db.jobs.insert_one(job)
    await db.projects.update_one(
        {"_id": doc["_id"]},
        {"$set": {"status": "processing", "latestJobId": job_id, "error": None, "settings": ps.to_doc(), "updatedAt": now}},
    )

    def ref(m: dict[str, Any]) -> pl.MediaRef:
        return pl.MediaRef(str(m["_id"]), m["originalName"], m["storedKey"], m.get("width") or 0, m.get("height") or 0)

    from app.trends.reference import load_references

    inp = pl.PipelineInput(
        project_id=str(doc["_id"]), job_type=job_type, videos=[ref(v) for v in videos],
        audio=ref(audio) if audio else None, settings=ps, rendering_id=str(rendering_id), seed=seed,
        project_name=doc["name"], revision=revision or [], references=await load_references(ps.reference),
    )  # fmt: skip
    prior_status = "completed" if doc.get("latestRenderingId") else "draft"
    label = (req.label if req and req.label else "") or ""
    _spawn(job_id, _run(job_id, doc["_id"], inp, rendering_id, prior_status, label))
    return job


async def submit_render(project_id: str, quality: str = "final", label: str = "") -> dict[str, Any]:
    """Render the project's *current* timeline (as edited). ``preview`` is small and quick."""
    from app.models.timeline import Timeline
    from app.video.timeline_ops import ensure_ids

    if quality not in ("preview", "final"):
        raise ValidationFailed("Quality must be 'preview' or 'final'.", code="INVALID_QUALITY")
    db = get_db()
    doc = await get_project_doc(project_id)
    if doc["status"] == "processing":
        raise ConflictError("This project is already being processed.", code="PROJECT_BUSY")
    if not doc.get("timeline"):
        raise ValidationFailed("Generate a Reel first; there is no timeline to render yet.", code="NO_TIMELINE")
    media = {m["_id"]: m async for m in db.media.find({"projectId": doc["_id"]})}
    videos = [media[i] for i in doc.get("videoOrder", []) if i in media]
    audio = media.get(doc.get("audioId"))
    timeline = Timeline.model_validate(ensure_ids(doc["timeline"]))
    ps = ProjectSettings.model_validate(doc["settings"])
    if not videos or (audio is None and ps.audio_mode in ("music", "voice_music") and timeline.voice is None):
        raise ValidationFailed("The project needs its videos (and music, for this audio mode) to render.", code="NO_MEDIA")
    now = utcnow()
    job_id, rendering_id = ObjectId(), ObjectId()
    job = {
        "_id": job_id, "projectId": doc["_id"], "type": "render", "status": "queued", "progress": 0,
        "stage": "rendering", "stages": _initial_stages("render"), "error": None, "renderingId": None,
        "createdAt": now, "updatedAt": now,
    }  # fmt: skip
    await db.jobs.insert_one(job)
    await db.projects.update_one(
        {"_id": doc["_id"]}, {"$set": {"status": "processing", "latestJobId": job_id, "error": None, "updatedAt": now}}
    )

    def ref(m: dict[str, Any]) -> pl.MediaRef:
        return pl.MediaRef(str(m["_id"]), m["originalName"], m["storedKey"], m.get("width") or 0, m.get("height") or 0)

    inp = pl.PipelineInput(
        project_id=str(doc["_id"]), job_type="render", videos=[ref(v) for v in videos], audio=ref(audio) if audio else None,
        settings=ps, rendering_id=str(rendering_id), project_name=doc["name"], kind=quality, timeline=timeline,
    )  # fmt: skip
    prior_status = "completed" if doc.get("latestRenderingId") else "draft"
    _spawn(job_id, _run(job_id, doc["_id"], inp, rendering_id, prior_status, label or ""))
    return job


async def submit_variations(project_id: str, strategy_ids: list[str] | None = None, seed: int = 0) -> dict[str, Any]:
    """Render several versions (each a different editing strategy) from the same footage and music."""
    from app.models.timeline import Timeline
    from app.variations.strategies import DEFAULT_SET, get_strategy
    from app.video.timeline_ops import ensure_ids

    ids = list(dict.fromkeys(DEFAULT_SET if strategy_ids is None else strategy_ids))  # only 'not given' means the default set
    if not 1 <= len(ids) <= 6:
        raise ValidationFailed("Choose between 1 and 6 strategies.", code="INVALID_STRATEGIES")
    for sid in ids:
        get_strategy(sid)
    db = get_db()
    doc = await get_project_doc(project_id)
    if doc["status"] == "processing":
        raise ConflictError("This project is already being processed.", code="PROJECT_BUSY")
    media = {m["_id"]: m async for m in db.media.find({"projectId": doc["_id"]})}
    videos = [media[i] for i in doc.get("videoOrder", []) if i in media]
    audio = media.get(doc.get("audioId"))
    ps = ProjectSettings.model_validate(doc["settings"])
    if not videos:
        raise ValidationFailed("Upload at least one video first.", code="NO_VIDEOS")
    if audio is None and ps.audio_mode in ("music", "voice_music"):
        raise ValidationFailed("Upload a music file first (or choose an audio mode that does not need music).", code="NO_AUDIO")
    base = Timeline.model_validate(ensure_ids(doc["timeline"])) if doc.get("timeline") else None

    now = utcnow()
    job_id = ObjectId()
    job = {
        "_id": job_id, "projectId": doc["_id"], "type": "variations", "status": "queued", "progress": 0,
        "stage": "analyzing_videos", "stages": _initial_stages("variations", False, ps.ai), "error": None,
        "renderingId": None, "createdAt": now, "updatedAt": now,
    }  # fmt: skip
    await db.jobs.insert_one(job)
    await db.projects.update_one({"_id": doc["_id"]}, {"$set": {"status": "processing", "latestJobId": job_id, "error": None, "updatedAt": now}})

    def ref(m: dict[str, Any]) -> pl.MediaRef:
        return pl.MediaRef(str(m["_id"]), m["originalName"], m["storedKey"], m.get("width") or 0, m.get("height") or 0)

    inp = pl.PipelineInput(
        project_id=str(doc["_id"]), job_type="variations", videos=[ref(v) for v in videos], audio=ref(audio) if audio else None,
        settings=ps, rendering_id=str(ObjectId()), seed=seed, project_name=doc["name"], kind="final", timeline=base,
        strategies=ids, variant_ids=[str(ObjectId()) for _ in ids],
    )  # fmt: skip
    prior_status = "completed" if doc.get("latestRenderingId") else "draft"
    _spawn(job_id, _run(job_id, doc["_id"], inp, ObjectId(), prior_status, ""))
    return job


async def _update_job(job_id: ObjectId, *, only_active: bool = False, **fields: Any) -> None:
    fields["updatedAt"] = utcnow()
    query: dict[str, Any] = {"_id": job_id}
    if only_active:  # late progress ticks from the worker thread must never resurrect a finished job
        query["status"] = {"$in": ["queued", "processing"]}
    await get_db().jobs.update_one(query, {"$set": fields})


def _with_ai_context(fn, inp: pl.PipelineInput, storage, on_progress):
    """Runs in the worker thread: AI calls made by this job are logged against its project."""
    from app.ai.usage import ai_context

    with ai_context(inp.project_id):
        return fn(inp, storage, on_progress)


async def _run(job_id, project_oid, inp: pl.PipelineInput, rendering_id, prior_status: str, label: str) -> None:
    loop = asyncio.get_running_loop()
    caps = inp.settings.captions
    ai = inp.settings.ai
    stages = _initial_stages(inp.job_type, caps, ai)
    names = pl.stage_names(inp.job_type, caps, ai)
    state = {"progress": -1, "stage": ""}
    # _spawn() already registered this before the task was created; fall back defensively if somehow missing.
    cancel_event = _cancel_events.setdefault(str(job_id), threading.Event())

    def on_progress(stage: str, fraction: float) -> None:
        # Called from the worker thread, frequently (including mid-render, on every ffmpeg progress tick) — the
        # natural place to notice a cancel request without needing to touch every render call site individually.
        if cancel_event.is_set():
            raise JobCancelled("Cancelled by you.")
        # update in-memory state, push to Mongo when it changes.
        pct = pl.overall_progress(inp.job_type, stage, fraction, caps, ai)
        stage_pct = int(round(min(max(fraction, 0), 1) * 100))
        changed = False
        for s in stages:
            if s["name"] == stage:
                if s["progress"] != stage_pct or s["status"] == "pending":
                    s["progress"], s["status"] = stage_pct, ("completed" if stage_pct >= 100 else "running")
                    changed = True
            elif s["status"] != "completed" and names.index(s["name"]) < names.index(stage):
                s["progress"], s["status"] = 100, "completed"
                changed = True
        if changed or pct != state["progress"]:
            state["progress"], state["stage"] = pct, stage
            snapshot = [dict(s) for s in stages]
            asyncio.run_coroutine_threadsafe(
                _update_job(job_id, only_active=True, status="processing", progress=pct, stage=stage, stages=snapshot), loop
            )

    try:
        try:
            fn = {"render": pl.run_render, "variations": pl.run_variations, "product": pl.run_product}.get(inp.job_type, pl.run_pipeline)
            result = await loop.run_in_executor(_get_executor(), _with_ai_context, fn, inp, get_storage(), on_progress)
        except BaseException as exc:  # noqa: BLE001 - every failure (including a cancel) must be recorded on the job
            cancelled = isinstance(exc, JobCancelled)
            err = _error_doc(exc)
            failed_stages = [dict(s, status="failed") if s["status"] == "running" else dict(s) for s in stages]
            await _update_job(job_id, status="cancelled" if cancelled else "failed", error=err, stages=failed_stages)
            # A failed/cancelled preview/re-render must not mark the whole project failed: the previous result still stands.
            status = prior_status if cancelled or inp.job_type in ("render", "variations") or (inp.job_type == "product" and inp.kind == "preview") else "failed"
            await get_db().projects.update_one(
                {"_id": project_oid}, {"$set": {"status": status, "error": None if cancelled else err, "updatedAt": utcnow()}}
            )
            get_storage().delete_prefix(f"projects/{inp.project_id}/temp/render_{inp.rendering_id}")
            if isinstance(exc, (KeyboardInterrupt, SystemExit, asyncio.CancelledError)):
                raise
            return

        await _finish(job_id, project_oid, inp, result, rendering_id, prior_status, label)
    finally:
        _cancel_events.pop(str(job_id), None)


async def _finish_render(job_id, project_oid, inp, result: pl.PipelineResult, rendering_id, prior_status, label) -> None:
    """A render of a stored timeline: adds a rendering, never changes the timeline."""
    db = get_db()
    now = utcnow()
    proj = await db.projects.find_one({"_id": project_oid}) or {}
    assert result.render is not None and result.timeline is not None
    r = result.render
    await db.renderings.insert_one({
        "_id": rendering_id, "projectId": project_oid, "jobId": job_id, "style": result.timeline.style,
        "kind": inp.kind, "timelineVersion": proj.get("timelineVersion", 1),
        "duration": round(r.duration, 3), "width": r.width, "height": r.height, "size": r.size,
        "storedKey": result.output_key, "label": label, "timeline": result.timeline.to_doc(),
        "settings": inp.settings.to_doc(), "postCopy": None, "createdAt": now,
    })  # fmt: skip
    update: dict[str, Any] = {"updatedAt": now, "error": None, "status": prior_status}
    if inp.kind == "preview":
        update["previewRenderingId"] = rendering_id
    else:
        update.update({"latestRenderingId": rendering_id, "status": "completed"})
    await db.projects.update_one({"_id": project_oid}, {"$set": update})
    await _update_job(job_id, status="completed", progress=100, stage="rendering", renderingId=rendering_id,
                      stages=[dict(s, status="completed", progress=100) for s in _initial_stages("render")])  # fmt: skip


async def _finish_variations(job_id, project_oid, inp, result: pl.PipelineResult, prior_status) -> None:
    db = get_db()
    now = utcnow()
    proj = await db.projects.find_one({"_id": project_oid}) or {}
    version = proj.get("timelineVersion", 1)
    ids = []
    for v in result.variants:
        rid = ObjectId(v.rendering_id)
        ids.append(rid)
        await db.renderings.insert_one({
            "_id": rid, "projectId": project_oid, "jobId": job_id, "style": v.timeline.style, "kind": "final",
            "strategy": v.strategy_id, "timelineVersion": version, "duration": round(v.render.duration, 3),
            "width": v.render.width, "height": v.render.height, "size": v.render.size, "storedKey": v.output_key,
            "label": v.label, "timeline": v.timeline.to_doc(), "settings": inp.settings.to_doc(), "postCopy": None,
            "createdAt": now,
        })  # fmt: skip
    update: dict[str, Any] = {"updatedAt": now, "error": None, "status": prior_status}
    if not proj.get("latestRenderingId") and ids:
        update.update({"latestRenderingId": ids[0], "status": "completed"})
    await db.projects.update_one({"_id": project_oid}, {"$set": update})
    await _update_job(job_id, status="completed", progress=100, stage="rendering", renderingId=ids[0] if ids else None,
                      stages=[dict(s, status="completed", progress=100) for s in _initial_stages("variations", False, inp.settings.ai)])  # fmt: skip


async def _finish_product(job_id, project_oid, inp, result: pl.PipelineResult, rendering_id, prior_status, label) -> None:
    """A Reel directed from photos: a rendering, and the director's shot list kept on the project."""
    db = get_db()
    now = utcnow()
    assert result.render is not None and result.product_plan is not None
    r = result.render
    await db.renderings.insert_one({
        "_id": rendering_id, "projectId": project_oid, "jobId": job_id, "style": inp.settings.product_style, "kind": inp.kind,
        "duration": round(r.duration, 3), "width": r.width, "height": r.height, "size": r.size, "storedKey": result.output_key,
        "label": label, "plan": result.product_plan, "settings": inp.settings.to_doc(), "postCopy": None, "createdAt": now,
    })  # fmt: skip
    update: dict[str, Any] = {"updatedAt": now, "error": None, "status": prior_status, "productPlan": result.product_plan}
    if inp.kind == "preview":
        update["previewRenderingId"] = rendering_id
    else:
        update.update({"latestRenderingId": rendering_id, "status": "completed"})
    await db.projects.update_one({"_id": project_oid}, {"$set": update})
    await _update_job(job_id, status="completed", progress=100, stage="rendering", renderingId=rendering_id,
                      stages=[dict(s, status="completed", progress=100) for s in _initial_stages("product")])  # fmt: skip


async def _finish(job_id, project_oid, inp, result: pl.PipelineResult, rendering_id, prior_status, label) -> None:
    if inp.job_type == "product":
        return await _finish_product(job_id, project_oid, inp, result, rendering_id, prior_status, label)
    if inp.job_type == "variations":
        return await _finish_variations(job_id, project_oid, inp, result, prior_status)
    if inp.job_type == "render":
        return await _finish_render(job_id, project_oid, inp, result, rendering_id, prior_status, label)
    db = get_db()
    now = utcnow()
    for mid, a in result.clips.items():
        await db.media.update_one({"_id": ObjectId(mid)}, {"$set": {"analysisSummary": clip_summary(a)}})
    for mid, sem in result.semantics.items():
        await db.media.update_one(
            {"_id": ObjectId(mid)}, {"$set": {"semantic": sem.to_doc(), "tags": sem.tags, "category": sem.scene}}
        )
    summary: dict[str, Any] = {
        "clips": [clip_summary(a) for a in result.clips.values()],
        "usableClips": sum(a.usable for a in result.clips.values()),
        "warnings": result.warnings,
        "analyzedAt": now,
    }
    if result.audio:
        summary["audio"] = {
            "bpm": result.audio.bpm, "duration": result.audio.duration, "beatCount": len(result.audio.beats),
            "beatConfidence": result.audio.beat_confidence,
            "highEnergySections": [s.to_doc() for s in result.audio.high_energy_sections],
            "drops": result.audio.drops,
        }  # fmt: skip
    update: dict[str, Any] = {"analysis": summary, "updatedAt": now, "status": prior_status, "error": None}
    job_fields: dict[str, Any] = {}

    if result.timeline and result.render:
        r = result.render
        await db.renderings.insert_one({
            "_id": rendering_id, "projectId": project_oid, "jobId": job_id, "style": result.timeline.style,
            "kind": "final", "duration": round(r.duration, 3), "width": r.width, "height": r.height, "size": r.size,
            "storedKey": result.output_key, "label": label, "timeline": result.timeline.to_doc(),
            "settings": inp.settings.to_doc(), "postCopy": result.post_copy, "createdAt": now,
        })  # fmt: skip
        proj = await db.projects.find_one({"_id": project_oid}) or {}
        version = proj.get("timelineVersion", 0) + 1
        await db.renderings.update_one({"_id": rendering_id}, {"$set": {"timelineVersion": version}})
        tl_doc = result.timeline.to_doc()
        if result.reel_plan:
            update["reelPlan"] = {**result.reel_plan, "timelineVersion": version}  # edits later bump the version: the page can tell the plan is out of date
        update.update({
            "status": "completed", "timeline": tl_doc, "latestRenderingId": rendering_id,
            "timelineVersion": version,
            # a fresh AI result starts a new edit history (undo/redo work from here)
            "timelineHistory": [{"timeline": tl_doc, "label": "AI generated", "at": now}], "historyIndex": 0,
        })  # fmt: skip
        job_fields["renderingId"] = rendering_id
    await db.projects.update_one({"_id": project_oid}, {"$set": update})
    done = [dict(s, status="completed", progress=100) for s in _initial_stages(inp.job_type, inp.settings.captions, inp.settings.ai)]
    await _update_job(job_id, status="completed", progress=100, stage=done[-1]["name"], stages=done, **job_fields)


async def product_input(
    project_id: str, overrides: dict[str, Any] | None = None, quality: str = "final", seed: int = 0, audio_auto: bool = False
) -> tuple[dict[str, Any], pl.PipelineInput]:
    """The settings, photos and music of a product project, checked and ready to plan or render."""
    if quality not in ("preview", "final"):
        raise ValidationFailed("Quality must be 'preview' or 'final'.", code="INVALID_QUALITY")
    db = get_db()
    doc = await get_project_doc(project_id)
    settings = {**doc["settings"], **{k: v for k, v in (overrides or {}).items() if v is not None}}
    if audio_auto:
        settings["audioStart"] = None
    if settings.get("reelType") != "product":
        raise ValidationFailed("This project is not a product Reel project.", code="NOT_A_PRODUCT_PROJECT")
    from app.product.styles import get_product_style

    get_product_style(settings.get("productStyle", "luxury_jewelry"))  # an unknown style is a clear error before any work starts
    ps = ProjectSettings.model_validate(settings)
    media = {m["_id"]: m async for m in db.media.find({"projectId": doc["_id"]})}
    images = [media[i] for i in doc.get("imageOrder", []) if i in media]
    audio = media.get(doc.get("audioId"))
    if not images:
        raise ValidationFailed("Add at least one product photo first.", code="NO_IMAGES")

    def ref(m: dict[str, Any]) -> pl.MediaRef:
        return pl.MediaRef(str(m["_id"]), m["originalName"], m["storedKey"], m.get("width") or 0, m.get("height") or 0)

    inp = pl.PipelineInput(
        project_id=str(doc["_id"]), job_type="product", videos=[], audio=ref(audio) if audio else None, settings=ps, rendering_id=str(ObjectId()),
        seed=seed, project_name=doc["name"], kind=quality, images=[ref(m) for m in images],
    )  # fmt: skip
    return doc, inp


async def submit_product(
    project_id: str, overrides: dict[str, Any] | None = None, quality: str = "final", label: str = "", seed: int = 0, audio_auto: bool = False
) -> dict[str, Any]:
    """Direct and render a Reel from the project's photos (and music, if any)."""
    db = get_db()
    doc0 = await get_project_doc(project_id)
    if doc0["status"] == "processing":
        raise ConflictError("This project is already being processed.", code="PROJECT_BUSY")
    doc, inp = await product_input(project_id, overrides, quality, seed, audio_auto)
    now = utcnow()
    job_id, rendering_id = ObjectId(), ObjectId(inp.rendering_id)
    job = {
        "_id": job_id, "projectId": doc["_id"], "type": "product", "status": "queued", "progress": 0, "stage": pl.stage_names("product")[0],
        "stages": _initial_stages("product"), "error": None, "renderingId": None, "createdAt": now, "updatedAt": now,
    }  # fmt: skip
    await db.jobs.insert_one(job)
    await db.projects.update_one(
        {"_id": doc["_id"]},
        {"$set": {"status": "processing", "latestJobId": job_id, "error": None, "settings": inp.settings.to_doc(), "updatedAt": now}},
    )
    prior_status = "completed" if doc.get("latestRenderingId") else "draft"
    _spawn(job_id, _run(job_id, doc["_id"], inp, rendering_id, prior_status, label or ""))
    return job
