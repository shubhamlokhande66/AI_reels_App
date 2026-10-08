"""The manual editor: start an edit by hand from the uploaded clips, add clips, and use the pro tools on it."""

from __future__ import annotations

import pytest


async def _project_with_clips(client, media_dir, music=True):
    pid = (await client.post("/api/projects", json={"name": "By hand", "settings": {"duration": 15}})).json()["id"]
    files = [("files", (n, (media_dir / n).read_bytes(), "video/mp4")) for n in ("clip_a.mp4", "clip_b.mp4", "clip_c.mp4")]
    vids = (await client.post(f"/api/projects/{pid}/videos", files=files)).json()
    if music:
        await client.post(f"/api/projects/{pid}/audio", files={"file": ("beat120.mp3", (media_dir / "beat120.mp3").read_bytes(), "audio/mpeg")})
    return pid, vids


async def test_start_by_hand_add_and_shape_a_reel(client, media_dir):
    pid, _ = await _project_with_clips(client, media_dir)
    assert (await client.post("/api/projects/nonexistent0000000000000/timeline/start")).status_code in (404, 422)
    st = (await client.post(f"/api/projects/{pid}/timeline/start")).json()
    tl = st["timeline"]
    assert len(tl["segments"]) == 3 and abs(tl["duration"] - 9.0) < 0.01 and st["history"][-1]["label"] == "Start editing"
    clip_b = tl["segments"][1]["clipId"]
    first = tl["segments"][0]["id"]
    ops = [
        {"type": "insert", "clipId": clip_b, "sourceStart": 4.0, "length": 1.5, "index": 1},  # add a piece of clip B after shot 1
        {"type": "set_transition", "segmentId": tl["segments"][1]["id"], "transition": "circle_open", "duration": 0.5},
        {"type": "set_effect", "segmentId": first, "effect": "crash_zoom"},
        {"type": "set_speed", "segmentId": tl["segments"][2]["id"], "speed": 0.5},
        {"type": "set_grade", "grade": "cinematic"},
    ]
    r = await client.post(f"/api/projects/{pid}/timeline/ops", json={"ops": ops})
    assert r.status_code == 200, r.text
    tl2 = r.json()["timeline"]
    assert len(tl2["segments"]) == 4 and tl2["segments"][1]["clipId"] == clip_b and abs(tl2["segments"][1]["sourceStart"] - 4.0) < 0.01
    assert tl2["segments"][0]["effect"] == "crash_zoom" and tl2["colorGrade"] == "cinematic"
    assert (await client.post(f"/api/projects/{pid}/timeline/undo")).json()["timeline"]["segments"].__len__() == 3  # one undo step
    again = (await client.post(f"/api/projects/{pid}/timeline/start")).json()  # an existing edit opens as it is
    assert len(again["timeline"]["segments"]) == 3
    fresh = (await client.post(f"/api/projects/{pid}/timeline/start?fresh=true")).json()
    assert fresh["history"][-1]["label"] == "Start editing" and fresh["canUndo"]


async def test_insert_is_checked(client, media_dir):
    pid, _ = await _project_with_clips(client, media_dir, music=False)
    tl = (await client.post(f"/api/projects/{pid}/timeline/start")).json()["timeline"]
    bad = await client.post(f"/api/projects/{pid}/timeline/ops", json={"ops": [{"type": "insert", "clipId": "x" * 24}]})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "CLIP_NOT_FOUND"
    clip = tl["segments"][0]["clipId"]
    end = await client.post(f"/api/projects/{pid}/timeline/ops", json={"ops": [{"type": "insert", "clipId": clip, "sourceStart": 99, "length": 2}]})
    assert end.status_code == 200  # past the clip's end: the last part of the clip is used instead
    seg = end.json()["timeline"]["segments"][-1]
    assert seg["sourceEnd"] <= 7.0 + 1e-6 and seg["sourceEnd"] - seg["sourceStart"] > 0.2


@pytest.mark.slow
async def test_a_hand_made_reel_renders(client, media_dir):
    from tests.test_jobs_api import wait_job

    pid, _ = await _project_with_clips(client, media_dir)
    tl = (await client.post(f"/api/projects/{pid}/timeline/start")).json()["timeline"]
    await client.post(f"/api/projects/{pid}/timeline/ops", json={"ops": [
        {"type": "set_transition", "segmentId": tl["segments"][1]["id"], "transition": "pixelize", "duration": 0.4},
        {"type": "set_effect", "segmentId": tl["segments"][2]["id"], "effect": "glow"}]})  # fmt: skip
    job = (await client.post(f"/api/projects/{pid}/render", json={"quality": "preview"})).json()
    done, _ = await wait_job(client, pid, job["id"], timeout=600)
    assert done["status"] == "completed", done["error"]
