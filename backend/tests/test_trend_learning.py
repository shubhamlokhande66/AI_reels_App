"""Learning from many trending Reels: grouping into styles, freshness, applying a style to a song, choosing one."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

from app.styles import get_style
from app.trends.learn import apply_trend, best_match, group_videos, name_for, recency_weight
from app.trends.reference import for_ai, merge_profiles


def _reel(shot: float, beat: float, bright: float, sat: float, hook: float | None = None, days_old: float = 0, bpm: float = 120) -> dict:
    added = (datetime.now(timezone.utc) - timedelta(days=days_old)).isoformat()
    return {"seconds": 15.0, "shots": int(15 / shot), "avg_shot": shot, "median_shot": shot, "shortest_shot": shot * 0.5,
            "longest_shot": shot * 2, "hook_seconds": hook or shot, "cuts_per_10s": round(10 / shot, 1), "on_beat_share": beat,
            "loud_avg_shot": shot * 0.8, "calm_avg_shot": shot * 1.3, "bpm": bpm, "energy_curve": "steady",
            "look": {"brightness": bright, "saturation": sat}, "added_at": added, "name": "r"}  # fmt: skip


def test_fifty_reels_of_three_styles_are_sorted_into_three_groups():
    rng = np.random.default_rng(1)
    fast = [_reel(0.5 + rng.normal(0, 0.05), 0.85, 0.6, 0.6, hook=0.4) for _ in range(20)]
    calm = [_reel(3.2 + rng.normal(0, 0.3), 0.3, 0.4, 0.3) for _ in range(18)]
    mid = [_reel(1.6 + rng.normal(0, 0.1), 0.6, 0.3, 0.2) for _ in range(12)]
    videos = fast + calm + mid
    groups = group_videos(videos)
    assert len(groups) == 3 and sorted(len(g) for g in groups) == [12, 18, 20]
    for g in groups:  # each group holds one kind only
        kinds = {0 if i < 20 else 1 if i < 38 else 2 for i in g}
        assert len(kinds) == 1
    names = {name_for(merge_profiles([videos[i] for i in g])) for g in groups}
    assert any(n.startswith("Very fast") and "beat-synced" in n for n in names) and any(n.startswith("Slow cinematic") for n in names)


def test_one_style_stays_one_group():
    rng = np.random.default_rng(2)
    videos = [_reel(1.0 + rng.normal(0, 0.05), 0.7, 0.5, 0.4) for _ in range(30)]
    assert len(group_videos(videos)) == 1
    assert group_videos(videos[:3]) == [[0, 1, 2]]


def test_newer_reels_count_more():
    assert recency_weight(datetime.now(timezone.utc).isoformat()) > 0.99
    assert abs(recency_weight((datetime.now(timezone.utc) - timedelta(days=45)).isoformat()) - 0.5) < 0.01
    old, new = _reel(3.0, 0.3, 0.5, 0.4, days_old=180), _reel(1.0, 0.8, 0.5, 0.4)
    assert merge_profiles([old, new])["avg_shot"] < 1.3  # the fresh trend wins


def test_a_trend_becomes_this_songs_cutting_rules():
    trend = for_ai({"name": "Fast food", "profile": merge_profiles([_reel(0.5, 0.9, 0.62, 0.62, hook=0.4)])})
    style, note = apply_trend(get_style("cinematic"), trend, bpm=120)  # 0.5 s per beat
    assert style.cut_beats_high == 1 and style.cut_beats_low == 1  # 0.4 / 0.65 s shots at 120 BPM = about one beat each
    assert style.min_segment <= 0.3 and style.accent_hits and style.hook_priority >= 0.6
    assert "saturation=" in (style.grade_filter or "") and "Fast food" in note
    slow, _ = apply_trend(get_style("fast_trending"), for_ai({"name": "Slow", "profile": merge_profiles([_reel(3.0, 0.3, 0.4, 0.3)])}), bpm=90)
    assert slow.cut_beats_low >= 5 and slow.max_segment >= 5  # long calm shots at a slower song


def test_auto_picks_a_style_only_when_it_fits():
    food = for_ai({"name": "Food fast", "notes": "recipes and street food", "profile": merge_profiles([_reel(0.5, 0.9, 0.6, 0.6, bpm=128)] * 6)})
    wedding = for_ai({"name": "Wedding cinematic", "profile": merge_profiles([_reel(3.0, 0.4, 0.5, 0.4, bpm=80)] * 6)})
    assert best_match([food, wedding], "street food recipe", 126, 20)["name"] == "Food fast"
    assert best_match([food, wedding], "our wedding day", 82, 30)["name"] == "Wedding cinematic"
    assert best_match([food, wedding], "", 82, 30)["name"] == "Wedding cinematic"  # the tempo alone fits
    assert best_match([food], "", 95, 60) is None  # nothing fits (tempo and length far off, no shared words): edit normally


async def test_bulk_learning_and_auto_styles_api(client, tmp_path, media_dir, monkeypatch):
    from app.trends import reference

    rng = np.random.default_rng(3)
    shots = iter([0.5] * 6 + [3.0] * 6)

    def fake_profile(path, name=""):
        s = next(shots, 1.0) + rng.normal(0, 0.03)
        return {**_reel(s, 0.9 if s < 1 else 0.3, 0.6 if s < 1 else 0.35, 0.6 if s < 1 else 0.25), "name": name}

    monkeypatch.setattr("app.api.references.profile_video", fake_profile)
    clip = (media_dir / "clip_a.mp4").read_bytes()
    for _ in range(4):  # 12 Reels, 3 at a time
        r = await client.post("/api/trend-library/learn", files=[("files", (f"r{i}.mp4", clip, "video/mp4")) for i in range(3)])
        assert r.status_code == 200, r.text
    bad = await client.post("/api/trend-library/learn", files=[("files", ("x.txt", b"no", "text/plain")), ("files", ("ok.mp4", clip, "video/mp4"))])
    assert bad.status_code == 200 and len(bad.json()["failed"]) == 1 and len(bad.json()["learned"]) == 1  # one bad file, the other learned
    assert (await client.get("/api/trend-library")).json()["count"] == 13
    styles = (await client.post("/api/trend-library/group")).json()
    assert len(styles) == 2 and all(s["auto"] for s in styles) and sorted(s["profile"]["videos"] for s in styles) in ([6, 7], [6, 6])
    trends = (await client.get("/api/references")).json()
    assert {t["name"] for t in trends} == {s["name"] for s in styles}
    assert (await client.delete("/api/trend-library")).status_code == 204
    assert (await client.get("/api/references")).json() == [] and (await client.get("/api/trend-library")).json()["count"] == 0
    assert reference  # the module is the one the API measures with


async def _reel_with_trend(client, db, media_dir, trend_profile: dict, name: str) -> list[float]:
    """Make a Reel from the same clips and song with a learned style chosen; return its shot lengths."""
    from bson import ObjectId

    from tests.test_jobs_api import wait_job

    tid = ObjectId()
    await db.references.insert_one({"_id": tid, "name": name, "notes": "", "videos": [], "profile": trend_profile, "createdAt": None, "updatedAt": None})
    pid = (await client.post("/api/projects", json={"name": name, "settings": {"duration": 12, "reference": str(tid), "ai": False}})).json()["id"]
    files = [("files", (n, (media_dir / n).read_bytes(), "video/mp4")) for n in ("clip_a.mp4", "clip_b.mp4", "clip_c.mp4", "clip_d.mp4")]
    await client.post(f"/api/projects/{pid}/videos", files=files)
    await client.post(f"/api/projects/{pid}/audio", files={"file": ("beat120.mp3", (media_dir / "beat120.mp3").read_bytes(), "audio/mpeg")})
    job = (await client.post(f"/api/projects/{pid}/generate", json={"quality": "preview"})).json()
    done, _ = await wait_job(client, pid, job["id"], timeout=600)
    assert done["status"] == "completed", done["error"]
    tl = (await client.get(f"/api/projects/{pid}/timeline")).json()
    segs = tl.get("segments") or tl.get("timeline", {}).get("segments")
    return [s["timelineEnd"] - s["timelineStart"] for s in segs]


@pytest.mark.slow
async def test_reels_really_follow_the_learned_style(client, db, media_dir):
    """The proof: the same clips and song, cut with a fast beat-synced style and a slow cinematic style, give Reels whose
    measured shot lengths match each style (the song: 120 BPM, a beat every 0.5 s)."""
    fast = merge_profiles([_reel(0.5, 0.9, 0.6, 0.6, hook=0.5)] * 5)
    slow = merge_profiles([_reel(3.0, 0.4, 0.4, 0.3)] * 5)
    fast_shots = await _reel_with_trend(client, db, media_dir, fast, "Fast beat style")
    slow_shots = await _reel_with_trend(client, db, media_dir, slow, "Slow cinematic style")
    f, s = float(np.median(fast_shots)), float(np.median(slow_shots))
    assert 0.3 <= f <= 1.1, fast_shots  # about one beat (0.5 s), some two
    assert s >= 2.0, slow_shots  # several beats per shot
    assert len(fast_shots) >= 2.5 * len(slow_shots)
    beat = 0.5
    starts = np.cumsum([0.0, *fast_shots[:-1]])
    on_beat = np.mean([min(t % beat, beat - t % beat) <= 0.06 for t in starts[1:]])
    assert on_beat >= 0.8, starts  # the fast style cuts on the beat


def _make_reference_reel(path, shots: list[float], media_dir) -> list[float]:
    """A test "Reel": solid colours that change at known times, over the 120 BPM click track. Returns its cut times."""
    import subprocess

    from app.core.ffmpeg import find_binary

    colours = ["red", "blue", "green", "yellow", "purple", "orange", "white", "cyan"]
    args = [find_binary("ffmpeg"), "-hide_banner", "-loglevel", "error", "-y"]
    for i, s in enumerate(shots):
        args += ["-f", "lavfi", "-t", f"{s}", "-i", f"color=c={colours[i % len(colours)]}:s=360x640:r=30"]
    args += ["-i", str(media_dir / "beat120.wav")]
    n = len(shots)
    args += ["-filter_complex", "".join(f"[{i}:v]" for i in range(n)) + f"concat=n={n}:v=1:a=0[v]", "-map", "[v]", "-map", f"{n}:a",
             "-shortest", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", str(path)]  # fmt: skip
    subprocess.run(args, check=True)
    return list(np.cumsum(shots)[:-1])


@pytest.mark.slow
async def test_make_it_like_this_reel_copies_the_cut_timing(client, media_dir, tmp_path):
    from tests.test_jobs_api import wait_job

    shots = [1.0, 0.5, 0.5, 2.0, 1.0, 1.5, 0.5, 0.5, 2.5, 2.0]  # 12 s, every cut on the 0.5 s beat grid
    ref = tmp_path / "ref.mp4"
    ref_cuts = _make_reference_reel(ref, shots, media_dir)
    pid = (await client.post("/api/projects", json={"name": "Like this", "settings": {"duration": 12, "ai": False}})).json()["id"]
    files = [("files", (n, (media_dir / n).read_bytes(), "video/mp4")) for n in ("clip_a.mp4", "clip_b.mp4", "clip_c.mp4", "clip_d.mp4")]
    await client.post(f"/api/projects/{pid}/videos", files=files)
    await client.post(f"/api/projects/{pid}/audio", files={"file": ("beat120.mp3", (media_dir / "beat120.mp3").read_bytes(), "audio/mpeg")})
    r = await client.post(f"/api/projects/{pid}/reference-reel", files={"file": ("ref.mp4", ref.read_bytes(), "video/mp4")})
    assert r.status_code == 200, r.text
    info = r.json()
    assert info["shots"] == len(shots) and abs(info["hookSeconds"] - 1.0) < 0.1
    job = (await client.post(f"/api/projects/{pid}/generate", json={"quality": "preview"})).json()
    done, _ = await wait_job(client, pid, job["id"], timeout=600)
    assert done["status"] == "completed", done["error"]
    tl = (await client.get(f"/api/projects/{pid}/timeline")).json()
    segs = tl.get("segments") or tl.get("timeline", {}).get("segments")
    cuts = [s["timelineStart"] for s in segs[1:]]
    scale = tl.get("duration", 12) / 12.0
    expected = [c * scale for c in ref_cuts]
    assert len(cuts) == len(expected), (cuts, expected)
    assert all(abs(a - b) <= 0.26 for a, b in zip(cuts, expected)), (cuts, expected)  # the reference's timing, on this song's beats
    assert (await client.get(f"/api/projects/{pid}/reference-reel")).json()["shots"] == len(shots)
    assert (await client.delete(f"/api/projects/{pid}/reference-reel")).status_code == 204


async def test_one_learned_reel_is_already_a_style(client, media_dir, monkeypatch):
    monkeypatch.setattr("app.api.references.profile_video", lambda path, name="": {**_reel(0.6, 0.85, 0.6, 0.55, hook=0.5), "name": name})
    clip = (media_dir / "clip_a.mp4").read_bytes()
    r = await client.post("/api/trend-library/learn", files=[("files", ("my_trend.mp4", clip, "video/mp4"))])
    assert r.json()["learned"] == ["my_trend.mp4"]
    styles = (await client.post("/api/trend-library/group")).json()
    assert len(styles) == 1 and styles[0]["profile"]["videos"] == 1 and styles[0]["auto"]
    await client.delete("/api/trend-library")
    empty = await client.post("/api/trend-library/group")
    assert empty.status_code == 422 and empty.json()["error"]["code"] == "NO_REELS"


def test_a_field_called_title_stays_in_the_ai_schema():
    """The AI's answer schema drops decorative labels ("title" keywords), never a real field named "title"."""
    from app.ai.schemas import CopyAnswer
    from app.ai.structured import json_schema

    s = json_schema(CopyAnswer)
    assert set(s["properties"]) == {"title", "description", "hashtags"} and set(s["required"]) <= set(s["properties"])
    assert "title" not in s and all("title" not in v for v in s["properties"].values())


def test_reference_timing_keeps_its_real_speed():
    from app.video.timeline import reference_cuts

    long_ref = [14.77, 16.57, 30.37, 35.77, 36.62, 37.12, 41.12, 44.42, 47.52, 49.22, 50.42]  # 64 s, slow shots
    cuts = reference_cuts(long_ref, 63.6, 15)
    shots = [b - a for a, b in zip([0, *cuts], [*cuts, 15])]
    assert len(shots) >= 3 and max(shots) <= 6  # a typical stretch at real speed, not the 15 s intro, not squeezed
    assert reference_cuts([1.0, 1.5, 3.0], 6.0, 15)[:4] == [1.0, 1.5, 3.0, 6.0]  # a short reference repeats its pattern
