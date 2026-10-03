"""Phase 1 + 2: project CRUD, validation, uploads, error format."""

from __future__ import annotations

import pytest


async def create(client, **kw):
    body = {"name": "Namora Luxury Reel", "settings": {"duration": 15, "style": "luxury"}}
    body.update(kw)
    r = await client.post("/api/projects", json=body)
    assert r.status_code == 201, r.text
    return r.json()


async def test_create_and_get_project(client):
    p = await create(client)
    assert p["status"] == "draft"
    assert p["settings"]["style"] == "luxury"
    assert p["videos"] == [] and p["audio"] is None
    r = await client.get(f"/api/projects/{p['id']}")
    assert r.status_code == 200 and r.json()["name"] == "Namora Luxury Reel"


async def test_list_projects_and_status_filter(client):
    await create(client, name="one")
    await create(client, name="two")
    assert len((await client.get("/api/projects")).json()) == 2
    assert (await client.get("/api/projects?status=completed")).json() == []
    assert (await client.get("/api/projects?status=bogus")).status_code == 422


@pytest.mark.parametrize(
    "body",
    [
        {"name": "", "settings": {}},
        {"name": "   ", "settings": {}},
        {"name": "x", "settings": {"duration": 3}},
        {"name": "x", "settings": {"duration": 601}},
        {"name": "x", "settings": {"style": "nope"}},
        {"name": "x", "settings": {"captionStyle": "comic-sans"}},
    ],
)
async def test_create_validation(client, body):
    r = await client.post("/api/projects", json=body)
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] in {"VALIDATION_ERROR", "UNKNOWN_STYLE"}
    assert "message" in err


async def test_update_and_delete_project(client, storage):
    p = await create(client)
    r = await client.patch(f"/api/projects/{p['id']}", json={"name": "Renamed", "duration": 30, "captions": True})
    assert r.status_code == 200
    assert r.json()["name"] == "Renamed" and r.json()["settings"]["duration"] == 30
    assert r.json()["settings"]["captions"] is True
    assert storage.exists(f"projects/{p['id']}/input")
    assert (await client.delete(f"/api/projects/{p['id']}")).status_code == 204
    assert (await client.get(f"/api/projects/{p['id']}")).status_code == 404
    assert not storage.exists(f"projects/{p['id']}")


async def test_unknown_and_malformed_ids_are_404(client):
    for pid in ("507f1f77bcf86cd799439011", "not-an-id", "%24where"):
        r = await client.get(f"/api/projects/{pid}")
        assert r.status_code == 404
        assert r.json()["error"]["code"] == "PROJECT_NOT_FOUND"


async def test_upload_videos_and_audio(client, media_dir, storage):
    p = await create(client)
    pid = p["id"]
    files = [("files", (n, (media_dir / n).read_bytes(), "video/mp4")) for n in ("clip_a.mp4", "clip_portrait.mp4")]
    r = await client.post(f"/api/projects/{pid}/videos", files=files)
    assert r.status_code == 201, r.text
    up = r.json()["uploaded"]
    assert [u["name"] for u in up] == ["clip_a.mp4", "clip_portrait.mp4"]
    assert (up[0]["width"], up[0]["height"]) == (1280, 720)
    assert (up[1]["width"], up[1]["height"]) == (720, 1280)
    assert up[0]["thumbnailUrl"]

    assert (await client.get(up[0]["thumbnailUrl"])).headers["content-type"] == "image/jpeg"
    file_resp = await client.get(up[0]["url"], headers={"Range": "bytes=0-99"})
    assert file_resp.status_code == 206 and len(file_resp.content) == 100

    r = await client.post(
        f"/api/projects/{pid}/audio",
        files={"file": ("beat120.mp3", (media_dir / "beat120.mp3").read_bytes(), "audio/mpeg")},
    )
    assert r.status_code == 201, r.text
    assert 29 < r.json()["duration"] < 31

    proj = (await client.get(f"/api/projects/{pid}")).json()
    assert len(proj["videos"]) == 2 and proj["audio"]["name"] == "beat120.mp3"

    # reorder
    ids = [v["id"] for v in proj["videos"]][::-1]
    r = await client.put(f"/api/projects/{pid}/videos/order", json={"ids": ids})
    assert [v["id"] for v in r.json()["videos"]] == ids
    bad = await client.put(f"/api/projects/{pid}/videos/order", json={"ids": ids[:1]})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "INVALID_ORDER"

    # delete a video removes it from storage
    key_count = len(list(storage.list(f"projects/{pid}/input")))
    assert (await client.delete(f"/api/projects/{pid}/videos/{ids[0]}")).status_code == 204
    assert len(list(storage.list(f"projects/{pid}/input"))) == key_count - 1


async def test_upload_rejects_bad_files(client, media_dir, storage):
    pid = (await create(client))["id"]
    # wrong extension
    r = await client.post(f"/api/projects/{pid}/videos", files=[("files", ("evil.exe", b"MZ", "video/mp4"))])
    assert r.status_code == 415 and r.json()["error"]["code"] == "UNSUPPORTED_MEDIA"
    # right extension, corrupted content
    r = await client.post(
        f"/api/projects/{pid}/videos",
        files=[("files", ("notvideo.mp4", (media_dir / "notvideo.mp4").read_bytes(), "video/mp4"))],
    )
    assert r.status_code == 415 or r.status_code == 400
    assert r.json()["error"]["code"] in {"CORRUPTED_MEDIA", "UNSUPPORTED_MEDIA"}
    # audio endpoint given a silent video-only file
    r = await client.post(
        f"/api/projects/{pid}/audio",
        files={"file": ("clip.mp3", (media_dir / "clip_a.mp4").read_bytes(), "audio/mpeg")},
    )
    assert r.status_code == 415 and r.json()["error"]["code"] == "NO_AUDIO_STREAM"
    # nothing left behind on disk
    assert list(storage.list(f"projects/{pid}/input")) == []


async def test_upload_size_limit_and_filename_sanitising(client, media_dir, monkeypatch, storage):
    monkeypatch.setenv("MAX_VIDEO_SIZE_MB", "0")  # every file is over the limit
    get = __import__("app.core.config", fromlist=["get_settings"]).get_settings
    get.cache_clear()
    pid = (await create(client))["id"]
    r = await client.post(
        f"/api/projects/{pid}/videos",
        files=[("files", ("../../etc/passwd;rm -rf.mp4", b"x" * 10, "video/mp4"))],
    )
    assert r.status_code == 413 and r.json()["error"]["code"] == "FILE_TOO_LARGE"
    assert list(storage.list(f"projects/{pid}/input")) == []


def test_sanitize_filename():
    from app.services.media_service import sanitize_filename

    assert sanitize_filename("../../etc/passwd.mp4") == "passwd.mp4"
    assert sanitize_filename("C:\\Users\\x\\my clip$$.MOV") == "my clip.mov"
    assert sanitize_filename("we$ird$name.mp4") == "we_ird_name.mp4"
    assert sanitize_filename("") == "upload"
    assert "/" not in sanitize_filename("a/b/c.mp4")


async def test_health_and_styles(client):
    r = await client.get("/api/health")
    assert r.status_code == 200 and r.json()["ffmpeg"] is True
    styles = (await client.get("/api/styles")).json()
    assert {s["id"] for s in styles} >= {"fast_trending", "cinematic", "luxury", "food", "travel", "custom"}


async def test_platform_is_stored_and_can_be_changed(client):
    p = await create(client, settings={"duration": 15, "style": "luxury", "platform": "instagram", "hookText": "Wait for it"})
    assert p["settings"]["platform"] == "instagram" and p["settings"]["hookText"] == "Wait for it"
    r = await client.patch(f"/api/projects/{p['id']}", json={"platform": "none"})
    assert r.status_code == 200 and r.json()["settings"]["platform"] == "none"
    r = await client.patch(f"/api/projects/{p['id']}", json={"platform": "myspace"})
    assert r.status_code == 422
