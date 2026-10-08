"""Privacy: delete a project's uploaded media (clips, song, photos and their thumbnails) once its Reel is made.

The finished Reels, the edit (timeline) and the analysis numbers are kept, so the result can still be watched,
downloaded and inspected; anything that needs the original footage again (a new render, a new version) asks for a new
upload. Songs saved to the Songs library are the library's own copies and are not touched.
"""

from __future__ import annotations

from typing import Any

from bson import ObjectId

from app.core.database import get_db
from app.core.errors import ValidationFailed
from app.models.base import utcnow
from app.storage import get_storage


async def purge_media(project_oid: ObjectId) -> int:
    """Delete the project's uploaded files from storage and mark the media as purged. Returns how many were deleted."""
    db = get_db()
    storage = get_storage()
    n = 0
    async for m in db.media.find({"projectId": project_oid, "purged": {"$ne": True}}):
        if m.get("storedKey"):
            from app.services.analysis_cache import forget

            forget(storage, m["storedKey"])  # what was measured / described about this file goes too
        for key in (m.get("storedKey"), m.get("thumbnailKey")):
            if key:
                storage.delete(key)
        await db.media.update_one({"_id": m["_id"]}, {"$set": {"purged": True, "purgedAt": utcnow()}})
        n += 1
    if n:
        await db.projects.update_one({"_id": project_oid}, {"$set": {"mediaPurgedAt": utcnow()}})
    return n


def ensure_not_purged(media: list[dict[str, Any]]) -> None:
    """A render needs the original footage: say so plainly when it was deleted for privacy."""
    if any(m.get("purged") for m in media if m):
        raise ValidationFailed(
            "The uploaded clips and music of this project were deleted after rendering (privacy). Upload them again to make "
            "a new version; the finished Reels are still available.",
            code="MEDIA_PURGED",
        )
