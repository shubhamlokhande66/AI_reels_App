"""User accounts (production): email + password, a signed session cookie, and each user's data in their own database.

* Off by default (``AUTH_ENABLED=false``): a local, single-person install behaves exactly as before.
* On: every ``/api`` request except the public ones needs a session; the user is set for the request (and for the jobs
  it starts, which inherit the request's context), and ``core.database.get_db`` then returns *that user's* database. So
  every query in the app is scoped to its owner without being rewritten, and one user can never read another's data.
* Passwords: scrypt with a random salt (standard library). Sessions: ``<payload>.<HMAC-SHA256>`` with ``SECRET_KEY``,
  sent as an HttpOnly cookie, valid ``SESSION_DAYS``.
"""

from __future__ import annotations

import base64
import contextvars
import hashlib
import hmac
import json
import os
import time

from app.core.config import get_settings
from app.core.errors import AppError

COOKIE = "reel_session"
SESSION_DAYS = 30
PUBLIC_PATHS = ("/api/health", "/api/auth/", "/api/admin/session", "/api/phone", "/api/public/", "/api/plans", "/api/site")  # /api/public: signed links

current_user: contextvars.ContextVar[str | None] = contextvars.ContextVar("current_user", default=None)


class AuthRequired(AppError):
    status_code = 401
    code = "AUTH_REQUIRED"


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return f"scrypt${base64.b64encode(salt).decode()}${base64.b64encode(digest).decode()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, salt_b64, digest_b64 = stored.split("$")
        digest = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt_b64), n=2**14, r=8, p=1, dklen=32)
        return hmac.compare_digest(digest, base64.b64decode(digest_b64))
    except (ValueError, TypeError):
        return False


def _secret() -> bytes:
    key = get_settings().secret_key.get_secret_value()
    if not key:
        raise AuthRequired("Accounts are switched on, but SECRET_KEY is not set on the server.", code="AUTH_MISCONFIGURED")
    return key.encode()


def make_token(user_id: str, days: int = SESSION_DAYS, version: int = 0) -> str:
    """``version``: the user's session version; changing the password or deleting the account raises it, which ends
    every older session on every device."""
    # no "=" padding: the token is cookie-safe as it is (a padded value would be sent back quoted)
    data = {"u": user_id, "e": int(time.time()) + days * 86400, "v": version}
    payload = base64.urlsafe_b64encode(json.dumps(data).encode()).decode().rstrip("=")
    sig = hmac.new(_secret(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{sig}"


def read_token(token: str | None) -> str | None:
    """The user id of a valid, unexpired session token; None otherwise."""
    s = read_session(token)
    return s[0] if s else None


def read_session(token: str | None) -> tuple[str, int] | None:
    """(user id, session version) of a valid, unexpired token; None otherwise."""
    token = (token or "").strip().strip('"')
    if not token or "." not in token:
        return None
    payload, sig = token.rsplit(".", 1)
    if not hmac.compare_digest(hmac.new(_secret(), payload.encode(), hashlib.sha256).hexdigest(), sig):
        return None
    try:
        data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except (ValueError, TypeError):
        return None
    if data.get("e", 0) <= time.time() or not data.get("u"):
        return None
    return str(data["u"]), int(data.get("v", 0))


# user id -> (session version, checked at); a short cache so a request does not always cost a database read
_versions: dict[str, tuple[int, float]] = {}
VERSION_TTL = 20.0


def forget_session_cache(user_id: str) -> None:
    _versions.pop(user_id, None)


async def session_valid(user_id: str, version: int) -> bool:
    """The account still exists and the session is not older than its last password change / sign-out everywhere."""
    hit = _versions.get(user_id)
    now = time.time()
    if hit is None or now - hit[1] > VERSION_TTL:
        from bson import ObjectId

        from app.core.database import get_main_db

        if not ObjectId.is_valid(user_id):
            return False
        doc = await get_main_db().users.find_one({"_id": ObjectId(user_id)}, {"sessionVersion": 1})
        if doc is None:
            _versions.pop(user_id, None)
            return False
        hit = (int(doc.get("sessionVersion", 0)), now)
        _versions[user_id] = hit
    return hit[0] == version


def is_public(path: str) -> bool:
    return not path.startswith("/api") or any(path == p or (p.endswith("/") and path.startswith(p)) for p in PUBLIC_PATHS)


class AuthMiddleware:
    """Pure ASGI middleware: with accounts on, resolves the session for every request and refuses private API calls
    without one (401 AUTH_REQUIRED, which the website answers by showing the sign-in page)."""

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not get_settings().auth_enabled:
            return await self.app(scope, receive, send)
        headers = {k.decode().lower(): v.decode() for k, v in scope.get("headers", [])}
        token = None
        for part in headers.get("cookie", "").split(";"):
            k, _, v = part.strip().partition("=")
            if k == COOKIE:
                token = v
        if not token and headers.get("authorization", "").lower().startswith("bearer "):
            token = headers["authorization"][7:]
        session = read_session(token)
        uid = session[0] if session and await session_valid(*session) else None
        path = scope.get("path", "")
        if uid is None and not is_public(path) and scope.get("method") != "OPTIONS":
            body = json.dumps({"error": {"code": "AUTH_REQUIRED", "message": "Please sign in.", "details": None}}).encode()
            await send({"type": "http.response.start", "status": 401, "headers": [(b"content-type", b"application/json")]})
            await send({"type": "http.response.body", "body": body})
            return
        tok = current_user.set(uid)
        try:
            await self.app(scope, receive, send)
        finally:
            current_user.reset(tok)
