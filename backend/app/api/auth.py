"""Accounts (core/auth.py): sign up / in / out, forgot + reset password, change password, delete the account.

With accounts off, ``/me`` says so and nothing else is needed."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import secrets
from datetime import timedelta
from typing import Any

from bson import ObjectId
from fastapi import APIRouter, Depends, Response
from pydantic import Field

from app.core.auth import COOKIE, SESSION_DAYS, AuthRequired, current_user, forget_session_cache, hash_password, make_token, verify_password
from app.core.config import get_settings
from app.core.database import OWNER, UNSCOPED, get_main_db
from app.core.errors import ConflictError, ValidationFailed
from app.core.ratelimit import rate_limit
from app.models.base import CamelModel, utcnow
from app.storage import get_storage

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
RESET_MINUTES = 60
MIN_PASSWORD = 8


class Credentials(CamelModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=200)


class ForgotIn(CamelModel):
    email: str = Field(min_length=3, max_length=254)


class ResetIn(CamelModel):
    token: str = Field(min_length=20, max_length=200)
    password: str = Field(min_length=1, max_length=200)


class ChangeIn(CamelModel):
    current_password: str = Field(min_length=1, max_length=200)
    new_password: str = Field(min_length=1, max_length=200)


class DeleteIn(CamelModel):
    password: str = Field(min_length=1, max_length=200)
    confirm: str = Field(max_length=254)  # the account's email, typed again


def _set_session(resp: Response, user: dict[str, Any]) -> None:
    token = make_token(str(user["_id"]), version=int(user.get("sessionVersion", 0)))
    resp.set_cookie(COOKIE, token, max_age=SESSION_DAYS * 86400, httponly=True, samesite="lax", secure=get_settings().cookie_secure, path="/")


def _need_accounts() -> None:
    if not get_settings().auth_enabled:
        raise ValidationFailed("Accounts are not switched on for this studio.", code="AUTH_DISABLED")


def _check_password(password: str) -> None:
    if len(password) < MIN_PASSWORD:
        raise ValidationFailed(f"Use a password of at least {MIN_PASSWORD} characters.", code="WEAK_PASSWORD")


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def _me_doc() -> dict[str, Any]:
    uid = current_user.get()
    user = await get_main_db().users.find_one({"_id": ObjectId(uid)}) if uid and ObjectId.is_valid(uid) else None
    if not user:
        raise AuthRequired("Please sign in.")
    return user


async def _new_session_version(user_id: ObjectId) -> dict[str, Any]:
    """Every older session (other phones, other browsers) stops working."""
    user = await get_main_db().users.find_one_and_update({"_id": user_id}, {"$inc": {"sessionVersion": 1}}, return_document=True)
    forget_session_cache(str(user_id))
    return user


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
    _check_password(payload.password)
    db = get_main_db()
    if await db.users.find_one({"email": email}):
        raise ConflictError("An account with this email already exists. Sign in instead.", code="EMAIL_TAKEN")
    user = {"_id": ObjectId(), "email": email, "password": hash_password(payload.password), "sessionVersion": 0, "createdAt": utcnow()}
    await db.users.insert_one(user)
    _set_session(response, user)
    return {"user": {"id": str(user["_id"]), "email": email}}


@router.post("/login", dependencies=[Depends(rate_limit("auth", 10))])
async def login(payload: Credentials, response: Response):
    _need_accounts()
    user = await get_main_db().users.find_one({"email": payload.email.strip().lower()})
    if not user or not verify_password(payload.password, user["password"]):
        raise AuthRequired("The email or password is not correct.", code="BAD_CREDENTIALS")
    _set_session(response, user)
    return {"user": {"id": str(user["_id"]), "email": user["email"]}}


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


def _site_url() -> str:
    s = get_settings()
    if s.public_base_url:
        return s.public_base_url.rstrip("/")
    return (s.cors_origin_list or ["http://localhost:3100"])[0].rstrip("/")


@router.post("/forgot", dependencies=[Depends(rate_limit("auth_forgot", 5))])
async def forgot(payload: ForgotIn):
    """Email a link to choose a new password. The answer is the same whether or not the email has an account, so
    nobody can find out who is signed up."""
    _need_accounts()
    from app.core import mailer

    db = get_main_db()
    user = await db.users.find_one({"email": payload.email.strip().lower()})
    if user:
        token = secrets.token_urlsafe(32)
        await db.users.update_one({"_id": user["_id"]}, {"$set": {"reset": {"hash": _hash_token(token), "expires": utcnow() + timedelta(minutes=RESET_MINUTES)}}})
        s = get_settings()
        link = f"{_site_url()}/reset?token={token}"
        text = (f"Hello,\n\nSomeone (hopefully you) asked to reset the password of your {s.business_name} account.\n\n"
                f"Choose a new password here (the link works for {RESET_MINUTES} minutes, once):\n{link}\n\n"
                "If you did not ask for this, you can ignore this email: your password stays the same.\n")  # fmt: skip
        await asyncio.to_thread(mailer.send, user["email"], f"Reset your {s.business_name} password", text)
    return {"ok": True}


@router.post("/reset", dependencies=[Depends(rate_limit("auth", 10))])
async def reset(payload: ResetIn, response: Response):
    _need_accounts()
    _check_password(payload.password)
    db = get_main_db()
    user = await db.users.find_one({"reset.hash": _hash_token(payload.token)})
    expires = (user or {}).get("reset", {}).get("expires")
    if expires is not None and expires.tzinfo is None:
        from datetime import timezone

        expires = expires.replace(tzinfo=timezone.utc)
    if not user or not expires or expires < utcnow():
        raise ValidationFailed("This link has expired or was already used. Ask for a new one.", code="RESET_LINK_INVALID")
    await db.users.update_one({"_id": user["_id"]}, {"$set": {"password": hash_password(payload.password)}, "$unset": {"reset": ""}})
    user = await _new_session_version(user["_id"])
    _set_session(response, user)  # signed in on this device; every other session ends
    return {"user": {"id": str(user["_id"]), "email": user["email"]}}


@router.post("/password", dependencies=[Depends(rate_limit("auth", 10))])
async def change_password(payload: ChangeIn, response: Response):
    _need_accounts()
    user = await _me_doc()
    if not verify_password(payload.current_password, user["password"]):
        raise ValidationFailed("The current password is not correct.", code="BAD_CREDENTIALS")
    _check_password(payload.new_password)
    await get_main_db().users.update_one({"_id": user["_id"]}, {"$set": {"password": hash_password(payload.new_password)}})
    user = await _new_session_version(user["_id"])
    _set_session(response, user)
    return {"ok": True}


@router.post("/logout-everywhere")
async def logout_everywhere(response: Response):
    _need_accounts()
    user = await _new_session_version((await _me_doc())["_id"])
    _set_session(response, user)  # this device stays signed in
    return {"ok": True}


async def delete_user_data(user_id: str) -> dict[str, int]:
    """Everything the user owns: records in every collection, their files (uploads, Reels, pictures, logos), credits.
    Payment records are kept for the accounts (tax law) without the link to the person."""
    db = get_main_db()
    storage = get_storage()
    counts: dict[str, int] = {}
    names = [n for n in await db.list_collection_names() if n not in UNSCOPED and not n.startswith("system.")]
    for name in names:
        async for doc in db[name].find({OWNER: user_id}):
            for k, v in doc.items():
                if k.endswith("Key") and isinstance(v, str) and v:
                    storage.delete(v)  # stored files: storedKey, thumbnailKey, logoKey ...
            if name == "projects":
                storage.delete_prefix(f"projects/{doc['_id']}")
        res = await db[name].delete_many({OWNER: user_id})
        if res.deleted_count:
            counts[name] = res.deleted_count
    await db.wallets.delete_many({"_id": user_id})
    await db.credit_ledger.delete_many({"userId": user_id})
    await db.payments.update_many({"userId": user_id}, {"$set": {"userId": None, "accountDeleted": True}})
    return counts


@router.post("/delete-account", dependencies=[Depends(rate_limit("auth", 5))])
async def delete_account(payload: DeleteIn, response: Response):
    """Delete the account and all its data, for good. Asks for the password and the email typed again."""
    _need_accounts()
    user = await _me_doc()
    if payload.confirm.strip().lower() != user["email"]:
        raise ValidationFailed("Type your email address exactly to confirm.", code="CONFIRMATION_MISMATCH")
    if not verify_password(payload.password, user["password"]):
        raise ValidationFailed("The password is not correct.", code="BAD_CREDENTIALS")
    db = get_main_db()
    busy = await db.projects.find_one({OWNER: str(user["_id"]), "status": "processing"})
    if busy:
        raise ConflictError("A Reel is being made right now. Wait until it finishes (or cancel it), then delete the account.", code="ACCOUNT_BUSY")
    counts = await delete_user_data(str(user["_id"]))
    await db.users.delete_one({"_id": user["_id"]})
    forget_session_cache(str(user["_id"]))
    response.delete_cookie(COOKIE, path="/")
    log.info("account deleted (%s records)", sum(counts.values()))
    return {"ok": True}
