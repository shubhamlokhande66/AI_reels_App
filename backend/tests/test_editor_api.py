"""Phase A through the REST API: edit the EDL, undo/redo, preview vs final render, quality check, versions."""

from __future__ import annotations

import pytest
from bson import ObjectId

from app.core.ffmpeg import probe
from app.styles import get_style
from app.video.timeline import build_timeline
from tests.test_jobs_api import make_project, wait_job
from tests.test_timeline import make_audio, make_clip

CLIPS = ["clip_a.mp4", "clip_d.mp4", "clip_portrait.mp4"]


async def seeded(client, db, media_dir, duration=8):
    """A project whose timeline is stored directly (no render): fast setup for pure edit tests."""
    pid = await make_project(client, media_dir, videos=CLIPS, duration=duration)
    doc = await db.projects.find_one({"_id": ObjectId(pid)})
    media = [m async for m in db.media.find({"projectId": doc["_id"], "kind": "video"})]
    clips = [make_clip(str(m["_id"]), dur=float(m["duration"]), sig_bin=i * 6) for i, m in enumerate(media)]
    for c, m in zip(clips, media):
        c.name = m["originalName"]
    tl = build_timeline(make_audio(), clips, duration, get_style("cinematic"), seed=2)
    await db.projects.update_one({"_id": doc["_id"]}, {"$set": {"timeline": tl.to_doc(), "status": "completed"}})
    return pid, tl


async def ops(client, pid, *o, label=None):
    body = {"ops": list(o), **({"label": label} if label else {})}
    return await client.post(f"/api/projects/{pid}/timeline/ops", json=body)


async def test_no_timeline_yet(client, media_dir):
    pid = await make_project(client, media_dir, videos=["clip_a.mp4"])
    r = await client.get(f"/api/projects/{pid}/timeline")
    assert r.status_code == 200 and r.json()["timeline"] is None and r.json()["canUndo"] is False
    assert (await client.post(f"/api/projects/{pid}/timeline/ops", json={"ops": [{"type": "set_music", "volume": 0.5}]})).status_code == 404
    assert (await client.post(f"/api/projects/{pid}/render", json={"quality": "preview"})).status_code == 422


async def test_edit_undo_redo_cycle(client, db, media_dir):
    pid, tl = await seeded(client, db, media_dir)
    st = (await client.get(f"/api/projects/{pid}/timeline")).json()
    assert st["canUndo"] is False and st["canRedo"] is False and len(st["history"]) == 1
    first = st["timeline"]["segments"][0]

    r = await ops(client, pid, {"type": "set_speed", "segmentId": first["id"], "speed": 0.5})
    assert r.status_code == 200, r.text
    s1 = r.json()
    assert s1["timeline"]["segments"][0]["speed"] == 0.5 and s1["canUndo"] and not s1["canRedo"]
    assert s1["version"] > st["version"] and s1["history"][-1]["label"] == "Change speed"

    r = await ops(client, pid, {"type": "delete", "segmentId": first["id"]}, label="Remove opener")
    s2 = r.json()
    assert len(s2["timeline"]["segments"]) == len(tl.segments) - 1 and s2["history"][-1]["label"] == "Remove opener"

    u1 = (await client.post(f"/api/projects/{pid}/timeline/undo")).json()
    assert len(u1["timeline"]["segments"]) == len(tl.segments) and u1["canRedo"]
    u2 = (await client.post(f"/api/projects/{pid}/timeline/undo")).json()
    assert u2["timeline"]["segments"][0]["speed"] == 1.0 and not u2["canUndo"]  # back to the original
    bad = await client.post(f"/api/projects/{pid}/timeline/undo")
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "NOTHING_TO_UNDO"

    r1 = (await client.post(f"/api/projects/{pid}/timeline/redo")).json()
    assert r1["timeline"]["segments"][0]["speed"] == 0.5
    # a new edit after undo discards the redo branch
    await client.post(f"/api/projects/{pid}/timeline/undo")
    await ops(client, pid, {"type": "set_music", "volume": 0.4})
    assert (await client.post(f"/api/projects/{pid}/timeline/redo")).json().get("error", {}).get("code") == "NOTHING_TO_REDO"


async def test_invalid_edits_change_nothing(client, db, media_dir):
    pid, tl = await seeded(client, db, media_dir)
    before = (await client.get(f"/api/projects/{pid}/timeline")).json()
    seg = before["timeline"]["segments"][0]
    r = await ops(client, pid, {"type": "set_effect", "segmentId": seg["id"], "effect": "punch"},
                  {"type": "delete", "segmentId": "does-not-exist"})  # fmt: skip
    assert r.status_code == 422 and r.json()["error"]["code"] == "SEGMENT_NOT_FOUND"
    after = (await client.get(f"/api/projects/{pid}/timeline")).json()
    assert after["timeline"] == before["timeline"] and len(after["history"]) == 1  # all-or-nothing
    for bad in ({"type": "format_disk"}, {"type": "set_music", "volume": 9}, {"type": "split"}):
        r = await ops(client, pid, bad)
        assert r.status_code == 422 and r.json()["error"]["code"] == "VALIDATION_ERROR"
    assert (await client.post(f"/api/projects/{pid}/timeline/ops", json={"ops": []})).status_code == 422


async def test_editing_never_touches_the_source_files(client, db, media_dir, storage):
    pid, tl = await seeded(client, db, media_dir)
    import hashlib

    def digest():
        return {k: hashlib.sha256(storage.read_bytes(k)).hexdigest() for k in storage.list(f"projects/{pid}/input")}

    before = digest()
    seg = tl.segments[0]
    await ops(client, pid, {"type": "trim", "segmentId": seg.id, "sourceStart": seg.source_start + 0.3},
              {"type": "set_speed", "segmentId": tl.segments[1].id, "speed": 0.5})  # fmt: skip
    assert digest() == before and len(before) == 4


async def test_quality_check_and_auto_fix_duration(client, db, media_dir):
    pid, tl = await seeded(client, db, media_dir, duration=8)
    q = (await client.post(f"/api/projects/{pid}/quality-check")).json()
    assert not any(i["code"] == "DURATION_MISMATCH" for i in q["issues"])

    victim = tl.segments[0]
    await ops(client, pid, {"type": "delete", "segmentId": victim.id})
    q = (await client.post(f"/api/projects/{pid}/quality-check")).json()
    dur = next(i for i in q["issues"] if i["code"] == "DURATION_MISMATCH")
    assert "too short" in dur["message"] and dur["fix"]

    fixed = await client.post(f"/api/projects/{pid}/quality-fix", json={"code": "DURATION_MISMATCH"})
    assert fixed.status_code == 200, fixed.text
    body = fixed.json()
    assert body["state"]["timeline"]["duration"] == pytest.approx(8, abs=0.05)
    assert not any(i["code"] == "DURATION_MISMATCH" for i in body["issues"])
    assert body["state"]["history"][-1]["label"].startswith("Auto-fix")
    undo = (await client.post(f"/api/projects/{pid}/timeline/undo")).json()  # the fix is itself undoable
    assert undo["timeline"]["duration"] < 8

    nofix = await client.post(f"/api/projects/{pid}/quality-fix", json={"code": "BLACK_FRAMES"})
    assert nofix.status_code == 422 and nofix.json()["error"]["code"] == "NO_AUTO_FIX"


async def test_quality_flags_short_repeated_and_broken_captions(client, db, media_dir):
    pid, tl = await seeded(client, db, media_dir)
    s = tl.segments[0]
    await ops(client, pid, {"type": "duplicate", "segmentId": s.id})  # same moment twice
    doc = await db.projects.find_one({"_id": ObjectId(pid)})
    t = doc["timeline"]
    t["segments"][1]["timelineEnd"] = t["segments"][1]["timelineStart"] + 0.2  # one very short shot
    t["captions"] = [{"id": "c1", "start": 1.0, "end": 0.5, "text": "backwards", "words": []}]
    await db.projects.update_one({"_id": doc["_id"]}, {"$set": {"timeline": t, "timelineHistory": None}})
    codes = {i["code"] for i in (await client.post(f"/api/projects/{pid}/quality-check")).json()["issues"]}
    assert {"SHORT_CLIP", "REPEATED_CLIP", "CAPTIONS_INVALID"} <= codes


async def test_export_presets_hardware_and_queue(client, db, media_dir):
    presets = (await client.get("/api/export-presets")).json()
    by = {p["id"]: p for p in presets}
    assert (by["instagram_reel"]["width"], by["instagram_reel"]["height"]) == (1080, 1920)
    assert (by["youtube"]["width"], by["youtube"]["height"]) == (1920, 1080) and by["instagram_post"]["aspect"] == "4:5"
    hw = (await client.get("/api/hardware")).json()
    assert hw["encoders"][0]["id"] == "libx264" and hw["selected"] in [e["id"] for e in hw["encoders"]]
    bad = await client.post("/api/projects", json={"name": "x", "settings": {"exportPreset": "vhs"}})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "UNKNOWN_PRESET"
    assert (await client.get("/api/queue")).json() == []


# ------------------------------------------------------------------ real renders of edited timelines
@pytest.mark.slow
async def test_preview_final_and_restore_use_the_edited_timeline(client, media_dir, storage):
    pid = await make_project(client, media_dir, videos=CLIPS, duration=8)
    job = (await client.post(f"/api/projects/{pid}/generate", json={"seed": 1})).json()
    done, _ = await wait_job(client, pid, job["id"])
    assert done["status"] == "completed", done["error"]
    proj = (await client.get(f"/api/projects/{pid}")).json()
    original_output = proj["output"]
    st = (await client.get(f"/api/projects/{pid}/timeline")).json()
    assert st["history"][0]["label"] == "AI generated" and proj["timelineVersion"] == st["version"]
    segs = st["timeline"]["segments"]

    # the human edits: speed, delete a shot, add a caption, quieter music
    await ops(client, pid, {"type": "set_speed", "segmentId": segs[0]["id"], "speed": 0.5},
              {"type": "delete", "segmentId": segs[1]["id"]},
              {"type": "add_caption", "start": 0.5, "end": 2.5, "text": "Hand written caption"},
              {"type": "set_music", "volume": 0.5, "fade_out": 1.0})  # fmt: skip
    edited = (await client.get(f"/api/projects/{pid}/timeline")).json()["timeline"]
    assert len(edited["segments"]) == len(segs) - 1 and edited["captions"][0]["text"] == "Hand written caption"

    # 1) low-res preview: separate rendering, project stays "completed", the final output is untouched
    job = (await client.post(f"/api/projects/{pid}/render", json={"quality": "preview"})).json()
    assert job["type"] == "render" and [s["name"] for s in job["stages"]] == ["rendering"]
    done, _ = await wait_job(client, pid, job["id"])
    assert done["status"] == "completed", done["error"]
    prev = (await client.get(f"/api/projects/{pid}/preview")).json()
    assert prev["kind"] == "preview" and (prev["width"], prev["height"]) == (360, 640)
    assert prev["duration"] == pytest.approx(edited["duration"], abs=0.4)
    proj = (await client.get(f"/api/projects/{pid}")).json()
    assert proj["status"] == "completed" and proj["output"]["id"] == original_output["id"]
    assert proj["preview"]["id"] == prev["id"] and prev["timelineVersion"] == proj["timelineVersion"]
    assert prev["size"] < original_output["size"]  # small and quick, as intended

    # quality check judges the preview because it matches the current timeline
    q = (await client.post(f"/api/projects/{pid}/quality-check")).json()
    assert q["checked"]["kind"] == "preview" and not any(i["severity"] == "error" for i in q["issues"])

    # 2) final render of the edited timeline
    job = (await client.post(f"/api/projects/{pid}/render", json={"quality": "final", "label": "edited"})).json()
    done, _ = await wait_job(client, pid, job["id"])
    assert done["status"] == "completed", done["error"]
    final = (await client.get(f"/api/projects/{pid}/output")).json()
    assert final["id"] != original_output["id"] and final["label"] == "edited"
    assert (final["width"], final["height"]) == (1080, 1920)
    assert final["duration"] == pytest.approx(edited["duration"], abs=0.4) and final["duration"] < original_output["duration"] - 0.3
    info = probe(storage.local_path(f"projects/{pid}/output/{final['id']}.mp4"))
    assert {s["codec_type"] for s in info["streams"]} == {"video", "audio"}

    # 3) version history: restoring the first render returns its timeline as a new, undoable step
    r = await client.post(f"/api/projects/{pid}/renderings/{original_output['id']}/restore")
    assert r.status_code == 200, r.text
    restored = r.json()
    assert len(restored["timeline"]["segments"]) == len(segs) and restored["history"][-1]["label"].startswith("Restored")
    undone = (await client.post(f"/api/projects/{pid}/timeline/undo")).json()
    assert len(undone["timeline"]["segments"]) == len(segs) - 1
    versions = (await client.get(f"/api/projects/{pid}/renderings")).json()
    assert {v["kind"] for v in versions} == {"final", "preview"} or len(versions) >= 2

    # 4) the queue lists these jobs with the project name and no active position once finished
    q = (await client.get("/api/queue")).json()
    assert len(q) >= 3 and q[0]["projectName"] == "Reel" and all(j["position"] is None for j in q)


@pytest.mark.slow
async def test_square_export_preset_renders_at_the_right_size(client, media_dir, storage):
    pid = await make_project(client, media_dir, videos=CLIPS, duration=5, exportPreset="square")
    job = (await client.post(f"/api/projects/{pid}/generate", json={"seed": 1})).json()
    done, _ = await wait_job(client, pid, job["id"])
    assert done["status"] == "completed", done["error"]
    out = (await client.get(f"/api/projects/{pid}/output")).json()
    assert (out["width"], out["height"]) == (1080, 1080)
    assert (await client.post(f"/api/projects/{pid}/quality-check")).json()["ok"] is True


@pytest.mark.slow
async def test_failed_preview_does_not_fail_the_project(client, db, media_dir, monkeypatch):
    from app.jobs import pipeline

    pid, _ = await seeded(client, db, media_dir)

    def boom(*a, **k):
        raise RuntimeError("disk on fire")

    monkeypatch.setattr(pipeline, "run_render", boom)
    job = (await client.post(f"/api/projects/{pid}/render", json={"quality": "preview"})).json()
    done, _ = await wait_job(client, pid, job["id"], timeout=30)
    assert done["status"] == "failed" and done["error"]["code"] == "INTERNAL_ERROR"
    # the project falls back to its previous state (never rendered => draft), it is NOT marked failed
    assert (await client.get(f"/api/projects/{pid}")).json()["status"] == "draft"


async def test_projects_created_before_the_editor_get_stable_ids(client, db, media_dir):
    """Old timelines have no segment ids. They must be assigned once and persisted, not invented per request."""
    pid, tl = await seeded(client, db, media_dir)
    doc = await db.projects.find_one({"_id": ObjectId(pid)})
    old = doc["timeline"]
    for s in old["segments"]:
        s.pop("id", None)
    await db.projects.update_one({"_id": doc["_id"]}, {"$set": {"timeline": old, "timelineHistory": None}})

    a = (await client.get(f"/api/projects/{pid}/timeline")).json()
    b = (await client.get(f"/api/projects/{pid}/timeline")).json()
    ids_a = [s["id"] for s in a["timeline"]["segments"]]
    assert all(ids_a) and ids_a == [s["id"] for s in b["timeline"]["segments"]]  # stable across requests
    r = await ops(client, pid, {"type": "set_speed", "segmentId": ids_a[0], "speed": 0.5})
    assert r.status_code == 200 and r.json()["timeline"]["segments"][0]["id"] == ids_a[0]
    assert (await client.post(f"/api/projects/{pid}/timeline/undo")).json()["timeline"]["segments"][0]["id"] == ids_a[0]


async def test_old_timelines_come_back_with_every_field_the_ui_needs(client, db, media_dir):
    """A timeline saved before captions/music/crop existed must not crash the editor."""
    pid, _ = await seeded(client, db, media_dir)
    doc = await db.projects.find_one({"_id": ObjectId(pid)})
    old = doc["timeline"]
    for key in ("captions", "captionStyle", "musicVolume", "musicFadeIn", "musicFadeOut"):
        old.pop(key, None)
    for s in old["segments"]:
        for key in ("crop", "volume", "focusSource", "id"):
            s.pop(key, None)
    await db.projects.update_one({"_id": doc["_id"]}, {"$set": {"timeline": old, "timelineHistory": None}})
    tl = (await client.get(f"/api/projects/{pid}/timeline")).json()["timeline"]
    assert tl["captions"] == [] and tl["captionStyle"] == "minimal" and tl["musicVolume"] == 1.0
    assert all(s["crop"]["framing"] == "auto" and s["id"] and "volume" in s for s in tl["segments"])
