"""Sign up / sign in / sign out (accounts: core/auth.py). With accounts off, ``/me`` says so and nothing else is needed."""

from __future__ import annotations

import re

from bson import ObjectId
from fastapi import APIRouter, Depends, Response
from pydantic import Field

from app.core.auth import COOKIE, SESSION_DAYS, AuthRequired, current_user, hash_password, make_token, verify_password
from app.core.config import get_settings
from app.core.database import get_main_db
from app.core.errors import ConflictError, ValidationFailed
from app.core.ratelimit import rate_limit
from app.models.base import CamelModel, utcnow

router = APIRouter(prefix="/api/auth", tags=["auth"])
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class Credentials(CamelModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=200)


def _set_session(resp: Response, user_id: str) -> None:
    resp.set_cookie(COOKIE, make_token(user_id), max_age=SESSION_DAYS * 86400, httponly=True, samesite="lax",
                    secure=get_settings().cookie_secure, path="/")  # fmt: skip


def _need_accounts() -> None:
    if not get_settings().auth_enabled:
        raise ValidationFailed("Accounts are not switched on for this studio.", code="AUTH_DISABLED")


@router.get("/me")
async def me():
    uid = current_user.get()
    user = await get_main_db().users.find_one({"_id": ObjectId(uid)}) if uid and ObjectId.is_valid(uid) else None
    return {"authEnabled": get_settings().auth_enabled, "user": {"id": str(user["_id"]), "email": user["email"]} if user else None}


@router.post("/register", status_code=201, dependencies=[Depends(rate_limit("auth", 10))])
async def register(payload: Credentials, response: Response):
    _need_accounts()
    email = payload.email.strip().lower()
    if not EMAIL.match(email):
        raise ValidationFailed("Enter a valid email address.", code="INVALID_EMAIL")
    if len(payload.password) < 8:
        raise ValidationFailed("Use a password of at least 8 characters.", code="WEAK_PASSWORD")
    db = get_main_db()
    if await db.users.find_one({"email": email}):
        raise ConflictError("An account with this email already exists. Sign in instead.", code="EMAIL_TAKEN")
    uid = ObjectId()
    await db.users.insert_one({"_id": uid, "email": email, "password": hash_password(payload.password), "createdAt": utcnow()})
    _set_session(response, str(uid))
    return {"user": {"id": str(uid), "email": email}}


@router.post("/login", dependencies=[Depends(rate_limit("auth", 10))])
async def login(payload: Credentials, response: Response):
    _need_accounts()
    user = await get_main_db().users.find_one({"email": payload.email.strip().lower()})
    if not user or not verify_password(payload.password, user["password"]):
        raise AuthRequired("The email or password is not correct.", code="BAD_CREDENTIALS")
    _set_session(response, str(user["_id"]))
    return {"user": {"id": str(user["_id"]), "email": user["email"]}}


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}
