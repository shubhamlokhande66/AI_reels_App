"""Reusable templates: built-in + user-saved, editable, favourites, and an AI generator that proposes drafts."""

from __future__ import annotations

import asyncio
from typing import Any, Literal

from bson import ObjectId
from fastapi import APIRouter, Response
from pydantic import Field

from app.ai import prompts
from app.ai.provider import AIProvider, AIResponseError, get_provider
from app.ai.schemas import TemplateAnswer
from app.core.database import get_db
from app.core.errors import ConflictError, NotFoundError
from app.models.base import CamelModel, utcnow
from app.schemas.project import MAX_DURATION, MIN_DURATION, AudioMode, CaptionStyle, Language, Pace
from app.services import project_service as ps
from app.services.ids import parse_id
from app.styles import AUTO_STYLE, list_styles, validate_style_id
from app.video.presets import PRESETS, validate_preset_id

router = APIRouter(tags=["templates"])


class TemplateIn(CamelModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=300)
    duration: int = Field(default=15, ge=MIN_DURATION, le=MAX_DURATION)
    style: str = "fast_trending"
    pace: Pace = "balanced"
    trend_id: str | None = None
    hook: bool = True  # suggest a hook / opening line
    captions: bool = False
    caption_style: CaptionStyle = "minimal"
    audio_mode: AudioMode = "music"
    music_sync: bool = True  # cuts land on the beat
    ai: bool = False
    language: Language = "en"
    export_preset: str = "instagram_reel"


BUILTIN: list[dict[str, Any]] = [
    {"id": "food_fast_reel", "name": "Food Fast Reel", "description": "Quick cuts on the action, ending on the finished dish.",
     "duration": 15, "style": "food", "pace": "balanced", "hook": True, "captions": True, "captionStyle": "bold",
     "audioMode": "music", "musicSync": True, "ai": False, "language": "en", "exportPreset": "instagram_reel"},
    {"id": "luxury_product", "name": "Luxury Product", "description": "Slow, elegant reveal for jewellery, fashion and premium products.",
     "duration": 15, "style": "luxury", "pace": "calm", "hook": False, "captions": False, "captionStyle": "luxury",
     "audioMode": "music", "musicSync": True, "ai": False, "language": "en", "exportPreset": "instagram_reel"},
    {"id": "travel_story", "name": "Travel Story", "description": "An establishing shot, then the journey. Works with a voice-over.",
     "duration": 30, "style": "travel", "pace": "balanced", "hook": True, "captions": True, "captionStyle": "highlight",
     "audioMode": "voice_music", "musicSync": True, "ai": True, "language": "en", "exportPreset": "instagram_reel"},
    {"id": "voiceover_explainer", "name": "Voice-over Explainer", "description": "A spoken script over calm visuals, with captions.",
     "duration": 30, "style": "cinematic", "pace": "calm", "hook": True, "captions": True, "captionStyle": "minimal",
     "audioMode": "voice_music", "musicSync": False, "ai": True, "language": "en", "exportPreset": "instagram_reel"},
    {"id": "clean_minimal", "name": "Clean Minimal", "description": "Simple cuts, no effects. Lets the footage speak.",
     "duration": 15, "style": "minimal", "pace": "balanced", "hook": False, "captions": False, "captionStyle": "minimal",
     "audioMode": "music", "musicSync": True, "ai": False, "language": "en", "exportPreset": "instagram_reel"},
]  # fmt: skip


def _check(t: TemplateIn) -> None:
    validate_style_id(t.style)
    validate_preset_id(t.export_preset)


def _find_builtin(tid: str) -> dict[str, Any] | None:
    return next((b for b in BUILTIN if b["id"] == tid), None)


async def _meta() -> dict[str, dict[str, Any]]:
    return {m["_id"]: m async for m in get_db().template_meta.find({})}


def _decorate(t: dict[str, Any], builtin: bool, meta: dict[str, Any]) -> dict[str, Any]:
    m = meta.get(t["id"], {})
    return {**t, "builtin": builtin, "favorite": bool(m.get("favorite")), "uses": int(m.get("uses", 0))}


@router.get("/api/templates")
async def list_templates():
    meta = await _meta()
    user = []
    async for d in get_db().templates.find({}).sort("createdAt", -1):
        body = {k: v for k, v in d.items() if k not in ("_id", "createdAt")}
        user.append(_decorate({"id": str(d["_id"]), **body}, False, meta))
    return [_decorate(b, True, meta) for b in BUILTIN] + user


@router.post("/api/templates", status_code=201)
async def create_template(payload: TemplateIn):
    _check(payload)
    doc = {"_id": ObjectId(), **payload.to_doc(), "createdAt": utcnow()}
    await get_db().templates.insert_one(doc)
    body = {k: v for k, v in doc.items() if k not in ("_id", "createdAt")}
    return _decorate({"id": str(doc["_id"]), **body}, False, {})


@router.patch("/api/templates/{template_id}")
async def update_template(template_id: str, payload: TemplateIn):
    if _find_builtin(template_id):
        raise ConflictError("Built-in templates cannot be changed. Duplicate it to make your own.", code="TEMPLATE_READ_ONLY")
    _check(payload)
    oid = parse_id(template_id, "Template")
    if not await get_db().templates.find_one({"_id": oid}):
        raise NotFoundError("Template not found.", code="TEMPLATE_NOT_FOUND")
    await get_db().templates.update_one({"_id": oid}, {"$set": payload.to_doc()})
    d = await get_db().templates.find_one({"_id": oid})
    body = {k: v for k, v in d.items() if k not in ("_id", "createdAt")}
    return _decorate({"id": template_id, **body}, False, await _meta())


@router.delete("/api/templates/{template_id}", status_code=204)
async def delete_template(template_id: str):
    if _find_builtin(template_id):
        raise ConflictError("Built-in templates cannot be deleted.", code="TEMPLATE_READ_ONLY")
    await get_db().templates.delete_one({"_id": parse_id(template_id, "Template")})
    await get_db().template_meta.delete_one({"_id": template_id})
    return Response(status_code=204)


class Favorite(CamelModel):
    favorite: bool


@router.put("/api/templates/{template_id}/favorite")
async def favorite_template(template_id: str, payload: Favorite):
    if not _find_builtin(template_id) and not await get_db().templates.find_one({"_id": parse_id(template_id, "Template")}):
        raise NotFoundError("Template not found.", code="TEMPLATE_NOT_FOUND")
    await get_db().template_meta.update_one({"_id": template_id}, {"$set": {"favorite": payload.favorite}}, upsert=True)
    return {"id": template_id, "favorite": payload.favorite}


class ApplyTemplate(CamelModel):
    template_id: str


@router.post("/api/projects/{project_id}/apply-template")
async def apply_template(project_id: str, payload: ApplyTemplate):
    doc = await ps.get_project_doc(project_id)
    t = _find_builtin(payload.template_id)
    if t is None:
        d = await get_db().templates.find_one({"_id": parse_id(payload.template_id, "Template")})
        if not d:
            raise NotFoundError("Template not found.", code="TEMPLATE_NOT_FOUND")
        t = {k: v for k, v in d.items() if k not in ("_id", "createdAt")}
    patch = {"settings.duration": t["duration"], "settings.style": t["style"], "settings.pace": t["pace"],
             "settings.captions": t["captions"], "settings.captionStyle": t["captionStyle"], "settings.audioMode": t["audioMode"],
             "settings.exportPreset": t["exportPreset"], "settings.ai": t["ai"], "settings.language": t["language"],
             "settings.trendId": t.get("trendId"), "updatedAt": utcnow()}  # fmt: skip
    await get_db().projects.update_one({"_id": doc["_id"]}, {"$set": patch})
    await get_db().template_meta.update_one({"_id": payload.template_id}, {"$inc": {"uses": 1}}, upsert=True)
    return {"settings": (await ps.get_project_doc(project_id))["settings"], "hook": t.get("hook", False)}


# ------------------------------------------------------------------ AI template generator
class GenerateTemplate(CamelModel):
    prompt: str = Field(min_length=3, max_length=300)


def draft_from_llm(data: dict[str, Any]) -> TemplateIn:
    """Coerce a model's answer into a valid template: unknown values fall back to safe defaults."""
    styles = {s.id for s in list_styles() if s.id != "custom"} | {AUTO_STYLE}

    def pick(v: Any, allowed: set[str] | tuple, default: str) -> str:
        return v if isinstance(v, str) and v in allowed else default

    try:
        duration = int(float(data.get("duration", 15)))
    except (TypeError, ValueError):
        duration = 15
    name = prompts.clean(str(data.get("name", "")), 80) or "AI template"
    if not name.strip():
        raise AIResponseError("The AI model returned no usable template.")
    return TemplateIn(
        name=name, description=prompts.clean(str(data.get("description", "")), 300), duration=min(max(duration, MIN_DURATION), MAX_DURATION),
        style=pick(data.get("style"), styles, "fast_trending"), pace=pick(data.get("pace"), {"calm", "balanced", "fast"}, "balanced"),  # type: ignore[arg-type]
        hook=bool(data.get("hook", True)), captions=bool(data.get("captions", False)),
        caption_style=pick(data.get("captionStyle"), {"minimal", "bold", "karaoke", "highlight", "luxury"}, "minimal"),  # type: ignore[arg-type]
        audio_mode=pick(data.get("audioMode"), {"music", "voice_music", "voice", "original", "none"}, "music"),  # type: ignore[arg-type]
        music_sync=bool(data.get("musicSync", True)), ai=bool(data.get("ai", False)),
        language=pick(data.get("language"), {"en", "hi", "mr", "hinglish"}, "en"),  # type: ignore[arg-type]
        export_preset=pick(data.get("exportPreset"), set(PRESETS), "instagram_reel"),
    )  # fmt: skip


def generate_draft(provider: AIProvider, request: str) -> TemplateIn:
    data = provider.generate_structured(
        prompts.SYSTEM_EDITOR,
        f'Create a reusable Reel template for: "{prompts.clean(request, 300)}".\n'
        f"Allowed styles: {sorted(s.id for s in list_styles() if s.id != 'custom')}. Paces: calm, balanced, fast. "
        "Caption styles: minimal, bold, karaoke, highlight, luxury. Audio modes: music, voice_music, voice, original, none. "
        f"Export presets: {sorted(PRESETS)}. Duration 5-90 seconds.\n"
        'Return JSON: {"name": "", "description": "", "duration": 15, "style": "", "pace": "", "hook": true, "captions": false, '
        '"captionStyle": "", "audioMode": "", "musicSync": true, "ai": false, "language": "en", "exportPreset": ""}',
        TemplateAnswer, task="template", temperature=0.5,
    ).model_dump()
    return draft_from_llm(data)


@router.post("/api/templates/generate")
async def generate_template(payload: GenerateTemplate):
    """AI proposes a template. It is NOT saved: the user reviews and edits it, then saves it with POST /api/templates."""
    draft = await asyncio.to_thread(generate_draft, get_provider("template"), payload.prompt)
    return {"draft": True, "template": draft.to_doc()}


class GenerateTemplateFromChat(CamelModel):
    transcript: str = Field(min_length=3, max_length=8000)


def generate_draft_from_conversation(provider: AIProvider, transcript: str) -> TemplateIn:
    """Same idea as generate_draft(), but reading a whole Chat conversation instead of a one-line prompt: lets a
    back-and-forth about how someone wants their Reels to look become a real, reviewable template."""
    data = provider.generate_structured(
        prompts.SYSTEM_EDITOR,
        "Below is a conversation between a person and an assistant about how they want their Reels to look and feel. "
        "Read it and propose a reusable Reel template that captures their stated preferences. If something was not "
        "discussed, use a sensible default rather than guessing wildly.\n\n"
        f"Conversation:\n{prompts.clean(transcript, 8000)}\n\n"
        f"Allowed styles: {sorted(s.id for s in list_styles() if s.id != 'custom')}. Paces: calm, balanced, fast. "
        "Caption styles: minimal, bold, karaoke, highlight, luxury. Audio modes: music, voice_music, voice, original, none. "
        f"Export presets: {sorted(PRESETS)}. Duration 5-90 seconds.\n"
        'Return JSON: {"name": "", "description": "", "duration": 15, "style": "", "pace": "", "hook": true, "captions": false, '
        '"captionStyle": "", "audioMode": "", "musicSync": true, "ai": false, "language": "en", "exportPreset": ""}',
        TemplateAnswer, task="template", temperature=0.5,
    ).model_dump()
    return draft_from_llm(data)


@router.post("/api/templates/generate-from-chat")
async def generate_template_from_chat(payload: GenerateTemplateFromChat):
    """The Chat tab's "Save as Reel template": same draft-then-review contract as /api/templates/generate."""
    draft = await asyncio.to_thread(generate_draft_from_conversation, get_provider("template"), payload.transcript)
    return {"draft": True, "template": draft.to_doc()}


__all__ = ["router", "Literal"]
