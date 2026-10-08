"""Payments with Razorpay (UPI, cards, net banking) and the user's credits.

Flow (Razorpay Standard Checkout):
1. ``POST /api/billing/order``: the server creates a Razorpay order for a plan or a top-up (the amount always comes from
   the server's own prices, never from the browser) and remembers it in ``payments``.
2. The website opens Razorpay Checkout with that order; the person pays.
3. ``POST /api/billing/verify``: the server checks Razorpay's signature (HMAC-SHA256 of ``order_id|payment_id`` with the
   key secret) and gives the plan / credits. ``POST /api/billing/webhook`` does the same from Razorpay's side, so a
   payment is credited even if the browser closed. Either way it is applied exactly once.

Plans are prepaid for a month or a year (no automatic renewal: the person renews from the pricing page).
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
from typing import Any

import httpx
from bson import ObjectId
from fastapi import APIRouter, Depends, Request
from pydantic import Field

from app.core.admin import require_admin
from app.core.auth import AuthRequired, current_user
from app.core.config import get_settings
from app.core.database import get_main_db
from app.core.errors import AppError, NotFoundError, ValidationFailed
from app.core.ratelimit import rate_limit
from app.models.base import CamelModel, utcnow
from app.services import credits
from app.services.plans import YEARLY_MONTHS_CHARGED, get_pricing, payments_open, pricing, set_pricing

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["billing"])
RAZORPAY = "https://api.razorpay.com/v1"


class OrderIn(CamelModel):
    item: str = Field(max_length=60)  # "plan:creator:monthly" | "plan:pro:yearly" | "topup:topup_30"


class VerifyIn(CamelModel):
    razorpay_order_id: str = Field(max_length=60)
    razorpay_payment_id: str = Field(max_length=60)
    razorpay_signature: str = Field(max_length=200)


class PricingIn(CamelModel):
    plans: list[dict[str, Any]]
    top_ups: list[dict[str, Any]]
    costs: dict[str, Any]


def _uid() -> str:
    uid = current_user.get()
    if not uid:
        raise AuthRequired("Please sign in to buy a plan or credits.")
    return uid


async def describe(item: str) -> dict[str, Any]:
    """What an item is and costs, from the server's own prices."""
    p = await get_pricing()
    parts = item.split(":")
    if parts[0] == "plan" and len(parts) == 3 and parts[2] in ("monthly", "yearly"):
        plan = next((x for x in p["plans"] if x["id"] == parts[1] and x["monthly"] > 0), None)
        if plan:
            rupees = plan["monthly"] * (YEARLY_MONTHS_CHARGED if parts[2] == "yearly" else 1)
            return {"kind": "plan", "plan": plan["id"], "period": parts[2], "rupees": rupees,
                    "label": f"{plan['name']} plan · {'1 year' if parts[2] == 'yearly' else '1 month'}"}  # fmt: skip
    if parts[0] == "topup" and len(parts) == 2:
        t = next((x for x in p["topUps"] if x["id"] == parts[1]), None)
        if t:
            return {"kind": "topup", "credits": t["credits"], "rupees": t["price"], "label": f"{t['credits']} credits"}
    raise ValidationFailed("Unknown plan or top-up.", code="UNKNOWN_ITEM")


def _auth() -> tuple[str, str]:
    s = get_settings()
    return s.razorpay_key_id, s.razorpay_key_secret.get_secret_value()


def signature_ok(order_id: str, payment_id: str, signature: str) -> bool:
    expected = hmac.new(_auth()[1].encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


async def fulfil(order_id: str, payment_id: str, via: str) -> dict[str, Any]:
    """Apply a paid order exactly once (the browser and the webhook may both report it)."""
    db = get_main_db()
    pay = await db.payments.find_one_and_update({"_id": order_id, "status": "created"},
                                                {"$set": {"status": "paid", "paymentId": payment_id, "paidAt": utcnow(), "via": via}},
                                                return_document=True)  # fmt: skip
    if pay is None:
        existing = await db.payments.find_one({"_id": order_id})
        if existing is None:
            raise NotFoundError("Payment not found.", code="PAYMENT_NOT_FOUND")
        return existing  # already applied
    item = pay["item"]
    if item["kind"] == "plan":
        await credits.give_plan(pay["userId"], item["plan"], item["period"], ref=order_id)
    else:
        await credits.give_extra(pay["userId"], item["credits"], f"Top-up: {item['label']}", ref=order_id)
    log.info("payment %s applied (%s) for %s", order_id, via, item["label"])
    return pay


async def razorpay_order(body: dict[str, Any]) -> dict[str, Any]:
    """Create an order at Razorpay (Orders API, basic auth with the key id and secret)."""
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(f"{RAZORPAY}/orders", auth=_auth(), json=body)
    except httpx.HTTPError as exc:
        raise AppError("The payment service could not be reached. Try again in a minute.", code="PAYMENT_START_FAILED") from exc
    if r.status_code >= 300:
        log.warning("razorpay order failed: %s %s", r.status_code, r.text[:200])
        raise AppError("The payment could not be started. Try again in a minute.", code="PAYMENT_START_FAILED")
    return r.json()


@router.get("/credits")
async def my_credits():
    """The signed-in user's credits, plan and recent history (``enabled: false`` when billing is off)."""
    uid = current_user.get()
    if not credits.enabled() or not uid:
        return {"enabled": False}
    return await credits.summary(uid)


@router.post("/billing/order", dependencies=[Depends(rate_limit("billing", 30))])
async def create_order(payload: OrderIn):
    if not payments_open():
        raise ValidationFailed("Online payment is not open yet.", code="PAYMENTS_CLOSED")
    uid = _uid()
    item = await describe(payload.item)
    key_id = _auth()[0]
    user = await get_main_db().users.find_one({"_id": ObjectId(uid)}) if ObjectId.is_valid(uid) else None
    order = await razorpay_order({"amount": int(item["rupees"]) * 100, "currency": "INR", "receipt": f"u{uid[-8:]}_{utcnow():%y%m%d%H%M%S}",
                                  "notes": {"userId": uid, "item": payload.item}})  # fmt: skip
    await get_main_db().payments.insert_one({"_id": order["id"], "userId": uid, "item": item, "itemKey": payload.item, "amount": order["amount"],
                                             "currency": "INR", "status": "created", "createdAt": utcnow()})  # fmt: skip
    return {"orderId": order["id"], "keyId": key_id, "amount": order["amount"], "currency": "INR", "label": item["label"],
            "email": (user or {}).get("email", "")}  # fmt: skip


@router.post("/billing/verify")
async def verify(payload: VerifyIn):
    uid = _uid()
    pay = await get_main_db().payments.find_one({"_id": payload.razorpay_order_id})
    if not pay or pay["userId"] != uid:
        raise NotFoundError("Payment not found.", code="PAYMENT_NOT_FOUND")
    if not signature_ok(payload.razorpay_order_id, payload.razorpay_payment_id, payload.razorpay_signature):
        raise ValidationFailed("The payment could not be verified. If money was taken, it will be credited automatically.", code="PAYMENT_UNVERIFIED")
    await fulfil(payload.razorpay_order_id, payload.razorpay_payment_id, "checkout")
    return await credits.summary(uid)


@router.post("/public/billing/webhook")
async def webhook(request: Request):
    """Razorpay calls this (signed with the webhook secret). Public: it carries no session; the signature is the proof."""
    secret = get_settings().razorpay_webhook_secret.get_secret_value()
    body = await request.body()
    sig = request.headers.get("x-razorpay-signature", "")
    if not secret or not hmac.compare_digest(hmac.new(secret.encode(), body, hashlib.sha256).hexdigest(), sig):
        raise ValidationFailed("Bad signature.", code="WEBHOOK_UNVERIFIED")
    event = json.loads(body)
    if event.get("event") in ("payment.captured", "order.paid"):
        entity = (event.get("payload", {}).get("payment") or {}).get("entity") or {}
        if entity.get("order_id") and entity.get("id"):
            try:
                await fulfil(entity["order_id"], entity["id"], "webhook")
            except NotFoundError:
                log.warning("webhook for an unknown order %s", entity.get("order_id"))
    return {"ok": True}


@router.get("/billing/payments")
async def my_payments():
    uid = _uid()
    return [{"id": p["_id"], "label": p["item"]["label"], "amount": p["amount"] / 100, "status": p["status"], "createdAt": p["createdAt"],
             "paidAt": p.get("paidAt")} async for p in get_main_db().payments.find({"userId": uid}).sort("createdAt", -1).limit(30)]  # fmt: skip


@router.put("/admin/pricing", dependencies=[Depends(require_admin)])
async def admin_pricing(payload: PricingIn):
    """Admin: prices, credits per plan, top-ups and credit costs."""
    await set_pricing(payload.plans, payload.top_ups, payload.costs)
    return await pricing()
