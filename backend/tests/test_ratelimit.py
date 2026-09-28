"""Rate limiting + uniform error responses."""

from __future__ import annotations

from fastapi import Depends, FastAPI
from httpx import ASGITransport, AsyncClient

from app.core import ratelimit
from app.core.errors import register_error_handlers


async def test_rate_limit_blocks_after_quota_with_structured_error():
    ratelimit.reset()
    app = FastAPI()
    register_error_handlers(app)

    @app.get("/x", dependencies=[Depends(ratelimit.rate_limit("t", 3))])
    async def x():
        return {"ok": True}

    @app.get("/y", dependencies=[Depends(ratelimit.rate_limit("other", 3))])
    async def y():
        return {"ok": True}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        assert [(await c.get("/x")).status_code for _ in range(3)] == [200, 200, 200]
        r = await c.get("/x")
        assert r.status_code == 429
        err = r.json()["error"]
        assert err["code"] == "RATE_LIMITED" and err["details"]["retryAfterSeconds"] >= 1
        assert (await c.get("/y")).status_code == 200  # buckets are independent
    ratelimit.reset()


async def test_unknown_route_and_unhandled_errors_use_the_error_shape(client):
    r = await client.get("/api/nope")
    assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"
    r = await client.post("/api/projects", content=b"not json", headers={"content-type": "application/json"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "VALIDATION_ERROR"
