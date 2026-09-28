"""How many videos a project can hold: unlimited by default, but still configurable."""

from __future__ import annotations

from app.core.config import get_settings


async def _make_project(client):
    return (await client.post("/api/projects", json={"name": "Reel", "settings": {"duration": 8}})).json()["id"]


async def test_unlimited_by_default(client, media_dir):
    assert get_settings().max_videos_per_project == 0  # 0 = unlimited
    pid = await _make_project(client)
    data = (media_dir / "clip_a.mp4").read_bytes()
    files = [("files", (f"clip_{i}.mp4", data, "video/mp4")) for i in range(25)]  # well past the old 20-video cap
    r = await client.post(f"/api/projects/{pid}/videos", files=files)
    assert r.status_code == 201, r.text
    assert len(r.json()["uploaded"]) == 25

    # a second batch, on top of the 25 already there, still goes through
    more = [("files", ("clip_extra.mp4", data, "video/mp4"))]
    r2 = await client.post(f"/api/projects/{pid}/videos", files=more)
    assert r2.status_code == 201, r2.text


async def test_the_limit_still_works_when_an_operator_sets_one(client, media_dir, monkeypatch):
    monkeypatch.setenv("MAX_VIDEOS_PER_PROJECT", "3")
    get_settings.cache_clear()
    try:
        pid = await _make_project(client)
        data = (media_dir / "clip_a.mp4").read_bytes()
        ok = [("files", (f"clip_{i}.mp4", data, "video/mp4")) for i in range(3)]
        assert (await client.post(f"/api/projects/{pid}/videos", files=ok)).status_code == 201

        over = [("files", ("clip_one_too_many.mp4", data, "video/mp4"))]
        r = await client.post(f"/api/projects/{pid}/videos", files=over)
        assert r.status_code == 422
        assert r.json()["error"]["code"] == "TOO_MANY_VIDEOS"
        assert "at most 3" in r.json()["error"]["message"]
    finally:
        monkeypatch.delenv("MAX_VIDEOS_PER_PROJECT", raising=False)
        get_settings.cache_clear()
