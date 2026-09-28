"""The song library: upload once and reuse, and auto-import from watched folders."""

from __future__ import annotations

import asyncio
import mimetypes
import shutil
import tempfile
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import FileResponse

from app.core.errors import NotFoundError
from app.core.ratelimit import rate_limit
from app.services import songs as lib
from app.services.media_service import sanitize_filename
from app.storage import get_storage

router = APIRouter(prefix="/api/songs", tags=["songs"])


@router.get("")
async def list_songs(q: str = Query(default="", max_length=100)):
    folder = await lib.import_folders()
    return {"songs": [lib.song_to_out(d) for d in await lib.list_songs(q)], "folders": folder["folders"]}


@router.post("/import")
async def import_now():
    """Scan the watched folders right away."""
    return await lib.import_folders(force=True)


@router.post("", status_code=201, dependencies=[Depends(rate_limit("upload", 60))])
async def upload_songs(files: Annotated[list[UploadFile], File()]):
    out, failed = [], []
    for f in files[:20]:
        tmp = Path(tempfile.mkdtemp()) / sanitize_filename(f.filename, "song")
        try:
            with open(tmp, "wb") as fh:
                await asyncio.to_thread(shutil.copyfileobj, f.file, fh)
            out.append(lib.song_to_out(await lib.add_file(tmp, f.filename or tmp.name, "upload")))
        except Exception as exc:  # noqa: BLE001 - reported per file
            failed.append({"name": f.filename, "error": getattr(exc, "message", str(exc))[:160]})
        finally:
            shutil.rmtree(tmp.parent, ignore_errors=True)
    return {"uploaded": out, "failed": failed}


@router.get("/{song_id}/file")
async def song_file(song_id: str):
    doc = await lib.get_song(song_id)
    path = get_storage().local_path(doc["fileKey"])
    if not path.exists():
        raise NotFoundError("The song file is missing from storage.", code="SONG_FILE_MISSING")
    ctype = mimetypes.guess_type(path.name)[0] or "audio/mpeg"
    return FileResponse(path, media_type=ctype, filename=f"{doc['name']}{path.suffix}")


@router.post("/{song_id}/used", status_code=204)
async def song_used(song_id: str):
    await lib.mark_used(song_id)


@router.delete("/{song_id}", status_code=204)
async def delete_song(song_id: str):
    await lib.delete_song(song_id)
