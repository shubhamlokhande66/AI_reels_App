"""The same video uploaded twice (a WhatsApp "(1)" copy, a trimmed re-export) is found and used only once."""

from __future__ import annotations

import shutil
import subprocess

from app.core.ffmpeg import find_binary
from app.video.duplicates import find_duplicates, thumbnails


def test_copies_and_trimmed_copies_are_found_but_different_videos_are_not(media_dir, tmp_path):
    a = media_dir / "clip_a.mp4"
    copy = tmp_path / "clip_a (1).mp4"
    shutil.copy(a, copy)
    trimmed = tmp_path / "clip_a trimmed.mp4"  # re-encoded, starting 2 s in: still the same footage
    subprocess.run([find_binary("ffmpeg"), "-v", "error", "-y", "-ss", "2", "-i", str(a), "-t", "3", "-c:v", "libx264", "-crf", "28",
                    "-pix_fmt", "yuv420p", str(trimmed)], check=True)  # fmt: skip
    clips = [("a", thumbnails(a, 7.0)), ("copy", thumbnails(copy, 7.0)), ("b", thumbnails(media_dir / "clip_b.mp4", 7.0)),
             ("trim", thumbnails(trimmed, 3.0)), ("d", thumbnails(media_dir / "clip_d.mp4", 7.0))]  # fmt: skip
    found = {d.clip_id: d for d in find_duplicates(clips)}
    assert set(found) == {"copy", "trim"}  # clip_b / clip_d are different videos (clip_b is even a similar test pattern)
    assert found["copy"].same_as == "a" and found["copy"].offset == 0.0
    assert found["trim"].same_as in ("a", "copy") and abs(found["trim"].offset - 2.0) <= 0.3


async def test_a_duplicate_upload_is_used_only_once(client, media_dir, tmp_path):
    from tests.test_jobs_api import make_project, wait_job

    pid = await make_project(client, media_dir, videos=["clip_a.mp4", "clip_b.mp4"], duration=6)
    copy = (media_dir / "clip_a.mp4").read_bytes()
    r = await client.post(f"/api/projects/{pid}/videos", files=[("files", ("clip_a (1).mp4", copy, "video/mp4"))])
    assert r.status_code == 201, r.text
    job = (await client.post(f"/api/projects/{pid}/analyze")).json()
    done, _ = await wait_job(client, pid, job["id"])
    assert done["status"] == "completed", done["error"]
    from app.jobs import pipeline as pl
    from app.storage import get_storage

    proj = (await client.get(f"/api/projects/{pid}")).json()
    videos = [pl.MediaRef(v["id"], v["name"], f"projects/{pid}/input/{v['id']}{'.mp4'}") for v in proj["videos"]]
    stored = {p.name: p for p in (get_storage().local_path(f"projects/{pid}/input")).iterdir()}
    for v in videos:  # the real stored file names
        v.key = f"projects/{pid}/input/" + next(n for n in stored if v.id in n)
    inp = pl.PipelineInput(project_id=pid, job_type="generate", videos=videos, audio=None, settings=None)  # type: ignore[arg-type]
    warnings: list[str] = []
    kept = pl.drop_duplicate_videos(inp, get_storage(), warnings)
    assert [v.name for v in kept.videos] == ["clip_a.mp4", "clip_b.mp4"]
    assert warnings == ["'clip_a (1).mp4' is the same video as 'clip_a.mp4', so it was used only once."]


def test_a_landscape_and_a_portrait_clip_are_never_called_copies(media_dir):
    # the same synthetic test pattern in two shapes: real footage in different shapes is different footage
    clips = [("wide", thumbnails(media_dir / "clip_a.mp4", 7.0)), ("tall", thumbnails(media_dir / "clip_portrait.mp4", 7.0))]
    assert find_duplicates(clips) == []
