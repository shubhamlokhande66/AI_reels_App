"""File storage. ``get_storage()`` returns the active backend (local disk at ``STORAGE_PATH`` by default)."""

from __future__ import annotations

from app.storage.base import PROJECT_FOLDERS, StorageBackend, project_key
from app.storage.local import LocalStorage

__all__ = ["PROJECT_FOLDERS", "LocalStorage", "StorageBackend", "get_storage", "project_key", "set_storage"]

_storage: StorageBackend | None = None


def get_storage() -> StorageBackend:
    global _storage
    if _storage is None:
        from app.core.config import get_settings

        _storage = LocalStorage(get_settings().storage_path)
    return _storage


def set_storage(storage: StorageBackend | None) -> None:
    """Replace the backend (tests use a temporary folder); ``None`` goes back to the default."""
    global _storage
    _storage = storage
