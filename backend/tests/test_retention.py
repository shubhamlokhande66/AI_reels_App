"""Auto-delete (admin setting) and the one-database, per-owner view of the data."""

from __future__ import annotations

from datetime import timedelta

from bson import ObjectId

from app.core.auth import current_user
from app.core.database import ScopedDatabase, get_db
from app.models.base import utcnow
from app.services import retention


async def _project(db, storage, hours_old: float, **extra):
    pid = ObjectId()
    clip_key, reel_key = f"projects/{pid}/input/a.mp4", f"projects/{pid}/output/r.mp4"
    storage.write_bytes(clip_key, b"clip")
    storage.write_bytes(reel_key, b"reel")
    when = utcnow() - timedelta(hours=hours_old)
    await db.projects.insert_one({"_id": pid, "name": "P", "status": "completed", "settings": {}, "videoOrder": [], "createdAt": when,
                                  "updatedAt": when, **extra})  # fmt: skip
    await db.media.insert_one({"_id": ObjectId(), "projectId": pid, "kind": "video", "storedKey": clip_key})
    await db.renderings.insert_one({"_id": ObjectId(), "projectId": pid, "storedKey": reel_key})
    return pid, clip_key, reel_key


async def test_off_by_default_nothing_is_deleted(db, storage):
    pid, clip, _ = await _project(db, storage, hours_old=1000)
    assert (await retention.get_retention())["enabled"] is False
    assert await retention.sweep() == {"uploads": 0, "projects": 0}
    assert storage.exists(clip) and await db.projects.find_one({"_id": pid})


async def test_uploads_then_whole_projects_are_deleted_on_time(db, storage):
    await retention.set_retention(True, uploads_hours=2, projects_hours=24)
    fresh, fresh_clip, _ = await _project(db, storage, hours_old=0.5)
    idle, idle_clip, idle_reel = await _project(db, storage, hours_old=3)
    old, old_clip, old_reel = await _project(db, storage, hours_old=30)
    busy, busy_clip, _ = await _project(db, storage, hours_old=30, status="processing")
    assert await retention.sweep() == {"uploads": 1, "projects": 1}
    assert storage.exists(fresh_clip)  # still being worked on
    assert not storage.exists(idle_clip) and storage.exists(idle_reel)  # clips gone, the Reel can still be downloaded
    assert (await db.media.find_one({"projectId": idle}))["purged"] is True
    assert not await db.projects.find_one({"_id": old}) and not storage.exists(old_reel) and not await db.renderings.find_one({"projectId": old})
    assert storage.exists(busy_clip)  # never while rendering
    assert await retention.sweep() == {"uploads": 0, "projects": 0}  # nothing twice


async def test_a_scheduled_post_keeps_its_project(db, storage):
    await retention.set_retention(True, uploads_hours=1, projects_hours=1)
    pid, _, reel = await _project(db, storage, hours_old=5)
    await db.posts.insert_one({"_id": ObjectId(), "projectId": pid, "status": "scheduled"})
    await retention.sweep()
    assert await db.projects.find_one({"_id": pid}) and storage.exists(reel)


async def test_admin_api_and_validation(client):
    r = await client.get("/api/retention")
    assert r.status_code == 200 and r.json()["uploadsHours"] == 2
    bad = await client.put("/api/admin/retention", json={"enabled": True, "uploadsHours": 48, "projectsHours": 24})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "INVALID_RETENTION"
    ok = await client.put("/api/admin/retention", json={"enabled": True, "uploadsHours": 6, "projectsHours": 72})
    assert ok.json() == {"enabled": True, "uploadsHours": 6, "projectsHours": 72}
    assert (await client.get("/api/retention")).json()["projectsHours"] == 72  # saved in MongoDB


async def test_each_user_sees_only_their_own_documents(db):
    tok = current_user.set("ann")
    try:
        view = get_db()
        assert isinstance(view, ScopedDatabase)
        doc = {"name": "Ann's"}
        await view.projects.insert_one(doc)
        assert doc["ownerId"] == "ann" and "_id" in doc
        await view.projects.update_one({}, {"$set": {"x": 1}})
    finally:
        current_user.reset(tok)
    await db.projects.insert_one({"name": "Bob's", "ownerId": "bob"})
    tok = current_user.set("bob")
    try:
        view = get_db()
        assert [p["name"] async for p in view.projects.find({})] == ["Bob's"]
        assert await view.projects.count_documents({}) == 1
        assert await view.projects.find_one({"_id": doc["_id"]}) is None  # Ann's id does not exist for Bob
        assert (await view.projects.delete_many({})).deleted_count == 1  # only his own
        assert view.users is db.users or view.users.name == "users"  # accounts are not per user
    finally:
        current_user.reset(tok)
    assert (await db.projects.find_one({"_id": doc["_id"]}))["x"] == 1  # Ann's untouched by Bob
