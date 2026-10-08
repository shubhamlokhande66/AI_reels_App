"""Analyze / generate jobs, job status, and rendered output."""

from __future__ import annotations

import re

from fastapi import APIRouter, Depends, Query
from pydantic import Field

from app.models.base import CamelModel
from fastapi.responses import FileResponse

from app.core.database import get_db
from app.core.errors import ConflictError, NotFoundError
from app.core.ratelimit import rate_limit
from app.jobs import manager
from app.schemas.project import GenerateRequest, JobOut, RenderingOut
from app.services import project_service as ps
from app.services.ids import parse_id
from app.storage import get_storage

router = APIRouter(prefix="/api", tags=["jobs"])


@router.post("/projects/{project_id}/analyze", response_model=JobOut, status_code=202,
             dependencies=[Depends(rate_limit("job", 30))])
async def analyze(project_id: str):
    return ps.job_to_out(await manager.submit(project_id, "analyze"))


@router.post("/projects/{project_id}/understand", response_model=JobOut, status_code=202,
             dependencies=[Depends(rate_limit("job", 30))])
async def understand(project_id: str):
    """Analyse what is IN each clip with the local vision model (tags, scene, objects). Cached per clip."""
    return ps.job_to_out(await manager.submit(project_id, "analyze", GenerateRequest(ai=True)))


@router.post("/projects/{project_id}/generate", response_model=JobOut, status_code=202,
             dependencies=[Depends(rate_limit("job", 30))])
async def generate(project_id: str, payload: GenerateRequest | None = None):
    return ps.job_to_out(await manager.submit(project_id, "generate", payload or GenerateRequest()))


async def _job_doc(job_id: str, project_id: str | None = None) -> dict:
    query = {"_id": parse_id(job_id, "Job")}
    if project_id is not None:
        query["projectId"] = (await ps.get_project_doc(project_id))["_id"]
    doc = await get_db().jobs.find_one(query)
    if not doc:
        raise NotFoundError("Job not found.", code="JOB_NOT_FOUND")
    return doc


class VariationsRequest(CamelModel):
    strategies: list[str] | None = Field(default=None, max_length=6)  # default: the five standard versions
    seed: int = 0


class SplitRequest(CamelModel):
    count: int = Field(default=3, ge=1, le=5)
    seconds: int = Field(default=30, ge=10, le=90)


@router.post("/projects/{project_id}/split", response_model=JobOut, status_code=202, dependencies=[Depends(rate_limit("job", 30))])
async def split(project_id: str, payload: SplitRequest):
    """One long video -> several Reels made from its best parts (talks: the densest whole sentences; other footage: the
    strongest moments). They appear as versions of this project."""
    return ps.job_to_out(await manager.submit_split(project_id, payload.count, payload.seconds))


@router.get("/variation-strategies")
async def variation_strategies():
    from app.variations.strategies import DEFAULT_SET, STRATEGIES

    return [{"id": s.id, "label": s.label, "description": s.description, "style": s.style, "order": s.order, "default": s.id in DEFAULT_SET}
            for s in STRATEGIES.values()]  # fmt: skip


@router.post("/projects/{project_id}/variations", response_model=JobOut, status_code=202,
             dependencies=[Depends(rate_limit("job", 10))])
async def variations(project_id: str, payload: VariationsRequest | None = None):
    """Version A-E from the same source: each with a different editing strategy, analysed once."""
    p = payload or VariationsRequest()
    return ps.job_to_out(await manager.submit_variations(project_id, p.strategies, p.seed))


@router.get("/jobs/{job_id}", response_model=JobOut)
async def get_job(job_id: str):
    return ps.job_to_out(await _job_doc(job_id))


@router.get("/projects/{project_id}/jobs/{job_id}", response_model=JobOut)
async def get_project_job(project_id: str, job_id: str):
    return ps.job_to_out(await _job_doc(job_id, project_id))


@router.post("/projects/{project_id}/jobs/{job_id}/cancel", response_model=JobOut, status_code=202,
             dependencies=[Depends(rate_limit("job", 30))])
async def cancel_job(project_id: str, job_id: str):
    """Ask a running/queued job to stop. It does not stop instantly (the worker thread notices at its next progress
    tick, which happens frequently, including mid-render) — keep polling the job the same way as for its progress."""
    doc = await _job_doc(job_id, project_id)
    if doc["status"] not in ("queued", "processing"):
        raise ConflictError("This job has already finished, so there is nothing to cancel.", code="JOB_NOT_ACTIVE")
    if not manager.request_cancel(job_id):
        raise ConflictError(
            "This job can no longer be cancelled from here (the server may have restarted since it started).",
            code="JOB_NOT_CANCELLABLE",
        )
    return ps.job_to_out(await _job_doc(job_id, project_id))


@router.get("/projects/{project_id}/jobs", response_model=list[JobOut])
async def list_jobs(project_id: str, limit: int = Query(20, ge=1, le=100)):
    doc = await ps.get_project_doc(project_id)
    cur = get_db().jobs.find({"projectId": doc["_id"]}).sort("createdAt", -1).limit(limit)
    return [ps.job_to_out(j) async for j in cur]


@router.get("/projects/{project_id}/output", response_model=RenderingOut)
async def get_output(project_id: str):
    doc = await ps.get_project_doc(project_id)
    rid = doc.get("latestRenderingId")
    r = await get_db().renderings.find_one({"_id": rid}) if rid else None
    if not r:
        raise NotFoundError("No Reel has been generated for this project yet.", code="NO_OUTPUT")
    return ps.rendering_to_out(r)


@router.get("/projects/{project_id}/renderings", response_model=list[RenderingOut])
async def list_renderings(project_id: str):
    doc = await ps.get_project_doc(project_id)
    cur = get_db().renderings.find({"projectId": doc["_id"]}).sort("createdAt", -1)
    return [ps.rendering_to_out(r) async for r in cur]


@router.get("/projects/{project_id}/renderings/{rendering_id}/file")
async def rendering_file(project_id: str, rendering_id: str, download: bool = False, music: bool = True):
    """The rendered MP4. ``music=false``: the same Reel with no sound (made once by copying the picture, instant), to
    post with a licensed / trending sound added inside Instagram or TikTok."""
    doc = await ps.get_project_doc(project_id)
    r = await get_db().renderings.find_one({"_id": parse_id(rendering_id, "Rendering"), "projectId": doc["_id"]})
    if not r:
        raise NotFoundError("Rendering not found.", code="RENDERING_NOT_FOUND")
    path = get_storage().local_path(r["storedKey"])
    if not path.exists():
        raise NotFoundError("The rendered file is missing from storage.", code="RENDERING_FILE_MISSING")
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", doc["name"]).strip("-")[:60] or "reel"
    if not music:
        import asyncio

        from app.core.ffmpeg import run_ffmpeg

        silent = path.with_name(f"{path.stem}_nomusic.mp4")
        if not silent.exists():  # the picture is copied as it is: no re-encode, no quality loss, under a second
            await asyncio.to_thread(lambda: run_ffmpeg(["-i", str(path), "-map", "0:v:0", "-c:v", "copy", "-an", "-movflags", "+faststart", str(silent)], timeout=120))
        path, slug = silent, f"{slug}-no-music"
    return FileResponse(
        path, media_type="video/mp4", filename=f"{slug}.mp4" if download else None,
        content_disposition_type="attachment" if download else "inline",
    )


@router.get("/projects/{project_id}/song-parts", dependencies=[Depends(rate_limit("job", 60))])
async def song_parts(project_id: str, duration: float = Query(default=15, ge=5, le=600), count: int = Query(default=5, ge=1, le=10)):
    """The best parts of the project's song for a Reel of ``duration`` seconds, best first (the first is what the editor
    picks automatically), each with why. The song is analysed once (cached, also across projects)."""
    import asyncio

    from app.core.errors import ValidationFailed
    from app.jobs import pipeline as pl
    from app.schemas.project import ProjectSettings
    from app.video.timeline import rank_music_windows

    doc = await ps.get_project_doc(project_id)
    audio = await get_db().media.find_one({"_id": doc.get("audioId")}) if doc.get("audioId") else None
    if audio is None:
        raise ValidationFailed("Upload a song first.", code="NO_AUDIO")
    if audio.get("purged"):
        raise ValidationFailed("The song of this project was deleted (privacy). Upload it again.", code="MEDIA_PURGED")
    inp = pl.PipelineInput(project_id=str(doc["_id"]), job_type="analyze", videos=[], settings=ProjectSettings.model_validate(doc["settings"]),
                           audio=pl.MediaRef(str(audio["_id"]), audio["originalName"], audio["storedKey"]))  # fmt: skip
    analysis = await asyncio.to_thread(pl.analyze_music, inp, get_storage(), lambda *_: None)
    parts = rank_music_windows(analysis, duration, k=count)
    return {"songSeconds": round(analysis.duration, 2), "bpm": round(analysis.bpm, 1), "duration": duration,
            "parts": parts, "tooShort": analysis.duration < duration}  # fmt: skip
