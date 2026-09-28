"""Product Reels through the REST API: photo uploads, the director's plan, and real render jobs."""

from __future__ import annotations

import cv2
import numpy as np
import pytest

from app.core.ffmpeg import probe
from tests.test_jobs_api import wait_job
from tests.test_product import ring_photo


def png(tmp, name="p.png", w=1000, h=1300, dark=True):
    path = ring_photo(tmp / name, w=w, h=h, dark=dark)
    return path.read_bytes()


async def product_project(client, **settings):
    body = {"name": "Ring", "settings": {"reelType": "product", "duration": 8, **settings}}
    r = await client.post("/api/projects", json=body)
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def add_photos(client, pid, files):
    return await client.post(f"/api/projects/{pid}/images", files=[("files", (n, b, "image/png")) for n, b in files])


async def add_music(client, pid, media_dir):
    r = await client.post(f"/api/projects/{pid}/audio", files={"file": ("beat120.mp3", (media_dir / "beat120.mp3").read_bytes(), "audio/mpeg")})
    assert r.status_code == 201, r.text


async def test_the_styles_are_listed(client):
    j = (await client.get("/api/product/styles")).json()
    assert [s["id"] for s in j] == ["luxury_jewelry", "clean_product", "energetic"] and all(s["description"] for s in j)


async def test_a_product_project_starts_with_the_right_settings(client):
    pid = await product_project(client, hookText="The Solitaire", loop=True)
    j = (await client.get(f"/api/projects/{pid}")).json()
    assert j["settings"]["reelType"] == "product" and j["settings"]["productStyle"] == "luxury_jewelry" and j["settings"]["loop"] is True
    assert j["images"] == [] and j["productPlan"] is None
    assert (await client.post("/api/projects", json={"name": "x", "settings": {"hookText": "y" * 81}})).status_code == 422  # text stays short


async def test_photos_are_validated_by_decoding_them(client, tmp_path):
    pid = await product_project(client)
    ok = await add_photos(client, pid, [("ring.png", png(tmp_path)), ("ring2.png", png(tmp_path, "b.png", dark=False))])
    assert ok.status_code == 201 and len(ok.json()["uploaded"]) == 2 and ok.json()["failed"] == []
    up = ok.json()["uploaded"][0]
    assert up["kind"] == "image" and (up["width"], up["height"]) == (1000, 1300) and up["thumbnailUrl"]
    assert (await client.get(up["thumbnailUrl"])).headers["content-type"] == "image/jpeg"
    p = (await client.get(f"/api/projects/{pid}")).json()
    assert [i["name"] for i in p["images"]] == ["ring.png", "ring2.png"] and p["videos"] == []

    heic = await add_photos(client, pid, [("iphone.heic", b"\x00\x00\x00\x18ftypheic")])
    assert heic.status_code == 415 and "JPG" in heic.json()["error"]["message"]
    fake = await add_photos(client, pid, [("fake.jpg", b"this is not a picture")])
    assert fake.status_code >= 400 and fake.json()["error"]["code"] in ("CORRUPTED_IMAGE", "CORRUPTED_MEDIA")
    tiny = await add_photos(client, pid, [("tiny.png", png(tmp_path, "t.png", w=300, h=300))])
    assert tiny.status_code == 422 and tiny.json()["error"]["code"] == "IMAGE_TOO_SMALL"
    empty = await add_photos(client, pid, [("empty.png", b"")])
    assert empty.status_code == 422 and empty.json()["error"]["code"] == "EMPTY_FILE"
    assert len((await client.get(f"/api/projects/{pid}")).json()["images"]) == 2  # nothing rejected was kept


async def test_a_mixed_batch_keeps_the_good_photos_and_reports_the_bad(client, tmp_path):
    pid = await product_project(client)
    r = await add_photos(client, pid, [("good.png", png(tmp_path)), ("bad.jpg", b"nope"), ("also.gif", b"GIF89a")])
    j = r.json()
    assert r.status_code == 201 and [u["name"] for u in j["uploaded"]] == ["good.png"]
    assert {f["name"] for f in j["failed"]} == {"bad.jpg", "also.gif"}


async def test_the_number_of_photos_is_limited(client, tmp_path, monkeypatch):
    monkeypatch.setenv("MAX_IMAGES_PER_PROJECT", "2")
    from app.core.config import get_settings

    get_settings.cache_clear()
    pid = await product_project(client)
    assert (await add_photos(client, pid, [("a.png", png(tmp_path)), ("b.png", png(tmp_path))])).status_code == 201
    r = await add_photos(client, pid, [("c.png", png(tmp_path))])
    assert r.status_code == 422 and r.json()["error"]["code"] == "TOO_MANY_IMAGES"


async def test_photos_can_be_reordered_and_removed(client, tmp_path):
    pid = await product_project(client)
    ids = [u["id"] for u in (await add_photos(client, pid, [("a.png", png(tmp_path)), ("b.png", png(tmp_path, "b.png"))])).json()["uploaded"]]
    assert (await client.put(f"/api/projects/{pid}/images/order", json={"ids": ids[::-1]})).status_code == 200
    assert [i["id"] for i in (await client.get(f"/api/projects/{pid}")).json()["images"]] == ids[::-1]
    bad = await client.put(f"/api/projects/{pid}/images/order", json={"ids": [ids[0]]})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "INVALID_ORDER"
    assert (await client.delete(f"/api/projects/{pid}/images/{ids[0]}")).status_code == 204
    assert [i["id"] for i in (await client.get(f"/api/projects/{pid}")).json()["images"]] == [ids[1]]
    assert (await client.delete(f"/api/projects/{pid}/images/{ids[0]}")).status_code == 404


async def test_the_directors_shot_list_comes_without_rendering(client, tmp_path):
    pid = await product_project(client, duration=12)
    await add_photos(client, pid, [("ring.png", png(tmp_path))])
    r = await client.post(f"/api/projects/{pid}/product/plan", json={"hookText": "The Solitaire", "ctaText": "Shop now", "productStyle": "clean_product"})
    assert r.status_code == 200
    plan = r.json()
    assert plan["style"] == "clean_product" and plan["duration"] == 12 and plan["images"] and len(plan["shots"]) >= 8
    assert [s["purpose"] for s in plan["shots"]][0] == "hook" and plan["shots"][-1]["purpose"] == "cta"
    assert [t["role"] for t in plan["texts"]] == ["hook", "cta"] and all(c["ok"] for c in plan["quality"])
    assert {"start", "end", "camera", "effects", "transitionIn", "purpose", "framing", "note"} <= set(plan["shots"][0])
    assert any("No music" in n for n in plan["notes"])
    assert (await client.get(f"/api/projects/{pid}")).json()["output"] is None  # nothing was rendered or saved


async def test_the_plan_follows_the_chosen_part_of_the_song_and_says_when_it_is_short(client, tmp_path, media_dir):
    pid = await product_project(client, duration=40)  # longer than the 30 s test song
    await add_photos(client, pid, [("ring.png", png(tmp_path))])
    await add_music(client, pid, media_dir)
    plan = (await client.post(f"/api/projects/{pid}/product/plan", json={})).json()
    assert plan["duration"] < 30 and any("shortened" in w for w in plan["warnings"]) and plan["bpm"] == pytest.approx(120, abs=3)
    ok = (await client.post(f"/api/projects/{pid}/product/plan", json={"duration": 10, "audioStart": 12})).json()
    assert ok["duration"] == 10 and ok["audioStart"] == 12.0
    assert all(abs(s["start"] * 2 - round(s["start"] * 2)) < 0.13 for s in ok["shots"])  # cuts sit on the 120 BPM grid of that part


async def test_mistakes_are_explained(client, tmp_path):
    pid = await product_project(client)
    r = await client.post(f"/api/projects/{pid}/product/generate", json={})
    assert r.status_code == 422 and r.json()["error"]["code"] == "NO_IMAGES"
    r = await client.post(f"/api/projects/{pid}/product/plan", json={})
    assert r.status_code == 422 and r.json()["error"]["code"] == "NO_IMAGES"
    await add_photos(client, pid, [("ring.png", png(tmp_path))])
    r = await client.post(f"/api/projects/{pid}/product/plan", json={"productStyle": "nope"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "UNKNOWN_PRODUCT_STYLE"
    assert (await client.post(f"/api/projects/{pid}/product/plan", json={"duration": 2})).status_code == 422
    edit = (await client.post("/api/projects", json={"name": "clips"})).json()["id"]
    r = await client.post(f"/api/projects/{edit}/product/generate", json={})
    assert r.status_code == 422 and r.json()["error"]["code"] == "NOT_A_PRODUCT_PROJECT"


@pytest.mark.slow
async def test_a_preview_renders_quickly_and_keeps_the_project_a_draft(client, tmp_path, media_dir):
    pid = await product_project(client, duration=6)
    await add_photos(client, pid, [("ring.png", png(tmp_path))])
    await add_music(client, pid, media_dir)
    j = (await client.post(f"/api/projects/{pid}/product/generate", json={"quality": "preview", "hookText": "Hi"})).json()
    assert j["type"] == "product" and [s["name"] for s in j["stages"]][-1] == "rendering" and "understanding_images" in [s["name"] for s in j["stages"]]
    done, seen = await wait_job(client, pid, j["id"])
    assert done["status"] == "completed", done
    p = (await client.get(f"/api/projects/{pid}")).json()
    assert p["status"] == "draft" and p["output"] is None and p["preview"]["kind"] == "preview" and (p["preview"]["width"], p["preview"]["height"]) == (540, 960)
    assert p["productPlan"]["shots"] and p["productPlan"]["texts"][0]["text"] == "Hi"
    got = await client.get(p["preview"]["url"])
    path = tmp_path / "prev.mp4"
    path.write_bytes(got.content)
    v = next(s for s in probe(path)["streams"] if s["codec_type"] == "video")
    assert (v["codec_name"], v["width"]) == ("h264", 540) and float(probe(path)["format"]["duration"]) == pytest.approx(6, abs=0.2)


@pytest.mark.slow
async def test_a_final_reel_is_1080x1920_with_the_plan_saved_and_versions_kept(client, tmp_path, media_dir):
    pid = await product_project(client, duration=6)
    await add_photos(client, pid, [("ring.png", png(tmp_path))])
    await add_music(client, pid, media_dir)
    first = (await client.post(f"/api/projects/{pid}/product/generate", json={"label": "first", "ctaText": "Shop now"})).json()
    assert (await wait_job(client, pid, first["id"]))[0]["status"] == "completed"
    p = (await client.get(f"/api/projects/{pid}")).json()
    assert p["status"] == "completed" and (p["output"]["width"], p["output"]["height"]) == (1080, 1920) and p["output"]["label"] == "first"
    assert p["output"]["style"] == "luxury_jewelry" and p["output"]["duration"] == pytest.approx(6, abs=0.2)
    plan1 = p["productPlan"]
    assert plan1["quality"] and all(c["ok"] for c in plan1["quality"]) and plan1["texts"][0]["text"] == "Shop now"
    got = await client.get(p["output"]["url"])
    f = tmp_path / "final.mp4"
    f.write_bytes(got.content)
    streams = {s["codec_type"]: s for s in probe(f)["streams"]}
    assert streams["video"]["pix_fmt"] == "yuv420p" and streams["audio"]["codec_name"] == "aac"
    # another version with a different seed and style: both are kept
    second = (await client.post(f"/api/projects/{pid}/product/generate", json={"seed": 5, "productStyle": "energetic", "label": "punchy"})).json()
    assert (await wait_job(client, pid, second["id"]))[0]["status"] == "completed"
    rs = (await client.get(f"/api/projects/{pid}/renderings")).json()
    assert [r["label"] for r in rs][:2] == ["punchy", "first"] and rs[0]["style"] == "energetic"
    assert (await client.get(f"/api/projects/{pid}")).json()["productPlan"] != plan1


@pytest.mark.slow
async def test_a_missing_photo_file_fails_the_job_clearly_and_can_be_retried(client, tmp_path, storage):
    pid = await product_project(client, duration=5)
    up = (await add_photos(client, pid, [("ring.png", png(tmp_path))])).json()["uploaded"][0]
    from bson import ObjectId

    from app.core.database import get_db

    m = await get_db().media.find_one({"_id": ObjectId(up["id"])})
    storage.delete(m["storedKey"])  # the file vanished from disk
    j = (await client.post(f"/api/projects/{pid}/product/generate", json={"quality": "preview"})).json()
    done, _ = await wait_job(client, pid, j["id"])
    assert done["status"] == "failed" and done["error"]["message"]
    again = (await client.post(f"/api/projects/{pid}/product/generate", json={"quality": "preview"})).json()  # not stuck: another try is accepted
    assert (await wait_job(client, pid, again["id"]))[0]["status"] == "failed"
