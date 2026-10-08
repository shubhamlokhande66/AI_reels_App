"""Credit balance per user: given by a plan or a top-up, used when a Reel is made, given back if the Reel fails.

Only active when billing is switched on (``BILLING_ENABLED``) and users sign in (``AUTH_ENABLED``); a local, single-person
studio never counts credits.

A wallet (``wallets``, ``_id`` = user id) has two buckets:
* ``monthly``: the plan's credits for the current month; replaced (not added to) when the month renews
* ``extra``: the free starter credits and top-ups; they never expire
Credits are taken from ``monthly`` first. Every change is a line in ``credit_ledger`` (``ref`` = the job or payment).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from app.core.auth import current_user
from app.core.config import get_settings
from app.core.database import get_main_db
from app.core.errors import AppError
from app.models.base import utcnow

CYCLE = timedelta(days=30)


class NotEnoughCredits(AppError):
    status_code = 402
    code = "INSUFFICIENT_CREDITS"


def enabled() -> bool:
    s = get_settings()
    return bool(s.billing_enabled and s.auth_enabled)


def _aware(d: Any) -> datetime | None:
    if d is None:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


async def _plans() -> dict[str, dict]:
    from app.services.plans import get_pricing

    return {p["id"]: p for p in (await get_pricing())["plans"]}


async def wallet(user_id: str) -> dict[str, Any]:
    """The user's wallet, created with the free starter credits, and renewed / expired as the dates say."""
    db = get_main_db()
    now = utcnow()
    w = await db.wallets.find_one({"_id": user_id})
    if w is None:
        free = (await _plans()).get("free", {}).get("credits", 0)
        w = {"_id": user_id, "plan": "free", "period": None, "monthly": 0, "extra": int(free), "planEnds": None, "cycleEnds": None,
             "createdAt": now, "updatedAt": now}  # fmt: skip
        try:
            await db.wallets.insert_one(w)
            await _log(user_id, int(free), "Free starter credits", "signup", w)
        except Exception:  # noqa: BLE001 - created at the same moment by another request
            w = await db.wallets.find_one({"_id": user_id})
    plan_ends, cycle_ends = _aware(w.get("planEnds")), _aware(w.get("cycleEnds"))
    if w["plan"] != "free" and plan_ends and now >= plan_ends:  # the paid period is over: back to free (top-ups stay)
        await db.wallets.update_one({"_id": user_id}, {"$set": {"plan": "free", "period": None, "monthly": 0, "planEnds": None, "cycleEnds": None,
                                                                "updatedAt": now}})  # fmt: skip
        w = await db.wallets.find_one({"_id": user_id})
    elif w["plan"] != "free" and cycle_ends and now >= cycle_ends:  # a new month inside a yearly plan: fresh monthly credits
        credits = (await _plans()).get(w["plan"], {}).get("credits", 0)
        nxt = cycle_ends
        while nxt <= now:
            nxt += CYCLE
        res = await db.wallets.find_one_and_update({"_id": user_id, "cycleEnds": w["cycleEnds"]},
                                                   {"$set": {"monthly": int(credits), "cycleEnds": nxt, "updatedAt": now}}, return_document=True)  # fmt: skip
        if res:
            await _log(user_id, int(credits), "Monthly credits renewed", "renewal", res)
        w = await db.wallets.find_one({"_id": user_id})
    return w


def balance(w: dict[str, Any]) -> int:
    return int(w.get("monthly", 0)) + int(w.get("extra", 0))


async def _log(user_id: str, delta: int, reason: str, ref: str, w: dict[str, Any], **extra: Any) -> None:
    await get_main_db().credit_ledger.insert_one({"userId": user_id, "delta": delta, "reason": reason, "ref": ref, "balance": balance(w),
                                                  "at": utcnow(), **extra})  # fmt: skip


async def cost_of(action: str, times: int = 1) -> int:
    from app.services.plans import get_pricing

    return int((await get_pricing())["costs"].get(action, 0)) * max(times, 0)


async def charge(action: str, ref: str, reason: str, times: int = 1) -> int:
    """Take the credits for an action from the signed-in user, or raise NotEnoughCredits (402). Returns what was taken."""
    uid = current_user.get()
    if not enabled() or not uid:
        return 0
    cost = await cost_of(action, times)
    if cost <= 0:
        return 0
    db = get_main_db()
    for _ in range(5):  # optimistic: retry if another request changed the wallet in between
        w = await wallet(uid)
        monthly, extra = int(w.get("monthly", 0)), int(w.get("extra", 0))
        if monthly + extra < cost:
            raise NotEnoughCredits(
                f"This needs {cost} credit{'s' if cost > 1 else ''}, you have {monthly + extra}. Top up or choose a plan to continue.",
                details={"needed": cost, "balance": monthly + extra},
            )
        from_monthly = min(monthly, cost)
        res = await db.wallets.find_one_and_update(
            {"_id": uid, "monthly": monthly, "extra": extra},
            {"$set": {"monthly": monthly - from_monthly, "extra": extra - (cost - from_monthly), "updatedAt": utcnow()}},
            return_document=True,
        )
        if res:
            await _log(uid, -cost, reason, ref, res, fromMonthly=from_monthly)
            return cost
    raise AppError("Your credits are being updated by another request. Try again.", code="CREDITS_BUSY")


async def refund(ref: str) -> int:
    """Give back what a job took (it failed or was cancelled). Each charge is refunded at most once."""
    db = get_main_db()
    entry = await db.credit_ledger.find_one_and_update({"ref": ref, "delta": {"$lt": 0}, "refunded": {"$ne": True}}, {"$set": {"refunded": True}})
    if not entry:
        return 0
    amount = -int(entry["delta"])
    back_monthly = min(int(entry.get("fromMonthly", 0)), amount)
    res = await db.wallets.find_one_and_update({"_id": entry["userId"]},
                                               {"$inc": {"monthly": back_monthly, "extra": amount - back_monthly}, "$set": {"updatedAt": utcnow()}},
                                               return_document=True)  # fmt: skip
    if res:
        await _log(entry["userId"], amount, "Refund: the Reel could not be made", ref, res)
    return amount


async def give_plan(user_id: str, plan_id: str, period: str, ref: str) -> dict[str, Any]:
    """A paid plan starts (or is extended): this month's credits replace the old monthly ones."""
    plans = await _plans()
    plan = plans[plan_id]
    w = await wallet(user_id)
    now = utcnow()
    start = _aware(w.get("planEnds")) if w["plan"] == plan_id and w.get("planEnds") and _aware(w["planEnds"]) > now else now
    ends = start + (timedelta(days=365) if period == "yearly" else CYCLE)
    res = await get_main_db().wallets.find_one_and_update(
        {"_id": user_id},
        {"$set": {"plan": plan_id, "period": period, "monthly": int(plan["credits"]), "planEnds": ends,
                  "cycleEnds": min(now + CYCLE, ends), "updatedAt": now}},  # fmt: skip
        return_document=True,
    )
    await _log(user_id, int(plan["credits"]), f"{plan['name']} plan ({period})", ref, res)
    return res


async def give_extra(user_id: str, credits: int, reason: str, ref: str) -> dict[str, Any]:
    await wallet(user_id)
    res = await get_main_db().wallets.find_one_and_update({"_id": user_id}, {"$inc": {"extra": int(credits)}, "$set": {"updatedAt": utcnow()}},
                                                          return_document=True)  # fmt: skip
    await _log(user_id, int(credits), reason, ref, res)
    return res


async def summary(user_id: str) -> dict[str, Any]:
    w = await wallet(user_id)
    plans = await _plans()
    history = [
        {"delta": e["delta"], "reason": e["reason"], "at": e["at"], "balance": e.get("balance")}
        async for e in get_main_db().credit_ledger.find({"userId": user_id}).sort("at", -1).limit(30)
    ]
    return {"enabled": True, "balance": balance(w), "monthly": int(w.get("monthly", 0)), "extra": int(w.get("extra", 0)),
            "plan": w["plan"], "planName": plans.get(w["plan"], {}).get("name", w["plan"]), "period": w.get("period"),
            "planEnds": w.get("planEnds"), "renews": w.get("cycleEnds"), "history": history}  # fmt: skip
