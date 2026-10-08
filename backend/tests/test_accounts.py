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


async def test_pricing_is_public(client, monkeypatch):
    _accounts_on(monkeypatch)
    r = await client.get("/api/plans")
    assert r.status_code == 200
    data = r.json()
    assert [p["id"] for p in data["plans"]] == ["free", "creator", "pro", "business"]
    creator = next(p for p in data["plans"] if p["id"] == "creator")
    assert creator["yearly"] == creator["monthly"] * 10 and data["paymentsOpen"] is False


def _bearer(client, r):
    from app.core.auth import COOKIE

    client.headers["Authorization"] = f"Bearer {r.cookies[COOKIE]}"
    client.cookies.clear()  # each test step speaks with exactly the session it chose
    return client.headers["Authorization"]


async def test_forgot_and_reset_password_by_email(client, monkeypatch):
    import re as _re

    from app.core import mailer

    _accounts_on(monkeypatch)
    sent = []
    monkeypatch.setattr(mailer, "send", lambda to, subject, text: sent.append((to, text)) or True)
    old = _bearer(client, await client.post("/api/auth/register", json={"email": "ann@x.com", "password": "first-password"}))
    assert (await client.post("/api/auth/forgot", json={"email": "nobody@x.com"})).json() == {"ok": True} and not sent  # same answer, no mail
    assert (await client.post("/api/auth/forgot", json={"email": "ANN@x.com"})).json() == {"ok": True}
    token = _re.search(r"/reset\?token=([\w-]+)", sent[0][1]).group(1)
    assert sent[0][0] == "ann@x.com"
    weak = await client.post("/api/auth/reset", json={"token": token, "password": "short"})
    assert weak.json()["error"]["code"] == "WEAK_PASSWORD"
    r = await client.post("/api/auth/reset", json={"token": token, "password": "second-password"})
    assert r.status_code == 200
    new = _bearer(client, r)
    assert (await client.get("/api/projects")).status_code == 200
    client.headers["Authorization"] = old
    assert (await client.get("/api/projects")).status_code == 401  # the old session ended everywhere
    again = await client.post("/api/auth/reset", json={"token": token, "password": "third-password"})
    assert again.json()["error"]["code"] == "RESET_LINK_INVALID"  # a link works once
    client.headers.pop("Authorization")
    assert (await client.post("/api/auth/login", json={"email": "ann@x.com", "password": "second-password"})).status_code == 200
    assert new


async def test_change_password_ends_other_sessions(client, monkeypatch):
    _accounts_on(monkeypatch)
    r = await client.post("/api/auth/register", json={"email": "bob@x.com", "password": "bob-password-1"})
    phone = _bearer(client, r)
    laptop = _bearer(client, await client.post("/api/auth/login", json={"email": "bob@x.com", "password": "bob-password-1"}))
    bad = await client.post("/api/auth/password", json={"currentPassword": "wrong-one", "newPassword": "bob-password-2"})
    assert bad.json()["error"]["code"] == "BAD_CREDENTIALS"
    r = await client.post("/api/auth/password", json={"currentPassword": "bob-password-1", "newPassword": "bob-password-2"})
    assert r.status_code == 200
    _bearer(client, r)
    assert (await client.get("/api/projects")).status_code == 200  # this device stays signed in
    for other in (phone, laptop):
        client.headers["Authorization"] = other
        assert (await client.get("/api/projects")).status_code == 401


async def test_delete_account_removes_everything_and_only_theirs(client, monkeypatch, storage):
    from app.core.database import get_main_db

    _accounts_on(monkeypatch)
    _bearer(client, await client.post("/api/auth/register", json={"email": "keep@x.com", "password": "keep-password"}))
    kept = (await client.post("/api/projects", json={"name": "Keep", "settings": {}})).json()["id"]
    keep_auth = client.headers["Authorization"]
    _bearer(client, await client.post("/api/auth/register", json={"email": "gone@x.com", "password": "gone-password"}))
    pid = (await client.post("/api/projects", json={"name": "Gone", "settings": {}})).json()["id"]
    storage.write_bytes(f"projects/{pid}/output/r.mp4", b"reel")
    assert (await client.post("/api/auth/delete-account", json={"password": "gone-password", "confirm": "other@x.com"})).json()["error"]["code"] == "CONFIRMATION_MISMATCH"
    assert (await client.post("/api/auth/delete-account", json={"password": "nope-nope", "confirm": "gone@x.com"})).json()["error"]["code"] == "BAD_CREDENTIALS"
    r = await client.post("/api/auth/delete-account", json={"password": "gone-password", "confirm": "Gone@x.com"})
    assert r.status_code == 200
    db = get_main_db()
    assert await db.users.find_one({"email": "gone@x.com"}) is None
    assert await db.projects.count_documents({"name": "Gone"}) == 0 and not storage.exists(f"projects/{pid}/output/r.mp4")
    assert (await client.get("/api/projects")).status_code == 401  # signed out
    assert (await client.post("/api/auth/login", json={"email": "gone@x.com", "password": "gone-password"})).status_code == 401
    client.headers["Authorization"] = keep_auth
    assert [p["id"] for p in (await client.get("/api/projects")).json()] == [kept]  # the other user is untouched


async def test_site_details_are_public(client, monkeypatch):
    _accounts_on(monkeypatch)
    r = await client.get("/api/site")
    assert r.status_code == 200 and r.json()["businessName"]
