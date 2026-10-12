"""The music-first Reel pipeline, one endpoint per step (app/services/music_reel.py).

    POST /api/v1/audio/analyze          librosa -> the song analysis document (audio_analysis.json)
    POST /api/v1/video/analyze          the clips: quality, good parts, scene cuts, duplicate uploads
    POST /api/v1/reels/plan             song + clip analysis -> the AI's editing timeline (checked, saved as plan_id)
    POST /api/v1/reels/render           check the plan and render it with FFmpeg (a background job)
    GET  /api/v1/reels/{reel_id}/status progress, and the video's URL when done
"""

from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, UploadFile
from pydantic import Field

from app.core.errors import ValidationFailed
from app.core.ratelimit import rate_limit
from app.models.base import CamelModel
from app.services import music_reel as mr
from app.storage import get_storage

router = APIRouter(prefix="/api/v1", tags=["v1"])
MAX_UPLOAD_MB = 200


@router.post("/audio/analyze", dependencies=[Depends(rate_limit("job", 30))])
async def audio_analyze(project_id: str | None = Form(default=None), onsets: bool = Form(default=False), full: bool = Form(default=False),
                        file: UploadFile | None = File(default=None)):  # fmt: skip
    """Run librosa on a song and return audio_analysis.json, schema 1.0 (audio/analysis_json.video_shape): tempo,
    beats (bar starts marked), energy curve every 0.25 s, labelled sections, candidate events. Send ``project_id``
    (the project's song; analysed once and saved) or a ``file`` (any audio: MP3, WAV, M4A...). ``onsets=true`` adds
    every detected attack; ``full=true`` returns the whole internal document instead (every measurement, for debugging)."""
    from app.audio.analysis_json import analyze_to_json, video_shape

    def shape(doc: dict) -> dict:
        return doc if full else video_shape(doc, onsets=onsets)

    if file is not None:
        data = await file.read()
        if len(data) > MAX_UPLOAD_MB * 1024 * 1024:
            raise ValidationFailed(f"The file is larger than {MAX_UPLOAD_MB} MB.", code="FILE_TOO_LARGE")
        suffix = Path(file.filename or "song").suffix[:8] or ".audio"
        with tempfile.TemporaryDirectory(prefix="v1_audio_") as tmp:
            path = Path(tmp) / f"song{suffix}"
            path.write_bytes(data)
            return shape(await asyncio.to_thread(analyze_to_json, path, 10))
    if not project_id:
        raise ValidationFailed("Send project_id or a file.", code="NO_INPUT")
    _, inp = await mr.project_input(project_id, need_videos=False)
    return shape(await asyncio.to_thread(mr.song_document, get_storage(), inp.audio.key, 10))  # type: ignore[union-attr]


class VideoRequest(CamelModel):
    project_id: str
    understand: bool = False  # also ask the vision model what each clip shows (one paid call per new clip, saved)


@router.post("/video/analyze", dependencies=[Depends(rate_limit("job", 30))])
async def video_analyze(req: VideoRequest):
    """Analyse the project's clips (once; saved): size, quality, flags, good parts, scene cuts, best segments, and
    which uploads are copies of another. ``understand``: also what each clip shows (a finished dish, a smile, a
    product close-up), whether it would make a good opening or ending, and how important it is; /reels/plan passes it
    to the AI editor."""
    _, inp = await mr.project_input(req.project_id, need_audio=False)
    return await asyncio.to_thread(mr.video_report, inp, get_storage(), req.understand)


class PlanRequest(CamelModel):
    project_id: str
    duration: float | None = Field(default=None, ge=3, le=600)  # default: the project's Reel length
    start: float | None = Field(default=None, ge=0, le=36000)  # song time the Reel starts at (default: chosen / best part)
    min_clip: float = Field(default=0.4, ge=0.25, le=2.0)
    brief: str | None = Field(default=None, max_length=600)
    refresh: bool = False  # ask the AI again instead of reusing the saved plan


@router.post("/reels/plan", dependencies=[Depends(rate_limit("job", 20))])
async def reels_plan(req: PlanRequest):
    """Send the song and clip analysis to the AI configured in Settings and get the complete editing timeline (checked
    and made playable). The same inputs give the same plan (saved under ``plan_id``) unless ``refresh``."""
    _, inp = await mr.project_input(req.project_id)
    return await asyncio.to_thread(mr.make_plan, inp, get_storage(), req.duration, req.start, req.min_clip, req.brief, req.refresh)


class RenderRequest(CamelModel):
    project_id: str
    plan_id: str | None = None  # a saved plan (from /reels/plan) ...
    timeline: list[dict] | None = None  # ... or a timeline in the plan's format (e.g. edited by hand)
    quality: str = Field(default="final", pattern="^(final|preview)$")
    min_clip: float = Field(default=0.4, ge=0.25, le=2.0)


@router.post("/reels/render", status_code=202, dependencies=[Depends(rate_limit("job", 20))])
async def reels_render(req: RenderRequest):
    """Check the plan again (an edited plan is made playable too) and render it with FFmpeg in the background. Poll
    /api/v1/reels/{reel_id}/status for progress and the video's URL."""
    return await mr.render_plan(req.project_id, req.plan_id, req.timeline, req.quality, req.min_clip)


@router.get("/reels/{reel_id}/status")
async def reels_status(reel_id: str):
    """Rendering progress (0..1, the current stage), and when it is done the URL of the video."""
    return await mr.reel_status(reel_id)
