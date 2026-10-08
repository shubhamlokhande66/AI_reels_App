"""Automatic deletion (admin setting): uploaded clips / songs go a few hours after a project was last used, and the whole
project (its finished Reels, versions and records) some time later. Keeps the server disk and the database small (a free
512 MB Atlas cluster is plenty) and means users' footage is not kept.

The setting lives in MongoDB (``app_settings``, ``_id: "retention"``), editable on the Admin page; until the admin saves
it, the .env defaults apply (``RETENTION_ENABLED``, ``KEEP_UPLOADS_HOURS``, ``KEEP_PROJECTS_HOURS``).

Never deleted: a project that is rendering right now, or one with a post still scheduled (until it has been posted).
"""

from __future__ import annotations

import asyncio
import logging
from datetime import timedelta
from typing import Any

from app.core.config import get_settings
from app.core.database import get_main_db
from app.core.errors import ValidationFailed
from app.models.base import utcnow
from app.storage import get_storage

log = logging.getLogger(__name__)
KEY = "retention"
MAX_HOURS = 24 * 90


def _defaults() -> dict[str, Any]:
    s = get_settings()
    return {"enabled": s.retention_enabled, "uploadsHours": s.keep_uploads_hours, "projectsHours": s.keep_projects_hours}


async def get_retention() -> dict[str, Any]:
    saved = await get_main_db().app_settings.find_one({"_id": KEY}) or {}
    out = _defaults()
    out.update({k: saved[k] for k in out if k in saved})
    return out


async def set_retention(enabled: bool, uploads_hours: int, projects_hours: int) -> dict[str, Any]:
    if not 1 <= uploads_hours <= MAX_HOURS or not 1 <= projects_hours <= MAX_HOURS:
        raise ValidationFailed(f"Choose between 1 hour and {MAX_HOURS // 24} days.", code="INVALID_RETENTION")
    if projects_hours < uploads_hours:
        raise ValidationFailed("Projects must be kept at least as long as their uploaded clips.", code="INVALID_RETENTION")
    doc = {"enabled": enabled, "uploadsHours": uploads_hours, "projectsHours": projects_hours, "updatedAt": utcnow()}
    await get_main_db().app_settings.update_one({"_id": KEY}, {"$set": doc}, upsert=True)
    return await get_retention()


async def _busy(db: Any, oid: Any) -> bool:
    return bool(await db.posts.find_one({"projectId": oid, "status": {"$in": ["scheduled", "publishing"]}}))


async def sweep() -> dict[str, int]:
    """One pass over every user's projects. Returns how many uploads were cleared and projects deleted."""
    from app.services.privacy import purge_media

    r = await get_retention()
    done = {"uploads": 0, "projects": 0}
    if not r["enabled"]:
        return done
    db = get_main_db()  # housekeeping sees every user's projects
    now = utcnow()
    old_projects = {"updatedAt": {"$lt": now - timedelta(hours=r["projectsHours"])}, "status": {"$ne": "processing"}}
    async for p in db.projects.find(old_projects, {"_id": 1}):
        if await _busy(db, p["_id"]):
            continue
        pid = p["_id"]
        await purge_media(pid)  # also forgets what was measured about the files
        for name in ("media", "jobs", "renderings", "posts"):
            await db[name].delete_many({"projectId": pid})
        await db.projects.delete_one({"_id": pid})
        get_storage().delete_prefix(f"projects/{pid}")
        done["projects"] += 1
    old_uploads = {"updatedAt": {"$lt": now - timedelta(hours=r["uploadsHours"])}, "status": {"$ne": "processing"},
                   "mediaPurgedAt": {"$exists": False}}  # fmt: skip
    async for p in db.projects.find(old_uploads, {"_id": 1}):
        if await _busy(db, p["_id"]):
            continue
        if await purge_media(p["_id"]):
            done["uploads"] += 1
        else:
            await db.projects.update_one({"_id": p["_id"]}, {"$set": {"mediaPurgedAt": now}})  # nothing left: skip next time
    if done["uploads"] or done["projects"]:
        log.info("auto-delete: cleared uploads of %d project(s), deleted %d project(s)", done["uploads"], done["projects"])
    return done


async def runner(every: float = 600) -> None:
    """Runs for the life of the server (every 10 minutes)."""
    while True:
        try:
            await sweep()
        except Exception as exc:  # noqa: BLE001 - housekeeping must never stop the server
            log.warning("auto-delete: %s", exc)
        await asyncio.sleep(every)
