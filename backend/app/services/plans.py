"""Plans and credits: what each plan costs and includes, and how many credits each action uses.

Credits follow what an action really costs the studio: a Reel from the user's own footage uses almost no paid AI, a
Story Reel uses pictures and a narrator. Prices are in rupees, GST included. These are the defaults; payments, the credit
balance and admin editing build on this same data.
"""

from __future__ import annotations

from typing import Any

CURRENCY = "INR"
YEARLY_MONTHS_CHARGED = 10  # a yearly plan costs 10 months: 2 months free

PLANS: list[dict[str, Any]] = [
    {
        "id": "free", "name": "Free", "monthly": 0, "credits": 15, "creditsNote": "once, to try everything",
        "tagline": "Try every feature", "highlight": False,
        "features": ["15 credits to start", "Reels from your clips", "1 Story Reel", "Watermark on Reels", "Draft-quality AI pictures"],
    },
    {
        "id": "creator", "name": "Creator", "monthly": 499, "credits": 80, "creditsNote": "every month",
        "tagline": "For creators posting every week", "highlight": True,
        "features": ["80 credits a month", "~6 Story Reels or 80 clip Reels", "No watermark", "Full-HD export", "Natural AI voices",
                     "Post to Instagram, TikTok, YouTube"],
    },
    {
        "id": "pro", "name": "Pro", "monthly": 1299, "credits": 250, "creditsNote": "every month",
        "tagline": "For daily posting and small brands", "highlight": False,
        "features": ["250 credits a month", "~20 Story Reels", "Everything in Creator", "Schedule posts", "Brand kit (logo, colours, fonts)",
                     "Priority rendering"],
    },
    {
        "id": "business", "name": "Business", "monthly": 2999, "credits": 650, "creditsNote": "every month",
        "tagline": "For agencies and teams", "highlight": False,
        "features": ["650 credits a month", "~60 Story Reels", "Everything in Pro", "Several brands", "Fastest rendering", "Email support"],
    },
]  # fmt: skip

TOP_UPS: list[dict[str, Any]] = [{"id": "topup_30", "credits": 30, "price": 199}, {"id": "topup_100", "credits": 100, "price": 599}]

# what one action uses
CREDIT_COSTS: list[dict[str, Any]] = [
    {"action": "Reel from your own clips", "credits": 1},
    {"action": "New version / regenerate", "credits": 1},
    {"action": "Story Reel (about 8 scenes, narrated)", "credits": 10},
    {"action": "A new picture for one scene", "credits": 1},
    {"action": "Story draft preview", "credits": 0},
    {"action": "Premium HD AI pictures", "credits": "×3"},
]  # fmt: skip


def yearly_price(monthly: int) -> int:
    return monthly * YEARLY_MONTHS_CHARGED


def pricing() -> dict[str, Any]:
    plans = [{**p, "yearly": yearly_price(p["monthly"])} for p in PLANS]
    return {"currency": CURRENCY, "yearlyMonthsCharged": YEARLY_MONTHS_CHARGED, "plans": plans, "topUps": TOP_UPS,
            "creditCosts": CREDIT_COSTS, "paymentsOpen": False}  # fmt: skip
