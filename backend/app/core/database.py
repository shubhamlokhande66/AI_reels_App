"""MongoDB access (Motor). Collections: users, projects, media, jobs, renderings, styles."""

from __future__ import annotations

from typing import Any

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.core.config import get_settings

_client: Any = None
_db: Any = None


def set_database(db: Any) -> None:
    """Override the database (used by tests with mongomock-motor)."""
    global _db
    _db = db


def get_db() -> AsyncIOMotorDatabase:
    global _client, _db
    if _db is None:
        s = get_settings()
        _client = AsyncIOMotorClient(s.mongodb_uri, serverSelectionTimeoutMS=3000, tz_aware=True)
        _db = _client[s.mongodb_db]
    return _db


async def close_db() -> None:
    global _client, _db
    if _client is not None:
        _client.close()
    _client = None
    _db = None


async def ensure_indexes(db: Any) -> None:
    await db.projects.create_index([("updatedAt", -1)])
    await db.projects.create_index("status")
    await db.media.create_index([("projectId", 1), ("kind", 1)])
    await db.jobs.create_index([("projectId", 1), ("createdAt", -1)])
    await db.renderings.create_index([("projectId", 1), ("createdAt", -1)])
    await db.voices.create_index([("createdAt", -1)])
    await db.brands.create_index([("createdAt", -1)])
    await db.templates.create_index([("createdAt", -1)])
    await db.songs.create_index("sha1")
