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
# request addresses are not logged: some services put a key or other secrets in them
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
log = logging.getLogger("app")


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    if s.auth_enabled and len(s.secret_key.get_secret_value()) < 16:
        raise RuntimeError("AUTH_ENABLED is on but SECRET_KEY is missing or too short (use 32+ random characters).")
    try:
        db = get_db()
        await ensure_indexes(db)
        await manager.recover_stale_jobs()
    except Exception as exc:  # noqa: BLE001
        log.warning("MongoDB is not reachable yet: %s", exc)
    import asyncio

    from app.publish.service import scheduler

    from app.services.retention import runner as retention_runner

    sched = asyncio.create_task(scheduler())  # scheduled posts
    sweeper = asyncio.create_task(retention_runner())  # auto-delete (admin setting)
    yield
    sched.cancel()
    sweeper.cancel()
    manager.shutdown()
    await close_db()


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(title="AI Reel Maker", version="0.1.0", lifespan=lifespan)
    from app.core.auth import AuthMiddleware

    app.add_middleware(AuthMiddleware)  # added before CORS = runs inside it, so a 401 still carries the CORS headers
    app.add_middleware(
        CORSMiddleware,
        allow_origins=s.cors_origin_list,
        allow_origin_regex=s.cors_origin_regex,
        allow_credentials=True,  # the session cookie (accounts on) goes with API calls from the website
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Range", "Accept-Ranges", "Content-Disposition"],
    )
    register_error_handlers(app)
    from app.api import auth as auth_api

    app.include_router(auth_api.router)
    from app.api import publish as publish_api
    from app.api import story as story_api
    from app.api import billing as billing_api

    app.include_router(billing_api.router)

    app.include_router(story_api.router)

    app.include_router(publish_api.router)
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
