"""Credits and Razorpay payments (Razorpay is faked: no network, no real money)."""

from __future__ import annotations

import hashlib
import hmac
import json
from datetime import timedelta

import pytest
from pydantic import SecretStr

from app.core.config import get_settings
from app.models.base import utcnow
from app.services import credits

KEY_SECRET = "rzp_secret_for_tests"
HOOK_SECRET = "hook_secret_for_tests"


def _billing_on(monkeypatch, payments=True):
    s = get_settings()
    monkeypatch.setattr(s, "auth_enabled", True)
    monkeypatch.setattr(s, "billing_enabled", True)
    monkeypatch.setattr(s, "secret_key", SecretStr("test-secret-key-0123456789"))
    if payments:
        monkeypatch.setattr(s, "razorpay_key_id", "rzp_test_123")
        monkeypatch.setattr(s, "razorpay_key_secret", SecretStr(KEY_SECRET))
        monkeypatch.setattr(s, "razorpay_webhook_secret", SecretStr(HOOK_SECRET))


async def _signup(client, email="ann@x.com"):
    r = await client.post("/api/auth/register", json={"email": email, "password": "password-123"})
    client.headers["Authorization"] = f"Bearer {r.cookies['reel_session']}"
    return r.json()["user"]["id"]


def _fake_razorpay(monkeypatch, seen: list):
    from app.api import billing

    async def order(body):
        seen.append(("orders", body))
        return {"id": f"order_{len(seen)}", "amount": body["amount"], "currency": "INR"}

    monkeypatch.setattr(billing, "razorpay_order", order)


def _sign(order_id: str, payment_id: str) -> str:
    return hmac.new(KEY_SECRET.encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()


async def test_billing_off_counts_nothing(client):
    assert (await client.get("/api/credits")).json() == {"enabled": False}
    assert await credits.charge("clip_reel", "job1", "test") == 0
    assert (await client.get("/api/plans")).json()["paymentsOpen"] is False


async def test_starter_credits_charge_and_refund(client, monkeypatch):
    _billing_on(monkeypatch, payments=False)
    await _signup(client)
    me = (await client.get("/api/credits")).json()
    assert me["enabled"] and me["balance"] == 15 and me["plan"] == "free"
    from app.core.auth import current_user

    tok = current_user.set(me and (await client.get("/api/auth/me")).json()["user"]["id"])
    try:
        assert await credits.charge("story_render", "job_a", "Story Reel") == 2
        assert await credits.charge("clip_reel", "job_b", "Reel", times=13) == 13
        with pytest.raises(credits.NotEnoughCredits) as e:
            await credits.charge("clip_reel", "job_c", "Reel")
        assert e.value.status_code == 402 and e.value.details == {"needed": 1, "balance": 0}
        assert await credits.refund("job_b") == 13
        assert await credits.refund("job_b") == 0  # never twice
    finally:
        current_user.reset(tok)
    assert (await client.get("/api/credits")).json()["balance"] == 13


async def test_a_failed_reel_gives_its_credits_back(client, monkeypatch, media_dir):
    from app.jobs import pipeline as pl
    from tests.test_jobs_api import wait_job

    _billing_on(monkeypatch, payments=False)
    await _signup(client)

    def boom(*a, **k):
        raise RuntimeError("render failed")

    monkeypatch.setattr(pl, "run_pipeline", boom)
    pid = (await client.post("/api/projects", json={"name": "P", "settings": {"duration": 6}})).json()["id"]
    await client.post(f"/api/projects/{pid}/videos", files=[("files", ("clip_a.mp4", (media_dir / "clip_a.mp4").read_bytes(), "video/mp4"))])
    await client.post(f"/api/projects/{pid}/audio", files={"file": ("beat120.mp3", (media_dir / "beat120.mp3").read_bytes(), "audio/mpeg")})
    r = await client.post(f"/api/projects/{pid}/generate", json={})
    assert r.status_code == 202, r.text
    assert (await client.get("/api/credits")).json()["balance"] == 14  # taken when the Reel started
    done, _ = await wait_job(client, pid, r.json()["id"])
    assert done["status"] == "failed"
    assert (await client.get("/api/credits")).json()["balance"] == 15  # and given back


async def test_no_credits_no_reel(client, monkeypatch, media_dir):
    from app.core.database import get_main_db

    _billing_on(monkeypatch, payments=False)
    uid = await _signup(client)
    await client.get("/api/credits")
    await get_main_db().wallets.update_one({"_id": uid}, {"$set": {"extra": 0}})
    pid = (await client.post("/api/projects", json={"name": "P", "settings": {"duration": 6}})).json()["id"]
    await client.post(f"/api/projects/{pid}/videos", files=[("files", ("clip_a.mp4", (media_dir / "clip_a.mp4").read_bytes(), "video/mp4"))])
    await client.post(f"/api/projects/{pid}/audio", files={"file": ("beat120.mp3", (media_dir / "beat120.mp3").read_bytes(), "audio/mpeg")})
    r = await client.post(f"/api/projects/{pid}/generate", json={})
    assert r.status_code == 402 and r.json()["error"]["code"] == "INSUFFICIENT_CREDITS"
    assert (await client.get(f"/api/projects/{pid}")).json()["status"] != "processing"  # nothing started


async def test_buy_a_plan_with_a_verified_payment(client, monkeypatch):
    _billing_on(monkeypatch)
    seen: list = []
    _fake_razorpay(monkeypatch, seen)
    await _signup(client)
    assert (await client.get("/api/plans")).json()["paymentsOpen"] is True
    bad = await client.post("/api/billing/order", json={"item": "plan:free:monthly"})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "UNKNOWN_ITEM"
    order = (await client.post("/api/billing/order", json={"item": "plan:creator:yearly"})).json()
    assert seen[0][1]["amount"] == 499 * 10 * 100  # the server's price, in paise
    assert order["keyId"] == "rzp_test_123" and order["email"] == "ann@x.com"
    forged = await client.post("/api/billing/verify", json={"razorpayOrderId": order["orderId"], "razorpayPaymentId": "pay_1",
                                                            "razorpaySignature": "0" * 64})  # fmt: skip
    assert forged.status_code == 422 and forged.json()["error"]["code"] == "PAYMENT_UNVERIFIED"
    ok = await client.post("/api/billing/verify", json={"razorpayOrderId": order["orderId"], "razorpayPaymentId": "pay_1",
                                                        "razorpaySignature": _sign(order["orderId"], "pay_1")})  # fmt: skip
    assert ok.status_code == 200, ok.text
    me = ok.json()
    assert me["plan"] == "creator" and me["period"] == "yearly" and me["balance"] == 80 + 15
    again = await client.post("/api/billing/verify", json={"razorpayOrderId": order["orderId"], "razorpayPaymentId": "pay_1",
                                                           "razorpaySignature": _sign(order["orderId"], "pay_1")})  # fmt: skip
    assert again.json()["balance"] == 95  # applied once
    pays = (await client.get("/api/billing/payments")).json()
    assert pays[0]["status"] == "paid" and pays[0]["amount"] == 4990


async def test_webhook_credits_a_top_up_once(client, monkeypatch):
    _billing_on(monkeypatch)
    seen: list = []
    _fake_razorpay(monkeypatch, seen)
    await _signup(client)
    order = (await client.post("/api/billing/order", json={"item": "topup:topup_30"})).json()
    body = json.dumps({"event": "payment.captured", "payload": {"payment": {"entity": {"id": "pay_9", "order_id": order["orderId"]}}}}).encode()
    sig = hmac.new(HOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()
    bad = await client.post("/api/public/billing/webhook", content=body, headers={"x-razorpay-signature": "nope"})
    assert bad.status_code == 422
    for _ in range(2):
        r = await client.post("/api/public/billing/webhook", content=body, headers={"x-razorpay-signature": sig})
        assert r.status_code == 200
    assert (await client.get("/api/credits")).json()["balance"] == 15 + 30


async def test_monthly_credits_renew_and_plans_end(client, monkeypatch):
    from app.core.database import get_main_db

    _billing_on(monkeypatch, payments=False)
    uid = await _signup(client)
    await credits.give_plan(uid, "pro", "yearly", ref="test")
    db = get_main_db()
    await db.wallets.update_one({"_id": uid}, {"$set": {"monthly": 3, "cycleEnds": utcnow() - timedelta(minutes=1)}})
    w = await credits.wallet(uid)
    assert w["monthly"] == 250 and w["plan"] == "pro"  # a new month: fresh credits (not added to the old ones)
    await db.wallets.update_one({"_id": uid}, {"$set": {"planEnds": utcnow() - timedelta(minutes=1)}})
    w = await credits.wallet(uid)
    assert w["plan"] == "free" and w["monthly"] == 0 and w["extra"] == 15  # the plan ended; starter / top-up credits stay


async def test_admin_edits_prices(client):
    p = (await client.get("/api/plans")).json()
    plans = [{"id": x["id"], "monthly": x["monthly"], "credits": x["credits"]} for x in p["plans"]]
    plans[1]["monthly"] = 599
    r = await client.put("/api/admin/pricing", json={"plans": plans, "topUps": p["topUps"], "costs": {**p["costs"], "story_render": 3}})
    assert r.status_code == 200, r.text
    after = (await client.get("/api/plans")).json()
    assert after["plans"][1]["monthly"] == 599 and after["plans"][1]["yearly"] == 5990 and after["costs"]["story_render"] == 3
    plans[1]["monthly"] = -5
    bad = await client.put("/api/admin/pricing", json={"plans": plans, "topUps": p["topUps"], "costs": p["costs"]})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "INVALID_PRICING"
