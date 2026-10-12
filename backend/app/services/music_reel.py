"""Music-first Reels, step by step (the /api/v1 endpoints):

1. ``song_document``: the song analysed by librosa (audio/analysis_json.py), once per song
2. ``video_report``: each clip's quality, good parts, scene cuts, and which uploads are duplicates
3. ``make_plan``: both sent to the AI (director/ai_timeline.py) -> a checked timeline, saved under a ``plan_id``
4. ``render_plan``: the plan checked again (it may have been edited), turned into the renderer's timeline, rendered
5. ``reel_status``: the render job's progress and, when done, the video's URL
"""

from __future__ import annotations

import json
from typing import Any

from app.core.database import get_db
from app.core.errors import NotFoundError, ValidationFailed
from app.jobs import pipeline as pl
from app.storage import StorageBackend, get_storage, project_key
from app.video.timeline import ClipInput

ANALYSIS_JSON_VERSION = 4  # 4 = bar starts / strong beats from audio/accents.py; 2 = energy curve + labelled sections; 3 = confidence per beat; raise when audio/analysis_json.py changes what it returns: saved documents are redone


async def project_input(project_id: str, need_videos: bool = True, need_audio: bool = True) -> tuple[dict[str, Any], pl.PipelineInput]:
    from app.schemas.project import ProjectSettings
    from app.services import project_service as ps
    from app.services.privacy import ensure_not_purged

    doc = await ps.get_project_doc(project_id)
    media = {m["_id"]: m async for m in get_db().media.find({"projectId": doc["_id"]})}
    videos = [media[i] for i in doc.get("videoOrder", []) if i in media]
    audio = media.get(doc.get("audioId"))
    if need_videos and not videos:
        raise ValidationFailed("Upload at least one clip first.", code="NO_VIDEOS")
    if need_audio and audio is None:
        raise ValidationFailed("Upload a song first.", code="NO_AUDIO")
    ensure_not_purged([*videos, *([audio] if audio else [])])

    def ref(m: dict[str, Any]) -> pl.MediaRef:
        return pl.MediaRef(str(m["_id"]), m["originalName"], m["storedKey"], m.get("width") or 0, m.get("height") or 0)

    inp = pl.PipelineInput(project_id=str(doc["_id"]), job_type="analyze", videos=[ref(v) for v in videos],
                           audio=ref(audio) if audio else None, settings=ProjectSettings.model_validate(doc["settings"]))  # fmt: skip
    return doc, inp


def song_document(storage: StorageBackend, audio_key: str, frame_step: int = 10) -> dict[str, Any]:
    """The analysis document of a stored song, analysed once (shared by content across projects)."""
    from app.audio.analysis_json import analyze_to_json
    from app.services import analysis_cache as shared

    digest = shared.content_hash(storage, audio_key)
    kind = f"analysis_json_step{frame_step}"
    hit = shared.load(storage, digest, kind, ANALYSIS_JSON_VERSION)
    if hit:
        return hit
    doc = analyze_to_json(storage.local_path(audio_key), frame_step)
    if doc["status"] == "completed":
        shared.save(storage, digest, kind, ANALYSIS_JSON_VERSION, doc)
    return doc


def clip_inputs(inp: pl.PipelineInput, storage: StorageBackend) -> list[ClipInput]:
    """The clips with their analysis (done once, cached) and, when known, what they show (no new AI call here)."""
    from app.ai.understanding import ClipSemantic

    clips = pl.analyze_videos(inp, storage, lambda *_: None)
    semantics = {}
    for v in inp.videos:
        cached = pl._load_json(storage, pl._semantic_key(inp.project_id, v.id))
        if cached:
            try:
                semantics[v.id] = ClipSemantic.model_validate(cached)
            except ValueError:
                pass
    return [ClipInput(v.id, v.name, clips[v.id], semantics.get(v.id)) for v in inp.videos if v.id in clips]


def video_report(inp: pl.PipelineInput, storage: StorageBackend, understand: bool = False) -> dict[str, Any]:
    """Each clip: size, quality scores, flags, good parts, scene cuts, best segments; and the duplicate uploads.
    ``understand``: also ask the vision model what each clip shows (sampled frames; once per clip, saved: the same
    footage is never sent twice). Technical measurements cannot tell a finished dish, a smile or a product close-up;
    this can, and /reels/plan then gives it to the AI editor."""
    from app.video import footage

    warnings: list[str] = []
    if understand:
        pl.understand_clips(inp, pl.analyze_videos(inp, storage, lambda *_: None), storage, lambda *_: None, warnings)
    clips = clip_inputs(inp, storage)
    dups = pl.find_duplicate_videos(inp, storage)
    same = {d["clipId"]: d for d in dups or []}
    names = {v.id: v.name for v in inp.videos}
    rows = []
    for c in clips:
        a = c.analysis
        m = a.metadata
        rows.append({
            "clip_id": c.clip_id, "name": c.name, "duration_sec": round(m.duration, 3), "width": m.width, "height": m.height,
            "fps": m.fps, "orientation": m.orientation, "usable": a.usable, "flags": a.flags,
            "scores": {"quality": round(a.quality_score, 3), "sharpness": round(a.sharpness_score, 3), "brightness": round(a.brightness_score, 3),
                       "motion": round(a.motion_score, 3), "shake": round(a.shake_score, 3), "resolution": round(a.resolution_score, 3)},
            "usable_windows": [{"start_sec": round(w.start, 3), "end_sec": round(w.end, 3), "quality": round(w.quality, 3), "motion": round(w.motion, 3),
                                "face": w.face, "shot": w.shot_size} for w in footage.joined(a.windows)],
            "scene_changes_sec": [round(t, 3) for t in a.scene_changes],
            "best_segments": [{"start_sec": round(b.start, 3), "end_sec": round(b.end, 3), "score": round(b.score, 3), "why": b.reason} for b in a.best_segments],
            "duplicate_of": (same[c.clip_id]["sameAs"] if c.clip_id in same else None),
            "understanding": None if c.semantic is None else {
                "shows": c.semantic.summary, "category": c.semantic.category, "scene": c.semantic.scene, "objects": c.semantic.objects,
                "people": c.semantic.people, "action": c.semantic.action, "mood": c.semantic.mood, "stage": c.semantic.stage,
                "hook_candidate": c.semantic.hook_candidate, "ending_candidate": c.semantic.ending_candidate,
                "importance": c.semantic.importance, "tags": c.semantic.tags, "model": c.semantic.model},
        })  # fmt: skip
    return {
        "status": "completed", "clips": rows,
        "duplicates": [{"clip_id": d["clipId"], "name": names.get(d["clipId"]), "same_as": d["sameAs"], "same_as_name": names.get(d["sameAs"]),
                        "offset_sec": d.get("offset")} for d in dups or []],
        "understood": sum(1 for r in rows if r["understanding"]),
        "errors": ([] if dups is not None else ["The duplicate check could not run."]) + warnings,
    }  # fmt: skip


def _plan_key(project_id: str, plan_id: str) -> str:
    return project_key(project_id, "analysis", f"ai_timeline_{plan_id}.json")


def make_plan(inp: pl.PipelineInput, storage: StorageBackend, duration: float | None = None, start: float | None = None,
              min_clip: float = 0.4, brief: str | None = None, refresh: bool = False) -> dict[str, Any]:  # fmt: skip
    """The AI's checked timeline for this project, with its ``plan_id`` (the same inputs give the same plan, saved)."""
    from app.director.ai_timeline import plan_timeline
    from app.video.timeline import rank_music_windows

    assert inp.audio is not None
    clips = clip_inputs(inp, storage)
    audio = pl.analyze_music(inp, storage, lambda *_: None)
    song = song_document(storage, inp.audio.key, 10)
    duration = float(duration or inp.settings.duration)
    if start is None:
        start = inp.settings.audio_start
    if start is None:
        best = rank_music_windows(audio, duration, k=1)
        start = float(best[0]["start"]) if best else 0.0
    saved_id: dict[str, str] = {}

    def load(key: str) -> dict | None:
        saved_id["id"] = key
        return pl._load_json(storage, _plan_key(inp.project_id, key))

    def save(key: str, value: dict) -> None:
        saved_id["id"] = key
        storage.write_bytes(_plan_key(inp.project_id, key), json.dumps({**value, "song_start_sec": round(float(start), 3)}).encode())

    out = plan_timeline(song, clips, float(start), duration, min_clip, brief if brief is not None else inp.settings.brief,
                        cache=((lambda k: (saved_id.__setitem__("id", k), None)[1]) if refresh else load, save))  # fmt: skip
    return {"plan_id": saved_id.get("id"), "song_start_sec": round(float(start), 3), "duration_sec": duration, "min_clip_sec": min_clip, **out}


def load_plan(storage: StorageBackend, project_id: str, plan_id: str) -> dict[str, Any]:
    if not plan_id.isalnum() or len(plan_id) > 64:
        raise ValidationFailed("Not a plan id.", code="BAD_PLAN_ID")
    doc = pl._load_json(storage, _plan_key(project_id, plan_id))
    if not doc:
        raise NotFoundError("No such plan for this project: make one with /api/v1/reels/plan.", code="PLAN_NOT_FOUND")
    return doc


def plan_to_timeline(inp: pl.PipelineInput, storage: StorageBackend, plan: dict[str, Any], min_clip: float) -> tuple[Any, list[str]]:
    """Check the plan again (it may have been edited by hand) and turn it into the renderer's timeline."""
    from app.director.ai_timeline import AITimeline, check, clips_for_ai, music_for_reel, to_timeline

    clips = clip_inputs(inp, storage)
    audio = pl.analyze_music(inp, storage, lambda *_: None)
    song = song_document(storage, inp.audio.key, 10)  # type: ignore[union-attr]
    start = float(plan.get("song_start_sec") or 0.0)
    timeline = AITimeline.model_validate({"timeline": plan["timeline"]})
    duration = timeline.timeline[-1].timeline_end_sec
    from app.audio.analysis_json import video_shape

    music = music_for_reel(video_shape(song), start, duration)
    _, alias = clips_for_ai(clips)
    checked, notes = check(timeline, music, clips, alias, min_clip)
    tl, more = to_timeline(checked, alias, clips, audio, start)
    return tl, notes + more


async def render_plan(project_id: str, plan_id: str | None = None, timeline: list[dict] | None = None, quality: str = "final",
                      min_clip: float = 0.4) -> dict[str, Any]:  # fmt: skip
    """Save the checked plan as the project's timeline (it opens in the editor too) and start rendering it."""
    import asyncio

    from app.models.base import utcnow
    from app.jobs import manager

    if not plan_id and not timeline:
        raise ValidationFailed("Send a plan_id (from /api/v1/reels/plan) or a timeline.", code="NO_PLAN")
    doc, inp = await project_input(project_id)
    storage = get_storage()
    plan = load_plan(storage, inp.project_id, plan_id) if plan_id else {"timeline": timeline, "song_start_sec": doc["settings"].get("audioStart") or 0.0}
    if timeline:
        plan = {**plan, "timeline": timeline}
    tl, notes = await asyncio.to_thread(plan_to_timeline, inp, storage, plan, min_clip)
    await get_db().projects.update_one({"_id": doc["_id"]}, {"$set": {
        "timeline": tl.to_doc(), "settings.audioStart": tl.audio_start, "settings.duration": tl.duration, "updatedAt": utcnow()}})  # fmt: skip
    job = await manager.submit_render(project_id, quality=quality, label="AI plan")
    return {"reel_id": str(job["_id"]), "project_id": project_id, "status": job["status"], "plan_id": plan_id, "segments": len(tl.segments), "notes": notes}


async def reel_status(reel_id: str) -> dict[str, Any]:
    from app.services.ids import parse_id

    job = await get_db().jobs.find_one({"_id": parse_id(reel_id)})
    if not job:
        raise NotFoundError("No such reel.", code="REEL_NOT_FOUND")
    pid = str(job["projectId"])
    out: dict[str, Any] = {"reel_id": reel_id, "project_id": pid, "status": job["status"], "progress": job.get("progress", 0),
                           "stage": job.get("stage"), "error": job.get("error"), "result_url": None}  # fmt: skip
    if job["status"] == "completed" and job.get("renderingId"):
        rid = str(job["renderingId"])
        out["rendering_id"] = rid
        out["result_url"] = f"/api/projects/{pid}/renderings/{rid}/file"
        out["download_url"] = f"/api/projects/{pid}/renderings/{rid}/file?download=true"
        rendering = await get_db().renderings.find_one({"_id": job["renderingId"]}, {"check": 1})
        out["check"] = (rendering or {}).get("check")  # the final check of the file (quality/checker.final_check)
    return out
