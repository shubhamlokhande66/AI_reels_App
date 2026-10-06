"""Storage on the local disk, under one root folder (``STORAGE_PATH``)."""

from __future__ import annotations

import os
import shutil
from collections.abc import Iterator
from pathlib import Path

from app.storage.base import PROJECT_FOLDERS, StorageBackend, project_key


class LocalStorage(StorageBackend):
    def __init__(self, root: Path | str):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        """Map a key to a path inside the root; keys that would escape it (``..``, absolute paths) are refused."""
        rel = str(key).replace("\\", "/").strip("/")
        if not rel:
            raise ValueError("empty storage key")
        path = (self.root / rel).resolve()
        if path != self.root and self.root not in path.parents:
            raise ValueError(f"storage key outside the storage folder: {key!r}")
        return path

    def local_path(self, key: str) -> Path:
        return self._path(key)

    def new_local_path(self, key: str) -> Path:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    def commit(self, key: str) -> None:
        # The file is already in its final place on disk.
        return None

    def exists(self, key: str) -> bool:
        return self._path(key).exists()

    def read_bytes(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def write_bytes(self, key: str, data: bytes) -> None:
        # Write to a side file and rename, so a reader never sees half a file.
        path = self.new_local_path(key)
        tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
        tmp.write_bytes(data)
        os.replace(tmp, path)

    def delete(self, key: str) -> None:
        path = self._path(key)
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=True)
        else:
            path.unlink(missing_ok=True)

    def delete_prefix(self, prefix: str) -> None:
        path = self._path(prefix)
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=True)
        elif path.exists():
            path.unlink(missing_ok=True)

    def list(self, prefix: str) -> Iterator[str]:
        base = self._path(prefix)
        if not base.is_dir():
            return iter(())
        return (p.relative_to(self.root).as_posix() for p in sorted(base.rglob("*")) if p.is_file())

    def ensure_project(self, project_id: str) -> None:
        for folder in PROJECT_FOLDERS:
            self._path(project_key(project_id, folder, "")).mkdir(parents=True, exist_ok=True)

    def free_bytes(self) -> int:
        return shutil.disk_usage(self.root).free
