"""Shared analysis cache: the same clip / song is analysed once, whatever project it is used in."""

from __future__ import annotations

import pytest

from app.jobs import pipeline as pl
from app.schemas.project import ProjectSettings
from app.services import analysis_cache as shared


def _inp(storage, media_dir, pid: str, mid: str):
    key = f"projects/{pid}/input/{mid}.mp4"
    storage.write_bytes(key, (media_dir / "clip_a.mp4").read_bytes())
    akey = f"projects/{pid}/input/{mid}_song.mp3"
    storage.write_bytes(akey, (media_dir / "beat120.mp3").read_bytes())
    return pl.PipelineInput(project_id=pid, job_type="analyze", videos=[pl.MediaRef(mid, "clip_a.mp4", key)],
                            audio=pl.MediaRef(f"{mid}a", "song.mp3", akey), settings=ProjectSettings())  # fmt: skip


def test_the_same_footage_is_analysed_once_across_projects(storage, media_dir, monkeypatch):
    noop = lambda *a: None  # noqa: E731
    first = pl.analyze_videos(_inp(storage, media_dir, "p1", "m1"), storage, noop)
    song1 = pl.analyze_music(_inp(storage, media_dir, "p1", "m1"), storage, noop)

    def boom(*a, **k):
        raise AssertionError("analysed again")

    monkeypatch.setattr(pl, "analyze_clip", boom)
    monkeypatch.setattr(pl, "analyze_audio", boom)
    inp2 = _inp(storage, media_dir, "p2", "m2")  # a new project, a new media id, the same files
    second = pl.analyze_videos(inp2, storage, noop)
    song2 = pl.analyze_music(inp2, storage, noop)
    assert second["m2"].clip_id == "m2" and second["m2"].quality_score == first["m1"].quality_score
    assert len(second["m2"].windows) == len(first["m1"].windows) and song2.bpm == song1.bpm
    assert storage.exists(pl._clip_key("p2", "m2"))  # also cached inside the new project


def test_deleting_uploads_also_forgets_their_shared_analysis(storage, media_dir):
    inp = _inp(storage, media_dir, "p1", "m1")
    pl.analyze_videos(inp, storage, lambda *a: None)
    digest = shared.content_hash(storage, inp.videos[0].key)
    assert shared.load(storage, digest, "clip", pl.VIDEO_ANALYSIS_VERSION) is not None
    shared.forget(storage, inp.videos[0].key)
    assert shared.load(storage, digest, "clip", pl.VIDEO_ANALYSIS_VERSION) is None


@pytest.mark.parametrize("missing", ["projects/x/input/none.mp4"])
def test_a_missing_file_is_simply_not_cached(storage, missing):
    assert shared.content_hash(storage, missing) is None and shared.load(storage, None, "clip", 1) is None


async def test_song_parts_lists_the_automatic_choice_first_then_alternatives(client, media_dir):
    from app.models.analysis import AudioAnalysis
    from app.video.timeline import choose_music_window
    from tests.test_jobs_api import make_project

    pid = await make_project(client, media_dir, videos=[])
    r = await client.get(f"/api/projects/{pid}/song-parts", params={"duration": 8, "count": 4})
    assert r.status_code == 200, r.text
    body = r.json()
    parts = body["parts"]
    assert 2 <= len(parts) <= 4 and body["songSeconds"] > 8 and not body["tooShort"]
    for a in parts:
        assert a["end"] - a["start"] == pytest.approx(8, abs=0.01) and a["reasons"]
    for i, a in enumerate(parts):  # alternatives really differ: they overlap by less than half
        for b in parts[i + 1:]:
            assert abs(a["start"] - b["start"]) >= 4 - 1e-6
    # the first part is exactly what the editor picks when the person leaves it on automatic
    from app.storage import get_storage

    st = get_storage()
    key = next(k for k in (str(p.relative_to(st.local_path("x").parent)).replace("\\", "/")
                           for p in st.local_path(f"projects/{pid}/analysis").glob("audio_*.json")))  # fmt: skip
    audio = AudioAnalysis.model_validate_json(st.read_bytes(key))
    assert parts[0]["start"] == choose_music_window(audio, 8)[0]
    no_song = (await client.post("/api/projects", json={"name": "x", "settings": {}})).json()["id"]
    assert (await client.get(f"/api/projects/{no_song}/song-parts")).json()["error"]["code"] == "NO_AUDIO"
