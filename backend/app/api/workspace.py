"""Workspace-level features: duplicate as a variant (no re-upload), performance data + insights, dashboard stats."""

from __future__ import annotations

import shutil
from datetime import datetime
from typing import Any, Literal

from bson import ObjectId
from fastapi import APIRouter
from pydantic import Field

from app.core.database import get_db
from app.core.errors import ConflictError, NotFoundError
from app.models.base import CamelModel, utcnow
from app.services import project_service as ps
from app.services import timeline_service as ts
from app.services.ids import parse_id
from app.storage import get_storage

router = APIRouter(tags=["workspace"])


# ------------------------------------------------------------------ duplicate / language variants
class DuplicateRequest(CamelModel):
    name: str | None = Field(default=None, max_length=120)
    variant: Literal["copy", "language"] = "copy"
    language: Literal["en", "hi", "mr", "hinglish"] | None = None
    export_preset: str | None = None


def _remap(tl: dict[str, Any] | None, ids: dict[str, str]) -> dict[str, Any] | None:
    if not tl:
        return tl
    out = {**tl, "segments": [{**s, "clipId": ids.get(s.get("clipId"), s.get("clipId"))} for s in tl.get("segments", [])]}
    return out


@router.post("/api/projects/{project_id}/duplicate", status_code=201)
async def duplicate_project(project_id: str, payload: DuplicateRequest | None = None):
    """Copy a project *with its media* so a new version (another language, another format) needs no re-upload.

    ``language`` variant: keeps footage, music, style and edit, but clears script, voice and captions
    (they are language-specific) and switches the project language.
    """
    req = payload or DuplicateRequest()
    db, storage = get_db(), get_storage()
    doc = await ts.load(project_id)
    if doc["status"] == "processing":
        raise ConflictError("The project is being processed; try again when it finishes.", code="PROJECT_BUSY")
    new_id = ObjectId()
    storage.ensure_project(str(new_id))
    ids: dict[str, str] = {}
    new_media: list[dict[str, Any]] = []
    async for m in db.media.find({"projectId": doc["_id"]}):
        nid = ObjectId()
        ids[str(m["_id"])] = str(nid)
        key = f"projects/{new_id}/input/{nid}{'.' + m['storedKey'].rsplit('.', 1)[-1] if '.' in m['storedKey'] else ''}"
        shutil.copyfile(storage.local_path(m["storedKey"]), storage.new_local_path(key))
        thumb = None
        if m.get("thumbnailKey") and storage.exists(m["thumbnailKey"]):
            thumb = f"projects/{new_id}/analysis/thumb_{nid}.jpg"
            shutil.copyfile(storage.local_path(m["thumbnailKey"]), storage.new_local_path(thumb))
        for prefix in ("clip", "audio", "semantic"):  # cached analyses are reusable: copy them too
            old = f"projects/{doc['_id']}/analysis/{prefix}_{m['_id']}.json"
            if storage.exists(old):
                text = storage.read_bytes(old).decode("utf-8").replace(str(m["_id"]), str(nid))
                storage.write_bytes(f"projects/{new_id}/analysis/{prefix}_{nid}.json", text.encode("utf-8"))
        new_media.append({**m, "_id": nid, "projectId": new_id, "storedKey": key, "thumbnailKey": thumb, "createdAt": utcnow()})
    if new_media:
        await db.media.insert_many(new_media)

    state = ts.state_of(doc)
    timeline = _remap(state["timeline"], ids)
    settings = dict(doc["settings"])
    script = doc.get("script")
    if req.export_preset:
        settings["exportPreset"] = req.export_preset
    if req.variant == "language":
        settings["language"] = req.language or settings.get("language", "en")
        settings["captions"] = False
        script = {"language": settings["language"], "lines": [], "hook": None, "cta": None, "tone": (script or {}).get("tone", ""),
                  "voiceProfileId": None}  # fmt: skip
        if timeline:
            timeline = {**timeline, "voice": None, "captions": []}
    now = utcnow()
    new_doc = {
        "_id": new_id, "name": req.name or f"{doc['name']} ({settings.get('language', 'en').upper() if req.variant == 'language' else 'copy'})",
        "status": "completed" if False else "draft", "settings": settings,
        "videoOrder": [ObjectId(ids[str(i)]) for i in doc.get("videoOrder", []) if str(i) in ids],
        "audioId": ObjectId(ids[str(doc["audioId"])]) if doc.get("audioId") and str(doc["audioId"]) in ids else None,
        "analysis": doc.get("analysis"), "timeline": timeline,
        "timelineHistory": [{"timeline": timeline, "label": "Copied from " + doc["name"], "at": now}] if timeline else None,
        "historyIndex": 0, "timelineVersion": 1 if timeline else 0, "script": script, "latestRenderingId": None,
        "previewRenderingId": None, "latestJobId": None, "error": None, "createdAt": now, "updatedAt": now,
    }  # fmt: skip
    await db.projects.insert_one(new_doc)
    return {"id": str(new_id), "name": new_doc["name"], "mediaCopied": len(new_media), "hasTimeline": bool(timeline)}


# ------------------------------------------------------------------ performance data + insights
class Performance(CamelModel):
    platform: Literal["instagram", "youtube", "tiktok", "other"] = "instagram"
    posted_at: datetime | None = None
    views: int = Field(default=0, ge=0)
    watch_seconds: float = Field(default=0, ge=0)  # total watch time
    likes: int = Field(default=0, ge=0)
    shares: int = Field(default=0, ge=0)
    saves: int = Field(default=0, ge=0)
    comments: int = Field(default=0, ge=0)
    completion_rate: float | None = Field(default=None, ge=0, le=1)


@router.put("/api/projects/{project_id}/renderings/{rendering_id}/performance")
async def set_performance(project_id: str, rendering_id: str, payload: Performance):
    """Numbers the user copies from the platform. Stored for insights; nothing is fetched from any social network."""
    doc = await ps.get_project_doc(project_id)
    rid = parse_id(rendering_id, "Rendering")
    r = await get_db().renderings.find_one({"_id": rid, "projectId": doc["_id"]})
    if not r:
        raise NotFoundError("Rendering not found.", code="RENDERING_NOT_FOUND")
    await get_db().renderings.update_one({"_id": rid}, {"$set": {"performance": payload.to_doc()}})
    return {"id": rendering_id, "performance": payload.to_doc()}


def _bucket(seconds: float) -> str:
    return "up to 15s" if seconds <= 15.5 else "16-30s" if seconds <= 30.5 else "over 30s"


def _group(rows: list[dict[str, Any]], key) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        groups.setdefault(str(key(r)), []).append(r)
    out = []
    for name, rs in groups.items():
        comps = [r["performance"]["completionRate"] for r in rs if r["performance"].get("completionRate") is not None]
        views = [r["performance"]["views"] for r in rs]
        out.append({"name": name, "n": len(rs), "avgViews": round(sum(views) / len(views), 1),
                    "avgCompletion": round(sum(comps) / len(comps), 3) if comps else None,
                    "confident": len(rs) >= 5})  # fmt: skip
    return sorted(out, key=lambda g: (-(g["avgCompletion"] or 0), -g["avgViews"]))


@router.get("/api/insights")
async def insights():
    """What worked, from the user's OWN posted Reels. Small samples are flagged; nothing here predicts results."""
    rows = [r async for r in get_db().renderings.find({"performance": {"$ne": None}, "kind": {"$ne": "preview"}})]
    rows = [{**r, "performance": r["performance"]} for r in rows if r.get("performance")]
    enough = len(rows) >= 8
    return {
        "posts": len(rows), "enoughData": enough,
        "byStyle": _group(rows, lambda r: r.get("style", "?")),
        "byDuration": _group(rows, lambda r: _bucket(r.get("duration", 0))),
        "byCaptionStyle": _group(rows, lambda r: (r.get("timeline") or {}).get("captionStyle", "none") if (r.get("timeline") or {}).get("captions") else "no captions"),
        "byVoiceOver": _group(rows, lambda r: "voice-over" if (r.get("timeline") or {}).get("voice") else "music only"),
        "note": ("Based only on the results you entered. Differences between groups may be chance or caused by the content itself, "
                 "not the editing choice. Nothing here guarantees or predicts performance."
                 + ("" if enough else " Add results for at least 8 posted Reels before drawing conclusions.")),
    }  # fmt: skip


# ------------------------------------------------------------------ dashboard
@router.get("/api/dashboard")
async def dashboard():
    db = get_db()
    status: dict[str, int] = {"draft": 0, "processing": 0, "completed": 0, "failed": 0}
    styles: dict[str, int] = {}
    async for p in db.projects.find({}, {"status": 1, "settings.style": 1}):
        status[p["status"]] = status.get(p["status"], 0) + 1
        st = (p.get("settings") or {}).get("style", "?")
        styles[st] = styles.get(st, 0) + 1
    recent = [r async for r in db.renderings.find({"kind": {"$ne": "preview"}}).sort("createdAt", -1).limit(6)]
    names = {p["_id"]: p["name"] async for p in db.projects.find({"_id": {"$in": [r["projectId"] for r in recent]}})}
    from app.api.templates import BUILTIN

    meta = {m["_id"]: m async for m in db.template_meta.find({})}
    user_templates = [{"id": str(t["_id"]), "name": t["name"]} async for t in db.templates.find({})]
    all_t = [{"id": b["id"], "name": b["name"]} for b in BUILTIN] + user_templates
    favs = [t for t in all_t if meta.get(t["id"], {}).get("favorite")]
    popular = sorted(all_t, key=lambda t: -int(meta.get(t["id"], {}).get("uses", 0)))[:3]
    media = await db.media.count_documents({"kind": "video"})
    analyzed = await db.media.count_documents({"kind": "video", "semantic": {"$ne": None}})
    return {
        "projects": {"total": sum(status.values()), **status},
        "rendering": await db.jobs.count_documents({"status": {"$in": ["queued", "processing"]}}),
        "templates": {"total": len(all_t), "favorites": favs, "mostUsed": [t | {"uses": int(meta.get(t["id"], {}).get("uses", 0))} for t in popular]},
        "voiceProfiles": await db.voices.count_documents({}), "brands": await db.brands.count_documents({}),
        "library": {"clips": media, "analyzed": analyzed},
        "recentlyGenerated": [{"id": str(r["_id"]), "projectId": str(r["projectId"]), "projectName": names.get(r["projectId"], ""),
                               "label": r.get("label", ""), "style": r.get("style"), "createdAt": r["createdAt"],
                               "url": f"/api/projects/{r['projectId']}/renderings/{r['_id']}/file"} for r in recent],  # fmt: skip
        "mostUsedStyles": [{"style": k, "projects": v} for k, v in sorted(styles.items(), key=lambda kv: -kv[1])[:5]],
    }  # fmt: skip
