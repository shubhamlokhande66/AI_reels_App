"""Story -> Reel: plan a story into scenes, give each scene a picture (cheapest source first, or the user's own), narrate
and render. A story is a project (``reelType: "story"``): versions, download, posting and auto-delete work as for any Reel."""

from __future__ import annotations

import asyncio
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import FileResponse
from pydantic import Field

from app.api.projects import upload_limit
from app.core.errors import NotFoundError, ValidationFailed
from app.core.ratelimit import rate_limit
from app.jobs import manager
from app.models.base import CamelModel
from app.schemas.project import JobOut, Language, ProjectCreate, ProjectSettings
from app.services import project_service
from app.storage import get_storage
from app.story import images as im
from app.story import service
from app.story.models import ART_STYLES
from app.story.planner import MAX_SCENES, MIN_SCENES, plan_story

router = APIRouter(prefix="/api", tags=["story"])

# narrators that suit stories (Gemini voices speak every language); the first is the default
NARRATORS = [("gemini:Orus", "Orus · deep, firm (male)"), ("gemini:Charon", "Charon · calm storyteller (male)"),
             ("gemini:Algenib", "Algenib · gravelly, epic (male)"), ("gemini:Kore", "Kore · firm (female)"),
             ("gemini:Despina", "Despina · smooth (female)"), ("gemini:Aoede", "Aoede · gentle (female)"),
             ("none", "No narration (captions + music only)")]  # fmt: skip


class StoryIn(CamelModel):
    text: str = Field(min_length=40, max_length=12000)
    language: Language = "hi"
    art_style: str = "ravi_varma"
    scenes: int = Field(default=8, ge=MIN_SCENES, le=MAX_SCENES)
    seconds: int = Field(default=60, ge=20, le=180)


class SceneEdit(CamelModel):
    id: str = ""
    narration: str = Field(max_length=600)
    visual: str = Field(default="", max_length=700)


class StoryEdit(CamelModel):
    title: str = Field(default="", max_length=120)
    scenes: list[SceneEdit] = Field(min_length=2, max_length=MAX_SCENES)


class PictureIn(CamelModel):
    another: bool = False


class RenderIn(CamelModel):
    voice_id: str | None = Field(default=None, max_length=60)
    quality: str = Field(default="final", pattern="^(final|preview)$")


def _out(doc: dict[str, Any], plan) -> dict[str, Any]:
    pid = str(doc["_id"])
    data = plan.model_dump(mode="json", by_alias=True)
    data.pop("sourceText", None)  # the page does not need the whole story back
    for s in data["scenes"]:
        s["imageUrl"] = f"/api/projects/{pid}/story/scenes/{s['id']}/image?v={(s.get('imageKey') or '')[-10:]}" if s.get("imageKey") else None
        s.pop("imageKey", None)
        s.pop("seen", None)
    return {"projectId": pid, **data}


OPENAI_NARRATORS = [("openai:onyx", "Onyx · deep (male, OpenAI)"), ("openai:ballad", "Ballad · storyteller (male, OpenAI)"),
                    ("openai:ash", "Ash · warm (male, OpenAI)"), ("openai:fable", "Fable · narrator (OpenAI)"),
                    ("openai:nova", "Nova · friendly (female, OpenAI)"), ("openai:shimmer", "Shimmer · clear (female, OpenAI)")]  # fmt: skip


def narrators() -> list[dict[str, str]]:
    """The narrators whose service has a key on this server (Gemini, OpenAI), and "no narration"."""
    from app.core.config import get_settings

    s = get_settings()
    out = [(i, n) for i, n in NARRATORS if i.startswith("gemini:") and s.gemini_api_key.get_secret_value()]
    if s.openai_api_key.get_secret_value():
        out += OPENAI_NARRATORS
    out += [(i, n) for i, n in NARRATORS if i == "none"]
    return [{"id": i, "name": n} for i, n in out]


@router.get("/story/options")
async def options():
    """Art styles, narrators and which picture sources are connected (so the page can say what pictures will cost)."""
    return {
        "artStyles": [{"id": s.id, "name": s.name, "paintings": s.paintings, "sources": im.sources_available(s.id)} for s in ART_STYLES.values()],
        "narrators": narrators(),
        "freeAi": im.cloudflare_ready(),
        "paidAi": bool(im.paid_ready()),
    }


@router.post("/story", status_code=201, dependencies=[Depends(rate_limit("story", 20))])
async def create(payload: StoryIn):
    """Plan the story into scenes (one AI call; without AI, by sentence) and make it a project."""
    plan = await asyncio.to_thread(plan_story, payload.text, payload.language, payload.art_style, payload.scenes, payload.seconds)
    settings = ProjectSettings(reel_type="story", language=payload.language, duration=min(max(payload.seconds, 5), 600))
    doc = await project_service.create_project(ProjectCreate(name=plan.title[:120] or "Story", settings=settings))
    await service.save_story(doc["_id"], plan)
    return _out(doc, plan)


@router.get("/projects/{project_id}/story")
async def get(project_id: str):
    doc = await project_service.get_project_doc(project_id)
    return _out(doc, await service.get_story(doc))


@router.put("/projects/{project_id}/story")
async def edit(project_id: str, payload: StoryEdit):
    doc = await project_service.get_project_doc(project_id)
    plan = service.edit_plan(await service.get_story(doc), payload.title, [s.model_dump() for s in payload.scenes])
    await service.save_story(doc["_id"], plan)
    return _out(doc, plan)


@router.post("/projects/{project_id}/story/replan", dependencies=[Depends(rate_limit("story", 20))])
async def replan(project_id: str):
    """Write the scenes again with the AI (e.g. after it was busy and the story was split plainly). Pictures are reset."""
    doc = await project_service.get_project_doc(project_id)
    old = await service.get_story(doc)
    if not old.source_text:
        raise ValidationFailed("The original story text is not stored for this project.", code="STORY_NO_SOURCE")
    plan = await asyncio.to_thread(plan_story, old.source_text, old.language, old.art_style, max(len(old.scenes), MIN_SCENES), old.seconds)
    if plan.planned_by != "ai":
        raise ValidationFailed("The AI is still busy. Try again in a minute; your scenes are unchanged.", code="AI_BUSY")
    await service.save_story(doc["_id"], plan)
    return _out(doc, plan)


@router.post("/projects/{project_id}/story/scenes/{scene_id}/picture", dependencies=[Depends(rate_limit("story_picture", 120))])
async def picture(project_id: str, scene_id: str, payload: PictureIn):
    """A picture for one scene: the library, a public-domain painting, then AI. ``another`` = a different one."""
    doc = await project_service.get_project_doc(project_id)
    await service.find_scene_picture(doc, scene_id, payload.another)
    doc = await project_service.get_project_doc(project_id)
    return _out(doc, await service.get_story(doc))


@router.post("/projects/{project_id}/story/scenes/{scene_id}/upload", dependencies=[upload_limit])
async def upload(project_id: str, scene_id: str, file: Annotated[UploadFile, File()]):
    doc = await project_service.get_project_doc(project_id)
    data = await file.read(service.MAX_UPLOAD + 1)
    await service.upload_scene_picture(doc, scene_id, data)
    doc = await project_service.get_project_doc(project_id)
    return _out(doc, await service.get_story(doc))


@router.get("/projects/{project_id}/story/scenes/{scene_id}/image")
async def image(project_id: str, scene_id: str):
    doc = await project_service.get_project_doc(project_id)
    scene = service.scene_of(await service.get_story(doc), scene_id)
    path = get_storage().local_path(scene.image_key) if scene.image_key else None
    if not path or not path.exists():
        raise NotFoundError("This scene has no picture yet.", code="SCENE_NO_PICTURE")
    return FileResponse(path, media_type="image/png" if path.suffix == ".png" else "image/jpeg")


@router.post("/projects/{project_id}/story/render", response_model=JobOut, status_code=202, dependencies=[Depends(rate_limit("job", 30))])
async def render(project_id: str, payload: RenderIn):
    from app.services import project_service as ps

    return ps.job_to_out(await manager.submit_story(project_id, payload.voice_id, payload.quality))
