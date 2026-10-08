"""Plans and credits: what each plan costs and includes, and how many credits each action uses.

Credits follow what an action really costs the studio: a Reel from the user's own footage uses almost no paid AI, a
Story Reel uses AI pictures and a narrator. Prices are in rupees, GST included. These are the defaults; the admin can
change prices, credits and costs on the Admin page (saved in MongoDB, ``app_settings`` ``_id: "pricing"``).
"""

from __future__ import annotations

import copy
from typing import Any

from app.core.config import get_settings
from app.core.database import get_main_db
from app.core.errors import ValidationFailed
from app.models.base import utcnow

CURRENCY = "INR"
YEARLY_MONTHS_CHARGED = 10  # a yearly plan costs 10 months: 2 months free
KEY = "pricing"

DEFAULTS: dict[str, Any] = {
    "plans": [
        {"id": "free", "name": "Free", "monthly": 0, "credits": 15, "creditsNote": "once, to try everything",
         "tagline": "Try every feature", "highlight": False,
         "features": ["15 credits to start", "Reels from your clips", "Your first Story Reel", "Natural AI voices"]},
        {"id": "creator", "name": "Creator", "monthly": 499, "credits": 80, "creditsNote": "every month",
         "tagline": "For creators posting every week", "highlight": True,
         "features": ["80 credits a month", "~8 Story Reels or 80 clip Reels", "Full-HD export", "Natural AI voices",
                      "Post to Instagram, TikTok, YouTube"]},
        {"id": "pro", "name": "Pro", "monthly": 1299, "credits": 250, "creditsNote": "every month",
         "tagline": "For daily posting and small brands", "highlight": False,
         "features": ["250 credits a month", "~25 Story Reels", "Everything in Creator", "Schedule posts", "Brand kit (logo, colours, fonts)"]},
        {"id": "business", "name": "Business", "monthly": 2999, "credits": 650, "creditsNote": "every month",
         "tagline": "For agencies and teams", "highlight": False,
         "features": ["650 credits a month", "~65 Story Reels", "Everything in Pro", "Several brands", "Email support"]},
    ],
    "topUps": [{"id": "topup_30", "credits": 30, "price": 199}, {"id": "topup_100", "credits": 100, "price": 599}],
    # credits per action (see COST_LABELS)
    "costs": {"clip_reel": 1, "version": 1, "story_render": 2, "ai_picture": 1, "paid_picture": 3, "preview": 0},
}  # fmt: skip

COST_LABELS = {
    "clip_reel": "Reel from your own clips",
    "version": "New version / re-render",
    "story_render": "Story Reel: narrate and render",
    "ai_picture": "AI picture for a story scene",
    "paid_picture": "Premium HD AI picture",
    "preview": "Quick previews",
}
FREE_PICTURE_NOTE = "Classical paintings and pictures from the library: free"


async def get_pricing() -> dict[str, Any]:
    """The defaults with the admin's changes on top."""
    out = copy.deepcopy(DEFAULTS)
    saved = await get_main_db().app_settings.find_one({"_id": KEY}) or {}
    for k in ("plans", "topUps"):
        if saved.get(k):
            out[k] = saved[k]
    out["costs"].update({k: v for k, v in (saved.get("costs") or {}).items() if k in out["costs"]})
    return out


def payments_open() -> bool:
    s = get_settings()
    return bool(s.billing_enabled and s.razorpay_key_id and s.razorpay_key_secret.get_secret_value())


async def pricing() -> dict[str, Any]:
    """What the pricing page shows."""
    p = await get_pricing()
    plans = [{**x, "yearly": x["monthly"] * YEARLY_MONTHS_CHARGED} for x in p["plans"]]
    costs = [{"id": k, "action": COST_LABELS[k], "credits": v} for k, v in p["costs"].items()]
    costs.append({"id": "free_picture", "action": FREE_PICTURE_NOTE, "credits": 0})
    return {"currency": CURRENCY, "yearlyMonthsCharged": YEARLY_MONTHS_CHARGED, "plans": plans, "topUps": p["topUps"],
            "creditCosts": costs, "costs": p["costs"], "paymentsOpen": payments_open(),
            "billingEnabled": get_settings().billing_enabled}  # fmt: skip


def _int(v: Any, lo: int, hi: int, what: str) -> int:
    try:
        n = int(v)
    except (TypeError, ValueError):
        raise ValidationFailed(f"{what} must be a whole number.", code="INVALID_PRICING") from None
    if not lo <= n <= hi:
        raise ValidationFailed(f"{what} must be between {lo} and {hi}.", code="INVALID_PRICING")
    return n


async def set_pricing(plans: list[dict], top_ups: list[dict], costs: dict[str, Any]) -> dict[str, Any]:
    """Admin: change prices, credits and costs. Plan ids stay as they are (payments and wallets refer to them)."""
    current = await get_pricing()
    by_id = {p["id"]: p for p in current["plans"]}
    new_plans = []
    for p in plans:
        base = by_id.get(p.get("id"))
        if base is None:
            raise ValidationFailed(f"Unknown plan '{p.get('id')}'.", code="INVALID_PRICING")
        new_plans.append({**base,
                          "monthly": 0 if base["id"] == "free" else _int(p.get("monthly"), 1, 100000, f"{base['name']} price"),
                          "credits": _int(p.get("credits"), 0, 100000, f"{base['name']} credits"),
                          "features": [str(f).strip()[:80] for f in (p.get("features") or base["features"]) if str(f).strip()][:10]})  # fmt: skip
    if {p["id"] for p in new_plans} != set(by_id):
        raise ValidationFailed("Every plan must be included.", code="INVALID_PRICING")
    new_top = [{"id": t["id"], "credits": _int(n.get("credits"), 1, 100000, "Top-up credits"), "price": _int(n.get("price"), 1, 100000, "Top-up price")}
               for t, n in zip(current["topUps"], top_ups)]  # fmt: skip
    if len(new_top) != len(current["topUps"]):
        raise ValidationFailed("Every top-up must be included.", code="INVALID_PRICING")
    new_costs = {k: _int(costs.get(k, v), 0, 100, COST_LABELS[k]) for k, v in current["costs"].items()}
    await get_main_db().app_settings.update_one({"_id": KEY}, {"$set": {"plans": new_plans, "topUps": new_top, "costs": new_costs,
                                                                        "updatedAt": utcnow()}}, upsert=True)  # fmt: skip
    return await pricing()
