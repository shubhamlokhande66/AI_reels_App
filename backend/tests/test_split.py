"""One long video -> several Reels from its best parts (saved as versions)."""

from __future__ import annotations

import subprocess

import pytest

from app.core.ffmpeg import find_binary
from app.jobs.pipeline import pick_ranges
from app.models.analysis import Moment
from tests.test_timeline import make_clip


def test_ranges_are_the_best_non_overlapping_parts_in_order():
    clip = make_clip("long", dur=120.0)
    clip.analysis.moments = [Moment(t=t, kind="action_peak", score=0.9) for t in (20, 22, 24, 80, 82, 84, 86)]
    ranges = pick_ranges(clip.analysis, None, 15.0, 2)
    assert len(ranges) == 2 and ranges == sorted(ranges)
    (a1, b1, _), (a2, b2, _) = ranges
    assert b1 <= a2  # no overlap
    assert a1 <= 20 <= b1 and a2 <= 80 <= b2  # the parts with the moments
    assert pick_ranges(make_clip("short", dur=10.0).analysis, None, 15.0, 2) == []  # not enough footage anywhere


@pytest.mark.slow
async def test_split_a_long_video_into_versions(client, media_dir, tmp_path):
    from tests.test_jobs_api import wait_job

    long = tmp_path / "long.mp4"
    subprocess.run([find_binary("ffmpeg"), "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                    "testsrc2=size=640x360:rate=30:duration=60", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", str(long)],
                   check=True)  # fmt: skip
    pid = (await client.post("/api/projects", json={"name": "Talk", "settings": {"duration": 15}})).json()["id"]
    assert (await client.post(f"/api/projects/{pid}/videos", files=[("files", ("long.mp4", long.read_bytes(), "video/mp4"))])).status_code == 201
    r = await client.post(f"/api/projects/{pid}/audio", files={"file": ("beat120.mp3", (media_dir / "beat120.mp3").read_bytes(), "audio/mpeg")})
    assert r.status_code == 201
    job = (await client.post(f"/api/projects/{pid}/split", json={"count": 2, "seconds": 12})).json()
    assert job["type"] == "split"
    done, _ = await wait_job(client, pid, job["id"], timeout=900)
    assert done["status"] == "completed", done["error"]
    versions = (await client.get(f"/api/projects/{pid}/renderings")).json()
    assert sorted(v["label"][:6] for v in versions) == ["Part 1", "Part 2"]
    assert all(v["duration"] == pytest.approx(12, abs=0.6) for v in versions)
