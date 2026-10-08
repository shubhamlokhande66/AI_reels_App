"""Accounts (production): sign up / in / out, private API needs a session, and users never see each other's data."""

from __future__ import annotations

from pydantic import SecretStr

from app.core.config import get_settings


async def _post(client, url, body):
    """POST, then keep the session cookie (the test client does not keep cookies for the dotless host 'test')."""
    from app.core.auth import COOKIE

    r = await client.post(url, json=body)
    if COOKIE in r.cookies:  # the same session token the browser keeps in its cookie, sent as a bearer token
        client.headers["Authorization"] = f"Bearer {r.cookies[COOKIE]}"
    return r


def _accounts_on(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "auth_enabled", True)
    monkeypatch.setattr(s, "secret_key", SecretStr("test-secret-key-0123456789"))


async def test_accounts_off_means_open_as_before(client):
    assert (await client.get("/api/auth/me")).json() == {"authEnabled": False, "user": None}
    assert (await client.get("/api/projects")).status_code == 200


async def test_sign_up_sign_in_and_private_api(client, monkeypatch):
    _accounts_on(monkeypatch)
    r = await client.get("/api/projects")
    assert r.status_code == 401 and r.json()["error"]["code"] == "AUTH_REQUIRED"
    assert (await client.get("/api/health")).status_code == 200  # public
    bad = await client.post("/api/auth/register", json={"email": "a@x.com", "password": "short"})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "WEAK_PASSWORD"
    r = await _post(client, "/api/auth/register", {"email": "A@x.com", "password": "correct horse"})
    assert r.status_code == 201 and r.json()["user"]["email"] == "a@x.com"
    assert (await client.get("/api/auth/me")).json()["user"]["email"] == "a@x.com"  # the cookie is the session
    assert (await client.get("/api/projects")).status_code == 200
    assert (await client.post("/api/auth/register", json={"email": "a@x.com", "password": "another one"})).status_code == 409
    await client.post("/api/auth/logout")
    client.headers.pop("Authorization", None)
    assert (await client.get("/api/projects")).status_code == 401
    wrong = await client.post("/api/auth/login", json={"email": "a@x.com", "password": "nope nope"})
    assert wrong.status_code == 401 and wrong.json()["error"]["code"] == "BAD_CREDENTIALS"
    assert (await _post(client, "/api/auth/login", {"email": "a@x.com", "password": "correct horse"})).status_code == 200
    assert (await client.get("/api/projects")).status_code == 200


async def test_users_never_see_each_others_projects(client, monkeypatch):
    _accounts_on(monkeypatch)
    await _post(client, "/api/auth/register", {"email": "ann@x.com", "password": "password-ann"})
    pid = (await client.post("/api/projects", json={"name": "Ann's Reel", "settings": {}})).json()["id"]
    assert [p["name"] for p in (await client.get("/api/projects")).json()] == ["Ann's Reel"]
    client.headers.pop("Authorization", None)
    await _post(client, "/api/auth/register", {"email": "bob@x.com", "password": "password-bob"})
    assert (await client.get("/api/projects")).json() == []  # Bob's own (empty) studio
    r = await client.get(f"/api/projects/{pid}")
    assert r.status_code == 404  # Ann's project does not exist for Bob
    client.headers.pop("Authorization", None)
    await _post(client, "/api/auth/login", {"email": "ann@x.com", "password": "password-ann"})
    assert (await client.get(f"/api/projects/{pid}")).status_code == 200


async def test_a_users_job_runs_and_reports_in_their_own_studio(client, monkeypatch, media_dir):
    """Jobs run on worker threads: their progress and results must land in the owner's database."""
    from tests.test_jobs_api import wait_job

    _accounts_on(monkeypatch)
    await _post(client, "/api/auth/register", {"email": "cat@x.com", "password": "password-cat"})
    pid = (await client.post("/api/projects", json={"name": "Cat", "settings": {"duration": 6}})).json()["id"]
    files = [("files", ("clip_a.mp4", (media_dir / "clip_a.mp4").read_bytes(), "video/mp4"))]
    assert (await client.post(f"/api/projects/{pid}/videos", files=files)).status_code == 201
    job = (await client.post(f"/api/projects/{pid}/analyze")).json()
    done, seen = await wait_job(client, pid, job["id"])
    assert done["status"] == "completed", done["error"]
    assert any(p > 0 for _, p in seen)  # progress was visible while it ran
    assert (await client.get(f"/api/projects/{pid}")).json()["videos"][0]["analysis"]["usable"] is True
