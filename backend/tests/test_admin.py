"""Admin mode: with ADMIN_KEY set, the AI settings (provider, models, keys, usage) need the key; everything else stays open."""

from __future__ import annotations

from pydantic import SecretStr

from app.core.config import get_settings


async def test_no_key_configured_means_everyone_is_admin(client):
    r = await client.get("/api/admin/session")
    assert r.json() == {"admin": True, "required": False}
    assert (await client.get("/api/ai/config")).status_code == 200


async def test_with_a_key_settings_are_admin_only(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "admin_key", SecretStr("s3cret"))
    assert (await client.get("/api/admin/session")).json() == {"admin": False, "required": True}
    r = await client.get("/api/ai/config")
    assert r.status_code == 403 and r.json()["error"]["code"] == "ADMIN_ONLY"
    assert (await client.get("/api/ai/config", headers={"X-Admin-Key": "wrong"})).status_code == 403
    ok = {"X-Admin-Key": "s3cret"}
    assert (await client.get("/api/ai/config", headers=ok)).status_code == 200
    assert (await client.get("/api/admin/session", headers=ok)).json() == {"admin": True, "required": True}
    assert (await client.get("/api/projects")).status_code == 200  # the product itself stays open to users
