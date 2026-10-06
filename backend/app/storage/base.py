"""Storage interface: every file the app keeps (uploads, analysis caches, renders, settings) goes through it.

Keys are POSIX-style relative paths such as ``projects/<id>/input/<media>.mp4``. FFmpeg/OpenCV need real files, so a
remote backend (S3 / R2) implements ``local_path()`` as "download to a cache" and ``new_local_path()`` + ``commit()``
as "write locally, then upload".
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Iterator
from pathlib import Path

PROJECT_FOLDERS = ("input", "analysis", "temp", "output")


def project_key(project_id: str, folder: str, name: str) -> str:
    """Key of a file in a project folder: ``projects/<id>/<folder>/<name>``."""
    return f"projects/{project_id}/{folder}/{name}"


class StorageBackend(ABC):
    @abstractmethod
    def local_path(self, key: str) -> Path:
        """A local path to read the file (or folder) behind ``key``. It may not exist."""

    @abstractmethod
    def new_local_path(self, key: str) -> Path:
        """A local path to write a new file for ``key`` (its folder exists). Call ``commit(key)`` when it is written."""

    @abstractmethod
    def commit(self, key: str) -> None:
        """The file written at ``new_local_path(key)`` is complete."""

    @abstractmethod
    def exists(self, key: str) -> bool: ...

    @abstractmethod
    def read_bytes(self, key: str) -> bytes: ...

    @abstractmethod
    def write_bytes(self, key: str, data: bytes) -> None: ...

    @abstractmethod
    def delete(self, key: str) -> None:
        """Remove one file; a missing file is not an error."""

    @abstractmethod
    def delete_prefix(self, prefix: str) -> None:
        """Remove everything under ``prefix`` (a folder key); missing is not an error."""

    @abstractmethod
    def list(self, prefix: str) -> Iterator[str]:
        """Keys of all files under ``prefix``, recursively."""

    @abstractmethod
    def ensure_project(self, project_id: str) -> None:
        """Create the project's folders (input, analysis, temp, output)."""

    @abstractmethod
    def free_bytes(self) -> int:
        """Free space where files are written, in bytes."""
