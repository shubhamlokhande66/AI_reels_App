"""MongoDB access (Motor). One database for everything (fits a free 512 MB Atlas cluster: its limit is 100 databases /
500 collections, so there is no database per user).

Accounts on (core/auth.py): every record carries ``ownerId``. While a user is set for the request (or for the job it
started), ``get_db`` returns a *scoped* view of the database that adds ``ownerId = that user`` to every read, update
and delete, and stamps it on every insert. So every query in the app is limited to its owner without being rewritten,
and one user can never read or change another's data. Without a user (accounts off, or server housekeeping) the
database is used as it is.
"""

from __future__ import annotations

from typing import Any

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.core.config import get_settings

_client: Any = None
_db: Any = None

OWNER = "ownerId"
# accounts, studio-wide settings, the shared picture library, and billing (always looked up by user id explicitly)
UNSCOPED = frozenset({"users", "app_settings", "story_images", "wallets", "credit_ledger", "payments"})


def set_database(db: Any) -> None:
    """Override the database (used by tests with mongomock-motor)."""
    global _db
    _db = db


def get_main_db() -> AsyncIOMotorDatabase:
    """The whole database, not limited to a user: accounts, admin settings and server housekeeping."""
    global _client, _db
    if _db is None:
        s = get_settings()
        _client = AsyncIOMotorClient(s.mongodb_uri, serverSelectionTimeoutMS=5000, tz_aware=True)
        _db = _client[s.mongodb_db]
    return _db


class ScopedCollection:
    """A collection seen by one user: only their documents exist."""

    def __init__(self, col: Any, owner: str) -> None:
        self._col = col
        self._owner = owner

    def _f(self, flt: dict[str, Any] | None) -> dict[str, Any]:
        return {**(flt or {}), OWNER: self._owner}

    def _stamp(self, doc: dict[str, Any]) -> dict[str, Any]:
        doc[OWNER] = self._owner  # in place: the driver also fills in doc["_id"] in place, callers rely on that
        return doc

    def find(self, filter: dict | None = None, *args, **kwargs):  # noqa: A002 - the driver's own name
        return self._col.find(self._f(filter), *args, **kwargs)

    async def find_one(self, filter: Any = None, *args, **kwargs):  # noqa: A002
        if filter is not None and not isinstance(filter, dict):
            filter = {"_id": filter}  # find_one(oid)
        return await self._col.find_one(self._f(filter), *args, **kwargs)

    async def count_documents(self, filter: dict, *args, **kwargs):  # noqa: A002
        return await self._col.count_documents(self._f(filter), *args, **kwargs)

    async def distinct(self, key: str, filter: dict | None = None, *args, **kwargs):  # noqa: A002
        return await self._col.distinct(key, self._f(filter), *args, **kwargs)

    async def insert_one(self, doc: dict, *args, **kwargs):
        return await self._col.insert_one(self._stamp(doc), *args, **kwargs)

    async def insert_many(self, docs: list[dict], *args, **kwargs):
        return await self._col.insert_many([self._stamp(d) for d in docs], *args, **kwargs)

    async def update_one(self, filter: dict, update: Any, *args, **kwargs):  # noqa: A002
        return await self._col.update_one(self._f(filter), update, *args, **kwargs)  # an upsert inserts ownerId too

    async def update_many(self, filter: dict, update: Any, *args, **kwargs):  # noqa: A002
        return await self._col.update_many(self._f(filter), update, *args, **kwargs)

    async def replace_one(self, filter: dict, doc: dict, *args, **kwargs):  # noqa: A002
        return await self._col.replace_one(self._f(filter), self._stamp(doc), *args, **kwargs)

    async def delete_one(self, filter: dict, *args, **kwargs):  # noqa: A002
        return await self._col.delete_one(self._f(filter), *args, **kwargs)

    async def delete_many(self, filter: dict, *args, **kwargs):  # noqa: A002
        return await self._col.delete_many(self._f(filter), *args, **kwargs)

    async def find_one_and_update(self, filter: dict, update: Any, *args, **kwargs):  # noqa: A002
        return await self._col.find_one_and_update(self._f(filter), update, *args, **kwargs)

    async def find_one_and_delete(self, filter: dict, *args, **kwargs):  # noqa: A002
        return await self._col.find_one_and_delete(self._f(filter), *args, **kwargs)

    def aggregate(self, pipeline: list[dict], *args, **kwargs):
        return self._col.aggregate([{"$match": {OWNER: self._owner}}, *pipeline], *args, **kwargs)

    def __getattr__(self, name: str) -> Any:
        if name in ("find_one_and_replace", "bulk_write", "watch", "estimated_document_count", "drop"):
            raise AttributeError(f"{name} is not available on a user's view of the database")  # never unscoped by accident
        return getattr(self._col, name)  # create_index, name, ...


class ScopedDatabase:
    """The database seen by one signed-in user."""

    def __init__(self, db: Any, owner: str) -> None:
        self._db = db
        self._owner = owner

    def __getitem__(self, name: str) -> Any:
        col = self._db[name]
        return col if name in UNSCOPED else ScopedCollection(col, self._owner)

    def __getattr__(self, name: str) -> Any:
        attr = getattr(self._db, name)
        if name.startswith("_") or name in UNSCOPED or not hasattr(attr, "insert_one"):
            return attr  # command, name, client ... and the unscoped collections
        return ScopedCollection(attr, self._owner)


def get_db() -> Any:
    """The database for the current request or job: the signed-in user's view (accounts on), else the whole one."""
    from app.core.auth import current_user

    uid = current_user.get()
    return ScopedDatabase(get_main_db(), uid) if uid else get_main_db()


async def close_db() -> None:
    global _client, _db
    if _client is not None:
        _client.close()
    _client = None
    _db = None


async def ensure_indexes(db: Any) -> None:
    await db.projects.create_index([("updatedAt", -1)])
    await db.projects.create_index([(OWNER, 1), ("updatedAt", -1)])
    await db.projects.create_index("status")
    await db.media.create_index([("projectId", 1), ("kind", 1)])
    await db.jobs.create_index([("projectId", 1), ("createdAt", -1)])
    await db.renderings.create_index([("projectId", 1), ("createdAt", -1)])
    for name in ("voices", "brands", "templates", "references", "generations", "feedback", "library"):
        await db[name].create_index([(OWNER, 1), ("createdAt", -1)])
    await db.songs.create_index([(OWNER, 1), ("sha1", 1)])
    await db.posts.create_index([("status", 1), ("at", 1)])
    await db.posts.create_index([("projectId", 1), ("createdAt", -1)])
    await db.users.create_index("email", unique=True)
    await db.credit_ledger.create_index([("userId", 1), ("at", -1)])
    await db.credit_ledger.create_index("ref")
    await db.payments.create_index([("userId", 1), ("createdAt", -1)])
