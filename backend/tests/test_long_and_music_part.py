"""Custom lengths (up to 10 minutes) and choosing which part of the song the Reel uses."""

from __future__ import annotations

import pytest

from tests.test_editor_api import seeded
from tests.test_jobs_api import make_project, wait_job


async def test_lengths_up_to_ten_minutes_are_accepted_and_beyond_are_not(client):
    for ok in (5, 120, 300, 600):
        r = await client.post("/api/projects", json={"name": f"{ok}s", "settings": {"duration": ok}})
        assert r.status_code == 201 and r.json()["settings"]["duration"] == ok, ok
    for bad in (4, 601, 3600):
        assert (await client.post("/api/projects", json={"name": "x", "settings": {"duration": bad}})).status_code == 422, bad
    pid = (await client.post("/api/projects", json={"name": "p"})).json()["id"]
    assert (await client.patch(f"/api/projects/{pid}", json={"duration": 180})).json()["settings"]["duration"] == 180
    assert (await client.patch(f"/api/projects/{pid}", json={"duration": 601})).status_code == 422


async def test_the_chosen_start_of_the_song_is_stored_and_validated(client):
    r = await client.post("/api/projects", json={"name": "x", "settings": {"audioStart": 42.5}})
    assert r.json()["settings"]["audioStart"] == 42.5
    assert (await client.post("/api/projects", json={"name": "x"})).json()["settings"]["audioStart"] is None  # automatic by default
    assert (await client.post("/api/projects", json={"name": "x", "settings": {"audioStart": -1}})).status_code == 422
    pid = r.json()["id"]
    assert (await client.patch(f"/api/projects/{pid}", json={"audioStart": 10})).json()["settings"]["audioStart"] == 10


async def test_editor_accepts_five_minute_lengths(client, db, media_dir):
    pid, tl = await seeded(client, db, media_dir)
    ok = await client.post(f"/api/projects/{pid}/timeline/ops", json={"ops": [{"type": "fit_duration", "target": 12}]})
    assert ok.status_code == 200
    too_big = await client.post(f"/api/projects/{pid}/timeline/ops", json={"ops": [{"type": "fit_duration", "target": 601}]})
    assert too_big.status_code == 422


@pytest.mark.slow
async def test_reel_uses_exactly_the_part_of_the_song_the_user_chose(client, media_dir):
    """The song in the fixtures is 30 s long. Ask for 8 s starting at 14 s: the Reel must start there, and stay there."""
    pid = await make_project(client, media_dir, videos=["clip_a.mp4", "clip_d.mp4"], duration=8, audioStart=14)
    first = await client.post(f"/api/projects/{pid}/generate")
    assert (await wait_job(client, pid, first.json()["id"]))[0]["status"] == "completed"
    tl = (await client.get(f"/api/projects/{pid}/timeline")).json()["timeline"]
    assert tl["audioStart"] == 14.0 and tl["duration"] == 8

    # ask for another part in the same request, without changing the project first
    second = await client.post(f"/api/projects/{pid}/generate", json={"audioStart": 3, "seed": 5})
    assert (await wait_job(client, pid, second.json()["id"]))[0]["status"] == "completed"
    assert (await client.get(f"/api/projects/{pid}/timeline")).json()["timeline"]["audioStart"] == 3.0
    assert (await client.get(f"/api/projects/{pid}")).json()["settings"]["audioStart"] == 3  # remembered for the next regenerate

    # "let the app choose" forgets the choice
    third = await client.post(f"/api/projects/{pid}/generate", json={"audioAuto": True, "seed": 6})
    assert (await wait_job(client, pid, third.json()["id"]))[0]["status"] == "completed"
    assert (await client.get(f"/api/projects/{pid}")).json()["settings"]["audioStart"] is None
