"""Project persistence + serialisation to API schemas."""

from __future__ import annotations

from typing import Any

from bson import ObjectId

from app.core.database import get_db
from app.core.errors import ConflictError, NotFoundError
from app.models.base import utcnow
from app.schemas.project import (
    JobOut,
    MediaOut,
    ProjectCreate,
    ProjectOut,
    ProjectSettings,
    ProjectSummary,
    ProjectUpdate,
    RenderingOut,
)
from app.services.ids import parse_id
from app.storage import get_storage
from app.styles import validate_style_id
from app.trends.manual import get_trend_source
from app.video.presets import validate_preset_id
from app.core.errors import ValidationFailed


def validate_trend_id(trend_id: str | None) -> None:
    if trend_id and get_trend_source().get(trend_id) is None:
        raise ValidationFailed(f"Unknown trend '{trend_id}'.", code="UNKNOWN_TREND")


def media_url(project_id: Any, media_id: Any) -> str:
    return f"/api/projects/{project_id}/media/{media_id}/file"


def media_to_out(doc: dict[str, Any]) -> MediaOut:
    pid, mid = doc["projectId"], doc["_id"]
    return MediaOut(
        id=str(mid),
        kind=doc["kind"],
        name=doc["originalName"],
        size=doc["size"],
        mime_type=doc.get("mimeType", ""),
        duration=doc.get("duration"),
        width=doc.get("width"),
        height=doc.get("height"),
        fps=doc.get("fps"),
        analysis=doc.get("analysisSummary"),
        url=media_url(pid, mid),
        thumbnail_url=f"/api/projects/{pid}/media/{mid}/thumbnail" if doc.get("thumbnailKey") and not doc.get("purged") else None,
        purged=bool(doc.get("purged")),
    )


def rendering_to_out(doc: dict[str, Any]) -> RenderingOut:
    pid, rid = doc["projectId"], doc["_id"]
    base = f"/api/projects/{pid}/renderings/{rid}/file"
    return RenderingOut(
        id=str(rid),
        project_id=str(pid),
        style=doc["style"],
        duration=doc["duration"],
        width=doc["width"],
        height=doc["height"],
        size=doc["size"],
        label=doc.get("label", ""),
        kind=doc.get("kind", "final"),
        timeline_version=doc.get("timelineVersion", 1),
        created_at=doc["createdAt"],
        post_copy=doc.get("postCopy"),
        performance=doc.get("performance"),
        url=base,
        download_url=f"{base}?download=1",
    )


def job_to_out(doc: dict[str, Any]) -> JobOut:
    return JobOut(
        id=str(doc["_id"]),
        project_id=str(doc["projectId"]),
        type=doc["type"],
        status=doc["status"],
        progress=doc["progress"],
        stage=doc["stage"],
        stages=doc.get("stages", []),
        error=doc.get("error"),
        rendering_id=str(doc["renderingId"]) if doc.get("renderingId") else None,
        created_at=doc["createdAt"],
        updated_at=doc["updatedAt"],
    )


async def get_project_doc(project_id: str) -> dict[str, Any]:
    oid = parse_id(project_id, "Project")
    doc = await get_db().projects.find_one({"_id": oid})
    if not doc:
        raise NotFoundError("Project not found.", code="PROJECT_NOT_FOUND")
    return doc


async def create_project(payload: ProjectCreate) -> dict[str, Any]:
    validate_style_id(payload.settings.style)
    validate_preset_id(payload.settings.export_preset)
    validate_trend_id(payload.settings.trend_id)
    now = utcnow()
    doc = {
        "_id": ObjectId(),
        "name": payload.name,
        "status": "draft",
        "settings": payload.settings.to_doc(),
        "videoOrder": [],
        "audioId": None,
        "analysis": None,
        "timeline": None,
        "latestRenderingId": None,
        "latestJobId": None,
        "error": None,
        "createdAt": now,
        "updatedAt": now,
    }
    await get_db().projects.insert_one(doc)
    get_storage().ensure_project(str(doc["_id"]))
    return doc


async def update_project(project_id: str, payload: ProjectUpdate) -> dict[str, Any]:
    doc = await get_project_doc(project_id)
    if doc["status"] == "processing":
        raise ConflictError("The project is being processed; try again when it finishes.",
                            code="PROJECT_BUSY")
    settings = dict(doc["settings"])
    fields = payload.model_dump(exclude_unset=True, by_alias=False)
    update: dict[str, Any] = {"updatedAt": utcnow()}
    if "name" in fields and fields["name"] is not None:
        update["name"] = fields.pop("name")
    fields.pop("name", None)
    camel = {
        "duration": "duration", "audio_start": "audioStart", "style": "style", "pace": "pace", "sequence": "sequence", "teaser": "teaser", "step_labels": "stepLabels", "order_mode": "orderMode", "export_preset": "exportPreset", "brief": "brief", "audio_mode": "audioMode", "language": "language", "voice_profile_id": "voiceProfileId",
        "brand_id": "brandId", "captions": "captions",
        "caption_style": "captionStyle", "ai": "ai", "ai_director": "aiDirector", "auto_review": "autoReview", "delete_media_after_render": "deleteMediaAfterRender", "trend_id": "trendId", "reference": "reference",
        "custom_style": "customStyle", "product_style": "productStyle", "hook_text": "hookText", "tagline_text": "taglineText", "cta_text": "ctaText", "loop": "loop",
    }  # fmt: skip
    for k, v in fields.items():
        if k == "custom_style" and v is not None:
            v = payload.custom_style.to_doc()  # type: ignore[union-attr]
        settings[camel[k]] = v
    if "style" in fields and fields["style"] is not None:
        validate_style_id(fields["style"])
    from app.services.feedback import record_settings_change

    await record_settings_change(doc["_id"], dict(doc["settings"]), {camel[k]: v for k, v in fields.items() if k in ("duration", "style", "pace")})
    if fields.get("export_preset"):
        validate_preset_id(fields["export_preset"])
    if fields.get("trend_id"):
        validate_trend_id(fields["trend_id"])
    ProjectSettings.model_validate(settings)  # final consistency check
    update["settings"] = settings
    await get_db().projects.update_one({"_id": doc["_id"]}, {"$set": update})
    return await get_project_doc(project_id)


async def delete_project(project_id: str) -> None:
    doc = await get_project_doc(project_id)
    if doc["status"] == "processing":
        raise ConflictError("Cannot delete a project while it is processing.", code="PROJECT_BUSY")
    db = get_db()
    oid = doc["_id"]
    await db.media.delete_many({"projectId": oid})
    await db.jobs.delete_many({"projectId": oid})
    await db.renderings.delete_many({"projectId": oid})
    await db.projects.delete_one({"_id": oid})
    get_storage().delete_prefix(f"projects/{project_id}")


async def build_project_out(doc: dict[str, Any]) -> ProjectOut:
    db = get_db()
    oid = doc["_id"]
    media = {m["_id"]: m async for m in db.media.find({"projectId": oid})}
    videos = [media_to_out(media[i]) for i in doc.get("videoOrder", []) if i in media]
    images = [media_to_out(media[i]) for i in doc.get("imageOrder", []) if i in media]
    audio = media_to_out(media[doc["audioId"]]) if doc.get("audioId") in media else None
    output = None
    if doc.get("latestRenderingId"):
        r = await db.renderings.find_one({"_id": doc["latestRenderingId"]})
        output = rendering_to_out(r) if r else None
    preview = None
    if doc.get("previewRenderingId"):
        pr = await db.renderings.find_one({"_id": doc["previewRenderingId"]})
        preview = rendering_to_out(pr) if pr else None
    latest_job = None
    if doc.get("latestJobId"):
        j = await db.jobs.find_one({"_id": doc["latestJobId"]})
        latest_job = job_to_out(j) if j else None
    return ProjectOut(
        id=str(oid),
        name=doc["name"],
        status=doc["status"],
        settings=ProjectSettings.model_validate(doc["settings"]),
        videos=videos,
        images=images,
        product_plan=doc.get("productPlan"),
        reel_plan=doc.get("reelPlan"),
        audio=audio,
        analysis=doc.get("analysis"),
        timeline=doc.get("timeline"),
        timeline_version=doc.get("timelineVersion", 0),
        preview=preview,
        output=output,
        latest_job=latest_job,
        error=doc.get("error"),
        created_at=doc["createdAt"],
        updated_at=doc["updatedAt"],
    )


async def list_projects(status: str | None = None, limit: int = 100) -> list[ProjectSummary]:
    db = get_db()
    query: dict[str, Any] = {"status": status} if status else {}
    docs = [d async for d in db.projects.find(query).sort("updatedAt", -1).limit(limit)]
    out: list[ProjectSummary] = []
    for d in docs:
        thumb = None
        for mid in d.get("videoOrder", [])[:1]:
            m = await db.media.find_one({"_id": mid})
            if m and m.get("thumbnailKey"):
                thumb = f"/api/projects/{d['_id']}/media/{mid}/thumbnail"
        output_url = None
        if d.get("latestRenderingId"):
            output_url = f"/api/projects/{d['_id']}/renderings/{d['latestRenderingId']}/file"
        out.append(
            ProjectSummary(
                id=str(d["_id"]),
                name=d["name"],
                status=d["status"],
                style=d["settings"]["style"],
                duration=d["settings"]["duration"],
                video_count=len(d.get("videoOrder", [])),
                thumbnail_url=thumb,
                output_url=output_url,
                created_at=d["createdAt"],
                updated_at=d["updatedAt"],
            )
        )
    return out
