"""Publishing connectors (no real network: the platforms are faked), scheduling, signed links, and the trend feed."""

from __future__ import annotations

import json
from datetime import timedelta

import httpx
import pytest
from bson import ObjectId
from pydantic import SecretStr

from app.core.config import get_settings
from app.models.base import utcnow
from app.publish import platforms as pf
from app.publish import service


def _connect_all(monkeypatch):
    s = get_settings()
    for k, v in {"instagram_user_id": "1784", "public_base_url": "https://reels.example.com", "youtube_client_id": "cid"}.items():
        monkeypatch.setattr(s, k, v)
    for k in ("instagram_access_token", "tiktok_access_token", "youtube_client_secret", "youtube_refresh_token", "secret_key"):
        monkeypatch.setattr(s, k, SecretStr(f"{k}-value-0123456789"))


def test_nothing_connected_by_default_and_what_is_missing():
    c = pf.connections()
    assert not any(v["connected"] for v in c.values())
    assert "INSTAGRAM_ACCESS_TOKEN" in c["instagram"]["missing"] and "PUBLIC_BASE_URL" in c["tiktok"]["missing"]
    assert "YOUTUBE_REFRESH_TOKEN" in c["youtube"]["missing"]


def test_instagram_creates_waits_and_publishes(monkeypatch):
    _connect_all(monkeypatch)
    calls: list[str] = []
    states = iter(["IN_PROGRESS", "FINISHED"])

    def handler(req: httpx.Request) -> httpx.Response:
        calls.append(f"{req.method} {req.url.path}")
        if req.url.path.endswith("/1784/media"):
            body = dict(x.split("=", 1) for x in req.content.decode().split("&"))
            assert body["media_type"] == "REELS" and "video_url" in body
            return httpx.Response(200, json={"id": "C1"})
        if req.url.path.endswith("/C1"):
            return httpx.Response(200, json={"status_code": next(states)})
        if req.url.path.endswith("/media_publish"):
            return httpx.Response(200, json={"id": "M9"})
        return httpx.Response(200, json={"permalink": "https://instagram.com/reel/M9"})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        done = pf.post_instagram("https://x/v.mp4", "Hi", client, poll=0)
    assert done.post_id == "M9" and done.url.endswith("/M9")
    assert calls[0].endswith("/1784/media") and calls[-2].endswith("/media_publish")


def test_platform_errors_are_readable(monkeypatch):
    _connect_all(monkeypatch)
    bad = httpx.MockTransport(lambda r: httpx.Response(400, json={"error": {"message": "Invalid token"}}))
    with httpx.Client(transport=bad) as client, pytest.raises(pf.PublishError, match="Instagram said: Invalid token"):
        pf.post_instagram("https://x/v.mp4", "Hi", client, poll=0)
    tk = httpx.MockTransport(lambda r: httpx.Response(200, json={"error": {"code": "spam_risk_too_many_posts", "message": "Too many posts"}}))
    with httpx.Client(transport=tk) as client, pytest.raises(pf.PublishError, match="Too many posts"):
        pf.post_tiktok("https://x/v.mp4", "Hi", client)


def test_youtube_uploads_as_a_short(monkeypatch, tmp_path):
    _connect_all(monkeypatch)
    video = tmp_path / "r.mp4"
    video.write_bytes(b"mp4")
    seen = {}

    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.host == "oauth2.googleapis.com":
            return httpx.Response(200, json={"access_token": "AT"})
        if req.method == "POST":
            seen["meta"] = json.loads(req.content)
            return httpx.Response(200, headers={"location": "https://upload.example/session"})
        seen["bytes"] = req.content
        return httpx.Response(200, json={"id": "YT1"})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        done = pf.post_youtube(video, "My Reel", "desc", client)
    assert done.url == "https://youtube.com/shorts/YT1" and seen["bytes"] == b"mp4"
    assert seen["meta"]["snippet"]["title"] == "My Reel #Shorts"


def test_signed_links_expire_and_cannot_be_forged(monkeypatch):
    _connect_all(monkeypatch)
    link = service.public_link("p" * 24, "r" * 24)
    token = link.rsplit("/", 1)[1]
    assert link.startswith("https://reels.example.com/api/public/reels/") and service.read_link(token)["r"] == "r" * 24
    assert service.read_link(token.replace(".", "x.", 1)) is None  # tampered
    assert service.read_link(service.public_link("p" * 24, "r" * 24, minutes=-1).rsplit("/", 1)[1]) is None  # expired


async def _rendering(db, storage):
    pid, rid = ObjectId(), ObjectId()
    key = f"projects/{pid}/output/r.mp4"
    storage.write_bytes(key, b"video-bytes")
    await db.projects.insert_one({"_id": pid, "name": "Shop", "status": "completed", "settings": {}, "videoOrder": [], "createdAt": utcnow(), "updatedAt": utcnow()})
    await db.renderings.insert_one({"_id": rid, "projectId": pid, "storedKey": key, "createdAt": utcnow()})
    return str(pid), str(rid)


async def test_publish_refuses_platforms_that_are_not_connected(client, db, storage):
    pid, rid = await _rendering(db, storage)
    r = await client.post(f"/api/projects/{pid}/renderings/{rid}/publish", json={"platforms": ["instagram"]})
    assert r.status_code == 422 and r.json()["error"]["code"] == "PLATFORM_NOT_CONNECTED"
    assert (await client.get("/api/publish/connections")).json()["tiktok"]["connected"] is False


async def test_schedule_then_the_scheduler_publishes_once(client, db, storage, monkeypatch):
    _connect_all(monkeypatch)
    pid, rid = await _rendering(db, storage)
    posted = []
    monkeypatch.setattr(pf, "post_tiktok", lambda url, cap, c: posted.append((url, cap)) or pf.Posted("T1"))
    at = (utcnow() + timedelta(hours=2)).isoformat()
    bad = await client.post(f"/api/projects/{pid}/renderings/{rid}/publish", json={"platforms": ["tiktok"], "at": "2020-01-01T00:00:00Z"})
    assert bad.json()["error"]["code"] == "TIME_IN_PAST"
    post = (await client.post(f"/api/projects/{pid}/renderings/{rid}/publish", json={"platforms": ["tiktok"], "caption": "New drop", "at": at})).json()
    assert post["status"] == "scheduled"
    assert await service.run_due_posts() == 0 and not posted  # not yet
    await db.posts.update_one({"_id": ObjectId(post["id"])}, {"$set": {"at": utcnow() - timedelta(seconds=1)}})
    assert await service.run_due_posts() == 1
    assert await service.run_due_posts() == 0  # never twice
    done = (await client.get(f"/api/projects/{pid}/posts")).json()[0]
    assert done["status"] == "done" and done["results"]["tiktok"]["postId"] == "T1"
    assert posted[0][1] == "New drop" and "/api/public/reels/" in posted[0][0]
    # the platform can download the file from that link, without signing in
    r = await client.get("/api/public/reels/" + posted[0][0].rsplit("/", 1)[1])
    assert r.status_code == 200 and r.content == b"video-bytes"


async def test_cancel_a_scheduled_post(client, db, storage, monkeypatch):
    _connect_all(monkeypatch)
    pid, rid = await _rendering(db, storage)
    at = (utcnow() + timedelta(hours=2)).isoformat()
    post = (await client.post(f"/api/projects/{pid}/renderings/{rid}/publish", json={"platforms": ["youtube"], "at": at})).json()
    assert (await client.delete(f"/api/posts/{post['id']}")).status_code == 200
    assert (await client.delete(f"/api/posts/{post['id']}")).status_code == 404
    assert await service.run_due_posts() == 0


def test_trend_feed_adds_live_trends_and_survives_outages(monkeypatch):
    from app.trends import feed

    s = get_settings()
    monkeypatch.setattr(s, "trend_feed_url", "https://trends.example.com/feed")
    rows = [{"id": "slow-lux", "trendName": "Slow luxury reveal", "recommendedDuration": 15, "cutFrequency": "slow", "transitionStyle": "smooth"},
            {"id": "broken"}]  # fmt: skip
    src = feed.FeedTrendSource()
    monkeypatch.setattr(src, "_fetch", lambda: [p.model_copy(update={"id": f"feed-{p.id}"}) for p in map(feed.TrendPreset.model_validate, rows[:1])])
    names = [t.trend_name for t in src.list_trends()]
    assert names[0] == "Slow luxury reveal" and len(names) == 1 + len(feed.ManualTrendSource().list_trends())

    def down():
        raise httpx.ConnectError("down")

    monkeypatch.setattr(src, "_fetch", down)
    src._at = 0
    assert src.list_trends()[0].trend_name == "Slow luxury reveal"  # the last good feed is kept
