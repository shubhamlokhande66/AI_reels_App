"""Posts: publish a rendering now or at a time, one result per platform, and a small scheduler that runs due posts.

A post document: ``{_id, projectId, renderingId, platforms, caption, at, status: scheduled|publishing|done|failed|
cancelled, results: {platform: {ok, postId, url, error}}, createdAt}`` in the owner's database."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import time
from typing import Any

import httpx
from bson import ObjectId

from app.core.auth import current_user
from app.core.config import get_settings
from app.core.database import get_db, get_main_db
from app.models.base import utcnow
from app.publish import platforms as pf
from app.storage import get_storage

log = logging.getLogger(__name__)
LINK_MINUTES = 120


def _sign(payload: str) -> str:
    return hmac.new(get_settings().secret_key.get_secret_value().encode(), payload.encode(), hashlib.sha256).hexdigest()[:40]


def public_link(project_id: str, rendering_id: str, minutes: int = LINK_MINUTES) -> str:
    """A short-lived link the platforms can download the Reel from (signed; no sign-in)."""
    data = {"u": current_user.get(), "p": project_id, "r": rendering_id, "e": int(time.time()) + minutes * 60}
    payload = base64.urlsafe_b64encode(json.dumps(data).encode()).decode().rstrip("=")
    return f"{get_settings().public_base_url.rstrip('/')}/api/public/reels/{payload}.{_sign(payload)}.mp4"


def read_link(token: str) -> dict[str, Any] | None:
    """The link's contents when it is signed by this server and not expired; None otherwise."""
    if not get_settings().secret_key.get_secret_value():
        return None
    try:
        payload, sig = token.removesuffix(".mp4").rsplit(".", 1)
    except ValueError:
        return None
    if not hmac.compare_digest(_sign(payload), sig):
        return None
    try:
        data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except ValueError:
        return None
    return data if data.get("e", 0) > time.time() else None


def _publish_sync(post: dict[str, Any], rendering: dict[str, Any], project_name: str) -> dict[str, dict]:
    pid, rid = str(post["projectId"]), str(rendering["_id"])
    caption = post.get("caption") or project_name
    out: dict[str, dict] = {}
    with httpx.Client(timeout=60) as client:
        for p in post["platforms"]:
            try:
                if not pf.connections()[p]["connected"]:
                    raise pf.PublishError(f"{p.title()} is not connected on this server.")
                if p == "youtube":
                    path = get_storage().local_path(rendering["storedKey"])
                    done = pf.post_youtube(path, caption.split("\n")[0][:90], caption, client)
                elif p == "instagram":
                    done = pf.post_instagram(public_link(pid, rid), caption, client)
                else:
                    done = pf.post_tiktok(public_link(pid, rid), caption, client)
                out[p] = {"ok": True, "postId": done.post_id, "url": done.url, "error": None}
            except (pf.PublishError, httpx.HTTPError, KeyError, OSError) as exc:
                out[p] = {"ok": False, "postId": None, "url": "", "error": str(exc) or exc.__class__.__name__}
    return out


async def run_post(post_id: ObjectId) -> None:
    """Publish one post (already marked 'publishing') in a worker thread; record each platform's result."""
    db = get_db()
    post = await db.posts.find_one({"_id": post_id})
    if not post:
        return
    rendering = await db.renderings.find_one({"_id": post["renderingId"]})
    project = await db.projects.find_one({"_id": post["projectId"]})
    if not rendering or not project:
        await db.posts.update_one({"_id": post_id}, {"$set": {"status": "failed", "error": "The Reel no longer exists.", "updatedAt": utcnow()}})
        return
    uid = current_user.get()

    def work() -> dict[str, dict]:
        tok = current_user.set(uid)  # a worker thread does not inherit the owner by itself
        try:
            return _publish_sync(post, rendering, project["name"])
        finally:
            current_user.reset(tok)

    results = await asyncio.to_thread(work)
    status = "done" if all(r["ok"] for r in results.values()) else "failed"
    await db.posts.update_one({"_id": post_id}, {"$set": {"status": status, "results": results, "updatedAt": utcnow()}})


async def run_due_posts() -> int:
    """Start every scheduled post whose time has come, for every user. Returns how many ran."""
    ran = 0
    db = get_main_db()
    while True:  # claim one at a time, so a post is never published twice
        post = await db.posts.find_one_and_update(
            {"status": "scheduled", "at": {"$lte": utcnow()}}, {"$set": {"status": "publishing", "updatedAt": utcnow()}}
        )
        if not post:
            break
        tok = current_user.set(post.get("ownerId"))  # published as its owner: their Reel, their records
        try:
            await run_post(post["_id"])
        finally:
            current_user.reset(tok)
        ran += 1
    return ran


async def scheduler(every: float = 30) -> None:
    """Runs for the life of the server (a single process: see docs/deploy.md)."""
    while True:
        try:
            await run_due_posts()
        except Exception as exc:  # noqa: BLE001 - the scheduler must never die
            log.warning("publishing scheduler: %s", exc)
        await asyncio.sleep(every)
