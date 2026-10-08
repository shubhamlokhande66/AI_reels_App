"""Story projects: plan -> pictures -> render. A story project is an ordinary project (``reelType: "story"``) whose
``story`` field holds the plan; its pictures are stored like uploads, so versions, posting and auto-delete all work.

The shared picture library (``story_images`` + ``shared/story_images/``) is studio-wide: a picture made or found for one
description is reused for the next user who needs the same scene, so popular stories cost nothing after the first time.
Users' own uploads never go in it.
"""

from __future__ import annotations

import asyncio
import uuid
from typing import Any

import cv2
import numpy as np
from bson import ObjectId

from app.core.database import get_db, get_main_db
from app.core.errors import NotFoundError, ValidationFailed
from app.models.base import utcnow
from app.storage import get_storage, project_key
from app.story import images as im
from app.story.models import StoryPlan, StoryScene

LIBRARY_ROOT = "shared/story_images"
MAX_UPLOAD = 15 * 1024 * 1024


def _check_image(data: bytes) -> tuple[int, int]:
    """Decodable picture of a sensible size, or a clear error (the bytes are never trusted by their name)."""
    arr = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if arr is None:
        raise ValidationFailed("That file is not a picture we can read (use JPG or PNG).", code="INVALID_IMAGE")
    h, w = arr.shape[:2]
    if min(h, w) < 320:
        raise ValidationFailed("The picture is too small (at least 320 pixels on each side).", code="IMAGE_TOO_SMALL")
    return w, h


class SharedLibrary:
    """The studio-wide picture library (Mongo index + files). Synchronous parts run in a worker thread."""

    def __init__(self, loop: asyncio.AbstractEventLoop) -> None:
        self.loop = loop

    def _run(self, awaitable):
        """Await on the server's event loop from this worker thread (Motor returns futures, not coroutines)."""

        async def wait():
            return await awaitable

        return asyncio.run_coroutine_threadsafe(wait(), self.loop).result(timeout=30)

    def get(self, key: str, art_style: str, scene: StoryScene, skip: set[str]) -> im.Picture | None:
        doc = self._run(self._find(key, art_style, scene, skip))
        if not doc:
            return None
        storage = get_storage()
        if not storage.exists(doc["key"]):
            return None
        data = storage.read_bytes(doc["key"])
        return im.Picture(data, doc.get("ext", "jpg"), "library", doc.get("credit", ""), library_id=doc["_id"], ref=doc["_id"])

    async def _find(self, key: str, art_style: str, scene: StoryScene, skip: set[str]) -> dict | None:
        db = get_main_db()
        if key not in skip:
            exact = await db.story_images.find_one({"_id": key})
            if exact:
                return exact
        words = {w.lower() for w in [*scene.keywords, *scene.characters] if w}
        if len(words) < 2:
            return None
        best, best_score = None, 0.0
        async for d in db.story_images.find({"style": art_style, "tags": {"$in": sorted(words)}}).limit(50):
            if d["_id"] in skip:
                continue
            tags = set(d.get("tags", []))
            score = len(tags & words) / len(tags | words)
            if score > best_score:
                best, best_score = d, score
        return best if best_score >= 0.6 else None  # only a close match: the same people and things

    def remember(self, key: str, art_style: str, scene: StoryScene, pic: im.Picture) -> str:
        if pic.source == "library":
            return pic.library_id or key
        storage = get_storage()
        skey = f"{LIBRARY_ROOT}/{key}.{pic.ext}"
        storage.write_bytes(skey, pic.data)
        tags = sorted({w.lower() for w in [*scene.keywords, *scene.characters] if w})
        doc = {"key": skey, "ext": pic.ext, "style": art_style, "tags": tags, "source": pic.source, "credit": pic.credit,
               "visual": scene.visual[:300], "createdAt": utcnow()}  # fmt: skip
        self._run(get_main_db().story_images.update_one({"_id": key}, {"$set": doc}, upsert=True))
        return key


async def get_story(doc: dict[str, Any]) -> StoryPlan:
    if doc.get("settings", {}).get("reelType") != "story" or not doc.get("story"):
        raise ValidationFailed("This project is not a story Reel.", code="NOT_A_STORY_PROJECT")
    return StoryPlan.model_validate(doc["story"])


async def save_story(project_oid: ObjectId, plan: StoryPlan) -> None:
    await get_db().projects.update_one({"_id": project_oid}, {"$set": {"story": plan.model_dump(mode="json"), "updatedAt": utcnow()}})


def scene_of(plan: StoryPlan, scene_id: str) -> StoryScene:
    s = next((s for s in plan.scenes if s.id == scene_id), None)
    if s is None:
        raise NotFoundError("Scene not found.", code="SCENE_NOT_FOUND")
    return s


def _store_scene_picture(project_id: str, scene: StoryScene, data: bytes, ext: str) -> str:
    storage = get_storage()
    key = project_key(project_id, "input", f"scene_{scene.id}_{uuid.uuid4().hex[:6]}.{ext}")
    storage.write_bytes(key, data)
    if scene.image_key and storage.exists(scene.image_key):
        storage.delete(scene.image_key)  # the previous picture of this scene
    return key


async def find_scene_picture(doc: dict[str, Any], scene_id: str, another: bool = False) -> StoryScene:
    """Give a scene a picture (or the next one, with ``another``): cheapest source first, remembered in the library."""
    plan = await get_story(doc)
    scene = scene_of(plan, scene_id)
    skip = set(scene.seen) if another else set()
    if another and scene.library_id:
        skip.add(scene.library_id)
    lib = SharedLibrary(asyncio.get_running_loop())
    key = im.library_key(plan.art_style, scene)

    def work() -> tuple[im.Picture, str | None]:
        used = {r for s in plan.scenes if s.id != scene.id for r in s.seen}  # pictures other scenes show
        pic = im.find_picture(plan, scene, lib, skip | ({key} if another else set()), used)
        _check_image(pic.data)
        lib_id = lib.remember(key if pic.source != "public_domain" else f"pd_{uuid.uuid5(uuid.NAMESPACE_URL, pic.ref).hex[:20]}", plan.art_style, scene, pic)
        return pic, lib_id

    from app.services import credits

    try:
        pic, lib_id = await asyncio.to_thread(work)
    except im.NoPicture as exc:
        raise ValidationFailed(str(exc), code="NO_PICTURE") from exc
    if pic.source in ("free_ai", "paid_ai"):  # made just now for this user (the library and paintings are free)
        await credits.charge("paid_picture" if pic.source == "paid_ai" else "ai_picture", f"picture_{doc['_id']}_{scene.id}_{uuid.uuid4().hex[:6]}",
                             "AI picture for a story scene")  # fmt: skip
    scene.image_key = _store_scene_picture(str(doc["_id"]), scene, pic.data, pic.ext)
    scene.source, scene.credit, scene.library_id = pic.source, pic.credit, lib_id
    scene.seen = list(dict.fromkeys([*scene.seen, *(x for x in (pic.ref, lib_id) if x)]))[-30:]
    await save_story(doc["_id"], plan)
    return scene


async def upload_scene_picture(doc: dict[str, Any], scene_id: str, data: bytes) -> StoryScene:
    plan = await get_story(doc)
    scene = scene_of(plan, scene_id)
    if len(data) > MAX_UPLOAD:
        raise ValidationFailed("The picture is larger than 15 MB.", code="IMAGE_TOO_LARGE")
    _check_image(data)
    ext = "png" if data[:8] == b"\x89PNG\r\n\x1a\n" else "jpg"
    scene.image_key = _store_scene_picture(str(doc["_id"]), scene, data, ext)
    scene.source, scene.credit, scene.library_id = "upload", "Your picture", None
    await save_story(doc["_id"], plan)
    return scene


def edit_plan(plan: StoryPlan, title: str, scenes: list[dict[str, Any]]) -> StoryPlan:
    """The user's edits: text, order, deletions, new scenes. A scene whose description changed loses its picture."""
    old = {s.id: s for s in plan.scenes}
    out: list[StoryScene] = []
    for d in scenes[:14]:
        narration = str(d.get("narration", "")).strip()[:600]
        visual = str(d.get("visual", "")).strip()[:700]
        if not narration:
            continue
        prev = old.get(str(d.get("id", "")))
        if prev is None:
            out.append(StoryScene(id=uuid.uuid4().hex[:10], narration=narration, visual=visual or narration[:700]))
            continue
        changed = visual and visual != prev.visual
        out.append(prev.model_copy(update={
            "narration": narration, "visual": visual or prev.visual,
            **({"image_key": None, "source": None, "credit": "", "library_id": None, "seen": []} if changed and prev.source != "upload" else {}),
        }))  # fmt: skip
    if len(out) < 2:
        raise ValidationFailed("A story needs at least 2 scenes.", code="STORY_TOO_FEW_SCENES")
    return plan.model_copy(update={"title": title.strip()[:120] or plan.title, "scenes": out})
