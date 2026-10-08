"""Admin access: the settings and diagnostic parts of the app are for the operator, not for every user.

Set ``ADMIN_KEY`` in the backend environment for production. Requests then need the header ``X-Admin-Key`` with that
key to use admin endpoints (AI provider, models, keys, budgets, usage, connection tests, diagnostics); the browser keeps
the key after the operator unlocks admin mode once. With no ``ADMIN_KEY`` set (local development) everyone is admin.
"""

from __future__ import annotations

import hmac

from fastapi import Request

from app.core.config import get_settings
from app.core.errors import AppError


class AdminOnly(AppError):
    status_code = 403
    code = "ADMIN_ONLY"


def is_admin(request: Request) -> bool:
    key = get_settings().admin_key.get_secret_value()
    if not key:
        return True  # no key configured: a local / development install, everything is open
    given = request.headers.get("x-admin-key", "")
    return bool(given) and hmac.compare_digest(given.encode(), key.encode())


async def require_admin(request: Request) -> None:
    """FastAPI dependency for admin-only endpoints."""
    if not is_admin(request):
        raise AdminOnly("This part of the app is for the administrator.")


def admin_required() -> bool:
    return bool(get_settings().admin_key.get_secret_value())
