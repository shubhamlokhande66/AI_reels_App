"""Phases 3-7 through the REST API: analyze, generate, job status, output, download."""

from __future__ import annotations

import asyncio

import pytest

from app.core.errors import FFmpegError
from app.core.ffmpeg import probe
from app.jobs import manager, pipeline

CLIPS = ["clip_a.mp4", "clip_b.mp4", "clip_c.mp4", "clip_d.mp4", "clip_portrait.mp4"]


async def make_project(client, media_dir, videos=CLIPS, audio="beat120.mp3", **settings):
    body = {"name": "Reel", "settings": {"duration": 8, "style": "fast_trending", **settings}}
    pid = (await client.post("/api/projects", json=body)).json()["id"]
    if videos:
        files = [("files", (n, (media_dir / n).read_bytes(), "video/mp4")) for n in videos]
        r = await client.post(f"/api/projects/{pid}/videos", files=files)
        assert r.status_code == 201, r.text
    if audio:
        r = await client.post(f"/api/projects/{pid}/audio", files={"file": (audio, (media_dir / audio).read_bytes(), "audio/mpeg")})
        assert r.status_code == 201, r.text
    return pid


async def wait_job(client, pid, jid, timeout=240):
    seen = []
    for _ in range(timeout * 4):
        j = (await client.get(f"/api/projects/{pid}/jobs/{jid}")).json()
        seen.append((j["stage"], j["progress"]))
        if j["status"] in ("completed", "failed", "cancelled"):
            return j, seen
        await asyncio.sleep(0.25)
    raise AssertionError("job did not finish")


async def test_generate_requires_media(client, media_dir):
    pid = await make_project(client, media_dir, videos=[], audio=None)
    r = await client.post(f"/api/projects/{pid}/generate")
    assert r.status_code == 422 and r.json()["error"]["code"] == "NO_VIDEOS"
    pid = await make_project(client, media_dir, videos=["clip_a.mp4"], audio=None)
    r = await client.post(f"/api/projects/{pid}/generate")
    assert r.status_code == 422 and r.json()["error"]["code"] == "NO_AUDIO"
    assert (await client.get("/api/jobs/507f1f77bcf86cd799439011")).status_code == 404


async def test_analyze_only_job(client, media_dir):
    pid = await make_project(client, media_dir, videos=["clip_a.mp4", "clip_portrait.mp4"])
    r = await client.post(f"/api/projects/{pid}/analyze")
    assert r.status_code == 202
    job = r.json()
    assert job["type"] == "analyze" and [s["name"] for s in job["stages"]] == [
        "analyzing_videos", "analyzing_music", "detecting_beats",
    ]
    done, _ = await wait_job(client, pid, job["id"])
    assert done["status"] == "completed" and done["progress"] == 100
    proj = (await client.get(f"/api/projects/{pid}")).json()
    assert proj["status"] == "draft"  # analysis alone does not produce output
    assert proj["analysis"]["audio"]["bpm"] == pytest.approx(120, abs=2)
    assert all(v["analysis"]["qualityScore"] > 0 for v in proj["videos"])
    assert proj["output"] is None


async def test_full_generate_flow_produces_real_mp4(client, media_dir, storage):
    pid = await make_project(client, media_dir)
    r = await client.post(f"/api/projects/{pid}/generate", json={"seed": 1})
    assert r.status_code == 202
    job = r.json()
    assert job["status"] in ("queued", "processing")
    # a second job while busy is rejected
    busy = await client.post(f"/api/projects/{pid}/generate")
    assert busy.status_code == 409 and busy.json()["error"]["code"] == "PROJECT_BUSY"

    done, seen = await wait_job(client, pid, job["id"])
    assert done["status"] == "completed", done["error"]
    assert done["progress"] == 100 and done["renderingId"]
    progresses = [p for _, p in seen]
    assert progresses == sorted(progresses)
    assert {s for s, _ in seen} >= {"rendering"}
    assert all(s["status"] == "completed" for s in done["stages"])
    # same job through the flat route from the spec
    assert (await client.get(f"/api/jobs/{job['id']}")).json()["status"] == "completed"

    proj = (await client.get(f"/api/projects/{pid}")).json()
    assert proj["status"] == "completed" and proj["timeline"]["duration"] == 8
    assert len(proj["timeline"]["segments"]) >= 4

    out = (await client.get(f"/api/projects/{pid}/output")).json()
    assert (out["width"], out["height"]) == (1080, 1920) and out["size"] > 10_000
    assert out["duration"] == pytest.approx(8, abs=0.4)

    video = await client.get(out["url"], headers={"Range": "bytes=0-1023"})
    assert video.status_code == 206 and video.headers["content-type"] == "video/mp4"
    dl = await client.get(out["downloadUrl"])
    assert dl.status_code == 200 and "attachment" in dl.headers["content-disposition"]
    assert dl.content[4:8] == b"ftyp"
    # the downloaded bytes are a valid, playable MP4
    f = storage.root / "dl.mp4"
    f.write_bytes(dl.content)
    info = probe(f)
    assert {s["codec_type"] for s in info["streams"]} == {"video", "audio"}

    # no temp files left behind
    assert list(storage.list(f"projects/{pid}/temp")) == []

    # regenerate with another style + seed => a second version, latest wins
    r = await client.post(f"/api/projects/{pid}/generate", json={"style": "cinematic", "duration": 6, "seed": 5, "label": "v2"})
    done2, _ = await wait_job(client, pid, r.json()["id"])
    assert done2["status"] == "completed", done2["error"]
    versions = (await client.get(f"/api/projects/{pid}/renderings")).json()
    assert len(versions) == 2 and versions[0]["label"] == "v2" and versions[0]["style"] == "cinematic"
    proj = (await client.get(f"/api/projects/{pid}")).json()
    assert proj["settings"]["style"] == "cinematic" and proj["settings"]["duration"] == 6
    assert proj["output"]["id"] == versions[0]["id"]


async def test_failed_render_reports_error(client, media_dir, monkeypatch):
    pid = await make_project(client, media_dir, videos=["clip_a.mp4"])

    def boom(*a, **k):
        raise FFmpegError("Video rendering failed.", details="Conversion failed!")

    monkeypatch.setattr(pipeline, "run_pipeline", boom)
    job = (await client.post(f"/api/projects/{pid}/generate")).json()
    done, _ = await wait_job(client, pid, job["id"], timeout=30)
    assert done["status"] == "failed"
    assert done["error"] == {"code": "FFMPEG_RENDER_FAILED", "message": "Video rendering failed.", "details": "Conversion failed!"}
    proj = (await client.get(f"/api/projects/{pid}")).json()
    assert proj["status"] == "failed" and proj["error"]["code"] == "FFMPEG_RENDER_FAILED"
    # a failed project can be retried
    monkeypatch.undo()
    assert (await client.post(f"/api/projects/{pid}/analyze")).status_code == 202
    await manager.wait_for_all()


async def test_unexpected_error_is_not_leaked(client, media_dir, monkeypatch):
    pid = await make_project(client, media_dir, videos=["clip_a.mp4"])
    monkeypatch.setattr(pipeline, "run_pipeline", lambda *a, **k: 1 / 0)
    job = (await client.post(f"/api/projects/{pid}/generate")).json()
    done, _ = await wait_job(client, pid, job["id"], timeout=30)
    assert done["status"] == "failed" and done["error"]["code"] == "INTERNAL_ERROR"
    assert "division" not in str(done["error"])


async def test_cancelling_a_running_job_stops_it_and_reverts_the_project(client, media_dir, monkeypatch):
    import time

    def slow_pipeline(inp, storage, progress):
        progress("analyzing_videos", 0.0)
        time.sleep(1.5)
        progress("analyzing_videos", 1.0)  # the cancel flag, once set, is noticed right here
        raise AssertionError("should have been cancelled before reaching this point")

    monkeypatch.setattr(pipeline, "run_pipeline", slow_pipeline)
    pid = await make_project(client, media_dir, videos=["clip_a.mp4"])
    job = (await client.post(f"/api/projects/{pid}/generate")).json()

    cancel = await client.post(f"/api/projects/{pid}/jobs/{job['id']}/cancel")
    assert cancel.status_code == 202
    assert cancel.json()["id"] == job["id"]

    done, _ = await wait_job(client, pid, job["id"], timeout=30)
    assert done["status"] == "cancelled"
    assert done["error"] == {"code": "JOB_CANCELLED", "message": "Cancelled by you.", "details": None}
    proj = (await client.get(f"/api/projects/{pid}")).json()
    assert proj["status"] == "draft" and proj["error"] is None  # reverted cleanly, not stuck "processing" or "failed"

    # a cancelled project can be retried, same as a failed one
    assert (await client.post(f"/api/projects/{pid}/analyze")).status_code == 202
    await manager.wait_for_all()


async def test_cancel_is_rejected_once_the_job_is_no_longer_active(client, media_dir):
    pid = await make_project(client, media_dir, videos=["clip_a.mp4"])
    job = (await client.post(f"/api/projects/{pid}/generate")).json()
    done, _ = await wait_job(client, pid, job["id"])
    assert done["status"] == "completed"

    r = await client.post(f"/api/projects/{pid}/jobs/{job['id']}/cancel")
    assert r.status_code == 409 and r.json()["error"]["code"] == "JOB_NOT_ACTIVE"


async def test_cancel_404s_for_an_unknown_job(client, media_dir):
    pid = await make_project(client, media_dir, videos=[], audio=None)
    r = await client.post(f"/api/projects/{pid}/jobs/507f1f77bcf86cd799439011/cancel")
    assert r.status_code == 404


def test_request_cancel_returns_false_for_a_job_this_process_is_not_tracking():
    assert manager.request_cancel("not-a-real-job-id") is False


async def test_stale_jobs_recovered_on_startup(client, media_dir, db):
    pid = await make_project(client, media_dir, videos=["clip_a.mp4"])
    from bson import ObjectId

    await db.projects.update_one({"_id": ObjectId(pid)}, {"$set": {"status": "processing"}})
    await db.jobs.insert_one({"_id": ObjectId(), "projectId": ObjectId(pid), "status": "processing", "type": "generate",
                              "progress": 10, "stage": "rendering", "stages": []})  # fmt: skip
    await manager.recover_stale_jobs()
    proj = (await client.get(f"/api/projects/{pid}")).json()
    assert proj["status"] == "failed" and proj["error"]["code"] == "JOB_INTERRUPTED"


async def test_output_404_before_generation_and_delete_cascade(client, media_dir, storage):
    pid = await make_project(client, media_dir, videos=["clip_a.mp4"])
    r = await client.get(f"/api/projects/{pid}/output")
    assert r.status_code == 404 and r.json()["error"]["code"] == "NO_OUTPUT"
    assert (await client.delete(f"/api/projects/{pid}")).status_code == 204
    assert not storage.exists(f"projects/{pid}")
