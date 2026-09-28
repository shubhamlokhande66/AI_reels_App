"""Song library: upload once and reuse; watched folders."""

from __future__ import annotations

import shutil

from tests.test_jobs_api import make_project


async def songs(client, q=""):
    return (await client.get("/api/songs", params={"q": q})).json()


async def test_a_song_uploaded_to_a_reel_joins_the_library_once(client, media_dir):
    await make_project(client, media_dir, videos=["clip_a.mp4"])  # uploads beat120.mp3
    await make_project(client, media_dir, videos=["clip_a.mp4"])  # the same song again
    lib = await songs(client)
    assert [s["name"] for s in lib["songs"]] == ["beat120"] and lib["songs"][0]["useCount"] == 2 and lib["songs"][0]["duration"] > 20
    r = await client.get(lib["songs"][0]["url"])
    assert r.status_code == 200 and r.headers["content-type"].startswith("audio/") and len(r.content) > 10_000


async def test_upload_search_and_delete(client, media_dir, tmp_path):
    wav = tmp_path / "Dhol Tasha Mix.wav"
    shutil.copy(media_dir / "beat120.wav", wav)
    r = await client.post("/api/songs", files=[("files", (wav.name, wav.read_bytes(), "audio/wav")),
                                               ("files", ("notes.txt", b"not audio", "text/plain"))])  # fmt: skip
    j = r.json()
    assert r.status_code == 201 and [s["name"] for s in j["uploaded"]] == ["Dhol Tasha Mix"] and j["failed"][0]["name"] == "notes.txt"
    assert [s["name"] for s in (await songs(client, "dhol"))["songs"]] == ["Dhol Tasha Mix"]
    assert (await songs(client, "nothing like this"))["songs"] == []
    sid = j["uploaded"][0]["id"]
    assert (await client.delete(f"/api/songs/{sid}")).status_code == 204
    assert (await songs(client))["songs"] == []


async def test_songs_in_a_watched_folder_are_imported_and_a_deleted_one_stays_deleted(client, media_dir, tmp_path, monkeypatch):
    from app.core.config import get_settings
    from app.services import songs as lib

    folder = tmp_path / "Downloads"
    (folder / "sub").mkdir(parents=True)
    shutil.copy(media_dir / "beat120.mp3", folder / "Ganpati Bappa.mp3")
    shutil.copy(media_dir / "beat120.wav", folder / "sub" / "Aarti.wav")
    (folder / "readme.txt").write_text("not a song")
    monkeypatch.setenv("SONG_IMPORT_FOLDERS", str(folder))
    get_settings.cache_clear()
    lib._last_scan = 0.0
    lst = await songs(client)
    assert sorted(s["name"] for s in lst["songs"]) == ["Aarti", "Ganpati Bappa"] and all(s["source"] == "folder" for s in lst["songs"])
    assert lst["folders"] == [str(folder)]
    gone = next(s for s in lst["songs"] if s["name"] == "Aarti")
    await client.delete(f"/api/songs/{gone['id']}")
    assert (await client.post("/api/songs/import")).json()["added"] == 0  # not imported again
    assert [s["name"] for s in (await songs(client))["songs"]] == ["Ganpati Bappa"]
