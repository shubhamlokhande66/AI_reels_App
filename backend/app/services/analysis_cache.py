"""Shared analysis cache: a clip or song analysed once is never analysed again, in any project.

Entries are keyed by a hash of the file's CONTENT (not its name or project), plus the analysis version (and, for the
vision model's description, the model), so the same footage uploaded to a new project, a duplicate or a language
variant reuses the measurements instantly, while a newer analyser or another model still computes fresh results.
Only numbers and descriptions are stored, never media. Deleting a project's uploads for privacy removes their entries.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from typing import Any

from app.storage import StorageBackend

log = logging.getLogger(__name__)

ROOT = "shared/analysis"
_hashes: dict[tuple[str, int, float], str] = {}


def content_hash(storage: StorageBackend, key: str) -> str | None:
    """SHA-256 of the stored file (memoised by path, size and modification time). None when the file is missing."""
    try:
        path = storage.local_path(key)
        st = path.stat()
    except (OSError, ValueError):
        return None
    memo = (str(path), st.st_size, st.st_mtime)
    if memo in _hashes:
        return _hashes[memo]
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    _hashes[memo] = h.hexdigest()
    return _hashes[memo]


def _key(digest: str, kind: str, version: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", version)[:80]
    return f"{ROOT}/{digest[:40]}/{kind}_v{safe}.json"


def load(storage: StorageBackend, digest: str | None, kind: str, version: Any) -> dict | None:
    if not digest:
        return None
    k = _key(digest, kind, str(version))
    try:
        return json.loads(storage.read_bytes(k)) if storage.exists(k) else None
    except (ValueError, OSError):
        return None


def save(storage: StorageBackend, digest: str | None, kind: str, version: Any, doc: dict) -> None:
    if not digest:
        return
    try:
        storage.write_bytes(_key(digest, kind, str(version)), json.dumps(doc).encode())
    except OSError as exc:  # a cache that cannot be written only costs speed
        log.info("shared analysis not cached: %s", exc)


def forget(storage: StorageBackend, key: str) -> None:
    """Remove every shared entry of the file stored at ``key`` (privacy: the person deleted their uploads)."""
    digest = content_hash(storage, key)
    if digest:
        storage.delete_prefix(f"{ROOT}/{digest[:40]}")
