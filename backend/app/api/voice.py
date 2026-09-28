"""Voice profiles, the script editor, and voice-over generation (which re-times the Reel to the voice)."""

from __future__ import annotations

import asyncio
import tempfile
import time
from pathlib import Path
from typing import Literal

from bson import ObjectId
from fastapi import APIRouter, Response
from pydantic import Field

from app.ai import script as scr
from app.ai.provider import get_provider
from app.core.database import get_db
from app.core.errors import AppError, NotFoundError, ValidationFailed
from app.models.base import CamelModel, utcnow
from app.models.timeline import VoiceLine, VoiceTrack
from app.schemas.project import ProjectSettings
from app.services import project_service as ps
from app.services import timeline_service as ts
from app.services.ids import parse_id
from app.storage import get_storage, project_key
from app.video.timeline_ops import ClearVoice, EditError, FitToVoice, ReplaceCaptions, SetVoice
from app.voice.base import EMOTIONS, ENERGY, PAUSES, SpeechSettings
from app.voice.sapi import get_voice_provider
from app.voice.service import ScriptLine, estimate_seconds, synthesize_script, validate_lines
from app.voice.captions import captions_from_voice

voices_router = APIRouter(prefix="/api/voices", tags=["voice"])
script_router = APIRouter(prefix="/api/projects/{project_id}", tags=["script"])

Lang = Literal["en", "hi", "mr", "hinglish"]
SAMPLE = {"en": "Your everyday look just got a little more elegant.", "hi": "आपका रोज़ का लुक अब और भी खूबसूरत।",
          "mr": "तुमचा रोजचा लुक आता आणखी सुंदर.", "hinglish": "Aapka everyday look ab aur bhi elegant."}  # fmt: skip


class VoiceProfileIn(CamelModel):
    name: str = Field(min_length=1, max_length=60)
    voice: str | None = Field(default=None, max_length=120)  # installed voice; empty = pick by language
    language: Lang = "en"
    speed: float = Field(default=1.0, ge=0.5, le=2.0)
    pitch: float = Field(default=0.0, ge=-30, le=30)
    energy: Literal["low", "medium", "high"] = "medium"
    emotion: Literal["neutral", "friendly", "energetic", "calm", "serious"] = "friendly"
    pause_style: Literal["tight", "natural", "dramatic"] = "natural"
    pronunciations: dict[str, str] = Field(default_factory=dict, max_length=50)


class ScriptLineIn(CamelModel):
    text: str = Field(max_length=scr.MAX_LINE_CHARS)
    pause_after: float | None = Field(default=None, ge=0, le=3)


class ScriptIn(CamelModel):
    language: Lang = "en"
    lines: list[ScriptLineIn] = Field(max_length=scr.MAX_LINES * 2)
    hook: str | None = Field(default=None, max_length=scr.MAX_HOOK_CHARS)
    cta: str | None = Field(default=None, max_length=100)
    tone: str = Field(default="", max_length=60)
    voice_profile_id: str | None = None


class HooksRequest(CamelModel):
    count: int = Field(default=3, ge=1, le=6)
    tone: str = Field(default="", max_length=60)


class GenerateScriptRequest(CamelModel):
    hook: str | None = Field(default=None, max_length=scr.MAX_HOOK_CHARS)
    cta: str | None = Field(default=None, max_length=100)
    tone: str = Field(default="", max_length=60)
    target_seconds: float | None = Field(default=None, ge=5, le=600)


class ReviseRequest(CamelModel):
    instruction: Literal["shorten", "natural", "energetic", "regenerate"]


class VoiceGenerateRequest(CamelModel):
    voice_profile_id: str | None = None


class PreviewRequest(CamelModel):
    text: str | None = Field(default=None, max_length=200)


def _profile_out(d: dict) -> dict:
    return {"id": str(d["_id"]), **{k: d.get(k) for k in ("name", "voice", "language", "speed", "pitch", "energy", "emotion",
            "pauseStyle", "pronunciations")}, "createdAt": d.get("createdAt")}  # fmt: skip


def _settings(p: dict) -> SpeechSettings:
    return SpeechSettings(speed=p.get("speed", 1.0), pitch=p.get("pitch", 0.0), energy=p.get("energy", "medium"),
                          emotion=p.get("emotion", "friendly"), pause_style=p.get("pauseStyle", "natural"),
                          pronunciations=p.get("pronunciations") or {})  # fmt: skip


# ------------------------------------------------------------------ voice profiles
@voices_router.get("/system")
async def system_voices():
    """What can actually speak on this machine, and which languages are covered."""
    provider = get_voice_provider()
    voices = await asyncio.to_thread(provider.list_voices)
    langs = sorted({v.language.split("-")[0] for v in voices})
    covered = {"en": "en" in langs, "hi": "hi" in langs, "mr": "mr" in langs, "hinglish": "en" in langs}
    return {
        "provider": provider.name, "available": bool(voices), "voices": [v.__dict__ for v in voices], "languages": covered,
        "emotions": list(EMOTIONS), "energies": list(ENERGY), "pauseStyles": list(PAUSES),
        "note": None if all(covered.values()) else "Some languages have no installed voice. Install a Windows voice pack "
                                                   "(Settings > Time & language > Speech) or add another voice engine.",
    }  # fmt: skip


@voices_router.get("")
async def list_profiles():
    return [_profile_out(d) async for d in get_db().voices.find({}).sort("createdAt", -1)]


@voices_router.post("", status_code=201)
async def create_profile(payload: VoiceProfileIn):
    doc = {"_id": ObjectId(), **payload.to_doc(), "createdAt": utcnow()}
    await get_db().voices.insert_one(doc)
    return _profile_out(doc)


@voices_router.patch("/{voice_id}")
async def update_profile(voice_id: str, payload: VoiceProfileIn):
    oid = parse_id(voice_id, "Voice")
    if not await get_db().voices.find_one({"_id": oid}):
        raise NotFoundError("Voice profile not found.", code="VOICE_NOT_FOUND")
    await get_db().voices.update_one({"_id": oid}, {"$set": payload.to_doc()})
    return _profile_out(await get_db().voices.find_one({"_id": oid}))


@voices_router.delete("/{voice_id}", status_code=204)
async def delete_profile(voice_id: str):
    await get_db().voices.delete_one({"_id": parse_id(voice_id, "Voice")})
    return Response(status_code=204)


@voices_router.post("/{voice_id}/preview")
async def preview_profile(voice_id: str, payload: PreviewRequest | None = None):
    p = await get_db().voices.find_one({"_id": parse_id(voice_id, "Voice")})
    if not p:
        raise NotFoundError("Voice profile not found.", code="VOICE_NOT_FOUND")
    text = (payload.text if payload and payload.text else SAMPLE[p["language"]]).strip()
    wav = await asyncio.to_thread(_render_preview, p, text)
    return Response(content=wav, media_type="audio/wav")


def _render_preview(p: dict, text: str) -> bytes:
    provider = get_voice_provider()
    voice = provider.find_voice(p["language"], p.get("voice"))
    with tempfile.TemporaryDirectory(prefix="reel_prev_") as tmp:
        out = Path(tmp) / "preview.wav"
        synthesize_script(provider, [ScriptLine(text)], voice.id, _settings(p), scr.LANGUAGE_TAGS[p["language"]], out)
        return out.read_bytes()


# ------------------------------------------------------------------ script editor
def _script_out(doc: dict | None, settings: SpeechSettings | None = None) -> dict:
    s = doc or {"language": "en", "lines": [], "hook": None, "cta": None, "tone": "", "voiceProfileId": None}
    lines = [ScriptLine(ln["text"], ln.get("pauseAfter")) for ln in s.get("lines", []) if ln.get("text")]
    return {**s, "estimatedSeconds": estimate_seconds(lines, settings) if lines else 0.0}


async def _speech_for(doc: dict) -> SpeechSettings | None:
    pid = (doc.get("script") or {}).get("voiceProfileId") or doc["settings"].get("voiceProfileId")
    if not pid:
        return None
    try:
        p = await get_db().voices.find_one({"_id": ObjectId(pid)})
    except Exception:  # noqa: BLE001 - a stale id must not break the editor
        return None
    return _settings(p) if p else None


@script_router.get("/script")
async def get_script(project_id: str):
    doc = await ps.get_project_doc(project_id)
    return _script_out(doc.get("script"), await _speech_for(doc))


async def _save_script(doc: dict, script: dict) -> dict:
    script["updatedAt"] = utcnow()
    await get_db().projects.update_one({"_id": doc["_id"]}, {"$set": {"script": script, "updatedAt": utcnow()}})
    return _script_out(script, await _speech_for({**doc, "script": script}))


@script_router.put("/script")
async def put_script(project_id: str, payload: ScriptIn):
    doc = await ps.get_project_doc(project_id)
    lines = [{"text": ln.text.strip(), "pauseAfter": ln.pause_after} for ln in payload.lines if ln.text.strip()]
    return await _save_script(doc, {"language": payload.language, "lines": lines, "hook": payload.hook, "cta": payload.cta,
                                    "tone": payload.tone, "voiceProfileId": payload.voice_profile_id})  # fmt: skip


def _provider_or_raise():
    return get_provider("script")


@script_router.post("/script/hooks")
async def make_hooks(project_id: str, payload: HooksRequest | None = None):
    """Generate hook options ("Generate 3 Hooks"); the user picks one. Nothing is saved until they do."""
    doc = await ps.get_project_doc(project_id)
    req = payload or HooksRequest()
    language = (doc.get("script") or {}).get("language") or doc["settings"].get("language", "en")
    brief = doc["settings"].get("brief") or doc["name"]
    hooks = await asyncio.to_thread(scr.generate_hooks, _provider_or_raise(), brief, language, req.tone, req.count)
    return {"hooks": hooks, "language": language}


@script_router.post("/script/generate")
async def generate_script(project_id: str, payload: GenerateScriptRequest | None = None):
    doc = await ps.get_project_doc(project_id)
    req = payload or GenerateScriptRequest()
    settings = ProjectSettings.model_validate(doc["settings"])
    prior = doc.get("script") or {}
    language = prior.get("language") or settings.language
    speech = await _speech_for(doc)
    target = req.target_seconds or float(settings.duration)
    lines = await asyncio.to_thread(
        scr.write_script, _provider_or_raise(), settings.brief or doc["name"], language, req.tone or prior.get("tone", ""),
        target, req.hook or prior.get("hook"), req.cta or prior.get("cta"), speech.prosody()[0] if speech else 1.0,
    )
    return await _save_script(doc, {"language": language, "lines": [ln.to_doc() for ln in lines], "hook": req.hook or prior.get("hook"),
                                    "cta": req.cta or prior.get("cta"), "tone": req.tone or prior.get("tone", ""),
                                    "voiceProfileId": prior.get("voiceProfileId")})  # fmt: skip


@script_router.post("/script/revise")
async def revise_script(project_id: str, payload: ReviseRequest):
    doc = await ps.get_project_doc(project_id)
    prior = doc.get("script") or {}
    if not prior.get("lines"):
        raise ValidationFailed("Write or generate a script first.", code="EMPTY_SCRIPT")
    settings = ProjectSettings.model_validate(doc["settings"])
    speech = await _speech_for(doc)
    lines = await asyncio.to_thread(
        scr.revise_script, _provider_or_raise(), prior["lines"], payload.instruction, prior.get("language", settings.language),
        float(settings.duration), speech.prosody()[0] if speech else 1.0,
    )
    return await _save_script(doc, {**prior, "lines": [ln.to_doc() for ln in lines]})


# ------------------------------------------------------------------ voice generation
@script_router.post("/voice/generate")
async def generate_voice(project_id: str, payload: VoiceGenerateRequest | None = None):
    """Speak the script, then re-time the Reel to the real voice (shots, captions, music window)."""
    doc = await ts.load(project_id)
    if not doc.get("timeline"):
        raise NotFoundError("Generate a Reel first; the voice needs a timeline to fit.", code="NO_TIMELINE")
    script = doc.get("script") or {}
    lines = validate_lines([ScriptLine(ln["text"], ln.get("pauseAfter")) for ln in script.get("lines", [])])
    pid = (payload.voice_profile_id if payload else None) or script.get("voiceProfileId") or doc["settings"].get("voiceProfileId")
    if not pid:
        raise ValidationFailed("Choose a voice profile first.", code="NO_VOICE_PROFILE")
    profile = await get_db().voices.find_one({"_id": parse_id(pid, "Voice")})
    if not profile:
        raise NotFoundError("Voice profile not found.", code="VOICE_NOT_FOUND")

    language = script.get("language") or profile["language"]
    provider = get_voice_provider()
    voice = provider.find_voice(language, profile.get("voice"))
    storage = get_storage()
    key = project_key(project_id, "analysis", f"voice_{int(time.time())}.wav")
    result = await asyncio.to_thread(
        synthesize_script, provider, lines, voice.id, _settings(profile), scr.LANGUAGE_TAGS.get(language, "en-US"),
        storage.new_local_path(key),
    )
    storage.commit(key)

    track = VoiceTrack(file_key=key, duration=result.duration, start=0.3,
                       lines=[VoiceLine(text=ln.text, start=round(ln.start + 0.3, 3), end=round(ln.end + 0.3, 3)) for ln in result.lines],
                       profile_name=profile["name"], language=language)  # fmt: skip
    ops = [SetVoice(voice=track), ReplaceCaptions(captions=captions_from_voice(track)), FitToVoice(tail=0.8)]
    try:
        state = await ts.apply(project_id, ops, f"Voice-over: {profile['name']}")
    except EditError:
        storage.delete(key)  # nothing was applied; do not leave an orphan file
        raise
    # (an earlier voice file is kept: undo can bring it back; it is removed with the project)
    # the Reel now has a voice: make sure the audio mode uses it
    mode = doc["settings"].get("audioMode", "music")
    if mode in ("music", "none", "original"):
        new_mode = "voice_music" if mode == "music" and doc.get("audioId") else "voice"
        await get_db().projects.update_one({"_id": doc["_id"]}, {"$set": {"settings.audioMode": new_mode}})
    await get_db().projects.update_one({"_id": doc["_id"]}, {"$set": {"script.voiceProfileId": pid}})
    return {"state": state, "voice": {"duration": result.duration, "voice": voice.name, "lines": len(lines)}}


@script_router.delete("/voice")
async def remove_voice(project_id: str):
    return await ts.apply(project_id, [ClearVoice()], "Remove voice-over")


__all__ = ["voices_router", "script_router", "AppError"]
