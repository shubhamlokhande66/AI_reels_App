"""Learned trends: measuring reference Reels and handing their style to the AI director."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.ai.reel_director import build_request
from app.director.music_map import build_music_map
from app.trends.reference import detect_cuts, for_ai, measure, merge_profiles, profile_video
from tests.conftest import _ffmpeg
from tests.test_timeline import make_audio, make_clip

CUTS = [1.0, 2.5, 3.0, 5.0]  # all on the 120 BPM beat grid (every 0.5 s)


@pytest.fixture(scope="module")
def reference(media_dir, tmp_path_factory) -> Path:
    """A 6 s 'trending Reel': hard cuts between very different pictures at CUTS, over a 120 BPM click track."""
    out = tmp_path_factory.mktemp("ref") / "trend.mp4"
    bounds = [0.0, *CUTS, 6.0]
    colours = ["red", "blue", "green", "white", "black"]
    args, labels = [], ""
    for i, (a, b) in enumerate(zip(bounds, bounds[1:])):
        args += ["-f", "lavfi", "-i", f"color=c={colours[i]}:s=360x640:r=30:d={b - a}"]
        labels += f"[{i}:v]"
    _ffmpeg(*args, "-i", str(media_dir / "beat120.wav"), "-filter_complex", f"{labels}concat=n={len(bounds) - 1}:v=1:a=0[v]",
            "-map", "[v]", "-map", f"{len(bounds) - 1}:a", "-t", "6", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
            "-c:a", "aac", str(out))  # fmt: skip
    return out


def test_cuts_are_found_frame_accurately(reference):
    cuts = detect_cuts(reference, 6.0)
    assert len(cuts) == len(CUTS)
    assert all(abs(a - b) <= 0.05 for a, b in zip(cuts, CUTS))


def test_a_reference_reel_is_measured(reference):
    p = profile_video(reference, "trend.mp4")
    assert p["shots"] == 5 and p["hook_seconds"] == pytest.approx(1.0, abs=0.05)
    assert p["avg_shot"] == pytest.approx(1.2, abs=0.05) and p["pace"] in ("fast", "balanced")
    assert p["has_music"] and p["bpm"] == pytest.approx(120, abs=3)
    assert p["on_beat_share"] >= 0.75  # its cuts land on the music
    assert 0 <= p["look"]["brightness"] <= 1 and p["described"] is None  # no vision AI in tests: numbers only


def test_loud_and_calm_shot_lengths_are_measured_separately():
    audio = make_audio(duration=20, loud_from=10.0)
    p = measure([3.0, 6.0, 9.0, 10.5, 11.5, 12.5, 13.5], 14.0, audio)
    assert p["calm_avg_shot"] > p["loud_avg_shot"]  # this Reel cuts faster when the music is loud


def test_several_videos_make_one_trend():
    a = {"seconds": 10, "avg_shot": 1.0, "shortest_shot": 0.5, "longest_shot": 2, "hook_seconds": 0.8, "look": {"brightness": 0.4, "saturation": 0.6},
         "described": {"summary": "fast zooms"}}
    b = {"seconds": 30, "avg_shot": 2.0, "shortest_shot": 0.8, "longest_shot": 4, "hook_seconds": 1.2, "look": {"brightness": 0.6, "saturation": 0.2}}
    m = merge_profiles([a, b])
    assert m["videos"] == 2 and m["avg_shot"] == pytest.approx(1.75)  # weighted by length
    assert m["shortest_shot"] == 0.5 and m["longest_shot"] == 4 and m["described"] == [{"summary": "fast zooms"}]


def test_the_ai_director_gets_the_chosen_trend():
    audio = make_audio(duration=20)
    clips = [make_clip(f"id{i}") for i in range(3)]
    mm = build_music_map(audio, 0.0, 12.0)
    trend = for_ai({"name": "Luxury Oct", "profile": {"pace": "calm", "avg_shot": 3.1, "hook_seconds": 1.4, "on_beat_share": 0.9}})
    ask = dict(brief="", language="en", style_hint=None, captions=False, cta="", hook="", pace="auto")
    facts, _ = build_request(clips, audio, mm, 0.0, 12.0, {"luxury": "x"}, references=[{**trend, "chosen": True}], **ask)
    assert facts["reel"]["reference"] == "Luxury Oct"
    assert facts["reference_edits"] == [trend] and "chosen" not in facts["reference_edits"][0]
    auto, _ = build_request(clips, audio, mm, 0.0, 12.0, {"luxury": "x"}, references=[trend], **ask)
    assert auto["reel"]["reference"] == "auto"
    none, _ = build_request(clips, audio, mm, 0.0, 12.0, {"luxury": "x"}, **ask)
    assert none["reel"]["reference"] == "none" and "reference_edits" not in none


async def test_trends_api_learns_lists_renames_and_deletes(client, reference, media_dir):
    with reference.open("rb") as f:
        r = await client.post("/api/references", data={"name": "Luxury Oct", "notes": "slow zooms"}, files=[("files", ("trend.mp4", f, "video/mp4"))])
    assert r.status_code == 201, r.text
    t = r.json()
    assert t["name"] == "Luxury Oct" and t["profile"]["videos"] == 1 and t["videos"][0]["shots"] == 5 and "avgShot" in t["profile"]
    with reference.open("rb") as f:
        r = await client.post(f"/api/references/{t['id']}/videos", files=[("files", ("again.mp4", f, "video/mp4"))])
    assert r.json()["profile"]["videos"] == 2
    r = await client.patch(f"/api/references/{t['id']}", json={"name": "Luxury Nov"})
    assert r.json()["name"] == "Luxury Nov"
    assert [x["name"] for x in (await client.get("/api/references")).json()] == ["Luxury Nov"]
    with (media_dir / "notvideo.mp4").open("rb") as f:
        bad = await client.post("/api/references", data={"name": "x"}, files=[("files", ("notvideo.mp4", f, "video/mp4"))])
    assert bad.status_code == 422
    assert (await client.delete(f"/api/references/{t['id']}")).status_code == 204
    assert (await client.get("/api/references")).json() == []
