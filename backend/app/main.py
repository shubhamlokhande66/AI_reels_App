from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import ai_settings, brands, chat, director, jobs, library, product, projects, quality, references, revise, songs, system, templates, timeline, voice, workspace
from app.core.config import get_settings
from app.core.database import close_db, ensure_indexes, get_db
from app.core.errors import register_error_handlers
from app.jobs import manager

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("app")


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        db = get_db()
        await ensure_indexes(db)
        await manager.recover_stale_jobs()
    except Exception as exc:  # noqa: BLE001
        log.warning("MongoDB is not reachable yet: %s", exc)
    yield
    manager.shutdown()
    await close_db()


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(title="AI Reel Maker", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=s.cors_origin_list,
        allow_origin_regex=s.cors_origin_regex,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Range", "Accept-Ranges", "Content-Disposition"],
    )
    register_error_handlers(app)
    app.include_router(system.router)
    app.include_router(system.check_router)
    app.include_router(projects.router)
    app.include_router(jobs.router)
    app.include_router(timeline.router)
    app.include_router(quality.router)
    app.include_router(revise.router)
    app.include_router(chat.router)
    app.include_router(ai_settings.router)
    app.include_router(director.router)
    app.include_router(product.router)
    app.include_router(library.router)
    app.include_router(brands.router)
    app.include_router(references.router)
    app.include_router(workspace.router)
    app.include_router(templates.router)
    app.include_router(songs.router)
    app.include_router(voice.voices_router)
    app.include_router(voice.script_router)
    return app


app = create_app()
