"""Phone mode: pages opened from another device on the home network may call the API, but only when switched on."""

from __future__ import annotations

import pytest

from app.core.config import PRIVATE_NETWORK_ORIGIN, get_settings
import re


@pytest.mark.parametrize("origin", [
    "http://192.168.1.20:3100", "http://192.168.0.5", "http://10.63.183.201:3100", "https://10.0.0.7:8443",
    "http://172.16.4.9:3100", "http://172.31.255.1:3100",
])
def test_private_network_addresses_match(origin):
    assert re.match(PRIVATE_NETWORK_ORIGIN, origin)


@pytest.mark.parametrize("origin", [
    "http://8.8.8.8:3100", "http://172.32.0.1:3100", "http://172.15.0.1:3100", "http://192.169.1.1", "http://11.0.0.1",
    "http://evil.example.com", "http://192.168.1.20.evil.com", "http://192.168.1.20:3100/x", "ftp://192.168.1.20", "http://10.0.0",
    "http://mydomain.com:3100", "http://192.168.1.20@evil.com",
])
def test_public_addresses_and_lookalikes_do_not_match(origin):
    assert not re.match(PRIVATE_NETWORK_ORIGIN, origin)


async def _preflight(client, origin):
    return await client.options("/api/health", headers={"Origin": origin, "Access-Control-Request-Method": "GET"})


async def test_off_by_default_only_localhost_is_allowed(client):
    assert get_settings().cors_allow_lan is False
    assert (await _preflight(client, "http://192.168.1.20:3100")).headers.get("access-control-allow-origin") is None
    assert (await _preflight(client, "http://localhost:3000")).headers.get("access-control-allow-origin") == "http://localhost:3000"


async def test_switched_on_allows_the_home_network_and_nothing_public(storage, db, monkeypatch):
    from httpx import ASGITransport, AsyncClient

    from app.main import create_app

    monkeypatch.setenv("CORS_ALLOW_LAN", "true")
    get_settings.cache_clear()
    async with AsyncClient(transport=ASGITransport(app=create_app()), base_url="http://test") as c:
        ok = await _preflight(c, "http://192.168.1.20:3100")
        assert ok.headers.get("access-control-allow-origin") == "http://192.168.1.20:3100"
        assert (await _preflight(c, "http://10.63.183.201:3100")).headers.get("access-control-allow-origin") == "http://10.63.183.201:3100"
        assert (await _preflight(c, "http://evil.example.com")).headers.get("access-control-allow-origin") is None
        assert (await _preflight(c, "http://8.8.8.8:3100")).headers.get("access-control-allow-origin") is None
        # uploads from a phone are ordinary requests with that Origin
        r = await c.get("/api/health", headers={"Origin": "http://192.168.1.20:3100"})
        assert r.status_code == 200 and r.headers["access-control-allow-origin"] == "http://192.168.1.20:3100"


async def test_phone_endpoint_reports_state_and_only_private_addresses(client, monkeypatch):
    import app.api.system as system

    monkeypatch.setattr(system.socket, "getaddrinfo", lambda *a, **k: [(2, 1, 6, "", ("10.63.183.201", 0)), (2, 1, 6, "", ("8.8.8.8", 0)),
                                                                        (2, 1, 6, "", ("169.254.3.4", 0)), (2, 1, 6, "", ("10.63.183.201", 0))])  # fmt: skip
    j = (await client.get("/api/phone")).json()
    assert j["enabled"] is False  # phone mode is off unless started on purpose
    assert "8.8.8.8" not in j["addresses"] and "169.254.3.4" not in j["addresses"]  # never a public or link-local address
    assert j["addresses"].count("10.63.183.201") == 1 and all(a.startswith(("10.", "192.168.", "172.")) for a in j["addresses"])


async def test_phone_endpoint_says_when_phone_mode_is_on(storage, db, monkeypatch):
    from httpx import ASGITransport, AsyncClient

    from app.main import create_app

    monkeypatch.setenv("CORS_ALLOW_LAN", "true")
    get_settings.cache_clear()
    async with AsyncClient(transport=ASGITransport(app=create_app()), base_url="http://test") as c:
        assert (await c.get("/api/phone")).json()["enabled"] is True


async def test_phone_check_page_shows_who_connected_and_escapes_everything(client):
    r = await client.get("/phone-check", headers={"user-agent": "<script>alert(1)</script> Mobile Safari"})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/html") and r.headers["cache-control"] == "no-store"
    body = r.text
    assert "Your phone reached this computer" in body and ":3100/" in body  # it also tests the app port from the phone
    assert "<script>alert(1)</script>" not in body and "&lt;script&gt;alert(1)&lt;/script&gt;" in body  # header text can never become markup
    assert "__CLIENT__" not in body and "__UA__" not in body
